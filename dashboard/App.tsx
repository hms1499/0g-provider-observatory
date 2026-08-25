import { useState } from 'react';
import { Caveats } from './Caveats.js';
import { DEFAULT_NETWORK, NETWORKS, type NetworkKey } from './networks.js';
import { Providers } from './Providers.js';
import { Reproduce } from './Reproduce.js';
import { useObservatory } from './useObservatory.js';
import { Verify } from './Verify.js';

export default function App() {
  const [key, setKey] = useState<NetworkKey>(DEFAULT_NETWORK);
  const [panel, setPanel] = useState<'providers' | 'verify' | 'reproduce'>('providers');
  const net = NETWORKS[key];
  const data = useObservatory(net);

  return (
    <main>
      <header>
        <h1>0G Provider Observatory</h1>
        <p>An independent measurement layer for 0G&rsquo;s inference network.</p>
        <nav>
          {(['testnet', 'mainnet'] as NetworkKey[]).map((k) => (
            <button key={k} onClick={() => setKey(k)} aria-pressed={k === key}>
              {NETWORKS[k].name}
            </button>
          ))}
        </nav>
        <nav>
          <button onClick={() => setPanel('providers')} aria-pressed={panel === 'providers'}>
            Providers
          </button>
          <button onClick={() => setPanel('verify')} aria-pressed={panel === 'verify'}>
            Verify
          </button>
          <button onClick={() => setPanel('reproduce')} aria-pressed={panel === 'reproduce'}>
            Reproducibility
          </button>
        </nav>
      </header>

      {net.seeded && (
        <p>
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

      <Caveats />
    </main>
  );
}
