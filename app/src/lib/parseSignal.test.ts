import { describe, expect, it } from 'vitest';
import { parseSignal } from './parseSignal';

const RSPS = `⚡ Portfolio Signal Update ⚡
───── ⋆⋅☆⋅⋆ ─────
📈 RSPS Signal: 📈
• 100.0% CASH 💵

📉 Short Module: 📉
• 2.1% XRP SHORT 💀
• 1.6% ETH SHORT 🔷
• 1.3% SOL SHORT 🟣
• 1.3% HYPE SHORT 🟢
• 1.2% ZEC SHORT 🛡️
• 1.2% XMR SHORT 🕶️
• 1.0% WLD SHORT 🌍
• 1.0% ENA SHORT 🔹
• 0.8% NEAR SHORT 🌐
• 0.7% PUMP SHORT 💊
• Total short exposure: 12.0%`;

const SDCA = `⚡ SDCA Signal Update ⚡
───── ⋆⋅☆⋅⋆ ─────
📈 Today's Accumulation/Distribution Rate: 📈
• SDCA Accelerated Accumulation Threshold not passed - Default to ~1% per-day perpetually ♻️
Important:
• Strategic Dollar Cost Averaging change frequently at market extremes. Check in every day.
• Signal = Amount of your remaining cash you deploy into BTC.`;

describe('parseSignal', () => {
  it('reads the RSPS signal with its short module', () => {
    const p = parseSignal(RSPS);
    expect(p.rsps?.cashInMessage).toBe(100);
    expect(p.rsps?.rows).toHaveLength(10);
    expect(p.rsps?.rows[0]).toEqual({ sym: 'XRP', pct: 2.1, short: true });
    expect(p.rsps?.rows.every((r) => r.short)).toBe(true);
    expect(p.rsps?.rows.reduce((t, r) => t + r.pct, 0)).toBeCloseTo(12.2);   // the lines; the message rounds its total
    expect(p.rsps?.shortTotalInMessage).toBe(12);
    expect(p.sdca).toBeNull();
    expect(p.unknown).toEqual([]);
  });
  it('reads the SDCA rate', () => {
    expect(parseSignal(SDCA).sdca).toEqual({ side: 'buy', pct: 1 });
    expect(parseSignal(SDCA).rsps).toBeNull();
  });
  it('reads both messages pasted together, longs, comma decimals and unknown coins', () => {
    const p = parseSignal(`RSPS Signal:\n• 40,5% BTC\n• 20% SOL LONG\n• 39.5% CASH\n• 5% FOO\n\n${SDCA}`);
    expect(p.rsps?.rows).toEqual([{ sym: 'BTC', pct: 40.5, short: false }, { sym: 'SOL', pct: 20, short: false }]);
    expect(p.unknown).toEqual(['FOO']);
    expect(p.sdca?.pct).toBe(1);
  });
});
