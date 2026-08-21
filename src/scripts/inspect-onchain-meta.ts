import { fetchRouterServices } from '../sources/router.js';
import { fetchOnchainServices } from '../sources/onchain.js';

const key = (a: string, m: string) => `${a.toLowerCase()}|${m}`;

async function main() {
  const [router, chain] = await Promise.all([fetchRouterServices(), fetchOnchainServices()]);
  const rMap = new Map<string, string>();
  for (const s of router) rMap.set(key(s.address, s.model_id), s.verifiability ?? s.trust_mode ?? '?');

  const rows: any[] = [];
  for (const s of chain as any[]) {
    let meta: any = {};
    try { meta = JSON.parse(String(s[8] ?? '{}')); } catch { /* trường khác */ }
    rows.push({
      addr: String(s[0]).slice(0, 10),
      model: String(s[6]),
      chainVerif: String(s[7] || '-'),
      router: rMap.get(key(String(s[0]), String(s[6]))) ?? '(không có)',
      TargetSeparated: meta.TargetSeparated,
      ProviderType: meta.ProviderType,
      TEEVerifier: meta.TEEVerifier,
      ImageDigest: meta.ImageDigest ? 'có' : '(rỗng)',
    });
  }
  console.table(rows);

  const sep = rows.filter(r => r.TargetSeparated === true);
  const nosep = rows.filter(r => r.TargetSeparated === false);
  console.log(`\nTargetSeparated=true  → router nói: ${[...new Set(sep.map(r=>r.router))].join(', ')}`);
  console.log(`TargetSeparated=false → router nói: ${[...new Set(nosep.map(r=>r.router))].join(', ')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
