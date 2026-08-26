/**
 * Read side of the on-chain ledger, shared by the verification CLI and the dashboard.
 *
 * Everything here is a plain RPC read. No API of ours sits in the path, which is the
 * point: a third party runs the same calls against the same public node and gets the
 * same answer.
 *
 * The full model string is not in storage — it is emitted in ProviderRegistered — so
 * `loadProviders` reads the log to recover names. Reading a log is still reading chain.
 */
import { Contract, JsonRpcProvider } from 'ethers';
import { MEASUREMENT_REGISTRY_ABI, PROVIDER_REGISTRY_ABI } from './abi.js';
import { mapWithConcurrency } from './concurrency.js';
import { retryRead } from './retry.js';

/** Mirrors ProviderRegistry.Mode. Index 0 is Unknown so an unset slot never reads as real. */
export const MODES = ['Unknown', 'TeeML', 'TeeTLS', 'standard'] as const;
export type Mode = (typeof MODES)[number];

export const modeName = (i: number): Mode => MODES[i] ?? 'Unknown';

export interface ProviderRecord {
  id: number;
  address: string;
  /** Recovered from the registration log; null if the log is out of the scanned range. */
  model: string | null;
  modelHash: string;
  /** What the network claims about itself at registration time. */
  declaredMode: Mode;
  registeredAt: Date;
}

export interface MeasurementRecord {
  providerId: number;
  p50Ms: number;
  p95Ms: number;
  /** Basis points: 10000 = 100%. */
  errorRateBps: number;
  divergenceBps: number;
  calls: number;
  /** Recorded per epoch, because a provider's mode can change between epochs. */
  observedMode: Mode;
}

export interface EpochRecord {
  epoch: number;
  prober: string;
  writtenAt: Date;
  /** 0G Storage merkle root of the raw transcript these numbers were derived from. */
  storageRoot: string;
  measurements: MeasurementRecord[];
}

export interface ObservatoryAddresses {
  providerRegistry: string;
  measurementRegistry: string;
}

export class ObservatoryReader {
  private readonly provider: JsonRpcProvider;
  private readonly reg: Contract;
  private readonly mr: Contract;

  /**
   * Cached provider list, keyed by the registry's own count. `ProviderRegistry` is
   * append-only, so a cache that still matches the current count cannot be stale.
   */
  #providers: { count: number; records: ProviderRecord[] } | null = null;

  constructor(rpcUrl: string, private readonly addresses: ObservatoryAddresses) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.reg = new Contract(addresses.providerRegistry, PROVIDER_REGISTRY_ABI, this.provider);
    this.mr = new Contract(addresses.measurementRegistry, MEASUREMENT_REGISTRY_ABI, this.provider);
  }

  async epochDuration(): Promise<number> {
    return Number(await this.mr.EPOCH_DURATION());
  }

  async currentEpoch(): Promise<number> {
    return Number(await this.mr.currentEpoch());
  }

  /**
   * Which epoch a moment belongs to. The contract derives this as timestamp / duration,
   * so a verifier can compute it offline and check the chain agrees.
   */
  async epochOf(at: Date): Promise<number> {
    return Number(await this.mr.epochOf(BigInt(Math.floor(at.getTime() / 1000))));
  }

  /** All registered providers, with model names recovered from registration logs. */
  async loadProviders(fromBlock = 0): Promise<ProviderRecord[]> {
    const count = Number(await retryRead(() => this.reg.providerCount()));
    if (count === 0) return [];
    if (this.#providers?.count === count) return this.#providers.records;

    const names = new Map<number, string>();
    const logs = await this.reg.queryFilter(
      this.reg.filters.ProviderRegistered(),
      fromBlock,
      'latest',
    );
    for (const log of logs) {
      const a = (log as any).args;
      if (a) names.set(Number(a.id), a.model as string);
    }

    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const records = await mapWithConcurrency(ids, 8, async (id) => {
      const p = await retryRead(() => this.reg.get(id));
      return {
        id,
        address: p.addr,
        model: names.get(id) ?? null,
        modelHash: p.modelHash,
        declaredMode: modeName(Number(p.declaredMode)),
        registeredAt: new Date(Number(p.registeredAt) * 1000),
      } satisfies ProviderRecord;
    });

    this.#providers = { count, records };
    return records;
  }

  /**
   * The transaction that published an epoch.
   *
   * `EpochHeader` stores no transaction hash — nothing on chain needs one — so it comes from
   * the `EpochWritten` log. Needed because every number on the dashboard has to link back to
   * the transaction that published it; a figure with no path to its source is an opinion.
   */
  async epochTxHash(epoch: number, prober: string): Promise<string | null> {
    const logs = await this.mr.queryFilter(this.mr.filters.EpochWritten(epoch, prober), 0, 'latest');
    return logs[0]?.transactionHash ?? null;
  }

  async epochsOf(prober: string): Promise<number[]> {
    const raw = (await retryRead(() => this.mr.epochsOf(prober))) as bigint[];
    return raw.map(Number);
  }

  /** One epoch as written by one prober, or null if that prober never wrote it. */
  async readEpoch(epoch: number, prober: string): Promise<EpochRecord | null> {
    if (!(await retryRead(() => this.mr.isWritten(epoch, prober)))) return null;

    const h = await retryRead(() => this.mr.getHeader(epoch, prober));
    const raw = await retryRead(() => this.mr.getMeasurements(epoch, prober));

    return {
      epoch,
      prober: h.prober,
      writtenAt: new Date(Number(h.writtenAt) * 1000),
      storageRoot: h.storageRoot,
      measurements: raw.map((m: any) => ({
        providerId: Number(m.providerId),
        p50Ms: Number(m.p50Ms),
        p95Ms: Number(m.p95Ms),
        errorRateBps: Number(m.errorRateBps),
        divergenceBps: Number(m.divergenceBps),
        calls: Number(m.calls),
        observedMode: modeName(Number(m.observedMode)),
      })),
    };
  }

  /**
   * Providers registered but absent from this epoch — services that could not be measured.
   *
   * The contract stores no zero-filled placeholder for them, because a zero p50 reads as
   * "instant". Deriving the gap here keeps the dashboard able to say what it does not know.
   */
  async unmeasuredIn(epoch: EpochRecord): Promise<ProviderRecord[]> {
    const measured = new Set(epoch.measurements.map((m) => m.providerId));
    const all = await this.loadProviders();
    return all.filter((p) => !measured.has(p.id));
  }
}
