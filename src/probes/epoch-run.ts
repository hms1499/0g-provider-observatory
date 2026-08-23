/**
 * The pure half of a live epoch run — roster selection and money.
 *
 * Kept out of the runner script for the same reason `plan.ts` is kept out of
 * `dry-run.ts`: these are the decisions worth testing, and none of them need a
 * network. The script is the shell that spends and prints.
 */
import type { CallResult } from './router-client.js';
import type { Target } from './plan.js';
import { SUITE_MEASURED_TOKENS } from './suite.js';

export interface RosterOptions {
  /**
   * Keep only models served by more than one provider. Divergence has nothing to say
   * about a lone provider, so on a constrained budget these are the calls that buy
   * something.
   */
  groupsOnly?: boolean;
  /** Canonical ids to leave out entirely — the cost lever. */
  exclude?: readonly string[];
}

export function selectRoster(
  targets: readonly Target[],
  opts: RosterOptions = {},
): Target[] {
  const excluded = new Set(opts.exclude ?? []);
  const kept = targets.filter((t) => !excluded.has(t.canonicalId));
  if (!opts.groupsOnly) return kept;

  const counts = new Map<string, number>();
  for (const t of kept) counts.set(t.canonicalId, (counts.get(t.canonicalId) ?? 0) + 1);
  return kept.filter((t) => (counts.get(t.canonicalId) ?? 0) > 1);
}

/**
 * What the roster is expected to cost, from the token profile a real run measured
 * rather than from the max_tokens ceiling. `max_tokens` is a ceiling, not a charge:
 * pricing the ceiling overstates an epoch by about 70%.
 */
export function projectedCostUsd(targets: readonly Target[]): number {
  return targets.reduce(
    (n, t) =>
      n +
      t.usdPerPromptToken * SUITE_MEASURED_TOKENS.input +
      t.usdPerCompletionToken * SUITE_MEASURED_TOKENS.output,
    0,
  );
}

/** What one completed call actually cost, from the usage the Router reported. */
export function callCostUsd(
  r: CallResult,
  rates: Pick<Target, 'usdPerPromptToken' | 'usdPerCompletionToken'>,
): number {
  if (!r.usage) return 0;
  return (
    (r.usage.prompt ?? 0) * rates.usdPerPromptToken +
    (r.usage.completion ?? 0) * rates.usdPerCompletionToken
  );
}

export class BudgetExceeded extends Error {}

/**
 * A running total with a hard ceiling.
 *
 * The credit behind the key is worth a fraction of a full epoch, so the run has to
 * stop on measured spend rather than on an estimate made before it started. Passing
 * the cap throws instead of warning — a run that quietly overshoots leaves nothing to
 * retry with.
 */
export class Budget {
  #spent = 0;

  constructor(readonly capUsd: number) {}

  get spentUsd(): number {
    return this.#spent;
  }

  get remainingUsd(): number {
    return this.capUsd - this.#spent;
  }

  /** Whether one more call of roughly this size still fits. */
  canAfford(estUsd: number): boolean {
    return this.#spent + estUsd <= this.capUsd;
  }

  record(usd: number): void {
    this.#spent += usd;
    if (this.#spent > this.capUsd) {
      throw new BudgetExceeded(
        `spent $${this.#spent.toFixed(6)} against a cap of $${this.capUsd.toFixed(6)}`,
      );
    }
  }
}

/**
 * Did the Router actually serve the provider we pinned?
 *
 * A missing header counts as NOT held. The pin being unverifiable and the pin being
 * wrong are the same thing for a measurement: neither can be attributed.
 */
export function pinHeld(r: CallResult, pinnedAddress: string): boolean {
  return r.servedBy !== null && r.servedBy.toLowerCase() === pinnedAddress.toLowerCase();
}
