/**
 * Retry one chain read.
 *
 * 0G's public mainnet RPC intermittently fails reads that are correct. Measured 2026-08-26
 * against `ProviderRegistry.get(id)` on `https://evmrpc.0g.ai`: twenty consecutive calls for
 * id 36 all reverted with `UnknownProvider(36)`, and ten minutes' worth of calls before and
 * after — same id, same block tag, same contract — all returned the provider. `providerCount`
 * read 38 throughout, so the ids being asked for were in range the whole time.
 *
 * Without a retry that blip reaches the reader as a hard failure, and because the dashboard
 * loads all 38 providers together, one bad read out of 38 replaces the entire page with an
 * error. Retrying is the difference between a page that flickers and a page that refuses to
 * render.
 *
 * **Every error is retried, including a revert.** A transient `UnknownProvider` and a genuine
 * one are the same bytes; nothing here can tell them apart. Retrying an id that really is out
 * of range costs two extra calls and then fails exactly as it did before, which is the cheaper
 * mistake by a wide margin.
 *
 * **Reads only.** A read has no side effect, so repeating it cannot double anything. Nothing
 * that writes to the ledger goes through here — `MeasurementRegistry` is write-once, and a
 * retried write is precisely the thing that must never happen.
 */
export interface RetryOptions {
  /**
   * How long to wait before each retry. One entry per retry, so the number of attempts is
   * `delaysMs.length + 1`. Short by design: a person is watching the page load.
   */
  delaysMs?: readonly number[];
}

const DEFAULT_DELAYS_MS = [150, 400] as const;

export async function retryRead<T>(read: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      if (attempt >= delays.length) throw e;
      const wait = delays[attempt];
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}
