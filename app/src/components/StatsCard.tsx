import { useState } from 'react';
import { periodReturns, riskStats, type DayRow } from '../lib/engine';
import { priceOn, type PriceBook } from '../lib/prices';
import { addDays } from '../lib/utc';
import { pct, tone } from '../lib/format';

const num2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');

/** Risk numbers and monthly / yearly returns for the portfolio, each strategy and the BTC / SOL benchmarks. */
export function StatsCard({ rows, book }: { rows: DayRow[]; book: PriceBook }) {
  const [tab, setTab] = useState<'risk' | 'months'>('risk');
  const dates = rows.map((r) => r.date);
  const bench = (sym: string) => dates.map((d) => { const a = priceOn(book, sym, addDays(d, -1)), b = priceOn(book, sym, d); return a > 0 && b > 0 ? b / a - 1 : 0; });
  const series = [
    { label: 'Portfolio', rs: rows.map((r) => r.r) },
    { label: 'SDCA', rs: rows.map((r) => r.rSdca) },
    { label: 'RSPS', rs: rows.map((r) => r.rRsps) },
    { label: 'BTC buy & hold', rs: bench('BTC') },
    { label: 'SOL buy & hold', rs: bench('SOL') }
  ];
  const per = series.map((s) => periodReturns(dates, s.rs));
  const months = [...per[0].months.keys()].reverse();
  const years = [...per[0].years.keys()].reverse();
  const cell = (v: number | undefined) => <td className={`r ${tone(v ?? 0)}`}>{v === undefined ? '—' : pct(v, 1)}</td>;

  return (
    <section className="card panel">
      <div className="panel-head">
        <h2>Statistics</h2>
        <div className="seg">
          <button className={tab === 'risk' ? 'on' : ''} onClick={() => setTab('risk')}>Risk</button>
          <button className={tab === 'months' ? 'on' : ''} onClick={() => setTab('months')}>Monthly / yearly</button>
        </div>
      </div>
      {!rows.length ? <div className="empty">Add signals to see statistics.</div> : tab === 'risk' ? (
        <div className="table-wrap">
          <table className="mini stats">
            <thead><tr><th /><th className="r">Return</th><th className="r">Max drawdown</th><th className="r">Volatility (yr)</th><th className="r">Sharpe</th><th className="r">Sortino</th></tr></thead>
            <tbody>{series.map((s) => { const st = riskStats(s.rs); return (
              <tr key={s.label}><td><b>{s.label}</b></td>{cell(st.total)}<td className="r neg">{pct(st.maxDD, 1)}</td><td className="r">{pct(st.vol, 1, false)}</td><td className="r">{num2(st.sharpe)}</td><td className="r">{num2(st.sortino)}</td></tr>
            ); })}</tbody>
          </table>
          <div className="dim small">{rows.length} days of daily returns · annualised over 365 days · risk-free rate 0. Under ~30 days the ratios say little.</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="mini stats">
            <thead><tr><th>Period</th>{series.map((s) => <th key={s.label} className="r">{s.label.replace(' buy & hold', '')}</th>)}</tr></thead>
            <tbody>
              {years.map((y) => <tr key={y} className="year-row"><td><b>{y}</b></td>{per.map((p, i) => <td key={i} className={`r ${tone(p.years.get(y) ?? 0)}`}><b>{pct(p.years.get(y) ?? NaN, 1)}</b></td>)}</tr>)}
              {months.map((m) => <tr key={m}><td>{new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>{per.map((p) => cell(p.months.get(m)))}</tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
