import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { CallResult } from '../../src/probes/router-client.js';
import type { VerifiableBundle } from '../../src/verify/recompute.js';
import { measurableGroups, measureGroup } from '../measureGroup.js';

const bundle = JSON.parse(
  readFileSync('data/epochs/496540-2026-08-24T040551787Z.bundle.json', 'utf8'),
) as VerifiableBundle;

/** The first epoch that probed every healthy service, so the first with unmeasurable groups. */
const wide = JSON.parse(
  readFileSync('data/epochs/496616-2026-08-27T080843441Z.bundle.json', 'utf8'),
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

describe('measurableGroups', () => {
  it('marks a group replayable when the published run measured every provider of it', () => {
    const choices = measurableGroups(bundle);
    const g = choices.find((c) => c.canonicalId === 'qwen3-vl-30b');
    assert.ok(g?.replayable);
    assert.deepEqual(g.short, []);
    assert.equal(g.calls, g.services * bundle.probes.length);
  });

  it('keeps every group of the epoch in one list, replayable or not', () => {
    // The picker shows all of them and disables the rest, so none may be dropped here.
    const choices = measurableGroups(wide);
    assert.equal(choices.length, 10);
    assert.equal(choices.filter((c) => c.replayable).length, 6);
    assert.equal(choices.filter((c) => !c.replayable).length, 4);
  });

  it('orders replayable first, so the picker default is always one a key can run', () => {
    const choices = measurableGroups(wide);
    const firstUnreplayable = choices.findIndex((c) => !c.replayable);
    assert.ok(choices.slice(0, firstUnreplayable).every((c) => c.replayable));
    assert.ok(choices.slice(firstUnreplayable).every((c) => !c.replayable));
    assert.ok(choices[0]!.replayable);
  });

  it('orders by cost within each half, cheapest first', () => {
    for (const half of [true, false]) {
      const calls = measurableGroups(wide).filter((c) => c.replayable === half).map((c) => c.calls);
      assert.deepEqual(calls, [...calls].sort((a, b) => a - b));
    }
  });

  it('refuses the Anthropic groups of epoch 496616, whose every call was rejected', () => {
    const choices = measurableGroups(wide);
    for (const id of ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8']) {
      const g = choices.find((c) => c.canonicalId === id);
      assert.ok(g, `${id} must still appear in the picker`);
      assert.equal(g.replayable, false);
      // Every member failed, so every member is named with the samples it managed.
      assert.equal(g.short.length, g.services);
      for (const sv of g.short) assert.equal(sv.successes, 0);
    }
  });

  it('refuses a group where only one member fell short, not just where all did', () => {
    // glm-5 is three providers; zai-org/GLM-5-FP8 spent its output ceiling before answering.
    const g = measurableGroups(wide).find((c) => c.canonicalId === 'glm-5')!;
    assert.equal(g.replayable, false);
    assert.equal(g.services, 3);
    assert.equal(g.short.length, 1);
    assert.match(g.short[0]!.modelId, /GLM-5-FP8/);
  });

  it('leaves a lone provider out entirely — it is not a comparison to offer or to refuse', () => {
    const choices = measurableGroups(wide);
    for (const id of ['hy3', 'minimax-m3', 'gpt-5.5']) {
      assert.ok(!choices.some((c) => c.canonicalId === id));
    }
    for (const c of choices) assert.ok(c.services >= 2, `${c.canonicalId} has ${c.services}`);
  });
});
