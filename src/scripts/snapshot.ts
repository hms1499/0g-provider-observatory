/** Chụp trạng thái mạng lưới từ cả hai nguồn, lưu kèm dấu thời gian. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fetchRouterServices } from '../sources/router.js';
import { fetchOnchainServices } from '../sources/onchain.js';

async function main() {
  const at = new Date().toISOString();
  const [router, chain] = await Promise.all([fetchRouterServices(), fetchOnchainServices()]);

  mkdirSync('data', { recursive: true });
  const out = {
    at,
    router: { count: router.length, services: router },
    onchain: {
      count: chain.length,
      services: chain.map((s) => ({ ...s, inputPrice: s.inputPrice.toString(), outputPrice: s.outputPrice.toString(), updatedAt: s.updatedAt.toString() })),
    },
  };
  const file = `data/snapshot-${at.slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(out, null, 2));

  const modes = chain.reduce<Record<string, number>>((a, s) => ((a[s.mode] = (a[s.mode] ?? 0) + 1), a), {});
  const overstated = chain.filter((s) => s.rawVerifiability === 'TeeML' && s.mode !== 'TeeML').length;

  console.log(`\n✓ ${file}`);
  console.log(`  Router:   ${router.length} dịch vụ`);
  console.log(`  On-chain: ${chain.length} dịch vụ`);
  console.log(`  Chế độ suy ra:`, modes);
  console.log(`  Dịch vụ có verifiability on-chain nói quá mức đảm bảo: ${overstated}\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
