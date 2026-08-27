import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DIVERGENCE_UNMEASURED } from '../../chain/encoding.js';
import { select, summarise, type Sample, type ServiceHistory } from '../select.js';

const sample = (epoch: number, over: Partial<Sample> = {}): Sample => ({
  epoch,
  writtenAt: new Date(epoch * 3_600_000),
  p50Ms: 2000,
  p95Ms: 5000,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeTLS',
  ...over,
});

const service = (
  address: string,
  model: string,
  samples: Sample[],
): ServiceHistory => ({ address, model, samples });

const NOW = new Date(10 * 3_600_000);

describe('summarise', () => {
  it('takes the WORST epoch p95, not the average of them', () => {
    // At 15 probes an epoch's p95 is its slowest call, so averaging five of them produces a
    // number no call ever took. A caller asking not to be surprised wants the maximum.
    const c = summarise(
      service('0xA', 'm', [
        sample(1, { p95Ms: 4000 }),
        sample(2, { p95Ms: 43000 }),
        sample(3, { p95Ms: 4000 }),
      ]),
    );
    assert.equal(c?.p95Ms, 43000);
  });

  it('takes the median of the epoch p50s, so one bad epoch cannot drag it', () => {
    const c = summarise(
      service('0xA', 'm', [
        sample(1, { p50Ms: 2000 }),
        sample(2, { p50Ms: 2100 }),
        sample(3, { p50Ms: 30000 }),
      ]),
    );
    assert.equal(c?.p50Ms, 2100);
  });

  it('pools the error rate by calls rather than averaging the rates', () => {
    // 1 failure in 3 calls, then 0 in 15. Averaging the rates gives 1667bps; the truth is
    // one failure in eighteen calls, 556bps.
    const c = summarise(
      service('0xA', 'm', [
        sample(1, { errorRateBps: 3333, calls: 3 }),
        sample(2, { errorRateBps: 0, calls: 15 }),
      ]),
    );
    assert.equal(c?.errorRateBps, 556);
    assert.equal(c?.calls, 18);
  });

  it('counts divergence epochs instead of averaging a figure that cannot be pooled', () => {
    const c = summarise(
      service('0xA', 'm', [
        sample(1, { divergenceBps: 0 }),
        sample(2, { divergenceBps: 2000 }),
        sample(3, { divergenceBps: DIVERGENCE_UNMEASURED }),
      ]),
    );
    assert.equal(c?.divergenceMeasuredIn, 2);
    assert.equal(c?.divergedIn, 1);
  });

  it('reports the newest mode and flags that it changed', () => {
    const c = summarise(
      service('0xA', 'm', [
        sample(1, { observedMode: 'TeeTLS' }),
        sample(2, { observedMode: 'TeeML' }),
      ]),
    );
    assert.equal(c?.mode, 'TeeML');
    assert.equal(c?.modeChanged, true);
  });

  it('reads the newest epoch whatever order the samples arrive in', () => {
    const c = summarise(service('0xA', 'm', [sample(3), sample(1), sample(2)]));
    assert.equal(c?.newestEpoch, 3);
    assert.equal(c?.epochsUsed, 3);
  });

  it('returns null for a service with no readings rather than a zero-filled one', () => {
    assert.equal(summarise(service('0xA', 'm', [])), null);
  });
});

describe('select', () => {
  it('returns the best on the stated axis and every other match behind it', () => {
    const s = select(
      [
        service('0xA', 'm', [sample(1, { p50Ms: 3000 })]),
        service('0xB', 'm', [sample(1, { p50Ms: 1000 })]),
      ],
      { model: 'm' },
      NOW,
    );
    assert.equal(s.best?.address, '0xB');
    assert.equal(s.matches.length, 2);
    assert.equal(s.orderedBy, 'p50');
  });

  it('orders by whichever field the caller named, never by a blend of them', () => {
    const services = [
      service('0xA', 'm', [sample(1, { p50Ms: 1000, p95Ms: 40000 })]),
      service('0xB', 'm', [sample(1, { p50Ms: 3000, p95Ms: 4000 })]),
    ];
    assert.equal(select(services, { model: 'm', orderBy: 'p50' }, NOW).best?.address, '0xA');
    assert.equal(select(services, { model: 'm', orderBy: 'p95' }, NOW).best?.address, '0xB');
  });

  it('breaks a tie on address, so the same input always gives the same answer', () => {
    const s = select(
      [
        service('0xB', 'm', [sample(1, { p50Ms: 2000 })]),
        service('0xA', 'm', [sample(1, { p50Ms: 2000 })]),
      ],
      { model: 'm' },
      NOW,
    );
    assert.equal(s.best?.address, '0xA');
  });

  it('never relaxes a mode requirement to fill an empty result', () => {
    const s = select(
      [service('0xA', 'm', [sample(1, { observedMode: 'TeeTLS' })])],
      { model: 'm', mode: 'TeeML' },
      NOW,
    );
    assert.equal(s.best, null, 'a weaker guarantee is not a match');
    assert.equal(s.matches.length, 0);
    assert.match(s.rejected[0].reason, /mode is TeeTLS, TeeML required/);
  });

  it('distinguishes "nobody serves this model" from "nobody met the criteria"', () => {
    const services = [service('0xA', 'm', [sample(1, { p50Ms: 9000 })])];
    const noModel = select(services, { model: 'other' }, NOW);
    assert.equal(noModel.consideredCount, 0);

    const tooSlow = select(services, { model: 'm', maxP50Ms: 1000 }, NOW);
    assert.equal(tooSlow.consideredCount, 1);
    assert.equal(tooSlow.best, null);
  });

  it('filters p95 on the worst epoch, so one slow epoch disqualifies', () => {
    const s = select(
      [service('0xA', 'm', [sample(1, { p95Ms: 4000 }), sample(2, { p95Ms: 43000 })])],
      { model: 'm', maxP95Ms: 5000 },
      NOW,
    );
    assert.equal(s.best, null);
    assert.match(s.rejected[0].reason, /worst-epoch p95 43000ms/);
  });

  it('rejects a service measured in too few epochs', () => {
    const s = select(
      [service('0xA', 'm', [sample(1)])],
      { model: 'm', minEpochs: 3 },
      NOW,
    );
    assert.match(s.rejected[0].reason, /measured in 1 epoch\(s\), 3 required/);
  });

  it('rejects a stale reading rather than presenting it as current', () => {
    const s = select(
      [service('0xA', 'm', [sample(1)])],
      { model: 'm', maxAgeMs: 2 * 3_600_000 },
      NOW,
    );
    assert.equal(s.best, null);
    assert.match(s.rejected[0].reason, /9h old/);
  });

  it('requireNoDivergence refuses a service that ever diverged', () => {
    const s = select(
      [service('0xA', 'm', [sample(1, { divergenceBps: 0 }), sample(2, { divergenceBps: 2000 })])],
      { model: 'm', requireNoDivergence: true },
      NOW,
    );
    assert.match(s.rejected[0].reason, /diverged from its peers in 1 of 2 epochs/);
  });

  it('requireNoDivergence refuses a service it was never measurable for', () => {
    // A dash is not a zero. Treating "could not measure" as "did not diverge" would hand back
    // a guarantee nobody established.
    const s = select(
      [service('0xA', 'm', [sample(1, { divergenceBps: DIVERGENCE_UNMEASURED })])],
      { model: 'm', requireNoDivergence: true },
      NOW,
    );
    assert.equal(s.best, null);
    assert.match(s.rejected[0].reason, /never measurable/);
  });

  it('keeps two models of one operator apart', () => {
    const s = select(
      [
        service('0xA', 'glm-5.2', [sample(1, { p50Ms: 2000 })]),
        service('0xA', 'qwen3.7-plus', [sample(1, { p50Ms: 9000 })]),
      ],
      { model: 'glm-5.2' },
      NOW,
    );
    assert.equal(s.consideredCount, 1);
    assert.equal(s.best?.p50Ms, 2000);
  });

  it('carries the evidence for the choice on the result', () => {
    const s = select(
      [service('0xA', 'm', [sample(1), sample(2), sample(3)])],
      { model: 'm' },
      NOW,
    );
    assert.equal(s.best?.epochsUsed, 3);
    assert.equal(s.best?.newestEpoch, 3);
    assert.equal(s.best?.calls, 45);
    assert.ok(s.best?.measuredAt instanceof Date);
  });
});
