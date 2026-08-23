import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { verifyEpochInBrowser } from '../verifyEpoch.js';

const BUNDLE = readFileSync('data/epochs/496516-2026-08-23T040342956Z.bundle.json', 'utf8');
const ROOT = '0x6fa317afa4d0fd954a8584fde63e8999da5d519e35dc95d317f89f68ed4d4ca9';

/** The registry ids the bundle's services hold, recovered from the bundle itself. */
function providersFromBundle(): ProviderRecord[] {
  const b = JSON.parse(BUNDLE) as { roster: Array<{ address: string; modelId: string }> };
  return b.roster.map((s, i) => ({
    id: i + 1,
    address: s.address,
    model: s.modelId,
    modelHash: '0x0',
    declaredMode: 'TeeTLS' as const,
    registeredAt: new Date(0),
  }));
}

const epochRecord = (over: Partial<EpochRecord> = {}): EpochRecord => ({
  epoch: 496516,
  prober: '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB',
  writtenAt: new Date(0),
  storageRoot: ROOT,
  measurements: [],
  ...over,
});

describe('verifyEpochInBrowser', () => {
  it('fails when the record points at evidence the gateway does not have', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord({ storageRoot: '0xdead' }),
      providers: [],
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => '{"code":101,"message":"File not found","data":null}',
    });
    assert.equal(out.verdict, 'failed');
    assert.equal(out.steps.find((s) => s.status === 'fail')?.label.includes('evidence'), true);
  });

  it('fails when the bytes returned do not hash to the committed root', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: [],
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => `${BUNDLE} tampered`,
    });
    assert.equal(out.verdict, 'failed');
    assert.ok(out.steps.some((s) => s.status === 'fail' && /merkle/i.test(s.label)));
  });

  it('recomputes a real epoch and reaches a verdict without a wallet', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: providersFromBundle(),
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => BUNDLE,
    });
    assert.ok(out.steps.filter((s) => s.status === 'ok').length >= 3, 'early steps should pass');
    // No measurements were supplied, so nothing is checked and nothing can mismatch.
    assert.equal(out.findings.filter((f) => f.severity === 'mismatch').length, 0);
    assert.equal(out.verdict, 'verified');
  });

  it('fails the verdict when the evidence does not claim this epoch, even though fetch and merkle both pass', async () => {
    // Real bytes, real root — fetch and the merkle check both succeed. Only the epoch
    // number is wrong, so only the "claims this epoch" step should fail.
    const out = await verifyEpochInBrowser({
      epoch: epochRecord({ epoch: 1 }),
      providers: providersFromBundle(),
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => BUNDLE,
    });
    assert.equal(
      out.steps.find((s) => /claims this epoch/i.test(s.label))?.status,
      'fail',
    );
    assert.equal(out.verdict, 'failed');
  });
});
