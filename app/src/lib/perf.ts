import type { DayRow } from './engine';

export type PerfRange = '24h' | '7d' | '30d' | 'all';
export type PerfMode = 'all' | 'perps';
export const PERF_RANGES: [PerfRange, string][] = [['24h', '24h'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']];
const DAYS: Record<PerfRange, number | null> = { '24h': 1, '7d': 7, '30d': 30, all: null };

/** P/L (USD) and % for the last 1 / 7 / 30 daily rows or since the start.
 *  'all' = the whole crypto portfolio (SDCA + RSPS): % is time-weighted (chained daily returns), P/L = change in value
 *  minus the money put in or taken out in that window. 'perps' = only the perp positions (shorts and leveraged longs):
 *  P/L = price moves + funding + liquidations, % = chained daily P/L / perp equity (margin + unrealized P/L).
 *  The last row is today: from the last daily close (00:00 UTC) to the live price, so '24h' = today so far. */
export function periodPerf(rows: DayRow[], range: PerfRange, mode: PerfMode): { pnl: number; pct: number; days: number; from: string } | null {
  if (!rows.length) return null;
  const n = DAYS[range], win = n == null ? rows : rows.slice(-n), i0 = rows.length - win.length;
  const before = i0 > 0 ? rows[i0 - 1] : null, last = rows[rows.length - 1];
  if (mode === 'perps') {
    return { pnl: win.reduce((t, r) => t + (r.perpPnl ?? 0), 0), pct: win.reduce((g, r) => g * (1 + (r.rPerp ?? 0)), 1) - 1, days: win.length, from: win[0].date };
  }
  const pnl = (last.value - (before?.value ?? 0)) - (last.invested - (before?.invested ?? 0));
  return { pnl, pct: win.reduce((g, r) => g * (1 + r.r), 1) - 1, days: win.length, from: win[0].date };
}
