/**
 * Per-caller rate limiting for the relay's Function endpoint.
 *
 * Extracted from api/router/chat/completions.ts so the caller-key selection and the token
 * bucket can be exercised directly in tests, without standing up `vercel dev`.
 */

/** Tokens per bucket, and how fast they refill: 40 requests per minute, per caller. */
const RATE_CAPACITY = 40;
const RATE_REFILL_PER_MS = RATE_CAPACITY / 60_000;

/**
 * Once the store holds more distinct callers than this, a request that would grow it further
 * first sweeps out buckets that have fully refilled (see `evictFullBuckets`). Picked as "large
 * enough that a legitimate burst of distinct callers never triggers a sweep mid-traffic," not
 * as a hard ceiling — the map can still hold more than this between sweeps.
 */
export const MAX_BUCKETS = 10_000;

interface Bucket {
  tokens: number;
  at: number;
}

export type BucketStore = Map<string, Bucket>;

export function createBucketStore(): BucketStore {
  return new Map();
}

/**
 * The rate-limit key for one request.
 *
 * Prefers `x-real-ip`, which Vercel's edge sets itself and a caller cannot override from the
 * request it sends. Falls back to the LAST entry of `x-forwarded-for` — the one appended by
 * the proxy closest to us — because every entry before that is caller-supplied: a caller who
 * sets its own `x-forwarded-for` controls exactly the first entry, so keying on the first
 * entry would let it mint a fresh bucket on every request. If neither header is present,
 * every such request shares a single bucket rather than getting one of its own — a shared
 * bucket throttles the whole unidentified pool together, which is the safe failure direction,
 * rather than exempting it.
 *
 * This is only as trustworthy as the platform's edge that sets these headers. It is
 * abuse-dampening, not an authorization boundary — nothing downstream should treat this
 * string as a verified caller identity.
 */
export function clientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const entries = forwardedFor.split(',');
    return entries[entries.length - 1]!.trim();
  }

  return 'unknown';
}

/**
 * Casual abuse only. Fluid Compute reuses instances, so `store` survives between requests
 * often enough to be useful — but it is per-instance, so it is NOT a hard guarantee across a
 * scaled-out deployment. Saying so here is cheaper than someone later assuming otherwise.
 *
 * The vector that would actually matter, using this as an anonymising relay to arbitrary
 * hosts, is closed by the upstream URL being a constant rather than by this function.
 *
 * `now` is injected so the refill math is testable without a real clock.
 */
export function allow(store: BucketStore, key: string, now: number = Date.now()): boolean {
  const b = store.get(key) ?? { tokens: RATE_CAPACITY, at: now };
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + (now - b.at) * RATE_REFILL_PER_MS);
  b.at = now;

  if (b.tokens < 1) {
    store.set(key, b);
    return false;
  }
  b.tokens -= 1;
  store.set(key, b);

  if (store.size > MAX_BUCKETS) evictFullBuckets(store, now);
  return true;
}

/**
 * A bucket that has fully refilled by `now` carries no state worth keeping: `allow()`'s own
 * default for a key it has never seen — `{ tokens: RATE_CAPACITY, at: now }` — is exactly what
 * that caller's bucket looks like once refilled, so deleting it changes nothing about that
 * caller's next request. A bucket that has NOT fully refilled is mid-throttle for someone;
 * dropping it early would hand that caller a fresh allowance for free, so the sweep leaves it
 * alone. Every bucket `allow()` itself just touched is stored one token below capacity (it
 * always consumes a token on the success path), so a caller mid-request can never be the one
 * evicted by its own call.
 */
function evictFullBuckets(store: BucketStore, now: number): void {
  for (const [key, bucket] of store) {
    const refilled = bucket.tokens + (now - bucket.at) * RATE_REFILL_PER_MS;
    if (refilled >= RATE_CAPACITY) store.delete(key);
  }
}
