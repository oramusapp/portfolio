// Checklist from the "Crypto Learning System Rulebook": a daily check that starts empty every local calendar day
// and the stage gates 0–5, which stay until changed. Dates are the phone's local days ('YYYY-MM-DD'), like reminders.

export const DAILY_ITEMS: { id: string; text: string }[] = [
  { id: 'sleep', text: 'Sleep and health check — slept enough? If not, skip the market work today.' },
  { id: 'trend', text: 'Update the trend indicators and read the aggregate score.' },
  { id: 'compare', text: 'Compare the score with yesterday’s; note any change and any indicator that disagrees.' },
  { id: 'positions', text: 'Check open positions against their written stop and exit rules.' },
  { id: 'skipped', text: 'Log any signal you skipped, and why.' },
  { id: 'study', text: 'Study block (10 minutes): one lesson from the current stage.' },
  { id: 'close', text: 'Close the screens. No intraday checking.' }
];

export const STAGES: { title: string; gate: string }[] = [
  { title: 'Foundations and vetting', gate: 'You can explain, in writing, why an MLM-style or influencer offer fails your vetting rules.' },
  { title: 'Valuation', gate: 'The valuation score is written down, updated weekly, and you can state where each input comes from.' },
  { title: 'Trend', gate: '8 weeks of daily trend readings logged, plus a note on when each indicator disagreed with the others.' },
  { title: 'Risk and sizing', gate: 'Sizing sheet tested on at least 20 past or paper positions without a rule violation.' },
  { title: 'Paper trading', gate: '3 months logged against buy-and-hold, every skipped signal explained, and a written post-mortem.' },
  { title: 'Small live allocation', gate: 'Gate to scale: a written review showing the rules were followed, whatever the P/L.' }
];

export interface DailyState { day: string; done: string[]; history?: Record<string, number>; }
export type StageState = Record<number, string | null>;   // stage index → date the gate was passed (null / missing = not passed)

const HISTORY_DAYS = 60;

/** The daily check as it applies today: a list stored on an earlier day reads as empty. */
export function dailyFor(stored: DailyState | null | undefined, today: string): DailyState {
  if (stored?.day === today) return stored;
  const history = { ...(stored?.history ?? {}) };
  if (stored?.day && stored.day < today) history[stored.day] = countDone(stored);   // keep yesterday's score
  const keep = Object.keys(history).sort().slice(-HISTORY_DAYS);
  return { day: today, done: [], history: Object.fromEntries(keep.map((d) => [d, history[d]])) };
}

/** Ticks or unticks an item for today (rolling over to a new day first if needed). */
export function toggleDaily(stored: DailyState | null | undefined, id: string, today: string): DailyState {
  const cur = dailyFor(stored, today);
  const done = cur.done.includes(id) ? cur.done.filter((x) => x !== id) : [...cur.done, id];
  return { ...cur, done };
}

export const countDone = (s: DailyState) => s.done.filter((id) => DAILY_ITEMS.some((i) => i.id === id)).length;

/** Index of the first stage whose gate is not passed; STAGES.length when all are passed. */
export const currentStage = (st: StageState) => { const i = STAGES.findIndex((_, k) => !st[k]); return i < 0 ? STAGES.length : i; };
export const passedCount = (st: StageState) => STAGES.filter((_, k) => !!st[k]).length;
