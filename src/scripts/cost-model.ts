/**
 * Real cost of one measurement epoch, computed from the on-chain price table.
 * On-chain prices are denominated in wei (1e18 = 1 0G token).
 *
 * NOTE: this counts on-chain chatbot services. The prober actually calls through the
 * Router, which exposes roughly twice as many — see `pnpm dry-run` for the figure
 * that governs the budget.
 */
import { fetchOnchainServices } from '../sources/onchain.js';

const OG_USD = 0.17;           // 0G price on 2026-08-21
const WEI = 1e18;
const PROBES = 15;             // probes per service
const IN_TOK = 250;            // input tokens per probe
const OUT_TOK = 120;           // output tokens per probe

const usd = (wei: number) => (wei / WEI) * OG_USD;

async function main() {
  const svcs = (await fetchOnchainServices()).filter(s => s.serviceType === 'chatbot');

  console.log('\n\x1b[1mPRICE PER TOKEN (read straight from the contract)\x1b[0m');
  console.log('model'.padEnd(32), 'in (wei)'.padStart(16), 'out (wei)'.padStart(16), '1 probe'.padStart(12));
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
  console.log(`\n\x1b[1mONE FULL EPOCH\x1b[0m  (${PROBES} probes x ${svcs.length} chatbot services)`);
  console.log(`  total calls:       ${PROBES * svcs.length}`);
  console.log(`  inference cost:    \x1b[1m$${total.toFixed(4)}\x1b[0m`);
  console.log(`  most expensive:    ${rows[0].model} — $${rows[0].perEpoch.toFixed(4)}`);
  console.log(`  cheapest:          ${rows[rows.length-1].model} — $${rows[rows.length-1].perEpoch.toFixed(6)}`);
  console.log(`\n  4 epochs/day for 8 days = $${(total*4*8).toFixed(2)}`);
  console.log(`  1 epoch/day for 8 days  = $${(total*8).toFixed(2)}\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
