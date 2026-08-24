/**
 * Pin the set of services a series of epochs measures.
 *
 * The product answers "how did this provider behave last week", the noise floor needs the
 * same service across epochs, and neither survives a roster that changes underneath them.
 * `fitToBudget` picks whatever fits, so a price move is enough to admit a new group: after
 * the token profile was re-measured, glm-5 became affordable and the roster went from 10
 * services to 13 without anyone deciding that.
 *
 * So the series roster is stated once, in a file, and every epoch is measured against it.
 * The lock can only ever REMOVE services from what fitting chose — it cannot add one that
 * the budget could not pay for, or one the Router no longer lists.
 */

export interface LockedService {
  address: string;
  modelId: string;
}

export interface RosterLock {
  /** The epoch this set was established in, so the series has a stated beginning. */
  epoch: number;
  services: LockedService[];
}

export interface LockedRoster<T extends LockedService> {
  /** What to measure: the fitted roster narrowed to the lock, in the lock's order. */
  roster: T[];
  /** Locked but absent this epoch — unhealthy, unaffordable, or delisted. Never silent. */
  missing: LockedService[];
  /** Fitted but not in the lock. Dropped, and reported so the drift is visible. */
  extra: T[];
}

/** An address is a checksummed string; two spellings of the same address differ only by case. */
const keyOf = (s: LockedService) => `${s.address.toLowerCase()}|${s.modelId}`;

export function applyRosterLock<T extends LockedService>(
  fitted: readonly T[],
  lock: RosterLock,
): LockedRoster<T> {
  const available = new Map(fitted.map((s) => [keyOf(s), s]));
  const locked = new Set(lock.services.map(keyOf));

  const roster: T[] = [];
  const missing: LockedService[] = [];
  // Lock order, not fitted order: an epoch's roster should not be reshuffled by which
  // group happened to be cheapest when it was planned.
  for (const want of lock.services) {
    const found = available.get(keyOf(want));
    if (found) roster.push(found);
    else missing.push(want);
  }

  const extra = fitted.filter((s) => !locked.has(keyOf(s)));
  return { roster, missing, extra };
}
