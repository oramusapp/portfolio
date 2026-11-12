// Embedded build: the app lives in a shadow root inside the "Mój dzień" dashboard, so its theme goes on the host
// element instead of <html> (which belongs to the dashboard and has its own data-theme).
export type Theme = 'dark' | 'light';
let host: HTMLElement | null = null;
export function setThemeHost(el: HTMLElement) { host = el; }
export function applyTheme(t: Theme) { if (host) host.dataset.theme = t; }
export function initialTheme(): Theme {
  try { return JSON.parse(localStorage.getItem('pp.theme') ?? '"dark"') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}
