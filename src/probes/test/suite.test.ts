import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { assertSuiteValid, PROBES, PROBE_TOKEN_PROFILE } from '../suite.js';

describe('the probe suite', () => {
  it('satisfies its own invariants', () => {
    assert.doesNotThrow(() => assertSuiteValid());
  });

  it('prices the noise-floor pair identically', () => {
    // The two requests are byte-identical on the wire, so their cost distributions cannot
    // legitimately differ. When they do, it means one of them is not reaching the same
    // services as the other — which is exactly what happened: arith-mult-repeat sits near
    // the end of the suite, never reached glm-5 or qwen3.7-plus before the run was cut,
    // and so measured 513 output tokens against arith-mult's 1836.
    const a = PROBE_TOKEN_PROFILE['arith-mult'];
    const b = PROBE_TOKEN_PROFILE['arith-mult-repeat'];
    assert.deepEqual(b, a, 'the noise pair must carry one shared token profile');
  });

  it('still has probes billed past the ceiling they declare', () => {
    // The finding this pins: max_tokens does not bound what is charged. Reasoning models
    // bill their thinking as completion tokens, so 45 of 176 billed calls across epochs
    // 496514/496516 exceeded the limit they were sent — arith-mod by 10x. Asserted per
    // probe rather than over the suite total, which one generous ceiling would mask.
    const over = PROBES.filter((p) => (PROBE_TOKEN_PROFILE[p.id]?.output ?? 0) > p.maxTokens);
    assert.ok(
      over.length > 0,
      'no probe is measured above its ceiling — either the roster changed or this regressed',
    );
  });

  it('gives the noise pair room for a reasoning model to finish', () => {
    // Measured: glm-5.2 was truncated on 8 of 8 noise-pair calls at a 512 ceiling while
    // glm-5 ran to 3213 tokens. A provider that honours max_tokens must not be the one
    // dropped from the measurement for honouring it.
    const pair = PROBES.filter((p) => p.id.startsWith('arith-mult'));
    assert.equal(pair.length, 2);
    for (const p of pair) assert.ok(p.maxTokens >= 3213, `${p.id} caps below observed usage`);
  });
});
