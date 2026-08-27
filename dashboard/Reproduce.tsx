import { useEffect, useMemo, useState } from 'react';
import { ObservatoryReader } from '../src/chain/registry.js';
import { Masthead } from './Masthead.js';
import { RatioCell } from './RatioCell.js';
import { newestPair, orderedPair, serviceLabel } from './rows.js';
import type { NetworkConfig } from './networks.js';
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
 * not tampered with. This panel asks the other question: take two runs of the same roster
 * and see whether they reached the same conclusions.
 *
 * Nothing here costs the reader anything. Both runs are already published, both bundles
 * are already on 0G Storage, and the comparison happens in this page.
 */
export function Reproduce(props: { net: NetworkConfig; epochs: readonly number[] }) {
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

  if (!pairs) {
    return (
      <section>
        <h2>Reproducibility</h2>
        <p>
          This compares two runs of the same roster against each other. {props.net.name} holds{' '}
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
        <strong>{earlier}</strong> and <strong>{later}</strong> — two runs of the same pinned
        roster — and compares what each concluded, from their published evidence, in this page.
      </p>
      <p>
        Latency is reported as a ratio and never scored: two runs at two times see different
        load, and nothing here can say which one caught a bad minute. What is stable enough to
        compare is the conclusion. <strong>Neither run is treated as correct.</strong>
      </p>

      {props.epochs.length > 2 && (
        <div className="pair">
          <label>
            earlier{' '}
            <select
              value={earlier}
              onChange={(e) => setPicked(orderedPair(Number(e.target.value), later))}
            >
              {props.epochs.map((e) => (
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
              {props.epochs.map((e) => (
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

      {busy && <p>Fetching both bundles through the public gateway…</p>}

      {outcome?.state === 'failed' && (
        <p>
          Could not compare these epochs: {outcome.error}. This is a read failure, not a
          disagreement between the runs.
        </p>
      )}

      {report && (
        <>
          <Masthead
            readings={[
              { label: 'earlier', value: earlier },
              { label: 'later', value: later },
              { label: 'compared', value: report.compared },
              {
                label: 'disagreements',
                value: report.disagreements.length === 0 ? 'none' : report.disagreements.length,
              },
            ]}
          />
          <p>
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
              <p>
                Measured by one run and not the other. Not a fault on either side — a service
                that returned too few usable samples is dropped rather than published thin.
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
