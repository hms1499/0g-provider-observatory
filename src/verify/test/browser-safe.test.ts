import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { builtinModules } from 'node:module';

/**
 * The dashboard runs in a browser and imports these modules. Everything they reach,
 * transitively, must be browser-safe. `src/config.ts` is the specific hazard: it calls
 * `dotenv/config` and reads `process.env`, and one careless import of RPC_URL inside
 * `registry.ts` would break the dashboard build with nothing in the type system to catch it.
 *
 * `dashboard/main.tsx` is included, not just the `src/` modules it pulls in: the reviewer
 * proved that a bad import landing anywhere under `dashboard/` (e.g. `dashboard/rows.ts`
 * importing `src/config.js` directly) passed both gates when only `src/` entrypoints were
 * walked. Following the page's real entrypoint closes that hole.
 */
const BROWSER_ENTRYPOINTS = [
  'src/chain/registry.ts',
  'src/chain/abi.ts',
  'src/verify/recompute.ts',
  'src/verify/check.ts',
  'src/verify/reproduce.ts',
  'src/storage/merkle.ts',
  'dashboard/main.tsx',
];

const BUILTINS = new Set(builtinModules);

/** Cannot run in a browser. `ethers` is fine — it ships a browser build. */
function isNodeOnly(spec: string): boolean {
  if (spec.startsWith('node:')) return true;
  if (spec === 'dotenv' || spec.startsWith('dotenv/')) return true;
  return BUILTINS.has(spec.split('/')[0]);
}

/** Every module specifier a file references — imports, `export … from`, and dynamic
 * `import()` alike. Hand-rolled regexes miss re-exports, which is precisely the shape
 * that would smuggle `config.ts` into browser-bound code. */
function specifiersOf(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((f) => f.fileName);
}

/**
 * A relative import written as `./Foo.js` resolves to `./Foo.ts` almost everywhere in this
 * repo, but the dashboard also has `.tsx` components (`App.tsx`, `main.tsx`, …) that are
 * imported the same `./App.js` way. Try `.ts` first, then `.tsx`, so a component file is not
 * silently invisible to the walker — it must reach `readFileSync`, not vanish as a dangling
 * path that happens not to exist.
 */
function resolveRelative(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const ext of ['.ts', '.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return base + '.ts';
}

/**
 * Assets a bundler turns into something other than a module — a stylesheet, an image, a
 * font. `dashboard/main.tsx` imports `./styles.css` the way Vite expects, and there is no
 * `styles.css.ts` to read, so the walker has to recognise these rather than build a
 * dangling path and die on `readFileSync`.
 *
 * They are skipped rather than followed because they carry no import statements and cannot
 * reach a node-only module. Note this list is deliberately explicit: an unrecognised
 * relative specifier that resolves to nothing still fails loudly, which is what keeps a
 * genuinely missing module from slipping past as an assumed asset.
 */
const ASSET_EXTENSIONS = /\.(css|json|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i;

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
    for (const spec of specifiersOf(source)) {
      if (!spec.startsWith('.')) {
        bare.push({ from: file, spec });
        continue;
      }
      if (ASSET_EXTENSIONS.test(spec)) continue;
      const resolved = resolveRelative(file, spec);
      // Skip relative imports that point into node_modules; these are external packages
      // accessed by their real path, and the bundler handles them, not the walker.
      if (!resolved.includes('node_modules')) {
        queue.push(resolved);
      }
    }
  }
  return { files: [...seen], bare };
}

/**
 * The import scan cannot see through a package barrel: a bare specifier that is not itself
 * node-only still drags in whatever that package's entry re-exports. That is exactly how a
 * broken bundle passed this guard once already, so the guard bundles for real.
 */
function bundles(entry: string): { ok: boolean; output: string } {
  try {
    execFileSync(
      'npx',
      [
        'esbuild',
        entry,
        '--bundle',
        '--platform=browser',
        '--format=esm',
        // Matches tsconfig's "jsx": "react-jsx" — the automatic runtime the real dashboard
        // build (vite + @vitejs/plugin-react) uses, so a .tsx entrypoint like main.tsx
        // bundles the same way here as it does for real.
        '--jsx=automatic',
        // The page imports its stylesheet the way Vite expects. This guard asks whether the
        // JavaScript is browser-safe, and a stylesheet cannot answer that question either
        // way, so it is emptied rather than compiled — without this, esbuild refuses the
        // import outright and the guard fails for a reason that has nothing to do with what
        // it exists to catch.
        '--loader:.css=empty',
        '--outfile=/dev/null',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { ok: true, output: '' };
  } catch (e: any) {
    return { ok: false, output: String(e.stderr ?? e.stdout ?? e.message) };
  }
}

describe('the modules the dashboard imports stay browser-safe', () => {
  for (const entry of BROWSER_ENTRYPOINTS) {
    it(`${entry} reaches nothing node-only`, () => {
      const { bare } = walk(entry);
      const offenders = bare.filter((b) => isNodeOnly(b.spec));
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

describe('the browser entrypoints actually bundle for real', { timeout: 60000 }, () => {
  for (const entry of BROWSER_ENTRYPOINTS) {
    it(`${entry} bundles with esbuild for browser`, () => {
      const result = bundles(entry);
      assert.ok(
        result.ok,
        result.output ? `bundle failed:\n${result.output}` : 'bundle failed with no error message',
      );
    });
  }
});
