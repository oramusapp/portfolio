import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UpdateBanner } from './components/UpdateBanner';
import { migrate, requestPersistence } from './lib/storage';
import { applyTheme, initialTheme } from './lib/theme';
import '@fontsource/share-tech-mono';
import './styles.css';
import { MatrixRain } from './components/MatrixRain';

// No zooming: pinch (iOS gesture events, multi-touch, trackpad ctrl+wheel) and double-tap (CSS touch-action + guard below).
// iOS ignores user-scalable=no, so the gestures are blocked here as well.
const stop = (e: Event) => e.preventDefault();
document.addEventListener('gesturestart', stop, { passive: false });
document.addEventListener('gesturechange', stop, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
const interactive = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, button, a, label');
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouch < 300 && !interactive(e.target)) e.preventDefault();
  lastTouch = now;
}, { passive: false });
document.addEventListener('dblclick', (e) => { if (!interactive(e.target)) e.preventDefault(); });

migrate();
applyTheme(initialTheme());
requestPersistence();

createRoot(document.getElementById('root')!).render(<StrictMode><MatrixRain /><App /><UpdateBanner /></StrictMode>);
