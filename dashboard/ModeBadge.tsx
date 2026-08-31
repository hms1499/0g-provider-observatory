import { modeAnchorId, modeNote } from './modes.js';

/**
 * The guarantee mode a service's registry entry declares, and a way to find out what it means.
 *
 * **This used to be a `<span title=…>` and nothing else, which put the most load-bearing
 * sentence on the page behind the least reachable affordance there is.** A `title` tooltip
 * needs a hover: it does not exist on a touch device, it does not open from the keyboard, and
 * it is announced inconsistently by screen readers. The sentence it was hiding is the one that
 * says `standard` mode is a property of the model being served and not a shortcoming of the
 * operator serving it — the project's own positioning rule, unreadable on a phone.
 *
 * So the badge is a button. Pressing it moves the reader to that mode's entry in the caveats
 * block, which is the same text, in the flow of the page, where it can be read, selected,
 * linked to and found again by scrolling. The `title` stays for the hover that already worked.
 *
 * **It scrolls; it does not link.** An `<a href="#mode-standard">` would be the obvious way to
 * do this and it is the wrong one here: `App` keeps chain, section and epoch in the hash and
 * canonicalises it on `hashchange`, so a fragment would be read as a view and would drop the
 * reader's pinned epoch on the way past. `scrollIntoView` reaches the same element and leaves
 * the address bar as it found it.
 *
 * **It degrades to what it was.** The caveats block renders only on the Providers panel, which
 * is also the only panel with a table of badges — but if the target is ever missing, the click
 * does nothing and the tooltip still says what the mode means. A badge that threw would be a
 * worse failure than a badge that is merely quiet.
 */
export function ModeBadge({ mode }: { mode: string }) {
  const note = modeNote(mode);

  function reveal() {
    const target = document.getElementById(modeAnchorId(note.label));
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Marks where the reader was sent. The caveats list is a wall of prose and an unmarked
    // jump into the middle of it leaves them hunting for which entry they asked for.
    //
    // Held for five seconds, not two: measured on a 390px viewport the trip is about 3000px
    // and the smooth scroll takes most of two seconds to land, so a shorter mark spends its
    // life passing the reader on the way down and is gone by the time they arrive.
    target.setAttribute('data-revealed', 'true');
    window.setTimeout(() => target.removeAttribute('data-revealed'), 5000);
  }

  return (
    <button
      type="button"
      className="mode"
      data-mode={mode}
      title={note.means}
      aria-label={`${note.label} — what this mode means`}
      onClick={reveal}
    >
      {note.label}
    </button>
  );
}
