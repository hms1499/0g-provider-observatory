import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { merkleRootOf } from '../merkle.js';

describe('merkleRootOf', () => {
  it('derives the root from bytes alone, with no filesystem', async () => {
    // The exact bundle behind epoch 496516, whose root the chain records.
    const bytes = readFileSync('data/epochs/496516-2026-08-23T040342956Z.bundle.json', 'utf8');
    assert.equal(
      await merkleRootOf(bytes),
      '0x6fa317afa4d0fd954a8584fde63e8999da5d519e35dc95d317f89f68ed4d4ca9',
    );
  });

  it('accepts a Uint8Array, which is what a browser fetch produces', async () => {
    const bytes = readFileSync('data/epochs/496516-2026-08-23T040342956Z.bundle.json');
    assert.equal(
      await merkleRootOf(new Uint8Array(bytes)),
      '0x6fa317afa4d0fd954a8584fde63e8999da5d519e35dc95d317f89f68ed4d4ca9',
    );
  });
});
