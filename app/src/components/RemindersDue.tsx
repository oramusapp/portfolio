import { IcBell } from './icons';
import { dueFor, localToday, type Reminder } from '../lib/reminders';

/** Due reminders at the top of the page; each stays until marked done. */
export function RemindersDue({ reminders, onDone }: { reminders: Reminder[]; onDone: (r: Reminder, occurrence: string) => void }) {
  const today = localToday();
  const due = reminders.map((r) => ({ r, on: dueFor(r, today) })).filter((x): x is { r: Reminder; on: string } => !!x.on);
  if (!due.length) return null;
  return (
    <div className="rem-due">
      {due.map(({ r, on }) => (
        <div className="card rem-card" key={r.id}>
          <IcBell width={20} className="rem-ic" />
          <div className="rem-main">
            <b>{r.title}</b>
            {r.action && <div className="rem-action">{r.action}</div>}
            <div className="dim small">Reminder for {on}</div>
          </div>
          <button className="btn gold small" onClick={() => onDone(r, on)}>Done</button>
        </div>
      ))}
    </div>
  );
}
