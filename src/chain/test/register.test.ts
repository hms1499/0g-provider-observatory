import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  planRegistrations,
  resolveAll,
  resolveDeclaredMode,
  type RegistrationCandidate,
} from '../register.js';

const A = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';
const B = '0xF203A388e9E70F09ece38046a6D40a89cf896309';

const candidate = (over: Partial<RegistrationCandidate> = {}): RegistrationCandidate => ({
  address: A,
  modelId: 'glm-5',
  routerMode: 'TeeTLS',
  onchainMode: null,
  ...over,
});

describe('resolveDeclaredMode', () => {
  it('prefers what the chain says about a service over what the Router says', () => {
    // The registry field means "what the network claims about itself", and the compute
    // contract is the network claiming it directly rather than through an HTTP service.
    const r = resolveDeclaredMode('TeeTLS', 'TeeML');
    assert.equal(r.mode, 'TeeML');
    assert.equal(r.source, 'onchain');
  });

  it('falls back to the Router when the chain has no entry for the pair', () => {
    // 22 of 38 pairs are in this position: each address registers one model on chain
    // while serving many through the Router.
    const r = resolveDeclaredMode('TeeTLS', null);
    assert.equal(r.mode, 'TeeTLS');
    assert.equal(r.source, 'router');
  });

  it('records that the two sources agreed when they did', () => {
    assert.equal(resolveDeclaredMode('TeeML', 'TeeML').source, 'both');
  });

  it('never resolves to Unknown, which the contract rejects', () => {
    assert.equal(resolveDeclaredMode('standard', null).mode, 'standard');
  });
});

describe('planRegistrations', () => {
  it('skips a pair that is already registered', () => {
    const plan = planRegistrations([candidate(), candidate({ address: B })], (addr) =>
      addr.toLowerCase() === A.toLowerCase() ? 7 : 0,
    );
    assert.deepEqual(plan.skipped.map((s) => s.address), [A]);
    assert.deepEqual(plan.toRegister.map((s) => s.address), [B]);
  });

  it('is a no-op when everything is already registered', () => {
    const plan = planRegistrations([candidate()], () => 3);
    assert.equal(plan.toRegister.length, 0);
  });

  it('treats an id of 0 as not registered, since ids start at 1', () => {
    const plan = planRegistrations([candidate()], () => 0);
    assert.equal(plan.toRegister.length, 1);
  });

  it('refuses to plan the same pair twice in one batch', () => {
    // registerBatch would revert on the duplicate and take the whole transaction with it.
    const plan = planRegistrations([candidate(), candidate()], () => 0);
    assert.equal(plan.toRegister.length, 1);
    assert.equal(plan.duplicates.length, 1);
  });
});

describe('resolveAll', () => {
  it('attaches the decided mode and its source to every candidate', () => {
    const out = resolveAll([
      candidate({ routerMode: 'TeeTLS', onchainMode: 'TeeML' }),
      candidate({ address: B, routerMode: 'standard', onchainMode: null }),
    ]);
    assert.deepEqual(
      out.map((r) => [r.declaredMode, r.modeSource]),
      [['TeeML', 'onchain'], ['standard', 'router']],
    );
  });

  it('leaves the candidate fields untouched, so the source data stays auditable', () => {
    const [only] = resolveAll([candidate({ routerMode: 'TeeTLS', onchainMode: 'TeeML' })]);
    assert.equal(only.routerMode, 'TeeTLS');
    assert.equal(only.onchainMode, 'TeeML');
  });
});
