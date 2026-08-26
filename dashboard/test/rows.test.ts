import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { formatBps, formatSeconds, groupByModel, groupByOperator, ratioPosition, serviceLabel } from '../rows.js';
import { DIVERGENCE_UNMEASURED } from '../../src/chain/encoding.js';

const provider = (id: number, address: string, model: string): ProviderRecord => ({
  id,
  address,
  model,
  modelHash: '0x0',
  declaredMode: 'TeeTLS',
  registeredAt: new Date(0),
});

const measurement = (providerId: number, p50Ms: number): EpochRecord['measurements'][number] => ({
  providerId,
  p50Ms,
  p95Ms: p50Ms * 2,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeTLS',
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

  it('shows an unmeasured divergence as a gap, never as a rate', () => {
    // The sentinel is 65535, and 655.35% would read as a measurement of a named operator.
    assert.equal(formatBps(DIVERGENCE_UNMEASURED), '—');
  });

  it('renders milliseconds without inventing precision', () => {
    assert.equal(formatSeconds(0), '—');
    // One unit and one precision down the whole column: 847 ms next to 43.3 s cannot be
    // compared by eye, and comparing them is the only reason the column exists.
    assert.equal(formatSeconds(847), '0.85');
    assert.equal(formatSeconds(5010), '5.01');
    assert.equal(formatSeconds(43300), '43.30');
  });
});

describe('groupByModel', () => {
  const providers = [
    provider(1, '0xAAA', 'model-one'),
    provider(2, '0xAAA', 'model-two'),
    provider(3, '0xBBB', 'model-one'),
    provider(4, '0xCCC', 'model-lonely'),
  ];

  it('puts every provider of one model side by side, which is what divergence compares', () => {
    const groups = groupByModel(
      epoch([measurement(1, 100), measurement(2, 900), measurement(3, 200)]),
      providers,
    );
    const one = groups.find((g) => g.model === 'model-one')!;
    assert.deepEqual(
      one.rows.map((r) => r.address).sort(),
      ['0xAAA', '0xBBB'],
    );
  });

  it('never merges the providers of a model into a single figure', () => {
    const groups = groupByModel(epoch([measurement(1, 100), measurement(3, 200)]), providers);
    const one = groups.find((g) => g.model === 'model-one')!;
    assert.deepEqual(one.rows.map((r) => r.p50Ms).sort((a, b) => a - b), [100, 200]);
  });

  it('names the TeeML service as the reference the others were measured against', () => {
    const withReference = [
      { ...measurement(1, 100), observedMode: 'TeeML' as const },
      measurement(3, 200),
    ];
    const groups = groupByModel(epoch(withReference), providers);
    const one = groups.find((g) => g.model === 'model-one')!;
    assert.equal(one.referenceAddress, '0xAAA');
  });

  it('leaves referenceAddress null when no peer runs in an enclave', () => {
    const groups = groupByModel(epoch([measurement(1, 100), measurement(3, 200)]), providers);
    assert.equal(groups.find((g) => g.model === 'model-one')!.referenceAddress, null);
  });

  it('keeps a model served by one provider, rather than hiding what has no peer', () => {
    const groups = groupByModel(epoch([measurement(4, 100)]), providers);
    assert.equal(groups.find((g) => g.model === 'model-lonely')!.rows.length, 1);
  });

  it('reports a registered service this epoch never measured, against its operator', () => {
    const groups = groupByModel(epoch([measurement(1, 100)]), providers);
    const two = groups.find((g) => g.model === 'model-two');
    assert.equal(two, undefined, 'a model with no measurement is not a group');
    const missing = groupByModel(epoch([measurement(1, 100)]), providers);
    assert.deepEqual(
      missing.flatMap((g) => g.rows).map((r) => r.model),
      ['model-one'],
    );
  });

  it('orders the widest groups first, so the comparisons come before the singletons', () => {
    const groups = groupByModel(
      epoch([measurement(1, 100), measurement(3, 200), measurement(4, 300)]),
      providers,
    );
    assert.deepEqual(groups.map((g) => g.model), ['model-one', 'model-lonely']);
  });
});

describe('ratioPosition', () => {
  it('puts parity in the middle, because parity is the thing being looked for', () => {
    assert.equal(ratioPosition(1), 0.5);
  });

  it('places half and double the same distance either side', () => {
    const half = ratioPosition(0.5)!;
    const double = ratioPosition(2)!;
    assert.ok(Math.abs(0.5 - half - (double - 0.5)) < 1e-9);
  });

  it('pins an outlier to the edge rather than rescaling everything else', () => {
    assert.equal(ratioPosition(400), 1);
    assert.equal(ratioPosition(0.0001), 0);
  });

  it('cannot place a ratio against a published zero', () => {
    assert.equal(ratioPosition(0), null);
  });
});

describe('serviceLabel', () => {
  it('shortens the address and keeps the model, which is what the eye is looking for', () => {
    assert.equal(
      serviceLabel('0xF203A388e9E70F09ece38046a6D40a89cf896309 glm-5.2'),
      '0xF203A388…6309 glm-5.2',
    );
  });

  it('leaves a label that is not an address alone rather than truncating it', () => {
    assert.equal(serviceLabel('some other shape'), 'some other shape');
  });
});
