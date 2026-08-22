import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { CallResult } from '../router-client.js';
import { toMeasurements, aggregate, type ResolveContext } from '../aggregate.js';
import {
  canonicalJson,
  classifyRefusal,
  compareAnswers,
  computeDivergence,
  divergenceLookup,
  extractNumber,
  noiseFloor,
  normalizeText,
  type ServiceKey,
} from '../divergence.js';

const TEEML = '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D'; // the real glm-5.2 TeeML service
const TEETLS = '0xF203A388e9E70F09ece38046a6D40a89cf896309'; // its TeeTLS peer
const PEER_C = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';
const PEER_D = '0xe4d9768112BFE0C4a2f0e33Fb6D0Ad7dC1D0eb1B';

function answer(address: string, probeId: string, text: string): CallResult {
  return {
    probeId,
    providerAddress: address,
    model: 'glm-5.2',
    ok: true,
    status: 200,
    latencyMs: 3000,
    text,
    usage: null,
    chatId: null,
    servedBy: null,
    truncated: false,
    rateLimitRemaining: null,
    droppedParams: [],
    at: '2026-08-22T00:00:00.000Z',
  };
}

const svc = (address: string, mode: string): ServiceKey => ({
  address,
  modelId: 'glm-5.2',
  canonicalId: 'glm-5.2',
  mode,
});

/** A provider that answers every comparable probe correctly and stably. */
function goodRun(address: string): CallResult[] {
  return [
    answer(address, 'echo-exact', 'OBSERVATORY-7F2A'),
    answer(address, 'json-strict', '{"a":1,"b":[2,3],"c":"x"}'),
    answer(address, 'one-word', 'Tokyo'),
    answer(address, 'primes-list', '2,3,5,7,11'),
    answer(address, 'arith-mult', '13352884'),
    answer(address, 'arith-mod', '407'),
    answer(address, 'count-chars', '5'),
    answer(address, 'reverse-token', 'yrotavresbo-GZ'),
    answer(address, 'diacritics-echo', 'Quảng Ngãi — đo lường độc lập.'),
    answer(address, 'fact-anchor', 'Fe'),
    answer(address, 'needle', 'QN-8317-KX'),
    answer(address, 'policy-boundary', 'A SQL injection works by concatenating input.'),
    answer(address, 'arith-mult-repeat', '13352884'),
  ];
}

describe('normalisation', () => {
  it('collapses whitespace but keeps case and punctuation as signal', () => {
    assert.equal(normalizeText('  a   b \n c '), 'a b c');
    assert.notEqual(normalizeText('Tokyo'), normalizeText('tokyo'));
  });

  it('pulls a number out regardless of separators, or reports none', () => {
    assert.equal(extractNumber('13,352,884'), 13352884);
    assert.equal(extractNumber('The answer is 407.'), 407);
    assert.equal(extractNumber('-42'), -42);
    assert.equal(extractNumber('no digits here'), null);
  });

  it('treats key order and a markdown fence as noise, not difference', () => {
    assert.equal(canonicalJson('{"b":2,"a":1}'), canonicalJson('{"a":1,"b":2}'));
    assert.equal(canonicalJson('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(canonicalJson('not json'), null);
  });

  it('detects a refusal without judging whether refusing was right', () => {
    assert.equal(classifyRefusal("I can't help with that."), 'refused');
    assert.equal(classifyRefusal("I'm sorry, but I cannot assist."), 'refused');
    assert.equal(classifyRefusal('As an AI, I must decline.'), 'refused');
    assert.equal(classifyRefusal('SQL injection concatenates untrusted input.'), 'answered');
  });
});

describe('compareAnswers', () => {
  it('ignores formatting differences the comparator is meant to absorb', () => {
    assert.equal(compareAnswers('numeric', '13352884', 'The answer is 13,352,884'), 'match');
    assert.equal(compareAnswers('json', '{"a":1,"b":2}', '```json\n{"b":2,"a":1}\n```'), 'match');
    assert.equal(compareAnswers('exact', ' Tokyo ', 'Tokyo'), 'match');
  });

  it('reports incomparable rather than differ when a key cannot be derived', () => {
    assert.equal(compareAnswers('numeric', 'no number', '407'), 'incomparable');
    assert.equal(compareAnswers('json', 'broken', '{"a":1}'), 'incomparable');
  });

  it('never compares freeform probes', () => {
    assert.equal(compareAnswers('freeform', 'same text', 'same text'), 'incomparable');
  });
});

describe('noise floor', () => {
  it('is zero when the byte-identical pair agrees', () => {
    const probes = new Map([['arith-mult', ['13352884']], ['arith-mult-repeat', ['13352884']]]);
    assert.deepEqual(noiseFloor(probes), { bps: 0, samples: 1 });
  });

  it('is total when a single epoch shows the provider disagreeing with itself', () => {
    const probes = new Map([['arith-mult', ['13352884']], ['arith-mult-repeat', ['13352883']]]);
    assert.deepEqual(noiseFloor(probes), { bps: 10000, samples: 1 });
  });

  it('becomes a real rate once epochs are pooled', () => {
    const probes = new Map([
      ['arith-mult', ['1', '1', '1', '1']],
      ['arith-mult-repeat', ['1', '2', '1', '1']],
    ]);
    assert.deepEqual(noiseFloor(probes), { bps: 2500, samples: 4 });
  });

  it('reports no samples rather than a zero when the pair never landed', () => {
    assert.deepEqual(noiseFloor(undefined), { bps: 0, samples: 0 });
    assert.deepEqual(noiseFloor(new Map([['arith-mult', ['1']]])), { bps: 0, samples: 0 });
  });
});

describe('computeDivergence', () => {
  const pair = [svc(TEEML, 'TeeML'), svc(TEETLS, 'TeeTLS')];

  it('makes the TeeML service the reference and gives it no divergence of its own', () => {
    const rows = computeDivergence([...goodRun(TEEML), ...goodRun(TEETLS)], pair);
    const ref = rows.find((r) => r.address === TEEML)!;
    assert.equal(ref.method, 'reference-self');
    assert.equal(ref.divergenceBps, 0);

    const other = rows.find((r) => r.address === TEETLS)!;
    assert.equal(other.method, 'teeml-reference');
    assert.equal(other.referenceAddress, TEEML);
    assert.equal(other.divergenceBps, 0);
    assert.equal(other.comparedProbes, 12);
  });

  it('counts a differing probe and names it', () => {
    const bad = goodRun(TEETLS).map((r) =>
      r.probeId === 'count-chars' ? { ...r, text: '4' } : r,
    );
    const rows = computeDivergence([...goodRun(TEEML), ...bad], pair);
    const other = rows.find((r) => r.address === TEETLS)!;
    assert.deepEqual(other.differingProbeIds, ['count-chars']);
    assert.equal(other.rawDivergenceBps, 833); // 1 of 12
  });

  it('subtracts self-instability, and can only ever lower the figure', () => {
    // Differs on one probe AND disagrees with itself on the duplicate pair.
    const unstable = goodRun(TEETLS).map((r) => {
      if (r.probeId === 'count-chars') return { ...r, text: '4' };
      if (r.probeId === 'arith-mult-repeat') return { ...r, text: '13352883' };
      return r;
    });
    const rows = computeDivergence([...goodRun(TEEML), ...unstable], pair);
    const other = rows.find((r) => r.address === TEETLS)!;

    assert.equal(other.rawDivergenceBps, 833);
    assert.equal(other.noiseFloorBps, 10000);
    assert.equal(other.noiseSamples, 1);
    assert.equal(other.divergenceBps, 0, 'a provider that cannot agree with itself is not accused');
    assert.ok(other.divergenceBps <= other.rawDivergenceBps);
  });

  it('gives two peers with no reference the same symmetric distance', () => {
    const peers = [svc(TEETLS, 'TeeTLS'), svc(PEER_C, 'TeeTLS')];
    const bad = goodRun(PEER_C).map((r) => (r.probeId === 'fact-anchor' ? { ...r, text: 'Cu' } : r));
    const rows = computeDivergence([...goodRun(TEETLS), ...bad], peers);

    assert.equal(rows[0].method, 'symmetric-pair');
    assert.equal(rows[1].method, 'symmetric-pair');
    assert.equal(
      rows[0].divergenceBps,
      rows[1].divergenceBps,
      'with no ground truth neither side can be called wrong',
    );
    assert.equal(rows[0].referenceAddress, null);
  });

  it('uses the majority answer when three or more peers and no reference', () => {
    const group = [svc(TEETLS, 'TeeTLS'), svc(PEER_C, 'TeeTLS'), svc(PEER_D, 'standard')];
    const odd = goodRun(PEER_D).map((r) => (r.probeId === 'arith-mod' ? { ...r, text: '743' } : r));
    const rows = computeDivergence([...goodRun(TEETLS), ...goodRun(PEER_C), ...odd], group);

    const outlier = rows.find((r) => r.address === PEER_D)!;
    assert.equal(outlier.method, 'majority');
    assert.deepEqual(outlier.differingProbeIds, ['arith-mod']);
    assert.equal(rows.find((r) => r.address === TEETLS)!.divergenceBps, 0);
  });

  it('says nothing about a probe where the peers themselves tie', () => {
    const group = [svc(TEETLS, 'TeeTLS'), svc(PEER_C, 'TeeTLS'), svc(PEER_D, 'standard')];
    const a = goodRun(PEER_C).map((r) => (r.probeId === 'one-word' ? { ...r, text: 'Kyoto' } : r));
    const rows = computeDivergence([...goodRun(TEETLS), ...a, ...goodRun(PEER_D)], group);
    // PEER_D's peers split Tokyo/Kyoto, so that probe is dropped rather than decided.
    const d = rows.find((r) => r.address === PEER_D)!;
    assert.equal(d.comparedProbes, 11); // 12 minus the undecidable one
    assert.deepEqual(d.differingProbeIds, []);
  });

  it('reports a lone provider as ungrouped rather than as consistent', () => {
    const rows = computeDivergence(goodRun(TEEML), [svc(TEEML, 'TeeML')]);
    assert.equal(rows[0].method, 'ungrouped');
    assert.equal(rows[0].comparedProbes, 0);
    assert.equal(rows[0].referenceAddress, null);
  });

  it('excludes freeform probes and the noise pair from the comparison count', () => {
    const rows = computeDivergence([...goodRun(TEEML), ...goodRun(TEETLS)], pair);
    // 15 probes - 2 freeform - the duplicated arithmetic probe = 12
    assert.equal(rows.find((r) => r.address === TEETLS)!.comparedProbes, 12);
  });

  it('skips a probe a provider never answered instead of scoring it as different', () => {
    const partial = goodRun(TEETLS).filter((r) => r.probeId !== 'needle');
    const rows = computeDivergence([...goodRun(TEEML), ...partial], pair);
    const other = rows.find((r) => r.address === TEETLS)!;
    assert.equal(other.comparedProbes, 11);
    assert.equal(other.divergenceBps, 0);
  });

  it('discards a truncated answer rather than counting it as a difference', () => {
    // A reasoning model cut off mid-working on (7^13) mod 1000 emitted a bare "7". The
    // numeric comparator would read that as a real answer differing from 407.
    const cut = goodRun(TEETLS).map((r) =>
      r.probeId === 'arith-mod' ? { ...r, text: '7', truncated: true } : r,
    );
    const rows = computeDivergence([...goodRun(TEEML), ...cut], pair);
    const other = rows.find((r) => r.address === TEETLS)!;
    assert.deepEqual(other.differingProbeIds, [], 'truncation is our artifact, not their difference');
    assert.equal(other.comparedProbes, 11, 'the probe is dropped, not scored');
  });

  it('still reads a truncated policy answer, where only refusal matters', () => {
    const cut = goodRun(TEETLS).map((r) =>
      r.probeId === 'policy-boundary' ? { ...r, truncated: true } : r,
    );
    const rows = computeDivergence([...goodRun(TEEML), ...cut], pair);
    assert.equal(rows.find((r) => r.address === TEETLS)!.comparedProbes, 12);
  });

  it('ignores failed calls entirely — an error is not a wrong answer', () => {
    const withFailure: CallResult[] = [
      ...goodRun(TEETLS),
      { ...answer(TEETLS, 'echo-exact', 'x'), ok: false, text: null, errorKind: 'upstream' },
    ];
    const rows = computeDivergence([...goodRun(TEEML), ...withFailure], pair);
    assert.equal(rows.find((r) => r.address === TEETLS)!.divergenceBps, 0);
  });
});

describe('wiring into the on-chain row', () => {
  it('feeds divergence through the hook toMeasurements already exposed', () => {
    const bad = goodRun(TEETLS).map((r) =>
      r.probeId === 'count-chars' ? { ...r, text: '4' } : r,
    );
    const results = [...goodRun(TEEML), ...bad];
    const divergence = computeDivergence(results, [svc(TEEML, 'TeeML'), svc(TEETLS, 'TeeTLS')]);
    const lookup = divergenceLookup(divergence);

    const ctx: ResolveContext = {
      providerId: (a) => (a === TEEML ? 1 : 2),
      observedMode: (a) => (a === TEEML ? 1 : 2),
      divergenceBps: lookup,
    };

    const { rows } = toMeasurements(aggregate(results, { minSamples: 5 }), ctx);
    const teetls = rows.find((r) => r.providerId === 2)!;
    assert.equal(teetls.divergenceBps, 833);
    assert.equal(rows.find((r) => r.providerId === 1)!.divergenceBps, 0);
  });
});
