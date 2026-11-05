import { describe, expect, it } from 'vitest';
import { DAILY_ITEMS, STAGES, countDone, currentStage, dailyFor, passedCount, toggleDaily, type DailyState } from './checklist';

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

describe('daily check reset', () => {
  it('starts empty when nothing is stored', () => {
    expect(dailyFor(null, '2026-11-05')).toEqual({ day: '2026-11-05', done: [], history: {} });
  });
  it('keeps the ticks during the same day', () => {
    let s = toggleDaily(null, 'sleep', '2026-11-05');
    s = toggleDaily(s, 'trend', '2026-11-05');
    expect(dailyFor(s, '2026-11-05').done).toEqual(['sleep', 'trend']);
    expect(countDone(s)).toBe(2);
  });
  it('untick removes the item', () => {
    const s = toggleDaily(toggleDaily(null, 'sleep', '2026-11-05'), 'sleep', '2026-11-05');
    expect(s.done).toEqual([]);
  });
  it('reads as empty on the next day and keeps yesterday’s count in the history', () => {
    const yesterday = DAILY_ITEMS.reduce<DailyState | null>((s, it) => toggleDaily(s, it.id, '2026-11-04'), null)!;
    expect(countDone(yesterday)).toBe(DAILY_ITEMS.length);
    const today = dailyFor(yesterday, '2026-11-05');
    expect(today.day).toBe('2026-11-05');
    expect(today.done).toEqual([]);
    expect(today.history).toEqual({ '2026-11-04': DAILY_ITEMS.length });
  });
  it('ticking on a new day starts from an empty list', () => {
    const old = toggleDaily(toggleDaily(null, 'sleep', '2026-11-04'), 'trend', '2026-11-04');
    const s = toggleDaily(old, 'study', '2026-11-06');           // a day skipped in between
    expect(s.done).toEqual(['study']);
    expect(s.history).toEqual({ '2026-11-04': 2 });
  });
  it('a clock set back does not wipe today', () => {
    const s = toggleDaily(null, 'sleep', '2026-11-05');
    expect(dailyFor(s, '2026-11-04').history).toEqual({});        // the newer day is not archived as history
  });
  it('history keeps at most 60 days', () => {
    let s: DailyState | null = null;
    for (let i = 0; i < 80; i++) s = toggleDaily(s, 'sleep', day(i));
    const kept = Object.keys(s!.history ?? {}).sort();
    expect(kept.length).toBe(60);
    expect(kept[0]).toBe(day(19));                                  // oldest days dropped first
    expect(kept.at(-1)).toBe(day(78));
  });
  it('ignores ids that are not on the list', () => {
    expect(countDone({ day: '2026-11-05', done: ['sleep', 'gone'] })).toBe(1);
  });
});

describe('stage gates', () => {
  it('current stage is the first gate not passed', () => {
    expect(currentStage({})).toBe(0);
    expect(currentStage({ 0: '2026-10-01', 1: '2026-10-20' })).toBe(2);
    expect(currentStage({ 0: '2026-10-01', 1: null, 2: '2026-10-20' })).toBe(1);
    expect(passedCount({ 0: '2026-10-01', 1: null, 2: '2026-10-20' })).toBe(2);
  });
  it('all passed', () => {
    const all = Object.fromEntries(STAGES.map((_, i) => [i, '2026-11-01']));
    expect(currentStage(all)).toBe(STAGES.length);
    expect(passedCount(all)).toBe(6);
  });
});
