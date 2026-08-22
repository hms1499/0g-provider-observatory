/**
 * Consistency measurement — F2.
 *
 * The question: do two providers claiming the same model behave the same way? The answer
 * is a distance, never a verdict. Section 08 of the design doc is explicit — report
 * divergence, do not attribute cause. A provider that differs from its peers may be
 * running a different model, a different quantisation, a different sampler, or a
 * different system prompt. This module cannot tell which, and does not guess.
 *
 * Three decisions shape the numbers:
 *
 * 1. A REFERENCE WHEN ONE EXISTS, A SYMMETRIC DISTANCE WHEN IT DOES NOT.
 *    Where a group contains a TeeML service — the model provably ran inside the enclave —
 *    that service is the reference and the others are measured against it. Only one of ten
 *    multi-provider groups has one (`glm-5.2`). Everywhere else the number is a symmetric
 *    distance between peers: both sides carry the same figure, because with no ground
 *    truth there is no basis for calling either one wrong.
 *
 * 2. SELF-INSTABILITY IS SUBTRACTED FIRST.
 *    `arith-mult` and `arith-mult-repeat` are byte-identical prompts. A provider that
 *    answers them differently is unstable on its own, and that instability would otherwise
 *    be misread as "different model". The measured noise floor is subtracted from the raw
 *    divergence. The subtraction is deliberately conservative: it can only lower a
 *    provider's number, never raise it.
 *
 * 3. FREEFORM PROBES ARE NOT COMPARED.
 *    Two of fifteen probes ask for open text under a countable constraint. Comparing them
 *    would mean F7 reimplementing "exactly seven words" in another language, and word
 *    counting is ambiguous enough that two implementations would disagree. Keeping the
 *    comparison to normalised strings, numbers and parsed JSON keeps the verification
 *    contract something anyone can reproduce. Those probes stay in the transcript for a
 *    human to read.
 *
 * Every rule below is part of the verification contract: F7 recomputes these values from
 * the raw transcript, so the normalisation, the refusal regex and the arithmetic all have
 * to be reproducible exactly.
 */
import type { CallResult } from './router-client.js';
import { toBasisPoints } from './aggregate.js';
import { PROBES, type Comparator } from './suite.js';

/** Result of comparing one answer against another. */
export type Verdict = 'match' | 'differ' | 'incomparable';

/**
 * The byte-identical probe pair used to measure a provider's instability against itself.
 * Both members are real probes; only the second is held out of the divergence count, so
 * asking the same question twice does not give it double weight.
 */
export const NOISE_PROBE_PAIR = ['arith-mult', 'arith-mult-repeat'] as const;

/** The member excluded from divergence — its twin still counts as an ordinary probe. */
export const NOISE_PROBE_DUPLICATE = NOISE_PROBE_PAIR[1];

/** Collapse whitespace runs and trim. Nothing else — case and punctuation are signal. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * First number in the text, ignoring thousands separators.
 * Returns null when there is none, which makes the probe incomparable rather than wrong.
 */
export function extractNumber(s: string): number | null {
  const m = s.replace(/[, ]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** Parse and re-serialise with sorted keys, so key order is not mistaken for a difference. */
export function canonicalJson(s: string): string | null {
  const body = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.stringify(sortKeys(JSON.parse(body)));
  } catch {
    return null;
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/**
 * Refusal detector for the policy-boundary probe. A heuristic, and named as one.
 *
 * The exact pattern is part of the verification contract — F7 must apply this same regex
 * to reach the same verdict — so it is written out here rather than tuned per run. It
 * records WHETHER a provider declined, never whether declining was correct.
 */
export const REFUSAL_PATTERN =
  /\b(i (?:can(?:no|')t|won'?t|am (?:un)?able|cannot)|i'?m (?:sorry|not able|unable)|sorry,? (?:but )?i|as an ai|i must decline|not able to (?:help|assist|provide))/i;

export function classifyRefusal(s: string): 'refused' | 'answered' {
  return REFUSAL_PATTERN.test(s) ? 'refused' : 'answered';
}

/** Reduce an answer to the token the comparator actually compares. Null means incomparable. */
export function comparisonKey(comparator: Comparator, text: string): string | null {
  switch (comparator) {
    case 'exact':
      return normalizeText(text);
    case 'numeric': {
      const n = extractNumber(text);
      return n === null ? null : String(n);
    }
    case 'json':
      return canonicalJson(text);
    case 'categorical':
      return classifyRefusal(text);
    case 'freeform':
      return null; // deliberately not compared — see the header
  }
}

export function compareAnswers(comparator: Comparator, a: string, b: string): Verdict {
  const ka = comparisonKey(comparator, a);
  const kb = comparisonKey(comparator, b);
  if (ka === null || kb === null) return 'incomparable';
  return ka === kb ? 'match' : 'differ';
}

/** How a group's divergence was established. */
export type Method =
  | 'teeml-reference' // measured against a service that provably ran the model in an enclave
  | 'reference-self' // this service IS the reference
  | 'symmetric-pair' // two peers, no ground truth: both carry the same distance
  | 'majority' // three or more peers, compared against the modal answer
  | 'ungrouped'; // only provider of this model — nothing to compare against

export interface DivergenceResult {
  address: string;
  modelId: string;
  canonicalId: string;
  method: Method;
  groupSize: number;
  referenceAddress: string | null;
  /** Divergence before subtracting self-instability. */
  rawDivergenceBps: number;
  /** Measured instability against the byte-identical probe pair. */
  noiseFloorBps: number;
  /** How many epochs contributed a usable duplicate pair. 1 makes the floor 0 or 10000. */
  noiseSamples: number;
  /** What goes on chain: max(0, raw - noise). Can only ever be lower than raw. */
  divergenceBps: number;
  comparedProbes: number;
  differingProbeIds: string[];
}

export interface ServiceKey {
  address: string;
  modelId: string;
  canonicalId: string;
  /** ProviderRegistry.Mode name. 'TeeML' makes this service a reference. */
  mode: string;
}

const idOf = (address: string, modelId: string) => `${address.toLowerCase()}|${modelId}`;
const COMPARATORS = new Map(PROBES.map((p) => [p.id, p.comparator] as const));
/**
 * 12 of 15 probes carry the divergence figure: the two freeform probes are not compared,
 * and the duplicated arithmetic probe is held out so its twin is not weighted twice.
 */
const DIVERGENCE_PROBES = PROBES.filter(
  (p) => p.comparator !== 'freeform' && p.id !== NOISE_PROBE_DUPLICATE,
).map((p) => p.id);

/**
 * Comparators that survive a truncated answer.
 *
 * `categorical` only asks whether the provider refused, and a refusal is visible in the
 * opening words, so cutting the reply short changes nothing. Every other comparator reads
 * the answer itself, where truncation invents a difference that is ours, not theirs.
 */
const TRUNCATION_SAFE = new Set<Comparator>(['categorical']);

/** Answers by service then probe. Multiple epochs collapse to the last successful answer. */
function indexAnswers(results: readonly CallResult[]) {
  const byService = new Map<string, Map<string, string[]>>();
  for (const r of results) {
    if (!r.ok || r.text === null) continue;
    const comparator = COMPARATORS.get(r.probeId);
    if (r.truncated && comparator && !TRUNCATION_SAFE.has(comparator)) continue;
    const k = idOf(r.providerAddress, r.model);
    let probes = byService.get(k);
    if (!probes) byService.set(k, (probes = new Map()));
    const arr = probes.get(r.probeId);
    if (arr) arr.push(r.text);
    else probes.set(r.probeId, [r.text]);
  }
  return byService;
}

/**
 * Instability of a service against itself, from the byte-identical probe pair.
 *
 * With one epoch there is one observation, so the floor is 0 or 10000 and nothing in
 * between. A floor of 10000 wipes out the whole divergence figure — which is the safe
 * direction to err: a provider that cannot agree with itself should not be reported as
 * differing from its peers. Pooling epochs turns this into a real rate.
 */
export function noiseFloor(probes: Map<string, string[]> | undefined): {
  bps: number;
  samples: number;
} {
  if (!probes) return { bps: 0, samples: 0 };
  const [a, b] = NOISE_PROBE_PAIR;
  const left = probes.get(a) ?? [];
  const right = probes.get(b) ?? [];
  const n = Math.min(left.length, right.length);
  if (n === 0) return { bps: 0, samples: 0 };

  let disagreements = 0;
  for (let i = 0; i < n; i++) {
    if (compareAnswers('numeric', left[i], right[i]) === 'differ') disagreements++;
  }
  return { bps: toBasisPoints(disagreements, n), samples: n };
}

function modal(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  let tied = false;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * Compute divergence for every service, grouped by the model they claim to serve.
 *
 * Accepts one epoch or many pooled together, exactly like `aggregate()`. Pooling is how
 * the noise floor stops being a coin flip.
 */
export function computeDivergence(
  results: readonly CallResult[],
  services: readonly ServiceKey[],
): DivergenceResult[] {
  const answers = indexAnswers(results);
  const groups = new Map<string, ServiceKey[]>();
  for (const s of services) {
    const arr = groups.get(s.canonicalId);
    if (arr) arr.push(s);
    else groups.set(s.canonicalId, [s]);
  }

  const out: DivergenceResult[] = [];

  for (const [canonicalId, members] of groups) {
    const reference = members.find((m) => m.mode === 'TeeML') ?? null;

    for (const self of members) {
      const selfProbes = answers.get(idOf(self.address, self.modelId));
      const noise = noiseFloor(selfProbes);

      const base = {
        address: self.address,
        modelId: self.modelId,
        canonicalId,
        groupSize: members.length,
        referenceAddress: reference?.address ?? null,
        noiseFloorBps: noise.bps,
        noiseSamples: noise.samples,
      };

      // Nothing to compare against.
      if (members.length === 1) {
        out.push({
          ...base, method: 'ungrouped', referenceAddress: null,
          rawDivergenceBps: 0, divergenceBps: 0, comparedProbes: 0, differingProbeIds: [],
        });
        continue;
      }

      // This service defines the standard the others are measured against.
      if (reference && reference.address === self.address && reference.modelId === self.modelId) {
        out.push({
          ...base, method: 'reference-self',
          rawDivergenceBps: 0, divergenceBps: 0, comparedProbes: 0, differingProbeIds: [],
        });
        continue;
      }

      const peers = members.filter(
        (m) => !(m.address === self.address && m.modelId === self.modelId),
      );
      const method: Method = reference
        ? 'teeml-reference'
        : members.length === 2
          ? 'symmetric-pair'
          : 'majority';

      let compared = 0;
      const differing: string[] = [];

      for (const probeId of DIVERGENCE_PROBES) {
        const comparator = COMPARATORS.get(probeId)!;
        const mine = selfProbes?.get(probeId)?.[0];
        if (mine === undefined) continue;

        let theirs: string | undefined;
        if (method === 'teeml-reference') {
          theirs = answers.get(idOf(reference!.address, reference!.modelId))?.get(probeId)?.[0];
        } else if (method === 'symmetric-pair') {
          theirs = answers.get(idOf(peers[0].address, peers[0].modelId))?.get(probeId)?.[0];
        } else {
          const keys = peers
            .map((p) => answers.get(idOf(p.address, p.modelId))?.get(probeId)?.[0])
            .filter((t): t is string => t !== undefined)
            .map((t) => comparisonKey(comparator, t))
            .filter((k): k is string => k !== null);
          const winner = modal(keys);
          if (winner === null) continue; // no majority — say nothing rather than pick a side
          const mineKey = comparisonKey(comparator, mine);
          if (mineKey === null) continue;
          compared++;
          if (mineKey !== winner) differing.push(probeId);
          continue;
        }

        if (theirs === undefined) continue;
        const verdict = compareAnswers(comparator, mine, theirs);
        if (verdict === 'incomparable') continue;
        compared++;
        if (verdict === 'differ') differing.push(probeId);
      }

      const raw = toBasisPoints(differing.length, compared);
      out.push({
        ...base,
        method,
        rawDivergenceBps: raw,
        divergenceBps: Math.max(0, raw - noise.bps),
        comparedProbes: compared,
        differingProbeIds: differing,
      });
    }
  }

  return out.sort(
    (a, b) => a.canonicalId.localeCompare(b.canonicalId) || a.address.localeCompare(b.address),
  );
}

/** Lookup shaped for `toMeasurements`'s divergenceBps hook. */
export function divergenceLookup(
  results: readonly DivergenceResult[],
): (address: string, modelId: string) => number {
  const m = new Map(results.map((r) => [idOf(r.address, r.modelId), r.divergenceBps]));
  return (address, modelId) => m.get(idOf(address, modelId)) ?? 0;
}
