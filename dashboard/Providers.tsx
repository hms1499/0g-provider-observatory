import { bundleUrl, explorerAddress, explorerTx, type NetworkConfig } from './networks.js';
import {
  formatBps,
  formatSeconds,
  groupByModel,
  groupByOperator,
  scalePosition,
  shortAddress as short,
  type ModelGroup,
  type ProviderRow,
} from './rows.js';
import { censusOf } from './census.js';
import { EpochLede } from './EpochLede.js';
import { EpochNotes } from './EpochNote.js';
import { epochNotesFor } from './epochNotes.js';
import { EpochRuler } from './EpochRuler.js';
import { seriesFor, seriesScale, type SeriesPoint } from './history.js';
import { ticksOf } from './ruler.js';
import { newestEpoch, type HistoryState } from './selectEpoch.js';
import { Bar } from './Skeleton.js';
import { Sparkline } from './Sparkline.js';
import { Primer } from './Primer.js';
import { observe } from './findings.js';
import { ModeBadge } from './ModeBadge.js';
import { isUnmeasured } from '../src/chain/encoding.js';
import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function Providers(props: {
  net: NetworkConfig;
  epoch: EpochRecord;
  providers: readonly ProviderRecord[];
  /** The transaction that published this epoch, so every row traces to a source. */
  txHash: string | null;
  /** Every epoch read so far, newest last. One member while the series is still arriving. */
  records: readonly EpochRecord[];
  /** How far the epochs behind the newest one have got. */
  history: HistoryState;
  /** Every epoch this prober has published, whether or not its record has arrived. */
  epochs: readonly number[];
  onEpoch: (epoch: number) => void;
}) {
  const groups = groupByModel(props.epoch, props.providers);
  const observations = observe(groups);
  const gaps = groupByOperator(props.epoch, props.providers).filter((g) => g.unmeasured.length > 0);
  const census = censusOf(groups, props.providers);

  // One scale for the whole epoch, so a tick means the same thing in every group. Built from
  // both columns together: p50 and p95 sharing a track is what makes a service's spread — the
  // distance between its own two ticks — legible at a glance.
  const durations = props.epoch.measurements
    .flatMap((m) => [m.p50Ms, m.p95Ms])
    .filter((ms) => ms > 0);
  const lo = durations.length > 0 ? Math.min(...durations) : 0;
  const hi = durations.length > 0 ? Math.max(...durations) : 0;

  // One scale across every service's series, for the reason `seriesScale` gives: a per-row
  // scale would draw a provider that moved by 100ms with the same profile as one that moved
  // by 38 seconds.
  const series = new Map<number, SeriesPoint[]>(
    props.epoch.measurements.map((m) => [m.providerId, seriesFor(m.providerId, props.records)]),
  );
  const [seriesLo, seriesHi] = seriesScale([...series.values()]);

  return (
    <section>
      {/*
        The reading first, the manual after it.
        
        `Primer` used to stand here, above everything, so the first screen of a site called an
        observatory held an explanation of its own tabs and no observation. It is unchanged and
        still open by default — a reader who has never seen this project needs it — but it now
        follows the one thing they came for. One screen of scrolling either way; the difference
        is which of the two a stranger meets first.
      */}
      <EpochLede
        census={census}
        observations={observations}
        observedAt={utc(props.epoch.writtenAt)}
        network={props.net.name}
        epoch={
          <EpochSelect
            epochs={props.epochs}
            selected={props.epoch.epoch}
            pending={props.history === 'loading'}
            onEpoch={props.onEpoch}
          />
        }
        picker={
          <EpochRuler
            ticks={ticksOf(props.epochs, props.records)}
            marks={[{ epoch: props.epoch.epoch }]}
            label="Which published epoch to read"
            pending={props.history === 'loading'}
            onEpoch={props.onEpoch}
          />
        }
        provenance={
          <>
            published in{' '}
            {props.txHash ? (
              <a href={explorerTx(props.net, props.txHash)} target="_blank" rel="noreferrer">
                one transaction
              </a>
            ) : (
              'one transaction'
            )}
            , derived from{' '}
            <a href={bundleUrl(props.net, props.epoch.storageRoot)} target="_blank" rel="noreferrer">
              this evidence
            </a>
          </>
        }
      />

      {/*
        Above the readings, not under them. A caveat a reader meets after they have drawn a
        conclusion from the table has arrived too late to be a caveat.
      */}
      <EpochNotes notes={epochNotesFor(props.net.chainId, [props.epoch.epoch])} />

      <Primer />

      <p className="grouping">
        Grouped by the exact model string the registry records. Nothing is averaged across a
        group — the spread between its providers is the finding, not noise to summarise away.
      </p>

      {props.records.length > 1 && (
        <p className="grouping series-note">
          The history column carries each service&rsquo;s p50 across all{' '}
          {props.records.length} published epochs, oldest on the left, on one scale shared by
          every row. A flat line is a service that held steady, not a service with no readings;
          the line breaks where an epoch measured nothing for it.
        </p>
      )}

      {groups.map((g) => (
        <ModelBlock
          key={g.model}
          group={g}
          net={props.net}
          lo={lo}
          hi={hi}
          series={series}
          seriesLo={seriesLo}
          seriesHi={seriesHi}
          at={props.epoch.epoch}
          history={props.history}
        />
      ))}

      {gaps.length > 0 && (
        <div className="gaps">
          <h3>Registered, not measured this epoch</h3>
          <p>
            A service is left out when we could not reach it, or when too few calls succeeded
            to support a number. It stays listed here: a measurement that did not happen is
            different from a service that does not exist.
          </p>
          <dl>
            {gaps.map((g) => (
              <div key={g.address}>
                <dt>
                  <a
                    href={explorerAddress(props.net, g.address)}
                    target="_blank"
                    rel="noreferrer"
                    title={g.address}
                  >
                    {short(g.address)}
                  </a>
                </dt>
                <dd>{g.unmeasured.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function ModelBlock(props: {
  group: ModelGroup;
  net: NetworkConfig;
  lo: number;
  hi: number;
  series: ReadonlyMap<number, SeriesPoint[]>;
  seriesLo: number;
  seriesHi: number;
  at: number;
  history: HistoryState;
}) {
  const { group } = props;
  const modes = [...new Set(group.rows.map((r) => r.mode))].sort();

  return (
    <article className="group">
      <h3>
        <span className="model">{group.model}</span>
        <span className="census">
          {group.rows.length} {group.rows.length === 1 ? 'provider' : 'providers'} ·{' '}
          {modes.join(' + ')}
        </span>
      </h3>

      {/*
        A lone group is three different situations wearing one shape, and the row count cannot
        tell them apart — only the divergence field can.

        `divergenceLookup` stores a plain 0 for a service that was never grouped: "no divergence
        entry at all was never grouped, so 0 is the measured truth for it". The sentinel means
        something else entirely — grouped, compared, but the noise floor the comparison must be
        corrected against was never measured. And a real figure on a service sitting alone means
        it WAS compared, against peers the registry files under a different model string: the
        prober groups by the Router's `canonical_id`, this page groups by the exact string on
        chain, and the two disagree on the live network at `glm-5` / `zai-org/GLM-5-FP8`.

        The 0 case is the one that needed saying most. Fourteen of the twenty-one blocks in the
        first wide epoch are lone services reading 0%, and a reader who takes that for "agreed
        with its peers" has read the opposite of what happened.

        One ambiguity is left standing rather than papered over: a split-string service whose
        answers genuinely matched would also store 0, and nothing in the record separates that
        from never having been compared. It cannot occur on the network as it stands.
      */}
      {group.rows.length === 1 && (
        <p className="aside">
          {isUnmeasured(group.rows[0]!.divergenceBps) ? (
            <>
              This service was compared, but the noise floor that the comparison has to be
              corrected against was not measured this epoch, so its divergence column reads as
              a gap rather than as a figure the evidence does not support.
            </>
          ) : group.rows[0]!.divergenceBps === 0 ? (
            <>
              One provider serves this model in this epoch, so nothing was compared against it.
              Its divergence reads 0% because there was nothing to differ from — not because
              its answers matched another provider&rsquo;s.
            </>
          ) : (
            <>
              One provider serves this model under this exact name, but a divergence figure was
              published for it: the prober compared it against services the registry records
              under a different string for the same model. The figure is real; the providers it
              was measured against are in another block on this page.
            </>
          )}
        </p>
      )}

      <table className="readings" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">operator</th>
            <th role="columnheader">
              {/*
                This used to end "see the notes at the foot of the page", which was a direction
                and not a route: the notes were two thousand pixels down with nothing pointing
                at them. Each badge in the column below now takes the reader there, so the
                header says which thing to press rather than where to go looking.
              */}
              <abbr title="What the operator's registry entry declares about how this model is run. A kind of guarantee, never a grade. Press any badge in this column for what its mode means.">
                mode
              </abbr>
            </th>
            <th className="num" role="columnheader">
              <abbr title="Median response time. Half this service's calls came back faster than this.">
                p50
              </abbr>{' '}
              <span className="unit">s</span>
            </th>
            <th className="num" role="columnheader">
              <abbr title="At 15 probes per service, p95 is this service's slowest call in this epoch. It carries almost no tail information until epochs are pooled.">
                p95
              </abbr>{' '}
              <span className="unit">s</span>
            </th>
            <th className="num" role="columnheader">
              <abbr title="Share of calls that failed in a way attributed to the provider, including one that did not answer inside the 60-second ceiling this prober sets — a call that never came back is counted against the service, though the deadline is ours. Excluded as ours: an answer cut off by the output ceiling we chose, and a request the Router refused before it reached the service.">
                errors
              </abbr>
            </th>
            <th className="num" role="columnheader">
              <abbr title="How often this service's answers differed from other providers of the same model, after subtracting how often it disagrees with itself. A dash means it could not be measured, not that it was zero.">
                divergence
              </abbr>
            </th>
            <th className="num" role="columnheader">
              <abbr title="Probe calls this service answered in this epoch.">calls</abbr>
            </th>
            <th className="num" role="columnheader">
              <abbr title="This service's p50 across every epoch published so far, oldest on the left. The line breaks at an epoch that measured nothing for it, and the upright mark is the epoch shown in this table.">
                history
              </abbr>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {group.rows.map((r) => (
            <Row
              key={r.providerId}
              row={r}
              net={props.net}
              lo={props.lo}
              hi={props.hi}
              series={props.series.get(r.providerId) ?? []}
              seriesLo={props.seriesLo}
              seriesHi={props.seriesHi}
              at={props.at}
              history={props.history}
              isReference={group.referenceAddress === r.address}
            />
          ))}
        </tbody>
      </table>
    </article>
  );
}

function Row(props: {
  row: ProviderRow;
  net: NetworkConfig;
  lo: number;
  hi: number;
  series: readonly SeriesPoint[];
  seriesLo: number;
  seriesHi: number;
  at: number;
  history: HistoryState;
  isReference: boolean;
}) {
  const { row } = props;
  return (
    <tr role="row">
      <td role="cell">
        <a
          href={explorerAddress(props.net, row.address)}
          target="_blank"
          rel="noreferrer"
          title={row.address}
        >
          {short(row.address)}
        </a>
        {props.isReference && (
          <span
            className="reference"
            title="Attested in an enclave, so divergence for the rest of this group was measured against it."
          >
            reference
          </span>
        )}
      </td>
      <td role="cell" data-label="mode">
        <ModeBadge mode={row.mode} />
      </td>
      <Duration label="p50 s" ms={row.p50Ms} lo={props.lo} hi={props.hi} />
      <Duration label="p95 s" ms={row.p95Ms} lo={props.lo} hi={props.hi} />
      <td className="num" role="cell" data-label="errors">
        {formatBps(row.errorRateBps)}
      </td>
      <td className="num" role="cell" data-label="divergence">
        {formatBps(row.divergenceBps)}
      </td>
      <td className="num" role="cell" data-label="calls">
        {row.calls}
      </td>
      {props.history === 'loading' && (
        // The series arrives in a second pass, so this cell is the one thing on a finished row
        // still waiting. A bar the width of the drawing keeps the column from resizing under a
        // reader when ten of them fill in at once.
        <td className="num spark" role="cell" data-label="history">
          <Bar w="96px" />
        </td>
      )}
      {props.history === 'failed' && (
        // The epochs behind the newest one did not arrive. Drawing what did would put a line
        // through an unknown number of missing readings and let it read as the whole series —
        // the same claim the broken line in `Sparkline` exists to avoid making.
        <td className="num spark" role="cell" data-label="history">
          <span
            className="none"
            title="The earlier epochs could not be read from the chain, so there is no series to draw. This says nothing about the figures in this row, which came from the epoch shown above."
          >
            —
          </span>
        </td>
      )}
      {props.history === 'ready' && (
        <Sparkline series={props.series} lo={props.seriesLo} hi={props.seriesHi} at={props.at} />
      )}
    </tr>
  );
}

/**
 * A duration and where it sits on the epoch's scale.
 *
 * The tick is the same ink for every provider, in every group. It reports how long a call
 * took, never whether that is good — colouring it by value would rank the operators, and the
 * operators here are the people running this network.
 */
function Duration(props: { label: string; ms: number; lo: number; hi: number }) {
  const at = scalePosition(props.ms, props.lo, props.hi);
  return (
    <td className="num dur" role="cell" data-label={props.label}>
      <span className="figure">{formatSeconds(props.ms)}</span>
      {at !== null && (
        <span className="track" aria-hidden="true">
          <span className="tick" style={{ left: `${(at * 100).toFixed(1)}%` }} />
        </span>
      )}
    </td>
  );
}

/**
 * Which epoch the table is reading, as an exact control.
 *
 * The ruler beside it is the better picture and the worse target. Two of these epochs are an
 * hour apart on an axis spanning four days — about ten pixels — and a hit area cannot be both
 * 24px wide, which is the smallest a pointer target may be, and narrow enough to belong to one
 * of them. Overlapping them would let a click land on the epoch next to the one aimed at, and
 * a page showing figures the address bar does not name is the defect `selectEpoch.ts` exists
 * to remove.
 *
 * So the strip keeps the series and the arrow keys, and this keeps the guarantee: a native
 * control, full size, works on a phone, and lists every epoch by number.
 */
function EpochSelect(props: {
  epochs: readonly number[];
  selected: number;
  pending: boolean;
  onEpoch: (epoch: number) => void;
}) {
  if (props.epochs.length <= 1) return <>{props.selected}</>;
  const newest = newestEpoch(props.epochs);

  return (
    <span className="epoch-picker">
      <select
        aria-label="Which epoch to read"
        value={props.selected}
        disabled={props.pending}
        onChange={(e) => props.onEpoch(Number(e.target.value))}
      >
        {[...props.epochs]
          .sort((a, b) => b - a)
          .map((e) => (
            <option key={e} value={e}>
              {e}
              {e === newest ? ' · newest' : ''}
            </option>
          ))}
      </select>
    </span>
  );
}
