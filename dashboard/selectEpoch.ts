/**
 * Which epoch the Providers panel is actually showing, and why it is not the one asked for.
 *
 * The address bar can name an epoch — that is the whole point of `urlState.ts` — but the
 * ledger arrives in two phases, so for the first second or so of a page load the only record
 * in hand is the newest one. The selection used to be a single expression in the render:
 *
 *     records.find((r) => r.epoch === chosen) ?? data.latest
 *
 * which answered "not here yet" and "not on this chain" with the same thing: the newest
 * epoch's figures, under the newest epoch's timestamp, with the picker showing a number the
 * reader can see is not the one in their link. A reader following a link to epoch 496539 read
 * 496620's numbers and was told nothing. Every number on this page is supposed to trace to a
 * source; that one traced to a different source than the address claimed.
 *
 * So the fallback is gone and the cases are separated. Three of them are not the record:
 *
 * - **arriving** — published, and the second phase is still reading it. A wait, not a fault.
 * - **unreadable** — published, but the read finished or failed without producing it.
 * - **absent** — this prober never published it on this chain. Decidable in the first phase,
 *   because the epoch list arrives with the newest record, so a link carrying a testnet epoch
 *   number is answered immediately rather than after a load that cannot succeed.
 *
 * Nothing here reaches for `latest` on the reader's behalf. Showing the newest epoch when a
 * different one was asked for is the defect this module exists to remove; the panel offers a
 * way back to it instead, which is a choice the reader makes rather than one made for them.
 */
import type { EpochRecord } from '../src/chain/registry.js';

/** How far the second phase — every epoch behind the newest — has got. */
export type HistoryState = 'loading' | 'ready' | 'failed';

export type EpochView =
  /** The record to render. */
  | { state: 'record'; record: EpochRecord }
  /** Published; still being read. */
  | { state: 'arriving'; epoch: number }
  /** Published, but its record did not come back. */
  | { state: 'unreadable'; epoch: number }
  /** Never published on this chain by this prober. */
  | { state: 'absent'; epoch: number }
  /** Nothing has been published on this chain at all. */
  | { state: 'empty' };

/**
 * The newest epoch this prober has published, or null if it has published none.
 *
 * By `epochsOf`'s own ordering the last element is the newest, but this takes the maximum
 * rather than the tail: the ordering is the contract's append order, which is a property of
 * how records were written and not one this page should depend on for correctness.
 */
export function newestEpoch(epochs: readonly number[]): number | null {
  return epochs.length === 0 ? null : Math.max(...epochs);
}

export function selectEpoch(args: {
  /** The epoch the reader asked for, or null for "whichever is newest". */
  chosen: number | null;
  /** Records read so far, in any order. */
  records: readonly EpochRecord[];
  /** Every epoch this prober has published, whether or not its record has arrived. */
  epochs: readonly number[];
  history: HistoryState;
  latest?: EpochRecord;
}): EpochView {
  if (args.chosen === null) {
    return args.latest ? { state: 'record', record: args.latest } : { state: 'empty' };
  }

  const found = args.records.find((r) => r.epoch === args.chosen);
  if (found) return { state: 'record', record: found };

  // Not in the published list, so no amount of waiting will produce it. This is the link that
  // carried an epoch number from the other chain, or one typed by hand.
  if (!args.epochs.includes(args.chosen)) return { state: 'absent', epoch: args.chosen };

  return args.history === 'loading'
    ? { state: 'arriving', epoch: args.chosen }
    : { state: 'unreadable', epoch: args.chosen };
}
