import { useState } from 'react';
import { ObservatoryReader, type ProviderRecord } from '../src/chain/registry.js';
import { Masthead } from './Masthead.js';
import { bundleUrl, type NetworkConfig } from './networks.js';
import { verifyEpochInBrowser, type VerifyOutcome } from './verifyEpoch.js';

/** How long to wait for the storage gateway before treating the fetch as failed. Chain reads
 * get this for free from ethers' own AbortController; a bare `fetch` does not, so a hanging
 * indexer would otherwise leave the button disabled forever with no error and no timeout. */
const GATEWAY_TIMEOUT_MS = 30_000;

export function Verify(props: {
  net: NetworkConfig;
  epochs: readonly number[];
  providers: readonly ProviderRecord[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <ul>
          {props.epochs.map((e) => (
            <li key={e}>
              <button onClick={() => run(e)} disabled={busy}>
                epoch {e}
              </button>
              {selected === e && busy && <span> checking…</span>}
            </li>
          ))}
        </ul>
      )}

      {outcome && (
        <div className="log">
          <Masthead
            readings={[
              { label: 'epoch', value: selected ?? '—' },
              { label: 'steps', value: outcome.steps.length },
              { label: 'measurements', value: outcome.checked },
              {
                label: 'advisories',
                value: outcome.findings.length === 0 ? 'none' : outcome.findings.length,
              },
            ]}
          />

          <ol>
            {outcome.steps.map((s, i) => (
              <li key={i}>
                <strong data-status={s.status}>{s.status === 'ok' ? 'ok' : 'FAIL'}</strong>{' '}
                <span className="what">{s.label}</span>
                {s.detail && <span className="detail">{s.detail}</span>}
              </li>
            ))}
          </ol>

          {/*
            The one loud element on the page, and the only place it is spent. F7 is the claim
            the whole project rests on — that a stranger can recompute every published number
            from the published evidence — so the moment it comes back clean is stated as a
            result, not as a sentence in a paragraph. Colour here reports the outcome of a
            check, which is a state; nothing on this page colours a provider.
          */}
          <p className="stamp" data-verdict={outcome.verdict}>
            <span className="verdict">
              {outcome.verdict === 'verified' ? 'verified' : 'not verified'}
            </span>
            <span className="census">
              {outcome.checked} measurement{outcome.checked === 1 ? '' : 's'} recomputed
              {outcome.verdict === 'verified' ? ' exactly' : ''} · epoch {selected}
            </span>
          </p>

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
