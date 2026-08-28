import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { NETWORKS } from '../networks.js';
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
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
      fetchBytes: async () => '{"code":101,"message":"File not found","data":null}',
    });
    assert.equal(out.verdict, 'failed');
    assert.match(out.steps.find((s) => s.status === 'fail')?.label ?? '', /fetched/);
    // The bytes never arrived, so there is nothing to set against the committed root. That
    // is a comparison the panel cannot make, not one it made and lost.
    assert.equal(out.evidence?.computed, null);
    assert.equal(out.evidence?.committed, '0xdead');
  });

  it('fails when the bytes returned do not hash to the committed root', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: [],
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
      fetchBytes: async () => `${BUNDLE} tampered`,
    });
    assert.equal(out.verdict, 'failed');
    assert.ok(out.steps.some((s) => s.status === 'fail' && /hashed to the root/i.test(s.label)));
    // Both roots are carried out, because the panel sets them against each other character by
    // character and a mismatch is the case that comparison exists for.
    assert.equal(out.evidence?.committed, ROOT);
    assert.ok(out.evidence?.computed && out.evidence.computed !== ROOT);
  });

  it('recomputes a real epoch and reaches a verdict without a wallet', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: providersFromBundle(),
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
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
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
      fetchBytes: async () => BUNDLE,
    });
    const step = out.steps.find((s) => /claims this epoch/i.test(s.label));
    assert.equal(step?.status, 'fail');
    assert.match(step?.detail ?? '', /the bundle says epoch 496516, the record 1/);
    assert.doesNotMatch(step?.detail ?? '', /written by/, 'the prober matched, so it is not named');
    assert.equal(out.verdict, 'failed');
  });

  /*
   * The ledger keys a record by (epoch, prober), so a bundle for the right epoch written by
   * somebody else is a different measurement. The step used to report the epoch whatever had
   * gone wrong, which put a FAIL next to a number that agreed.
   */
  it('names the prober, not the epoch, when it is the prober that disagrees', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord({ prober: '0x1111111111111111111111111111111111111111' }),
      providers: providersFromBundle(),
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
      fetchBytes: async () => BUNDLE,
    });
    const step = out.steps.find((s) => /claims this epoch/i.test(s.label));
    assert.equal(step?.status, 'fail');
    assert.match(step?.detail ?? '', /the bundle was written by 0xaBaCa14B…34DB, the record by 0x11111111…1111/);
    assert.doesNotMatch(step?.detail ?? '', /says epoch/, 'the epoch matched, so it is not named');
    assert.equal(out.verdict, 'failed');
  });

  it('states both claims when they hold', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: providersFromBundle(),
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
      fetchBytes: async () => BUNDLE,
    });
    const step = out.steps.find((s) => /claims this epoch/i.test(s.label));
    assert.equal(step?.status, 'ok');
    assert.equal(step?.detail, 'epoch 496516, prober 0xaBaCa14B…34DB');
  });

  it('carries both roots out on a clean run, identical', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: providersFromBundle(),
      net: { ...NETWORKS.testnet, indexerUrl: 'https://indexer.example' },
      fetchBytes: async () => BUNDLE,
    });
    assert.equal(out.evidence?.committed, ROOT);
    assert.equal(out.evidence?.computed, ROOT);
  });
});
