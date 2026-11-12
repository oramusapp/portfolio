import { describe, expect, it } from 'vitest';
import { dashboardStats } from './dashboardStats';
import type { DayRow } from './engine';

const row = (date: string, r: number, gain: number): DayRow => ({
  date, signal: { date, createdAt: 0, sdca: { pct: 0, cash: 0, btc: 0 }, rsps: { alloc: {}, cash: 0, units: {} } }, duplicated: false,
  execs: [], sdca: null, rsps: null, value: 0, sdcaValue: 0, rspsValue: 0, r, rSdca: r, rRsps: 0, btcDay: 0,
  totalGain: gain, sdcaGain: gain, rspsGain: 0, invested: 0, missing: [], fundingUsd: 0, liquidations: []
});

describe('dashboardStats', () => {
  it('summarises returns, risk and signals as plain JSON numbers', () => {
    const s = dashboardStats({
      now: Date.UTC(2026, 10, 10), today: '2026-11-10', rows: [row('2026-11-08', 0.1, 0.1), row('2026-11-09', -0.05, 0.045)],
      btcDaily: [0.02, 0.01], value: 1100, sdcaValue: 600, rspsValue: 500, invested: 1000, btcBuyHold: 0.0302, signalDates: ['2026-11-09', '2026-11-08']
    });
    expect(s.app).toBe('skb-portfolio');
    expect(s.kind).toBe('dashboard-stats');
    expect(s.gains).toBeCloseTo(0.1);
    expect(s.strategyReturn).toBeCloseTo(0.045);
    expect(s.vsBtc).toBeCloseTo(0.0148);
    expect(s.risk.portfolio.maxDD).toBeCloseTo(-0.05);
    expect(s.firstSignal).toBe('2026-11-08');
    expect(s.lastSignal).toBe('2026-11-09');
    expect(s.series).toEqual([['2026-11-08', 0.1, 0.1, 0], ['2026-11-09', 0.045, 0.045, 0]]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it('turns missing numbers into null instead of NaN', () => {
    const s = dashboardStats({ now: 0, today: '2026-11-10', rows: [], btcDaily: [], value: 0, sdcaValue: 0, rspsValue: 0, invested: 0, btcBuyHold: NaN, signalDates: [] });
    expect(s.strategyReturn).toBeNull();
    expect(s.gains).toBeNull();
    expect(s.lastSignal).toBeNull();
    expect(s.series).toEqual([]);
  });
});
