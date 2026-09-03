import { useEffect, useMemo, useState } from 'react';
import { isUnmeasured } from '../src/chain/encoding.js';
import type { EpochRecord, Mode, ProviderRecord } from '../src/chain/registry.js';
import { select, toHistories, type Candidate, type OrderBy, type Sample, type Selection } from '../src/sdk/pickProvider.js';
import type { HistoryState } from './selectEpoch.js';
import { formatBps, formatSeconds, shortAddress } from './rows.js';
import { Bar } from './Skeleton.js';

const MODES: Array<Mode | ''> = ['', 'TeeML', 'TeeTLS', 'standard'];
const ORDERS: OrderBy[] = ['p50', 'p95', 'errorRate'];

function num(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function copiedText(c: Candidate): string {
  return [
    `X-0G-Provider-Address: ${c.address}`,
    `model: ${c.model}`,
  ].join('\n');
}

function routerSnippet(c: Candidate): string {
  return [
    "await fetch('https://router-api.0g.ai/v1/chat/completions', {",
    "  method: 'POST',",
    '  headers: {',
    "    authorization: `Bearer ${process.env.ROUTER_API_KEY}`,",
    "    'content-type': 'application/json',",
    `    'X-0G-Provider-Address': '${c.address}',`,
    '  },',
    '  body: JSON.stringify({',
    `    model: '${c.model}',`,
    "    messages: [{ role: 'user', content: 'Say hello from the pinned provider.' }],",
    '  }),',
    '});',
  ].join('\n');
}

export function Pick(props: {
  records: readonly EpochRecord[];
  providers: readonly ProviderRecord[];
  epochs: readonly number[];
  history: HistoryState;
  prefillModel: string | null;
  onModel: (model: string | null) => void;
}) {
  const { onModel } = props;
  const publishedCount = props.epochs.length;
  const models = useMemo(
    () => [...new Set(props.providers.map((p) => p.model).filter((m): m is string => m !== null))]
      .sort(),
    [props.providers],
  );
  const [model, setModel] = useState(props.prefillModel ?? models[0] ?? '');
  const [mode, setMode] = useState<Mode | ''>('');
  const [maxP95, setMaxP95] = useState('');
  const [maxP50, setMaxP50] = useState('');
  const [maxErrors, setMaxErrors] = useState('');
  const [minEpochs, setMinEpochs] = useState('1');
  const [maxAgeHours, setMaxAgeHours] = useState('');
  const [windowSize, setWindowSize] = useState('5');
  const [orderBy, setOrderBy] = useState<OrderBy>('p50');
  const [requireNoDivergence, setRequireNoDivergence] = useState(false);
  const [copied, setCopied] = useState<'pin' | 'call' | null>(null);

  useEffect(() => {
    if (props.prefillModel !== null) setModel(props.prefillModel);
  }, [props.prefillModel]);

  useEffect(() => {
    if (!model && models[0]) setModel(models[0]);
  }, [model, models]);

  useEffect(() => {
    onModel(model || null);
    setCopied(null);
  }, [model, onModel]);

  const windowRecords = useMemo(() => {
    const n = Math.max(1, Math.floor(num(windowSize) ?? 5));
    return [...props.records].sort((a, b) => a.epoch - b.epoch).slice(-n);
  }, [props.records, windowSize]);

  const histories = useMemo(
    () => toHistories(windowRecords, props.providers),
    [props.providers, windowRecords],
  );

  const result = useMemo(() => {
    if (!model) return null;
    return select(histories, {
      model,
      mode: mode || undefined,
      maxP50Ms: num(maxP50),
      maxP95Ms: num(maxP95),
      maxErrorRateBps: num(maxErrors) === undefined ? undefined : Math.round(num(maxErrors)! * 100),
      requireNoDivergence: requireNoDivergence || undefined,
      minEpochs: Math.max(1, Math.floor(num(minEpochs) ?? 1)),
      maxAgeMs: num(maxAgeHours) === undefined ? undefined : num(maxAgeHours)! * 3_600_000,
      orderBy,
    });
  }, [
    maxAgeHours,
    maxErrors,
    maxP50,
    maxP95,
    minEpochs,
    mode,
    model,
    orderBy,
    histories,
    requireNoDivergence,
  ]);

  const bestSamples = useMemo(() => {
    if (!result?.best) return [];
    const best = result.best;
    return histories.find(
      (h) => h.model === best.model && h.address.toLowerCase() === best.address.toLowerCase(),
    )?.samples ?? [];
  }, [histories, result]);

  async function copyPin(c: Candidate) {
    await navigator.clipboard.writeText(copiedText(c));
    setCopied('pin');
  }

  async function copyCall(c: Candidate) {
    await navigator.clipboard.writeText(routerSnippet(c));
    setCopied('call');
  }

  return (
    <section>
      <h2>Pick Provider</h2>
      <p>
        Choose a model and the constraints your application actually needs. This uses the same
        decision rules as <code>pnpm pick</code>: one ordering axis, exact criteria, and named
        rejections instead of a hidden score.
      </p>

      <div className="pick-panel">
        <div className="pick-controls">
          <label>
            model
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label>
            mode
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode | '')}>
              {MODES.map((m) => (
                <option key={m || 'any'} value={m}>
                  {m || 'any'}
                </option>
              ))}
            </select>
          </label>

          <label>
            order by
            <select value={orderBy} onChange={(e) => setOrderBy(e.target.value as OrderBy)}>
              {ORDERS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>

          <label>
            epochs
            <input
              inputMode="numeric"
              min="1"
              type="number"
              value={windowSize}
              onChange={(e) => setWindowSize(e.target.value)}
            />
          </label>

          <label>
            min epochs
            <input
              inputMode="numeric"
              min="1"
              type="number"
              value={minEpochs}
              onChange={(e) => setMinEpochs(e.target.value)}
            />
          </label>

          <label>
            max age hours
            <input
              inputMode="numeric"
              min="0"
              type="number"
              value={maxAgeHours}
              onChange={(e) => setMaxAgeHours(e.target.value)}
            />
          </label>

          <label>
            max p50 ms
            <input inputMode="numeric" type="number" value={maxP50} onChange={(e) => setMaxP50(e.target.value)} />
          </label>

          <label>
            max p95 ms
            <input inputMode="numeric" type="number" value={maxP95} onChange={(e) => setMaxP95(e.target.value)} />
          </label>

          <label>
            max errors %
            <input inputMode="decimal" type="number" value={maxErrors} onChange={(e) => setMaxErrors(e.target.value)} />
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={requireNoDivergence}
              onChange={(e) => setRequireNoDivergence(e.target.checked)}
            />
            no measured divergence
          </label>
        </div>

        <p className="pick-window">
          Loaded window:{' '}
          {windowRecords.length > 0
            ? windowRecords.map((r) => r.epoch).join(', ')
            : props.history === 'loading'
              ? 'still reading published epochs'
              : 'no records loaded'}
          {props.history === 'loading' && <Bar w="5rem" />}
          {windowRecords.length > 0 && ` · ${windowRecords.length} of ${publishedCount} published epoch${publishedCount === 1 ? '' : 's'} read`}
          {props.history === 'failed' && ' · history reads failed'}
        </p>

        {result && (
          <PickResult
            result={result}
            samples={bestSamples}
            onCopyPin={copyPin}
            onCopyCall={copyCall}
            copied={copied}
          />
        )}
      </div>
    </section>
  );
}

function PickResult(props: {
  result: Selection;
  samples: readonly Sample[];
  onCopyPin: (candidate: Candidate) => void;
  onCopyCall: (candidate: Candidate) => void;
  copied: 'pin' | 'call' | null;
}) {
  const { result } = props;
  if (result.consideredCount === 0) {
    return (
      <div className="pick-result">
        <h3>No measured service in this window serves that model</h3>
        <p>
          The match is exact, using the model string the registry records. Check the Providers
          table if the model exists under a different spelling.
        </p>
      </div>
    );
  }

  if (!result.best) {
    return (
      <div className="pick-result">
        <h3>No provider met those constraints</h3>
        <Rejections rejected={result.rejected} />
      </div>
    );
  }

  const best = result.best;
  return (
    <div className="pick-result">
      <div className="pick-best">
        <p className="eyebrow">Best match</p>
        <h3 title={best.address}>{shortAddress(best.address)}</h3>
        <p>
          {best.mode}
          {best.modeChanged ? ' · mode changed in this window' : ''} · {best.epochsUsed}{' '}
          epoch{best.epochsUsed === 1 ? '' : 's'} · {best.calls} calls
        </p>
        <dl>
          <div>
            <dt>p50</dt>
            <dd>{formatSeconds(best.p50Ms)}s</dd>
          </div>
          <div>
            <dt>worst p95</dt>
            <dd>{formatSeconds(best.p95Ms)}s</dd>
          </div>
          <div>
            <dt>errors</dt>
            <dd>{formatBps(best.errorRateBps)}</dd>
          </div>
          <div>
            <dt>divergence</dt>
            <dd>
              {best.divergedIn} / {best.divergenceMeasuredIn}
            </dd>
          </div>
        </dl>
        <div className="pick-actions">
          <button onClick={() => props.onCopyPin(best)}>
            {props.copied === 'pin' ? 'Copied' : 'Copy Router pin'}
          </button>
          <button className="secondary" onClick={() => props.onCopyCall(best)}>
            {props.copied === 'call' ? 'Copied' : 'Copy Router call'}
          </button>
        </div>
        <pre>{copiedText(best)}</pre>
        <h3>Router call</h3>
        <pre>{routerSnippet(best)}</pre>
      </div>

      <PickHistory samples={props.samples} />

      {result.matches.length > 1 && (
        <>
          <h3>Other matches</h3>
          <table className="readings pick-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">provider</th>
                <th role="columnheader">mode</th>
                <th className="num" role="columnheader">p50</th>
                <th className="num" role="columnheader">p95</th>
                <th className="num" role="columnheader">errors</th>
                <th className="num" role="columnheader">epochs</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {result.matches.slice(1).map((m) => (
                <tr key={m.address} role="row">
                  <td role="cell" data-label="provider" title={m.address}>{shortAddress(m.address)}</td>
                  <td role="cell" data-label="mode">{m.mode}</td>
                  <td className="num" role="cell" data-label="p50">{formatSeconds(m.p50Ms)}s</td>
                  <td className="num" role="cell" data-label="p95">{formatSeconds(m.p95Ms)}s</td>
                  <td className="num" role="cell" data-label="errors">{formatBps(m.errorRateBps)}</td>
                  <td className="num" role="cell" data-label="epochs">{m.epochsUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {result.rejected.length > 0 && <Rejections rejected={result.rejected} />}
    </div>
  );
}

function PickHistory(props: { samples: readonly Sample[] }) {
  const samples = [...props.samples].sort((a, b) => a.epoch - b.epoch);
  if (samples.length === 0) return null;
  const max = Math.max(...samples.map((s) => s.p95Ms), 1);

  return (
    <>
      <h3>Why this provider</h3>
      <table className="readings pick-history" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader">epoch</th>
            <th role="columnheader">mode</th>
            <th className="num" role="columnheader">p50</th>
            <th className="num" role="columnheader">p95</th>
            <th className="num" role="columnheader">errors</th>
            <th className="num" role="columnheader">divergence</th>
            <th role="columnheader">shape</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {samples.map((s) => (
            <tr key={s.epoch} role="row">
              <td role="cell" data-label="epoch">{s.epoch}</td>
              <td role="cell" data-label="mode">{s.observedMode}</td>
              <td className="num" role="cell" data-label="p50">{formatSeconds(s.p50Ms)}s</td>
              <td className="num" role="cell" data-label="p95">{formatSeconds(s.p95Ms)}s</td>
              <td className="num" role="cell" data-label="errors">{formatBps(s.errorRateBps)}</td>
              <td className="num" role="cell" data-label="divergence">
                {isUnmeasured(s.divergenceBps) ? 'unmeasured' : formatBps(s.divergenceBps)}
              </td>
              <td role="cell" data-label="shape">
                <div className="history-track" aria-label={`p50 ${s.p50Ms}ms, p95 ${s.p95Ms}ms`}>
                  <span className="p95" style={{ width: `${Math.max(2, (s.p95Ms / max) * 100)}%` }} />
                  <span className="p50" style={{ width: `${Math.max(2, (s.p50Ms / max) * 100)}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Rejections(props: { rejected: readonly { address: string; reason: string }[] }) {
  return (
    <>
      <h3>Rejected</h3>
      <dl className="pick-rejections">
        {props.rejected.map((r) => (
          <div key={`${r.address}-${r.reason}`}>
            <dt title={r.address}>{shortAddress(r.address)}</dt>
            <dd>{r.reason}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
