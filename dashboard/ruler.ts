/**
 * The published series, laid out on the axis it actually happened on.
 *
 * The picker used to be a `<select>`, and a `<select>` is a list of numbers. Three things
 * about this series are true, and a list of numbers hides all three:
 *
 * **The epochs are not evenly spaced.** Two days separate 496540 from 496591. In a dropdown
 * that gap is one line break like any other. Positioned by time it is a gap, which is what it
 * was — the prober was not running.
 *
 * **The epochs are not the same width.** The first seven measured ten locked services; 496616
 * probed thirty and 496620 twenty-eight. `docs/HANDOFF.md` is explicit that nothing may
 * describe two arbitrary epochs as "two runs of the same roster", because for most pairs on
 * this chain that is false. A reader cannot honour a rule they cannot see, so the width of a
 * run is the height of its tick and two comparable epochs are two ticks of the same height.
 *
 * **The ledger is append-only.** The series only ever grows to the right, and drawing it on a
 * time axis says so without a sentence.
 *
 * No chain read is needed for the first of those. `MeasurementRegistry.epochOf` is
 * `timestamp / EPOCH_DURATION` with a 3600s duration, so the epoch number *is* the hour, and
 * multiplying it back gives the hour the run belongs to exactly. That is a fact about the
 * contract, not an assumption about the data — see `contracts/MeasurementRegistry.sol:82`.
 *
 * Nothing here encodes how well anything performed. A tick's height is how many services a run
 * measured, which is a fact about our own roster, not about any operator in it.
 */
import type { EpochRecord } from '../src/chain/registry.js';

/** Seconds per epoch, as deployed. `deployments/aristotle-16661.json` records the same value. */
export const EPOCH_SECONDS = 3600;

export interface Tick {
  epoch: number;
  /** 0 at the oldest epoch, 1 at the newest. Position on the time axis, not the index. */
  x: number;
  /**
   * How many services this run measured, or null while its record is still being read.
   *
   * Null is not zero. An epoch whose record has not arrived measured something we have not
   * seen yet; an epoch that measured nothing would be a different fact and is not one this
   * chain carries.
   */
  measured: number | null;
  /** The hour this epoch covers, derived from its number. */
  at: Date;
}

/**
 * The start of the hour an epoch covers.
 *
 * The epoch's record carries `writtenAt`, which is when the transaction landed — a minute or
 * forty into the hour, depending on how long the run took. The axis is drawn from the hour
 * instead so that an epoch nobody has read yet sits in the right place, and so two epochs an
 * hour apart are exactly one hour apart on screen.
 */
export function epochStart(epoch: number): Date {
  return new Date(epoch * EPOCH_SECONDS * 1000);
}

/**
 * Every published epoch as a tick, oldest first.
 *
 * `epochs` is the full published list; `records` is whichever of them have been read. The two
 * are separate arguments because they arrive in two phases and the ruler has to be complete
 * from the first one — a ruler that grew a tick per record would redraw itself under the
 * reader as the history loaded.
 */
export function ticksOf(
  epochs: readonly number[],
  records: readonly EpochRecord[],
): Tick[] {
  if (epochs.length === 0) return [];

  const sorted = [...epochs].sort((a, b) => a - b);
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const span = newest - oldest;

  const measured = new Map<number, number>();
  for (const r of records) measured.set(r.epoch, r.measurements.length);

  return sorted.map((epoch) => ({
    epoch,
    // A single epoch has no span to be positioned within. It sits at the start of the axis
    // rather than at 0.5, because the axis is time and one reading begins the series.
    x: span === 0 ? 0 : (epoch - oldest) / span,
    measured: measured.get(epoch) ?? null,
    at: epochStart(epoch),
  }));
}

/**
 * The tallest run in the series, for the shared scale the ticks are drawn against.
 *
 * Returns null while no record has arrived, which is the state the ruler draws every tick at
 * its floor height in — the positions are known, the widths are not, and guessing a width
 * would be drawing a measurement.
 */
export function tallestRun(ticks: readonly Tick[]): number | null {
  const widths = ticks.flatMap((t) => (t.measured === null ? [] : [t.measured]));
  return widths.length === 0 ? null : Math.max(...widths);
}

/**
 * How far apart in hours two neighbouring ticks are, for the gap annotation.
 *
 * Only gaps worth naming are returned, and the threshold is a full day rather than the twelve
 * hours it started at. At twelve, the mainnet series has three gaps: the two-day break, and
 * two overnight ones of sixteen and seventeen hours. The overnight two are a person not
 * running a command at 3am, and annotating them tells a reader about the operator's sleep
 * rather than about the network. A day or more with no reading is the break that changes how
 * the series should be read, so a day is where the line is.
 */
export const GAP_HOURS = 24;

export function gapsIn(ticks: readonly Tick[]): { after: number; hours: number }[] {
  const out: { after: number; hours: number }[] = [];
  for (let i = 1; i < ticks.length; i += 1) {
    const hours = ticks[i].epoch - ticks[i - 1].epoch;
    if (hours >= GAP_HOURS) out.push({ after: ticks[i - 1].epoch, hours });
  }
  return out;
}

/**
 * The span the ruler covers, as a sentence fragment for the axis label.
 *
 * Days rather than hours once the series passes a day, because "97 hours" is a number a reader
 * has to divide before it means anything, and the question the axis answers is how long this
 * has been watched.
 */
export function spanLabel(ticks: readonly Tick[]): string {
  if (ticks.length === 0) return '';
  if (ticks.length === 1) return 'one epoch';
  const hours = ticks[ticks.length - 1].epoch - ticks[0].epoch;
  if (hours < 48) return hours === 1 ? 'one hour' : `${hours} hours`;
  // Rounded down: a series spanning 97 hours has covered four whole days, not 4.04 of them.
  return `${Math.floor(hours / 24)} days`;
}
