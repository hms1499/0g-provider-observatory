import { NETWORKS, type NetworkKey } from './networks.js';
import { THEMES, type Theme } from './theme.js';

/**
 * The tab icon's glyph, inline. The mark on the page and the mark in the browser tab being the
 * same drawing is most of what makes a site feel like one thing rather than a template — so
 * this and `public/favicon.svg` carry the same four paths, and changing one means changing
 * both.
 *
 * Three readings on one scale: every tick the same length, only its position differing. It is
 * the drawing the Providers table puts under every duration, which is the point — the mark
 * says what the instrument does rather than what category of software it is.
 *
 * The strokes were 9, 15 and 9 tall, under a comment in the favicon saying the mark was
 * "deliberately not bars of differing height, which would read as a ranking of the providers
 * being measured". The comment was right and the drawing was not: a small-medium-small bar
 * chart sat on the tab and in the header of a site whose first rule is that it does not rank
 * the people it measures.
 */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M4 23h24" />
        <path d="M8 23v-10" />
        <path d="M14 23v-10" />
        <path d="M25 23v-10" />
      </g>
    </svg>
  );
}

export type Panel = 'providers' | 'verify' | 'reproduce' | 'measure' | 'pick';

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
  theme: Theme;
  onTheme: (theme: Theme) => void;
}) {
  const tabs: Array<{ id: Panel; label: string }> = [
    { id: 'providers', label: 'Providers' },
    { id: 'verify', label: 'Verify' },
    { id: 'reproduce', label: 'Reproducibility' },
    { id: 'measure', label: 'Measure' },
    { id: 'pick', label: 'Pick' },
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

        <div className="settings">
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

          {/*
            Which ground the page is drawn on.

            Three states rather than a toggle, and `system` is one of them. A two-way switch
            decides for the reader the first time they load the page — whatever it happens to
            be showing becomes a choice they did not make, with no way back to "whatever my
            system says", which is the state most readers want.

            It sits under the chain switch and reads as the lesser of the two, because it is:
            the chain changes what every figure below means, and this changes nothing but the
            light it is read in.
          */}
          <div className="ground">
            <span className="label" id="ground-label">
              ground
            </span>
            <div className="switch" role="group" aria-labelledby="ground-label">
              {THEMES.map((t) => (
                <button
                  key={t}
                  onClick={() => props.onTheme(t)}
                  aria-pressed={t === props.theme}
                  title={
                    t === 'system'
                      ? 'Follow the system setting, and keep following it'
                      : `Always draw this page on ${t === 'dark' ? 'the night' : 'the paper'} ground`
                  }
                >
                  {t}
                </button>
              ))}
            </div>
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
