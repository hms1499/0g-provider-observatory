/**
 * Measure one consistency group from the page, and compare it against what was published.
 *
 * **Both sides go through `recompute()`, under one rulebook: the published epoch's.**
 * The prompts, `maxTokens` and expected answers sent to the Router come from the bundle, so
 * a reader does not have to trust this repository for what was asked — and the rules that
 * decide what a difference *means* come from the bundle too: which probes count toward
 * divergence, which comparator each one uses, which pair measures the noise floor, and what
 * value stands for "not measurable".
 *
 * A live run records no rules of its own, so it has to borrow some. Borrowing today's
 * `src/probes/suite.ts` was the earlier design and it was wrong: reclassify one probe and
 * the two sides of the comparison are scored under different rulebooks, so the panel reports
 * our own edit as a disagreement between two measurements of the network — silently, because
 * nothing in the report says the rules differed. `src/verify/reproduce.ts` states the
 * principle this file now keeps: both sides must go through the same implementation, or the
 * comparison inherits the bias it exists to detect.
 *
 * The consequence is worth stating plainly: a live replay is scored by rules that may be
 * older than the code that ran it. That is the correct direction. The published number is
 * the fixed point — it is what the evidence records — and a comparison against it is only
 * meaningful under the rules it was published beneath.
 *
 * Nothing here imports the measurement code from `src/probes/`. `callPinned` sends the
 * calls and `Probe` types their shape; no figure in the output is computed by the code that
 * produced the published figures.
 *
 * Ordering matches the prober: sequential within a provider, parallel across the providers
 * of a group. Concurrent calls to one provider would measure queueing, not the provider.
 */
import { callPinned, type CallResult } from '../src/probes/router-client.js';
import type { Probe } from '../src/probes/suite.js';
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

  // The live run as a bundle of its own: the published epoch's probes and rules, this run's
  // roster and results. Only the group's services are in the roster — passing the whole
  // roster would hand `recompute` services this run never called and have it publish their
  // zeros as measurements, which is exactly the invented figure `compareRuns` narrows its
  // input to keep out.
  const live: ComparableService[] = recompute({
    ...args.bundle,
    roster: services,
    results,
  });

  const published = recompute(args.bundle).filter((s) => s.canonicalId === args.canonicalId);

  const report = compareRuns(
    { services: published, unmeasured: args.bundle.rules.divergenceUnmeasured },
    { services: live, unmeasured: args.bundle.rules.divergenceUnmeasured },
  );

  return { live, report };
}
