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
}) {
  const groups = groupByModel(props.epoch, props.providers);
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

  return (
    <section>
      <div className="masthead">
        <div className="reading">
          <span className="label">epoch</span>
          <span className="value">{props.epoch.epoch}</span>
        </div>
        <div className="reading">
          <span className="label">observed</span>
          <span className="value">{utc(props.epoch.writtenAt)}</span>
        </div>
        <div className="reading">
          <span className="label">services</span>
          <span className="value">
            {measured} <span className="of">of {registered}</span>
          </span>
        </div>
        <div className="reading">
          <span className="label">calls</span>
          <span className="value">{calls}</span>
        </div>
        <div className="reading provenance">
          <span className="label">published in</span>
          <span className="value">
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
          </span>
        </div>
      </div>

      <p>
        Grouped by model, so the providers serving one model can be read against each other —
        that comparison is what a divergence figure means. Nothing is averaged across a group:
        the spread between providers is the finding, not noise to summarise away. Models are
        grouped by the exact string the registry records, never guessed to be the same thing.
      </p>

      {groups.map((g) => (
        <ModelBlock key={g.model} group={g} net={props.net} lo={lo} hi={hi} />
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

function ModelBlock(props: { group: ModelGroup; net: NetworkConfig; lo: number; hi: number }) {
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

      <table>
        <thead>
          <tr>
            <th>operator</th>
            <th>mode</th>
            <th className="num">
              p50 <span className="unit">s</span>
            </th>
            <th className="num">
              p95 <span className="unit">s</span>
            </th>
            <th className="num">errors</th>
            <th className="num">divergence</th>
            <th className="num">calls</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => (
            <Row
              key={r.providerId}
              row={r}
              net={props.net}
              lo={props.lo}
              hi={props.hi}
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
  isReference: boolean;
}) {
  const { row } = props;
  return (
    <tr>
      <td>
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
      <td>
        <ModeBadge mode={row.mode} />
      </td>
      <Duration ms={row.p50Ms} lo={props.lo} hi={props.hi} />
      <Duration ms={row.p95Ms} lo={props.lo} hi={props.hi} />
      <td className="num">{formatBps(row.errorRateBps)}</td>
      <td className="num">{formatBps(row.divergenceBps)}</td>
      <td className="num">{row.calls}</td>
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
function Duration(props: { ms: number; lo: number; hi: number }) {
  const at = scalePosition(props.ms, props.lo, props.hi);
  return (
    <td className="num dur">
      <span className="figure">{formatSeconds(props.ms)}</span>
      {at !== null && (
        <span className="track" aria-hidden="true">
          <span className="tick" style={{ left: `${(at * 100).toFixed(1)}%` }} />
        </span>
      )}
    </td>
  );
}
