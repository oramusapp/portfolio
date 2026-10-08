import { useState } from 'react';
import { n } from './SignalForm';
import { IcClose, IcPlus, IcTrash } from './icons';

// Manually entered amounts across asset classes. All amounts are in one currency picked at the top (no conversion).
export const CATEGORIES = [
  { id: 'crypto', label: 'Crypto', hint: 'e.g. Hyperliquid, cold wallet' },
  { id: 'stocks', label: 'Stock market', hint: 'e.g. broker account, ETF' },
  { id: 'metals', label: 'Metals (gold, silver…)', hint: 'e.g. gold coins, silver bars' },
  { id: 'cash', label: 'Cash (currencies)', hint: 'e.g. EUR cash, USD cash' },
  { id: 'bank', label: 'Bank accounts', hint: 'e.g. current account, savings' }
] as const;
export type Category = typeof CATEGORIES[number]['id'];
export const CURRENCIES = ['USD', 'PLN', 'EUR'] as const;
export interface NetWorthItem { cat: Category; name: string; amount: number; }
export interface NetWorth { currency: typeof CURRENCIES[number]; items: NetWorthItem[]; updatedAt: number; }

type Row = { cat: Category; name: string; v: string };
const COLORS: Record<Category, string> = { crypto: '#e2b44c', stocks: '#4fc3d9', metals: '#c9c4b8', cash: '#7fd26b', bank: '#9a6cf0' };

const money = (v: number, cur: string) =>
  Number.isFinite(v) ? `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}` : '—';

export function NetWorthPanel({ initial, onSave, onClose }: { initial: NetWorth; onSave: (w: NetWorth) => void; onClose: () => void }) {
  const [currency, setCurrency] = useState(initial.currency);
  const [rows, setRows] = useState<Row[]>(initial.items.map((i) => ({ cat: i.cat, name: i.name, v: String(i.amount) })));

  const sub = (c: Category) => rows.filter((r) => r.cat === c).reduce((t, r) => t + (n(r.v) > 0 ? n(r.v) : 0), 0);
  const total = CATEGORIES.reduce((t, c) => t + sub(c.id), 0);
  const bad = rows.some((r) => !(n(r.v) >= 0));
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = () => {
    if (bad) return;
    onSave({ currency, items: rows.filter((r) => r.name.trim() || n(r.v) > 0).map((r) => ({ cat: r.cat, name: r.name.trim(), amount: n(r.v) })), updatedAt: Date.now() });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>Net worth</h2>
            <div className="dim small">How much you hold in each asset class. Amounts are typed in by hand.</div></div>
          <div className="field">
            <select value={currency} onChange={(e) => setCurrency(e.target.value as NetWorth['currency'])}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="icon" onClick={onClose}><IcClose /></button>
          </div>
        </div>

        <div className="nw-total">
          <div className="total-row"><span className="dim">Total</span><b>{money(total, currency)}</b></div>
          {total > 0 && (
            <>
              <div className="nw-bar">{CATEGORIES.map((c) => sub(c.id) > 0 && <i key={c.id} style={{ width: `${(sub(c.id) / total) * 100}%`, background: COLORS[c.id] }} title={c.label} />)}</div>
              <div className="nw-legend">{CATEGORIES.map((c) => sub(c.id) > 0 && <span key={c.id}><i style={{ background: COLORS[c.id] }} />{c.label} {((sub(c.id) / total) * 100).toFixed(1)}%</span>)}</div>
            </>
          )}
        </div>

        <div className="nw-grid">
          {CATEGORIES.map((c) => (
            <div className="card pane" key={c.id}>
              <h3><i className="dot" style={{ background: COLORS[c.id] }} />{c.label} <span className="right">{money(sub(c.id), currency)}</span></h3>
              {rows.map((r, i) => r.cat === c.id && (
                <div className="pair" key={i}>
                  <input className="nw-name" value={r.name} placeholder={c.hint} onChange={(e) => set(i, { name: e.target.value })} />
                  <input inputMode="decimal" value={r.v} placeholder="0" onChange={(e) => set(i, { v: e.target.value })} />
                  <span className="unit">{currency}</span>
                  <button className="icon" title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><IcTrash width={16} /></button>
                </div>
              ))}
              <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { cat: c.id, name: '', v: '' }])}><IcPlus width={15} />Add</button>
            </div>
          ))}
        </div>

        {bad && <ul className="errors"><li>Amounts must be numbers ≥ 0.</li></ul>}
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn gold" disabled={bad} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
