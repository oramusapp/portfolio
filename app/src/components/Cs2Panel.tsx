import { useEffect, useState } from 'react';
import { LineChart } from './LineChart';
import { pct, tone, usd } from '../lib/format';

// CS2 skin market from cs2.json (written daily at 00:05 UTC by the GitHub Action from the Skinport public API).
export interface Cs2Snap {
  date: string; marketCap: number; listings: number; items: number; gainers: number; losers: number; flat: number;
  breadth: number; momentum: number; riskAppetite: number; volumeTrend: number; fearGreed: number;
}
interface Cs2File { updated: string; source: string; latest: Cs2Snap; history: Cs2Snap[]; }

const REFRESH_MS = 30 * 60_000;

function useCs2() {
  const [data, setData] = useState<Cs2File | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`./cs2.json?t=${Math.floor(Date.now() / REFRESH_MS)}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json() as Cs2File;
        if (alive) { setData(j); setError(null); }
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    const wake = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', wake);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', wake); };
  }, []);
  return { data, error };
}

const fgLabel = (v: number) => (v < 25 ? 'Extreme fear' : v < 45 ? 'Fear' : v <= 55 ? 'Neutral' : v <= 75 ? 'Greed' : 'Extreme greed');
const compact = (v: number) => '$' + v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const pts = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)} pts`;

function Delta({ now, prev, fmt }: { now: number; prev?: number; fmt: (d: number) => string }) {
  if (prev === undefined) return null;
  const d = now - prev;
  return <span className={`small ${tone(d)}`}>{fmt(d)} vs previous day</span>;
}

export function Cs2Panel() {
  const { data, error } = useCs2();
  if (!data) return <div className="empty">{error ? `CS2 data not available yet (${error}). It is published daily after 00:05 UTC.` : 'Loading CS2 market data…'}</div>;
  const h = data.history, cur = data.latest, prev = h.length > 1 ? h[h.length - 2] : undefined;
  return (
    <div className="cs2">
      <div className="cs2-head">
        <div>
          <div className="dim small">CS2 listed market value (Skinport)</div>
          <div className="cs2-cap">{usd(cur.marketCap)}</div>
          <Delta now={cur.marketCap} prev={prev?.marketCap} fmt={(d) => `${d >= 0 ? '+' : '−'}${usd(Math.abs(d))} (${pct(d / (prev?.marketCap || 1), 2)})`} />
        </div>
        <div className="dim small r">{cur.items.toLocaleString('en-US')} items · {cur.listings.toLocaleString('en-US')} listings<br />close {cur.date} (UTC)</div>
      </div>

      {h.length > 1
        ? <LineChart dates={h.map((x) => x.date)} lines={[{ key: 'cap', label: 'Listed market value (USD)', color: 'var(--accent)', values: h.map((x) => x.marketCap), glow: true, area: true }]} fmtY={compact} fmtTip={(v) => usd(v)} height={260} />
        : <div className="dim small cs2-note">The chart starts on {h[0]?.date}: one point is added after each daily close (00:00 UTC).</div>}

      <div className="cs2-grid">
        <div className="card pane">
          <div className="dim small">Fear &amp; Greed</div>
          <div className="cs2-v">{cur.fearGreed} <span className="cs2-sub">{fgLabel(cur.fearGreed)}</span></div>
          <div className="fg-bar"><i style={{ left: `${cur.fearGreed}%` }} /></div>
          <Delta now={cur.fearGreed} prev={prev?.fearGreed} fmt={(d) => `${d > 0 ? '+' : ''}${d}`} />
        </div>
        <div className="card pane">
          <div className="dim small">Momentum <span title="Turnover-weighted change of the 7-day median price vs the 30-day median">ⓘ</span></div>
          <div className={`cs2-v ${tone(cur.momentum)}`}>{pct(cur.momentum, 2)}</div>
          <div className="dim small">7-day vs 30-day prices</div>
          <Delta now={cur.momentum} prev={prev?.momentum} fmt={pts} />
        </div>
        <div className="card pane">
          <div className="dim small">Gainers vs Losers</div>
          <div className="cs2-v"><span className="pos">{cur.gainers.toLocaleString('en-US')}</span> <span className="dim">/</span> <span className="neg">{cur.losers.toLocaleString('en-US')}</span></div>
          <div className="gl-bar"><i style={{ width: `${cur.breadth * 100}%` }} /></div>
          <div className="dim small">{(cur.breadth * 100).toFixed(0)}% of moving items are up · {cur.flat.toLocaleString('en-US')} flat</div>
        </div>
        <div className="card pane">
          <div className="dim small">Risk appetite <span title="Momentum of items ≥ $100 minus momentum of items < $10">ⓘ</span></div>
          <div className={`cs2-v ${tone(cur.riskAppetite)}`}>{pts(cur.riskAppetite)}</div>
          <div className="dim small">{cur.riskAppetite > 0.005 ? 'Risk-on: expensive items lead' : cur.riskAppetite < -0.005 ? 'Risk-off: cheap items hold up better' : 'Neutral'}</div>
          <Delta now={cur.riskAppetite} prev={prev?.riskAppetite} fmt={pts} />
        </div>
      </div>
      <div className="dim small">
        Source: {data.source}, updated {new Date(data.updated).toLocaleString()}. Our own definitions, not Pricempire's: listed value = Σ suggested price × listings on Skinport;
        momentum and gainers/losers compare each item's 7-day and 30-day median sale price (items with enough sales); risk appetite = momentum of items ≥ $100 minus items &lt; $10;
        Fear &amp; Greed (0–100) averages breadth, momentum, risk appetite and the 7-day vs 30-day turnover trend.
      </div>
    </div>
  );
}
