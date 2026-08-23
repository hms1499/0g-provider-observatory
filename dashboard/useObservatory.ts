import { useEffect, useState } from 'react';
import { ObservatoryReader, type EpochRecord, type ProviderRecord } from '../src/chain/registry.js';
import { isDeployed, type NetworkConfig } from './networks.js';

export interface ObservatoryData {
  state: 'loading' | 'error' | 'ready' | 'not-deployed';
  error?: string;
  epochs: number[];
  providers: ProviderRecord[];
  latest?: EpochRecord;
  /** The transaction that published `latest`, so the view can link every number to a source. */
  latestTxHash?: string | null;
}

const EMPTY: ObservatoryData = { state: 'loading', epochs: [], providers: [] };

/**
 * Read the ledger for one network. Every failure is surfaced as an error state rather than
 * an empty table: an RPC that is down must never render as a provider with no data.
 */
export function useObservatory(net: NetworkConfig): ObservatoryData {
  const [data, setData] = useState<ObservatoryData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    setData(EMPTY);

    if (!isDeployed(net)) {
      setData({ state: 'not-deployed', epochs: [], providers: [] });
      return;
    }

    (async () => {
      try {
        const reader = new ObservatoryReader(net.rpcUrl, {
          providerRegistry: net.providerRegistry,
          measurementRegistry: net.measurementRegistry,
        });
        const [epochs, providers] = await Promise.all([
          reader.epochsOf(net.prober),
          reader.loadProviders(),
        ]);
        const newest = epochs.at(-1);
        const [latest, latestTxHash] =
          newest === undefined
            ? [undefined, null]
            : await Promise.all([
                reader.readEpoch(newest, net.prober),
                reader.epochTxHash(newest, net.prober),
              ]);
        if (cancelled) return;
        setData({ state: 'ready', epochs, providers, latest: latest ?? undefined, latestTxHash });
      } catch (e: any) {
        if (cancelled) return;
        setData({ state: 'error', error: String(e?.message ?? e), epochs: [], providers: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [net]);

  return data;
}
