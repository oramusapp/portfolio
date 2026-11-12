// Things the browser provides that the app also needs inside the "Mój dzień" dashboard, where they work differently:
// a yes/no question, saving a file and starting over after an import. The embedded build (vite.embed.config.ts)
// swaps this file for embed/platform.ts.

/** Yes/no question before a change that replaces data. */
export async function ask(message: string): Promise<boolean> { return confirm(message); }

/** Reload after an import or a full restore, so every part of the app reads the new data. */
export function reloadApp() { location.reload(); }

/** Offer a generated file (backup) to the user: the share sheet on phones, a download elsewhere. */
export async function saveFile(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
