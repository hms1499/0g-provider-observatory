/**
 * Compare two independent measurements of the same epoch.
 *
 * This file imports nothing from `src/probes/`, for the same reason `recompute.ts`
 * does not: both sides of the comparison must go through the same independent
 * implementation, or the comparison inherits the bias it exists to detect.
 *
 * Neither run is treated as correct. The output names what the two runs disagree
 * about; which one is wrong is not a question this file can answer.
 */
import { recompute, type RecomputedService, type VerifiableBundle } from './recompute.js';

/**
 * The fields a cross-run comparison actually reads.
 *
 * `RecomputedService` satisfies this structurally, so recomputing a bundle still feeds
 * `compareRuns` directly. A live measurement taken in the page produces `ServiceStats`
 * plus a `DivergenceResult` and has no honest value for the rest — narrowing the input is
 * how invented zeros are kept out of a comparison against measured numbers.
 */
export interface ComparableService {
  address: string;
  modelId: string;
  mode: string;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
}

export interface Measured {
  services: readonly ComparableService[];
  /**
   * The value this run's bundle uses for "divergence was not measurable". Read from the
   * bundle rather than assumed: a bundle that never names one cannot express the
   * distinction, and then a withheld figure is indistinguishable from a real zero.
   */
  unmeasured?: number;
}

export type DisagreementKind =
  | 'mode'
  | 'divergence-measurability'
  | 'divergence-verdict'
  | 'error-rate';

/**
 * How far apart two error rates may be before the runs are called to disagree.
 *
 * 1000 bps is a shade over one failed call in fifteen, which is the smallest step a
 * full suite can take. A tighter bound would report the sampling grain as a finding.
 */
export const ERROR_RATE_TOLERANCE_BPS = 1000;

export interface Disagreement {
  kind: DisagreementKind;
  service: string;
  published: string | number;
  independent: string | number;
  message: string;
}

/**
 * Latency is reported as a ratio and never as a disagreement. Two runs an hour apart
 * see different load; a p50 that doubled is information, not a fault, and this file
 * has no way to tell which run caught the network on a bad minute.
 */
export interface LatencyRatio {
  service: string;
  p50Ratio: number;
  p95Ratio: number;
}

export interface ReproduceReport {
  compared: number;
  disagreements: Disagreement[];
  latency: LatencyRatio[];
  /** Measured by one run and not the other. Named, never silently dropped. */
  onlyPublished: string[];
  onlyIndependent: string[];
}

const idOf = (s: ComparableService) => `${s.address.toLowerCase()}|${s.modelId}`;
const nameOf = (s: ComparableService) => `${s.address} ${s.modelId}`;

export function compareRuns(published: Measured, independent: Measured): ReproduceReport {
  const byId = new Map(independent.services.map((s) => [idOf(s), s]));
  const disagreements: Disagreement[] = [];
  const latency: LatencyRatio[] = [];
  const onlyPublished: string[] = [];
  const matched = new Set<string>();
  let compared = 0;

  for (const a of published.services) {
    const b = byId.get(idOf(a));
    if (!b) {
      onlyPublished.push(nameOf(a));
      continue;
    }
    matched.add(idOf(a));
    compared += 1;

    latency.push({
      service: nameOf(a),
      p50Ratio: ratio(b.p50Ms, a.p50Ms),
      p95Ratio: ratio(b.p95Ms, a.p95Ms),
    });

    const aWithheld = published.unmeasured !== undefined && a.divergenceBps === published.unmeasured;
    const bWithheld = independent.unmeasured !== undefined && b.divergenceBps === independent.unmeasured;
    if (aWithheld !== bWithheld) {
      disagreements.push({
        kind: 'divergence-measurability',
        service: nameOf(a),
        published: aWithheld ? 'withheld' : a.divergenceBps,
        independent: bWithheld ? 'withheld' : b.divergenceBps,
        message: aWithheld
          ? 'the published run could not measure divergence for this service; the independent run could'
          : 'the independent run could not measure divergence for this service; the published run could',
      });
    } else if (!aWithheld && (a.divergenceBps > 0) !== (b.divergenceBps > 0)) {
      /**
       * Both runs measured it and reached opposite conclusions. The sizes are not
       * compared: two runs an hour apart will differ on magnitude, and only the
       * verdict — does this provider disagree with its peers at all — is stable.
       */
      disagreements.push({
        kind: 'divergence-verdict',
        service: nameOf(a),
        published: a.divergenceBps,
        independent: b.divergenceBps,
        message: 'one run found this service diverging from its peers and the other did not',
      });
    }

    if (Math.abs(a.errorRateBps - b.errorRateBps) > ERROR_RATE_TOLERANCE_BPS) {
      disagreements.push({
        kind: 'error-rate',
        service: nameOf(a),
        published: a.errorRateBps,
        independent: b.errorRateBps,
        message:
          `error rates ${a.errorRateBps} and ${b.errorRateBps} bps are more than ` +
          `${ERROR_RATE_TOLERANCE_BPS} bps apart`,
      });
    }

    if (a.mode !== b.mode) {
      disagreements.push({
        kind: 'mode',
        service: nameOf(a),
        published: a.mode,
        independent: b.mode,
        message: `the two runs observed different modes: ${a.mode} and ${b.mode}`,
      });
    }
  }

  const onlyIndependent = independent.services
    .filter((s) => !matched.has(idOf(s)))
    .map(nameOf);

  return { compared, disagreements, latency, onlyPublished, onlyIndependent };
}

/** A published zero would make every ratio infinite, so it is reported as 0 instead. */
function ratio(independentMs: number, publishedMs: number): number {
  return publishedMs === 0 ? 0 : independentMs / publishedMs;
}

/**
 * Compare a published epoch against an independent measurement of the same roster.
 *
 * Both bundles go through `recompute()`, so neither side is read through the code that
 * produced it, and the sentinel standing for "divergence not measurable" is taken from
 * each bundle's own rules rather than assumed to be shared.
 */
export function reproduce(
  published: VerifiableBundle,
  independent: VerifiableBundle,
): ReproduceReport {
  return compareRuns(
    { services: recompute(published), unmeasured: published.rules.divergenceUnmeasured },
    { services: recompute(independent), unmeasured: independent.rules.divergenceUnmeasured },
  );
}
