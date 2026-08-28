import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { censusOf } from '../census.js';
import { groupByModel } from '../rows.js';

const provider = (id: number, address: string, model: string | null): ProviderRecord => ({
  id,
  address,
  model,
  modelHash: '0x0',
  declaredMode: 'TeeTLS',
  registeredAt: new Date(0),
});

const measurement = (providerId: number, calls = 15): EpochRecord['measurements'][number] => ({
  providerId,
  p50Ms: 1000,
  p95Ms: 2000,
  errorRateBps: 0,
  divergenceBps: 0,
  calls,
  observedMode: 'TeeTLS',
});

const epoch = (measurements: ReturnType<typeof measurement>[]): EpochRecord => ({
  epoch: 1,
  prober: '0xP',
  writtenAt: new Date(0),
  storageRoot: '0xroot',
  measurements,
});

const census = (providers: ProviderRecord[], e: EpochRecord) =>
  censusOf(groupByModel(e, providers), providers);

describe('censusOf', () => {
  it('splits the models into those with a peer and those without', () => {
    const providers = [
      provider(1, '0xA', 'shared'),
      provider(2, '0xB', 'shared'),
      provider(3, '0xC', 'alone'),
    ];
    const c = census(providers, epoch([measurement(1), measurement(2), measurement(3)]));
    assert.equal(c.models, 2);
    assert.equal(c.comparable, 1);
    assert.equal(c.lone, 1);
    assert.equal(c.measured, 3);
  });

  it('counts every registered service, measured or not', () => {
    const providers = [provider(1, '0xA', 'm'), provider(2, '0xB', 'm')];
    const c = census(providers, epoch([measurement(1)]));
    assert.equal(c.registered, 2);
    assert.equal(c.measured, 1);
    // One provider answered, so its model is lone this epoch even though two are registered
    // for it. The census reports what was measured, not what was hoped for.
    assert.equal(c.comparable, 0);
    assert.equal(c.lone, 1);
  });

  it('leaves a provider with no model out of the registered count', () => {
    const providers = [provider(1, '0xA', 'm'), provider(2, '0xB', null)];
    assert.equal(census(providers, epoch([measurement(1)])).registered, 1);
  });

  it('totals the calls across every service measured', () => {
    const providers = [provider(1, '0xA', 'm'), provider(2, '0xB', 'm')];
    const c = census(providers, epoch([measurement(1, 15), measurement(2, 14)]));
    assert.equal(c.calls, 29);
  });

  /*
   * The count in the lede and the rows in the tables are drawn from the same groups, so they
   * cannot disagree. They used to come from two sources: `epoch.measurements.length` above a
   * table built by joining those measurements to the registry, which agree until a measurement
   * names a provider the registry does not resolve.
   */
  it('counts what the tables draw, not what the record holds', () => {
    const providers = [provider(1, '0xA', 'm')];
    const e = epoch([measurement(1), measurement(99)]);
    const groups = groupByModel(e, providers);
    const c = censusOf(groups, providers);
    assert.equal(e.measurements.length, 2, 'the record holds two');
    assert.equal(c.measured, 1, 'and one of them resolves to a registered service');
    assert.equal(
      c.measured,
      groups.reduce((n, g) => n + g.rows.length, 0),
    );
  });

  it('is all zeros for an epoch with nothing this page can name', () => {
    const c = census([], epoch([]));
    assert.deepEqual(c, {
      measured: 0,
      registered: 0,
      models: 0,
      comparable: 0,
      lone: 0,
      calls: 0,
    });
  });
});
