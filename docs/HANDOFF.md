# Session handoff — continue from here

**Updated:** 2026-08-22 · end of day 2 of 9

---

## What this is

**0G Provider Observatory** — an independent measurement layer for 0G's inference network.
Submission for **0G Bridge by AKINDO, Wave 3**. Deadline **2026-08-30 22:00** (8 days left).

Design doc (v3, locked): https://claude.ai/code/artifact/d4f6a199-c73f-470d-bc63-e90a22cdd02c
Source file: `docs/provider-observatory.html` — edit the file and republish to the same URL.

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

## Day 1 — done

Details: `docs/day-1-findings.md`

1. **TEE risk closed** — the verification chain is public and a third party can run it. F7 keeps its
   strong scope.
2. **Main finding** — the on-chain `verifiability` field reads `TeeML` for 21 of 23 services, but
   only 6 actually run the model inside an enclave. The real distinction is `TargetSeparated`.
   Implemented as `deriveMode()` in `src/sources/onchain.ts`; matches the Router on all 20
   comparable services.
3. **The two sources disagree** — Router 42 services, on-chain 23. Three on-chain addresses are
   invisible to the Router, one of them a genuine TeeML service.
4. **Both SDKs in the first-party skill are deprecated** — switched to the correct packages.

Baseline snapshot: `data/snapshot-2026-08-21.json`

## Commands that run today (no private key, zero cost)

```bash
pnpm install
pnpm snapshot             # capture both sources
pnpm compare              # reconcile counts and addresses
pnpm diff-verifiability   # per-service label divergence table
pnpm inspect-meta         # raw on-chain metadata
pnpm cost-model           # cost from the on-chain price table
pnpm dry-run              # DRY RUN a whole epoch: probes, pinning, groups, cost, sample request
```

---

## Day 2 — done

Runs today at zero cost: `pnpm dry-run`

1. **15-probe suite** — `src/probes/suite.ts`. Six categories: format, arithmetic, tokenizer,
   instruction following, context, and refusal boundary. Each probe carries its own `comparator`
   (exact / numeric / json / categorical / freeform) because the goal is measuring divergence, not
   scoring answers.
   `arith-mult-repeat` is byte-identical to `arith-mult` so the **internal noise floor** of a single
   provider can be measured — that noise must be subtracted before attributing divergence between
   two providers to anything else.
2. **Provider-pinned Router layer** — `src/probes/router-client.ts`. `buildPinnedRequest()` is pure
   (usable by the dry run, never touches the key) and separate from `callPinned()` which sends.
   **No retries** — retrying corrupts the latency measurement and hides the error rate, and the
   error rate is one of the things being measured.
3. **Epoch plan** — `src/probes/plan.ts`. Groups multi-provider models, attaches the TeeML
   reference, computes price ceilings and a cost estimate.

### Three corrections to the original plan

- **"temperature 0 for everything" does not hold.** 9 of 38 chatbot services (the whole Claude line
  plus kimi-k3) do not declare `temperature` support. Now negotiated per service, and **the dropped
  parameters are recorded** in the measurement — comparing a service at temperature 0 against one
  running its own default is comparing against a different baseline, and the published number must
  say so.
- **Price ceilings must be plain decimals.** A per-token price is around 1e-8 USD, so `toString()`
  yields `4.14e-7`; a malformed header makes the Router return 400. Fixed with `plainDecimal()` plus
  a regex check before sending.
- **Twice the calls of the day-1 estimate, at lower cost.** `cost-model.ts` counts 19 on-chain
  chatbot services, but the Router exposes **38** — and the prober calls through the Router. Calls
  go 285 -> **570**. The upper bound for one epoch is still only **$0.19** (below the old $0.39)
  because the real probes are shorter than the 250/120-token assumption in `cost-model.ts`: ~696
  input tokens and <=440 output tokens for all 15 probes. 1 epoch/day for 8 days is about **$1.50**.

### Known limit, not yet handled

**3 chatbot services exist on the contract but the Router never exposes them** — header pinning
cannot reach them, and one is a genuine **TeeML** service (`openai/gpt-5.4-mini`, Phala dstack).
The dry run prints them with their direct URLs. This must be shown on the dashboard rather than
silently dropped from the sample. Measuring them would mean calling `{providerURL}` directly — which
means funding a sub-account, exactly what decision F1 set out to avoid. Decide on day 6 during the
full-network sweep.

### Calibration pairs

Only **1 of 10** multi-provider groups has a TeeML reference: `glm-5.2` (TeeML `0x7DCF…e87D` plus a
TeeTLS peer). The other nine must be compared peer-to-peer. `deepseek-v4-flash` is the largest group
— 4 providers, all TeeTLS.

---

## NEXT — day 3

### Blocked on the user (only Huy can do this)

Go to **pc.0g.ai** -> connect wallet -> fund a little 0G -> Dashboard -> API Keys -> create a key
with the `inference` scope (`sk-…`) -> put it in `.env`. This is the one thing Claude cannot do.

Start on **testnet** (faucet https://faucet.0g.ai, 0.1 0G/day). Move to mainnet on day 6.

### Can start immediately, no waiting

- Divergence engine: take `CallResult[]` -> divergence per comparator, minus the internal noise floor
- Aggregate measurements into p50/p95 per service, never pooled by address
- `ProviderRegistry` + `MeasurementRegistry` contracts (F3), tested on testnet

### Technical decision from day 2, still in force

**Pin providers with Router headers, do NOT fund per-provider sub-accounts.**
Avoids 20 sub-accounts and a 24-hour withdrawal lock.

```
X-0G-Provider-Address: 0x…                      pin to exactly one provider
X-0G-Provider-Max-Price-Usd-Completion: …       safety valve against burning funds
```

SDK, contract, and endpoint details: `docs/0g-reference/ai-context-notes.md`

---

## Cost

| | |
|---|---|
| One epoch (15 probes x 38 Router services = 570 calls) | **$0.19** upper bound |
| ~~Day-1 estimate based on 19 on-chain services~~ | ~~$0.39~~ — see `pnpm dry-run` |
| Inference for the whole program (1 epoch/day for 8 days) | ~$1.50 |
| Mainnet deploy gas | $5–10 |
| **Total** | **$10–15** |

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

## Remaining schedule

| Day | Work |
|---|---|
| ~~2~~ | ~~Probe suite + pinning layer + dry run~~ done |
| 3 | Divergence engine + p50/p95, calibrate on the `glm-5.2` TeeML/TeeTLS pair, real run once the key exists |
| 3–4 | Registry + Measurement contracts, testnet tests |
| 5 | Wire up 0G Storage, transcripts up and rootHash back |
| 6–7 | Dashboard, full-network sweep, group by the 20 operator addresses |
| 8 | Verification CLI, mainnet deploy, run several real epochs |
| 9 | README, 3-minute video, X post (`#0GBridge #BuildOn0G`, tag `@0G_labs @0G_Builders @AKINDO_io`), submit |

**No code on day 9.** Full submission requirements: `HACKATHON-RULES.md`
