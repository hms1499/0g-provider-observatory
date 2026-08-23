/**
 * Write side of the measurement ledger. Deliberately a separate file from `registry.ts`,
 * which promises in its own header that nothing in it can write — a reader that cannot
 * write is one less thing a verifier has to trust. This module is the only place a
 * private key is used.
 */
import { Contract, JsonRpcProvider, Wallet, parseUnits } from 'ethers';
import type { OnchainMeasurement } from '../probes/aggregate.js';

/**
 * Only the write function. Kept out of `abi.ts` so the read ABI stays read-only.
 */
export const MEASUREMENT_WRITE_ABI = [
  'function writeEpoch(bytes32 storageRoot, tuple(uint16 providerId, uint32 p50Ms, uint32 p95Ms, uint16 errorRateBps, uint16 divergenceBps, uint16 calls, uint8 observedMode)[] items) returns (uint32)',
  'function currentEpoch() view returns (uint32)',
  'function isWritten(uint32 epoch, address prober) view returns (bool)',
] as const;

/**
 * Positional tuple in the order MeasurementRegistry.Measurement declares its fields.
 * ethers accepts an object too, but the order is part of the on-chain layout and a
 * silent reordering would write correct-looking nonsense, so it is stated here once.
 */
export type MeasurementTuple = [number, number, number, number, number, number, number];

export function encodeMeasurement(m: OnchainMeasurement): MeasurementTuple {
  return [m.providerId, m.p50Ms, m.p95Ms, m.errorRateBps, m.divergenceBps, m.calls, m.observedMode];
}

export class EpochDrift extends Error {}

/**
 * Refuse to file measurements under an epoch they did not come from.
 *
 * The contract stamps a write with `currentEpoch()` at transaction time, while the
 * measurements were taken while the run was in progress. A run that crosses an hour
 * boundary therefore publishes epoch N+1 holding epoch N's calls — which is exactly what
 * happened on the first live run (measured in 496514, written as 496515). The link a
 * verifier follows is `storageRoot`, so the record is not unverifiable, but the epoch
 * label is wrong and the ledger is write-once, so it stays wrong forever.
 *
 * Blocking is the safe direction. A mislabelled epoch cannot be corrected; a refused
 * write can simply be run again.
 */
export function assertEpoch(measuredIn: number, chainEpoch: number): void {
  if (measuredIn === chainEpoch) return;
  throw new EpochDrift(
    `the run measured epoch ${measuredIn} but the chain is now on ${chainEpoch}. ` +
      'Writing would file these calls under an epoch they did not come from, and the ' +
      'ledger is write-once. Re-run inside a single epoch.',
  );
}

export interface WriteEpochResult {
  epoch: number;
  txHash: string;
  gasUsed: bigint;
  count: number;
}

/**
 * The RPC's own gas estimate is unusable on 0G: it suggests fractions of a gwei while the
 * node rejects anything under a 2 gwei tip, and the broadcast fails after four attempts
 * with `transaction gas price below minimum`. So the price is set explicitly, as a legacy
 * transaction, exactly as the testnet deploy had to.
 */
export const GAS_PRICE_GWEI = '6';

export async function writeEpoch(opts: {
  rpcUrl: string;
  privateKey: string;
  measurementRegistry: string;
  /** 0G Storage merkle root of the evidence bundle. The only path from summary to source. */
  storageRoot: string;
  rows: readonly OnchainMeasurement[];
  /** Epoch the measurements were taken in. The write is refused if the chain has moved on. */
  measuredInEpoch?: number;
}): Promise<WriteEpochResult> {
  if (opts.rows.length === 0) throw new Error('refusing to write an empty epoch');

  const provider = new JsonRpcProvider(opts.rpcUrl);
  const wallet = new Wallet(opts.privateKey, provider);
  const contract = new Contract(opts.measurementRegistry, MEASUREMENT_WRITE_ABI, wallet);

  const epoch = Number(await contract.currentEpoch());
  if (opts.measuredInEpoch !== undefined) assertEpoch(opts.measuredInEpoch, epoch);
  if (await contract.isWritten(epoch, wallet.address)) {
    throw new Error(
      `epoch ${epoch} is already written by ${wallet.address}. The ledger is write-once; ` +
        'wait for the next epoch rather than trying to revise this one.',
    );
  }

  const tx = await contract.writeEpoch(opts.storageRoot, opts.rows.map(encodeMeasurement), {
    type: 0,
    gasPrice: parseUnits(GAS_PRICE_GWEI, 'gwei'),
  });
  const receipt = await tx.wait();

  return { epoch, txHash: tx.hash, gasUsed: receipt?.gasUsed ?? 0n, count: opts.rows.length };
}
