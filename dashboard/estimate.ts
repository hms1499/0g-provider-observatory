/**
 * What a group cost the published run, and what it would cost at today's advertised rates.
 *
 * The Measure panel asked a reader to spend their own credit and told them a call count. A
 * count is not a price, and the two are not close: this suite's probes run from 33 output
 * tokens to 2726, so thirty calls can differ by an order of magnitude in what they bill.
 *
 * The basis is measured, not modelled. Every call in the evidence bundle carries the tokens it
 * actually used, so the token half of the figure is a reading rather than a projection. What
 * is projected is only the price applied to it, and only two things can move it:
 *
 * - **Advertised rates change.** The figure is priced from the table fetched now, against
 *   tokens spent then.
 * - **A reasoning model bills its thinking.** The published run measured that too — it is in
 *   these very tokens — but a model that thinks for longer on the reader's attempt bills more.
 *   This is the reason `max_tokens` was never an upper bound on cost, recorded at length in
 *   `docs/HANDOFF.md`.
 *
 * So the figure is offered as what the published run would cost today, which is a fact about
 * evidence, and never as a promise about the reader's own bill.
 */

/**
 * `address|model -> price in USD per token`, as the relay's price route returns it.
 *
 * Per token, not per million. `pricing_usd` in `/v1/providers` is a per-token figure of around
 * 1e-8, while the `X-0G-Provider-Max-Price-Usd-*` headers the prober sends are denominated per
 * million — the two units sit next to each other in this codebase and `src/probes/plan.ts`
 * carries the measurement that established which is which. Confusing them here would divide
 * every estimate by a million and print `$0.0000` against a button that spends real credit.
 */
export interface PriceRow {
  prompt?: string;
  completion?: string;
}
export type PriceTable = Record<string, PriceRow>;

export interface GroupUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** Services in this group whose price the table does not carry, as `address|model`. */
  unpriced: string[];
  usd: number | null;
}

/** The key the relay's table is built on. Kept identical to `src/relay/request.ts`. */
export function priceKey(address: string, model: string): string {
  return `${address.toLowerCase()}|${model}`;
}

interface UsageResult {
  providerAddress?: string;
  model?: string;
  usage?: { prompt?: number; completion?: number } | null;
}

interface RosterEntry {
  address: string;
  modelId: string;
  canonicalId: string;
}

/**
 * Sum one group's tokens from the evidence, and price them if the table can.
 *
 * Priced per service rather than per group, because two providers of one model do not have to
 * charge the same thing — and if they did, the group would not be worth measuring.
 *
 * **A service is an (address, model) pair, never an address.** Operators serve several models:
 * `0xF203A388` serves both `glm-5.2` and `qwen3.7-plus` in the pinned roster. Selecting this
 * group's calls by address alone pulls in that operator's calls for every other model it
 * serves — measured here as $0.070 against a true $0.020, because the qwen calls came along
 * with the glm ones. `rows.ts` already says pooling by address is the exact defect this project
 * exists to point at; this is the same defect wearing a different hat.
 *
 * A service the table does not price is named rather than dropped or zeroed. Returning a total
 * that silently omits a provider would understate the bill, and understating what a reader is
 * about to spend is the one direction this figure must never be wrong in. With any service
 * unpriced, `usd` is null.
 */
export function groupUsage(
  results: readonly UsageResult[],
  roster: readonly RosterEntry[],
  canonicalId: string,
  prices: PriceTable | null,
): GroupUsage {
  const inGroup = roster.filter((s) => s.canonicalId === canonicalId);
  const services = new Set(inGroup.map((s) => priceKey(s.address, s.modelId)));

  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let usd = 0;
  const unpriced = new Set<string>();

  for (const r of results) {
    const address = r.providerAddress?.toLowerCase();
    if (address === undefined || r.model === undefined) continue;
    const key = priceKey(address, r.model);
    if (!services.has(key)) continue;

    calls += 1;
    const prompt = r.usage?.prompt ?? 0;
    const completion = r.usage?.completion ?? 0;
    promptTokens += prompt;
    completionTokens += completion;

    if (prices === null) continue;
    const row = prices[key];
    const promptRate = Number(row?.prompt);
    const completionRate = Number(row?.completion);
    if (!Number.isFinite(promptRate) || !Number.isFinite(completionRate)) {
      unpriced.add(key);
      continue;
    }
    // Rates are per token. See the note on PriceTable — there is no factor here on purpose.
    usd += prompt * promptRate + completion * completionRate;
  }

  return {
    calls,
    promptTokens,
    completionTokens,
    unpriced: [...unpriced],
    usd: prices === null || unpriced.size > 0 ? null : usd,
  };
}

/**
 * A small amount of money, written so it cannot round to nothing.
 *
 * `$0.00` against a button that spends real credit is worse than no figure at all — it reads
 * as free. Below a cent the figure keeps enough places to stay true.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Thousands separated, because six figures of tokens are unreadable without it. */
export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}
