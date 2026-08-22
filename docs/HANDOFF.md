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
| T6 | Latency aggregation: results -> p50/p95/error rate | `src/probes/aggregate.ts` |
| T5 | Divergence engine, calibrated on the TeeML reference | `src/probes/divergence.ts` |

### Ready now — nothing blocks these, do them in any order

| | Task | Notes |
|---|---|---|
| T8 | **Verification CLI** (F7) | Buildable against fixtures; needs no live data. Argumentatively load-bearing, do not cut |
| T9 | **Dashboard shell** (F5) | Renders from `data/snapshot-2026-08-21.json` today; swap in real measurements when T5/T6 land |

### Blocked on Huy — these are the only things Claude cannot do

| | Blocker | Unblocks | How |
|---|---|---|---|
| B1 | `ROUTER_API_KEY` (**mainnet**) | T10 | pc.0g.ai -> connect wallet -> fund ~$5 of 0G -> Dashboard -> API Keys -> `inference` scope -> `sk-…` into `.env`. See "Why the API key must be mainnet" below |
| B2 | ~$10–20 of 0G on **mainnet** | T12 | Buy, or ask in 0G's Telegram. Faucet is testnet-only. **This gates the submission — do it first** |

### Blocked on other tasks

| | Task | Waits on |
|---|---|---|
| T10 | Live epoch run against real providers | **B1 only** — every piece it needs is built |
| T11 | Storage wiring (F4): transcript up, rootHash back | T10 for real transcripts — buildable against a fixture before that |
| T12 | **Mainnet deploy + accumulate real epochs** | B2, T10 — contracts are ready |
| T13 | Submission pack: README, 3-min video, X post | T12 for the explorer link |

### Not in scope for Wave 3

Provider selection SDK (F6) if time runs short · full statistical methodology (Wave 4) ·
multiple decentralised probers with staking (Wave 5 — the contracts already key every record
by (epoch, prober), so opening the gate needs no data migration).

**Critical path:** B2 -> T12 -> T13. The contracts are deployed and verified on testnet, so
mainnet funds are now the only thing standing between here and a valid submission.

### Why the API key must be mainnet

Measured 2026-08-22, not assumed:

| | Testnet (16602) | Mainnet (16661) |
|---|---|---|
| Chatbot services | **1** (`qwen2.5-omni-7b`) | **38** |
| Other services | 1 image-editing | 4 |
| Operator addresses | 2 | 16 |
| Multi-provider model groups | **0** | 10 |
| Router API | **none exists** | `router-api.0g.ai`, 29 models |

`router-api-testnet.0g.ai`, `testnet-router-api.0g.ai` and `router-testnet.0g.ai` all fail
to resolve. The Router is mainnet-only, and the entire pinning layer is built on it.

With one chatbot service, T5 has nothing to measure — divergence needs at least two
providers of the same model, and testnet has zero such groups. There is no `glm-5.2`
calibration pair. Every finding this project rests on is a mainnet observation.

**Two independent choices, easy to conflate:**

- **Chain** — where the contracts live. Testnet today, mainnet at T12, which Wave 3 requires.
- **Compute** — where inference runs. Mainnet, because testnet has nothing to measure.
  The rules permit testnet Compute, but permission does not help when it is empty.

Inference credit at pc.0g.ai is a separate balance from the 0G in the wallet that pays
contract gas. **~$5 covers 7 epochs**, measured rather than estimated — see Cost below.
The price-ceiling headers guard against a provider raising its rate mid-run.

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
pnpm test                 # TypeScript tests
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

### What the first live calls changed

The smoke test against one real provider cost $0.0007 and invalidated four assumptions.
Every one of them would have corrupted a full epoch silently.

- **The price-ceiling headers are denominated in USD per MILLION tokens**, while
  `pricing_usd` in `/v1/providers` is USD per token. Sending the per-token figure is
  rejected as `pinned_provider_exceeds_max_price` — a message that names the provider, not
  the unit, so it reads as though the provider got more expensive. Measured boundary for a
  service priced at 0.0359/M: 0.03 rejected, 0.0359 accepted. The comparison is inclusive
  and is made against the tier the request falls into, not the worst tier. Not documented
  at docs.0g.ai/ai-context — worth reporting to 0G DevRel.
- **Truncated answers were being scored as divergence.** Cut off mid-working on
  `(7^13) mod 1000`, a reasoning model emitted a bare `7`, which the numeric comparator
  read as a real answer differing from 407. `CallResult.truncated` now carries
  `finish_reason === 'length'` and divergence discards those — except for the policy probe,
  where only the opening words matter.
- **`extractNumber` took the first number, which is the wrong end.** A reasoning model
  opens by restating the problem, so the first number in `(7^13) mod 1000` is 7, and in a
  letter count it is the position index 1. It now takes the last number.
- **The noise floor was firing on our own artifact.** `arith-mult` and `arith-mult-repeat`
  disagreed (13347244 vs 13342724) purely because both were truncated at 24 tokens. With
  headroom both return 13352884 and the floor is correctly zero. `assertSuiteValid` now
  enforces that the pair shares `maxTokens` as well as its prompt — raising one and not the
  other would turn a measurement of the provider's instability into a measurement of ours.

`max_tokens` is a ceiling, not a charge: a model answering in 17 tokens costs 17. So probe
ceilings were raised generously — the suite ceiling went 440 -> 3424 — while measured
consumption is 1740. Only three probes still truncate, and none feed divergence.

### The three rules T6 encodes

`src/probes/aggregate.ts` turns raw results into the numbers a reader ends up trusting,
so it is where the project's principles become arithmetic:

- **Never pool by address.** The unit is (address, model), same as ProviderRegistry.
  Pooling by address is the exact defect this project points at — four differently-sized
  models reported at an identical 9408 ms because the figure was aggregated at the address.
- **Our faults are not their errors.** A 401 from an expired key or a 402 from an empty
  balance is a *prober* failure. Counting it against a provider's error rate would publish
  an accusation caused by our own billing. `auth` / `payment` / `bad_request` are excluded
  from both the rate and the attempt count; `upstream` / `timeout` / `rate_limit` /
  `malformed` / `not_found` count against the provider; `network` is genuinely ambiguous
  and is reported as unattributed rather than guessed either way.
- **Too few samples means no number.** Below 5 successful calls the service is marked
  insufficient and left out of the epoch entirely — which is exactly why
  MeasurementRegistry stores no zero-filled placeholder.

Every formula is integer-only and stated exactly, because F7 has to recompute the same
values from the raw transcript in possibly another language and get identical bits.
Percentiles use nearest rank, `rank = ceil(k*n/100)`, no interpolation.

**Honest consequence worth repeating on the dashboard:** at n=15, p95 has rank 15, so a
single epoch's p95 *is* its slowest call and carries almost no tail information. It only
becomes meaningful once epochs are pooled — which `aggregate()` supports, since pooling
many epochs is the same call as aggregating one.

### What T5 measures, and what it refuses to say

`src/probes/divergence.ts` answers one question: do two providers claiming the same model
behave the same way? The answer is always a distance, never a verdict — a provider that
differs may be running a different model, quantisation, sampler or system prompt, and this
code cannot tell which.

- **A reference when one exists, a symmetric distance when it does not.** Where a group
  holds a TeeML service, that service is the standard and the others are measured against
  it. Only `glm-5.2` qualifies, out of ten multi-provider groups. Everywhere else the
  figure is symmetric: both peers carry the same number, because with no ground truth
  neither side can be called the wrong one. Three or more peers fall back to the modal
  answer, and a tie among peers drops the probe rather than picking a side.
- **Self-instability is subtracted first.** `arith-mult` and `arith-mult-repeat` are
  byte-identical prompts, so disagreement between them is the provider's own noise. That
  floor is subtracted from raw divergence, and the subtraction can only ever lower a
  provider's number. In a single epoch the floor is 0 or 10000 with nothing in between —
  10000 zeroes the whole figure, which is the safe direction to err: a service that cannot
  agree with itself should not be reported as differing from its peers. Pooling epochs
  turns it into a real rate.
- **12 of 15 probes carry the figure.** The two freeform probes are not compared — doing
  so would make F7 reimplement "exactly seven words" in another language, and word
  counting is ambiguous enough that two implementations would disagree. `arith-mult-repeat`
  is held out so its twin is not weighted twice. Both stay in the transcript for a human.
- **A failed call is not a wrong answer.** Errors belong to T6's error rate and are
  invisible here. A probe a provider never answered is skipped, never scored as differing.

The normalisation rules, the refusal regex and the arithmetic are all part of the
verification contract, because F7 recomputes these values from the raw transcript.

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
