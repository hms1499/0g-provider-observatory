/**
 * One service's readings across every published epoch.
 *
 * The page used to read the whole epoch list off the chain and then show exactly one of them —
 * `epochs.at(-1)`. That threw away the only thing this project claims nobody else has: a
 * series. "How did this provider behave last week" is one of the three questions the product
 * exists to answer, and the page could not answer it about an hour ago.
 *
 * Two rules hold here, both inherited from the ledger rather than invented for the drawing.
 *
 * **A gap is not a zero.** An epoch that did not measure a service produces `null`, never 0.
 * A missing reading is not a fast one, and a line drawn straight through the gap would assert
 * a measurement nobody took.
 *
 * **Nothing is ranked.** These are magnitudes over time in one ink. The series says what was
 * measured and when, and never whether it was good.
 */
import type { EpochRecord } from '../src/chain/registry.js';

export interface SeriesPoint {
  epoch: number;
  /** Null where this epoch published no measurement for this service. */
  p50Ms: number | null;
}

/**
 * A service's p50 across the epochs given, in chronological order.
 *
 * Every epoch appears, including the ones that measured nothing for this service, so the
 * spacing of the series is the spacing of the ledger. Dropping the empty ones would draw four
 * hourly readings and a two-day gap as five evenly spaced points.
 */
export function seriesFor(providerId: number, records: readonly EpochRecord[]): SeriesPoint[] {
  return [...records]
    .sort((a, b) => a.epoch - b.epoch)
    .map((r) => {
      const m = r.measurements.find((x) => x.providerId === providerId);
      return { epoch: r.epoch, p50Ms: m && m.p50Ms > 0 ? m.p50Ms : null };
    });
}

/** How many of a series' points carry a reading. Below two there is no line to draw. */
export function measuredCount(series: readonly SeriesPoint[]): number {
  return series.filter((p) => p.p50Ms !== null).length;
}

export interface SparkSegment {
  /** `x y` pairs for one unbroken run of readings, ready for an SVG polyline. */
  points: Array<{ x: number; y: number }>;
}

/**
 * A series as SVG coordinates, broken into segments at every gap.
 *
 * Segments rather than one polyline because a gap must interrupt the line. Joining across it
 * would draw a measurement between two epochs that nobody took.
 *
 * `x` is the point's position in the series, so an epoch that measured nothing still occupies
 * its slot and the line's slope stays honest. `y` is inverted for SVG — 0 is the top — and
 * scaled logarithmically for the same reason the duration tracks are: within one series the
 * spread runs to more than an order of magnitude, and a linear scale flattens everything below
 * the slowest reading onto the floor.
 */
export function sparkSegments(
  series: readonly SeriesPoint[],
  lo: number,
  hi: number,
  width: number,
  height: number,
): SparkSegment[] {
  if (series.length < 2 || !(lo > 0) || !(hi > 0) || hi < lo) return [];

  const span = Math.log(hi) - Math.log(lo);
  const y = (ms: number) => {
    // A flat series — every reading identical — has nowhere to sit but the middle.
    if (span <= 0) return height / 2;
    const at = (Math.log(Math.min(Math.max(ms, lo), hi)) - Math.log(lo)) / span;
    return height - at * height;
  };

  const segments: SparkSegment[] = [];
  let current: Array<{ x: number; y: number }> = [];

  series.forEach((p, i) => {
    if (p.p50Ms === null) {
      if (current.length > 0) segments.push({ points: current });
      current = [];
      return;
    }
    current.push({ x: (i / (series.length - 1)) * width, y: y(p.p50Ms) });
  });
  if (current.length > 0) segments.push({ points: current });

  return segments;
}

/**
 * The scale a set of series should share: the lowest and highest reading across all of them.
 *
 * One scale for the whole panel, exactly as the duration tracks do it. Scaling each service to
 * its own range would draw a provider that varied between 2.2 and 2.3 seconds with the same
 * dramatic profile as one that varied between 2 and 40, which is a chart that lies about
 * magnitude while looking precise.
 */
export function seriesScale(all: ReadonlyArray<readonly SeriesPoint[]>): [number, number] {
  const values = all.flat().flatMap((p) => (p.p50Ms === null ? [] : [p.p50Ms]));
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}
