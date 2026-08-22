# Network findings

**2026-08-21** · 0G Aristotle mainnet (chain 16661) · inference contract `0x47340d900bdFec2BD393c626E12ea0656F938d84`

What reconciling the two sources of truth about the network turned up, and what it means for the design.
The question driving it: **how far can any of this actually be verified?**

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

## 5. Design impact

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
