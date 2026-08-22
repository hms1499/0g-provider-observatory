# 0G Provider Observatory

Independent measurement layer for 0G's inference network. Wave 3 submission for
0G Bridge by AKINDO. Read `docs/HANDOFF.md` first — it carries the current state,
the positioning constraints, and what is blocked.

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
