import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertEpoch, encodeMeasurement, EpochDrift } from '../writer.js';

describe('encodeMeasurement', () => {
  it('orders the tuple as MeasurementRegistry.Measurement declares it', () => {
    assert.deepEqual(
      encodeMeasurement({
        providerId: 7,
        p50Ms: 1200,
        p95Ms: 3400,
        errorRateBps: 500,
        divergenceBps: 833,
        calls: 15,
        observedMode: 2,
      }),
      [7, 1200, 3400, 500, 833, 15, 2],
    );
  });
});

describe('EpochDrift', () => {
  it('is thrown when the chain has moved past the epoch the run measured', () => {
    assert.throws(
      () => assertEpoch(496514, 496515),
      (e: Error) => e instanceof EpochDrift && /496514/.test(e.message) && /496515/.test(e.message),
    );
  });

  it('accepts a write landing in the epoch the measurements came from', () => {
    assert.doesNotThrow(() => assertEpoch(496514, 496514));
  });
});
