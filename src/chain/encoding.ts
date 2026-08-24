/**
 * How a measurement is encoded in `MeasurementRegistry.Measurement`.
 *
 * Deliberately free of imports. Both the prober (`src/probes/aggregate.ts`) and the browser
 * dashboard need these values, and the dashboard's import boundary rejects anything that
 * transitively reaches `src/config.ts`. A module with no dependencies cannot drift across
 * that line.
 */

/**
 * Written into `divergenceBps` when the figure could not be measured, as distinct from
 * measured and found to be zero.
 *
 * The field is a `uint16` carrying basis points, so 0..10000 are real values and everything
 * above is free. 65535 needs no contract change and cannot be mistaken for a rate: applying
 * the basis-point rule to it yields 655%, which is impossible by construction.
 *
 * The alternative was writing 0, and 0 is a claim — it says the provider matched its peers.
 * Saying that about a named operator on the strength of a measurement never taken is the one
 * thing this project must not do.
 */
export const DIVERGENCE_UNMEASURED = 0xffff;

/** Whether a `divergenceBps` read off the chain stands for "not measured". */
export const isUnmeasured = (divergenceBps: number): boolean =>
  divergenceBps === DIVERGENCE_UNMEASURED;
