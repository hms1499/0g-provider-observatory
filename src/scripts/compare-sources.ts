/**
 * Ngày 1 — đối chiếu hai nguồn mô tả cùng một mạng lưới:
 *   1. Router HTTP  (router-api.0g.ai/v1/providers)
 *   2. On-chain     (contract inference qua listService)
 * Chênh lệch giữa hai nguồn là dữ kiện đầu tiên của Observatory.
 */
import { fetchRouterServices, guaranteeMode } from '../sources/router.js';
import { fetchOnchainServices } from '../sources/onchain.js';

const b = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  console.log(b('\n═══ NGUỒN 1 · Router HTTP ═══'));
  const router = await fetchRouterServices();
  console.log(`  ${router.length} bản ghi dịch vụ`);

  const byMode = new Map<string, number>();
  const byOperator = new Map<string, number>();
  const addrs = new Set<string>();
  for (const s of router) {
    byMode.set(guaranteeMode(s), (byMode.get(guaranteeMode(s)) ?? 0) + 1);
    const op = s.provider_name ?? '(không khai báo)';
    byOperator.set(op, (byOperator.get(op) ?? 0) + 1);
    addrs.add(s.address.toLowerCase());
  }
  console.log(`  ${addrs.size} địa chỉ vận hành duy nhất`);
  console.log('  chế độ:', Object.fromEntries(byMode));
  console.log('  nhà vận hành:', Object.fromEntries(byOperator));

  console.log(b('\n═══ NGUỒN 2 · On-chain listService ═══'));
  let onchain: any[] = [];
  try {
    onchain = await fetchOnchainServices();
    console.log(`  ${onchain.length} dịch vụ đăng ký on-chain`);
    if (onchain.length) {
      console.log(dim('  mẫu bản ghi đầu tiên:'));
      console.log(dim('  ' + JSON.stringify(onchain[0], (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v).slice(0, 500)));
    }
  } catch (e) {
    console.log(`  ✗ đọc on-chain thất bại: ${(e as Error).message}`);
    return;
  }

  console.log(b('\n═══ CHÊNH LỆCH ═══'));
  const onchainAddrs = new Set(
    onchain.map((s: any) => String(s.provider ?? s[0] ?? '').toLowerCase()).filter(Boolean)
  );
  const onlyRouter = [...addrs].filter((a) => !onchainAddrs.has(a));
  const onlyChain = [...onchainAddrs].filter((a) => !addrs.has(a));
  console.log(`  địa chỉ Router có mà chain không: ${onlyRouter.length}`);
  onlyRouter.forEach((a) => console.log(`    ${a}`));
  console.log(`  địa chỉ chain có mà Router không: ${onlyChain.length}`);
  onlyChain.forEach((a) => console.log(`    ${a}`));
  console.log();
}

main().catch((e) => {
  console.error('LỖI:', e);
  process.exit(1);
});
