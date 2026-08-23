import { bundleUrl, explorerAddress, explorerTx, type NetworkConfig } from './networks.js';
import { formatBps, formatMs, groupByOperator, type OperatorGroup } from './rows.js';
import { ModeBadge } from './ModeBadge.js';
import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';

export function Providers(props: {
  net: NetworkConfig;
  epoch: EpochRecord;
  providers: readonly ProviderRecord[];
  /** The transaction that published this epoch, so every row traces to a source. */
  txHash: string | null;
}) {
  const groups = groupByOperator(props.epoch, props.providers);

  return (
    <section>
      <h2>Providers</h2>
      <p>
        One row per provider and model. Numbers are never averaged across the models an
        operator serves — grouping here is for reading, not for arithmetic.
      </p>
      <p>
        Every figure below was published in{' '}
        {props.txHash ? (
          <a href={explorerTx(props.net, props.txHash)} target="_blank" rel="noreferrer">
            one transaction
          </a>
        ) : (
          'one transaction'
        )}{' '}
        and derived from{' '}
        <a href={bundleUrl(props.net, props.epoch.storageRoot)} target="_blank" rel="noreferrer">
          this evidence bundle
        </a>
        .
      </p>
      {groups.map((g) => (
        <OperatorBlock key={g.address} group={g} net={props.net} />
      ))}
    </section>
  );
}

function OperatorBlock({ group, net }: { group: OperatorGroup; net: NetworkConfig }) {
  return (
    <article>
      <h3>
        <a href={explorerAddress(net, group.address)} target="_blank" rel="noreferrer">
          {group.address}
        </a>{' '}
        <span>{group.rows.length > 0 ? `${group.rows.length} measured` : 'not measured this epoch'}</span>
      </h3>
      {group.rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>model</th><th>mode</th><th>p50</th><th>p95</th>
              <th>errors</th><th>divergence</th><th>calls</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r) => (
              <tr key={r.providerId}>
                <td>{r.model}</td>
                <td><ModeBadge mode={r.mode} /></td>
                <td>{formatMs(r.p50Ms)}</td>
                <td>{formatMs(r.p95Ms)}</td>
                <td>{formatBps(r.errorRateBps)}</td>
                <td>{formatBps(r.divergenceBps)}</td>
                <td>{r.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {group.unmeasured.length > 0 && (
        <p>
          Registered but not measured this epoch: {group.unmeasured.join(', ')}. A service
          with too few successful calls is left out rather than published with a number the
          samples do not support.
        </p>
      )}
    </article>
  );
}
