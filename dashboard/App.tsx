import { useEffect, useRef, useState } from 'react';
import { Caveats } from './Caveats.js';
import { Measure } from './Measure.js';
import { DEFAULT_NETWORK, NETWORKS, type NetworkKey } from './networks.js';
import { Providers } from './Providers.js';
import { Reproduce } from './Reproduce.js';
import { SiteFooter } from './SiteFooter.js';
import { SiteHeader, type Panel } from './SiteHeader.js';
import { useEpochTxHash, useObservatory } from './useObservatory.js';
import { Verify } from './Verify.js';

export default function App() {
  const [key, setKey] = useState<NetworkKey>(DEFAULT_NETWORK);
  const [panel, setPanel] = useState<Panel>('providers');
  const net = NETWORKS[key];
  const data = useObservatory(net);

  // Null means "whichever is newest", so the page keeps following the series as epochs are
  // published rather than pinning itself to the epoch that happened to be newest on load.
  // Reset with the chain, because an epoch number on mainnet names a different run on testnet.
  const [chosen, setChosen] = useState<number | null>(null);
  useEffect(() => setChosen(null), [key]);

  /*
   * A tab is a different section, so it starts at its beginning.
   *
   * Without this the scroll position carried across, and since these panels are thousands of
   * pixels long a reader deep in the Providers table who pressed Measure landed halfway down
   * it — past the paragraph that tells them their key passes through this site's server, which
   * is the one thing on that panel nobody should arrive below.
   *
   * Instant, not smooth: this is a change of document, not a movement through one, and an
   * animation here would be motion for its own sake.
   */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [panel]);

  const shown =
    (chosen === null ? undefined : data.records.find((r) => r.epoch === chosen)) ?? data.latest;
  const isLatest = shown !== undefined && shown.epoch === data.latest?.epoch;
  // The newest epoch's transaction arrived with it; any other is fetched only when asked for.
  const olderTxHash = useEpochTxHash(net, isLatest || !shown ? null : shown.epoch);

  return (
    <>
      <SiteHeader network={key} onNetwork={setKey} panel={panel} onPanel={setPanel} />

      <main>
        {net.seeded && (
          <p className="notice">
            This chain carries stand-in values from before the prober ran against real
            services. Read it as a record that the contracts work, not as a measurement of
            anything. {NETWORKS.mainnet.name} holds only real runs.
          </p>
        )}

        {data.state === 'loading' && <p>Reading the ledger from {net.rpcUrl}…</p>}
        {data.state === 'not-deployed' && (
          <p>
            The Observatory contracts are not deployed on {net.name} yet. Nothing has been
            measured there, which is different from having measured nothing.
          </p>
        )}
        {data.state === 'error' && (
          <p>Could not read {net.name}: {data.error}. This is a read failure, not a measurement.</p>
        )}
        {data.state === 'ready' && panel === 'providers' && shown && (
          <Providers
            net={net}
            epoch={shown}
            providers={data.providers}
            txHash={isLatest ? data.latestTxHash ?? null : olderTxHash}
            records={data.records}
            history={data.history}
            epochs={data.epochs}
            onEpoch={setChosen}
          />
        )}
        {data.state === 'ready' && panel === 'providers' && !shown && (
          <p>No epochs have been written on {net.name} yet.</p>
        )}
        {data.state === 'ready' && panel === 'verify' && (
          <Verify net={net} epochs={data.epochs} providers={data.providers} />
        )}
        {data.state === 'ready' && panel === 'reproduce' && (
          <Reproduce net={net} epochs={data.epochs} />
        )}
        {data.state === 'ready' && panel === 'measure' && (
          <Measure net={net} epochs={data.epochs} />
        )}

        {/*
          Only here. These notes qualify the figures in the table above them — what a mode
          means, why a p95 at fifteen probes says little, what a dash stands for. On the
          verification panel they explained guarantee modes to a reader rehashing a bundle,
          which is a different question, and took more than half the page doing it.
        */}
        {panel === 'providers' && <Caveats />}
      </main>

      <SiteFooter net={net} />
    </>
  );
}
