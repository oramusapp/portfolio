import { useEffect, useMemo, useRef, useState } from 'react';
import { IcChevron, IcPen, IcTrash } from './icons';

// Notes in the style of the iPhone Notes app: list grouped by date, search, pin, the first line is the title,
// every keystroke is saved, an empty note disappears when you leave it.
export interface Note { id: string; text: string; created: number; updated: number; pinned?: boolean; }

const title = (n: Note) => n.text.split('\n').find((l) => l.trim())?.trim() || 'New Note';
const preview = (n: Note) => n.text.split('\n').filter((l) => l.trim()).slice(1).join(' ').trim() || 'No additional text';
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 86_400_000;

function group(n: Note, now: number) {
  if (n.pinned) return 'Pinned';
  const age = startOfDay(now) - startOfDay(n.updated);
  if (age <= 0) return 'Today';
  if (age <= 7 * DAY) return 'Previous 7 Days';
  if (age <= 30 * DAY) return 'Previous 30 Days';
  return new Date(n.updated).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
const when = (t: number, now: number) => (startOfDay(t) === startOfDay(now)
  ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' }));
const IcPin = ({ on }: { on: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M9 3h6l-1 6 4 4H6l4-4-1-6ZM12 13v8" /></svg>
);

interface Props { notes: Note[]; setNotes: (f: (l: Note[]) => Note[]) => void; onDelete: (n: Note) => void; }

export function NotesTab({ notes, setNotes, onDelete }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const now = Date.now();
  const open = notes.find((n) => n.id === openId) ?? null;

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return notes.filter((n) => !term || n.text.toLowerCase().includes(term))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
  }, [notes, q]);
  const groups: [string, Note[]][] = [];
  for (const n of list) {
    const g = group(n, now);
    const last = groups.at(-1);
    if (last && last[0] === g) last[1].push(n); else groups.push([g, [n]]);
  }

  const create = () => {
    const t = Date.now();
    const n: Note = { id: `${t}-${Math.random().toString(36).slice(2, 7)}`, text: '', created: t, updated: t };
    setNotes((l) => [n, ...l]);
    setOpenId(n.id);
  };
  const close = () => {
    if (open && !open.text.trim()) setNotes((l) => l.filter((n) => n.id !== open.id));   // like iPhone: empty notes are dropped
    setOpenId(null);
  };

  if (open) return <Editor note={open} onBack={close}
    onChange={(text) => setNotes((l) => l.map((n) => (n.id === open.id ? { ...n, text, updated: Date.now() } : n)))}
    onPin={() => setNotes((l) => l.map((n) => (n.id === open.id ? { ...n, pinned: !n.pinned } : n)))}
    onDelete={() => { if (!open.text.trim() || confirm('Delete this note? It can be restored from Settings → Backup → Archive.')) { if (open.text.trim()) onDelete(open); else setNotes((l) => l.filter((n) => n.id !== open.id)); setOpenId(null); } }} />;

  return (
    <div className="notes">
      <div className="notes-bar">
        <input className="notes-search" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="icon notes-new" title="New note" aria-label="New note" onClick={create}><IcPen width={22} /></button>
      </div>
      {!list.length && <div className="empty">{q ? 'No matching notes.' : 'No notes yet — tap ✎ to write one.'}</div>}
      {groups.map(([g, ns]) => (
        <div key={g} className="notes-group">
          <div className="notes-group-title">{g}</div>
          <div className="notes-list card">
            {ns.map((n) => (
              <button key={n.id} className="note-row" onClick={() => setOpenId(n.id)}>
                <b>{title(n)}</b>
                <span><span className="note-time">{when(n.updated, now)}</span> <span className="dim">{preview(n)}</span></span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="notes-count dim small">{notes.length} {notes.length === 1 ? 'Note' : 'Notes'}</div>
    </div>
  );
}

function Editor({ note, onBack, onChange, onPin, onDelete }: { note: Note; onBack: () => void; onChange: (t: string) => void; onPin: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!note.text) ref.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stamp = new Date(note.updated).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="note-editor">
      <div className="notes-bar">
        <button className="note-back" onClick={onBack}><IcChevron width={20} style={{ transform: 'rotate(90deg)' }} />Notes</button>
        <span className="grow" />
        <button className={`icon ${note.pinned ? 'pinned' : ''}`} title={note.pinned ? 'Unpin' : 'Pin'} onClick={onPin}><IcPin on={!!note.pinned} /></button>
        <button className="icon" title="Delete note" onClick={onDelete}><IcTrash width={19} /></button>
      </div>
      <div className="note-stamp dim small">{stamp}</div>
      <textarea ref={ref} className="note-text" value={note.text} placeholder="Title&#10;Start writing…" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
