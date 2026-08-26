import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { CallResult } from '../../src/probes/router-client.js';
import type { VerifiableBundle } from '../../src/verify/recompute.js';
import { measureGroup } from '../measureGroup.js';

const bundle = JSON.parse(
  readFileSync('data/epochs/496540-2026-08-24T040551787Z.bundle.json', 'utf8'),
) as VerifiableBundle;

/** Answers every probe correctly and instantly, so the run is deterministic. */
const perfectCall = async (opts: any): Promise<CallResult> => ({
  probeId: opts.probe.id,
  providerAddress: opts.providerAddress,
  model: opts.model,
  droppedParams: opts.params.dropped,
  at: new Date(0).toISOString(),
  ok: true,
  status: 200,
  latencyMs: 100,
  text: String(opts.probe.expect ?? ''),
  usage: null,
  chatId: null,
  servedBy: opts.providerAddress,
  truncated: false,
  rateLimitRemaining: null,
  // CallResult.errorKind is optional and never null — omitting it is what "no error" means.
  errorKind: undefined,
});

describe('measureGroup', () => {
  it('replays every probe the bundle records, for each provider in the group', async () => {
    const seen: string[] = [];
    await measureGroup({
      bundle,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: async (opts: any) => {
        seen.push(`${opts.providerAddress}|${opts.probe.id}`);
        return perfectCall(opts);
      },
    });
    // Two providers serve this model in the pinned roster, and the suite has 15 probes.
    assert.equal(seen.length, 30);
    assert.equal(new Set(seen).size, 30);
  });

  it('reports progress once per call', async () => {
    const ticks: number[] = [];
    await measureGroup({
      bundle,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: perfectCall,
      onProgress: (p) => ticks.push(p.done),
    });
    assert.equal(ticks.length, 30);
    assert.equal(ticks.at(-1), 30);
  });

  /**
   * The rules that decide what a difference MEANS are recorded in the bundle, and a live
   * replay has no rules of its own — so it has to borrow the published epoch's, not the
   * ones `src/probes/suite.ts` happens to carry today. Otherwise changing the suite
   * silently rewrites what an old epoch is compared against, and the panel reports our
   * edit as a disagreement between two measurements of the network.
   */
  it('scores the live run by the bundle\'s divergence rules, not today\'s suite', async () => {
    const [a] = bundle.roster.filter((s) => s.canonicalId === 'qwen3-vl-30b');
    const narrowed: VerifiableBundle = {
      ...bundle,
      rules: { ...bundle.rules, divergenceProbeIds: ['one-word'] },
    };

    // One provider answers `echo-exact` differently. That probe counts toward divergence
    // under today's suite and is absent from this bundle's rules, so it is exactly the
    // probe the two rulebooks disagree about.
    const { live } = await measureGroup({
      bundle: narrowed,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: async (opts: any) => {
        const r = await perfectCall(opts);
        if (opts.probe.id === 'echo-exact' && opts.providerAddress === a.address) {
          return { ...r, text: 'something else entirely' };
        }
        return r;
      },
    });

    assert.equal(live.length, 2);
    for (const s of live) assert.equal(s.divergenceBps, 0, `${s.address} counted a probe the bundle excludes`);
  });

  it('compares the live run against what the bundle published', async () => {
    const { report } = await measureGroup({
      bundle,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: perfectCall,
    });
    assert.equal(report.compared, 2);
  });

  it('refuses a model the bundle never measured, rather than reporting an empty run', async () => {
    await assert.rejects(
      () => measureGroup({ bundle, canonicalId: 'not-in-this-bundle', apiKey: 'sk-test', call: perfectCall }),
      /no services/i,
    );
  });

  it('refuses to replay against a bundle that never recorded the parameters it sent', async () => {
    // Schema /1 and /2 bundles did not carry `sentParams` at all — simulate that by omitting
    // the field, not by setting it to a falsy value, so the guard is proven against the real
    // shape of an old bundle rather than an easier stand-in.
    const noSentParams: VerifiableBundle = {
      ...bundle,
      roster: bundle.roster.map((s) => {
        if (s.canonicalId !== 'qwen3-vl-30b') return s;
        const { sentParams: _omit, ...rest } = s;
        return rest;
      }),
    };
    await assert.rejects(
      () =>
        measureGroup({ bundle: noSentParams, canonicalId: 'qwen3-vl-30b', apiKey: 'sk-test', call: perfectCall }),
      /does not record the generation parameters/i,
    );
  });
});
