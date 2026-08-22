import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { CallResult, ErrorKind } from '../router-client.js';
import {
  aggregate,
  faultSide,
  FieldOverflow,
  percentileNearestRank,
  toBasisPoints,
  toMeasurements,
  type ResolveContext,
} from '../aggregate.js';

const ADDR_A = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';
const ADDR_B = '0xF203A388e9E70F09ece38046a6D40a89cf896309';

function ok(address: string, model: string, latencyMs: number, i = 0): CallResult {
  return {
    probeId: `p${i}`,
    providerAddress: address,
    model,
    ok: true,
    status: 200,
    latencyMs,
    text: 'x',
    usage: null,
    chatId: null,
    servedBy: null,
    truncated: false,
    rateLimitRemaining: null,
    droppedParams: [],
    at: '2026-08-22T00:00:00.000Z',
  };
}

function bad(address: string, model: string, kind: ErrorKind, i = 0): CallResult {
  return { ...ok(address, model, 12, i), ok: false, status: 0, text: null, errorKind: kind };
}

const ctx = (ids: Record<string, number>): ResolveContext => ({
  providerId: (a, m) => ids[`${a}|${m}`] ?? null,
  observedMode: () => 2,
});

describe('percentileNearestRank', () => {
  it('uses rank = ceil(k*n/100) with no interpolation', () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(percentileNearestRank(s, 50), 50); // rank 5
    assert.equal(percentileNearestRank(s, 95), 100); // rank 10
    assert.equal(percentileNearestRank(s, 10), 10); // rank 1
  });

  it('at n=15 a p95 is the slowest call — the honest consequence of 15 probes', () => {
    const s = Array.from({ length: 15 }, (_, i) => (i + 1) * 100);
    assert.equal(percentileNearestRank(s, 50), 800); // rank ceil(750/100)=8
    assert.equal(percentileNearestRank(s, 95), 1500); // rank ceil(1425/100)=15 = max
  });

  it('is stable on a single sample and on the edges', () => {
    assert.equal(percentileNearestRank([42], 50), 42);
    assert.equal(percentileNearestRank([42], 95), 42);
    assert.equal(percentileNearestRank([1, 2, 3], 0), 1);
    assert.equal(percentileNearestRank([1, 2, 3], 100), 3);
  });

  it('refuses an empty sample rather than inventing a value', () => {
    assert.throws(() => percentileNearestRank([], 50));
  });
});

describe('toBasisPoints', () => {
  it('rounds half up in integer arithmetic', () => {
    assert.equal(toBasisPoints(1, 15), 667); // 6.667% -> 667 bps
    assert.equal(toBasisPoints(1, 3), 3333);
    assert.equal(toBasisPoints(2, 3), 6667);
    assert.equal(toBasisPoints(0, 15), 0);
    assert.equal(toBasisPoints(15, 15), 10000);
  });

  it('returns zero rather than dividing by zero', () => {
    assert.equal(toBasisPoints(3, 0), 0);
  });
});

describe('fault attribution', () => {
  it('blames the provider only for failures that are theirs', () => {
    for (const k of ['upstream', 'timeout', 'rate_limit', 'malformed', 'not_found'] as const) {
      assert.equal(faultSide(k), 'provider', k);
    }
  });

  it('keeps our own billing and auth failures off their record', () => {
    for (const k of ['auth', 'payment', 'bad_request'] as const) {
      assert.equal(faultSide(k), 'prober', k);
    }
  });

  it('leaves an ambiguous network failure unattributed rather than guessing', () => {
    assert.equal(faultSide('network'), 'unknown');
  });
});

describe('aggregate', () => {
  const many = (address: string, model: string, latencies: number[]) =>
    latencies.map((ms, i) => ok(address, model, ms, i));

  it('never pools two models served by one address', () => {
    const rows = aggregate([
      ...many(ADDR_A, 'glm-5.2', [100, 100, 100, 100, 100]),
      ...many(ADDR_A, 'kimi-k3', [900, 900, 900, 900, 900]),
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.p50Ms).sort((a, b) => a - b), [100, 900]);
  });

  it('computes latency over successful calls only', () => {
    // A 402 that fails in 12 ms must not drag the median down.
    const rows = aggregate([
      ...many(ADDR_A, 'glm-5.2', [500, 600, 700, 800, 900]),
      bad(ADDR_A, 'glm-5.2', 'payment', 9),
    ]);
    assert.equal(rows[0].p50Ms, 700);
    assert.equal(rows[0].successes, 5);
  });

  it('excludes prober faults from the error rate entirely', () => {
    const rows = aggregate([
      ...many(ADDR_A, 'glm-5.2', [100, 200, 300, 400, 500]),
      bad(ADDR_A, 'glm-5.2', 'payment', 6),
      bad(ADDR_A, 'glm-5.2', 'auth', 7),
    ]);
    const r = rows[0];
    assert.equal(r.proberFaults, 2);
    assert.equal(r.providerFailures, 0);
    assert.equal(r.calls, 5, 'our failures must not inflate the attempt count either');
    assert.equal(r.errorRateBps, 0, 'an expired key is not a provider outage');
  });

  it('counts provider-side failures against the provider', () => {
    const rows = aggregate([
      ...many(ADDR_A, 'glm-5.2', [100, 200, 300, 400, 500]),
      bad(ADDR_A, 'glm-5.2', 'upstream', 6),
      bad(ADDR_A, 'glm-5.2', 'timeout', 7),
    ]);
    const r = rows[0];
    assert.equal(r.providerFailures, 2);
    assert.equal(r.calls, 7);
    assert.equal(r.errorRateBps, toBasisPoints(2, 7));
    assert.deepEqual(r.errorsByKind, { upstream: 1, timeout: 1 });
  });

  it('surfaces an ambiguous network failure without attributing it', () => {
    const rows = aggregate([
      ...many(ADDR_A, 'glm-5.2', [100, 200, 300, 400, 500]),
      bad(ADDR_A, 'glm-5.2', 'network', 6),
    ]);
    const r = rows[0];
    assert.equal(r.unknownFaults, 1);
    assert.equal(r.providerFailures, 0);
    assert.equal(r.errorRateBps, 0);
  });

  it('publishes no percentile below the sample floor', () => {
    const rows = aggregate(many(ADDR_A, 'glm-5.2', [100, 200]));
    assert.equal(rows[0].sufficient, false);
    assert.equal(rows[0].p50Ms, 0);
    assert.equal(rows[0].successes, 2);
  });

  it('carries dropped parameters so divergence can be labelled', () => {
    const withDrop = { ...ok(ADDR_A, 'claude-opus-5', 300), droppedParams: ['temperature'] };
    const rows = aggregate([withDrop, ...many(ADDR_A, 'claude-opus-5', [310, 320, 330, 340])]);
    assert.deepEqual(rows[0].droppedParams, ['temperature']);
  });

  it('keeps the raw sample so the CLI can recompute the percentiles', () => {
    const rows = aggregate(many(ADDR_A, 'glm-5.2', [300, 100, 200, 500, 400]));
    assert.deepEqual(rows[0].latenciesMs, [100, 200, 300, 400, 500]);
    assert.equal(percentileNearestRank(rows[0].latenciesMs, 50), rows[0].p50Ms);
  });

  it('pools many epochs the same way it handles one', () => {
    const epoch1 = many(ADDR_A, 'glm-5.2', [100, 200, 300, 400, 500]);
    const epoch2 = many(ADDR_A, 'glm-5.2', [600, 700, 800, 900, 1000]);
    const rows = aggregate([...epoch1, ...epoch2]);
    assert.equal(rows[0].successes, 10);
    assert.equal(rows[0].p50Ms, 500); // rank ceil(500/100) = 5
  });
});

describe('toMeasurements', () => {
  const ids = { [`${ADDR_A}|glm-5.2`]: 1, [`${ADDR_B}|glm-5.2`]: 2 };
  const five = (a: string) => [100, 200, 300, 400, 500].map((ms, i) => ok(a, 'glm-5.2', ms, i));

  it('maps aggregates onto the on-chain row shape', () => {
    const { rows, skipped } = toMeasurements(aggregate(five(ADDR_A)), ctx(ids));
    assert.equal(skipped.length, 0);
    assert.deepEqual(rows[0], {
      providerId: 1,
      p50Ms: 300,
      p95Ms: 500,
      errorRateBps: 0,
      divergenceBps: 0,
      calls: 5,
      observedMode: 2,
    });
  });

  it('drops insufficient services instead of zero-filling them', () => {
    const stats = aggregate([...five(ADDR_A), ...[100, 200].map((ms, i) => ok(ADDR_B, 'glm-5.2', ms, i))]);
    const { rows, skipped } = toMeasurements(stats, ctx(ids));
    assert.equal(rows.length, 1);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /only 2 successful calls/);
  });

  it('drops a service the registry has never seen', () => {
    const { rows, skipped } = toMeasurements(aggregate(five(ADDR_A)), ctx({}));
    assert.equal(rows.length, 0);
    assert.match(skipped[0].reason, /not registered/);
  });

  it('throws on overflow rather than clamping a number that looks measured', () => {
    const stats = aggregate(five(ADDR_A));
    stats[0].p50Ms = 0x1_0000_0000;
    assert.throws(() => toMeasurements(stats, ctx(ids)), FieldOverflow);
  });

  it('leaves divergence at zero until T5 supplies it', () => {
    const { rows } = toMeasurements(aggregate(five(ADDR_A)), ctx(ids));
    assert.equal(rows[0].divergenceBps, 0);
  });

  it('takes divergence from T5 when it is wired in', () => {
    const withDivergence: ResolveContext = { ...ctx(ids), divergenceBps: () => 340 };
    const { rows } = toMeasurements(aggregate(five(ADDR_A)), withDivergence);
    assert.equal(rows[0].divergenceBps, 340);
  });
});
