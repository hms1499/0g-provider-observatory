/**
 * Chi phí thật của một vòng đo, tính từ bảng giá on-chain.
 * Giá on-chain tính bằng wei (1e18 = 1 token 0G).
 */
import { fetchOnchainServices } from '../sources/onchain.js';

const OG_USD = 0.17;           // giá 0G ngày 21/08/2026
const WEI = 1e18;
const PROBES = 15;             // số prompt thăm dò mỗi dịch vụ
const IN_TOK = 250;            // token đầu vào mỗi probe
const OUT_TOK = 120;           // token đầu ra mỗi probe

const usd = (wei: number) => (wei / WEI) * OG_USD;

async function main() {
  const svcs = (await fetchOnchainServices()).filter(s => s.serviceType === 'chatbot');

  console.log('\n\x1b[1mGIÁ MỖI TOKEN (đọc thẳng từ contract)\x1b[0m');
  console.log('model'.padEnd(32), 'vào (wei)'.padStart(16), 'ra (wei)'.padStart(16), '1 probe'.padStart(12));
  console.log('─'.repeat(80));

  let total = 0;
  const rows = svcs.map(s => {
    const perProbe = usd(Number(s.inputPrice) * IN_TOK + Number(s.outputPrice) * OUT_TOK);
    const perEpoch = perProbe * PROBES;
    total += perEpoch;
    return { model: s.model, mode: s.mode, inp: Number(s.inputPrice), out: Number(s.outputPrice), perProbe, perEpoch };
  }).sort((a, b) => b.perEpoch - a.perEpoch);

  for (const r of rows) {
    console.log(
      r.model.slice(0, 31).padEnd(32),
      String(r.inp).padStart(16),
      String(r.out).padStart(16),
      ('$' + r.perProbe.toFixed(6)).padStart(12)
    );
  }

  console.log('─'.repeat(80));
  console.log(`\n\x1b[1mMỘT VÒNG ĐO ĐẦY ĐỦ\x1b[0m  (${PROBES} probe × ${svcs.length} dịch vụ chatbot)`);
  console.log(`  tổng lời gọi:      ${PROBES * svcs.length}`);
  console.log(`  chi phí inference: \x1b[1m$${total.toFixed(4)}\x1b[0m`);
  console.log(`  đắt nhất:          ${rows[0].model} — $${rows[0].perEpoch.toFixed(4)}`);
  console.log(`  rẻ nhất:           ${rows[rows.length-1].model} — $${rows[rows.length-1].perEpoch.toFixed(6)}`);
  console.log(`\n  chạy 4 lần/ngày × 8 ngày = $${(total*4*8).toFixed(2)}`);
  console.log(`  chạy 1 lần/ngày × 8 ngày = $${(total*8).toFixed(2)}\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
