import { useEffect, useRef, useState } from 'react';

// Signals, holdings and settings are kept in localStorage under the app's address. An app update (new deploy,
// new service worker) only replaces the code, so this data stays. Rules that keep data from being lost:
//  • never rename the `pp.` keys; new fields get defaults when read,
//  • a change to the stored format = a new entry in MIGRATIONS + SCHEMA_VERSION bumped by one
//    (a snapshot of all data is archived before migrating),
//  • nothing is overwritten automatically: a value is written only after the user changed it, unreadable data is
//    archived before anything replaces it, and replaced/deleted records go to the archive (restorable in Backup).
const PREFIX = 'pp.';
export const SCHEMA_VERSION = 1;
const ARCHIVE = PREFIX + 'archive';
const ARCHIVE_MAX = 300;

/** MIGRATIONS[n] upgrades stored data from version n-1 to n. */
const MIGRATIONS: Record<number, () => void> = {};

export const SAVE_FAILED = 'pp-save-failed';
export const STORAGE_CHANGED = 'pp-storage-changed';

const dataKeys = () => {
  try { return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && k !== ARCHIVE); } catch { return []; }
};

// ---------- archive ----------
export interface ArchiveEntry { id: string; time: number; key: string; reason: 'replaced' | 'deleted' | 'unreadable' | 'before-import' | 'before-migration'; label: string; data: string; }

export function readArchive(): ArchiveEntry[] {
  try { return JSON.parse(localStorage.getItem(ARCHIVE) ?? '[]') as ArchiveEntry[]; } catch { return []; }
}
function writeRaw(key: string, raw: string) {
  try { localStorage.setItem(key, raw); return true; }
  catch { window.dispatchEvent(new Event(SAVE_FAILED)); return false; }
}
/** Keeps a copy of `data` (any JSON value) that is about to be replaced or deleted. Oldest entries drop off after ARCHIVE_MAX. */
export function archive(key: string, reason: ArchiveEntry['reason'], label: string, data: unknown) {
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  const prev = readArchive();
  if (prev[0] && prev[0].key === key && prev[0].reason === reason && prev[0].data === raw) return;   // same copy already kept
  const entry: ArchiveEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: Date.now(), key, reason, label, data: raw };
  writeRaw(ARCHIVE, JSON.stringify([entry, ...prev].slice(0, ARCHIVE_MAX)));
}
export function removeFromArchive(id: string) {
  writeRaw(ARCHIVE, JSON.stringify(readArchive().filter((e) => e.id !== id)));
}

// ---------- backup ----------
export interface BackupFile { app: 'portfolio-performance'; schema: number; created: string; data: Record<string, string>; archive?: ArchiveEntry[]; }

export function exportBackup(): BackupFile {
  const data: Record<string, string> = {};
  for (const k of dataKeys()) data[k] = localStorage.getItem(k) ?? '';
  return { app: 'portfolio-performance', schema: SCHEMA_VERSION, created: new Date().toISOString(), data, archive: readArchive() };
}

/** Replaces the current data with the backup; the current data is archived first, so nothing is lost. */
export function importBackup(file: BackupFile) {
  if (file?.app !== 'portfolio-performance' || typeof file.data !== 'object') throw new Error('This is not a Portfolio Performance backup file.');
  if (file.schema > SCHEMA_VERSION) throw new Error('This backup comes from a newer version of the app. Update the app first.');
  archive('*', 'before-import', 'All data before import', exportBackup().data);
  const keep = new Set([ARCHIVE]);
  for (const k of dataKeys()) if (!keep.has(k) && !(k in file.data)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(file.data)) if (k.startsWith(PREFIX) && k !== ARCHIVE) writeRaw(k, v);
  if (file.archive?.length) {
    const ids = new Set(readArchive().map((e) => e.id));
    writeRaw(ARCHIVE, JSON.stringify([...readArchive(), ...file.archive.filter((e) => !ids.has(e.id))].sort((a, b) => b.time - a.time).slice(0, ARCHIVE_MAX)));
  }
  localStorage.setItem(PREFIX + 'schema', String(file.schema));
  migrate();
}

/** Puts an archived value back (the value it replaces is archived in turn). */
export function restoreValue(key: string, raw: string, label: string) {
  const cur = localStorage.getItem(key);
  if (cur !== null) archive(key, 'replaced', `${label} (before restore)`, cur);
  writeRaw(key, raw);
  window.dispatchEvent(new CustomEvent(STORAGE_CHANGED, { detail: key }));
}

// ---------- start-up ----------
/** Runs pending migrations once at start-up, before the app reads its data. */
export function migrate() {
  try {
    const raw = localStorage.getItem(PREFIX + 'schema');
    let v = raw === null ? (dataKeys().length ? 1 : SCHEMA_VERSION) : Number(raw);
    if (v < SCHEMA_VERSION) archive('*', 'before-migration', `All data (format v${v})`, exportBackup().data);
    while (v < SCHEMA_VERSION) { v++; MIGRATIONS[v]?.(); }
    writeRaw(PREFIX + 'schema', String(SCHEMA_VERSION));
  } catch { /* storage blocked */ }
}

/** Asks the browser not to evict the app's storage under pressure (granted silently for installed apps on most browsers). */
export function requestPersistence() {
  try { void navigator.storage?.persist?.(); } catch { /* not supported */ }
}

function read<T>(key: string, initial: T): { value: T; raw: string | null } {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PREFIX + key); } catch { return { value: initial, raw: null }; }
  if (raw === null) return { value: initial, raw };
  try { return { value: JSON.parse(raw) as T, raw }; }
  catch {
    // unreadable value: keep a copy; it is only replaced once the user saves something new here
    archive(PREFIX + key, 'unreadable', `Unreadable ${key}`, raw);
    return { value: initial, raw };
  }
}

/** State kept in localStorage. It is written only when it differs from what is stored, and changes from other
 *  tabs/windows are picked up, so loading the app never writes and an older tab cannot overwrite newer data. */
export function usePersisted<T>(key: string, initial: T) {
  const [first] = useState(() => read(key, initial));
  const [value, setValue] = useState<T>(first.value);
  const stored = useRef<string | null>(first.raw);   // what localStorage holds for this key, as far as this tab knows
  const loaded = useRef(JSON.stringify(first.value)); // value as loaded, so an untouched default is never written
  useEffect(() => {
    const json = JSON.stringify(value);
    if (json === stored.current || json === loaded.current) return;
    loaded.current = '';
    if (writeRaw(PREFIX + key, json)) stored.current = json;
  }, [key, value]);
  useEffect(() => {
    const reload = () => {
      const next = read(key, initial);
      stored.current = next.raw;
      loaded.current = JSON.stringify(next.value);
      setValue((cur) => (JSON.stringify(cur) === loaded.current ? cur : next.value));
    };
    const onStorage = (e: StorageEvent) => { if (e.key === PREFIX + key || e.key === null) reload(); };
    const onLocal = (e: Event) => { const k = (e as CustomEvent).detail; if (k === PREFIX + key || k === '*') reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(STORAGE_CHANGED, onLocal);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(STORAGE_CHANGED, onLocal); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, setValue] as const;
}

/** Writes a raw value under a full key and tells mounted `usePersisted` hooks to reload it. */
export function writeKey(key: string, raw: string) {
  const ok = writeRaw(key, raw);
  window.dispatchEvent(new CustomEvent(STORAGE_CHANGED, { detail: key }));
  return ok;
}
