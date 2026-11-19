import type { DayRow } from './engine';

export type PerfRange = '24h' | '7d' | '30d' | 'all';
/** What the chart line, PnL and % show: the whole crypto portfolio, one strategy, or only the perp positions. */
export type PerfMode = 'total' | 'sdca' | 'rsps' | 'perps';
export const PERF_RANGES: [PerfRange, string][] = [['24h', '24h'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']];
export const PERF_MODES: [PerfMode, string][] = [['total', 'Total'], ['sdca', 'SDCA'], ['rsps', 'RSPS'], ['perps', 'Perps']];
const DAYS: Record<PerfRange, number | null> = { '24h': 1, '7d': 7, '30d': 30, all: null };


/** Per mode: daily return, value, money put in (total = SDCA + RSPS). */
const pick = (mode: PerfMode) => (r: DayRow) =>
  mode === 'sdca' ? { r: r.rSdca, v: r.sdcaValue, inv: r.sdcaInvested ?? 0 }
    : mode === 'rsps' ? { r: r.rRsps, v: r.rspsValue, inv: r.rspsInvested ?? 0 }
      : { r: r.r, v: r.value, inv: r.invested };

/** Cumulative line for the chart (0 at the start) for a mode. */
export const gainOf = (mode: PerfMode) => (r: DayRow) =>
  mode === 'sdca' ? r.sdcaGain : mode === 'rsps' ? r.rspsGain : mode === 'perps' ? r.perpGain ?? 0 : r.totalGain;

/** P/L (USD) and % for the last 1 / 7 / 30 daily rows or since the start.
 *  total / sdca / rsps: % is time-weighted (chained daily returns), P/L = change in value minus the money put in or
 *  taken out in that window. perps: only the perp positions (shorts and leveraged longs): P/L = price moves + funding +
 *  liquidations, % = chained daily P/L / perp equity (margin + unrealized P/L).
 *  The last row is today: from the last daily close (00:00 UTC) to the live price, so '24h' = today so far. */
export function periodPerf(rows: DayRow[], range: PerfRange, mode: PerfMode): { pnl: number; pct: number; days: number; from: string } | null {
  if (!rows.length) return null;
  const n = DAYS[range], win = n == null ? rows : rows.slice(-n), i0 = rows.length - win.length;
  if (mode === 'perps') {
    return { pnl: win.reduce((t, r) => t + (r.perpPnl ?? 0), 0), pct: win.reduce((g, r) => g * (1 + (r.rPerp ?? 0)), 1) - 1, days: win.length, from: win[0].date };
  }
  const f = pick(mode), last = f(rows[rows.length - 1]), before = i0 > 0 ? f(rows[i0 - 1]) : { v: 0, inv: 0 };
  const pnl = (last.v - before.v) - (last.inv - before.inv);
  return { pnl, pct: win.reduce((g, r) => g * (1 + f(r).r), 1) - 1, days: win.length, from: win[0].date };
}

/** The daily rows of a period and the line rebased to 0 at its start (the close before the first row of the window). */
export function perfWindow(rows: DayRow[], range: PerfRange, mode: PerfMode, start: string) {
  const n = DAYS[range], win = n == null ? rows : rows.slice(-n), i0 = rows.length - win.length, g = gainOf(mode);
  const base = i0 > 0 ? g(rows[i0 - 1]) : 0;
  return {
    rows: win, start: i0 > 0 ? rows[i0 - 1].date : start,
    values: [0, ...win.map((r) => (1 + base > 1e-12 ? (1 + g(r)) / (1 + base) - 1 : 0))]
  };
}
