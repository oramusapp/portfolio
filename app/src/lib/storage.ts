import { useEffect, useState } from 'react';

// Signals, holdings and settings are kept in localStorage under the app's address. An app update (new deploy,
// new service worker) only replaces the code, so this data stays. Rules for future changes:
//  • never rename the `pp.` keys; new fields get defaults when read,
//  • a change to the stored format = a new entry in MIGRATIONS + SCHEMA_VERSION bumped by one.
const PREFIX = 'pp.';
export const SCHEMA_VERSION = 1;

/** MIGRATIONS[n] upgrades stored data from version n-1 to n. */
const MIGRATIONS: Record<number, () => void> = {};

const keys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)); } catch { return []; } };

/** Runs pending migrations once at start-up, before the app reads its data. */
export function migrate() {
  try {
    const raw = localStorage.getItem(PREFIX + 'schema');
    let v = raw === null ? (keys().length ? 1 : SCHEMA_VERSION) : Number(raw);
    while (v < SCHEMA_VERSION) { v++; MIGRATIONS[v]?.(); }
    localStorage.setItem(PREFIX + 'schema', String(SCHEMA_VERSION));
  } catch { /* storage blocked */ }
}

/** Asks the browser not to evict the app's storage under pressure (granted silently for installed apps on most browsers). */
export function requestPersistence() {
  try { void navigator.storage?.persist?.(); } catch { /* not supported */ }
}

export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }, [key, value]);
  return [value, setValue] as const;
}
