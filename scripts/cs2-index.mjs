// Daily CS2 market snapshot from the Skinport public API (no key). Run by .github/workflows/cs2.yml at 00:05 UTC,
// right after the daily candle closes; the result is appended to cs2.json, which the app reads from GitHub Pages
// (Skinport does not allow browser requests, so the app cannot call it directly).
//
// Definitions (our own, not Pricempire's):
//  • marketCap  = Σ suggested price × listed quantity over all CS2 items listed on Skinport
//  • change     = 7-day median sale price / 30-day median − 1, per item with ≥ 3 sales in 7 days and ≥ 10 in 30 days
//                 (clamped to ±50% so a few thin items cannot dominate)
//  • gainers / losers = items with change > +1% / < −1%; breadth = gainers / (gainers + losers)
//  • momentum   = turnover-weighted average change (turnover = 7-day sales × 7-day median)
//  • riskAppetite = momentum of items with 30-day median ≥ $100 minus momentum of items < $10
//  • volumeTrend  = average daily turnover of the last 7 days / of the last 30 days − 1
//  • fearGreed (0–100) = average of breadth×100, 50+momentum×500, 50+riskAppetite×500, 50+volumeTrend×100 (each clamped 0–100)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const API = 'https://api.skinport.com/v1';
const OUT = new URL('../cs2.json', import.meta.url);
const KEEP_DAYS = 1100;

async function get(path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { 'Accept-Encoding': 'br' } });
    if (res.ok) return res.json();
    if (attempt === 3) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 30_000 * attempt));   // rate limit: wait and retry
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export function compute(items, sales) {
  let marketCap = 0, listings = 0, listed = 0;
  for (const it of items) {
    const price = it.suggested_price ?? it.median_price ?? it.min_price;
    if (!(price > 0) || !(it.quantity > 0)) continue;
    marketCap += price * it.quantity; listings += it.quantity; listed++;
  }
  let gainers = 0, losers = 0, flat = 0, w = 0, wch = 0, t7 = 0, t30 = 0;
  const tier = { hi: [0, 0], lo: [0, 0] };
  for (const s of sales) {
    const d7 = s.last_7_days, d30 = s.last_30_days;
    if (d30?.median > 0 && d30.volume > 0) t30 += d30.median * d30.volume;
    if (d7?.median > 0 && d7.volume > 0) t7 += d7.median * d7.volume;
    if (!(d7?.volume >= 3 && d30?.volume >= 10 && d7.median > 0 && d30.median > 0)) continue;
    const ch = clamp(d7.median / d30.median - 1, -0.5, 0.5), wt = d7.volume * d7.median;
    if (ch > 0.01) gainers++; else if (ch < -0.01) losers++; else flat++;
    w += wt; wch += wt * ch;
    const t = d30.median >= 100 ? tier.hi : d30.median < 10 ? tier.lo : null;
    if (t) { t[0] += wt; t[1] += wt * ch; }
  }
  const momentum = w > 0 ? wch / w : 0;
  const mHi = tier.hi[0] > 0 ? tier.hi[1] / tier.hi[0] : 0, mLo = tier.lo[0] > 0 ? tier.lo[1] / tier.lo[0] : 0;
  const riskAppetite = mHi - mLo;
  const breadth = gainers + losers > 0 ? gainers / (gainers + losers) : 0.5;
  const volumeTrend = t30 > 0 ? (t7 / 7) / (t30 / 30) - 1 : 0;
  const parts = [breadth * 100, 50 + momentum * 500, 50 + riskAppetite * 500, 50 + volumeTrend * 100].map((v) => clamp(v, 0, 100));
  const fearGreed = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return {
    marketCap: Math.round(marketCap), listings, items: listed, gainers, losers, flat,
    breadth: r4(breadth), momentum: r4(momentum), riskAppetite: r4(riskAppetite), volumeTrend: r4(volumeTrend), fearGreed,
    turnover7d: Math.round(t7), turnover30d: Math.round(t30)
  };
}

async function main() {
  const items = await get('/items?app_id=730&currency=USD');
  await new Promise((r) => setTimeout(r, 5_000));
  const sales = await get('/sales/history?app_id=730&currency=USD');
  if (!Array.isArray(items) || items.length < 1000 || !Array.isArray(sales) || sales.length < 1000) throw new Error('Unexpected Skinport response — nothing written');
  const now = new Date();
  // label = the UTC day whose candle just closed (run at 00:05 → previous day); a manual run mid-day labels today
  const date = new Date(now.getTime() - 10 * 60_000).toISOString().slice(0, 10);
  const snap = { date, ...compute(items, sales) };
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { history: [] };
  const history = [...prev.history.filter((h) => h.date !== date), snap].sort((a, b) => a.date.localeCompare(b.date)).slice(-KEEP_DAYS);
  writeFileSync(OUT, JSON.stringify({ updated: now.toISOString(), source: 'Skinport public API (app_id 730, USD)', latest: snap, history }, null, 0) + '\n');
  console.log(JSON.stringify(snap));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
