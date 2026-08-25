import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { loadPrices, priceTableFrom } from '../prices.js';
import { priceKey } from '../request.js';

const ADDRESS = '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D';

/** The shape /v1/providers really returns, measured 2026-08-25. */
const response = {
  object: 'list',
  data: [
    {
      address: ADDRESS,
      model_id: 'glm-5.2',
      pricing_usd: { prompt: '0.0000009', completion: '0.000003', cached_prompt: '0.00000018' },
    },
  ],
};

describe('priceTableFrom', () => {
  it('keys the advertised prices by the (address, model) pair', () => {
    const table = priceTableFrom(response);
    assert.deepEqual(table[priceKey(ADDRESS, 'glm-5.2')], {
      prompt: '0.0000009',
      completion: '0.000003',
    });
  });

  it('returns an empty table for a response it does not recognise', () => {
    assert.deepEqual(priceTableFrom({ nope: true }), {});
  });
});

describe('loadPrices', () => {
  it('fetches once and serves the cache within the TTL', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return response;
    };
    await loadPrices('Bearer sk-a', fetchJson, 1_000);
    await loadPrices('Bearer sk-b', fetchJson, 30_000);
    assert.equal(calls, 1);
  });

  it('refetches once the TTL has passed', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return response;
    };
    await loadPrices('Bearer sk-a', fetchJson, 100_000);
    await loadPrices('Bearer sk-a', fetchJson, 100_000 + 60_001);
    assert.equal(calls, 2);
  });
});
