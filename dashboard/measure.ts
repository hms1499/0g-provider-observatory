/**
 * Measure one consistency group from the page, and compare it against what was published.
 *
 * The probes are read from the evidence bundle rather than from `src/probes/suite.ts`. That
 * is the point: a reader does not have to trust this repository for the probe definitions,
 * they use the ones recorded in the evidence the published numbers were derived from.
 *
 * Ordering matches the prober: sequential within a provider, parallel across the providers
 * of a group. Concurrent calls to one provider would measure queueing, not the provider.
 */
import { aggregate } from '../src/probes/aggregate.js';
import { computeDivergence, divergenceLookup, type ServiceKey } from '../src/probes/divergence.js';
import { callPinned, type CallResult } from '../src/probes/router-client.js';
import type { Probe } from '../src/probes/suite.js';
import { DIVERGENCE_UNMEASURED } from '../src/chain/encoding.js';
import { compareRuns, type ComparableService, type ReproduceReport } from '../src/verify/reproduce.js';
import { recompute, type VerifiableBundle } from '../src/verify/recompute.js';

export interface MeasureProgress {
  done: number;
  total: number;
  probeId: string;
  address: string;
}

export async function measureGroup(args: {
  bundle: VerifiableBundle;
  canonicalId: string;
  apiKey: string;
  baseUrl?: string;
  onProgress?: (p: MeasureProgress) => void;
  call?: typeof callPinned;
}): Promise<{ live: ComparableService[]; report: ReproduceReport }> {
  const call = args.call ?? callPinned;
  const baseUrl = args.baseUrl ?? '/api/router';
  const probes = args.bundle.probes as unknown as Probe[];
  const services = args.bundle.roster.filter((s) => s.canonicalId === args.canonicalId);
  if (services.length === 0) {
    throw new Error(`no services in this epoch serve ${args.canonicalId}`);
  }

  const total = services.length * probes.length;
  let done = 0;
  const results: CallResult[] = [];

  await Promise.all(
    services.map(async (service) => {
      for (const probe of probes) {
        const r = await call({
          baseUrl,
          apiKey: args.apiKey,
          providerAddress: service.address,
          model: service.modelId,
          probe,
          params: { ...(service.sentParams ?? {}), dropped: service.droppedParams ?? [] },
        });
        results.push(r);
        done += 1;
        args.onProgress?.({ done, total, probeId: probe.id, address: service.address });
      }
    }),
  );

  const keys: ServiceKey[] = services.map((s) => ({
    address: s.address,
    modelId: s.modelId,
    canonicalId: s.canonicalId,
    mode: s.mode,
  }));
  const stats = aggregate(results);
  const divergenceOf = divergenceLookup(computeDivergence(results, keys));
  const modeOf = new Map(keys.map((k) => [`${k.address.toLowerCase()}|${k.modelId}`, k.mode]));

  const live: ComparableService[] = stats.map((s) => ({
    address: s.address,
    modelId: s.modelId,
    mode: modeOf.get(`${s.address.toLowerCase()}|${s.modelId}`) ?? 'unknown',
    p50Ms: s.p50Ms,
    p95Ms: s.p95Ms,
    errorRateBps: s.errorRateBps,
    divergenceBps: divergenceOf(s.address, s.modelId),
  }));

  const publishedAll = recompute(args.bundle);
  const published = publishedAll.filter((s) => s.canonicalId === args.canonicalId);

  const report = compareRuns(
    { services: published, unmeasured: args.bundle.rules.divergenceUnmeasured },
    { services: live, unmeasured: DIVERGENCE_UNMEASURED },
  );

  return { live, report };
}
