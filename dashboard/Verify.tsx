import { useState } from 'react';
import { ObservatoryReader, type ProviderRecord } from '../src/chain/registry.js';
import { bundleUrl, type NetworkConfig } from './networks.js';
import { verifyEpochInBrowser, type VerifyOutcome } from './verifyEpoch.js';

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
          indexerUrl: props.net.indexerUrl,
          fetchBytes: async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`gateway returned ${res.status}`);
            return res.text();
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

      {outcome && (
        <div>
          <ol>
            {outcome.steps.map((s, i) => (
              <li key={i}>
                <strong>{s.status === 'ok' ? 'ok' : 'FAIL'}</strong> {s.label}
                {s.detail && <span> — {s.detail}</span>}
              </li>
            ))}
          </ol>

          {outcome.verdict === 'verified' ? (
            <p>Verified. All {outcome.checked} published measurements recomputed exactly.</p>
          ) : (
            <>
              <p>Not verified.</p>
              <ul>
                {outcome.findings.map((f, i) => (
                  <li key={i}>
                    {f.severity} — {f.service}: {f.message}
                  </li>
                ))}
              </ul>
            </>
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
