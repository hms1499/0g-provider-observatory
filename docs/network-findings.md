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

## 6. Design impact

1. **Stop treating the HTTP Router as the primary source.** On-chain carries enough to derive the
   correct mode. The Router becomes a cross-check, and the gap between the two is itself a measurement.
2. **Add a column to F5:** "on-chain label" next to "real mode", making the 15 divergent services visible.
3. **F7 keeps its strong scope** — a complete public verification path exists.
4. **A funded wallet is needed** before any real inference call. Everything here is read-only
   and costs nothing.

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
