import { useState } from 'react';
import { NETWORKS, type NetworkKey } from './networks.js';
import { Providers } from './Providers.js';
import { useObservatory } from './useObservatory.js';

export default function App() {
  const [key, setKey] = useState<NetworkKey>('testnet');
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
      </header>

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
      {data.state === 'ready' && data.latest && (
        <Providers
          net={net}
          epoch={data.latest}
          providers={data.providers}
          txHash={data.latestTxHash ?? null}
        />
      )}
      {data.state === 'ready' && !data.latest && (
        <p>No epochs have been written on {net.name} yet.</p>
      )}
    </main>
  );
}
