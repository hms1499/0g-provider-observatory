/**
 * Independent recomputation of everything the Observatory publishes.
 *
 * This file imports NOTHING from `src/probes/`. That is the entire point. A verifier that
 * called `aggregate()` would re-run the same code that produced the numbers, so it would
 * agree with them even if the formula were wrong — it would check for tampering and
 * nothing else. Written separately, it also catches the case that matters most here: the
 * published rule and the code that ran having drifted apart.
 *
 * Every rule is read from the bundle, never assumed. If the bundle does not state
 * something, this file cannot compute it and says so rather than filling in a default.
 * The project's own test suite asserts that this implementation and `src/probes/` agree
 * on a real epoch; a disagreement is a finding either way, and neither side gets to be
 * automatically right.
 */

export type FaultSide = 'provider' | 'prober' | 'unknown' | 'unlisted';

export interface FaultAttribution {
  provider: readonly string[];
  prober: readonly string[];
  unknown: readonly string[];
}

export interface BundleRules {
  minSamples: number;
  percentile: string;
  basisPoints: string;
  /** 'last' — a reasoning model restates the question, so the first number is not the answer. */
  numericExtraction: 'first' | 'last';
  /** Source of the refusal regex, applied case-insensitively. */
  refusalPattern: string;
  /** Comparators whose verdict survives a truncated answer. */
  truncationSafeComparators: readonly string[];
  divergenceProbeIds: readonly string[];
  noiseProbePair: readonly string[];
  /** Value standing for "could not be measured". Absent in bundles written before /3. */
  divergenceUnmeasured?: number;
  divergencePublication?: string;
  faultAttribution: FaultAttribution;
}

export interface BundleResult {
  probeId: string;
  providerAddress: string;
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  text: string | null;
  truncated: boolean;
  errorKind?: string;
  at: string;
}

export interface VerifiableBundle {
  schema: string;
  epoch: number;
  prober: string;
  startedAt: string;
  endedAt: string;
  probes: Array<{ id: string; prompt: string; comparator: string; maxTokens: number; expect?: string }>;
  roster: Array<{
    address: string;
    modelId: string;
    canonicalId: string;
    mode: string;
    onchainMode: string | null;
    droppedParams: string[];
  }>;
  rules: BundleRules;
  results: BundleResult[];
}

/** rank = ceil(k*n/100), clamped to [1, n], written as integer division so it ports exactly. */
export function nearestRank(ascending: readonly number[], k: number): number {
  const n = ascending.length;
  if (n === 0) throw new Error('percentile of an empty sample');
  if (k <= 0) return ascending[0];
  if (k >= 100) return ascending[n - 1];
  const rank = Math.min(n, Math.max(1, Math.floor((k * n + 99) / 100)));
  return ascending[rank - 1];
}

/** round(part / whole * 10000), half up, integer arithmetic throughout. */
export function basisPoints(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.floor((part * 10000 + Math.floor(whole / 2)) / whole);
}

export function attributeFault(table: FaultAttribution, kind: string): FaultSide {
  if (table.provider.includes(kind)) return 'provider';
  if (table.prober.includes(kind)) return 'prober';
  if (table.unknown.includes(kind)) return 'unknown';
  return 'unlisted';
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function pickNumber(s: string, which: 'first' | 'last'): string | null {
  const m = s.replace(/[, ]/g, '').match(/-?\d+(?:\.\d+)?/g);
  if (!m) return null;
  const v = Number(which === 'last' ? m[m.length - 1] : m[0]);
  return Number.isFinite(v) ? String(v) : null;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

function canonicalJson(s: string): string | null {
  const body = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.stringify(sortKeys(JSON.parse(body)));
  } catch {
    return null;
  }
}

/**
 * Reduce an answer to the token actually compared. Null means the probe cannot be
 * compared, which is different from the answers differing.
 */
export function compareKey(
  comparator: string,
  text: string,
  rules: Pick<BundleRules, 'numericExtraction' | 'refusalPattern'> = {
    numericExtraction: 'last',
    refusalPattern: '',
  },
): string | null {
  switch (comparator) {
    case 'exact':
      return collapse(text);
    case 'numeric':
      return pickNumber(text, rules.numericExtraction);
    case 'json':
      return canonicalJson(text);
    case 'categorical':
      return new RegExp(rules.refusalPattern, 'i').test(text) ? 'refused' : 'answered';
    case 'freeform':
      return null;
    default:
      return null;
  }
}

export interface RecomputedService {
  address: string;
  modelId: string;
  canonicalId: string;
  mode: string;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
  rawDivergenceBps: number;
  noiseFloorBps: number;
  calls: number;
  successes: number;
  providerFailures: number;
  proberFaults: number;
  unknownFaults: number;
  unlistedFaults: number;
  comparedProbes: number;
  differingProbeIds: string[];
  method: string;
  sufficient: boolean;
}

const idOf = (address: string, modelId: string) => `${address.toLowerCase()}|${modelId}`;

export function recompute(bundle: VerifiableBundle): RecomputedService[] {
  const rules = bundle.rules;
  const comparatorOf = new Map(bundle.probes.map((p) => [p.id, p.comparator]));
  const truncationSafe = new Set(rules.truncationSafeComparators);

  // Answers usable for comparison: successful, and not truncated unless the comparator
  // survives truncation. A cut-off reply invents a difference that is the prober's, not
  // the provider's.
  const answers = new Map<string, Map<string, string[]>>();
  for (const r of bundle.results) {
    if (!r.ok || r.text === null) continue;
    const comparator = comparatorOf.get(r.probeId);
    if (r.truncated && comparator && !truncationSafe.has(comparator)) continue;
    const k = idOf(r.providerAddress, r.model);
    let probes = answers.get(k);
    if (!probes) answers.set(k, (probes = new Map()));
    const arr = probes.get(r.probeId);
    if (arr) arr.push(r.text);
    else probes.set(r.probeId, [r.text]);
  }

  const groups = new Map<string, typeof bundle.roster>();
  for (const s of bundle.roster) {
    const arr = groups.get(s.canonicalId);
    if (arr) arr.push(s);
    else groups.set(s.canonicalId, [s]);
  }

  const out: RecomputedService[] = [];

  for (const service of bundle.roster) {
    const mine = bundle.results.filter(
      (r) => idOf(r.providerAddress, r.model) === idOf(service.address, service.modelId),
    );

    const latencies = mine.filter((r) => r.ok).map((r) => r.latencyMs).sort((a, b) => a - b);
    let providerFailures = 0;
    let proberFaults = 0;
    let unknownFaults = 0;
    let unlistedFaults = 0;
    for (const r of mine) {
      if (r.ok) continue;
      switch (attributeFault(rules.faultAttribution, r.errorKind ?? '')) {
        case 'provider': providerFailures++; break;
        case 'prober': proberFaults++; break;
        case 'unknown': unknownFaults++; break;
        default: unlistedFaults++; break;
      }
    }
    const successes = latencies.length;
    const calls = successes + providerFailures;
    const sufficient = successes >= rules.minSamples;

    const { rawDivergenceBps, noiseFloorBps, divergenceBps, comparedProbes, differingProbeIds, method } =
      divergenceFor(service, groups.get(service.canonicalId) ?? [service], answers, rules, comparatorOf);

    out.push({
      address: service.address,
      modelId: service.modelId,
      canonicalId: service.canonicalId,
      mode: service.mode,
      p50Ms: sufficient ? nearestRank(latencies, 50) : 0,
      p95Ms: sufficient ? nearestRank(latencies, 95) : 0,
      errorRateBps: basisPoints(providerFailures, calls),
      divergenceBps,
      rawDivergenceBps,
      noiseFloorBps,
      calls,
      successes,
      providerFailures,
      proberFaults,
      unknownFaults,
      unlistedFaults,
      comparedProbes,
      differingProbeIds,
      method,
      sufficient,
    });
  }

  return out.sort((a, b) => a.address.localeCompare(b.address) || a.modelId.localeCompare(b.modelId));
}

function modal(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; tied = false; }
    else if (n === bestN) tied = true;
  }
  return tied ? null : best;
}

function divergenceFor(
  self: VerifiableBundle['roster'][number],
  members: VerifiableBundle['roster'],
  answers: Map<string, Map<string, string[]>>,
  rules: BundleRules,
  comparatorOf: Map<string, string>,
) {
  const selfProbes = answers.get(idOf(self.address, self.modelId));

  // Self-instability from the byte-identical probe pair, subtracted before publishing.
  // With one epoch it is 0 or 10000 and nothing between; 10000 zeroes the whole figure,
  // which is the safe direction — a service that cannot agree with itself should not be
  // reported as differing from its peers.
  const [na, nb] = rules.noiseProbePair;
  const left = selfProbes?.get(na) ?? [];
  const right = selfProbes?.get(nb) ?? [];
  const pairs = Math.min(left.length, right.length);
  let unstable = 0;
  // Comparable pairs only. A reply carrying no number is missing evidence, not evidence of
  // agreement, and leaving it in the denominator drags the floor down — which under-subtracts
  // and overstates the divergence reported against the provider.
  let comparable = 0;
  for (let i = 0; i < pairs; i++) {
    const a = compareKey('numeric', left[i], rules);
    const b = compareKey('numeric', right[i], rules);
    if (a === null || b === null) continue;
    comparable++;
    if (a !== b) unstable++;
  }
  const noiseSamples = comparable;
  const noiseFloorBps = comparable === 0 ? 0 : basisPoints(unstable, comparable);

  const reference = members.find((m) => m.mode === 'TeeML') ?? null;
  const isReference =
    reference !== null && reference.address === self.address && reference.modelId === self.modelId;

  if (members.length === 1 || isReference) {
    return {
      method: members.length === 1 ? 'ungrouped' : 'reference-self',
      rawDivergenceBps: 0, noiseFloorBps, divergenceBps: 0,
      comparedProbes: 0, differingProbeIds: [] as string[],
    };
  }

  const peers = members.filter((m) => !(m.address === self.address && m.modelId === self.modelId));
  const method = reference ? 'teeml-reference' : members.length === 2 ? 'symmetric-pair' : 'majority';

  let compared = 0;
  const differing: string[] = [];

  for (const probeId of rules.divergenceProbeIds) {
    const comparator = comparatorOf.get(probeId);
    if (!comparator) continue;
    const mine = selfProbes?.get(probeId)?.[0];
    if (mine === undefined) continue;
    const mineKey = compareKey(comparator, mine, rules);
    if (mineKey === null) continue;

    if (method === 'majority') {
      const keys = peers
        .map((p) => answers.get(idOf(p.address, p.modelId))?.get(probeId)?.[0])
        .filter((t): t is string => t !== undefined)
        .map((t) => compareKey(comparator, t, rules))
        .filter((k): k is string => k !== null);
      const winner = modal(keys);
      if (winner === null) continue;
      compared++;
      if (mineKey !== winner) differing.push(probeId);
      continue;
    }

    const other = method === 'teeml-reference' ? reference! : peers[0];
    const theirs = answers.get(idOf(other.address, other.modelId))?.get(probeId)?.[0];
    if (theirs === undefined) continue;
    const theirKey = compareKey(comparator, theirs, rules);
    if (theirKey === null) continue;
    compared++;
    if (mineKey !== theirKey) differing.push(probeId);
  }

  const rawDivergenceBps = basisPoints(differing.length, compared);
  return {
    method,
    rawDivergenceBps,
    noiseFloorBps,
    divergenceBps: publishedDivergence(rawDivergenceBps, noiseFloorBps, noiseSamples, rules),
    comparedProbes: compared,
    differingProbeIds: differing,
  };
}

/**
 * What the record should carry for divergence.
 *
 * A raw figure above zero with no measured floor cannot be attributed: there is no way to
 * separate the provider disagreeing with its peers from it disagreeing with itself. The
 * bundle names the value that stands for "not measured"; a bundle that does not name one
 * cannot express the distinction, so those figures fall back to the plain subtraction and
 * the mismatch surfaces as a disagreement rather than being papered over.
 */
function publishedDivergence(
  raw: number,
  floorBps: number,
  noiseSamples: number,
  rules: BundleRules,
): number {
  if (raw > 0 && noiseSamples === 0 && rules.divergenceUnmeasured !== undefined) {
    return rules.divergenceUnmeasured;
  }
  return Math.max(0, raw - floorBps);
}
