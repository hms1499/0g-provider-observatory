/**
 * Compare the `verifiability` field between on-chain and the HTTP Router
 * for the same (address, model). This is what a developer relies on to know which
 * guarantee they are buying.
 */
import { fetchRouterServices } from '../sources/router.js';
import { fetchOnchainServices } from '../sources/onchain.js';

const key = (a: string, m: string) => `${a.toLowerCase()}|${m}`;

async function main() {
  const [router, chain] = await Promise.all([fetchRouterServices(), fetchOnchainServices()]);

  const routerMap = new Map<string, string>();
  for (const s of router) {
    routerMap.set(key(s.address, s.model_id), s.verifiability ?? s.trust_mode ?? '?');
  }

  console.log('\n\x1b[1mADDRESS    | MODEL                          | ON-CHAIN | ROUTER\x1b[0m');
  console.log('─'.repeat(78));

  let agree = 0, disagree = 0, missing = 0;
  const conflicts: string[] = [];

  for (const s of chain as any[]) {
    const addr = String(s[0]);
    const model = String(s[6]);
    const onchainVerif = String(s[7] || '(empty)');
    const routerVerif = routerMap.get(key(addr, model));

    if (routerVerif === undefined) { missing++; continue; }
    const same = onchainVerif === routerVerif;
    same ? agree++ : disagree++;
    const mark = same ? '\x1b[2m  ok\x1b[0m' : '\x1b[1;33m DIFF\x1b[0m';
    const line = `${addr.slice(0, 10)}… | ${model.padEnd(30)} | ${onchainVerif.padEnd(8)} | ${String(routerVerif).padEnd(8)}${mark}`;
    console.log(line);
    if (!same) conflicts.push(`${addr} ${model}: chain=${onchainVerif} router=${routerVerif}`);
  }

  console.log('─'.repeat(78));
  console.log(`agree: ${agree}   differ: ${disagree}   on-chain only: ${missing}`);
  if (conflicts.length) {
    console.log('\n\x1b[1;33mCONFLICTS\x1b[0m — same service, two sources reporting two different guarantees:');
    conflicts.forEach((c) => console.log('  ' + c));
  }
  console.log();
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
