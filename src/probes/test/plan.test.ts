import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { negotiateParams, type SnapshotRouterService } from '../plan.js';

function service(supported: string[]): SnapshotRouterService {
  return {
    address: '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB',
    model_id: 'glm-5',
    canonical_id: 'glm-5',
    service_type: 'chatbot',
    is_healthy: true,
    supported_parameters: supported,
  };
}

describe('negotiateParams', () => {
  it('sends temperature when the service declares support for it', () => {
    const p = negotiateParams(service(['temperature']));
    assert.equal(p.temperature, 0);
    assert.deepEqual(p.dropped, []);
  });

  it('records temperature as dropped when the service does not declare it', () => {
    const p = negotiateParams(service([]));
    assert.equal(p.temperature, undefined);
    assert.deepEqual(p.dropped, ['temperature']);
  });

  describe('reasoning_effort', () => {
    it('sends the configured effort when the service declares support', () => {
      const p = negotiateParams(service(['temperature', 'reasoning_effort']), {
        reasoningEffort: 'low',
      });
      assert.equal(p.reasoning_effort, 'low');
      assert.deepEqual(p.dropped, []);
    });

    it('records it as dropped when the service does not declare support', () => {
      const p = negotiateParams(service(['temperature']), { reasoningEffort: 'low' });
      assert.equal(p.reasoning_effort, undefined);
      assert.deepEqual(p.dropped, ['reasoning_effort']);
    });

    it('is left out entirely when no effort is configured', () => {
      const p = negotiateParams(service(['temperature', 'reasoning_effort']));
      assert.equal(p.reasoning_effort, undefined);
      assert.deepEqual(
        p.dropped,
        [],
        'a parameter we chose not to send is not one the service refused',
      );
    });
  });
});
