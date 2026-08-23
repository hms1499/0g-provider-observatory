/**
 * Compare what the chain published against what the evidence supports.
 *
 * Every difference is reported as a finding rather than an exception, because a run that
 * stopped at the first mismatch would tell a reader one thing when there might be twelve.
 * Findings carry both numbers so a reader can judge the size of the gap themselves.
 *
 * An absence is not automatically a fault. A service below the sample floor is *meant* to
 * be missing from the ledger — `MeasurementRegistry` deliberately stores no zero-filled
 * placeholder — so evidence for such a service is expected to have no published row.
 */
import type { RecomputedService } from './recompute.js';

export interface ChainRow {
  providerId: number;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
  calls: number;
  observedMode: string;
}

/** Registry id -> the (address, model) pair it names. The unit is the pair, never the address. */
export type ProviderLookup = Record<number, { address: string; model: string | null }>;

export type Severity =
  | 'mismatch'          // published and recomputed disagree on a number
  | 'unknown-provider'  // the published row names an id the registry does not have
  | 'unsupported'       // published, but the evidence holds nothing for that service
  | 'unpublished';      // the evidence supports a row that was never published

export interface Finding {
  severity: Severity;
  service: string;
  field?: string;
  onChain?: number;
  recomputed?: number;
  message: string;
}

const COMPARED_FIELDS = [
  'p50Ms',
  'p95Ms',
  'errorRateBps',
  'divergenceBps',
  'calls',
] as const;

const key = (address: string, model: string) => `${address.toLowerCase()}|${model}`;

export function compareToChain(
  rows: readonly ChainRow[],
  recomputed: readonly RecomputedService[],
  providers: ProviderLookup,
): { findings: Finding[]; checked: number } {
  const findings: Finding[] = [];
  const byKey = new Map(recomputed.map((r) => [key(r.address, r.modelId), r]));
  const publishedKeys = new Set<string>();
  let checked = 0;

  for (const row of rows) {
    const provider = providers[row.providerId];
    if (!provider || provider.model === null) {
      findings.push({
        severity: 'unknown-provider',
        service: `providerId ${row.providerId}`,
        message: `the published row names provider id ${row.providerId}, which the registry does not resolve`,
      });
      continue;
    }

    const name = `${provider.address} ${provider.model}`;
    const k = key(provider.address, provider.model);
    publishedKeys.add(k);
    const mine = byKey.get(k);

    if (!mine) {
      findings.push({
        severity: 'unsupported',
        service: name,
        message: 'published on chain, but the evidence bundle holds nothing for this service',
      });
      continue;
    }

    checked++;
    for (const field of COMPARED_FIELDS) {
      if (row[field] === mine[field]) continue;
      findings.push({
        severity: 'mismatch',
        service: name,
        field,
        onChain: row[field],
        recomputed: mine[field],
        message: `${field}: chain says ${row[field]}, the evidence gives ${mine[field]}`,
      });
    }
  }

  for (const mine of recomputed) {
    // Below the sample floor the service is supposed to be absent, so absence is correct.
    if (!mine.sufficient) continue;
    if (publishedKeys.has(key(mine.address, mine.modelId))) continue;
    findings.push({
      severity: 'unpublished',
      service: `${mine.address} ${mine.modelId}`,
      message: 'the evidence supports a measurement that was never published on chain',
    });
  }

  return { findings, checked };
}
