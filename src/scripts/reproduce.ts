/**
 * Compare a published epoch against a measurement you took yourself.
 *
 *   npx tsx src/scripts/reproduce.ts <your-bundle.json> <epoch> [--prober 0x…]
 *
 * `verify-epoch.ts` asks whether the published numbers follow from the published
 * evidence. This asks a different question: run the same instrument yourself, and do
 * the two runs reach the same conclusions? Nothing here needs a wallet or an API key —
 * the published side is fetched through a public gateway, and your side is a file you
 * produced with `pnpm epoch --confirm`.
 *
 * Neither run is treated as correct. Where they disagree, the disagreement is named.
 */
import { readFileSync } from 'node:fs';
import { ObservatoryReader } from '../chain/registry.js';
import { fetchBundle, merkleRootOf } from '../storage/upload.js';
import { reproduce } from '../verify/reproduce.js';
import type { VerifiableBundle } from '../verify/recompute.js';
import { CHAIN_ID, RPC_URL, STORAGE_INDEXER } from '../config.js';
import { deploymentFor } from '../paths.js';

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

async function main() {
  const path = argv.find((a) => a.endsWith('.json'));
  const epoch = Number(argv.find((a) => /^\d+$/.test(a)));
  if (!path || !Number.isFinite(epoch)) {
    console.error('usage: reproduce.ts <your-bundle.json> <epoch> [--prober 0x…]');
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(opt('--deployment', deploymentFor(CHAIN_ID))!, 'utf8'));
  const prober = opt('--prober', deployment.probers[0])!;

  console.log(`\n${B('REPRODUCE EPOCH')} ${epoch}  ${DIM(deployment.network)}`);
  console.log(`published by  ${prober}`);
  console.log(`measured by   you — ${path}`);

  // ── 01 the published side, fetched the same way any stranger would ────────
  head('01', 'THE PUBLISHED RUN');
  const reader = new ObservatoryReader(RPC_URL, {
    providerRegistry: deployment.contracts.ProviderRegistry,
    measurementRegistry: deployment.contracts.MeasurementRegistry,
  });
  const record = await reader.readEpoch(epoch, prober);
  if (!record) {
    console.error(RED(`\nNo epoch ${epoch} written by ${prober}.\n`));
    process.exit(1);
  }

  const bytes = await fetchBundle(STORAGE_INDEXER, record.storageRoot);
  const root = await merkleRootOf(bytes);
  if (root.toLowerCase() !== record.storageRoot.toLowerCase()) {
    console.error(RED('\nThe gateway returned bytes the chain did not commit to. Stopping.\n'));
    process.exit(1);
  }
  const published = JSON.parse(bytes) as VerifiableBundle;
  console.log(
    `${GRN('  ok')}  fetched and root-checked  ` +
      DIM(`${(bytes.length / 1024).toFixed(0)} KB, ${published.roster.length} services`),
  );

  // ── 02 your side ──────────────────────────────────────────────────────────
  head('02', 'YOUR RUN');
  const independent = JSON.parse(readFileSync(path, 'utf8')) as VerifiableBundle;
  console.log(
    `${GRN('  ok')}  read from disk            ` +
      DIM(`epoch ${independent.epoch}, ${independent.roster.length} services`),
  );
  if (independent.schema !== published.schema) {
    console.log(
      YEL(`      schemas differ: ${published.schema} vs ${independent.schema}`) +
        DIM(' — rules are read from each bundle, so a difference here is reported, not fatal.') +
        DIM('\n      A bundle that records no rules at all is refused, and that is fatal.'),
    );
  }

  // ── 03 what the two runs say ──────────────────────────────────────────────
  const report = reproduce(published, independent);

  head('03', 'WHERE THE TWO RUNS DISAGREE');
  if (report.compared === 0) {
    console.log(RED('  No service was measured by both runs. There is nothing to compare.'));
    console.log(DIM('  Run against the same roster: --roster-lock data/series-roster.json'));
    process.exit(1);
  }
  if (report.disagreements.length === 0) {
    console.log(`${GRN('  none')}  ${report.compared} services, every conclusion matched.`);
  } else {
    for (const d of report.disagreements) {
      console.log(`${YEL('  ' + d.kind.padEnd(24))}${d.service}`);
      console.log(DIM(`      published ${d.published}   ·   yours ${d.independent}`));
      console.log(DIM(`      ${d.message}`));
    }
  }

  // ── 04 latency, reported and not judged ───────────────────────────────────
  head('04', 'LATENCY, AS A RATIO');
  console.log(DIM('  Two runs at two times see different load. These are reported, never scored.\n'));
  console.log(DIM('  service                                       p50     p95'));
  for (const l of report.latency) {
    const [address, ...rest] = l.service.split(' ');
    const label = `${address.slice(0, 10)}… ${rest.join(' ')}`;
    // A dash, never `0.00x`: one of the two runs published no figure for this service, and
    // printing a number for an absence would put a reading against a named operator that
    // nobody took. Same mark this project uses everywhere else for "no figure here".
    const show = (r: number | null) => (r === null ? '—'.padStart(6) : `${r.toFixed(2).padStart(5)}x`);
    console.log(`  ${label.slice(0, 42).padEnd(44)}${show(l.p50Ratio)} ${show(l.p95Ratio)}`);
  }

  // ── 05 what could not be compared ─────────────────────────────────────────
  if (report.onlyPublished.length || report.onlyIndependent.length) {
    head('05', 'NOT COMPARABLE');
    for (const s of report.onlyPublished) console.log(`  ${DIM('published only')}  ${s}`);
    for (const s of report.onlyIndependent) console.log(`  ${DIM('yours only    ')}  ${s}`);
    console.log(DIM('\n  Measured by one run and not the other. Not a fault on either side.'));
  }

  const verdict = report.disagreements.length === 0;
  console.log(
    `\n${verdict ? GRN(B('REPRODUCED')) : YEL(B('DISAGREES'))}  ` +
      `${report.compared} services compared, ${report.disagreements.length} disagreement(s).\n`,
  );
  process.exit(verdict ? 0 : 1);
}

main().catch((e) => {
  console.error(RED(`\n${e?.message ?? e}\n`));
  process.exit(1);
});
