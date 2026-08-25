import { useState } from 'react';
import { ObservatoryReader, type ProviderRecord } from '../src/chain/registry.js';
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

      <details>
        <summary>Recomputing is one question. Measuring it yourself is another.</summary>
        <p>
          The check below asks whether the published numbers follow from the published
          evidence. It cannot tell you whether the method itself holds up. For that, run the
          same instrument on your own key and compare what the two runs concluded.
        </p>
        <pre>
{`# your own run — nothing is written to the chain
pnpm epoch --confirm --no-lock --budget-usd=0.80 --exclude=

# compare it against a published epoch
pnpm reproduce data/epochs/<your-bundle>.json ${props.epochs.at(-1) ?? 496539}`}
        </pre>
        <p>
          That measures all 10 multi-provider groups — 23 services, 345 calls, about $0.78
          of inference on your own key. Drop both flags to measure only the pinned series
          instead: 10 services, about $0.055.
        </p>
        <p>
          Latency is reported as a ratio and never scored — two runs at two times see
          different load. What gets compared is the conclusion: the observed mode, whether
          divergence could be measured at all, whether the service diverges from its peers,
          and the error rate past a tolerance of one failed call in fifteen. Neither run is
          treated as correct.
        </p>
      </details>

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
        <div>
          <ol>
            {outcome.steps.map((s, i) => (
              <li key={i}>
                <strong data-status={s.status}>{s.status === 'ok' ? 'ok' : 'FAIL'}</strong> {s.label}
                {s.detail && <span> — {s.detail}</span>}
              </li>
            ))}
          </ol>

          {outcome.verdict === 'verified' ? (
            <>
              <p>Verified. All {outcome.checked} published measurements recomputed exactly.</p>
              {outcome.findings.length > 0 && (
                <>
                  <p>
                    Advisory — not blocking the verdict. The evidence supports these
                    measurements, but the chain never published them.
                  </p>
                  <ul>
                    {outcome.findings.map((f, i) => (
                      <li key={i}>
                        {f.severity} — {f.service}: {f.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
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
