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

export interface ModelGroup {
  /** The model string as the chain records it. Not canonicalised — see `groupByModel`. */
  model: string;
  rows: ProviderRow[];
  /**
   * The TeeML service in this group, if one exists. Divergence for every other member was
   * measured against it, and a reader cannot judge a divergence figure without knowing what
   * it was compared to. Null where the group has no enclave-attested member and the figure
   * therefore comes from peer comparison instead.
   */
  referenceAddress: string | null;
}

/**
 * Turn one epoch into rows, grouped by model.
 *
 * This is the axis the product's second question lives on: providers claiming the same model
 * either behave alike or they do not, and that is only readable when they sit next to each
 * other. Grouped by operator instead, the four services serving `deepseek-v4-flash` land in
 * four different places on the page and the comparison has to be done from memory.
 *
 * As with `groupByOperator`, the grouping is for reading. No figure is averaged across the
 * providers of a model — that would invent a "model score" nobody measured, and the spread
 * between providers is the finding, not noise to be summarised away.
 *
 * **Grouped by the exact model string the chain records, never canonicalised.** In every
 * epoch so far each consistency group registers under one string, so this produces exactly
 * the groups the prober compared. If two providers ever serve one model under different
 * strings they will appear as two groups — which is what the registry says, and the panel
 * says so rather than guessing they are the same thing.
 *
 * Rows are ordered by address, never by a measurement. Sorting by p50 would rank the
 * operators down the page, which is the one thing this dashboard does not do.
 */
export function groupByModel(
  epoch: EpochRecord,
  providers: readonly ProviderRecord[],
): ModelGroup[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const groups = new Map<string, ModelGroup>();

  for (const m of epoch.measurements) {
    const p = byId.get(m.providerId);
    if (!p || p.model === null) continue;

    let g = groups.get(p.model);
    if (!g) groups.set(p.model, (g = { model: p.model, rows: [], referenceAddress: null }));

    g.rows.push({
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
    if (m.observedMode === 'TeeML') g.referenceAddress = p.address;
  }

  for (const g of groups.values()) g.rows.sort((a, b) => a.address.localeCompare(b.address));

  // Widest groups first: a model with four providers carries a comparison, one with a single
  // provider carries none. Ordering by how much can be compared, not by how well anyone did.
  return [...groups.values()].sort(
    (a, b) => b.rows.length - a.rows.length || a.model.localeCompare(b.model),
  );
}

/**
 * The two epochs a comparison should open on, newest pair first, or null if there is no pair.
 *
 * Separate from the component so the "which two" decision can be read and tested on its own —
 * it used to be a `.slice(-2)` buried in a render, which was right for the two epochs that
 * existed and silently ignored the other twelve this series is heading for.
 */
export function newestPair(epochs: readonly number[]): [number, number] | null {
  if (epochs.length < 2) return null;
  const sorted = [...epochs].sort((a, b) => a - b);
  return [sorted[sorted.length - 2], sorted[sorted.length - 1]];
}

/** Two epochs in chronological order, whichever way round a reader picked them. */
export function orderedPair(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * An address shortened for reading. 42 characters and no reader holds one in their head.
 *
 * Every place that renders one of these keeps the whole address within reach — in a `title`,
 * or in the explorer link the short form sits inside. The elision is for the eye; anyone who
 * wants to *use* the address should not have to go to a third-party site to copy it back out.
 *
 * One definition rather than a copy per panel, so a table row, an observation and a
 * verification step all elide at the same place and read as the same address.
 */
export function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-4)}`;
}

/**
 * A service label with its address shortened, for reading rather than for copying.
 *
 * `compareRuns` names a service by its full address and model, which is right for a CLI whose
 * output someone may paste into a script. On a page it is 42 characters nobody reads, sitting
 * where the eye needs to find the model. The full address is a click away on the explorer.
 *
 * Anything that does not start with an address is returned untouched: this shortens a known
 * shape, it does not truncate arbitrary text.
 */
export function serviceLabel(service: string): string {
  const [address, ...rest] = service.split(' ');
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) return service;
  return [shortAddress(address!), ...rest].join(' ');
}

/**
 * Where a ratio sits on a track centred on parity, as 0..1. Null when it cannot be placed.
 *
 * The same instrument as `scalePosition`, reading a different quantity. Logarithmic and
 * symmetric about 1.0, because half as fast and twice as fast are the same size of
 * disagreement and a linear track would draw the second one twice as far from centre.
 *
 * `span` is how far out the track reaches, as a multiple: 4 shows 0.25x to 4x. Anything
 * beyond is pinned to the end, so an outlier stays visible as "past the edge" rather than
 * stretching the scale until every other reading collapses into the middle.
 */
export function ratioPosition(ratio: number, span = 4): number | null {
  if (!(ratio > 0) || !(span > 1)) return null;
  const limit = Math.log(span);
  const at = Math.min(Math.max(Math.log(ratio), -limit), limit);
  return (at + limit) / (2 * limit);
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

/**
 * Seconds, always, to two places. 0 means "not published".
 *
 * The unit is fixed rather than chosen per value. Switching to milliseconds under some
 * threshold puts `847 ms` in the same column as `43.3 s`, and a reader comparing two
 * providers then has to convert in their head before they can see which is slower — in a
 * column whose entire purpose is that comparison. Fixed precision also gives every cell the
 * same width, so `tabular-nums` can line the decimal points up.
 */
export function formatSeconds(ms: number): string {
  if (ms === 0) return '—';
  return (ms / 1000).toFixed(2);
}

/**
 * Where a duration sits on the epoch's own scale, as 0..1. Null when it cannot be placed.
 *
 * Logarithmic, because the spread within one epoch is nearly two orders of magnitude —
 * 4192 ms against 43.3 s — and on a linear track everything below the slowest service
 * collapses into the left edge and stops being readable.
 *
 * This carries magnitude and nothing else. It is drawn in one ink for every provider: the
 * tick says how long the call took, never whether that is good.
 */
export function scalePosition(ms: number, lo: number, hi: number): number | null {
  if (ms <= 0 || lo <= 0 || hi <= 0 || hi <= lo) return null;
  const clamped = Math.min(Math.max(ms, lo), hi);
  return (Math.log(clamped) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
}
