import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { assertNotGatewayError, assertRootMatches, gatewayUrl, merkleRootOf, RootMismatch, UploadFailed } from '../upload.js';

const ROOT = `0x${'ab'.repeat(32)}`;

describe('gatewayUrl', () => {
  it('is a plain REST URL a verifier can curl with no SDK and no wallet', () => {
    assert.equal(
      gatewayUrl('https://indexer-storage-testnet-turbo.0g.ai', ROOT),
      `https://indexer-storage-testnet-turbo.0g.ai/file?root=${ROOT}`,
    );
  });

  it('does not double the slash when the indexer url has a trailing one', () => {
    assert.equal(
      gatewayUrl('https://indexer-storage-turbo.0g.ai/', ROOT),
      `https://indexer-storage-turbo.0g.ai/file?root=${ROOT}`,
    );
  });
});

describe('assertRootMatches', () => {
  it('accepts the indexer returning the root we computed locally', () => {
    assert.doesNotThrow(() => assertRootMatches(ROOT, ROOT.toUpperCase().replace('0X', '0x')));
  });

  it('refuses a root the indexer invented, since that root is what goes on chain', () => {
    assert.throws(() => assertRootMatches(ROOT, `0x${'cd'.repeat(32)}`), RootMismatch);
  });
});

describe('assertNotGatewayError', () => {
  it('rejects the indexer error envelope, which arrives as HTTP 200', () => {
    // Measured live: an unknown root returns 200 with this body, so res.ok is not enough.
    assert.throws(
      () => assertNotGatewayError('{"code":101,"message":"File not found","data":null}'),
      (e: Error) => e instanceof UploadFailed && /File not found/.test(e.message),
    );
  });

  it('lets a real bundle through', () => {
    assert.doesNotThrow(() => assertNotGatewayError('{"schema":"og-observatory-epoch/2"}'));
  });

  it('lets through a body that is not JSON at all', () => {
    assert.doesNotThrow(() => assertNotGatewayError('plain bytes'));
  });
});

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
