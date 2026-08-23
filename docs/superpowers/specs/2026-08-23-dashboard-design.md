# T9 — Public dashboard (F5)

**Status:** design approved 2026-08-23, not yet implemented.

## What it is

A web page that answers the three questions the project exists to answer, using only data
that already exists on 0G Chain and 0G Storage. It runs entirely in the browser. There is
no backend, no API of ours, and no build-time snapshot of measurements.

That constraint is not an aesthetic choice. The design doc's architecture says *"Dashboard,
SDK and CLI all read straight from 0G Chain and 0G Storage — no component has to trust our
server."* A dashboard served from our own database would make the whole project a
centralised leaderboard with extra steps.

Measured 2026-08-23, which is what makes this possible:

```
evmrpc-testnet.0g.ai              Access-Control-Allow-Origin: *   chainId 0x40da
evmrpc.0g.ai                      Access-Control-Allow-Origin: *   chainId 0x4115
indexer-storage-testnet-turbo…    access-control-allow-origin: *
```

## Scope

**In:** two views — Providers and Verify — over a network the reader selects.
**Out:** the per-service time series. With three epochs in existence it would be a chart of
noise. The epoch list ships now; the series is added when epochs exist to plot.
**Out:** TEE attestation display. That is prober-side work, same reasoning as in T8.

## Architecture

One `package.json` at the repository root. Vite and React are dev dependencies; `dashboard/`
holds only source. A single `pnpm typecheck` covers the dashboard and the prober together.

The page is one route with two panels selected by a tab. No router: two views do not justify
one, and a URL that survives a reload is not something this page needs.

An earlier draft made `dashboard/` its own package with an alias into `../src`. That was
rejected: the root typecheck would not have covered it, and one deliverable would have had
two dependency trees.

### Shared code, not copied code

The dashboard imports the same modules the CLI uses:

| Module | Role in the dashboard |
|---|---|
| `src/chain/registry.ts` | reads epochs, headers, measurements, providers |
| `src/chain/abi.ts` | ABI fragments |
| `src/verify/recompute.ts` | recomputes every published number in the browser |
| `src/verify/check.ts` | compares recomputed against published |

`recompute.ts` has **zero imports**, so it runs unchanged in a browser. `registry.ts` needs
only `ethers`.

### The browser-safe boundary is enforced, not trusted

`src/config.ts` calls `dotenv/config` and reads `process.env`. One future
`import { RPC_URL } from '../config.js'` inside `registry.ts` would silently break the
dashboard build. Nothing in the type system prevents it.

So: a test reads the source of the browser-bound modules, follows their relative imports
transitively, and fails if any file in that closure imports a node-only module — anything
matching `node:*`, or bare `fs` / `path` / `os` / `crypto` / `dotenv`. It is a static scan of
import statements, not a runtime probe, so it catches the bad import at test time rather than
at build time. It runs inside the existing `pnpm test` suite.

The closure starts at `src/chain/registry.ts`, `src/chain/abi.ts`, `src/verify/recompute.ts`
and `src/verify/check.ts`. `ethers` is allowed; it ships a browser build.

This is the kind of constraint that rots the moment it is only written down.

### Network selection

Contract addresses come from `deployments/<network>.json`, bundled at build time — they are
public constants. The RPC endpoint and the storage indexer are chosen at runtime by a
toggle, defaulting to whichever network the deployment file names. When T12 lands, pointing
the dashboard at mainnet is a deployment file and a default, not a code change.

### Reading providers without hammering a public RPC

`ObservatoryReader.loadProviders()` currently issues one `get(id)` per provider — 38
sequential round trips — plus a `queryFilter` for the names. That is fine in a terminal and
wrong on a page: it is slow, and public RPCs rate-limit.

The reader gains a parallel path with bounded concurrency and an in-session cache, shared
with the CLI rather than forked for the dashboard. The registry is append-only, so a cache
keyed by provider count can never serve a stale name.

## The two views

### Providers

One row per **(address, model)** pair. Never per address.

Pooling by address is the exact defect this project points at — four differently-sized
models reported at an identical 9408 ms because the figure was aggregated at the address.
The design doc's phrase "roll 42 records up to 20 addresses" therefore means *group for
navigation*: rows sit under their operator so a reader can see that one operator serves
eleven models, and no number is ever averaged across them.

Columns: model, mode badge, p50, p95, error rate, divergence, sample count, and a link to
the transaction that published the row.

Counts are read from chain, never hardcoded. The design doc's "42 services · 20 addresses"
was measured on 2026-08-21; the registry currently holds 38 across 16 addresses.

### Verify

Pick an epoch. The page then does what `pnpm verify` does, in the browser:

1. read the epoch's header and measurements from chain
2. fetch the evidence bundle from the storage gateway by its `storageRoot`
3. recompute the merkle root over the bytes received and compare it to the record
4. recompute every published number from the rules the bundle states
5. show chain against recomputed, row by row

Step 3 needs a merkle root without a filesystem. `MemData` from the storage SDK takes a
`Uint8Array` and produces the same root — verified 2026-08-23 against the bundle behind
epoch 496516, matching `0x6fa317af…` exactly. The browser therefore performs the *full*
check, not a weakened one. `merkleRootOf` in `src/storage/upload.ts` switches to `MemData`
too, dropping its temporary-file dance so the CLI and the page share one path.

The three epochs on testnet today produce three different outcomes, and the view shows all
three honestly:

| epoch | `storageRoot` | outcome |
|---|---|---|
| 496497 | `0xababab…` | stand-in values from a ledger test; no evidence exists |
| 496515 | keccak of the transcript | written before T11; the root fetches nothing |
| 496516 | real merkle root | verifies completely |

## Honesty mechanics

These are requirements, not decoration. They come from section 08 of the design doc.

- **`standard` mode carries its technical reason and is never scored down.** Nobody can put
  a closed third-party API inside their own TDX enclave. A reader who sees `standard` should
  learn what it does and does not guarantee, not that the provider did something wrong.
- **A service below the sample floor appears as a labelled gap**, not a silent omission.
  `MeasurementRegistry` stores no zero-filled placeholder precisely so that a missing
  measurement stays visible as missing.
- **An unverifiable epoch says so.** See the table above.
- **Every number links to its source** — the publishing transaction on the explorer, and the
  evidence bundle on the storage gateway.
- **A standing "what we do not know" section**, carrying at minimum: we cannot weight by
  traffic and do not know how real traffic is distributed; at n=15 a single epoch's p95 *is*
  its slowest call and carries almost no tail information; three chatbot services registered
  on chain are never exposed by the Router, so header pinning cannot reach them and they are
  absent from every measurement.

## States

Live RPC means waiting, failing and emptiness are normal, so each is designed rather than
discovered:

- **Loading** — per-panel, with what is being fetched named.
- **Error** — the RPC or the gateway failing is reported as that, and never rendered as a
  provider having no data.
- **Few epochs is the normal state.** With three epochs the page must read as a young
  instrument, not a broken one. No layout may depend on having many.

## Testing

Logic lives outside React so it can be tested with `node:test` like the rest of the
repository: row grouping, badge selection, formatting, and the verification state machine.
Components stay thin enough that rendering carries no decisions worth asserting.

The import-boundary test above runs in the same suite.

Manual verification before it is called done: build, serve, load against testnet, and
confirm the Verify view reproduces epoch 496516 and correctly refuses 496515 and 496497.

## Deployment

Vercel, static output. The submission needs a URL a judge can open; nothing about the page
requires a server, so the hosting choice carries no architectural weight and can change.

## What this does not solve

The dashboard is not on the critical path. B2 → T12 → T13 is. If the calendar tightens, the
Verify view is the half worth keeping: it is what distinguishes the project from a
leaderboard, and the Providers view without it is just a table.
