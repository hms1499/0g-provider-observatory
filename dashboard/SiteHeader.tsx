import { NETWORKS, type NetworkKey } from './networks.js';

/** The tab icon's glyph, inline. The mark on the page and the mark in the browser tab being
 *  the same drawing is most of what makes a site feel like one thing rather than a template. */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M4 23h24" />
        <path d="M8 23v-9" />
        <path d="M16 23v-15" />
        <path d="M24 23v-9" />
      </g>
    </svg>
  );
}

export type Panel = 'providers' | 'verify' | 'reproduce' | 'measure';

/**
 * The site header.
 *
 * Two rows doing two different jobs, which the previous single stack of chips did not
 * distinguish. The top row is identity and context — the mark, the wordmark, and which chain
 * is being read. The second is navigation between sections of one document, so the tabs are
 * underlined rather than filled: a filled chip reads as a button that does something, and
 * these only move the reader.
 *
 * The chain selector sits opposite the wordmark because it is not navigation. It changes what
 * everything below means, and a control with that much reach belongs where a reader looks for
 * "where am I", not in the row they use to move around.
 */
export function SiteHeader(props: {
  network: NetworkKey;
  onNetwork: (key: NetworkKey) => void;
  panel: Panel;
  onPanel: (panel: Panel) => void;
}) {
  const tabs: Array<{ id: Panel; label: string }> = [
    { id: 'providers', label: 'Providers' },
    { id: 'verify', label: 'Verify' },
    { id: 'reproduce', label: 'Reproducibility' },
    { id: 'measure', label: 'Measure' },
  ];

  return (
    <header className="site">
      <div className="bar">
        <div className="identity">
          <Mark />
          <div>
            <h1>0G Provider Observatory</h1>
            <p>An independent measurement layer for 0G&rsquo;s inference network.</p>
          </div>
        </div>

        <div className="chain">
          <span className="label" id="chain-label">
            reading
          </span>
          <div className="switch" role="group" aria-labelledby="chain-label">
            {(['mainnet', 'testnet'] as NetworkKey[]).map((k) => (
              <button
                key={k}
                onClick={() => props.onNetwork(k)}
                aria-pressed={k === props.network}
                title={`${NETWORKS[k].name} · chain ${NETWORKS[k].chainId}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      <nav className="tabs" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => props.onPanel(t.id)} aria-pressed={t.id === props.panel}>
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
