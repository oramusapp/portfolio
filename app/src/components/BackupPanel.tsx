import { useRef, useState } from 'react';
import { SCHEMA_VERSION, exportBackup, importBackup, readArchive, archive, restoreValue, writeKey, type ArchiveEntry, type BackupFile } from '../lib/storage';
import { IcClose } from './icons';

const REASON: Record<ArchiveEntry['reason'], string> = {
  replaced: 'replaced', deleted: 'deleted', unreadable: 'unreadable', 'before-import': 'before import', 'before-migration': 'before update'
};
const SIGNAL_PREFIX = 'pp.signals#';

async function saveFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function restore(e: ArchiveEntry) {
  if (e.key === '*') {
    importBackup({ app: 'portfolio-performance', schema: SCHEMA_VERSION, created: new Date(e.time).toISOString(), data: JSON.parse(e.data) as Record<string, string> });
    location.reload();
    return;
  }
  if (e.key.startsWith(SIGNAL_PREFIX)) {
    const sig = JSON.parse(e.data) as { date: string };
    let list: { date: string }[] = [];
    try { list = JSON.parse(localStorage.getItem('pp.signals') ?? '[]'); } catch { /* unreadable list is archived on load */ }
    const cur = list.find((x) => x.date === sig.date);
    if (cur) archive(SIGNAL_PREFIX + sig.date, 'replaced', `Signal ${sig.date} (before restore)`, cur);
    writeKey('pp.signals', JSON.stringify([...list.filter((x) => x.date !== sig.date), sig]));
    return;
  }
  restoreValue(e.key, e.data, e.label);
}

export function BackupPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState(readArchive);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const day = new Date().toISOString().slice(0, 10);
    await saveFile(`portfolio-backup-${day}.json`, JSON.stringify(exportBackup(), null, 1));
    setMsg({ ok: true, text: 'Backup file created. Keep it somewhere outside the phone (e.g. cloud drive).' });
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const file = JSON.parse(await f.text()) as BackupFile;
      if (!confirm(`Load the backup from ${file.created?.slice(0, 10) ?? 'unknown date'}? Your current data is archived first and can be restored.`)) return;
      importBackup(file);
      location.reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message || 'Could not read this file.' }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const doRestore = (e: ArchiveEntry) => {
    if (!confirm(`Restore “${e.label}” from ${new Date(e.time).toLocaleString()}? What it replaces is archived first.`)) return;
    try { restore(e); setEntries(readArchive()); setMsg({ ok: true, text: `Restored: ${e.label}.` }); }
    catch { setMsg({ ok: false, text: 'Could not restore this entry.' }); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>Backup</h2>
            <div className="dim small">The app never overwrites or deletes your data on its own. Replaced and deleted records are kept in the archive below.</div></div>
          <button className="icon" onClick={onClose}><IcClose /></button>
        </div>

        <div className="split">
          <div className="card pane">
            <h3>Export</h3>
            <div className="dim small">Saves all signals, holdings, net worth, settings and the archive to one file.</div>
            <button className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={doExport}>Export backup</button>
          </div>
          <div className="card pane">
            <h3>Import</h3>
            <div className="dim small">Loads a backup file. The current data is archived first, so it can be brought back.</div>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => doImport(e.target.files?.[0])} />
            <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current?.click()}>Import backup…</button>
          </div>
        </div>
        {msg && <div className={msg.ok ? 'pos small' : 'warn small'}>{msg.text}</div>}

        <div className="card pane">
          <h3>Archive <span className="dim">({entries.length})</span></h3>
          {!entries.length && <div className="dim small">Nothing archived yet.</div>}
          {entries.length > 0 && (
            <div className="table-wrap">
              <table className="mini">
                <thead><tr><th>When</th><th>What</th><th>Why</th><th /></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.time).toLocaleString()}</td>
                      <td>{e.label}</td>
                      <td className="dim">{REASON[e.reason]}</td>
                      <td>{e.reason !== 'unreadable' && <button className="btn ghost small" onClick={() => doRestore(e)}>Restore</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
