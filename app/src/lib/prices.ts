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
