import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildPinnedRequest, readChoice } from '../router-client.js';
import { PROBES } from '../suite.js';

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

describe('buildPinnedRequest reasoning_effort', () => {
  const base = {
    baseUrl: 'https://router-api.0g.ai/v1',
    providerAddress: '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB',
    model: 'glm-5',
    probe: PROBES[0],
  };

  it('carries the negotiated effort into the request body', () => {
    const req = buildPinnedRequest({
      ...base,
      params: { temperature: 0, reasoning_effort: 'low', dropped: [] },
    });
    assert.equal(req.body.reasoning_effort, 'low');
  });

  it('omits the field entirely when no effort was negotiated', () => {
    const req = buildPinnedRequest({ ...base, params: { temperature: 0, dropped: [] } });
    assert.equal('reasoning_effort' in req.body, false);
  });
});

describe('buildPinnedRequest · endpoint', () => {
  it('builds its URL from the caller-supplied base, not from the environment', () => {
    const req = buildPinnedRequest({
      baseUrl: '/api/router',
      providerAddress: '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D',
      model: 'glm-5.2',
      probe: PROBES[0],
      params: { temperature: 0, dropped: [] },
    });
    assert.equal(req.url, '/api/router/chat/completions');
  });
});
