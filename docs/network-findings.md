# Network findings

**2026-08-21 to 2026-08-25** · 0G Aristotle mainnet (chain 16661) · inference contract
`0x47340d900bdFec2BD393c626E12ea0656F938d84`

What measuring the network turned up, and what it forced in the design. Sections 1–4 come from
reconciling the two sources of truth about which services exist; section 5 from trying to reach the
Router from a browser.

The question driving all of it: **how far can any of this actually be verified?**

---

## 1. The TEE risk is closed — F7 keeps its strong scope

The verification chain is fully public and a third party can run it, without being the original client:

| Step | How |
|---|---|
| Fetch the attestation report | `GET {providerURL}/v1/proxy/attestation/report` — no auth |
| Fetch the signature of a past chat | `GET {providerURL}/v1/proxy/signature/{chatID}?model={model}` — no auth |
| Verify the signature | `ethers.recoverAddress()` — runs offline |

The SDK exposes all of this via `InferenceVerifier.verifyRA`, `.fetchSignatureByChatID`, and
`.verifySignature` (all static).

**Consequence:** F7 keeps its full scope. No need to fall back to merely checking transcript integrity.

---

## 2. The SDK taught by the first-party skill is deprecated

```
@0glabs/0g-serving-broker  ->  DEPRECATED
"Package renamed to @0gfoundation/0g-compute-ts-sdk"
```

Both `0g-compute-skills` and `0g-agent-skills` (published by the 0G Foundation) still instruct you
to install the old package. The correct one is **`@0gfoundation/0g-compute-ts-sdk` v0.9.0**, which
also adds `createZGComputeNetworkReadOnlyBroker` — reading the service registry without a wallet,
which suits a prober exactly.

*Worth reporting back to 0G DevRel.*

---

## 3. Main finding: the on-chain `verifiability` field overstates the guarantee

The `verifiability` field returned by `listService()` reads **`TeeML`** for **21 of 23** services.
But only **6** services actually run the model inside the enclave.

**15 services carry an on-chain label higher than the guarantee they provide.**

A developer following the official path — call `broker.inference.listService()`, read
`verifiability`, see `TeeML` — will conclude the model runs inside an enclave. For 15 services that
conclusion is wrong.

### Where the real distinction lives

The information *is* on chain, just in a different field: `TargetSeparated`, inside the metadata blob.

```
TargetSeparated = false                        -> model inside the enclave  -> TeeML
TargetSeparated = true  + TEEVerifier != ""    -> broker inside the enclave -> TeeTLS
TargetSeparated = true  + TEEVerifier == ""    -> no TEE                    -> standard
```

Cross-checked against the HTTP Router's classification: **matches on all 20 comparable services**
(5 TeeML, 13 TeeTLS, 2 standard). No exceptions.

Implemented as `deriveMode()` in `src/sources/onchain.ts`.

> **How to read this fairly:** it is a *field-naming* problem, not providers lying. `verifiability`
> is almost certainly a legacy flag meaning "has a TEE", which the Router later split into finer
> categories. But read literally it overstates — and the official SDK path is the one that reads it
> literally.

---

## 4. Two sources, two different pictures

| Source | Services |
|---|---|
| HTTP Router `/v1/providers` | 42 |
| On-chain `listService()` | 23 |

**3 addresses are registered on chain but never appear in the Router** — invisible to every Router user:

```
0x25f8f01c…  openai/gpt-5.4-mini   (TargetSeparated=false -> genuine TeeML)
0x8bd36fa1…  glm-5.2
0x91992374…  kimi-k3
```

Worth noting: one of the three is a genuine **TeeML** service — the highest guarantee on the
network — and the Router does not list it.

No address appears in the Router while missing from the chain.

---

## 5. The Router answers a browser only from an origin it already knows

Measured 2026-08-25, sending `Origin` by hand against `https://router-api.0g.ai`:

| Origin sent | Result |
|---|---|
| `http://localhost:3000` | 200, `access-control-allow-origin` returned |
| `http://localhost:5173` | 200 |
| `http://localhost:5174` | 403 |
| `http://localhost:8080` | 403 |
| `https://observatory.0g.ai` | 200 |
| `https://0g.ai.evil.test` | 403 — a suffix match would have passed this; it is not fooled |
| `https://foo.vercel.app` | 403 |
| `https://<our own>.vercel.app` | 403 |

So the allowlist is fixed and specific, and a deployed dashboard cannot join it. `/v1/providers`
behaves the same way, which means a browser cannot even read the advertised price table.

A second, independent blocker: the `access-control-allow-headers` the Router returns does **not**
include `X-0G-Provider-Max-Price-Usd-Prompt` / `-Completion`. A browser that attached a price
ceiling would have its request refused by its own CORS preflight, before anything left the machine.
Measuring from a page without a server would therefore mean measuring **with no price ceiling at
all**, on the reader's credit.

### What this forced

A relay at `api/router/chat/completions.ts` — 83 lines, four rules, none of them preferences:

1. **It holds no secret.** No `PRIVATE_KEY`, no server-side `ROUTER_API_KEY`, no fallback key. A
   request with no `Authorization` is rejected before any upstream call, so a keyless request costs
   nothing.
2. **The upstream is a constant**, never read from a body or a header, so the relay cannot be aimed
   at another host.
3. **It attaches the price ceiling itself**, at three times the advertised rate, from a table it
   fetches server-side. A caller cannot widen its own ceiling.
4. **It never gains chain access.** The ledger is write-once and keyed by prober; a second write
   path behind a public endpoint would undo both properties at once.

It logs no header and no body, and scrubs upstream errors before returning them — an upstream error
string can carry a URL with a token in it. It runs no measurement, so it cannot produce a wrong
number; what it can do is see a key in transit.

**One limit worth stating.** The 40 requests/minute rate limit lives in memory, so it is per
instance rather than global. It is abuse-dampening, not an authorization boundary. The vector that
would actually matter — using this as an anonymising relay to arbitrary hosts — is closed by rule 2,
not by the rate limit.

Running the CLI from a clone skips the relay entirely: `run-epoch.ts` calls the Router directly.

---

## 6. ChainScan's verification API is undocumented, and its field names are not Etherscan's

Measured 2026-08-26 while verifying the two mainnet contracts. `chainscan.0g.ai` is a ConfluxScan
derivative, not Blockscout and not Etherscan, so `forge verify-contract` does not reach it and the
Etherscan-compatible parameter names are silently ignored — an ignored name is not rejected, it just
produces `bytecode_length_mismatch`, which reads like a compiler-settings problem and is not one.

The endpoint is `POST https://chainscan.0g.ai/v1/contract/verify`, JSON body. Three companion
endpoints list what it will accept: `/v1/contract/compiler`, `/v1/contract/evm-version`,
`/v1/contract/license`.

| Field | Value that works | The name that silently fails |
|---|---|---|
| `address` | contract address | — |
| `sourceCode` | flattened source | — |
| `compiler` | `v0.8.28+commit.7893614a` | — |
| `name` | the contract to select from the flattened file | `contractName`, `contractname`, `contract` |
| `optimize` | `true` | `optimization`, `optimizationUsed` |
| `optimizeRuns` | `20000` | `runs` |
| `evmVersion` | `cancun` | — |
| `license` | `3` (= MIT, from `/v1/contract/license`) | — |
| `constructorArguments` | hex, no `0x` | — |

Two things cost real time here:

**`evmVersion` tops out at `cancun`.** The list has no `prague`, which is what Foundry 1.5 compiles
with by default. Recompiling at `cancun` produces byte-identical output for these contracts, so this
is only a submission parameter — but a mismatch here is silent too.

**Without a working `name`, the server picks a contract on its own.** A flattened file holds several,
and `MeasurementRegistry.flat.sol` also carries `ProviderRegistry`; when the name is ignored the
server compiles the wrong one and reports a length mismatch against the right address.
`ProviderRegistry` verified anyway with the name ignored — the file's first non-abstract contract
happened to be the one being verified, which is exactly the sort of accident that makes a wrong
diagnosis look confirmed.

Both contracts now read `exactMatch: true`, with source and ABI public on the explorer.

## 7. A 429 is recorded against the provider, and some of them are ours

Measured 2026-08-27 by re-reading every transcript in `data/epochs/`. Three of the nine runs on
disk carry HTTP 429s, and they are not all the same thing.

| epoch | services | 429s | `x-ratelimit-remaining` at the rejection | when |
|---|---|---|---|---|
| 496514 | 15 | 12 | **0** | 62 s in |
| 496516 | 15 | 15 | 429–494 | first 10 s, all on one service |
| 496591 | 10 | 8 | 462–478 | first 8 s, two services |

`faultSide()` in `src/probes/aggregate.ts` maps `rate_limit` to `'provider'`, so every one of
these is published as that provider's error rate on a write-once ledger. In epoch 496591 —
already on mainnet — that is 5 rejections out of 15 for `0x61C00071…`, an error rate of 3333 bps,
and 3 of 15 for `0xB01EBd79…`.

**The two shapes have different causes, and only one of them is ours.**

*The key's own ceiling.* In 496514 the counter reads exactly 0 at every rejection. The Router
meters per API key at 500 requests a minute, the run started all fifteen services at the same
instant, and it exhausted the key a minute in. That is our call pattern, published against four
operators. `--concurrency` now defaults to 10 for this reason — the width every surviving epoch
was measured at.

*A provider's own limit.* In 496516 and 496591 the counter still had 430–490 of its 500 left, so
the key was nowhere near its ceiling. The rejections land in the first ten seconds, on the
fastest model on the roster — `deepseek-v4-flash-0731` answers in about 850 ms, so a single
sequential worker issues roughly 1.2 requests a second against one address — and on two of that
model's four providers, not all four. Both services then recovered and answered the rest of the
suite. This looks like a per-provider limit meeting a probe pattern no ordinary client produces.

**Nothing is being reclassified.** Moving `rate_limit` off `'provider'` would be defensible for
the first shape and wrong for the second, and it would break F7 outright: `verify-epoch.ts`
recomputes each record from its bundle with the current code, so changing the attribution makes
every epoch already on chain fail to reproduce. The ledger is write-once and the verification
path is the argument the project rests on; neither is worth trading for a cleaner number.

**What this costs a reader.** An error rate on this dashboard is an upper bound on the provider's
own failures. Fifteen probes back to back is not a client workload, and a service that meters its
callers will show up here in a way it would not under ordinary use. That belongs next to the
figure, not in a footnote — and it is the sharpest example so far of the difference between
reporting a measurement and levelling an accusation.

## 8. Anthropic models are on the Router but not on the endpoint the prober speaks

Measured 2026-08-27 in epoch 496616, the first run that probed every healthy service. All seven
Anthropic services refused every one of their fifteen probes with HTTP 400 and the same body:

```
prepare HTTP request: model 'claude-sonnet-5' is not available on the openai API format
(supported: [anthropic]); use the matching endpoint
```

That is 105 calls, 15 of 15 on each of `0xd3f02c1a…` (claude-sonnet-5, claude-opus-5,
claude-opus-4-8) and `0x1F444c8A…` (the same three plus claude-fable-5). The Router lists them,
prices them and reports them healthy; `/v1/chat/completions` is simply not where they are served.

**Nothing was published against them, and that is the machinery working.** `bad_request` maps to
`'prober'` in `faultSide()`, so the failures never reach an error rate, and with zero successful
calls `toMeasurements` drops each service with `only 0 successful calls`. The epoch went on chain
with 30 measurements out of 38 services, and the eight absentees appear on the dashboard under
"Registered, not measured this epoch" rather than as a row of noughts.

**Worth noticing how long this stayed hidden.** Six of the seven sit in `DEFAULT_EXCLUDE` and the
seventh is the only provider of its model, so `groupsOnly` dropped it — the roster has never
included them. Both filters were chosen on cost, and they happened to conceal a reachability fact
about seven of the network's thirty-eight services. A cost lever is not a survey design, and the
first wide run is what turned one into the other.

This is the same class of gap as the three services on the contract that the Router never exposes
(section 4): a part of the network this instrument cannot reach, for reasons of protocol rather
than of quality. Saying which services those are is more honest than a sample that quietly omits
them.

## 9. One service is defeated by our own output ceiling

Also epoch 496616. `0xd9966e13…` serving `zai-org/GLM-5-FP8` answered all fifteen probes with
HTTP 200 and was still dropped from the record.

Fourteen of the fifteen replies came back `truncated`, twelve of them with no usable content at
all — the model spends the whole output allowance before it reaches an answer. It happens at
every ceiling in the suite, including the two 4096-token probes: `arith-mult` truncated, and
`arith-mult-repeat` was the single reply that did not.

Three usable answers is below what `sufficient` requires, so the service was skipped. The
attribution is right — `no_content` is `'prober'`, because the ceiling is ours — but the outcome
is that a healthy, responsive service produces no measurement, and the reason lives in our probe
design rather than in its behaviour.

**It also costs a comparison.** The Router groups this service with the two `glm-5` providers
under one `canonical_id`, so that consistency group should have three members and reached chain
with two.

Raising the ceiling is not free: `max_tokens` drives the projected cost of every probe, and the
suite's token profile was measured at the current values. Left as it is for now, recorded here so
the gap is not mistaken for a provider that failed.

## 10. Design impact

1. **Stop treating the HTTP Router as the primary source.** On-chain carries enough to derive the
   correct mode. The Router becomes a cross-check, and the gap between the two is itself a measurement.
2. **Add a column to F5:** "on-chain label" next to "real mode", making the 15 divergent services visible.
3. **F7 keeps its strong scope** — a complete public verification path exists.
4. **A funded wallet is needed** before any real inference call. Everything here is read-only
   and costs nothing.
5. **Cap the probe width, and read an error rate as an upper bound.** See section 7: the run's
   own concurrency has put rejections on providers' records, and a 429 cannot be attributed
   cleanly after the fact.
6. **A wide run is a survey; the default roster is not.** Sections 8 and 9: filters picked for
   cost hid an entire model family that cannot be reached at all, and a probe ceiling of ours
   silences a service that answers everything. State both on the page rather than letting the
   roster imply the network.

---

## Reproduce

```bash
pnpm install
pnpm snapshot             # capture both sources into data/snapshot-YYYY-MM-DD.json
pnpm compare              # reconcile counts and addresses
pnpm diff-verifiability   # per-service label divergence table
pnpm inspect-meta         # raw on-chain metadata + the TargetSeparated correlation
```

None of the above needs `PRIVATE_KEY`.
