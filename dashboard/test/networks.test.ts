import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bundleUrl, explorerTx, NETWORKS } from '../networks.js';

describe('NETWORKS', () => {
  it('names both chains by their real ids', () => {
    assert.equal(NETWORKS.testnet.chainId, 16602);
    assert.equal(NETWORKS.mainnet.chainId, 16661);
  });

  it('carries the deployed testnet contracts', () => {
    assert.equal(
      NETWORKS.testnet.measurementRegistry,
      '0x9bdeC5D5749270cf20DDa5d541770839E083CAc6',
    );
  });

  it('uses a different storage indexer per network, since they are not interchangeable', () => {
    assert.notEqual(NETWORKS.testnet.indexerUrl, NETWORKS.mainnet.indexerUrl);
  });
});

describe('source links', () => {
  it('links a measurement to the transaction that published it', () => {
    assert.equal(
      explorerTx(NETWORKS.testnet, '0xabc'),
      'https://chainscan-galileo.0g.ai/tx/0xabc',
    );
  });

  it('links a record to the evidence it rests on', () => {
    assert.equal(
      bundleUrl(NETWORKS.testnet, '0xdef'),
      'https://indexer-storage-testnet-turbo.0g.ai/file?root=0xdef',
    );
  });
});
