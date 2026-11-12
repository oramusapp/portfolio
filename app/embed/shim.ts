// Embedded build: the dashboard page may not call outside APIs, so the app's requests are answered from data the
// dashboard reads out of the user's Google Sheet ("Ceny krypto – Hyperliquid (dashboard)", filled by an Apps Script).
// Same request shapes as lib/prices.ts expects from api.hyperliquid.xyz; Binance (the fallback) is unavailable.
import { TOKENS } from '../src/lib/tokens';

export interface EmbedData {
  live: Record<string, number>;                          // sym → USD per token (latest)
  closes: Record<string, Record<string, number>>;        // day → sym → USD per token
  highs: Record<string, Record<string, number>>;
  funding: Record<string, Record<string, number>>;       // day → sym → summed hourly rate
  maxLev: Record<string, number>;                        // sym → max leverage
  files: Record<string, string>;                         // 'markets.json' / 'cs2.json' → text
}

let data: EmbedData = { live: {}, closes: {}, highs: {}, funding: {}, maxLev: {}, files: {} };
export function setData(d: EmbedData) { data = d; }

const byHl = new Map(TOKENS.map((t) => [t.hl, t]));
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
const msOf = (d: string) => Date.parse(d + 'T00:00:00Z');

function hyperliquid(body: any): Response {
  switch (body?.type) {
    case 'allMids': {
      const out: Record<string, string> = {};
      for (const t of TOKENS) { const v = data.live[t.sym]; if (v > 0) out[t.hl] = String(v * t.scale); }
      return json(out);
    }
    case 'candleSnapshot': {
      const tk = byHl.get(body.req?.coin);
      if (!tk) return json([]);
      const from = Number(body.req.startTime) || 0, to = Number(body.req.endTime) || Infinity;
      const rows = Object.keys(data.closes).sort().filter((d) => { const t = msOf(d); return t >= from - 86_399_999 && t <= to; })
        .map((d) => ({ d, c: data.closes[d][tk.sym], h: data.highs[d]?.[tk.sym] }))
        .filter((r) => r.c > 0)
        .map((r) => ({ t: msOf(r.d), c: String(r.c * tk.scale), h: String((r.h > 0 ? r.h : r.c) * tk.scale) }));
      return json(rows);
    }
    case 'fundingHistory': {
      const tk = byHl.get(body.coin);
      if (!tk) return json([]);
      const from = Number(body.startTime) || 0;
      const rows = Object.keys(data.funding).sort().filter((d) => msOf(d) + 86_399_999 >= from && data.funding[d][tk.sym] != null)
        .map((d) => ({ time: msOf(d) + 3_600_000, fundingRate: String(data.funding[d][tk.sym]) }));
      return json(rows);
    }
    case 'meta':
      return json({ universe: TOKENS.filter((t) => data.maxLev[t.sym]).map((t) => ({ name: t.hl, maxLeverage: data.maxLev[t.sym] })) });
    default:
      return json({ error: 'not available in the dashboard' }, 503);
  }
}

export function installFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('api.hyperliquid.xyz')) {
      let body: unknown = null;
      try { body = JSON.parse(String(init?.body ?? 'null')); } catch { /* bad body */ }
      return hyperliquid(body);
    }
    if (/binance/.test(url)) throw new TypeError('Binance is not available in the dashboard');
    const file = url.match(/(markets|cs2)\.json/);
    if (file) {
      const text = data.files[file[0]];
      return text ? new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response('not found', { status: 404 });
    }
    return real(input, init);
  };
}
