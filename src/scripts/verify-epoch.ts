/**
 * Verify one published epoch against the evidence it claims to rest on — F7.
 *
 * Reads the chain, fetches the bundle the record points at, recomputes every number from
 * the rules the bundle publishes, and reports every difference. Nothing here trusts the
 * Observatory: the recomputation lives in `src/verify/`, which imports nothing from the
 * code that produced the measurements.
 *
 *   npx tsx src/scripts/verify-epoch.ts <epoch> [--prober 0x…]
 *
 * Exit code is 0 only when every published number was reproducible.
 */
import { readFileSync } from 'node:fs';
import { ObservatoryReader } from '../chain/registry.js';
import { fetchBundle, merkleRootOf } from '../storage/upload.js';
import { compareToChain, type ProviderLookup } from '../verify/check.js';
import { recompute, type VerifiableBundle } from '../verify/recompute.js';
import { RPC_URL, STORAGE_INDEXER } from '../config.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;
const GRN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const YEL = (s: string) => `\x1b[33m${s}\x1b[0m`;
const head = (n: string, t: string) => console.log(`\n${B(n)} ${B(t)}\n${'─'.repeat(78)}`);

const argv = process.argv.slice(2);
const opt = (f: string, d?: string) =>
  argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1) ??
  (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined) ??
  d;

const step = (ok: boolean, label: string, detail = '') =>
  console.log(`${ok ? GRN('  ok') : RED('FAIL')}  ${label}${detail ? `  ${DIM(detail)}` : ''}`);

async function main() {
  const epoch = Number(argv.find((a) => /^\d+$/.test(a)));
  if (!Number.isFinite(epoch)) {
    console.error('usage: verify-epoch.ts <epoch> [--prober 0x…]');
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(opt('--deployment', 'deployments/galileo-16602.json')!, 'utf8'));
  const prober = opt('--prober', deployment.probers[0])!;

  console.log(`\n${B('VERIFY EPOCH')} ${epoch}  ${DIM(deployment.network)}`);
  console.log(`prober   ${prober}`);
  console.log(`rpc      ${RPC_URL}`);
  console.log(`indexer  ${STORAGE_INDEXER}`);

  // ── 01 the published record ───────────────────────────────────────────────
  head('01', 'WHAT THE CHAIN PUBLISHED');
  const reader = new ObservatoryReader(RPC_URL, {
    providerRegistry: deployment.contracts.ProviderRegistry,
    measurementRegistry: deployment.contracts.MeasurementRegistry,
  });
  const record = await reader.readEpoch(epoch, prober);
  if (!record) {
    console.error(RED(`\nNo epoch ${epoch} written by ${prober}.\n`));
    process.exit(1);
  }
  step(true, `${record.measurements.length} measurements`, `written ${record.writtenAt.toISOString()}`);
  console.log(`      storageRoot ${record.storageRoot}`);

  // ── 02 the evidence ───────────────────────────────────────────────────────
  head('02', 'THE EVIDENCE IT POINTS AT');
  let bytes: string;
  try {
    bytes = await fetchBundle(STORAGE_INDEXER, record.storageRoot);
  } catch (e: any) {
    console.log(RED(`FAIL  the storageRoot fetches nothing: ${e.message}`));
    console.log(DIM('      A summary with no path back to its evidence cannot be verified.'));
    process.exit(1);
  }
  step(true, 'fetched through the public gateway', `${(bytes.length / 1024).toFixed(0)} KB, no wallet, no SDK`);

  // Fetching BY root only proves a gateway answered to that root. Recomputing the root
  // over the bytes received is what binds them to the record.
  const recomputedRoot = await merkleRootOf(bytes);
  const rootHolds = recomputedRoot.toLowerCase() === record.storageRoot.toLowerCase();
  step(rootHolds, 'merkle root of the received bytes matches the record', recomputedRoot);
  if (!rootHolds) {
    console.log(RED('      The gateway returned bytes that are not what the chain committed to.'));
    process.exit(1);
  }

  let bundle: VerifiableBundle;
  try {
    bundle = JSON.parse(bytes) as VerifiableBundle;
  } catch {
    console.log(RED('FAIL  the evidence is not readable JSON'));
    process.exit(1);
  }
  step(true, `schema ${bundle.schema}`, `${bundle.results.length} calls, ${bundle.roster.length} services`);

  const epochMatches = bundle.epoch === epoch;
  const proberMatches = bundle.prober.toLowerCase() === prober.toLowerCase();
  step(epochMatches, 'the evidence claims the same epoch', `bundle says ${bundle.epoch}`);
  step(proberMatches, 'the evidence claims the same prober', `bundle says ${bundle.prober}`);

  // ── 03 recomputation ──────────────────────────────────────────────────────
  head('03', 'RECOMPUTED FROM THE EVIDENCE');
  console.log(DIM('src/verify/ imports nothing from src/probes/ — it applies the rules the'));
  console.log(DIM('bundle publishes, so a wrong formula cannot agree with itself.\n'));
  console.log(`minSamples ${bundle.rules.minSamples} · numeric ${bundle.rules.numericExtraction} number · ` +
    `${bundle.rules.divergenceProbeIds.length} divergence probes`);

  const mine = recompute(bundle);
  const providers = await reader.loadProviders();
  const lookup: ProviderLookup = Object.fromEntries(
    providers.map((p) => [p.id, { address: p.address, model: p.model }]),
  );

  const { findings, checked } = compareToChain(record.measurements, mine, lookup);

  console.log('');
  console.log('service'.padEnd(34), 'p50'.padStart(8), 'p95'.padStart(8), 'err'.padStart(7), 'div'.padStart(7), 'n'.padStart(4));
  for (const row of record.measurements) {
    const p = lookup[row.providerId];
    const got = p && mine.find(
      (m) => m.address.toLowerCase() === p.address.toLowerCase() && m.modelId === p.model,
    );
    const cell = (a: number, b: number | undefined) =>
      (b === undefined ? String(a) : a === b ? String(a) : RED(`${a}≠${b}`));
    console.log(
      `${(p?.address ?? '?').slice(0, 8)} ${(p?.model ?? '?').slice(0, 24)}`.padEnd(34),
      cell(row.p50Ms, got?.p50Ms).padStart(8),
      cell(row.p95Ms, got?.p95Ms).padStart(8),
      cell(row.errorRateBps, got?.errorRateBps).padStart(7),
      cell(row.divergenceBps, got?.divergenceBps).padStart(7),
      cell(row.calls, got?.calls).padStart(4),
    );
  }

  // ── 04 verdict ────────────────────────────────────────────────────────────
  head('04', 'VERDICT');
  const blocking = findings.filter((f) => f.severity !== 'unpublished');
  if (findings.length === 0) {
    console.log(GRN(`${B('VERIFIED')}  all ${checked} published measurements recomputed exactly.\n`));
    return;
  }

  for (const f of findings) {
    const paint = f.severity === 'unpublished' ? YEL : RED;
    console.log(`${paint(f.severity.padEnd(17))} ${f.service}`);
    console.log(`${' '.repeat(18)}${DIM(f.message)}`);
  }

  console.log(
    `\n${checked} measurements checked · ${blocking.length} blocking · ` +
      `${findings.length - blocking.length} advisory\n`,
  );
  if (blocking.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
