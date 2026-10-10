import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDaily, fetchLive, type PriceBook } from './prices';
import { CASH } from './tokens';
import { addDays, todayUtc } from './utc';

const REFRESH_MS = 60_000;   // daily candles (the open one included)
const LIVE_MS = 10_000;      // live prices for today

/** Daily closes for `syms` from `from` onwards; the open candle of today is refreshed every minute. */
export function usePrices(syms: string[], from: string) {
  const [book, setBook] = useState<PriceBook>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(0);
  const loaded = useRef(new Map<string, string>());   // sym → earliest day fetched

  const load = useCallback(async (sym: string, start: string) => {
    setLoading((n) => n + 1);
    try {
      const s = await fetchDaily(sym, start);
      // closed candles already loaded are kept; only the last days (the open candle and the one that just closed) are updated
      const keepBefore = addDays(todayUtc(), -2);
      setBook((b) => {
        const merged = { ...b[sym] };
        for (const [d, v] of Object.entries(s)) if (merged[d] === undefined || d >= keepBefore) merged[d] = v;
        return { ...b, [sym]: merged };
      });
      setErrors((e) => { const { [sym]: _, ...rest } = e; return rest; });
    } catch (err) {
      setErrors((e) => ({ ...e, [sym]: String((err as Error).message ?? err) }));
      if (start !== addDays(todayUtc(), -2)) loaded.current.delete(sym);
    } finally { setLoading((n) => n - 1); }
  }, []);

  const key = [...new Set(syms)].filter((s) => s !== CASH).sort().join(',');
  useEffect(() => {
    for (const sym of key ? key.split(',') : []) {
      const have = loaded.current.get(sym);
      if (have && have <= from) continue;
      loaded.current.set(sym, from);
      void load(sym, from);
    }
  }, [key, from, load]);

  useEffect(() => {
    const id = setInterval(() => {
      for (const sym of loaded.current.keys()) void load(sym, addDays(todayUtc(), -2));
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // live price = today's value for every token, so orders and holdings follow the market while the app is open
  const [liveAt, setLiveAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const live = await fetchLive();
        if (!alive) return;
        const day = todayUtc();
        setBook((b) => {
          const next = { ...b };
          for (const [sym, v] of Object.entries(live)) next[sym] = { ...next[sym], [day]: v };
          return next;
        });
        setLiveAt(Date.now());
      } catch { /* keep the last prices */ }
    };
    void tick();
    const id = setInterval(tick, LIVE_MS);
    // phones pause timers in the background: refresh at once when the app comes back or the network returns
    const wake = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      alive = false; clearInterval(id);
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); window.removeEventListener('focus', wake);
    };
  }, []);

  return { book, errors, loading: loading > 0, liveAt };
}
