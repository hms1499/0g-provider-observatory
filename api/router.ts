/**
 * Forward exactly one chat completion to the 0G Router.
 *
 * This endpoint holds no secret and performs no measurement. It exists because the Router
 * refuses any request whose `Origin` is outside its allowlist — a deployed dashboard cannot
 * be on that list — and because its `access-control-allow-headers` omits the
 * `X-0G-Provider-Max-Price-Usd-*` pair, so a browser sending a price ceiling has its request
 * blocked before it leaves the machine. Measuring from a page without a relay would mean
 * measuring with no ceiling, on the reader's own credit.
 *
 * It cannot produce a wrong measurement, because it does not measure. What a reader has to
 * trust is that it does not log one header, and that is checkable by reading this file.
 */
import { loadPrices } from '../src/relay/prices.js';
import { buildUpstream, parseRelayBody, RelayRejected } from '../src/relay/request.js';

/** A token bucket per IP. See the note at `allow()` for what this does and does not promise. */
const buckets = new Map<string, { tokens: number; at: number }>();
const RATE_CAPACITY = 40;
const RATE_REFILL_PER_MS = 40 / 60_000;

export const config = { maxDuration: 90 };

// Named export, not `export default`: @vercel/node only recognises the Web Fetch
// (Request -> Response) signature via a named export matching an HTTP method (or a
// `.fetch` property) — a `default` export gets treated as the legacy Node.js
// `(req, res)` handler instead, which is a silent mismatch (`req.headers.get` throws).
// Verified against @vercel/node's bundling-handler.js, so this is true at build time,
// not just under `vercel dev`. Exporting only POST also means the platform rejects
// every other method before this file runs at all.
export async function POST(req: Request): Promise<Response> {
  if (!allow(clientIp(req))) return json({ error: 'too many requests' }, 429);

  const authorization = req.headers.get('authorization') ?? undefined;

  try {
    // Checked before the price fetch, not only inside buildUpstream: loadPrices needs a
    // key too, and a request with none must cost us no upstream call at all.
    if (!authorization) {
      throw new RelayRejected('an Authorization: Bearer header is required', 401);
    }
    const body = parseRelayBody(await req.json());
    const prices = await loadPrices(authorization, fetchJson);
    const { url, init } = buildUpstream(body, authorization, prices);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    try {
      const upstream = await fetch(url, { ...init, signal: ac.signal });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e instanceof RelayRejected) return json({ error: e.message }, e.status);
    // Scrubbed on purpose: an upstream error string can carry a URL with a token in it.
    return json({ error: 'the relay could not complete this request' }, 502);
  }
}

async function fetchJson(url: string, auth: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: auth } });
  if (!res.ok) throw new RelayRejected('could not read the advertised price table', 502);
  return res.json();
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
}

/**
 * Casual abuse only. Fluid Compute reuses instances, so this map survives between requests
 * often enough to be useful — but it is per-instance, so it is NOT a hard guarantee across
 * a scaled-out deployment. Saying so here is cheaper than someone later assuming otherwise.
 *
 * The vector that would actually matter, using this as an anonymising relay to arbitrary
 * hosts, is closed by the upstream URL being a constant rather than by this function.
 */
function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_CAPACITY, at: now };
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + (now - b.at) * RATE_REFILL_PER_MS);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}
