# Session handoff — continue from here

**Updated:** 2026-08-25 (measuring from the page)

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
| T10 | Live epoch runner, run once against real providers | `src/scripts/run-epoch.ts`, `src/probes/epoch-run.ts` |
| T11 | Storage wiring (F4): evidence bundle up, real merkle root on chain | `src/storage/`, `src/scripts/upload-epoch.ts` |
| T8 | Verification CLI (F7): independent recomputation, verified live | `src/verify/`, `src/scripts/verify-epoch.ts` |
| T9 | Public dashboard (F5), reading chain + storage live in the browser | `dashboard/` |
| T10b | Budget cap is now a real cap: reserve before the call, settle on what was billed | `src/probes/epoch-run.ts` |
| T10c | Per-probe token profile measured over 353 real calls, regenerable | `src/probes/suite.ts`, `src/scripts/token-profile.ts` |
| T14 | Divergence is withheld when its noise floor was never measured | `src/probes/divergence.ts`, `src/chain/encoding.ts` |
| T15 | Roster fitted to the budget before sending, so no run is cut mid-suite | `src/probes/epoch-run.ts` |
| T12 | **Mainnet deploy, 38 providers registered, first epoch written and verified** | `deployments/aristotle-16661.json` |
| T16 | Series roster pinned so epochs stay comparable | `data/series-roster.json`, `src/probes/roster-lock.ts` |
| T17 | A dev can measure the network themselves and compare, without asking permission | `src/verify/reproduce.ts`, `src/scripts/reproduce.ts`, `README.md` |
| T18 | Reproducibility is a panel on the dashboard, not a page of pnpm commands | `dashboard/Reproduce.tsx`, `dashboard/reproduceEpochs.ts` |
| T19 | A reader measures a group from the page, with their own key, through a relay that holds nothing | `api/router/chat/completions.ts`, `src/relay/`, `dashboard/Measure.tsx`, `dashboard/measureGroup.ts` |

### Ready now

**Accumulate epochs.** One command, roughly $0.055 each:

    pnpm epoch --confirm --write-chain

One epoch per clock hour, and the ledger takes one record per (epoch, prober) — a second
run in the same hour reverts. Start with at least 20 minutes left in the hour or the run
crosses the boundary and refuses to write, which is the safe direction but wastes the calls.

**Then T13**: 3-minute video and X post. `README.md` now exists — T17 wrote the spine of it
and T19 put the Measure panel at the top of it. It still needs the submission framing and the
video link. The video has one more thing to show than it did: a reader measuring the network
from the page.

**Deploy so `/api/router` exists.** The Measure panel 404s under `pnpm dashboard:preview`,
which serves the built page with no functions. It needs a real Vercel deployment or
`npx vercel dev`. Not yet verified in a browser against mainnet — see T19.

### T19 — measuring from the page, through a relay that holds nothing

T18 established that a browser cannot talk to the Router directly: the Router serves CORS
only to a fixed allowlist a deployed dashboard cannot join, and its
`access-control-allow-headers` omits the `X-0G-Provider-Max-Price-Usd-*` pair, so a browser
sending a price ceiling has the request blocked before it leaves the machine. `/v1/providers`
is 403 from a foreign origin for the same reason — verified 2026-08-25 — so a page cannot even
learn what a call should cost.

A relay at `/api/router` gets past both. **Its four rules, all of them load-bearing:**

1. **It holds no secret.** No `PRIVATE_KEY`, no server-side `ROUTER_API_KEY`, no fallback key.
   A request with no `Authorization` header is rejected 401 before any upstream call, so a
   keyless request costs us nothing.
2. **The upstream is hardcoded** to `https://router-api.0g.ai/v1/chat/completions`, never read
   from a body or a header. One endpoint is reachable through this relay and nothing else.
3. **It attaches the price ceiling itself**, at three times the advertised rate — the same
   multiplier as `run-epoch.ts` — from a price table it fetches server-side. A caller cannot
   widen its own ceiling.
4. **It logs no header and no body**, and scrubs upstream errors before returning them,
   because an upstream error string can carry a URL with a token in it.

**It must never gain chain access.** The ledger is write-once and keyed by (epoch, prober); a
relay that could write would put a second, unaudited path to the same records behind an
endpoint anyone on the internet can call. It reads no RPC and holds no key, and that is a
property to preserve, not an accident of the current implementation.

**It is a drop-in for the Router, not a bespoke endpoint.** The path is
`api/router/chat/completions.ts` so `buildPinnedRequest` reaches it as
`${baseUrl}/chat/completions` with the provider pinned in `X-0G-Provider-Address` — exactly
the shape the real Router serves. `router-client.ts` needs no special case to know which one
it is talking to, and that is what makes the browser path and the CLI path the same code.

**What the panel refuses to do.** A bundle written before schema /3 does not record the
sampling parameters the published run sent. Replaying against one of those would compare a
live run at temperature 0 against a run whose actual conditions were never written down, and
report it as one experiment rather than two. It refuses instead — the same call as dropping
GLM-5-FP8 from an epoch on two usable samples.

**Rate limiting is keyed on `x-real-ip`**, which Vercel's edge sets and a caller cannot
override, falling back to the *last* `x-forwarded-for` entry — the first entries are
caller-supplied, so keying on the first would let a caller mint a fresh bucket per request.
40 requests per minute per caller. Fixed during the build; it was spoofable and unbounded.

**Two filenames collided.** The plan named the panel `Measure.tsx` next to the existing
`measure.ts`; tsc refuses both in one program on a case-insensitive filesystem. The logic
module is `measureGroup.ts`, matching `Verify.tsx`/`verifyEpoch.ts` and
`Reproduce.tsx`/`reproduceEpochs.ts`.

**Not yet verified in a browser.** `pnpm typecheck`, `pnpm test` (284 pass) and
`pnpm dashboard:build` are green, and the browser-safety guard now bundles the probe modules
through `dashboard/main.tsx` for real. What has not happened is a live run under
`npx vercel dev` against mainnet with a real key — the cheapest group, `qwen3-vl-30b`, is
about $0.003. Until that runs, the panel is built and untested end to end.

### T18 — the Router's CORS allowlist, measured

T17 shipped reproducibility as a CLI and put the commands on the dashboard. That was the
wrong vehicle: a feature that needs a clone, a package manager and `--exclude=` is an
operations note, not something a reader can use.

The obvious fix was to let the page measure with the reader's own key. **Measured, and it
does not work.** The Router serves CORS properly but only to a fixed allowlist:

    http://localhost:3000        200, ACAO returned
    http://localhost:5173        200, ACAO returned
    http://localhost:5174        403
    http://localhost:8080        403
    https://observatory.0g.ai    200
    https://0g.ai.evil.test      403      (suffix match is correct, not fooled)
    https://foo.vercel.app       403
    https://<ours>.vercel.app    403

A deployed dashboard cannot be in that list, and we do not control it. Worse, the
`access-control-allow-headers` the Router returns does not include
`X-0G-Provider-Max-Price-Usd-Prompt`/`-Completion`, so a browser carrying the price ceiling
has its request blocked before it is sent. Measuring from a page means measuring with no
price guard, on the reader's credit. Not shipped, deliberately.

**What shipped instead** is a Reproducibility panel that compares two already-published
epochs from their evidence, in the page. No key, no wallet, no install, no cost, and it
answers the same question — does this instrument give the same answer twice. 496539 vs
496540 renders live: 10 services compared, 0 modes changed, one error-rate disagreement
(glm-5.2 at `0xF203A388…`, 0.00% against 13.33%), p95 ratios spanning 0.18x to 1.47x.

The pnpm commands moved back to the README, where a reader who has already cloned the repo
will find them.

### T17 — reproducing a published epoch, and what it decided not to do

A dev can now take their own measurement and compare it against a published one:

    pnpm epoch --confirm --no-lock --budget-usd=0.80 --exclude=   # 23 services, $0.7836
    pnpm reproduce <their-bundle>.json 496539

**No contract change and no allowlist.** Opening `writeEpoch` to other probers was the
obvious reading of "give devs control", and it was rejected: a dev's own run is worth more
as an independent check than as a second series on the same ledger, and `setAuthorized`
would have put a permission gate in front of exactly the thing the project claims needs no
permission. `MeasurementRegistry` is untouched.

**Latency is reported as a ratio and never scored.** Two runs an hour apart see different
load; nothing in the evidence says which one caught a bad minute. What is stable enough to
compare is the conclusion — observed mode, whether divergence was measurable, whether the
service diverges at all, and error rate past a 1000 bps tolerance (a shade over one failed
call in fifteen).

**Both bundles go through `recompute()`.** `src/verify/reproduce.ts` imports nothing from
`src/probes/`, so neither run is read through the code that produced it. Neither side is
treated as correct.

Checked against 496539 vs 496540 — two real mainnet runs of the same roster, an hour apart.
All 10 services line up, no observed mode changed, and one disagreement surfaces: glm-5.2 at
`0xF203A388…` read 0% error in one run and 13.33% in the other. p95 ratios span 0.18x to
1.47x, which is why they are reported rather than judged.

**Two flags cost an hour to discover.** `DEFAULT_EXCLUDE` drops the four `standard`-mode
groups, so reaching all 23 services needs `--exclude=` as well as a raised budget. And
through `pnpm`, `--budget-usd 0.80` is swallowed before the script sees it — only
`--budget-usd=0.80` works. Both are now in the README as written.

### How many epochs the project needs: 14

Derived from three constraints, not guessed. The binding one is the noise floor.

| Constraint | Needs | Why |
|---|---|---|
| **Noise floor granularity** | **>= 12 epochs** | One duplicate probe pair per epoch, so the floor can only take (epochs + 1) values. One probe differing out of twelve is 833 bps; the floor has to be finer than that step or the subtraction jumps a whole probe. At 12 epochs it is 833 bps. At 1 epoch it is 0 or 10000 — unusable. |
| **p95 meaningfulness** | >= 7 epochs | At n=15 the p95 has rank 15, so it *is* the slowest call. 7 epochs puts 5 samples above it, 14 puts 10. |
| **"How did it behave last week"** | spread over days | One of the three questions the product answers. Also what a judge sees in the explorer: a steady series across days reads differently from a burst of test transactions. |

**14 epochs.** Twelve is the floor. What that costs depends entirely on the roster — see
Cost below; it is between $1 and $40 and the roster choice is the whole difference.

**The 12-epoch noise-floor argument does not currently pay off.** It assumes epochs are
pooled so the floor becomes a real rate. `computeDivergence()` accepts pooled input, but
`run-epoch.ts` passes only the current run's results, so every published record still carries
a floor of 0 or 10000 from its single duplicate pair. Running 14 epochs separately does not
fix this on its own, and the ledger is write-once. Either add pooling to the write path
before mainnet, or accept that the floor stays coarse and say so.

### Blocked on Huy — these are the only things Claude cannot do

| | Blocker | Unblocks | How |
|---|---|---|---|
| B1 | `ROUTER_API_KEY` (**mainnet**) | T10 | pc.0g.ai -> connect wallet -> fund ~$5 of 0G -> Dashboard -> API Keys -> `inference` scope -> `sk-…` into `.env`. See "Why the API key must be mainnet" below |
| B2 | ~$10–20 of 0G on **mainnet** | T12 | Buy, or ask in 0G's Telegram. Faucet is testnet-only. **This gates the submission** |
| B3 | Top up Router credit — **~$2-3 is now enough**, not $10 | T10 | See "Cost" below. ~$0.09 left, under one epoch |

### Blocked on other tasks

| | Task | Waits on |
|---|---|---|
| T13 | Submission pack: README, 3-min video, X post | nothing — T12 is done, the explorer link exists |

### Not in scope for Wave 3

Provider selection SDK (F6) if time runs short · full statistical methodology (Wave 4) ·
multiple decentralised probers with staking (Wave 5 — the contracts already key every record
by (epoch, prober), so opening the gate needs no data migration).

**Critical path:** B2 -> T12 -> T13. The contracts are deployed and verified on testnet, so
mainnet funds are now the only thing standing between here and a valid submission.

### Live on 0G Aristotle mainnet (chain 16661)

    ProviderRegistry     0x25165feDACd1B78e103c3B49FcAF7CAeB118b9D6
    MeasurementRegistry  0xF2fC195A72Ed74e09530b31C568c1e0CBF6c0333
    owner / prober       0x691Bb0Cc823A03f7dcaF272Dc62896668f81D2FD
    epoch 3600s · 38 providers registered · gas wallet ~1.67 0G

Deployed and registered 2026-08-24. Two earlier keys are retired and recorded in the
deployment file: one was generated inside a Claude Code session (testnet only), and one had
its private key printed into a session transcript — rotated and drained before it owned
anything. The owner is immutable and the ledger is write-once, so reusing either would have
no way back.

**Epoch 496539, the first real record.** 10 services, 150 calls, $0.0725.

    https://chainscan.0g.ai/tx/0xf3f1de65f0b25652ea0e88cde51d2cc3ee879e574609863b12b97fcb53ca83b2

`pnpm verify 496539` reports VERIFIED — bundle fetched through the public gateway with no
wallet and no SDK, merkle root recomputed from the received bytes, all 10 measurements
reproduced by code importing nothing from `src/probes/`. The mainnet storage path had never
been exercised before this.

**The noise floor now lands.** All 10 services returned both halves of the byte-identical
pair, none truncated, against 6 of 13 missing a half before. glm-5.2 spent 1727 and 1789
completion tokens on those probes — which is why a 512 ceiling was cutting it off, and why
raising the ceiling was the fix rather than adding more repeats. One service's pair
disagreed, so its floor is 100% and its divergence is withheld: working as designed.

**Roster is pinned** to those 10 services in `data/series-roster.json`. Re-measuring the
token profile made glm-5 affordable and fitting silently went to 13 services; the noise
floor pools across epochs and needs the same set each time, so the series states its roster
rather than inheriting whatever fits.

**Two things that cost money and are worth not repeating.** `pnpm epoch --confirm` spends
the full epoch and does not publish — publishing the result needs `pnpm upload-epoch
<transcript>`, not a re-run, and a re-run was what the message used to imply. And the runner
had no check that its deployment file matched the chain it was writing to; `assertDeploymentChain`
now refuses before a single call is paid for.

### Cost — remeasured 2026-08-24, and the earlier figures were wrong

The old $0.6962/epoch came from a token profile measured against one provider. Measured over
353 real calls, a full 38-service epoch projects at **$3.12**, not $0.70. `pnpm dry-run`
prints it.

The reason is that **`max_tokens` does not bound what gets billed.** Reasoning models bill
their thinking as completion tokens: 45 of 176 billed calls exceeded the limit they were
sent, `arith-mod` by 10x (512 declared, 5223 billed).

**Roster choice is worth far more than epoch count.** With the roster now fitted to the
budget before anything is sent, the default $0.13 cap buys:

    10 services · 150 calls · $0.1199 projected
    glm-5.2 (TeeML reference), qwen3-vl-30b, deepseek-v4-flash, qwen3.7-plus

14 epochs of that is about **$1.70**. Compare the two shapes rather than the service counts:

| | Before | Now |
|---|---|---|
| Services | 15 | 10 |
| Calls planned / sent | 225 / 172 | 150 / 150 |
| Full suite per service | no, cut around probe 8 | yes |
| Noise floor measurable | 9 of 29 | expected for nearly all |
| Spend | $0.139 actual | $0.120 projected |

Fewer services, measured properly, for less money.

**`reasoning_effort` is not the lever it looked like.** Tried live against glm-5 on
`arith-mod` (expected 407): no parameter gave 3263 completion tokens and the right answer;
`low` gave 7724 and the right answer; `minimal` gave 2 tokens and **the wrong answer, 243**.
Both values are accepted, so this is not a compatibility problem — `minimal` turns thinking
off, and a starved model's wrong answer is indistinguishable from provider divergence. The
flag exists (`--reasoning-effort`), is recorded in the bundle, and is **off by default**.

### The divergence work, and what it cost us to be honest

Three defects found by measuring rather than reasoning, all fixed.

**1. The suite was being cut off by position, not by chance.** Counting calls actually sent,
both epochs have the same shape: probe 1 landed 15/15, probe 5 landed 15/15, probe 14 landed
8/15, probe 15 landed 8/15. The runner walks `PROBES` in order for every service and all the
workers advance together, so a budget abort stops them at the same index.

That is a crooked measurement, not a smaller one. `policy-boundary` was measured on 8 of 15
services. And the two halves of the byte-identical noise pair sit at positions 5 and 14, so
the half that got cut was always the second — which is what left 20 of 29 services with no
measurable noise floor.

Nearly drew the opposite conclusion from this: the plan was to repeat `arith-mult` twice more
for extra samples. That would have added calls at the tail of the suite, had them cut too,
and cost 45% more for nothing. `fitToBudget()` fixes it instead, for free.

**2. Divergence was published with no floor behind it.** glm-5 published 2000 bps — 20%
against a named operator — with `noiseSamples = 0`. We had no evidence whether that model
agrees with itself. It now writes `DIVERGENCE_UNMEASURED` (65535), which the `uint16` field
has room for, so no contract change. Writing 0 was the alternative, and 0 is a claim: it says
the provider matched its peers.

**3. The provider that honoured `max_tokens` was the one being dropped.** At a 512 ceiling,
glm-5.2 was truncated on 8 of 8 noise-pair calls while glm-5 ran to 3213 tokens unchecked.
glm-5.2 is the only TeeML reference in the roster. Ceiling raised to 4096 for the pair;
measured extra cost $0.0165 an epoch.

**What this costs.** The divergence column on the dashboard will be sparse, and honestly so —
a dash means unmeasured, not zero, and `Caveats` says that. Whether it fills in depends on
whether the noise pair now lands, which is the first thing to check after the first mainnet
epoch.

**Still open:** the noise floor is 0 or 10000 from a single pair per epoch even when it does
land. Pooling epochs would fix the granularity but breaks verifiability — the bundle is
per-epoch, so a verifier holding one bundle could not recompute a pooled figure. Extra
samples have to come from inside the epoch. Not solved; not blocking a submission.

### Funding

Topped up to **2.5 0G** on 2026-08-23 and the credit works: two live epochs ran and were
billed against it.

| | |
|---|---|
| Epoch 496515 (181 calls) | $0.1310 |
| Epoch 496516 (172 calls) | $0.1388 |
| Live `reasoning_effort` test, 3 calls to glm-5 | ~$0.037 |
| **Left** | **~$0.09** |

At the lean roster's $0.073/epoch that is roughly one more epoch. **B3 does not need $10** —
$2-3 of credit covers all 14 epochs on the lean roster with room to spare. Do not skimp on
B2 instead: mainnet gas and the deploy are the actual submission gate.

The earlier open question about the deposit address is left below because it was never
actually answered — the top-up worked, but nothing confirmed *why*.

Huy found a deposit address on pc.0g.ai,
`0x495C63D097582Fb4e31fDc06970EEebDe9F69227`, with no network stated. Read on chain
2026-08-22:

| Network | Balance | Nonce | Ledger account |
|---|---|---|---|
| 0G mainnet | 0 | **0** | none |
| 0G testnet | 0 | **0** | none |
| Ethereum | 0 | **0** | — |

Not a contract (`code = 0x`) and never used anywhere. Yet the key is funded, since calls
are being billed — so **that address is not the account paying for the key**.

The likely explanation is that 0G Compute has two parallel payment paths and we are on the
hosted one:

| | Router (`sk-…` key) — what we use | SDK direct |
|---|---|---|
| Billing | Hosted account at pc.0g.ai | On-chain Ledger contract |
| Readable via | Dashboard only | `getLedger(address)` |

`getLedger()` reverting with LedgerNotExists is therefore expected, not a problem, and
`0x495C…` is plausibly a sweep address that credits the hosted account rather than holding
a balance.

**Unverified, because the pc.0g.ai UI is not visible from here.** So: send **1 0G on 0G
mainnet (chain 16661)** first, confirm the dashboard balance moves, and only then send the
rest. An 0x address is EVM-format and identifies no chain — the same string is valid on
Ethereum — and 0G is the native token of 0G mainnet, so the network chosen at send time is
what matters.

Two things to read off the dashboard next session: whether the deposit page names a
network, and the current credit balance. The prober key holds only `inference` scope, so
`/v1/account/balance`, `/v1/account/usage/stats` and `/v1/account/usage/history` all return
403 — a second key with account-read scope would let T10 preflight the balance instead of
discovering it is empty halfway through an epoch.

### What the first live epoch found

Epoch **496515** on Galileo, 12 measurements, written 2026-08-23 03:00:50Z.
Transcript: `data/epochs/496514-2026-08-23T025915129Z.jsonl`.

    https://chainscan-galileo.0g.ai/tx/0xb39c4f367795c393caa915806f2710d7074b94f3ef8bf9bae67b3296556d3f25

Deliberately reduced: 15 services across the 6 cheapest multi-provider groups, 225 calls
planned, **181 sent, 153 successful, $0.131 spent**. The four Claude/kimi groups were
excluded — none of them holds a TeeML reference, so they exercise no code path the cheaper
groups do not. The chain round trip reads back exactly what was written.

**The pin held on all 153 successful calls, zero mismatches.** That was the single riskiest
assumption and it is now measured rather than hoped for.

Four defects surfaced. Two are fixed; two are open and listed in *Ready now*.

**1. Our own ceiling was being published as their error rate. FIXED.**
15 replies came back HTTP 200 with `content: null`, the chain of thought in a `reasoning`
field, and `finish_reason: "length"` — reasoning models that spent the entire output budget
thinking and never reached an answer. The client read only `message.content`, got null, and
classified them `malformed`, which `aggregate.ts` attributes to the provider. The result was
an **86.7% error rate published against `zai-org/GLM-5-FP8`** that the provider had no part
in. This is precisely the failure the project's own rule forbids — *our faults are not their
errors* — and the ledger is write-once, so it is on testnet permanently.

`readChoice()` now separates the two cases: no content plus `finish_reason: length` is
`no_content`, attributed to the prober; no content after a normal stop stays `malformed` and
stays theirs. `reasoning` is deliberately never read as the answer — it is a scratchpad, and
comparing one model's thinking against another's conclusion would be nonsense. Replaying the
real transcript through the fix: GLM-5-FP8 goes 86.7% -> 0.0%, and its usable sample count
drops 15 -> 2, which puts it under the 5-sample floor so it is now dropped from the epoch
instead of published. That is the correct outcome — no number is better than a wrong one.

**2. The budget cap is not a cap. FIXED (T10b).**
Spent $0.131 against a $0.120 ceiling. `canAfford()` tests an average per-call estimate, and
all 15 workers pass that test before any of them records what it spent. Under concurrency it
is a warning, not a limit.

`Budget` now reserves before the call and settles on what the Router actually billed. A hold
comes out of the cap before the request goes out, a failed call releases it, and an overspend
is booked before it throws so the ledger stays consistent. `canAfford()`/`record()` are gone —
an API that lets you test and then spend is the bug.

**3. Cost per call is 2.15x the projection. FIXED (T10c).**
Projected $0.000336/call, actual $0.000724. `SUITE_MEASURED_TOKENS` (1753 in / 1740 out) was
measured against a single provider; this roster produced **9,848 in / 41,155 out over 181
calls**. Reasoning models are the whole difference. Related: **53 of 181 replies truncated
(29%)**, against the "only three probes still truncate" claim recorded earlier — that claim
was also measured on one provider.

Replaced with a **per-probe** profile measured over 353 calls: one number cannot describe both
`word-count-7` (33 output tokens) and `arith-mod` (2726). Reservations are priced per probe
instead of at a suite average, which under-reserved exactly the calls that overspend.
`pnpm token-profile <transcript...>` regenerates the table — it immediately caught a
percentile convention in the first hand-built version that did not match the nearest-rank rule
the project publishes under.

The deeper finding: **`SUITE_MAX_OUTPUT_TOKENS` was never an upper bound on cost.** The
measured profile (8191 output tokens/service) is 2.4x the sum of the declared `max_tokens`
(3424), because thinking is billed as completion regardless of the limit sent.

**4. An epoch label that did not match its own measurements. FIXED.**
The run started at 02:59:15 and wrote at 03:00:50, crossing the hour. The transcript was
named for epoch 496514, where nearly every call actually happened; the contract stamped the
write `currentEpoch()` = **496515**. `storageRoot` still binds the record to its evidence so
nothing is unverifiable, but the epoch label is wrong and cannot be corrected.
`assertEpoch()` now refuses the write when the chain has moved on, and the runner warns
before starting if under 20 minutes remain in the epoch. Blocking is the safe direction: a
refused write can be re-run, a mislabelled one is permanent.

**Also measured, not a defect:** 12 rate-limit rejections came from the *providers*, not the
Router — `rate_limit_error` with a `request_id`, concentrated in two operators. The Router's
500/min is not the binding constraint; individual providers are.

**What divergence actually produced:** one non-zero figure, the `qwen3-vl-30b` pair at
**9.1%**. `glm-5.2`, the only group with a TeeML reference, compared just **2 probes** — rate
limits and truncation consumed the rest — so the most important group in the design barely
reported. Fixing defect 3 should recover most of those probes.

### What T11 put in place, and what it proved

`storageRoot` now carries a real 0G Storage merkle root. The placeholder keccak hash is
gone from the write path.

**What gets uploaded is a bundle, not the bare transcript.** The on-chain record is seven
integers per service; everything needed to recheck them travels with the evidence:

| | |
|---|---|
| `probes[]` | all 15, with prompt, comparator, maxTokens, expected answer |
| `roster[]` | address, model, canonical id, mode, on-chain mode, **droppedParams** |
| `aggregation` | minSamples, the exact percentile rule, the basis-point rule, which probes carry divergence, the noise pair |
| `results[]` | every raw CallResult, in the order they happened |

Shipping only the raw results would leave a verifier reading this repository to find the
comparators and the percentile rule — which is trusting the measurer, the one thing the
project exists to avoid. `droppedParams` rides in the roster because a service running at
its own default temperature is not on the same baseline as one pinned to 0.

Serialization is deterministic (keys sorted at every depth, array order untouched because
the transcript is chronological). The same epoch built twice produces the same bytes and
therefore the same root, so a verifier who rebuilds the bundle can tell an honest rebuild
from a tampered one.

**Proven on testnet 2026-08-23** with the 181-call transcript from the first live epoch:

```
root     0x53b8400b909e119d0dd5118572931579ebece6cfda73091a0088761a494dbaa2
gateway  https://indexer-storage-testnet-turbo.0g.ai/file?root=0x53b8400b…
tx       0xb231d0d661d588a67b24368e9d73161cb39e554dd0aa09edf3f42b2a9bf575a9
```

Fetched back with plain `curl`, no SDK and no wallet: **HTTP 200, 98,954 bytes, sha256
identical to the local file.** That is the whole F7 argument, executed rather than asserted.

**Storage cost is not a constraint either.** The fee for a 99 KB bundle was
12,785,196,304,192 wei — 0.0000128 0G, about $0.000002. Fourteen epochs of evidence cost
less than a thousandth of a cent.

Two rules the wiring enforces:

- **The root is computed locally before the upload and checked against what the indexer
  reports.** Accepting whatever value came back over the network, without having derived it
  ourselves, would defeat the purpose of the root.
- **Upload failure refuses the chain write.** A record pointing at evidence nobody can fetch
  is what T11 exists to eliminate, and the ledger is write-once. The transcript and bundle
  stay on disk, so an upload can be retried with `pnpm upload-epoch` — though the epoch will
  have drifted by then, so that path re-publishes evidence rather than rescuing a record.

`--verify-download` does the round trip before the chain write: fetch by root through the
public gateway, re-hash, compare. The root that goes on chain is one already proven
fetchable.

**Mainnet needs a different indexer** — `https://indexer-storage-turbo.0g.ai`. `config.ts`
picks it from `CHAIN_ID`, so T12 needs no code change, but the mainnet path is unexercised
until then.

### What T8 established, and the bug it found before it was written

`pnpm verify <epoch>` reads the chain, fetches the evidence the record points at,
recomputes every published number, and reports every difference. Exit code is 0 only when
all of them reproduce.

**Verified live on epoch 496516**, 11 measurements, all reproduced exactly:

```
ok  fetched through the public gateway     96 KB, no wallet, no SDK
ok  merkle root of the received bytes matches the record
ok  schema og-observatory-epoch/2          172 calls, 15 services
ok  the evidence claims the same epoch and prober
VERIFIED  all 11 published measurements recomputed exactly.
```

**`src/verify/` imports nothing from `src/probes/`.** That is the whole point: a verifier
that called `aggregate()` would re-run the code that produced the numbers, so it would
agree with them even if the formula were wrong. It would check for tampering and nothing
else. The rules come from the bundle; if the bundle does not state something, the verifier
cannot compute it and says so rather than assuming a default.

`src/verify/test/agreement.test.ts` asserts the two implementations produce identical
figures for every service in a real epoch. A disagreement fails the build, and neither side
is treated as automatically right.

**Three things this work found, all fixed:**

- **`extractNumber` was still taking the FIRST number.** HANDOFF and commit `1f334f2`
  both claim it was changed to take the last, but `git show 1f334f2 -- src/probes/divergence.ts`
  is empty — that commit never touched the file, and `git log -L` shows the function
  unchanged since T5. Running it: `"Compute (7^13) mod 1000. The answer is 407."` returned
  **7**. Measured across the 38 numeric answers with a known correct value, the last number
  matches 32 times against 30 for the first. Recomputing epoch 496515's divergence under
  both rules gave **identical published figures**, so nothing already on chain was wrong —
  it was a latent defect, and the roster is getting more reasoning models, not fewer.
  *The docs describing a fix that was never applied is exactly the drift F7 exists to catch.*

- **Schema /1 was not actually verifiable.** It stated `minSamples` and the percentile
  formula but not the fault-attribution table, the numeric extraction rule, the refusal
  regex or the truncation rule — so an error rate could not be recomputed from it without
  reading this repository. Schema **/2** states all of them, and `faultAttribution` is
  derived from `faultSide()` rather than restated, so the bundle cannot claim an
  attribution the code does not apply. `ERROR_KINDS` is now a runtime list with the type
  derived from it, so a kind cannot exist in one and not the other.

- **The indexer reports a missing file as HTTP 200.** Body:
  `{"code":101,"message":"File not found","data":null}`. `res.ok` was therefore not enough,
  and a verifier would have handed 51 bytes of JSON error to the recomputation and
  concluded the evidence had been tampered with, when it was simply never there.

**Fetching by root is not enough on its own.** A gateway answering to a root proves only
that it answered; the verifier recomputes the merkle root over the bytes it actually
received and compares. That is what binds the evidence to the record.

**Running it on epoch 496515 fails, correctly.** That epoch predates T11, so its
`storageRoot` is a keccak hash rather than a storage root and fetches nothing. The CLI
reports exactly that. An epoch written before the evidence path existed is not verifiable,
and saying so is the honest output.

**TEE signature verification is deliberately out of scope.** Checking an enclave signature
means calling `{providerURL}` per response — the prober's job at measurement time, not the
verifier's. T8 answers one question: can the published numbers be derived from the evidence.

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

### Two more Router behaviours, measured

- **The pin is confirmed by `x-provider`, not `x-0g-provider-address`.** The client was
  reading a header that does not exist, so `servedBy` was always null and the pin was never
  actually verified — a mis-pinned epoch would have attributed every measurement to the
  wrong service while looking perfectly healthy. Fixed and confirmed live; the smoke test
  now exits non-zero if the echoed address ever differs from the pinned one.
- **Rate limit is 500 requests per minute**, reset on the minute boundary, published on
  every response. An epoch is 570 calls but takes ~25 minutes sequentially, averaging 23
  requests a minute — under 5% of the limit. More API keys would buy nothing: keys are
  credentials, not budget, and the limit is not the constraint.

  For T10, parallelise **across** providers and stay sequential **within** each one.
  Concurrent calls to the same provider inflate the latency we are measuring — we would be
  recording our own queueing as their performance. 38 concurrent calls, one per provider,
  cuts an epoch to well under a minute and stays far inside the limit on a single key.

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
  go 285 -> **570**. (The **$0.19** figure this line used to carry was wrong — it predated any
  live token profile. Measured: **$0.6962** per epoch, ceiling **$1.1778**. See Cost.)
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
| One epoch (15 probes x 38 Router services = 570 calls) | **$0.6962** measured · $1.1778 ceiling |
| Inference across the whole build (1 epoch/day until submission) | ~$5.60 |
| Mainnet deploy + 100 epochs of gas (measured) | **$0.08** |
| **Total** | **under $6** |

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
