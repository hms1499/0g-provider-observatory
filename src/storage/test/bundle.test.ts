import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Target } from '../../probes/plan.js';
import type { CallResult } from '../../probes/router-client.js';
import { PROBES } from '../../probes/suite.js';
import { ERROR_KINDS } from '../../probes/router-client.js';
import { buildBundle, localDigest, serializeBundle, stableStringify } from '../bundle.js';

const ADDR_A = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';

function target(over: Partial<Target> = {}): Target {
  return {
    address: ADDR_A,
    providerName: 'acme',
    modelId: 'glm-5.2',
    canonicalId: 'glm-5.2',
    mode: 'TeeML',
    onchainMode: 'TeeML',
    params: { temperature: 0, dropped: [] },
    estCostUsd: 0,
    reportedLatency: null,
    usdPerPromptToken: 1e-8,
    usdPerCompletionToken: 2e-8,
    ...over,
  };
}

function result(over: Partial<CallResult> = {}): CallResult {
  return {
    probeId: 'echo-exact',
    providerAddress: ADDR_A,
    model: 'glm-5.2',
    ok: true,
    status: 200,
    latencyMs: 100,
    text: 'OBSERVATORY-7F2A',
    usage: { prompt: 20, completion: 8, total: 28 },
    chatId: 'chat-1',
    servedBy: ADDR_A,
    rateLimitRemaining: 499,
    truncated: false,
    droppedParams: [],
    at: '2026-08-23T02:59:16.000Z',
    ...over,
  };
}

const input = {
  epoch: 496514,
  prober: '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB',
  startedAt: '2026-08-23T02:59:15.129Z',
  endedAt: '2026-08-23T03:00:44.000Z',
  roster: [target()],
  results: [result()],
};

describe('stableStringify', () => {
  it('produces the same bytes however the keys were inserted', () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    assert.equal(stableStringify(a), stableStringify(b));
  });

  it('preserves array order, because a transcript is chronological evidence', () => {
    assert.equal(stableStringify([3, 1, 2]), '[3,1,2]');
  });
});

describe('buildBundle', () => {
  it('carries every probe definition, so the comparators need not be trusted', () => {
    const b = buildBundle(input);
    assert.equal(b.probes.length, PROBES.length);
    const echo = b.probes.find((p) => p.id === 'echo-exact')!;
    assert.equal(echo.comparator, PROBES.find((p) => p.id === 'echo-exact')!.comparator);
    assert.ok(echo.prompt.length > 0);
  });

  it('records the parameters a service would not accept', () => {
    const b = buildBundle({
      ...input,
      roster: [target({ params: { dropped: ['temperature'] } })],
    });
    assert.deepEqual(b.roster[0].droppedParams, ['temperature']);
  });

  it('records the generation parameters a service was actually sent', () => {
    const b = buildBundle({
      ...input,
      roster: [target({ params: { temperature: 0, reasoning_effort: 'low', dropped: [] } })],
    });
    assert.deepEqual(b.roster[0].sentParams, { temperature: 0, reasoning_effort: 'low' });
  });

  it('omits a parameter that was never sent rather than inventing a default', () => {
    const b = buildBundle({
      ...input,
      roster: [target({ params: { dropped: ['temperature'] } })],
    });
    assert.deepEqual(b.roster[0].sentParams, {});
  });

  it('states the aggregation rules the numbers were derived under', () => {
    const b = buildBundle(input);
    assert.equal(b.rules.minSamples, 5);
    assert.match(b.rules.percentile, /nearest.rank/i);
    assert.ok(b.rules.divergenceProbeIds.length > 0);
    assert.equal(b.rules.noiseProbePair.length, 2);
  });

  it('states which failures belong to the provider and which are ours', () => {
    const { faultAttribution } = buildBundle(input).rules;
    assert.ok(faultAttribution.provider.includes('upstream'));
    assert.ok(faultAttribution.prober.includes('no_content'));
    assert.ok(faultAttribution.unknown.includes('network'));
    // Every kind must land somewhere, or a verifier cannot attribute it at all.
    const all = [...faultAttribution.provider, ...faultAttribution.prober, ...faultAttribution.unknown];
    assert.equal(new Set(all).size, ERROR_KINDS.length);
  });

  it('states the rules that would otherwise only exist in our code', () => {
    const { rules } = buildBundle(input);
    assert.equal(rules.numericExtraction, 'last');
    assert.ok(rules.refusalPattern.length > 0);
    assert.deepEqual(rules.truncationSafeComparators, ['categorical']);
  });

  it('keeps the raw results verbatim', () => {
    const b = buildBundle(input);
    assert.deepEqual(b.results, input.results);
  });
});

describe('serializeBundle', () => {
  it('round-trips to an equal bundle', () => {
    const b = buildBundle(input);
    assert.deepEqual(JSON.parse(serializeBundle(b)), JSON.parse(JSON.stringify(b)));
  });

  it('is byte-identical across two builds of the same epoch', () => {
    assert.equal(serializeBundle(buildBundle(input)), serializeBundle(buildBundle(input)));
  });
});

describe('localDigest', () => {
  it('changes when a single byte changes', () => {
    assert.notEqual(localDigest('a'), localDigest('b'));
  });

  it('is a bytes32 hex string', () => {
    assert.match(localDigest('x'), /^0x[0-9a-f]{64}$/);
  });
});
