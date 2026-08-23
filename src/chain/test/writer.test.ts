import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertEpoch, encodeMeasurement, EpochDrift, transcriptRoot } from '../writer.js';

describe('transcriptRoot', () => {
  it('commits to the exact bytes of the transcript', () => {
    const a = transcriptRoot('{"probeId":"echo-exact"}\n');
    assert.match(a, /^0x[0-9a-f]{64}$/);
    assert.equal(a, transcriptRoot('{"probeId":"echo-exact"}\n'));
  });

  it('changes when a single byte of the transcript changes', () => {
    assert.notEqual(transcriptRoot('a'), transcriptRoot('b'));
  });

  it('never returns the zero root, which the contract rejects', () => {
    assert.notEqual(transcriptRoot(''), `0x${'0'.repeat(64)}`);
  });
});

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
