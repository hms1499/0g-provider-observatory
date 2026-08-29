import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isTheme, readTheme, themeAttribute, THEME_KEY, writeTheme } from '../theme.js';

/** A `localStorage` that works, and one that throws on every access the way a locked-down
 *  browser does. Both are what this module has to survive. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    seen: map,
  };
}

const throwingStorage = {
  getItem() {
    throw new DOMException('blocked');
  },
  setItem() {
    throw new DOMException('blocked');
  },
  removeItem() {
    throw new DOMException('blocked');
  },
};

describe('isTheme', () => {
  it('accepts the three grounds', () => {
    assert.ok(isTheme('system') && isTheme('light') && isTheme('dark'));
  });

  it('rejects anything else', () => {
    assert.ok(!isTheme('night'));
    assert.ok(!isTheme(''));
    assert.ok(!isTheme(null));
    assert.ok(!isTheme(undefined));
  });
});

describe('readTheme', () => {
  it('is system when nothing was ever chosen', () => {
    assert.equal(readTheme(fakeStorage()), 'system');
  });

  it('returns what was stored', () => {
    assert.equal(readTheme(fakeStorage({ [THEME_KEY]: 'dark' })), 'dark');
  });

  it('is system for a value it does not recognise', () => {
    // Storage is editable by the reader and writable by an older version of this page. A
    // stray string must not leave the document on a ground with no tokens defined for it.
    assert.equal(readTheme(fakeStorage({ [THEME_KEY]: 'sepia' })), 'system');
  });

  it('is system where storage throws rather than returning null', () => {
    // Private windows and browsers set to block site data throw on access.
    assert.equal(readTheme(throwingStorage), 'system');
  });

  it('is system where there is no storage at all', () => {
    assert.equal(readTheme(null), 'system');
  });
});

describe('writeTheme', () => {
  it('stores an explicit choice', () => {
    const s = fakeStorage();
    writeTheme(s, 'light');
    assert.equal(s.seen.get(THEME_KEY), 'light');
  });

  it('stores system as the absence of a choice', () => {
    // Otherwise the page could never tell "chose system" from "never chose", which is the
    // difference the default depends on.
    const s = fakeStorage({ [THEME_KEY]: 'dark' });
    writeTheme(s, 'system');
    assert.equal(s.seen.has(THEME_KEY), false);
  });

  it('does not throw where storage does', () => {
    assert.doesNotThrow(() => writeTheme(throwingStorage, 'dark'));
  });

  it('round-trips every ground', () => {
    for (const t of ['light', 'dark', 'system'] as const) {
      const s = fakeStorage();
      writeTheme(s, t);
      assert.equal(readTheme(s), t);
    }
  });
});

describe('themeAttribute', () => {
  it('carries no attribute for system', () => {
    // A stamped attribute would freeze the page on whichever ground the system was showing
    // when it loaded, and stop following it when the reader's system flips at sunset.
    assert.equal(themeAttribute('system'), null);
  });

  it('names the ground for an explicit choice', () => {
    assert.equal(themeAttribute('light'), 'light');
    assert.equal(themeAttribute('dark'), 'dark');
  });
});
