import { useEffect, useMemo, useState } from 'react';
import { benchmark, bySignalOrder, costBasis, executeSignal, sigId, simulate, type Signal } from './lib/engine';
import { StatsCard } from './components/StatsCard';
import { exportNow } from './components/BackupPanel';
import { priceOn } from './lib/prices';
import { usePersisted, archive, SAVE_FAILED } from './lib/storage';
import { applyTheme } from './lib/theme';
import { IcGear } from './components/icons';
import { SettingsPanel } from './components/SettingsPanel';
import { RemindersDue } from './components/RemindersDue';
import { dueFor, localToday, type Reminder } from './lib/reminders';
import { usePrices } from './lib/usePrices';
import { CASH, TOKENS, emojiOf } from './lib/tokens';
import { addDays, msToReset, todayUtc } from './lib/utc';
import { pct } from './lib/format';
import { Kpis } from './components/Kpis';
import { LineChart, type Line } from './components/LineChart';
import { SignalHistory } from './components/SignalHistory';
import { SignalForm } from './components/SignalForm';
import { PriceChart, PRICE_DAYS, CS2 } from './components/PriceChart';
import { Footer } from './components/Footer';
import { HoldingsPanel, type Holdings, type Flow } from './components/HoldingsPanel';
import { NetWorthPanel, CATEGORIES, type NetWorth, type NetWorthSnapshot } from './components/NetWorthPanel';
import { CornerPanel, type CornerTab } from './components/CornerPanel';
import { NotesTab, type Note } from './components/Notes';
import { EtfApp } from './EtfApp';
import { PortfolioView } from './components/PortfolioView';

const BENCH_COLORS: Record<string, string> = { BTC: 'var(--amber)', SOL: 'var(--cyan)' };
const EXTRA_COLORS = ['#d946ef', '#84cc16', '#f97316', '#6366f1'];

type PfTab = 'crypto' | 'stocks' | 'ai';
const PF_TABS: [PfTab, string][] = [['crypto', 'Crypto'], ['stocks', 'Stocks'], ['ai', 'AI Apocalypse']];

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
  const [tabRaw, setTab] = usePersisted<PfTab>('portfolio.tab', 'crypto');
  const tab: PfTab = PF_TABS.some(([k]) => k === tabRaw) ? tabRaw : 'crypto';
  // Net worth across asset classes (bottom-right button), entered by hand.
  const [netWorth, setNetWorth] = usePersisted<NetWorth>('networth', { currency: 'USD', items: [], updatedAt: 0 });
  const [netWorthOpen, setNetWorthOpen] = useState(false);
  const [cornerTab, setCornerTab] = usePersisted<CornerTab>('corner.tab', 'networth');
  const [notes, setNotes] = usePersisted<Note[]>('notes', []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reminders, setReminders] = usePersisted<Reminder[]>('reminders', []);
  const dueCount = reminders.filter((r) => dueFor(r, localToday(new Date(now)))).length;
  const saveReminder = (r: Reminder) => {
    const old = reminders.find((x) => x.id === r.id);
    if (old) archive('pp.reminders', 'replaced', `Reminder “${old.title}”`, reminders);
    setReminders((l) => (l.some((x) => x.id === r.id) ? l.map((x) => (x.id === r.id ? r : x)) : [...l, r]));
  };
  const deleteReminder = (r: Reminder) => {
    archive('pp.reminders', 'deleted', `Reminder “${r.title}”`, reminders);
    setReminders((l) => l.filter((x) => x.id !== r.id));
  };
  const [theme, setTheme] = usePersisted<'dark' | 'light'>('theme', 'dark');
  useEffect(() => { applyTheme(theme); }, [theme]);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [feePct, setFeePct] = usePersisted<number>('settings.feePct', 0);
  const [hideValue, setHideValue] = usePersisted<boolean>('privacy.hideValue', false);   // blur the Portfolio value tile   // optional trading fee, % of each trade
  const [flows, setFlows] = usePersisted<Flow[]>('flows', []);
  const [series, setSeries] = usePersisted<'total' | 'sdca' | 'rsps'>('chart.series', 'total');
  const [nwHistory, setNwHistory] = usePersisted<NetWorthSnapshot[]>('networth.history', []);
  const [lastBackup] = usePersisted<number>('backup.last', 0);
  const [backupSnooze, setBackupSnooze] = usePersisted<number>('backup.snooze', 0);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => { const on = () => setSaveFailed(true); window.addEventListener(SAVE_FAILED, on); return () => window.removeEventListener(SAVE_FAILED, on); }, []);

  const sorted = useMemo(() => [...signals].sort(bySignalOrder), [signals]);
  const first = sorted[0]?.date;
  const from = addDays(first && first < addDays(today, -PRICE_DAYS) ? first : addDays(today, -PRICE_DAYS), -3);
  const needed = [
    'BTC', 'SOL', ...(chartSym === CS2 ? [] : [chartSym]), ...bench.extra, ...formSyms, ...Object.keys(holdings?.rsps.units ?? {}),
    ...sorted.flatMap((s) => [...Object.keys(s.rsps.alloc), ...Object.keys(s.rsps.units)])
  ];
  const { book, errors, loading, liveAt } = usePrices(needed, from);

  const sim = useMemo(() => simulate(sorted, book, today), [sorted, book, today]);
  const rows = sim?.rows ?? [];
  const last = rows.at(-1);
  const dates = sim ? [sim.start, ...rows.map((r) => r.date)] : [];
  const btcBh = sim ? benchmark(book, 'BTC', sim.start, rows.map((r) => r.date)).at(-1) ?? 0 : NaN;

  const lines: Line[] = [];
  if (sim) {
    const pick = series === 'sdca' ? (r: typeof rows[number]) => r.sdcaGain : series === 'rsps' ? (r: typeof rows[number]) => r.rspsGain : (r: typeof rows[number]) => r.totalGain;
    lines.push({ key: 'pf', label: series === 'total' ? 'Portfolio' : series.toUpperCase(), color: 'var(--accent)', values: [0, ...rows.map(pick)], glow: true, area: true });
    const add = (sym: string, color: string) => lines.push({ key: sym, label: `${sym} buy & hold`, color, dashed: true, values: [0, ...benchmark(book, sym, sim.start, rows.map((r) => r.date))] });
    if (bench.BTC) add('BTC', BENCH_COLORS.BTC);
    if (bench.SOL) add('SOL', BENCH_COLORS.SOL);
    bench.extra.forEach((s, i) => add(s, EXTRA_COLORS[i % EXTRA_COLORS.length]));
  }
  const markers = rows.map((r, i) => (r.duplicated ? -1 : i + 1)).filter((i) => i >= 0);

  const hasToday = sorted.some((s) => s.date === today);
  const ms = msToReset(now);
  const resetIn = `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;

  // a new signal (today can have several): starts from the current holdings and the last allocation
  const openToday = () => {
    const prev = sorted.at(-1);
    // pre-fill with the carried-forward holdings of each strategy and the last allocation
    const base = holdings ?? (prev && sim ? { sdca: sim.sdca, rsps: sim.rsps } : null);
    const initial: Signal = base
      ? { date: today, createdAt: 0, sdca: { pct: 0, cash: base.sdca.cash, btc: base.sdca.btc }, rsps: { alloc: prev ? { ...prev.rsps.alloc } : { [CASH]: 100 }, cash: base.rsps.cash, units: { ...base.rsps.units } } }
      : emptySignal(today);
    setForm({ date: today, initial, existing: false });
  };
  const saveSignal = (input: Signal) => {
    const editing = form?.existing ? form.initial : null;
    // an edited signal keeps its id and its place in the day's order; a new one gets a fresh id
    const s: Signal = editing
      ? { ...input, id: sigId(editing), createdAt: editing.createdAt }
      : { ...input, id: `${input.date}-${Date.now().toString(36)}` };
    const id = sigId(s);
    if (editing) archive(`pp.signals#${id}`, 'replaced', `Signal ${s.date}`, editing);
    setSignals((list) => [...list.filter((x) => sigId(x) !== id), s]);
    const laterToday = signals.some((x) => x.date === s.date && sigId(x) !== id && x.createdAt > s.createdAt);
    if (s.date === today && !laterToday) {   // the day's latest orders are executed: holdings move to the post-trade state (old state archived)
      if (holdings) archive('pp.holdings', 'replaced', 'Portfolio holdings', holdings);
      const p0 = (sym: string) => s.px?.[sym] ?? priceOn(book, sym, addDays(s.date, -1));
      const ex = executeSignal(s, p0);
      setHoldings({ sdca: ex.sdca, rsps: ex.rsps, updatedAt: Date.now() });
    }
    setForm(null); setFormSyms([]);
  };

  // current holdings at live prices (the same numbers as the Portfolio view)
  const hSdca = holdings ? holdings.sdca.cash + holdings.sdca.btc * priceOn(book, 'BTC', today) : 0;
  const hRsps = holdings ? holdings.rsps.cash + Object.entries(holdings.rsps.units).reduce((t, [k, u]) => t + u * priceOn(book, k, today), 0) : 0;
  // money put in: what the signals saw (typed-in vs carried) + deposits/withdrawals made since the last saved signal
  const lastSigTime = signals.reduce((t, s) => Math.max(t, s.createdAt), 0);
  const invested = (last?.invested ?? 0) + flows.filter((f) => f.time > lastSigTime).reduce((t, f) => t + f.amount, 0);
  const valueNow = holdings ? hSdca + hRsps : last?.value ?? 0;
  const positions = useMemo(() => costBasis(sorted, book), [sorted, book]);
  const applyFlow = (f: Flow) => {
    const base: Holdings = holdings ?? { sdca: sim?.sdca ?? { cash: 0, btc: 0 }, rsps: sim?.rsps ?? { cash: 0, units: {} }, updatedAt: 0 };
    if (holdings) archive('pp.holdings', 'replaced', 'Portfolio holdings', holdings);
    setHoldings({ ...base, [f.strategy]: { ...base[f.strategy], cash: base[f.strategy].cash + f.amount }, updatedAt: Date.now() });
    setFlows((l) => [...l, f]);
  };
  const saveNetWorth = (w: NetWorth) => {
    if (netWorth.items.length) archive('pp.networth', 'replaced', 'Net worth', netWorth);
    setNetWorth(w);
    const d = new Date(), date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const byCat = Object.fromEntries(CATEGORIES.map((c) => [c.id, w.items.filter((i) => i.cat === c.id).reduce((t, i) => t + i.amount, 0)]));
    const snap: NetWorthSnapshot = { date, currency: w.currency, total: w.items.reduce((t, i) => t + i.amount, 0), byCat };
    setNwHistory((h) => [...h.filter((x) => !(x.date === date && x.currency === w.currency)), snap]);
    setNetWorthOpen(false);
  };
  const hasData = signals.length > 0 || notes.length > 0 || netWorth.items.length > 0 || !!holdings;
  const backupDue = hasData && now - lastBackup > 30 * 86_400_000 && now > backupSnooze;
  const extraOptions = TOKENS.map((t) => t.sym).filter((s) => s !== 'BTC' && s !== 'SOL' && !bench.extra.includes(s));
  const errList = Object.entries(errors);

  return (
    <div className="page">
      <div className="topbar">
        <button className="theme-btn" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <IcGear width={19} />{dueCount > 0 && <span className="badge-dot">{dueCount}</span>}
        </button>
        <button className="avatar-btn" title={`${PF_TABS.find(([k]) => k === tab)![1]} holdings`} aria-label="Portfolio holdings" onClick={() => setHoldingsOpen(true)}>
          <img src="./holdings-icon.png" alt="" />
        </button>
      </div>

      <RemindersDue reminders={reminders} onDone={(r, on) => setReminders((l) => l.map((x) => (x.id === r.id ? { ...x, doneFor: on } : x)))} />

      {backupDue && (
        <div className="card rem-card">
          <div className="rem-main"><b>Time for a backup</b>
            <div className="dim small">{lastBackup ? `Last backup ${new Date(lastBackup).toLocaleDateString()}.` : 'No backup yet.'} Your data lives only on this device — export it and keep the file somewhere else.</div></div>
          <button className="btn ghost small" onClick={() => setBackupSnooze(Date.now() + 7 * 86_400_000)}>Later</button>
          <button className="btn gold small" onClick={() => void exportNow()}>Export now</button>
        </div>
      )}

      <div className="seg tabs pf-tabs" role="tablist">
        {PF_TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {tab === 'crypto' ? <>
      <Kpis value={valueNow} strategy={last?.totalGain ?? NaN} btc={btcBh} sdcaValue={holdings ? hSdca : last?.sdcaValue ?? 0} rspsValue={holdings ? hRsps : last?.rspsValue ?? 0} onOpenPortfolio={() => setPortfolioOpen(true)} hidden={hideValue} onToggleHidden={() => setHideValue(!hideValue)}
        gains={invested > 0 ? valueNow / invested - 1 : NaN} />

      <section className="card panel">
        <div className="panel-head">
          <h2>Portfolio performance (%)</h2>
          <div className="checks">
            <div className="seg">
              {(['total', 'sdca', 'rsps'] as const).map((k) => <button key={k} className={series === k ? 'on' : ''} onClick={() => setSeries(k)}>{k === 'total' ? 'Total' : k.toUpperCase()}</button>)}
            </div>
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

      <StatsCard rows={rows} book={book} benchmarks={[...(bench.BTC ? ['BTC'] : []), ...(bench.SOL ? ['SOL'] : []), ...bench.extra]} />

      {errList.length > 0 && <div className="warn small">Price data unavailable: {errList.map(([s, e]) => `${s} (${e})`).join('; ')}</div>}

      <SignalHistory rows={rows} today={today} hasToday={hasToday} resetIn={resetIn} onAdd={openToday}
        onEdit={(s) => setForm({ date: s.date, initial: s, existing: true })}
        onDelete={(old) => {
          archive(`pp.signals#${sigId(old)}`, 'deleted', `Signal ${old.date}`, old);
          setSignals((list) => list.filter((x) => sigId(x) !== sigId(old)));
        }} />

      <PriceChart sym={chartSym} setSym={setChartSym} book={book} today={today} />
      </> : <EtfApp key={tab} which={tab} today={today} feePct={feePct} hideValue={hideValue} setHideValue={setHideValue} holdingsOpen={holdingsOpen} setHoldingsOpen={setHoldingsOpen} />}

      <Footer />

      <button className="corner-btn" title="Net worth · Notes" aria-label="Net worth and notes" onClick={() => setNetWorthOpen(true)}>
        <img src="./networth-icon.png" alt="" />
      </button>
      {netWorthOpen && <CornerPanel tab={cornerTab} setTab={setCornerTab} onClose={() => { setNotes((l) => l.filter((n) => n.text.trim())); setNetWorthOpen(false); }}
        networth={<NetWorthPanel initial={netWorth} history={nwHistory} onSave={saveNetWorth} onClose={() => setNetWorthOpen(false)} />}
        notes={<NotesTab notes={notes} setNotes={setNotes} onDelete={(n) => { archive(`pp.notes#${n.id}`, 'deleted', `Note “${n.text.split('\n')[0].slice(0, 40)}”`, n); setNotes((l) => l.filter((x) => x.id !== n.id)); }} />} />}

      {portfolioOpen && <PortfolioView today={today} book={book} positions={positions} onClose={() => setPortfolioOpen(false)}
        sdca={holdings?.sdca ?? sim?.sdca ?? { cash: 0, btc: 0 }} rsps={holdings?.rsps ?? sim?.rsps ?? { cash: 0, units: {} }} />}
      {settingsOpen && <SettingsPanel theme={theme} setTheme={setTheme} feePct={feePct} setFeePct={setFeePct} reminders={reminders} saveReminder={saveReminder} deleteReminder={deleteReminder} onClose={() => setSettingsOpen(false)} />}
      {saveFailed && <div className="update-banner"><div><b>Could not save</b><div className="dim small">The browser’s storage is full or blocked. Export a backup now.</div></div>
        <button className="btn gold small" onClick={() => { setSaveFailed(false); setSettingsOpen(true); }}>Backup</button></div>}

      {tab === 'crypto' && holdingsOpen && <HoldingsPanel key={holdings?.updatedAt ?? 0} today={today} book={book} onNeed={setFormSyms} flows={flows} onFlow={applyFlow}
        initial={holdings ?? { sdca: sim?.sdca ?? { cash: 0, btc: 0 }, rsps: sim?.rsps ?? { cash: 0, units: {} }, updatedAt: 0 }}
        onSave={(h) => { if (holdings) archive('pp.holdings', 'replaced', 'Portfolio holdings', holdings); setHoldings(h); setHoldingsOpen(false); setFormSyms([]); }} onClose={() => { setHoldingsOpen(false); setFormSyms([]); }} />}

      {form && <SignalForm feePct={feePct} today={today} sameDay={signals.filter((x) => x.date === form.date).length} liveAt={liveAt} date={form.date} initial={form.initial} book={book} editingExisting={form.existing}
        onNeed={setFormSyms} onSave={saveSignal} onClose={() => { setForm(null); setFormSyms([]); }} />}
    </div>
  );
}
