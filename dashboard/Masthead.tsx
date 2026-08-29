import type { ReactNode } from 'react';

/**
 * A reading, and the conditions it was taken under.
 *
 * This opened all four panels once, on the argument that they are four instruments on one
 * bench rather than four pages and the same frame at the top of each is what says so. The
 * argument was right about the four panels and wrong about the frame: what each masthead
 * actually held was a row of scalars a reader had just read somewhere else on the same screen.
 *
 * Providers dropped its four when the lede replaced them — `census.ts` records why, and the
 * short version is that `420 calls` was the most prominent number on the project's front page.
 * Reproducibility's four were the two selects above it and the sentence below it. Measure's
 * five were the epoch named in bold two paragraphs up and the text of the option showing in
 * its own select. A frame around figures already on screen is not a summary; it is the same
 * figures at a second size.
 *
 * One use is left, and it is the shape this was always right for: Measure's price, which is
 * computed rather than repeated, with the sentence about who pays for it underneath. What
 * says the panels are one bench is the series strip they now share — see `EpochRuler.tsx`.
 *
 * A reading is a label and a value, nothing else. Anything that needs a sentence goes in the
 * `note` row underneath, which spans the full width so prose never competes with figures for
 * column space.
 */
export function Masthead(props: {
  readings: ReadonlyArray<{ label: string; value: ReactNode; hint?: string }>;
  note?: { label: string; value: ReactNode };
}) {
  return (
    <div className="masthead">
      {props.readings.map((r) => (
        <div className="reading" key={r.label}>
          <span className="label">
            {r.hint ? <abbr title={r.hint}>{r.label}</abbr> : r.label}
          </span>
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
