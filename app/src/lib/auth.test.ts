import { describe, expect, it } from 'vitest';
import {
  BASE_LOCKOUT_MS, FREE_TRIES, ITERATIONS, MAX_LOCKOUT_MS, afterFailure, afterSuccess, hashPassword, idleExpired,
  isAuthKey, passwordProblem, verifyPassword, waitMs, type LimitState
} from './auth';

describe('password hash', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const h = await hashPassword('correct horse', 1000);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('correct hors', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });
  it('never stores the password and salts every hash', async () => {
    const a = await hashPassword('same password', 1000), b = await hashPassword('same password', 1000);
    expect(JSON.stringify(a)).not.toContain('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(atob(a.salt).length).toBe(16);
  });
  it('uses the slow default (600 000 PBKDF2-SHA256 iterations)', async () => {
    const h = await hashPassword('pw-default-cost');
    expect(h).toMatchObject({ algo: 'PBKDF2-SHA256', iterations: ITERATIONS });
    expect(ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(await verifyPassword('pw-default-cost', h)).toBe(true);
  });
  it('setup rules', () => {
    expect(passwordProblem('short', 'short')).toMatch(/8 characters/);
    expect(passwordProblem('longenough', 'different1')).toMatch(/match/);
    expect(passwordProblem('longenough', 'longenough')).toBeNull();
  });
});

describe('failed-attempt rate limit', () => {
  const t0 = 1_000_000;
  const fail = (n: number, now = t0) => { let s: LimitState = afterSuccess(); for (let i = 0; i < n; i++) s = afterFailure(s, now); return s; };
  it('the first tries are free', () => {
    const s = fail(FREE_TRIES - 1);
    expect(waitMs(s, t0)).toBe(0);
  });
  it('then locks out for 30 s, doubling each further failure', () => {
    expect(waitMs(fail(FREE_TRIES), t0)).toBe(BASE_LOCKOUT_MS);
    expect(waitMs(fail(FREE_TRIES + 1), t0)).toBe(2 * BASE_LOCKOUT_MS);
    expect(waitMs(fail(FREE_TRIES + 2), t0)).toBe(4 * BASE_LOCKOUT_MS);
  });
  it('caps the lock-out at 15 minutes', () => {
    expect(waitMs(fail(FREE_TRIES + 20), t0)).toBe(MAX_LOCKOUT_MS);
  });
  it('the wait runs out with time, and a success resets the counter', () => {
    const s = fail(FREE_TRIES);
    expect(waitMs(s, t0 + BASE_LOCKOUT_MS - 1)).toBe(1);
    expect(waitMs(s, t0 + BASE_LOCKOUT_MS)).toBe(0);
    expect(afterSuccess()).toEqual({ fails: 0, until: 0 });
    expect(waitMs(afterFailure(afterSuccess(), t0), t0)).toBe(0);
  });
});

describe('auto-lock', () => {
  it('locks only after the idle time has passed', () => {
    const t = 5_000_000;
    expect(idleExpired(t, t + 5 * 60_000 - 1, 5)).toBe(false);
    expect(idleExpired(t, t + 5 * 60_000, 5)).toBe(true);
    expect(idleExpired(t, t + 59_000, 1)).toBe(false);
  });
  it('the password keys are kept out of backups', () => {
    expect(isAuthKey('pp.auth')).toBe(true);
    expect(isAuthKey('pp.auth.limit')).toBe(true);
    expect(isAuthKey('pp.authors')).toBe(false);
    expect(isAuthKey('pp.signals')).toBe(false);
  });
});
