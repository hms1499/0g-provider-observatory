import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertDeploymentChain, pickLatestSnapshot, WrongChain } from '../paths.js';

describe('pickLatestSnapshot', () => {
  it('takes the newest snapshot by date, not the first on disk', () => {
    const files = ['snapshot-2026-08-21.json', 'snapshot-2026-08-24.json', 'snapshot-2026-08-02.json'];
    assert.equal(pickLatestSnapshot(files), 'data/snapshot-2026-08-24.json');
  });

  it('ignores files that are not snapshots', () => {
    const files = ['epochs', 'raw', 'snapshot-2026-08-21.json', 'notes.md'];
    assert.equal(pickLatestSnapshot(files), 'data/snapshot-2026-08-21.json');
  });

  it('returns null when there is no snapshot to use', () => {
    assert.equal(pickLatestSnapshot(['epochs', 'raw']), null);
  });
});

describe('assertDeploymentChain', () => {
  it('refuses a deployment file from a different chain than the run is on', () => {
    // The ledger is write-once. Measurements filed against the wrong registry cannot be
    // withdrawn, and nothing else in the runner would have noticed.
    assert.throws(
      () => assertDeploymentChain({ chainId: 16602 }, 16661, 'deployments/galileo-16602.json'),
      WrongChain,
    );
  });

  it('accepts a deployment file for the chain being written to', () => {
    assert.doesNotThrow(() => assertDeploymentChain({ chainId: 16661 }, 16661, 'x.json'));
  });

  it('refuses a deployment file that does not state a chain at all', () => {
    assert.throws(() => assertDeploymentChain({}, 16661, 'x.json'), WrongChain);
  });
});
