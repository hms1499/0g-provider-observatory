import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readChoice } from '../router-client.js';

/**
 * The shape a reasoning model returns when it spends its whole output budget thinking:
 * HTTP 200, `content` null, the chain of thought in `reasoning`, cut off at the ceiling.
 * Measured live 2026-08-23 against zai-org/GLM-5-FP8.
 */
const reasoningTruncated = {
  choices: [
    {
      finish_reason: 'length',
      index: 0,
      message: { content: null, reasoning: '1. **Analyze the Request:** ...' },
    },
  ],
};

describe('readChoice', () => {
  it('reads the answer and reports no error on a normal reply', () => {
    const c = readChoice({ choices: [{ finish_reason: 'stop', message: { content: '407' } }] });
    assert.deepEqual(c, { text: '407', truncated: false, errorKind: undefined });
  });

  it('marks a reply cut off at the ceiling as truncated', () => {
    const c = readChoice({ choices: [{ finish_reason: 'length', message: { content: '134' } }] });
    assert.equal(c.truncated, true);
    assert.equal(c.errorKind, undefined);
  });

  it('blames nobody when a reasoning model burns the whole budget before answering', () => {
    // `reasoning` is chain of thought, never the answer — reading it as one would feed
    // the model's scratchpad into the comparators.
    const c = readChoice(reasoningTruncated);
    assert.equal(c.text, null);
    assert.equal(c.truncated, true);
    assert.equal(c.errorKind, 'no_content');
  });

  it('still calls it malformed when a reply ends normally with nothing in it', () => {
    const c = readChoice({ choices: [{ finish_reason: 'stop', message: { content: null } }] });
    assert.equal(c.errorKind, 'malformed');
  });

  it('calls a body with no choices malformed', () => {
    assert.equal(readChoice({}).errorKind, 'malformed');
  });
});
