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

  it('stops pulling new items once one has rejected, instead of orphaning workers', async () => {
    // item 0 rejects instantly on worker A. Item 1 is already in flight on worker B
    // when that happens, so it still runs — that is unavoidable and fine. Items 2
    // and 3 have not started yet: a correct implementation must never reach them,
    // because worker B should stop instead of looping past the failure to grab them.
    const fired: number[] = [];
    await assert.rejects(
      mapWithConcurrency([1, 2, 3, 4], 2, async (v, i) => {
        if (i === 0) throw new Error('boom');
        await new Promise((r) => setTimeout(r, 30));
        fired.push(v);
        return v;
      }),
      /boom/,
    );
    // Give a wrongly-still-looping worker B enough time to reach items 2 and 3
    // before asserting they were never touched.
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(fired, [2]);
  });
});
