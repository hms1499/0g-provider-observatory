/**
 * Build the plan for one measurement epoch from a snapshot — pure, no network I/O.
 *
 * Kept separate from execution so the dry run is possible: the same function
 * produces the plan, and the dry run only prints it instead of sending it.
 */
import { readFileSync } from 'node:fs';
import type { NegotiatedParams } from './router-client.js';
import { PROBES, SUITE_EST_INPUT_TOKENS, SUITE_MAX_OUTPUT_TOKENS } from './suite.js';

export type Mode = 'TeeML' | 'TeeTLS' | 'standard';

/** Per-token USD prices. Some services also publish tiers that rise with input size. */
export interface PricingUsd {
  prompt?: string;
  completion?: string;
  cached_prompt?: string;
  tiered_pricing?: Array<{ max_input_tokens: number; prompt?: string; completion?: string }>;
  [k: string]: unknown;
}

export interface SnapshotRouterService {
  address: string;
  model_id: string;
  canonical_id: string;
  service_type?: string;
  type?: string;
  is_healthy: boolean;
  provider_name?: string | null;
  verifiability?: 'TeeML' | 'TeeTLS';
  trust_mode?: string;
  supported_parameters?: string[];
  pricing_usd?: PricingUsd;
  latency?: number | null;
  uptime?: number | null;
}

export interface Snapshot {
  at: string;
  router: { count: number; services: SnapshotRouterService[] };
  onchain: {
    count: number;
    services: Array<{ provider: string; model: string; mode: Mode; serviceType: string; url: string }>;
  };
}

export function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
}

/** Guarantee mode per the Router. Confirmed to match the on-chain derivation exactly. */
export function routerMode(s: SnapshotRouterService): Mode {
  return s.verifiability ?? 'standard';
}

export interface Target {
  address: string;
  providerName: string | null;
  modelId: string;
  canonicalId: string;
  mode: Mode;
  /** Mode derived from on-chain metadata. null means the Router lists it but the chain does not. */
  onchainMode: Mode | null;
  params: NegotiatedParams;
  maxPriceUsdPrompt?: string;
  maxPriceUsdCompletion?: string;
  /** Estimated USD for all 15 probes against this service. An upper bound, not the real figure. */
  estCostUsd: number;
  /** What the Router reports. Kept so it can be compared against what we measure. */
  reportedLatency: number | null;
  /** Base-tier USD per token. What a probe actually costs — not what the header carries. */
  usdPerPromptToken: number;
  usdPerCompletionToken: number;
}

export interface PlanOptions {
  /**
   * Price ceiling = the service's highest published tier x this factor. A provider that
   * raises its price beyond this gets rejected by the Router instead of billing us.
   */
  priceMultiplier?: number;
  temperature?: number;
  seed?: number;
  /** Skip services the Router currently reports as unhealthy. */
  skipUnhealthy?: boolean;
}

/**
 * Negotiate generation parameters against what each service declares.
 *
 * The original plan said "temperature 0" across the board. That does not hold: 9/38
 * chatbot services (the whole Claude line plus kimi-k3) do not declare support for
 * `temperature`, and sending it may return 400. So drop the parameter and RECORD
 * what was dropped — comparing a service running at temperature 0 against one
 * running at its own default is comparing against a different baseline.
 */
export function negotiateParams(
  s: SnapshotRouterService,
  opts: PlanOptions = {},
): NegotiatedParams {
  const supported = new Set(s.supported_parameters ?? []);
  const dropped: string[] = [];
  const p: NegotiatedParams = { dropped };

  const temperature = opts.temperature ?? 0;
  if (supported.has('temperature')) p.temperature = temperature;
  else dropped.push('temperature');

  if (opts.seed !== undefined) {
    if (supported.has('seed')) p.seed = opts.seed;
    else dropped.push('seed');
  }
  return p;
}

/** Base-tier price. What a small probe actually costs, so this drives the estimate. */
const usdPerToken = (s: SnapshotRouterService, k: 'prompt' | 'completion') =>
  Number(s.pricing_usd?.[k] ?? 0);

/**
 * Highest price the service publishes across every tier.
 *
 * 12 of 38 chatbot services price in tiers that rise with input size, up to 4x the base
 * rate. Probes are ~250 input tokens so they always fall in the base tier, but building
 * the ceiling from the top tier means a ceiling can never reject a request mid-epoch just
 * because a prompt grew. The cost estimate still uses the base rate, which is what a probe
 * actually costs.
 */
export function maxUsdPerToken(s: SnapshotRouterService, k: 'prompt' | 'completion'): number {
  const base = Number(s.pricing_usd?.[k] ?? 0);
  const tiers = s.pricing_usd?.tiered_pricing ?? [];
  return tiers.reduce((hi, t) => Math.max(hi, Number(t[k] ?? 0)), base);
}

/**
 * A per-token price is around 1e-8 USD, so Number.toString() yields exponent form
 * ("4.14e-7"). A malformed header makes the Router return 400, so force plain decimal.
 */
export function plainDecimal(n: number, digits = 14): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * The X-0G-Provider-Max-Price-Usd-* headers are denominated in USD per MILLION tokens,
 * while `pricing_usd` in /v1/providers is USD per token. Sending the per-token figure is
 * rejected with `pinned_provider_exceeds_max_price` — it reads as a ceiling a million
 * times too low, and the message names the provider rather than the unit, so it looks
 * like the provider got more expensive.
 *
 * Measured against the live Router 2026-08-22 for qwen3-vl-30b-a3b-instruct, whose base
 * rate is 0.0000000359/token = 0.0359/M:
 *
 *   0.03    -> rejected        0.0359 -> accepted (the comparison is inclusive)
 *   0.036   -> accepted        0.14   -> accepted
 *
 * 0.14 is below that service's top tier of 0.1436/M and still passes, so the ceiling is
 * compared against the tier the request actually falls into, not the worst tier.
 *
 * Not documented at docs.0g.ai/ai-context — worth reporting to 0G DevRel.
 */
export const TOKENS_PER_PRICE_UNIT = 1_000_000;

export function toHeaderPrice(usdPerToken: number, multiplier: number): string | undefined {
  if (!usdPerToken) return undefined;
  return plainDecimal(usdPerToken * TOKENS_PER_PRICE_UNIT * multiplier);
}

export function buildTargets(snap: Snapshot, opts: PlanOptions = {}): Target[] {
  const mult = opts.priceMultiplier ?? 3;
  const onchain = new Map(
    snap.onchain.services.map((o) => [o.provider.toLowerCase(), o.mode] as const),
  );

  return snap.router.services
    .filter((s) => (s.service_type ?? s.type) === 'chatbot')
    .filter((s) => (opts.skipUnhealthy ? s.is_healthy : true))
    .map((s) => {
      const inUsd = usdPerToken(s, 'prompt');
      const outUsd = usdPerToken(s, 'completion');
      const inCap = maxUsdPerToken(s, 'prompt');
      const outCap = maxUsdPerToken(s, 'completion');
      return {
        address: s.address,
        providerName: s.provider_name ?? null,
        modelId: s.model_id,
        canonicalId: s.canonical_id,
        mode: routerMode(s),
        onchainMode: onchain.get(s.address.toLowerCase()) ?? null,
        params: negotiateParams(s, opts),
        maxPriceUsdPrompt: toHeaderPrice(inCap, mult),
        maxPriceUsdCompletion: toHeaderPrice(outCap, mult),
        estCostUsd: inUsd * SUITE_EST_INPUT_TOKENS + outUsd * SUITE_MAX_OUTPUT_TOKENS,
        reportedLatency: s.latency ?? null,
        usdPerPromptToken: inUsd,
        usdPerCompletionToken: outUsd,
      };
    });
}

export interface ConsistencyGroup {
  canonicalId: string;
  targets: Target[];
  /** The TeeML service used as the calibration reference. null means peer-to-peer only. */
  reference: Target | null;
  /** Modes present in the group. A group holding both TeeML and another mode calibrates. */
  modes: Mode[];
}

/** Group services by model where more than one provider serves it — the input to F2. */
export function consistencyGroups(targets: Target[]): ConsistencyGroup[] {
  const by = new Map<string, Target[]>();
  for (const t of targets) {
    const arr = by.get(t.canonicalId) ?? [];
    arr.push(t);
    by.set(t.canonicalId, arr);
  }
  return [...by.entries()]
    .filter(([, ts]) => ts.length > 1)
    .map(([canonicalId, ts]) => ({
      canonicalId,
      targets: ts,
      reference: ts.find((t) => t.mode === 'TeeML') ?? null,
      modes: [...new Set(ts.map((t) => t.mode))],
    }))
    .sort((a, b) => b.targets.length - a.targets.length);
}

export interface EpochPlan {
  snapshotAt: string;
  targets: Target[];
  groups: ConsistencyGroup[];
  probeCount: number;
  callCount: number;
  estCostUsd: number;
  /** Services that had to drop temperature — must be labelled when publishing divergence. */
  degraded: Target[];
  /** Listed by the Router but absent from the contract. The two sources are known to diverge. */
  routerOnly: Target[];
  /**
   * Registered on the contract but never exposed by the Router. Header pinning CANNOT
   * reach these — a real limit of the F1 decision, stated rather than quietly ignored.
   */
  unreachable: Array<{ provider: string; model: string; mode: Mode; url: string }>;
}

export function buildPlan(snap: Snapshot, opts: PlanOptions = {}): EpochPlan {
  const targets = buildTargets(snap, opts);
  const routerAddrs = new Set(snap.router.services.map((s) => s.address.toLowerCase()));
  return {
    snapshotAt: snap.at,
    targets,
    groups: consistencyGroups(targets),
    probeCount: PROBES.length,
    callCount: targets.length * PROBES.length,
    estCostUsd: targets.reduce((n, t) => n + t.estCostUsd, 0),
    degraded: targets.filter((t) => t.params.dropped.length > 0),
    routerOnly: targets.filter((t) => t.onchainMode === null),
    unreachable: snap.onchain.services
      .filter((o) => o.serviceType === 'chatbot' && !routerAddrs.has(o.provider.toLowerCase()))
      .map((o) => ({ provider: o.provider, model: o.model, mode: o.mode, url: o.url })),
  };
}
