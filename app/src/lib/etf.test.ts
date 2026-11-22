import { describe, expect, it } from 'vitest';
import { dcaOrder, etfCostBasis, executeEtf, orderFee, positionTrades, simulateEtf, type EtfSignal } from './etf';
import type { PriceBook } from './prices';

const px = (s: string) => ({ A: 10, B: 20, CASH: 1 } as Record<string, number>)[s];

describe('ETF DCA', () => {
  it('buys x% of cash split by the target weights, keeping fractional shares', () => {
    const o = dcaOrder({ cash: 1000, units: {} }, 10, { A: 75, B: 25 }, px, ['A', 'B']);
    expect(o.rows.map((r) => [r.sym, r.usd, r.units])).toEqual([['A', 75, 7.5], ['B', 25, 1.25]]);
    expect(o.after.cash).toBe(900);
  });
  it('sells x% of every position', () => {
    const o = dcaOrder({ cash: 0, units: { A: 10, B: 5 } }, -50, {}, px, ['A', 'B']);
    expect(o.after.units).toEqual({ A: 5, B: 2.5 }); expect(o.after.cash).toBe(100);
  });
});

describe('ETF signals', () => {
  const sig = (p: Partial<EtfSignal>): EtfSignal => ({ id: 'x', date: '2026-01-02', createdAt: 1, cash: 1000, units: {}, alloc: { A: 50, CASH: 50 }, rebalance: true, dca: null, px: { A: 10, B: 20 }, ...p });
  it('rebalance first, then DCA from the remaining cash', () => {
    const ex = executeEtf(sig({ dca: 50 }), px, ['A', 'B']);
    // rebalance: 500 in A (50 units), 500 cash; DCA 50% of 500 = 250 → A (only non-cash weight) = 25 units
    expect(ex.after.units.A).toBeCloseTo(75); expect(ex.after.cash).toBeCloseTo(250);
  });
  it('simulates returns and cost basis', () => {
    const book: PriceBook = { A: { '2026-01-01': 10, '2026-01-02': 11, '2026-01-05': 12 }, SPY: { '2026-01-01': 100, '2026-01-02': 101 } };
    const sim = simulateEtf([sig({})], book, '2026-01-05', ['A'])!;
    expect(sim.rows[0].r).toBeCloseTo(0.05);                  // half in A, +10%
    expect(sim.rows.at(-1)!.value).toBeCloseTo(500 + 50 * 12);   // weekend forward-filled, Monday close
    const pos = etfCostBasis([sig({}), sig({ id: 'y', date: '2026-01-05', createdAt: 2, units: { A: 50 }, cash: 500, alloc: { CASH: 100 }, px: { A: 12 } })], book, ['A']);
    expect(pos.A.realized).toBeCloseTo(50 * 2);
  });
});

describe('position orders', () => {
  const px = (s: string) => ({ VWCE: 100, SGLN: 50 } as Record<string, number>)[s] ?? 1;
  it('targets a weight, sells first and buys within cash', () => {
    // total 2000: VWCE 1000 (50%), SGLN 500, cash 500
    const t = positionTrades({ cash: 500, units: { VWCE: 10, SGLN: 10 } }, [{ sym: 'VWCE', mode: 'target', pct: 20 }, { sym: 'SGLN', mode: 'target', pct: 60 }], px);
    expect(t.after.units.VWCE).toBeCloseTo(4);           // 400 USD = 20%
    expect(t.after.units.SGLN).toBeCloseTo(24);          // 1200 USD = 60%, funded by the VWCE sale
    expect(t.after.cash).toBeCloseTo(400);
  });
  it('sells x% of a position and caps buys at the cash', () => {
    const t = positionTrades({ cash: 100, units: { VWCE: 10 } }, [{ sym: 'VWCE', mode: 'sell', pct: 50 }, { sym: 'SGLN', mode: 'target', pct: 90 }], px);
    expect(t.after.units.VWCE).toBeCloseTo(5);
    expect(t.after.cash).toBeCloseTo(0);
    expect(t.after.units.SGLN).toBeCloseTo(12);          // 600 USD available, target would need 990
  });
  it('runs inside a signal after the rebalance', () => {
    const ex = executeEtf({ id: 'x', date: '2026-01-01', createdAt: 1, cash: 1000, units: {}, alloc: {}, rebalance: false, dca: null, px: {}, orders: [{ sym: 'VWCE', mode: 'buy', pct: 50 }] }, px, ['VWCE']);
    expect(ex.after.units.VWCE).toBeCloseTo(5);
    expect(ex.after.cash).toBeCloseTo(500);
  });
});

describe('IBKR Fixed (Europe) fees: 0.05%, minimum per order (22.11.2026)', () => {
  const px = (s: string) => ({ CASH: 1, VWCE: 100, SGLN: 50 } as Record<string, number>)[s];
  const min = { VWCE: 3.3, SGLN: 3.9 };
  it('small orders pay the minimum, large ones 0.05%', () => {
    expect(orderFee('VWCE', 500, 0.0005, min)).toBeCloseTo(3.3);
    expect(orderFee('VWCE', 20000, 0.0005, min)).toBeCloseTo(10);
    expect(orderFee('VWCE', 0, 0.0005, min)).toBe(0);
    expect(orderFee('VWCE', 500, 0.0005)).toBeCloseTo(0.25);   // old signals: no minimum
  });
  it('DCA buy charges the minimum per ticker order', () => {
    const o = dcaOrder({ cash: 1000, units: {} }, 50, { VWCE: 50, SGLN: 50 }, px, ['VWCE', 'SGLN'], 0.0005, min);
    expect(o.fee).toBeCloseTo(3.3 + 3.9);
    expect(o.rows.find((r) => r.sym === 'VWCE')!.units).toBeCloseTo((250 - 3.3) / 100);
    expect(o.after.cash).toBeCloseTo(500);
  });
  it('a position buy smaller than the minimum fee is skipped; a sell pays the minimum', () => {
    const t = positionTrades({ cash: 2, units: { SGLN: 10 } }, [{ sym: 'VWCE', mode: 'buy', pct: 100 }, { sym: 'SGLN', mode: 'sell', pct: 10 }], px, 0.0005, min);
    expect(t.rows.find((r) => r.sym === 'SGLN')!.usd).toBeCloseTo(50 - 3.9);
    expect(t.after.units.SGLN).toBeCloseTo(9);
  });
  it('rebalance uses the per-order minimum when the signal stores it', () => {
    const sig = { id: 'a', date: '2026-01-02', createdAt: 1, cash: 1000, units: {}, alloc: { VWCE: 50, CASH: 50 }, rebalance: true, dca: null, px: { VWCE: 100 }, fee: 0.0005, feeMin: min };
    const ex = executeEtf(sig, px, ['VWCE', 'SGLN']);
    expect(ex.plan!.fee).toBeCloseTo(3.3);
  });
});
