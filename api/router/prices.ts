/**
 * The network's advertised price list, forwarded for a caller who has a key.
 *
 * The Measure panel asks a reader to spend their own credit and, until this existed, could not
 * tell them how much. It knew the call count — 30 calls, 60 calls — and stopped there, which
 * is a count, not a price. The evidence bundle carries the tokens the published run actually
 * spent on every probe; what it does not carry is what a token costs, and `/v1/providers` is
 * CORS-blocked from a foreign origin exactly like the completions endpoint (403, verified
 * 2026-08-25). So a browser cannot price its own request without this.
 *
 * It obeys the same four rules as the completions relay, and one more that follows from what
 * it is:
 *
 * 1. **It holds no secret.** A request with no `Authorization` is rejected 401 before any
 *    upstream call. There is no key of ours behind it and no fallback.
 * 2. **The upstream is a constant** — `PROVIDERS_URL`, never read from a query or a header.
 * 3. **It logs no header and no body**, and scrubs upstream errors, because an upstream error
 *    string can carry a URL with a token in it.
 * 4. **It never gains chain access.** No RPC, no key, no write path.
 * 5. **It sends no probe and spends nothing.** Reading the catalogue is not a measurement and
 *    is not billable, so a reader can price a run before deciding to pay for one.
 *
 * What comes back is the table the relay itself prices ceilings from, not the raw upstream
 * response: `address|model -> { prompt, completion }` and nothing else. A caller learns what a
 * call costs, which is public, and learns nothing about any other caller.
 */
import { loadPrices } from '../../src/relay/prices.js';
import { allow, clientIp, createBucketStore } from '../../src/relay/rate-limit.js';
import { RelayRejected } from '../../src/relay/request.js';

/** Its own bucket store, so pricing a run cannot exhaust the budget for making one. */
const buckets = createBucketStore();

export const config = { maxDuration: 20 };

// Named export for the same reason `chat/completions.ts` uses one: @vercel/node reads a
// default export as the legacy Node handler, which is a silent mismatch.
export async function GET(req: Request): Promise<Response> {
  if (!allow(buckets, clientIp(req))) return json({ error: 'too many requests' }, 429);

  const authorization = req.headers.get('authorization') ?? undefined;

  try {
    if (!authorization) {
      throw new RelayRejected('an Authorization: Bearer header is required', 401);
    }
    const table = await loadPrices(authorization, fetchJson);
    return json({ prices: table }, 200);
  } catch (e) {
    if (e instanceof RelayRejected) return json({ error: e.message }, e.status);
    return json({ error: 'the relay could not read the price list' }, 502);
  }
}

async function fetchJson(url: string, auth: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: auth } });
  if (!res.ok) {
    // 401 and 403 are the caller's key, not our fault, and saying so is what lets a reader
    // fix it. Anything else is reported as an upstream failure without its body.
    if (res.status === 401 || res.status === 403) {
      throw new RelayRejected('the Router refused that key for the price list', res.status);
    }
    throw new RelayRejected('could not read the advertised price table', 502);
  }
  return res.json();
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
