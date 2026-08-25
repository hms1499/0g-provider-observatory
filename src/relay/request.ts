/**
 * The pure half of the measurement relay.
 *
 * The relay exists for one reason: the Router refuses any request carrying an `Origin`
 * outside its allowlist, and the `X-0G-Provider-Max-Price-Usd-*` headers are absent from
 * its `access-control-allow-headers`, so a browser that sent them would have its request
 * blocked before it left the machine. Measuring from a page therefore means measuring with
 * no price ceiling — unless a server attaches it.
 *
 * Everything here is a pure function so the rules that matter can be tested without a
 * network: which upstream is reachable, what happens without an Authorization header, and
 * whether a caller can widen its own price ceiling. It holds no secret of its own.
 */
import { toHeaderPrice } from '../probes/plan.js';

/** The only URL this relay will ever call. Never taken from a request. */
export const UPSTREAM = 'https://router-api.0g.ai/v1/chat/completions';
export const PROVIDERS_URL = 'https://router-api.0g.ai/v1/providers';

/** Matches `priceMultiplier: 3` in run-epoch.ts, so a page measures on the CLI's terms. */
export const PRICE_MULTIPLIER = 3;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BEARER_RE = /^Bearer\s+\S+$/;

export interface RelayBody {
  providerAddress: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  temperature?: number;
}

export interface PriceRow {
  prompt?: string;
  completion?: string;
}

/** Keyed by `${address.toLowerCase()}|${model}` — the unit is the pair, never the address. */
export type PriceTable = Record<string, PriceRow>;

export class RelayRejected extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'RelayRejected';
  }
}

export function priceKey(address: string, model: string): string {
  return `${address.toLowerCase()}|${model}`;
}

export function parseRelayBody(raw: unknown): RelayBody {
  const b = raw as Partial<RelayBody> | null;
  if (!b || typeof b !== 'object') throw new RelayRejected('body must be a JSON object', 400);
  if (typeof b.providerAddress !== 'string' || !ADDRESS_RE.test(b.providerAddress)) {
    throw new RelayRejected('providerAddress must be a 0x-prefixed 20-byte address', 400);
  }
  if (typeof b.model !== 'string' || b.model === '') {
    throw new RelayRejected('model must be a non-empty string', 400);
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new RelayRejected('messages must be a non-empty array', 400);
  }
  for (const m of b.messages) {
    if (typeof m?.role !== 'string' || typeof m?.content !== 'string') {
      throw new RelayRejected('each message needs a string role and content', 400);
    }
  }
  if (typeof b.max_tokens !== 'number' || !Number.isInteger(b.max_tokens) || b.max_tokens <= 0) {
    throw new RelayRejected('max_tokens must be a positive integer', 400);
  }
  if (b.temperature !== undefined && typeof b.temperature !== 'number') {
    throw new RelayRejected('temperature must be a number when present', 400);
  }
  return {
    providerAddress: b.providerAddress,
    model: b.model,
    messages: b.messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: b.max_tokens,
    ...(b.temperature === undefined ? {} : { temperature: b.temperature }),
  };
}

export function buildUpstream(
  body: RelayBody,
  authorization: string | undefined,
  prices: PriceTable,
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  // No fallback to a key of our own. That fallback is how a relay silently spends its
  // operator's money, and it would also make every measurement ours rather than theirs.
  if (!authorization || !BEARER_RE.test(authorization)) {
    throw new RelayRejected('an Authorization: Bearer header is required', 401);
  }

  const row = prices[priceKey(body.providerAddress, body.model)];
  if (!row) {
    // Sending it uncapped would be spending the caller's credit with no ceiling.
    throw new RelayRejected('no advertised price for that provider and model', 400);
  }

  // Both prompt and completion must be priced. A row with only one ceiling leaves the other spend
  // unbounded, so it is useless as a price control. toHeaderPrice returns undefined for zero
  // or missing values, so we check the row before building headers.
  const prompt = toHeaderPrice(Number(row.prompt ?? 0), PRICE_MULTIPLIER);
  const completion = toHeaderPrice(Number(row.completion ?? 0), PRICE_MULTIPLIER);
  if (!prompt || !completion) {
    throw new RelayRejected('provider and model must have both prompt and completion prices', 400);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization,
    'X-0G-Provider-Address': body.providerAddress,
    'X-0G-Provider-Max-Price-Usd-Prompt': prompt,
    'X-0G-Provider-Max-Price-Usd-Completion': completion,
  };

  // Rebuilt field by field rather than spread, so nothing a caller invents rides along.
  const payload: Record<string, unknown> = {
    model: body.model,
    messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: body.max_tokens,
    stream: false,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;

  return { url: UPSTREAM, init: { method: 'POST', headers, body: JSON.stringify(payload) } };
}
