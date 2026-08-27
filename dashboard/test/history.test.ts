import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord } from '../../src/chain/registry.js';
import { measuredCount, seriesFor, seriesScale, sparkSegments } from '../history.js';

const measurement = (providerId: number, p50Ms: number): EpochRecord['measurements'][number] => ({
  providerId,
  p50Ms,
  p95Ms: p50Ms * 2,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeTLS',
});

const epoch = (n: number, measurements: ReturnType<typeof measurement>[]): EpochRecord => ({
  epoch: n,
  prober: '0xP',
  writtenAt: new Date(n * 3600_000),
  storageRoot: '0xroot',
  measurements,
});

describe('seriesFor', () => {
  it('returns one point per epoch, in chronological order, whatever order they arrive in', () => {
    const records = [
      epoch(3, [measurement(1, 3000)]),
      epoch(1, [measurement(1, 1000)]),
      epoch(2, [measurement(1, 2000)]),
    ];
    assert.deepEqual(seriesFor(1, records), [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: 2000 },
      { epoch: 3, p50Ms: 3000 },
    ]);
  });

  it('reports an epoch that did not measure the service as a gap, never as zero', () => {
    const records = [epoch(1, [measurement(1, 1000)]), epoch(2, [measurement(9, 5000)])];
    assert.deepEqual(seriesFor(1, records), [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: null },
    ]);
  });

  it('treats a published zero as a gap too, since zero milliseconds is not a reading', () => {
    const records = [epoch(1, [measurement(1, 0)])];
    assert.deepEqual(seriesFor(1, records), [{ epoch: 1, p50Ms: null }]);
  });

  it('keeps the empty epochs in the series, so the spacing is the spacing of the ledger', () => {
    const records = [
      epoch(1, [measurement(1, 1000)]),
      epoch(2, []),
      epoch(3, []),
      epoch(4, [measurement(1, 1000)]),
    ];
    assert.equal(seriesFor(1, records).length, 4);
    assert.equal(measuredCount(seriesFor(1, records)), 2);
  });
});

describe('sparkSegments', () => {
  it('breaks the line at a gap rather than joining across it', () => {
    const series = [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: null },
      { epoch: 3, p50Ms: 1000 },
    ];
    const segments = sparkSegments(series, 1000, 4000, 90, 18);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].points.length, 1);
    assert.equal(segments[1].points.length, 1);
  });

  it('keeps one unbroken run in one segment', () => {
    const series = [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: 2000 },
      { epoch: 3, p50Ms: 4000 },
    ];
    const segments = sparkSegments(series, 1000, 4000, 90, 18);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].points.length, 3);
  });

  it('spaces points by position in the series, so a gap still occupies its slot', () => {
    const series = [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: null },
      { epoch: 3, p50Ms: 1000 },
    ];
    const segments = sparkSegments(series, 1000, 4000, 90, 18);
    assert.equal(segments[0].points[0].x, 0);
    assert.equal(segments[1].points[0].x, 90);
  });

  it('puts the lowest reading at the floor and the highest at the ceiling', () => {
    const series = [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: 4000 },
    ];
    const [a, b] = sparkSegments(series, 1000, 4000, 90, 18)[0].points;
    assert.equal(a.y, 18);
    assert.equal(b.y, 0);
  });

  it('sits a flat series in the middle instead of dividing by a zero span', () => {
    const series = [
      { epoch: 1, p50Ms: 2000 },
      { epoch: 2, p50Ms: 2000 },
    ];
    const points = sparkSegments(series, 2000, 2000, 90, 18)[0].points;
    assert.deepEqual(points.map((p) => p.y), [9, 9]);
  });

  it('draws nothing from a series too short to carry a line', () => {
    assert.deepEqual(sparkSegments([{ epoch: 1, p50Ms: 1000 }], 1000, 4000, 90, 18), []);
  });

  it('draws nothing when the scale is unusable', () => {
    const series = [
      { epoch: 1, p50Ms: 1000 },
      { epoch: 2, p50Ms: 2000 },
    ];
    assert.deepEqual(sparkSegments(series, 0, 0, 90, 18), []);
  });
});

describe('seriesScale', () => {
  it('spans the lowest and highest reading across every series, so one scale serves all', () => {
    const a = [
      { epoch: 1, p50Ms: 2200 },
      { epoch: 2, p50Ms: 2300 },
    ];
    const b = [
      { epoch: 1, p50Ms: 900 },
      { epoch: 2, p50Ms: 40000 },
    ];
    assert.deepEqual(seriesScale([a, b]), [900, 40000]);
  });

  it('ignores gaps when deciding the scale', () => {
    const a = [
      { epoch: 1, p50Ms: null },
      { epoch: 2, p50Ms: 1500 },
    ];
    assert.deepEqual(seriesScale([a]), [1500, 1500]);
  });

  it('returns an unusable scale when nothing was measured, rather than inventing one', () => {
    assert.deepEqual(seriesScale([[{ epoch: 1, p50Ms: null }]]), [0, 0]);
  });
});
