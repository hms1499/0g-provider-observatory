/**
 * One real pinned call against the live Router. Costs a fraction of a cent.
 *
 * A full epoch is 570 calls; discovering there that the key lacks a scope, or that the
 * pinning header is rejected, wastes the whole run. This proves the path end to end
 * first: auth, provider pinning, price ceiling, timing, and response parsing.
 *
 *   npx tsx src/scripts/smoke-call.ts [probeId]
 */
import { callPinned } from '../probes/router-client.js';
import { buildPlan, loadSnapshot } from '../probes/plan.js';
import { PROBES } from '../probes/suite.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function main() {
  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) {
    console.error('ROUTER_API_KEY is not set. pc.0g.ai -> Dashboard -> API Keys.');
    process.exit(1);
  }

  const plan = buildPlan(loadSnapshot('data/snapshot-2026-08-21.json'), {
    priceMultiplier: 3,
    temperature: 0,
    skipUnhealthy: true,
  });

  // Cheapest service, so a smoke test never costs anything worth noticing.
  const target = [...plan.targets].sort((a, b) => a.estCostUsd - b.estCostUsd)[0];
  const probe = PROBES.find((p) => p.id === (process.argv[2] ?? 'echo-exact'))!;

  console.log(`\n${B('SMOKE CALL')}  ${DIM('one real request against the live Router')}`);
  console.log(`provider  ${target.address}  ${DIM(target.providerName ?? '')}`);
  console.log(`model     ${target.modelId}  ${DIM(`(${target.mode})`)}`);
  console.log(`probe     ${probe.id}`);
  if (target.params.dropped.length) {
    console.log(`dropped   ${target.params.dropped.join(', ')}`);
  }
  console.log(
    `ceiling   prompt ${target.maxPriceUsdPrompt} · completion ${target.maxPriceUsdCompletion} ` +
    DIM('USD / million tokens'),
  );
  console.log('');

  const r = await callPinned({
    apiKey,
    providerAddress: target.address,
    model: target.modelId,
    probe,
    params: target.params,
    maxPriceUsdPrompt: target.maxPriceUsdPrompt,
    maxPriceUsdCompletion: target.maxPriceUsdCompletion,
    timeoutMs: 60_000,
  });

  console.log(`status    ${r.status}${r.ok ? '' : `  ${r.errorKind}`}`);
  console.log(`latency   ${B(String(r.latencyMs))} ms   ${DIM(`Router claims ${target.reportedLatency} ms`)}`);
  if (r.usage) console.log(`tokens    in ${r.usage.prompt} · out ${r.usage.completion}`);
  if (r.chatId) console.log(`chat id   ${r.chatId}  ${DIM('(needed for the TEE signature endpoint)')}`);
  if (r.servedBy) console.log(`served by ${r.servedBy}`);

  if (!r.ok) {
    console.log(`\n${B('FAILED')}  ${r.errorKind}`);
    console.log(r.errorMessage);
    process.exit(1);
  }

  console.log(`\nanswer    ${JSON.stringify(r.text)}`);
  if (probe.expect !== undefined) {
    const got = (r.text ?? '').replace(/\s+/g, ' ').trim();
    console.log(`expected  ${JSON.stringify(probe.expect)}  ${got === probe.expect ? '— match' : '— differs'}`);
  }

  // Base-tier per-token rates. The ceiling headers are per MILLION tokens and must not
  // be reused here — doing so overstates the cost by a factor of a million.
  const inTok = r.usage?.prompt ?? 0;
  const outTok = r.usage?.completion ?? 0;
  const cost = inTok * target.usdPerPromptToken + outTok * target.usdPerCompletionToken;
  console.log(`\ncost      ~$${cost.toFixed(8)}   ${DIM('(base-tier list price)')}`);
  console.log(`${B('OK')} — auth, pinning, price ceiling and timing all work.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
