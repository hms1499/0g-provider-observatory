# 0G Provider Observatory

Independent measurement layer for 0G's inference network. Wave 3 submission for
0G Bridge by AKINDO. Read `docs/HANDOFF.md` first — it carries the task board,
the positioning constraints, and what is blocked.

## How work is organised

**Task-based, not day-based.** There is no per-day schedule; the only fixed date is
the submission deadline. Pick a task from *Ready now* in `docs/HANDOFF.md`, finish
it, move it to *Done*. Optimise for the shortest path to a valid submission — the
critical path runs mainnet funds -> T7 contracts -> T12 deploy -> T13 submission,
because Wave 3 is invalid without a mainnet contract and an explorer link. Do not
reintroduce a day-by-day plan.

## Language

**Everything in this repository is written in English** — code, comments, console
output, documentation, commit messages, the design doc. Conversation between Huy
and Claude is in Vietnamese; nothing from that conversation lands in a file in
Vietnamese.

One deliberate exception: the `diacritics-echo` probe in `src/probes/suite.ts`
contains Vietnamese diacritics on purpose. It is a tokenizer discriminator, not
untranslated text, and the file says so in its `why` field.

`.claude/skills/**` is a vendored third-party package from the 0G Foundation and
is left as shipped.

## Positioning — read before writing any user-facing text

This is **an instrument, not an indictment**. The subjects being measured are the
0G Foundation, Alibaba Cloud, Tencent, ByteDance, MiniMax and OpenRouter — the
hackathon's own hosts. Report divergence, never attribute motive. `standard` mode
gets shown with its technical reason and is never scored down. Full principles:
section 08 of `docs/provider-observatory.html`.

## Verification

Run the command and read its output before claiming anything works.

```bash
pnpm typecheck
pnpm dry-run     # plans a full epoch offline, zero cost, no API key
```

Everything except a live prober run works without `PRIVATE_KEY` or
`ROUTER_API_KEY` and costs nothing.
