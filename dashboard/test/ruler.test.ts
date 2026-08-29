import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord, MeasurementRecord } from '../../src/chain/registry.js';
import { epochStart, gapsIn, spanLabel, tallestRun, ticksOf } from '../ruler.js';

const measurement = (providerId: number): MeasurementRecord => ({
  providerId,
  p50Ms: 1000,
  p95Ms: 2000,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeML',
});

const record = (epoch: number, services: number): EpochRecord => ({
  epoch,
  prober: '0xP',
  writtenAt: epochStart(epoch),
  storageRoot: '0xroot',
  measurements: Array.from({ length: services }, (_, i) => measurement(i)),
});

/* The ten epochs on Aristotle mainnet as of 2026-08-28, read off the chain rather than
   invented, because the two-day gap and the change of roster width are the two things this
   module exists to draw and both of them are properties of this exact series. */
const SERIES = [496539, 496540, 496591, 496592, 496609, 496610, 496615, 496616, 496620, 496636];

describe('epochStart', () => {
  it('is the epoch number times the epoch duration', () => {
    // Matches `MeasurementRegistry.epochOf`: timestamp / 3600, so 496636 is 2026-08-28 04:00.
    assert.equal(epochStart(496636).toISOString(), '2026-08-28T04:00:00.000Z');
  });
});

describe('ticksOf · position', () => {
  it('places epochs by time, so a two-day gap is a gap', () => {
    const ticks = ticksOf([496539, 496540, 496591], []);
    // 496539 -> 496591 is 52 hours; 496540 sits one hour in, at 1/52 of the axis.
    assert.equal(ticks[0].x, 0);
    assert.ok(Math.abs(ticks[1].x - 1 / 52) < 1e-9);
    assert.equal(ticks[2].x, 1);
  });

  it('does not space epochs evenly by index', () => {
    const ticks = ticksOf([496539, 496540, 496591], []);
    // The index layout the sparklines use would put the middle tick at 0.5. It is nowhere near.
    assert.ok(ticks[1].x < 0.05, `middle tick at ${ticks[1].x}, expected near the left edge`);
  });

  it('sorts an unordered published list', () => {
    // `epochsOf` returns the contract's append order, which is a fact about how the ledger
    // filled and not a promise about which number is largest.
    const ticks = ticksOf([496620, 496539, 496591], []);
    assert.deepEqual(ticks.map((t) => t.epoch), [496539, 496591, 496620]);
  });

  it('puts a lone epoch at the start of the axis, not the middle', () => {
    const ticks = ticksOf([496539], []);
    assert.equal(ticks[0].x, 0);
  });

  it('is empty when nothing has been published', () => {
    assert.deepEqual(ticksOf([], []), []);
  });
});

describe('ticksOf · width', () => {
  it('carries how many services each run measured', () => {
    const ticks = ticksOf([496615, 496616], [record(496615, 10), record(496616, 30)]);
    assert.deepEqual(ticks.map((t) => t.measured), [10, 30]);
  });

  it('reports an unread epoch as null, never as zero', () => {
    // Null is "not read yet". Zero would be "measured nothing", which is a different fact and
    // not one this chain carries.
    const ticks = ticksOf([496615, 496616], [record(496616, 30)]);
    assert.equal(ticks[0].measured, null);
    assert.equal(ticks[1].measured, 30);
  });

  it('draws every tick complete before any record arrives', () => {
    // The ruler must not grow ticks as the second phase loads.
    assert.equal(ticksOf(SERIES, []).length, SERIES.length);
  });
});

describe('tallestRun', () => {
  it('is the widest roster read so far', () => {
    const ticks = ticksOf([496615, 496616], [record(496615, 10), record(496616, 30)]);
    assert.equal(tallestRun(ticks), 30);
  });

  it('is null while no record has arrived', () => {
    assert.equal(tallestRun(ticksOf(SERIES, [])), null);
  });
});

describe('gapsIn', () => {
  it('names the two-day break in the mainnet series', () => {
    const gaps = gapsIn(ticksOf(SERIES, []));
    assert.deepEqual(gaps, [{ after: 496540, hours: 51 }]);
  });

  it('says nothing about consecutive hours', () => {
    assert.deepEqual(gapsIn(ticksOf([496539, 496540, 496541], [])), []);
  });

  it('says nothing about an overnight break', () => {
    // 496592 -> 496609 is seventeen hours, and there are two breaks that shape in this series.
    // A person running a command does not run it at 3am; naming that as a gap would annotate
    // the operator's sleep three times across ten ticks and say nothing about the network.
    assert.deepEqual(gapsIn(ticksOf([496592, 496609], [])), []);
  });
});

describe('spanLabel', () => {
  it('counts whole days once the series passes two of them', () => {
    // 496539 -> 496636 is 97 hours: four whole days covered, not 4.04.
    assert.equal(spanLabel(ticksOf(SERIES, [])), '4 days');
  });

  it('counts hours below two days', () => {
    assert.equal(spanLabel(ticksOf([496539, 496542], [])), '3 hours');
  });

  it('does not say "1 hours"', () => {
    assert.equal(spanLabel(ticksOf([496539, 496540], [])), 'one hour');
  });

  it('names a single epoch as one', () => {
    assert.equal(spanLabel(ticksOf([496539], [])), 'one epoch');
  });

  it('is empty when nothing has been published', () => {
    assert.equal(spanLabel([]), '');
  });
});
