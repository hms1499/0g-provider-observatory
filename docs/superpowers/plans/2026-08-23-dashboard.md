# T9 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-only dashboard that shows the Observatory's measurements read straight from 0G Chain and 0G Storage, and re-verifies any published epoch in the page itself.

**Architecture:** Vite + React + TypeScript under `dashboard/`, built from the repository's single root `package.json`. The page imports the same reader and recomputation modules the CLI uses — no copies, no backend, no build-time data snapshot. Two panels: Providers and Verify.

**Tech Stack:** TypeScript 5.6, React 18, Vite 5, ethers 6, `@0gfoundation/0g-storage-ts-sdk` (for `MemData` only), `node:test` for all logic tests.

**Spec:** `docs/superpowers/specs/2026-08-23-dashboard-design.md`

## Global Constraints

- **All project artefacts are in English** — code, comments, UI copy, commit messages.
- **No backend, no API of ours, no build-time snapshot of measurements.** Every measurement shown must come from a live RPC or the storage gateway at view time.
- **Never pool by address.** The unit is the `(address, model)` pair. Grouping under an operator is for navigation only; no number is averaged across models.
- **`standard` mode is shown with its technical reason and is never scored down.**
- **A service below the sample floor appears as a labelled gap, never a silent omission.**
- **Every number links to its source** — the publishing transaction, and the evidence bundle.
- Contract addresses come from `deployments/<network>.json`. Counts are read from chain, never hardcoded.
- One root `package.json`. One `pnpm typecheck` must cover `src/` and `dashboard/`.
- Existing suites must stay green: `pnpm test` (126 tests) and `pnpm contracts:test` (26 tests).

---

### Task 1: Guard the browser-safe import boundary

The dashboard imports four modules from `src/`. If any of them ever reaches `src/config.ts` — which calls `dotenv/config` and reads `process.env` — the dashboard build breaks silently. Nothing in the type system prevents that, so a test does.

**Files:**
- Test: `src/verify/test/browser-safe.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. This task is a guard only.

- [ ] **Step 1: Write the failing test**

Create `src/verify/test/browser-safe.test.ts`:

```typescript
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

const IMPORT_RE = /^\s*import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm;

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
```

- [ ] **Step 2: Run it and confirm it passes today**

Run: `node --import tsx --test src/verify/test/browser-safe.test.ts`
Expected: PASS. The four modules are clean as of this plan — `recompute.ts` has zero imports, `check.ts` imports one type, `abi.ts` has none, `registry.ts` imports only `ethers` and `./abi.js`.

This is a regression guard, so passing immediately is correct. The next step proves it can fail.

- [ ] **Step 3: Prove the guard actually catches the thing it exists for**

Temporarily add this line to the top of `src/chain/registry.ts`:

```typescript
import { RPC_URL } from '../config.js';
```

Run: `node --import tsx --test src/verify/test/browser-safe.test.ts`
Expected: FAIL, naming `src/config.ts imports dotenv/config`.

A guard never seen failing is not known to guard anything.

- [ ] **Step 4: Remove the temporary import and re-run**

Delete the line added in Step 3.

Run: `node --import tsx --test src/verify/test/browser-safe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/verify/test/browser-safe.test.ts
git commit -m "Guard the browser-safe import boundary with a test"
```

---

### Task 2: Compute merkle roots without a filesystem

`merkleRootOf` writes a temp file and uses `ZgFile.fromFilePath`, which needs `node:fs`. The browser has no file path. `MemData` takes a `Uint8Array` and produces the same root — verified 2026-08-23 against epoch 496516's bundle, matching `0x6fa317af…`. Switching removes the temp-file dance and lets the CLI and the page share one path.

**Files:**
- Modify: `src/storage/upload.ts` (the `merkleRootOf` function and its imports)
- Test: `src/storage/test/upload.test.ts` (add cases)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `merkleRootOf(bytes: string | Uint8Array): Promise<string>` — accepts bytes directly, no filesystem. Task 7 calls it from the browser.

- [ ] **Step 1: Write the failing test**

Append to `src/storage/test/upload.test.ts`:

```typescript
describe('merkleRootOf', () => {
  it('derives the root from bytes alone, with no filesystem', async () => {
    // The exact bundle behind epoch 496516, whose root the chain records.
    const bytes = readFileSync('data/epochs/496516-2026-08-23T040342956Z.bundle.json', 'utf8');
    assert.equal(
      await merkleRootOf(bytes),
      '0x6fa317afa4d0fd954a8584fde63e8999da5d519e35dc95d317f89f68ed4d4ca9',
    );
  });

  it('accepts a Uint8Array, which is what a browser fetch produces', async () => {
    const bytes = readFileSync('data/epochs/496516-2026-08-23T040342956Z.bundle.json');
    assert.equal(
      await merkleRootOf(new Uint8Array(bytes)),
      '0x6fa317afa4d0fd954a8584fde63e8999da5d519e35dc95d317f89f68ed4d4ca9',
    );
  });
});
```

Add to the imports at the top of that file:

```typescript
import { readFileSync } from 'node:fs';
```

and add `merkleRootOf` to the existing import from `'../upload.js'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/storage/test/upload.test.ts`
Expected: FAIL. The current `merkleRootOf` takes a `string` it writes to a file, so the `Uint8Array` case fails to typecheck or produces a wrong root.

- [ ] **Step 3: Replace the implementation**

In `src/storage/upload.ts`, change the import line:

```typescript
import { Indexer, MemData, ZgFile } from '@0gfoundation/0g-storage-ts-sdk';
```

Delete the now-unused `mkdtempSync`, `rmSync`, `writeFileSync`, `tmpdir`, `join` imports. Replace the whole `merkleRootOf` function with:

```typescript
/**
 * Merkle root of some bytes, derived locally and without touching a filesystem.
 *
 * The verifier needs this: fetching by root proves only that a gateway answered to that
 * root, and a hostile gateway could answer with anything. Recomputing the root over the
 * bytes actually received is what binds them to the record on chain.
 *
 * `MemData` rather than `ZgFile` because the same check has to run in a browser, where
 * there is no file path. Verified 2026-08-23 to produce an identical root.
 */
export async function merkleRootOf(bytes: string | Uint8Array): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const [tree, err] = await new MemData(data).merkleTree();
  const root = tree?.rootHash();
  if (err || !root) throw new UploadFailed(`merkle tree failed: ${err?.message}`);
  return root;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test src/storage/test/upload.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 5: Confirm the CLI still verifies a real epoch**

Run: `pnpm verify 496516`
Expected: `VERIFIED  all 11 published measurements recomputed exactly.`

- [ ] **Step 6: Commit**

```bash
git add src/storage/upload.ts src/storage/test/upload.test.ts
git commit -m "Hash bundles from memory so the browser can verify too"
```

---

### Task 3: Load providers without hammering a public RPC

`loadProviders()` issues one `get(id)` per provider — 38 sequential round trips — plus a log query. Acceptable in a terminal, wrong on a page: slow, and public RPCs rate-limit. The fix is bounded concurrency plus an in-session cache, shared with the CLI rather than forked.

**Files:**
- Create: `src/chain/concurrency.ts`
- Create: `src/chain/test/concurrency.test.ts`
- Modify: `src/chain/registry.ts` (the `loadProviders` method, and a new `epochTxHash`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>` — results in input order. `ObservatoryReader.loadProviders()` keeps its existing signature `(fromBlock?: number) => Promise<ProviderRecord[]>` and gains an internal cache. `ObservatoryReader.epochTxHash(epoch: number, prober: string): Promise<string | null>` is new; Task 5 consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/chain/test/concurrency.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mapWithConcurrency } from '../concurrency.js';

describe('mapWithConcurrency', () => {
  it('returns results in input order, not completion order', async () => {
    const out = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    assert.deepEqual(out, [30, 10, 20]);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return null;
    });
    assert.equal(peak, 4);
  });

  it('passes the index, so a caller can map back to ids', async () => {
    assert.deepEqual(
      await mapWithConcurrency(['a', 'b'], 2, async (v, i) => `${i}:${v}`),
      ['0:a', '1:b'],
    );
  });

  it('rejects if any task rejects', async () => {
    await assert.rejects(
      mapWithConcurrency([1, 2], 2, async (v) => {
        if (v === 2) throw new Error('boom');
        return v;
      }),
      /boom/,
    );
  });

  it('handles an empty list without hanging', async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/chain/test/concurrency.test.ts`
Expected: FAIL with `Cannot find module '.../src/chain/concurrency.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/chain/concurrency.ts`:

```typescript
/**
 * Run an async function over a list with a ceiling on how many are in flight.
 *
 * The dashboard reads 38 providers from a public RPC. Sequentially that is 38 round trips
 * and a visibly slow page; all at once it is a burst that public endpoints rate-limit.
 * Results come back in input order so a caller can zip them against their ids.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/chain/test/concurrency.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Use it in `loadProviders`, with a cache**

In `src/chain/registry.ts`, add the import:

```typescript
import { mapWithConcurrency } from './concurrency.js';
```

Add a private field to `ObservatoryReader`:

```typescript
  /**
   * Cached provider list, keyed by the registry's own count. `ProviderRegistry` is
   * append-only, so a cache that still matches the current count cannot be stale.
   */
  #providers: { count: number; records: ProviderRecord[] } | null = null;
```

Replace the body of `loadProviders` with:

```typescript
  async loadProviders(fromBlock = 0): Promise<ProviderRecord[]> {
    const count = Number(await this.reg.providerCount());
    if (count === 0) return [];
    if (this.#providers?.count === count) return this.#providers.records;

    const names = new Map<number, string>();
    const logs = await this.reg.queryFilter(
      this.reg.filters.ProviderRegistered(),
      fromBlock,
      'latest',
    );
    for (const log of logs) {
      const a = (log as any).args;
      if (a) names.set(Number(a.id), a.model as string);
    }

    const ids = Array.from({ length: count }, (_, i) => i + 1);
    const records = await mapWithConcurrency(ids, 8, async (id) => {
      const p = await this.reg.get(id);
      return {
        id,
        address: p.addr,
        model: names.get(id) ?? null,
        modelHash: p.modelHash,
        declaredMode: modeName(Number(p.declaredMode)),
        registeredAt: new Date(Number(p.registeredAt) * 1000),
      } satisfies ProviderRecord;
    });

    this.#providers = { count, records };
    return records;
  }
```

- [ ] **Step 6: Recover the transaction that published an epoch**

The spec requires every number to link to its source, and one of those sources is the
transaction that published it. `EpochRecord` carries no transaction hash — the contract
stores none, because nothing on chain needs one — so it comes from the `EpochWritten` log.
It lands here rather than with the view that uses it because `useObservatory` (Task 5)
calls it, and Task 5 runs first.

Add to `ObservatoryReader` in `src/chain/registry.ts`:

```typescript
  /**
   * The transaction that published an epoch.
   *
   * `EpochHeader` stores no transaction hash — nothing on chain needs one — so it comes from
   * the `EpochWritten` log. Needed because every number on the dashboard has to link back to
   * the transaction that published it; a figure with no path to its source is an opinion.
   */
  async epochTxHash(epoch: number, prober: string): Promise<string | null> {
    const logs = await this.mr.queryFilter(this.mr.filters.EpochWritten(epoch, prober), 0, 'latest');
    return logs[0]?.transactionHash ?? null;
  }
```

Verify it against the real chain with a throwaway script that constructs an
`ObservatoryReader` for testnet and calls
`epochTxHash(496516, '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB')`.
Expected exactly: `0xb557c3d84438a9ae60833d9406e38f9ca1d155b013d66f7443415433e00b6439`.
Delete the throwaway script afterwards.

- [ ] **Step 7: Verify against the real chain**

Run: `pnpm verify 496516`
Expected: `VERIFIED  all 11 published measurements recomputed exactly.` — same result as before, noticeably faster.

Run: `pnpm typecheck && pnpm test`
Expected: clean, all pass.

- [ ] **Step 8: Commit**

```bash
git add src/chain/concurrency.ts src/chain/test/concurrency.test.ts src/chain/registry.ts
git commit -m "Read providers in parallel and cache them, and recover an epoch's transaction"
```

---

### Task 4: Scaffold the dashboard from the root package

One `package.json`, so one `pnpm typecheck` covers prober and page together. `dashboard/` holds only source.

**Files:**
- Modify: `package.json` (devDependencies, scripts)
- Modify: `tsconfig.json` (include `dashboard/`, add DOM lib and JSX)
- Create: `vite.config.ts`
- Create: `dashboard/index.html`
- Create: `dashboard/main.tsx`
- Create: `dashboard/App.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `pnpm dashboard:dev` and `pnpm dashboard:build`. `dashboard/App.tsx` exports `default function App(): JSX.Element`, which Task 5 replaces the body of.

- [ ] **Step 1: Install the toolchain**

```bash
pnpm add -D vite @vitejs/plugin-react react react-dom @types/react @types/react-dom
```

React and react-dom are dev dependencies because nothing in `src/` imports them; they are bundled into static output, not consumed as a library.

- [ ] **Step 2: Add the build config**

Create `vite.config.ts` at the repository root:

```typescript
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dashboard is a static page with no backend. It reads 0G Chain and 0G Storage
 * directly from the browser, so there is nothing to proxy and no server to configure.
 */
export default defineConfig({
  root: 'dashboard',
  build: { outDir: '../dashboard-dist', emptyOutDir: true },
});
```

Add `dashboard-dist/` to `.gitignore`.

- [ ] **Step 3: Teach TypeScript about the DOM and JSX**

In `tsconfig.json`, change `include` and add two compiler options:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "dashboard/**/*.ts", "dashboard/**/*.tsx", "vite.config.ts"]
}
```

- [ ] **Step 4: Add the entry point**

Create `dashboard/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>0G Provider Observatory</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Create `dashboard/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `dashboard/App.tsx`:

```tsx
export default function App() {
  return (
    <main>
      <h1>0G Provider Observatory</h1>
      <p>An independent measurement layer for 0G&rsquo;s inference network.</p>
    </main>
  );
}
```

- [ ] **Step 5: Add the scripts**

In `package.json`, add to `scripts`, after `"verify"`:

```json
    "dashboard:dev": "vite",
    "dashboard:build": "vite build",
    "dashboard:preview": "vite preview --outDir ../dashboard-dist",
```

Also widen the `test` script, or every dashboard test written from Task 5 onward would sit
in a directory the suite never looks at:

```json
    "test": "node --import tsx --test \"src/**/test/*.test.ts\" \"dashboard/test/*.test.ts\"",
```

Until `dashboard/test/` exists the second pattern matches nothing, which node tolerates.

- [ ] **Step 6: Verify the build and the typecheck**

Run: `pnpm dashboard:build`
Expected: succeeds, writes `dashboard-dist/index.html` and an asset bundle.

Run: `pnpm typecheck`
Expected: clean — and it now covers `dashboard/`.

Run: `pnpm test`
Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts dashboard/ .gitignore
git commit -m "Scaffold the dashboard inside the root package"
```

---

### Task 5: Network configuration and live chain reads

**Files:**
- Create: `dashboard/networks.ts`
- Create: `dashboard/test/networks.test.ts`
- Create: `dashboard/useObservatory.ts`

**Interfaces:**
- Consumes: `ObservatoryReader` from `src/chain/registry.ts`; `mapWithConcurrency` indirectly via Task 3.
- Produces:
  - `NETWORKS: Record<'testnet' | 'mainnet', NetworkConfig>` where `NetworkConfig = { name: string; chainId: number; rpcUrl: string; indexerUrl: string; explorer: string; providerRegistry: string; measurementRegistry: string; prober: string }`
  - `explorerTx(net: NetworkConfig, hash: string): string`
  - `bundleUrl(net: NetworkConfig, root: string): string`
  - `useObservatory(net: NetworkConfig)` returning `{ state: 'loading' | 'error' | 'ready' | 'not-deployed'; error?: string; epochs: number[]; providers: ProviderRecord[]; latest?: EpochRecord; latestTxHash?: string | null }`

**Note:** `epochTxHash` comes from Task 3.

- [ ] **Step 1: Write the failing test**

Create `dashboard/test/networks.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bundleUrl, explorerTx, NETWORKS } from '../networks.js';

describe('NETWORKS', () => {
  it('names both chains by their real ids', () => {
    assert.equal(NETWORKS.testnet.chainId, 16602);
    assert.equal(NETWORKS.mainnet.chainId, 16661);
  });

  it('carries the deployed testnet contracts', () => {
    assert.equal(
      NETWORKS.testnet.measurementRegistry,
      '0x9bdeC5D5749270cf20DDa5d541770839E083CAc6',
    );
  });

  it('uses a different storage indexer per network, since they are not interchangeable', () => {
    assert.notEqual(NETWORKS.testnet.indexerUrl, NETWORKS.mainnet.indexerUrl);
  });
});

describe('source links', () => {
  it('links a measurement to the transaction that published it', () => {
    assert.equal(
      explorerTx(NETWORKS.testnet, '0xabc'),
      'https://chainscan-galileo.0g.ai/tx/0xabc',
    );
  });

  it('links a record to the evidence it rests on', () => {
    assert.equal(
      bundleUrl(NETWORKS.testnet, '0xdef'),
      'https://indexer-storage-testnet-turbo.0g.ai/file?root=0xdef',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test dashboard/test/networks.test.ts`
Expected: FAIL with `Cannot find module '.../dashboard/networks.js'`.

- [ ] **Step 3: Write the configuration**

Create `dashboard/networks.ts`:

```typescript
/**
 * Where the dashboard reads from. Contract addresses are public constants and are bundled
 * at build time; the RPC and indexer are chosen at view time by the network toggle.
 *
 * Mainnet's registry addresses are filled in by T12. Until then the mainnet entry exists so
 * that pointing the page at it is a deployment detail rather than a code change, and the UI
 * shows it as not yet deployed.
 */
export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  indexerUrl: string;
  explorer: string;
  providerRegistry: string;
  measurementRegistry: string;
  prober: string;
}

export type NetworkKey = 'testnet' | 'mainnet';

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    name: '0G Galileo testnet',
    chainId: 16602,
    rpcUrl: 'https://evmrpc-testnet.0g.ai',
    indexerUrl: 'https://indexer-storage-testnet-turbo.0g.ai',
    explorer: 'https://chainscan-galileo.0g.ai',
    providerRegistry: '0xCF9236a145FaE855B6894Eb7951cA9619D6613a8',
    measurementRegistry: '0x9bdeC5D5749270cf20DDa5d541770839E083CAc6',
    prober: '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB',
  },
  mainnet: {
    name: '0G Aristotle mainnet',
    chainId: 16661,
    rpcUrl: 'https://evmrpc.0g.ai',
    indexerUrl: 'https://indexer-storage-turbo.0g.ai',
    explorer: 'https://chainscan.0g.ai',
    providerRegistry: '',
    measurementRegistry: '',
    prober: '',
  },
};

export const isDeployed = (net: NetworkConfig): boolean => net.measurementRegistry !== '';

export const explorerTx = (net: NetworkConfig, hash: string): string =>
  `${net.explorer}/tx/${hash}`;

export const explorerAddress = (net: NetworkConfig, address: string): string =>
  `${net.explorer}/address/${address}`;

export const bundleUrl = (net: NetworkConfig, root: string): string =>
  `${net.indexerUrl.replace(/\/+$/, '')}/file?root=${root}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test dashboard/test/networks.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the data hook**

Create `dashboard/useObservatory.ts`:

```typescript
import { useEffect, useState } from 'react';
import { ObservatoryReader, type EpochRecord, type ProviderRecord } from '../src/chain/registry.js';
import { isDeployed, type NetworkConfig } from './networks.js';

export interface ObservatoryData {
  state: 'loading' | 'error' | 'ready' | 'not-deployed';
  error?: string;
  epochs: number[];
  providers: ProviderRecord[];
  latest?: EpochRecord;
  /** The transaction that published `latest`, so the view can link every number to a source. */
  latestTxHash?: string | null;
}

const EMPTY: ObservatoryData = { state: 'loading', epochs: [], providers: [] };

/**
 * Read the ledger for one network. Every failure is surfaced as an error state rather than
 * an empty table: an RPC that is down must never render as a provider with no data.
 */
export function useObservatory(net: NetworkConfig): ObservatoryData {
  const [data, setData] = useState<ObservatoryData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    setData(EMPTY);

    if (!isDeployed(net)) {
      setData({ state: 'not-deployed', epochs: [], providers: [] });
      return;
    }

    (async () => {
      try {
        const reader = new ObservatoryReader(net.rpcUrl, {
          providerRegistry: net.providerRegistry,
          measurementRegistry: net.measurementRegistry,
        });
        const [epochs, providers] = await Promise.all([
          reader.epochsOf(net.prober),
          reader.loadProviders(),
        ]);
        const newest = epochs.at(-1);
        const [latest, latestTxHash] =
          newest === undefined
            ? [undefined, null]
            : await Promise.all([
                reader.readEpoch(newest, net.prober),
                reader.epochTxHash(newest, net.prober),
              ]);
        if (cancelled) return;
        setData({ state: 'ready', epochs, providers, latest: latest ?? undefined, latestTxHash });
      } catch (e: any) {
        if (cancelled) return;
        setData({ state: 'error', error: String(e?.message ?? e), epochs: [], providers: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [net]);

  return data;
}
```

- [ ] **Step 6: Verify it typechecks and the boundary still holds**

Run: `pnpm typecheck`
Expected: clean.

Run: `pnpm test`
Expected: all pass, including the browser-safe guard from Task 1.

- [ ] **Step 7: Commit**

```bash
git add dashboard/networks.ts dashboard/useObservatory.ts dashboard/test/networks.test.ts
git commit -m "Read either network live, and say when one is not deployed yet"
```

---

### Task 6: The Providers view

One row per `(address, model)` pair, grouped under its operator for navigation only. Pooling by address is the defect this project points at, so no number crosses a model boundary.

**Files:**
- Create: `dashboard/rows.ts`
- Create: `dashboard/test/rows.test.ts`
- Create: `dashboard/Providers.tsx`
- Modify: `dashboard/App.tsx`

**Interfaces:**
- Consumes: `NetworkConfig`, `explorerAddress` from Task 5; `ProviderRecord`, `EpochRecord` from `src/chain/registry.ts`.
- Produces:
  - `type ProviderRow = { providerId: number; address: string; model: string; mode: string; p50Ms: number; p95Ms: number; errorRateBps: number; divergenceBps: number; calls: number }`
  - `type OperatorGroup = { address: string; rows: ProviderRow[]; unmeasured: string[] }`
  - `groupByOperator(epoch: EpochRecord, providers: readonly ProviderRecord[]): OperatorGroup[]`
  - `formatBps(bps: number): string`, `formatMs(ms: number): string`

- [ ] **Step 1: Write the failing test**

Create `dashboard/test/rows.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { formatBps, formatMs, groupByOperator } from '../rows.js';

const provider = (id: number, address: string, model: string): ProviderRecord => ({
  id,
  address,
  model,
  modelHash: '0x0',
  declaredMode: 'TeeTLS',
  registeredAt: new Date(0),
});

const measurement = (providerId: number, p50Ms: number) => ({
  providerId,
  p50Ms,
  p95Ms: p50Ms * 2,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeTLS' as const,
});

const epoch = (measurements: ReturnType<typeof measurement>[]): EpochRecord => ({
  epoch: 1,
  prober: '0xP',
  writtenAt: new Date(0),
  storageRoot: '0xroot',
  measurements,
});

describe('groupByOperator', () => {
  const providers = [
    provider(1, '0xAAA', 'model-one'),
    provider(2, '0xAAA', 'model-two'),
    provider(3, '0xBBB', 'model-one'),
  ];

  it('keeps one row per model, never merging an operator into a single figure', () => {
    const groups = groupByOperator(epoch([measurement(1, 100), measurement(2, 900)]), providers);
    const aaa = groups.find((g) => g.address === '0xAAA')!;
    assert.equal(aaa.rows.length, 2);
    assert.deepEqual(aaa.rows.map((r) => r.p50Ms).sort((a, b) => a - b), [100, 900]);
  });

  it('groups by operator so one operator reads as one block', () => {
    const groups = groupByOperator(
      epoch([measurement(1, 100), measurement(2, 200), measurement(3, 300)]),
      providers,
    );
    assert.deepEqual(groups.map((g) => g.address).sort(), ['0xAAA', '0xBBB']);
  });

  it('names a registered service that this epoch did not measure, rather than hiding it', () => {
    const groups = groupByOperator(epoch([measurement(1, 100)]), providers);
    const aaa = groups.find((g) => g.address === '0xAAA')!;
    assert.deepEqual(aaa.unmeasured, ['model-two']);
  });

  it('ignores a measurement whose provider id is not registered', () => {
    const groups = groupByOperator(epoch([measurement(99, 100)]), providers);
    assert.deepEqual(groups.flatMap((g) => g.rows), []);
  });
});

describe('formatting', () => {
  it('renders basis points as a percentage a reader can scan', () => {
    assert.equal(formatBps(0), '0%');
    assert.equal(formatBps(833), '8.33%');
    assert.equal(formatBps(10000), '100%');
  });

  it('renders milliseconds without inventing precision', () => {
    assert.equal(formatMs(0), '—');
    assert.equal(formatMs(847), '847 ms');
    assert.equal(formatMs(12480), '12.5 s');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test dashboard/test/rows.test.ts`
Expected: FAIL with `Cannot find module '.../dashboard/rows.js'`.

- [ ] **Step 3: Write the implementation**

Create `dashboard/rows.ts`:

```typescript
import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';

export interface ProviderRow {
  providerId: number;
  address: string;
  model: string;
  mode: string;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
  calls: number;
}

export interface OperatorGroup {
  address: string;
  rows: ProviderRow[];
  /** Registered under this operator but absent from this epoch — shown as a gap, not dropped. */
  unmeasured: string[];
}

/**
 * Turn one epoch into rows, grouped by operator.
 *
 * The grouping is for navigation only. Every number belongs to an (address, model) pair and
 * none is averaged across the models an operator serves — pooling by address is the exact
 * defect this project exists to point at, and doing it here would reproduce it.
 */
export function groupByOperator(
  epoch: EpochRecord,
  providers: readonly ProviderRecord[],
): OperatorGroup[] {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const groups = new Map<string, OperatorGroup>();

  const group = (address: string): OperatorGroup => {
    let g = groups.get(address);
    if (!g) groups.set(address, (g = { address, rows: [], unmeasured: [] }));
    return g;
  };

  const measured = new Set<number>();
  for (const m of epoch.measurements) {
    const p = byId.get(m.providerId);
    if (!p || p.model === null) continue;
    measured.add(p.id);
    group(p.address).rows.push({
      providerId: p.id,
      address: p.address,
      model: p.model,
      mode: m.observedMode,
      p50Ms: m.p50Ms,
      p95Ms: m.p95Ms,
      errorRateBps: m.errorRateBps,
      divergenceBps: m.divergenceBps,
      calls: m.calls,
    });
  }

  for (const p of providers) {
    if (measured.has(p.id) || p.model === null) continue;
    if (!groups.has(p.address)) continue; // operator absent from this epoch entirely
    group(p.address).unmeasured.push(p.model);
  }

  for (const g of groups.values()) {
    g.rows.sort((a, b) => a.model.localeCompare(b.model));
    g.unmeasured.sort();
  }
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}

/** Basis points as a percentage. 833 -> "8.33%", with no trailing zeros invented. */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

/** Milliseconds, switching to seconds where ms would be noise. 0 means "not published". */
export function formatMs(ms: number): string {
  if (ms === 0) return '—';
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test dashboard/test/rows.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the view**

Create `dashboard/Providers.tsx`:

```tsx
import { bundleUrl, explorerAddress, explorerTx, type NetworkConfig } from './networks.js';
import { formatBps, formatMs, groupByOperator, type OperatorGroup } from './rows.js';
import { ModeBadge } from './ModeBadge.js';
import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';

export function Providers(props: {
  net: NetworkConfig;
  epoch: EpochRecord;
  providers: readonly ProviderRecord[];
  /** The transaction that published this epoch, so every row traces to a source. */
  txHash: string | null;
}) {
  const groups = groupByOperator(props.epoch, props.providers);

  return (
    <section>
      <h2>Providers</h2>
      <p>
        One row per provider and model. Numbers are never averaged across the models an
        operator serves — grouping here is for reading, not for arithmetic.
      </p>
      <p>
        Every figure below was published in{' '}
        {props.txHash ? (
          <a href={explorerTx(props.net, props.txHash)} target="_blank" rel="noreferrer">
            one transaction
          </a>
        ) : (
          'one transaction'
        )}{' '}
        and derived from{' '}
        <a href={bundleUrl(props.net, props.epoch.storageRoot)} target="_blank" rel="noreferrer">
          this evidence bundle
        </a>
        .
      </p>
      {groups.map((g) => (
        <OperatorBlock key={g.address} group={g} net={props.net} />
      ))}
    </section>
  );
}

function OperatorBlock({ group, net }: { group: OperatorGroup; net: NetworkConfig }) {
  return (
    <article>
      <h3>
        <a href={explorerAddress(net, group.address)} target="_blank" rel="noreferrer">
          {group.address}
        </a>{' '}
        <span>{group.rows.length} measured</span>
      </h3>
      <table>
        <thead>
          <tr>
            <th>model</th><th>mode</th><th>p50</th><th>p95</th>
            <th>errors</th><th>divergence</th><th>calls</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => (
            <tr key={r.providerId}>
              <td>{r.model}</td>
              <td><ModeBadge mode={r.mode} /></td>
              <td>{formatMs(r.p50Ms)}</td>
              <td>{formatMs(r.p95Ms)}</td>
              <td>{formatBps(r.errorRateBps)}</td>
              <td>{formatBps(r.divergenceBps)}</td>
              <td>{r.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {group.unmeasured.length > 0 && (
        <p>
          Registered but not measured this epoch: {group.unmeasured.join(', ')}. A service
          with too few successful calls is left out rather than published with a number the
          samples do not support.
        </p>
      )}
    </article>
  );
}
```

`ModeBadge` is created in Task 8. To keep this task independently runnable, create a minimal placeholder now in `dashboard/ModeBadge.tsx`:

```tsx
export function ModeBadge({ mode }: { mode: string }) {
  return <span>{mode}</span>;
}
```

- [ ] **Step 6: Wire it into the app**

Replace `dashboard/App.tsx`:

```tsx
import { useState } from 'react';
import { NETWORKS, type NetworkKey } from './networks.js';
import { Providers } from './Providers.js';
import { useObservatory } from './useObservatory.js';

export default function App() {
  const [key, setKey] = useState<NetworkKey>('testnet');
  const net = NETWORKS[key];
  const data = useObservatory(net);

  return (
    <main>
      <header>
        <h1>0G Provider Observatory</h1>
        <p>An independent measurement layer for 0G&rsquo;s inference network.</p>
        <nav>
          {(['testnet', 'mainnet'] as NetworkKey[]).map((k) => (
            <button key={k} onClick={() => setKey(k)} aria-pressed={k === key}>
              {NETWORKS[k].name}
            </button>
          ))}
        </nav>
      </header>

      {data.state === 'loading' && <p>Reading the ledger from {net.rpcUrl}…</p>}
      {data.state === 'not-deployed' && (
        <p>
          The Observatory contracts are not deployed on {net.name} yet. Nothing has been
          measured there, which is different from having measured nothing.
        </p>
      )}
      {data.state === 'error' && (
        <p>Could not read {net.name}: {data.error}. This is a read failure, not a measurement.</p>
      )}
      {data.state === 'ready' && data.latest && (
        <Providers
          net={net}
          epoch={data.latest}
          providers={data.providers}
          txHash={data.latestTxHash ?? null}
        />
      )}
      {data.state === 'ready' && !data.latest && (
        <p>No epochs have been written on {net.name} yet.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Verify against the live chain**

Run: `pnpm dashboard:dev`
Open the printed URL. Expected: the testnet tab lists operators from epoch 496516 with real p50/p95 values, and switching to mainnet shows the not-deployed message.

Run: `pnpm typecheck && pnpm test && pnpm dashboard:build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add dashboard/
git commit -m "Providers view: one row per model, never pooled by address"
```

---

### Task 7: The Verify view

Run F7 in the page. This is the half that distinguishes the project from a leaderboard.

**Files:**
- Create: `dashboard/verifyEpoch.ts`
- Create: `dashboard/test/verifyEpoch.test.ts`
- Create: `dashboard/Verify.tsx`
- Modify: `dashboard/App.tsx`
- Modify: `src/verify/test/browser-safe.test.ts` (extend the entrypoint list)

**Extend the guard first.** This task makes browser code import `src/storage/upload.ts`, so
that module joins the set the boundary test protects. Add `'src/storage/upload.ts'` to
`BROWSER_ENTRYPOINTS` in `src/verify/test/browser-safe.test.ts` and run
`node --import tsx --test src/verify/test/browser-safe.test.ts` before writing anything
else. It passes only because Task 2 removed that file's filesystem use; if it fails, stop
and report rather than weakening the guard.

**Interfaces:**
- Consumes: `merkleRootOf` from Task 2; `recompute` and `VerifiableBundle` from `src/verify/recompute.ts`; `compareToChain`, `ProviderLookup`, `Finding` from `src/verify/check.ts`; `bundleUrl` from Task 5.
- Produces:
  - `type VerifyStep = { label: string; status: 'pending' | 'ok' | 'fail'; detail?: string }`
  - `type VerifyOutcome = { steps: VerifyStep[]; findings: Finding[]; checked: number; verdict: 'verified' | 'failed' }`
  - `verifyEpochInBrowser(args: { epoch: EpochRecord; providers: readonly ProviderRecord[]; indexerUrl: string; fetchBytes: (url: string) => Promise<string>; }): Promise<VerifyOutcome>`

- [ ] **Step 1: Write the failing test**

Create `dashboard/test/verifyEpoch.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../src/chain/registry.js';
import { verifyEpochInBrowser } from '../verifyEpoch.js';

const BUNDLE = readFileSync('data/epochs/496516-2026-08-23T040342956Z.bundle.json', 'utf8');
const ROOT = '0x6fa317afa4d0fd954a8584fde63e8999da5d519e35dc95d317f89f68ed4d4ca9';

/** The registry ids the bundle's services hold, recovered from the bundle itself. */
function providersFromBundle(): ProviderRecord[] {
  const b = JSON.parse(BUNDLE) as { roster: Array<{ address: string; modelId: string }> };
  return b.roster.map((s, i) => ({
    id: i + 1,
    address: s.address,
    model: s.modelId,
    modelHash: '0x0',
    declaredMode: 'TeeTLS' as const,
    registeredAt: new Date(0),
  }));
}

const epochRecord = (over: Partial<EpochRecord> = {}): EpochRecord => ({
  epoch: 496516,
  prober: '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB',
  writtenAt: new Date(0),
  storageRoot: ROOT,
  measurements: [],
  ...over,
});

describe('verifyEpochInBrowser', () => {
  it('fails when the record points at evidence the gateway does not have', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord({ storageRoot: '0xdead' }),
      providers: [],
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => '{"code":101,"message":"File not found","data":null}',
    });
    assert.equal(out.verdict, 'failed');
    assert.equal(out.steps.find((s) => s.status === 'fail')?.label.includes('evidence'), true);
  });

  it('fails when the bytes returned do not hash to the committed root', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: [],
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => `${BUNDLE} tampered`,
    });
    assert.equal(out.verdict, 'failed');
    assert.ok(out.steps.some((s) => s.status === 'fail' && /merkle/i.test(s.label)));
  });

  it('recomputes a real epoch and reaches a verdict without a wallet', async () => {
    const out = await verifyEpochInBrowser({
      epoch: epochRecord(),
      providers: providersFromBundle(),
      indexerUrl: 'https://indexer.example',
      fetchBytes: async () => BUNDLE,
    });
    assert.ok(out.steps.filter((s) => s.status === 'ok').length >= 3, 'early steps should pass');
    // No measurements were supplied, so nothing is checked and nothing can mismatch.
    assert.equal(out.findings.filter((f) => f.severity === 'mismatch').length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test dashboard/test/verifyEpoch.test.ts`
Expected: FAIL with `Cannot find module '.../dashboard/verifyEpoch.js'`.

- [ ] **Step 3: Write the implementation**

Create `dashboard/verifyEpoch.ts`:

```typescript
import type { EpochRecord, ProviderRecord } from '../src/chain/registry.js';
import { merkleRootOf } from '../src/storage/upload.js';
import { compareToChain, type Finding, type ProviderLookup } from '../src/verify/check.js';
import { recompute, type VerifiableBundle } from '../src/verify/recompute.js';

export interface VerifyStep {
  label: string;
  status: 'pending' | 'ok' | 'fail';
  detail?: string;
}

export interface VerifyOutcome {
  steps: VerifyStep[];
  findings: Finding[];
  checked: number;
  verdict: 'verified' | 'failed';
}

/**
 * The same check `pnpm verify` performs, run in the page.
 *
 * `fetchBytes` is injected so the sequence can be tested without a network, and so the
 * caller decides how the gateway is reached. Fetching by root proves only that a gateway
 * answered to that root, so the merkle root is recomputed over the bytes received: that is
 * what binds the evidence to the record.
 */
export async function verifyEpochInBrowser(args: {
  epoch: EpochRecord;
  providers: readonly ProviderRecord[];
  indexerUrl: string;
  fetchBytes: (url: string) => Promise<string>;
}): Promise<VerifyOutcome> {
  const steps: VerifyStep[] = [];
  const fail = (label: string, detail: string): VerifyOutcome => {
    steps.push({ label, status: 'fail', detail });
    return { steps, findings: [], checked: 0, verdict: 'failed' };
  };

  let bytes: string;
  try {
    bytes = await args.fetchBytes(
      `${args.indexerUrl.replace(/\/+$/, '')}/file?root=${args.epoch.storageRoot}`,
    );
    // The indexer answers a missing file with HTTP 200 and an error envelope.
    const maybe = bytes.startsWith('{') ? safeParse(bytes) : null;
    if (maybe && typeof maybe.code === 'number' && maybe.code !== 0) {
      return fail('the evidence is fetchable', String(maybe.message ?? 'not found'));
    }
  } catch (e: any) {
    return fail('the evidence is fetchable', String(e?.message ?? e));
  }
  steps.push({
    label: 'the evidence is fetchable',
    status: 'ok',
    detail: `${(bytes.length / 1024).toFixed(0)} KB through the public gateway, no wallet`,
  });

  const root = await merkleRootOf(bytes);
  if (root.toLowerCase() !== args.epoch.storageRoot.toLowerCase()) {
    return fail('the merkle root of the bytes matches the record', root);
  }
  steps.push({ label: 'the merkle root of the bytes matches the record', status: 'ok', detail: root });

  const bundle = safeParse(bytes) as VerifiableBundle | null;
  if (!bundle) return fail('the evidence is readable', 'not valid JSON');
  steps.push({
    label: 'the evidence is readable',
    status: 'ok',
    detail: `${bundle.schema}, ${bundle.results.length} calls`,
  });

  steps.push({
    label: 'the evidence claims this epoch and prober',
    status:
      bundle.epoch === args.epoch.epoch &&
      bundle.prober.toLowerCase() === args.epoch.prober.toLowerCase()
        ? 'ok'
        : 'fail',
    detail: `bundle says epoch ${bundle.epoch}`,
  });

  const lookup: ProviderLookup = Object.fromEntries(
    args.providers.map((p) => [p.id, { address: p.address, model: p.model }]),
  );
  const { findings, checked } = compareToChain(args.epoch.measurements, recompute(bundle), lookup);
  const blocking = findings.filter((f) => f.severity !== 'unpublished');
  const anyStepFailed = steps.some((s) => s.status === 'fail');

  return {
    steps,
    findings,
    checked,
    verdict: blocking.length === 0 && !anyStepFailed ? 'verified' : 'failed',
  };
}

function safeParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test dashboard/test/verifyEpoch.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the view**

Create `dashboard/Verify.tsx`:

```tsx
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
```

- [ ] **Step 6: Add the tab to the app**

In `dashboard/App.tsx`, add `import { Verify } from './Verify.js';` and a panel state:

```tsx
  const [panel, setPanel] = useState<'providers' | 'verify'>('providers');
```

Add the tab control inside `<header>`, after the network `<nav>`:

```tsx
        <nav>
          <button onClick={() => setPanel('providers')} aria-pressed={panel === 'providers'}>
            Providers
          </button>
          <button onClick={() => setPanel('verify')} aria-pressed={panel === 'verify'}>
            Verify
          </button>
        </nav>
```

Replace the `data.state === 'ready' && data.latest` block with:

```tsx
      {data.state === 'ready' && panel === 'providers' && data.latest && (
        <Providers net={net} epoch={data.latest} providers={data.providers} />
      )}
      {data.state === 'ready' && panel === 'verify' && (
        <Verify net={net} epochs={data.epochs} providers={data.providers} />
      )}
```

- [ ] **Step 7: Verify against the live chain**

Run: `pnpm dashboard:dev`

In the Verify tab, click each epoch. Expected, and these are the real outcomes:
- **496516** — every step ok, "Verified. All 11 published measurements recomputed exactly."
- **496515** — fails at "the evidence is fetchable" with `File not found`; it predates T11 and its root is a keccak hash.
- **496497** — fails the same way; it holds stand-in values from a ledger test.

Run: `pnpm typecheck && pnpm test && pnpm dashboard:build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add dashboard/
git commit -m "Verify view: run F7 in the browser, against the live chain"
```

---

### Task 8: Mode explanations, and what we do not know

The honesty mechanics from section 08 of the design doc are requirements, not decoration. This task makes them visible.

**Files:**
- Modify: `dashboard/ModeBadge.tsx`
- Create: `dashboard/test/modes.test.ts`
- Create: `dashboard/modes.ts`
- Create: `dashboard/Caveats.tsx`
- Modify: `dashboard/App.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond `ModeBadge`'s placeholder.
- Produces: `MODE_NOTES: Record<string, { label: string; means: string }>`, `modeNote(mode: string): { label: string; means: string }`.

- [ ] **Step 1: Write the failing test**

Create `dashboard/test/modes.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { modeNote } from '../modes.js';

describe('modeNote', () => {
  it('explains what each mode does and does not guarantee', () => {
    assert.match(modeNote('TeeML').means, /enclave/i);
    assert.match(modeNote('TeeTLS').means, /transport|channel/i);
  });

  it('gives standard a technical reason rather than a verdict', () => {
    const note = modeNote('standard');
    assert.match(note.means, /closed|third-party|cannot/i);
    assert.doesNotMatch(note.means, /worse|untrustworthy|bad|unsafe/i);
  });

  it('does not invent an explanation for a mode it has never seen', () => {
    assert.equal(modeNote('Unknown').label, 'Unknown');
    assert.match(modeNote('Unknown').means, /not recorded|do not know/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test dashboard/test/modes.test.ts`
Expected: FAIL with `Cannot find module '.../dashboard/modes.js'`.

- [ ] **Step 3: Write the implementation**

Create `dashboard/modes.ts`:

```typescript
/**
 * What each guarantee mode means, in the words a reader needs before comparing anything.
 *
 * `standard` carries a technical reason and is never scored down. Nobody can place a closed
 * third-party API inside their own TDX enclave, so running in `standard` mode is a property
 * of what is being served, not a failing of who serves it. Section 08 of the design doc:
 * explain before ranking.
 */
export const MODE_NOTES: Record<string, { label: string; means: string }> = {
  TeeML: {
    label: 'TeeML',
    means:
      'The model itself ran inside a hardware enclave, and the result carries an attestation ' +
      'a third party can check. This is the strongest claim on the network.',
  },
  TeeTLS: {
    label: 'TeeTLS',
    means:
      'The transport into the provider is protected by an enclave-terminated channel. What ' +
      'happened to the request after that is not attested.',
  },
  standard: {
    label: 'standard',
    means:
      'No enclave attestation, because the model is a closed third-party API the operator ' +
      'cannot place inside their own enclave. This is a property of the model being served, ' +
      'not a shortcoming of the operator.',
  },
};

export function modeNote(mode: string): { label: string; means: string } {
  return (
    MODE_NOTES[mode] ?? {
      label: mode,
      means: 'This mode was not recorded on chain, so we do not know what it guarantees.',
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test dashboard/test/modes.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Make the badge carry the explanation**

Replace `dashboard/ModeBadge.tsx`:

```tsx
import { modeNote } from './modes.js';

export function ModeBadge({ mode }: { mode: string }) {
  const note = modeNote(mode);
  return (
    <span title={note.means} data-mode={mode}>
      {note.label}
    </span>
  );
}
```

- [ ] **Step 6: Write the caveats panel**

Create `dashboard/Caveats.tsx`:

```tsx
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
```

- [ ] **Step 7: Show it on the page**

In `dashboard/App.tsx`, add `import { Caveats } from './Caveats.js';` and render it after the panels, inside `<main>`:

```tsx
      <Caveats />
```

- [ ] **Step 8: Verify**

Run: `pnpm dashboard:dev` — confirm mode badges show their explanation on hover and the caveats section renders.

Run: `pnpm typecheck && pnpm test && pnpm dashboard:build`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add dashboard/
git commit -m "Explain the modes, and say plainly what we do not know"
```

---

### Task 9: Deploy

**Files:**
- Create: `vercel.json`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: `pnpm dashboard:build` from Task 4.
- Produces: a public URL.

- [ ] **Step 1: Add the deployment config**

Create `vercel.json`:

```json
{
  "buildCommand": "pnpm dashboard:build",
  "outputDirectory": "dashboard-dist",
  "framework": null
}
```

- [ ] **Step 2: Confirm the build output is genuinely static**

Run: `pnpm dashboard:build && ls dashboard-dist`
Expected: `index.html` plus an `assets/` directory. No server entry point — there is nothing to run.

- [ ] **Step 3: Deploy**

Run: `npx vercel deploy --prod`

Follow the prompts to link the project. This is an outward-facing action: confirm with Huy before promoting to production.

- [ ] **Step 4: Verify the deployed page reads the live chain**

Open the deployed URL. Expected: the Providers table populates from testnet, and the Verify tab reproduces epoch 496516. If the page renders but tables stay empty, check the browser console for a CORS or RPC error rather than assuming there is no data.

- [ ] **Step 5: Record it**

In `docs/HANDOFF.md`, move T9 into the *Done* table with the deployed URL, and add the URL to the submission notes for T13.

- [ ] **Step 6: Commit**

```bash
git add vercel.json docs/HANDOFF.md
git commit -m "Deploy the dashboard"
```

---

## Notes for whoever executes this

- **Run `pnpm test` after every task.** The browser-safe guard from Task 1 is the one most likely to catch a mistake, and it only helps if it runs.
- **The dashboard is not on the critical path.** B2 → T12 → T13 is. If the calendar tightens, Tasks 1–3 and 7 are the half worth keeping: they are what makes the project something other than a leaderboard. Tasks 6 and 8 make it readable, and Task 9 makes it visible.
- **Styling is deliberately absent from this plan.** Every component here is unstyled markup. Adding a stylesheet is a separate pass and should not block the data being correct.
