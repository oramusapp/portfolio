// Password lock. The password itself is never stored: only a PBKDF2-SHA256 hash (Web Crypto, random 16-byte salt,
// 600 000 iterations) under `pp.auth`. Failed attempts are counted in `pp.auth.limit` so a reload does not reset the
// lock-out. This is an access gate for this device, not encryption: the app data stays in localStorage as before.

export const AUTH_KEY = 'pp.auth';
export const LIMIT_KEY = 'pp.auth.limit';
export const ITERATIONS = 600_000;
export const MIN_LENGTH = 8;

export interface PasswordHash { v: 1; algo: 'PBKDF2-SHA256'; iterations: number; salt: string; hash: string; }

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256));
}

export async function hashPassword(password: string, iterations = ITERATIONS): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, algo: 'PBKDF2-SHA256', iterations, salt: b64(salt), hash: b64(await derive(password, salt, iterations)) };
}

/** Constant-time comparison of the derived key with the stored one. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const got = await derive(password, unb64(stored.salt), stored.iterations), want = unb64(stored.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export function passwordProblem(pw: string, repeat: string): string | null {
  if (pw.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (pw !== repeat) return 'The two passwords do not match.';
  return null;
}

// ---------- rate limit ----------
export interface LimitState { fails: number; until: number; }
export const FREE_TRIES = 5;
export const BASE_LOCKOUT_MS = 30_000;
export const MAX_LOCKOUT_MS = 15 * 60_000;

/** ms left before another attempt is allowed (0 = may try now). */
export const waitMs = (s: LimitState, now: number) => Math.max(0, s.until - now);

/** After a wrong password: the first FREE_TRIES failures are free, then 30 s, 60 s, 120 s … up to 15 min. */
export function afterFailure(s: LimitState, now: number): LimitState {
  const fails = s.fails + 1;
  if (fails < FREE_TRIES) return { fails, until: 0 };
  const ms = Math.min(BASE_LOCKOUT_MS * 2 ** (fails - FREE_TRIES), MAX_LOCKOUT_MS);
  return { fails, until: now + ms };
}
export const afterSuccess = (): LimitState => ({ fails: 0, until: 0 });

// ---------- auto-lock ----------
export const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60];
export const DEFAULT_AUTO_LOCK_MIN = 5;
/** True when the app has been idle (no input, or in the background) for `minutes` or longer. */
export const idleExpired = (lastActive: number, now: number, minutes: number) => now - lastActive >= minutes * 60_000;

// ---------- storage ----------
const readJson = <T,>(key: string): T | null => { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T : null; } catch { return null; } };
export const loadHash = () => readJson<PasswordHash>(AUTH_KEY);
export const saveHash = (h: PasswordHash) => localStorage.setItem(AUTH_KEY, JSON.stringify(h));
export const loadLimit = (): LimitState => readJson<LimitState>(LIMIT_KEY) ?? { fails: 0, until: 0 };
export const saveLimit = (s: LimitState) => { try { localStorage.setItem(LIMIT_KEY, JSON.stringify(s)); } catch { /* storage blocked */ } };
export const isAuthKey = (k: string) => k === AUTH_KEY || k.startsWith(AUTH_KEY + '.');
