/**
 * What the page shows while it is still reading.
 *
 * Not decoration. Measured before this existed, the **first load** scored a CLS of 0.49 — five
 * times Google's "good" threshold and twice its "poor" one — in a single jolt at 2423ms. The
 * cause was structural: while the chain read was in flight `main` held one line of text and the
 * caveats block, so the caveats sat near the top of a short page; when the ledger arrived, two
 * thousand pixels of tables were inserted above them and everything the reader was looking at
 * jumped off screen. It reads 0.0007 now.
 *
 * **That figure is the page load, and only the page load.** Switching tabs also moves a great
 * deal of layout, and driving those switches from a script scores 0.2 to 0.5 — but a real
 * pointer click sets `hadRecentInput` on every shift that follows it, so a browser excludes
 * them and a reader's own CLS for a tab switch is 0. Verified both ways. The skeletons on the
 * Measure and Reproducibility panels are therefore not there to fix a number; they are there
 * because a reader who has just opened a tab should see the shape of what is coming rather
 * than one line of prose and a blank page. Do not tune them against a synthetic-click score.
 *
 * So the skeleton's job is not to look busy. It is to put the primer and the masthead at the
 * Y positions they will still occupy once the data lands, so that what a reader is reading at
 * second one is still under their eyes at second three.
 *
 * **A placeholder must not look like a reading.** These bars are drawn in `--rule`, the same
 * ink as the lines between rows, and never in the ink figures are set in. Nothing here shows a
 * number, a zero, or a dash — a dash means "measured and withheld" everywhere else on this
 * site, and borrowing it for "not fetched yet" would collide with the one distinction the
 * project spends the most words defending.
 *
 * The pulse is the smallest thing that separates "still working" from "rendered wrong", and it
 * is off under `prefers-reduced-motion`. There is no shimmer sweeping across it: an instrument
 * that animates while it has nothing to report is performing rather than measuring.
 */
import { Primer } from './Primer.js';

/** A bar standing where a value will be. `w` is a CSS length. */
export function Bar({ w = '100%', className }: { w?: string; className?: string }) {
  return <span className={`skel${className ? ` ${className}` : ''}`} style={{ width: w }} />;
}

/**
 * A masthead with its labels and no figures yet.
 *
 * Every panel opens with one, so every panel can reserve its height the same way. The labels
 * are known before the read — they are what the panel is about to report — and only the values
 * are pending, which is exactly the shape a skeleton should have.
 */
export function MastheadSkeleton({
  labels,
  note,
  valueWidth = '7ch',
}: {
  labels: readonly string[];
  note?: string;
  valueWidth?: string;
}) {
  return (
    <div className="masthead">
      {labels.map((label) => (
        <div className="reading" key={label}>
          <span className="label">{label}</span>
          <span className="value">
            <Bar w={valueWidth} />
          </span>
        </div>
      ))}
      {note !== undefined && (
        <div className="reading provenance">
          <span className="label">{note}</span>
          <span className="value">
            <Bar w="28ch" />
          </span>
        </div>
      )}
    </div>
  );
}

/** Rows shaped like a measurement table's, to stand where one will. */
export function RowsSkeleton({ rows = 3, heading }: { rows?: number; heading?: boolean }) {
  return (
    <div className="skel-rows">
      {heading === true && (
        <h3>
          <Bar w="20ch" />
        </h3>
      )}
      {Array.from({ length: rows }, (_, row) => (
        <div className="skel-row" key={row}>
          <Bar w="22ch" />
          <Bar w="6ch" />
          <Bar w="5ch" />
          <Bar w="5ch" />
        </div>
      ))}
    </div>
  );
}

/**
 * The Providers panel, at the size it is about to be.
 *
 * The masthead is reproduced exactly rather than approximated: same four readings, same
 * provenance row, so its height is the real height and nothing below it moves when the figures
 * arrive.
 *
 * The group blocks are deliberately generic — two of them, three rows each. The real roster is
 * ten services across four groups today, but hardcoding four would be asserting a fact about
 * the epoch before reading it, and the pinned roster is a decision that can change. Two blocks
 * fill the fold, which is all a skeleton has to do.
 */
export function ProvidersSkeleton({ rpcUrl }: { rpcUrl: string }) {
  return (
    <section aria-busy="true">
      {/*
        Shaped like the lede, which is what lands here: a line of conditions, two sentences of
        reading, and the findings block under its rule. The masthead this replaced was four
        small readings, so the real content arrived taller than its placeholder and pushed the
        primer down by the difference — the shift this whole file exists to remove.
      */}
      <div className="lede">
        <p className="where">
          <Bar w="22ch" />
        </p>
        <p className="reach">
          <Bar w="min(38ch, 100%)" />
        </p>
        <p className="compare">
          <Bar w="min(34ch, 100%)" />
        </p>
        <div className="found">
          <h2>
            <Bar w="12ch" />
          </h2>
          <p className="note">
            <Bar w="min(30ch, 100%)" />
          </p>
        </div>
        <p className="provenance">
          <Bar w="26ch" />
        </p>
      </div>

      {/*
        The real primer, not a placeholder for one. It needs nothing from the chain and opens
        to several hundred pixels, so leaving it out would mean inserting it later and pushing
        everything under it down.
      */}
      <Primer />

      <p className="grouping">Reading the ledger from {rpcUrl}…</p>

      {[0, 1].map((block) => (
        <article className="group" key={block}>
          <h3>
            <span className="model">
              <Bar w="18ch" />
            </span>
          </h3>
          <RowsSkeleton />
        </article>
      ))}
    </section>
  );
}
