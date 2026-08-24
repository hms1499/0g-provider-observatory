import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { CallResult } from '../router-client.js';
import type { Target } from '../plan.js';
import {
  Budget,
  BudgetExceeded,
  callCostUsd,
  pinHeld,
  fitToBudget,
  projectedCostUsd,
  reservationUsd,
  selectRoster,
} from '../epoch-run.js';
import { PROBES, SUITE_MEASURED_TOKENS } from '../suite.js';

const ADDR_A = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';
const ADDR_B = '0xF203A388e9E70F09ece38046a6D40a89cf896309';
const ADDR_C = '0x7DCF7Bc0Ee1B5eD8Cbb0Cef0dcC1eF1c3B0Ce87D';
const ADDR_D = '0xe4d9768112BFe24112e2E0433FE1F4F452fcB6eb';

function target(address: string, canonicalId: string, rate = 1e-8): Target {
  return {
    address,
    providerName: null,
    modelId: `${canonicalId}-0731`,
    canonicalId,
    mode: 'TeeTLS',
    onchainMode: 'TeeTLS',
    params: { dropped: [] },
    estCostUsd: 0,
    reportedLatency: null,
    usdPerPromptToken: rate,
    usdPerCompletionToken: rate * 2,
  };
}

function result(over: Partial<CallResult> = {}): CallResult {
  return {
    probeId: 'echo-exact',
    providerAddress: ADDR_A,
    model: 'x',
    ok: true,
    status: 200,
    latencyMs: 100,
    text: 'x',
    usage: { prompt: 100, completion: 50, total: 150 },
    chatId: null,
    servedBy: ADDR_A,
    rateLimitRemaining: null,
    truncated: false,
    droppedParams: [],
    at: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

describe('selectRoster', () => {
  it('keeps only models served by more than one provider', () => {
    const targets = [
      target(ADDR_A, 'glm-5.2'),
      target(ADDR_B, 'glm-5.2'),
      target(ADDR_C, 'lonely-model'),
    ];
    const kept = selectRoster(targets, { groupsOnly: true });
    assert.deepEqual(
      kept.map((t) => t.canonicalId),
      ['glm-5.2', 'glm-5.2'],
    );
  });

  it('drops every provider of an excluded model', () => {
    const targets = [
      target(ADDR_A, 'glm-5.2'),
      target(ADDR_B, 'glm-5.2'),
      target(ADDR_A, 'claude-opus-5'),
      target(ADDR_B, 'claude-opus-5'),
    ];
    const kept = selectRoster(targets, { groupsOnly: true, exclude: ['claude-opus-5'] });
    assert.deepEqual(new Set(kept.map((t) => t.canonicalId)), new Set(['glm-5.2']));
  });

  it('keeps a single-provider model when groupsOnly is off', () => {
    const targets = [target(ADDR_C, 'lonely-model')];
    assert.equal(selectRoster(targets).length, 1);
  });
});

describe('fitToBudget', () => {
  /** One service's full suite at the rates `target()` uses. */
  const perService = () => projectedCostUsd([target(ADDR_A, 'x')]);

  it('drops whole groups rather than leaving half a group behind', () => {
    // Half a pair is worthless: the survivor becomes ungrouped and has nothing to diverge
    // from, so it costs money and produces no divergence figure at all.
    const targets = [
      target(ADDR_A, 'cheap'), target(ADDR_B, 'cheap'),
      target(ADDR_C, 'dear', 1e-6), target(ADDR_D, 'dear', 1e-6),
    ];
    const kept = fitToBudget(targets, perService() * 3);
    const counts = new Map<string, number>();
    for (const t of kept) counts.set(t.canonicalId, (counts.get(t.canonicalId) ?? 0) + 1);
    for (const [id, n] of counts) assert.equal(n % 2, 0, `${id} was left half-measured`);
  });

  it('fits the whole suite for everything it keeps', () => {
    const targets = [
      target(ADDR_A, 'cheap'), target(ADDR_B, 'cheap'),
      target(ADDR_C, 'dear', 1e-6), target(ADDR_D, 'dear', 1e-6),
    ];
    const budget = perService() * 3;
    const kept = fitToBudget(targets, budget);
    assert.ok(kept.length > 0, 'something must fit');
    assert.ok(
      projectedCostUsd(kept) <= budget,
      `kept roster projects ${projectedCostUsd(kept)} against a budget of ${budget}`,
    );
  });

  it('prefers the group carrying a TeeML reference when not everything fits', () => {
    const withRef = { ...target(ADDR_C, 'anchored', 1e-6), mode: 'TeeML' as const };
    const targets = [
      target(ADDR_A, 'cheap'), target(ADDR_B, 'cheap'),
      withRef, target(ADDR_D, 'anchored', 1e-6),
    ];
    // Only the expensive anchored pair fits, and it is the one that calibrates.
    const kept = fitToBudget(targets, projectedCostUsd([withRef, target(ADDR_D, 'anchored', 1e-6)]));
    assert.deepEqual(new Set(kept.map((t) => t.canonicalId)), new Set(['anchored']));
  });

  it('returns nothing when not even the cheapest group fits', () => {
    const targets = [target(ADDR_A, 'cheap'), target(ADDR_B, 'cheap')];
    assert.deepEqual(fitToBudget(targets, perService() / 2), []);
  });
});

describe('projectedCostUsd', () => {
  it('prices the measured token profile, not the max_tokens ceiling', () => {
    const t = target(ADDR_A, 'glm-5.2');
    assert.equal(
      projectedCostUsd([t]),
      1e-8 * SUITE_MEASURED_TOKENS.input + 2e-8 * SUITE_MEASURED_TOKENS.output,
    );
  });

});

describe('callCostUsd', () => {
  it('bills reported usage at the base-tier rate', () => {
    const t = target(ADDR_A, 'glm-5.2');
    assert.equal(callCostUsd(result(), t), 100 * 1e-8 + 50 * 2e-8);
  });

  it('costs nothing when the call reported no usage', () => {
    const t = target(ADDR_A, 'glm-5.2');
    assert.equal(callCostUsd(result({ ok: false, usage: null }), t), 0);
  });
});

describe('Budget', () => {
  /** Reserve and settle in one step, the way a completed call moves through the cap. */
  const spend = (b: Budget, usd: number) => {
    const held = b.reserve(usd);
    assert.ok(held, `expected $${usd} to fit`);
    held.settle(usd);
  };

  it('refuses a call that would carry spending past the cap', () => {
    const b = new Budget(0.001);
    spend(b, 0.0009);
    assert.equal(b.reserve(0.0002), null);
    assert.ok(b.reserve(0.00005));
  });

  it('accumulates what was actually spent', () => {
    const b = new Budget(1);
    spend(b, 0.25);
    spend(b, 0.5);
    assert.equal(b.spentUsd, 0.75);
    assert.equal(b.remainingUsd, 0.25);
  });

  it('throws when spending passes the cap, so a run cannot quietly overshoot', () => {
    const b = new Budget(0.001);
    // The estimate fitted; what the provider actually billed did not.
    const held = b.reserve(0.0005);
    assert.ok(held);
    assert.throws(() => held.settle(0.002), BudgetExceeded);
  });
});

describe('pinHeld', () => {
  it('accepts the pinned provider regardless of address casing', () => {
    assert.equal(pinHeld(result({ servedBy: ADDR_A.toLowerCase() }), ADDR_A), true);
  });

  it('rejects a response served by a different provider', () => {
    assert.equal(pinHeld(result({ servedBy: ADDR_B }), ADDR_A), false);
  });

  it('rejects a response with no x-provider header, since the pin is unproven', () => {
    assert.equal(pinHeld(result({ servedBy: null }), ADDR_A), false);
  });
});

describe('reservationUsd', () => {
  const probeById = (id: string) => {
    const p = PROBES.find((x) => x.id === id);
    assert.ok(p, `no probe ${id}`);
    return p;
  };

  it('prices each probe at its own measured profile, not at a suite average', () => {
    const t = target(ADDR_A, 'glm-5');
    const oneWord = reservationUsd(t, probeById('word-count-7'));
    const reasoning = reservationUsd(t, probeById('arith-mod'));
    assert.ok(
      reasoning > oneWord * 10,
      `a reasoning probe must reserve far more than a one-word one, got ${reasoning} vs ${oneWord}`,
    );
  });

  it('reserves above what the probe declared as max_tokens', () => {
    // Measured on epochs 496514/496516: arith-mod declares a 512-token ceiling and was
    // billed up to 5223. A reservation pinned to the ceiling would under-reserve 10x.
    const t = target(ADDR_A, 'glm-5');
    const probe = probeById('arith-mod');
    const atCeiling = t.usdPerCompletionToken * probe.maxTokens;
    assert.ok(reservationUsd(t, probe) > atCeiling);
  });

  it('covers every probe in the suite, so none is estimated at zero', () => {
    const t = target(ADDR_A, 'glm-5');
    for (const probe of PROBES) {
      assert.ok(reservationUsd(t, probe) > 0, `probe ${probe.id} has no token profile`);
    }
  });
});

describe('Budget reservations', () => {
  it('holds a reservation against the cap so a concurrent call cannot slip past it', () => {
    const b = new Budget(0.001);
    // Two workers, each about to send a call estimated at $0.0006. Only one fits.
    const first = b.reserve(0.0006);
    const second = b.reserve(0.0006);
    assert.ok(first, 'the first call fits and must be admitted');
    assert.equal(second, null, 'the second must be refused while the first is still in flight');
  });

  it('frees the unspent remainder when a call settles for less than it reserved', () => {
    const b = new Budget(0.001);
    const held = b.reserve(0.0006);
    assert.ok(held);
    held.settle(0.0001);
    assert.equal(b.spentUsd, 0.0001);
    // $0.0009 of the cap is free again, so a second call of this size now fits.
    assert.ok(b.reserve(0.0006), 'the remainder must return to the cap on settle');
  });

  it('returns the whole hold when a call fails without spending', () => {
    const b = new Budget(0.001);
    const held = b.reserve(0.0006);
    assert.ok(held);
    held.release();
    assert.equal(b.spentUsd, 0);
    assert.equal(b.remainingUsd, 0.001);
  });

  it('counts outstanding reservations as committed, not as spent', () => {
    const b = new Budget(0.001);
    assert.ok(b.reserve(0.0006));
    assert.equal(b.spentUsd, 0, 'nothing has been billed yet');
    assert.equal(b.committedUsd, 0.0006, 'but the cap is already committed');
  });

  it('records the real cost when a call settles for more than it reserved', () => {
    const b = new Budget(1);
    const held = b.reserve(0.1);
    assert.ok(held);
    // A reasoning model bills past the max_tokens we asked for.
    held.settle(0.3);
    assert.equal(b.spentUsd, 0.3);
    assert.equal(b.committedUsd, 0.3, 'the hold must not linger once it is settled');
  });

  it('refuses a reservation once settled spend has reached the cap', () => {
    const b = new Budget(0.001);
    const held = b.reserve(0.0005);
    assert.ok(held);
    held.settle(0.001);
    assert.equal(b.reserve(0.000001), null);
  });

  it('still books an overspend before reporting it, so the ledger stays consistent', () => {
    const b = new Budget(0.001);
    const held = b.reserve(0.0005);
    assert.ok(held);
    assert.throws(() => held.settle(0.002), BudgetExceeded);
    assert.equal(b.spentUsd, 0.002, 'what was billed is spent, whether or not it fit');
    assert.equal(b.committedUsd, 0.002, 'and the hold is released even on the throwing path');
  });

  it('rejects settling the same reservation twice', () => {
    const b = new Budget(1);
    const held = b.reserve(0.1);
    assert.ok(held);
    held.settle(0.05);
    assert.throws(() => held.settle(0.05));
  });
});
