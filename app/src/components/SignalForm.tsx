import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { MIN_SDCA_BUY_PCT, allocError, rebalance, sdcaOrder, type Signal } from '../lib/engine';
import { priceOn, type PriceBook } from '../lib/prices';
import { ALL_ASSETS, CASH, TOKENS, emojiOf } from '../lib/tokens';
import { addDays } from '../lib/utc';
import { price, usd } from '../lib/format';
import { RebalanceView, SdcaOrderView, allocText } from './SignalHistory';
import { IcClose, IcPlus, IcTrash } from './icons';

interface Props {
  date: string; initial: Signal; book: PriceBook; editingExisting: boolean;
  onNeed: (syms: string[]) => void; onSave: (s: Signal) => void; onClose: () => void; today: string; liveAt: number | null; feePct: number;
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

export function SignalForm({ date, initial, book, editingExisting, onNeed, onSave, onClose, today, liveAt, feePct }: Props) {
  // fee: today's signal uses the setting, an older one keeps the fee it was saved with
  const fee = date === today ? feePct / 100 : initial.fee ?? 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const [side, setSide] = useState<'buy' | 'sell'>(initial.sdca.pct < 0 ? 'sell' : 'buy');
  const [sdcaPct, setSdcaPct] = useState(String(Math.abs(initial.sdca.pct)));
  const [sdcaCash, setSdcaCash] = useState(String(+initial.sdca.cash.toFixed(2)));
  const [sdcaBtc, setSdcaBtc] = useState(String(+initial.sdca.btc.toFixed(8)));
  const [alloc, setAlloc] = useState<Pair[]>(toPairs(initial.rsps.alloc));
  const [rspsCash, setRspsCash] = useState(String(+initial.rsps.cash.toFixed(2)));
  const [units, setUnits] = useState<Pair[]>(toPairs(initial.rsps.units));
  // tick a strategy to enter a new signal for it; unticked = no change today (DUPLICATED: no trades, holdings carried)
  const [sdcaNew, setSdcaNew] = useState(editingExisting ? initial.sdcaNew !== false : false);
  const [rspsNew, setRspsNew] = useState(editingExisting ? initial.rspsNew !== false : false);

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
  const order = useMemo(() => (Number.isFinite(btcPx) ? sdcaOrder(sdcaInput, btcPx, fee) : null), [btcPx, side, sdcaPct, sdcaCash, sdcaBtc, fee]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = rebalance(rspsInput, px, fee);
  const sum = alloc.reduce((s, r) => s + n(r.v), 0);

  const errors: string[] = [];
  if (sdcaNew && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100)) errors.push('SDCA signal must be between 0% and 100%.');
  if (sdcaNew && side === 'buy' && pctNum > 0 && pctNum < MIN_SDCA_BUY_PCT) errors.push(`Minimum SDCA buy is ${MIN_SDCA_BUY_PCT}% of the SDCA cash reserve.`);
  if (!(sdcaInput.cash >= 0) || !(sdcaInput.btc >= 0)) errors.push('SDCA cash and BTC must be ≥ 0.');
  if (!(rspsInput.cash >= 0) || Object.values(unitsRec).some((v) => !(v >= 0))) errors.push('RSPS holdings must be ≥ 0.');
  const ae = rspsNew ? allocError(allocRec) : null; if (ae) errors.push(`RSPS: ${ae}`);
  if (!Number.isFinite(btcPx)) errors.push('No BTC price yet (still loading).');
  if (rspsNew && plan.missing.length) errors.push(`No price for ${plan.missing.join(', ')} yet (still loading).`);
  const nothing = !sdcaNew && !rspsNew;
  const afterSdca = sdcaNew && order ? order.after : { cash: sdcaInput.cash, btc: sdcaInput.btc };
  const afterRsps = rspsNew ? plan.after : { cash: rspsInput.cash, units: unitsRec };

  const save = () => {
    if (errors.length || nothing) return;
    const used = ['BTC', ...Object.keys(allocRec), ...Object.keys(unitsRec)].filter((k) => k !== CASH);
    const snapshot = Object.fromEntries(used.map((k) => [k, px(k)]).filter(([, v]) => Number.isFinite(v as number)));
    onSave({
      date, createdAt: Date.now(), px: snapshot, sdcaNew, rspsNew, fee,
      sdca: sdcaNew ? sdcaInput : { ...sdcaInput, pct: 0 },
      rsps: { alloc: rspsNew ? Object.fromEntries(Object.entries(allocRec).filter(([, v]) => v > 0)) : initial.rsps.alloc, cash: rspsInput.cash, units: unitsRec }
    });
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
            <div className="pane-head">
              <h3>Strategy 1 · SDCA <span className="dim">(BTC only)</span></h3>
              <label className="check new-toggle"><input type="checkbox" checked={sdcaNew} onChange={(e) => setSdcaNew(e.target.checked)} /><span />New signal today</label>
            </div>
            {!sdcaNew ? (
              <div className="dup-box">
                <span className="tag dup">DUPLICATED</span>
                <div>No new SDCA signal — no trade today. Holdings stay: <b>{fmtUnits(sdcaInput.btc)} BTC</b> + <b>{usd(sdcaInput.cash, 2)}</b> cash.</div>
                <div className="dim small">Tick “New signal today” to enter a buy or sell.</div>
              </div>
            ) : <>
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
            </>}
          </div>

          <div className="card pane">
            <div className="pane-head">
              <h3>Strategy 2 · RSPS</h3>
              <label className="check new-toggle"><input type="checkbox" checked={rspsNew} onChange={(e) => setRspsNew(e.target.checked)} /><span />New signal today</label>
            </div>
            {!rspsNew ? (
              <div className="dup-box">
                <span className="tag dup">DUPLICATED</span>
                <div>No new RSPS signal — no rebalance today. The allocation stays: <b>{allocText(initial.rsps.alloc) || '—'}</b></div>
                <div>Holdings stay: <b>{Object.entries(unitsRec).map(([k, u]) => `${fmtUnits(u)} ${k}`).join(', ') || 'no tokens'}</b> + <b>{usd(rspsInput.cash, 2)}</b> cash.</div>
                <div className="dim small">Tick “New signal today” to enter a new allocation.</div>
              </div>
            ) : <>
            <div className="dim small">Target allocation (must sum to 100%):</div>
            <PairRows rows={alloc} setRows={setAlloc} options={ALL_ASSETS} unit="%" placeholder="0" />
            <div className={Math.abs(sum - 100) <= 0.01 ? 'pos small' : 'warn small'}>Sum: {+sum.toFixed(2)}%</div>
            <div className="dim small" style={{ marginTop: 10 }}>Current RSPS part:</div>
            <label>{emojiOf(CASH)} RSPS cash<div className="field"><input inputMode="decimal" value={rspsCash} onChange={(e) => setRspsCash(e.target.value)} /><span className="unit">USD</span></div></label>
            <PairRows rows={units} setRows={setUnits} options={TOKENS.map((t) => t.sym)} unit="units" placeholder="0" extra={(u) => <span className="val">{usd(n(u.v) * px(u.sym), 2)}</span>} />
            <h4 style={{ marginTop: 12 }}>Orders</h4>
            <RebalanceView p={plan} live={live} />
            </>}
          </div>
        </div>

        {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="modal-foot">
          <div className="after-note">
            {nothing
              ? <>No new signal ticked — nothing to save. {editingExisting ? 'To make this day DUPLICATED, delete its signal (Edit → bin).' : 'Today stays DUPLICATED.'}</>
              : live && (!rspsNew || !plan.missing.length)
                ? <>After saving, Portfolio holdings become — <b>SDCA:</b> {fmtUnits(afterSdca.btc)} BTC + {usd(afterSdca.cash, 2)} · <b>RSPS:</b> {Object.entries(afterRsps.units).map(([k, u]) => `${fmtUnits(u)} ${k}`).join(', ') || 'no tokens'} + {usd(afterRsps.cash, 2)}</>
                : !live ? 'Editing an older signal does not change Portfolio holdings.' : null}
          </div>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={errors.length > 0 || nothing} onClick={save}>Save signal</button>
        </div>
      </div>
    </div>
  );
}
