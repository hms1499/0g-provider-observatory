# Measuring From The Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader measure a consistency group from the dashboard, with their own Router key, and compare the result against a published epoch — without a clone, a package manager, or a CLI flag.

**Architecture:** A Vercel Function at `/api/router` forwards exactly one chat completion. It holds no secret and runs no measurement logic, so it cannot produce a wrong number; it exists only to get past the Router's origin allowlist and to attach the price-ceiling headers a browser is forbidden to send. The browser replays the probes recorded in a published epoch's evidence bundle, aggregates, computes divergence, and compares — all with code the dashboard already ships.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Node 22, Vercel Functions (Node runtime), React 19 + Vite 8, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-25-browser-measure-proxy-design.md`

## Global Constraints

- **Everything in this repository is written in English** — code, comments, console output, docs, commit messages.
- **`/api/router` must never hold a secret.** No `PRIVATE_KEY`, no server-side `ROUTER_API_KEY`, no RPC access, no chain writes. A missing `Authorization` header is rejected; there is never a fallback key.
- **The upstream host and path are hardcoded** as `https://router-api.0g.ai/v1/chat/completions`. Never taken from the request body or a header.
- **Never log request headers or bodies**, and scrub error messages before returning them.
- **Price-ceiling multiplier is 3**, matching `src/scripts/run-epoch.ts:114`.
- Positioning: this is an instrument, not an indictment. Report divergence, never attribute motive. `standard` mode is never scored down.
- Verification commands: `pnpm typecheck`, `pnpm test`, `pnpm dashboard:build`.

---

### Task 1: Let `router-client.ts` be told its endpoint

`src/probes/router-client.ts:16` imports `ROUTER_API` from `src/config.ts`, which calls `dotenv/config` and reads `process.env`. That single import is the only thing keeping the probe layer out of a browser. The endpoint becomes a parameter: the CLI passes `ROUTER_API`, the browser passes `/api/router`.

**Files:**
- Modify: `src/probes/router-client.ts` (remove the `config.js` import; add `baseUrl` to `PinnedRequestInput`; use it in `buildPinnedRequest`)
- Modify: `src/scripts/run-epoch.ts`, `src/scripts/dry-run.ts`, `src/scripts/token-profile.ts`, `src/scripts/smoke-call.ts` (pass `baseUrl: ROUTER_API` wherever `buildPinnedRequest`/`callPinned` is called)
- Modify: `src/verify/test/browser-safe.test.ts:20-28` (add the probe modules to `BROWSER_ENTRYPOINTS`)
- Test: `src/probes/test/router-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PinnedRequestInput` gains a required `baseUrl: string`. `buildPinnedRequest(input: PinnedRequestInput): PinnedRequest` now returns `url` = `${input.baseUrl}/chat/completions`. `CallOptions extends PinnedRequestInput` so `callPinned` takes it too.

- [ ] **Step 1: Write the failing test**

Append to `src/probes/test/router-client.test.ts`:

```typescript
describe('buildPinnedRequest · endpoint', () => {
  it('builds its URL from the caller-supplied base, not from the environment', () => {
    const req = buildPinnedRequest({
      baseUrl: '/api/router',
      providerAddress: '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D',
      model: 'glm-5.2',
      probe: PROBES[0],
      params: { temperature: 0, dropped: [] },
    });
    assert.equal(req.url, '/api/router/chat/completions');
  });
});
```

The file already imports `buildPinnedRequest`; add `PROBES` to its import from `../suite.js` if it is not already there.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "src/probes/test/router-client.test.ts"`
Expected: FAIL — TypeScript rejects the unknown property `baseUrl`, or the assertion reports `https://router-api.0g.ai/v1/chat/completions`.

- [ ] **Step 3: Write minimal implementation**

In `src/probes/router-client.ts`, delete line 16 (`import { ROUTER_API } from '../config.js';`), add the field to the interface:

```typescript
export interface PinnedRequestInput {
  /** Where the Router lives. The CLI passes ROUTER_API; the browser passes '/api/router'. */
  baseUrl: string;
  providerAddress: string;
  /** The exact string the Router routes on — use model_id, not canonical_id. */
  model: string;
  probe: Probe;
  params: NegotiatedParams;
  /** USD per token. Taken from pricing_usd and multiplied by a safety factor. */
  maxPriceUsdPrompt?: string;
  maxPriceUsdCompletion?: string;
}
```

and change the return of `buildPinnedRequest`:

```typescript
  return { url: `${input.baseUrl}/chat/completions`, method: 'POST', headers, body };
```

`fetchModels()` at line 323 also reads `ROUTER_API`. Give it the same treatment — `export async function fetchModels(baseUrl: string): Promise<any[]>` — and pass `ROUTER_API` at its call sites.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test "src/probes/test/router-client.test.ts"`
Expected: PASS

- [ ] **Step 5: Fix every call site**

Run: `pnpm typecheck`
Expected: errors naming each script that builds a pinned request. At each one, add `baseUrl: ROUTER_API` to the object literal — `ROUTER_API` is already imported in the scripts, since they are node-side. Re-run until clean.

- [ ] **Step 6: Extend the browser-safety guard**

In `src/verify/test/browser-safe.test.ts`, `BROWSER_ENTRYPOINTS` becomes:

```typescript
const BROWSER_ENTRYPOINTS = [
  'src/chain/registry.ts',
  'src/chain/abi.ts',
  'src/verify/recompute.ts',
  'src/verify/check.ts',
  'src/verify/reproduce.ts',
  'src/storage/merkle.ts',
  'src/probes/router-client.ts',
  'src/probes/suite.ts',
  'src/probes/aggregate.ts',
  'src/probes/divergence.ts',
  'dashboard/main.tsx',
];
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: all pass. The guard bundles each entrypoint with esbuild for real, so a lingering `config.js` import fails here rather than at deploy time.

- [ ] **Step 8: Commit**

```bash
git add src/probes/router-client.ts src/probes/test/router-client.test.ts src/scripts src/verify/test/browser-safe.test.ts
git commit -m "Let the probe client be told where the Router is

One import — ROUTER_API from config.ts, which calls dotenv — was the only thing
keeping the probe layer out of a browser. suite.ts, aggregate.ts and
divergence.ts were already clean. The endpoint is now a parameter, and all four
modules join the browser-safety guard, which bundles them with esbuild for real."
```

---

### Task 2: Let a live run be compared without fabricating fields

`compareRuns()` takes `RecomputedService[]`, which carries eighteen fields. A live browser run produces `ServiceStats` plus `DivergenceResult`, and filling the other fields with zeros to satisfy a type would put invented values next to measured ones. The input type narrows to exactly what the comparison reads.

**Files:**
- Modify: `src/verify/reproduce.ts`
- Test: `src/verify/test/reproduce.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `export interface ComparableService { address: string; modelId: string; mode: string; p50Ms: number; p95Ms: number; errorRateBps: number; divergenceBps: number; }` and `Measured.services: readonly ComparableService[]`. `RecomputedService` satisfies `ComparableService` structurally, so `reproduce()` and every existing caller keep working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/verify/test/reproduce.test.ts`:

```typescript
describe('compareRuns · input shape', () => {
  it('compares a run that carries only the fields the comparison reads', () => {
    const live: ComparableService = {
      address: '0xA', modelId: 'm-one', mode: 'TeeTLS',
      p50Ms: 100, p95Ms: 200, errorRateBps: 0, divergenceBps: 0,
    };
    const report = compareRuns({ services: [live] }, { services: [live] });
    assert.deepEqual(report.disagreements, []);
    assert.equal(report.compared, 1);
  });
});
```

Add `ComparableService` to the existing import from `../reproduce.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "src/verify/test/reproduce.test.ts"`
Expected: FAIL — `'../reproduce.js' does not provide an export named 'ComparableService'`.

- [ ] **Step 3: Write minimal implementation**

In `src/verify/reproduce.ts`, add the type above `Measured` and widen `Measured`:

```typescript
/**
 * The fields a cross-run comparison actually reads.
 *
 * `RecomputedService` satisfies this structurally, so recomputing a bundle still feeds
 * `compareRuns` directly. A live measurement taken in the page produces `ServiceStats`
 * plus a `DivergenceResult` and has no honest value for the rest — narrowing the input is
 * how invented zeros are kept out of a comparison against measured numbers.
 */
export interface ComparableService {
  address: string;
  modelId: string;
  mode: string;
  p50Ms: number;
  p95Ms: number;
  errorRateBps: number;
  divergenceBps: number;
}

export interface Measured {
  services: readonly ComparableService[];
  /**
   * The value this run's bundle uses for "divergence was not measurable". Read from the
   * bundle rather than assumed: a bundle that never names one cannot express the
   * distinction, and then a withheld figure is indistinguishable from a real zero.
   */
  unmeasured?: number;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test "src/verify/test/reproduce.test.ts" && pnpm typecheck`
Expected: all pass, including the existing real-bundle tests, which prove `RecomputedService` still fits.

- [ ] **Step 5: Commit**

```bash
git add src/verify/reproduce.ts src/verify/test/reproduce.test.ts
git commit -m "Narrow the comparison's input to what it reads

A live run produces ServiceStats and a DivergenceResult, not a RecomputedService.
Padding the difference with zeros would put invented values beside measured ones,
so the input type shrinks to the seven fields compareRuns actually touches.
RecomputedService satisfies it structurally; no caller changes."
```

---

### Task 3: The relay's pure half

Validation, price-ceiling calculation and upstream request construction, with no network and no Vercel types, so it is testable the way `epoch-run.ts` is testable and `run-epoch.ts` is not.

**Files:**
- Create: `src/relay/request.ts`
- Test: `src/relay/test/request.test.ts`

**Interfaces:**
- Consumes: `toHeaderPrice(usdPerToken: number, multiplier: number): string | undefined` from `src/probes/plan.js`.
- Produces:
  - `export const UPSTREAM = 'https://router-api.0g.ai/v1/chat/completions'`
  - `export const PROVIDERS_URL = 'https://router-api.0g.ai/v1/providers'`
  - `export const PRICE_MULTIPLIER = 3`
  - `export interface RelayBody { providerAddress: string; model: string; messages: Array<{ role: string; content: string }>; max_tokens: number; temperature?: number; }`
  - `export interface PriceRow { prompt?: string; completion?: string }`
  - `export type PriceTable = Record<string, PriceRow>` keyed by `` `${address.toLowerCase()}|${model}` ``
  - `export class RelayRejected extends Error { constructor(message: string, readonly status: number) }`
  - `export function priceKey(address: string, model: string): string`
  - `export function parseRelayBody(raw: unknown): RelayBody` — throws `RelayRejected` with status 400
  - `export function buildUpstream(body: RelayBody, authorization: string | undefined, prices: PriceTable): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }` — throws `RelayRejected` with status 401 when `authorization` is missing or malformed

- [ ] **Step 1: Write the failing tests**

Create `src/relay/test/request.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildUpstream,
  parseRelayBody,
  priceKey,
  RelayRejected,
  UPSTREAM,
  type PriceTable,
  type RelayBody,
} from '../request.js';

const ADDRESS = '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D';

const body = (over: Partial<RelayBody> = {}): RelayBody => ({
  providerAddress: ADDRESS,
  model: 'glm-5.2',
  messages: [{ role: 'user', content: 'hello' }],
  max_tokens: 64,
  temperature: 0,
  ...over,
});

const prices: PriceTable = {
  [priceKey(ADDRESS, 'glm-5.2')]: { prompt: '0.0000009', completion: '0.000003' },
};

describe('parseRelayBody', () => {
  it('rejects a malformed provider address', () => {
    assert.throws(
      () => parseRelayBody({ ...body(), providerAddress: 'not-an-address' }),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('rejects a body with no messages', () => {
    assert.throws(() => parseRelayBody({ ...body(), messages: [] }), (e: RelayRejected) => e.status === 400);
  });

  it('accepts a well-formed body', () => {
    assert.equal(parseRelayBody(body()).model, 'glm-5.2');
  });
});

describe('buildUpstream', () => {
  it('refuses a request with no Authorization, rather than falling back to a key', () => {
    assert.throws(() => buildUpstream(body(), undefined, prices), (e: RelayRejected) => e.status === 401);
  });

  it('always calls the one hardcoded upstream, whatever the body says', () => {
    const withExtras = { ...body(), url: 'https://evil.test/v1/chat/completions' } as RelayBody;
    const { url } = buildUpstream(withExtras, 'Bearer sk-test', prices);
    assert.equal(url, UPSTREAM);
  });

  it('pins the provider and sets both price ceilings at the multiplier the CLI uses', () => {
    const { init } = buildUpstream(body(), 'Bearer sk-test', prices);
    assert.equal(init.headers['X-0G-Provider-Address'], ADDRESS);
    // 0.0000009 USD/token * 1e6 tokens * 3 = 2.7 USD per million tokens
    assert.equal(init.headers['X-0G-Provider-Max-Price-Usd-Prompt'], '2.7');
    // 0.000003 * 1e6 * 3 = 9
    assert.equal(init.headers['X-0G-Provider-Max-Price-Usd-Completion'], '9');
  });

  it('forwards the caller Authorization verbatim and sends no key of its own', () => {
    const { init } = buildUpstream(body(), 'Bearer sk-caller', prices);
    assert.equal(init.headers.authorization, 'Bearer sk-caller');
  });

  it('refuses a service it holds no price for, rather than sending an uncapped request', () => {
    assert.throws(
      () => buildUpstream(body({ model: 'unknown-model' }), 'Bearer sk-test', {}),
      (e: RelayRejected) => e.status === 400,
    );
  });

  it('never puts the api key in the body', () => {
    const { init } = buildUpstream(body(), 'Bearer sk-secret', prices);
    assert.equal(init.body.includes('sk-secret'), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test "src/relay/test/request.test.ts"`
Expected: FAIL — `Cannot find module .../src/relay/request.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/relay/request.ts`:

```typescript
/**
 * The pure half of the measurement relay.
 *
 * The relay exists for one reason: the Router refuses any request carrying an `Origin`
 * outside its allowlist, and the `X-0G-Provider-Max-Price-Usd-*` headers are absent from
 * its `access-control-allow-headers`, so a browser that sent them would have its request
 * blocked before it left the machine. Measuring from a page therefore means measuring with
 * no price ceiling — unless a server attaches it.
 *
 * Everything here is a pure function so the rules that matter can be tested without a
 * network: which upstream is reachable, what happens without an Authorization header, and
 * whether a caller can widen its own price ceiling. It holds no secret of its own.
 */
import { toHeaderPrice } from '../probes/plan.js';

/** The only URL this relay will ever call. Never taken from a request. */
export const UPSTREAM = 'https://router-api.0g.ai/v1/chat/completions';
export const PROVIDERS_URL = 'https://router-api.0g.ai/v1/providers';

/** Matches `priceMultiplier: 3` in run-epoch.ts, so a page measures on the CLI's terms. */
export const PRICE_MULTIPLIER = 3;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BEARER_RE = /^Bearer\s+\S+$/;

export interface RelayBody {
  providerAddress: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens: number;
  temperature?: number;
}

export interface PriceRow {
  prompt?: string;
  completion?: string;
}

/** Keyed by `${address.toLowerCase()}|${model}` — the unit is the pair, never the address. */
export type PriceTable = Record<string, PriceRow>;

export class RelayRejected extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'RelayRejected';
  }
}

export function priceKey(address: string, model: string): string {
  return `${address.toLowerCase()}|${model}`;
}

export function parseRelayBody(raw: unknown): RelayBody {
  const b = raw as Partial<RelayBody> | null;
  if (!b || typeof b !== 'object') throw new RelayRejected('body must be a JSON object', 400);
  if (typeof b.providerAddress !== 'string' || !ADDRESS_RE.test(b.providerAddress)) {
    throw new RelayRejected('providerAddress must be a 0x-prefixed 20-byte address', 400);
  }
  if (typeof b.model !== 'string' || b.model === '') {
    throw new RelayRejected('model must be a non-empty string', 400);
  }
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    throw new RelayRejected('messages must be a non-empty array', 400);
  }
  for (const m of b.messages) {
    if (typeof m?.role !== 'string' || typeof m?.content !== 'string') {
      throw new RelayRejected('each message needs a string role and content', 400);
    }
  }
  if (typeof b.max_tokens !== 'number' || !Number.isInteger(b.max_tokens) || b.max_tokens <= 0) {
    throw new RelayRejected('max_tokens must be a positive integer', 400);
  }
  if (b.temperature !== undefined && typeof b.temperature !== 'number') {
    throw new RelayRejected('temperature must be a number when present', 400);
  }
  return {
    providerAddress: b.providerAddress,
    model: b.model,
    messages: b.messages,
    max_tokens: b.max_tokens,
    ...(b.temperature === undefined ? {} : { temperature: b.temperature }),
  };
}

export function buildUpstream(
  body: RelayBody,
  authorization: string | undefined,
  prices: PriceTable,
): { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } } {
  // No fallback to a key of our own. That fallback is how a relay silently spends its
  // operator's money, and it would also make every measurement ours rather than theirs.
  if (!authorization || !BEARER_RE.test(authorization)) {
    throw new RelayRejected('an Authorization: Bearer header is required', 401);
  }

  const row = prices[priceKey(body.providerAddress, body.model)];
  if (!row) {
    // Sending it uncapped would be spending the caller's credit with no ceiling.
    throw new RelayRejected('no advertised price for that provider and model', 400);
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization,
    'X-0G-Provider-Address': body.providerAddress,
  };
  const prompt = toHeaderPrice(Number(row.prompt ?? 0), PRICE_MULTIPLIER);
  const completion = toHeaderPrice(Number(row.completion ?? 0), PRICE_MULTIPLIER);
  if (prompt) headers['X-0G-Provider-Max-Price-Usd-Prompt'] = prompt;
  if (completion) headers['X-0G-Provider-Max-Price-Usd-Completion'] = completion;

  // Rebuilt field by field rather than spread, so nothing a caller invents rides along.
  const payload: Record<string, unknown> = {
    model: body.model,
    messages: body.messages,
    max_tokens: body.max_tokens,
    stream: false,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;

  return { url: UPSTREAM, init: { method: 'POST', headers, body: JSON.stringify(payload) } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test "src/relay/test/request.test.ts"`
Expected: 8 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: all pass. `src/relay/test/` is already covered by the `src/**/test/*.test.ts` glob in `package.json`.

- [ ] **Step 6: Commit**

```bash
git add src/relay
git commit -m "The relay's rules, as pure functions

Which upstream is reachable, what happens with no Authorization, and whether a
caller can widen its own price ceiling are the three things worth testing about a
relay, and none of them need a network. The upstream is a constant, a missing
Authorization is a 401 with no fallback key, and a service with no advertised
price is refused rather than sent uncapped on the caller's credit."
```

---

### Task 4: The relay itself

The Vercel Function. Thin: read the body, fetch the price table, call the pure half, forward, return.

**Files:**
- Create: `api/router.ts`
- Create: `src/relay/prices.ts`
- Modify: `vercel.json`
- Test: `src/relay/test/prices.test.ts`

**Interfaces:**
- Consumes: everything Task 3 produced.
- Produces: `export async function loadPrices(authorization: string, fetchJson: (url: string, auth: string) => Promise<any>, now?: number): Promise<PriceTable>` from `src/relay/prices.js`, and `export function priceTableFrom(data: unknown): PriceTable`.

- [ ] **Step 1: Write the failing test**

Create `src/relay/test/prices.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { loadPrices, priceTableFrom } from '../prices.js';
import { priceKey } from '../request.js';

const ADDRESS = '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D';

/** The shape /v1/providers really returns, measured 2026-08-25. */
const response = {
  object: 'list',
  data: [
    {
      address: ADDRESS,
      model_id: 'glm-5.2',
      pricing_usd: { prompt: '0.0000009', completion: '0.000003', cached_prompt: '0.00000018' },
    },
  ],
};

describe('priceTableFrom', () => {
  it('keys the advertised prices by the (address, model) pair', () => {
    const table = priceTableFrom(response);
    assert.deepEqual(table[priceKey(ADDRESS, 'glm-5.2')], {
      prompt: '0.0000009',
      completion: '0.000003',
    });
  });

  it('returns an empty table for a response it does not recognise', () => {
    assert.deepEqual(priceTableFrom({ nope: true }), {});
  });
});

describe('loadPrices', () => {
  it('fetches once and serves the cache within the TTL', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return response;
    };
    await loadPrices('Bearer sk-a', fetchJson, 1_000);
    await loadPrices('Bearer sk-b', fetchJson, 30_000);
    assert.equal(calls, 1);
  });

  it('refetches once the TTL has passed', async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return response;
    };
    await loadPrices('Bearer sk-a', fetchJson, 100_000);
    await loadPrices('Bearer sk-a', fetchJson, 100_000 + 60_001);
    assert.equal(calls, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "src/relay/test/prices.test.ts"`
Expected: FAIL — `Cannot find module .../src/relay/prices.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/relay/prices.ts`:

```typescript
/**
 * The advertised price table, fetched server-side because it has to be.
 *
 * `/v1/providers` is CORS-blocked from a foreign origin exactly like `/v1/chat/completions`
 * — verified 2026-08-25, 403 — and the evidence bundle's roster carries no pricing, so a
 * browser has no way to learn what a call should cost. Having the relay look it up also
 * means a caller cannot widen its own ceiling.
 *
 * The table is cached as `address|model -> pricing_usd`, never the raw response. It is a
 * public catalogue that happens to sit behind auth, not per-caller data — this is written
 * down so nobody later mistakes the cache for something user-scoped.
 */
import { PROVIDERS_URL, priceKey, type PriceTable } from './request.js';

const TTL_MS = 60_000;

let cached: { at: number; table: PriceTable } | null = null;

export function priceTableFrom(data: unknown): PriceTable {
  const rows = (data as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return {};
  const table: PriceTable = {};
  for (const r of rows) {
    const address = r?.address;
    const model = r?.model_id;
    const pricing = r?.pricing_usd;
    if (typeof address !== 'string' || typeof model !== 'string' || !pricing) continue;
    table[priceKey(address, model)] = {
      prompt: typeof pricing.prompt === 'string' ? pricing.prompt : undefined,
      completion: typeof pricing.completion === 'string' ? pricing.completion : undefined,
    };
  }
  return table;
}

/**
 * `fetchJson` and `now` are injected so the cache can be tested without a network and
 * without waiting a minute.
 */
export async function loadPrices(
  authorization: string,
  fetchJson: (url: string, auth: string) => Promise<unknown>,
  now: number = Date.now(),
): Promise<PriceTable> {
  if (cached && now - cached.at < TTL_MS) return cached.table;
  const table = priceTableFrom(await fetchJson(PROVIDERS_URL, authorization));
  cached = { at: now, table };
  return table;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test "src/relay/test/prices.test.ts"`
Expected: 4 tests PASS.

- [ ] **Step 5: Write the function**

Create `api/router.ts`:

```typescript
/**
 * Forward exactly one chat completion to the 0G Router.
 *
 * This endpoint holds no secret and performs no measurement. It exists because the Router
 * refuses any request whose `Origin` is outside its allowlist — a deployed dashboard cannot
 * be on that list — and because its `access-control-allow-headers` omits the
 * `X-0G-Provider-Max-Price-Usd-*` pair, so a browser sending a price ceiling has its request
 * blocked before it leaves the machine. Measuring from a page without a relay would mean
 * measuring with no ceiling, on the reader's own credit.
 *
 * It cannot produce a wrong measurement, because it does not measure. What a reader has to
 * trust is that it does not log one header, and that is checkable by reading this file.
 */
import { loadPrices } from '../src/relay/prices.js';
import { buildUpstream, parseRelayBody, RelayRejected } from '../src/relay/request.js';

/** A token bucket per IP. See the note at `allow()` for what this does and does not promise. */
const buckets = new Map<string, { tokens: number; at: number }>();
const RATE_CAPACITY = 40;
const RATE_REFILL_PER_MS = 40 / 60_000;

export const config = { maxDuration: 90 };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  if (!allow(clientIp(req))) return json({ error: 'too many requests' }, 429);

  const authorization = req.headers.get('authorization') ?? undefined;

  try {
    // Checked before the price fetch, not only inside buildUpstream: loadPrices needs a
    // key too, and a request with none must cost us no upstream call at all.
    if (!authorization) {
      throw new RelayRejected('an Authorization: Bearer header is required', 401);
    }
    const body = parseRelayBody(await req.json());
    const prices = await loadPrices(authorization, fetchJson);
    const { url, init } = buildUpstream(body, authorization, prices);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    try {
      const upstream = await fetch(url, { ...init, signal: ac.signal });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e instanceof RelayRejected) return json({ error: e.message }, e.status);
    // Scrubbed on purpose: an upstream error string can carry a URL with a token in it.
    return json({ error: 'the relay could not complete this request' }, 502);
  }
}

async function fetchJson(url: string, auth: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: auth } });
  if (!res.ok) throw new RelayRejected('could not read the advertised price table', 502);
  return res.json();
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0]!.trim();
}

/**
 * Casual abuse only. Fluid Compute reuses instances, so this map survives between requests
 * often enough to be useful — but it is per-instance, so it is NOT a hard guarantee across
 * a scaled-out deployment. Saying so here is cheaper than someone later assuming otherwise.
 *
 * The vector that would actually matter, using this as an anonymising relay to arbitrary
 * hosts, is closed by the upstream URL being a constant rather than by this function.
 */
function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_CAPACITY, at: now };
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + (now - b.at) * RATE_REFILL_PER_MS);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}
```

- [ ] **Step 6: Point Vercel at the function**

`vercel.json` becomes:

```json
{
  "buildCommand": "pnpm dashboard:build",
  "outputDirectory": "dashboard-dist",
  "framework": null,
  "functions": {
    "api/router.ts": { "maxDuration": 90 }
  }
}
```

- [ ] **Step 7: Verify it typechecks and the suite is green**

Run: `pnpm typecheck && pnpm test && pnpm dashboard:build`
Expected: all pass.

If `pnpm typecheck` does not cover `api/`, add `"api"` to the `include` array in `tsconfig.json` so the function is typechecked with everything else.

- [ ] **Step 8: Verify the function actually runs on Vercel**

This is the step most likely to surface a surprise: the repo is ESM with `.js` extensions in its import specifiers, and the function imports across the `api/` → `src/` boundary. Run `npx vercel dev` and exercise it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/router \
  -H 'content-type: application/json' \
  -d '{"providerAddress":"0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D","model":"glm-5.2","messages":[{"role":"user","content":"hi"}],"max_tokens":8}'
```

Expected: `401` — no Authorization header. That single number proves the module graph resolved, the body parsed, and the guard fired. **Do not** move on until this returns 401 rather than a 500 or a module-resolution error.

- [ ] **Step 9: Commit**

```bash
git add api vercel.json tsconfig.json src/relay
git commit -m "A relay that holds nothing

Forwards one chat completion, attaches the price ceiling a browser is forbidden
to send, and returns the upstream response verbatim. No PRIVATE_KEY, no
server-side Router key, no chain access, no logging of headers or bodies, and a
hardcoded upstream so it cannot be turned into an open proxy.

The price table has to be fetched server-side: /v1/providers is CORS-blocked from
a foreign origin exactly like /v1/chat/completions, and the evidence bundle
carries no pricing. It uses the caller's own key, so the relay still needs none."
```

---

### Task 5: Measuring in the page

Replays the probes recorded in a published epoch's bundle through the relay, then compares.

**Files:**
- Create: `dashboard/measure.ts`
- Test: `dashboard/test/measure.test.ts`

**Interfaces:**
- Consumes: `buildPinnedRequest`/`callPinned` with `baseUrl` (Task 1); `ComparableService` (Task 2); `aggregate(results, opts)` → `ServiceStats[]`; `computeDivergence(results, services)` → `DivergenceResult[]`; `compareRuns(published, independent)` → `ReproduceReport`.
- Produces:
  - `export interface MeasureProgress { done: number; total: number; probeId: string; address: string }`
  - `export async function measureGroup(args: { bundle: VerifiableBundle; canonicalId: string; apiKey: string; baseUrl?: string; onProgress?: (p: MeasureProgress) => void; call?: typeof callPinned }): Promise<{ live: ComparableService[]; report: ReproduceReport }>`

- [ ] **Step 1: Write the failing test**

Create `dashboard/test/measure.test.ts`:

```typescript
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { CallResult } from '../../src/probes/router-client.js';
import type { VerifiableBundle } from '../../src/verify/recompute.js';
import { measureGroup } from '../measure.js';

const bundle = JSON.parse(
  readFileSync('data/epochs/496540-2026-08-24T040551787Z.bundle.json', 'utf8'),
) as VerifiableBundle;

/** Answers every probe correctly and instantly, so the run is deterministic. */
const perfectCall = async (opts: any): Promise<CallResult> => ({
  probeId: opts.probe.id,
  providerAddress: opts.providerAddress,
  model: opts.model,
  droppedParams: opts.params.dropped,
  at: new Date(0).toISOString(),
  ok: true,
  status: 200,
  latencyMs: 100,
  text: String(opts.probe.expect ?? ''),
  usage: null,
  chatId: null,
  servedBy: opts.providerAddress,
  truncated: false,
  rateLimitRemaining: null,
  errorKind: null,
});

describe('measureGroup', () => {
  it('replays every probe the bundle records, for each provider in the group', async () => {
    const seen: string[] = [];
    await measureGroup({
      bundle,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: async (opts: any) => {
        seen.push(`${opts.providerAddress}|${opts.probe.id}`);
        return perfectCall(opts);
      },
    });
    // Two providers serve this model in the pinned roster, and the suite has 15 probes.
    assert.equal(seen.length, 30);
    assert.equal(new Set(seen).size, 30);
  });

  it('reports progress once per call', async () => {
    const ticks: number[] = [];
    await measureGroup({
      bundle,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: perfectCall,
      onProgress: (p) => ticks.push(p.done),
    });
    assert.equal(ticks.length, 30);
    assert.equal(ticks.at(-1), 30);
  });

  it('compares the live run against what the bundle published', async () => {
    const { report } = await measureGroup({
      bundle,
      canonicalId: 'qwen3-vl-30b',
      apiKey: 'sk-test',
      call: perfectCall,
    });
    assert.equal(report.compared, 2);
  });

  it('refuses a model the bundle never measured, rather than reporting an empty run', async () => {
    await assert.rejects(
      () => measureGroup({ bundle, canonicalId: 'not-in-this-bundle', apiKey: 'sk-test', call: perfectCall }),
      /no services/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test "dashboard/test/measure.test.ts"`
Expected: FAIL — `Cannot find module .../dashboard/measure.js`.

- [ ] **Step 3: Write minimal implementation**

Create `dashboard/measure.ts`:

```typescript
/**
 * Measure one consistency group from the page, and compare it against what was published.
 *
 * The probes are read from the evidence bundle rather than from `src/probes/suite.ts`. That
 * is the point: a reader does not have to trust this repository for the probe definitions,
 * they use the ones recorded in the evidence the published numbers were derived from.
 *
 * Ordering matches the prober: sequential within a provider, parallel across the providers
 * of a group. Concurrent calls to one provider would measure queueing, not the provider.
 */
import { aggregate } from '../src/probes/aggregate.js';
import { computeDivergence, divergenceLookup, type ServiceKey } from '../src/probes/divergence.js';
import { callPinned, type CallResult } from '../src/probes/router-client.js';
import type { Probe } from '../src/probes/suite.js';
import { DIVERGENCE_UNMEASURED } from '../src/chain/encoding.js';
import { compareRuns, type ComparableService, type ReproduceReport } from '../src/verify/reproduce.js';
import { recompute, type VerifiableBundle } from '../src/verify/recompute.js';

export interface MeasureProgress {
  done: number;
  total: number;
  probeId: string;
  address: string;
}

export async function measureGroup(args: {
  bundle: VerifiableBundle;
  canonicalId: string;
  apiKey: string;
  baseUrl?: string;
  onProgress?: (p: MeasureProgress) => void;
  call?: typeof callPinned;
}): Promise<{ live: ComparableService[]; report: ReproduceReport }> {
  const call = args.call ?? callPinned;
  const baseUrl = args.baseUrl ?? '/api/router';
  const probes = args.bundle.probes as unknown as Probe[];
  const services = args.bundle.roster.filter((s) => s.canonicalId === args.canonicalId);
  if (services.length === 0) {
    throw new Error(`no services in this epoch serve ${args.canonicalId}`);
  }

  const total = services.length * probes.length;
  let done = 0;
  const results: CallResult[] = [];

  await Promise.all(
    services.map(async (service) => {
      for (const probe of probes) {
        const r = await call({
          baseUrl,
          apiKey: args.apiKey,
          providerAddress: service.address,
          model: service.modelId,
          probe,
          params: { ...(service.sentParams ?? {}), dropped: service.droppedParams ?? [] },
        });
        results.push(r);
        done += 1;
        args.onProgress?.({ done, total, probeId: probe.id, address: service.address });
      }
    }),
  );

  const keys: ServiceKey[] = services.map((s) => ({
    address: s.address,
    modelId: s.modelId,
    canonicalId: s.canonicalId,
    mode: s.mode,
  }));
  const stats = aggregate(results);
  const divergenceOf = divergenceLookup(computeDivergence(results, keys));
  const modeOf = new Map(keys.map((k) => [`${k.address.toLowerCase()}|${k.modelId}`, k.mode]));

  const live: ComparableService[] = stats.map((s) => ({
    address: s.address,
    modelId: s.modelId,
    mode: modeOf.get(`${s.address.toLowerCase()}|${s.modelId}`) ?? 'unknown',
    p50Ms: s.p50Ms,
    p95Ms: s.p95Ms,
    errorRateBps: s.errorRateBps,
    divergenceBps: divergenceOf(s.address, s.modelId),
  }));

  const publishedAll = recompute(args.bundle);
  const published = publishedAll.filter((s) => s.canonicalId === args.canonicalId);

  const report = compareRuns(
    { services: published, unmeasured: args.bundle.rules.divergenceUnmeasured },
    { services: live, unmeasured: DIVERGENCE_UNMEASURED },
  );

  return { live, report };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test "dashboard/test/measure.test.ts"`
Expected: 4 tests PASS.

If the `sentParams`/`droppedParams` fields are missing from the `VerifiableBundle` roster type, widen that type in `src/verify/recompute.ts` to include `sentParams?: Record<string, unknown>` and `droppedParams?: string[]` — the real bundles carry both, as `roster[0]` in any file under `data/epochs/` shows.

- [ ] **Step 5: Run the full suite**

Run: `pnpm typecheck && pnpm test && pnpm dashboard:build`
Expected: all pass, including the browser-safety guard now that `measure.ts` is reachable from `dashboard/main.tsx` only after Task 6 — so a failure here means something else.

- [ ] **Step 6: Commit**

```bash
git add dashboard/measure.ts dashboard/test/measure.test.ts
git commit -m "Measure a group in the page, from the probes in the evidence

The probes come from the bundle, not from src/probes/suite.ts. A reader does not
have to trust this repository for the probe definitions — they replay the ones
recorded in the evidence the published numbers were derived from.

Ordering matches the prober: sequential within a provider, parallel across the
group. Concurrent calls to one provider would measure queueing."
```

---

### Task 6: The Measure panel

**Files:**
- Create: `dashboard/Measure.tsx`
- Modify: `dashboard/App.tsx` (add the tab)
- Modify: `dashboard/styles.css` (key field, progress bar)

**Interfaces:**
- Consumes: `measureGroup` (Task 5), `NETWORKS`/`NetworkConfig` and `bundleUrl` from `dashboard/networks.js`, `useObservatory` for the epoch list.
- Produces: `export function Measure(props: { net: NetworkConfig; epochs: readonly number[] }): JSX.Element`

- [ ] **Step 1: Build the panel**

Create `dashboard/Measure.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { ObservatoryReader } from '../src/chain/registry.js';
import type { VerifiableBundle } from '../src/verify/recompute.js';
import type { ReproduceReport } from '../src/verify/reproduce.js';
import { measureGroup } from './measure.js';
import { bundleUrl, type NetworkConfig } from './networks.js';

const GATEWAY_TIMEOUT_MS = 30_000;

/** Every numeric field a disagreement can carry is in basis points. */
function show(value: string | number): string {
  return typeof value === 'number' ? `${(value / 100).toFixed(2)}%` : value;
}

/**
 * Measure a consistency group now, with the reader's own key, and compare it against
 * what the newest published epoch concluded.
 *
 * The key never leaves component state — not localStorage, not a URL, not a log. It does
 * pass through this site's server, because the Router refuses a browser Origin outside its
 * allowlist and forbids the price-ceiling headers a browser would need to send. The panel
 * says so above the input rather than burying it.
 */
export function Measure(props: { net: NetworkConfig; epochs: readonly number[] }) {
  const newest = props.epochs.at(-1);
  const [bundle, setBundle] = useState<VerifiableBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [group, setGroup] = useState<string>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<ReproduceReport | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (newest === undefined) return;
    let cancelled = false;
    setBundle(null);
    setLoadError(null);

    (async () => {
      try {
        const reader = new ObservatoryReader(props.net.rpcUrl, {
          providerRegistry: props.net.providerRegistry,
          measurementRegistry: props.net.measurementRegistry,
        });
        const record = await reader.readEpoch(newest, props.net.prober);
        if (!record) throw new Error('that epoch was never written');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
        try {
          const res = await fetch(bundleUrl(props.net, record.storageRoot), {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`gateway returned ${res.status}`);
          const parsed = JSON.parse(await res.text());
          if (typeof parsed?.code === 'number' && parsed.code !== 0) {
            throw new Error(String(parsed.message ?? 'the gateway holds no evidence'));
          }
          if (!cancelled) setBundle(parsed as VerifiableBundle);
        } finally {
          clearTimeout(timer);
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(String(e?.message ?? e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.net, newest]);

  /** Only models with two or more providers: a lone provider has nothing to diverge from. */
  const groups = useMemo(() => {
    if (!bundle) return [];
    const counts = new Map<string, number>();
    for (const s of bundle.roster) counts.set(s.canonicalId, (counts.get(s.canonicalId) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([canonicalId, n]) => ({ canonicalId, services: n, calls: n * bundle.probes.length }))
      .sort((a, b) => a.calls - b.calls);
  }, [bundle]);

  const selected = groups.find((g) => g.canonicalId === group) ?? groups[0];

  async function run() {
    if (!bundle || !selected) return;
    setReport(null);
    setRunError(null);
    setProgress({ done: 0, total: selected.calls });
    try {
      const { report: r } = await measureGroup({
        bundle,
        canonicalId: selected.canonicalId,
        apiKey,
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      });
      setReport(r);
    } catch (e: any) {
      setRunError(String(e?.message ?? e));
    } finally {
      setProgress(null);
    }
  }

  if (newest === undefined) {
    return (
      <section>
        <h2>Measure</h2>
        <p>No epoch has been published on {props.net.name}, so there is nothing to compare against.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Measure</h2>
      <p>
        The Reproducibility panel compares two runs we already published. This one lets you
        take the measurement yourself, now, with your own key, and compare it against epoch{' '}
        <strong>{newest}</strong>. The probes come from that epoch&rsquo;s evidence, not from
        our source — you are replaying what the published numbers were derived from.
      </p>

      <p>
        Your key passes through this site&rsquo;s server to get around the Router&rsquo;s
        origin check. It is not stored and not logged. Use a key with <code>inference</code>{' '}
        scope only. This is the one part of this page that asks you to trust us.
      </p>

      {loadError && <p>Could not read epoch {newest}: {loadError}.</p>}

      {bundle && selected && (
        <>
          <label>
            group{' '}
            <select value={selected.canonicalId} onChange={(e) => setGroup(e.target.value)}>
              {groups.map((g) => (
                <option key={g.canonicalId} value={g.canonicalId}>
                  {g.canonicalId} — {g.services} providers, {g.calls} calls
                </option>
              ))}
            </select>
          </label>

          <label>
            Router API key{' '}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </label>

          <p>
            This will send <strong>{selected.calls} calls</strong> on your key, billed at
            whatever those providers charge. The relay caps each call at three times the
            advertised rate.
          </p>

          <button onClick={run} disabled={!apiKey || progress !== null}>
            {progress ? `measuring ${progress.done}/${progress.total}…` : 'Measure'}
          </button>
        </>
      )}

      {runError && (
        <p>
          The run stopped: {runError}.{' '}
          {runError.includes('404')
            ? 'A 404 here means the page is being served without its relay — that endpoint only exists on a real deployment or under `vercel dev`.'
            : 'This is a run failure, not a disagreement between the measurements.'}
        </p>
      )}

      {report && (
        <>
          <p>
            {report.compared} service{report.compared === 1 ? '' : 's'} measured by both runs
            {report.disagreements.length === 0
              ? ', and every conclusion matched.'
              : `, with ${report.disagreements.length} disagreement${
                  report.disagreements.length === 1 ? '' : 's'
                }.`}
          </p>

          {report.disagreements.length > 0 && (
            <>
              <h3>Where the two runs disagree</h3>
              <table>
                <thead>
                  <tr>
                    <th>service</th>
                    <th>what</th>
                    <th>epoch {newest}</th>
                    <th>yours</th>
                  </tr>
                </thead>
                <tbody>
                  {report.disagreements.map((d, i) => (
                    <tr key={i}>
                      <td>{d.service}</td>
                      <td>{d.kind}</td>
                      <td>{show(d.published)}</td>
                      <td>{show(d.independent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Latency, as a ratio</h3>
          <p>
            Yours over the published run. Two runs at two times see different load, and
            nothing here can say which one caught a bad minute.
          </p>
          <table>
            <thead>
              <tr>
                <th>service</th>
                <th>p50</th>
                <th>p95</th>
              </tr>
            </thead>
            <tbody>
              {report.latency.map((l) => (
                <tr key={l.service}>
                  <td>{l.service}</td>
                  <td>{l.p50Ratio.toFixed(2)}&times;</td>
                  <td>{l.p95Ratio.toFixed(2)}&times;</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(report.onlyPublished.length > 0 || report.onlyIndependent.length > 0) && (
            <>
              <h3>Not comparable</h3>
              <ul>
                {report.onlyPublished.map((s) => (
                  <li key={s}>{s} — epoch {newest} only</li>
                ))}
                {report.onlyIndependent.map((s) => (
                  <li key={s}>{s} — your run only</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
```

Add to `dashboard/styles.css`:

```css
/* ── the Measure panel ─────────────────────────────────────────────────────
 *
 * No colour encodes a result here either. The key field is styled as an input and
 * nothing more: making it look alarming would be theatre, and the paragraph above it
 * already says exactly what happens to the key.
 */

label {
  display: block;
  margin: 0.75rem 0;
  color: var(--muted);
}

input[type='password'],
select {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--rule);
  border-radius: 3px;
  padding: 0.4rem 0.6rem;
  min-width: 18rem;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Add the tab**

In `dashboard/App.tsx`, widen the panel state and add the button and the branch:

```tsx
const [panel, setPanel] = useState<'providers' | 'verify' | 'reproduce' | 'measure'>('providers');
```

```tsx
          <button onClick={() => setPanel('measure')} aria-pressed={panel === 'measure'}>
            Measure
          </button>
```

```tsx
      {data.state === 'ready' && panel === 'measure' && (
        <Measure net={net} epochs={data.epochs} />
      )}
```

- [ ] **Step 3: Verify it builds and the guard still holds**

Run: `pnpm typecheck && pnpm test && pnpm dashboard:build`
Expected: all pass. The browser-safety guard walks `dashboard/main.tsx`, so it now reaches `measure.ts` and the probe modules and bundles them with esbuild for real. A node-only import anywhere in that closure fails here.

- [ ] **Step 4: Verify it in a browser against mainnet**

```bash
npx vercel dev
```

Open `http://localhost:3000`, go to **Measure**, pick `qwen3-vl-30b` — the cheapest group, about $0.003 — paste a real key and run it. Confirm: the cost appears before the button, progress advances 1..30, and a comparison renders.

`vercel dev` is required rather than `pnpm dashboard:preview`, because `/api/router` does not exist under the static preview.

- [ ] **Step 5: Commit**

```bash
git add dashboard/Measure.tsx dashboard/App.tsx dashboard/styles.css
git commit -m "Measure a group from the page

Pick a group, see what it will cost before spending, paste a key, watch it run,
read the comparison. The key lives in component state and nowhere else — not
localStorage, not a URL — and the panel says plainly that this is the one part of
the page that asks the reader to trust us."
```

---

### Task 7: Say what it does, and what it asks

**Files:**
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Update the README**

In the "Measure it yourself, and compare" section, lead with the page rather than the CLI:

- The dashboard's **Measure** panel is the path for most readers: pick a group, bring a Router key, no clone.
- Say what the relay is and is not, in two sentences: it forwards one call and attaches the price ceiling a browser cannot send; it holds no key and runs no measurement.
- Keep the `pnpm epoch` / `pnpm reproduce` commands below, for a reader who has already cloned.

- [ ] **Step 2: Update the task board**

Add T19 to *Done* in `docs/HANDOFF.md`, and record: the relay's four rules, the measured CORS allowlist that forced it, the missing price-ceiling headers, and that `/v1/providers` is CORS-blocked too. Note explicitly that the relay must never gain chain access — the ledger is write-once and prober-keyed.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/HANDOFF.md
git commit -m "Document the relay, and what it asks of a reader"
```

---

## Deployment note

`/api/router` only exists on a real Vercel deployment or under `vercel dev`. The static
`pnpm dashboard:preview` serves the built page with no functions, so the Measure panel will
fail there with a 404 and that is expected, not a bug. Say so in the panel's error text if
the fetch returns 404.
