import { useState } from 'react';
import { BackupSection } from './BackupPanel';
import { IcBell, IcClose, IcPen, IcPlus, IcTrash } from './icons';
import { WEEKDAYS, describe, dueFor, localToday, nextOccurrence, type Reminder, type Schedule } from '../lib/reminders';
import type { Theme } from '../lib/theme';

type Kind = Schedule['kind'];
interface Draft { id?: string; title: string; action: string; kind: Kind; day: string; weekday: number; date: string; }
const empty = (): Draft => ({ title: '', action: '', kind: 'monthDay', day: '10', weekday: 1, date: localToday() });
const toDraft = (r: Reminder): Draft => ({
  id: r.id, title: r.title, action: r.action, kind: r.schedule.kind,
  day: r.schedule.kind === 'monthDay' ? String(r.schedule.day) : '10',
  weekday: r.schedule.kind === 'weekly' ? r.schedule.weekday : 1,
  date: r.schedule.kind === 'once' ? r.schedule.date : localToday()
});

interface Props {
  theme: Theme; setTheme: (t: Theme) => void; feePct: number; setFeePct: (v: number) => void;
  reminders: Reminder[]; saveReminder: (r: Reminder) => void; deleteReminder: (r: Reminder) => void;
  onClose: () => void;
}

export function SettingsPanel({ theme, setTheme, feePct, setFeePct, reminders, saveReminder, deleteReminder, onClose }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fee, setFee] = useState(feePct ? String(feePct) : '');
  const feeNum = fee.trim() === '' ? 0 : Number(fee.replace(',', '.'));
  const feeErr = !(feeNum >= 0 && feeNum < 5);
  const today = localToday();
  const dayNum = Number(draft?.day);
  const err = !draft ? null
    : !draft.title.trim() ? 'Write what to check.'
    : draft.kind === 'monthDay' && !(Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31) ? 'Day of month must be 1–31.'
    : draft.kind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? 'Pick a date.' : null;

  const submit = () => {
    if (!draft || err) return;
    const schedule: Schedule = draft.kind === 'monthDay' ? { kind: 'monthDay', day: dayNum }
      : draft.kind === 'monthEnd' ? { kind: 'monthEnd' }
      : draft.kind === 'weekly' ? { kind: 'weekly', weekday: draft.weekday } : { kind: 'once', date: draft.date };
    const old = reminders.find((r) => r.id === draft.id);
    saveReminder({
      id: draft.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: draft.title.trim(), action: draft.action.trim(), schedule,
      created: old?.created ?? today, doneFor: old && JSON.stringify(old.schedule) === JSON.stringify(schedule) ? old.doneFor : undefined
    });
    setDraft(null);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="icon" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>

        <section className="set-sec">
          <h3>Appearance</h3>
          <div className="seg">
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Dark (OLED)</button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          </div>
        </section>

        <section className="set-sec">
          <h3>Trading fees <span className="dim small">(optional)</span></h3>
          <div className="dim small">Taken from each SDCA and RSPS trade of new signals. Leave empty for no fees. Older signals keep the fee they were saved with.</div>
          <div className="field" style={{ maxWidth: 260 }}>
            <input inputMode="decimal" placeholder="0" value={fee} onChange={(e) => setFee(e.target.value)} onBlur={() => { if (!feeErr) setFeePct(feeNum); }} />
            <span className="unit">% per trade</span>
          </div>
          {feeErr ? <div className="warn small">Enter a number from 0 to 5.</div> : feeNum !== feePct ? <button className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => setFeePct(feeNum)}>Save fee</button> : null}
        </section>

        <section className="set-sec">
          <div className="pane-head">
            <h3><IcBell width={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />Reminders</h3>
            {!draft && <button className="btn ghost small" onClick={() => setDraft(empty())}><IcPlus width={15} />Add reminder</button>}
          </div>
          <div className="dim small">Shown in the app on the chosen day (and after it) until you mark them done.</div>

          {draft && (
            <div className="card pane rem-form">
              <label>What to check
                <input value={draft.title} placeholder="e.g. Have stocks closed above their price 12 months ago?" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label>What to do then (optional)
                <textarea rows={3} value={draft.action} placeholder="e.g. Above → stay invested. Below → move to bonds / cash." onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
              </label>
              <label>When
                <div className="field rem-when">
                  <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}>
                    <option value="monthDay">Every month on day…</option>
                    <option value="monthEnd">Last day of every month</option>
                    <option value="weekly">Every week on…</option>
                    <option value="once">Once on a date</option>
                  </select>
                  {draft.kind === 'monthDay' && <input inputMode="numeric" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} style={{ width: 80 }} />}
                  {draft.kind === 'weekly' && (
                    <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
                    </select>
                  )}
                  {draft.kind === 'once' && <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />}
                </div>
              </label>
              {err && <div className="warn small">{err}</div>}
              <div className="modal-foot">
                <button className="btn ghost small" onClick={() => setDraft(null)}>Cancel</button>
                <button className="btn gold small" disabled={!!err} onClick={submit}>{draft.id ? 'Save' : 'Add'}</button>
              </div>
            </div>
          )}

          {!reminders.length && !draft && <div className="dim small">No reminders yet.</div>}
          {reminders.map((r) => {
            const due = dueFor(r, today), next = nextOccurrence(r.schedule, today);
            return (
              <div className="rem-row" key={r.id}>
                <div className="rem-main">
                  <b>{r.title}</b>
                  {r.action && <div className="rem-action">{r.action}</div>}
                  <div className="dim small">{describe(r.schedule)} · {due ? <span className="warn">due ({due})</span> : next ? `next ${next}` : 'done'}</div>
                </div>
                <button className="icon" title="Edit" onClick={() => setDraft(toDraft(r))}><IcPen width={16} /></button>
                <button className="icon" title="Delete" onClick={() => { if (confirm(`Delete the reminder “${r.title}”?`)) deleteReminder(r); }}><IcTrash width={16} /></button>
              </div>
            );
          })}
        </section>

        <section className="set-sec">
          <h3>Backup</h3>
          <BackupSection />
        </section>
      </div>
    </div>
  );
}
