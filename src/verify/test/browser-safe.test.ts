import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The dashboard runs in a browser and imports these four modules. Everything they reach,
 * transitively, must be browser-safe. `src/config.ts` is the specific hazard: it calls
 * `dotenv/config` and reads `process.env`, and one careless import of RPC_URL inside
 * `registry.ts` would break the dashboard build with nothing in the type system to catch it.
 */
const BROWSER_ENTRYPOINTS = [
  'src/chain/registry.ts',
  'src/chain/abi.ts',
  'src/verify/recompute.ts',
  'src/verify/check.ts',
];

/** Bare specifiers that cannot run in a browser. `ethers` is fine — it ships a browser build. */
const NODE_ONLY = /^(node:|fs$|fs\/|path$|os$|crypto$|dotenv$|dotenv\/)/;

const IMPORT_RE = /^\s*import\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm;

/** Every module reachable from an entrypoint, plus every bare specifier it pulls in. */
function walk(entry: string): { files: string[]; bare: Array<{ from: string; spec: string }> } {
  const seen = new Set<string>();
  const bare: Array<{ from: string; spec: string }> = [];
  const queue = [resolve(entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!spec.startsWith('.')) {
        bare.push({ from: file, spec });
        continue;
      }
      queue.push(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
    }
  }
  return { files: [...seen], bare };
}

describe('the modules the dashboard imports stay browser-safe', () => {
  for (const entry of BROWSER_ENTRYPOINTS) {
    it(`${entry} reaches nothing node-only`, () => {
      const { bare } = walk(entry);
      const offenders = bare.filter((b) => NODE_ONLY.test(b.spec));
      assert.deepEqual(
        offenders,
        [],
        `browser-bound code imported a node-only module:\n` +
          offenders.map((o) => `  ${o.from} imports ${o.spec}`).join('\n'),
      );
    });
  }

  it('actually follows relative imports rather than only reading the entry file', () => {
    // registry.ts imports ./abi.js, so the closure must be larger than one file.
    const { files } = walk('src/chain/registry.ts');
    assert.ok(files.length > 1, 'the walk did not follow any relative import');
  });
});
