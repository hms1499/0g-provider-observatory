import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { formatTokens, formatUsd, groupUsage, priceKey } from '../estimate.js';

/** Money out of floating-point multiplication lands a few ulps off. Compare to the cent. */
const near = (actual: number | null, expected: number) => {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `got ${actual}`);
};

/**
 * `0xBBB` serves two models, exactly as `0xF203A388` does on mainnet. Any roster used to test
 * this must contain such an operator, because selecting a group by address alone passes every
 * other test and silently triples the figure on the real one.
 */
const roster = [
  { address: '0xAAA', modelId: 'glm-5.2', canonicalId: 'glm-5.2' },
  { address: '0xBBB', modelId: 'glm-5.2', canonicalId: 'glm-5.2' },
  { address: '0xBBB', modelId: 'qwen3.7-plus', canonicalId: 'qwen3.7-plus' },
  { address: '0xCCC', modelId: 'qwen3.7-plus', canonicalId: 'qwen3.7-plus' },
];

const call = (address: string, model: string, prompt: number, completion: number) => ({
  providerAddress: address,
  model,
  usage: { prompt, completion, total: prompt + completion },
});

/**
 * Real shape: `pricing_usd` is USD per TOKEN, around 1e-6 to 1e-8. Written out rather than
 * rounded to 1 and 2 so that a regression reintroducing a per-million factor fails here
 * instead of passing on numbers that work either way.
 */
const prices = {
  [priceKey('0xAAA', 'glm-5.2')]: { prompt: '0.0000009', completion: '0.000003' },
  [priceKey('0xBBB', 'glm-5.2')]: { prompt: '0.000000968', completion: '0.00000338888' },
  [priceKey('0xBBB', 'qwen3.7-plus')]: { prompt: '0.00000052', completion: '0.00000208' },
  [priceKey('0xCCC', 'qwen3.7-plus')]: { prompt: '0.00000052', completion: '0.00000208' },
};

describe('groupUsage', () => {
  it('counts only the calls belonging to the group asked for', () => {
    const results = [
      call('0xAAA', 'glm-5.2', 100, 200),
      call('0xCCC', 'qwen3.7-plus', 500, 500),
    ];
    const u = groupUsage(results, roster, 'glm-5.2', prices);
    assert.equal(u.calls, 1);
    assert.equal(u.promptTokens, 100);
    assert.equal(u.completionTokens, 200);
  });

  it('leaves out an operator\u2019s calls for the other models it serves', () => {
    // Measured on mainnet before this was fixed: glm-5.2 read $0.070 because 0xF203A388's
    // qwen3.7-plus calls were counted into it. The true figure was $0.020.
    const results = [
      call('0xBBB', 'glm-5.2', 100, 100),
      call('0xBBB', 'qwen3.7-plus', 9000, 9000),
    ];
    const u = groupUsage(results, roster, 'glm-5.2', prices);
    assert.equal(u.calls, 1, 'one call of this operator belongs to this group');
    assert.equal(u.promptTokens, 100);
    assert.equal(u.completionTokens, 100);
  });

  it('prices each service at its own rate rather than at the group average', () => {
    const results = [
      call('0xAAA', 'glm-5.2', 1000, 1000), // 0.0009 + 0.003
      call('0xBBB', 'glm-5.2', 1000, 1000), // 0.000968 + 0.00338888
    ];
    near(groupUsage(results, roster, 'glm-5.2', prices).usd, 0.00825688);
  });

  it('reads the rate as USD per token, not per million', () => {
    // The one bug this module could ship and have nobody notice: a stray 1e6 divisor turns
    // a run that costs cents into `$0.0000`, which reads as free.
    const u = groupUsage([call('0xAAA', 'glm-5.2', 1_000_000, 0)], roster, 'glm-5.2', prices);
    near(u.usd, 0.9);
  });

  it('matches an address whatever case the evidence recorded it in', () => {
    const results = [call('0xaaa', 'glm-5.2', 1_000_000, 0)];
    near(groupUsage(results, roster, 'glm-5.2', prices).usd, 0.9);
  });

  it('withholds the total when any service in the group has no advertised price', () => {
    const partial = {
      [priceKey('0xAAA', 'glm-5.2')]: { prompt: '0.0000009', completion: '0.000003' },
    };
    const results = [
      call('0xAAA', 'glm-5.2', 1_000_000, 0),
      call('0xBBB', 'glm-5.2', 1_000_000, 0),
    ];
    const u = groupUsage(results, roster, 'glm-5.2', partial);
    assert.equal(u.usd, null, 'a total missing a provider understates the bill');
    assert.deepEqual(u.unpriced, [priceKey('0xBBB', 'glm-5.2')]);
    assert.equal(u.calls, 2, 'the tokens are still counted, only the price is withheld');
  });

  it('withholds the total when a price is present but not a number', () => {
    const broken = {
      [priceKey('0xAAA', 'glm-5.2')]: { prompt: 'free', completion: '0.000003' },
    };
    assert.equal(
      groupUsage([call('0xAAA', 'glm-5.2', 10, 10)], roster, 'glm-5.2', broken).usd,
      null,
    );
  });

  it('reports tokens with no price table at all, since the tokens are measured either way', () => {
    const u = groupUsage([call('0xAAA', 'glm-5.2', 100, 200)], roster, 'glm-5.2', null);
    assert.equal(u.usd, null);
    assert.equal(u.promptTokens, 100);
    assert.equal(u.completionTokens, 200);
    assert.deepEqual(u.unpriced, [], 'nothing is unpriced when nothing was priced');
  });

  it('treats a call with no usage block as zero tokens, not as a missing call', () => {
    const results = [{ providerAddress: '0xAAA', model: 'glm-5.2', usage: null }];
    const u = groupUsage(results, roster, 'glm-5.2', prices);
    assert.equal(u.calls, 1);
    assert.equal(u.promptTokens, 0);
    assert.equal(u.usd, 0);
  });

  it('ignores a result with no provider address rather than attributing it to the group', () => {
    const results = [{ model: 'glm-5.2', usage: { prompt: 999, completion: 999 } }];
    assert.equal(groupUsage(results, roster, 'glm-5.2', prices).calls, 0);
  });
});

describe('formatUsd', () => {
  it('keeps enough places that a real charge never renders as zero', () => {
    assert.equal(formatUsd(0.0031), '$0.0031');
    assert.equal(formatUsd(0.00004), '$0.0000');
  });

  it('writes nothing as nothing', () => {
    assert.equal(formatUsd(0), '$0');
  });

  it('shortens as the amount grows', () => {
    assert.equal(formatUsd(0.42), '$0.420');
    assert.equal(formatUsd(12.5), '$12.50');
  });
});

describe('formatTokens', () => {
  it('separates thousands', () => {
    assert.equal(formatTokens(61884), '61,884');
  });
});
