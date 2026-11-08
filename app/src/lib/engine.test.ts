import { describe, expect, it } from 'vitest';
import { allocError, costBasis, fillCash, frozenCash, liqPrice, rebalance, sdcaOrder, simulate, benchmark, type PerpData, type Signal } from './engine';
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
  it('keeps a strategy unchanged when it has no new signal that day', () => {
    const next: Signal = { ...sig, date: '2026-01-03', px: { BTC: 99, SOL: 11 }, sdcaNew: false, rspsNew: false,
      sdca: { pct: -100, cash: 0, btc: 1000 / 100 }, rsps: { alloc: { CASH: 100 }, cash: 500, units: { SOL: 50 } } };
    const sim = simulate([sig, next], book, '2026-01-03')!;
    expect(sim.rows[1].sdca?.side).toBe('hold');        // the -100% is ignored
    expect(sim.rows[1].rsps).toBeNull();                 // no rebalance
    expect(sim.sdca.btc).toBeCloseTo(10); expect(sim.rsps.units.SOL).toBe(50);
  });
  it('computes buy & hold benchmarks', () => {
    expect(benchmark(book, 'BTC', '2026-01-01', ['2026-01-02', '2026-01-03'])).toEqual([expect.closeTo(0.1), expect.closeTo(-0.01)]);
  });
});

describe('several signals on one day', () => {
  const book: PriceBook = { BTC: { '2026-01-01': 100, '2026-01-02': 120 } };
  const base = { rsps: { alloc: { CASH: 100 }, cash: 0, units: {} } };
  it('executes them in order and chains the day return through each execution', () => {
    const a: Signal = { id: 'a', date: '2026-01-02', createdAt: 1, px: { BTC: 100 }, sdca: { pct: 50, cash: 1000, btc: 0 }, ...base };
    const b: Signal = { id: 'b', date: '2026-01-02', createdAt: 2, px: { BTC: 110 }, sdca: { pct: 100, cash: 500, btc: 5 }, ...base };
    const sim = simulate([b, a], book, '2026-01-02')!;
    const row = sim.rows[0];
    expect(row.execs.map((e) => e.signal.id)).toEqual(['a', 'b']);
    expect(sim.sdca.cash).toBe(0);
    expect(sim.sdca.btc).toBeCloseTo(5 + 500 / 110);
    // 1000 → (500 cash + 5 BTC) → at 110: 1050 → all BTC → at 120: 1050 × 120/110
    expect(row.rSdca).toBeCloseTo((1050 * 120 / 110) / 1000 - 1);
    expect(row.invested).toBeCloseTo(1000);
  });
});

describe('fillCash', () => {
  it('puts the rest of an allocation under 100% into CASH', () => {
    expect(fillCash({ BTC: 30, ETH: 20 })).toEqual({ alloc: { BTC: 30, ETH: 20, CASH: 50 }, added: 50 });
  });
  it('adds to a CASH row that is already there', () => {
    expect(fillCash({ OP: 5, ICP: 5, CASH: 10 })).toEqual({ alloc: { OP: 5, ICP: 5, CASH: 90 }, added: 80 });
  });
  it('leaves a full, empty or over-100% allocation unchanged', () => {
    expect(fillCash({ BTC: 60, CASH: 40 }).added).toBe(0);
    expect(fillCash({}).added).toBe(0);
    expect(fillCash({ BTC: 0 }).added).toBe(0);
    expect(fillCash({ BTC: 70, ETH: 40 })).toEqual({ alloc: { BTC: 70, ETH: 40 }, added: 0 });
  });
  it('the filled allocation passes the 100% check', () => {
    const { alloc } = fillCash({ OP: 5, ICP: 5, ARB: 5, SUI: 5, SHIB: 5, DASH: 5, ALGO: 5, FIL: 5, INJ: 2.5, XMR: 2.5 });
    expect(alloc.CASH).toBe(55);
    expect(allocError(alloc)).toBeNull();
  });
});

describe('RSPS short', () => {
  const px = (p: Record<string, number>) => (s: string) => ({ CASH: 1, ...p } as Record<string, number>)[s];
  it('accepts shorts only where allowed, never for CASH, and counts |weight| towards 100%', () => {
    expect(allocError({ OP: -50, CASH: 50 }, undefined, undefined, true)).toBeNull();
    expect(allocError({ OP: -50, CASH: 50 })).toMatch(/≥ 0%/);                       // stocks / default: no shorts
    expect(allocError({ OP: 50, CASH: -50 }, undefined, undefined, true)).toMatch(/CASH cannot be short/);
    expect(allocError({ OP: -50, ARB: -50 }, undefined, undefined, true)).toBeNull();
    expect(allocError({ OP: -60, ARB: 60 }, undefined, undefined, true)).toMatch(/120\.00%/);
  });
  it('fills the rest with CASH using the size of the shorts', () => {
    const f = fillCash({ OP: -5, ICP: -5, INJ: -2.5 });
    expect(f.added).toBeCloseTo(87.5); expect(f.alloc.CASH).toBeCloseTo(87.5);
  });
  it('opens a short as negative units, keeps the proceeds in cash and the value unchanged', () => {
    const p = rebalance({ alloc: { OP: -50, CASH: 50 }, cash: 1000, units: {} }, px({ OP: 10 }));
    expect(p.after.units.OP).toBeCloseTo(-50);
    expect(p.after.cash).toBeCloseTo(1500);
    expect(p.after.cash + p.after.units.OP * 10).toBeCloseTo(1000);
  });
  it('gains when the price falls and loses when it rises (50% short)', () => {
    const { after } = rebalance({ alloc: { OP: -50, CASH: 50 }, cash: 1000, units: {} }, px({ OP: 10 }));
    expect(after.cash + after.units.OP * 5).toBeCloseTo(1250);    // −50% price → +25%
    expect(after.cash + after.units.OP * 12).toBeCloseTo(900);    // +20% price → −10%
  });
  it('covers and flips: from a short to a long', () => {
    const p = rebalance({ alloc: { OP: 40, CASH: 60 }, cash: 1500, units: { OP: -50 } }, px({ OP: 10 }));   // value 1000
    expect(p.total).toBeCloseTo(1000);
    expect(p.after.units.OP).toBeCloseTo(40); expect(p.after.cash).toBeCloseTo(600);
  });
  it('mixes longs and shorts and keeps the value', () => {
    const p = rebalance({ alloc: { SOL: 30, OP: -20, CASH: 50 }, cash: 1000, units: {} }, px({ SOL: 100, OP: 2 }));
    const v = p.after.cash + p.after.units.SOL * 100 + p.after.units.OP * 2;
    expect(v).toBeCloseTo(1000); expect(p.after.units.SOL).toBeCloseTo(3); expect(p.after.units.OP).toBeCloseTo(-100);
  });
  it('takes the fee from the value, also on shorts', () => {
    const p = rebalance({ alloc: { OP: -50, CASH: 50 }, cash: 1000, units: {} }, px({ OP: 10 }), 0.001);
    expect(p.fee).toBeCloseTo(0.5);
    expect(p.after.cash + p.after.units.OP * 10).toBeCloseTo(999.5);
  });
  it('realizes the P/L of a short when it is covered (average entry price)', () => {
    const book: PriceBook = {};
    const base = { createdAt: 1, sdcaNew: false, sdca: { pct: 0, cash: 0, btc: 0 } };
    const s1: Signal = { ...base, date: '2026-01-02', px: { OP: 10 }, rsps: { alloc: { OP: -50, CASH: 50 }, cash: 1000, units: {} } };
    const s2: Signal = { ...base, createdAt: 2, date: '2026-01-05', px: { OP: 8 }, rsps: { alloc: { CASH: 100 }, cash: 1500, units: { OP: -50 } } };
    const one = costBasis([s1], book)['RSPS:OP'];
    expect(one.units).toBeCloseTo(-50); expect(one.cost / one.units).toBeCloseTo(10);   // average entry 10
    const two = costBasis([s1, s2], book)['RSPS:OP'];
    expect(two.units).toBe(0); expect(two.realized).toBeCloseTo(100);                  // sold at 10, bought back at 8
    expect(two.realizedByYear['2026']).toBeCloseTo(100);
  });
  it('a long-only allocation gives the same plan as before', () => {
    const p = rebalance({ alloc: { ETH: 10, SOL: 40, CASH: 50 }, cash: 0, units: { SOL: 100 } }, px({ ETH: 2000, SOL: 100 }));
    expect(p.after.cash).toBeCloseTo(5000); expect(p.after.units.SOL).toBeCloseTo(40); expect(p.after.units.ETH).toBeCloseTo(0.5);
  });
});

describe('RSPS short: funding and liquidation (perp 1×)', () => {
  // OP short 50% of 1000 at 10 on 2026-01-02; prices by day
  const btc = { '2026-01-01': 1, '2026-01-02': 1, '2026-01-03': 1, '2026-01-04': 1 };
  const book: PriceBook = { BTC: btc, OP: { '2026-01-01': 10, '2026-01-02': 10, '2026-01-03': 10, '2026-01-04': 10 } };
  const sig: Signal = { date: '2026-01-02', createdAt: 1, sdcaNew: false, px: { OP: 10 }, sdca: { pct: 0, cash: 0, btc: 0 }, rsps: { alloc: { OP: -50, CASH: 50 }, cash: 1000, units: {} } };
  const perp = (p: Partial<PerpData>): PerpData => ({ high: {}, funding: {}, mm: {}, ...p });

  it('liquidation price of a 1× short: 2 × entry / (1 + MM)', () => {
    expect(liqPrice(10, 0.1)).toBeCloseTo(18.1818);
    expect(liqPrice(10, 0.05)).toBeCloseTo(19.0476);
  });
  it('a positive funding rate pays the short, a negative one costs it', () => {
    const s = simulate([sig], book, '2026-01-04', perp({ funding: { OP: { '2026-01-03': 0.001, '2026-01-04': -0.0005 } } }))!;
    const d3 = s.rows.find((r) => r.date === '2026-01-03')!, d4 = s.rows.find((r) => r.date === '2026-01-04')!;
    expect(d3.fundingUsd).toBeCloseTo(0.5);       // 50 OP × 10 × 0.1%
    expect(d4.fundingUsd).toBeCloseTo(-0.25);
    expect(d4.value).toBeCloseTo(1000.25);
    expect(s.events.filter((e) => e.kind === 'funding')).toHaveLength(2);
  });
  it('liquidates the short when the day high reaches the liquidation price and loses the margin', () => {
    const s = simulate([sig], book, '2026-01-04', perp({ high: { OP: { '2026-01-03': 18.5 } }, mm: { OP: 0.1 } }))!;
    const d3 = s.rows.find((r) => r.date === '2026-01-03')!;
    expect(d3.liquidations).toHaveLength(1);
    expect(d3.liquidations[0].price).toBeCloseTo(18.1818); expect(d3.liquidations[0].loss).toBeCloseTo(500);
    expect(s.rsps.units.OP).toBeUndefined();
    expect(d3.value).toBeCloseTo(500);            // 1000 − the 500 margin of the short
    expect(s.rows.at(-1)!.value).toBeCloseTo(500);
  });
  it('does not liquidate below the liquidation price', () => {
    const s = simulate([sig], book, '2026-01-04', perp({ high: { OP: { '2026-01-03': 18 } }, mm: { OP: 0.1 } }))!;
    expect(s.rows.every((r) => r.liquidations.length === 0)).toBe(true);
    expect(s.rsps.units.OP).toBeCloseTo(-50); expect(s.shortEntry.OP).toBeCloseTo(10);
  });
  it('averages the entry when a short is increased', () => {
    const b2: PriceBook = { BTC: btc, OP: { '2026-01-01': 10, '2026-01-02': 10, '2026-01-03': 12, '2026-01-04': 12 } };
    // value at 12: 1500 − 600 = 900 → short 100% = 75 OP; 25 more OP shorted at 12 → entry (50×10 + 25×12) / 75
    const s2: Signal = { date: '2026-01-03', createdAt: 2, sdcaNew: false, px: { OP: 12 }, sdca: { pct: 0, cash: 0, btc: 0 }, rsps: { alloc: { OP: -100 }, cash: 1500, units: { OP: -50 } } };
    const s = simulate([sig, s2], b2, '2026-01-04')!;
    expect(s.rsps.units.OP).toBeCloseTo(-75); expect(s.shortEntry.OP).toBeCloseTo(10.6667);
  });
  it('a 1× short is liquidated when the price doubles, even without perp data (close used as the high)', () => {
    const b3: PriceBook = { BTC: btc, OP: { '2026-01-01': 10, '2026-01-02': 10, '2026-01-03': 20, '2026-01-04': 20 } };
    const s = simulate([sig], b3, '2026-01-04')!;
    expect(s.rsps.units.OP).toBeUndefined(); expect(s.rows.at(-1)!.value).toBeCloseTo(500);
  });
  it('books funding and the liquidation loss as realized P/L', () => {
    const s = simulate([sig], book, '2026-01-04', perp({ funding: { OP: { '2026-01-03': 0.001 } }, high: { OP: { '2026-01-04': 19 } }, mm: { OP: 0.1 } }))!;
    const pos = costBasis([sig], book, s.events)['RSPS:OP'];
    expect(pos.units).toBe(0);
    expect(pos.realized).toBeCloseTo(0.5 - 500);
  });
});

describe('frozen cash of shorts', () => {
  it('freezes margin + entry value (2 × size) and leaves the rest free', () => {
    // 1000 RSPS: 50% CASH, 50% OP short at $2 → 250 OP short, cash 500 + 2 × 500 = 1500, of which 1000 frozen
    const plan = rebalance({ alloc: { CASH: 50, OP: -50 }, cash: 1000, units: {} }, (s) => (s === 'CASH' ? 1 : 2));
    expect(plan.after.units.OP).toBeCloseTo(-250);
    const frozen = frozenCash(plan.after.units, () => 2);
    expect(frozen).toBeCloseTo(1000);
    expect(plan.after.cash - frozen).toBeCloseTo(500);
  });
  it('uses the entry price, falls back when it is unknown, ignores longs', () => {
    expect(frozenCash({ OP: -10, BTC: 1 }, (s) => (s === 'OP' ? 3 : NaN))).toBeCloseTo(60);
    expect(frozenCash({ OP: -10 }, () => NaN, () => 4)).toBeCloseTo(80);
    expect(frozenCash({ OP: -10 }, () => NaN)).toBe(0);
  });
});
