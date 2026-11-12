// Reads a signal message as Prof. Adam posts it in The Real World (copied as text) and turns it into form values.
// RSPS: "• 40.0% BTC", "• 100.0% CASH"; Short Module: "• 2.1% XRP SHORT"; SDCA: "... Default to ~1% per-day ...".
// CASH from the message is not used: the app keeps the allocation at 100% with shorts counted by their size, so
// CASH is whatever longs and shorts leave (the form fills it in, as when a signal is typed by hand).
import { CASH, isAllowed } from './tokens';

export interface ParsedSignal {
  rsps: { rows: { sym: string; pct: number; short: boolean }[]; cashInMessage: number | null; shortTotalInMessage: number | null } | null;
  sdca: { side: 'buy' | 'sell'; pct: number } | null;
  unknown: string[];   // coins in the message that are not on the RSPS list
}

const num = (s: string) => Number(s.replace(',', '.'));

export function parseSignal(text: string): ParsedSignal {
  const out: ParsedSignal = { rsps: null, sdca: null, unknown: [] };
  const lines = text.split(/\r?\n/);
  let section: 'rsps' | 'short' | 'sdca' | null = null;
  const rows: { sym: string; pct: number; short: boolean }[] = [];
  let cash: number | null = null, shortTotal: number | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/short\s*module/i.test(line)) { section = 'short'; continue; }
    if (/rsps\s*signal/i.test(line)) { section = 'rsps'; continue; }
    if (/sdca/i.test(line) && /signal|rate/i.test(line)) { section = 'sdca'; }
    if (/accumulation|distribution|per[\s-]?day/i.test(line)) {
      const m = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (m) {
        const sell = /distribut|sell/i.test(line) && !/accumulat/i.test(line);
        out.sdca = { side: sell ? 'sell' : 'buy', pct: num(m[1]) };
      } else if (/no\s+(accumulation|buy)|0\s*%/i.test(line)) out.sdca = { side: 'buy', pct: 0 };
      continue;
    }
    if (/total\s+short/i.test(line)) { const t = line.match(/(\d+(?:[.,]\d+)?)\s*%/); if (t) shortTotal = num(t[1]); continue; }
    const m = line.match(/(\d+(?:[.,]\d+)?)\s*%\s*([A-Za-z0-9]{2,12})\b(?:\s+(SHORT|LONG))?/i);
    if (!m || section === 'sdca') continue;
    const sym = m[2].toUpperCase(), pct = num(m[1]);
    if (!(pct >= 0)) continue;
    if (sym === CASH) { cash = (cash ?? 0) + pct; continue; }
    if (!isAllowed(sym)) { out.unknown.push(sym); continue; }
    const short = m[3] ? m[3].toUpperCase() === 'SHORT' : section === 'short';
    const same = rows.find((r) => r.sym === sym && r.short === short);
    if (same) same.pct += pct; else rows.push({ sym, pct, short });
  }
  if (rows.length || cash != null) out.rsps = { rows, cashInMessage: cash, shortTotalInMessage: shortTotal };
  return out;
}
