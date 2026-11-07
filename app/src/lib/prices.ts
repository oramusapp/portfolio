// Daily UTC candles (close prices). Source: Hyperliquid perps (the exchange used); Binance spot is a fallback
// only when Hyperliquid cannot be reached. The candle of the current UTC day is still open, so its close is the live price.
import { tokenBySym, CASH } from './tokens';
import { dayOf, msOf, addDays } from './utc';

export type Series = Record<string, number>;   // 'YYYY-MM-DD' → close (USD per 1 token)
export type PriceBook = Record<string, Series>;

async function fromHyperliquid(sym: string, startMs: number): Promise<Series> {
  const tk = tokenBySym.get(sym)!;
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin: tk.hl, interval: '1d', startTime: startMs, endTime: Date.now() + 86_400_000 } })
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  const rows: { t: number; c: string }[] = await res.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Hyperliquid: no candles for ${tk.hl}`);
  const out: Series = {};
  for (const r of rows) out[dayOf(r.t)] = Number(r.c) / tk.scale;
  return out;
}

async function fromBinance(sym: string, startMs: number): Promise<Series> {
  const out: Series = {};
  for (const host of ['https://data-api.binance.vision', 'https://api.binance.com']) {
    try {
      const res = await fetch(`${host}/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=1000&startTime=${startMs}`);
      if (!res.ok) continue;
      const rows: [number, string, string, string, string][] = await res.json();
      for (const r of rows) out[dayOf(r[0])] = Number(r[4]);
      if (rows.length) return out;
    } catch { /* next host */ }
  }
  throw new Error(`No price data for ${sym}`);
}

export async function fetchDaily(sym: string, fromDay: string): Promise<Series> {
  if (sym === CASH) return {};
  const startMs = msOf(fromDay);
  try { return await fromHyperliquid(sym, startMs); }
  catch { return await fromBinance(sym, startMs); }
}

/** Close of `day`, forward-filled from the last earlier candle (max 7 days back). CASH = 1. NaN when unknown. */
export function priceOn(book: PriceBook, sym: string, day: string): number {
  if (sym === CASH) return 1;
  const s = book[sym];
  if (!s) return NaN;
  for (let i = 0, d = day; i < 8; i++, d = addDays(d, -1)) if (s[d] !== undefined) return s[d];
  return NaN;
}

/** Live prices of all RSPS tokens (Hyperliquid mid prices) in one request; USD per 1 token. */
export async function fetchLive(): Promise<Record<string, number>> {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'allMids' })
  });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  const mids: Record<string, string> = await res.json();
  const out: Record<string, number> = {};
  for (const [sym, tk] of tokenBySym) {
    const v = Number(mids[tk.hl]);
    if (Number.isFinite(v) && v > 0) out[sym] = v / tk.scale;
  }
  return out;
}

// ---------- perp data for the shorts (Hyperliquid) ----------
const HL = 'https://api.hyperliquid.xyz/info';
const hl = async <T,>(body: unknown): Promise<T> => {
  const res = await fetch(HL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`);
  return res.json() as Promise<T>;
};

/** Daily highs (USD per 1 token) from `fromDay`. */
export async function fetchHighs(sym: string, fromDay: string): Promise<Series> {
  const tk = tokenBySym.get(sym); if (!tk) return {};
  const rows = await hl<{ t: number; h: string }[]>({ type: 'candleSnapshot', req: { coin: tk.hl, interval: '1d', startTime: msOf(fromDay), endTime: Date.now() + 86_400_000 } });
  const out: Series = {};
  for (const r of Array.isArray(rows) ? rows : []) out[dayOf(r.t)] = Number(r.h) / tk.scale;
  return out;
}

/** Hourly funding rates summed per UTC day (the payment at hh:00 belongs to the hour before it). Positive = longs pay shorts. */
export async function fetchFunding(sym: string, fromDay: string): Promise<Record<string, number>> {
  const tk = tokenBySym.get(sym); if (!tk) return {};
  const out: Record<string, number> = {};
  let start = msOf(fromDay);
  for (let page = 0; page < 60; page++) {   // 500 hourly rates per request ≈ 20 days; up to ~3 years
    const rows = await hl<{ fundingRate: string; time: number }[]>({ type: 'fundingHistory', coin: tk.hl, startTime: start });
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) { const d = dayOf(r.time - 1000); out[d] = (out[d] ?? 0) + Number(r.fundingRate); }
    if (rows.length < 500) break;
    start = rows[rows.length - 1].time + 1;
  }
  return out;
}

/** Maintenance margin per token = half the initial margin at its max leverage (Hyperliquid). */
export async function fetchMaintenance(): Promise<Record<string, number>> {
  const meta = await hl<{ universe: { name: string; maxLeverage: number }[] }>({ type: 'meta' });
  const byHl = new Map(meta.universe.map((u) => [u.name, u.maxLeverage]));
  const out: Record<string, number> = {};
  for (const [sym, tk] of tokenBySym) { const lev = byHl.get(tk.hl); if (lev && lev > 0) out[sym] = 1 / (2 * lev); }
  return out;
}
