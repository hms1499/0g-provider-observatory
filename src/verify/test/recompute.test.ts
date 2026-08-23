import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  attributeFault,
  basisPoints,
  compareKey,
  nearestRank,
  recompute,
  type VerifiableBundle,
} from '../recompute.js';

describe('nearestRank', () => {
  it('takes the value at rank ceil(k*n/100) with no interpolation', () => {
    const s = [10, 20, 30, 40, 50];
    assert.equal(nearestRank(s, 50), 30);
    assert.equal(nearestRank(s, 95), 50);
  });

  it('makes p95 the slowest call when n is 15, which is the honest consequence', () => {
    const s = Array.from({ length: 15 }, (_, i) => (i + 1) * 100);
    assert.equal(nearestRank(s, 95), 1500);
  });

  it('clamps at both ends', () => {
    assert.equal(nearestRank([7], 50), 7);
    assert.equal(nearestRank([1, 2], 0), 1);
    assert.equal(nearestRank([1, 2], 100), 2);
  });
});

describe('basisPoints', () => {
  it('rounds half up in integer arithmetic', () => {
    assert.equal(basisPoints(1, 3), 3333);
    assert.equal(basisPoints(2, 3), 6667);
    assert.equal(basisPoints(1, 15), 667);
    assert.equal(basisPoints(0, 10), 0);
  });

  it('is zero when nothing was attempted, rather than dividing by zero', () => {
    assert.equal(basisPoints(0, 0), 0);
  });
});

describe('attributeFault', () => {
  const table = {
    provider: ['upstream', 'timeout', 'rate_limit', 'malformed', 'not_found'],
    prober: ['auth', 'payment', 'bad_request', 'no_content'],
    unknown: ['network'],
  };

  it('reads the attribution from the bundle rather than assuming it', () => {
    assert.equal(attributeFault(table, 'upstream'), 'provider');
    assert.equal(attributeFault(table, 'no_content'), 'prober');
    assert.equal(attributeFault(table, 'network'), 'unknown');
  });

  it('refuses to guess about a kind the bundle never listed', () => {
    assert.equal(attributeFault(table, 'something_new'), 'unlisted');
  });
});

describe('compareKey', () => {
  it('collapses whitespace for exact, and nothing else', () => {
    assert.equal(compareKey('exact', '  A  B \n'), 'A B');
    assert.notEqual(compareKey('exact', 'abc'), compareKey('exact', 'ABC'));
  });

  it('takes the last number, so a restated question is not read as the answer', () => {
    assert.equal(compareKey('numeric', 'Compute (7^13) mod 1000. The answer is 407.'), '407');
    assert.equal(compareKey('numeric', '13,352,884'), '13352884');
    assert.equal(compareKey('numeric', 'nothing here'), null);
  });

  it('treats json key order and a markdown fence as noise', () => {
    assert.equal(
      compareKey('json', '```json\n{"b":1,"a":2}\n```'),
      compareKey('json', '{"a":2,"b":1}'),
    );
  });

  it('never compares freeform, because word counting is not reproducible', () => {
    assert.equal(compareKey('freeform', 'seven words exactly right here now ok'), null);
  });
});

/** A two-service group where one answer differs, built small enough to check by hand. */
const bundle: VerifiableBundle = {
  schema: 'og-observatory-epoch/2',
  epoch: 1,
  prober: '0x1',
  startedAt: '2026-08-23T00:00:00.000Z',
  endedAt: '2026-08-23T00:01:00.000Z',
  probes: [
    { id: 'p-num', prompt: 'x', comparator: 'numeric', maxTokens: 64 },
    { id: 'p-txt', prompt: 'y', comparator: 'exact', maxTokens: 64 },
  ],
  roster: [
    { address: '0xA', modelId: 'm', canonicalId: 'm', mode: 'TeeTLS', onchainMode: 'TeeTLS', droppedParams: [] },
    { address: '0xB', modelId: 'm', canonicalId: 'm', mode: 'TeeTLS', onchainMode: 'TeeTLS', droppedParams: [] },
  ],
  rules: {
    minSamples: 1,
    percentile: 'nearest-rank',
    basisPoints: 'half-up',
    numericExtraction: 'last',
    refusalPattern: '\\bi cannot\\b',
    truncationSafeComparators: ['categorical'],
    divergenceProbeIds: ['p-num', 'p-txt'],
    noiseProbePair: ['p-num', 'p-num'],
    faultAttribution: {
      provider: ['upstream', 'timeout', 'rate_limit', 'malformed', 'not_found'],
      prober: ['auth', 'payment', 'bad_request', 'no_content'],
      unknown: ['network'],
    },
  },
  results: [
    call('0xA', 'p-num', '407', 100),
    call('0xA', 'p-txt', 'hello', 300),
    call('0xB', 'p-num', '408', 200),
    call('0xB', 'p-txt', 'hello', 400),
  ],
};

function call(address: string, probeId: string, text: string, latencyMs: number) {
  return {
    probeId, providerAddress: address, model: 'm', ok: true, status: 200,
    latencyMs, text, truncated: false, at: '2026-08-23T00:00:30.000Z',
  };
}

describe('recompute', () => {
  it('derives latency percentiles from successful calls only', () => {
    const rows = recompute(bundle);
    const a = rows.find((r) => r.address === '0xA')!;
    assert.equal(a.p50Ms, 100);
    assert.equal(a.p95Ms, 300);
    assert.equal(a.calls, 2);
  });

  it('scores a symmetric pair the same on both sides, since neither is ground truth', () => {
    const rows = recompute(bundle);
    const a = rows.find((r) => r.address === '0xA')!;
    const b = rows.find((r) => r.address === '0xB')!;
    // one of two probes differs -> 5000 bps, both carry it
    assert.equal(a.divergenceBps, 5000);
    assert.equal(b.divergenceBps, 5000);
  });

  it('keeps a prober-side failure out of the provider error rate and out of the count', () => {
    const withFault = {
      ...bundle,
      results: [
        ...bundle.results,
        { probeId: 'p-txt', providerAddress: '0xA', model: 'm', ok: false, status: 402,
          latencyMs: 5, text: null, truncated: false, errorKind: 'payment',
          at: '2026-08-23T00:00:40.000Z' },
      ],
    };
    const a = recompute(withFault).find((r) => r.address === '0xA')!;
    assert.equal(a.errorRateBps, 0);
    assert.equal(a.calls, 2);
    assert.equal(a.proberFaults, 1);
  });

  it('marks a service insufficient when it has fewer successes than minSamples', () => {
    const thin = { ...bundle, rules: { ...bundle.rules, minSamples: 5 } };
    assert.equal(recompute(thin).every((r) => !r.sufficient), true);
  });
});
