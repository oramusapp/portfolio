// Dates are UTC calendar days 'YYYY-MM-DD' — the same days as the exchange's daily candles.
export const DAY = 86_400_000;
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const msOf = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => dayOf(msOf(day) + n * DAY);
export const todayUtc = (now = Date.now()) => dayOf(now);
export function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
/** ms until the next 00:00 UTC (daily candle close = signal reset). */
export const msToReset = (now = Date.now()) => (Math.floor(now / DAY) + 1) * DAY - now;
