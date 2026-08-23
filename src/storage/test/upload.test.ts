import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertRootMatches, gatewayUrl, RootMismatch } from '../upload.js';

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
