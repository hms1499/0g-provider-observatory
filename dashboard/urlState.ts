/**
 * The reader's position on the page, written into the address bar.
 *
 * Four things decide what the page shows — which chain is being read, which section is open,
 * which epoch the Providers table holds, and which model the Pick panel is prefilled with.
 * Those used to live only in React state. That made ordinary things impossible: a reload put
 * a reader back on Providers/mainnet/newest wherever they had been, and there was no way to
 * hand someone a link to a particular epoch. The second one was already assumed elsewhere in
 * the codebase —
 * `EpochPicker` marks the newest epoch specifically so "a reader arriving on an epoch two
 * days old because they followed a link" can tell it is not the current one, and no such link
 * existed.
 *
 * The shape is `#[network/]panel[/epoch/N][/model/name]`:
 *
 *     #providers                          the default view
 *     #providers/epoch/496615             one epoch, pinned — the shareable link
 *     #pick/model/glm-5.2                 provider selection for one model
 *     #testnet/verify                     a section on the other chain
 *
 * **Defaults are omitted rather than spelled out.** The network segment only appears for
 * testnet, so the address of the ordinary case stays short enough to read aloud. An epoch
 * segment means the reader pinned one; its absence means "whichever is newest", which is a
 * different request from naming today's newest epoch and is stored as `null` for that reason.
 *
 * **Parsing never throws and never half-applies.** A hash written by hand, or one carried over
 * from an older version of this format, yields defaults for the parts it does not name. An
 * epoch that does not exist on the chain being read is a question for the caller, not for the
 * parser: it returns the number, and the view falls back to the newest record.
 */
import { DEFAULT_NETWORK, NETWORKS, type NetworkKey } from './networks.js';
import type { Panel } from './SiteHeader.js';

export interface ViewState {
  network: NetworkKey;
  panel: Panel;
  /** Null means "whichever epoch is newest", not "the epoch that is newest right now". */
  epoch: number | null;
  /** Exact registry model string to prefill on the Pick panel. */
  pickModel: string | null;
}

export const DEFAULT_VIEW: ViewState = {
  network: DEFAULT_NETWORK,
  panel: 'providers',
  epoch: null,
  pickModel: null,
};

const PANELS: readonly Panel[] = ['providers', 'verify', 'reproduce', 'measure', 'pick'];

const isNetwork = (s: string): s is NetworkKey => s in NETWORKS;
const isPanel = (s: string): s is Panel => (PANELS as readonly string[]).includes(s);

/**
 * Read a view out of a location hash.
 *
 * Segments are taken in order and anything unrecognised is skipped rather than rejected, so a
 * link that has drifted still lands the reader somewhere real instead of on an error.
 */
export function parseHash(hash: string): ViewState {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean);
  const view: ViewState = { ...DEFAULT_VIEW };

  let i = 0;
  const network = parts[i];
  if (network !== undefined && isNetwork(network)) {
    view.network = network;
    i++;
  }
  const panel = parts[i];
  if (panel !== undefined && isPanel(panel)) {
    view.panel = panel;
    i++;
  }
  while (i < parts.length) {
    if (parts[i] === 'epoch') {
      // Epoch numbers are unsigned and come off the chain as integers. A malformed one is
      // dropped, which shows the newest epoch — the same thing an absent segment does.
      const n = Number(parts[i + 1]);
      if (Number.isInteger(n) && n >= 0) view.epoch = n;
      i += 2;
      continue;
    }
    if (parts[i] === 'model') {
      const raw = parts[i + 1];
      if (raw !== undefined && raw !== '') {
        try {
          view.pickModel = decodeURIComponent(raw);
        } catch {
          view.pickModel = raw;
        }
      }
      i += 2;
      continue;
    }
    i++;
  }

  return view;
}

/**
 * Write a view as a location hash, including the leading `#`.
 *
 * The panel is always named even when it is the default, because a hash of `#` alone reads as
 * a broken link rather than as the front page.
 */
export function formatHash(view: ViewState): string {
  const parts: string[] = [];
  if (view.network !== DEFAULT_VIEW.network) parts.push(view.network);
  parts.push(view.panel);
  if (view.epoch !== null) parts.push('epoch', String(view.epoch));
  if (view.panel === 'pick' && view.pickModel !== null && view.pickModel !== '') {
    parts.push('model', encodeURIComponent(view.pickModel));
  }
  return `#${parts.join('/')}`;
}
