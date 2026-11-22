import { useState } from 'react';
import { BackupSection } from './BackupPanel';
import { IcBell, IcClose, IcPen, IcPlus, IcTrash } from './icons';
import { WEEKDAYS, describe, dueFor, localToday, nextOccurrence, type Reminder, type Schedule } from '../lib/reminders';
import type { Theme } from '../lib/theme';
import { ask } from '../lib/platform';
import { HL_FEES } from '../lib/engine';
import { IBKR_FIXED_EU } from '../lib/etf';

type Kind = Schedule['kind'];
interface Draft { id?: string; title: string; action: string; kind: Kind; day: string; weekday: number; date: string; }
const empty = (): Draft => ({ title: '', action: '', kind: 'monthDay', day: '10', weekday: 1, date: localToday() });
const toDraft = (r: Reminder): Draft => ({
  id: r.id, title: r.title, action: r.action, kind: r.schedule.kind,
  day: r.schedule.kind === 'monthDay' ? String(r.schedule.day) : '10',
  weekday: r.schedule.kind === 'weekly' ? r.schedule.weekday : 1,
  date: r.schedule.kind === 'once' ? r.schedule.date : localToday()
});

interface Props {
  theme: Theme; setTheme: (t: Theme) => void;
  feeSpotPct: number; setFeeSpotPct: (v: number) => void; feePerpPct: number; setFeePerpPct: (v: number) => void;
  stockFeePct: number; setStockFeePct: (v: number) => void; stockFeeMin: number; setStockFeeMin: (v: number) => void;
  reminders: Reminder[]; saveReminder: (r: Reminder) => void; deleteReminder: (r: Reminder) => void;
  onClose: () => void;
}

/** One fee field (% of the traded value): saved on blur or with the button; 0–5%. */
function FeeField({ label, value, onSave, unit = '% per trade', max = 5 }: { label: string; value: number; onSave: (v: number) => void; unit?: string; max?: number }) {
  const [txt, setTxt] = useState(value ? String(value) : '');
  const num = txt.trim() === '' ? 0 : Number(txt.replace(',', '.'));
  const bad = !(num >= 0 && num < max);
  return (
    <label>{label}
      <div className="field" style={{ maxWidth: 260 }}>
        <input inputMode="decimal" placeholder="0" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => { if (!bad) onSave(num); }} />
        <span className="unit">{unit}</span>
      </div>
      {bad ? <div className="warn small">Enter a number from 0 to {max}.</div> : num !== value ? <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => onSave(num)}>Save</button> : null}
    </label>
  );
}

export function SettingsPanel({ theme, setTheme, feeSpotPct, setFeeSpotPct, feePerpPct, setFeePerpPct, stockFeePct, setStockFeePct, stockFeeMin, setStockFeeMin, reminders, saveReminder, deleteReminder, onClose }: Props) {
  const [feeKey, setFeeKey] = useState(0);   // remounts the fee fields after a preset
  const [draft, setDraft] = useState<Draft | null>(null);
  const today = localToday();
  const dayNum = Number(draft?.day);
  const err = !draft ? null
    : !draft.title.trim() ? 'Write what to check.'
    : draft.kind === 'monthDay' && !(Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31) ? 'Day of month must be 1–31.'
    : draft.kind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? 'Pick a date.' : null;

  const submit = () => {
    if (!draft || err) return;
    const schedule: Schedule = draft.kind === 'monthDay' ? { kind: 'monthDay', day: dayNum }
      : draft.kind === 'monthEnd' ? { kind: 'monthEnd' }
      : draft.kind === 'weekly' ? { kind: 'weekly', weekday: draft.weekday } : { kind: 'once', date: draft.date };
    const old = reminders.find((r) => r.id === draft.id);
    saveReminder({
      id: draft.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: draft.title.trim(), action: draft.action.trim(), schedule,
      created: old?.created ?? today, doneFor: old && JSON.stringify(old.schedule) === JSON.stringify(schedule) ? old.doneFor : undefined
    });
    setDraft(null);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="icon" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>

        <section className="set-sec">
          <h3>Appearance</h3>
          <div className="seg">
            <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Dark (OLED)</button>
            <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          </div>
        </section>

        <section className="set-sec">
          <h3>Trading fees</h3>
          <div className="dim small">Taken from each trade of new signals as a % of the traded value. Older signals keep the fees they were saved with.</div>
          <div className="seg" role="group" aria-label="Fee presets">
            <button type="button" onClick={() => { setFeeSpotPct(HL_FEES.spotTaker); setFeePerpPct(HL_FEES.perpTaker); setFeeKey((k) => k + 1); }}>Hyperliquid · market (taker)</button>
            <button type="button" onClick={() => { setFeeSpotPct(HL_FEES.spotMaker); setFeePerpPct(HL_FEES.perpMaker); setFeeKey((k) => k + 1); }}>Hyperliquid · limit (maker)</button>
            <button type="button" onClick={() => { setFeeSpotPct(0); setFeePerpPct(0); setFeeKey((k) => k + 1); }}>No fees</button>
          </div>
          <div key={feeKey} className="fee-fields">
            <FeeField label="Crypto spot — SDCA (BTC) and RSPS longs at 1×" value={feeSpotPct} onSave={setFeeSpotPct} />
            <FeeField label="Crypto perps — RSPS shorts and longs above 1×" value={feePerpPct} onSave={setFeePerpPct} />
          </div>
          <div className="dim small">Hyperliquid base tier (14-day volume under $5M): perps {HL_FEES.perpTaker}% taker / {HL_FEES.perpMaker}% maker, spot {HL_FEES.spotTaker}% taker / {HL_FEES.spotMaker}% maker. Funding is counted separately (hourly rates). Liquidations on Hyperliquid have no extra fee.</div>
          <h4 style={{ margin: '10px 0 0' }}>Stocks (ETFs)</h4>
          <div className="seg" role="group" aria-label="Stock fee presets">
            <button type="button" onClick={() => { setStockFeePct(IBKR_FIXED_EU.pct); setStockFeeMin(IBKR_FIXED_EU.min); setFeeKey((k) => k + 1); }}>Interactive Brokers · Fixed (Europe)</button>
            <button type="button" onClick={() => { setStockFeePct(0); setStockFeeMin(0); setFeeKey((k) => k + 1); }}>No fees</button>
          </div>
          <div key={`s${feeKey}`} className="fee-fields">
            <FeeField label="Commission" value={stockFeePct} onSave={setStockFeePct} />
            <FeeField label="Minimum per order (in the listing's currency: EUR on Xetra/Euronext, GBP on LSE)" value={stockFeeMin} onSave={setStockFeeMin} unit="EUR / GBP" max={100} />
          </div>
          <div className="dim small">IBKR Pro Fixed, European stocks/ETFs via SmartRouting: {IBKR_FIXED_EU.pct}% of the trade value, minimum EUR {IBKR_FIXED_EU.min.toFixed(2)} / GBP {IBKR_FIXED_EU.min.toFixed(2)} per order, no maximum, exchange fees included. The minimum is converted to USD at the latest close's exchange rate and stored with each signal; an order smaller than the minimum fee is skipped.</div>
        </section>

        <section className="set-sec">
          <div className="pane-head">
            <h3><IcBell width={17} style={{ verticalAlign: '-3px', marginRight: 6 }} />Reminders</h3>
            {!draft && <button className="btn ghost small" onClick={() => setDraft(empty())}><IcPlus width={15} />Add reminder</button>}
          </div>
          <div className="dim small">Shown in the app on the chosen day (and after it) until you mark them done.</div>

          {draft && (
            <div className="card pane rem-form">
              <label>What to check
                <input value={draft.title} placeholder="e.g. Have stocks closed above their price 12 months ago?" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label>What to do then (optional)
                <textarea rows={3} value={draft.action} placeholder="e.g. Above → stay invested. Below → move to bonds / cash." onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
              </label>
              <label>When
                <div className="field rem-when">
                  <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}>
                    <option value="monthDay">Every month on day…</option>
                    <option value="monthEnd">Last day of every month</option>
                    <option value="weekly">Every week on…</option>
                    <option value="once">Once on a date</option>
                  </select>
                  {draft.kind === 'monthDay' && <input inputMode="numeric" value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })} style={{ width: 80 }} />}
                  {draft.kind === 'weekly' && (
                    <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>
                      {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
                    </select>
                  )}
                  {draft.kind === 'once' && <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />}
                </div>
              </label>
              {err && <div className="warn small">{err}</div>}
              <div className="modal-foot">
                <button className="btn ghost small" onClick={() => setDraft(null)}>Cancel</button>
                <button className="btn gold small" disabled={!!err} onClick={submit}>{draft.id ? 'Save' : 'Add'}</button>
              </div>
            </div>
          )}

          {!reminders.length && !draft && <div className="dim small">No reminders yet.</div>}
          {reminders.map((r) => {
            const due = dueFor(r, today), next = nextOccurrence(r.schedule, today);
            return (
              <div className="rem-row" key={r.id}>
                <div className="rem-main">
                  <b>{r.title}</b>
                  {r.action && <div className="rem-action">{r.action}</div>}
                  <div className="dim small">{describe(r.schedule)} · {due ? <span className="warn">due ({due})</span> : next ? `next ${next}` : 'done'}</div>
                </div>
                <button className="icon" title="Edit" onClick={() => setDraft(toDraft(r))}><IcPen width={16} /></button>
                <button className="icon" title="Delete" onClick={async () => { if (await ask(`Delete the reminder “${r.title}”?`)) deleteReminder(r); }}><IcTrash width={16} /></button>
              </div>
            );
          })}
        </section>

        <section className="set-sec">
          <h3>Backup</h3>
          <BackupSection />
        </section>
      </div>
    </div>
  );
}
