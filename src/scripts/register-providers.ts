/**
 * Register the measured (address, model) pairs in ProviderRegistry.
 *
 *   pnpm register-providers                    # plan only, no transaction
 *   pnpm register-providers --broadcast        # send it
 *
 * Registration is permanent: the contract has no update and no delete. So this prints the
 * full plan and does nothing unless --broadcast is passed, and it re-reads the chain first
 * so a second run after a partial failure is safe rather than a revert.
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Contract, JsonRpcProvider } from 'ethers';
import { CHAIN_ID, RPC_URL } from '../config.js';
import { loadSnapshot, routerMode, type SnapshotRouterService } from '../probes/plan.js';
import { planRegistrations, resolveAll, type RegistrationCandidate } from '../chain/register.js';
import { PROVIDER_WRITE_ABI, registerProviders } from '../chain/writer.js';
import type { DeclaredMode } from '../chain/register.js';

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const opt = (f: string, d: string) => argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1) ?? d;

const SNAPSHOT = opt('--snapshot', 'data/snapshot-2026-08-24.json');
const DEPLOYMENT = opt('--deployment', 'deployments/aristotle-16661.json');

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const YEL = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function main() {
  if (!existsSync(SNAPSHOT)) {
    console.error(`Snapshot not found: ${SNAPSHOT}\nRun \`pnpm snapshot\` first.`);
    process.exit(1);
  }
  const deployment = JSON.parse(readFileSync(DEPLOYMENT, 'utf8'));
  if (deployment.chainId !== CHAIN_ID) {
    console.error(
      `Deployment file is for chain ${deployment.chainId} but CHAIN_ID is ${CHAIN_ID}. ` +
        'Registering against the wrong chain cannot be undone.',
    );
    process.exit(1);
  }
  const registryAddress: string = deployment.contracts.ProviderRegistry;

  // ── candidates ────────────────────────────────────────────────────────────
  const snap = loadSnapshot(SNAPSHOT);
  const onchainMode = new Map<string, DeclaredMode>();
  for (const s of snap.onchain.services) {
    // The chain keys by (address, model) exactly as the registry does.
    onchainMode.set(`${s.provider.toLowerCase()}|${s.model}`, s.mode as DeclaredMode);
  }

  const chatbots = snap.router.services.filter(
    (s: SnapshotRouterService) => (s.service_type ?? s.type) === 'chatbot',
  );
  const candidates: RegistrationCandidate[] = chatbots.map((s: SnapshotRouterService) => ({
    address: s.address,
    modelId: s.model_id,
    routerMode: routerMode(s) as DeclaredMode,
    onchainMode: onchainMode.get(`${s.address.toLowerCase()}|${s.model_id}`) ?? null,
  }));

  const resolved = resolveAll(candidates);

  // ── what is already there ─────────────────────────────────────────────────
  const provider = new JsonRpcProvider(RPC_URL);
  const registry = new Contract(registryAddress, PROVIDER_WRITE_ABI, provider);
  const existing = new Map<string, number>();
  for (const c of resolved) {
    existing.set(
      `${c.address.toLowerCase()}|${c.modelId}`,
      Number(await registry.idOf(c.address, c.modelId)),
    );
  }
  const plan = planRegistrations(resolved, (a, m) => existing.get(`${a.toLowerCase()}|${m}`) ?? 0);

  // ── report ────────────────────────────────────────────────────────────────
  console.log(`\n${B('ProviderRegistry')} ${registryAddress} on chain ${CHAIN_ID}`);
  console.log(`already registered: ${B(String(await registry.providerCount()))} pairs\n`);

  const bySource = { both: 0, onchain: 0, router: 0 };
  for (const c of resolved) bySource[c.modeSource]++;
  console.log('mode decided by:');
  console.log(`  ${String(bySource.both).padStart(3)} both sources agree`);
  console.log(`  ${String(bySource.onchain).padStart(3)} chain only (sources disagreed)`);
  console.log(`  ${String(bySource.router).padStart(3)} router only (chain has no entry for the pair)`);
  console.log(
    DIM('  Each address registers one model on chain while serving many through the Router,'),
  );
  console.log(DIM('  so most pairs have no on-chain entry to read a mode from.\n'));

  console.log('model'.padEnd(34), 'mode'.padEnd(9), 'source'.padEnd(8), 'address');
  for (const c of plan.toRegister) {
    console.log(
      c.modelId.slice(0, 34).padEnd(34),
      c.declaredMode.padEnd(9),
      c.modeSource.padEnd(8),
      c.address,
    );
  }
  if (plan.skipped.length) {
    console.log(`\n${plan.skipped.length} already registered, left alone:`);
    for (const s of plan.skipped) console.log(DIM(`  id ${s.id} · ${s.modelId} · ${s.address}`));
  }
  if (plan.duplicates.length) {
    console.log(YEL(`\n${plan.duplicates.length} duplicate pair(s) in the snapshot, dropped:`));
    for (const d of plan.duplicates) console.log(YEL(`  ${d.modelId} · ${d.address}`));
  }

  console.log(`\n${B(String(plan.toRegister.length))} pair(s) to register`);
  if (plan.toRegister.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }
  if (!has('--broadcast')) {
    console.log(YEL('\nPlan only. Re-run with --broadcast to send it.'));
    console.log(DIM('Registration is permanent — there is no update and no delete.\n'));
    return;
  }

  // ── send ──────────────────────────────────────────────────────────────────
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY is not set.');
    process.exit(1);
  }
  console.log('\nsending…');
  const res = await registerProviders({
    rpcUrl: RPC_URL,
    privateKey,
    providerRegistry: registryAddress,
    candidates: plan.toRegister,
  });
  console.log(`\n${B('registered')} ${res.ids.length} pairs`);
  console.log(`tx      ${res.txHash}`);
  console.log(`gas     ${res.gasUsed}`);
  console.log(`${deployment.explorer}/tx/${res.txHash}\n`);

  const unresolved = res.ids.filter((i) => i.id === 0);
  if (unresolved.length) {
    console.error(YEL(`${unresolved.length} pair(s) read back as id 0 — registration did not take.`));
    process.exit(1);
  }

  deployment.seeded = {
    providerCount: Number(await registry.providerCount()),
    registeredAt: new Date().toISOString(),
    snapshot: SNAPSHOT,
    tx: res.txHash,
    modeSources: bySource,
    note: 'Real services from the snapshot. No stand-in values on this ledger.',
  };
  writeFileSync(DEPLOYMENT, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`updated ${DEPLOYMENT}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
