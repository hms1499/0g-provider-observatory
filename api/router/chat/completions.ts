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
 *
 * Lives at `api/router/chat/completions.ts` — not a bespoke `api/router.ts` — on purpose:
 * `buildPinnedRequest` in router-client.ts builds every call as `${baseUrl}/chat/completions`
 * and pins the provider via an `X-0G-Provider-Address` header, exactly like the real Router.
 * Serving that same shape means this relay is a drop-in replacement for the Router at
 * `baseUrl: '/api/router'`, and router-client.ts needs no special case to know it is talking
 * to a relay instead of the Router itself.
 */
import { loadPrices } from '../../../src/relay/prices.js';
import { allow, clientIp, createBucketStore } from '../../../src/relay/rate-limit.js';
import { buildUpstream, parseRelayBody, RelayRejected } from '../../../src/relay/request.js';

/** See src/relay/rate-limit.ts for the caller-key rule and the eviction it is paired with. */
const buckets = createBucketStore();

export const config = { maxDuration: 90 };

// Named export, not `export default`: @vercel/node only recognises the Web Fetch
// (Request -> Response) signature via a named export matching an HTTP method (or a
// `.fetch` property) — a `default` export gets treated as the legacy Node.js
// `(req, res)` handler instead, which is a silent mismatch (`req.headers.get` throws).
// Verified against @vercel/node's bundling-handler.js, so this is true at build time,
// not just under `vercel dev`. Exporting only POST also means the platform rejects
// every other method before this file runs at all.
export async function POST(req: Request): Promise<Response> {
  if (!allow(buckets, clientIp(req))) return json({ error: 'too many requests' }, 429);

  const authorization = req.headers.get('authorization') ?? undefined;

  try {
    // Checked before the price fetch, not only inside buildUpstream: loadPrices needs a
    // key too, and a request with none must cost us no upstream call at all.
    if (!authorization) {
      throw new RelayRejected('an Authorization: Bearer header is required', 401);
    }
    const providerAddress = req.headers.get('x-0g-provider-address') ?? undefined;
    const body = parseRelayBody(await req.json(), providerAddress);
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
