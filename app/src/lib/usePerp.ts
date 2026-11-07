import { useEffect, useRef, useState } from 'react';
import type { PerpData } from './engine';
import { fetchFunding, fetchHighs, fetchMaintenance } from './prices';

const REFRESH_MS = 10 * 60_000;   // funding is paid hourly; highs of the open day change

/** Hyperliquid perp data for the coins that are or were short: daily highs, funding per day, maintenance margin. */
export function usePerp(syms: string[], from: string): PerpData {
  const [data, setData] = useState<PerpData>({ high: {}, funding: {}, mm: {} });
  const key = [...new Set(syms)].sort().join(',');
  const mmLoaded = useRef(false);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = async () => {
      if (!mmLoaded.current) {
        try { const mm = await fetchMaintenance(); if (alive) { mmLoaded.current = true; setData((d) => ({ ...d, mm })); } } catch { /* default MM */ }
      }
      for (const sym of key.split(',')) {
        try {
          const [high, funding] = await Promise.all([fetchHighs(sym, from), fetchFunding(sym, from)]);
          if (!alive) return;
          setData((d) => ({ ...d, high: { ...d.high, [sym]: high }, funding: { ...d.funding, [sym]: funding } }));
        } catch { /* keep what we have; closes are used as highs, no funding */ }
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, [key, from]);
  return data;
}
