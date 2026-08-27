/**
 * Picking a provider from published measurements — F6, the part with no network in it.
 *
 * This is where the project stops describing and starts advising, and that is a bigger step
 * than its size suggests. The dashboard says "here is what I measured"; this says "use this
 * one". Everything below exists to make that step without giving up what the measurements are
 * worth, so four rules constrain it, and each one costs something:
 *
 * 1. **The caller states the axis. This module never invents one.** There is no
 *    `score = 0.5 * latency + 0.3 * errors`, because a single number blending three
 *    measurements is a league table with its weights hidden inside it. `orderBy` is one named
 *    field, and it is the caller's field.
 *
 * 2. **No criterion is ever relaxed.** Asking for `TeeML` and getting `TeeTLS` back because
 *    nothing else was available would quietly hand over a weaker guarantee than the one that
 *    was requested. No match returns nothing, and says why each candidate failed.
 *
 * 3. **Percentiles are pooled conservatively, never averaged.** See `summarise`.
 *
 * 4. **Everything the README admits not knowing travels with the answer.** `epochsUsed`,
 *    `measuredAt` and `modeChanged` are on the result because a caller who cannot see them
 *    cannot tell a figure resting on five epochs from one resting on a single slow minute.
 */
import { isUnmeasured } from '../chain/encoding.js';
import type { Mode } from '../chain/registry.js';

/** One service's reading in one epoch, as the ledger recorded it. */
export interface Sample {
  epoch: number;
  writtenAt: Date;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
  calls: number;
  observedMode: Mode;
}

/** One (address, model) pair and every reading of it in the window being considered. */
export interface ServiceHistory {
  address: string;
  model: string;
  samples: Sample[];
}

export type OrderBy = 'p50' | 'p95' | 'errorRate';

export interface Criteria {
  /** Exact model string as the registry records it. Required: services are per model. */
  model: string;
  /** Exact match, never "at least". A guarantee is not a scale this module gets to slide. */
  mode?: Mode;
  maxP95Ms?: number;
  maxP50Ms?: number;
  maxErrorRateBps?: number;
  /**
   * Require that in every epoch where divergence could be measured, it was zero.
   *
   * A predicate over epochs, not an average of them. Pooling divergence into one figure needs
   * a pooled noise floor, which this project has not solved and says so — averaging it here
   * would be the SDK making a claim the rest of the codebase refuses to make.
   */
  requireNoDivergence?: boolean;
  /** Reject a service measured in fewer epochs than this. Default 1. */
  minEpochs?: number;
  /** Reject everything if the newest reading is older than this. */
  maxAgeMs?: number;
  /** Which field decides the order. Default `p50`. */
  orderBy?: OrderBy;
}

export interface Candidate {
  address: string;
  model: string;
  /** The newest epoch's mode. Modes are recorded per epoch because they can change. */
  mode: Mode;
  /** True where the pooled window did not agree on the mode — see `summarise`. */
  modeChanged: boolean;
  /** Median of the per-epoch p50s. */
  p50Ms: number;
  /** The WORST p95 in the window, not the typical one. */
  p95Ms: number;
  /** Calls-weighted across the window: total attributed failures over total calls. */
  errorRateBps: number;
  /** Epochs in the window that measured this service. */
  epochsUsed: number;
  /** Epochs in the window where divergence was measurable at all. */
  divergenceMeasuredIn: number;
  /** Of those, how many found this service diverging from its peers. */
  divergedIn: number;
  calls: number;
  newestEpoch: number;
  measuredAt: Date;
}

export interface Rejection {
  address: string;
  model: string;
  reason: string;
}

export interface Selection {
  /** Best match by the stated axis, or null. Never a near miss. */
  best: Candidate | null;
  /** Every candidate that met the criteria, in the stated order. */
  matches: Candidate[];
  rejected: Rejection[];
  orderedBy: OrderBy;
  /** True when the criteria were met by nobody, as opposed to nobody being registered. */
  consideredCount: number;
}

/** Nearest-rank median, the same convention the published percentiles use. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

/**
 * Reduce one service's window to the figures a decision is made on.
 *
 * **p95 is the worst epoch, not the average of them.** At fifteen probes an epoch's p95 *is*
 * its slowest call, so averaging five of them produces a number no call ever took. A caller
 * asking for `maxP95Ms: 5000` is asking not to be surprised, and the answer they want is "no
 * epoch in this window was slower than that", which is the maximum.
 *
 * **p50 is the median of the epoch medians.** Also not a true pooled p50 — the ledger stores
 * summaries, not the calls behind them — but a middling epoch is a fair stand-in for a
 * middling call, and one bad minute cannot drag it the way a mean would.
 *
 * **The error rate is genuinely pooled.** Rate times calls recovers the failures each epoch
 * counted, so summing both sides gives a real rate over the window rather than an average of
 * rates that would weight a 3-call epoch like a 15-call one.
 *
 * **Divergence is counted, never averaged**, for the reason on `requireNoDivergence`.
 */
export function summarise(service: ServiceHistory): Candidate | null {
  const samples = [...service.samples].sort((a, b) => a.epoch - b.epoch);
  if (samples.length === 0) return null;

  const newest = samples[samples.length - 1];
  const calls = samples.reduce((n, s) => n + s.calls, 0);
  const failures = samples.reduce((n, s) => n + (s.errorRateBps * s.calls) / 10_000, 0);

  const measurable = samples.filter((s) => !isUnmeasured(s.divergenceBps));

  return {
    address: service.address,
    model: service.model,
    mode: newest.observedMode,
    modeChanged: new Set(samples.map((s) => s.observedMode)).size > 1,
    p50Ms: median(samples.map((s) => s.p50Ms)),
    p95Ms: Math.max(...samples.map((s) => s.p95Ms)),
    errorRateBps: calls === 0 ? 0 : Math.round((failures / calls) * 10_000),
    epochsUsed: samples.length,
    divergenceMeasuredIn: measurable.length,
    divergedIn: measurable.filter((s) => s.divergenceBps > 0).length,
    calls,
    newestEpoch: newest.epoch,
    measuredAt: newest.writtenAt,
  };
}

const ORDER: Record<OrderBy, (c: Candidate) => number> = {
  p50: (c) => c.p50Ms,
  p95: (c) => c.p95Ms,
  errorRate: (c) => c.errorRateBps,
};

/**
 * Apply the criteria. Pure, so the whole decision can be tested without a chain.
 *
 * Every rejection is named and reasoned. A caller who gets nothing back deserves to know
 * whether nobody serves the model, or four providers do and all four are slower than the
 * ceiling they set — those are different problems with different fixes.
 */
export function select(
  services: readonly ServiceHistory[],
  criteria: Criteria,
  now: Date = new Date(),
): Selection {
  const orderedBy = criteria.orderBy ?? 'p50';
  const minEpochs = criteria.minEpochs ?? 1;

  const matches: Candidate[] = [];
  const rejected: Rejection[] = [];
  let considered = 0;

  for (const service of services) {
    if (service.model !== criteria.model) continue;
    considered += 1;

    const c = summarise(service);
    if (c === null) {
      rejected.push({
        address: service.address,
        model: service.model,
        reason: 'no measurement in the window considered',
      });
      continue;
    }

    const fail = (reason: string) =>
      rejected.push({ address: c.address, model: c.model, reason });

    if (c.epochsUsed < minEpochs) {
      fail(`measured in ${c.epochsUsed} epoch(s), ${minEpochs} required`);
      continue;
    }
    if (criteria.maxAgeMs !== undefined && now.getTime() - c.measuredAt.getTime() > criteria.maxAgeMs) {
      const hours = Math.round((now.getTime() - c.measuredAt.getTime()) / 3_600_000);
      fail(`newest reading is ${hours}h old, older than the limit set`);
      continue;
    }
    if (criteria.mode !== undefined && c.mode !== criteria.mode) {
      fail(`mode is ${c.mode}, ${criteria.mode} required`);
      continue;
    }
    if (criteria.maxP50Ms !== undefined && c.p50Ms > criteria.maxP50Ms) {
      fail(`p50 ${c.p50Ms}ms is over the ${criteria.maxP50Ms}ms limit`);
      continue;
    }
    if (criteria.maxP95Ms !== undefined && c.p95Ms > criteria.maxP95Ms) {
      fail(`worst-epoch p95 ${c.p95Ms}ms is over the ${criteria.maxP95Ms}ms limit`);
      continue;
    }
    if (criteria.maxErrorRateBps !== undefined && c.errorRateBps > criteria.maxErrorRateBps) {
      fail(`error rate ${c.errorRateBps}bps is over the ${criteria.maxErrorRateBps}bps limit`);
      continue;
    }
    if (criteria.requireNoDivergence === true) {
      if (c.divergenceMeasuredIn === 0) {
        fail('divergence was never measurable for this service in the window');
        continue;
      }
      if (c.divergedIn > 0) {
        fail(`diverged from its peers in ${c.divergedIn} of ${c.divergenceMeasuredIn} epochs`);
        continue;
      }
    }

    matches.push(c);
  }

  const key = ORDER[orderedBy];
  // Ties break on address, so the same input always produces the same answer. Falling back to
  // a second measurement would be inventing the composite score rule 1 forbids.
  matches.sort((a, b) => key(a) - key(b) || a.address.localeCompare(b.address));

  return {
    best: matches[0] ?? null,
    matches,
    rejected,
    orderedBy,
    consideredCount: considered,
  };
}
