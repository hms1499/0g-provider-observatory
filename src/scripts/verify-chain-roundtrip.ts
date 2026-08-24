/**
 * End-to-end check of the on-chain ledger against a local node.
 *
 * Registers the real network shape from a snapshot, writes one epoch, then reads it
 * back through the same reader the verification CLI and dashboard use. If the numbers
 * that come out differ from the ones that went in, this exits non-zero.
 *
 *   anvil --port 8546 &
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
 *   PROVIDER_REGISTRY=0x… MEASUREMENT_REGISTRY=0x… npx tsx src/scripts/verify-chain-roundtrip.ts
 */
import { Contract, JsonRpcProvider, NonceManager, Wallet } from 'ethers';
import { ObservatoryReader, MODES } from '../chain/registry.js';
import { buildPlan, loadSnapshot } from '../probes/plan.js';
import { latestSnapshot } from '../paths.js';

const RPC = process.env.LOCAL_RPC ?? 'http://127.0.0.1:8546';
const PK = process.env.LOCAL_PK ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SNAPSHOT = process.env.SNAPSHOT ?? latestSnapshot() ?? '';

const REG = process.env.PROVIDER_REGISTRY;
const MR = process.env.MEASUREMENT_REGISTRY;

const WRITE_REG_ABI = [
  'function registerBatch(address[] addrs, string[] models, uint8[] declaredModes) returns (uint16[])',
];
const WRITE_MR_ABI = [
  'function writeEpoch(bytes32 storageRoot, tuple(uint16 providerId, uint32 p50Ms, uint32 p95Ms, uint16 errorRateBps, uint16 divergenceBps, uint16 calls, uint8 observedMode)[] items)',
];

const modeId = (m: string) => Math.max(1, MODES.indexOf(m as any));
const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const fail = (msg: string) => { console.error(`\x1b[31mFAIL\x1b[0m ${msg}`); process.exit(1); };

async function main() {
  if (!REG || !MR) fail('Set PROVIDER_REGISTRY and MEASUREMENT_REGISTRY from the deploy output.');

  const snap = loadSnapshot(SNAPSHOT);
  const plan = buildPlan(snap, { skipUnhealthy: true });
  const targets = plan.targets;

  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(PK, provider);
  // Several writes land back to back; NonceManager keeps them sequential instead of
  // racing on a cached pending nonce.
  const signer = new NonceManager(wallet);
  const reg = new Contract(REG!, WRITE_REG_ABI, signer);
  const mr = new Contract(MR!, WRITE_MR_ABI, signer);

  console.log(`\n${B('CHAIN ROUND TRIP')}  ${RPC}`);
  console.log(`snapshot ${SNAPSHOT} — ${targets.length} healthy chatbot services\n`);

  // ── register the real network shape ───────────────────────────────────────
  const tx1 = await reg.registerBatch(
    targets.map((t) => t.address),
    targets.map((t) => t.modelId),
    targets.map((t) => modeId(t.mode)),
  );
  const r1 = await tx1.wait();
  console.log(`registered ${targets.length} providers — gas ${r1!.gasUsed}`);

  // ── write one epoch of stand-in measurements ──────────────────────────────
  // Values are synthetic; what is under test is the ledger, not the prober.
  const storageRoot = '0x' + 'ab'.repeat(32);
  const items = targets.map((t, i) => ({
    providerId: i + 1,
    p50Ms: 2900 + i * 7,
    p95Ms: 9400 + i * 11,
    errorRateBps: (i * 13) % 10000,
    divergenceBps: (i * 29) % 10000,
    calls: 15,
    observedMode: modeId(t.mode),
  }));

  const tx2 = await mr.writeEpoch(storageRoot, items);
  const r2 = await tx2.wait();
  console.log(`wrote 1 epoch of ${items.length} measurements — gas ${B(String(r2!.gasUsed))}\n`);

  // ── read it back through the shared reader ────────────────────────────────
  const reader = new ObservatoryReader(RPC, {
    providerRegistry: REG!,
    measurementRegistry: MR!,
  });

  const epoch = await reader.currentEpoch();
  const record = await reader.readEpoch(epoch, wallet.address);
  if (!record) fail(`epoch ${epoch} reads back as unwritten`);

  const providers = await reader.loadProviders();
  if (providers.length !== targets.length) {
    fail(`registry holds ${providers.length} providers, expected ${targets.length}`);
  }

  // ── compare every field that went in ──────────────────────────────────────
  let checked = 0;
  for (const sent of items) {
    const got = record!.measurements.find((m) => m.providerId === sent.providerId);
    if (!got) fail(`provider ${sent.providerId} missing from the epoch`);
    for (const k of ['p50Ms', 'p95Ms', 'errorRateBps', 'divergenceBps', 'calls'] as const) {
      if ((got as any)[k] !== sent[k]) {
        fail(`provider ${sent.providerId} ${k}: wrote ${sent[k]}, read ${(got as any)[k]}`);
      }
    }
    if (MODES.indexOf(got!.observedMode) !== sent.observedMode) {
      fail(`provider ${sent.providerId} observedMode round-tripped wrong`);
    }
    checked++;
  }

  if (record!.storageRoot !== storageRoot) fail('storageRoot did not round trip');

  // model names live only in logs — confirm they came back
  const named = providers.filter((p) => p.model !== null);
  if (named.length !== providers.length) {
    fail(`${providers.length - named.length} model names missing from registration logs`);
  }
  const first = providers[0];
  if (first.model !== targets[0].modelId) {
    fail(`model name mismatch: wrote ${targets[0].modelId}, read ${first.model}`);
  }

  // write-once must hold
  let rejected = false;
  try {
    await (await mr.writeEpoch(storageRoot, items)).wait();
  } catch {
    rejected = true;
    signer.reset(); // the reverted tx must not strand the nonce counter
  }
  if (!rejected) fail('a second write to the same epoch was accepted — the ledger is not immutable');

  console.log(`${B('PASS')}  ${checked} measurements round-tripped field by field`);
  console.log(`      ${named.length} model names recovered from logs`);
  console.log(`      storageRoot intact · rewrite rejected · epoch ${epoch}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
