import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { EpochRecord } from '../../src/chain/registry.js';
import { NETWORKS } from '../networks.js';
import { reproduceInBrowser } from '../reproduceEpochs.js';

const A_PATH = 'data/epochs/496539-2026-08-24T032740866Z.bundle.json';
const B_PATH = 'data/epochs/496540-2026-08-24T040551787Z.bundle.json';
const A = readFileSync(A_PATH, 'utf8');
const B = readFileSync(B_PATH, 'utf8');

const record = (epoch: number, storageRoot: string): EpochRecord => ({
  epoch,
  prober: '0x691Bb0Cc823A03f7dcaF272Dc62896668f81D2FD',
  writtenAt: new Date(0),
  storageRoot,
  measurements: [],
});

const net = { ...NETWORKS.mainnet, indexerUrl: 'https://indexer.example' };

/** Serve each bundle by the root the caller asks for, so order does not matter. */
const serve = async (url: string) => (url.includes('rootA') ? A : B);

describe('reproduceInBrowser', () => {
  it('compares two published epochs without a wallet or an API key', async () => {
    const out = await reproduceInBrowser({
      earlier: record(496539, '0xrootA'),
      later: record(496540, '0xrootB'),
      net,
      fetchBytes: serve,
    });
    assert.equal(out.state, 'ready');
    assert.equal(out.report!.compared, 10);
  });

  it('reports a gateway failure as a fetch failure, not as a disagreement', async () => {
    const out = await reproduceInBrowser({
      earlier: record(496539, '0xrootA'),
      later: record(496540, '0xrootB'),
      net,
      fetchBytes: async () => '{"code":101,"message":"File not found","data":null}',
    });
    assert.equal(out.state, 'failed');
    assert.match(out.error!, /not found/i);
  });
});
