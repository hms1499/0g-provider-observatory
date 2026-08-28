import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { compareRuns, reproduce, type ComparableService } from '../reproduce.js';
import type { RecomputedService, VerifiableBundle } from '../recompute.js';

function measured(over: Partial<RecomputedService> = {}): RecomputedService {
  return {
    address: '0xA', modelId: 'm-one', canonicalId: 'm', mode: 'TeeTLS',
    p50Ms: 100, p95Ms: 200, errorRateBps: 0, divergenceBps: 0,
    rawDivergenceBps: 0, noiseFloorBps: 0,
    calls: 15, successes: 15, providerFailures: 0, proberFaults: 0,
    unknownFaults: 0, unlistedFaults: 0,
    comparedProbes: 12, differingProbeIds: [], method: 'symmetric-pair', sufficient: true,
    ...over,
  };
}

describe('compareRuns', () => {
  it('reports no disagreement when two runs reach the same conclusions', () => {
    const report = compareRuns({ services: [measured()] }, { services: [measured()] });
    assert.deepEqual(report.disagreements, []);
    assert.equal(report.compared, 1);
  });
});

describe('compareRuns · observed mode', () => {
  it('flags a service the two runs saw in different modes', () => {
    const report = compareRuns(
      { services: [measured({ mode: 'TeeML' })] },
      { services: [measured({ mode: 'TeeTLS' })] },
    );
    assert.equal(report.disagreements.length, 1);
    assert.equal(report.disagreements[0].kind, 'mode');
    assert.equal(report.disagreements[0].service, '0xA m-one');
    assert.equal(report.disagreements[0].published, 'TeeML');
    assert.equal(report.disagreements[0].independent, 'TeeTLS');
  });
});

describe('compareRuns · divergence', () => {
  const UNMEASURED = 0xffff;

  it('flags a service one run could measure and the other withheld', () => {
    const report = compareRuns(
      { services: [measured({ divergenceBps: UNMEASURED })], unmeasured: UNMEASURED },
      { services: [measured({ divergenceBps: 900 })], unmeasured: UNMEASURED },
    );
    assert.equal(report.disagreements.length, 1);
    assert.equal(report.disagreements[0].kind, 'divergence-measurability');
  });

  it('does not flag a service both runs withheld', () => {
    const withheld = { services: [measured({ divergenceBps: UNMEASURED })], unmeasured: UNMEASURED };
    assert.deepEqual(compareRuns(withheld, withheld).disagreements, []);
  });

  it('flags a service one run found diverging and the other found matching', () => {
    const report = compareRuns(
      { services: [measured({ divergenceBps: 0 })], unmeasured: UNMEASURED },
      { services: [measured({ divergenceBps: 900 })], unmeasured: UNMEASURED },
    );
    assert.equal(report.disagreements.length, 1);
    assert.equal(report.disagreements[0].kind, 'divergence-verdict');
  });

  it('does not flag two runs that both found divergence, at different sizes', () => {
    const report = compareRuns(
      { services: [measured({ divergenceBps: 400 })], unmeasured: UNMEASURED },
      { services: [measured({ divergenceBps: 1900 })], unmeasured: UNMEASURED },
    );
    assert.deepEqual(report.disagreements, []);
  });
});

describe('compareRuns · error rate', () => {
  it('flags two runs whose error rates are more than 10 points apart', () => {
    const report = compareRuns(
      { services: [measured({ errorRateBps: 0 })] },
      { services: [measured({ errorRateBps: 2000 })] },
    );
    assert.equal(report.disagreements.length, 1);
    assert.equal(report.disagreements[0].kind, 'error-rate');
  });

  it('tolerates a gap one failed call out of fifteen could explain', () => {
    const report = compareRuns(
      { services: [measured({ errorRateBps: 0 })] },
      { services: [measured({ errorRateBps: 667 })] },
    );
    assert.deepEqual(report.disagreements, []);
  });
});

describe('compareRuns · services that do not line up', () => {
  const other = measured({ address: '0xB', modelId: 'm-two' });

  it('lists a service only the published run measured, without calling it an error', () => {
    const report = compareRuns(
      { services: [measured(), other] },
      { services: [measured()] },
    );
    assert.deepEqual(report.disagreements, []);
    assert.deepEqual(report.onlyPublished, ['0xB m-two']);
    assert.deepEqual(report.onlyIndependent, []);
    assert.equal(report.compared, 1);
  });

  it('lists a service only the independent run measured', () => {
    const report = compareRuns(
      { services: [measured()] },
      { services: [measured(), other] },
    );
    assert.deepEqual(report.onlyIndependent, ['0xB m-two']);
  });
});

describe('compareRuns · latency', () => {
  it('reports a ratio per service and never a disagreement', () => {
    const report = compareRuns(
      { services: [measured({ p50Ms: 100, p95Ms: 200 })] },
      { services: [measured({ p50Ms: 250, p95Ms: 300 })] },
    );
    assert.deepEqual(report.disagreements, []);
    assert.equal(report.latency.length, 1);
    assert.equal(report.latency[0].service, '0xA m-one');
    assert.equal(report.latency[0].p50Ratio, 2.5);
    assert.equal(report.latency[0].p95Ratio, 1.5);
  });

  /*
   * A service that answered no call has no median, and the ledger stores no zero-filled
   * placeholder for it. This used to report 0, which the dashboard printed as `0.00x` beside
   * a named operator — twelve rows of it in the 496616/496620 comparison, every one reading
   * as a service that had become infinitely fast.
   */
  it('has no ratio where the later run published no figure', () => {
    const report = compareRuns(
      { services: [measured({ p50Ms: 100, p95Ms: 200 })] },
      { services: [measured({ p50Ms: 0, p95Ms: 0 })] },
    );
    assert.equal(report.latency[0].p50Ratio, null);
    assert.equal(report.latency[0].p95Ratio, null);
  });

  it('has no ratio where the earlier run published no figure', () => {
    const report = compareRuns(
      { services: [measured({ p50Ms: 0, p95Ms: 0 })] },
      { services: [measured({ p50Ms: 100, p95Ms: 200 })] },
    );
    assert.equal(report.latency[0].p50Ratio, null);
    assert.equal(report.latency[0].p95Ratio, null);
  });

  it('still takes a ratio per field, so one missing figure does not withhold the other', () => {
    const report = compareRuns(
      { services: [measured({ p50Ms: 100, p95Ms: 200 })] },
      { services: [measured({ p50Ms: 250, p95Ms: 0 })] },
    );
    assert.equal(report.latency[0].p50Ratio, 2.5);
    assert.equal(report.latency[0].p95Ratio, null);
  });
});

/**
 * Epochs 496539 and 496540 are two runs of the same roster an hour apart on mainnet —
 * exactly the shape of an independent replication, and free to test against.
 */
const A = 'data/epochs/496539-2026-08-24T032740866Z.bundle.json';
const B = 'data/epochs/496540-2026-08-24T040551787Z.bundle.json';
const haveBoth = existsSync(A) && existsSync(B);

describe('reproduce · two real mainnet runs of the same roster', { skip: !haveBoth }, () => {
  const load = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as VerifiableBundle;
  const report = haveBoth ? reproduce(load(A), load(B)) : undefined;

  it('lines up every service, because the roster is pinned', () => {
    assert.equal(report!.compared, 10);
    assert.deepEqual(report!.onlyPublished, []);
    assert.deepEqual(report!.onlyIndependent, []);
  });

  it('finds no service whose observed mode changed between the two runs', () => {
    assert.deepEqual(report!.disagreements.filter((d) => d.kind === 'mode'), []);
  });
});

/**
 * Bundles written before schema /2 carry no `rules`. `recompute()` reads the rulebook out of
 * the bundle on purpose, so there is no honest way to score one of these — and epoch 496514,
 * on testnet, is one of them.
 */
const OLD = 'data/epochs/496514-2026-08-23T025915129Z.bundle.json';

describe('reproduce · a run that recorded no rulebook', { skip: !existsSync(OLD) || !haveBoth }, () => {
  const ancient = JSON.parse(readFileSync(OLD, 'utf8')) as VerifiableBundle;
  const modern = JSON.parse(readFileSync(B, 'utf8')) as VerifiableBundle;

  it('refuses rather than scoring it under the other run rulebook', () => {
    assert.throws(() => reproduce(ancient, modern), /records no rulebook/);
  });

  it('names which of the two runs it is refusing', () => {
    assert.throws(() => reproduce(ancient, modern), /the earlier run \(epoch 496514/);
    assert.throws(() => reproduce(modern, ancient), /the later run \(epoch 496514/);
  });

  /* The failure a reader used to see was `Cannot read properties of undefined (reading
     'truncationSafeComparators')`, printed on the page under the sentence "This is a read
     failure" — which it was not. */
  it('does not leak a property access from the recomputation', () => {
    assert.throws(() => reproduce(ancient, modern), (e: Error) => {
      assert.doesNotMatch(e.message, /Cannot read properties/);
      return true;
    });
  });
});

describe('compareRuns · input shape', () => {
  it('compares a run that carries only the fields the comparison reads', () => {
    const live: ComparableService = {
      address: '0xA', modelId: 'm-one', mode: 'TeeTLS',
      p50Ms: 100, p95Ms: 200, errorRateBps: 0, divergenceBps: 0,
    };
    const report = compareRuns({ services: [live] }, { services: [live] });
    assert.deepEqual(report.disagreements, []);
    assert.equal(report.compared, 1);
  });
});
