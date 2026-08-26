import { useEffect, useMemo, useState } from 'react';
import { ObservatoryReader } from '../src/chain/registry.js';
import type { VerifiableBundle } from '../src/verify/recompute.js';
import type { ReproduceReport } from '../src/verify/reproduce.js';
import { measureGroup } from './measureGroup.js';
import { bundleUrl, type NetworkConfig } from './networks.js';

const GATEWAY_TIMEOUT_MS = 30_000;

/** Every numeric field a disagreement can carry is in basis points. */
function show(value: string | number): string {
  return typeof value === 'number' ? `${(value / 100).toFixed(2)}%` : value;
}

/**
 * Measure a consistency group now, with the reader's own key, and compare it against
 * what the newest published epoch concluded.
 *
 * The key never leaves component state — not localStorage, not a URL, not a log. It does
 * pass through this site's server, because the Router refuses a browser Origin outside its
 * allowlist and forbids the price-ceiling headers a browser would need to send. The panel
 * says so above the input rather than burying it.
 */
export function Measure(props: { net: NetworkConfig; epochs: readonly number[] }) {
  const newest = props.epochs.at(-1);
  const [bundle, setBundle] = useState<VerifiableBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [group, setGroup] = useState<string>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<ReproduceReport | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (newest === undefined) return;
    let cancelled = false;
    setBundle(null);
    setLoadError(null);

    (async () => {
      try {
        const reader = new ObservatoryReader(props.net.rpcUrl, {
          providerRegistry: props.net.providerRegistry,
          measurementRegistry: props.net.measurementRegistry,
        });
        const record = await reader.readEpoch(newest, props.net.prober);
        if (!record) throw new Error('that epoch was never written');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
        try {
          const res = await fetch(bundleUrl(props.net, record.storageRoot), {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`gateway returned ${res.status}`);
          const parsed = JSON.parse(await res.text());
          // The gateway answers a missing root with a JSON envelope and HTTP 200, so a
          // non-zero `code` is the only signal that nothing was stored there.
          if (typeof parsed?.code === 'number' && parsed.code !== 0) {
            throw new Error(String(parsed.message ?? 'the gateway holds no evidence'));
          }
          if (!cancelled) setBundle(parsed as VerifiableBundle);
        } catch (e: any) {
          if (e?.name === 'AbortError') {
            throw new Error(`gateway did not respond within ${GATEWAY_TIMEOUT_MS / 1000}s`);
          }
          throw e;
        } finally {
          clearTimeout(timer);
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(String(e?.message ?? e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.net, newest]);

  /** Only models with two or more providers: a lone provider has nothing to diverge from. */
  const groups = useMemo(() => {
    if (!bundle) return [];
    const counts = new Map<string, number>();
    for (const s of bundle.roster) counts.set(s.canonicalId, (counts.get(s.canonicalId) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([canonicalId, n]) => ({ canonicalId, services: n, calls: n * bundle.probes.length }))
      .sort((a, b) => a.calls - b.calls);
  }, [bundle]);

  const selected = groups.find((g) => g.canonicalId === group) ?? groups[0];

  async function run() {
    if (!bundle || !selected) return;
    setReport(null);
    setRunError(null);
    setProgress({ done: 0, total: selected.calls });
    try {
      const { report: r } = await measureGroup({
        bundle,
        canonicalId: selected.canonicalId,
        apiKey,
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      });
      setReport(r);
    } catch (e: any) {
      setRunError(String(e?.message ?? e));
    } finally {
      setProgress(null);
    }
  }

  if (newest === undefined) {
    return (
      <section>
        <h2>Measure</h2>
        <p>
          No epoch has been published on {props.net.name}, so there is nothing to compare
          against.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Measure</h2>
      <p>
        The Reproducibility panel compares two runs we already published. This one lets you
        take the measurement yourself, now, with your own key, and compare it against epoch{' '}
        <strong>{newest}</strong>. The probes come from that epoch&rsquo;s evidence, not from
        our source — you are replaying what the published numbers were derived from.
      </p>

      <p>
        Your key passes through this site&rsquo;s server to get around the Router&rsquo;s
        origin check. It is not stored and not logged. Use a key with <code>inference</code>{' '}
        scope only. This is the one part of this page that asks you to trust us.
      </p>

      {loadError && <p>Could not read epoch {newest}: {loadError}.</p>}

      {!bundle && !loadError && <p>Fetching epoch {newest}&rsquo;s evidence through the public gateway…</p>}

      {bundle && !selected && (
        <p>
          Epoch {newest} measured no model served by two or more providers, so there is no
          consistency group to replay.
        </p>
      )}

      {bundle && selected && (
        <>
          <label>
            group{' '}
            <select value={selected.canonicalId} onChange={(e) => setGroup(e.target.value)}>
              {groups.map((g) => (
                <option key={g.canonicalId} value={g.canonicalId}>
                  {g.canonicalId} — {g.services} providers, {g.calls} calls
                </option>
              ))}
            </select>
          </label>

          <label>
            Router API key{' '}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </label>

          <p>
            This will send <strong>{selected.calls} calls</strong> on your key, billed at
            whatever those providers charge. The relay caps each call at three times the
            advertised rate.
          </p>

          <button onClick={run} disabled={!apiKey || progress !== null}>
            {progress ? `measuring ${progress.done}/${progress.total}…` : 'Measure'}
          </button>
        </>
      )}

      {runError && (
        <p>
          The run stopped: {runError}.{' '}
          {runError.includes('404')
            ? 'A 404 here means the page is being served without its relay — that endpoint only exists on a real deployment or under `vercel dev`.'
            : 'This is a run failure, not a disagreement between the measurements.'}
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
                    <th>epoch {newest}</th>
                    <th>yours</th>
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
          <p>
            Yours over the published run. Two runs at two times see different load, and
            nothing here can say which one caught a bad minute.
          </p>
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
              <ul>
                {report.onlyPublished.map((s) => (
                  <li key={s}>{s} — epoch {newest} only</li>
                ))}
                {report.onlyIndependent.map((s) => (
                  <li key={s}>{s} — your run only</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
