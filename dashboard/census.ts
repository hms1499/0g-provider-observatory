/**
 * The shape of one epoch, in the terms the page opens with.
 *
 * The panel used to lead with four readings about the *run* — epoch, timestamp, services,
 * calls — and the most prominent number on the project's front page was `420 calls`, which is
 * the least interesting fact available about it. None of the four said anything about the
 * network being measured.
 *
 * What this counts instead is how much of the network can be checked at all. A model served by
 * one provider has nothing to be compared against: its divergence column reads 0% because
 * there was no peer to differ from, and no key, epoch or amount of patience will change that.
 * On epoch 496620 that is sixteen of twenty-one models. That ratio is the project's own thesis
 * stated as a measurement, and until now it appeared nowhere on the site.
 *
 * **Derived from the rendered groups, never from the raw record.** `measured` used to be
 * `epoch.measurements.length` while the table below it drew a row per measurement that
 * resolved to a registered service — two counts from two sources that agree today and would
 * quietly stop agreeing the day a measurement named a provider the registry had dropped.
 * Counting the groups counts exactly what is on screen.
 */
import type { ProviderRecord } from '../src/chain/registry.js';
import type { ModelGroup } from './rows.js';

export interface EpochCensus {
  /** Services this epoch measured and this page can name. */
  measured: number;
  /** Services registered on chain with a model, measured or not. */
  registered: number;
  /** Distinct model strings among the measured services. */
  models: number;
  /** Models with two or more providers measured — the ones a comparison is possible for. */
  comparable: number;
  /** Models with exactly one provider measured. Nothing to check them against. */
  lone: number;
  /** Probe calls answered across every service measured. */
  calls: number;
}

export function censusOf(
  groups: readonly ModelGroup[],
  providers: readonly ProviderRecord[],
): EpochCensus {
  let measured = 0;
  let comparable = 0;
  let lone = 0;
  let calls = 0;

  for (const g of groups) {
    measured += g.rows.length;
    if (g.rows.length > 1) comparable += 1;
    else lone += 1;
    for (const r of g.rows) calls += r.calls;
  }

  return {
    measured,
    registered: providers.filter((p) => p.model !== null).length,
    models: groups.length,
    comparable,
    lone,
    calls,
  };
}
