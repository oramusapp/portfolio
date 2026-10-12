import { describe, expect, it } from 'vitest';
import { dueFor, lastOccurrence, nextOccurrence, type Reminder } from './reminders';

describe('reminder dates', () => {
  it('monthly on day N, clamped to short months', () => {
    expect(lastOccurrence({ kind: 'monthDay', day: 10 }, '2026-10-12')).toBe('2026-10-10');
    expect(lastOccurrence({ kind: 'monthDay', day: 10 }, '2026-10-09')).toBe('2026-09-10');
    expect(nextOccurrence({ kind: 'monthDay', day: 10 }, '2026-10-10')).toBe('2026-11-10');
    expect(nextOccurrence({ kind: 'monthDay', day: 31 }, '2026-02-01')).toBe('2026-02-28');
  });
  it('last day of the month', () => {
    expect(lastOccurrence({ kind: 'monthEnd' }, '2026-10-31')).toBe('2026-10-31');
    expect(lastOccurrence({ kind: 'monthEnd' }, '2026-10-30')).toBe('2026-09-30');
    expect(nextOccurrence({ kind: 'monthEnd' }, '2026-12-31')).toBe('2027-01-31');
  });
  it('weekly and once', () => {
    expect(lastOccurrence({ kind: 'weekly', weekday: 1 }, '2026-10-14')).toBe('2026-10-12');   // Wed → Mon
    expect(nextOccurrence({ kind: 'weekly', weekday: 1 }, '2026-10-12')).toBe('2026-10-19');
    expect(lastOccurrence({ kind: 'once', date: '2026-11-01' }, '2026-10-12')).toBeNull();
  });
  it('is due from the occurrence until marked done, never before it was created', () => {
    const r: Reminder = { id: '1', title: 'x', action: '', schedule: { kind: 'monthDay', day: 10 }, created: '2026-10-05' };
    expect(dueFor(r, '2026-10-09')).toBeNull();
    expect(dueFor(r, '2026-10-12')).toBe('2026-10-10');
    expect(dueFor({ ...r, doneFor: '2026-10-10' }, '2026-10-12')).toBeNull();
    expect(dueFor({ ...r, doneFor: '2026-10-10' }, '2026-11-10')).toBe('2026-11-10');
    expect(dueFor({ ...r, created: '2026-10-11' }, '2026-10-12')).toBeNull();
  });
});
