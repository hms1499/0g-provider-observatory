import { useEffect, useState } from 'react';
import { ObservatoryReader } from '../src/chain/registry.js';
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
  const pairs = props.epochs.length >= 2 ? props.epochs.slice(-2) : null;
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
  }, [props.net, props.epochs.join(',')]);

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

  const [earlier, later] = pairs;
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

      {busy && <p>Fetching both bundles through the public gateway…</p>}

      {outcome?.state === 'failed' && (
        <p>
          Could not compare these epochs: {outcome.error}. This is a read failure, not a
          disagreement between the runs.
        </p>
      )}

      {report && (
        <>
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
              <table>
                <thead>
                  <tr>
                    <th>service</th>
                    <th>what</th>
                    <th>epoch {earlier}</th>
                    <th>epoch {later}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.disagreements.map((d, i) => (
                    <tr key={i}>
                      <td>{d.service}</td>
                      <td>{d.kind}</td>
                      <td>{show(d.published)}</td>
                      <td>{show(d.independent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Latency, as a ratio</h3>
          <table>
            <thead>
              <tr>
                <th>service</th>
                <th>p50</th>
                <th>p95</th>
              </tr>
            </thead>
            <tbody>
              {report.latency.map((l) => (
                <tr key={l.service}>
                  <td>{l.service}</td>
                  <td>{l.p50Ratio.toFixed(2)}&times;</td>
                  <td>{l.p95Ratio.toFixed(2)}&times;</td>
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
                  <li key={s}>{s} — epoch {earlier} only</li>
                ))}
                {report.onlyIndependent.map((s) => (
                  <li key={s}>{s} — epoch {later} only</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
