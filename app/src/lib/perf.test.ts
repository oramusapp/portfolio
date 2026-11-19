import { describe, expect, it } from 'vitest';
import { perfWindow, periodPerf } from './perf';
import type { DayRow } from './engine';

const row = (date: string, value: number, invested: number, r: number, perpPnl = 0, rPerp = 0) =>
  ({ date, value, invested, r, perpPnl, rPerp, sdcaValue: value * 0.4, sdcaInvested: invested * 0.4, rSdca: r, rspsValue: value * 0.6, rspsInvested: invested * 0.6, rRsps: r / 2 } as unknown as DayRow);
const rows = [row('2026-01-01', 1000, 1000, 0), row('2026-01-02', 1100, 1000, 0.1, 50, 0.1), row('2026-01-03', 1650, 1500, 0.0455, -20, -0.04)];

describe('periodPerf', () => {
  it('All since the start: value − money in, % chained', () => {
    const p = periodPerf(rows, 'all', 'total')!;
    expect(p.pnl).toBeCloseTo(150); expect(p.pct).toBeCloseTo(1.1 * 1.0455 - 1);
  });
  it('24h = the last row; a deposit is not profit', () => {
    const p = periodPerf(rows, '24h', 'total')!;
    expect(p.pnl).toBeCloseTo(50); expect(p.pct).toBeCloseTo(0.0455); expect(p.from).toBe('2026-01-03');
  });
  it('7d with fewer rows = since the start', () => { expect(periodPerf(rows, '7d', 'total')!.days).toBe(3); });
  it('Perps: only the perp P/L', () => {
    const p = periodPerf(rows, 'all', 'perps')!;
    expect(p.pnl).toBeCloseTo(30); expect(p.pct).toBeCloseTo(1.1 * 0.96 - 1);
  });
  it('SDCA / RSPS use their own value, money in and daily returns', () => {
    const sd = periodPerf(rows, 'all', 'sdca')!, rs = periodPerf(rows, '24h', 'rsps')!;
    expect(sd.pnl).toBeCloseTo(0.4 * 150); expect(sd.pct).toBeCloseTo(1.1 * 1.0455 - 1);
    expect(rs.pnl).toBeCloseTo(0.6 * 50); expect(rs.pct).toBeCloseTo(0.0455 / 2);
  });
  it('no rows → null', () => { expect(periodPerf([], 'all', 'total')).toBeNull(); });
});

describe('perfWindow', () => {
  const r = (date: string, totalGain: number) => ({ date, totalGain } as unknown as DayRow);
  const rows = [r('2026-01-01', 0.1), r('2026-01-02', 0.21), r('2026-01-03', 0.089)];
  it('All = the whole line from the start', () => {
    const w = perfWindow(rows, 'all', 'total', '2025-12-31');
    expect(w.start).toBe('2025-12-31'); [0, 0.1, 0.21, 0.089].forEach((v, i) => expect(w.values[i]).toBeCloseTo(v));
  });
  it('a shorter period starts at 0% at the close before it', () => {
    const w = perfWindow(rows, '24h', 'total', '2025-12-31');
    expect(w.start).toBe('2026-01-02'); expect(w.values[0]).toBe(0); expect(w.values[1]).toBeCloseTo(1.089 / 1.21 - 1);
  });
});
