import { useEffect, useMemo, useState } from 'react';
import { ObservatoryReader, type EpochRecord } from '../src/chain/registry.js';
import { EpochNotes } from './EpochNote.js';
import { epochNotesFor } from './epochNotes.js';
import { LiveStatus } from './LiveStatus.js';
import { RowsSkeleton } from './Skeleton.js';
import { RatioCell } from './RatioCell.js';
import { newestPair, orderedPair, serviceLabel } from './rows.js';
import type { NetworkConfig } from './networks.js';
import { EpochRuler } from './EpochRuler.js';
import { ticksOf } from './ruler.js';
import { reproduceInBrowser, type ReproduceOutcome } from './reproduceEpochs.js';

const GATEWAY_TIMEOUT_MS = 30_000;

/**
 * Every numeric field a disagreement can carry is in basis points. Printing the raw
 * integer would show `1333` where the reader needs `13.33%`; `withheld` passes through
 * untouched, because it is a state and not a rate.
 */
function show(value: string | number): string {
  return typeof value === 'number' ? `${(value / 100).toFixed(2)}%` : value;
}

/**
 * Does this instrument give the same answer twice?
 *
 * The Verify panel asks whether a published number follows from its evidence. That check
 * would pass even if the method itself were unstable — it only proves the arithmetic was
 * not tampered with. This panel asks the other question: take two runs and see whether they
 * reached the same conclusions about the services both of them measured.
 *
 * It used to say "two runs of the same roster", which was true while every epoch measured the
 * same ten locked services and stopped being true at 496616 — that run probed thirty, and
 * pairing it with an earlier one compares ten services against thirty. Nothing breaks: the
 * services only one run measured are named under "not comparable", and the paragraph there
 * gives both reasons a service lands in that list. But the claim above it had to stop being
 * made, because the page cannot promise a reader something the epoch list contradicts.
 *
 * Nothing here costs the reader anything. Both runs are already published, both bundles
 * are already on 0G Storage, and the comparison happens in this page.
 */
export function Reproduce(props: {
  net: NetworkConfig;
  epochs: readonly number[];
  /** Every epoch read so far, for the strip's tick heights. Positions need only the numbers. */
  records: readonly EpochRecord[];
}) {
  // Which two, chosen rather than assumed. It opened on the last two and offered no way to
  // reach the rest, which was invisible at two epochs and drops twelve at fourteen.
  const [picked, setPicked] = useState<[number, number] | null>(null);
  const pairs = useMemo(
    () => picked ?? newestPair(props.epochs),
    [picked, props.epochs.join(',')],
  );
  const [outcome, setOutcome] = useState<ReproduceOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pairs) return;
    let cancelled = false;
    setBusy(true);
    setOutcome(null);

    (async () => {
      try {
        const reader = new ObservatoryReader(props.net.rpcUrl, {
          providerRegistry: props.net.providerRegistry,
          measurementRegistry: props.net.measurementRegistry,
        });
        const [earlier, later] = await Promise.all(
          pairs.map((e) => reader.readEpoch(e, props.net.prober)),
        );
        if (!earlier || !later) throw new Error('one of those epochs was never written');
        const result = await reproduceInBrowser({
          earlier,
          later,
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
        });
        if (!cancelled) setOutcome(result);
      } catch (e: any) {
        if (!cancelled) setOutcome({ state: 'failed', error: String(e?.message ?? e) });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.net, pairs?.join(',')]);

  const [earlier, later] = pairs ?? [0, 0];
  const descending = useMemo(
    () => [...props.epochs].sort((a, b) => b - a),
    [props.epochs.join(',')],
  );

  if (!pairs) {
    return (
      <section>
        <h2>Reproducibility</h2>
        <p>
          This compares two published runs against each other. {props.net.name} holds{' '}
          {props.epochs.length} epoch{props.epochs.length === 1 ? '' : 's'}, so there is nothing
          to compare yet.
        </p>
      </section>
    );
  }

  const report = outcome?.report;

  return (
    <section>
      <h2>Reproducibility</h2>
      <p>
        Verifying an epoch proves its numbers follow from its evidence. It cannot tell you
        whether the instrument gives the same answer twice. This takes epochs{' '}
        <strong>{earlier}</strong> and <strong>{later}</strong> — two runs of this network —
        and compares what each concluded, from their published evidence, in this page.
      </p>
      <p>
        Latency is reported as a ratio and never scored: two runs at two times see different
        load, and nothing here can say which one caught a bad minute. What is stable enough to
        compare is the conclusion. <strong>Neither run is treated as correct.</strong>
      </p>

      {/*
        Both epochs on one axis, before the controls that set them.

        This panel's whole question is whether a pair can be compared, and two dropdowns cannot
        show that. `docs/HANDOFF.md` is explicit: pairing a narrow epoch with a wide one is a
        legitimate comparison of the services both measured, but nothing may call two arbitrary
        epochs "two runs of the same roster", because for most pairs on this chain that is
        false. The tick heights are what a reader needs to see it — two marks at the same
        height are two runs of the same width, and 496616 against 496539 visibly is not that.
        It also shows how far apart in time the pair sits, which is the other thing a reader
        should weigh before reading a latency ratio.

        A drawing, not a control: the two selects below set the marks, and a strip where a
        click had to guess which of the two handles it was moving would be worse at both jobs.
      */}
      <EpochRuler
        ticks={ticksOf(props.epochs, props.records)}
        marks={[{ epoch: later, label: 'later' }, { epoch: earlier, label: 'earlier' }]}
        label={`The published series, with epochs ${earlier} and ${later} marked`}
      />

      {props.epochs.length > 2 && (
        <div className="pair">
          {/* Newest first in both lists, as the epoch picker and the Verify panel have it.
              The chain returns these in the order they were written, which puts the epoch a
              reader almost always reaches for at the bottom of a list heading for fourteen. */}
          <label>
            earlier{' '}
            <select
              value={earlier}
              onChange={(e) => setPicked(orderedPair(Number(e.target.value), later))}
            >
              {descending.map((e) => (
                <option key={e} value={e} disabled={e === later}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label>
            later{' '}
            <select
              value={later}
              onChange={(e) => setPicked(orderedPair(earlier, Number(e.target.value)))}
            >
              {descending.map((e) => (
                <option key={e} value={e} disabled={e === earlier}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <span className="of">
            {props.epochs.length} epochs published on this chain
          </span>
        </div>
      )}

      {/*
        Ahead of the comparison, because on this chain the corrections explain part of it.

        A disagreement between 496620 and any later epoch is partly the rate-limit window that
        run exhausted: an error rate that fell from 20% to 0% between two runs reads as a
        provider that stopped failing, and on those services it is a prober that stopped
        counting its own refused requests against them. This panel exists to ask whether the
        instrument gives the same answer twice, so where the answer moved for a reason that is
        ours, that is the first thing the reader is owed.
      */}
      <EpochNotes notes={epochNotesFor(props.net.chainId, [earlier, later])} />

      <LiveStatus>
        {busy
          ? `Comparing epochs ${earlier} and ${later}. Fetching both bundles.`
          : outcome?.state === 'failed'
            ? `Epochs ${earlier} and ${later} were not compared: ${outcome.error}.`
            : report
              ? `Epochs ${earlier} and ${later}: ${report.compared} service${report.compared === 1 ? '' : 's'} measured by both runs, ` +
                `${report.disagreements.length === 0 ? 'and every conclusion matched' : `with ${report.disagreements.length} disagreement${report.disagreements.length === 1 ? '' : 's'}`}.`
              : ''}
      </LiveStatus>

      {/* This panel compares the newest pair as soon as it opens, so the reader is waiting on
          something they did not ask for and a line of text was all they had.

          Sized to the report's shape, not to a score. An earlier version of this was tuned
          against a CLS figure that turned out to be an artefact of driving the page with
          synthetic clicks — see the note in `Skeleton.tsx`. What justifies it is the reader
          seeing the shape of what is coming, which needs no metric to defend. */}
      {busy && (
        <div aria-busy="true">
          {/* The masthead this stood in for is gone, and a placeholder for something that no
              longer arrives is a promise the panel does not keep. The strip above is already
              drawn and already says which pair is being fetched. */}
          <p className="grouping">Fetching both bundles through the public gateway…</p>
          <RowsSkeleton rows={2} heading />
          <RowsSkeleton rows={10} heading />
        </div>
      )}

      {outcome?.state === 'failed' && outcome.reason !== 'incomparable' && (
        <p>
          Could not compare these epochs: {outcome.error}. This is a read failure, not a
          disagreement between the runs.
        </p>
      )}

      {/* The evidence arrived and cannot be compared, which is not the same as failing to
          read it — saying "read failure" here would blame the gateway for a property of the
          run. Nothing is offered in its place: a comparison this panel cannot make honestly
          is one it does not make. */}
      {outcome?.state === 'failed' && outcome.reason === 'incomparable' && (
        <p>
          These two epochs cannot be compared: {outcome.error}. The evidence was fetched and
          read — this is a limit of what one of these runs wrote down, not a fault in either
          measurement.
        </p>
      )}

      {report && (
        <>
          {/*
            A four-reading masthead stood here and every one of the four was already on screen.
            `earlier` and `later` were the two selects directly above it and the two marks on
            the strip above those; `compared` and `disagreements` were the sentence directly
            below it, in words. It is the same mistake `census.ts` records the Providers panel
            making — four scalars about the run, none of them a finding — so it goes for the
            same reason, and the sentence stays.
          */}
          <p className="verdict-line">
            {report.compared} service{report.compared === 1 ? '' : 's'} measured by both runs
            {report.disagreements.length === 0
              ? ', and every conclusion matched.'
              : `, with ${report.disagreements.length} disagreement${
                  report.disagreements.length === 1 ? '' : 's'
                }.`}
          </p>

          {report.disagreements.length > 0 && (
            <>
              <h3>Where the two runs disagree</h3>
              <table className="readings" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader">service</th>
                    <th role="columnheader">what</th>
                    <th role="columnheader">epoch {earlier}</th>
                    <th role="columnheader">epoch {later}</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {report.disagreements.map((d, i) => (
                    <tr key={i} role="row">
                      <td role="cell">{serviceLabel(d.service)}</td>
                      <td role="cell" data-label="what">
                        {d.kind}
                      </td>
                      <td role="cell" data-label={`epoch ${earlier}`}>
                        {show(d.published)}
                      </td>
                      <td role="cell" data-label={`epoch ${later}`}>
                        {show(d.independent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Latency, as a ratio</h3>
          <table className="readings" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">service</th>
                <th className="num" role="columnheader">
                  p50
                </th>
                <th className="num" role="columnheader">
                  p95
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {report.latency.map((l) => (
                <tr key={l.service} role="row">
                  <td role="cell">{serviceLabel(l.service)}</td>
                  <RatioCell ratio={l.p50Ratio} label="p50" />
                  <RatioCell ratio={l.p95Ratio} label="p95" />
                </tr>
              ))}
            </tbody>
          </table>

          {(report.onlyPublished.length > 0 || report.onlyIndependent.length > 0) && (
            <>
              <h3>Not comparable</h3>
              {/*
                Two different things end up in this list and the old copy named only one of
                them. A service can be missing because its run returned too few usable samples
                — that was the whole story while every epoch measured the same locked roster.
                Since epoch 496616 probed all 38 services against the other epochs' 10, the
                commoner reason by far is that the two runs did not set out to measure the same
                set at all, and calling that a sampling failure describes the wrong thing.
              */}
              <p>
                Measured by one run and not the other, which happens two ways: the two runs
                measured different rosters, or a service returned too few usable samples and
                was dropped rather than published thin. Neither is a fault on either side, and
                only the second says anything about the service.
              </p>
              <ul>
                {report.onlyPublished.map((s) => (
                  <li key={s}>{serviceLabel(s)} — epoch {earlier} only</li>
                ))}
                {report.onlyIndependent.map((s) => (
                  <li key={s}>{serviceLabel(s)} — epoch {later} only</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
