import { frozenCash, liqPrice, type SdcaState, type RspsState, type Positions } from '../lib/engine';
import { priceOn, type PriceBook } from '../lib/prices';
import { CASH, emojiOf } from '../lib/tokens';
import { addDays } from '../lib/utc';
import { pct, price, tone, usd } from '../lib/format';
import { IcClose } from './icons';

interface Line { sym: string; units: number; price: number; value: number; change: number; pnl: number; avg: number; upl: number; frozen?: number; }

/** One line per asset: today's change = live price vs yesterday's close (00:00 UTC); cash has no change.
 *  An open short (units < 0) freezes `frozen` = 2 × |units| × entry of the cash (margin + entry value of the coins sold).
 *  That part is moved out of the cash line into the short's own line, whose value is then what the short is worth to
 *  you: frozen + units × price = margin + unrealized P/L. The cash line shows only the free cash; the total is unchanged. */
function lines(assets: [string, number][], book: PriceBook, today: string, positions: Positions, strat: 'SDCA' | 'RSPS', entry?: (sym: string) => number): Line[] {
  const yday = addDays(today, -1);
  const avgOf = (sym: string, units: number) => {
    // short: units < 0 and cost < 0, so cost / units is the average entry price and units × (p − avg) its unrealized P/L
    const pos = positions[`${strat}:${sym}`];
    return pos && pos.units !== 0 && Math.sign(pos.units) === Math.sign(units) ? pos.cost / pos.units : NaN;
  };
  const entryOf = (sym: string) => {
    const e = entry ? entry(sym) : NaN;
    if (Number.isFinite(e) && e > 0) return e;
    const units = assets.find(([s]) => s === sym)?.[1] ?? 0, a = avgOf(sym, units);
    return Number.isFinite(a) && a > 0 ? a : priceOn(book, sym, today);
  };
  const shortUnits = Object.fromEntries(assets.filter(([s, u]) => s !== CASH && u < 0));
  const frozenAll = frozenCash(shortUnits, entryOf);
  return assets.map(([sym, units]) => {
    if (sym === CASH) { const free = units - frozenAll; return { sym, units: free, price: 1, value: free, change: 0, pnl: 0, avg: NaN, upl: NaN }; }
    const p = priceOn(book, sym, today), p0 = priceOn(book, sym, yday), avg = avgOf(sym, units);
    const frozen = units < 0 ? frozenCash({ [sym]: units }, entryOf) : 0;
    return { sym, units, price: p, value: frozen + units * p, change: p / p0 - 1, pnl: units * (p - p0), avg, upl: units * (p - avg), frozen: units < 0 ? frozen : undefined };
  }).sort((a, b) => (a.sym === CASH ? 1 : b.sym === CASH ? -1 : Math.abs(b.value) - Math.abs(a.value)));
}

const amount = (sym: string, v: number) =>
  sym === CASH ? usd(v, 2) : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toLocaleString('en-US', { maximumFractionDigits: 8 });

/** Open shorts (perp 1×): average entry and maintenance margin → liquidation price; funding per coin in total. */
export interface ShortInfo { entry: Record<string, number>; mm: Record<string, number>; funding: Record<string, number>; }

function Strategy({ title, rows, total, positions, year, shorts }: { title: 'SDCA' | 'RSPS'; rows: Line[]; total: number; positions: Positions; year: string; shorts?: ShortInfo }) {
  const own = Object.entries(positions).filter(([k]) => k.startsWith(`${title}:`)).map(([, p]) => p);
  const realized = own.reduce((t, p) => t + p.realized, 0), realizedYear = own.reduce((t, p) => t + (p.realizedByYear[year] ?? 0), 0);
  const value = rows.reduce((t, r) => t + r.value, 0);
  const pnl = rows.reduce((t, r) => t + r.pnl, 0);
  const frozenTotal = rows.reduce((t, r) => t + (r.frozen ?? 0), 0);
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
            <thead><tr><th>Asset</th><th className="r">Amount</th><th className="r">Price</th><th className="r">Value</th><th className="r">Allocation</th><th className="r">Today</th><th className="r">Day P/L</th><th className="r">Avg price</th><th className="r">Unrealized</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sym}>
                  <td className="pv-asset">{emojiOf(r.sym)} <b>{r.sym}</b>{r.units < 0 && <span className="tag short">SHORT</span>}
                    {r.units < 0 && shorts && Number.isFinite(shorts.entry[r.sym]) && <span className="pv-liq">perp 1× · liq. {price(liqPrice(shorts.entry[r.sym], shorts.mm[r.sym]))}</span>}
                    {r.frozen !== undefined && <span className="pv-frozen">🔒 {usd(r.frozen, 2)} frozen cash</span>}
                    {r.sym === CASH && frozenTotal > 0 && <span className="pv-frozen">free · {usd(frozenTotal, 2)} frozen in shorts</span>}</td>
                  <td className="r" data-label="Amount">{amount(r.sym, r.units)}</td>
                  <td className="r dim" data-label="Price">{r.sym === CASH ? '—' : price(r.price)}</td>
                  <td className="r" data-label="Value">{usd(r.value, 2)}</td>
                  <td className="r" data-label="Allocation"><div className="alloc-cell"><i style={{ width: `${value > 0 ? Math.min(100, (Math.abs(r.value) / value) * 100) : 0}%` }} />{value > 0 ? ((r.value / value) * 100).toFixed(1) : '0.0'}%</div></td>
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
      <div className="dim small">Realized P/L: <span className={tone(realizedYear)}>{usd(realizedYear, 2)}</span> in {year} · <span className={tone(realized)}>{usd(realized, 2)}</span> in total (average-cost method, after fees, USD{shorts ? '; shorts: funding and liquidations included' : ''})</div>
      {shorts && Object.keys(shorts.funding).length > 0 && (() => {
        const f = Object.values(shorts.funding).reduce((t, v) => t + v, 0);
        return <div className="dim small">Funding of the shorts: <span className={tone(f)}>{f >= 0 ? '+' : ''}{usd(f, 2)}</span> in total ({Object.entries(shorts.funding).filter(([, v]) => Math.abs(v) >= 0.005).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${usd(v, 2)}`).join(' · ') || '—'})</div>;
      })()}
    </div>
  );
}

export function PortfolioView({ sdca, rsps, book, today, positions, shorts, onClose }: { sdca: SdcaState; rsps: RspsState; book: PriceBook; today: string; positions: Positions; shorts?: ShortInfo; onClose: () => void }) {
  const year = today.slice(0, 4);
  const sd = lines([['BTC', sdca.btc], [CASH, sdca.cash]].filter(([, u]) => (u as number) > 0) as [string, number][], book, today, positions, 'SDCA');
  const rs = lines([...Object.entries(rsps.units), [CASH, rsps.cash] as [string, number]].filter(([, u]) => u !== 0), book, today, positions, 'RSPS',
    shorts ? (sym) => shorts.entry[sym] : undefined);
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
        <Strategy title="RSPS" rows={rs} total={total} positions={positions} year={year} shorts={shorts} />
        <div className="dim small">A SHORT is a perpetual short at 1× leverage: it shows as a negative amount. Opening it freezes cash — the margin plus the entry value of the coins sold (2 × amount × entry price) — which is not free to spend or withdraw while the short is open; the cash line shows only the free cash, and the short's value is its frozen cash plus its unrealized P/L. Its avg price is the average entry price. Funding (Hyperliquid hourly rates) is added to cash; a short is liquidated when the day's high reaches “liq.” and its margin is then lost. Avg price and realized P/L are worked out from the saved signals at their execution prices; coins typed in without a trade count at that day's price. Values are in USD — for a tax return (e.g. PIT-38) convert each trade at the official exchange rate; this is a helper, not tax advice.</div>
      </div>
    </div>
  );
}
