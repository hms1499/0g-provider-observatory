import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { observe } from '../findings.js';
import type { ModelGroup, ProviderRow } from '../rows.js';

const row = (p: Partial<ProviderRow> & { address: string }): ProviderRow => ({
  providerId: 1,
  model: 'model-one',
  mode: 'TeeTLS',
  p50Ms: 2000,
  p95Ms: 4000,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  ...p,
});

const group = (rows: ProviderRow[]): ModelGroup => ({
  model: 'model-one',
  rows,
  referenceAddress: null,
});

describe('observe', () => {
  it('says nothing rather than inventing a finding when a group is unremarkable', () => {
    const out = observe([group([row({ address: '0xA' }), row({ address: '0xB' })])]);
    assert.deepEqual(out, []);
  });

  it('reports an error rate that differs from a peer past the tolerance', () => {
    const out = observe([
      group([row({ address: '0xA', errorRateBps: 1333 }), row({ address: '0xB' })]),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'error-rate-gap');
    assert.match(out[0].text, /13\.33%/);
    assert.match(out[0].text, /0%/);
  });

  it('ignores an error rate gap inside the tolerance, which is one failed call in fifteen', () => {
    const out = observe([
      group([row({ address: '0xA', errorRateBps: 667 }), row({ address: '0xB' })]),
    ]);
    assert.deepEqual(out, []);
  });

  it('reports a p50 spread past 2x, which is outside this instrument\'s own repeatability', () => {
    const out = observe([
      group([row({ address: '0xA', p50Ms: 1000 }), row({ address: '0xB', p50Ms: 3000 })]),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'latency-spread');
    assert.match(out[0].text, /3\.0/);
  });

  it('does not report a spread a repeat run could produce on its own', () => {
    const out = observe([
      group([row({ address: '0xA', p50Ms: 2000 }), row({ address: '0xB', p50Ms: 2800 })]),
    ]);
    assert.deepEqual(out, []);
  });

  it('never compares across models, because two models are not the same measurement', () => {
    const a = group([row({ address: '0xA', p50Ms: 1000 })]);
    const b: ModelGroup = { model: 'model-two', rows: [row({ address: '0xB', p50Ms: 9000 })], referenceAddress: null };
    assert.deepEqual(observe([a, b]), []);
  });

  it('reports a service that answered fewer calls than its peers', () => {
    const out = observe([
      group([row({ address: '0xA', calls: 10 }), row({ address: '0xB', calls: 15 })]),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'short-sample');
    assert.match(out[0].text, /10 of 15/);
  });
});
