import { IcBolt, IcBtc, IcCase, IcTrend, IcWallet } from './icons';
import { pct, tone, usd } from '../lib/format';

interface Props { value: number; strategy: number; btc: number; gains: number; sdcaValue: number; rspsValue: number; }

export function Kpis({ value, strategy, btc, gains, sdcaValue, rspsValue }: Props) {
  const vs = strategy - btc;
  const cards = [
    { v: usd(value), label: 'Portfolio value', icon: IcWallet, cls: '', title: `SDCA ${usd(sdcaValue)} · RSPS ${usd(rspsValue)}` },
    { v: pct(strategy), label: 'Strategy return', icon: IcTrend, cls: tone(strategy), title: 'Time-weighted return of SDCA + RSPS' },
    { v: pct(btc), label: 'BTC buy & hold', icon: IcBtc, cls: tone(btc), title: 'BTC price change since the first signal' },
    { v: Number.isFinite(vs) ? `${(vs * 100).toFixed(1)}% pts` : '—', label: 'Strategy vs BTC', icon: IcBolt, cls: tone(vs), title: 'Strategy return minus BTC buy & hold' },
    { v: pct(gains), label: 'Portfolio gains', icon: IcCase, cls: tone(gains), title: 'Portfolio value vs net money put in (deposits − withdrawals)' }
  ];
  return (
    <div className="kpis">
      {cards.map((c) => (
        <div className="card kpi" key={c.label} title={c.title}>
          <div><div className={`kpi-v ${c.cls}`}>{c.v}</div><div className="kpi-l">{c.label}</div></div>
          <c.icon className={`kpi-ic ${c.cls}`} />
        </div>
      ))}
    </div>
  );
}
