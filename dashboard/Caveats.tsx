import { MODE_NOTES } from './modes.js';

/**
 * The things a reader would otherwise have to guess. Principle 04: state plainly what we do
 * not know, on the dashboard, rather than glossing over it.
 */
export function Caveats() {
  return (
    <section>
      <h2>What these numbers are, and what they are not</h2>

      <h3>Guarantee modes</h3>
      <dl>
        {Object.values(MODE_NOTES).map((m) => (
          <div key={m.label}>
            <dt>{m.label}</dt>
            <dd>{m.means}</dd>
          </div>
        ))}
      </dl>

      <h3>What we do not know</h3>
      <ul>
        <li>
          We cannot weight by traffic. We do not know how real usage is distributed across
          these providers, so a slow provider here may serve almost nobody, and a fast one
          may serve almost everybody.
        </li>
        <li>
          A single epoch sends 15 probes per service, so that epoch&rsquo;s p95 <em>is</em> its
          slowest call and carries almost no tail information. It becomes meaningful only
          once epochs are pooled.
        </li>
        <li>
          Three chatbot services registered on chain are never exposed by the Router. Header
          pinning cannot reach them, so they appear in no measurement here.
        </li>
        <li>
          Divergence is a distance, never a verdict. A provider that differs from its peers
          may be running a different model, quantisation, sampler or system prompt, and this
          measurement cannot tell which.
        </li>
      </ul>
    </section>
  );
}
