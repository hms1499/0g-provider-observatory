import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { retryRead } from '../retry.js';

describe('retryRead', () => {
  it('returns the first answer when the read succeeds', async () => {
    let calls = 0;
    const out = await retryRead(async () => {
      calls++;
      return 'ok';
    }, { delaysMs: [0, 0] });
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
  });

  it('rides through a blip: fails, then succeeds', async () => {
    let calls = 0;
    const out = await retryRead(async () => {
      calls++;
      if (calls < 3) throw new Error('execution reverted');
      return 38;
    }, { delaysMs: [0, 0] });
    assert.equal(out, 38);
    assert.equal(calls, 3);
  });

  it('gives up and rethrows the last error, so a real failure still surfaces', async () => {
    let calls = 0;
    await assert.rejects(
      retryRead(async () => {
        calls++;
        throw new Error(`attempt ${calls}`);
      }, { delaysMs: [0, 0] }),
      /attempt 3/,
    );
    assert.equal(calls, 3);
  });

  it('makes exactly one attempt more than it has delays', async () => {
    let calls = 0;
    await assert.rejects(
      retryRead(async () => {
        calls++;
        throw new Error('no');
      }, { delaysMs: [0] }),
    );
    assert.equal(calls, 2);
  });
});
