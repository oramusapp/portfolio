import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { equityCash, internalCash, MIN_SDCA_BUY_PCT, MAX_LEV, allocError, fillCash, levOf, maxLevFromMm, rebalance, sdcaOrder, type Signal } from '../lib/engine';
import { priceOn, type PriceBook } from '../lib/prices';
import { ALL_ASSETS, CASH, TOKENS, emojiOf } from '../lib/tokens';
import { addDays } from '../lib/utc';
import { price, usd } from '../lib/format';
import { RebalanceView, SdcaOrderView, allocText } from './SignalHistory';
import { IcClose, IcPlus, IcTrash } from './icons';
import { parseSignal } from '../lib/parseSignal';

interface Props {
  date: string; initial: Signal; book: PriceBook; editingExisting: boolean;
  onNeed: (syms: string[]) => void; onSave: (s: Signal) => void; onClose: () => void; today: string; liveAt: number | null; sameDay?: number;
  /** crypto fees in %: spot (SDCA and RSPS longs at 1×) and perp (shorts, longs above 1×) */
  feePct: number; feePerpPct: number;
  /** maintenance margin per coin (Hyperliquid) → the exchange's max leverage, for a warning */
  mm?: Record<string, number>;
}

const fmtUnits = (v: number) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v.toLocaleString('en-US', { maximumFractionDigits: 8 }));

/** short = the amount is a short position (RSPS only); `v` is always typed as a positive number; lev = 1–5× (RSPS). */
export type Pair = { sym: string; v: string; short?: boolean; lev?: number };
export const toPairs = (r: Record<string, number>, lev?: Record<string, number>) =>
  Object.entries(r).map(([sym, v]) => ({ sym, v: String(+Math.abs(v).toFixed(8)), ...(v < 0 ? { short: true } : {}), ...(levOf(lev, sym) > 1 ? { lev: levOf(lev, sym) } : {}) }));
/** { sym: lev } for the rows above 1× (with a positive amount), or undefined. */
export const levRec = (rows: Pair[]) => {
  const out = Object.fromEntries(rows.filter((r) => r.sym !== CASH && (r.lev ?? 1) > 1 && n(r.v) > 0).map((r) => [r.sym, r.lev!]));
  return Object.keys(out).length ? out : undefined;
};
const LEVS = Array.from({ length: MAX_LEV }, (_, i) => i + 1);
export const n = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(',', '.')));
/** Signed value of a row: a short counts as negative. */
export const signed = (r: Pair) => (r.short && r.sym !== CASH ? -1 : 1) * n(r.v);

function AssetSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (s: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((s) => <option key={s} value={s}>{emojiOf(s)} {s}</option>)}
    </select>
  );
}

export function PairRows({ rows, setRows, options, unit, placeholder, extra, sides, levs, maxLevOf }: { rows: Pair[]; setRows: (r: Pair[]) => void; options: string[]; unit: string; placeholder: string; extra?: (r: Pair) => ReactNode; sides?: boolean; levs?: boolean; maxLevOf?: (sym: string) => number }) {
  const free = (keep: string) => options.filter((s) => s === keep || !rows.some((r) => r.sym === s));
  return (
    <div className="pairs">
      {rows.map((r, i) => (
        <div className="pair" key={i}>
          <AssetSelect value={r.sym} options={free(r.sym)} onChange={(sym) => setRows(rows.map((x, j) => (j === i ? { ...x, sym } : x)))} />
          <input inputMode="decimal" value={r.v} placeholder={placeholder} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
          <span className="unit">{unit}</span>
          {sides && r.sym !== CASH && (
            <button type="button" className={`ls ${r.short ? 'short' : 'long'}`} aria-pressed={!!r.short} title={r.short ? `Short (perp, ${r.lev ?? 1}× leverage) — tap for long` : (r.lev ?? 1) > 1 ? `Long (perp, ${r.lev}× leverage) — tap for short` : 'Long (spot) — tap for short (perp)'}
              onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, short: !x.short } : x)))}>{r.short ? 'SHORT' : 'LONG'}</button>
          )}
          {levs && r.sym !== CASH && (() => {
            // Hyperliquid: leverage is a whole number from 1 to the coin's max leverage (here capped at 5×)
            const max = maxLevOf ? maxLevOf(r.sym) : NaN;
            return (
              <select className={`lev${(r.lev ?? 1) > 1 ? ' on' : ''}`} aria-label={`${r.sym} leverage`} title={`Leverage: 1× = no leverage (a 1× long is spot), up to 5×${Number.isFinite(max) ? `; Hyperliquid max for ${r.sym}: ${max}×` : ''}`}
                value={r.lev ?? 1} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, lev: Number(e.target.value) > 1 ? Number(e.target.value) : undefined } : x)))}>
                {LEVS.map((l) => <option key={l} value={l} disabled={Number.isFinite(max) && l > max && l !== (r.lev ?? 1)}>{l}×</option>)}
              </select>
            );
          })()}
          {extra?.(r)}
          <button className="icon" onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove"><IcTrash width={16} /></button>
        </div>
      ))}
      {free('').length > 0 && <button className="btn ghost small" onClick={() => setRows([...rows, { sym: free('')[0], v: '' }])}><IcPlus width={15} />Add asset</button>}
    </div>
  );
}

export function SignalForm({ date, initial, book, editingExisting, onNeed, onSave, onClose, today, liveAt, feePct, feePerpPct, sameDay = 0, mm }: Props) {
  // fee: today's signal uses the settings, an older one keeps the fees it was saved with
  const fee = date === today ? feePct / 100 : initial.fee ?? 0;
  const feePerp = date === today ? feePerpPct / 100 : initial.feePerp ?? fee;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const [side, setSide] = useState<'buy' | 'sell'>(initial.sdca.pct < 0 ? 'sell' : 'buy');
  const [sdcaPct, setSdcaPct] = useState(String(Math.abs(initial.sdca.pct)));
  const [sdcaCash, setSdcaCash] = useState(String(+initial.sdca.cash.toFixed(2)));
  const [sdcaBtc, setSdcaBtc] = useState(String(+initial.sdca.btc.toFixed(8)));
  const [alloc, setAlloc] = useState<Pair[]>(toPairs(initial.rsps.alloc, initial.rsps.lev));
  // RSPS cash is typed as the exchange shows it (USDT equity); null = not edited → derived from the saved holdings
  const [rspsCashEq, setRspsCashEq] = useState<string | null>(null);
  const [units, setUnits] = useState<Pair[]>(toPairs(initial.rsps.units, initial.rsps.heldLev));
  // tick a strategy to enter a new signal for it; unticked = no change today (DUPLICATED: no trades, holdings carried)
  const [sdcaNew, setSdcaNew] = useState(editingExisting ? initial.sdcaNew !== false : false);
  const [rspsNew, setRspsNew] = useState(editingExisting ? initial.rspsNew !== false : false);
  // "Paste signal": the TRW message fills the form; the user still checks it and saves
  const [pasteText, setPasteText] = useState('');
  const [pasteNote, setPasteNote] = useState<{ ok: boolean; text: string } | null>(null);
  const applyPaste = (text: string) => {
    const p = parseSignal(text);
    const notes: string[] = [];
    if (p.rsps) {
      const rows: Pair[] = p.rsps.rows.map((r) => ({ sym: r.sym, v: String(r.pct), ...(r.short ? { short: true } : {}) }));
      setAlloc(rows.length ? rows : [{ sym: CASH, v: '100' }]);
      setRspsNew(true);
      const longs = p.rsps.rows.filter((r) => !r.short), shorts = p.rsps.rows.filter((r) => r.short);
      const shortSum = shorts.reduce((t, r) => t + r.pct, 0);
      notes.push(`RSPS: ${longs.length} long, ${shorts.length} short${shorts.length ? ` (${+shortSum.toFixed(2)}%)` : ''} — the rest goes to CASH`);
      if (p.rsps.shortTotalInMessage != null && Math.abs(p.rsps.shortTotalInMessage - shortSum) > 0.05)
        notes.push(`the short lines add up to ${+shortSum.toFixed(2)}%, the message says ${p.rsps.shortTotalInMessage}% (rounded) — the lines are used`);
    }
    if (p.sdca) { setSdcaNew(true); setSide(p.sdca.side); setSdcaPct(String(p.sdca.pct)); notes.push(`SDCA: ${p.sdca.side} ${p.sdca.pct}% of the SDCA cash`); }
    if (p.unknown.length) notes.push(`not on the RSPS list, skipped: ${p.unknown.join(', ')}`);
    if (!p.rsps && !p.sdca) { setPasteNote({ ok: false, text: 'No signal found in this text. Copy the whole message from TRW (RSPS / Short Module / SDCA).' }); return; }
    setPasteNote({ ok: !p.unknown.length, text: 'Filled in: ' + notes.join(' · ') + '. Check it below, then save.' });
  };

  // today's signal: live prices (stored on save as the execution prices); an older signal keeps the prices it was saved with
  const live = date === today;
  const execDay = addDays(date, -1);
  const px = (s: string) => (live ? priceOn(book, s, today) : initial.px?.[s] ?? priceOn(book, s, execDay));
  const syms = [...alloc, ...units].map((r) => r.sym);
  useEffect(() => { onNeed(syms); }, [syms.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const pctNum = n(sdcaPct);
  const sdcaInput = { pct: side === 'sell' ? -pctNum : pctNum, cash: n(sdcaCash), btc: n(sdcaBtc) };
  // under 100% the rest goes to CASH automatically (confirmed on save)
  const { alloc: allocRec, added: cashAdded } = fillCash(Object.fromEntries(alloc.map((r) => [r.sym, signed(r)])));
  const [confirmCash, setConfirmCash] = useState(false);
  const unitsRec = Object.fromEntries(units.filter((r) => n(r.v) > 0).map((r) => [r.sym, signed(r)]));
  const heldLev = levRec(units), tgtLev = levRec(alloc);
  const initEq = equityCash(initial.rsps.cash, initial.rsps.units, px, initial.rsps.heldLev);
  const rspsCash = rspsCashEq ?? (Number.isFinite(initEq) ? String(+initEq.toFixed(2)) : '');
  const rspsEq = n(rspsCash);
  const rspsInput = { alloc: allocRec, cash: internalCash(rspsEq, unitsRec, px, heldLev), units: unitsRec, ...(tgtLev ? { lev: tgtLev } : {}), ...(heldLev ? { heldLev } : {}) };

  const btcPx = px('BTC');
  const order = useMemo(() => (Number.isFinite(btcPx) ? sdcaOrder(sdcaInput, btcPx, fee) : null), [btcPx, side, sdcaPct, sdcaCash, sdcaBtc, fee]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = rebalance(rspsInput, px, fee, feePerp);
  const sum = alloc.reduce((s, r) => s + n(r.v), 0);   // shorts count with their size
  const shorts = alloc.filter((r) => r.short && r.sym !== CASH && n(r.v) > 0);
  const levRows = alloc.filter((r) => r.sym !== CASH && n(r.v) > 0 && (r.lev ?? 1) > 1);
  const exposure = alloc.reduce((t, r) => t + (r.sym !== CASH ? n(r.v) * (r.lev ?? 1) : 0), 0);

  const errors: string[] = [];
  if (sdcaNew && (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100)) errors.push('SDCA signal must be between 0% and 100%.');
  if (sdcaNew && side === 'buy' && pctNum > 0 && pctNum < MIN_SDCA_BUY_PCT) errors.push(`Minimum SDCA buy is ${MIN_SDCA_BUY_PCT}% of the SDCA cash reserve.`);
  if (!(sdcaInput.cash >= 0) || !(sdcaInput.btc >= 0)) errors.push('SDCA cash and BTC must be ≥ 0.');
  if (!(rspsInput.cash >= 0) || units.some((r) => !(n(r.v) >= 0))) errors.push('RSPS holdings must be ≥ 0 (use SHORT for a short position).');
  if (alloc.some((r) => !(n(r.v) >= 0))) errors.push('RSPS: type the % as a positive number and use LONG / SHORT for the side.');
  const ae = rspsNew ? allocError(allocRec, undefined, undefined, true) : null; if (ae) errors.push(`RSPS: ${ae}`);
  for (const r of [...levRows, ...units.filter((u) => n(u.v) > 0 && (u.lev ?? 1) > 1)]) {
    const max = maxLevFromMm(mm?.[r.sym]);
    if (Number.isFinite(max) && (r.lev ?? 1) > max) errors.push(`${r.sym}: Hyperliquid allows at most ${max}× on this coin.`);
  }
  if (!Number.isFinite(btcPx)) errors.push('No BTC price yet (still loading).');
  if (rspsNew && plan.missing.length) errors.push(`No price for ${plan.missing.join(', ')} yet (still loading).`);
  const nothing = !sdcaNew && !rspsNew;
  const afterSdca = sdcaNew && order ? order.after : { cash: sdcaInput.cash, btc: sdcaInput.btc };
  const afterRsps = rspsNew ? plan.after : { cash: rspsInput.cash, units: unitsRec, ...(heldLev ? { lev: heldLev } : {}) };

  const save = (confirmed = false) => {
    if (errors.length || nothing) return;
    if (rspsNew && cashAdded > 0 && !confirmed) { setConfirmCash(true); return; }
    const used = ['BTC', ...Object.keys(allocRec), ...Object.keys(unitsRec)].filter((k) => k !== CASH);
    const snapshot = Object.fromEntries(used.map((k) => [k, px(k)]).filter(([, v]) => Number.isFinite(v as number)));
    onSave({
      date, createdAt: Date.now(), px: snapshot, sdcaNew, rspsNew, fee, feePerp,
      sdca: sdcaNew ? sdcaInput : { ...sdcaInput, pct: 0 },
      rsps: {
        alloc: rspsNew ? Object.fromEntries(Object.entries(allocRec).filter(([, v]) => v !== 0)) : initial.rsps.alloc, cash: rspsInput.cash, units: unitsRec,
        ...((rspsNew ? tgtLev : initial.rsps.lev) ? { lev: rspsNew ? tgtLev : initial.rsps.lev } : {}), heldLev: heldLev ?? {}
      }
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{editingExisting ? 'Edit signal' : sameDay > 0 ? `Signal ${sameDay + 1} for today` : 'New signal'} · {date}</h2>
            {!editingExisting && sameDay > 0 && <div className="small" style={{ color: 'var(--accent)' }}>Another signal today — it starts from the holdings after the previous one.</div>}
            <div className="dim small">{live ? 'Amounts follow live prices; saving stores them as the execution prices and updates Portfolio holdings.' : 'Uses the prices stored when this signal was saved.'} SDCA and RSPS are separate: each uses only its own cash and holdings.</div>
            {live && <div className={`live-dot ${liveAt && now - liveAt < 45_000 ? '' : 'stale'}`}>
              {liveAt ? (now - liveAt < 45_000 ? `Live prices · updated ${Math.max(0, Math.round((now - liveAt) / 1000))} s ago` : `Prices not updated for ${Math.round((now - liveAt) / 1000)} s — check the connection`) : 'Loading live prices…'}
            </div>}</div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>

        <details className="card paste-signal" open={!editingExisting}>
          <summary>Paste signal from TRW</summary>
          <textarea rows={3} value={pasteText} placeholder="Paste the RSPS / Short Module and/or SDCA message here"
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); setPasteText(t); applyPaste(t); } }} />
          <div className="paste-row">
            <button type="button" className="btn small" disabled={!pasteText.trim()} onClick={() => applyPaste(pasteText)}>Fill the form</button>
            {pasteNote && <span className={`small ${pasteNote.ok ? 'pos' : 'warn'}`}>{pasteNote.text}</span>}
          </div>
        </details>

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
                <div>No new RSPS signal — no rebalance today. The allocation stays: <b>{allocText(initial.rsps.alloc, initial.rsps.lev) || '—'}</b></div>
                <div>Holdings stay: <b>{Object.entries(unitsRec).map(([k, u]) => `${fmtUnits(u)} ${k}`).join(', ') || 'no tokens'}</b> + <b>{usd(rspsEq, 2)}</b> cash (USDT equity).</div>
                <div className="dim small">Tick “New signal today” to enter a new allocation.</div>
              </div>
            ) : <>
            <div className="dim small">Target allocation (100%; anything left under 100% goes to {emojiOf(CASH)} CASH). Tap LONG / SHORT to switch a coin's side; 1×–5× = leverage (1× = none, the % is the margin):</div>
            <PairRows rows={alloc} setRows={setAlloc} options={ALL_ASSETS} unit="%" placeholder="0" sides levs maxLevOf={(s) => maxLevFromMm(mm?.[s])} />
            <div className={Math.abs(sum - 100) <= 0.01 ? 'pos small' : 'warn small'}>Sum: {+sum.toFixed(2)}%{cashAdded > 0 && <> — the remaining <b>{+cashAdded.toFixed(4)}%</b> goes to {emojiOf(CASH)} CASH (CASH {+allocRec[CASH].toFixed(4)}% in total)</>}</div>
            {shorts.length > 0 && <div className="dim small">Short {+shorts.reduce((t, r) => t + n(r.v), 0).toFixed(2)}% as a perpetual short (margin = the %, position = margin × leverage): it gains when the price falls and loses when it rises. Funding (Hyperliquid) is counted, and a short is liquidated — its margin lost — if the price rises to entry × (1 + 1/leverage) / (1 + maintenance margin) (about 2× entry at 1×).</div>}
            {levRows.length > 0 && <div className="dim small">Leverage: {levRows.map((r) => `${r.sym} ${+n(r.v).toFixed(2)}% × ${r.lev} = ${+(n(r.v) * r.lev!).toFixed(2)}% ${r.short ? 'short' : 'long'}`).join(' · ')}. Total exposure <b>{+exposure.toFixed(2)}%</b> of RSPS. A leveraged long is a perp (funding; liquidated — margin lost — at entry × (1 − 1/leverage) / (1 − maintenance margin)).</div>}
            <div className="dim small" style={{ marginTop: 10 }}>Current RSPS part:</div>
            <label>{emojiOf(CASH)} RSPS cash — USDT equity on the exchange<div className="field"><input inputMode="decimal" value={rspsCash} onChange={(e) => setRspsCashEq(e.target.value)} /><span className="unit">USD</span></div></label>
            <div className="dim small">Type what the exchange shows (Bybit: USDT equity = balance with the perps' margin and unrealized P/L). The app adds the open perps (shorts, longs above 1×) itself; set each held coin's leverage as on the exchange.</div>
            <PairRows rows={units} setRows={setUnits} options={TOKENS.map((t) => t.sym)} unit="units" placeholder="0" sides levs extra={(u) => <span className="val">{usd(signed(u) * px(u.sym), 2)}</span>} />
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
                ? <>After saving, Portfolio holdings become — <b>SDCA:</b> {fmtUnits(afterSdca.btc)} BTC + {usd(afterSdca.cash, 2)} · <b>RSPS:</b> {Object.entries(afterRsps.units).map(([k, u]) => `${fmtUnits(u)} ${k}${levOf(afterRsps.lev, k) > 1 ? ` (${levOf(afterRsps.lev, k)}×)` : ''}`).join(', ') || 'no tokens'} + {usd(equityCash(afterRsps.cash, afterRsps.units, px, afterRsps.lev), 2)} USDT equity</>
                : !live ? 'Editing an older signal does not change Portfolio holdings.' : null}
          </div>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={errors.length > 0 || nothing} onClick={() => save()}>Save signal</button>
        </div>
        {confirmCash && (
          <div className="overlay confirm-overlay" onClick={() => setConfirmCash(false)}>
            <div className="modal confirm-box" role="alertdialog" aria-labelledby="cash-confirm-title" onClick={(e) => e.stopPropagation()}>
              <h3 id="cash-confirm-title">Save with this allocation?</h3>
              <div>The coins add up to <b>{+(100 - cashAdded).toFixed(4)}%</b>. The remaining <b>{+cashAdded.toFixed(4)}%</b> will be kept as {emojiOf(CASH)} <b>CASH</b>.</div>
              <div className="dim small">{allocText(allocRec, tgtLev)}</div>
              <div className="row-btns">
                <button className="btn ghost" onClick={() => setConfirmCash(false)}>Back</button>
                <button className="btn gold" onClick={() => { setConfirmCash(false); save(true); }}>Yes, save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
