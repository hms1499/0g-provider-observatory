/**
 * Measure one consistency group from the page, and compare it against what was published.
 *
 * What comes from the bundle, and what does not — stated plainly because overstating this
 * is worse than an honest gap:
 *
 *   - The prompts, `maxTokens` and expected answers SENT to the Router are the bundle's.
 *     A reader does not have to trust this repository for what was asked.
 *   - The rules used to COMPARE the answers — which probes count toward divergence, which
 *     comparator each one uses — are `src/probes/suite.ts`'s, via `computeDivergence`. That
 *     module is out of scope for this file to change: it is what produces the numbers this
 *     project publishes on chain, and a verifier reading it independently is a separate
 *     concern (`src/verify/recompute.ts`) with its own rules read from the bundle instead.
 *
 * The consequence: if the suite has drifted since a bundle was written — a probe added,
 * removed, or reclassified — the live divergence figure computed here is today's rules
 * applied to yesterday's evidence, not a like-for-like replay. That is a real limitation of
 * comparing a live run against an old bundle, not a bug in this file.
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

/** The fields of `Probe` this file actually reads from `bundle.probes` — not the full type,
 *  because a bundle's JSON never carries `category` or `why`; those are commentary for a
 *  human reading `src/probes/suite.ts`, not part of what a probe replay needs. */
interface BundleProbe {
  id: string;
  prompt: string;
  maxTokens: number;
  comparator: string;
  expect?: string;
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
  // `bundle.probes` already has exactly this shape (see VerifiableBundle in recompute.ts) —
  // no cast needed to read it as BundleProbe.
  const probes: BundleProbe[] = args.bundle.probes;
  const services = args.bundle.roster.filter((s) => s.canonicalId === args.canonicalId);
  if (services.length === 0) {
    throw new Error(`no services in this epoch serve ${args.canonicalId}`);
  }

  // Temperature 0 has been the uniform default since the first epoch — but bundles written
  // before schema /3 simply did not RECORD `sentParams`, so a live replay against one of them
  // cannot prove it sent what the published run sent. That is what makes this a refusal about
  // the evidence rather than a guess about what probably happened: sending our own default in
  // place of the missing record would compare a live run at temperature 0 against a published
  // run whose actual sampling conditions were never written down, and report the result as if
  // it were one experiment rather than two different ones. Same call as GLM-5-FP8 being
  // dropped from an epoch on 2 usable samples — no number is better than a wrong one.
  const noSentParams = services.filter((s) => s.sentParams === undefined);
  if (noSentParams.length > 0) {
    throw new Error(
      `${args.canonicalId}: this bundle does not record the generation parameters the ` +
        `published run sent for ${noSentParams.map((s) => s.address).join(', ')} — a live ` +
        `replay cannot prove it used the same parameters, so comparing it against this ` +
        `bundle would be measuring a different experiment`,
    );
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
          // `buildPinnedRequest` only reads `probe.prompt` and `probe.maxTokens`; `category`
          // and `why` are display-only fields no code on this path touches (the one reader,
          // `src/scripts/dry-run.ts`, is a CLI table, not this call). Asserting the narrower
          // bundle shape as `Probe` here is safe for that reason, not because the fields exist.
          probe: probe as Probe,
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
