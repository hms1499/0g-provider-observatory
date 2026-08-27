/**
 * A latency ratio, and where it sits against parity.
 *
 * The same track the Providers panel puts under a duration, reading a different quantity —
 * one instrument answering the page's three questions rather than three different charts.
 * Centre is 1.0x: the two runs agreed. The tick says how far from agreement, never which run
 * was right, because nothing in the evidence says which one caught a bad minute.
 */
import { ratioPosition } from './rows.js';

export function RatioCell({ ratio, label }: { ratio: number; label: string }) {
  const at = ratioPosition(ratio);
  return (
    <td className="num dur" role="cell" data-label={label}>
      <span className="figure">{ratio.toFixed(2)}&times;</span>
      {at !== null && (
        <span className="track parity" aria-hidden="true">
          <span className="tick" style={{ left: `${(at * 100).toFixed(1)}%` }} />
        </span>
      )}
    </td>
  );
}
