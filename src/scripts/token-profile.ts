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
console.log('export const PROBE_TOKEN_PROFILE: Record<string, ProbeTokens> = {');
let changed = 0;
for (const probe of PROBES) {
  const slot = byProbe.get(probe.id);
  if (!slot || slot.input.length === 0) {
    console.log(`  // '${probe.id}': no usage in these transcripts, keeping the committed value`);
    continue;
  }
  // Worst case for both, and the output one is a correction.
  //
  // This used to take the 90th percentile, on the reasoning that a wild over-reservation
  // would stop a run early. Measuring epoch 496539 killed that: the distribution is bimodal,
  // not long-tailed. `no-letter-e` declares maxTokens 40; eight of ten services honour it and
  // qwen3.7-plus ignores it and bills 2281. With 2 of 18 samples in the upper mode the p90
  // sits exactly on the boundary, and one more compliant sample flips the figure from 2281 to
  // 41 — a 56x swing from noise. A percentile is the wrong statistic for that shape.
  //
  // The max is stable, means something plain ("the most this probe has ever cost"), and is
  // only 20% above the p90 now that the noise pair no longer truncates. The error directions
  // are not symmetric either: over-reserving costs headroom, under-reserving aborts a run
  // mid-suite and biases every probe near the end of the suite.
  const input = Math.max(...slot.input);
  const output = Math.round(slot.output.reduce((a, b) => a + b, 0) / slot.output.length);
  const outputMax = Math.max(...slot.output);
  const was = PROBE_TOKEN_PROFILE[probe.id];
  const drift =
    was && (was.input !== input || was.output !== output || was.outputMax !== outputMax);
  if (drift) changed++;
  console.log(
    `  '${probe.id}': { input: ${input}, output: ${output}, outputMax: ${outputMax} },` +
      (drift ? `  // was ${was.input}/${was.output}/${was.outputMax}` : ''),
  );
}
console.log('};');
console.log(
  `\n// ${changed} probe(s) differ from the committed profile` +
    (changed ? ' — paste the block above into src/probes/suite.ts' : ''),
);
