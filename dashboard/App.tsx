import { useState } from 'react';
import { Caveats } from './Caveats.js';
import { Measure } from './Measure.js';
import { DEFAULT_NETWORK, NETWORKS, type NetworkKey } from './networks.js';
import { Providers } from './Providers.js';
import { Reproduce } from './Reproduce.js';
import { SiteFooter } from './SiteFooter.js';
import { SiteHeader, type Panel } from './SiteHeader.js';
import { useObservatory } from './useObservatory.js';
import { Verify } from './Verify.js';

export default function App() {
  const [key, setKey] = useState<NetworkKey>(DEFAULT_NETWORK);
  const [panel, setPanel] = useState<Panel>('providers');
  const net = NETWORKS[key];
  const data = useObservatory(net);

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
        {data.state === 'ready' && panel === 'providers' && data.latest && (
          <Providers
            net={net}
            epoch={data.latest}
            providers={data.providers}
            txHash={data.latestTxHash ?? null}
          />
        )}
        {data.state === 'ready' && panel === 'providers' && !data.latest && (
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

        <Caveats />
      </main>

      <SiteFooter net={net} />
    </>
  );
}
