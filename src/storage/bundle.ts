/**
 * The evidence package for one epoch — what actually goes to 0G Storage.
 *
 * The on-chain record is seven integers per service. Everything that makes those integers
 * checkable lives here, and the merkle root of this file is what `storageRoot` points at.
 *
 * The transcript alone would not be enough. Recomputing a divergence figure needs the probe
 * prompts and their comparators; recomputing an error rate needs to know which failures were
 * attributed to whom; recomputing a p95 needs the percentile rule. Shipping only the raw
 * results would leave a verifier reading our repository to find those — which is trusting the
 * measurer, the one thing this project exists to avoid. So the bundle states them.
 *
 * Serialization is deterministic: the same epoch built twice produces the same bytes and
 * therefore the same root. Without that, a verifier who rebuilt the bundle would get a
 * different root and could not tell an honest rebuild from a tampered one.
 */
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  DIVERGENCE_PROBES,
  NOISE_PROBE_PAIR,
  REFUSAL_PATTERN,
  TRUNCATION_SAFE_COMPARATORS,
} from '../probes/divergence.js';
import { DIVERGENCE_UNMEASURED, faultSide } from '../probes/aggregate.js';
import { ERROR_KINDS } from '../probes/router-client.js';
import type { Mode, Target } from '../probes/plan.js';
import type { CallResult, NegotiatedParams, ReasoningEffort } from '../probes/router-client.js';
import { PROBES, type Comparator } from '../probes/suite.js';

/**
 * Bumped to /2 when building the verification CLI showed /1 was not actually verifiable:
 * it stated minSamples and the percentile formula but not the fault-attribution table, the
 * numeric extraction rule, the refusal regex or the truncation rule — so an error rate or a
 * divergence figure could not be recomputed from it without reading this repository.
 *
 * Bumped to /3 when `reasoning_effort` entered the request. /2 recorded only the parameters
 * a service REFUSED, which was enough while every accepted parameter was the same for
 * everyone. It is not enough once a parameter changes how much a model thinks: two epochs
 * measured at different efforts are not comparable, and nothing in /2 would have said so.
 */
export const BUNDLE_SCHEMA = 'og-observatory-epoch/3';

/**
 * Everything in the negotiated params except the bookkeeping list of what was dropped.
 * Derived rather than restated, so the bundle cannot claim a parameter the request omitted.
 */
function sentParamsOf(params: NegotiatedParams): SentParams {
  const { dropped: _dropped, ...sent } = params;
  return sent;
}

export interface BundleProbe {
  id: string;
  prompt: string;
  comparator: Comparator;
  maxTokens: number;
  expect?: string;
}

export interface BundleService {
  address: string;
  modelId: string;
  canonicalId: string;
  /** Mode per the Router. `TeeML` makes this service the calibration reference for its group. */
  mode: Mode;
  /** Mode derived from on-chain metadata. null means the Router lists it but the chain does not. */
  onchainMode: Mode | null;
  /**
   * Parameters this service would not accept. A service running at its own default temperature
   * is not on the same baseline as one pinned to 0, and a divergence figure that hides this
   * would be comparing two different things.
   */
  droppedParams: string[];
  /**
   * The generation parameters this service was actually sent.
   *
   * `droppedParams` says what was refused; this says what was applied. A verifier needs
   * both to know the baseline: a service at `reasoning_effort: 'low'` and the same service
   * at its own default are two different measurements of two different things.
   */
  sentParams: SentParams;
}

/** Applied generation parameters. A key is absent when the parameter was not sent at all. */
export interface SentParams {
  temperature?: number;
  seed?: number;
  top_p?: number;
  reasoning_effort?: ReasoningEffort;
}

export interface EpochBundle {
  schema: typeof BUNDLE_SCHEMA;
  epoch: number;
  prober: string;
  startedAt: string;
  endedAt: string;
  probes: BundleProbe[];
  roster: BundleService[];
  /** Everything needed to recompute the published numbers without reading our code. */
  rules: {
    minSamples: number;
    percentile: string;
    basisPoints: string;
    /** Which end of the answer the numeric comparator reads. */
    numericExtraction: 'first' | 'last';
    /** Source of the refusal regex, applied case-insensitively. */
    refusalPattern: string;
    /** Comparators whose verdict survives a truncated answer. */
    truncationSafeComparators: readonly string[];
    divergenceProbeIds: readonly string[];
    noiseProbePair: readonly string[];
    /** Value written into divergenceBps when the figure could not be measured. */
    divergenceUnmeasured: number;
    /** When a divergence figure may not be published at all. */
    divergencePublication: string;
    /** Which failures count against the provider, which are ours, which are neither. */
    faultAttribution: { provider: string[]; prober: string[]; unknown: string[] };
  };
  results: CallResult[];
}

export interface BundleInput {
  epoch: number;
  prober: string;
  startedAt: string;
  endedAt: string;
  roster: readonly Target[];
  results: readonly CallResult[];
}

export function buildBundle(input: BundleInput): EpochBundle {
  return {
    schema: BUNDLE_SCHEMA,
    epoch: input.epoch,
    prober: input.prober,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    probes: PROBES.map((p) => ({
      id: p.id,
      prompt: p.prompt,
      comparator: p.comparator,
      maxTokens: p.maxTokens,
      ...(p.expect !== undefined && { expect: p.expect }),
    })),
    roster: input.roster.map((t) => ({
      address: t.address,
      modelId: t.modelId,
      canonicalId: t.canonicalId,
      mode: t.mode,
      onchainMode: t.onchainMode,
      droppedParams: t.params.dropped,
      sentParams: sentParamsOf(t.params),
    })),
    rules: {
      minSamples: 5,
      percentile: 'nearest-rank, rank = ceil(k*n/100), no interpolation, integer arithmetic',
      basisPoints: 'round(part / whole * 10000), half-up, integer arithmetic',
      numericExtraction: 'last',
      refusalPattern: REFUSAL_PATTERN.source,
      truncationSafeComparators: TRUNCATION_SAFE_COMPARATORS,
      divergenceProbeIds: DIVERGENCE_PROBES,
      noiseProbePair: NOISE_PROBE_PAIR,
      divergenceUnmeasured: DIVERGENCE_UNMEASURED,
      divergencePublication:
        'the noise floor counts comparable pairs only; when it has 0 samples and raw ' +
        'divergence is above 0, publish divergenceUnmeasured instead of a rate',
      // Derived from faultSide() rather than restated, so the bundle cannot claim an
      // attribution the code does not apply.
      faultAttribution: {
        provider: ERROR_KINDS.filter((k) => faultSide(k) === 'provider'),
        prober: ERROR_KINDS.filter((k) => faultSide(k) === 'prober'),
        unknown: ERROR_KINDS.filter((k) => faultSide(k) === 'unknown'),
      },
    },
    results: [...input.results],
  };
}

/**
 * JSON with object keys in sorted order at every depth. Array order is left alone — the
 * results array is the chronological transcript, and reordering it would destroy the record
 * of when each call happened.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export function serializeBundle(bundle: EpochBundle): string {
  return `${stableStringify(bundle)}\n`;
}

/**
 * Local content commitment. NOT what goes on chain — `storageRoot` carries the 0G Storage
 * merkle root, which is what a verifier can actually fetch by. This is the cheap check that
 * the bytes uploaded are the bytes still on disk.
 */
export function localDigest(bytes: string): string {
  return keccak256(toUtf8Bytes(bytes));
}
