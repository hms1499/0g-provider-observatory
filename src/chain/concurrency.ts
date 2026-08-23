/**
 * Run an async function over a list with a ceiling on how many are in flight.
 *
 * The dashboard reads 38 providers from a public RPC. Sequentially that is 38 round trips
 * and a visibly slow page; all at once it is a burst that public endpoints rate-limit.
 * Results come back in input order so a caller can zip them against their ids.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };

  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}
