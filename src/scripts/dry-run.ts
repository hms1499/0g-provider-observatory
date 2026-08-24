/**
 * Dry-run one measurement epoch against a stored snapshot.
 *
 * No network calls, no API key, zero cost. Prints exactly what would be sent so it
 * can be reviewed before any real money is spent.
 *
 *   npx tsx src/scripts/dry-run.ts [snapshot-path]
 */
import { existsSync } from 'node:fs';
import { buildPinnedRequest } from '../probes/router-client.js';
import { buildPlan, loadSnapshot, type Target } from '../probes/plan.js';
import {
  assertSuiteValid,
  PROBES,
  SUITE_MAX_OUTPUT_TOKENS,
  SUITE_MEASURED_TOKENS,
} from '../probes/suite.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const YEL = (s: string) => `\x1b[33m${s}\x1b[0m`;
const head = (n: string, t: string) => console.log(`\n${B(n)} ${B(t)}\n${'─'.repeat(78)}`);

const SNAPSHOT = process.argv[2] ?? 'data/snapshot-2026-08-21.json';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function main() {
  assertSuiteValid();
  if (!existsSync(SNAPSHOT)) {
    console.error(`Snapshot not found: ${SNAPSHOT}\nRun \`pnpm snapshot\` first.`);
    process.exit(1);
  }

  const snap = loadSnapshot(SNAPSHOT);
  const plan = buildPlan(snap, { priceMultiplier: 3, temperature: 0, skipUnhealthy: true });

  console.log(`\n${B('DRY RUN — ONE MEASUREMENT EPOCH')}  ${DIM('no network calls, zero cost')}`);
  console.log(`snapshot ${SNAPSHOT} · taken at ${snap.at}`);

  // ── 01 probe suite ────────────────────────────────────────────────────────
  head('01', 'PROBE SUITE');
  console.log('id'.padEnd(22), 'category'.padEnd(13), 'comparator'.padEnd(13), 'out tok'.padStart(8));
  for (const p of PROBES) {
    console.log(
      p.id.padEnd(22),
      p.category.padEnd(13),
      p.comparator.padEnd(13),
      String(p.maxTokens).padStart(8),
    );
  }
  console.log(
    `${PROBES.length} probes · ceiling ${SUITE_MAX_OUTPUT_TOKENS} out tok · ` +
      `measured ${SUITE_MEASURED_TOKENS.input} in / ${SUITE_MEASURED_TOKENS.output} out`,
  );

  // ── 02 targets ────────────────────────────────────────────────────────────
  head('02', 'MEASUREMENT TARGETS');
  const byMode = plan.targets.reduce<Record<string, number>>((a, t) => {
    a[t.mode] = (a[t.mode] ?? 0) + 1;
    return a;
  }, {});
  const addrs = new Set(plan.targets.map((t) => t.address));
  console.log(`healthy chatbot services: ${B(String(plan.targets.length))} · operator addresses: ${addrs.size}`);
  console.log(`by mode: ${Object.entries(byMode).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`total calls per epoch: ${B(String(plan.callCount))}`);

  if (plan.routerOnly.length) {
    console.log(
      YEL(`\n! ${plan.routerOnly.length} services the Router lists but the contract does not`) +
      DIM(' — the mode label rests on the Router alone, with no on-chain cross-check'),
    );
    for (const t of plan.routerOnly.slice(0, 6)) {
      console.log(`   ${short(t.address)}  ${t.canonicalId.padEnd(22)} ${t.mode}`);
    }
    if (plan.routerOnly.length > 6) console.log(DIM(`   … ${plan.routerOnly.length - 6} more`));
  }

  if (plan.unreachable.length) {
    console.log(
      YEL(`\n! ${plan.unreachable.length} chatbot services on the contract that the Router never exposes`),
    );
    console.log(DIM('   Header pinning cannot reach them. This epoch leaves them unmeasured.'));
    console.log(DIM('   State this on the dashboard rather than silently dropping them from the sample.'));
    for (const u of plan.unreachable) {
      console.log(`   ${short(u.provider)}  ${u.model.padEnd(26)} ${u.mode.padEnd(8)} ${DIM(u.url)}`);
    }
  }

  // ── 03 parameter negotiation ──────────────────────────────────────────────
  head('03', 'PARAMETER NEGOTIATION');
  if (!plan.degraded.length) {
    console.log('Every service accepts temperature 0.');
  } else {
    console.log(
      YEL(`${plan.degraded.length}/${plan.targets.length} services do NOT declare temperature support.`),
    );
    console.log(DIM("They run at the provider's own default. Divergence measured on these"));
    console.log(DIM('services carries sampling noise too — label the number when publishing it.'));
    console.log();
    for (const t of plan.degraded) {
      console.log(`   ${short(t.address)}  ${t.canonicalId.padEnd(22)} dropped: ${t.params.dropped.join(', ')}`);
    }
  }

  // ── 04 consistency groups ─────────────────────────────────────────────────
  head('04', 'CONSISTENCY GROUPS (F2)');
  const calib = plan.groups.filter((g) => g.reference && g.modes.length > 1);
  console.log(
    `${plan.groups.length} models served by 2+ providers · ${calib.length} with a TeeML calibration reference\n`,
  );
  console.log('model'.padEnd(24), 'n'.padStart(3), '  modes'.padEnd(26), 'calibration reference');
  for (const g of plan.groups) {
    console.log(
      g.canonicalId.padEnd(24),
      String(g.targets.length).padStart(3),
      ('  ' + g.modes.join('+')).padEnd(26),
      g.reference ? short(g.reference.address) : DIM('peer-to-peer only'),
    );
  }

  // ── 05 cost ───────────────────────────────────────────────────────────────
  head('05', 'COST');
  const top = [...plan.targets].sort((a, b) => b.estCostUsd - a.estCostUsd).slice(0, 5);
  console.log('model'.padEnd(24), 'mode'.padEnd(10), 'USD/epoch'.padStart(12));
  for (const t of top) {
    console.log(t.canonicalId.padEnd(24), t.mode.padEnd(10), ('$' + t.estCostUsd.toFixed(6)).padStart(12));
  }
  const share = top.reduce((n, t) => n + t.estCostUsd, 0) / plan.estCostUsd;

  // Priced from one real run rather than from the ceiling. This is the number to budget on.
  const measured = plan.targets.reduce(
    (n, t) =>
      n +
      t.usdPerPromptToken * SUITE_MEASURED_TOKENS.input +
      t.usdPerCompletionToken * SUITE_MEASURED_TOKENS.output,
    0,
  );

  console.log('─'.repeat(78));
  console.log(
    `declared ${'$' + plan.estCostUsd.toFixed(4)}   ` +
      DIM('if every probe were billed exactly its max_tokens'),
  );
  console.log(`measured ${B('$' + measured.toFixed(4))}   ${DIM(`(top 5 services account for ${(share * 100).toFixed(0)}%)`)}`);
  console.log(
    DIM(`  token profile from live runs: ${SUITE_MEASURED_TOKENS.input} in / ${SUITE_MEASURED_TOKENS.output} out per service`),
  );
  if (measured > plan.estCostUsd) {
    console.log(
      YEL(
        `  The measured figure is ${(measured / plan.estCostUsd).toFixed(1)}x the declared one. ` +
          'max_tokens is not a ceiling on',
      ),
    );
    console.log(
      YEL('  what is billed: reasoning models bill their thinking as completion tokens, and'),
    );
    console.log(
      YEL('  45 of 176 billed calls in epochs 496514/496516 exceeded the limit they were sent.'),
    );
    console.log(
      YEL('  --reasoning-effort exists but is off by default: measured live, `minimal` made'),
    );
    console.log(
      YEL('  glm-5 answer arith-mod wrong. See ReasoningEffort in router-client.ts.'),
    );
  }
  console.log(`\n1 epoch/day for 8 days:  $${(measured * 8).toFixed(2)}`);
  console.log(`2 epochs/day for 8 days: $${(measured * 16).toFixed(2)}`);
  console.log(
    YEL('Inference is the real cost, not gas — one epoch of inference buys ~870 epochs of chain writes.'),
  );
  console.log(
    YEL('Differs from cost-model.ts: that counts 19 on-chain chatbot services, the Router exposes ' +
      `${plan.targets.length}. The prober calls through the Router, so use the figure here.`),
  );

  // ── 06 sample request ─────────────────────────────────────────────────────
  head('06', 'REQUEST THAT WOULD BE SENT (sample)');
  const sample: Target = plan.groups[0]?.targets[0] ?? plan.targets[0];
  const req = buildPinnedRequest({
    providerAddress: sample.address,
    model: sample.modelId,
    probe: PROBES[0],
    params: sample.params,
    maxPriceUsdPrompt: sample.maxPriceUsdPrompt,
    maxPriceUsdCompletion: sample.maxPriceUsdCompletion,
  });
  console.log(`${req.method} ${req.url}`);
  for (const [k, v] of Object.entries(req.headers)) console.log(`${k}: ${v}`);
  console.log(DIM('authorization: Bearer sk-…            (added at send time, never in this dump)'));
  console.log(JSON.stringify(req.body, null, 2));

  // ── 07 preflight ──────────────────────────────────────────────────────────
  head('07', 'STILL MISSING FOR A REAL RUN');
  const key = process.env.ROUTER_API_KEY;
  console.log(
    key
      ? 'ok  ROUTER_API_KEY is present in the environment'
      : YEL('--  ROUTER_API_KEY is not set') +
        DIM('\n    pc.0g.ai -> connect wallet -> fund 0G -> Dashboard -> API Keys -> inference scope'),
  );
  console.log(DIM('Everything else is ready: probe suite, pinning layer, epoch plan.\n'));
}

main();
