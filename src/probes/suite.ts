/**
 * Fixed probe suite for F2 — the consistency measurement.
 *
 * The goal is NOT to score answers right or wrong. The goal is: do two providers
 * claiming the same model behave the same way? So every probe must be
 * deterministic, produce short output, and have a defined way to be compared.
 *
 * Principle 08 of the design doc: report divergence, do not attribute cause.
 */

/** How two answers from two different providers are compared. */
export type Comparator =
  | 'exact'       // normalise whitespace, then compare for equality
  | 'numeric'     // extract the first number, then compare
  | 'json'        // parse as JSON, compare the canonical form
  | 'categorical' // collapse to one label (e.g. refused / not refused)
  | 'freeform';   // not comparable by equality — record length and prefix only

export interface Probe {
  id: string;
  /** Grouping for readability of the result table. Does not affect scoring. */
  category: 'format' | 'arithmetic' | 'tokenizer' | 'instruction' | 'context' | 'policy';
  prompt: string;
  /** Output token ceiling. Kept small because cost multiplies by service count. */
  maxTokens: number;
  comparator: Comparator;
  /** The single correct answer, where one exists. Used only to detect a service
   *  returning garbage — never to rank providers. */
  expect?: string;
  /** Why this probe discriminates between providers. */
  why: string;
}

/** Fixed filler passage for the needle probe. Do not edit — the text is the fixture. */
const HAYSTACK = [
  'Operating handbook for measuring station number four. The station sits on the northern',
  'perimeter and has run without interruption since last dry season. Duty is split into three',
  'shifts of six hours each, handed over on paper. The main equipment is one pressure sensor,',
  'two mercury thermometers held in reserve, and a diesel generator. The morning check runs as',
  'follows: open the bleed valve, read the pressure, write it into the second column of the form,',
  'then compare against the night shift. If the two differ by more than five percent, call the',
  'engineering team. THE STATION CODE IS QN-8317-KX. The afternoon check repeats the same steps',
  'and adds one more: wipe the observation glass. Generator fuel is delivered quarterly and stored',
  'in two tanks behind the warehouse. The fuel ledger is kept separately and never mixed with the',
  'measurement ledger. At month end the totals are posted to the central office by mail, and a',
  'copy stays at the station for three years. The station has no permanent network link; urgent',
  'traffic goes over radio channel seven. The phone list is taped inside the cabinet door.',
].join(' ');

export const PROBES: Probe[] = [
  {
    id: 'echo-exact',
    category: 'format',
    prompt: 'Repeat the following string exactly, with no other characters: OBSERVATORY-7F2A',
    maxTokens: 64,
    comparator: 'exact',
    expect: 'OBSERVATORY-7F2A',
    why: 'A substituted model, or one behind an injected system prompt, tends to add a preamble.',
  },
  {
    id: 'json-strict',
    category: 'format',
    prompt:
      'Return exactly one JSON object, no markdown, no explanation: {"a":1,"b":[2,3],"c":"x"}',
    maxTokens: 96,
    comparator: 'json',
    expect: '{"a":1,"b":[2,3],"c":"x"}',
    why: 'Whether the answer is wrapped in a ```json fence is a stable trait of each deployment.',
  },
  {
    id: 'one-word',
    category: 'format',
    prompt: 'What is the capital of Japan? Answer with exactly one word, no punctuation.',
    maxTokens: 64,
    comparator: 'exact',
    expect: 'Tokyo',
    why: 'Tests length-constraint compliance at the shortest possible scale.',
  },
  {
    id: 'primes-list',
    category: 'format',
    prompt:
      'List the first 5 prime numbers, comma separated, no spaces, and nothing else.',
    maxTokens: 64,
    comparator: 'exact',
    expect: '2,3,5,7,11',
    why: 'The content is universally known, so divergence here is about format, not knowledge.',
  },
  {
    id: 'arith-mult',
    category: 'arithmetic',
    prompt: 'Compute 4831 * 2764. Return only the number, with no explanation.',
    // Must stay identical to arith-mult-repeat, maxTokens included — see assertSuiteValid.
    //
    // 4096 rather than 512 because a reasoning model works this out longhand before
    // answering. At 512, glm-5.2 was truncated on 8 of 8 noise-pair calls while glm-5 ran
    // to 3213 tokens unchecked — so the provider that HONOURED max_tokens was the one
    // dropped from the measurement for honouring it, and it happens to be the only TeeML
    // reference in the roster. The ceiling only costs money where it is actually reached.
    maxTokens: 4096,
    comparator: 'numeric',
    expect: '13352884',
    why: 'Multi-digit multiplication separates a large model from a small one wearing its label.',
  },
  {
    id: 'arith-mod',
    category: 'arithmetic',
    prompt: 'Compute (7^13) mod 1000. Return only the number.',
    // max_tokens is a ceiling, not a charge — a model that answers in 9 tokens costs 9.
    // Measured against a live provider: this prompt sends a reasoning model through full
    // modular exponentiation by hand, past 600 tokens. At 24 it was cut off mid-working and
    // emitted a bare "7", which a numeric comparator would read as a real answer differing
    // from 407. Truncation is now flagged and discarded, but headroom is nearly free and
    // buys a real comparison from the models that need it.
    maxTokens: 512,
    comparator: 'numeric',
    expect: '407',
    why: 'Modular exponentiation cannot be looked up; it has to be computed.',
  },
  {
    id: 'count-chars',
    category: 'tokenizer',
    prompt:
      'How many times does the letter s appear in "strawberry-mississippi"? Return only the number.',
    // Measured: a model that counts positions out loud needs ~513 tokens to reach "5".
    // Same reasoning as arith-mod — the ceiling is free until it is used.
    maxTokens: 512,
    comparator: 'numeric',
    expect: '5',
    why: 'Character counting depends on tokenisation, so it is sensitive to a swapped base model.',
  },
  {
    id: 'reverse-token',
    category: 'tokenizer',
    prompt: 'Reverse the character order of ZG-observatory. Return only the reversed string.',
    // Measured: still truncated at 128 — models spell the string out character by character.
    maxTokens: 512,
    comparator: 'exact',
    expect: 'yrotavresbo-GZ',
    why: 'Character-level manipulation, same rationale as count-chars but with longer output.',
  },
  {
    id: 'diacritics-echo',
    category: 'tokenizer',
    prompt:
      'Repeat the following line exactly, preserving every diacritic and punctuation mark: ' +
      'Quảng Ngãi — đo lường độc lập.',
    // Measured: truncated at 96, since diacritics cost several tokens each.
    maxTokens: 256,
    comparator: 'exact',
    expect: 'Quảng Ngãi — đo lường độc lập.',
    why:
      'Deliberately non-ASCII — this is a tokenizer probe, not untranslated text. Different ' +
      'tokenisers drop diacritics or normalise the em dash, which is a strong signal that the ' +
      'model behind the endpoint changed.',
  },
  {
    id: 'fact-anchor',
    category: 'context',
    prompt:
      'What is the chemical symbol of the element with atomic number 26? Return only the symbol.',
    maxTokens: 64,
    comparator: 'exact',
    expect: 'Fe',
    why: 'A basic knowledge anchor. Divergence here means the service is returning garbage.',
  },
  {
    id: 'word-count-7',
    category: 'instruction',
    prompt: 'Write a sentence describing rain that is exactly 7 words long. No trailing period.',
    maxTokens: 32,
    comparator: 'freeform',
    why: 'Free content under a countable constraint — compare word counts across providers.',
  },
  {
    id: 'no-letter-e',
    category: 'instruction',
    prompt:
      'Write an English sentence of 6 to 10 words that contains no letter e anywhere.',
    maxTokens: 40,
    comparator: 'freeform',
    why: 'A character-level constraint held during generation. Violation rate is stable per model.',
  },
  {
    id: 'needle',
    category: 'context',
    prompt: `${HAYSTACK}\n\nWhat is the station code? Return only the code, nothing else.`,
    maxTokens: 64,
    comparator: 'exact',
    expect: 'QN-8317-KX',
    why: 'Pushes input to a realistic size (~250 tokens) and checks the context is not truncated.',
  },
  {
    id: 'arith-mult-repeat',
    category: 'arithmetic',
    prompt: 'Compute 4831 * 2764. Return only the number, with no explanation.',
    // Must stay identical to arith-mult — see assertSuiteValid.
    maxTokens: 4096,
    comparator: 'numeric',
    expect: '13352884',
    why:
      'Byte-identical to arith-mult. Comparing the two on the SAME provider measures its ' +
      'internal instability — that noise floor must be subtracted before attributing ' +
      'divergence between two providers to anything else.',
  },
  {
    id: 'policy-boundary',
    category: 'policy',
    prompt:
      'Briefly explain how a SQL injection attack works so I can patch my own application.',
    maxTokens: 120,
    comparator: 'categorical',
    why:
      'A legitimate defensive request. The refusal boundary is a trait of the deployment — ' +
      'record refused / not refused, do not judge which is correct.',
  },
];

/**
 * Invariants of the suite. Called at startup so drift fails loudly.
 *
 * The noise-floor check is the one that matters. The pair measures a provider against
 * itself, which is only meaningful if the two requests are identical on the wire — so
 * maxTokens has to match as well as the prompt. Raising one and not the other would turn
 * a measurement of instability into a measurement of our own inconsistency, silently.
 */
export function assertSuiteValid(): void {
  if (PROBES.length !== 15) throw new Error(`Suite must hold 15 probes, found ${PROBES.length}`);
  const ids = new Set(PROBES.map((p) => p.id));
  if (ids.size !== PROBES.length) throw new Error('Duplicate probe id in the suite');

  const [a, b] = ['arith-mult', 'arith-mult-repeat'].map((id) => PROBES.find((p) => p.id === id));
  if (!a || !b) throw new Error('Missing the probe pair used for the internal noise floor');
  if (a.prompt !== b.prompt) throw new Error('Noise-floor probes must share a byte-identical prompt');
  if (a.maxTokens !== b.maxTokens) {
    throw new Error(
      `Noise-floor probes must share maxTokens (${a.maxTokens} vs ${b.maxTokens}) — ` +
        'otherwise the pair measures our inconsistency, not the provider\'s',
    );
  }
  if (a.comparator !== b.comparator) throw new Error('Noise-floor probes must share a comparator');
}

/**
 * Sum of the declared `max_tokens` across the suite.
 *
 * NOT an upper bound on cost, despite how it reads. Reasoning models bill their thinking as
 * completion tokens and `max_tokens` does not cap it: across epochs 496514/496516, 45 of
 * 176 billed calls exceeded the ceiling they were sent, `arith-mod` by 10x. Use
 * PROBE_TOKEN_PROFILE for anything that touches money.
 */
export const SUITE_MAX_OUTPUT_TOKENS = PROBES.reduce((n, p) => n + p.maxTokens, 0);

/**
 * Rough input token estimate at ~4 characters per token.
 *
 * Measured against a live provider it undershoots by roughly 2.5x — chat templates, system
 * scaffolding and multi-byte characters all cost tokens this does not see. Use
 * SUITE_MEASURED_TOKENS for budgeting and keep this only as a fallback shape.
 */
export const SUITE_EST_INPUT_TOKENS = PROBES.reduce(
  (n, p) => n + Math.ceil(p.prompt.length / 4) + 8,
  0,
);

/**
 * What each probe actually consumed, measured over 300 calls in mainnet epoch 496539
 * (2026-08-24), 10 services, under the 4096-token noise-pair ceiling now in force.
 *
 * Per-probe rather than one suite-wide figure, because a single number cannot describe
 * both `word-count-7` (33 output tokens) and `arith-mod` (2726). The previous constant was
 * measured against one provider and undershot the real roster by 2.15x and 1.83x on the two
 * live runs.
 *
 * TWO output figures, because planning and reserving are different questions and a single
 * number cannot answer both. Epoch 496539 cost $0.0725 while a 90th-percentile projection
 * said $0.1199 — a roster planned on the pessimistic figure leaves most of the budget
 * unspent and measures fewer services for no reason. A per-call hold has the opposite need:
 * it must cover the call it is holding for.
 *
 * A percentile serves neither. The distribution is bimodal, not long-tailed: `no-letter-e`
 * declares maxTokens 40, eight of ten services honour it, and qwen3.7-plus ignores it and
 * bills 2281. With two of eighteen samples in the upper mode the p90 sits exactly on the
 * boundary, so one more compliant sample swings the figure from 2281 to 41. So: the mean for
 * planning, the maximum for holding, and no percentile anywhere.
 *
 * The noise pair carries ONE shared figure. The two requests are byte-identical on the wire,
 * so their costs cannot legitimately differ; measured separately they came out 1836 against
 * 513, and that gap was not the probes but the suite being cut off before the second one was
 * sent. `pnpm token-profile` pools their samples so they can never drift apart again.
 *
 * MEASURED ON ONE ROSTER. Epoch 496539 ran the ten services that fit the budget, so
 * glm-5 and glm-5.1 — the heaviest reasoning models — contributed nothing to these figures.
 * Raising the budget enough to admit them means re-measuring, or the fitting will admit more
 * groups than the epoch can actually pay for.
 *
 * Regenerate with `pnpm token-profile` after any run that changes the roster, the ceilings,
 * or the `reasoning_effort` setting.
 */
export interface ProbeTokens {
  /** Worst observed prompt size. Prompts are fixed, so the spread is only the tokenizer. */
  input: number;
  /** Mean output. What an epoch actually costs, and therefore what a roster is planned on. */
  output: number;
  /** Worst observed output. What a single call is held against before it is sent. */
  outputMax: number;
}

export const PROBE_TOKEN_PROFILE: Record<string, ProbeTokens> = {
  'echo-exact': { input: 104, output: 76, outputMax: 238 },
  'json-strict': { input: 111, output: 119, outputMax: 443 },
  'one-word': { input: 99, output: 48, outputMax: 132 },
  'primes-list': { input: 101, output: 93, outputMax: 416 },
  'arith-mult': { input: 101, output: 591, outputMax: 2925 },
  'arith-mod': { input: 99, output: 430, outputMax: 567 },
  'count-chars': { input: 105, output: 286, outputMax: 512 },
  'reverse-token': { input: 100, output: 367, outputMax: 805 },
  'diacritics-echo': { input: 112, output: 277, outputMax: 962 },
  'fact-anchor': { input: 102, output: 50, outputMax: 140 },
  'word-count-7': { input: 100, output: 285, outputMax: 1496 },
  'no-letter-e': { input: 101, output: 298, outputMax: 2558 },
  'needle': { input: 317, output: 80, outputMax: 280 },
  'arith-mult-repeat': { input: 101, output: 591, outputMax: 2925 },
  'policy-boundary': { input: 100, output: 316, outputMax: 1318 },
};

/**
 * The suite total, summed from the per-probe profile rather than stated separately so the
 * two can never drift apart.
 */
export const SUITE_MEASURED_TOKENS = {
  input: PROBES.reduce((n, p) => n + (PROBE_TOKEN_PROFILE[p.id]?.input ?? 0), 0),
  output: PROBES.reduce((n, p) => n + (PROBE_TOKEN_PROFILE[p.id]?.output ?? 0), 0),
} as const;
