import { Fragment, useState } from 'react';
import type { DayRow, RebalancePlan, SdcaOrder, Signal } from '../lib/engine';
import { emojiOf } from '../lib/tokens';
import { num, pct, price, tone, usd } from '../lib/format';
import { IcChevron, IcPen, IcPlus, IcTrash } from './icons';

export const allocText = (alloc: Record<string, number>) =>
  Object.entries(alloc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${emojiOf(k)} ${k} ${+v.toFixed(2)}%`).join(' · ');

export const sdcaText = (p: number) => (p > 0 ? `BTC buy ${p}%` : p < 0 ? `BTC sell ${-p}%` : 'BTC hold');

export function SdcaOrderView({ o }: { o: SdcaOrder }) {
  return (
    <div className="order">
      {o.side === 'hold' && <div>No SDCA trade today.</div>}
      {o.side === 'buy' && <div><b className="pos">BUY {usd(o.usd, 2)}</b> of BTC ≈ {num(o.btc, 6)} BTC @ {price(o.price)} — from SDCA cash</div>}
      {o.side === 'sell' && <div><b className="neg">SELL {num(o.btc, 6)} BTC</b> ≈ {usd(o.usd, 2)} @ {price(o.price)} — into SDCA cash</div>}
      {o.capped && <div className="warn">Capped: the signal asks for {usd(o.wantedUsd, 2)}, but only {o.side === 'buy' ? 'the SDCA cash' : 'the BTC position'} is available.</div>}
      <div className="dim">SDCA part {usd(o.value, 2)} → cash {usd(o.after.cash, 2)} · BTC {num(o.after.btc, 6)}</div>
    </div>
  );
}

export function RebalanceView({ p }: { p: RebalancePlan }) {
  const rows = p.rows.filter((r) => Math.abs(r.deltaUsd) > 0.005 || r.tgtPct > 0 || r.curUsd > 0.005);
  return (
    <div className="order">
      <table className="mini">
        <thead><tr><th>Asset</th><th>Now</th><th>Target</th><th>Action</th><th>Δ %</th><th>Δ $</th><th>Δ units</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const side = r.deltaUsd > 0.005 ? 'BUY' : r.deltaUsd < -0.005 ? 'SELL' : '—';
            return (
              <tr key={r.sym}>
                <td>{emojiOf(r.sym)} {r.sym}</td>
                <td>{r.curPct.toFixed(1)}%</td>
                <td>{r.tgtPct.toFixed(1)}%</td>
                <td className={side === 'BUY' ? 'pos' : side === 'SELL' ? 'neg' : 'dim'}>{side}</td>
                <td>{side === '—' ? '—' : `${Math.abs(r.deltaPct).toFixed(2)}%`}</td>
                <td>{side === '—' ? '—' : usd(Math.abs(r.deltaUsd), 2)}</td>
                <td>{side === '—' || r.sym === 'CASH' ? '—' : num(Math.abs(r.deltaUnits), 6)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dim">RSPS part {usd(p.total, 2)}{p.missing.length ? ` · missing price: ${p.missing.join(', ')}` : ''}</div>
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
