// In-app reminders. Dates are the phone's local calendar days ('YYYY-MM-DD'). A reminder is due from its latest
// occurrence until it is marked done for that occurrence; it shows when the app is opened.
export type Schedule =
  | { kind: 'monthDay'; day: number }        // every month on day N (shorter months: their last day)
  | { kind: 'monthEnd' }                      // last day of every month
  | { kind: 'weekly'; weekday: number }       // 0 = Sunday … 6 = Saturday
  | { kind: 'once'; date: string };
export interface Reminder { id: string; title: string; action: string; schedule: Schedule; created: string; doneFor?: string; }

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const monthDay = (y: number, m: number, day: number) => fmt(new Date(y, m, Math.min(day, daysIn(y, m))));
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };

export const localToday = (now = new Date()) => fmt(now);

/** Latest occurrence on or before `today`, or null. */
export function lastOccurrence(s: Schedule, today: string): string | null {
  const t = parse(today), y = t.getFullYear(), m = t.getMonth();
  switch (s.kind) {
    case 'monthDay': { const here = monthDay(y, m, s.day); return here <= today ? here : monthDay(y, m - 1, s.day); }
    case 'monthEnd': { const here = monthDay(y, m, 31); return here <= today ? here : monthDay(y, m - 1, 31); }
    case 'weekly': return addDays(today, -((t.getDay() - s.weekday + 7) % 7));
    case 'once': return s.date <= today ? s.date : null;
  }
}

/** First occurrence after `today`, or null. */
export function nextOccurrence(s: Schedule, today: string): string | null {
  const t = parse(today), y = t.getFullYear(), m = t.getMonth();
  switch (s.kind) {
    case 'monthDay': { const here = monthDay(y, m, s.day); return here > today ? here : monthDay(y, m + 1, s.day); }
    case 'monthEnd': { const here = monthDay(y, m, 31); return here > today ? here : monthDay(y, m + 1, 31); }
    case 'weekly': return addDays(today, ((s.weekday - t.getDay() + 7) % 7) || 7);
    case 'once': return s.date > today ? s.date : null;
  }
}

/** The occurrence the reminder is due for (not yet marked done), or null. Occurrences before it was created don't count. */
export function dueFor(r: Reminder, today: string): string | null {
  const last = lastOccurrence(r.schedule, today);
  if (!last || last < r.created) return null;
  return r.doneFor && r.doneFor >= last ? null : last;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function describe(s: Schedule) {
  switch (s.kind) {
    case 'monthDay': return `Every month on day ${s.day}`;
    case 'monthEnd': return 'Last day of every month';
    case 'weekly': return `Every ${WEEKDAYS[s.weekday]}`;
    case 'once': return `Once on ${s.date}`;
  }
}
