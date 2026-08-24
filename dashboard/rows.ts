import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';
import { isUnmeasured } from '../src/chain/encoding.js';

export interface ProviderRow {
  providerId: number;
  address: string;
  model: string;
  mode: string;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
  calls: number;
}

export interface OperatorGroup {
  address: string;
  rows: ProviderRow[];
  /** Registered under this operator but absent from this epoch — shown as a gap, not dropped. */
  unmeasured: string[];
}

/**
 * Turn one epoch into rows, grouped by operator.
 *
 * The grouping is for navigation only. Every number belongs to an (address, model) pair and
 * none is averaged across the models an operator serves — pooling by address is the exact
 * defect this project exists to point at, and doing it here would reproduce it.
 */
export function groupByOperator(
  epoch: EpochRecord,
  providers: readonly ProviderRecord[],
): OperatorGroup[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const groups = new Map<string, OperatorGroup>();

  const group = (address: string): OperatorGroup => {
    let g = groups.get(address);
    if (!g) groups.set(address, (g = { address, rows: [], unmeasured: [] }));
    return g;
  };

  const measured = new Set<number>();
  for (const m of epoch.measurements) {
    const p = byId.get(m.providerId);
    if (!p || p.model === null) continue;
    measured.add(p.id);
    group(p.address).rows.push({
      providerId: p.id,
      address: p.address,
      model: p.model,
      mode: m.observedMode,
      p50Ms: m.p50Ms,
      p95Ms: m.p95Ms,
      errorRateBps: m.errorRateBps,
      divergenceBps: m.divergenceBps,
      calls: m.calls,
    });
  }

  for (const p of providers) {
    if (measured.has(p.id) || p.model === null) continue;
    // Every registered service reaches the output, even one whose operator this epoch
    // measured nothing for — a missing measurement must stay visible as missing, never
    // vanish as if the service had never registered.
    group(p.address).unmeasured.push(p.model);
  }

  for (const g of groups.values()) {
    g.rows.sort((a, b) => a.model.localeCompare(b.model));
    g.unmeasured.sort();
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}

/**
 * Basis points as a percentage. 833 -> "8.33%", with no trailing zeros invented.
 *
 * The unmeasured sentinel renders as a gap. Showing 655.35% would put a number against a
 * named operator that nobody measured, which is worse than showing nothing.
 */
export function formatBps(bps: number): string {
  if (isUnmeasured(bps)) return '—';
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Milliseconds, switching to seconds where ms would be noise. 0 means "not published". */
export function formatMs(ms: number): string {
  if (ms === 0) return '—';
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
