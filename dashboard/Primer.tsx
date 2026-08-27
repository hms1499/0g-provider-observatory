import { useState } from 'react';

const REMEMBERED = 'observatory.primer.open';

/**
 * What this is, for someone who has just arrived.
 *
 * The page was written for a reader who already understood it. Landing cold, the first screen
 * held eight terms — epoch, p50, p95, divergence, TeeML, TeeTLS, reference, "10 of 38" — with
 * every explanation a thousand pixels below, and nothing anywhere saying what the four tabs
 * were for or why a stranger should care.
 *
 * The tabs are the part worth stating out loud, because their order is an argument. They
 * escalate from "show me" to "I do not believe you, let me run it myself", and a reader who
 * sees that reads the whole site differently from one who sees four similar words.
 *
 * The last paragraph exists because the figures outlived the page. They are on chain, so they
 * read from a program as readily as from here — and until it was written down, the only way to
 * find that out was to open the repository. It is a sentence, deliberately: a control on this
 * page that ordered providers by speed would be a league table under this project's own domain,
 * aimed at the people running the network, which is the one thing the site does not build.
 */
export function Primer() {
  /*
   * Read once, at the first render, and then let the DOM own the state.
   *
   * The obvious shape — `open` in React state, written back from the effect — does not work:
   * the browser mutates `details.open` itself when the reader clicks, so React and the DOM end
   * up disagreeing about who owns it, and the panel reopened on every reload with `closed`
   * sitting in storage. Found by reloading and looking, not by reasoning about it.
   *
   * So `open` is an initial value, `onToggle` only records what happened, and nothing tries
   * to control an element the user is already controlling.
   */
  const [initiallyOpen] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED) !== 'closed';
    } catch {
      // A browser told to block site data throws on the accessor itself. A first-time reader
      // needs this block, so the unreadable case opens it.
      return true;
    }
  });

  function remember(open: boolean) {
    try {
      localStorage.setItem(REMEMBERED, open ? 'open' : 'closed');
    } catch {
      /* the choice applies to this view and is not carried forward */
    }
  }

  const tabs: Array<[string, string]> = [
    ['Providers', 'what the last run measured'],
    ['Verify', 'whether those numbers follow from the published evidence'],
    ['Reproducibility', 'whether the instrument gives the same answer twice'],
    ['Measure', 'whether you get the same result running it yourself'],
  ];

  return (
    <details
      className="primer"
      open={initiallyOpen}
      onToggle={(e) => remember((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>How this works</summary>
      <p>
        Every clock hour a prober sends the same 15 probes to each service the Router exposes,
        times them with its own clock, and compares the answers of providers claiming the same
        model. The full transcript goes to 0G Storage; a summary and a pointer to that
        transcript go to a write-once contract on 0G mainnet. This page reads both directly, in
        your browser — no server of ours is between you and the numbers.
      </p>
      <dl className="ladder">
        {tabs.map(([name, does]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{does}</dd>
          </div>
        ))}
      </dl>
      <p className="ladder-note">
        Each tab doubts the one before it. You do not have to take any of it on trust.
      </p>
      <p className="ladder-note">
        These figures also read from code, straight off the chain, with no API of ours in the
        path: <code>pnpm pick glm-5.2</code> picks a provider by them. It invents no ranking of
        its own — you name the field it sorts on, and it reports every service it rejected and
        why.
      </p>
    </details>
  );
}
