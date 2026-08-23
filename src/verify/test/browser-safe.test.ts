import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { builtinModules } from 'node:module';

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
      queue.push(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
    }
  }
  return { files: [...seen], bare };
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
