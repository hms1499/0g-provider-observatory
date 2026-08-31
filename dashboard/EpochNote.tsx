import type { EpochNote as Note } from './epochNotes.js';

/**
 * A correction shown beside the epoch it belongs to.
 *
 * Deliberately not an alert, a warning triangle or a red panel. The figures it stands next to
 * are real measurements that were computed correctly under the rule in force when they were
 * written; what is wrong is the rule, and it has been fixed for every epoch since. Dressing
 * that as an error would tell a reader to distrust the reading, when what they need is to know
 * what part of it belongs to the prober rather than to the services named underneath.
 *
 * It is a `<aside>` rather than a paragraph in the flow because it is about the epoch, not part
 * of what the epoch found — and it is placed above the readings rather than under them, since a
 * caveat a reader meets after they have already drawn a conclusion has arrived too late.
 */
export function EpochNoteCard({ note }: { note: Note }) {
  return (
    <aside className="epoch-note">
      <h3>{note.label}</h3>
      <p>{note.text}</p>
    </aside>
  );
}

/** Every note for the epochs on screen, or nothing at all when there are none. */
export function EpochNotes({ notes }: { notes: readonly Note[] }) {
  if (notes.length === 0) return null;
  return (
    <>
      {notes.map((n) => (
        <EpochNoteCard key={`${n.chainId}/${n.epoch}`} note={n} />
      ))}
    </>
  );
}
