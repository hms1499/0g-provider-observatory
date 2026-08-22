/**
 * Reconcile the two sources describing the same network:
 *   1. HTTP Router  (router-api.0g.ai/v1/providers)
 *   2. On-chain     (the inference contract via listService)
 * The gap between them is the Observatory's first datum.
 */
import { fetchRouterServices, guaranteeMode } from '../sources/router.js';
import { fetchOnchainServices } from '../sources/onchain.js';

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  console.log(b('\n=== SOURCE 1 · HTTP Router ==='));
  const router = await fetchRouterServices();
  console.log(`  ${router.length} service records`);

  const byMode = new Map<string, number>();
  const byOperator = new Map<string, number>();
  const addrs = new Set<string>();
  for (const s of router) {
    byMode.set(guaranteeMode(s), (byMode.get(guaranteeMode(s)) ?? 0) + 1);
    const op = s.provider_name ?? '(undeclared)';
    byOperator.set(op, (byOperator.get(op) ?? 0) + 1);
    addrs.add(s.address.toLowerCase());
  }
  console.log(`  ${addrs.size} unique operator addresses`);
  console.log('  modes:', Object.fromEntries(byMode));
  console.log('  operators:', Object.fromEntries(byOperator));

  console.log(b('\n=== SOURCE 2 · On-chain listService ==='));
  let onchain: any[] = [];
  try {
    onchain = await fetchOnchainServices();
    console.log(`  ${onchain.length} services registered on-chain`);
    if (onchain.length) {
      console.log(dim('  first record sample:'));
      console.log(dim('  ' + JSON.stringify(onchain[0], (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v).slice(0, 500)));
    }
  } catch (e) {
    console.log(`  failed to read on-chain: ${(e as Error).message}`);
    return;
  }

  console.log(b('\n=== DIVERGENCE ==='));
  const onchainAddrs = new Set(
    onchain.map((s: any) => String(s.provider ?? s[0] ?? '').toLowerCase()).filter(Boolean)
  );
  const onlyRouter = [...addrs].filter((a) => !onchainAddrs.has(a));
  const onlyChain = [...onchainAddrs].filter((a) => !addrs.has(a));
  console.log(`  addresses in the Router but not on chain: ${onlyRouter.length}`);
  onlyRouter.forEach((a) => console.log(`    ${a}`));
  console.log(`  addresses on chain but not in the Router: ${onlyChain.length}`);
  onlyChain.forEach((a) => console.log(`    ${a}`));
  console.log();
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
