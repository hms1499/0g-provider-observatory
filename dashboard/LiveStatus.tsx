/**
 * What just happened, for a reader who is not looking at the screen.
 *
 * All three action panels set `aria-busy` while they work and then swap a skeleton for a
 * result. `aria-busy` says the region is unsettled; it does not say what it settled on. So a
 * reader using a screen reader pressed Measure, waited thirty seconds for a run against the
 * live network, and was told nothing at all — the verdict, the number of measurements and the
 * count of disagreements all arrived silently.
 *
 * One persistent region per panel, rather than a `role="status"` on the result itself. A live
 * region announces changes to a node that was already in the tree, and these panels mount
 * their results fresh; wrapping the whole result would also read out every row of a table
 * that is right there to be read at the reader's own pace.
 *
 * So this carries a sentence, not the output: the same summary the panel prints at the top of
 * its result, and nothing that is not already on screen. It is visually hidden because it
 * duplicates what is visible — the one case where hiding text from sight is correct rather
 * than a shortcut.
 *
 * `polite`, never `assertive`: a finished measurement is worth saying at the next pause, not
 * worth cutting somebody off mid-sentence.
 */
export function LiveStatus({ children }: { children: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {children}
    </p>
  );
}
