/**
 * Re-derive PROBE_TOKEN_PROFILE from real transcripts.
 *
 * The profile in `suite.ts` is committed rather than computed at runtime — a budget that
 * depended on files in `data/` would behave differently on a fresh checkout. This script is
 * how those committed numbers are produced, so they can be regenerated rather than guessed
 * the next time the roster or `reasoning_effort` changes.
 *
 *   pnpm token-profile data/epochs/*.jsonl
 */
import { readFileSync } from 'node:fs';
import { NOISE_PROBE_PAIR } from '../probes/divergence.js';
import { PROBES, PROBE_TOKEN_PROFILE } from '../probes/suite.js';
import type { CallResult } from '../probes/router-client.js';

/** Nearest-rank, matching the percentile rule the aggregation publishes under. */
function percentile(sorted: number[], k: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((k * sorted.length) / 100) - 1)];
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: pnpm token-profile <transcript.jsonl> [more.jsonl ...]');
  process.exit(1);
}

const byProbe = new Map<string, { input: number[]; output: number[] }>();
let calls = 0;
for (const path of paths) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as CallResult;
    calls++;
    if (!r.usage) continue;
    const slot = byProbe.get(r.probeId) ?? { input: [], output: [] };
    slot.input.push(r.usage.prompt ?? 0);
    slot.output.push(r.usage.completion ?? 0);
    byProbe.set(r.probeId, slot);
  }
}

// The noise pair is byte-identical on the wire, so one shared profile rather than two.
// Measured separately they drifted 3.5x apart — not because the requests differ but because
// the second one sits near the end of the suite and stopped being sent when a run was cut.
const pooled = { input: [] as number[], output: [] as number[] };
for (const id of NOISE_PROBE_PAIR) {
  const slot = byProbe.get(id);
  if (!slot) continue;
  pooled.input.push(...slot.input);
  pooled.output.push(...slot.output);
}
if (pooled.input.length > 0) for (const id of NOISE_PROBE_PAIR) byProbe.set(id, pooled);

console.log(`// measured over ${calls} calls from ${paths.length} transcript(s)`);
console.log('export const PROBE_TOKEN_PROFILE: Record<string, { input: number; output: number }> = {');
let changed = 0;
for (const probe of PROBES) {
  const slot = byProbe.get(probe.id);
  if (!slot || slot.input.length === 0) {
    console.log(`  // '${probe.id}': no usage in these transcripts, keeping the committed value`);
    continue;
  }
  // Input is fixed by the prompt, so carry the worst case. Output takes p90 rather than the
  // maximum: reserve-then-settle makes a mild under-reservation safe, a wild over-reservation
  // just stops the run early.
  const input = Math.max(...slot.input);
  const output = percentile([...slot.output].sort((a, b) => a - b), 90);
  const was = PROBE_TOKEN_PROFILE[probe.id];
  const drift = was && (was.input !== input || was.output !== output);
  if (drift) changed++;
  console.log(
    `  '${probe.id}': { input: ${input}, output: ${output} },` +
      (drift ? `  // was ${was.input}/${was.output}` : ''),
  );
}
console.log('};');
console.log(
  `\n// ${changed} probe(s) differ from the committed profile` +
    (changed ? ' — paste the block above into src/probes/suite.ts' : ''),
);
