import { Fragment, useState } from 'react';
import type { DayRow, RebalancePlan, RebalanceRow, SdcaOrder, Signal } from '../lib/engine';
import { CASH, emojiOf } from '../lib/tokens';
import { num, pct, price, tone, usd } from '../lib/format';
import { IcChevron, IcPen, IcPlus, IcTrash } from './icons';

export const allocText = (alloc: Record<string, number>) =>
  Object.entries(alloc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${emojiOf(k)} ${k} ${+v.toFixed(2)}%`).join(' · ');

export const sdcaText = (p: number) => (p > 0 ? `BTC buy ${p}%` : p < 0 ? `BTC sell ${-p}%` : 'BTC hold');

const btcAmt = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—');
const unitsAmt = (v: number) => (!Number.isFinite(v) ? '—' : v >= 1000 ? num(v, 2) : v >= 1 ? num(v, 4) : num(v, 8));

export function SdcaOrderView({ o, live }: { o: SdcaOrder; live?: boolean }) {
  const when = live ? 'live' : 'at save';
  return (
    <div className="order">
      {o.side === 'hold' && <div className="act-line"><span className="badge hold">HOLD</span>No SDCA trade.</div>}
      {o.side === 'buy' && (
        <>
          <div className="act-line"><span className="badge buy">BUY</span><b>{btcAmt(o.btc)} BTC</b> for <b>{usd(o.usd, 2)}</b></div>
          <div className="dim small">{+(o.pct * 100).toFixed(4)}% of the SDCA cash reserve {usd(o.after.cash + o.usd, 2)} · BTC {price(o.price)} ({when})</div>
        </>
      )}
      {o.side === 'sell' && (
        <>
          <div className="act-line"><span className="badge sell">SELL</span><b>{btcAmt(o.btc)} BTC</b> for ≈ <b>{usd(o.usd, 2)}</b></div>
          <div className="dim small">{+(o.pct * 100).toFixed(4)}% of the BTC held ({btcAmt(o.after.btc + o.btc)} BTC) · BTC {price(o.price)} ({when})</div>
        </>
      )}
      <div className="dim small">After: cash {usd(o.after.cash, 2)} · BTC {btcAmt(o.after.btc)} · SDCA part {usd(o.value, 2)}</div>
    </div>
  );
}

const MIN_USD = 0.01;

export function RebalanceView({ p, live }: { p: RebalancePlan; live?: boolean }) {
  const cash = p.rows.find((r) => r.sym === CASH)!;
  const tokens = p.rows.filter((r) => r.sym !== CASH);
  const sells = tokens.filter((r) => r.deltaUsd < -MIN_USD).sort((a, b) => a.deltaUsd - b.deltaUsd);
  const buys = tokens.filter((r) => r.deltaUsd > MIN_USD).sort((a, b) => b.deltaUsd - a.deltaUsd);
  const holds = tokens.filter((r) => Math.abs(r.deltaUsd) <= MIN_USD && r.tgtPct > 0);
  const row = (r: RebalanceRow, side: 'SELL' | 'BUY' | 'HOLD') => (
    <tr key={r.sym}>
      <td><span className={`badge ${side.toLowerCase()}`}>{side}</span></td>
      <td>{emojiOf(r.sym)} <b>{side === 'HOLD' ? '' : unitsAmt(Math.abs(r.deltaUnits))} {r.sym}</b></td>
      <td>{side === 'HOLD' ? '—' : `${side === 'SELL' ? '≈ ' : ''}${usd(Math.abs(r.deltaUsd), 2)}`}</td>
      <td className="dim">{r.curPct.toFixed(1)}% → {r.tgtPct.toFixed(1)}%</td>
      <td className="dim">{price(r.price)}</td>
    </tr>
  );
  return (
    <div className="order">
      <div className="dim small">RSPS part {usd(p.total, 2)} = tokens {usd(p.total - cash.curUsd, 2)} + cash {usd(cash.curUsd, 2)} · prices {live ? 'live' : 'at save'}</div>
      {sells.length + buys.length === 0
        ? <div className="act-line"><span className="badge hold">HOLD</span>Nothing to trade — already on target.</div>
        : (
          <table className="mini orders">
            <thead><tr><th /><th>Amount</th><th>For</th><th>Now → target</th><th>Price</th></tr></thead>
            <tbody>{sells.map((r) => row(r, 'SELL'))}{buys.map((r) => row(r, 'BUY'))}{holds.map((r) => row(r, 'HOLD'))}</tbody>
          </table>
        )}
      {sells.length > 0 && buys.length > 0 && <div className="dim small">Sell first, then buy with the proceeds.</div>}
      <div className="cash-line">{emojiOf(CASH)} Cash: {usd(cash.curUsd, 2)} → <b>{usd(cash.tgtUsd, 2)}</b> <span className="dim">({cash.tgtPct.toFixed(1)}% of RSPS)</span></div>
      {p.missing.length > 0 && <div className="warn small">Missing price: {p.missing.join(', ')}</div>}
    </div>
  );
}

interface Props {
  rows: DayRow[]; today: string; hasToday: boolean; resetIn: string;
  onAdd: () => void; onEdit: (s: Signal) => void; onDelete: (date: string) => void;
}

export function SignalHistory({ rows, today, hasToday, resetIn, onAdd, onEdit, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = [...rows].reverse();
  return (
    <section className="history">
      <div className="history-head">
        <div>
          <h2>Signal history</h2>
          <div className={hasToday ? 'dim small' : 'warn small'}>
            {hasToday ? `Signal for ${today} saved.` : `No signal for ${today} (UTC) yet — the last allocation is carried as DUPLICATED.`} Reset at 00:00 UTC in {resetIn}.
          </div>
        </div>
        <div className="actions">
          <button className="btn gold" onClick={onAdd}><IcPlus width={18} />{hasToday ? 'Today’s Signal' : 'Add Signal'}</button>
          <button className={`btn ghost ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)}><IcPen width={17} />{editing ? 'Done' : 'Edit'}</button>
        </div>
      </div>
      <div className="card table-wrap">
        <table className="hist">
          <thead><tr><th>DATE</th><th>ALLOCATION</th><th className="r">STRATEGY DAY</th><th className="r">BTC DAY</th><th className="r">TOTAL GAIN</th>{editing && <th />}</tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={5} className="empty">No signals yet — press “Add Signal” to enter today’s SDCA and RSPS signal.</td></tr>}
            {list.map((r) => (
              <Fragment key={r.date}>
                <tr className="row" onClick={() => setOpen(open === r.date ? null : r.date)}>
                  <td className="date">{r.date}</td>
                  <td>
                    <span className="alloc">{allocText(r.signal.rsps.alloc)}</span>
                    <span className="sdca-chip">{sdcaText(r.duplicated ? 0 : r.signal.sdca.pct)}</span>
                    {r.duplicated ? <span className="tag dup">DUPLICATED</span> : <span className="tag sig">Signal <IcChevron width={14} className={open === r.date ? 'flip' : ''} /></span>}
                  </td>
                  <td className={`r ${tone(r.r)}`}>{pct(r.r)}</td>
                  <td className={`r ${tone(r.btcDay)}`}>{pct(r.btcDay)}</td>
                  <td className={`r ${tone(r.totalGain)}`}>{pct(r.totalGain)}</td>
                  {editing && (
                    <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                      {!r.duplicated && <>
                        <button className="icon" title="Edit signal" onClick={() => onEdit(r.signal)}><IcPen width={16} /></button>
                        <button className="icon" title="Delete signal" onClick={() => { if (confirm(`Delete the signal of ${r.date}?`)) onDelete(r.date); }}><IcTrash width={16} /></button>
                      </>}
                    </td>
                  )}
                </tr>
                {open === r.date && (
                  <tr className="detail"><td colSpan={editing ? 6 : 5}>
                    <div className="split">
                      <div>
                        <h4>SDCA (BTC) <span className={tone(r.rSdca)}>{pct(r.rSdca)} day</span> · <span className={tone(r.sdcaGain)}>{pct(r.sdcaGain)} total</span> · {usd(r.sdcaValue, 2)}</h4>
                        {r.sdca ? <SdcaOrderView o={r.sdca} /> : <div className="dim">Carried from the signal of {r.signal.date}: no trade.</div>}
                      </div>
                      <div>
                        <h4>RSPS <span className={tone(r.rRsps)}>{pct(r.rRsps)} day</span> · <span className={tone(r.rspsGain)}>{pct(r.rspsGain)} total</span> · {usd(r.rspsValue, 2)}</h4>
                        {r.rsps ? <RebalanceView p={r.rsps} /> : <div className="dim">Carried from the signal of {r.signal.date}: no rebalance.</div>}
                      </div>
                    </div>
                    {r.missing.length > 0 && <div className="warn small">Missing price for {r.missing.join(', ')} — that day’s return may be incomplete.</div>}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
