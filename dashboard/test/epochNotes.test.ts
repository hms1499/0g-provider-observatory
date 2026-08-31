import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { EPOCH_NOTES, epochNote, epochNotesFor } from '../epochNotes.js';

const MAINNET = 16661;
const TESTNET = 16602;

describe('epochNote', () => {
  it('returns the note for an annotated epoch on the chain it was written on', () => {
    const note = epochNote(MAINNET, 496620);
    assert.ok(note);
    assert.equal(note.epoch, 496620);
    assert.match(note.text, /rate-limit window/);
  });

  it('never prints a mainnet correction over a testnet reading', () => {
    // An epoch number is an hour, and the same hour exists on both chains.
    assert.equal(epochNote(TESTNET, 496620), null);
    assert.equal(epochNote(TESTNET, 496591), null);
  });

  it('has nothing to say about an epoch that has nothing to correct', () => {
    assert.equal(epochNote(MAINNET, 496636), null);
    assert.equal(epochNote(MAINNET, 496539), null);
  });

  it('treats "whichever is newest" as an epoch it cannot annotate', () => {
    // The Providers panel holds null for "follow the series", not a number.
    assert.equal(epochNote(MAINNET, null), null);
    assert.equal(epochNote(MAINNET, undefined), null);
  });
});

describe('epochNotesFor', () => {
  it('carries both notes when a comparison spans two annotated epochs', () => {
    const notes = epochNotesFor(MAINNET, [496591, 496620]);
    assert.equal(notes.length, 2);
    assert.deepEqual(notes.map((n) => n.epoch), [496591, 496620]);
  });

  it('says a note once when the same epoch is given twice', () => {
    assert.equal(epochNotesFor(MAINNET, [496620, 496620]).length, 1);
  });

  it('is empty for a pair that needs no correction', () => {
    assert.deepEqual(epochNotesFor(MAINNET, [496539, 496540]), []);
  });
});

describe('the notes themselves', () => {
  it('annotates only the two mainnet epochs measured to need it', () => {
    assert.deepEqual(
      EPOCH_NOTES.map((n) => `${n.chainId}/${n.epoch}`).sort(),
      ['16661/496591', '16661/496620'],
    );
  });

  // Principle 01: an instrument, not an indictment — and a correction that names an operator
  // as the cause of our own fault would be exactly that.
  it('names no operator and quotes no corrected figure', () => {
    for (const n of EPOCH_NOTES) {
      assert.equal(/0x[0-9a-fA-F]{4}/.test(n.text), false, n.label);
      assert.equal(/should have (been|read)/i.test(n.text), false, n.label);
    }
  });

  it('says who the fault belongs to, in every note', () => {
    for (const n of EPOCH_NOTES) {
      assert.match(n.text, /prober/, n.label);
      assert.match(n.text, /write-once/, n.label);
    }
  });
});
