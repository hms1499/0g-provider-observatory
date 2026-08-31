import { useEffect, useRef, useState } from 'react';
import {
  ObservatoryReader,
  type EpochRecord,
  type ProviderRecord,
} from '../src/chain/registry.js';
import { bundleUrl, type NetworkConfig } from './networks.js';
import { EpochNotes } from './EpochNote.js';
import { epochNotesFor } from './epochNotes.js';
import { LiveStatus } from './LiveStatus.js';
import { EpochRuler } from './EpochRuler.js';
import { ticksOf } from './ruler.js';
import { newestEpoch } from './selectEpoch.js';
import { Bar, RowsSkeleton } from './Skeleton.js';
import { verifyEpochInBrowser, type EvidenceRoots, type VerifyOutcome } from './verifyEpoch.js';

/**
 * The two roots, set against each other.
 *
 * This is what verifying an epoch *is*: the ledger committed to a hash of its evidence, the
 * page fetched some bytes from a public gateway, and either those bytes hash to that same
 * value or they do not. Everything else on this panel is downstream of that one comparison.
 *
 * It used to appear once, in eleven-pixel mono, as a detail line under the second item of a
 * checklist — smaller on the page than the paragraph introducing it — and the reader was
 * told the two matched rather than shown it. So it is the panel's opening now, and the
 * masthead that stood here is gone: the reading this instrument publishes is not four
 * scalars, it is one comparison, and stating it twice at two sizes weakened both.
 *
 * **The alignment is the whole design, and it is for the failing case.** The two hashes are
 * split into identical groups and stacked, so a differing character sits directly under its
 * counterpart and is marked. A design that only works when everything agrees would be
 * decoration; this one is at its most useful on the run that goes wrong.
 *
 * The verdict is folded in rather than stamped again below. `verified` was previously said
 * five times on one screen — four `ok`s and a bordered box — and a claim repeated is not a
 * claim strengthened.
 */
function Roots(props: {
  evidence: EvidenceRoots;
  epoch: number | null;
  network: string;
  outcome: VerifyOutcome;
}) {
  const { committed, computed } = props.evidence;
  const identical =
    computed !== null && computed.toLowerCase() === committed.toLowerCase();
  const { outcome } = props;

  return (
    <div className="roots" data-verdict={outcome.verdict}>
      <p className="where">
        epoch {props.epoch} · {props.network}
      </p>

      <div className="root">
        <span className="caption">the ledger committed to</span>
        <Hash hash={committed} against={identical ? null : computed} />
      </div>

      <div className="root">
        <span className="caption">
          {computed === null
            ? 'and the bytes never arrived to be hashed'
            : 'and the bytes it just fetched hash to'}
        </span>
        {computed === null ? (
          <span className="hash absent">—</span>
        ) : (
          <Hash hash={computed} against={identical ? null : committed} />
        )}
      </div>

      <p className="reading">
        <span className="verdict">
          {computed === null ? 'no comparison' : identical ? 'identical' : 'they differ'}
        </span>
        <span className="census">
          {outcome.verdict === 'verified'
            ? `${outcome.checked} measurement${outcome.checked === 1 ? '' : 's'} recomputed exactly` +
              (outcome.findings.length > 0
                ? `, ${outcome.findings.length} advisory note${outcome.findings.length === 1 ? '' : 's'}`
                : '')
            : outcome.checked > 0
              ? `not verified — ${outcome.checked} measurement${outcome.checked === 1 ? '' : 's'} recomputed, and the run did not reconcile`
              : 'not verified — nothing could be recomputed'}
        </span>
      </p>
    </div>
  );
}

/**
 * One hash, in groups, with the characters that differ from its counterpart marked.
 *
 * Grouped in eights because sixty-four undifferentiated hex characters are a texture rather
 * than a value, and because the groups give the eye somewhere to land when comparing two of
 * them. Both hashes are built by the same function, so the groups wrap at the same points
 * and a character always sits above its counterpart.
 *
 * `against` is null when there is nothing to compare to, or when the two are identical —
 * marking every character of a match would be as loud as marking a mismatch, and they mean
 * opposite things.
 */
function Hash({ hash, against }: { hash: string; against: string | null }) {
  const hex = hash.replace(/^0x/, '');
  const other = against?.replace(/^0x/, '').toLowerCase() ?? null;
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 8) groups.push(hex.slice(i, i + 8));

  return (
    <span className="hash">
      {groups.map((group, g) => (
        <span className="group" key={g}>
          {[...group].map((ch, i) => {
            const at = g * 8 + i;
            const differs = other !== null && other[at] !== ch.toLowerCase();
            return (
              <span key={i} className={differs ? 'differs' : undefined}>
                {ch}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

/** How long to wait for the storage gateway before treating the fetch as failed. Chain reads
 * get this for free from ethers' own AbortController; a bare `fetch` does not, so a hanging
 * indexer would otherwise leave the button disabled forever with no error and no timeout. */
const GATEWAY_TIMEOUT_MS = 30_000;

export function Verify(props: {
  net: NetworkConfig;
  epochs: readonly number[];
  /**
   * Every epoch read so far, for the strip's tick heights.
   *
   * Only the heights depend on it: the positions come from the epoch numbers alone, so the
   * series is complete and correctly spaced from the first paint whether or not any record
   * has arrived. A run that has not been read yet is drawn at the floor height and lighter,
   * which is the honest drawing of "published, not read".
   */
  records: readonly EpochRecord[];
  providers: readonly ProviderRecord[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const newest = newestEpoch(props.epochs);

  async function run(epochNumber: number) {
    setSelected(epochNumber);
    setBusy(true);
    setOutcome(null);
    setRoot(null);
    try {
      const reader = new ObservatoryReader(props.net.rpcUrl, {
        providerRegistry: props.net.providerRegistry,
        measurementRegistry: props.net.measurementRegistry,
      });
      const record = await reader.readEpoch(epochNumber, props.net.prober);
      if (!record) throw new Error('that epoch was never written');
      // Kept in state rather than read back out of `steps` by index: the link must survive
      // a failed run, and coupling it to a step position would break the moment a step moves.
      setRoot(record.storageRoot);
      setOutcome(
        await verifyEpochInBrowser({
          epoch: record,
          providers: props.providers,
          net: props.net,
          fetchBytes: async (url) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
            try {
              const res = await fetch(url, { signal: controller.signal });
              if (!res.ok) throw new Error(`gateway returned ${res.status}`);
              return await res.text();
            } catch (e: any) {
              if (e?.name === 'AbortError') {
                throw new Error(`gateway did not respond within ${GATEWAY_TIMEOUT_MS / 1000}s`);
              }
              throw e;
            } finally {
              clearTimeout(timer);
            }
          },
        }),
      );
    } catch (e: any) {
      setOutcome({
        steps: [{ label: 'read the epoch from chain', status: 'fail', detail: String(e?.message ?? e) }],
        findings: [],
        checked: 0,
        verdict: 'failed',
      });
    } finally {
      setBusy(false);
    }
  }

  /*
   * Check the newest epoch as soon as the panel opens, instead of showing an empty dropdown.
   *
   * This tab held the most convincing thing on the site behind one more decision: a reader who
   * pressed Verify met a select reading "choose one" and no verification, on a page whose other
   * three tabs all show a reading immediately. The argument for making them choose was that a
   * check costs a Storage fetch — but the panel only mounts when the tab is opened, so the
   * fetch happens exactly when a reader has asked to see a check and not before.
   *
   * Guarded by the epoch it last auto-ran, not by a "has run" flag. The chain toggle remounts
   * nothing — `props.net` changes underneath this component — so a flag would leave the reader
   * on mainnet's verification after switching to testnet. Comparing the number means a chain
   * switch, or a newly published epoch, runs again, and a reader's own choice is never
   * overwritten because `selected` is only null before the first run.
   */
  const auto = useRef<number | null>(null);
  useEffect(() => {
    if (newest === null || busy) return;
    if (auto.current === newest && selected !== null) return;
    auto.current = newest;
    void run(newest);
    // `run` is redefined every render and depends only on props; listing it would re-fire the
    // check on every state change it makes. The guard above is what makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest, props.net.chainId]);

  return (
    <section>
      <h2>Verify</h2>
      <p>
        Nothing here trusts this page. It fetches the evidence an epoch points at, rehashes
        it, and recomputes every published number using code that imports nothing from the
        prober that produced them.
      </p>

      {props.epochs.length === 0 ? (
        <p>No epochs have been written on {props.net.name} yet.</p>
      ) : (
        <>
          <p className="pick">
            This checks the newest epoch on opening; pick another to check that one instead. It
            fetches that epoch&rsquo;s evidence from 0G Storage and recomputes every figure in
            it — a couple of seconds, and nothing is sent anywhere.
          </p>

          {/*
            The series, drawn the way the Providers panel draws it.

            This was a grid of ten identical chips reading "epoch 496636", "epoch 496620", and
            so on — the word "epoch" ten times, carrying nothing, and the numbers the only
            thing that differed. It said less than the same ten epochs say on the panel next
            door, and it said it in a different shape, so one document showed one series two
            ways. Worse for this panel in particular: what a check costs in time is roughly
            how many services the run measured, and the chips could not show that. The tick
            heights can.

            The select beside it is the exact control, for the reason `EpochSelect` gives on
            the Providers panel: two of these epochs are an hour apart on an axis spanning four
            days, and a target that narrow cannot also be the 24px a pointer target must be.
          */}
          <div className="choose">
            <EpochRuler
              ticks={ticksOf(props.epochs, props.records)}
              marks={selected === null ? [] : [{ epoch: selected }]}
              label="Which epoch to check"
              busy={busy}
              onEpoch={run}
            />
            <p className="exact">
              <label htmlFor="verify-epoch">epoch</label>
              <select
                id="verify-epoch"
                value={selected ?? ''}
                disabled={busy}
                onChange={(e) => run(Number(e.target.value))}
              >
                {/* Only reachable in the moment before the opening check names an epoch;
                    kept so the control is never a select with no value at all. */}
                {selected === null && (
                  <option value="" disabled>
                    choose one
                  </option>
                )}
                {[...props.epochs]
                  .sort((a, b) => b - a)
                  .map((e) => (
                    <option key={e} value={e}>
                      {e}
                      {e === newest ? ' · newest' : ''}
                    </option>
                  ))}
              </select>
              {busy && <span className="tag">checking…</span>}
            </p>
          </div>

          {/* What this epoch's figures carry that its evidence cannot say for itself. The
              check below still passes — the numbers do follow from the bundle; the note is
              about the rule they were computed under, not about the arithmetic. */}
          <EpochNotes notes={epochNotesFor(props.net.chainId, [selected])} />
        </>
      )}

      <LiveStatus>
        {busy
          ? `Checking epoch ${selected}. Fetching its evidence and recomputing every figure.`
          : outcome
            ? `Epoch ${selected}: ${outcome.verdict === 'verified' ? 'verified' : 'not verified'}. ` +
              `${outcome.checked} measurement${outcome.checked === 1 ? '' : 's'} recomputed. ` +
              `${outcome.findings.length === 0 ? 'No advisories' : `${outcome.findings.length} advisor${outcome.findings.length === 1 ? 'y' : 'ies'}`}.`
            : ''}
      </LiveStatus>

      {/* The gateway fetch takes a few seconds, and until this existed the panel answered a
          click with a tag beside the button and nothing else — the result area stayed empty,
          which reads as a click that did not register. Same reasoning as the Reproducibility
          and Measure panels, and the same shape: the masthead's real labels at the height
          they will keep, then rows where the log is about to be. Not tuned against a CLS
          score; see the note at the top of `Skeleton.tsx`. */}
      {busy && (
        <div className="log" aria-busy="true">
          {/* Shaped like the two roots, because that is what lands here: a caption, two
              lines of hash, twice over. A masthead's worth of small readings used to stand
              in for it and the result then pushed everything down by its own height. */}
          <div className="roots">
            <p className="where">
              reading epoch {selected} from {props.net.name}
            </p>
            {['the ledger committed to', 'and the bytes it just fetched hash to'].map((c) => (
              <div className="root" key={c}>
                <span className="caption">{c}</span>
                <span className="hash">
                  <Bar w="min(34ch, 100%)" />
                  <Bar w="min(30ch, 100%)" />
                </span>
              </div>
            ))}
          </div>
          <RowsSkeleton rows={4} />
        </div>
      )}

      {!busy && outcome && (
        <div className="log">
          {outcome.evidence && (
            <Roots
              evidence={outcome.evidence}
              epoch={selected}
              network={props.net.name}
              outcome={outcome}
            />
          )}

          {/*
            The chain of custody, as a chain. Each stage takes what the one above produced —
            bytes, then a root, then a parsed bundle, then the pair of claims it makes — so
            the second is meaningless without the first, and a flat list of ticks said none
            of that. The connector is the point; the ticks are gone with it, because a stage
            that failed says so in its own words and the rest read `ok` five times over.
          */}
          <ol className="custody">
            {outcome.steps.map((s, i) => (
              <li key={i} data-status={s.status}>
                <span className="what">{s.label}</span>
                {s.detail && <span className="detail">{s.detail}</span>}
              </li>
            ))}
          </ol>

          {outcome.findings.length > 0 && (
            <div className="findings">
              <h3>
                {outcome.verdict === 'verified'
                  ? 'Advisory — not blocking the verdict'
                  : 'What did not reconcile'}
              </h3>
              {outcome.verdict === 'verified' && (
                <p>The evidence supports these measurements, but the chain never published them.</p>
              )}
              <dl>
                {outcome.findings.map((f, i) => (
                  <div key={i}>
                    <dt>{f.service}</dt>
                    <dd>
                      <span className="severity">{f.severity}</span> {f.message}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {root && (
            <p>
              <a href={bundleUrl(props.net, root)} target="_blank" rel="noreferrer">
                open the evidence yourself
              </a>
            </p>
          )}
        </div>
      )}

    </section>
  );
}
