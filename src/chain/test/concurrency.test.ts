import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mapWithConcurrency } from '../concurrency.js';

describe('mapWithConcurrency', () => {
  it('returns results in input order, not completion order', async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    assert.deepEqual(out, [30, 10, 20]);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return null;
    });
    assert.equal(peak, 4);
  });

  it('passes the index, so a caller can map back to ids', async () => {
    assert.deepEqual(
      await mapWithConcurrency(['a', 'b'], 2, async (v, i) => `${i}:${v}`),
      ['0:a', '1:b'],
    );
  });

  it('rejects if any task rejects', async () => {
    await assert.rejects(
      mapWithConcurrency([1, 2], 2, async (v) => {
        if (v === 2) throw new Error('boom');
        return v;
      }),
      /boom/,
    );
  });

  it('handles an empty list without hanging', async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  });
});
