/**
 * Turn raw call results into the per-service numbers that get written on chain — F1.
 *
 * The output of this module is what a reader ends up trusting, so three rules shape it:
 *
 * 1. NEVER POOL BY ADDRESS. The unit is (address, model), same as ProviderRegistry.
 *    Pooling by address is the exact defect this project exists to point at: on
 *    2026-08-21 the Router reported four differently-sized models at an identical
 *    9408 ms because the figure was aggregated at the address.
 *
 * 2. OUR FAULTS ARE NOT THEIR ERRORS. A 401 from an expired key, a 402 from an empty
 *    balance, a 429 from our own rate-limit window are prober failures. Counting one
 *    against a provider's error rate would publish an accusation caused by our own
 *    billing. Prober-side failures are excluded from the rate and reported separately.
 *
 * 3. TOO FEW SAMPLES MEANS NO NUMBER. A p95 over two successful calls is not a p95.
 *    Services below the sample floor are marked insufficient and left out of the epoch
 *    entirely, which is why MeasurementRegistry stores no zero-filled placeholder.
 *
 * Every formula here is integer-only and stated exactly, because the verification CLI
 * has to recompute these same values from the raw transcript and get the same bits. A
 * percentile method that rounded differently in another language would break F7.
 */
import type { CallResult, ErrorKind } from './router-client.js';
import { DIVERGENCE_UNMEASURED } from '../chain/encoding.js';

/** Who a failure belongs to. */
export type FaultSide = 'provider' | 'prober' | 'unknown';

/**
 * Attribution of each error kind.
 *
 * `network` is genuinely ambiguous — our link or theirs — so it is neither counted
 * against the provider nor silently dropped. It is surfaced as `unknown` and the
 * dashboard says so rather than guessing.
 */
export function faultSide(kind: ErrorKind): FaultSide {
  switch (kind) {
    case 'upstream':
    case 'timeout':
    case 'malformed':
    case 'not_found':
      return 'provider';
    case 'auth':
    case 'payment':
    case 'bad_request':
    // Our probe's max_tokens ceiling cut the model off before it answered. Charging
    // that to the provider publishes an accusation we caused.
    case 'no_content':
    // A 429 is the Router refusing OUR key, not a service failing. `classify()` reads it
    // from the HTTP status alone, and the counter it exhausts is `x-ratelimit-remaining`
    // on the prober's own credentials — nothing about it describes the provider. Epoch
    // 496620 is the proof: 570 calls in 254 s took that header from 499 to 0 and collected
    // 137 429s in the final 8 seconds, and nine services were published with those charged
    // against them. Seven of the nine had no provider-side failure at all — `kimi-k3` at
    // `0x1F444c8A…` went on chain at 6667 bps when its true rate was 0.
    case 'rate_limit':
      return 'prober';
    case 'network':
      return 'unknown';
  }
}

export interface ServiceStats {
  address: string;
  modelId: string;
  /** Latency percentiles over SUCCESSFUL calls only. A 402 that failed in 30 ms is not fast. */
  p50Ms: number;
  p95Ms: number;
  /** Basis points over provider-attributable attempts. 10000 = 100%. */
  errorRateBps: number;
  /** Attempts that count: successes plus provider-attributable failures. */
  calls: number;
  successes: number;
  providerFailures: number;
  /** Excluded from `calls` and from the rate — these are ours. */
  proberFaults: number;
  /** Neither attributed nor hidden. */
  unknownFaults: number;
  errorsByKind: Partial<Record<ErrorKind, number>>;
  /** Generation parameters this service would not accept, e.g. temperature. */
  droppedParams: string[];
  /** False when there were too few successful calls to report a percentile honestly. */
  sufficient: boolean;
  /** Every latency sample, ascending. Kept so the CLI can recompute the percentiles. */
  latenciesMs: number[];
}

export interface AggregateOptions {
  /**
   * Minimum successful calls before percentiles are published. Default 5 of 15 probes.
   * Below this the numbers describe noise, not a service.
   */
  minSamples?: number;
}

const key = (address: string, modelId: string) => `${address.toLowerCase()}|${modelId}`;

/**
 * Nearest-rank percentile on an ascending array, integer arithmetic throughout.
 *
 *   rank = ceil(k * n / 100), clamped to [1, n]      value = sorted[rank - 1]
 *
 * No interpolation and no floating point, so a verifier reimplementing this in another
 * language lands on the same value. Integer ceiling division is written as
 * floor((k*n + 99) / 100) rather than Math.ceil on a quotient, for the same reason.
 *
 * Note what this means at n = 15: p95 has rank 15, so it IS the slowest call. A p95
 * from one epoch carries almost no tail information — it becomes meaningful only once
 * many epochs are pooled. `calls` is published alongside so a reader can see that.
 */
export function percentileNearestRank(ascending: readonly number[], k: number): number {
  const n = ascending.length;
  if (n === 0) throw new Error('percentile of an empty sample');
  if (k <= 0) return ascending[0];
  if (k >= 100) return ascending[n - 1];
  const rank = Math.min(n, Math.max(1, Math.floor((k * n + 99) / 100)));
  return ascending[rank - 1];
}

/** Half-up rounding in integer arithmetic: round(part / whole * 10000). */
export function toBasisPoints(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 10000 + Math.floor(whole / 2)) / whole);
}

/**
 * Aggregate raw results into one record per (address, model).
 *
 * Accepts results from a single epoch or from many pooled together — the grouping and
 * the maths are identical, which is how the dashboard gets a p95 worth reading.
 */
export function aggregate(
  results: readonly CallResult[],
  opts: AggregateOptions = {},
): ServiceStats[] {
  const minSamples = opts.minSamples ?? 5;
  const groups = new Map<string, CallResult[]>();

  for (const r of results) {
    const k = key(r.providerAddress, r.model);
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }

  const out: ServiceStats[] = [];

  for (const rows of groups.values()) {
    const latencies: number[] = [];
    const errorsByKind: Partial<Record<ErrorKind, number>> = {};
    const dropped = new Set<string>();
    let providerFailures = 0;
    let proberFaults = 0;
    let unknownFaults = 0;

    for (const r of rows) {
      for (const p of r.droppedParams) dropped.add(p);

      if (r.ok) {
        latencies.push(r.latencyMs);
        continue;
      }

      const kind = r.errorKind ?? 'network';
      errorsByKind[kind] = (errorsByKind[kind] ?? 0) + 1;

      switch (faultSide(kind)) {
        case 'provider':
          providerFailures++;
          break;
        case 'prober':
          proberFaults++;
          break;
        case 'unknown':
          unknownFaults++;
          break;
      }
    }

    latencies.sort((a, b) => a - b);
    const successes = latencies.length;
    const calls = successes + providerFailures;
    const sufficient = successes >= minSamples;

    out.push({
      address: rows[0].providerAddress,
      modelId: rows[0].model,
      p50Ms: sufficient ? percentileNearestRank(latencies, 50) : 0,
      p95Ms: sufficient ? percentileNearestRank(latencies, 95) : 0,
      errorRateBps: toBasisPoints(providerFailures, calls),
      calls,
      successes,
      providerFailures,
      proberFaults,
      unknownFaults,
      errorsByKind,
      droppedParams: [...dropped].sort(),
      sufficient,
      latenciesMs: latencies,
    });
  }

  return out.sort((a, b) => a.address.localeCompare(b.address) || a.modelId.localeCompare(b.modelId));
}

export { DIVERGENCE_UNMEASURED } from '../chain/encoding.js';

/** Shape of one row in MeasurementRegistry.writeEpoch. */
export interface OnchainMeasurement {
  providerId: number;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
  calls: number;
  observedMode: number;
}

export class FieldOverflow extends Error {}

const fit = (name: string, v: number, max: number): number => {
  if (!Number.isInteger(v) || v < 0 || v > max) {
    throw new FieldOverflow(`${name} = ${v} does not fit the on-chain field (0..${max})`);
  }
  return v;
};

/** Basis points, or the sentinel. Anything between the two is a bug, not a rounding case. */
const fitDivergence = (v: number): number =>
  v === DIVERGENCE_UNMEASURED ? v : fit('divergenceBps', v, 10000);

export interface ResolveContext {
  /** Registry id for a service, or null if it was never registered. */
  providerId(address: string, modelId: string): number | null;
  /** Mode observed this epoch, as a ProviderRegistry.Mode index. */
  observedMode(address: string, modelId: string): number;
  /** Divergence from T5, in basis points. Absent until T5 lands. */
  divergenceBps?(address: string, modelId: string): number;
}

/**
 * Convert aggregates into the rows written on chain.
 *
 * Services that are insufficient, or absent from the registry, are dropped rather than
 * padded with zeros — a zero p50 reads as "instant", and MeasurementRegistry deliberately
 * has no placeholder for them. The caller learns which were dropped so the dashboard can
 * show a gap instead of silence.
 *
 * Overflow throws instead of clamping. Silently saturating a p95 at 65535 would publish a
 * number that looks measured and is not.
 */
export function toMeasurements(
  stats: readonly ServiceStats[],
  ctx: ResolveContext,
): { rows: OnchainMeasurement[]; skipped: { stats: ServiceStats; reason: string }[] } {
  const rows: OnchainMeasurement[] = [];
  const skipped: { stats: ServiceStats; reason: string }[] = [];

  for (const s of stats) {
    if (!s.sufficient) {
      skipped.push({ stats: s, reason: `only ${s.successes} successful calls` });
      continue;
    }
    const id = ctx.providerId(s.address, s.modelId);
    if (id === null) {
      skipped.push({ stats: s, reason: 'not registered in ProviderRegistry' });
      continue;
    }

    rows.push({
      providerId: fit('providerId', id, 0xffff),
      p50Ms: fit('p50Ms', s.p50Ms, 0xffffffff),
      p95Ms: fit('p95Ms', s.p95Ms, 0xffffffff),
      errorRateBps: fit('errorRateBps', s.errorRateBps, 10000),
      divergenceBps: fitDivergence(ctx.divergenceBps?.(s.address, s.modelId) ?? 0),
      calls: fit('calls', s.calls, 0xffff),
      observedMode: fit('observedMode', ctx.observedMode(s.address, s.modelId), 0xff),
    });
  }

  return { rows, skipped };
}
