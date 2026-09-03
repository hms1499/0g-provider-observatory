import { useEffect, useMemo, useState } from 'react';
import type { EpochRecord, Mode, ProviderRecord } from '../src/chain/registry.js';
import { select, toHistories, type Candidate, type OrderBy, type Selection } from '../src/sdk/pickProvider.js';
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (props.prefillModel !== null) setModel(props.prefillModel);
  }, [props.prefillModel]);

  useEffect(() => {
    if (!model && models[0]) setModel(models[0]);
  }, [model, models]);

  useEffect(() => {
    onModel(model || null);
    setCopied(false);
  }, [model, onModel]);

  const windowRecords = useMemo(() => {
    const n = Math.max(1, Math.floor(num(windowSize) ?? 5));
    return [...props.records].sort((a, b) => a.epoch - b.epoch).slice(-n);
  }, [props.records, windowSize]);

  const result = useMemo(() => {
    if (!model) return null;
    return select(toHistories(windowRecords, props.providers), {
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
    props.providers,
    requireNoDivergence,
    windowRecords,
  ]);

  async function copy(c: Candidate) {
    await navigator.clipboard.writeText(copiedText(c));
    setCopied(true);
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
          Window:{' '}
          {windowRecords.length > 0
            ? windowRecords.map((r) => r.epoch).join(', ')
            : props.history === 'loading'
              ? 'still reading published epochs'
              : 'no records loaded'}
          {props.history === 'loading' && <Bar w="5rem" />}
          {windowRecords.length > 0 && ` · ${publishedCount} published epoch${publishedCount === 1 ? '' : 's'}`}
        </p>

        {result && <PickResult result={result} onCopy={copy} copied={copied} />}
      </div>
    </section>
  );
}

function PickResult(props: {
  result: Selection;
  onCopy: (candidate: Candidate) => void;
  copied: boolean;
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
        <button onClick={() => props.onCopy(best)}>
          {props.copied ? 'Copied' : 'Copy Router pin'}
        </button>
        <pre>{copiedText(best)}</pre>
      </div>

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
