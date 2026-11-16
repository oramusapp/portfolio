import { useEffect, useState } from 'react';
import { priceOn, type PriceBook } from '../lib/prices';
import { CASH, TOKENS, emojiOf } from '../lib/tokens';
import { equityCash, frozenCash, internalCash, type SdcaState, type RspsState } from '../lib/engine';
import { num, price, usd } from '../lib/format';
import { PairRows, toPairs, n, signed, type Pair } from './SignalForm';
import { IcClose } from './icons';

export interface Holdings { sdca: SdcaState; rsps: RspsState; updatedAt: number; }

export interface Flow { id: string; time: number; strategy: 'sdca' | 'rsps'; amount: number; }   // + deposit, − withdrawal (USD)
interface Props {
  initial: Holdings; book: PriceBook; today: string; onNeed: (syms: string[]) => void; onSave: (h: Holdings) => void; onClose: () => void;
  flows: Flow[]; onFlow: (f: Flow) => void;
  /** average entry price of each open short (from the saved signals); missing → today's price */
  entry?: Record<string, number>;
}

/** Current portfolio state per strategy; values are computed from the live price (open daily candle). */
export function HoldingsPanel({ initial, book, today, onNeed, onSave, onClose, flows, onFlow, entry }: Props) {
  const [flowOpen, setFlowOpen] = useState(false);
  const [flowStrat, setFlowStrat] = useState<'sdca' | 'rsps'>('sdca');
  const [flowSide, setFlowSide] = useState<'in' | 'out'>('in');
  const [flowAmt, setFlowAmt] = useState('');
  const [btc, setBtc] = useState(String(+initial.sdca.btc.toFixed(8)));
  const [sdcaCash, setSdcaCash] = useState(String(+initial.sdca.cash.toFixed(2)));
  const [units, setUnits] = useState<Pair[]>(toPairs(initial.rsps.units));
  // RSPS cash is typed as the exchange shows it (USDT equity); null = not edited → derived from the saved holdings
  const [rspsCashEq, setRspsCashEq] = useState<string | null>(null);

  const px = (s: string) => priceOn(book, s, today);
  const initEq = equityCash(initial.rsps.cash, initial.rsps.units, px);
  const rspsCash = rspsCashEq ?? (Number.isFinite(initEq) ? String(+initEq.toFixed(2)) : '');
  const setRspsCash = (v: string) => setRspsCashEq(v);
  useEffect(() => { onNeed(units.map((u) => u.sym)); }, [units.map((u) => u.sym).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const btcValue = n(btc) * px('BTC');
  const sdcaTotal = btcValue + n(sdcaCash);
  const tokenValue = (u: Pair) => signed(u) * px(u.sym);   // a short counts as negative
  // equity already contains the shorts (margin + unrealized P/L) → only the longs are added
  const rspsTotal = units.reduce((t, u) => t + (n(u.v) > 0 && !u.short ? tokenValue(u) : 0), n(rspsCash));
  const unitsSigned = Object.fromEntries(units.filter((u) => n(u.v) > 0).map((u) => [u.sym, signed(u)]));
  const bad = [btc, sdcaCash, rspsCash, ...units.map((u) => u.v)].some((v) => !(n(v) >= 0));
  // cash frozen by the open shorts (margin + entry value) — not free to withdraw
  const entryPx = (s: string) => entry?.[s] ?? NaN;
  const frozen = frozenCash(Object.fromEntries(units.filter((u) => u.short && n(u.v) > 0).map((u) => [u.sym, signed(u)])), entryPx, px);
  const frozenNow = frozenCash(initial.rsps.units, entryPx, px);

  const save = () => {
    if (bad) return;
    onSave({
      sdca: { btc: n(btc), cash: n(sdcaCash) },
      rsps: { cash: internalCash(n(rspsCash), unitsSigned, px), units: unitsSigned },
      updatedAt: Date.now()
    });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>Portfolio holdings</h2>
            <div className="dim small">What you hold now in each strategy. Values use the live price. The next signal starts from these holdings.</div></div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>

        <div className="split">
          <div className="card pane">
            <h3>SDCA <span className="dim">(BTC)</span> <span className="right">{usd(sdcaTotal, 2)}</span></h3>
            <label>{emojiOf('BTC')} BTC amount<div className="field"><input inputMode="decimal" value={btc} onChange={(e) => setBtc(e.target.value)} /><span className="unit">BTC</span></div></label>
            <div className="dim small">Value: {usd(btcValue, 2)} @ {price(px('BTC'))}</div>
            <label>{emojiOf(CASH)} Cash reserve<div className="field"><input inputMode="decimal" value={sdcaCash} onChange={(e) => setSdcaCash(e.target.value)} /><span className="unit">USD</span></div></label>
          </div>

          <div className="card pane">
            <h3>RSPS <span className="right">{usd(rspsTotal, 2)}</span></h3>
            <div className="dim small">Tokens and amounts:</div>
            <PairRows rows={units} setRows={setUnits} options={TOKENS.map((t) => t.sym)} unit="units" placeholder="0" sides
              extra={(u) => <span className="val">{usd(tokenValue(u), 2)}</span>} />
            <label>{emojiOf(CASH)} Cash — USDT equity on the exchange<div className="field"><input inputMode="decimal" value={rspsCash} onChange={(e) => setRspsCash(e.target.value)} /><span className="unit">USD</span></div></label>
            <div className="dim small">Type what the exchange shows (Bybit: USDT equity = balance with the shorts' margin and unrealized P/L). The shorts are already in it, so only longs are added.</div>
            {frozen > 0 && <div className={n(rspsCash) < frozen / 2 - 0.005 ? 'warn small' : 'dim small'}>🔒 {usd(frozen / 2, 2)} of it is the margin of the shorts (1×) · free ≈ <b>{usd(n(rspsCash) - frozen / 2, 2)}</b></div>}
            {units.length > 0 && <div className="dim small">{units.map((u) => `${u.sym} ${u.short ? 'short ' : ''}${num(n(u.v), 6)} @ ${price(px(u.sym))}`).join(' · ')}</div>}
          </div>
        </div>

        <div className="total-row"><span className="dim">Total portfolio</span><b>{usd(sdcaTotal + rspsTotal, 2)}</b></div>

        <div className="card pane">
          <div className="pane-head">
            <h3>Deposits &amp; withdrawals</h3>
            {!flowOpen && <button className="btn ghost small" onClick={() => setFlowOpen(true)}>Deposit / Withdraw</button>}
          </div>
          <div className="dim small">Money added to or taken from a strategy's cash. It changes the cash at once and counts as a deposit / withdrawal, not as profit or loss.</div>
          {flowOpen && (() => {
            const amt = n(flowAmt), cashNow = flowStrat === 'sdca' ? initial.sdca.cash : Math.max(0, initial.rsps.cash - frozenNow);
            const err = !(amt > 0) ? 'Enter an amount.' : flowSide === 'out' && amt > cashNow + 1e-9
              ? `Only ${usd(cashNow, 2)} free cash in ${flowStrat.toUpperCase()}${flowStrat === 'rsps' && frozenNow > 0 ? ` (${usd(frozenNow, 2)} is frozen by the shorts)` : ''}.` : null;
            return (
              <div className="flow-form">
                <div className="seg"><button className={flowStrat === 'sdca' ? 'on' : ''} onClick={() => setFlowStrat('sdca')}>SDCA</button><button className={flowStrat === 'rsps' ? 'on' : ''} onClick={() => setFlowStrat('rsps')}>RSPS</button></div>
                <div className="seg"><button className={flowSide === 'in' ? 'on pos' : ''} onClick={() => setFlowSide('in')}>Deposit</button><button className={flowSide === 'out' ? 'on neg' : ''} onClick={() => setFlowSide('out')}>Withdraw</button></div>
                <div className="field"><input inputMode="decimal" placeholder="0" value={flowAmt} onChange={(e) => setFlowAmt(e.target.value)} /><span className="unit">USD</span></div>
                {flowAmt && err && <div className="warn small">{err}</div>}
                <div className="modal-foot">
                  <button className="btn ghost small" onClick={() => { setFlowOpen(false); setFlowAmt(''); }}>Cancel</button>
                  <button className="btn gold small" disabled={!!err} onClick={() => onFlow({ id: `${Date.now()}`, time: Date.now(), strategy: flowStrat, amount: flowSide === 'in' ? amt : -amt })}>Apply</button>
                </div>
              </div>
            );
          })()}
          {flows.length > 0 && (
            <table className="mini">
              <tbody>{[...flows].reverse().slice(0, 8).map((f) => (
                <tr key={f.id}><td className="dim">{new Date(f.time).toLocaleDateString()}</td><td>{f.strategy.toUpperCase()}</td>
                  <td className={`r ${f.amount >= 0 ? 'pos' : 'neg'}`}>{f.amount >= 0 ? '+' : '−'}{usd(Math.abs(f.amount), 2)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        {bad && <ul className="errors"><li>Amounts must be numbers ≥ 0.</li></ul>}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={bad} onClick={save}>Save holdings</button>
        </div>
      </div>
    </div>
  );
}
