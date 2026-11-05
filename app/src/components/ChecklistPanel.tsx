import { IcClose } from './icons';
import { DAILY_ITEMS, STAGES, countDone, currentStage, passedCount, type DailyState, type StageState } from '../lib/checklist';
import { localToday } from '../lib/reminders';

const addDay = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return localToday(new Date(y, m - 1, d + n)); };

/** Checklist from the Crypto Learning System Rulebook: the daily check (empty again every local day) and the stage gates. */
export function ChecklistPanel({ today, daily, onToggle, stages, setStages, onClose }: {
  today: string; daily: DailyState; onToggle: (id: string) => void;
  stages: StageState; setStages: (s: StageState) => void; onClose: () => void;
}) {
  const done = countDone(daily), cur = currentStage(stages), passed = passedCount(stages);
  const week = Array.from({ length: 7 }, (_, i) => addDay(today, i - 7)).map((d) => ({ d, n: daily.history?.[d] }));
  const setGate = (i: number, date: string | null) => setStages({ ...stages, [i]: date });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>Checklist</h2><div className="dim small">Crypto Learning System Rulebook — study first, allocate last.</div></div>
          <button className="icon" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>

        <section className="set-sec">
          <div className="pane-head">
            <h3>Daily check</h3>
            <span className={`chip-count ${done === DAILY_ITEMS.length ? 'pos' : ''}`}>{done}/{DAILY_ITEMS.length} today</span>
          </div>
          <div className="dim small">One session, same time each day, about 30 minutes. Starts empty again every day ({today}, your local time).</div>
          <div className="cl-list">
            {DAILY_ITEMS.map((it) => (
              <label key={it.id} className={`check cl-item ${daily.done.includes(it.id) ? 'done' : ''}`}>
                <input type="checkbox" checked={daily.done.includes(it.id)} onChange={() => onToggle(it.id)} /><span />{it.text}
              </label>
            ))}
          </div>
          <div className="cl-week" aria-label="Last 7 days">
            {week.map(({ d, n }) => <span key={d} title={`${d}: ${n ?? 0}/${DAILY_ITEMS.length}`} className={n === undefined ? '' : n === DAILY_ITEMS.length ? 'full' : n > 0 ? 'part' : ''} />)}
            <span className="dim tiny">last 7 days</span>
          </div>
        </section>

        <section className="set-sec">
          <div className="pane-head">
            <h3>Stage gates</h3>
            <span className="chip-count">{passed}/{STAGES.length} passed</span>
          </div>
          <div className="dim small">
            {cur < STAGES.length ? <>Current stage: <b>Stage {cur} · {STAGES[cur].title}</b>. No written evidence, no advance.</> : <b>All gates passed.</b>}
          </div>
          <div className="cl-stages">
            {STAGES.map((s, i) => {
              const date = stages[i] ?? null;
              return (
                <div key={i} className={`card cl-stage ${date ? 'passed' : ''} ${i === cur ? 'current' : ''}`}>
                  <div className="cl-stage-head">
                    <b>Stage {i} · {s.title}</b>
                    {i === cur && <span className="tag sig">current</span>}
                  </div>
                  <div className="dim small">Gate: {s.gate}</div>
                  <div className="cl-stage-foot">
                    <label className="check"><input type="checkbox" checked={!!date} onChange={(e) => setGate(i, e.target.checked ? today : null)} /><span />Passed</label>
                    {date && <input type="date" className="cl-date" value={date} max={today} onChange={(e) => e.target.value && setGate(i, e.target.value)} />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="dim tiny">The 8 weeks, 20 positions and 3 months in the gates are the rulebook’s placeholders, not figures from its source.</div>
        </section>
      </div>
    </div>
  );
}
