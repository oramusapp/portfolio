import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AUTO_LOCK_OPTIONS, DEFAULT_AUTO_LOCK_MIN, FREE_TRIES, afterFailure, afterSuccess, hashPassword, idleExpired, loadHash, loadLimit,
  passwordProblem, saveHash, saveLimit, verifyPassword, waitMs
} from '../lib/auth';
import { usePersisted } from '../lib/storage';

interface Auth {
  lock: () => void;
  autoLockMin: number; setAutoLockMin: (m: number) => void;
  /** Checks the current password (rate-limited like the lock screen) and stores the new one. Returns an error or null. */
  changePassword: (current: string, next: string, repeat: string) => Promise<string | null>;
}
const AuthContext = createContext<Auth | null>(null);
export const useAuth = () => useContext(AuthContext);

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const secs = (ms: number) => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };

/** Gates the whole app behind a password: first run asks to set one, every start and every auto-lock asks for it. */
export function LockGate({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'setup' | 'locked' | 'open'>(() => (loadHash() ? 'locked' : 'setup'));
  const [autoLockRaw, setAutoLockMin] = usePersisted<number>('autoLockMin', DEFAULT_AUTO_LOCK_MIN);
  const autoLockMin = AUTO_LOCK_OPTIONS.includes(autoLockRaw) ? autoLockRaw : DEFAULT_AUTO_LOCK_MIN;
  const lastActive = useRef(Date.now());
  const lock = useCallback(() => setMode((m) => (m === 'open' ? 'locked' : m)), []);

  // auto-lock: any input counts as activity; time in the background counts as idle
  useEffect(() => {
    if (mode !== 'open') return;
    lastActive.current = Date.now();
    const touch = () => { lastActive.current = Date.now(); };
    const check = () => { if (idleExpired(lastActive.current, Date.now(), autoLockMin)) lock(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', check);
    const id = setInterval(check, 10_000);
    return () => { ACTIVITY.forEach((e) => window.removeEventListener(e, touch, { capture: true })); document.removeEventListener('visibilitychange', check); clearInterval(id); };
  }, [mode, autoLockMin, lock]);

  const changePassword = useCallback(async (current: string, next: string, repeat: string) => {
    const lim = loadLimit(), wait = waitMs(lim, Date.now());
    if (wait > 0) return `Too many wrong passwords. Try again in ${secs(wait)}.`;
    const stored = loadHash();
    if (!stored || !(await verifyPassword(current, stored))) { saveLimit(afterFailure(lim, Date.now())); return 'The current password is wrong.'; }
    saveLimit(afterSuccess());
    const p = passwordProblem(next, repeat); if (p) return p;
    saveHash(await hashPassword(next));
    return null;
  }, []);

  if (mode === 'open') return <AuthContext.Provider value={{ lock, autoLockMin, setAutoLockMin, changePassword }}>{children}</AuthContext.Provider>;
  return mode === 'setup' ? <SetupScreen onDone={() => setMode('open')} /> : <LockScreen onOpen={() => setMode('open')} />;
}

function Shell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="lock-wrap">
      <form className="card lock-card" onSubmit={(e) => e.preventDefault()}>
        <img src="./holdings-icon.png" alt="" className="lock-avatar" />
        <h2>{title}</h2>
        <div className="dim small">{sub}</div>
        {children}
      </form>
    </div>
  );
}

function SetupScreen({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState(''), [rep, setRep] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const p = passwordProblem(pw, rep); if (p) { setErr(p); return; }
    setBusy(true);
    try { saveHash(await hashPassword(pw)); saveLimit(afterSuccess()); onDone(); }
    catch { setErr('Could not save the password on this device.'); setBusy(false); }
  };
  return (
    <Shell title="Set a password" sub="It protects SKB Portfolio Manager on this device. Only a salted hash is stored; there is no way to recover a forgotten password.">
      <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <input type="password" autoComplete="new-password" placeholder="Repeat password" value={rep} onChange={(e) => setRep(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      {err && <div className="warn small">{err}</div>}
      <button type="submit" className="btn gold" disabled={busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Set password'}</button>
    </Shell>
  );
}

function LockScreen({ onOpen }: { onOpen: () => void }) {
  const [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now()), [limit, setLimit] = useState(loadLimit);
  const [erase, setErase] = useState(false), [eraseText, setEraseText] = useState('');
  const wait = waitMs(limit, now);
  useEffect(() => { if (wait <= 0) return; const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id); }, [wait]);

  const submit = async () => {
    const lim = loadLimit();
    if (waitMs(lim, Date.now()) > 0 || busy || !pw) { setLimit(lim); setNow(Date.now()); return; }
    const stored = loadHash();
    setBusy(true);
    const ok = !!stored && await verifyPassword(pw, stored).catch(() => false);
    setBusy(false);
    if (ok) { saveLimit(afterSuccess()); onOpen(); return; }
    const next = afterFailure(lim, Date.now());
    saveLimit(next); setLimit(next); setNow(Date.now()); setPw('');
    setErr(next.until > Date.now() ? 'Wrong password.' : `Wrong password. ${Math.max(0, FREE_TRIES - next.fails)} more tries before a pause.`);
  };
  const eraseAll = () => {
    try { Object.keys(localStorage).filter((k) => k.startsWith('pp.')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    location.reload();
  };

  return (
    <Shell title="Locked" sub="Enter your password to open SKB Portfolio Manager.">
      <input type="password" autoComplete="current-password" placeholder="Password" value={pw} disabled={wait > 0} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} autoFocus />
      {wait > 0 ? <div className="warn small">Too many wrong passwords. Try again in {secs(wait)}.</div> : err && <div className="warn small">{err}</div>}
      <button type="submit" className="btn gold" disabled={busy || wait > 0 || !pw} onClick={() => void submit()}>{busy ? 'Checking…' : 'Unlock'}</button>
      {!erase ? <button type="button" className="btn ghost small" onClick={() => setErase(true)}>Forgot password?</button> : (
        <div className="lock-erase">
          <div className="small">A forgotten password cannot be recovered. The only way back in is to <b>erase all app data on this device</b> (signals, holdings, notes, checklist) and start again — restore a backup file afterwards if you have one.</div>
          <input placeholder="Type ERASE to confirm" value={eraseText} onChange={(e) => setEraseText(e.target.value)} />
          <div className="row-btns">
            <button type="button" className="btn ghost small" onClick={() => { setErase(false); setEraseText(''); }}>Cancel</button>
            <button type="button" className="btn danger small" disabled={eraseText !== 'ERASE'} onClick={eraseAll}>Erase everything</button>
          </div>
        </div>
      )}
    </Shell>
  );
}
