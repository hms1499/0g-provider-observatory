/**
 * The advertised price table, fetched server-side because it has to be.
 *
 * `/v1/providers` is CORS-blocked from a foreign origin exactly like `/v1/chat/completions`
 * — verified 2026-08-25, 403 — and the evidence bundle's roster carries no pricing, so a
 * browser has no way to learn what a call should cost. Having the relay look it up also
 * means a caller cannot widen its own ceiling.
 *
 * The table is cached as `address|model -> pricing_usd`, never the raw response. It is a
 * public catalogue that happens to sit behind auth, not per-caller data — this is written
 * down so nobody later mistakes the cache for something user-scoped.
 */
import { PROVIDERS_URL, priceKey, type PriceTable } from './request.js';

const TTL_MS = 60_000;

let cached: { at: number; table: PriceTable } | null = null;

export function priceTableFrom(data: unknown): PriceTable {
  const rows = (data as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return {};
  const table: PriceTable = {};
  for (const r of rows) {
    const address = r?.address;
    const model = r?.model_id;
    const pricing = r?.pricing_usd;
    if (typeof address !== 'string' || typeof model !== 'string' || !pricing) continue;
    table[priceKey(address, model)] = {
      prompt: typeof pricing.prompt === 'string' ? pricing.prompt : undefined,
      completion: typeof pricing.completion === 'string' ? pricing.completion : undefined,
    };
  }
  return table;
}

/**
 * `fetchJson` and `now` are injected so the cache can be tested without a network and
 * without waiting a minute.
 */
export async function loadPrices(
  authorization: string,
  fetchJson: (url: string, auth: string) => Promise<unknown>,
  now: number = Date.now(),
): Promise<PriceTable> {
  if (cached && now - cached.at < TTL_MS) return cached.table;
  const table = priceTableFrom(await fetchJson(PROVIDERS_URL, authorization));
  cached = { at: now, table };
  return table;
}
