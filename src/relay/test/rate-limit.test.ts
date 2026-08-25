import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { allow, clientIp, createBucketStore, MAX_BUCKETS } from '../rate-limit.js';

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://relay.test/api/router/chat/completions', { headers });
}

describe('clientIp', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    const req = reqWith({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    assert.equal(clientIp(req), '203.0.113.9');
  });

  it('falls back to the LAST x-forwarded-for entry, not the first', () => {
    // The first entry is exactly what a spoofing caller controls; the last is what the
    // nearest trusted proxy appended.
    const req = reqWith({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    assert.equal(clientIp(req), '203.0.113.9');
  });

  it('a caller-forged leading x-forwarded-for entry does not earn its own bucket', () => {
    const trusted = '203.0.113.9';
    const a = reqWith({ 'x-forwarded-for': `10.0.0.1, ${trusted}` });
    const b = reqWith({ 'x-forwarded-for': `10.0.0.2, ${trusted}` });
    assert.equal(clientIp(a), clientIp(b));
  });

  it('falls back to a single shared bucket when neither header is present', () => {
    assert.equal(clientIp(reqWith({})), clientIp(reqWith({})));
    assert.equal(clientIp(reqWith({})), 'unknown');
  });
});

describe('allow', () => {
  it('allows up to capacity, then blocks, within the same instant', () => {
    const store = createBucketStore();
    let blocked = 0;
    for (let i = 0; i < 45; i++) {
      if (!allow(store, 'k', 0)) blocked += 1;
    }
    assert.equal(blocked, 5);
  });

  it('refills over time', () => {
    const store = createBucketStore();
    for (let i = 0; i < 40; i++) allow(store, 'k', 0);
    assert.equal(allow(store, 'k', 0), false);
    assert.equal(allow(store, 'k', 60_000), true); // a full minute later, back to capacity
  });

  it('keeps separate callers on separate buckets', () => {
    const store = createBucketStore();
    for (let i = 0; i < 40; i++) allow(store, 'a', 0);
    assert.equal(allow(store, 'a', 0), false);
    assert.equal(allow(store, 'b', 0), true); // a different key is unaffected
  });

  it('evicts fully-refilled buckets once the store exceeds MAX_BUCKETS, sparing a busy caller', () => {
    const store = createBucketStore();

    // One caller mid-throttle right now: it must survive the sweep below.
    allow(store, 'busy', 0);

    // Enough idle callers, all touched at the same instant, to push the store past the cap.
    // The last of these calls crosses MAX_BUCKETS and runs a sweep at now=0 — a no-op, since
    // nothing has had time to refill yet.
    for (let i = 0; i < MAX_BUCKETS; i++) {
      allow(store, `idle-${i}`, 0);
    }
    assert.equal(store.size, MAX_BUCKETS + 1);

    // 2 seconds later: long enough for the idle buckets (last touched at 0, one token below
    // capacity) to have refilled past capacity. Touching 'busy' again both keeps it alive
    // (it consumes a token, so it can never be "fully refilled" by its own call) and, because
    // the store is still over the cap, triggers the sweep at now=2000.
    allow(store, 'busy', 2_000);

    assert.equal(store.has('busy'), true);
    assert.equal(store.size, 1);
  });
});
