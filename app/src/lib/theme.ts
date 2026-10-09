// Day / dark mode. Dark uses a pure black background (OLED). Applied before the first render to avoid a flash.
export type Theme = 'dark' | 'light';
const COLOR: Record<Theme, string> = { dark: '#000000', light: '#eef3ef' };

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', COLOR[t]);
}

export function initialTheme(): Theme {
  try { return JSON.parse(localStorage.getItem('pp.theme') ?? '"dark"') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}
