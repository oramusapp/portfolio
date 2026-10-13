import type { SdcaState, RspsState, Positions } from '../lib/engine';
import { priceOn, type PriceBook } from '../lib/prices';
import { CASH, emojiOf } from '../lib/tokens';
import { addDays } from '../lib/utc';
import { pct, price, tone, usd } from '../lib/format';
import { IcClose } from './icons';

interface Line { sym: string; units: number; price: number; value: number; change: number; pnl: number; avg: number; upl: number; }

/** One line per asset: today's change = live price vs yesterday's close (00:00 UTC); cash has no change. */
function lines(assets: [string, number][], book: PriceBook, today: string, positions: Positions, strat: 'SDCA' | 'RSPS'): Line[] {
  const yday = addDays(today, -1);
  return assets.map(([sym, units]) => {
    if (sym === CASH) return { sym, units, price: 1, value: units, change: 0, pnl: 0, avg: NaN, upl: NaN };
    const p = priceOn(book, sym, today), p0 = priceOn(book, sym, yday);
    const pos = positions[`${strat}:${sym}`], avg = pos && pos.units > 0 ? pos.cost / pos.units : NaN;
    return { sym, units, price: p, value: units * p, change: p / p0 - 1, pnl: units * (p - p0), avg, upl: units * (p - avg) };
  }).sort((a, b) => (a.sym === CASH ? 1 : b.sym === CASH ? -1 : b.value - a.value));
}

const amount = (sym: string, v: number) =>
  sym === CASH ? usd(v, 2) : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toLocaleString('en-US', { maximumFractionDigits: 8 });

function Strategy({ title, rows, total, positions, year }: { title: 'SDCA' | 'RSPS'; rows: Line[]; total: number; positions: Positions; year: string }) {
  const own = Object.entries(positions).filter(([k]) => k.startsWith(`${title}:`)).map(([, p]) => p);
  const realized = own.reduce((t, p) => t + p.realized, 0), realizedYear = own.reduce((t, p) => t + (p.realizedByYear[year] ?? 0), 0);
  const value = rows.reduce((t, r) => t + r.value, 0);
  const pnl = rows.reduce((t, r) => t + r.pnl, 0);
  const dayPct = pnl / (value - pnl);
  return (
    <div className="card pane">
      <div className="pv-head">
        <h3>{title} <span className="dim">· {total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'}% of portfolio</span></h3>
        <div className="pv-sum">
          <b>{usd(value, 2)}</b>
          <span className={tone(pnl)}>{pnl >= 0 ? '+' : ''}{usd(pnl, 2)} ({pct(dayPct, 2)}) today</span>
        </div>
      </div>
      {!rows.length ? <div className="dim small">Nothing held.</div> : (
        <div className="table-wrap">
          <table className="mini pv">
            <thead><tr><th>Asset</th><th className="r">Amount</th><th className="r">Price</th><th className="r">Value</th><th className="r">Allocation</th><th className="r">Today</th><th className="r">Day P/L</th><th className="r">Avg buy</th><th className="r">Unrealized</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sym}>
                  <td className="pv-asset">{emojiOf(r.sym)} <b>{r.sym}</b></td>
                  <td className="r" data-label="Amount">{amount(r.sym, r.units)}</td>
                  <td className="r dim" data-label="Price">{r.sym === CASH ? '—' : price(r.price)}</td>
                  <td className="r" data-label="Value">{usd(r.value, 2)}</td>
                  <td className="r" data-label="Allocation"><div className="alloc-cell"><i style={{ width: `${value > 0 ? (r.value / value) * 100 : 0}%` }} />{value > 0 ? ((r.value / value) * 100).toFixed(1) : '0.0'}%</div></td>
                  <td className={`r ${tone(r.change)}`} data-label="Today">{r.sym === CASH ? '—' : pct(r.change, 2)}</td>
                  <td className={`r ${tone(r.pnl)}`} data-label="Day P/L">{r.sym === CASH ? '—' : `${r.pnl >= 0 ? '+' : ''}${usd(r.pnl, 2)}`}</td>
                  <td className="r dim" data-label="Avg buy">{Number.isFinite(r.avg) ? price(r.avg) : '—'}</td>
                  <td className={`r ${tone(r.upl)}`} data-label="Unrealized">{Number.isFinite(r.upl) ? `${r.upl >= 0 ? '+' : ''}${usd(r.upl, 2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dim small">Realized P/L: <span className={tone(realizedYear)}>{usd(realizedYear, 2)}</span> in {year} · <span className={tone(realized)}>{usd(realized, 2)}</span> in total (average-cost method, after fees, USD)</div>
    </div>
  );
}

export function PortfolioView({ sdca, rsps, book, today, positions, onClose }: { sdca: SdcaState; rsps: RspsState; book: PriceBook; today: string; positions: Positions; onClose: () => void }) {
  const year = today.slice(0, 4);
  const sd = lines([['BTC', sdca.btc], [CASH, sdca.cash]].filter(([, u]) => (u as number) > 0) as [string, number][], book, today, positions, 'SDCA');
  const rs = lines([...Object.entries(rsps.units), [CASH, rsps.cash] as [string, number]].filter(([, u]) => u > 0), book, today, positions, 'RSPS');
  const total = [...sd, ...rs].reduce((t, r) => t + r.value, 0);
  const pnl = [...sd, ...rs].reduce((t, r) => t + r.pnl, 0);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>Portfolio</h2>
            <div className="dim small">Current holdings at live prices. “Today” = change since the last daily close (00:00 UTC).</div></div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>
        <div className="total-row">
          <span className="dim">Total</span>
          <span><b>{usd(total, 2)}</b> <span className={tone(pnl)}>{pnl >= 0 ? '+' : ''}{usd(pnl, 2)} ({pct(pnl / (total - pnl), 2)}) today</span></span>
        </div>
        <Strategy title="SDCA" rows={sd} total={total} positions={positions} year={year} />
        <Strategy title="RSPS" rows={rs} total={total} positions={positions} year={year} />
        <div className="dim small">Avg buy and realized P/L are worked out from the saved signals at their execution prices; coins typed in without a trade count at that day's price. Values are in USD — for a tax return (e.g. PIT-38) convert each trade at the official exchange rate; this is a helper, not tax advice.</div>
      </div>
    </div>
  );
}
