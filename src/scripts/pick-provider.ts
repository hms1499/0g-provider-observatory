/**
 * F6 from the command line: pick a provider, and show the working.
 *
 * Reads 0G mainnet directly. No key, no wallet, no cost, and no server of ours in the path.
 *
 *     pnpm pick glm-5.2
 *     pnpm pick glm-5.2 --mode=TeeML
 *     pnpm pick deepseek-v4-flash-0731 --max-p95=8000 --order-by=p95
 *     pnpm pick qwen3.7-plus --epochs=3 --no-divergence
 *
 * Prints the rejections as well as the choice, because "nothing matched" and "four things
 * matched and here is why this one won" are different answers and a caller deserves to see
 * which one they got.
 */
import { MAINNET, pickProvider, type OrderBy } from '../sdk/pickProvider.js';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const OK = (s: string) => `\x1b[32m${s}\x1b[0m`;

const args = process.argv.slice(2);
const model = args.find((a) => !a.startsWith('--'));
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const has = (name: string) => args.includes(`--${name}`);

const num = (name: string): number | undefined => {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`--${name} must be a number, got: ${raw}`);
    process.exit(1);
  }
  return n;
};

if (!model) {
  console.error(`Usage: pnpm pick <model> [flags]

  --mode=TeeML|TeeTLS|standard   exact match, never "at least"
  --max-p50=<ms>                 ceiling on the median of the epoch medians
  --max-p95=<ms>                 ceiling on the WORST epoch p95 in the window
  --max-errors=<bps>             ceiling on the calls-weighted error rate
  --no-divergence                only services that never diverged where measurable
  --min-epochs=<n>               reject a service measured in fewer epochs
  --max-age-hours=<n>            reject a window whose newest reading is older
  --epochs=<n>                   how many epochs to pool (default 5)
  --order-by=p50|p95|errorRate   which field decides the order (default p50)

Flags must be written as --flag=value: through pnpm the spaced form is swallowed.`);
  process.exit(1);
}

const maxAgeHours = num('max-age-hours');

const result = await pickProvider({
  model,
  mode: flag('mode') as never,
  maxP50Ms: num('max-p50'),
  maxP95Ms: num('max-p95'),
  maxErrorRateBps: num('max-errors'),
  requireNoDivergence: has('--no-divergence') || has('no-divergence') ? true : undefined,
  minEpochs: num('min-epochs'),
  maxAgeMs: maxAgeHours === undefined ? undefined : maxAgeHours * 3_600_000,
  epochs: num('epochs'),
  orderBy: flag('order-by') as OrderBy | undefined,
});

const rule = '─'.repeat(78);

console.log(`\n${B('PICK A PROVIDER')}  ${DIM('read from 0G mainnet, no key, no cost')}`);
console.log(rule);
console.log(`model      ${model}`);
console.log(`window     ${result.window.length} epoch(s): ${result.window.join(', ')}`);
console.log(`prober     ${MAINNET.prober}`);
console.log(`ordered by ${result.orderedBy}\n`);

if (result.consideredCount === 0) {
  console.log(`No service in this window serves ${B(model)}.`);
  console.log(DIM('That is a different answer from "none met your criteria" — check the model'));
  console.log(DIM('string against the Providers panel; it is matched exactly as the registry'));
  console.log(DIM('records it, never canonicalised.\n'));
  process.exit(0);
}

if (result.best === null) {
  console.log(`${B('NO MATCH')}  ${result.consideredCount} service(s) serve this model, none met the criteria.`);
  console.log(DIM('Nothing is relaxed to fill an empty result — a weaker guarantee than the one'));
  console.log(DIM('you asked for is not a match.\n'));
} else {
  const b = result.best;
  console.log(`${OK(B('BEST'))}  ${b.address}`);
  console.log(`      ${b.mode}${b.modeChanged ? DIM('  (mode changed during the window)') : ''}`);
  console.log(
    `      p50 ${b.p50Ms}ms · worst-epoch p95 ${b.p95Ms}ms · errors ${b.errorRateBps}bps`,
  );
  console.log(
    `      ${b.epochsUsed} epoch(s), ${b.calls} calls, newest ${b.newestEpoch} at ${b.measuredAt.toISOString().slice(0, 16).replace('T', ' ')}Z`,
  );
  console.log(
    `      divergence measurable in ${b.divergenceMeasuredIn}, found in ${b.divergedIn}`,
  );

  console.log(`\n${DIM('pin it:')}  X-0G-Provider-Address: ${b.address}`);
  console.log(`${DIM('        ')}  model: ${b.model}\n`);
}

if (result.matches.length > 1) {
  console.log(B('OTHER MATCHES'));
  console.log(rule);
  for (const m of result.matches.slice(1)) {
    console.log(
      `  ${m.address}  ${m.mode.padEnd(8)} p50 ${String(m.p50Ms).padStart(6)}ms  p95 ${String(m.p95Ms).padStart(6)}ms  ${m.errorRateBps}bps`,
    );
  }
  console.log();
}

if (result.rejected.length > 0) {
  console.log(B('REJECTED'));
  console.log(rule);
  for (const r of result.rejected) console.log(`  ${r.address}  ${DIM(r.reason)}`);
  console.log();
}

console.log(
  DIM(
    'Nothing here is a verdict. p95 is the worst epoch in the window, not the typical one;\n' +
      'divergence is a distance, never a cause; and this measurement cannot weight a provider\n' +
      'by the traffic it really serves.',
  ),
);
console.log();
