import { Fragment, useEffect, useMemo, useState } from 'react';
import { allocError, rebalance } from './lib/engine';
import {
  UNIVERSES, benchmarkEtf, dcaOrder, etfCostBasis, etfPrice, executeEtf, lastCloseDate, simulateEtf,
  type DcaOrder, type EtfSignal, type EtfState, type EtfUniverse
} from './lib/etf';
import type { PriceBook } from './lib/prices';
import { archive, usePersisted } from './lib/storage';
import { CASH, emojiOf } from './lib/tokens';
import { addDays } from './lib/utc';
import { num, pct, price, tone, usd } from './lib/format';
import { Kpis } from './components/Kpis';
import { LineChart, type Line } from './components/LineChart';
import { StatsCard } from './components/StatsCard';
import { RebalanceView } from './components/SignalHistory';
import { PairRows, n, toPairs, type Pair } from './components/SignalForm';
import { IcChevron, IcClose, IcPen, IcPlus, IcTrash } from './components/icons';

// ---------- market data (markets.json, written daily by the GitHub Action) ----------
export interface MarketTicker { name: string; yahoo: string; exchange: string; currency: string; lastDate: string; lastLocal: number; closes: Record<string, number>; }
const REFRESH_MS = 30 * 60_000;
export function useMarkets() {
  const [data, setData] = useState<{ updated: string; tickers: Record<string, MarketTicker> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`./markets.json?t=${Math.floor(Date.now() / REFRESH_MS)}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (alive) { setData(j); setError(null); }
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    const wake = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', wake);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', wake); };
  }, []);
  const book: PriceBook = useMemo(() => Object.fromEntries(Object.entries(data?.tickers ?? {}).map(([k, v]) => [k, v.closes])), [data]);
  return { data, book, error };
}

interface Flow { id: string; time: number; amount: number; }
interface Holdings extends EtfState { updatedAt: number; }

const shares = (v: number) => (!Number.isFinite(v) ? '—' : v >= 1000 ? num(v, 2) : num(v, 6));
const allocLine = (a: Record<string, number>) => Object.entries(a).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k === CASH ? `${emojiOf(CASH)} ` : ''}${k} ${+v.toFixed(2)}%`).join(' · ');
const PAGE = 10;

// ---------- DCA order view ----------
function DcaView({ o }: { o: DcaOrder }) {
  return (
    <div className="order">
      <div className="dim small">{o.side === 'buy' ? `DCA: buy with ${+(o.pct * 100).toFixed(4)}% of the cash, split by the target weights` : `DCA: sell ${+(o.pct * 100).toFixed(4)}% of every position`}</div>
      {o.rows.length ? (
        <table className="mini orders"><tbody>{o.rows.map((r) => (
          <tr key={r.sym}><td><span className={`badge ${o.side}`}>{o.side.toUpperCase()}</span></td><td><b>{shares(r.units)} {r.sym}</b></td><td>{o.side === 'sell' ? '≈ ' : ''}{usd(r.usd, 2)}</td><td className="dim">{price(r.price)}</td></tr>
        ))}</tbody></table>
      ) : <div className="dim small">Nothing to {o.side}.</div>}
      {o.fee > 0 && <div className="dim small">Fees ≈ {usd(o.fee, 2)} (included)</div>}
      <div className="dim small">Cash after: {usd(o.after.cash, 2)}</div>
    </div>
  );
}

// ---------- signal form ----------
function EtfSignalForm({ uni, date, today, initial, book, existing, feePct, sameDay, onSave, onClose }: {
  uni: EtfUniverse; date: string; today: string; initial: EtfSignal; book: PriceBook; existing: boolean; feePct: number; sameDay: number;
  onSave: (s: EtfSignal) => void; onClose: () => void;
}) {
  const current = date === today;
  const fee = current ? feePct / 100 : initial.fee ?? 0;
  const px = (s: string) => (current ? etfPrice(book, s, today) : initial.px?.[s] ?? etfPrice(book, s, addDays(date, -1)));
  const closeDay = lastCloseDate(book, uni.tickers[0], current ? today : addDays(date, -1));
  const [cash, setCash] = useState(String(+initial.cash.toFixed(2)));
  const [units, setUnits] = useState<Pair[]>(toPairs(initial.units));
  const [dcaOn, setDcaOn] = useState(existing ? initial.dca !== null : false);
  const [side, setSide] = useState<'buy' | 'sell'>(initial.dca !== null && initial.dca < 0 ? 'sell' : 'buy');
  const [dcaPct, setDcaPct] = useState(initial.dca ? String(Math.abs(initial.dca)) : '');
  const [rebOn, setRebOn] = useState(existing ? initial.rebalance : false);
  const [alloc, setAlloc] = useState<Pair[]>(toPairs(initial.alloc));

  const unitsRec = Object.fromEntries(units.filter((u) => n(u.v) > 0).map((u) => [u.sym, n(u.v)]));
  const allocRec = Object.fromEntries(alloc.map((a) => [a.sym, n(a.v)]));
  const pctNum = n(dcaPct);
  const sig: EtfSignal = {
    id: initial.id, date, createdAt: initial.createdAt, cash: n(cash), units: unitsRec,
    alloc: rebOn ? Object.fromEntries(Object.entries(allocRec).filter(([, v]) => v > 0)) : initial.alloc,
    rebalance: rebOn, dca: dcaOn ? (side === 'sell' ? -pctNum : pctNum) : null,
    px: Object.fromEntries(uni.tickers.map((t) => [t, px(t)]).filter(([, v]) => Number.isFinite(v as number))), fee
  };
  const missing = uni.tickers.filter((t) => !Number.isFinite(px(t)));
  const errors: string[] = [];
  if (!(sig.cash >= 0) || Object.values(unitsRec).some((v) => !(v >= 0))) errors.push('Holdings must be ≥ 0.');
  if (dcaOn && !(pctNum > 0 && pctNum <= 100)) errors.push('DCA must be between 0% and 100%.');
  const ae = rebOn ? allocError(allocRec, (k) => k === CASH || uni.tickers.includes(k), 'list') : null; if (ae) errors.push(ae);
  if (missing.length) errors.push(`No price for ${missing.join(', ')} yet (markets data still loading).`);
  const nothing = !dcaOn && !rebOn;
  const ex = !missing.length ? executeEtf(sig, px, uni.tickers) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal etf" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{existing ? 'Edit signal' : sameDay > 0 ? `Signal ${sameDay + 1} for today` : 'New signal'} · {date}</h2>
            <div className="dim small">{uni.title}. Prices: last close {closeDay ?? '—'} in USD (stock prices are not live); saving stores them as the execution prices and updates the holdings.</div>
          </div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>
        <div className="split">
          <div className="card pane">
            <h3>Current holdings</h3>
            <label>{emojiOf(CASH)} Cash<div className="field"><input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /><span className="unit">USD</span></div></label>
            <PairRows rows={units} setRows={setUnits} options={uni.tickers} unit="sh" placeholder="0" extra={(u) => <span className="val">{usd(n(u.v) * px(u.sym), 2)}</span>} />
          </div>
          <div className="card pane">
            <div className="pane-head">
              <h3>DCA</h3>
              <label className="check new-toggle"><input type="checkbox" checked={dcaOn} onChange={(e) => setDcaOn(e.target.checked)} /><span />DCA signal</label>
            </div>
            {dcaOn ? <>
              <div className="seg">
                <button className={side === 'buy' ? 'on pos' : ''} onClick={() => setSide('buy')}>Buy</button>
                <button className={side === 'sell' ? 'on neg' : ''} onClick={() => setSide('sell')}>Sell</button>
              </div>
              <label>{side === 'buy' ? '% of the cash to invest (split by the target weights)' : '% of every position to sell'}<div className="field"><input inputMode="decimal" value={dcaPct} onChange={(e) => setDcaPct(e.target.value)} /><span className="unit">%</span></div></label>
              {ex?.dca && <DcaView o={ex.dca} />}
            </> : <div className="dim small">No DCA today.</div>}
            <div className="pane-head" style={{ marginTop: 10 }}>
              <h3>Rebalance</h3>
              <label className="check new-toggle"><input type="checkbox" checked={rebOn} onChange={(e) => setRebOn(e.target.checked)} /><span />New weights</label>
            </div>
            {rebOn ? <>
              <div className="dim small">Target weights (must sum to 100%):</div>
              <PairRows rows={alloc} setRows={setAlloc} options={[...uni.tickers, CASH]} unit="%" placeholder="0" />
              <div className={Math.abs(alloc.reduce((t, a) => t + n(a.v), 0) - 100) <= 0.01 ? 'pos small' : 'warn small'}>Sum: {+alloc.reduce((t, a) => t + n(a.v), 0).toFixed(2)}%</div>
              {ex?.plan && <RebalanceView p={ex.plan} partLabel="Portfolio" liveText={`last close ${closeDay ?? ''}`} />}
            </> : <div className="dim small">Weights stay: {allocLine(initial.alloc) || '—'}</div>}
          </div>
        </div>
        {errors.length > 0 && <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="modal-foot">
          <div className="after-note">
            {nothing ? 'Tick DCA and/or Rebalance — otherwise the signal changes nothing.'
              : ex && current ? <>After saving, holdings become — {Object.entries(ex.after.units).filter(([, u]) => u > 1e-9).map(([k, u]) => `${shares(u)} ${k}`).join(', ') || 'no shares'} + <b>{usd(ex.after.cash, 2)}</b> cash</> : null}
          </div>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={errors.length > 0 || nothing} onClick={() => onSave(sig)}>Save signal</button>
        </div>
      </div>
    </div>
  );
}

// ---------- holdings ----------
function EtfHoldingsPanel({ uni, initial, book, today, flows, onFlow, onSave, onClose }: {
  uni: EtfUniverse; initial: Holdings; book: PriceBook; today: string; flows: Flow[]; onFlow: (f: Flow) => void; onSave: (h: Holdings) => void; onClose: () => void;
}) {
  const [cash, setCash] = useState(String(+initial.cash.toFixed(2)));
  const [units, setUnits] = useState<Pair[]>(toPairs(initial.units));
  const [flowSide, setFlowSide] = useState<'in' | 'out'>('in');
  const [flowAmt, setFlowAmt] = useState('');
  const px = (s: string) => etfPrice(book, s, today);
  const total = units.reduce((t, u) => t + n(u.v) * px(u.sym), n(cash));
  const bad = [cash, ...units.map((u) => u.v)].some((v) => !(n(v) >= 0));
  const amt = n(flowAmt), flowErr = !(amt > 0) ? null : flowSide === 'out' && amt > initial.cash + 1e-9 ? `Only ${usd(initial.cash, 2)} cash.` : null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>Holdings · {uni.title}</h2><div className="dim small">What you hold at Interactive Brokers now. Values use the last close in USD.</div></div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>
        <div className="card pane">
          <label>{emojiOf(CASH)} Cash<div className="field"><input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} /><span className="unit">USD</span></div></label>
          <PairRows rows={units} setRows={setUnits} options={uni.tickers} unit="sh" placeholder="0" extra={(u) => <span className="val">{usd(n(u.v) * px(u.sym), 2)}</span>} />
        </div>
        <div className="total-row"><span className="dim">Total</span><b>{usd(total, 2)}</b></div>
        <div className="card pane">
          <h3>Deposit / Withdraw</h3>
          <div className="dim small">Changes the cash at once and counts as money in / out, not as profit or loss.</div>
          <div className="flow-form">
            <div className="seg"><button className={flowSide === 'in' ? 'on pos' : ''} onClick={() => setFlowSide('in')}>Deposit</button><button className={flowSide === 'out' ? 'on neg' : ''} onClick={() => setFlowSide('out')}>Withdraw</button></div>
            <div className="field"><input inputMode="decimal" placeholder="0" value={flowAmt} onChange={(e) => setFlowAmt(e.target.value)} /><span className="unit">USD</span></div>
            {flowErr && <div className="warn small">{flowErr}</div>}
            <button className="btn gold small" disabled={!(amt > 0) || !!flowErr} onClick={() => onFlow({ id: `${Date.now()}`, time: Date.now(), amount: flowSide === 'in' ? amt : -amt })}>Apply</button>
          </div>
          {flows.length > 0 && <table className="mini"><tbody>{[...flows].reverse().slice(0, 8).map((f) => (
            <tr key={f.id}><td className="dim">{new Date(f.time).toLocaleDateString()}</td><td className={`r ${f.amount >= 0 ? 'pos' : 'neg'}`}>{f.amount >= 0 ? '+' : '−'}{usd(Math.abs(f.amount), 2)}</td></tr>
          ))}</tbody></table>}
        </div>
        {bad && <ul className="errors"><li>Amounts must be numbers ≥ 0.</li></ul>}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={bad} onClick={() => onSave({ cash: n(cash), units: Object.fromEntries(units.filter((u) => n(u.v) > 0).map((u) => [u.sym, n(u.v)])), updatedAt: Date.now() })}>Save holdings</button>
        </div>
      </div>
    </div>
  );
}

// ---------- portfolio view ----------
function EtfPortfolioView({ uni, st, book, today, markets, positions, onClose }: {
  uni: EtfUniverse; st: EtfState; book: PriceBook; today: string; markets: Record<string, MarketTicker>; positions: ReturnType<typeof etfCostBasis>; onClose: () => void;
}) {
  const rows = [...Object.entries(st.units).filter(([, u]) => u > 1e-9).map(([sym, u]) => {
    const p = etfPrice(book, sym, today), d = lastCloseDate(book, sym, today), p0 = d ? etfPrice(book, sym, addDays(d, -1)) : NaN;
    const pos = positions[sym], avg = pos && pos.units > 0 ? pos.cost / pos.units : NaN;
    return { sym, units: u, price: p, value: u * p, change: p / p0 - 1, pnl: u * (p - p0), avg, upl: u * (p - avg) };
  }), { sym: CASH, units: st.cash, price: 1, value: st.cash, change: 0, pnl: 0, avg: NaN, upl: NaN }].filter((r) => r.value > 0 || r.sym !== CASH);
  const total = rows.reduce((t, r) => t + r.value, 0), pnl = rows.reduce((t, r) => t + (r.sym === CASH ? 0 : r.pnl), 0);
  const year = today.slice(0, 4);
  const realized = Object.values(positions).reduce((t, p) => t + p.realized, 0), realizedYear = Object.values(positions).reduce((t, p) => t + (p.realizedByYear[year] ?? 0), 0);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal etf" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{uni.title}</h2><div className="dim small">Holdings at the last close (USD). “Last day” = change of the latest trading day.</div></div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>
        <div className="total-row"><span className="dim">Total</span><span><b>{usd(total, 2)}</b> <span className={tone(pnl)}>{pnl >= 0 ? '+' : ''}{usd(pnl, 2)} last day</span></span></div>
        <div className="card pane"><div className="table-wrap">
          <table className="mini pv">
            <thead><tr><th>ETF</th><th className="r">Shares</th><th className="r">Price</th><th className="r">Value</th><th className="r">Allocation</th><th className="r">Last day</th><th className="r">Day P/L</th><th className="r">Avg buy</th><th className="r">Unrealized</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.sym}>
                <td className="pv-asset"><b>{r.sym === CASH ? `${emojiOf(CASH)} CASH` : r.sym}</b>{r.sym !== CASH && markets[r.sym] && <div className="dim small">{markets[r.sym].exchange} · {markets[r.sym].currency} {num(markets[r.sym].lastLocal, 2)}</div>}</td>
                <td className="r" data-label="Shares">{r.sym === CASH ? usd(r.units, 2) : shares(r.units)}</td>
                <td className="r dim" data-label="Price">{r.sym === CASH ? '—' : price(r.price)}</td>
                <td className="r" data-label="Value">{usd(r.value, 2)}</td>
                <td className="r" data-label="Allocation"><div className="alloc-cell"><i style={{ width: `${total > 0 ? (r.value / total) * 100 : 0}%` }} />{total > 0 ? ((r.value / total) * 100).toFixed(1) : '0.0'}%</div></td>
                <td className={`r ${tone(r.change)}`} data-label="Last day">{r.sym === CASH ? '—' : pct(r.change, 2)}</td>
                <td className={`r ${tone(r.pnl)}`} data-label="Day P/L">{r.sym === CASH ? '—' : `${r.pnl >= 0 ? '+' : ''}${usd(r.pnl, 2)}`}</td>
                <td className="r dim" data-label="Avg buy">{Number.isFinite(r.avg) ? price(r.avg) : '—'}</td>
                <td className={`r ${tone(r.upl)}`} data-label="Unrealized">{Number.isFinite(r.upl) ? `${r.upl >= 0 ? '+' : ''}${usd(r.upl, 2)}` : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="dim small">Realized P/L: <span className={tone(realizedYear)}>{usd(realizedYear, 2)}</span> in {year} · <span className={tone(realized)}>{usd(realized, 2)}</span> in total (average cost, after fees, USD)</div></div>
      </div>
    </div>
  );
}

// ---------- page ----------
export function EtfApp({ which, today, feePct, hideValue, setHideValue, holdingsOpen, setHoldingsOpen }: {
  which: 'stocks' | 'ai'; today: string; feePct: number; hideValue: boolean; setHideValue: (v: boolean) => void;
  holdingsOpen: boolean; setHoldingsOpen: (v: boolean) => void;
}) {
  const uni = UNIVERSES[which];
  const { data, book, error } = useMarkets();
  const [signals, setSignals] = usePersisted<EtfSignal[]>(`${which}.signals`, []);
  const [holdings, setHoldings] = usePersisted<Holdings | null>(`${which}.holdings`, null);
  const [flows, setFlows] = usePersisted<Flow[]>(`${which}.flows`, []);
  const [bench, setBench] = usePersisted<string[]>(`${which}.bench`, uni.defaultBench);
  const [chartSym, setChartSym] = usePersisted<string>(`${which}.chartSym`, uni.tickers[0]);
  const [form, setForm] = useState<{ initial: EtfSignal; existing: boolean } | null>(null);
  const [pvOpen, setPvOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const mainBench = bench[0] ?? 'SPY';
  const sim = useMemo(() => simulateEtf(signals, book, today, uni.tickers, mainBench), [signals, book, today, uni.tickers, mainBench]);
  const rows = sim?.rows ?? [];
  const last = rows.at(-1);
  const state: EtfState = holdings ?? sim?.state ?? { cash: 0, units: {} };
  const valueNow = Object.entries(state.units).reduce((t, [k, u]) => t + u * etfPrice(book, k, today), state.cash);
  const lastSigTime = signals.reduce((t, s) => Math.max(t, s.createdAt), 0);
  const invested = (last?.invested ?? 0) + flows.filter((f) => f.time > lastSigTime).reduce((t, f) => t + f.amount, 0);
  const benchRet = sim ? benchmarkEtf(book, mainBench, sim.start, rows.map((r) => r.date)).at(-1) ?? NaN : NaN;
  const positions = useMemo(() => etfCostBasis(signals, book, uni.tickers), [signals, book, uni.tickers]);
  const dates = sim ? [sim.start, ...rows.map((r) => r.date)] : [];
  const COLORS = ['var(--amber)', 'var(--cyan)', '#d946ef', '#84cc16', '#f97316', '#6366f1', '#e11d48', '#14b8a6'];
  const lines: Line[] = sim ? [
    { key: 'pf', label: 'Portfolio', color: 'var(--accent)', values: [0, ...rows.map((r) => r.totalGain)], glow: true, area: true },
    ...bench.map((b, i) => ({ key: b, label: `${b} buy & hold`, color: COLORS[i % COLORS.length], dashed: true, values: [0, ...benchmarkEtf(book, b, sim.start, rows.map((r) => r.date))] }))
  ] : [];
  const hasToday = signals.some((s) => s.date === today);

  const openNew = () => {
    const prev = [...signals].sort((a, b) => a.createdAt - b.createdAt).at(-1);
    setForm({ existing: false, initial: { id: `${today}-${Date.now().toString(36)}`, date: today, createdAt: Date.now(), cash: state.cash, units: { ...state.units }, alloc: prev?.alloc ?? uni.defaultAlloc, rebalance: false, dca: null, px: {} } });
  };
  const saveSignal = (s0: EtfSignal) => {
    const s = form?.existing ? s0 : { ...s0, createdAt: Date.now() };
    const old = signals.find((x) => x.id === s.id);
    if (old) archive(`pp.${which}.signals#${s.id}`, 'replaced', `${uni.title} signal ${s.date}`, old);
    setSignals((l) => [...l.filter((x) => x.id !== s.id), s]);
    const later = signals.some((x) => x.date === s.date && x.id !== s.id && x.createdAt > s.createdAt);
    if (s.date === today && !later) {
      if (holdings) archive(`pp.${which}.holdings`, 'replaced', `${uni.title} holdings`, holdings);
      const ex = executeEtf(s, (k) => s.px[k] ?? etfPrice(book, k, today), uni.tickers);
      setHoldings({ ...ex.after, updatedAt: Date.now() });
    }
    setForm(null);
  };
  const deleteSignal = (s: EtfSignal) => {
    archive(`pp.${which}.signals#${s.id}`, 'deleted', `${uni.title} signal ${s.date}`, s);
    setSignals((l) => l.filter((x) => x.id !== s.id));
  };
  const all = [...rows].reverse().filter((r) => !r.duplicated); // signals come only when entered — no daily rows
  const list = all.slice(0, shown);
  const priceDates = Object.keys(book[chartSym] ?? {}).sort().slice(-365);
  const mk = data?.tickers[chartSym];

  return (
    <>
      <Kpis value={valueNow} strategy={last?.totalGain ?? NaN} btc={benchRet} sdcaValue={0} rspsValue={valueNow} benchLabel={mainBench}
        gains={invested > 0 ? valueNow / invested - 1 : NaN} onOpenPortfolio={() => setPvOpen(true)} hidden={hideValue} onToggleHidden={() => setHideValue(!hideValue)} />
      {error && !data && <div className="warn small">Market data not available yet ({error}). It is published daily after 00:10 UTC.</div>}

      <section className="card panel">
        <div className="panel-head">
          <h2>{uni.title} (%)</h2>
          <div className="checks">
            {uni.benchmarks.map((b) => (
              <label key={b} className="check"><input type="checkbox" checked={bench.includes(b)} onChange={(e) => setBench(e.target.checked ? [...bench, b] : bench.filter((x) => x !== b))} /><span />{b}</label>
            ))}
          </div>
        </div>
        {sim && dates.length > 1
          ? <LineChart dates={dates} lines={lines} markers={rows.map((r, i) => (r.duplicated ? -1 : i + 1)).filter((i) => i >= 0)} zeroLine fmtY={(v) => pct(v, Number.isInteger(Math.round(v * 1e6) / 1e4) ? 0 : 1)} fmtTip={(v) => pct(v, 2)} />
          : <div className="empty">{data ? 'Add your first signal to start tracking performance.' : 'Loading market data…'}</div>}
      </section>

      <StatsCard rows={rows} book={book} benchmarks={bench} strategies={[{ label: 'Portfolio', rs: rows.map((r) => r.r) }]} />

      <section className="history">
        <div className="history-head">
          <div>
            <h2>Signal history</h2>
            <div className="dim small">Signals are not expected daily — add one only when there is a DCA or rebalance. Between signals the positions are simply held. Execution prices = last close.</div>
          </div>
          <div className="actions">
            <button className="btn gold" onClick={openNew}><IcPlus width={18} />{hasToday ? 'Add another signal' : 'Add Signal'}</button>
            <button className={`btn ghost ${editing ? 'on' : ''}`} onClick={() => setEditing(!editing)}><IcPen width={17} />{editing ? 'Done' : 'Edit'}</button>
          </div>
        </div>
        <div className="card table-wrap">
          <table className="hist">
            <thead><tr><th>DATE</th><th>ALLOCATION</th><th className="r">STRATEGY DAY</th><th className="r">{mainBench} DAY</th><th className="r">TOTAL GAIN</th>{editing && <th />}</tr></thead>
            <tbody>
              {!list.length && <tr><td colSpan={5} className="empty">No signals yet — press “Add Signal”.</td></tr>}
              {list.map((r) => (
                <Fragment key={r.date}>
                  <tr className="row" onClick={() => setOpen(open === r.date ? null : r.date)}>
                    <td className="date">{r.date}</td>
                    <td>
                      <span className="alloc">{allocLine(r.signal.alloc)}</span>
                      {r.execs.length > 1 ? <span className="sdca-chip multi">{r.execs.length} signals</span> : r.execs.length === 1 && <>
                        {r.execs[0].signal.dca !== null && <span className="sdca-chip">DCA {r.execs[0].signal.dca > 0 ? 'buy' : 'sell'} {Math.abs(r.execs[0].signal.dca)}%</span>}
                        {r.execs[0].signal.rebalance && <span className="sdca-chip">Rebalance</span>}
                      </>}
                      <span className="tag sig">Signal <IcChevron width={14} className={open === r.date ? 'flip' : ''} /></span>
                    </td>
                    <td className={`r ${tone(r.r)}`}>{pct(r.r)}</td>
                    <td className={`r ${tone(r.benchDay)}`}>{pct(r.benchDay)}</td>
                    <td className={`r ${tone(r.totalGain)}`}>{pct(r.totalGain)}</td>
                    {editing && <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                      {r.execs.length === 1 && <>
                        <button className="icon" title="Edit signal" onClick={() => setForm({ initial: r.execs[0].signal, existing: true })}><IcPen width={16} /></button>
                        <button className="icon" title="Delete signal" onClick={() => { if (confirm(`Delete the signal of ${r.date}?`)) deleteSignal(r.execs[0].signal); }}><IcTrash width={16} /></button>
                      </>}
                      {r.execs.length > 1 && <button className="btn ghost small" onClick={() => setOpen(r.date)}>{r.execs.length} signals ▾</button>}
                    </td>}
                  </tr>
                  {open === r.date && (
                    <tr className="detail"><td colSpan={editing ? 6 : 5}>
                      <div className="day-sum"><span><b>Value</b> {usd(r.value, 2)}</span><span><b>Day</b> <span className={tone(r.r)}>{pct(r.r)}</span></span></div>
                      {r.execs.map((ex, i) => (
                        <div className="exec" key={ex.signal.id}>
                          <div className="exec-head">
                            <b>{r.execs.length > 1 ? `Signal ${i + 1} of ${r.execs.length}` : 'Signal'}</b> <span className="dim small">saved {new Date(ex.signal.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                            {editing && r.execs.length > 1 && <span className="exec-actions">
                              <button className="icon" title="Edit signal" onClick={() => setForm({ initial: ex.signal, existing: true })}><IcPen width={16} /></button>
                              <button className="icon" title="Delete signal" onClick={() => { if (confirm(`Delete signal ${i + 1} of ${r.date}?`)) deleteSignal(ex.signal); }}><IcTrash width={16} /></button>
                            </span>}
                          </div>
                          <div className="split">
                            <div><h4>Rebalance</h4>{ex.plan ? <RebalanceView p={ex.plan} partLabel="Portfolio" /> : <div className="dim">No new weights.</div>}</div>
                            <div><h4>DCA</h4>{ex.dca ? <DcaView o={ex.dca} /> : <div className="dim">No DCA.</div>}</div>
                          </div>
                        </div>
                      ))}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {all.length > PAGE && (
          <div className="hist-more">
            <span className="dim small">Showing {Math.min(shown, all.length)} of {all.length} signal days</span>
            {shown < all.length && <button className="btn ghost small" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, all.length - shown)} more</button>}
            {shown < all.length && <button className="btn ghost small" onClick={() => setShown(all.length)}>Show all</button>}
            {shown > PAGE && <button className="btn ghost small" onClick={() => setShown(PAGE)}>Show less</button>}
          </div>
        )}
      </section>

      <section className="card panel">
        <div className="panel-head">
          <h2>Price chart</h2>
          <div className="price-now">
            <select value={chartSym} onChange={(e) => setChartSym(e.target.value)}>
              {[...new Set([...uni.tickers, ...uni.benchmarks])].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {mk && <><b>{price(mk.closes[mk.lastDate])}</b><span className="dim small">{mk.currency} {num(mk.lastLocal, 2)} · {mk.exchange} · close {mk.lastDate}</span></>}
          </div>
        </div>
        {priceDates.length > 1
          ? <LineChart dates={priceDates} lines={[{ key: chartSym, label: `${chartSym} daily close (USD)${mk ? ` — ${mk.name}` : ''}`, color: 'var(--accent)', values: priceDates.map((d) => book[chartSym][d]), glow: true, area: true }]} fmtY={price} height={300} />
          : <div className="empty">Loading prices…</div>}
        {data && <div className="dim small">Daily closes from Yahoo Finance, updated {new Date(data.updated).toLocaleString()} (after 00:10 UTC); EUR / GBP listings converted to USD at that day's rate.</div>}
      </section>

      {form && <EtfSignalForm uni={uni} date={form.initial.date} today={today} initial={form.initial} book={book} existing={form.existing} feePct={feePct}
        sameDay={signals.filter((x) => x.date === form.initial.date).length} onSave={saveSignal} onClose={() => setForm(null)} />}
      {holdingsOpen && <EtfHoldingsPanel key={holdings?.updatedAt ?? 0} uni={uni} initial={{ ...state, updatedAt: holdings?.updatedAt ?? 0 }} book={book} today={today} flows={flows}
        onFlow={(f) => { if (holdings) archive(`pp.${which}.holdings`, 'replaced', `${uni.title} holdings`, holdings); setHoldings({ ...state, cash: state.cash + f.amount, updatedAt: Date.now() }); setFlows((l) => [...l, f]); }}
        onSave={(h) => { if (holdings) archive(`pp.${which}.holdings`, 'replaced', `${uni.title} holdings`, holdings); setHoldings(h); setHoldingsOpen(false); }}
        onClose={() => setHoldingsOpen(false)} />}
      {pvOpen && <EtfPortfolioView uni={uni} st={state} book={book} today={today} markets={data?.tickers ?? {}} positions={positions} onClose={() => setPvOpen(false)} />}
    </>
  );
}

export { rebalance, dcaOrder };
