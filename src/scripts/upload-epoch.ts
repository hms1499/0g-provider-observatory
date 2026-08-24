/**
 * Build and upload the evidence bundle for a transcript that already exists.
 *
 * `run-epoch --write-chain` does this inline. This exists for the two cases where that is
 * not what you want: proving the storage path works without paying for another epoch of
 * inference, and re-publishing a bundle whose upload failed after the calls were made.
 *
 *   npx tsx src/scripts/upload-epoch.ts data/epochs/<file>.jsonl [--verify-download]
 *
 * It does NOT write on chain. An epoch whose measurements were taken hours ago cannot be
 * filed under the current epoch, and `assertEpoch` refuses to try.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Wallet } from 'ethers';
import { buildBundle, localDigest, serializeBundle } from '../storage/bundle.js';
import { fetchBundle, uploadBundle } from '../storage/upload.js';
import { buildPlan, loadSnapshot } from '../probes/plan.js';
import type { CallResult } from '../probes/router-client.js';
import { CHAIN_ID, RPC_URL, STORAGE_INDEXER } from '../config.js';
import { deploymentFor, latestSnapshot } from '../paths.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

const argv = process.argv.slice(2);
const transcriptPath = argv.find((a) => !a.startsWith('--'));
const opt = (f: string, d: string) =>
  argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1) ?? d;

async function main() {
  if (!transcriptPath) {
    console.error('usage: upload-epoch.ts <transcript.jsonl> [--verify-download]');
    process.exit(1);
  }
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY is not set — the upload is a chain transaction.');
    process.exit(1);
  }

  const results = readFileSync(transcriptPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as CallResult);

  // Rebuild the roster from the plan, keeping only services this transcript actually holds.
  const plan = buildPlan(loadSnapshot(opt('--snapshot', latestSnapshot() ?? '')), {
    priceMultiplier: 3,
    temperature: 0,
    skipUnhealthy: true,
  });
  const seen = new Set(results.map((r) => `${r.providerAddress.toLowerCase()}|${r.model}`));
  const roster = plan.targets.filter((t) => seen.has(`${t.address.toLowerCase()}|${t.modelId}`));

  const epochSeconds = JSON.parse(
    readFileSync(opt('--deployment', deploymentFor(CHAIN_ID)), 'utf8'),
  ).epochSeconds as number;
  const times = results.map((r) => new Date(r.at).getTime()).sort((a, b) => a - b);
  const epoch = Math.floor(times[0] / 1000 / epochSeconds);

  console.log(`\n${B('UPLOAD EPOCH BUNDLE')}`);
  console.log(`transcript ${transcriptPath}  ${DIM(`${results.length} calls`)}`);
  console.log(`epoch      ${epoch}  ${DIM('derived from the first call, not the filename')}`);
  console.log(`roster     ${roster.length} services`);
  console.log(`indexer    ${STORAGE_INDEXER}\n`);

  const bundlePath = transcriptPath.replace(/\.jsonl$/, '.bundle.json');
  const bytes = serializeBundle(
    buildBundle({
      epoch,
      prober: new Wallet(privateKey).address,
      startedAt: new Date(times[0]).toISOString(),
      endedAt: new Date(times[times.length - 1]).toISOString(),
      roster,
      results,
    }),
  );
  writeFileSync(bundlePath, bytes);
  console.log(`bundle       ${bundlePath}  ${DIM(`${(bytes.length / 1024).toFixed(0)} KB`)}`);
  console.log(`local digest ${DIM(localDigest(bytes))}`);

  const uploaded = await uploadBundle({
    filePath: bundlePath,
    indexerUrl: STORAGE_INDEXER,
    rpcUrl: RPC_URL,
    privateKey,
  });
  console.log(`\nstorageRoot  ${B(uploaded.rootHash)}`);
  console.log(`gateway      ${uploaded.gatewayUrl}`);
  console.log(`upload tx    ${DIM(uploaded.txHash)}`);

  if (argv.includes('--verify-download')) {
    const back = await fetchBundle(STORAGE_INDEXER, uploaded.rootHash);
    const same = localDigest(back) === localDigest(bytes);
    console.log(
      same
        ? `\n${B('VERIFIED')} fetched back through the public gateway, bytes identical`
        : RED('\nFETCHED BYTES DIFFER FROM WHAT WAS UPLOADED'),
    );
    if (!same) process.exit(1);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
