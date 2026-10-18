import { describe, expect, it } from 'vitest';
import { dcaOrder, etfCostBasis, executeEtf, simulateEtf, type EtfSignal } from './etf';
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
