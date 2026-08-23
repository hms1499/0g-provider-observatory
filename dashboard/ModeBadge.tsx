import { modeNote } from './modes.js';

export function ModeBadge({ mode }: { mode: string }) {
  const note = modeNote(mode);
  return (
    <span title={note.means} data-mode={mode}>
      {note.label}
    </span>
  );
}
