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
import { DIVERGENCE_PROBES, NOISE_PROBE_PAIR } from '../probes/divergence.js';
import type { Mode, Target } from '../probes/plan.js';
import type { CallResult } from '../probes/router-client.js';
import { PROBES, type Comparator } from '../probes/suite.js';

export const BUNDLE_SCHEMA = 'og-observatory-epoch/1';

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
}

export interface EpochBundle {
  schema: typeof BUNDLE_SCHEMA;
  epoch: number;
  prober: string;
  startedAt: string;
  endedAt: string;
  probes: BundleProbe[];
  roster: BundleService[];
  aggregation: {
    minSamples: number;
    percentile: string;
    basisPoints: string;
    divergenceProbeIds: readonly string[];
    noiseProbePair: readonly string[];
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
    })),
    aggregation: {
      minSamples: 5,
      percentile: 'nearest-rank, rank = ceil(k*n/100), no interpolation, integer arithmetic',
      basisPoints: 'round(part / whole * 10000), half-up, integer arithmetic',
      divergenceProbeIds: DIVERGENCE_PROBES,
      noiseProbePair: NOISE_PROBE_PAIR,
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
