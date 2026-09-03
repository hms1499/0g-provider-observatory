import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { DEFAULT_VIEW, formatHash, parseHash } from '../urlState.js';

describe('parseHash', () => {
  it('reads the default view from an empty hash', () => {
    assert.deepEqual(parseHash(''), DEFAULT_VIEW);
    assert.deepEqual(parseHash('#'), DEFAULT_VIEW);
  });

  it('reads a panel', () => {
    assert.equal(parseHash('#verify').panel, 'verify');
    assert.equal(parseHash('#measure').panel, 'measure');
    assert.equal(parseHash('#pick').panel, 'pick');
  });

  it('reads a pinned epoch — the link this format exists for', () => {
    assert.deepEqual(parseHash('#providers/epoch/496615'), {
      network: 'mainnet',
      panel: 'providers',
      epoch: 496615,
      pickModel: null,
    });
  });

  it('reads a model for the provider picker', () => {
    assert.deepEqual(parseHash('#pick/model/qwen%2Fqwen3-vl-30b-a3b-instruct'), {
      network: 'mainnet',
      panel: 'pick',
      epoch: null,
      pickModel: 'qwen/qwen3-vl-30b-a3b-instruct',
    });
  });

  it('reads a network in front of the panel', () => {
    assert.deepEqual(parseHash('#testnet/verify'), {
      network: 'testnet',
      panel: 'verify',
      epoch: null,
      pickModel: null,
    });
  });

  it('distinguishes no epoch from an epoch, since null means whichever is newest', () => {
    assert.equal(parseHash('#providers').epoch, null);
    assert.equal(parseHash('#providers/epoch/0').epoch, 0);
  });

  it('falls back rather than failing on a hash it does not recognise', () => {
    assert.deepEqual(parseHash('#nonsense'), DEFAULT_VIEW);
    assert.equal(parseHash('#providers/epoch/not-a-number').epoch, null);
    assert.equal(parseHash('#providers/epoch').epoch, null);
    assert.equal(parseHash('#providers/epoch/-1').epoch, null);
    assert.equal(parseHash('#providers/epoch/1.5').epoch, null);
  });

  it('ignores empty segments, so a trailing slash is not a different link', () => {
    assert.deepEqual(parseHash('#/providers//epoch/496615/'), {
      network: 'mainnet',
      panel: 'providers',
      epoch: 496615,
      pickModel: null,
    });
  });
});

describe('formatHash', () => {
  it('names the panel even when it is the default', () => {
    assert.equal(formatHash(DEFAULT_VIEW), '#providers');
  });

  it('omits the default network but writes the other one', () => {
    assert.equal(
      formatHash({ network: 'mainnet', panel: 'verify', epoch: null, pickModel: null }),
      '#verify',
    );
    assert.equal(
      formatHash({ network: 'testnet', panel: 'verify', epoch: null, pickModel: null }),
      '#testnet/verify',
    );
  });

  it('writes a pinned epoch and omits an unpinned one', () => {
    assert.equal(
      formatHash({ network: 'mainnet', panel: 'providers', epoch: 496615, pickModel: null }),
      '#providers/epoch/496615',
    );
    assert.equal(
      formatHash({ network: 'mainnet', panel: 'providers', epoch: null, pickModel: null }),
      '#providers',
    );
  });

  it('writes a picker model as an encoded segment', () => {
    assert.equal(
      formatHash({
        network: 'mainnet',
        panel: 'pick',
        epoch: null,
        pickModel: 'qwen/qwen3-vl-30b-a3b-instruct',
      }),
      '#pick/model/qwen%2Fqwen3-vl-30b-a3b-instruct',
    );
  });

  it('keeps picker model state out of non-picker URLs', () => {
    assert.equal(
      formatHash({ network: 'mainnet', panel: 'providers', epoch: null, pickModel: 'glm-5.2' }),
      '#providers',
    );
  });
});

describe('the two together', () => {
  const views = [
    DEFAULT_VIEW,
    { network: 'testnet', panel: 'reproduce', epoch: null, pickModel: null },
    { network: 'testnet', panel: 'providers', epoch: 496497, pickModel: null },
    { network: 'mainnet', panel: 'measure', epoch: null, pickModel: null },
    { network: 'mainnet', panel: 'providers', epoch: 496615, pickModel: null },
    { network: 'mainnet', panel: 'pick', epoch: null, pickModel: 'glm-5.2' },
  ] as const;

  it('round-trips every view a reader can reach', () => {
    for (const view of views) {
      assert.deepEqual(parseHash(formatHash(view)), view, formatHash(view));
    }
  });
});
