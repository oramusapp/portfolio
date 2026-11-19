import { describe, expect, it } from 'vitest';
import { periodPerf } from './perf';
import type { DayRow } from './engine';

const row = (date: string, value: number, invested: number, r: number, perpPnl = 0, rPerp = 0) => ({ date, value, invested, r, perpPnl, rPerp } as unknown as DayRow);
const rows = [row('2026-01-01', 1000, 1000, 0), row('2026-01-02', 1100, 1000, 0.1, 50, 0.1), row('2026-01-03', 1650, 1500, 0.0455, -20, -0.04)];

describe('periodPerf', () => {
  it('All since the start: value − money in, % chained', () => {
    const p = periodPerf(rows, 'all', 'all')!;
    expect(p.pnl).toBeCloseTo(150); expect(p.pct).toBeCloseTo(1.1 * 1.0455 - 1);
  });
  it('24h = the last row; a deposit is not profit', () => {
    const p = periodPerf(rows, '24h', 'all')!;
    expect(p.pnl).toBeCloseTo(50); expect(p.pct).toBeCloseTo(0.0455); expect(p.from).toBe('2026-01-03');
  });
  it('7d with fewer rows = since the start', () => { expect(periodPerf(rows, '7d', 'all')!.days).toBe(3); });
  it('Perps: only the perp P/L', () => {
    const p = periodPerf(rows, 'all', 'perps')!;
    expect(p.pnl).toBeCloseTo(30); expect(p.pct).toBeCloseTo(1.1 * 0.96 - 1);
  });
  it('no rows → null', () => { expect(periodPerf([], 'all', 'all')).toBeNull(); });
});
