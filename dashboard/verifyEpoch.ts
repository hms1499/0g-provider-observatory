import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';
import { merkleRootOf } from '../src/storage/merkle.js';
import { compareToChain, type Finding, type ProviderLookup } from '../src/verify/check.js';
import { recompute, type VerifiableBundle } from '../src/verify/recompute.js';
import { bundleUrl, type NetworkConfig } from './networks.js';
import { shortAddress } from './rows.js';

export interface VerifyStep {
  /** What this stage did, in one short phrase. Reads down a column, so it stays short. */
  label: string;
  status: 'pending' | 'ok' | 'fail';
  /** The artifact this stage produced or the reason it could not. */
  detail?: string;
}

/**
 * The two roots the whole check turns on: what the record committed to, and what the bytes
 * that came back actually hash to.
 *
 * Structured rather than left inside a step's `detail` string, because the panel sets them
 * against each other character by character and cannot do that with a sentence. `computed`
 * is null when the bytes never arrived or could not be hashed — a missing comparison, not a
 * failed one, and the two read differently on the page.
 */
export interface EvidenceRoots {
  committed: string;
  computed: string | null;
}

export interface VerifyOutcome {
  steps: VerifyStep[];
  findings: Finding[];
  checked: number;
  verdict: 'verified' | 'failed';
  evidence?: EvidenceRoots;
}

/**
 * The same check `pnpm verify` performs, run in the page.
 *
 * `fetchBytes` is injected so the sequence can be tested without a network, and so the
 * caller decides how the gateway is reached. Fetching by root proves only that a gateway
 * answered to that root, so the merkle root is recomputed over the bytes received: that is
 * what binds the evidence to the record.
 */
export async function verifyEpochInBrowser(args: {
  epoch: EpochRecord;
  providers: readonly ProviderRecord[];
  net: NetworkConfig;
  fetchBytes: (url: string) => Promise<string>;
}): Promise<VerifyOutcome> {
  const steps: VerifyStep[] = [];
  const evidence: EvidenceRoots = { committed: args.epoch.storageRoot, computed: null };
  const fail = (label: string, detail: string): VerifyOutcome => {
    steps.push({ label, status: 'fail', detail });
    return { steps, findings: [], checked: 0, verdict: 'failed', evidence };
  };

  let bytes: string;
  try {
    bytes = await args.fetchBytes(bundleUrl(args.net, args.epoch.storageRoot));
    // The indexer answers a missing file with HTTP 200 and an error envelope.
    const maybe = bytes.startsWith('{') ? safeParse(bytes) : null;
    if (maybe && typeof maybe.code === 'number' && maybe.code !== 0) {
      return fail('fetched from 0G Storage', String(maybe.message ?? 'not found'));
    }
  } catch (e: any) {
    return fail('fetched from 0G Storage', String(e?.message ?? e));
  }
  steps.push({
    label: 'fetched from 0G Storage',
    status: 'ok',
    detail: `${(bytes.length / 1024).toFixed(0)} KB through the public gateway, no wallet`,
  });

  let root: string;
  try {
    root = await merkleRootOf(bytes);
  } catch (e: any) {
    // A throw here means the bytes could not be hashed at all, not that reading the epoch
    // failed — that distinction matters, so it must not fall through to the caller's
    // generic "read the epoch from chain" handler.
    return fail('hashed to the root the record committed to', String(e?.message ?? e));
  }
  // Recorded before it is judged, so the panel can set the two roots against each other
  // whether they agree or not — a mismatch is the case the comparison exists for.
  evidence.computed = root;
  if (root.toLowerCase() !== args.epoch.storageRoot.toLowerCase()) {
    return fail('hashed to the root the record committed to', 'the two roots differ');
  }
  steps.push({
    label: 'hashed to the root the record committed to',
    status: 'ok',
    detail: 'shown above, character for character',
  });

  const bundle = safeParse(bytes) as VerifiableBundle | null;
  if (!bundle) return fail('parsed as an evidence bundle', 'not valid JSON');
  steps.push({
    label: 'parsed as an evidence bundle',
    status: 'ok',
    detail: `${bundle.schema}, ${bundle.results.length} calls`,
  });

  /*
   * Two claims, checked together because either one alone is not enough: a bundle for the
   * right epoch written by a different prober is a different measurement, and the ledger
   * keys records by the pair for exactly that reason.
   *
   * The detail names whichever side disagreed. It used to read `bundle says epoch N`
   * whatever had happened, so a prober mismatch printed the epoch the record agreed on and
   * left a reader looking at a FAIL beside a number that matched.
   */
  const sameEpoch = bundle.epoch === args.epoch.epoch;
  const sameProber = bundle.prober.toLowerCase() === args.epoch.prober.toLowerCase();
  steps.push({
    label: 'claims this epoch and this prober',
    status: sameEpoch && sameProber ? 'ok' : 'fail',
    detail: claimDetail(
      { epoch: bundle.epoch, prober: bundle.prober },
      { epoch: args.epoch.epoch, prober: args.epoch.prober },
    ),
  });

  const lookup: ProviderLookup = Object.fromEntries(
    args.providers.map((p) => [p.id, { address: p.address, model: p.model }]),
  );
  const { findings, checked } = compareToChain(args.epoch.measurements, recompute(bundle), lookup);
  const blocking = findings.filter((f) => f.severity !== 'unpublished');
  const anyStepFailed = steps.some((s) => s.status === 'fail');

  return {
    steps,
    findings,
    checked,
    verdict: blocking.length === 0 && !anyStepFailed ? 'verified' : 'failed',
    evidence,
  };
}

/**
 * What the bundle claims, next to what the record claims, with only the parts that differ
 * spelled out twice. Naming both sides of something that matches is noise in a log a reader
 * scans for the one line that says FAIL.
 */
function claimDetail(
  bundle: { epoch: number; prober: string },
  record: { epoch: number; prober: string },
): string {
  const epochDiffers = bundle.epoch !== record.epoch;
  const proberDiffers = bundle.prober.toLowerCase() !== record.prober.toLowerCase();

  if (!epochDiffers && !proberDiffers) {
    return `epoch ${bundle.epoch}, prober ${shortAddress(bundle.prober)}`;
  }
  const parts: string[] = [];
  if (epochDiffers) parts.push(`the bundle says epoch ${bundle.epoch}, the record ${record.epoch}`);
  if (proberDiffers) {
    parts.push(
      `the bundle was written by ${shortAddress(bundle.prober)}, the record by ${shortAddress(record.prober)}`,
    );
  }
  return parts.join('; ');
}

function safeParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
