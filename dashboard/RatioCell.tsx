/**
 * A latency ratio, and where it sits against parity.
 *
 * The same track the Providers panel puts under a duration, reading a different quantity —
 * one instrument answering the page's three questions rather than three different charts.
 * Centre is 1.0x: the two runs agreed. The tick says how far from agreement, never which run
 * was right, because nothing in the evidence says which one caught a bad minute.
 *
 * **Null is a dash, not a zero.** Where one of the two runs published no figure there is no
 * ratio to take, and the cell says so with the same mark the rest of this site uses for a
 * figure that does not exist. It printed `0.00x` before, which reads as a service that had
 * become infinitely fast — and the cell contradicted itself while doing it, because
 * `ratioPosition` already refuses a non-positive ratio and drew no tick beside the number.
 */
import { ratioPosition } from './rows.js';

export function RatioCell({ ratio, label }: { ratio: number | null; label: string }) {
  const at = ratio === null ? null : ratioPosition(ratio);
  return (
    <td className="num dur" role="cell" data-label={label}>
      {ratio === null ? (
        <span
          className="figure none"
          title="One of the two runs published no figure for this service, so there is no ratio to take. A service that answered no call has no median to divide."
        >
          —
        </span>
      ) : (
        <span className="figure">{ratio.toFixed(2)}&times;</span>
      )}
      {at !== null && (
        <span className="track parity" aria-hidden="true">
          <span className="tick" style={{ left: `${(at * 100).toFixed(1)}%` }} />
        </span>
      )}
    </td>
  );
}
