import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { aggregate } from '../../probes/aggregate.js';
import { computeDivergence, divergenceLookup, type ServiceKey } from '../../probes/divergence.js';
import { buildPlan, loadSnapshot } from '../../probes/plan.js';
import type { CallResult } from '../../probes/router-client.js';
import { buildBundle, serializeBundle } from '../../storage/bundle.js';
import { recompute, type VerifiableBundle } from '../recompute.js';

/**
 * The two implementations must agree on real data.
 *
 * `src/probes/` produced the numbers; `src/verify/` recomputes them from the rules the
 * bundle publishes, importing none of that code. If they ever disagree, one of two things
 * is true: the published rule does not describe what the code does, or the verifier is
 * wrong. Both are worth failing a build over, and neither side is automatically right.
 */
const DIR = 'data/epochs';
const transcript = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort().at(-1)
  : undefined;

describe('the verifier and the prober agree on a real epoch', { skip: !transcript }, () => {
  const results = readFileSync(`${DIR}/${transcript}`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as CallResult);

  const plan = buildPlan(loadSnapshot('data/snapshot-2026-08-21.json'), {
    priceMultiplier: 3,
    temperature: 0,
    skipUnhealthy: true,
  });
  const seen = new Set(results.map((r) => `${r.providerAddress.toLowerCase()}|${r.model}`));
  const roster = plan.targets.filter((t) => seen.has(`${t.address.toLowerCase()}|${t.modelId}`));

  const bundle = JSON.parse(
    serializeBundle(
      buildBundle({
        epoch: 496514,
        prober: '0xaBaCa14B88Ee1E392985e4dF315ae4e70CC734DB',
        startedAt: results[0].at,
        endedAt: results[results.length - 1].at,
        roster,
        results,
      }),
    ),
  ) as VerifiableBundle;

  const mine = recompute(bundle);
  const theirStats = aggregate(results);
  const services: ServiceKey[] = roster.map((t) => ({
    address: t.address,
    modelId: t.modelId,
    canonicalId: t.canonicalId,
    mode: t.mode,
  }));
  const theirDivergence = divergenceLookup(computeDivergence(results, services));

  it('covers the same services', () => {
    assert.equal(mine.length, roster.length);
  });

  for (const stats of theirStats) {
    const got = mine.find(
      (m) => m.address.toLowerCase() === stats.address.toLowerCase() && m.modelId === stats.modelId,
    );

    it(`agrees on ${stats.address.slice(0, 8)} ${stats.modelId}`, () => {
      assert.ok(got, 'the verifier produced no row for this service');
      assert.equal(got.sufficient, stats.sufficient, 'sufficiency');
      assert.equal(got.calls, stats.calls, 'attributable calls');
      assert.equal(got.errorRateBps, stats.errorRateBps, 'error rate');
      if (stats.sufficient) {
        assert.equal(got.p50Ms, stats.p50Ms, 'p50');
        assert.equal(got.p95Ms, stats.p95Ms, 'p95');
      }
      assert.equal(
        got.divergenceBps,
        theirDivergence(stats.address, stats.modelId),
        'divergence',
      );
    });
  }
});
