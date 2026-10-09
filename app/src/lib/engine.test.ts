import { describe, expect, it } from 'vitest';
import { allocError, rebalance, sdcaOrder, simulate, benchmark, type Signal } from './engine';
import type { PriceBook } from './prices';

describe('SDCA', () => {
  it('buys x% of the SDCA cash reserve', () => {
    const o = sdcaOrder({ pct: 1, cash: 100, btc: 0.05 }, 100_000);
    expect(o.side).toBe('buy'); expect(o.usd).toBeCloseTo(1); expect(o.btc).toBeCloseTo(0.00001);
    expect(o.after).toEqual({ cash: 99, btc: expect.closeTo(0.05001) });
  });
  it('sells x% of the BTC held at the given price', () => {
    const o = sdcaOrder({ pct: -5, cash: 0, btc: 0.2 }, 80_000);
    expect(o.side).toBe('sell'); expect(o.btc).toBeCloseTo(0.01); expect(o.usd).toBeCloseTo(800);
    expect(o.after).toEqual({ cash: expect.closeTo(800), btc: expect.closeTo(0.19) });
  });
  it('never spends more than the cash or sells more than the BTC', () => {
    expect(sdcaOrder({ pct: 150, cash: 1000, btc: 0 }, 100).after.cash).toBe(0);
    expect(sdcaOrder({ pct: -150, cash: 0, btc: 1 }, 100).after.btc).toBe(0);
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
  it('executes at the prices stored with the signal', () => {
    const sim = simulate([{ ...sig, px: { BTC: 105, SOL: 10 } }], book, '2026-01-02')!;
    // BTC bought at 105, closes at 110 → +4.76% on the SDCA part
    expect(sim.rows[0].rSdca).toBeCloseTo(110 / 105 - 1);
    expect(sim.sdca.btc).toBeCloseTo(1000 / 105);
  });
  it('chains the old holdings until execution with the new holdings after it', () => {
    const next: Signal = { ...sig, date: '2026-01-03', px: { BTC: 99, SOL: 11 }, sdca: { pct: -100, cash: 0, btc: 10 }, rsps: { alloc: { CASH: 100 }, cash: 500, units: { SOL: 50 } } };
    const sim = simulate([sig, next], book, '2026-01-03')!;
    expect(sim.rows[1].rSdca).toBeCloseTo(99 / 110 - 1);           // held BTC until the sell, then cash
    expect(sim.rows[1].rRsps).toBeCloseTo((500 + 50 * 11) / 1000 - 1); // SOL 10 → 11, then all cash
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
