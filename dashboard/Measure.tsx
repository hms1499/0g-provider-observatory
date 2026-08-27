import { useEffect, useMemo, useState } from 'react';
import { ObservatoryReader } from '../src/chain/registry.js';
import type { VerifiableBundle } from '../src/verify/recompute.js';
import type { ReproduceReport } from '../src/verify/reproduce.js';
import { Masthead } from './Masthead.js';
import { RatioCell } from './RatioCell.js';
import { serviceLabel } from './rows.js';
import { measurableGroups, measureGroup } from './measureGroup.js';
import { formatTokens, formatUsd, groupUsage, type PriceTable } from './estimate.js';
import { Bar, MastheadSkeleton } from './Skeleton.js';
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
  const [prices, setPrices] = useState<PriceTable | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

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

  /**
   * The advertised price list, once there is a key to ask for it with.
   *
   * Reading the catalogue sends no probe and bills nothing, but it does put the key through
   * the relay, so it happens only after one has been typed and the paragraph above the input
   * says it will. Debounced, because otherwise it would fire on every keystroke of a paste.
   *
   * A failure here is not a failure of the panel: the token counts below are read from the
   * evidence and stand without it. Only the money is withheld.
   */
  useEffect(() => {
    if (apiKey.length < 8) {
      setPrices(null);
      setPriceError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/router/prices', {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(String(body?.error ?? `the relay returned ${res.status}`));
        setPrices((body?.prices ?? {}) as PriceTable);
        setPriceError(null);
      } catch (e: any) {
        if (cancelled) return;
        setPrices(null);
        setPriceError(String(e?.message ?? e));
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiKey]);

  /**
   * Which groups are worth a reader's key, and which are not — see `measurableGroups`. The
   * decision is made from what the published run actually got back, not from what its roster
   * intended to measure; the two stopped agreeing the moment an epoch probed every service.
   */
  const choices = useMemo(() => (bundle ? measurableGroups(bundle) : []), [bundle]);
  const offered = useMemo(() => choices.filter((g) => g.replayable), [choices]);
  const withheld = useMemo(() => choices.filter((g) => !g.replayable), [choices]);

  // Only a replayable group can be selected, whatever the picker shows. `group` comes from
  // the select, which cannot yield a disabled option — but the fallback matters on a change
  // of epoch, where a group replayable in the last one may not be in this one.
  const selected = offered.find((g) => g.canonicalId === group) ?? offered[0];
  const probeCount = bundle?.probes.length ?? 0;

  const usage = useMemo(() => {
    if (!bundle || !selected) return null;
    return groupUsage(bundle.results as any, bundle.roster as any, selected.canonicalId, prices);
  }, [bundle, selected, prices]);

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
        Measure the network yourself, now, with your own key, and compare what you get against
        epoch <strong>{newest}</strong>. The probes are replayed from that epoch&rsquo;s
        published evidence rather than from our source, so you are sending exactly what the
        published numbers were derived from.
      </p>
      <p>
        Every other panel on this site reads figures somebody else recorded. This one takes a
        fresh measurement, which is the only check that does not depend on our evidence being
        honest in the first place.
      </p>

      <p>
        Your key passes through this site&rsquo;s server to get around the Router&rsquo;s
        origin check. It is not stored and not logged. Use a key with <code>inference</code>{' '}
        scope only. This is the one part of this page that asks you to trust us.
      </p>
      <p>
        Typing a key also reads the network&rsquo;s advertised price list through that same
        relay, so the figure below is in your rates. That is one request, it sends no probe and
        it bills nothing.
      </p>

      {loadError && <p>Could not read epoch {newest}: {loadError}.</p>}

      {/* The evidence fetch starts the moment this tab opens, so the reader is waiting on
          something they did not ask for, and a single line of text was all this said. */}
      {!bundle && !loadError && (
        <div aria-busy="true">
          <MastheadSkeleton
            labels={['replaying', 'group', 'providers', 'calls', 'cost']}
            note="billed to"
          />
          <p className="grouping">
            Fetching epoch {newest}&rsquo;s evidence through the public gateway…
          </p>
        </div>
      )}

      {bundle && !selected && (
        <p>
          Epoch {newest} published no consistency group both its providers answered, so there
          is nothing here a replay could be compared against.
        </p>
      )}

      {bundle && selected && (
        <>
          <Masthead
            readings={[
              { label: 'replaying', value: `epoch ${newest}` },
              { label: 'group', value: selected.canonicalId },
              { label: 'providers', value: selected.services },
              { label: 'calls', value: selected.calls },
              {
                label: 'cost',
                hint: 'What this group cost the published run, priced at the rates advertised now. The tokens are read from the evidence; only the price applied to them is current. Yours will differ — a reasoning model that thinks for longer bills more.',
                value: <Cost usage={usage} hasKey={apiKey.length >= 8} error={priceError} />,
              },
            ]}
            note={{
              label: 'billed to',
              value:
                'your key, at whatever those providers charge — the relay caps each call at three times the advertised rate',
            }}
          />

          <label>
            group{' '}
            <select value={selected.canonicalId} onChange={(e) => setGroup(e.target.value)}>
              {/*
                Every group in the epoch, with the ones this epoch cannot support disabled in
                place rather than filtered out — see `measurableGroups`. A reader looking for a
                model finds it and learns why it is unavailable, instead of finding nothing and
                concluding the instrument skipped it.
              */}
              {choices.map((g) => (
                <option key={g.canonicalId} value={g.canonicalId} disabled={!g.replayable}>
                  {g.canonicalId} — {g.services} providers,{' '}
                  {g.replayable
                    ? `${g.calls} calls`
                    : `not replayable from epoch ${newest}`}
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
              <table className="readings" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader">service</th>
                    <th role="columnheader">what</th>
                    <th role="columnheader">epoch {newest}</th>
                    <th role="columnheader">yours</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {report.disagreements.map((d, i) => (
                    <tr key={i} role="row">
                      <td role="cell">{serviceLabel(d.service)}</td>
                      <td role="cell" data-label="what">
                        {d.kind}
                      </td>
                      <td role="cell" data-label={`epoch ${newest}`}>
                        {show(d.published)}
                      </td>
                      <td role="cell" data-label="yours">
                        {show(d.independent)}
                      </td>
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
              <ul>
                {report.onlyPublished.map((s) => (
                  <li key={s}>{serviceLabel(s)} — epoch {newest} only</li>
                ))}
                {report.onlyIndependent.map((s) => (
                  <li key={s}>{serviceLabel(s)} — your run only</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/*
        Named, not hidden. A group whose published run could not measure every member has
        nothing to compare a replay against, so it is not offered — but a reader who came to
        check a particular model is owed the reason, and the reason is a fact about this epoch
        rather than a policy of ours.
      */}
      {withheld.length > 0 && (
        <div className="gaps">
          <h3>Groups this epoch cannot support a replay of</h3>
          <p>
            A replay is scored against what the published run measured. Where that run could
            not get enough usable answers from every provider of a model, there is no published
            figure on the other side of the comparison, so the group is left out rather than
            offered as though your key could settle it.
          </p>
          <dl>
            {withheld.map((g) => (
              <div key={g.canonicalId}>
                <dt>{g.canonicalId}</dt>
                <dd>
                  {g.short.map((sv) => (
                    <span key={`${sv.address}|${sv.modelId}`}>
                      {serviceLabel(`${sv.address} ${sv.modelId}`)} answered {sv.successes} of{' '}
                      {probeCount} probes usably.{' '}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

/**
 * What this run is going to cost, at every stage of knowing.
 *
 * Four states, and the difference between them matters more than the number does. Nothing is
 * ever rendered as `$0.00`: an amount that rounds to zero against a button which spends real
 * credit reads as free, and this button is not free.
 *
 * With no key there is still something true to say — the tokens the published run spent are in
 * the evidence and needed no permission to read. That is the honest half of the answer, and it
 * is offered rather than withheld until the reader has handed over a key.
 */
function Cost(props: {
  usage: ReturnType<typeof groupUsage> | null;
  hasKey: boolean;
  error: string | null;
}) {
  const { usage } = props;
  if (!usage) return <span className="pending">—</span>;

  const tokens = (
    <span className="of">
      {formatTokens(usage.promptTokens + usage.completionTokens)} tokens in the published run
    </span>
  );

  if (usage.usd !== null) {
    return (
      <>
        ≈ {formatUsd(usage.usd)} {tokens}
      </>
    );
  }

  if (props.error) {
    return (
      <>
        <span className="pending">not priced</span> <span className="of">{props.error}</span>
      </>
    );
  }

  if (usage.unpriced.length > 0) {
    return (
      <>
        <span className="pending">not priced</span>{' '}
        <span className="of">
          the price list carries no rate for {usage.unpriced.length} of these providers, and a
          total missing one would understate what you spend
        </span>
      </>
    );
  }

  if (props.hasKey) {
    return (
      <>
        <Bar w="6ch" /> {tokens}
      </>
    );
  }

  return (
    <>
      <span className="pending">add a key to price it</span> {tokens}
    </>
  );
}
