/**
 * The published series as a chart record, and — where a panel wants one — the control that
 * moves between its readings.
 *
 * This replaced a `<select>` on the Providers panel, then turned out to be the answer to a
 * problem three panels shared. The series was drawn four different ways in one document: a
 * strip here, a wall of ten identical chips on Verify, two dropdowns on Reproducibility, and a
 * sentence on Measure. Same ten epochs, four presentations, and only one of them said anything
 * about the series. It is one drawing now.
 *
 * A dropdown and a chip grid are both lists of numbers: evenly spaced, identical in size.
 * Every one of those properties is false of the series being listed — the runs are hours or
 * days apart, and they measured ten services or thirty. `ruler.ts` carries the arithmetic and
 * the argument; this file draws it.
 *
 * **Height is roster width, and that is not a score.** A tall tick measured more services than
 * a short one. It is a fact about which roster the prober sent, decided by a `--all` flag and
 * a budget, and it says nothing about any operator measured. Nothing on this page may rank the
 * operators, and nothing here does.
 *
 * **Why height at all.** `docs/HANDOFF.md` forbids describing two arbitrary epochs as "two
 * runs of the same roster", because for most pairs on this chain that is false. A reader
 * cannot keep a rule they cannot see. Two ticks of the same height are two runs of the same
 * width, and the eye finds that pairing before it reads a number. That is why the
 * Reproducibility panel marks both of its epochs on one strip: the question it exists to ask
 * is whether the pair can be compared at all.
 *
 * **Two modes.** With `onEpoch` the ticks are real buttons over the drawing, so focus, hit
 * area and the keyboard work the way the platform already makes them work, and arrow keys move
 * the reading. Without it the strip is a drawing and nothing else — which is what a panel
 * wants when its own controls set the marks.
 */
import { useLayoutEffect, useRef } from 'react';
import { gapsIn, spanLabel, tallestRun, type Tick } from './ruler.js';

const HEIGHT = 58;
/** Room under the baseline for the dashed mark that spans a break. */
const BASELINE = 46;
/*
 * The plot is inset from the box, the way `Sparkline` insets its own.
 *
 * The newest epoch sits at x=1 by construction and its tick is the heaviest stroke on the
 * strip, so drawn against the edge half of it was clipped — the one reading a visitor is
 * most likely to be looking at was the one drawn incomplete.
 */
const INSET = 1.5;
const PLOT = 100 - INSET * 2;
/**
 * The shortest a tick is ever drawn, as a fraction of the tallest.
 *
 * An epoch whose record has not arrived has no width to draw, and a ten-service run against a
 * thirty-service one would otherwise be a third of a tick — small enough to read as an
 * artefact. Every published epoch is a real run and is drawn as one.
 */
const FLOOR = 0.26;
/*
 * Assumed strip width in pixels, for sizing the hit areas from fractional positions.
 *
 * Deliberately a constant rather than a measured width: the ruler sits in a container that is
 * 72rem at most, the figure only ever narrows a target, and measuring would mean a resize
 * observer and a re-render for a control whose whole job is to be clicked.
 */
const WIDEST_PX = 1000;
/*
 * How far apart two marks must be, as a fraction of the axis, for both to be labelled.
 *
 * A word at 0.62rem mono runs about 45px, and the strip is roughly 1080px on a desktop
 * container, so two labels need something over 0.08 of the axis between them. The first
 * attempt used 0.18, which hid the labels on the default pair — 496620 and 496636 are 0.16
 * apart, a comfortable 170 pixels. Below this the pair is close enough that the two words
 * would touch; the narrow-viewport case is the stylesheet's, which has the width for free.
 */
const LABEL_GAP = 0.08;

const day = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hour = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:00`;

/**
 * An epoch marked on the strip.
 *
 * `label` names what this mark is *for* on the panel doing the marking — "earlier" and "later"
 * on a comparison — and is drawn under the tick. A panel with one mark passes no label,
 * because "the epoch you are reading" is the only thing a lone mark can be.
 */
export interface RulerMark {
  epoch: number;
  label?: string;
}

export function EpochRuler(props: {
  ticks: readonly Tick[];
  /** What is marked. The first is the one the keyboard moves and the tab order lands on. */
  marks: readonly RulerMark[];
  /** Named for the assistive tree — every panel's series answers a different question. */
  label: string;
  /** The older records have not arrived, so choosing one would show an empty table. */
  pending?: boolean;
  /** A run is in flight and the reader may not start a second one. */
  busy?: boolean;
  /** Absent makes the strip a drawing: the panel's own controls set the marks. */
  onEpoch?: (epoch: number) => void;
}) {
  const { ticks, marks, onEpoch } = props;
  const tallest = tallestRun(ticks);
  const gaps = gapsIn(ticks);
  const strip = useRef<HTMLDivElement>(null);
  const primary = marks[0]?.epoch ?? null;

  /*
   * Focus follows the reading, but only when the reader moved it from in here.
   *
   * Two things this must not do. It must not pull focus when the epoch was chosen from
   * somewhere else on the page — the "back to the newest" link the empty states offer would
   * otherwise yank the reader up into this strip. And it must not lose focus when they did
   * use the arrow keys, which is what happened while this asked `contains(activeElement)`
   * after the render: pressing Home moved the selection, the roving tabindex took the old
   * button out of the tab order, and focus was already on `<body>` by the time the check ran —
   * so a keyboard reader was dropped at the top of the document on every jump.
   *
   * The intent is recorded when the key is pressed instead, which is the moment it is known,
   * and a layout effect puts focus back before the browser paints.
   */
  const driving = useRef(false);
  useLayoutEffect(() => {
    if (!driving.current) return;
    driving.current = false;
    strip.current?.querySelector<HTMLButtonElement>(`[data-epoch="${primary}"]`)?.focus();
  }, [primary]);

  // One reading is not a series. The number stands on its own rather than as a lone tick on an
  // axis with no span, which would read as a chart that failed to load.
  if (ticks.length <= 1) {
    return <span className="ruler-single">{primary ?? ticks[0]?.epoch ?? '—'}</span>;
  }

  const move = (delta: number) => {
    if (!onEpoch) return;
    // With nothing marked yet, an arrow key starts at the newest rather than at the oldest,
    // because that is the reading a visitor almost always wants first.
    const i = primary === null ? ticks.length - 1 : ticks.findIndex((t) => t.epoch === primary);
    const next = ticks[Math.min(ticks.length - 1, Math.max(0, i + delta))];
    if (next && next.epoch !== primary) onEpoch(next.epoch);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!onEpoch) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in step) {
      e.preventDefault();
      driving.current = true;
      move(step[e.key]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      driving.current = true;
      onEpoch(ticks[e.key === 'Home' ? 0 : ticks.length - 1].epoch);
    }
  };

  const oldest = ticks[0];
  const newest = ticks[ticks.length - 1];

  /** A tick's position across the plot, in the viewBox's units. */
  const px = (x: number) => INSET + x * PLOT;

  /*
   * Each hit area is as wide as the space around its tick, never wider.
   *
   * A fixed 28px column was ambiguous exactly where this series is densest: 496539 and 496540
   * are one hour apart on a 97-hour axis, about eleven pixels, so two 28px columns overlapped
   * by seventeen and a click between them landed on whichever the browser painted last. The
   * width is half the distance to the nearer neighbour instead, which is the widest a target
   * can be and still belong to one reading. It is still smaller than a pointer target should
   * be, which is why every panel using this keeps an exact control beside it.
   */
  const widths = ticks.map((t, i) => {
    const before = i === 0 ? Infinity : t.x - ticks[i - 1].x;
    const after = i === ticks.length - 1 ? Infinity : ticks[i + 1].x - t.x;
    // `before` and `after` are fractions of the axis, so the strip width converts them to
    // pixels once. Multiplying by 100 first — as if they were percentages — made every gap
    // hundreds of pixels wide, the clamp never bound, and every target stayed at the full 28px.
    return Math.min(28, Math.max(6, Math.min(before, after) * WIDEST_PX * 0.5));
  });

  const markOf = (epoch: number) => marks.findIndex((m) => m.epoch === epoch);

  /*
   * Whether two mark labels have room to sit side by side.
   *
   * A fraction of the axis rather than a pixel measurement, for the reason `WIDEST_PX` gives:
   * measuring would mean a resize observer for a decision that only ever removes a label. The
   * narrow-viewport case is left to the stylesheet, which knows the width for free.
   */
  const spread = marks
    .map((m) => ticks.find((t) => t.epoch === m.epoch)?.x)
    .filter((x): x is number => x !== undefined);
  const labelsFit = spread.length < 2 || Math.max(...spread) - Math.min(...spread) > LABEL_GAP;

  return (
    <div className={`ruler${props.pending ? ' pending' : ''}`}>
      <div
        className="strip"
        ref={strip}
        role={onEpoch ? 'radiogroup' : 'img'}
        aria-label={props.label}
        onKeyDown={onKeyDown}
      >
        <svg
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <line className="axis" x1="0" y1={BASELINE} x2="100" y2={BASELINE} />

          {/* A gap is drawn as an absence with a mark at each end, not as a dashed line
              through it. A line across the gap would be a stroke where there are no readings,
              which is the one thing the sparklines refuse to do for the same reason. */}
          {gaps.map((g) => {
            const from = ticks.find((t) => t.epoch === g.after);
            const to = ticks.find((t) => t.epoch > g.after);
            if (!from || !to) return null;
            return (
              <g className="gap" key={g.after}>
                <line x1={px(from.x)} y1={BASELINE + 5} x2={px(to.x)} y2={BASELINE + 5} />
              </g>
            );
          })}

          {ticks.map((t) => {
            const share = tallest === null || t.measured === null ? 0 : t.measured / tallest;
            const h = (FLOOR + (1 - FLOOR) * share) * (BASELINE - 6);
            const at = markOf(t.epoch);
            return (
              <line
                key={t.epoch}
                /* Every mark is inked the same. A second colour for the second mark was tried
                   and it worked in one theme only: on paper `--ink` against `--muted` is
                   near-black against mid grey, and under the night ground the same pair is
                   #e6e8e5 against #aab5c0 — two light greys, so "marked" and "not marked"
                   nearly collapsed on the panel whose whole question is which two are marked.
                   Nothing is lost by dropping it: the axis is time, so the left mark is the
                   earlier one, and that is what an axis means. */
                className={'tick' + (at >= 0 ? ' at' : '') + (t.measured === null ? ' unread' : '')}
                x1={px(t.x)}
                y1={BASELINE}
                x2={px(t.x)}
                y2={BASELINE - h}
              />
            );
          })}
        </svg>

        {/*
          The break, named where it happened.

          Drawn alone, the two-day gap is half the strip with nothing in it, and an empty half
          of a chart reads as a chart that failed to load. It is the opposite: a stretch where
          no reading exists is a fact about the series, and the ledger cannot be backfilled to
          hide it because it is write-once. So it is labelled in place.

          HTML, not an SVG `<text>`: the drawing is stretched with `preserveAspectRatio: none`,
          which would stretch a glyph with it.
        */}
        {gaps.map((g) => {
          const from = ticks.find((t) => t.epoch === g.after);
          const to = ticks.find((t) => t.epoch > g.after);
          if (!from || !to) return null;
          return (
            <span
              className="gap-label"
              key={g.after}
              style={{ left: `${px((from.x + to.x) / 2)}%` }}
            >
              {Math.round(g.hours / 24)} days, no readings
            </span>
          );
        })}

        {/*
          What each mark is for, under the tick it names.

          Only where a panel marks more than one epoch — a single mark has nothing to be
          distinguished from — and only where the two are far enough apart on the axis to be
          labelled separately. Two epochs an hour apart are about one percent of a four-day
          axis, and "earlier" and "later" set under them run into each other and read as one
          word: at 390px the pair 496620/496636 already printed "earlierlater". A panel that
          marks two epochs has controls naming both directly below the strip, so dropping the
          labels loses nothing; printing them on top of each other would.
        */}
        {marks.length > 1 &&
          labelsFit &&
          marks.map((m) => {
            const t = ticks.find((x) => x.epoch === m.epoch);
            if (!t || !m.label) return null;
            /* Centred on the tick, except where centring would run the word off the strip.
               The newest epoch sits at x=1 by construction, so a mark on it is the common
               case, not an edge case — "later" was drawn half outside the box. */
            const align = t.x > 0.85 ? 'end' : t.x < 0.15 ? 'start' : 'centre';
            return (
              <span
                className="mark-label"
                data-align={align}
                key={m.epoch}
                style={{ left: `${px(t.x)}%` }}
              >
                {m.label}
              </span>
            );
          })}

        {onEpoch &&
          ticks.map((t, i) => (
            <button
              key={t.epoch}
              type="button"
              data-epoch={t.epoch}
              className={markOf(t.epoch) === 0 ? 'hit at' : 'hit'}
              style={{
                left: `${px(t.x)}%`,
                width: `${widths[i]}px`,
                marginLeft: `${-widths[i] / 2}px`,
              }}
              role="radio"
              aria-checked={markOf(t.epoch) === 0}
              /* Roving tabindex: the strip is one control in the tab order, and the arrow keys
                 move within it. Fourteen tab stops for fourteen epochs would make the keyboard
                 path through this page longer than the page. With nothing marked yet the
                 newest tick holds the stop, so tabbing in lands somewhere rather than nowhere. */
              tabIndex={
                (primary === null ? t.epoch === newest.epoch : markOf(t.epoch) === 0) ? 0 : -1
              }
              disabled={props.busy || (props.pending && markOf(t.epoch) !== 0)}
              onClick={() => onEpoch(t.epoch)}
            >
              <span className="sr-only">
                Epoch {t.epoch}, {day(t.at)} {hour(t.at)} UTC,{' '}
                {t.measured === null ? 'still being read' : `${t.measured} services measured`}
              </span>
            </button>
          ))}
      </div>

      <p className="axis-labels">
        <span>
          {day(oldest.at)} {hour(oldest.at)}
        </span>
        <span className="span">
          {ticks.length} epochs over {spanLabel(ticks)}
          {tallest !== null && <> · a taller tick measured more services</>}
        </span>
        <span>
          {day(newest.at)} {hour(newest.at)}
        </span>
      </p>
    </div>
  );
}
