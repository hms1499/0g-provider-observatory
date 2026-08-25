import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildUpstream,
  parseRelayBody,
  priceKey,
  RelayRejected,
  UPSTREAM,
  type PriceTable,
  type RelayBody,
} from '../request.js';

const ADDRESS = '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D';

const body = (over: Partial<RelayBody> = {}): RelayBody => ({
  providerAddress: ADDRESS,
  model: 'glm-5.2',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 64,
  temperature: 0,
  ...over,
});

const prices: PriceTable = {
  [priceKey(ADDRESS, 'glm-5.2')]: { prompt: '0.0000009', completion: '0.000003' },
};

describe('parseRelayBody', () => {
  it('rejects a malformed provider address', () => {
    assert.throws(
      () => parseRelayBody(body(), 'not-an-address'),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('rejects a well-formed body with no X-0G-Provider-Address header', () => {
    assert.throws(
      () => parseRelayBody(body(), undefined),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('rejects a body with no messages', () => {
    assert.throws(
      () => parseRelayBody({ ...body(), messages: [] }, ADDRESS),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('accepts a well-formed body', () => {
    assert.equal(parseRelayBody(body(), ADDRESS).model, 'glm-5.2');
  });

  it('takes the provider address from the header argument, not the body', () => {
    const parsed = parseRelayBody({ ...body(), providerAddress: 'ignored-if-present' }, ADDRESS);
    assert.equal(parsed.providerAddress, ADDRESS);
  });
});

describe('buildUpstream', () => {
  it('refuses a request with no Authorization, rather than falling back to a key', () => {
    assert.throws(() => buildUpstream(body(), undefined, prices), (e: RelayRejected) => e.status === 401);
  });

  it('always calls the one hardcoded upstream, whatever the body says', () => {
    const withExtras = { ...body(), url: 'https://evil.test/v1/chat/completions' } as RelayBody;
    const { url } = buildUpstream(withExtras, 'Bearer sk-test', prices);
    assert.equal(url, UPSTREAM);
  });

  it('pins the provider and sets both price ceilings at the multiplier the CLI uses', () => {
    const { init } = buildUpstream(body(), 'Bearer sk-test', prices);
    assert.equal(init.headers['X-0G-Provider-Address'], ADDRESS);
    // 0.0000009 USD/token * 1e6 tokens * 3 = 2.7 USD per million tokens
    assert.equal(init.headers['X-0G-Provider-Max-Price-Usd-Prompt'], '2.7');
    // 0.000003 * 1e6 * 3 = 9
    assert.equal(init.headers['X-0G-Provider-Max-Price-Usd-Completion'], '9');
  });

  it('forwards the caller Authorization verbatim and sends no key of its own', () => {
    const { init } = buildUpstream(body(), 'Bearer sk-caller', prices);
    assert.equal(init.headers.authorization, 'Bearer sk-caller');
  });

  it('refuses a service it holds no price for, rather than sending an uncapped request', () => {
    assert.throws(
      () => buildUpstream(body({ model: 'unknown-model' }), 'Bearer sk-test', {}),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('never puts the api key in the body', () => {
    const { init } = buildUpstream(body(), 'Bearer sk-secret', prices);
    assert.equal(init.body.includes('sk-secret'), false);
  });

  it('rejects a malformed Authorization header (not Bearer format)', () => {
    assert.throws(
      () => buildUpstream(body(), 'Basic xyz', prices),
      (e: RelayRejected) => e.status === 401,
    );
  });

  it('rejects a Bearer header with no token', () => {
    assert.throws(
      () => buildUpstream(body(), 'Bearer', prices),
      (e: RelayRejected) => e.status === 401,
    );
  });

  it('refuses an empty price row', () => {
    const emptyPrices = {
      [priceKey(ADDRESS, 'glm-5.2')]: {},
    };
    assert.throws(
      () => buildUpstream(body(), 'Bearer sk-test', emptyPrices),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('refuses a row with zero prices', () => {
    const zeroPrices = {
      [priceKey(ADDRESS, 'glm-5.2')]: { prompt: '0', completion: '0' },
    };
    assert.throws(
      () => buildUpstream(body(), 'Bearer sk-test', zeroPrices),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('refuses a row with only prompt price (completion-only cap leaves prompt unbounded)', () => {
    const promptOnly = {
      [priceKey(ADDRESS, 'glm-5.2')]: { prompt: '0.0000009' },
    };
    assert.throws(
      () => buildUpstream(body(), 'Bearer sk-test', promptOnly),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('refuses a row with only completion price (prompt-only cap leaves completion unbounded)', () => {
    const completionOnly = {
      [priceKey(ADDRESS, 'glm-5.2')]: { completion: '0.000003' },
    };
    assert.throws(
      () => buildUpstream(body(), 'Bearer sk-test', completionOnly),
      (e: RelayRejected) => e.status === 400,
    );
  });
});
