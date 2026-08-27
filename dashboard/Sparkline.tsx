/**
 * One service's p50 across every published epoch.
 *
 * Drawn in the same single ink as the duration tracks, for the same reason: the line reports
 * magnitude over time, and colouring it by value would rank the operators.
 *
 * The line breaks at every epoch that measured nothing for this service. It would be easy to
 * join across the gap and get a smoother drawing, and the smoother drawing would be a claim
 * about a measurement nobody took.
 *
 * The epoch currently on the page is marked, so a reader can see which point in the series
 * the table's figures belong to.
 */
import { measuredCount, sparkSegments, type SeriesPoint } from './history.js';
import { formatSeconds } from './rows.js';

const WIDTH = 96;
const HEIGHT = 18;
/* The epoch marker is a stroke with width, so a mark on the first or last epoch would be
   drawn half outside the box. The line is plotted inside this inset instead of against the
   edges, which costs four pixels and keeps every mark whole. */
const INSET = 2;
const PLOT = WIDTH - INSET * 2;

export function Sparkline(props: {
  series: readonly SeriesPoint[];
  lo: number;
  hi: number;
  /** The epoch the table around this line is showing. */
  at: number;
}) {
  const segments = sparkSegments(props.series, props.lo, props.hi, PLOT, HEIGHT);
  const measured = measuredCount(props.series);

  // One reading is a point in time, not a series. Saying so is more useful than drawing a
  // single dot and letting it read as a flat line.
  if (segments.length === 0 || measured < 2) {
    return (
      <td className="num spark" role="cell" data-label="history">
        <span className="none" title="This service has been measured in fewer than two epochs, so there is no series to draw yet.">
          {measured === 1 ? 'one epoch' : '—'}
        </span>
      </td>
    );
  }

  const index = props.series.findIndex((p) => p.epoch === props.at);
  const markerX = index < 0 ? null : (index / (props.series.length - 1)) * PLOT;

  const values = props.series.flatMap((p) => (p.p50Ms === null ? [] : [p.p50Ms]));
  const label = `p50 across ${props.series.length} epochs, ${formatSeconds(
    Math.min(...values),
  )}s to ${formatSeconds(Math.max(...values))}s${
    measured < props.series.length ? `, measured in ${measured} of them` : ''
  }`;

  return (
    <td className="num spark" role="cell" data-label="history">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <g transform={`translate(${INSET} 0)`}>
          {markerX !== null && (
            <line className="at" x1={markerX} y1={0} x2={markerX} y2={HEIGHT} />
          )}
          {segments.map((s, i) => (
            <polyline
              key={i}
              className="line"
              points={s.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            />
          ))}
          {/* A reading either side of a gap is a segment of one point, which a polyline draws
              as nothing at all. The dots make every reading visible whether or not it has a
              neighbour to be joined to. */}
          {segments
            .flatMap((s) => s.points)
            .map((p, i) => (
              <circle key={i} className="dot" cx={p.x} cy={p.y} r={1.1} />
            ))}
        </g>
      </svg>
    </td>
  );
}
