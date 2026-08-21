/**
 * Ngày 1 — đối chiếu trường `verifiability` giữa on-chain và Router HTTP
 * cho cùng một (địa chỉ, model). Đây là thứ lập trình viên dựa vào để biết
 * mình đang mua mức đảm bảo nào.
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

  console.log('\n\x1b[1mĐỊA CHỈ | MODEL                          | ON-CHAIN | ROUTER\x1b[0m');
  console.log('─'.repeat(78));

  let agree = 0, disagree = 0, missing = 0;
  const conflicts: string[] = [];

  for (const s of chain as any[]) {
    const addr = String(s[0]);
    const model = String(s[6]);
    const onchainVerif = String(s[7] || '(rỗng)');
    const routerVerif = routerMap.get(key(addr, model));

    if (routerVerif === undefined) { missing++; continue; }
    const same = onchainVerif === routerVerif;
    same ? agree++ : disagree++;
    const mark = same ? '\x1b[2m  ok\x1b[0m' : '\x1b[1;33m LỆCH\x1b[0m';
    const line = `${addr.slice(0, 10)}… | ${model.padEnd(30)} | ${onchainVerif.padEnd(8)} | ${String(routerVerif).padEnd(8)}${mark}`;
    console.log(line);
    if (!same) conflicts.push(`${addr} ${model}: chain=${onchainVerif} router=${routerVerif}`);
  }

  console.log('─'.repeat(78));
  console.log(`khớp: ${agree}   lệch: ${disagree}   chỉ có on-chain: ${missing}`);
  if (conflicts.length) {
    console.log('\n\x1b[1;33mMÂU THUẪN\x1b[0m — cùng một dịch vụ, hai nguồn báo hai mức đảm bảo khác nhau:');
    conflicts.forEach((c) => console.log('  ' + c));
  }
  console.log();
}

main().catch((e) => { console.error('LỖI:', e); process.exit(1); });
