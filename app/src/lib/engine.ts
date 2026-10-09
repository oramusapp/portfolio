// Two fully separate strategies (SDCA = BTC only, RSPS = closed token list). Each has its own value, cash and
// holdings; they are only added together for the combined portfolio KPI/chart.
//
// Assumptions:
// • Orders are worked out on live prices; saving a signal stores those prices (`px`) and the signal is executed at them,
//   with no fees or slippage. Older signals without `px` use the close of D-1 (00:00 UTC).
// • SDCA: BUY x% = x% of the SDCA cash reserve (1% of $100 = BTC for $1); SELL x% = x% of the BTC held. 0–100%, so it can
//   never spend more cash or sell more BTC than the SDCA part has.
// • RSPS: the target % applies to the whole RSPS part (tokens + RSPS cash), so spare RSPS cash is spread over the signal.
// • On days without a new signal (DUPLICATED) the previous allocation is carried forward by keeping the units as they are
//   (no daily re-rebalance), so weights drift with prices.
// • Day return = value at close D / value at close D-1 of the holdings held during D (time-weighted), so differences between
//   the holdings you type in and the carried-forward holdings count as deposits/withdrawals, not performance.
import { priceOn, type PriceBook } from './prices';
import { CASH, isAllowed } from './tokens';
import { addDays, daysBetween } from './utc';

export interface SdcaInput { pct: number; cash: number; btc: number; }   // pct > 0 buy, < 0 sell
export interface RspsInput { alloc: Record<string, number>; cash: number; units: Record<string, number>; }
export interface Signal { date: string; createdAt: number; sdca: SdcaInput; rsps: RspsInput; px?: Record<string, number>; }
export interface SdcaState { cash: number; btc: number; }
export interface RspsState { cash: number; units: Record<string, number>; }

const EPS = 1e-9;

// ---------- SDCA ----------
export interface SdcaOrder {
  price: number; value: number; side: 'buy' | 'sell' | 'hold'; pct: number;
  usd: number; btc: number; after: SdcaState;
}
export function sdcaOrder(inp: SdcaInput, price: number): SdcaOrder {
  const value = inp.cash + inp.btc * price;
  const pct = Math.min(Math.abs(inp.pct), 100) / 100;
  if (inp.pct > 0) {
    const usd = pct * Math.max(inp.cash, 0);
    return { price, value, side: 'buy', pct, usd, btc: usd / price, after: { cash: inp.cash - usd, btc: inp.btc + usd / price } };
  }
  if (inp.pct < 0) {
    const btc = pct * Math.max(inp.btc, 0);
    return { price, value, side: 'sell', pct, usd: btc * price, btc, after: { cash: inp.cash + btc * price, btc: inp.btc - btc } };
  }
  return { price, value, side: 'hold', pct: 0, usd: 0, btc: 0, after: { cash: inp.cash, btc: inp.btc } };
}

// ---------- RSPS ----------
export function allocError(alloc: Record<string, number>): string | null {
  const keys = Object.keys(alloc);
  if (!keys.length) return 'Add at least one asset.';
  for (const k of keys) {
    if (!isAllowed(k)) return `${k} is not on the RSPS list.`;
    if (!Number.isFinite(alloc[k]) || alloc[k] < 0) return `${k}: allocation must be ≥ 0%.`;
  }
  const sum = keys.reduce((s, k) => s + alloc[k], 0);
  if (Math.abs(sum - 100) > 0.01) return `Allocation sums to ${sum.toFixed(2)}% — it must be exactly 100%.`;
  return null;
}

export interface RebalanceRow {
  sym: string; price: number; curUnits: number; curUsd: number; curPct: number;
  tgtPct: number; tgtUsd: number; deltaUsd: number; deltaPct: number; deltaUnits: number;
}
export interface RebalancePlan { total: number; rows: RebalanceRow[]; after: RspsState; missing: string[]; }

export function rebalance(inp: RspsInput, px: (sym: string) => number): RebalancePlan {
  const syms = [...new Set([CASH, ...Object.keys(inp.units), ...Object.keys(inp.alloc)])];
  const missing = syms.filter((s) => !Number.isFinite(px(s)));
  const cur = (s: string) => (s === CASH ? inp.cash : inp.units[s] ?? 0);
  const total = syms.reduce((t, s) => t + (missing.includes(s) ? 0 : cur(s) * px(s)), 0);
  const rows: RebalanceRow[] = syms.map((sym) => {
    const price = px(sym), curUnits = cur(sym), curUsd = curUnits * price;
    const tgtPct = inp.alloc[sym] ?? 0, tgtUsd = total * tgtPct / 100, deltaUsd = tgtUsd - curUsd;
    return {
      sym, price, curUnits, curUsd, curPct: total > 0 ? curUsd / total * 100 : 0, tgtPct, tgtUsd,
      deltaUsd, deltaPct: total > 0 ? deltaUsd / total * 100 : 0, deltaUnits: deltaUsd / price
    };
  });
  const units: Record<string, number> = {};
  for (const r of rows) if (r.sym !== CASH && r.tgtUsd > EPS) units[r.sym] = r.tgtUsd / r.price;
  return { total, rows, after: { cash: total * (inp.alloc[CASH] ?? 0) / 100, units }, missing };
}

// ---------- valuation / simulation ----------
const sdcaValue = (s: SdcaState, btcPx: number) => s.cash + s.btc * btcPx;
const rspsValue = (s: RspsState, px: (sym: string) => number) =>
  Object.entries(s.units).reduce((t, [k, u]) => t + u * px(k), s.cash);

export interface DayRow {
  date: string; signal: Signal; duplicated: boolean;
  sdca: SdcaOrder | null; rsps: RebalancePlan | null;          // orders, only on signal days
  value: number; sdcaValue: number; rspsValue: number;
  r: number; rSdca: number; rRsps: number; btcDay: number;
  totalGain: number; sdcaGain: number; rspsGain: number;
  invested: number; missing: string[];
}
export interface Simulation {
  start: string; rows: DayRow[]; sdca: SdcaState; rsps: RspsState;
}

const ret = (v1: number, v0: number) => (v0 > EPS && Number.isFinite(v1 / v0) ? v1 / v0 - 1 : 0);

/** Replays every signal from the first one up to `today`. `start` is the day before the first signal (0% on the chart). */
export function simulate(signals: Signal[], book: PriceBook, today: string): Simulation | null {
  const sorted = [...signals].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const byDate = new Map(sorted.map((s) => [s.date, s]));
  const start = addDays(sorted[0].date, -1);
  let sd: SdcaState = { cash: 0, btc: 0 }, rs: RspsState = { cash: 0, units: {} };
  let active = sorted[0], idx = 1, iSd = 1, iRs = 1, invested = 0;
  const rows: DayRow[] = [];
  for (const d of daysBetween(sorted[0].date, today < sorted[0].date ? sorted[0].date : today)) {
    const prev = addDays(d, -1);
    const p0 = (s: string) => priceOn(book, s, prev), p1 = (s: string) => priceOn(book, s, d);
    const sig = byDate.get(d);
    let order: SdcaOrder | null = null, plan: RebalancePlan | null = null;
    // growth factors of the day: [old holdings from close D-1 to execution] × [new holdings from execution to close D]
    let gSd = 1, gRs = 1, gAll = 1, from = p0;
    if (sig) {
      active = sig;
      const pe = (s: string) => sig.px?.[s] ?? p0(s);
      if (rows.length) {
        const a = sdcaValue(sd, p0('BTC')), b = sdcaValue(sd, pe('BTC')), c = rspsValue(rs, p0), e = rspsValue(rs, pe);
        gSd = 1 + ret(b, a); gRs = 1 + ret(e, c); gAll = 1 + ret(b + e, a + c);
      }
      // what you typed in vs what was carried forward = a deposit (+) or withdrawal (−)
      const typed = sdcaValue(sig.sdca, pe('BTC')) + rspsValue({ cash: sig.rsps.cash, units: sig.rsps.units }, pe);
      const carried = rows.length ? sdcaValue(sd, pe('BTC')) + rspsValue(rs, pe) : 0;
      if (Number.isFinite(typed - carried)) invested += typed - carried;
      order = sdcaOrder(sig.sdca, pe('BTC'));
      plan = rebalance(sig.rsps, pe);
      sd = order.after; rs = plan.after; from = pe;
    }
    const s0 = sdcaValue(sd, from('BTC')), s1 = sdcaValue(sd, p1('BTC'));
    const r0 = rspsValue(rs, from), r1 = rspsValue(rs, p1);
    const rSdca = gSd * (1 + ret(s1, s0)) - 1, rRsps = gRs * (1 + ret(r1, r0)) - 1, r = gAll * (1 + ret(s1 + r1, s0 + r0)) - 1;
    idx *= 1 + r; iSd *= 1 + rSdca; iRs *= 1 + rRsps;
    const held = ['BTC', ...Object.keys(rs.units)];
    rows.push({
      date: d, signal: active, duplicated: !sig, sdca: order, rsps: plan,
      value: s1 + r1, sdcaValue: s1, rspsValue: r1,
      r, rSdca, rRsps, btcDay: ret(p1('BTC'), p0('BTC')),
      totalGain: idx - 1, sdcaGain: iSd - 1, rspsGain: iRs - 1, invested,
      missing: held.filter((s) => !Number.isFinite(p0(s)) || !Number.isFinite(p1(s)))
    });
  }
  return { start, rows, sdca: sd, rsps: rs };
}

/** Buy & hold of one token from the close of `start`: % change per day. */
export function benchmark(book: PriceBook, sym: string, start: string, days: string[]) {
  const base = priceOn(book, sym, start);
  return days.map((d) => ret(priceOn(book, sym, d), base));
}
