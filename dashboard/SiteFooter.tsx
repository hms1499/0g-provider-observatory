import { explorerAddress, isDeployed, type NetworkConfig } from './networks.js';

/**
 * The colophon.
 *
 * An observatory publication names its instrument. Everything here is a fact a reader can
 * check without asking us: the chain, the two contracts, the address whose measurements these
 * are, and the gateway the evidence is fetched through. Until now those addresses reached the
 * page only inside table rows, which meant a reader who wanted to look the project up on the
 * explorer had to find a row first.
 *
 * Every link here resolves to something a reader can open. The source is included now that it
 * is public; when it was not, this footer said nothing rather than carrying a placeholder.
 */
export function SiteFooter({ net }: { net: NetworkConfig }) {
  const rows: Array<{ label: string; address: string }> = [
    { label: 'ProviderRegistry', address: net.providerRegistry },
    { label: 'MeasurementRegistry', address: net.measurementRegistry },
    { label: 'prober', address: net.prober },
  ];

  return (
    <footer className="site">
      <div className="cols">
        <div className="col about">
          <h2>0G Provider Observatory</h2>
          <p>
            Providers are chosen on figures the network reports about itself. This measures
            them independently, one epoch per clock hour, and writes each result to a
            write-once ledger with a pointer to the evidence it came from.
          </p>
          <p className="stance">
            An instrument, not an indictment. It reports what it measured and never ranks the
            people running the network.
          </p>
        </div>

        <div className="col">
          <h3>On chain</h3>
          {isDeployed(net) ? (
            <dl>
              {rows.map((r) => (
                <div key={r.label}>
                  <dt>{r.label}</dt>
                  <dd>
                    <a href={explorerAddress(net, r.address)} target="_blank" rel="noreferrer">
                      {r.address}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>Not deployed on {net.name}.</p>
          )}
        </div>

        <div className="col">
          <h3>Read it yourself</h3>
          <p className="source">
            <a
              href="https://github.com/hms1499/0g-provider-observatory"
              target="_blank"
              rel="noreferrer"
            >
              Source on GitHub
            </a>{' '}
            — the prober, the contracts, and this page. The same figures pick a provider from
            code: <code>pnpm pick</code>, reading this chain directly.
          </p>
          <dl>
            <div>
              <dt>network</dt>
              <dd>
                {net.name} · chain {net.chainId}
              </dd>
            </div>
            <div>
              <dt>rpc</dt>
              <dd>{net.rpcUrl}</dd>
            </div>
            <div>
              <dt>evidence</dt>
              <dd>{net.indexerUrl}</dd>
            </div>
          </dl>
          <p>
            Nothing on this page is served from a database of ours. Every figure is read from
            the chain and the evidence store above, in your browser.
          </p>
        </div>
      </div>
    </footer>
  );
}
