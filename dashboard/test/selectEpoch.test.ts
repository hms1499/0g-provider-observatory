import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { EpochRecord } from '../../src/chain/registry.js';
import { newestEpoch, selectEpoch } from '../selectEpoch.js';

const record = (epoch: number): EpochRecord => ({
  epoch,
  prober: '0xP',
  writtenAt: new Date(epoch * 1000),
  storageRoot: '0xroot',
  measurements: [],
});

describe('newestEpoch', () => {
  it('is the largest, not the last written', () => {
    assert.equal(newestEpoch([496591, 496620, 496609]), 496620);
  });

  it('is null when the prober has published nothing', () => {
    assert.equal(newestEpoch([]), null);
  });
});

describe('selectEpoch · nothing asked for', () => {
  it('shows the newest record', () => {
    const view = selectEpoch({
      chosen: null,
      records: [record(496620)],
      epochs: [496591, 496620],
      history: 'loading',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'record', record: record(496620) });
  });

  it('is empty when the chain carries no epoch at all', () => {
    const view = selectEpoch({ chosen: null, records: [], epochs: [], history: 'ready' });
    assert.deepEqual(view, { state: 'empty' });
  });
});

describe('selectEpoch · an epoch asked for by link', () => {
  it('shows it once its record has arrived', () => {
    const view = selectEpoch({
      chosen: 496591,
      records: [record(496591), record(496620)],
      epochs: [496591, 496620],
      history: 'ready',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'record', record: record(496591) });
  });

  /*
   * The defect this module was written for. During the second phase the only record in hand is
   * the newest, and the panel used to fall back to it — a reader following a link to 496591
   * read 496620's figures under 496620's timestamp, with nothing on screen saying so.
   */
  it('never stands another epoch in for one still arriving', () => {
    const view = selectEpoch({
      chosen: 496591,
      records: [record(496620)],
      epochs: [496591, 496620],
      history: 'loading',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'arriving', epoch: 496591 });
  });

  it('reports a published epoch whose record never came back', () => {
    const view = selectEpoch({
      chosen: 496591,
      records: [record(496620)],
      epochs: [496591, 496620],
      history: 'failed',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'unreadable', epoch: 496591 });
  });

  it('reports one the second phase finished without producing', () => {
    const view = selectEpoch({
      chosen: 496591,
      records: [record(496620)],
      epochs: [496591, 496620],
      history: 'ready',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'unreadable', epoch: 496591 });
  });

  /*
   * Decided in the first phase: the epoch list arrives with the newest record, so an epoch
   * number from the other chain is answered at once rather than after a wait that cannot end
   * in the record being found.
   */
  it('calls an epoch this prober never published absent, without waiting', () => {
    const view = selectEpoch({
      chosen: 1,
      records: [record(496620)],
      epochs: [496591, 496620],
      history: 'loading',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'absent', epoch: 1 });
  });

  it('is absent, not empty, when the chain carries no epochs and a link names one', () => {
    const view = selectEpoch({ chosen: 496591, records: [], epochs: [], history: 'ready' });
    assert.deepEqual(view, { state: 'absent', epoch: 496591 });
  });

  it('finds the record wherever it sits in the list', () => {
    const view = selectEpoch({
      chosen: 496591,
      records: [record(496620), record(496591), record(496609)],
      epochs: [496591, 496609, 496620],
      history: 'ready',
      latest: record(496620),
    });
    assert.deepEqual(view, { state: 'record', record: record(496591) });
  });
});
