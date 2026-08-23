import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { compareToChain, type ChainRow, type ProviderLookup } from '../check.js';
import type { RecomputedService } from '../recompute.js';

const lookup: ProviderLookup = {
  6: { address: '0xA', model: 'm-one' },
  9: { address: '0xB', model: 'm-two' },
};

function recomputed(over: Partial<RecomputedService> = {}): RecomputedService {
  return {
    address: '0xA', modelId: 'm-one', canonicalId: 'm', mode: 'TeeTLS',
    p50Ms: 100, p95Ms: 200, errorRateBps: 0, divergenceBps: 0,
    rawDivergenceBps: 0, noiseFloorBps: 0,
    calls: 15, successes: 15, providerFailures: 0, proberFaults: 0,
    unknownFaults: 0, unlistedFaults: 0,
    comparedProbes: 12, differingProbeIds: [], method: 'symmetric-pair', sufficient: true,
    ...over,
  };
}

const chainRow = (over: Partial<ChainRow> = {}): ChainRow => ({
  providerId: 6, p50Ms: 100, p95Ms: 200, errorRateBps: 0, divergenceBps: 0, calls: 15,
  observedMode: 'TeeTLS', ...over,
});

describe('compareToChain', () => {
  it('reports nothing when every published number is reproducible', () => {
    const { findings, checked } = compareToChain([chainRow()], [recomputed()], lookup);
    assert.deepEqual(findings, []);
    assert.equal(checked, 1);
  });

  it('names the field, the published value and the recomputed one', () => {
    const { findings } = compareToChain([chainRow({ p95Ms: 999 })], [recomputed()], lookup);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].field, 'p95Ms');
    assert.equal(findings[0].onChain, 999);
    assert.equal(findings[0].recomputed, 200);
    assert.equal(findings[0].severity, 'mismatch');
  });

  it('flags a published row whose provider id is not in the registry', () => {
    const { findings } = compareToChain([chainRow({ providerId: 77 })], [recomputed()], lookup);
    assert.equal(findings[0].severity, 'unknown-provider');
  });

  it('flags a published row the evidence does not account for', () => {
    const { findings } = compareToChain([chainRow({ providerId: 9 })], [recomputed()], lookup);
    assert.equal(findings[0].severity, 'unsupported');
  });

  it('flags evidence for a service that was never published, without calling it an error', () => {
    const extra = recomputed({ address: '0xB', modelId: 'm-two' });
    const { findings } = compareToChain([chainRow()], [recomputed(), extra], lookup);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'unpublished');
  });

  it('does not call an insufficient service unpublished — it is meant to be absent', () => {
    const thin = recomputed({ address: '0xB', modelId: 'm-two', sufficient: false });
    const { findings } = compareToChain([chainRow()], [recomputed(), thin], lookup);
    assert.deepEqual(findings, []);
  });
});
