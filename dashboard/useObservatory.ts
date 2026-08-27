import { useEffect, useState } from 'react';
import { ObservatoryReader, type EpochRecord, type ProviderRecord } from '../src/chain/registry.js';
import { mapWithConcurrency } from '../src/chain/concurrency.js';
import { isDeployed, type NetworkConfig } from './networks.js';

export interface ObservatoryData {
  state: 'loading' | 'error' | 'ready' | 'not-deployed';
  error?: string;
  epochs: number[];
  providers: ProviderRecord[];
  latest?: EpochRecord;
  /** The transaction that published `latest`, so the view can link every number to a source. */
  latestTxHash?: string | null;
  /**
   * Every published epoch, newest last. Starts as just the newest and fills in behind it —
   * see the second phase below.
   */
  records: EpochRecord[];
  /** Whether the epochs behind the newest one have finished arriving. */
  history: 'loading' | 'ready';
}

const EMPTY: ObservatoryData = {
  state: 'loading',
  epochs: [],
  providers: [],
  records: [],
  history: 'loading',
};

/**
 * Read the ledger for one network. Every failure is surfaced as an error state rather than
 * an empty table: an RPC that is down must never render as a provider with no data.
 *
 * **Two phases, on purpose.** The newest epoch and the provider list come first and the page
 * renders from them; the epochs behind it arrive afterwards and fill in the series. Reading
 * all of them before the first paint would put every additional epoch between the reader and
 * the page, and this series is meant to reach fourteen — the load would grow with the
 * project's own success. Everything on the page is readable during the second phase; the only
 * thing missing is the history line, and the panel says it is still loading rather than
 * drawing a short series as though it were the whole one.
 *
 * The history failing is not the page failing. A second-phase error leaves `history` at
 * `loading` and the epoch that already rendered stays on screen — the alternative is throwing
 * away a good reading because a later request timed out.
 */
export function useObservatory(net: NetworkConfig): ObservatoryData {
  const [data, setData] = useState<ObservatoryData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    setData(EMPTY);

    if (!isDeployed(net)) {
      setData({ ...EMPTY, state: 'not-deployed' });
      return;
    }

    (async () => {
      const reader = new ObservatoryReader(net.rpcUrl, {
        providerRegistry: net.providerRegistry,
        measurementRegistry: net.measurementRegistry,
      });

      try {
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
        setData({
          state: 'ready',
          epochs,
          providers,
          latest: latest ?? undefined,
          latestTxHash,
          records: latest ? [latest] : [],
          history: epochs.length > 1 ? 'loading' : 'ready',
        });
      } catch (e: any) {
        if (cancelled) return;
        setData({ ...EMPTY, state: 'error', error: String(e?.message ?? e) });
        return;
      }

      // Second phase: the rest of the series, four at a time so a fourteen-epoch history does
      // not open fourteen connections at once against a public RPC that is known to blip.
      try {
        const epochs = await reader.epochsOf(net.prober);
        const older = epochs.slice(0, -1);
        const rest = await mapWithConcurrency(older, 4, (e) => reader.readEpoch(e, net.prober));
        if (cancelled) return;
        setData((d) => {
          if (d.state !== 'ready') return d;
          const byEpoch = new Map<number, EpochRecord>();
          for (const r of [...rest.filter((r): r is EpochRecord => r !== null), ...d.records]) {
            byEpoch.set(r.epoch, r);
          }
          return {
            ...d,
            records: [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch),
            history: 'ready',
          };
        });
      } catch {
        // Deliberately swallowed: the page already has an epoch on it. See the note above.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [net]);

  return data;
}

/**
 * The transaction that published one epoch.
 *
 * Fetched on demand rather than for every epoch up front: `epochTxHash` is a log query across
 * the whole chain, and running one per epoch would put fourteen of them on the first paint to
 * fill in thirteen links nobody has clicked yet.
 *
 * Null covers three different things — not asked, not arrived, not found — and the caller
 * treats them the same way, by rendering the words without a link rather than a broken one.
 */
export function useEpochTxHash(net: NetworkConfig, epoch: number | null): string | null {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHash(null);
    if (epoch === null || !isDeployed(net)) return;

    const reader = new ObservatoryReader(net.rpcUrl, {
      providerRegistry: net.providerRegistry,
      measurementRegistry: net.measurementRegistry,
    });
    reader
      .epochTxHash(epoch, net.prober)
      .then((h) => {
        if (!cancelled) setHash(h);
      })
      .catch(() => {
        // A missing link is not a missing measurement. The figures stand either way.
      });

    return () => {
      cancelled = true;
    };
  }, [net, epoch]);

  return hash;
}
