import type { EpochRecord } from '../src/chain/registry.js';
import type { VerifiableBundle } from '../src/verify/recompute.js';
import { reproduce, type ReproduceReport } from '../src/verify/reproduce.js';
import { bundleUrl, type NetworkConfig } from './networks.js';

export interface ReproduceOutcome {
  state: 'ready' | 'failed';
  report?: ReproduceReport;
  error?: string;
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
    return { state: 'failed', error: String(e?.message ?? e) };
  }

  return { state: 'ready', report: reproduce(a, b) };
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
