// Stats for the "Mój dzień" dashboard (claude.ai artifact). That page cannot read this app's localStorage or fetch
// prices, so the app copies a small JSON summary to the clipboard and the dashboard reads it from a paste.
// Keep `app`, `kind` and `v` stable: the dashboard checks them before accepting a paste.
import { riskStats, type DayRow, type RiskStats } from './engine';

export interface StatsBlock { total: number | null; maxDD: number | null; vol: number | null; sharpe: number | null; sortino: number | null; }
export interface DashboardStats {
  app: 'skb-portfolio'; kind: 'dashboard-stats'; v: 1;
  at: string; day: string;
  value: number | null; sdcaValue: number | null; rspsValue: number | null; invested: number | null; gains: number | null;
  strategyReturn: number | null; sdcaReturn: number | null; rspsReturn: number | null; btcBuyHold: number | null; vsBtc: number | null;
  days: number; signals: number; firstSignal: string | null; lastSignal: string | null;
  risk: { portfolio: StatsBlock; sdca: StatsBlock; rsps: StatsBlock; btc: StatsBlock };
}

const n = (v: number | undefined | null): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
const block = (s: RiskStats): StatsBlock => ({ total: n(s.total), maxDD: n(s.maxDD), vol: n(s.vol), sharpe: n(s.sharpe), sortino: n(s.sortino) });

export function dashboardStats(input: {
  now: number; today: string; rows: DayRow[]; btcDaily: number[];
  value: number; sdcaValue: number; rspsValue: number; invested: number; btcBuyHold: number;
  signalDates: string[];
}): DashboardStats {
  const { rows } = input;
  const last = rows.at(-1);
  const strategy = last?.totalGain ?? NaN;
  const dates = [...input.signalDates].sort();
  return {
    app: 'skb-portfolio', kind: 'dashboard-stats', v: 1,
    at: new Date(input.now).toISOString(), day: input.today,
    value: n(input.value), sdcaValue: n(input.sdcaValue), rspsValue: n(input.rspsValue), invested: n(input.invested),
    gains: n(input.invested > 0 ? input.value / input.invested - 1 : NaN),
    strategyReturn: n(strategy), sdcaReturn: n(last?.sdcaGain), rspsReturn: n(last?.rspsGain),
    btcBuyHold: n(input.btcBuyHold), vsBtc: n(strategy - input.btcBuyHold),
    days: rows.length, signals: dates.length, firstSignal: dates[0] ?? null, lastSignal: dates.at(-1) ?? null,
    risk: {
      portfolio: block(riskStats(rows.map((r) => r.r))),
      sdca: block(riskStats(rows.map((r) => r.rSdca))),
      rsps: block(riskStats(rows.map((r) => r.rRsps))),
      btc: block(riskStats(input.btcDaily))
    }
  };
}
