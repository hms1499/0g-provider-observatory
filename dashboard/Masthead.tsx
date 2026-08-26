import type { ReactNode } from 'react';

/**
 * The instrument's own header: what was read, and under what conditions.
 *
 * Every panel opens with one. An observatory publishes a reading taken at a moment, and the
 * conditions belong above the figures rather than inside them — but the stronger reason is
 * that the four panels are four instruments on one bench, not four pages. The same frame at
 * the top of each is what says so.
 *
 * A reading is a label and a value, nothing else. Anything that needs a sentence goes in the
 * `note` row underneath, which spans the full width so prose never competes with figures for
 * column space.
 */
export function Masthead(props: {
  readings: ReadonlyArray<{ label: string; value: ReactNode }>;
  note?: { label: string; value: ReactNode };
}) {
  return (
    <div className="masthead">
      {props.readings.map((r) => (
        <div className="reading" key={r.label}>
          <span className="label">{r.label}</span>
          <span className="value">{r.value}</span>
        </div>
      ))}
      {props.note && (
        <div className="reading provenance">
          <span className="label">{props.note.label}</span>
          <span className="value">{props.note.value}</span>
        </div>
      )}
    </div>
  );
}
