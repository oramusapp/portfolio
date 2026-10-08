import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_MS = 60 * 60 * 1000;

/** Shows when a new version has been downloaded. Updating swaps the code only; saved data is kept. */
export function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => { if (navigator.onLine) void reg.update(); };
      setInterval(check, CHECK_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    }
  });
  if (!needRefresh) return null;
  return (
    <div className="update-banner">
      <div><b>New version available</b><div className="dim small">Your saved data stays as it is.</div></div>
      <button className="btn gold small" onClick={() => updateServiceWorker(true)}>Update</button>
    </div>
  );
}
