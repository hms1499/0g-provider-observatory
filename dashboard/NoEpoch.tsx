import type { NetworkConfig } from './networks.js';
import { newestEpoch, type EpochView } from './selectEpoch.js';

/**
 * What the Providers panel says when the epoch the address named is not on the page.
 *
 * It says which epoch was asked for, and it does not show another one in its place. The panel
 * used to fall back to the newest record, which put a different run's figures under a
 * different run's timestamp while the address bar went on naming the epoch the reader had
 * followed a link to. Nothing on screen contradicted it.
 *
 * Each case names what is actually true and stops there — still arriving, did not come back,
 * never published here — because they call for different things from a reader: waiting,
 * trying again, or checking which chain the link came from.
 *
 * The way back to the newest epoch is a button rather than an automatic redirect. Moving the
 * reader somewhere they did not ask to go is the behaviour this panel is replacing, and doing
 * it with a smooth transition instead of a silent substitution would not make it honest.
 */
export function NoEpoch(props: {
  view: Exclude<EpochView, { state: 'record' }>;
  net: NetworkConfig;
  /** Every epoch this prober has published on this chain. */
  epochs: readonly number[];
  onNewest: () => void;
}) {
  const { view, net } = props;

  if (view.state === 'empty') {
    return <p>No epochs have been written on {net.name} yet.</p>;
  }

  const newest = newestEpoch(props.epochs);

  return (
    <div className="no-epoch">
      {view.state === 'arriving' && (
        <p>
          Reading epoch {view.epoch} from {net.rpcUrl}. It was published on {net.name}; the
          epochs behind the newest one arrive after the page does, and this is one of them.
        </p>
      )}

      {view.state === 'unreadable' && (
        <p>
          Epoch {view.epoch} is listed as published on {net.name}, but its record did not come
          back from {net.rpcUrl}. That is a read that failed, not a measurement that is
          missing — the record is on chain either way, and reloading may well produce it.
        </p>
      )}

      {view.state === 'absent' && (
        <p>
          This prober has not published epoch {view.epoch} on {net.name}. An epoch number names
          a different run on each chain, so a link made on one chain names nothing on the
          other; if this link came from testnet, switch chains rather than epochs.
          {newest !== null && ` The newest epoch here is ${newest}.`}
        </p>
      )}

      {newest !== null && view.state !== 'arriving' && (
        <p>
          <button onClick={props.onNewest}>Show the newest epoch</button>
        </p>
      )}
    </div>
  );
}
