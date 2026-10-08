import { describe, expect, it } from 'vitest';
import { allocError, rebalance, sdcaOrder, simulate, benchmark, type Signal } from './engine';
import type { PriceBook } from './prices';

describe('SDCA', () => {
  it('buys a % of the SDCA part from SDCA cash', () => {
    const o = sdcaOrder({ pct: 10, cash: 5000, btc: 0.05 }, 100_000);   // part = 10 000
    expect(o.side).toBe('buy'); expect(o.usd).toBeCloseTo(1000); expect(o.btc).toBeCloseTo(0.01);
    expect(o.after).toEqual({ cash: 4000, btc: expect.closeTo(0.06) });
  });
  it('never buys more than the SDCA cash', () => {
    const o = sdcaOrder({ pct: 50, cash: 1000, btc: 0.09 }, 100_000);   // wants 5 000
    expect(o.usd).toBe(1000); expect(o.capped).toBe(true); expect(o.after.cash).toBe(0);
  });
  it('never sells more BTC than held', () => {
    const o = sdcaOrder({ pct: -80, cash: 9000, btc: 0.01 }, 100_000);  // wants 0.08 BTC
    expect(o.btc).toBe(0.01); expect(o.capped).toBe(true); expect(o.after).toEqual({ cash: 10_000, btc: 0 });
  });
});

describe('RSPS', () => {
  it('validates the allocation', () => {
    expect(allocError({ ETH: 10, SOL: 40, CASH: 50 })).toBeNull();
    expect(allocError({ ETH: 10, SOL: 40 })).toMatch(/100%/);
    expect(allocError({ ETH: 50, FOO: 50 })).toMatch(/not on the RSPS list/);
  });
  it('plans buys and sells to the target', () => {
    const px = (s: string) => ({ CASH: 1, ETH: 2000, SOL: 100 } as Record<string, number>)[s];
    const p = rebalance({ alloc: { ETH: 10, SOL: 40, CASH: 50 }, cash: 0, units: { SOL: 100 } }, px); // 10 000 in SOL
    const row = (s: string) => p.rows.find((r) => r.sym === s)!;
    expect(p.total).toBe(10_000);
    expect(row('SOL').deltaUsd).toBe(-6000); expect(row('SOL').deltaUnits).toBe(-60);
    expect(row('ETH').deltaUsd).toBe(1000); expect(row('ETH').deltaPct).toBe(10);
    expect(row('CASH').deltaUsd).toBe(5000);
    expect(p.after).toEqual({ cash: 5000, units: { ETH: 0.5, SOL: 40 } });
  });
});

describe('simulation', () => {
  const book: PriceBook = {
    BTC: { '2026-01-01': 100, '2026-01-02': 110, '2026-01-03': 99 },
    SOL: { '2026-01-01': 10, '2026-01-02': 10, '2026-01-03': 12 }
  };
  const sig: Signal = {
    date: '2026-01-02', createdAt: 0,
    sdca: { pct: 100, cash: 1000, btc: 0 },                       // all-in BTC
    rsps: { alloc: { SOL: 50, CASH: 50 }, cash: 1000, units: {} }
  };
  it('keeps strategies separate and carries the allocation on DUPLICATED days', () => {
    const sim = simulate([sig], book, '2026-01-03')!;
    expect(sim.start).toBe('2026-01-01');
    const [d1, d2] = sim.rows;
    expect(d1.duplicated).toBe(false); expect(d2.duplicated).toBe(true);
    expect(d1.rSdca).toBeCloseTo(0.10); expect(d1.rRsps).toBeCloseTo(0);
    expect(d2.rSdca).toBeCloseTo(-0.10); expect(d2.rRsps).toBeCloseTo(0.10);   // 50 SOL +20%, 50 cash
    expect(d1.r).toBeCloseTo(0.05);
    expect(d2.sdcaValue).toBeCloseTo(990); expect(d2.rspsValue).toBeCloseTo(1100);
    expect(d2.totalGain).toBeCloseTo((2090 / 2000) - 1);
    expect(d2.invested).toBe(2000);
  });
  it('treats typed-in extra cash as a deposit, not performance', () => {
    const next: Signal = { ...sig, date: '2026-01-03', sdca: { pct: 0, cash: 500, btc: 10 }, rsps: { alloc: { CASH: 100 }, cash: 1000, units: {} } };
    const sim = simulate([sig, next], book, '2026-01-03')!;
    expect(sim.rows[1].invested).toBeCloseTo(2500);
    expect(sim.rows[1].rRsps).toBe(0);
  });
  it('computes buy & hold benchmarks', () => {
    expect(benchmark(book, 'BTC', '2026-01-01', ['2026-01-02', '2026-01-03'])).toEqual([expect.closeTo(0.1), expect.closeTo(-0.01)]);
  });
});
