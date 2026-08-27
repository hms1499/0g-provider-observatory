import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord, ProviderRecord } from '../../chain/registry.js';
import { toHistories } from '../pickProvider.js';

const provider = (id: number, address: string, model: string): ProviderRecord => ({
  id,
  address,
  model,
  modelHash: '0x0',
  declaredMode: 'TeeTLS',
  registeredAt: new Date(0),
});

const measurement = (providerId: number, p50Ms: number): EpochRecord['measurements'][number] => ({
  providerId,
  p50Ms,
  p95Ms: p50Ms * 2,
  errorRateBps: 0,
  divergenceBps: 0,
  calls: 15,
  observedMode: 'TeeTLS',
});

const epoch = (n: number, measurements: ReturnType<typeof measurement>[]): EpochRecord => ({
  epoch: n,
  prober: '0xP',
  writtenAt: new Date(n * 3_600_000),
  storageRoot: '0xroot',
  measurements,
});

describe('toHistories', () => {
  it('gathers one service across every epoch that measured it', () => {
    const providers = [provider(1, '0xA', 'glm-5.2')];
    const h = toHistories([epoch(1, [measurement(1, 2000)]), epoch(2, [measurement(1, 2500)])], providers);
    assert.equal(h.length, 1);
    assert.deepEqual(h[0].samples.map((s) => s.p50Ms), [2000, 2500]);
  });

  it('keeps an operator’s two models apart', () => {
    // 0xF203A388 serves both glm-5.2 and qwen3.7-plus on mainnet. Keying on address alone
    // pools two different services into one set of figures — the exact defect this project
    // exists to point at, and one already shipped once here by accident in the cost estimate.
    const providers = [provider(1, '0xA', 'glm-5.2'), provider(2, '0xA', 'qwen3.7-plus')];
    const h = toHistories([epoch(1, [measurement(1, 2000), measurement(2, 9000)])], providers);
    assert.equal(h.length, 2);
    assert.deepEqual(
      h.map((x) => [x.model, x.samples[0].p50Ms]).sort(),
      [['glm-5.2', 2000], ['qwen3.7-plus', 9000]],
    );
  });

  it('matches an address whatever case each source recorded it in', () => {
    const providers = [provider(1, '0xAbC', 'm')];
    const h = toHistories([epoch(1, [measurement(1, 2000)]), epoch(2, [measurement(1, 2100)])], providers);
    assert.equal(h.length, 1, 'one service, not two');
  });

  it('ignores a measurement whose provider id is not registered', () => {
    const h = toHistories([epoch(1, [measurement(99, 2000)])], [provider(1, '0xA', 'm')]);
    assert.deepEqual(h, []);
  });

  it('ignores a provider whose model could not be recovered', () => {
    const nameless = { ...provider(1, '0xA', 'm'), model: null } as unknown as ProviderRecord;
    assert.deepEqual(toHistories([epoch(1, [measurement(1, 2000)])], [nameless]), []);
  });
});
