// Stocks and AI Apocalypse portfolios: one strategy each (cash + ETF units), daily closes in USD from markets.json.
// A signal can carry a DCA order (buy x% of the cash split by the target weights, or sell x% of every position) and/or
// a rebalance to new target weights (incl. CASH). With both, the rebalance runs first and the DCA uses what is left.
// Orders use the latest close (stock prices are not live); saving stores those prices as the execution prices.
// Shares are kept exactly as bought (amount / price, no rounding). Same-day signals chain like in the crypto engine.
import { rebalance, riskStats, type RebalancePlan } from './engine';
import { CASH } from './tokens';
import { addDays, daysBetween } from './utc';
import type { PriceBook } from './prices';

export interface EtfUniverse { id: 'stocks' | 'ai'; title: string; tickers: string[]; benchmarks: string[]; defaultBench: string[]; defaultAlloc: Record<string, number>; }

export const UNIVERSES: Record<'stocks' | 'ai', EtfUniverse> = {
  stocks: {
    id: 'stocks', title: 'Stock portfolio', tickers: ['VWCE', 'IS04', 'SGLN', 'TRET'], benchmarks: ['SPY', 'QQQ', 'VWCE', 'IS04', 'SGLN', 'TRET'],
    defaultBench: ['SPY', 'VWCE'], defaultAlloc: { VWCE: 25, IS04: 25, SGLN: 25, TRET: 25 }
  },
  ai: {
    id: 'ai', title: 'AI Apocalypse Portfolio', tickers: ['SMH', 'DTCR', 'NLR', 'CIBR', 'IGV', 'BOTZ'], benchmarks: ['SPY', 'QQQ', 'SMH', 'DTCR', 'NLR', 'CIBR', 'IGV', 'BOTZ'],
    defaultBench: ['SPY', 'QQQ'], defaultAlloc: { SMH: 25, DTCR: 15, NLR: 20, CIBR: 15, IGV: 15, BOTZ: 10 }
  }
};

export interface EtfState { cash: number; units: Record<string, number>; }
export interface EtfSignal {
  id: string; date: string; createdAt: number;
  cash: number; units: Record<string, number>;      // holdings typed in / carried before the orders
  alloc: Record<string, number>;                    // target weights in force after this signal (incl. CASH)
  rebalance: boolean;                               // new target weights → rebalance
  dca: number | null;                               // > 0 buy x% of cash by the weights, < 0 sell x% of every position, null = no DCA
  px: Record<string, number>; fee?: number;
}

export interface DcaOrder { side: 'buy' | 'sell'; pct: number; rows: { sym: string; usd: number; units: number; price: number }[]; fee: number; after: EtfState; }

/** DCA: buy pct% of the cash split by the non-cash target weights (equal weights if none), or sell pct% of every position. */
export function dcaOrder(st: EtfState, pct: number, alloc: Record<string, number>, px: (s: string) => number, tickers: string[], fee = 0): DcaOrder {
  const p = Math.min(Math.abs(pct), 100) / 100;
  const units = { ...st.units };
  if (pct > 0) {
    const w = Object.entries(alloc).filter(([k, v]) => k !== CASH && v > 0);
    const weights = w.length ? w : tickers.map((t) => [t, 1] as [string, number]);
    const sum = weights.reduce((t, [, v]) => t + v, 0), spend = p * Math.max(st.cash, 0);
    const rows = weights.map(([sym, v]) => { const usd = spend * v / sum, price = px(sym); return { sym, usd, units: usd * (1 - fee) / price, price }; });
    for (const r of rows) units[r.sym] = (units[r.sym] ?? 0) + r.units;
    return { side: 'buy', pct: p, rows, fee: spend * fee, after: { cash: st.cash - spend, units } };
  }
  const rows = Object.entries(st.units).filter(([, u]) => u > 0).map(([sym, u]) => { const price = px(sym), n = u * p; return { sym, usd: n * price * (1 - fee), units: n, price }; });
  for (const r of rows) units[r.sym] -= r.units;
  const gross = rows.reduce((t, r) => t + r.units * r.price, 0);
  return { side: 'sell', pct: p, rows, fee: gross * fee, after: { cash: st.cash + gross * (1 - fee), units } };
}

export interface EtfExec { signal: EtfSignal; plan: RebalancePlan | null; dca: DcaOrder | null; after: EtfState; }
export function executeEtf(sig: EtfSignal, px: (s: string) => number, tickers: string[]): EtfExec {
  const fee = sig.fee ?? 0;
  let st: EtfState = { cash: sig.cash, units: { ...sig.units } };
  const plan = sig.rebalance ? rebalance({ alloc: sig.alloc, cash: st.cash, units: st.units }, px, fee) : null;
  if (plan) st = plan.after;
  const dca = sig.dca ? dcaOrder(st, sig.dca, sig.alloc, px, tickers, fee) : null;
  if (dca) st = dca.after;
  return { signal: sig, plan, dca, after: st };
}

/** Close on `day`, forward-filled over weekends and holidays (up to 10 days). */
export function etfPrice(book: PriceBook, sym: string, day: string) {
  if (sym === CASH) return 1;
  const s = book[sym]; if (!s) return NaN;
  for (let i = 0, d = day; i < 11; i++, d = addDays(d, -1)) if (s[d] !== undefined) return s[d];
  return NaN;
}
/** Date of the latest close at or before `day`. */
export function lastCloseDate(book: PriceBook, sym: string, day: string) {
  const s = book[sym]; if (!s) return null;
  for (let i = 0, d = day; i < 11; i++, d = addDays(d, -1)) if (s[d] !== undefined) return d;
  return null;
}

const value = (st: EtfState, px: (s: string) => number) => Object.entries(st.units).reduce((t, [k, u]) => t + u * px(k), st.cash);
const ret = (v1: number, v0: number) => (v0 > 1e-9 && Number.isFinite(v1 / v0) ? v1 / v0 - 1 : 0);

export interface EtfRow {
  date: string; signal: EtfSignal; duplicated: boolean; execs: EtfExec[];
  value: number; r: number; totalGain: number; benchDay: number; invested: number;
}
export const etfOrder = (a: EtfSignal, b: EtfSignal) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt;

export function simulateEtf(signals: EtfSignal[], book: PriceBook, today: string, tickers: string[], bench = 'SPY') {
  const sorted = [...signals].sort(etfOrder);
  if (!sorted.length) return null;
  const byDate = new Map<string, EtfSignal[]>();
  for (const s of sorted) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const start = addDays(sorted[0].date, -1);
  let st: EtfState = { cash: 0, units: {} }, active = sorted[0], idx = 1, invested = 0, started = false;
  const rows: EtfRow[] = [];
  for (const d of daysBetween(sorted[0].date, today < sorted[0].date ? sorted[0].date : today)) {
    const p0 = (s: string) => etfPrice(book, s, addDays(d, -1)), p1 = (s: string) => etfPrice(book, s, d);
    let g = 1, from = p0;
    const execs: EtfExec[] = [];
    for (const sig of byDate.get(d) ?? []) {
      active = sig;
      const pe = (s: string) => sig.px?.[s] ?? p0(s);
      if (started) g *= 1 + ret(value(st, pe), value(st, from));
      const typed = value({ cash: sig.cash, units: sig.units }, pe), carried = started ? value(st, pe) : 0;
      if (Number.isFinite(typed - carried)) invested += typed - carried;
      const ex = executeEtf(sig, pe, tickers);
      execs.push(ex); st = ex.after; from = pe; started = true;
    }
    const v1 = value(st, p1), r = g * (1 + ret(v1, value(st, from))) - 1;
    idx *= 1 + r;
    rows.push({ date: d, signal: active, duplicated: !execs.length, execs, value: v1, r, totalGain: idx - 1, benchDay: ret(p1(bench), p0(bench)), invested });
  }
  return { start, rows, state: st };
}

export function benchmarkEtf(book: PriceBook, sym: string, start: string, days: string[]) {
  const base = etfPrice(book, sym, start);
  return days.map((d) => ret(etfPrice(book, sym, d), base));
}

/** Average-cost basis per ticker from the signals at their execution prices (typed-in units count at that day's price). */
export function etfCostBasis(signals: EtfSignal[], book: PriceBook, tickers: string[]) {
  const pos: Record<string, { units: number; cost: number; realized: number; realizedByYear: Record<string, number> }> = {};
  const P = (k: string) => (pos[k] ??= { units: 0, cost: 0, realized: 0, realizedByYear: {} });
  const add = (k: string, u: number, c: number) => { const p = P(k); p.units += u; p.cost += c; };
  const remove = (k: string, u: number, proceeds: number | null, year: string) => {
    const p = P(k); if (p.units <= 1e-12) return;
    const n = Math.min(u, p.units), basis = p.cost * (n / p.units);
    p.units -= n; p.cost -= basis;
    if (proceeds !== null) { const pl = proceeds * (n / u) - basis; p.realized += pl; p.realizedByYear[year] = (p.realizedByYear[year] ?? 0) + pl; }
  };
  for (const sig of [...signals].sort(etfOrder)) {
    const pe = (s: string) => sig.px?.[s] ?? etfPrice(book, s, addDays(sig.date, -1)), year = sig.date.slice(0, 4), fee = sig.fee ?? 0;
    for (const s of new Set([...Object.keys(sig.units), ...Object.keys(pos)])) {
      const d = (sig.units[s] ?? 0) - (pos[s]?.units ?? 0);
      if (d > 1e-12) add(s, d, d * pe(s)); else if (d < -1e-12) remove(s, -d, null, year);
    }
    const ex = executeEtf(sig, pe, tickers);
    for (const s of new Set([...Object.keys(sig.units), ...Object.keys(ex.after.units)])) {
      const d = (ex.after.units[s] ?? 0) - (sig.units[s] ?? 0);
      if (d > 1e-12) add(s, d, d * pe(s) / (1 - fee || 1));
      else if (d < -1e-12) remove(s, -d, -d * pe(s) * (1 - fee), year);
    }
  }
  return pos;
}

export { riskStats };
