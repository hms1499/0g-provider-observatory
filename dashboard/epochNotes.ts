/**
 * What a published epoch needs said beside it, and could not have said at the time.
 *
 * `MeasurementRegistry` is write-once, which is the property the whole project rests on: a
 * record that could be revised afterwards is worth nothing as history. The cost of that
 * property is that a figure published under a rule we later corrected stays published under
 * the old rule, forever. The number cannot move. What can move is what stands next to it.
 *
 * So this file is the one place where an epoch carries a correction, and it is deliberately
 * additive: nothing here changes a reading, recomputes anything, or is used by `recompute()`.
 * A reader following `pnpm verify` gets the same bits either way — these notes never travel
 * on chain or into a bundle, and a verifier who ignores this file reaches the same verdict.
 *
 * **Keyed by chain as well as epoch.** An epoch number is an hour, and the same hour exists on
 * both chains; 496514 on testnet is a different run by a different prober from 496514 on
 * mainnet. Keying on the number alone would print a mainnet correction over a testnet reading.
 *
 * **The wording is bound by the same rule as everything else here: report, do not accuse, and
 * do not exonerate either.** These notes say what the prober did wrong, name the count, and
 * stop. They do not tell the reader what the number "should" have been — the corrected figures
 * exist in `docs/HANDOFF.md` for anyone who wants them, and printing them beside a published
 * one would quietly become a second, unverifiable ledger.
 */

export interface EpochNote {
  chainId: number;
  epoch: number;
  /** Short label for the note, used as its heading. */
  label: string;
  /** The correction itself, in full sentences. */
  text: string;
}

/**
 * Epochs 496591 and 496620 published error rates that include our own exhausted rate-limit
 * window.
 *
 * A 429 is the Router refusing this prober's key, not a service failing, but `faultSide`
 * charged it to the provider until 2026-08-31. 496620 is where it is worst: that run sent 570
 * calls in 254 s, took `x-ratelimit-remaining` from 499 to 0, and collected 137 429s in the
 * final eight seconds. Seven of its published services carry some of those; on two more the
 * rate would have been the same either way.
 *
 * Epochs before 496591 and after 496620 are not annotated because they have nothing to
 * annotate: recomputing all twelve bundles found rate-limit failures inside a published error
 * rate on these two mainnet runs and nowhere else on this chain.
 */
export const EPOCH_NOTES: readonly EpochNote[] = [
  {
    chainId: 16661,
    epoch: 496591,
    label: 'Two error rates in this epoch include failures that were ours',
    text:
      'Two of the services below were sent requests the Router refused because this prober’s ' +
      'own rate-limit window had closed. A refused request never reached the service, but the ' +
      'prober counted it against the service anyway. It charges those to itself from ' +
      '2026-08-31 onward; this epoch was written before that, and the ledger is write-once, so ' +
      'the figures here stand as they were published.',
  },
  {
    chainId: 16661,
    epoch: 496620,
    label: 'Several error rates in this epoch include failures that were ours',
    text:
      'This run sent 570 calls in about four minutes and exhausted its own rate-limit window ' +
      'partway through, after which the Router refused 137 of them. A refused request never ' +
      'reached the service, but the prober counted it against the service anyway, so seven of ' +
      'the services below carry an error rate that is partly this. It charges those to itself ' +
      'from 2026-08-31 onward; this epoch was written before that, and the ledger is ' +
      'write-once, so the figures here stand as they were published.',
  },
];

/** The note for one epoch on one chain, or null when it has nothing to correct. */
export function epochNote(chainId: number, epoch: number | null | undefined): EpochNote | null {
  if (epoch === null || epoch === undefined) return null;
  return EPOCH_NOTES.find((n) => n.chainId === chainId && n.epoch === epoch) ?? null;
}

/**
 * The notes for a pair of epochs, in the order given, with nothing repeated.
 *
 * The Reproducibility panel shows two epochs at once and both can carry a note; a reader
 * comparing 496591 against 496620 needs to know that the disagreements between them are
 * partly this, which neither note says on its own.
 */
export function epochNotesFor(
  chainId: number,
  epochs: readonly (number | null | undefined)[],
): EpochNote[] {
  const out: EpochNote[] = [];
  for (const e of epochs) {
    const note = epochNote(chainId, e);
    if (note && !out.includes(note)) out.push(note);
  }
  return out;
}
