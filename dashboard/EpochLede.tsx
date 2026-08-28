import type { ReactNode } from 'react';
import type { EpochCensus } from './census.js';
import type { Observation } from './findings.js';

/**
 * What this epoch measured, and what it found, above everything else on the page.
 *
 * The panel used to open with a manual. Nine hundred pixels of first screen held a block
 * explaining the four tabs, then four readings about the run, then two paragraphs of method —
 * and not one measurement. A reader arriving at a site called an observatory saw no
 * observation until they scrolled.
 *
 * So the lede states three things in the order a reader wants them: how much of the network
 * answered, how much of it can be checked at all, and what stood out. Every number in it is
 * counted from the same groups the tables below are drawn from, so the summary and the detail
 * cannot drift apart.
 *
 * **The second sentence is the one that matters, and it is not flattering to the network.**
 * Most models on this network are served by a single provider, and a lone provider cannot be
 * checked against anything. Stating it is not an accusation — it is the measurement this
 * instrument exists to take, and the reason the divergence column reads 0% on rows where
 * nothing was compared. It is said plainly, with no adjective attached to it.
 *
 * **"Nothing stood out" is a finding.** An epoch where every comparable provider agreed inside
 * the instrument's own repeatability is a real result, and epoch 496620 is one. Rendering an
 * empty space there would read as a page that failed to load rather than a network that
 * behaved.
 */
export function EpochLede(props: {
  census: EpochCensus;
  observations: readonly Observation[];
  /** The epoch picker, built by the panel that owns the epoch state. */
  picker: ReactNode;
  observedAt: string;
  network: string;
  /** Links back to the transaction and the evidence this reading came from. */
  provenance: ReactNode;
}) {
  const c = props.census;
  const notReached = Math.max(0, c.registered - c.measured);

  return (
    <div className="lede">
      <p className="where">
        <span className="epoch">epoch {props.picker}</span>
        <span className="sep" aria-hidden="true">
          ·
        </span>
        {props.observedAt}
        <span className="sep" aria-hidden="true">
          ·
        </span>
        {props.network}
      </p>

      {/* Two sentences, not one with a clause wedged into it. Written as
          "…answered, N could not be reached, serving M models between them" the last phrase
          attached itself to the services that did NOT answer, which is the opposite of what
          it counts. */}
      <p className="reach">
        {c.measured} of {c.registered} registered service{c.registered === 1 ? '' : 's'}{' '}
        answered, serving {c.models} model{c.models === 1 ? '' : 's'} between them.
        {notReached > 0 && (
          <>
            {' '}
            The other {notReached} could not be reached.
          </>
        )}
      </p>

      <p className="compare">{comparability(c)}</p>

      <div className="found">
        <h2>{props.observations.length > 0 ? 'What stood out' : 'Nothing stood out'}</h2>
        {props.observations.length > 0 ? (
          <>
            <ul>
              {props.observations.map((o) => (
                <li key={o.text}>{o.text}</li>
              ))}
            </ul>
            <p className="note">
              Observations, not verdicts. Each names a service and a number and stops there —
              why two providers of one model differ is not a question this instrument can
              answer.
            </p>
          </>
        ) : (
          <p className="note">
            {c.comparable === 0
              ? 'No model in this epoch had a second provider, so there was nothing for a difference to show up between.'
              : 'No two providers of the same model differed by more than this instrument repeats to on its own.'}
          </p>
        )}
      </div>

      <p className="provenance">
        {c.calls} call{c.calls === 1 ? '' : 's'} · {props.provenance}
      </p>
    </div>
  );
}

/**
 * How much of this epoch could be compared at all, as a sentence.
 *
 * Three cases, because one sentence with numbers substituted into it is wrong in two of them:
 * "only 0 of 21" reads as a failure of the instrument rather than a fact about the roster, and
 * "only 21 of 21" is not a caveat at all.
 */
function comparability(c: EpochCensus): string {
  if (c.models === 0) return 'This epoch measured no service this page can name.';
  if (c.comparable === 0) {
    return `Every one of those ${c.models} is served by a single provider, so nothing in this epoch had a peer to be checked against.`;
  }
  if (c.lone === 0) {
    return `Every one of those ${c.models} has at least two providers, so every measurement here could be checked against a peer.`;
  }
  return (
    `Only ${c.comparable} of those ${c.models} ${c.comparable === 1 ? 'has' : 'have'} a second provider. ` +
    `The other ${c.lone} ${c.lone === 1 ? 'has' : 'have'} nothing to be checked against.`
  );
}
