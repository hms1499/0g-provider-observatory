/**
 * Which ground the page is drawn on, and who decided.
 *
 * The palette had two grounds from the start and no way to ask for either. A reader whose
 * system is set to light never saw the dark one, and — the case that matters for this project
 * — neither did anyone reading the page over somebody's shoulder in a demo.
 *
 * **Three states, not two.** A two-way toggle silently makes a choice on the reader's behalf
 * the first time they load the page: whatever it is showing becomes a decision they did not
 * make, and there is no way back to "whatever my system says". `system` is the default and
 * stays reachable, which is the state most readers actually want.
 *
 * **Stored, not inferred.** The choice is the reader's and it is kept in `localStorage` under
 * one key. Nothing about it reaches the network — this page holds no key and calls no server
 * of ours, and a preference is not the place to start.
 *
 * Every function here is pure or takes its storage as an argument, so the behaviour can be
 * tested without a browser. `apply()` is the only one that touches the document.
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** The single key this page writes. Named for the project so it cannot collide on a shared origin. */
export const THEME_KEY = 'observatory:theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/**
 * The stored choice, or `system` when there is none.
 *
 * Anything unrecognised is `system` too. The value comes out of storage a reader can edit and
 * a previous version of this page may have written, and a stray string must not leave the page
 * on a ground with no tokens defined for it.
 */
export function readTheme(storage: Pick<Storage, 'getItem'> | null): Theme {
  if (!storage) return 'system';
  try {
    const raw = storage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : 'system';
  } catch {
    // Private windows and blocked site data throw on access rather than returning null. A
    // reader who cannot store a preference should still get a page, on their system ground.
    return 'system';
  }
}

export function writeTheme(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, theme: Theme) {
  if (!storage) return;
  try {
    // `system` is the absence of a choice, so it is stored as one. Writing the string would
    // work and would also mean this page could never tell "chose system" from "never chose",
    // which is the difference the default depends on.
    if (theme === 'system') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, theme);
  } catch {
    // Same as above: a preference that cannot be saved still applies for this visit.
  }
}

/**
 * The value for the root element's `data-theme`, or null to carry no attribute at all.
 *
 * `system` carries none, so the stylesheet's `prefers-color-scheme` query is what answers —
 * and it keeps answering as the reader's system flips at sunset, which a stamped attribute
 * would stop doing.
 */
export function themeAttribute(theme: Theme): string | null {
  return theme === 'system' ? null : theme;
}

/** Put a choice on the document. The one impure function here. */
export function apply(root: HTMLElement, theme: Theme) {
  const value = themeAttribute(theme);
  if (value === null) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', value);
}
