# 0G Provider Observatory

An independent measurement layer for 0G's inference network.

Developers pick providers based on metrics the network reports about itself. Nobody has
measured them independently, and nothing is retained over time. This is an instrument that
measures them from the outside, writes what it found to a write-once ledger on 0G mainnet,
and puts the raw transcript on 0G Storage so anyone can recheck the numbers — or take their
own measurement and compare.

It reports divergence. It does not attribute motive.

## Live on 0G Aristotle mainnet (chain 16661)

```
ProviderRegistry     0x25165feDACd1B78e103c3B49FcAF7CAeB118b9D6
MeasurementRegistry  0xF2fC195A72Ed74e09530b31C568c1e0CBF6c0333
epoch duration       3600s · 38 provider/model pairs registered
```

First record: [epoch 496539](https://chainscan.0g.ai/tx/0xf3f1de65f0b25652ea0e88cde51d2cc3ee879e574609863b12b97fcb53ca83b2)
— 10 services, 150 calls.

## Check a published epoch — no wallet, no API key, no cost

```bash
pnpm install
pnpm verify 496539
```

Reads the chain record, fetches the evidence its `storageRoot` points at through a public
gateway, recomputes the merkle root over the bytes it received, and rederives every
published number from the rules the bundle itself states.

`src/verify/` imports nothing from `src/probes/`. A verifier that called the measurement
code would agree with it even if the formula were wrong — it would catch tampering and
nothing else.

## Measure it yourself, and compare

`pnpm verify` asks whether the published numbers follow from the published evidence. A
different question is whether the *method* holds up: run the same instrument yourself and
see if you reach the same conclusions.

**Start with the dashboard's Measure panel.** Pick a consistency group, see the call count
and what it will cost before you spend anything, paste a Router key with `inference` scope,
and watch it run. The probes it sends come out of the published epoch's evidence bundle, not
out of this repository, so you are replaying what the published numbers were derived from.
No clone, no package manager, no flags. The key stays in the page — not in localStorage, not
in a URL — and the calls are billed to you.

The one thing it asks of you is the relay. Your key passes through `/api/router`, a function
that forwards exactly one chat completion upstream and attaches the
`X-0G-Provider-Max-Price-Usd-*` ceiling, at three times the advertised rate. It holds no key
of its own, reads no chain, and runs no measurement, so it cannot produce a wrong number —
what it can do is see your key in transit, which is why it logs no header and no body
(`api/router/chat/completions.ts`, 83 lines, worth reading before you paste anything). It
exists because the Router answers a browser only from an `Origin` on its own allowlist, which
a deployed dashboard cannot join, and because the price-ceiling headers are absent from its
`access-control-allow-headers` — so measuring from a page without a relay would mean measuring
with no ceiling at all.

If you have already cloned the repo, the CLI measures the whole roster instead of one group:

```bash
# 0. see what it would cost, offline and free — no --confirm means nothing is sent
pnpm epoch --no-lock --budget-usd=0.80 --exclude=

# 1. your own run — needs your own ROUTER_API_KEY, writes nothing to the chain
pnpm epoch --confirm --no-lock --budget-usd=0.80 --exclude=

# 2. compare it against a published epoch
pnpm reproduce data/epochs/<your-bundle>.json 496539
```

That measures all 10 multi-provider groups — **23 services, 345 calls, $0.7836 projected**
on your own key. Two flags are doing work: `--no-lock` ignores the pinned series roster, and
`--exclude=` clears the default exclusion of the four `standard`-mode groups, which are left
out of the published series because they cost ten times the rest and hold no TeeML reference
to calibrate against. Pass the flags in `--flag=value` form; through `pnpm` the space-separated
form is swallowed before the script sees it.

To measure only the pinned series instead — 10 services, **$0.055** — drop both flags. Either
works: the comparison runs on whatever the two runs have in common and names the rest.

**What gets compared, and what does not.** Both bundles go through the same independent
recomputation, so neither side is read through the code that produced it. Two runs at two
times see different load, so latency is reported as a ratio and never scored. What is stable
enough to compare is the conclusion:

| Compared | Why |
|---|---|
| observed mode | a provider's guarantee mode does not change by the hour. **Only in the CLI** — see below |
| divergence measurability | one run could measure a noise floor and the other could not |
| divergence verdict | does this service disagree with its peers at all — not by how much |
| error rate | flagged only past 1000 bps, a shade over one failed call in fifteen |
| p50 / p95 | **reported as a ratio, never as a fault** |

Neither run is treated as correct. Where they disagree, the tool names the disagreement.

**Mode is not a live check in the Measure panel.** It is not measured by any probe anywhere:
it is derived from the service registry on chain — whether a TEE verifier is declared, and
whether the target is separated — and read once when a run builds its roster. Two published
epochs each derive it for themselves, so the CLI comparing two bundles can genuinely catch an
operator changing what they declare. The panel replays the roster recorded in the published
bundle, so its mode is that epoch's by construction and can never differ. The panel is
comparing measurements; the current mode of every provider is on the Providers tab, read live
from chain.

## Everything that costs nothing

```bash
pnpm dry-run           # plan a whole epoch offline: roster, groups, cost, sample request
pnpm test              # TypeScript suite
pnpm contracts:test    # Solidity suite
pnpm compare           # reconcile the Router against the on-chain registry
```

None of these need `PRIVATE_KEY` or `ROUTER_API_KEY`.

## What we do not know

The noise floor comes from one byte-identical probe pair per epoch, so within a single
epoch it can only read 0% or 100%. Pooling epochs would make it finer, but the evidence
bundle is per-epoch — a verifier holding one bundle could not recompute a pooled figure,
and that trade is not worth making. Where the floor could not be measured, divergence is
withheld rather than published as zero. A dash means unmeasured, not zero.

`standard` mode is shown with its technical reason and is never scored down. Nobody can
put a closed third-party API inside their own TDX enclave.

## Layout

| | |
|---|---|
| `contracts/` | Foundry. `MeasurementRegistry` is write-once — no update, no delete, no owner override |
| `src/probes/` | the 15-probe suite, provider pinning, roster fitting, divergence |
| `src/storage/` | evidence bundles and 0G Storage upload |
| `src/verify/` | independent recomputation and cross-run comparison. Imports nothing from `src/probes/` |
| `src/relay/` | the relay's rules as pure functions: what it forwards, what it refuses, how it rate-limits |
| `api/router/` | the relay itself — one chat completion forwarded, no secret, no chain, no measurement |
| `dashboard/` | the public read-only view |
| `docs/HANDOFF.md` | task board, findings, and what is still open |
