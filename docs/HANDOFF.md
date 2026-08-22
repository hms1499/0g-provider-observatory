# Session handoff — continue from here

**Updated:** 2026-08-22

---

## What this is

**0G Provider Observatory** — an independent measurement layer for 0G's inference network.
Submission for **0G Bridge by AKINDO, Wave 3**. Hard deadline **2026-08-30 22:00**.

Design doc (v3, locked): https://claude.ai/code/artifact/d4f6a199-c73f-470d-bc63-e90a22cdd02c
Source file: `docs/provider-observatory.html` — edit the file and republish to the same URL.

## How we work

**Task-based, not day-based.** There is no per-day schedule. Pick anything from *Ready now*,
finish it, move it to *Done*. The only real date is the submission deadline.

Optimise for the shortest path to a valid, defensible submission — not for even progress across
all seven features. Two consequences worth holding onto:

- **The submission gate is T12, not the dashboard.** Wave 3 is invalid without a contract on 0G
  mainnet plus an explorer link showing real activity. The contracts exist and are tested (T7);
  what remains is funding a mainnet wallet and deploying, so epochs can start accumulating while
  everything else is built. On-chain history takes wall-clock time to exist.
- **Nothing in *Ready now* blocks anything else in *Ready now*.** They can be done in any order.

## Positioning — READ BEFORE WRITING ANYTHING

**This is an instrument, NOT an indictment.**

The operators on this network are **0G Foundation, Alibaba Cloud, Tencent, ByteDance, MiniMax, and
OpenRouter** — that is, the hackathon's own hosts and several large corporations. The original
positioning ("88% of the network cannot prove which model ran") was **dropped** because it reads as
an accusation aimed at the host.

Current positioning: *developers pick providers based on metrics the network reports about itself —
nobody has measured them independently, and nothing is retained over time.*

Four principles (section 08 of the design doc): an instrument, not an indictment · explain before
ranking · every number traces to a source · state plainly what we do not know.

In particular, `standard` mode must be shown with its **technical reason** and must not be scored
down — nobody can put Anthropic's closed API inside their own TDX enclave.

## Project language

**All project artefacts are in English** — code, comments, console output, docs, commit messages,
the design doc. Vietnamese is used only in conversation between Huy and Claude.

One deliberate exception: the `diacritics-echo` probe in `src/probes/suite.ts` uses Vietnamese
diacritics on purpose. It is a tokenizer discriminator, not untranslated text, and the file says so.

Not translated: `.claude/skills/**` is a vendored third-party package from the 0G Foundation.

---

## Task board

### Done

| | Task | Where |
|---|---|---|
| T1 | Repo, dual-source reconciliation, `deriveMode()` | `src/sources/`, `src/scripts/` |
| T2 | 15-probe suite | `src/probes/suite.ts` |
| T3 | Provider-pinned Router layer | `src/probes/router-client.ts` |
| T4 | Epoch plan + offline dry run | `src/probes/plan.ts`, `src/scripts/dry-run.ts` |
| T7 | Registry contracts + chain reader | `contracts/`, `src/chain/` |
| T7b | Testnet deploy, seeded and verified live | `deployments/galileo-16602.json` |

### Ready now — nothing blocks these, do them in any order

| | Task | Notes |
|---|---|---|
| T5 | **Divergence engine** (F2) | `CallResult[]` -> divergence per comparator, minus the internal noise floor from the `arith-mult` / `arith-mult-repeat` pair |
| T6 | **Latency aggregation** (F1) | p50 / p95 / error rate per service, never pooled by address |
| T8 | **Verification CLI** (F7) | Buildable against fixtures; needs no live data. Argumentatively load-bearing, do not cut |
| T9 | **Dashboard shell** (F5) | Renders from `data/snapshot-2026-08-21.json` today; swap in real measurements when T5/T6 land |

### Blocked on Huy — these are the only things Claude cannot do

| | Blocker | Unblocks | How |
|---|---|---|---|
| B1 | `ROUTER_API_KEY` | T10 | pc.0g.ai -> connect wallet -> fund 0G -> Dashboard -> API Keys -> `inference` scope -> `sk-…` into `.env`. Start on testnet (faucet https://faucet.0g.ai, 0.1 0G/day) |
| B2 | ~$10–20 of 0G on **mainnet** | T12 | Buy, or ask in 0G's Telegram. Faucet is testnet-only. **This gates the submission — do it first** |

### Blocked on other tasks

| | Task | Waits on |
|---|---|---|
| T10 | Live epoch run against real providers | B1, T5, T6 |
| T11 | Storage wiring (F4): transcript up, rootHash back | T10 for real transcripts — buildable against a fixture before that |
| T12 | **Mainnet deploy + accumulate real epochs** | B2, T10 — contracts are ready |
| T13 | Submission pack: README, 3-min video, X post | T12 for the explorer link |

### Not in scope for Wave 3

Provider selection SDK (F6) if time runs short · full statistical methodology (Wave 4) ·
multiple decentralised probers with staking (Wave 5 — the contracts already key every record
by (epoch, prober), so opening the gate needs no data migration).

**Critical path:** B2 -> T12 -> T13. The contracts are deployed and verified on testnet, so
mainnet funds are now the only thing standing between here and a valid submission.

### Live on Galileo testnet (chain 16602)

```
ProviderRegistry     0xCF9236a145FaE855B6894Eb7951cA9619D6613a8
MeasurementRegistry  0x9bdeC5D5749270cf20DDa5d541770839E083CAc6
prober / owner       0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB
epoch duration       3600s · first epoch written: 496497 · 38 providers registered
```

Explorer: https://chainscan-galileo.0g.ai · full record in `deployments/galileo-16602.json`

Two things worth knowing before deploying again:

- **The RPC's gas estimate is unusable.** It suggests 0.000000015 gwei while the node
  rejects anything under a 2 gwei tip. Pass `--legacy --with-gas-price 6gwei` or the
  broadcast fails after four attempts with `transaction gas price below minimum`.
- **The testnet owner key is disposable and must stay that way.** It was generated inside
  a Claude Code session. The deployer becomes owner of both contracts and controls who may
  write measurements, so the mainnet key has to be generated by Huy and never appear in a
  transcript.

---

## Commands that run today (no private key, zero cost)

```bash
pnpm install
pnpm snapshot             # capture both sources
pnpm compare              # reconcile counts and addresses
pnpm diff-verifiability   # per-service label divergence table
pnpm inspect-meta         # raw on-chain metadata
pnpm cost-model           # cost from the on-chain price table
pnpm dry-run              # DRY RUN a whole epoch: probes, pinning, groups, cost, sample request
pnpm contracts:test       # 26 Solidity tests
pnpm contracts:gas        # gas report

# full chain round trip against a local node
anvil --port 8546 &
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8546 --broadcast
PROVIDER_REGISTRY=0x… MEASUREMENT_REGISTRY=0x… pnpm chain:roundtrip
```

---

## What T1–T4 established

Network findings in detail: `docs/network-findings.md`

1. **TEE risk closed** — the verification chain is public and a third party can run it. F7 keeps its
   strong scope.
2. **Main finding** — the on-chain `verifiability` field reads `TeeML` for 21 of 23 services, but
   only 6 actually run the model inside an enclave. The real distinction is `TargetSeparated`.
   Implemented as `deriveMode()` in `src/sources/onchain.ts`; matches the Router on all 20
   comparable services.
3. **The two sources disagree** — Router 42 services, on-chain 23. Three on-chain addresses are
   invisible to the Router, one of them a genuine TeeML service.
4. **Both SDKs in the first-party skill are deprecated** — switched to the correct packages.
5. **The ledger is write-once and cheap.** `ProviderRegistry` gives every (address, model)
   pair a uint16 id; `MeasurementRegistry` packs each measurement into exactly one storage
   slot and writes a whole epoch in one transaction. No update, no delete, not even for the
   owner. Epochs are derived from time (`epoch = timestamp / EPOCH_DURATION`) so several
   probers land in the same epoch without coordinating, and a verifier can compute the epoch
   number offline. See "Measured gas" below.
6. **The probe suite runs on 15 deterministic probes**, each with its own comparator, because the
   goal is measuring divergence rather than scoring answers. `arith-mult-repeat` is byte-identical
   to `arith-mult` so a provider's internal noise floor can be subtracted first.

Baseline snapshot: `data/snapshot-2026-08-21.json`

### Measured gas — not estimated

`forge test --gas-report` on the real network shape, 38 services:

| | gas | USD on 0G mainnet |
|---|---|---|
| Write one epoch (38 measurements) | 1,094,085 | **$0.0007** |
| Register 38 providers (one-time) | 2,831,955 | $0.0029 |
| Deploy both contracts | ~2,000,000 | ~$0.0014 |

At 4.0 gwei and 0G at $0.17. **Gas is not a constraint** — 100 epochs cost seven cents, so
the earlier $5–10 gas line was three orders of magnitude too conservative. B2 still needs a
funded mainnet wallet, but the real spend is inference, not gas. Write epochs hourly without
worrying about it.

### Three corrections the build forced

- **"temperature 0 for everything" does not hold.** 9 of 38 chatbot services (the whole Claude line
  plus kimi-k3) do not declare `temperature` support. Now negotiated per service, and **the dropped
  parameters are recorded** in the measurement — comparing a service at temperature 0 against one
  running its own default is comparing against a different baseline, and the published number must
  say so.
- **Price ceilings must be plain decimals.** A per-token price is around 1e-8 USD, so `toString()`
  yields `4.14e-7`; a malformed header makes the Router return 400. Fixed with `plainDecimal()` plus
  a regex check before sending.
- **Twice the calls of the first estimate, at lower cost.** `cost-model.ts` counts 19 on-chain
  chatbot services, but the Router exposes **38** — and the prober calls through the Router. Calls
  go 285 -> **570**. The upper bound for one epoch is still only **$0.19** (below the old $0.39)
  because the real probes are shorter than the 250/120-token assumption in `cost-model.ts`: ~696
  input tokens and <=440 output tokens for all 15 probes.

### Known limit, not yet handled

**3 chatbot services exist on the contract but the Router never exposes them** — header pinning
cannot reach them, and one is a genuine **TeeML** service (`openai/gpt-5.4-mini`, Phala dstack).
The dry run prints them with their direct URLs. This must be shown on the dashboard rather than
silently dropped from the sample. Measuring them would mean calling `{providerURL}` directly — which
means funding a sub-account, exactly what the T3 decision set out to avoid. Decide during T9.

### Calibration pairs

Only **1 of 10** multi-provider groups has a TeeML reference: `glm-5.2` (TeeML `0x7DCF…e87D` plus a
TeeTLS peer). The other nine must be compared peer-to-peer. `deepseek-v4-flash` is the largest group
— 4 providers, all TeeTLS.

---

## Technical decisions in force

**Pin providers with Router headers, do NOT fund per-provider sub-accounts.**
Avoids 20 sub-accounts and a 24-hour withdrawal lock.

```
X-0G-Provider-Address: 0x…                      pin to exactly one provider
X-0G-Provider-Max-Price-Usd-Completion: …       safety valve against burning funds
```

**No retries in the measurement path.** Retrying corrupts the latency measurement and hides the
error rate, and the error rate is one of the things being measured.

SDK, contract, and endpoint details: `docs/0g-reference/ai-context-notes.md`

---

## Cost

| | |
|---|---|
| One epoch (15 probes x 38 Router services = 570 calls) | **$0.19** upper bound |
| Inference across the whole build (1 epoch/day until submission) | ~$1.50 |
| Mainnet deploy + 100 epochs of gas (measured) | **$0.08** |
| **Total** | **under $2** |

The five most expensive services (`claude-fable-5`, `gpt-5.6-sol`, `gpt-5.5`, `claude-opus-4-8`,
`claude-opus-5`) account for 46% of the cost of an epoch.

---

## Open questions

- **Overlap with VeriAgent** (Wave 3) — they score the trustworthiness of a user's *agent*; we
  measure the *infrastructure* of the network. This has to be explicit in the one-line description
  and in the demo video.
- **Two things worth reporting to 0G DevRel**: the skill points at deprecated SDKs, and the on-chain
  `verifiability` field overstates the guarantee. Both are genuine contributions and score under
  Traction & Communication.

Full submission requirements: `HACKATHON-RULES.md`
