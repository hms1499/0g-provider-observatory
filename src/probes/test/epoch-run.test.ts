import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { CallResult } from '../router-client.js';
import type { Target } from '../plan.js';
import {
  Budget,
  BudgetExceeded,
  callCostUsd,
  pinHeld,
  projectedCostUsd,
  selectRoster,
} from '../epoch-run.js';

const ADDR_A = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';
const ADDR_B = '0xF203A388e9E70F09ece38046a6D40a89cf896309';
const ADDR_C = '0x7DCF7Bc0Ee1B5eD8Cbb0Cef0dcC1eF1c3B0Ce87D';

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

describe('projectedCostUsd', () => {
  it('prices the measured token profile, not the max_tokens ceiling', () => {
    // 1753 input x 1e-8 + 1740 output x 2e-8 = 0.00001753 + 0.0000348
    const t = target(ADDR_A, 'glm-5.2');
    assert.equal(projectedCostUsd([t]).toFixed(8), '0.00005233');
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
  it('refuses a call that would carry spending past the cap', () => {
    const b = new Budget(0.001);
    b.record(0.0009);
    assert.equal(b.canAfford(0.0002), false);
    assert.equal(b.canAfford(0.00005), true);
  });

  it('accumulates what was actually spent', () => {
    const b = new Budget(1);
    b.record(0.25);
    b.record(0.5);
    assert.equal(b.spentUsd, 0.75);
    assert.equal(b.remainingUsd, 0.25);
  });

  it('throws when spending passes the cap, so a run cannot quietly overshoot', () => {
    const b = new Budget(0.001);
    assert.throws(() => b.record(0.002), BudgetExceeded);
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
