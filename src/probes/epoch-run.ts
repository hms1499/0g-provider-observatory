/**
 * The pure half of a live epoch run — roster selection and money.
 *
 * Kept out of the runner script for the same reason `plan.ts` is kept out of
 * `dry-run.ts`: these are the decisions worth testing, and none of them need a
 * network. The script is the shell that spends and prints.
 */
import type { CallResult } from './router-client.js';
import type { Target } from './plan.js';
import { PROBE_TOKEN_PROFILE, SUITE_MEASURED_TOKENS } from './suite.js';
import type { Probe } from './suite.js';

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
 * Trim a roster so the FULL suite fits the budget for everything left in it.
 *
 * Measured on epochs 496514/496516: the runner started with more services than the budget
 * could cover and aborted mid-suite, so every service was measured on probes 1..k. Probe 5
 * landed 15 times out of 15 and probe 14 landed 8. That is not a smaller measurement, it is
 * a biased one — and it destroyed the noise floor specifically, because the two halves of
 * the byte-identical pair sit at positions 5 and 14, so the second half was the part that
 * got cut.
 *
 * So the budget is spent on measuring fewer services completely rather than more services
 * partially. Whole groups only: half a pair leaves a service with nothing to diverge
 * against, which costs money and publishes no divergence figure.
 *
 * Groups holding a TeeML reference go first — they are the only ones that calibrate against
 * ground truth — and the rest follow cheapest-first, which fits the most groups into what
 * is left.
 */
export function fitToBudget(targets: readonly Target[], budgetUsd: number): Target[] {
  const groups = new Map<string, Target[]>();
  for (const t of targets) {
    const arr = groups.get(t.canonicalId);
    if (arr) arr.push(t);
    else groups.set(t.canonicalId, [t]);
  }

  const ranked = [...groups.values()]
    .map((members) => ({
      members,
      cost: projectedCostUsd(members),
      anchored: members.some((m) => m.mode === 'TeeML'),
    }))
    .sort((a, b) => Number(b.anchored) - Number(a.anchored) || a.cost - b.cost);

  const kept: Target[] = [];
  let spent = 0;
  for (const g of ranked) {
    if (spent + g.cost > budgetUsd) continue;
    spent += g.cost;
    kept.push(...g.members);
  }
  return kept;
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

/**
 * What to hold against the cap before sending one probe to one service.
 *
 * Priced from the probe's own measured profile rather than from a suite average: the
 * probes differ by two orders of magnitude in output, so an average over-reserves the
 * cheap ones and under-reserves exactly the reasoning-heavy ones that overspend.
 *
 * A probe with no profile entry falls back to its declared ceiling, which is a floor on
 * the truth rather than zero — an unpriced call must never look free.
 */
export function reservationUsd(
  t: Pick<Target, 'usdPerPromptToken' | 'usdPerCompletionToken'>,
  probe: Probe,
): number {
  const profile = PROBE_TOKEN_PROFILE[probe.id] ?? {
    input: Math.ceil(probe.prompt.length / 4) + 8,
    output: probe.maxTokens,
    outputMax: probe.maxTokens,
  };
  // outputMax, not output: this is a hold placed before the call, and a hold that only
  // covers the average call does not cover the call it was placed for.
  return t.usdPerPromptToken * profile.input + t.usdPerCompletionToken * profile.outputMax;
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
 * A hold placed on the cap before a call goes out, settled against what it really cost.
 *
 * The hold is the whole point. Testing an estimate and then spending is not a cap: under
 * concurrency every worker passes the same test before any of them has recorded anything,
 * so N workers can each be admitted against the same remaining dollar.
 */
export interface Reservation {
  /** What this hold took out of the cap while the call was in flight. */
  readonly heldUsd: number;
  /** Release the hold and book what the Router actually billed. */
  settle(actualUsd: number): void;
  /** Release the hold having spent nothing — a call that never billed. */
  release(): void;
}

/**
 * A running total with a hard ceiling, reserved before spending.
 *
 * The credit behind the key is worth a fraction of a full epoch, so the run has to stop on
 * measured spend rather than on an estimate made before it started. `reserve()` refuses
 * rather than throwing, because a refused call is a normal end to a run; `settle()` throws
 * only when what was actually billed lands past the cap, which no estimate could have
 * prevented.
 */
export class Budget {
  #settled = 0;
  #reserved = 0;

  constructor(readonly capUsd: number) {}

  /** What has actually been billed. Outstanding holds are not spend. */
  get spentUsd(): number {
    return this.#settled;
  }

  /** Spend plus every hold still in flight — what the cap is measured against. */
  get committedUsd(): number {
    return this.#settled + this.#reserved;
  }

  get remainingUsd(): number {
    return this.capUsd - this.committedUsd;
  }

  /**
   * Hold `estUsd` against the cap, or refuse when it no longer fits.
   *
   * Refusing returns null instead of throwing: reaching the cap is the expected way a
   * constrained run ends, and the caller stops the roster rather than handling an error.
   */
  reserve(estUsd: number): Reservation | null {
    const held = Math.max(0, estUsd);
    if (this.committedUsd + held > this.capUsd) return null;
    this.#reserved += held;

    let open = true;
    const close = () => {
      if (!open) throw new Error('this reservation has already been settled or released');
      open = false;
      this.#reserved -= held;
    };

    return {
      heldUsd: held,
      release: close,
      settle: (actualUsd: number) => {
        close();
        // Booked before the check, so a run that overshoots still reports what it spent.
        this.#settled += Math.max(0, actualUsd);
        if (this.#settled > this.capUsd) {
          throw new BudgetExceeded(
            `spent $${this.#settled.toFixed(6)} against a cap of $${this.capUsd.toFixed(6)}`,
          );
        }
      },
    };
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
