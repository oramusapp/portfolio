// Two fully separate strategies (SDCA = BTC only, RSPS = closed token list). Each has its own value, cash and
// holdings; they are only added together for the combined portfolio KPI/chart.
//
// Assumptions:
// • Orders are worked out on live prices; saving a signal stores those prices (`px`) and the signal is executed at them,
//   with no fees or slippage. Older signals without `px` use the close of D-1 (00:00 UTC).
// • SDCA: BUY x% = x% of the SDCA cash reserve (1% of $100 = BTC for $1); SELL x% = x% of the BTC held. 0–100%, so it can
//   never spend more cash or sell more BTC than the SDCA part has.
// • RSPS: the target % applies to the whole RSPS part (tokens + RSPS cash), so spare RSPS cash is spread over the signal.
// • RSPS SHORT = a perpetual short at 1× leverage: margin = position size. A negative target (e.g. OP −5%) is a short of
//   that size, held as negative units; margin and entry value both sit in RSPS cash, so the part's value
//   (cash + units × price) is unchanged at entry and moves by −size × price change, exactly as a 1× perp.
//   The % used for shorts counts towards the 100% like a long (|weight|).
// • LEVERAGE (RSPS only, 19.11.2026): each coin can have 1×–5× (`lev`). The target % is the MARGIN put into the
//   coin; the position (exposure) is margin × leverage. A long at 1× is spot (as before); a long above 1× and every
//   short are perpetuals: funding, isolated liquidation (whole margin lost). In the model a perp position adds
//   margin − units × entry to cash, so cash + units × price = margin + unrealized P/L, exactly like an isolated perp.
//   Liquidation price: long entry × (1 − 1/L) / (1 − MM) (the day's low), short entry × (1 + 1/L) / (1 + MM) (the day's high).
//   These are Hyperliquid's rules (docs, checked 22.11.2026): leverage is a whole number from 1 to the coin's max leverage;
//   initial margin = size × price / leverage; maintenance margin MM = half of the initial margin at max leverage
//   (1.25% at 40× … 16.7% at 3×); isolated liquidation price = price − side × (margin − MM × notional) / size / (1 − MM × side),
//   which is the formula above. Kept conservative: at liquidation the whole margin is lost (Hyperliquid returns what is
//   left above MM when the position is closed on the book; only a backstop liquidation takes everything).
// • FEES (22.11.2026): spot trades pay `fee`, perp trades (shorts, longs above 1×, opening or closing) pay `feePerp`;
//   defaults are Hyperliquid's base tier for market orders (spot 0.070%, perps 0.045%). Funding is separate (hourly).
// • Funding (Hyperliquid, hourly): each day the short gets −units × close × Σ that day's funding rates (positive rate:
//   longs pay shorts). It counts as performance and as realized P/L.
// • Liquidation (1×, isolated): when the day's high reaches 2 × entry / (1 + MM) — MM = maintenance margin = half the
//   initial margin at the coin's max leverage — the short is closed and its whole margin is lost (conservative: the
//   small rest of the margin is not returned). Entry = average entry price of the short.
// • On days without a new signal (DUPLICATED) the previous allocation is carried forward by keeping the units as they are
//   (no daily re-rebalance), so weights drift with prices.
// • Day return = value at close D / value at close D-1 of the holdings held during D (time-weighted), so differences between
//   the holdings you type in and the carried-forward holdings count as deposits/withdrawals, not performance.
import { priceOn, type PriceBook } from './prices';
import { CASH, isAllowed } from './tokens';
import { addDays, daysBetween } from './utc';

export interface SdcaInput { pct: number; cash: number; btc: number; }   // pct > 0 buy, < 0 sell
/** lev = leverage per coin for the target allocation (1–5; missing = 1×); heldLev = leverage of the perp positions in
 *  `units` (what is held before the signal; missing = 1×, a long at 1× is spot). */
export interface RspsInput { alloc: Record<string, number>; cash: number; units: Record<string, number>; lev?: Record<string, number>; heldLev?: Record<string, number>; }
/** sdcaNew / rspsNew = false: no new signal for that strategy that day (DUPLICATED) — no trades, holdings carried as they are.
 *  Missing (older signals) means true. */
export interface Signal {
  id?: string;   // unique per signal (several signals can share a date); older signals have none → their date is the id
  date: string; createdAt: number; sdca: SdcaInput; rsps: RspsInput; px?: Record<string, number>; sdcaNew?: boolean; rspsNew?: boolean;
  fee?: number;   // trading fee as a fraction of each trade's value, stored with the signal (setting at save time)
  feePerp?: number;   // fee for perp trades (shorts, longs above 1×); missing = `fee` (signals saved before 22.11.2026)
}

/** The orders a signal makes at the given prices; a strategy without a new signal keeps its holdings unchanged. */
export function executeSignal(sig: Signal, px: (sym: string) => number) {
  const fee = sig.fee ?? 0;
  const order = sdcaOrder(sig.sdcaNew === false ? { ...sig.sdca, pct: 0 } : sig.sdca, px('BTC'), fee);
  const plan = sig.rspsNew === false ? null : rebalance(sig.rsps, px, fee, sig.feePerp ?? fee);
  const rsps: RspsState = plan ? plan.after : { cash: sig.rsps.cash, units: { ...sig.rsps.units }, ...levFor(sig.rsps.units, sig.rsps.heldLev) };
  return { order, plan, sdca: order.after, rsps };
}
export interface SdcaState { cash: number; btc: number; }
/** lev = leverage of the open perp positions above 1× (missing = 1×). */
export interface RspsState { cash: number; units: Record<string, number>; lev?: Record<string, number>; }

const EPS = 1e-9;

// ---------- leverage ----------
export const MAX_LEV = 5;
/** Leverage of a coin (1–5, whole or fractional), 1× when missing or invalid. */
export const levOf = (lev: Record<string, number> | undefined, sym: string) => {
  const v = lev?.[sym];
  return typeof v === 'number' && Number.isFinite(v) && v > 1 ? Math.min(v, MAX_LEV) : 1;
};
/** A position is a perpetual when it is short (any leverage) or long above 1×; a long at 1× is spot. */
export const isPerp = (units: number, lev: number) => units < -EPS || (units > EPS && lev > 1 + EPS);
/** { lev } with only the held coins above 1×, or {} when there are none (keeps old saved data unchanged). */
const levFor = (units: Record<string, number>, lev?: Record<string, number>): { lev?: Record<string, number> } => {
  const out: Record<string, number> = {};
  for (const s of Object.keys(units)) { const L = levOf(lev, s); if (L > 1 && Math.abs(units[s]) > EPS) out[s] = L; }
  return Object.keys(out).length ? { lev: out } : {};
};

// ---------- SDCA ----------
export interface SdcaOrder {
  price: number; value: number; side: 'buy' | 'sell' | 'hold'; pct: number;
  usd: number; btc: number; fee: number; after: SdcaState;
}
/** fee = fraction of the trade value: a buy gets less BTC for the same cash, a sell brings in less cash. */
export function sdcaOrder(inp: SdcaInput, price: number, fee = 0): SdcaOrder {
  const value = inp.cash + inp.btc * price;
  const pct = Math.min(Math.abs(inp.pct), 100) / 100;
  if (inp.pct > 0) {
    const usd = pct * Math.max(inp.cash, 0), btc = usd * (1 - fee) / price;
    return { price, value, side: 'buy', pct, usd, btc, fee: usd * fee, after: { cash: inp.cash - usd, btc: inp.btc + btc } };
  }
  if (inp.pct < 0) {
    const btc = pct * Math.max(inp.btc, 0), gross = btc * price;
    return { price, value, side: 'sell', pct, usd: gross * (1 - fee), btc, fee: gross * fee, after: { cash: inp.cash + gross * (1 - fee), btc: inp.btc - btc } };
  }
  return { price, value, side: 'hold', pct: 0, usd: 0, btc: 0, fee: 0, after: { cash: inp.cash, btc: inp.btc } };
}

/** Smallest SDCA buy: 1% of the SDCA cash reserve. */
export const MIN_SDCA_BUY_PCT = 1;

// ---------- RSPS ----------
/** allowShort: negative weights (shorts) are accepted for every asset except CASH; the 100% counts |weight|. */
export function allocError(alloc: Record<string, number>, allowed: (s: string) => boolean = isAllowed, listName = 'RSPS list', allowShort = false): string | null {
  const keys = Object.keys(alloc);
  if (!keys.length) return 'Add at least one asset.';
  for (const k of keys) {
    if (!allowed(k)) return `${k} is not on the ${listName}.`;
    if (!Number.isFinite(alloc[k])) return `${k}: allocation must be a number.`;
    if (alloc[k] < 0 && k === CASH) return 'CASH cannot be short.';
    if (alloc[k] < 0 && !allowShort) return `${k}: allocation must be ≥ 0%.`;
  }
  const sum = keys.reduce((s, k) => s + Math.abs(alloc[k]), 0);
  if (Math.abs(sum - 100) > 0.01) return `Allocation sums to ${sum.toFixed(2)}% — it must be exactly 100%.`;
  return null;
}

/** An allocation that sums to less than 100% (but more than 0%): the rest goes to CASH. Returns the filled allocation and
 *  how many % were added (0 = unchanged). Over 100%, or all zero, is left as it is for allocError to report.
 *  Shorts count with their size (|weight|). */
export function fillCash(alloc: Record<string, number>): { alloc: Record<string, number>; added: number } {
  const sum = Object.values(alloc).reduce((t, v) => t + (Number.isFinite(v) ? Math.abs(v) : NaN), 0);
  const rest = Math.round((100 - sum) * 1e6) / 1e6;
  if (!(sum > 0) || !(rest > 0.01)) return { alloc, added: 0 };
  return { alloc: { ...alloc, [CASH]: (alloc[CASH] ?? 0) + rest }, added: rest };
}

export interface RebalanceRow {
  sym: string; price: number; curUnits: number; curUsd: number; curPct: number;
  tgtPct: number; tgtUsd: number; deltaUsd: number; deltaPct: number; deltaUnits: number;
  lev: number; marginPct: number;   // target leverage and the % of the part put in as margin (= the signal's %)
  feeRate: number;                  // fee charged on this coin's trade: the perp rate if it is or becomes a perp, else spot
}
export interface RebalancePlan { total: number; rows: RebalanceRow[]; after: RspsState; missing: string[]; fee: number; heldLev?: Record<string, number>; }

/** Current value of the open shorts: Σ |units| × price (NaN if a price is missing). */
export function shortNotional(units: Record<string, number>, px: (sym: string) => number): number {
  return Object.entries(units).reduce((t, [s, u]) => (u < 0 ? t + -u * px(s) : t), 0);
}
/** − Σ units × price over the perp positions (shorts, and longs above 1×): what the exchange equity does not hold
 *  as coins. Long-only at 1×: 0. */
export function perpNotional(units: Record<string, number>, px: (sym: string) => number, lev?: Record<string, number>): number {
  return Object.entries(units).reduce((t, [s, u]) => (isPerp(u, levOf(lev, s)) ? t - u * px(s) : t), 0);
}
/** RSPS cash as the exchange shows it ("USDT equity" on Bybit: balance incl. the shorts' margin and unrealized P/L).
 *  Inside the app the cash also holds the entry value of the coins sold short (see the model above), so
 *  equity = internal cash − Σ |units| × price and internal cash = equity + Σ |units| × price. Long-only: the same number. */
export const equityCash = (cash: number, units: Record<string, number>, px: (sym: string) => number, lev?: Record<string, number>) => cash - perpNotional(units, px, lev);
export const internalCash = (equity: number, units: Record<string, number>, px: (sym: string) => number, lev?: Record<string, number>) => equity + perpNotional(units, px, lev);

/** Cash frozen by open 1× shorts: the margin plus the entry value of the coins sold = 2 × |units| × entry price.
 *  It stays in RSPS cash for the valuation (cash + Σ units × price), but it is not free: it cannot be spent or
 *  withdrawn while the short is open. A short without a known entry price is counted at `fallback` (e.g. today's price). */
export function frozenCash(units: Record<string, number>, entry: (sym: string) => number, fallback?: (sym: string) => number, lev?: Record<string, number>): number {
  return Object.entries(units).reduce((t, [s, u]) => {
    const L = levOf(lev, s);
    if (!isPerp(u, L)) return t;
    let e = entry(s);
    if (!(Number.isFinite(e) && e > 0) && fallback) e = fallback(s);
    // margin − units × entry: short 1× = 2 × size; a leveraged long is negative (cash borrowed for the position)
    return Number.isFinite(e) && e > 0 ? t + Math.abs(u) * e / L - u * e : t;
  }, 0);
}
/** Margin of the perp positions: Σ |units| × entry / leverage. */
export function perpMargin(units: Record<string, number>, entry: (sym: string) => number, fallback?: (sym: string) => number, lev?: Record<string, number>): number {
  return Object.entries(units).reduce((t, [s, u]) => {
    const L = levOf(lev, s);
    if (!isPerp(u, L)) return t;
    let e = entry(s);
    if (!(Number.isFinite(e) && e > 0) && fallback) e = fallback(s);
    return Number.isFinite(e) && e > 0 ? t + Math.abs(u) * e / L : t;
  }, 0);
}

/** Hyperliquid base-tier (tier 0) fees, from its docs (checked 22.11.2026): perps taker 0.045% / maker 0.015%,
 *  spot taker 0.070% / maker 0.040% of the traded value. */
export const HL_FEES = { perpTaker: 0.045, perpMaker: 0.015, spotTaker: 0.07, spotMaker: 0.04 } as const;   // in %
/** fee = fraction of the traded value (token sells + buys); it is taken proportionally from the resulting holdings.
 *  feePerp = the rate for coins that are or become perps (shorts, longs above 1×); spot coins pay `fee`.
 *  A negative target is a short: negative units, and cash = CASH% + the collateral and the sale proceeds of the shorts
 *  (2 × their size), so cash + Σ units × price = the part's value. Long-only allocations give the same result as before. */
export function rebalance(inp: RspsInput, px: (sym: string) => number, fee = 0, feePerp = fee): RebalancePlan {
  const syms = [...new Set([CASH, ...Object.keys(inp.units), ...Object.keys(inp.alloc)])];
  const missing = syms.filter((s) => !Number.isFinite(px(s)));
  const cur = (s: string) => (s === CASH ? inp.cash : inp.units[s] ?? 0);
  const total = syms.reduce((t, s) => t + (missing.includes(s) ? 0 : cur(s) * px(s)), 0);
  // each coin: margin = total × |%|, position = ± margin × leverage; cash gets margin − position (0 for a 1× long)
  const pos = (s: string) => { const v = inp.alloc[s] ?? 0; return Math.sign(v) * total * Math.abs(v) / 100 * levOf(inp.lev, s); };
  const cashTgt = total * (inp.alloc[CASH] ?? 0) / 100 +
    Object.entries(inp.alloc).reduce((t, [s, v]) => t + (s !== CASH && v !== 0 ? total * Math.abs(v) / 100 - pos(s) : 0), 0);
  const rows: RebalanceRow[] = syms.map((sym) => {
    const price = px(sym), curUnits = cur(sym), curUsd = curUnits * price;
    const tgtUsd = sym === CASH ? cashTgt : pos(sym);
    const tgtPct = total > 0 ? tgtUsd / total * 100 : inp.alloc[sym] ?? 0, deltaUsd = tgtUsd - curUsd;
    return {
      sym, price, curUnits, curUsd, curPct: total > 0 ? curUsd / total * 100 : 0, tgtPct, tgtUsd,
      deltaUsd, deltaPct: total > 0 ? deltaUsd / total * 100 : 0, deltaUnits: deltaUsd / price,
      lev: sym === CASH ? 1 : levOf(inp.lev, sym), marginPct: sym === CASH ? inp.alloc[CASH] ?? 0 : Math.abs(inp.alloc[sym] ?? 0),
      feeRate: sym === CASH ? 0 : isPerp(curUnits, levOf(inp.heldLev, sym)) || isPerp(tgtUsd, levOf(inp.lev, sym)) ? feePerp : fee
    };
  });
  const feeUsd = rows.reduce((t, r) => t + (r.sym === CASH ? 0 : Math.abs(r.deltaUsd) * r.feeRate), 0);
  const k = total > 0 && Number.isFinite(feeUsd) ? (total - feeUsd) / total : 1;
  const units: Record<string, number> = {};
  for (const r of rows) if (r.sym !== CASH && Math.abs(r.tgtUsd) > EPS) units[r.sym] = r.tgtUsd * k / r.price;
  return { total, rows, after: { cash: cashTgt * k, units, ...levFor(units, inp.lev) }, missing, fee: Number.isFinite(feeUsd) ? feeUsd : 0, ...(inp.heldLev ? { heldLev: inp.heldLev } : {}) };
}

// ---------- valuation / simulation ----------
const sdcaValue = (s: SdcaState, btcPx: number) => s.cash + s.btc * btcPx;
const rspsValue = (s: RspsState, px: (sym: string) => number) =>
  Object.entries(s.units).reduce((t, [k, u]) => t + u * px(k), s.cash);

export const sigId = (s: Signal) => s.id ?? s.date;
/** Signals in execution order: by date, then by the time they were saved. */
export const bySignalOrder = (a: Signal, b: Signal) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt;

export interface Exec { signal: Signal; sdca: SdcaOrder; rsps: RebalancePlan | null; }
export interface DayRow {
  date: string; signal: Signal; duplicated: boolean;
  execs: Exec[];                                               // every signal executed that day, in order
  sdca: SdcaOrder | null; rsps: RebalancePlan | null;          // orders of the last signal of the day
  value: number; sdcaValue: number; rspsValue: number;
  r: number; rSdca: number; rRsps: number; btcDay: number;
  totalGain: number; sdcaGain: number; rspsGain: number;
  invested: number; missing: string[];
  sdcaInvested: number; rspsInvested: number;                   // the money put in per strategy (invested = their sum)
  fundingUsd: number;                                          // funding of the perps that day (+ received, − paid)
  liquidations: Liquidation[];                                 // perps liquidated that day
  perpPnl: number;                                             // P/L of the perp positions that day (price + funding + liquidations), USD
  rPerp: number; perpGain: number;                             // perp P/L / perp equity (day) and compounded since the start
}
/** lev / long are set for the leveraged perps (since 19.11.2026); older rows are 1× shorts. */
export interface Liquidation { date: string; sym: string; units: number; entry: number; price: number; loss: number; lev?: number; long?: boolean; }
export interface PerpEvent { date: string; sym: string; kind: 'funding' | 'liq'; usd: number; units?: number; }
export interface Simulation {
  start: string; rows: DayRow[]; sdca: SdcaState; rsps: RspsState;
  events: PerpEvent[];                                         // funding per day and coin + liquidations (for cost basis)
  shortEntry: Record<string, number>;                          // average entry price of the open perps (shorts and leveraged longs)
}
/** Perp data (Hyperliquid): daily highs and lows, funding (sum of the hourly rates per UTC day) and maintenance margin.
 *  low is optional: without it a leveraged long is checked against the day's close. */
export interface PerpData { high: PriceBook; low?: PriceBook; funding: Record<string, Record<string, number>>; mm: Record<string, number>; }
export const DEFAULT_MM = 0.1;   // when the coin's max leverage is unknown: 5× → 20% initial, 10% maintenance
/** Price at which an isolated perp with this entry is liquidated: short (default) or long, at `lev`×. */
export const liqPrice = (entry: number, mm = DEFAULT_MM, lev = 1, long = false) =>
  long ? (entry * (1 - 1 / lev)) / (1 - mm) : (entry * (1 + 1 / lev)) / (1 + mm);
/** Highest leverage the exchange allows for a coin, from its maintenance margin (MM = 1 / (2 × max)). */
export const maxLevFromMm = (mm: number | undefined) => (mm && mm > 0 ? Math.round(1 / (2 * mm)) : NaN);

const ret = (v1: number, v0: number) => (v0 > EPS && Number.isFinite(v1 / v0) ? v1 / v0 - 1 : 0);

/** Replays every signal from the first one up to `today`. `start` is the day before the first signal (0% on the chart). */
export function simulate(signals: Signal[], book: PriceBook, today: string, perp?: PerpData): Simulation | null {
  const sorted = [...signals].sort(bySignalOrder);
  if (!sorted.length) return null;
  const byDate = new Map<string, Signal[]>();
  for (const s of sorted) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const start = addDays(sorted[0].date, -1);
  let sd: SdcaState = { cash: 0, btc: 0 }, rs: RspsState = { cash: 0, units: {} };
  const entry: Record<string, number> = {};   // average entry of each open perp
  const events: PerpEvent[] = [];
  /** After an execution: keep the average entry of the perps (new = execution price, bigger on the same side = weighted). */
  const trackEntry = (before: Record<string, number>, after: RspsState, pe: (s: string) => number) => {
    for (const sym of new Set([...Object.keys(before), ...Object.keys(after.units), ...Object.keys(entry)])) {
      const u0 = before[sym] ?? 0, u1 = after.units[sym] ?? 0;
      if (!isPerp(u1, levOf(after.lev, sym))) { delete entry[sym]; continue; }
      const same = Math.sign(u0) === Math.sign(u1), a0 = same ? Math.abs(u0) : 0, a1 = Math.abs(u1);
      const e0 = same && entry[sym] !== undefined ? entry[sym] : pe(sym);
      entry[sym] = a1 > a0 + EPS ? (e0 * a0 + pe(sym) * (a1 - a0)) / a1 : e0;
    }
  };
  /** The perps' own money: Σ margin + unrealized P/L at prices `px`. */
  const perpEquity = (st: RspsState, px: (s: string) => number) => Object.entries(st.units).reduce((t, [s, u]) => {
    const L = levOf(st.lev, s), e = entry[s] ?? px(s), v = Math.abs(u) * e / L + u * (px(s) - e);
    return isPerp(u, L) && Number.isFinite(v) ? t + v : t;
  }, 0);
  /** P/L of the perps when prices move from `a` to `b`. */
  const perpMove = (st: RspsState, a: (s: string) => number, b: (s: string) => number) => Object.entries(st.units).reduce((t, [s, u]) => {
    const v = u * (b(s) - a(s));
    return isPerp(u, levOf(st.lev, s)) && Number.isFinite(v) ? t + v : t;
  }, 0);
  let active = sorted[0], idx = 1, iSd = 1, iRs = 1, iPerp = 1, invested = 0, invSd = 0, invRs = 0, started = false, prevLev: Record<string, number> | undefined;
  const rows: DayRow[] = [];
  for (const d of daysBetween(sorted[0].date, today < sorted[0].date ? sorted[0].date : today)) {
    const prev = addDays(d, -1);
    const p0 = (s: string) => priceOn(book, s, prev), p1 = (s: string) => priceOn(book, s, d);
    const sigs = byDate.get(d) ?? [];
    const execs: Exec[] = [];
    // growth factors of the day, chained: close D-1 → 1st signal → 2nd signal → … → close D (holdings held in between)
    let gSd = 1, gRs = 1, gAll = 1, from = p0, perpPnl = 0, perpBase = started ? perpEquity(rs, p0) : 0;
    for (const sig of sigs) {
      active = sig;
      const pe = (s: string) => sig.px?.[s] ?? p0(s);
      if (started) {
        const a = sdcaValue(sd, from('BTC')), b = sdcaValue(sd, pe('BTC')), c = rspsValue(rs, from), e = rspsValue(rs, pe);
        gSd *= 1 + ret(b, a); gRs *= 1 + ret(e, c); gAll *= 1 + ret(b + e, a + c);
        perpPnl += perpMove(rs, from, pe);
      }
      // what you typed in vs what was carried forward = a deposit (+) or withdrawal (−)
      const tSd = sdcaValue(sig.sdca, pe('BTC')), tRs = rspsValue({ cash: sig.rsps.cash, units: sig.rsps.units }, pe);
      const cSd = started ? sdcaValue(sd, pe('BTC')) : 0, cRs = started ? rspsValue(rs, pe) : 0;
      if (Number.isFinite(tSd + tRs - cSd - cRs)) invested += tSd + tRs - cSd - cRs;
      if (Number.isFinite(tSd - cSd)) invSd += tSd - cSd;
      if (Number.isFinite(tRs - cRs)) invRs += tRs - cRs;
      // a signal saved before leverage existed has no heldLev: the held perps keep the leverage carried so far
      const sigX = sig.rsps.heldLev === undefined && prevLev ? { ...sig, rsps: { ...sig.rsps, heldLev: prevLev } } : sig;
      const ex = executeSignal(sigX, pe);
      execs.push({ signal: sig, sdca: ex.order, rsps: ex.plan });
      trackEntry(sig.rsps.units, ex.rsps, pe);
      sd = ex.sdca; rs = ex.rsps; from = pe; started = true; prevLev = rs.lev;
      perpBase = Math.max(perpBase, perpEquity(rs, pe));
    }
    // perps during the day: liquidation (short: day's high, long: day's low), then funding on what is still open
    let fundingUsd = 0;
    const liquidations: Liquidation[] = [];
    if (started) {
      for (const [sym, u] of Object.entries(rs.units)) {
        const L = levOf(rs.lev, sym), long = u > 0;
        if (!isPerp(u, L)) continue;
        const e = entry[sym] ?? from(sym);
        if (!Number.isFinite(e)) continue;
        const lp = liqPrice(e, perp?.mm[sym], L, long);
        const ext = long ? perp?.low?.[sym]?.[d] ?? p1(sym) : perp?.high[sym]?.[d] ?? p1(sym);
        if (Number.isFinite(ext) && (long ? ext <= lp : ext >= lp)) {
          // the cash this position holds (margin − units × entry) goes; the whole margin is lost
          const held = Math.abs(u) * e / L - u * e;
          perpPnl += -(Math.abs(u) * e / L + u * (from(sym) - e));
          const levNext = { ...(rs.lev ?? {}) }; delete levNext[sym];
          rs = { cash: rs.cash - held, units: Object.fromEntries(Object.entries(rs.units).filter(([k]) => k !== sym)), ...levFor(rs.units, levNext) };
          liquidations.push({ date: d, sym, units: u, entry: e, price: lp, loss: Math.abs(u) * e / L, ...(L > 1 ? { lev: L } : {}), ...(long ? { long: true } : {}) });
          events.push({ date: d, sym, kind: 'liq', usd: Math.abs(held), units: -u });
          delete entry[sym];
          continue;
        }
        const rate = perp?.funding[sym]?.[d];
        const px1 = p1(sym);
        if (rate !== undefined && Number.isFinite(px1)) {
          const f = -u * px1 * rate;
          rs = { ...rs, cash: rs.cash + f }; fundingUsd += f;
          events.push({ date: d, sym, kind: 'funding', usd: f });
        }
      }
      perpPnl += fundingUsd + perpMove(rs, from, p1);
    }
    const rPerp = perpBase > EPS && Number.isFinite(perpPnl / perpBase) ? Math.max(perpPnl / perpBase, -1) : 0;
    iPerp *= 1 + rPerp;
    const lastEx = execs.at(-1);
    const s0 = sdcaValue(sd, from('BTC')), s1 = sdcaValue(sd, p1('BTC'));
    const r0 = rspsValue(rs, from), r1 = rspsValue(rs, p1);
    const rSdca = gSd * (1 + ret(s1, s0)) - 1, rRsps = gRs * (1 + ret(r1, r0)) - 1, r = gAll * (1 + ret(s1 + r1, s0 + r0)) - 1;
    idx *= 1 + r; iSd *= 1 + rSdca; iRs *= 1 + rRsps;
    const held = ['BTC', ...Object.keys(rs.units)];
    rows.push({
      date: d, signal: active, duplicated: !sigs.length, execs, sdca: lastEx?.sdca ?? null, rsps: lastEx?.rsps ?? null,
      value: s1 + r1, sdcaValue: s1, rspsValue: r1,
      r, rSdca, rRsps, btcDay: ret(p1('BTC'), p0('BTC')),
      totalGain: idx - 1, sdcaGain: iSd - 1, rspsGain: iRs - 1, invested, sdcaInvested: invSd, rspsInvested: invRs,
      missing: held.filter((s) => !Number.isFinite(p0(s)) || !Number.isFinite(p1(s))),
      fundingUsd, liquidations, perpPnl, rPerp, perpGain: iPerp - 1
    });
  }
  return { start, rows, sdca: sd, rsps: rs, events, shortEntry: { ...entry } };
}

/** Buy & hold of one token from the close of `start`: % change per day. */
export function benchmark(book: PriceBook, sym: string, start: string, days: string[]) {
  const base = priceOn(book, sym, start);
  return days.map((d) => ret(priceOn(book, sym, d), base));
}

// ---------- statistics ----------
export interface RiskStats { days: number; total: number; vol: number; sharpe: number; sortino: number; maxDD: number; }
/** Daily returns → total return, annualised volatility (365 days), Sharpe and Sortino (risk-free 0), max drawdown. */
export function riskStats(rs: number[]): RiskStats {
  const n = rs.length;
  let idx = 1, peak = 1, maxDD = 0;
  for (const r of rs) { idx *= 1 + r; peak = Math.max(peak, idx); maxDD = Math.min(maxDD, idx / peak - 1); }
  const mean = n ? rs.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1)) : NaN;
  const down = n > 1 ? Math.sqrt(rs.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / n) : NaN;
  const ann = Math.sqrt(365);
  return { days: n, total: idx - 1, vol: sd * ann, sharpe: sd > 0 ? (mean * 365) / (sd * ann) : NaN, sortino: down > 0 ? (mean * 365) / (down * ann) : NaN, maxDD };
}

/** Compounded return per calendar month ('YYYY-MM') and per year ('YYYY'). */
export function periodReturns(dates: string[], rs: number[]) {
  const months = new Map<string, number>(), years = new Map<string, number>();
  dates.forEach((d, i) => {
    const m = d.slice(0, 7), y = d.slice(0, 4);
    months.set(m, (months.get(m) ?? 1) * (1 + rs[i]));
    years.set(y, (years.get(y) ?? 1) * (1 + rs[i]));
  });
  const out = (mp: Map<string, number>) => new Map([...mp].map(([k, v]) => [k, v - 1]));
  return { months: out(months), years: out(years) };
}

// ---------- cost basis ----------
export interface Position { units: number; cost: number; realized: number; realizedByYear: Record<string, number>; }
export type Positions = Record<string, Position>;   // key 'SDCA:BTC' or 'RSPS:SOL'

/** Average-cost basis per strategy and coin, replayed from the signals at their execution prices. Coins that appear
 *  without a trade (typed-in holdings) are taken in at that day's execution price; ones that disappear leave at
 *  their average cost (no P/L). Realized P/L = sell value − average cost, after fees.
 *  Shorts: units < 0 and cost = −(sale proceeds), so cost / units is the average entry price; covering realizes
 *  proceeds − cost of buying back. */
export function costBasis(signals: Signal[], book: PriceBook, events: PerpEvent[] = []): Positions {
  const pos: Positions = {};
  const P = (k: string) => (pos[k] ??= { units: 0, cost: 0, realized: 0, realizedByYear: {} });
  /** d = change in units (+ buy, − sell), usd = cash paid (buy) or received (sell) for the whole trade, > 0;
   *  realize = false for typed-in holdings (transfers, no P/L). */
  const trade = (k: string, d: number, usd: number, year: string, realize: boolean) => {
    const p = P(k), sign = Math.sign(d);
    let left = Math.abs(d);
    if (p.units !== 0 && Math.sign(p.units) !== sign) {   // closing (part of) the position
      const u = Math.min(left, Math.abs(p.units)), basis = p.cost * (u / Math.abs(p.units)), share = usd * (u / Math.abs(d));
      const pl = p.units > 0 ? share - basis : -basis - share;
      p.units += sign * u; p.cost -= basis; left -= u;
      if (realize) { p.realized += pl; p.realizedByYear[year] = (p.realizedByYear[year] ?? 0) + pl; }
      if (Math.abs(p.units) <= EPS) { p.units = 0; p.cost = 0; }
    }
    if (left > EPS) { p.units += sign * left; p.cost += sign * usd * (left / Math.abs(d)); }   // opening / adding
  };
  const add = (k: string, units: number, cost: number, year: string) => trade(k, units, cost, year, true);
  const remove = (k: string, units: number, proceeds: number | null, year: string) => trade(k, -units, proceeds ?? 0, year, proceeds !== null);
  // funding and liquidations happen during the day, after that day's signals
  let ei = 0;
  const evs = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const applyEvents = (upTo: string) => {
    for (; ei < evs.length && evs[ei].date < upTo; ei++) {
      const ev = evs[ei], k = `RSPS:${ev.sym}`, year = ev.date.slice(0, 4), p = P(k);
      if (ev.kind === 'funding') { p.realized += ev.usd; p.realizedByYear[year] = (p.realizedByYear[year] ?? 0) + ev.usd; }
      else if (ev.units) trade(k, ev.units, ev.usd, year, true);   // bought back with the whole margin → loss = margin
    }
  };
  for (const sig of [...signals].sort(bySignalOrder)) {
    applyEvents(sig.date);
    const prev = addDays(sig.date, -1), year = sig.date.slice(0, 4);
    const pe = (s: string) => sig.px?.[s] ?? priceOn(book, s, prev);
    const fee = sig.fee ?? 0, feeP = sig.feePerp ?? fee;
    // holdings typed in vs what the replay holds → transfers in / out
    const adjust = (k: string, typed: number, price: number) => {
      const d = typed - (pos[k]?.units ?? 0);
      if (Math.abs(d) > EPS) trade(k, d, Math.abs(d) * price, year, false);
    };
    adjust('SDCA:BTC', sig.sdca.btc, pe('BTC'));
    const rspsSyms = new Set([...Object.keys(sig.rsps.units), ...Object.keys(pos).filter((k) => k.startsWith('RSPS:')).map((k) => k.slice(5))]);
    for (const s of rspsSyms) adjust(`RSPS:${s}`, sig.rsps.units[s] ?? 0, pe(s));
    const ex = executeSignal(sig, pe);
    if (ex.order.side === 'buy') add('SDCA:BTC', ex.order.btc, ex.order.usd, year);
    if (ex.order.side === 'sell') remove('SDCA:BTC', ex.order.btc, ex.order.usd, year);
    if (ex.plan) {
      for (const s of new Set([...Object.keys(sig.rsps.units), ...Object.keys(ex.rsps.units)])) {
        const d = (ex.rsps.units[s] ?? 0) - (sig.rsps.units[s] ?? 0);
        const f = isPerp(sig.rsps.units[s] ?? 0, levOf(sig.rsps.heldLev, s)) || isPerp(ex.rsps.units[s] ?? 0, levOf(ex.rsps.lev, s)) ? feeP : fee;
        if (d > EPS) add(`RSPS:${s}`, d, d * pe(s) / (1 - f || 1), year);
        else if (d < -EPS) remove(`RSPS:${s}`, -d, -d * pe(s) * (1 - f), year);
      }
    }
  }
  applyEvents('9999-12-31');
  return pos;
}
