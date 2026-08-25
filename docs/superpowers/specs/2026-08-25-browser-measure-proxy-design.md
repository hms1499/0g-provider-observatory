# Measuring from the page — design

**Date:** 2026-08-25 · **Status:** approved, not yet implemented

## The problem

The Observatory publishes measurements and lets anyone recheck them. Two paths exist today
and both stop short of letting a reader take their own measurement:

- `pnpm verify <epoch>` and the Verify panel recompute a published epoch from its evidence.
  They prove the arithmetic was not tampered with. They cannot say whether the instrument
  gives the same answer twice.
- `pnpm epoch` + `pnpm reproduce` do let someone measure independently, but only after a
  clone, a package manager, an API key and two non-obvious flags. That is an operations
  note, not a feature.

The Reproducibility panel (T18) closed part of the gap by comparing two already-published
epochs in the page, at no cost to the reader. What it cannot do is measure *now*.

## Why the page cannot call the Router directly

Measured 2026-08-25, not assumed. The Router serves CORS correctly, but only to a fixed
allowlist:

| Origin | Result |
|---|---|
| `http://localhost:3000` | 200, `access-control-allow-origin` returned |
| `http://localhost:5173` | 200, `access-control-allow-origin` returned |
| `http://localhost:5174` | 403 |
| `http://localhost:8080` | 403 |
| `https://observatory.0g.ai` | 200 |
| `https://0g.ai.evil.test` | 403 — the suffix match is correct, not fooled |
| `https://foo.vercel.app` | 403 |

A deployed dashboard cannot be on that list and we do not control it.

Separately, the `access-control-allow-headers` the Router returns is:

```
Origin, Content-Type, Authorization, X-0g-Source-Id, Http-Referer, X-Title,
X-0g-Provider-Address, X-0g-Provider-Sort, X-0g-Provider-Trust-Mode,
X-0g-Provider-Allow-Fallbacks, Traceparent, Tracestate
```

`X-0G-Provider-Max-Price-Usd-Prompt` and `-Completion` are absent. Per the CORS spec a
browser blocks a request carrying a header the server did not allow, so measuring straight
from a page would mean measuring **with no price ceiling, on the reader's own credit**.

## The shape chosen, and the two rejected

**Chosen: a thin per-call relay, with the browser orchestrating.** `/api/router` forwards
exactly one chat completion. The browser runs the suite, aggregates, and compares.

Rejected: **the server measures a whole group and streams progress.** Probes run
sequentially within a provider and `router-client.ts` allows 60s per call, so one group's
worst case is `15 × 60s = 900s` — three times Vercel's 300s ceiling. Measured wall clock
from epoch 496540 confirms the tail is real: `qwen3.7-plus` took 239.9s for one service,
`glm-5.2` 110.5s, `qwen3-vl-30b` 32.5s. Cutting the suite when the clock runs out would
recreate exactly the defect `fitToBudget()` was built to remove: the suite is walked in
order, so a truncated run under-samples the probes near the end, and the two halves of the
byte-identical noise pair sit at positions 5 and 14. A biased measurement is worse than no
measurement.

Rejected: **one request per service.** Same 900s ceiling, unless the per-call timeout is
lowered, which changes what is being measured.

The chosen shape also has a property worth more than its convenience: **the server holds no
secret and performs no measurement, so it cannot produce a wrong number.** A reader has to
trust that we do not log one header, and that is checkable by reading the file.

## Components

### `api/router.ts` — the relay

```
POST /api/router
Authorization: Bearer sk-…          ← the caller's key, forwarded verbatim
Content-Type: application/json
{ providerAddress, model, messages, max_tokens, temperature }
```

Sequence: validate the body shape → look up the advertised price for
`(providerAddress, model)` → attach `X-0G-Provider-Address` and both price-ceiling headers
at a multiplier of 3, matching `run-epoch.ts:114` → call
`https://router-api.0g.ai/v1/chat/completions` → return the upstream status and body
verbatim.

**Where the price comes from.** `GET https://router-api.0g.ai/v1/providers`, using the
caller's own `Authorization` header. Measured 2026-08-25: it returns `{object, data}` with
53 entries, each carrying `address`, `model_id` and
`pricing_usd: { prompt, completion, cached_prompt }` as USD-per-token decimal strings.
`toHeaderPrice()` already converts that to the header's per-million-token unit.

Three consequences worth stating:

- The price lookup happens **server-side because it has to**. That endpoint is CORS-blocked
  from a foreign origin exactly like `/v1/chat/completions` — verified, 403 — so a browser
  could not fetch it even if the bundle did not carry pricing. And the bundle does not: its
  `roster[]` holds `address`, `modelId`, `canonicalId`, `mode`, `onchainMode`,
  `droppedParams` and `sentParams`, and no prices at all.
- It uses the **caller's** key, so the relay still needs no key of its own. Rule 2 below is
  therefore absolute rather than merely preferred.
- Having the server compute the ceiling means a caller cannot widen its own.

The price table is cached in memory for 60s as `address|model -> pricing_usd`, never the raw
response. It is a public catalogue that happens to sit behind auth, not per-caller data —
this is written down so nobody later assumes the cache is user-scoped and treats it as
such.

Four rules that are load-bearing, not preferences:

1. **The upstream host and path are hardcoded.** Never taken from the request. Without this
   the endpoint is an open proxy.
2. **A missing `Authorization` is rejected.** There is no fallback to a server-side key. That
   fallback is how an endpoint silently spends its operator's money.
3. **No request logging of headers or bodies**, and error messages are scrubbed before they
   are returned.
4. **This function has no `PRIVATE_KEY`, no RPC access and no chain writes.** The ledger is
   write-once and keyed by prober; an endpoint that could write would let anyone burn epochs
   under our identity, permanently.

Rate limiting is a per-IP token bucket held in memory. Fluid Compute reuses instances, so
this stops casual abuse but is **not a hard guarantee across instances** — the code says so
rather than implying otherwise. The main abuse vector, using the endpoint as an anonymising
relay, is closed by rule 1.

### The browser side

The page fetches the published epoch's bundle and **replays the probes recorded in that
bundle** — `probes[]` carries `id`, `prompt`, `comparator`, `expect` and `maxTokens`. A
reader therefore does not have to trust this repository for the probe definitions; they use
the ones inside the evidence.

Measurement order is unchanged: sequential within a provider, parallel across the providers
of a group. Results go through `aggregate()` and `computeDivergence()`, then `compareRuns()`
against the published figures.

### Refactor required

One import. `src/probes/router-client.ts:16` imports `ROUTER_API` from `src/config.ts`,
which calls `dotenv/config`. It takes the endpoint as a parameter instead: the CLI passes
`ROUTER_API`, the browser passes `/api/router`.

`suite.ts`, `aggregate.ts` and `divergence.ts` are already free of node-only imports.
`plan.ts` needs no change, because pricing moved to the server.

### UI

A **Measure** panel: pick a group, paste a key, see the projected cost *before* spending,
watch progress per probe, then read the comparison.

Required text, under principle 04 — state plainly what we do not know, and what we ask:

> Your key passes through this site's server to get around the Router's origin check. It is
> not stored and not logged. Use a key with `inference` scope only. This is the one part of
> this page that asks you to trust us.

## Testing

The pure half of the relay — body validation, upstream request construction, price-ceiling
calculation — lives in its own module so it is testable without a network, following
`epoch-run.ts` / `run-epoch.ts`. Required tests:

- a request with no `Authorization` is rejected, and no upstream call is attempted
- a malformed `providerAddress` is rejected
- the price-ceiling headers are computed at the multiplier the CLI uses
- no input can redirect the upstream host or path

`router-client.ts`, `suite.ts`, `aggregate.ts` and `divergence.ts` join
`BROWSER_ENTRYPOINTS` in `src/verify/test/browser-safe.test.ts`, which bundles each entry
with esbuild for real and so catches a regression the type system cannot.

## Out of scope

No chain writes. No stored results. No whole-epoch runs. No server-side key. The
Reproducibility panel stays as it is and remains the path for a reader with no key.

## What this costs

Roughly a day: the refactor, the endpoint, rate limiting, the key-entry and progress UI, and
the honesty copy. The Wave 3 deadline is 2026-08-30 22:00 and T13 still has no video, no X
post and no deployed dashboard URL. This work displaces that; the trade was made
deliberately.
