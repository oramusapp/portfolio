import { describe, expect, it } from 'vitest';
import { costBasis, periodReturns, rebalance, riskStats, sdcaOrder, type Signal } from './engine';
import type { PriceBook } from './prices';

describe('fees', () => {
  it('SDCA buy gets less BTC, sell brings less cash', () => {
    const b = sdcaOrder({ pct: 10, cash: 1000, btc: 0 }, 100, 0.001);
    expect(b.usd).toBe(100); expect(b.btc).toBeCloseTo(0.999); expect(b.fee).toBeCloseTo(0.1);
    const s = sdcaOrder({ pct: -50, cash: 0, btc: 2 }, 100, 0.001);
    expect(s.after.cash).toBeCloseTo(99.9);
  });
  it('RSPS fee is taken from the traded value', () => {
    const p = rebalance({ alloc: { SOL: 100 }, cash: 1000, units: {} }, (s) => (s === 'SOL' ? 10 : 1), 0.01);
    expect(p.fee).toBeCloseTo(10); expect(p.after.units.SOL).toBeCloseTo(99);
  });
});

describe('statistics', () => {
  it('risk numbers', () => {
    const st = riskStats([0.1, -0.5, 0.2]);
    expect(st.total).toBeCloseTo(1.1 * 0.5 * 1.2 - 1);
    expect(st.maxDD).toBeCloseTo(-0.5);
    expect(st.vol).toBeGreaterThan(0);
  });
  it('monthly and yearly compounding', () => {
    const { months, years } = periodReturns(['2026-01-31', '2026-02-01', '2026-02-02'], [0.1, 0.1, -0.1]);
    expect(months.get('2026-01')).toBeCloseTo(0.1);
    expect(months.get('2026-02')).toBeCloseTo(1.1 * 0.9 - 1);
    expect(years.get('2026')).toBeCloseTo(1.1 * 1.1 * 0.9 - 1);
  });
});

describe('cost basis', () => {
  const book: PriceBook = {};
  it('average cost and realized P/L for SDCA BTC', () => {
    const s1: Signal = { date: '2026-01-02', createdAt: 0, px: { BTC: 100 }, sdca: { pct: 100, cash: 1000, btc: 0 }, rsps: { alloc: { CASH: 100 }, cash: 0, units: {} } };
    const s2: Signal = { date: '2026-01-03', createdAt: 0, px: { BTC: 200 }, sdca: { pct: 100, cash: 1000, btc: 10 }, rsps: { alloc: { CASH: 100 }, cash: 0, units: {} } };
    const s3: Signal = { date: '2026-01-04', createdAt: 0, px: { BTC: 300 }, sdca: { pct: -50, cash: 0, btc: 15 }, rsps: { alloc: { CASH: 100 }, cash: 0, units: {} } };
    const p = costBasis([s1, s2, s3], book)['SDCA:BTC'];
    // 10 @100 + 5 @200 = 15 for 2000 (avg 133.33); sell 7.5 @300 = 2250 − 1000 cost = +1250
    expect(p.units).toBeCloseTo(7.5); expect(p.cost).toBeCloseTo(1000); expect(p.realized).toBeCloseTo(1250);
    expect(p.realizedByYear['2026']).toBeCloseTo(1250);
  });
  it('RSPS rebalance sells at a profit', () => {
    const s1: Signal = { date: '2026-01-02', createdAt: 0, px: { BTC: 1, SOL: 10 }, sdca: { pct: 0, cash: 0, btc: 0 }, rsps: { alloc: { SOL: 100 }, cash: 1000, units: {} } };
    const s2: Signal = { date: '2026-01-03', createdAt: 0, px: { BTC: 1, SOL: 20 }, sdca: { pct: 0, cash: 0, btc: 0 }, rsps: { alloc: { SOL: 50, CASH: 50 }, cash: 0, units: { SOL: 100 } } };
    const p = costBasis([s1, s2], book)['RSPS:SOL'];
    expect(p.units).toBeCloseTo(50); expect(p.realized).toBeCloseTo(50 * 20 - 500);
  });
});
