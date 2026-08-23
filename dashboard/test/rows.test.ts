import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { formatBps, formatMs, groupByOperator } from '../rows.js';

const provider = (id: number, address: string, model: string): ProviderRecord => ({
  id,
  address,
  model,
  modelHash: '0x0',
  declaredMode: 'TeeTLS',
  registeredAt: new Date(0),
});

const measurement = (providerId: number, p50Ms: number) => ({
  providerId,
  p50Ms,
  p95Ms: p50Ms * 2,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeTLS' as const,
});

const epoch = (measurements: ReturnType<typeof measurement>[]): EpochRecord => ({
  epoch: 1,
  prober: '0xP',
  writtenAt: new Date(0),
  storageRoot: '0xroot',
  measurements,
});

describe('groupByOperator', () => {
  const providers = [
    provider(1, '0xAAA', 'model-one'),
    provider(2, '0xAAA', 'model-two'),
    provider(3, '0xBBB', 'model-one'),
  ];

  it('keeps one row per model, never merging an operator into a single figure', () => {
    const groups = groupByOperator(epoch([measurement(1, 100), measurement(2, 900)]), providers);
    const aaa = groups.find((g) => g.address === '0xAAA')!;
    assert.equal(aaa.rows.length, 2);
    assert.deepEqual(aaa.rows.map((r) => r.p50Ms).sort((a, b) => a - b), [100, 900]);
  });

  it('groups by operator so one operator reads as one block', () => {
    const groups = groupByOperator(
      epoch([measurement(1, 100), measurement(2, 200), measurement(3, 300)]),
      providers,
    );
    assert.deepEqual(groups.map((g) => g.address).sort(), ['0xAAA', '0xBBB']);
  });

  it('names a registered service that this epoch did not measure, rather than hiding it', () => {
    const groups = groupByOperator(epoch([measurement(1, 100)]), providers);
    const aaa = groups.find((g) => g.address === '0xAAA')!;
    assert.deepEqual(aaa.unmeasured, ['model-two']);
  });

  it('ignores a measurement whose provider id is not registered', () => {
    const groups = groupByOperator(epoch([measurement(99, 100)]), providers);
    assert.deepEqual(groups.flatMap((g) => g.rows), []);
  });

  it('still shows an operator that this epoch measured nothing for, as a full gap rather than dropping it', () => {
    const groups = groupByOperator(epoch([]), providers);
    const aaa = groups.find((g) => g.address === '0xAAA')!;
    assert.ok(aaa, 'operator 0xAAA must still appear even with zero measured rows');
    assert.deepEqual(aaa.rows, []);
    assert.deepEqual(aaa.unmeasured, ['model-one', 'model-two']);
  });

  it('shows both a fully measured and a fully unmeasured operator in the same epoch', () => {
    const groups = groupByOperator(epoch([measurement(3, 300)]), providers);
    const aaa = groups.find((g) => g.address === '0xAAA')!;
    const bbb = groups.find((g) => g.address === '0xBBB')!;
    assert.deepEqual(aaa.rows, []);
    assert.deepEqual(aaa.unmeasured, ['model-one', 'model-two']);
    assert.equal(bbb.rows.length, 1);
    assert.deepEqual(bbb.unmeasured, []);
  });
});

describe('formatting', () => {
  it('renders basis points as a percentage a reader can scan', () => {
    assert.equal(formatBps(0), '0%');
    assert.equal(formatBps(833), '8.33%');
    assert.equal(formatBps(10000), '100%');
  });

  it('renders milliseconds without inventing precision', () => {
    assert.equal(formatMs(0), '—');
    assert.equal(formatMs(847), '847 ms');
    assert.equal(formatMs(12480), '12.5 s');
  });
});
