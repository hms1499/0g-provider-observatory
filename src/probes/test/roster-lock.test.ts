import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { applyRosterLock, type RosterLock } from '../roster-lock.js';

const svc = (address: string, modelId: string) => ({ address, modelId });
const A = '0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D';
const Bx = '0xF203A388e9E70F09ece38046a6D40a89cf896309';
const C = '0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB';

const lock: RosterLock = {
  epoch: 496539,
  services: [svc(A, 'glm-5.2'), svc(Bx, 'glm-5.2')],
};

describe('applyRosterLock', () => {
  it('drops a service the lock does not name, however affordable it became', () => {
    // The series has to measure the same set every epoch. A group that becomes affordable
    // because prices moved would otherwise join silently and break comparability.
    const r = applyRosterLock([svc(A, 'glm-5.2'), svc(Bx, 'glm-5.2'), svc(C, 'glm-5')], lock);
    assert.deepEqual(r.roster.map((s) => s.modelId), ['glm-5.2', 'glm-5.2']);
    assert.deepEqual(r.extra.map((s) => s.modelId), ['glm-5']);
  });

  it('reports a locked service that did not make it into this epoch', () => {
    // Not an error: a provider can go unhealthy. It has to be visible rather than silent,
    // because a missing measurement is itself a measurement.
    const r = applyRosterLock([svc(A, 'glm-5.2')], lock);
    assert.deepEqual(r.missing.map((s) => s.address), [Bx]);
    assert.equal(r.roster.length, 1);
  });

  it('matches addresses case-insensitively, since a checksum differs by case alone', () => {
    const r = applyRosterLock([svc(A.toLowerCase(), 'glm-5.2')], lock);
    assert.equal(r.roster.length, 1);
    assert.equal(r.missing.length, 1);
  });

  it('keeps the lock order, so an epoch is not reordered by what happened to be cheap', () => {
    const r = applyRosterLock([svc(Bx, 'glm-5.2'), svc(A, 'glm-5.2')], lock);
    assert.deepEqual(r.roster.map((s) => s.address), [A, Bx]);
  });

  it('never invents a service the fitted roster did not contain', () => {
    const r = applyRosterLock([], lock);
    assert.equal(r.roster.length, 0);
    assert.equal(r.missing.length, 2);
  });
});
