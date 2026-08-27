import { useEffect, useRef, useState } from 'react';
import { Caveats } from './Caveats.js';
import { Measure } from './Measure.js';
import { NETWORKS, type NetworkKey } from './networks.js';
import { Providers } from './Providers.js';
import { Reproduce } from './Reproduce.js';
import { SiteFooter } from './SiteFooter.js';
import { SiteHeader, type Panel } from './SiteHeader.js';
import { ProvidersSkeleton } from './Skeleton.js';
import { useEpochTxHash, useObservatory } from './useObservatory.js';
import { formatHash, parseHash } from './urlState.js';
import { Verify } from './Verify.js';

export default function App() {
  /*
   * Which chain, which section, which epoch — read out of the address once, then written back
   * to it as the reader moves. See `urlState.ts` for the format and why it exists; the short
   * version is that a reload used to lose the reader's place and there was no way to send
   * anyone a link to a particular epoch.
   *
   * Read at the first render rather than in an effect, so the first paint is already the view
   * the link asked for. Reading it afterwards would render the default first and then replace
   * it, which is a flash of the wrong epoch on exactly the link that names one.
   */
  const [initial] = useState(() => parseHash(window.location.hash));
  const [key, setKey] = useState<NetworkKey>(initial.network);
  const [panel, setPanel] = useState<Panel>(initial.panel);
  const net = NETWORKS[key];
  const data = useObservatory(net);

  // Null means "whichever is newest", so the page keeps following the series as epochs are
  // published rather than pinning itself to the epoch that happened to be newest on load.
  const [chosen, setChosen] = useState<number | null>(initial.epoch);

  /*
   * Reset the epoch with the chain, because an epoch number on mainnet names a different run
   * on testnet.
   *
   * Guarded by the chain this effect last saw, not by a first-render flag. The first render
   * can already carry an epoch that came out of the link, and so can a hash the reader pastes
   * in later — in both cases the address named the chain and the epoch together, and clearing
   * one of them would break the single address this whole thing exists to make work. `sync`
   * below moves the guard forward for the same reason.
   */
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setChosen(null);
  }, [key]);

  /*
   * The address follows the page. `replaceState`, not `pushState`: the header calls these
   * four panels sections of one document, and a Back button that walked backwards through
   * sections would strand a reader who arrived from somewhere else and wants to leave. What
   * the hash is for is surviving a reload and being copied out of the bar, and replacing does
   * both.
   */
  useEffect(() => {
    const next = formatHash({ network: key, panel, epoch: chosen });
    if (window.location.hash !== next) history.replaceState(null, '', next);
  }, [key, panel, chosen]);

  /*
   * The one direction that is not ours: a reader editing the address bar, or following a
   * second link into a page that is already open. Our own writes replace rather than push, so
   * they raise no `hashchange` and this cannot feed back into itself.
   *
   * It normalises here rather than leaving that to the effect above, because a hash that
   * parses to the view already on screen — `#garbage`, or a link from an older format —
   * changes no state, so nothing downstream would run and the bar would go on describing a
   * page that is not there.
   */
  useEffect(() => {
    const sync = () => {
      const view = parseHash(window.location.hash);
      lastKey.current = view.network;
      setKey(view.network);
      setPanel(view.panel);
      setChosen(view.epoch);
      const canonical = formatHash(view);
      if (window.location.hash !== canonical) history.replaceState(null, '', canonical);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

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

        {/*
          The skeleton stands only where the Providers panel will. The other three tabs are
          mostly prose that renders instantly and a result area a reader has not asked for yet;
          putting a placeholder there would be waiting theatre for a wait that is not happening.
        */}
        {data.state === 'loading' && panel === 'providers' && (
          <ProvidersSkeleton rpcUrl={net.rpcUrl} />
        )}
        {data.state === 'loading' && panel !== 'providers' && (
          <p>Reading the ledger from {net.rpcUrl}…</p>
        )}
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
        {/*
          Held back until there are figures for it to qualify.
          
          This is where the 0.49 came from. Rendered during the read, the caveats sat near the
          top of a short page and were shoved two thousand pixels down the moment the tables
          arrived — the single largest shift on the page, and it moved the only thing a reader
          had to look at while waiting.
        */}
        {panel === 'providers' && data.state === 'ready' && <Caveats />}
      </main>

      <SiteFooter net={net} />
    </>
  );
}
