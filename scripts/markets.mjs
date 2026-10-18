// Daily closes (in USD) of the ETFs used by the Stocks and AI Apocalypse portfolios, from Yahoo Finance.
// Run by .github/workflows/markets.yml after the markets close (00:10 UTC); writes markets.json, which the app reads
// from GitHub Pages (Yahoo does not allow browser requests). EUR / GBP / GBp listings are converted with the same
// day's EURUSD / GBPUSD close (forward-filled over holidays).
import { writeFileSync } from 'node:fs';

export const TICKERS = {
  // Stocks portfolio
  IS04: { yahoo: 'IS04.DE', name: 'iShares $ Treasury Bond 20+yr UCITS ETF (Dist)' },
  SGLN: { yahoo: 'SGLN.L', name: 'iShares Physical Gold ETC' },
  TRET: { yahoo: 'TRET.DE', name: 'VanEck Global Real Estate UCITS ETF' },
  VWCE: { yahoo: 'VWCE.DE', name: 'Vanguard FTSE All-World UCITS ETF (Acc)' },
  // AI Apocalypse portfolio
  SMH: { yahoo: 'SMH', name: 'VanEck Semiconductor ETF' },
  DTCR: { yahoo: 'DTCR', name: 'Global X Data Center & Digital Infrastructure ETF' },
  NLR: { yahoo: 'NLR', name: 'VanEck Uranium and Nuclear ETF' },
  CIBR: { yahoo: 'CIBR', name: 'First Trust NASDAQ Cybersecurity ETF' },
  IGV: { yahoo: 'IGV', name: 'iShares Expanded Tech-Software Sector ETF' },
  BOTZ: { yahoo: 'BOTZ', name: 'Global X Robotics & Artificial Intelligence ETF' },
  // benchmarks
  SPY: { yahoo: 'SPY', name: 'SPDR S&P 500 ETF' },
  QQQ: { yahoo: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq-100)' }
};
const FX = { EUR: 'EURUSD=X', GBP: 'GBPUSD=X' };
const OUT = new URL('../markets.json', import.meta.url);

async function chart(symbol, range = '5y') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includeAdjustedClose=false`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.ok) {
      const r = (await res.json()).chart.result[0];
      const off = r.meta.gmtoffset ?? 0, q = r.indicators.quote[0];
      const closes = {};
      r.timestamp.forEach((t, i) => { const c = q.close[i]; if (c > 0) closes[new Date((t + off) * 1000).toISOString().slice(0, 10)] = c; });
      return { meta: r.meta, closes };
    }
    if (attempt === 3) throw new Error(`${symbol}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 15_000 * attempt));
  }
}

function ffill(series) {
  const days = Object.keys(series).sort();
  return (d) => { let lo = 0, hi = days.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m] <= d) { best = days[m]; lo = m + 1; } else hi = m - 1; } return best ? series[best] : NaN; };
}

async function main() {
  const fx = {};
  for (const [cur, sym] of Object.entries(FX)) fx[cur] = ffill((await chart(sym)).closes);
  const out = {};
  for (const [sym, t] of Object.entries(TICKERS)) {
    const { meta, closes } = await chart(t.yahoo);
    const cur = meta.currency;
    const toUsd = cur === 'USD' ? () => 1 : cur === 'EUR' ? fx.EUR : cur === 'GBP' ? fx.GBP : cur === 'GBp' ? (d) => fx.GBP(d) / 100 : null;
    if (!toUsd) throw new Error(`${sym}: unsupported currency ${cur}`);
    const usd = {};
    for (const [d, c] of Object.entries(closes)) { const v = c * toUsd(d); if (Number.isFinite(v)) usd[d] = Math.round(v * 1e4) / 1e4; }
    const days = Object.keys(closes).sort(), last = days.at(-1);
    out[sym] = { name: t.name, yahoo: t.yahoo, exchange: meta.exchangeName, currency: cur, lastDate: last, lastLocal: closes[last], closes: usd };
    await new Promise((r) => setTimeout(r, 1_500));
  }
  if (Object.keys(out).length !== Object.keys(TICKERS).length) throw new Error('Missing tickers — nothing written');
  writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), source: 'Yahoo Finance daily closes, converted to USD', tickers: out }) + '\n');
  console.log(Object.entries(out).map(([s, v]) => `${s} ${v.currency} ${v.lastDate} ${v.lastLocal} → $${v.closes[v.lastDate]}`).join('\n'));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
