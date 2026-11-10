import { useState } from 'react';
import type { DashboardStats } from '../lib/dashboardStats';

/** Copies the strategy stats as JSON for the "Mój dzień" dashboard (paste them there). */
export function DashboardExport({ build }: { build: () => DashboardStats }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [text, setText] = useState('');
  const copy = () => {
    const json = JSON.stringify(build());
    setText(json);
    const done = () => { setState('copied'); setTimeout(() => setState('idle'), 2500); };
    try {
      navigator.clipboard.writeText(json).then(done, () => setState('manual'));
    } catch { setState('manual'); }
  };
  return (
    <div className="dash-export">
      <button className="btn ghost small" onClick={copy} title="Copy the strategy stats, then paste them in the Mój dzień dashboard">
        {state === 'copied' ? 'Copied ✓ — paste in the dashboard' : 'Copy stats for dashboard'}
      </button>
      {state === 'manual' && (
        <textarea className="dash-export-text" readOnly value={text} aria-label="Stats to copy" rows={3}
          onFocus={(e) => e.currentTarget.select()} ref={(el) => { el?.focus(); el?.select(); }} />
      )}
    </div>
  );
}
