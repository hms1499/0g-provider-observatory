/**
 * Provider-pinned Router call layer — F1.
 *
 * Locked decision: pin via Router headers, do NOT fund a per-provider
 * sub-account. That avoids 20 sub-accounts and a 24-hour withdrawal lock.
 *
 *   X-0G-Provider-Address                      pin to exactly one provider
 *   X-0G-Provider-Max-Price-Usd-Prompt         safety valve, input price
 *   X-0G-Provider-Max-Price-Usd-Completion     safety valve, output price
 *
 * A malformed header makes the Router return 400, so validate before sending.
 *
 * Building the request is separated from sending it: the dry run can inspect the
 * exact bytes that would go on the wire without an API key and without spending.
 */
import { ROUTER_API } from '../config.js';
import type { Probe } from './suite.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** Prices must be plain decimals. Exponent form ("4.14e-7") makes the Router return 400. */
const PRICE_RE = /^\d+(\.\d+)?$/;

/** Generation parameters negotiated against what each service declares it supports. */
export interface NegotiatedParams {
  /** Sent only when the service declares support. 9/38 chatbot services do NOT take temperature. */
  temperature?: number;
  seed?: number;
  top_p?: number;
  /** Parameters dropped because the service does not declare support. Must be recorded. */
  dropped: string[];
}

export interface PinnedRequestInput {
  providerAddress: string;
  /** The exact string the Router routes on — use model_id, not canonical_id. */
  model: string;
  probe: Probe;
  params: NegotiatedParams;
  /** USD per token. Taken from pricing_usd and multiplied by a safety factor. */
  maxPriceUsdPrompt?: string;
  maxPriceUsdCompletion?: string;
}

export interface PinnedRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export class BadPinError extends Error {}

/**
 * Build a provider-pinned request. Pure, no I/O — the dry run calls this directly.
 * The API key is deliberately NOT included here, so a dump never leaks it.
 */
export function buildPinnedRequest(input: PinnedRequestInput): PinnedRequest {
  const { providerAddress, model, probe, params } = input;

  if (!ADDRESS_RE.test(providerAddress)) {
    throw new BadPinError(`Malformed provider address: ${providerAddress}`);
  }
  if (!model) throw new BadPinError('Missing model id');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-0G-Provider-Address': providerAddress,
  };

  for (const [name, value] of [
    ['X-0G-Provider-Max-Price-Usd-Prompt', input.maxPriceUsdPrompt],
    ['X-0G-Provider-Max-Price-Usd-Completion', input.maxPriceUsdCompletion],
  ] as const) {
    if (value === undefined) continue;
    if (!PRICE_RE.test(value)) {
      throw new BadPinError(`${name} must be a plain decimal, got: ${value}`);
    }
    headers[name] = value;
  }

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: probe.prompt }],
    max_tokens: probe.maxTokens,
    stream: false,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.top_p !== undefined) body.top_p = params.top_p;

  return { url: `${ROUTER_API}/chat/completions`, method: 'POST', headers, body };
}

export type ErrorKind =
  | 'bad_request'      // 400 — usually a malformed header
  | 'auth'             // 401/403 — wrong key, or missing the inference scope
  | 'payment'          // 402 — out of balance, or over the price ceiling we set
  | 'not_found'        // 404 — this provider does not serve this model
  | 'rate_limit'       // 429
  | 'upstream'         // 5xx — provider-side failure, counts toward their error rate
  | 'timeout'
  | 'network'
  | 'malformed'        // 200 but the body could not be read
  | 'no_content';      // 200, but the whole output budget went on reasoning before any answer

export interface CallResult {
  probeId: string;
  providerAddress: string;
  model: string;
  ok: boolean;
  status: number;
  /** Measured here, including time to read the full body. Our number, not the Router's. */
  latencyMs: number;
  text: string | null;
  usage: { prompt?: number; completion?: number; total?: number } | null;
  /** Needed by the TEE signature endpoint: /v1/proxy/signature/{chatID} */
  chatId: string | null;
  /**
   * The provider the Router echoes back in `x-provider` — proof the pin took effect.
   * Without checking this a mis-pinned epoch would silently measure the wrong service.
   */
  servedBy: string | null;
  /**
   * Requests left in the current rate-limit window, from `x-ratelimit-remaining-requests`.
   * Measured 2026-08-22: 500 requests per minute, reset on the minute boundary. An epoch is
   * 570 calls, so the limit is not the constraint — real latency is.
   */
  rateLimitRemaining: number | null;
  /**
   * The model hit max_tokens mid-sentence. A truncated answer is a measurement artifact,
   * not a provider difference: a reasoning model cut off partway through `(7^13) mod 1000`
   * returned a bare "7", which a numeric comparator would happily read as a real answer
   * differing from 407. Divergence must treat these as incomparable.
   */
  truncated: boolean;
  errorKind?: ErrorKind;
  errorMessage?: string;
  /** Parameters dropped when sending. The measurement must carry these for a fair comparison. */
  droppedParams: string[];
  at: string;
}

/**
 * Read the one choice a probe asks for, and decide what its absence means.
 *
 * A reasoning model can return HTTP 200 with `content: null`, its chain of thought in
 * `reasoning`, and `finish_reason: "length"` — it spent the entire output budget thinking
 * and never reached an answer. Measured live 2026-08-23: 15 such replies from
 * zai-org/GLM-5-FP8, every one of them published as an 86.7% error rate against that
 * service. The ceiling that cut it off is ours, so the fault is ours: `no_content` is
 * attributed to the prober and kept out of the provider's error rate.
 *
 * `reasoning` is deliberately NOT read as the answer. It is a scratchpad, and feeding it
 * to the comparators would score a model's thinking against another model's conclusion.
 *
 * A reply that ends normally with nothing in it is a different thing — that is the
 * provider returning an empty answer, and it stays `malformed`.
 */
export function readChoice(json: any): {
  text: string | null;
  truncated: boolean;
  errorKind: ErrorKind | undefined;
} {
  const choice = json?.choices?.[0];
  const text = choice?.message?.content ?? null;
  const truncated = choice?.finish_reason === 'length';

  if (text !== null) return { text, truncated, errorKind: undefined };
  return { text: null, truncated, errorKind: truncated ? 'no_content' : 'malformed' };
}

function rateLimitOf(res: Response): number | null {
  const v = res.headers.get('x-ratelimit-remaining-requests');
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function classify(status: number): ErrorKind {
  if (status === 400) return 'bad_request';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'payment';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  return 'upstream';
}

export interface CallOptions extends PinnedRequestInput {
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Send exactly one pinned call and time it.
 *
 * There is NO retry. Retrying corrupts the latency measurement and hides the error
 * rate — and the error rate is one of the things being measured. For more samples,
 * loop from outside and record each attempt separately.
 */
export async function callPinned(opts: CallOptions): Promise<CallResult> {
  const req = buildPinnedRequest(opts);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const base = {
    probeId: opts.probe.id,
    providerAddress: opts.providerAddress,
    model: opts.model,
    droppedParams: opts.params.dropped,
    at: new Date().toISOString(),
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = performance.now();

  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: { ...req.headers, authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify(req.body),
      signal: ac.signal,
    });
    const raw = await res.text();
    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      return {
        ...base, ok: false, status: res.status, latencyMs,
        text: null, usage: null, chatId: null, servedBy: null, truncated: false,
        rateLimitRemaining: rateLimitOf(res),
        errorKind: classify(res.status),
        errorMessage: raw.slice(0, 400),
      };
    }

    let json: any;
    try { json = JSON.parse(raw); } catch {
      return {
        ...base, ok: false, status: res.status, latencyMs,
        text: null, usage: null, chatId: null, servedBy: null, truncated: false,
        rateLimitRemaining: rateLimitOf(res),
        errorKind: 'malformed', errorMessage: raw.slice(0, 400),
      };
    }

    const { text, truncated, errorKind } = readChoice(json);
    const u = json?.usage ?? null;
    return {
      ...base,
      ok: text !== null,
      status: res.status,
      latencyMs,
      text,
      usage: u && {
        prompt: u.prompt_tokens, completion: u.completion_tokens, total: u.total_tokens,
      },
      truncated,
      chatId: json?.id ?? null,
      servedBy: res.headers.get('x-provider') ?? json?.provider_address ?? null,
      rateLimitRemaining: rateLimitOf(res),
      ...(errorKind && { errorKind, errorMessage: raw.slice(0, 400) }),
    };
  } catch (e: any) {
    const latencyMs = Math.round(performance.now() - t0);
    const timedOut = e?.name === 'AbortError';
    return {
      ...base, ok: false, status: 0, latencyMs,
      text: null, usage: null, chatId: null, servedBy: null, truncated: false,
      rateLimitRemaining: null,
      errorKind: timedOut ? 'timeout' : 'network',
      errorMessage: String(e?.message ?? e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The Router model catalogue. No auth required — a free preflight check. */
export async function fetchModels(): Promise<any[]> {
  const res = await fetch(`${ROUTER_API}/models`);
  if (!res.ok) throw new Error(`Router /models returned ${res.status}`);
  const body = (await res.json()) as { data?: any[] };
  return body.data ?? [];
}
