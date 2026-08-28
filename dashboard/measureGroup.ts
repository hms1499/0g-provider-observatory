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

export interface GroupChoice {
  canonicalId: string;
  /** How many providers of this model the published run set out to measure. */
  services: number;
  /** What a replay of the whole group would send. */
  calls: number;
  /** False when the published run could not measure every member — `short` says who. */
  replayable: boolean;
  /** Members that fell short of the bundle's own `minSamples`. Empty when replayable. */
  short: Array<{ address: string; modelId: string; successes: number }>;
}

/**
 * Every consistency group in an epoch, and whether a reader's key could settle it.
 *
 * The panel used to offer any group with two or more entries in `bundle.roster`. Roster
 * membership is what the prober *intended* to measure, not what came back — and the first
 * wide epoch made the difference expensive. Epoch 496616 carries three Anthropic groups whose
 * every call returned HTTP 400 (`not available on the openai API format`), so the panel
 * offered a reader thirty calls that cannot succeed, and priced them at $0 because failed
 * calls report no usage. "Free" and "impossible" rendered identically.
 *
 * A group is replayable only when every one of its members cleared the bundle's own
 * `minSamples` rule in the run being replayed. That threshold is read from the bundle rather
 * than chosen here, for the same reason `measureGroup` borrows the bundle's rulebook: the
 * comparison is against what that epoch published, under the rules it published beneath.
 *
 * **Every member, not most of them.** A replay is scored against the published group, and a
 * member the published run could not measure has nothing on the other side of the comparison.
 *
 * **One list, not two.** The unreplayable groups stay in the picker beside the rest, disabled
 * and labelled, rather than being filtered out of it. Removing them answers the question a
 * reader has not asked yet — someone who came to check the Anthropic services would find them
 * simply absent, which reads as an instrument that never looked. Present and greyed says the
 * true thing: measured, and the answer is that this epoch cannot support the comparison.
 *
 * Replayable first so the picker's default is always one a key can actually run, then cheapest
 * first within each half: the smallest group is the one a reader spends least to check.
 */
export function measurableGroups(bundle: VerifiableBundle): GroupChoice[] {
  const byGroup = new Map<string, ReturnType<typeof recompute>>();
  for (const s of recompute(bundle)) {
    const arr = byGroup.get(s.canonicalId);
    if (arr) arr.push(s);
    else byGroup.set(s.canonicalId, [s]);
  }

  const out: GroupChoice[] = [];
  for (const [canonicalId, members] of byGroup) {
    // A lone provider has nothing to diverge from, so it is not a comparison at all. It does
    // not belong in the picker as a choice or as a refusal.
    if (members.length < 2) continue;

    const short = members
      .filter((m) => !m.sufficient)
      .map((m) => ({ address: m.address, modelId: m.modelId, successes: m.successes }));

    out.push({
      canonicalId,
      services: members.length,
      calls: members.length * bundle.probes.length,
      replayable: short.length === 0,
      short,
    });
  }

  return out.sort(
    (a, b) =>
      Number(b.replayable) - Number(a.replayable) ||
      a.calls - b.calls ||
      a.canonicalId.localeCompare(b.canonicalId),
  );
}

/** A model this epoch measured that no second provider serves. Not a comparison. */
export interface LoneService {
  canonicalId: string;
  address: string;
  modelId: string;
}

/**
 * The models this epoch measured that only one provider serves.
 *
 * These are the groups `measurableGroups` drops. Dropping them from the *picker* is right —
 * a lone provider has nothing to diverge from, so it is not a comparison a key could settle,
 * and offering it as a disabled option would suggest it might become selectable one day.
 * Dropping them from the *page* was not: fifteen of epoch 496620's twenty-five groups leave
 * this way, and a reader who came to check MiniMax-M3 found it on the Providers panel and
 * nowhere here, with nothing accounting for the difference.
 *
 * That is the same argument this file already makes for keeping unreplayable groups visible
 * and greyed rather than filtering them out, applied to the larger of the two silences.
 *
 * Read from the roster rather than from `recompute()`. How many providers serve a model is a
 * fact about who registered, not about what came back, and it needs no recomputation to
 * establish — checked against `recompute()` on epochs 496540, 496616 and 496620, which
 * partition the roster identically.
 */
export function loneServices(bundle: VerifiableBundle): LoneService[] {
  const counts = new Map<string, number>();
  for (const s of bundle.roster) counts.set(s.canonicalId, (counts.get(s.canonicalId) ?? 0) + 1);

  return bundle.roster
    .filter((s) => counts.get(s.canonicalId) === 1)
    .map((s) => ({ canonicalId: s.canonicalId, address: s.address, modelId: s.modelId }))
    .sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}

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

/**
 * Refuse to run at all if the relay is not answering.
 *
 * `callPinned` never throws: an HTTP failure comes back as a `CallResult` with a status and
 * an `errorKind`, which is right for a prober that must record what happened rather than
 * stop. But a page served without its relay 404s every call, `not_found` is attributed to
 * the *provider* by the bundle's own rules, and the panel then reports two named operators
 * at a 100% error rate against a published run that saw none. Reproduced against epoch
 * 496620: two services, two disagreements, `0 -> 10000` on both.
 *
 * That is the one output this project must never produce. It is an instrument, and the
 * operators it names are real; a deployment fault of ours rendered as their failure is worse
 * than no measurement at all.
 *
 * So the endpoint is asked whether it exists before the reader's key is spent on it. The
 * relay exports only `POST`, so the platform answers a `GET` with 405 without the handler
 * running — verified against the live deployment on 2026-08-26. A 404 is the endpoint not
 * being there (`vite preview`, a build with no functions); a 200 is a static host rewriting
 * an unknown path to the page itself. Anything else — 405, and any error the relay or the
 * platform raises on its own — means something is answering as the relay, and the run goes
 * ahead and reports whatever it finds.
 *
 * One request, no key, no upstream call, nothing billed. It costs a round trip to not
 * slander somebody.
 */
async function requireRelay(baseUrl: string, fetchImpl: typeof fetch): Promise<void> {
  // An absolute base is the Router itself rather than our relay, and has no such contract.
  if (!baseUrl.startsWith('/')) return;

  let status: number;
  try {
    status = (await fetchImpl(`${baseUrl}/chat/completions`, { method: 'GET' })).status;
  } catch {
    // The probe itself could not be sent. That is a fact about this browser's connection,
    // not evidence the relay is missing, so it is not grounds to refuse.
    return;
  }

  if (status !== 404 && status !== 200) return;
  throw new Error(
    `the measurement relay at ${baseUrl} is not answering (a GET returned ${status}, and the ` +
      `relay answers 405) — this page is being served without its functions, so every call ` +
      `would fail in a way the rules charge to the provider. Nothing was sent`,
  );
}

export async function measureGroup(args: {
  bundle: VerifiableBundle;
  canonicalId: string;
  apiKey: string;
  baseUrl?: string;
  onProgress?: (p: MeasureProgress) => void;
  call?: typeof callPinned;
  /** Injected so the relay check can be tested without a network. */
  fetchImpl?: typeof fetch;
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

  // Last, after the refusals above: those are about the evidence and cost nothing to check,
  // and a bundle this panel cannot replay should say so whether or not a relay is running.
  await requireRelay(baseUrl, args.fetchImpl ?? fetch);

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
