import type { EpochRecord } from '../src/chain/registry.js';
import type { VerifiableBundle } from '../src/verify/recompute.js';
import { reproduce, type ReproduceReport } from '../src/verify/reproduce.js';
import { bundleUrl, type NetworkConfig } from './networks.js';

/**
 * Why a comparison did not happen. Two different things, and the panel used to call both of
 * them a read failure — which was a claim about the network in front of a message that was
 * sometimes about the evidence itself.
 */
export type FailureKind =
  /** The bundles could not be fetched, parsed, or found. Nothing was compared because
   *  nothing arrived. */
  | 'unreadable'
  /** The evidence arrived and cannot be compared — a run that recorded no rulebook, so
   *  recomputing it would mean scoring it under somebody else's rules. */
  | 'incomparable';

export interface ReproduceOutcome {
  state: 'ready' | 'failed';
  report?: ReproduceReport;
  error?: string;
  reason?: FailureKind;
}

/**
 * Compare two published epochs, in the page, from their evidence.
 *
 * The merkle root is deliberately NOT rechecked here: that is `verifyEpochInBrowser`'s
 * question, and answering it twice in two places would let the two drift. This asks only
 * whether two independent runs reached the same conclusions. A reader who wants the
 * evidence bound to the record has the Verify panel one click away.
 *
 * `fetchBytes` is injected so the sequence is testable without a network.
 */
export async function reproduceInBrowser(args: {
  earlier: EpochRecord;
  later: EpochRecord;
  net: NetworkConfig;
  fetchBytes: (url: string) => Promise<string>;
}): Promise<ReproduceOutcome> {
  let a: VerifiableBundle;
  let b: VerifiableBundle;
  try {
    [a, b] = await Promise.all([
      load(args.fetchBytes, bundleUrl(args.net, args.earlier.storageRoot)),
      load(args.fetchBytes, bundleUrl(args.net, args.later.storageRoot)),
    ]);
  } catch (e: any) {
    return { state: 'failed', error: String(e?.message ?? e), reason: 'unreadable' };
  }

  // Its own try. `reproduce` refuses a bundle that records no rulebook, and that refusal is
  // about what the evidence supports — grouping it with the fetch above would have the panel
  // tell a reader the gateway failed when it answered perfectly.
  try {
    return { state: 'ready', report: reproduce(a, b) };
  } catch (e: any) {
    return { state: 'failed', error: String(e?.message ?? e), reason: 'incomparable' };
  }
}

async function load(
  fetchBytes: (url: string) => Promise<string>,
  url: string,
): Promise<VerifiableBundle> {
  const bytes = await fetchBytes(url);
  let parsed: any;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw new Error('the evidence is not readable JSON');
  }
  // The indexer answers a missing file with HTTP 200 and an error envelope, so a
  // successful fetch is not the same as evidence having been returned.
  if (typeof parsed?.code === 'number' && parsed.code !== 0) {
    throw new Error(String(parsed.message ?? 'the gateway holds no evidence at that root'));
  }
  return parsed as VerifiableBundle;
}
