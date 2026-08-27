import { bundleUrl, explorerAddress, explorerTx, type NetworkConfig } from './networks.js';
import {
  formatBps,
  formatSeconds,
  groupByModel,
  groupByOperator,
  scalePosition,
  type ModelGroup,
  type ProviderRow,
} from './rows.js';
import { Masthead } from './Masthead.js';
import { seriesFor, seriesScale, type SeriesPoint } from './history.js';
import { Bar } from './Skeleton.js';
import { Sparkline } from './Sparkline.js';
import { Primer } from './Primer.js';
import { observe } from './findings.js';
import { ModeBadge } from './ModeBadge.js';
import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';

/** An address is 42 characters and no reader holds one in their head. Enough to tell apart. */
const short = (address: string) => `${address.slice(0, 10)}…${address.slice(-4)}`;

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export function Providers(props: {
  net: NetworkConfig;
  epoch: EpochRecord;
  providers: readonly ProviderRecord[];
  /** The transaction that published this epoch, so every row traces to a source. */
  txHash: string | null;
  /** Every epoch read so far, newest last. One member while the series is still arriving. */
  records: readonly EpochRecord[];
  /** Whether the epochs behind the newest one have finished loading. */
  history: 'loading' | 'ready';
  /** Every epoch this prober has published, whether or not its record has arrived. */
  epochs: readonly number[];
  onEpoch: (epoch: number) => void;
}) {
  const groups = groupByModel(props.epoch, props.providers);
  const observations = observe(groups);
  const gaps = groupByOperator(props.epoch, props.providers).filter((g) => g.unmeasured.length > 0);

  const measured = props.epoch.measurements.length;
  const registered = props.providers.filter((p) => p.model !== null).length;
  const calls = props.epoch.measurements.reduce((n, m) => n + m.calls, 0);

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
      <Primer />

      <Masthead
        readings={[
          {
            label: 'epoch',
            hint: 'One measurement run. The prober takes one per clock hour, and the ledger accepts one record per epoch per prober. Every epoch this prober has published is listed here.',
            value: (
              <EpochPicker
                epochs={props.epochs}
                selected={props.epoch.epoch}
                pending={props.history === 'loading'}
                onEpoch={props.onEpoch}
              />
            ),
          },
          {
            label: 'observed',
            hint: 'When this run was written to the chain.',
            value: utc(props.epoch.writtenAt),
          },
          {
            label: 'services',
            hint: 'Measured this epoch, out of every service registered on chain. A service is not measured when the prober could not reach it, or when too few calls succeeded to support a number.',
            value: (
              <>
                {measured} measured{' '}
                <span className="of">· {registered - measured} not reached</span>
              </>
            ),
          },
          {
            label: 'calls',
            hint: 'Probe calls this epoch made in total, across every service it measured.',
            value: calls,
          },
        ]}
        note={{
          label: 'published in',
          value: (
            <>
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
          ),
        }}
      />

      {observations.length > 0 && (
        <div className="observed">
          <h3>What stands out in this epoch</h3>
          <ul>
            {observations.map((o) => (
              <li key={o.text}>{o.text}</li>
            ))}
          </ul>
          <p>
            Observations, not verdicts. Each names a service and a number and stops there —
            why two providers of one model differ is not a question this instrument can answer.
          </p>
        </div>
      )}

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
                  <a href={explorerAddress(props.net, g.address)} target="_blank" rel="noreferrer">
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
  history: 'loading' | 'ready';
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

      {group.rows.length === 1 && (
        <p className="aside">
          One provider serves this model in this epoch, so there is nothing to diverge from.
          Its divergence column reads as a gap rather than as zero.
        </p>
      )}

      {/*
        Roles are spelled out because the narrow layout below 40rem sets `display` on every
        element here, and a table whose parts are no longer `display: table-*` loses its
        semantics in most engines. Stated explicitly, the columns stay announced as columns at
        every width, while the visual labels come from `data-label` on each cell.
      */}
      <table className="readings" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">operator</th>
            <th role="columnheader">
              <abbr title="What the operator's registry entry declares about how this model is run. A kind of guarantee, never a grade — see the notes at the foot of the page.">
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
              <abbr title="Share of calls that failed in a way attributed to the provider. Failures that were ours — a timeout we set, an output ceiling we chose — are excluded.">
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
  history: 'loading' | 'ready';
  isReference: boolean;
}) {
  const { row } = props;
  return (
    <tr role="row">
      <td role="cell">
        <a href={explorerAddress(props.net, row.address)} target="_blank" rel="noreferrer">
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
      {props.history === 'loading' ? (
        // The series arrives in a second pass, so this cell is the one thing on a finished row
        // still waiting. A bar the width of the drawing keeps the column from resizing under a
        // reader when ten of them fill in at once.
        <td className="num spark" role="cell" data-label="history">
          <Bar w="96px" />
        </td>
      ) : (
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
 * Which epoch the table is reading.
 *
 * A plain `<select>` on purpose. The list is the prober's whole history — the same list
 * `epochsOf` returns on chain, in the same order — and a native control gets keyboard
 * handling, a scrollable list on a phone and screen-reader support without any of it being
 * written here.
 *
 * The newest is marked rather than assumed. A reader arriving on an epoch two days old
 * because they followed a link should be able to see that it is not the current one.
 */
function EpochPicker(props: {
  epochs: readonly number[];
  selected: number;
  /** The older records have not arrived yet, so choosing one would show an empty table. */
  pending: boolean;
  onEpoch: (epoch: number) => void;
}) {
  const newest = props.epochs.at(-1);

  if (props.epochs.length <= 1) return <>{props.selected}</>;

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
      <span className="of">
        {props.pending ? 'reading the series…' : `of ${props.epochs.length} published`}
      </span>
    </span>
  );
}
