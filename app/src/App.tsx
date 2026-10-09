import { useEffect, useMemo, useState } from 'react';
import { benchmark, rebalance, sdcaOrder, simulate, type Signal } from './lib/engine';
import { priceOn } from './lib/prices';
import { usePersisted, archive, SAVE_FAILED } from './lib/storage';
import { usePrices } from './lib/usePrices';
import { CASH, TOKENS, emojiOf } from './lib/tokens';
import { addDays, msToReset, todayUtc } from './lib/utc';
import { pct } from './lib/format';
import { Kpis } from './components/Kpis';
import { LineChart, type Line } from './components/LineChart';
import { SignalHistory } from './components/SignalHistory';
import { SignalForm } from './components/SignalForm';
import { PriceChart, PRICE_DAYS } from './components/PriceChart';
import { Footer } from './components/Footer';
import { HoldingsPanel, type Holdings } from './components/HoldingsPanel';
import { NetWorthPanel, type NetWorth } from './components/NetWorthPanel';
import { BackupPanel } from './components/BackupPanel';
import { PortfolioView } from './components/PortfolioView';

const BENCH_COLORS: Record<string, string> = { BTC: '#ffb000', SOL: '#33e1ff' };
const EXTRA_COLORS = ['#ff4fd8', '#d4ff3c', '#ff7a3c', '#8c9bff'];

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

const emptySignal = (date: string): Signal => ({ date, createdAt: 0, sdca: { pct: 0, cash: 0, btc: 0 }, rsps: { alloc: { [CASH]: 100 }, cash: 0, units: {} } });

export default function App() {
  const now = useNow();
  const today = todayUtc(now);
  const [signals, setSignals] = usePersisted<Signal[]>('signals', []);
  const [bench, setBench] = usePersisted<{ BTC: boolean; SOL: boolean; extra: string[] }>('benchmarks', { BTC: true, SOL: true, extra: [] });
  const [chartSym, setChartSym] = usePersisted('priceChart', 'BTC');
  const [form, setForm] = useState<{ date: string; initial: Signal; existing: boolean } | null>(null);
  const [formSyms, setFormSyms] = useState<string[]>([]);
  // Current holdings per strategy (top-right button). The next signal starts from them; saving today's signal updates them.
  const [holdings, setHoldings] = usePersisted<Holdings | null>('holdings', null);
  const [holdingsOpen, setHoldingsOpen] = useState(false);
  // Net worth across asset classes (bottom-right button), entered by hand.
  const [netWorth, setNetWorth] = usePersisted<NetWorth>('networth', { currency: 'USD', items: [], updatedAt: 0 });
  const [netWorthOpen, setNetWorthOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => { const on = () => setSaveFailed(true); window.addEventListener(SAVE_FAILED, on); return () => window.removeEventListener(SAVE_FAILED, on); }, []);

  const sorted = useMemo(() => [...signals].sort((a, b) => a.date.localeCompare(b.date)), [signals]);
  const first = sorted[0]?.date;
  const from = addDays(first && first < addDays(today, -PRICE_DAYS) ? first : addDays(today, -PRICE_DAYS), -3);
  const needed = [
    'BTC', 'SOL', chartSym, ...bench.extra, ...formSyms, ...Object.keys(holdings?.rsps.units ?? {}),
    ...sorted.flatMap((s) => [...Object.keys(s.rsps.alloc), ...Object.keys(s.rsps.units)])
  ];
  const { book, errors, loading } = usePrices(needed, from);

  const sim = useMemo(() => simulate(sorted, book, today), [sorted, book, today]);
  const rows = sim?.rows ?? [];
  const last = rows.at(-1);
  const dates = sim ? [sim.start, ...rows.map((r) => r.date)] : [];
  const btcBh = sim ? benchmark(book, 'BTC', sim.start, rows.map((r) => r.date)).at(-1) ?? 0 : NaN;

  const lines: Line[] = [];
  if (sim) {
    lines.push({ key: 'pf', label: 'Portfolio', color: '#00ff41', values: [0, ...rows.map((r) => r.totalGain)], glow: true, area: true });
    const add = (sym: string, color: string) => lines.push({ key: sym, label: `${sym} buy & hold`, color, dashed: true, values: [0, ...benchmark(book, sym, sim.start, rows.map((r) => r.date))] });
    if (bench.BTC) add('BTC', BENCH_COLORS.BTC);
    if (bench.SOL) add('SOL', BENCH_COLORS.SOL);
    bench.extra.forEach((s, i) => add(s, EXTRA_COLORS[i % EXTRA_COLORS.length]));
  }
  const markers = rows.map((r, i) => (r.duplicated ? -1 : i + 1)).filter((i) => i >= 0);

  const hasToday = sorted.some((s) => s.date === today);
  const ms = msToReset(now);
  const resetIn = `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;

  const openToday = () => {
    const existing = sorted.find((s) => s.date === today);
    if (existing) { setForm({ date: today, initial: existing, existing: true }); return; }
    const prev = sorted.filter((s) => s.date < today).at(-1);
    // pre-fill with the carried-forward holdings of each strategy and the last allocation
    const base = holdings ?? (prev && sim ? { sdca: sim.sdca, rsps: sim.rsps } : null);
    const initial: Signal = base
      ? { date: today, createdAt: 0, sdca: { pct: 0, cash: base.sdca.cash, btc: base.sdca.btc }, rsps: { alloc: prev ? { ...prev.rsps.alloc } : { [CASH]: 100 }, cash: base.rsps.cash, units: { ...base.rsps.units } } }
      : emptySignal(today);
    setForm({ date: today, initial, existing: false });
  };
  const saveSignal = (s: Signal, updateHoldings: boolean) => {
    const old = signals.find((x) => x.date === s.date);
    if (old) archive(`pp.signals#${s.date}`, 'replaced', `Signal ${s.date}`, old);
    setSignals((list) => [...list.filter((x) => x.date !== s.date), s]);
    if (updateHoldings && s.date === today) {   // only when asked: holdings after executing today's orders
      if (holdings) archive('pp.holdings', 'replaced', 'Portfolio holdings', holdings);
      const p0 = (sym: string) => s.px?.[sym] ?? priceOn(book, sym, addDays(s.date, -1));
      setHoldings({ sdca: sdcaOrder(s.sdca, p0('BTC')).after, rsps: rebalance(s.rsps, p0).after, updatedAt: Date.now() });
    }
    setForm(null); setFormSyms([]);
  };

  // current holdings at live prices (the same numbers as the Portfolio view)
  const hSdca = holdings ? holdings.sdca.cash + holdings.sdca.btc * priceOn(book, 'BTC', today) : 0;
  const hRsps = holdings ? holdings.rsps.cash + Object.entries(holdings.rsps.units).reduce((t, [k, u]) => t + u * priceOn(book, k, today), 0) : 0;
  const extraOptions = TOKENS.map((t) => t.sym).filter((s) => s !== 'BTC' && s !== 'SOL' && !bench.extra.includes(s));
  const errList = Object.entries(errors);

  return (
    <div className="page">
      <div className="topbar">
        <button className="btn ghost small" onClick={() => setBackupOpen(true)}>Backup</button>
        <button className="avatar-btn" title="Portfolio holdings" aria-label="Portfolio holdings" onClick={() => setHoldingsOpen(true)}>
          <img src="./holdings-icon.png" alt="" />
        </button>
      </div>

      <Kpis value={holdings ? hSdca + hRsps : last?.value ?? 0} strategy={last?.totalGain ?? NaN} btc={btcBh} sdcaValue={holdings ? hSdca : last?.sdcaValue ?? 0} rspsValue={holdings ? hRsps : last?.rspsValue ?? 0} onOpenPortfolio={() => setPortfolioOpen(true)}
        gains={last && last.invested > 0 ? last.value / last.invested - 1 : NaN} />

      <section className="card panel">
        <div className="panel-head">
          <h2>Portfolio performance (%)</h2>
          <div className="checks">
            <label className="check amber"><input type="checkbox" checked={bench.BTC} onChange={(e) => setBench({ ...bench, BTC: e.target.checked })} /><span />BTC benchmark</label>
            <label className="check purple"><input type="checkbox" checked={bench.SOL} onChange={(e) => setBench({ ...bench, SOL: e.target.checked })} /><span />SOL benchmark</label>
            {bench.extra.map((s) => (
              <label className="check" key={s}><input type="checkbox" checked onChange={() => setBench({ ...bench, extra: bench.extra.filter((x) => x !== s) })} /><span />{s} benchmark</label>
            ))}
            <select className="bench-add" value="" onChange={(e) => e.target.value && setBench({ ...bench, extra: [...bench.extra, e.target.value] })}>
              <option value="">+ benchmark</option>
              {extraOptions.map((s) => <option key={s} value={s}>{emojiOf(s)} {s}</option>)}
            </select>
          </div>
        </div>
        {sim && dates.length > 1
          ? <LineChart dates={dates} lines={lines} markers={markers} zeroLine fmtY={(v) => pct(v, Number.isInteger(Math.round(v * 1e6) / 1e4) ? 0 : 1)} fmtTip={(v) => pct(v, 2)} liveLast />
          : <div className="empty">{loading ? 'Loading prices…' : 'Add your first signal to start tracking performance.'}</div>}
      </section>

      {errList.length > 0 && <div className="warn small">Price data unavailable: {errList.map(([s, e]) => `${s} (${e})`).join('; ')}</div>}

      <SignalHistory rows={rows} today={today} hasToday={hasToday} resetIn={resetIn} onAdd={openToday}
        onEdit={(s) => setForm({ date: s.date, initial: s, existing: true })}
        onDelete={(d) => {
          const old = signals.find((x) => x.date === d);
          if (old) archive(`pp.signals#${d}`, 'deleted', `Signal ${d}`, old);
          setSignals((list) => list.filter((x) => x.date !== d));
        }} />

      <PriceChart sym={chartSym} setSym={setChartSym} book={book} today={today} />

      <Footer />

      <button className="corner-btn" title="Net worth" aria-label="Net worth" onClick={() => setNetWorthOpen(true)}>
        <img src="./networth-icon.png" alt="" />
      </button>
      {netWorthOpen && <NetWorthPanel initial={netWorth} onSave={(w) => { if (netWorth.items.length) archive('pp.networth', 'replaced', 'Net worth', netWorth); setNetWorth(w); setNetWorthOpen(false); }} onClose={() => setNetWorthOpen(false)} />}

      {portfolioOpen && <PortfolioView today={today} book={book} onClose={() => setPortfolioOpen(false)}
        sdca={holdings?.sdca ?? sim?.sdca ?? { cash: 0, btc: 0 }} rsps={holdings?.rsps ?? sim?.rsps ?? { cash: 0, units: {} }} />}
      {backupOpen && <BackupPanel onClose={() => setBackupOpen(false)} />}
      {saveFailed && <div className="update-banner"><div><b>Could not save</b><div className="dim small">The browser’s storage is full or blocked. Export a backup now.</div></div>
        <button className="btn gold small" onClick={() => { setSaveFailed(false); setBackupOpen(true); }}>Backup</button></div>}

      {holdingsOpen && <HoldingsPanel today={today} book={book} onNeed={setFormSyms}
        initial={holdings ?? { sdca: sim?.sdca ?? { cash: 0, btc: 0 }, rsps: sim?.rsps ?? { cash: 0, units: {} }, updatedAt: 0 }}
        onSave={(h) => { if (holdings) archive('pp.holdings', 'replaced', 'Portfolio holdings', holdings); setHoldings(h); setHoldingsOpen(false); setFormSyms([]); }} onClose={() => { setHoldingsOpen(false); setFormSyms([]); }} />}

      {form && <SignalForm today={today} canUpdateHoldings={form.date === today} date={form.date} initial={form.initial} book={book} editingExisting={form.existing}
        onNeed={setFormSyms} onSave={saveSignal} onClose={() => { setForm(null); setFormSyms([]); }} />}
    </div>
  );
}
