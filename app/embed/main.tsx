// Entry of the embedded build (vite.embed.config.ts): the whole app inside the "Mój dzień" dashboard on claude.ai.
// The dashboard calls PortfolioEmbed.mount(container, {data, saved, onSave}) after it has read the price sheet and
// the saved app data; the app runs in a shadow root so its styles and the dashboard's never mix.
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/App';
import css from '../src/styles.css?inline';
import fontCss from '@fontsource/share-tech-mono/400.css?inline';
import { migrate } from '../src/lib/storage';
import { applyTheme, initialTheme, setThemeHost } from './theme';
import { installFetch, setData, type EmbedData } from './shim';

const scoped = css
  .replace(/:root\[data-theme=['"]?(\w+)['"]?\]/g, ":host([data-theme='$1'])")
  .replace(/:root/g, ':host')
  .replace(/(^|\})\s*html,\s*body\s*\{/g, '$1 :host {')
  .replace(/(^|\})\s*(html|body)\s*\{/g, '$1 .pp-body {')
  .replace(/#root\b/g, '.pp-root');

interface MountOptions {
  data: EmbedData;
  saved: Record<string, string>;                          // 'pp.*' key → stored string
  onSave: (key: string, value: string | null) => void;    // called when the app writes or removes a 'pp.*' key
}

let root: Root | null = null, fetchInstalled = false, storageHooked = false;
let notify: MountOptions['onSave'] = () => {};

function hookStorage() {
  if (storageHooked) return;
  storageHooked = true;
  let ls: Storage | null = null;
  try { ls = window.localStorage; ls.setItem('pp.__probe', '1'); ls.removeItem('pp.__probe'); } catch { ls = null; }
  if (!ls) {   // storage blocked (private mode, preview): keep the app's data in memory for this visit
    const mem = new Map<string, string>();
    const fake = {
      get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null,
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear()
    };
    Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
    ls = window.localStorage;
  }
  const proto = Object.getPrototypeOf(ls) as Storage;
  const target: any = proto === Storage.prototype ? Storage.prototype : ls;
  const set = target.setItem, remove = target.removeItem;
  target.setItem = function (this: Storage, k: string, v: string) { set.call(this, k, v); if (k.startsWith('pp.') && k !== 'pp.__probe') notify(k, String(v)); };
  target.removeItem = function (this: Storage, k: string) { remove.call(this, k); if (k.startsWith('pp.') && k !== 'pp.__probe') notify(k, null); };
}

function mount(container: HTMLElement, opts: MountOptions) {
  unmount();
  setData(opts.data);
  if (!fetchInstalled) { installFetch(); fetchInstalled = true; }
  hookStorage();
  notify = () => {};
  // the saved data is the source of truth: replace whatever an earlier visit left in this browser
  for (const k of Object.keys(localStorage)) if (k.startsWith('pp.') && !(k in opts.saved)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(opts.saved)) localStorage.setItem(k, v);
  notify = opts.onSave;
  migrate();

  if (!document.getElementById('pp-embed-font')) {
    const f = document.createElement('style'); f.id = 'pp-embed-font'; f.textContent = fontCss; document.head.appendChild(f);
  }
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' });
  shadow.replaceChildren();
  const style = document.createElement('style'); style.textContent = scoped; shadow.appendChild(style);
  const body = document.createElement('div'); body.className = 'pp-body'; shadow.appendChild(body);
  const rootEl = document.createElement('div'); rootEl.className = 'pp-root'; body.appendChild(rootEl);
  setThemeHost(container);
  applyTheme(initialTheme());
  root = createRoot(rootEl);
  root.render(<StrictMode><App /></StrictMode>);
}

function unmount() { if (root) { root.unmount(); root = null; } notify = () => {}; }

(window as any).PortfolioEmbed = { mount, unmount, update: setData };
