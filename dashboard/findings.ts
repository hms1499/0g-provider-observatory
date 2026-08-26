/**
 * What stands out in one epoch, said in a sentence.
 *
 * The table already holds every number. What it does not do is tell a reader arriving cold
 * that anything happened: a column of `0%` reads as "nothing to see", and the one service
 * answering 13.33% where its peers answered 0% sits in it at the same weight as the rest.
 * This is the reason the project exists, and it was the hardest thing on the page to find.
 *
 * **These are observations, never verdicts.** Each one names a service and a number and stops
 * there. It does not say a provider is slow, unreliable, or worse than another — it says two
 * services claiming the same model returned different figures in this epoch, which is a
 * measurement. Why they differ is not a question this instrument can answer.
 *
 * **Only within a consistency group.** Comparing two models is not a comparison; a reasoning
 * model taking ten seconds is not losing to a small one taking two.
 *
 * **No superlatives and no ordering.** Nothing here says "worst" or "slowest", and the
 * observations come out in roster order rather than sorted by size, because a list sorted by
 * how bad a number is is a leaderboard with extra steps.
 */
import { formatBps, formatSeconds, type ModelGroup, type ProviderRow } from './rows.js';
import { isUnmeasured } from '../src/chain/encoding.js';

export type ObservationKind = 'error-rate-gap' | 'latency-spread' | 'short-sample';

export interface Observation {
  kind: ObservationKind;
  text: string;
}

/**
 * How far apart two error rates may be before they are worth pointing at.
 *
 * 1000 bps, the same tolerance `src/verify/reproduce.ts` uses to decide whether two runs
 * disagree — reused rather than reinvented so the page and the comparison tool draw the line
 * in the same place. It is a shade over one failed call in fifteen, which is the smallest
 * step a full suite can take.
 */
export const ERROR_RATE_TOLERANCE_BPS = 1000;

/**
 * How far apart two p50 figures may be before the difference is more than this instrument's
 * own repeatability.
 *
 * 2x, and the number comes from the project's own measurements rather than from taste: epochs
 * 496539 and 496540 ran the same roster an hour apart, and the p50 of a single service moved
 * by ratios between 0.76x and 1.36x between them. A spread smaller than that is inside what a
 * repeat run produces on its own, and reporting it would be reporting noise.
 *
 * p95 is deliberately NOT used here despite looking far more dramatic. At fifteen probes the
 * p95 *is* the slowest call, and across those same two epochs it moved by as much as 0.18x —
 * a spread five times wider than anything this rule would flag.
 */
export const LATENCY_SPREAD_RATIO = 2;

const short = (address: string) => `${address.slice(0, 10)}…${address.slice(-4)}`;

const measured = (rows: readonly ProviderRow[]) => rows.filter((r) => r.p50Ms > 0);

export function observe(groups: readonly ModelGroup[]): Observation[] {
  const out: Observation[] = [];

  for (const g of groups) {
    const rows = measured(g.rows);
    if (rows.length < 2) continue;

    // Error rates, against the lowest in the same group. The floor is a peer's real figure,
    // not zero, so a group where everything failed equally reports nothing to see.
    const rates = rows.filter((r) => !isUnmeasured(r.errorRateBps)).map((r) => r.errorRateBps);
    const floor = Math.min(...rates);
    for (const r of rows) {
      if (isUnmeasured(r.errorRateBps)) continue;
      if (r.errorRateBps - floor < ERROR_RATE_TOLERANCE_BPS) continue;
      out.push({
        kind: 'error-rate-gap',
        text: `${g.model}: ${short(r.address)} returned ${formatBps(r.errorRateBps)} errors where another provider of the same model returned ${formatBps(floor)}.`,
      });
    }

    // Typical latency, end to end across the group.
    const p50s = rows.map((r) => r.p50Ms);
    const lo = Math.min(...p50s);
    const hi = Math.max(...p50s);
    if (lo > 0 && hi / lo >= LATENCY_SPREAD_RATIO) {
      out.push({
        kind: 'latency-spread',
        text: `${g.model}: typical response time spans ${(hi / lo).toFixed(1)}× across ${rows.length} providers, from ${formatSeconds(lo)}s to ${formatSeconds(hi)}s.`,
      });
    }

    // A service the suite could not finish against. Its figures rest on fewer samples than
    // its peers', which is a caveat about the measurement rather than about the provider.
    const fullest = Math.max(...rows.map((r) => r.calls));
    for (const r of rows) {
      if (r.calls >= fullest) continue;
      out.push({
        kind: 'short-sample',
        text: `${g.model}: ${short(r.address)} answered ${r.calls} of ${fullest} calls, so its figures rest on fewer samples than its peers'.`,
      });
    }
  }

  return out;
}
