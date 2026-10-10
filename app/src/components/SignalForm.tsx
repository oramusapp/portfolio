import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { allocError, rebalance, sdcaOrder, type Signal } from '../lib/engine';
import { priceOn, type PriceBook } from '../lib/prices';
import { ALL_ASSETS, CASH, TOKENS, emojiOf } from '../lib/tokens';
import { addDays } from '../lib/utc';
import { price, usd } from '../lib/format';
import { RebalanceView, SdcaOrderView } from './SignalHistory';
import { IcClose, IcPlus, IcTrash } from './icons';

interface Props {
  date: string; initial: Signal; book: PriceBook; editingExisting: boolean;
  onNeed: (syms: string[]) => void; onSave: (s: Signal) => void; onClose: () => void; today: string; liveAt: number | null;
}

const fmtUnits = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toLocaleString('en-US', { maximumFractionDigits: 8 }));

export type Pair = { sym: string; v: string };
export const toPairs = (r: Record<string, number>) => Object.entries(r).map(([sym, v]) => ({ sym, v: String(+v.toFixed(8)) }));
export const n = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(',', '.')));

function AssetSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (s: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((s) => <option key={s} value={s}>{emojiOf(s)} {s}</option>)}
    </select>
  );
}

export function PairRows({ rows, setRows, options, unit, placeholder, extra }: { rows: Pair[]; setRows: (r: Pair[]) => void; options: string[]; unit: string; placeholder: string; extra?: (r: Pair) => ReactNode }) {
  const free = (keep: string) => options.filter((s) => s === keep || !rows.some((r) => r.sym === s));
  return (
    <div className="pairs">
      {rows.map((r, i) => (
        <div className="pair" key={i}>
          <AssetSelect value={r.sym} options={free(r.sym)} onChange={(sym) => setRows(rows.map((x, j) => (j === i ? { ...x, sym } : x)))} />
          <input inputMode="decimal" value={r.v} placeholder={placeholder} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
          <span className="unit">{unit}</span>
          {extra?.(r)}
          <button className="icon" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove"><IcTrash width={16} /></button>
        </div>
      ))}
      {free('').length > 0 && <button className="btn ghost small" onClick={() => setRows([...rows, { sym: free('')[0], v: '' }])}><IcPlus width={15} />Add asset</button>}
    </div>
  );
}

export function SignalForm({ date, initial, book, editingExisting, onNeed, onSave, onClose, today, liveAt }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const [side, setSide] = useState<'buy' | 'sell'>(initial.sdca.pct < 0 ? 'sell' : 'buy');
  const [sdcaPct, setSdcaPct] = useState(String(Math.abs(initial.sdca.pct)));
  const [sdcaCash, setSdcaCash] = useState(String(+initial.sdca.cash.toFixed(2)));
  const [sdcaBtc, setSdcaBtc] = useState(String(+initial.sdca.btc.toFixed(8)));
  const [alloc, setAlloc] = useState<Pair[]>(toPairs(initial.rsps.alloc));
  const [rspsCash, setRspsCash] = useState(String(+initial.rsps.cash.toFixed(2)));
  const [units, setUnits] = useState<Pair[]>(toPairs(initial.rsps.units));

  // today's signal: live prices (stored on save as the execution prices); an older signal keeps the prices it was saved with
  const live = date === today;
  const execDay = addDays(date, -1);
  const px = (s: string) => (live ? priceOn(book, s, today) : initial.px?.[s] ?? priceOn(book, s, execDay));
  const syms = [...alloc, ...units].map((r) => r.sym);
  useEffect(() => { onNeed(syms); }, [syms.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const pctNum = n(sdcaPct);
  const sdcaInput = { pct: side === 'sell' ? -pctNum : pctNum, cash: n(sdcaCash), btc: n(sdcaBtc) };
  const allocRec = Object.fromEntries(alloc.map((r) => [r.sym, n(r.v)]));
  const unitsRec = Object.fromEntries(units.filter((r) => n(r.v) > 0).map((r) => [r.sym, n(r.v)]));
  const rspsInput = { alloc: allocRec, cash: n(rspsCash), units: unitsRec };

  const btcPx = px('BTC');
  const order = useMemo(() => (Number.isFinite(btcPx) ? sdcaOrder(sdcaInput, btcPx) : null), [btcPx, side, sdcaPct, sdcaCash, sdcaBtc]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = rebalance(rspsInput, px);
  const sum = alloc.reduce((s, r) => s + n(r.v), 0);

  const errors: string[] = [];
  if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) errors.push('SDCA signal must be between 0% and 100%.');
  if (!(sdcaInput.cash >= 0) || !(sdcaInput.btc >= 0)) errors.push('SDCA cash and BTC must be ≥ 0.');
  if (!(rspsInput.cash >= 0) || Object.values(unitsRec).some((v) => !(v >= 0))) errors.push('RSPS holdings must be ≥ 0.');
  const ae = allocError(allocRec); if (ae) errors.push(`RSPS: ${ae}`);
  if (!Number.isFinite(btcPx)) errors.push('No BTC price yet (still loading).');
  if (plan.missing.length) errors.push(`No price for ${plan.missing.join(', ')} yet (still loading).`);

  const save = () => {
    if (errors.length) return;
    const used = ['BTC', ...Object.keys(allocRec), ...Object.keys(unitsRec)].filter((k) => k !== CASH);
    const snapshot = Object.fromEntries(used.map((k) => [k, px(k)]).filter(([, v]) => Number.isFinite(v as number)));
    onSave({ date, createdAt: Date.now(), sdca: sdcaInput, rsps: { alloc: Object.fromEntries(Object.entries(allocRec).filter(([, v]) => v > 0)), cash: rspsInput.cash, units: unitsRec }, px: snapshot });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{editingExisting ? 'Edit signal' : 'New signal'} · {date}</h2>
            <div className="dim small">{live ? 'Amounts follow live prices; saving stores them as the execution prices and updates Portfolio holdings.' : 'Uses the prices stored when this signal was saved.'} SDCA and RSPS are separate: each uses only its own cash and holdings.</div>
            {live && <div className={`live-dot ${liveAt && now - liveAt < 45_000 ? '' : 'stale'}`}>
              {liveAt ? (now - liveAt < 45_000 ? `Live prices · updated ${Math.max(0, Math.round((now - liveAt) / 1000))} s ago` : `Prices not updated for ${Math.round((now - liveAt) / 1000)} s — check the connection`) : 'Loading live prices…'}
            </div>}</div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>

        <div className="split">
          <div className="card pane">
            <h3>Strategy 1 · SDCA <span className="dim">(BTC only)</span></h3>
            <div className="seg">
              <button className={side === 'buy' ? 'on pos' : ''} onClick={() => setSide('buy')}>Buy BTC</button>
              <button className={side === 'sell' ? 'on neg' : ''} onClick={() => setSide('sell')}>Sell BTC</button>
            </div>
            <label>{side === 'buy' ? 'Signal: % of the SDCA cash reserve to spend on BTC' : 'Signal: % of the BTC held to sell'}<div className="field"><input inputMode="decimal" value={sdcaPct} onChange={(e) => setSdcaPct(e.target.value)} /><span className="unit">%</span></div></label>
            <div className="dim small">Current SDCA part:</div>
            <label>SDCA cash reserve<div className="field"><input inputMode="decimal" value={sdcaCash} onChange={(e) => setSdcaCash(e.target.value)} /><span className="unit">USD</span></div></label>
            <label>BTC held<div className="field"><input inputMode="decimal" value={sdcaBtc} onChange={(e) => setSdcaBtc(e.target.value)} /><span className="unit">BTC</span></div></label>
            <div className="dim small">BTC {live ? 'live' : 'at save'}: {price(btcPx)}</div>
            <h4 style={{ marginTop: 8 }}>Order</h4>
            {order && <SdcaOrderView o={order} live={live} />}
          </div>

          <div className="card pane">
            <h3>Strategy 2 · RSPS</h3>
            <div className="dim small">Target allocation (must sum to 100%):</div>
            <PairRows rows={alloc} setRows={setAlloc} options={ALL_ASSETS} unit="%" placeholder="0" />
            <div className={Math.abs(sum - 100) <= 0.01 ? 'pos small' : 'warn small'}>Sum: {+sum.toFixed(2)}%</div>
            <div className="dim small" style={{ marginTop: 10 }}>Current RSPS part:</div>
            <label>{emojiOf(CASH)} RSPS cash<div className="field"><input inputMode="decimal" value={rspsCash} onChange={(e) => setRspsCash(e.target.value)} /><span className="unit">USD</span></div></label>
            <PairRows rows={units} setRows={setUnits} options={TOKENS.map((t) => t.sym)} unit="units" placeholder="0" extra={(u) => <span className="val">{usd(n(u.v) * px(u.sym), 2)}</span>} />
            <h4 style={{ marginTop: 12 }}>Orders</h4>
            <RebalanceView p={plan} live={live} />
          </div>
        </div>

        {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="modal-foot">
          <div className="after-note">
            {live && order && !plan.missing.length
              ? <>After saving, Portfolio holdings become — <b>SDCA:</b> {fmtUnits(order.after.btc)} BTC + {usd(order.after.cash, 2)} · <b>RSPS:</b> {Object.entries(plan.after.units).map(([k, u]) => `${fmtUnits(u)} ${k}`).join(', ') || 'no tokens'} + {usd(plan.after.cash, 2)}</>
              : !live ? 'Editing an older signal does not change Portfolio holdings.' : null}
          </div>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={errors.length > 0} onClick={save}>Save signal</button>
        </div>
      </div>
    </div>
  );
}
