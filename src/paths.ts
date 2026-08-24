/**
 * Where the scripts read their inputs from.
 *
 * Both defaults used to be literals — `data/snapshot-2026-08-21.json` and
 * `deployments/galileo-16602.json` — repeated across seven scripts. Both went stale the
 * moment the project moved to mainnet, and nothing would have said so: the runner had no
 * check that the deployment file it was handed described the chain it was writing to.
 */
import { existsSync, readdirSync } from 'node:fs';

const SNAPSHOT_RE = /^snapshot-\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Newest snapshot by filename date. Names are ISO-dated, so lexical order is date order.
 * Exported taking a file list so it can be tested without a filesystem.
 */
export function pickLatestSnapshot(files: readonly string[]): string | null {
  const snaps = files.filter((f) => SNAPSHOT_RE.test(f)).sort();
  const newest = snaps.at(-1);
  return newest ? `data/${newest}` : null;
}

/** The newest snapshot on disk, or null if none has been taken. */
export function latestSnapshot(dir = 'data'): string | null {
  if (!existsSync(dir)) return null;
  return pickLatestSnapshot(readdirSync(dir));
}

export class WrongChain extends Error {}

/**
 * Refuse a deployment file that describes a different chain than the one being written to.
 *
 * MeasurementRegistry is write-once. A run pointed at the testnet deployment while the RPC
 * is on mainnet would either revert or, worse, write real measurements into the wrong
 * ledger permanently. A file with no `chainId` is refused too — an unstated chain is not a
 * matching one.
 */
export function assertDeploymentChain(
  deployment: { chainId?: number },
  chainId: number,
  path: string,
): void {
  if (deployment.chainId === chainId) return;
  throw new WrongChain(
    `${path} is for chain ${deployment.chainId ?? '(unstated)'} but this run is on ${chainId}. ` +
      'The ledger is write-once, so a measurement filed against the wrong registry stays there.',
  );
}

/** Deployment file for a chain id, by the convention the deployment files already use. */
export function deploymentFor(chainId: number): string {
  return chainId === 16661
    ? 'deployments/aristotle-16661.json'
    : `deployments/galileo-${chainId}.json`;
}
