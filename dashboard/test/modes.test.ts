import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { modeNote } from '../modes.js';

describe('modeNote', () => {
  it('explains what each mode does and does not guarantee', () => {
    assert.match(modeNote('TeeML').means, /enclave/i);
    assert.match(modeNote('TeeTLS').means, /transport|channel/i);
  });

  it('gives standard a technical reason rather than a verdict', () => {
    const note = modeNote('standard');
    assert.match(note.means, /closed|third-party|cannot/i);
    assert.doesNotMatch(note.means, /worse|untrustworthy|bad|unsafe/i);
  });

  it('does not invent an explanation for a mode it has never seen', () => {
    assert.equal(modeNote('Unknown').label, 'Unknown');
    assert.match(modeNote('Unknown').means, /not recorded|do not know/i);
  });
});
