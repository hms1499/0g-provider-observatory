/**
 * F6 — pick a provider by independent measurement, straight from the chain.
 *
 * Reads the ledger directly. No API of ours sits in the path, and there is nothing to sign up
 * for: the same guarantee the dashboard makes, kept for code instead of for a browser. If this
 * project disappeared tomorrow the records would still be there and this file would still work
 * against them.
 *
 * **It does not call the Router and never sees a key.** It answers one question — which address
 * to pin — and the caller makes their own request with their own credentials:
 *
 *     const pick = await pickProvider({ model: 'glm-5.2', mode: 'TeeML' });
 *     if (!pick.best) throw new Error('nothing met those criteria');
 *
 *     await fetch('https://router-api.0g.ai/v1/chat/completions', {
 *       method: 'POST',
 *       headers: {
 *         authorization: `Bearer ${process.env.ROUTER_API_KEY}`,
 *         'content-type': 'application/json',
 *         'X-0G-Provider-Address': pick.best.address,
 *       },
 *       body: JSON.stringify({ model: pick.best.model, messages }),
 *     });
 *
 * Used alongside the Router, never as a replacement for it.
 */
import { ObservatoryReader, type EpochRecord, type ProviderRecord } from '../chain/registry.js';
import { mapWithConcurrency } from '../chain/concurrency.js';
import { select, type Criteria, type Sample, type Selection, type ServiceHistory } from './select.js';

export * from './select.js';

/** 0G Aristotle mainnet, and the prober whose series this is. */
export const MAINNET = {
  rpcUrl: 'https://evmrpc.0g.ai',
  providerRegistry: '0x25165feDACd1B78e103c3B49FcAF7CAeB118b9D6',
  measurementRegistry: '0xF2fC195A72Ed74e09530b31C568c1e0CBF6c0333',
  prober: '0x691Bb0Cc823A03f7dcaF272Dc62896668f81D2FD',
} as const;

export interface PickOptions extends Criteria {
  /**
   * How many of the newest epochs to pool. Default 5.
   *
   * Not 1, deliberately. At fifteen probes a single epoch's p95 *is* its slowest call, so a
   * decision taken on one epoch is a decision taken on one unlucky minute. More epochs cost
   * one chain read each and buy the only thing that makes a percentile mean anything.
   */
  epochs?: number;
  /** Override for testnet, a fork, or a second prober's series. */
  network?: {
    rpcUrl: string;
    providerRegistry: string;
    measurementRegistry: string;
    prober: string;
  };
}

export interface PickResult extends Selection {
  /** Epochs actually read, newest last. Fewer than asked for when fewer exist. */
  window: number[];
}

/**
 * Read the newest epochs and apply the criteria.
 *
 * Two reads to find the window, then one per epoch, four at a time — the public RPC is known
 * to revert reads it should answer, and `ObservatoryReader` already retries each one.
 */
export async function pickProvider(options: PickOptions): Promise<PickResult> {
  const net = options.network ?? MAINNET;
  const reader = new ObservatoryReader(net.rpcUrl, {
    providerRegistry: net.providerRegistry,
    measurementRegistry: net.measurementRegistry,
  });

  const [published, providers] = await Promise.all([
    reader.epochsOf(net.prober),
    reader.loadProviders(),
  ]);

  const window = published.slice(-Math.max(1, options.epochs ?? 5));
  const records = (
    await mapWithConcurrency(window, 4, (e) => reader.readEpoch(e, net.prober))
  ).filter((r): r is EpochRecord => r !== null);

  return { ...select(toHistories(records, providers), options), window };
}

/**
 * Turn epoch records into one history per service.
 *
 * **Keyed on (address, model), never on address.** An operator serves several models —
 * `0xF203A388` serves both `glm-5.2` and `qwen3.7-plus` — and pooling their readings by
 * address would mix two different services into one set of figures. That is the defect this
 * whole project exists to point at, and it has already been shipped once in this codebase by
 * accident, in the cost estimate.
 */
export function toHistories(
  records: readonly EpochRecord[],
  providers: readonly ProviderRecord[],
): ServiceHistory[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const histories = new Map<string, ServiceHistory>();

  for (const record of records) {
    for (const m of record.measurements) {
      const p = byId.get(m.providerId);
      if (!p || p.model === null) continue;

      const key = `${p.address.toLowerCase()}|${p.model}`;
      let h = histories.get(key);
      if (!h) histories.set(key, (h = { address: p.address, model: p.model, samples: [] }));

      const sample: Sample = {
        epoch: record.epoch,
        writtenAt: record.writtenAt,
        p50Ms: m.p50Ms,
        p95Ms: m.p95Ms,
        errorRateBps: m.errorRateBps,
        divergenceBps: m.divergenceBps,
        calls: m.calls,
        observedMode: m.observedMode,
      };
      h.samples.push(sample);
    }
  }

  return [...histories.values()];
}
