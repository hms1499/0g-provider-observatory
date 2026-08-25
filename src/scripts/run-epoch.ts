/**
 * Run one measurement epoch against the live Router. THIS SPENDS REAL MONEY.
 *
 * Nothing is sent without `--confirm`: the default run prints the roster, the projected
 * cost and the budget cap, then exits. That is the same output the real run starts with,
 * so what you approve is what gets sent.
 *
 *   npx tsx src/scripts/run-epoch.ts                        # plan only, free
 *   npx tsx src/scripts/run-epoch.ts --confirm              # spend
 *   npx tsx src/scripts/run-epoch.ts --confirm --write-chain
 *
 * Three guards, in the order they matter:
 *
 *   BUDGET  — spending is accumulated from the usage each response reports, and the run
 *             stops before a call that would cross `--budget-usd`. An estimate made
 *             beforehand is not enough when the credit behind the key is worth a
 *             fraction of one epoch.
 *   PIN     — the first response whose `x-provider` is not the address we pinned aborts
 *             everything. A mis-pinned epoch looks perfectly healthy and attributes every
 *             measurement to the wrong service.
 *   EVIDENCE— every result is appended to the transcript the moment it arrives. A crash
 *             halfway through must not lose calls that were already paid for.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aggregate, toMeasurements, type ResolveContext } from '../probes/aggregate.js';
import { computeDivergence, divergenceLookup, type ServiceKey } from '../probes/divergence.js';
import {
  Budget,
  BudgetExceeded,
  callCostUsd,
  pinHeld,
  fitToBudget,
  projectedCostUsd,
  reservationUsd,
  selectRoster,
} from '../probes/epoch-run.js';
import { buildPlan, loadSnapshot, type Target } from '../probes/plan.js';
import { callPinned, type CallResult, type ReasoningEffort } from '../probes/router-client.js';
import { assertSuiteValid, PROBES, SUITE_MEASURED_TOKENS } from '../probes/suite.js';
import { MODES, ObservatoryReader } from '../chain/registry.js';
import { CHAIN_ID, ROUTER_API } from '../config.js';
import { assertDeploymentChain, deploymentFor, latestSnapshot } from '../paths.js';
import { applyRosterLock, type RosterLock } from '../probes/roster-lock.js';
import { EpochDrift, writeEpoch } from '../chain/writer.js';
import { buildBundle, localDigest, serializeBundle } from '../storage/bundle.js';
import { fetchBundle, uploadBundle } from '../storage/upload.js';
import { RPC_URL, STORAGE_INDEXER } from '../config.js';
import { Wallet } from 'ethers';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const YEL = (s: string) => `\x1b[33m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const head = (n: string, t: string) => console.log(`\n${B(n)} ${B(t)}\n${'─'.repeat(78)}`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const opt = (f: string, d: string) => argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1) ?? d;

const SNAPSHOT = opt('--snapshot', latestSnapshot() ?? '');
/**
 * $0.13 rather than $0.12, purely for headroom. The roster is trimmed to this figure before
 * anything is sent, so it is a plan rather than just a ceiling — and the default roster
 * projects $0.1199, which leaves $0.0001 of slack against $0.12.
 *
 * Slack matters here because the noise pair's profile is a known LOWER bound: it was
 * measured at the old 512 ceiling, where every glm-5.2 call was a truncated 512. Under the
 * new 4096 ceiling those calls will cost more, and the first run under it would otherwise
 * abort mid-suite — the exact failure this fitting exists to prevent.
 */
const BUDGET_USD = Number(opt('--budget-usd', '0.13'));
const DEPLOYMENT = opt('--deployment', deploymentFor(CHAIN_ID));
/**
 * The four most expensive multi-provider groups. All four are peer-to-peer — none holds a
 * TeeML reference — so dropping them removes 80% of the cost without removing a code path
 * that the surviving groups do not already exercise.
 */
const DEFAULT_EXCLUDE = ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'kimi-k3'];
const EXCLUDE = opt('--exclude', DEFAULT_EXCLUDE.join(',')).split(',').filter(Boolean);
/**
 * Sent to every service that declares `reasoning_effort`. Empty means send nothing and let
 * each model run at its own default — the baseline epochs 496514/496516 were measured at.
 *
 * Opt-in on purpose: this changes what is being measured, so a run states it rather than
 * inheriting it, and the bundle records it per service.
 */
const REASONING_EFFORT = opt('--reasoning-effort', '') as ReasoningEffort | '';
/**
 * Pins the series to one set of services. `--no-lock` measures whatever fits instead, which
 * is right for exploring and wrong for a series: the noise floor pools across epochs and the
 * product answers week-over-week questions, and neither survives a roster that moves.
 */
const ROSTER_LOCK = opt('--roster-lock', 'data/series-roster.json');

const modeIndex = (name: string) => Math.max(0, MODES.indexOf(name as never));

async function main() {
  assertSuiteValid();
  if (!SNAPSHOT || !existsSync(SNAPSHOT)) {
    console.error(`Snapshot not found: ${SNAPSHOT || '(none on disk)'}\nRun \`pnpm snapshot\` first.`);
    process.exit(1);
  }
  if (!existsSync(DEPLOYMENT)) {
    console.error(`Deployment not found: ${DEPLOYMENT}`);
    process.exit(1);
  }
  // Checked before a single call is paid for: the run is worthless if it cannot be written,
  // and writing it to the wrong ledger is worse than not writing it at all.
  assertDeploymentChain(JSON.parse(readFileSync(DEPLOYMENT, 'utf8')), CHAIN_ID, DEPLOYMENT);
  console.log(DIM(`snapshot ${SNAPSHOT} · deployment ${DEPLOYMENT} · chain ${CHAIN_ID}`));

  const plan = buildPlan(loadSnapshot(SNAPSHOT), {
    priceMultiplier: 3,
    temperature: 0,
    skipUnhealthy: true,
    ...(REASONING_EFFORT ? { reasoningEffort: REASONING_EFFORT } : {}),
  });
  const candidates = selectRoster(plan.targets, { groupsOnly: !has('--all'), exclude: EXCLUDE });
  // Fit the roster to the money BEFORE sending anything. Starting a roster the budget cannot
  // finish does not measure less, it measures crookedly: every service gets probes 1..k, so
  // the late probes are systematically under-sampled and the noise pair — positions 5 and 14
  // — loses its second half. Measured on both live epochs.
  const fitted = has('--no-fit') ? candidates : fitToBudget(candidates, BUDGET_USD);

  // The lock narrows what fitting chose; it can never widen it.
  let roster = fitted;
  let lockReport: ReturnType<typeof applyRosterLock<Target>> | null = null;
  if (!has('--no-lock') && existsSync(ROSTER_LOCK)) {
    const lock = JSON.parse(readFileSync(ROSTER_LOCK, 'utf8')) as RosterLock;
    lockReport = applyRosterLock(fitted, lock);
    roster = lockReport.roster;
  }

  const projected = projectedCostUsd(roster);
  const droppedGroups = [...new Set(candidates.map((t) => t.canonicalId))].filter(
    (id) => !roster.some((t) => t.canonicalId === id),
  );

  // ── 01 roster ─────────────────────────────────────────────────────────────
  head('01', 'ROSTER');
  const byGroup = new Map<string, Target[]>();
  for (const t of roster) byGroup.set(t.canonicalId, [...(byGroup.get(t.canonicalId) ?? []), t]);
  console.log('model'.padEnd(24), 'n'.padStart(2), 'ref'.padEnd(6), 'cost'.padStart(9));
  for (const [id, ts] of byGroup) {
    console.log(
      id.padEnd(24),
      String(ts.length).padStart(2),
      (ts.some((t) => t.mode === 'TeeML') ? 'TeeML' : '—').padEnd(6),
      `$${projectedCostUsd(ts).toFixed(4)}`.padStart(9),
    );
  }
  if (lockReport) {
    console.log(
      DIM(`\nroster locked to ${ROSTER_LOCK} — the series measures one fixed set of services`),
    );
    for (const m of lockReport.missing) {
      console.log(YEL(`  locked but absent this epoch: ${m.modelId} · ${m.address}`));
    }
    for (const e of lockReport.extra) {
      console.log(DIM(`  affordable but not in the series: ${e.modelId} · ${e.address}`));
    }
  }
  if (droppedGroups.length > 0) {
    console.log(
      `\n${YEL('left out to fit the budget')}: ${droppedGroups.join(', ')}`,
    );
    console.log(
      DIM('  A full suite for fewer services beats a partial suite for more: a run that stops'),
    );
    console.log(
      DIM('  mid-suite under-samples every probe near the end, the noise pair included.'),
    );
  }
  console.log(
    `\n${roster.length} services × ${PROBES.length} probes = ${B(String(roster.length * PROBES.length))} calls · ` +
      `projected ${B(`$${projected.toFixed(4)}`)} · cap ${B(`$${BUDGET_USD.toFixed(4)}`)}`,
  );
  if (EXCLUDE.length) console.log(DIM(`excluded: ${EXCLUDE.join(', ')}`));
  if (projected > BUDGET_USD) {
    console.log(YEL(`\nProjected cost is above the cap — the run would stop partway through.`));
  }

  if (!has('--confirm')) {
    console.log(DIM('\nNothing sent. Add --confirm to spend.\n'));
    return;
  }

  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) {
    console.error('ROUTER_API_KEY is not set. pc.0g.ai -> Dashboard -> API Keys.');
    process.exit(1);
  }

  // ── 02 run ────────────────────────────────────────────────────────────────
  const epochSeconds = JSON.parse(readFileSync(DEPLOYMENT, 'utf8')).epochSeconds as number;
  const startedAt = new Date();
  const epoch = Math.floor(startedAt.getTime() / 1000 / epochSeconds);
  mkdirSync('data/epochs', { recursive: true });
  const transcriptPath = `data/epochs/${epoch}-${startedAt.toISOString().replace(/[:.]/g, '')}.jsonl`;

  head('02', 'RUNNING');
  const secondsLeft = epochSeconds - Math.floor(startedAt.getTime() / 1000) % epochSeconds;
  console.log(`epoch ${epoch} · transcript ${transcriptPath}`);
  console.log(DIM(`${Math.floor(secondsLeft / 60)} min left in this epoch`));
  if (secondsLeft < 20 * 60) {
    console.log(
      YEL('  A run that crosses the boundary cannot be written: the chain would file these'),
    );
    console.log(YEL('  calls under the next epoch, and the ledger is write-once.'));
  }
  console.log(DIM('parallel across providers, sequential within each — concurrent calls to one'));
  console.log(DIM('provider would measure our own queueing as their latency.\n'));

  const budget = new Budget(BUDGET_USD);
  const results: CallResult[] = [];
  /** First reason the run stopped. An array so the value survives TypeScript's narrowing
   * across the worker closures, and so the winner is unambiguously the first one recorded. */
  const aborts: string[] = [];
  const abortReason = (): string | undefined => aborts[0];

  await Promise.all(
    roster.map(async (t) => {
      for (const probe of PROBES) {
        if (aborts.length) return;
        // Held before the call, not merely tested: 15 workers all pass the same test
        // against the same remaining dollar, and only a hold stops them spending it twice.
        const held = budget.reserve(reservationUsd(t, probe));
        if (!held) {
          aborts.push(`budget cap reached at $${budget.spentUsd.toFixed(6)}`);
          return;
        }

        let r: CallResult;
        try {
          r = await callPinned({
            apiKey,
            baseUrl: ROUTER_API,
            providerAddress: t.address,
            model: t.modelId,
            probe,
            params: t.params,
            maxPriceUsdPrompt: t.maxPriceUsdPrompt,
            maxPriceUsdCompletion: t.maxPriceUsdCompletion,
            timeoutMs: 60_000,
          });
        } catch (e) {
          // Nothing was billed, so the hold must go back rather than starve the roster.
          held.release();
          throw e;
        }

        // Evidence first: written before anything can throw on it.
        appendFileSync(transcriptPath, `${JSON.stringify(r)}\n`);
        results.push(r);

        try {
          held.settle(callCostUsd(r, t));
        } catch (e) {
          if (e instanceof BudgetExceeded) aborts.push(e.message);
          else throw e;
        }

        if (r.ok && !pinHeld(r, t.address)) {
          aborts.push(`PIN DID NOT HOLD: pinned ${t.address}, served by ${r.servedBy ?? 'nothing'}`);
          return;
        }
        process.stdout.write(r.ok ? '.' : RED('x'));
      }
    }),
  );
  const endedAt = new Date();
  console.log('\n');

  if (abortReason()) {
    console.log(`${YEL('run stopped early')} — ${abortReason()}\n`);
    if (abortReason()?.startsWith('budget')) {
      console.log(
        YEL('  The roster was fitted to the budget before starting, so this should not happen.'),
      );
      console.log(
        YEL('  Real spend exceeded the projection: re-measure with `pnpm token-profile`.'),
      );
      console.log(
        DIM('  The probes near the end of the suite are now under-sampled for every service.\n'),
      );
    }
  }
  console.log(
    `${results.length} calls · ${results.filter((r) => r.ok).length} ok · ` +
      `spent ${B(`$${budget.spentUsd.toFixed(6)}`)} of $${BUDGET_USD.toFixed(4)}`,
  );
  if (abortReason()?.startsWith('PIN')) process.exit(1);

  // ── 03 aggregate ──────────────────────────────────────────────────────────
  head('03', 'MEASUREMENTS');
  const stats = aggregate(results);
  const services: ServiceKey[] = roster.map((t) => ({
    address: t.address,
    modelId: t.modelId,
    canonicalId: t.canonicalId,
    mode: t.mode,
  }));
  const divergence = computeDivergence(results, services);
  const divOf = divergenceLookup(divergence);

  console.log(
    'provider'.padEnd(14), 'model'.padEnd(24), 'p50'.padStart(7), 'p95'.padStart(7),
    'err'.padStart(6), 'div'.padStart(6), 'n'.padStart(3),
  );
  for (const s of stats) {
    console.log(
      short(s.address).padEnd(14),
      s.modelId.slice(0, 24).padEnd(24),
      (s.sufficient ? `${s.p50Ms}ms` : '—').padStart(7),
      (s.sufficient ? `${s.p95Ms}ms` : '—').padStart(7),
      `${(s.errorRateBps / 100).toFixed(1)}%`.padStart(6),
      `${(divOf(s.address, s.modelId) / 100).toFixed(1)}%`.padStart(6),
      String(s.calls).padStart(3),
    );
  }

  head('04', 'DIVERGENCE METHOD');
  for (const d of divergence) {
    console.log(
      short(d.address).padEnd(14),
      d.canonicalId.padEnd(20),
      d.method.padEnd(18),
      `raw ${(d.rawDivergenceBps / 100).toFixed(1)}% − noise ${(d.noiseFloorBps / 100).toFixed(1)}%` +
        ` = ${B(`${(d.divergenceBps / 100).toFixed(1)}%`)}`,
      DIM(`${d.comparedProbes} probes`),
    );
  }

  if (!has('--write-chain')) {
    // Deliberately loud. The calls are already paid for at this point, and the obvious
    // reading of "add --write-chain" is to re-run the whole suite — which spends a second
    // epoch's worth of credit to publish measurements that are already sitting on disk.
    console.log(YEL('\nNot written on chain. The calls above are already paid for.'));
    console.log(`Publish THIS run without spending again:\n  ${B(`pnpm upload-epoch ${transcriptPath}`)}`);
    console.log(
      DIM('Re-running with --write-chain would measure again and bill again. Only do that if\n') +
        DIM('you want a fresh measurement — and note the epoch may have moved on by then.\n'),
    );
    return;
  }

  // ── 05 chain ──────────────────────────────────────────────────────────────
  head('05', 'WRITE ON CHAIN');
  const deployment = JSON.parse(readFileSync(DEPLOYMENT, 'utf8'));
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY is not set — cannot write.');
    process.exit(1);
  }

  const reader = new ObservatoryReader(RPC_URL, {
    providerRegistry: deployment.contracts.ProviderRegistry,
    measurementRegistry: deployment.contracts.MeasurementRegistry,
  });
  const providers = await reader.loadProviders();
  const ids = new Map(
    providers.map((p) => [`${p.address.toLowerCase()}|${p.model ?? ''}`, p.id] as const),
  );

  const ctx: ResolveContext = {
    providerId: (address, modelId) => ids.get(`${address.toLowerCase()}|${modelId}`) ?? null,
    observedMode: (address, modelId) =>
      modeIndex(roster.find((t) => t.address === address && t.modelId === modelId)?.mode ?? 'Unknown'),
    divergenceBps: divOf,
  };
  const { rows, skipped } = toMeasurements(stats, ctx);

  for (const s of skipped) {
    console.log(DIM(`skipped ${short(s.stats.address)} ${s.stats.modelId} — ${s.reason}`));
  }
  if (rows.length === 0) {
    console.log(YEL('Nothing to write — every service was skipped.\n'));
    return;
  }

  // The evidence bundle, not the bare transcript: the probe definitions, the roster and the
  // aggregation rules travel with the raw results, so recomputing these numbers never
  // requires trusting this repository.
  const bundlePath = transcriptPath.replace(/\.jsonl$/, '.bundle.json');
  const bundle = buildBundle({
    epoch,
    prober: new Wallet(privateKey).address,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    roster,
    results,
  });
  const bytes = serializeBundle(bundle);
  writeFileSync(bundlePath, bytes);
  console.log(`bundle ${bundlePath}  ${DIM(`${(bytes.length / 1024).toFixed(0)} KB`)}`);
  console.log(DIM(`local digest ${localDigest(bytes)}`));

  const uploaded = await uploadBundle({
    filePath: bundlePath,
    indexerUrl: STORAGE_INDEXER,
    rpcUrl: RPC_URL,
    privateKey,
  });
  console.log(`storageRoot ${B(uploaded.rootHash)}`);
  console.log(`gateway     ${uploaded.gatewayUrl}`);
  console.log(DIM(`upload tx   ${uploaded.txHash}`));

  // Prove it comes back before committing it to a write-once ledger. A root nobody can
  // fetch is not evidence, and the record cannot be revised afterwards.
  if (has('--verify-download')) {
    const back = await fetchBundle(STORAGE_INDEXER, uploaded.rootHash);
    const same = localDigest(back) === localDigest(bytes);
    console.log(
      same
        ? `verified    ${DIM('fetched back through the public gateway, bytes identical')}`
        : RED('verified    FETCHED BYTES DIFFER FROM WHAT WAS UPLOADED'),
    );
    if (!same) process.exit(1);
  }

  const root = uploaded.rootHash;

  try {
    const receipt = await writeEpoch({
      rpcUrl: RPC_URL,
      privateKey,
      measurementRegistry: deployment.contracts.MeasurementRegistry,
      storageRoot: root,
      rows,
      measuredInEpoch: epoch,
    });
    console.log(
      `\n${B('WRITTEN')} epoch ${receipt.epoch} · ${receipt.count} measurements · ` +
        `gas ${receipt.gasUsed}\n${deployment.explorer}/tx/${receipt.txHash}\n`,
    );
  } catch (e) {
    if (!(e instanceof EpochDrift)) throw e;
    console.log(`\n${YEL('NOT WRITTEN')} — ${e.message}`);
    console.log(DIM(`The transcript is kept at ${transcriptPath}; nothing was spent twice.\n`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
