// Embedded build: replaces src/lib/platform.ts. Inside the dashboard the page may not open browser dialogs, reloading
// would reload the whole dashboard, and files are offered through the dashboard's download prompt.
export interface PlatformHost {
  ask: (message: string) => Promise<boolean>;
  reload: () => void;
  saveFile?: (name: string, text: string) => Promise<void>;
}
let host: PlatformHost | null = null;
export function setPlatformHost(h: PlatformHost) { host = h; }

export async function ask(message: string): Promise<boolean> { return host ? host.ask(message) : false; }
export function reloadApp() { host?.reload(); }
export async function saveFile(name: string, text: string) {
  if (host?.saveFile) return host.saveFile(name, text);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
