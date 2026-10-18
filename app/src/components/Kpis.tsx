import { IcBolt, IcBtc, IcCase, IcEye, IcEyeOff, IcTrend, IcWallet } from './icons';
import { pct, tone, usd } from '../lib/format';

interface Props { value: number; strategy: number; btc: number; gains: number; sdcaValue: number; rspsValue: number; onOpenPortfolio: () => void; hidden: boolean; onToggleHidden: () => void; benchLabel?: string; }

export function Kpis({ value, strategy, btc, gains, sdcaValue, rspsValue, onOpenPortfolio, hidden, onToggleHidden, benchLabel = 'BTC' }: Props) {
  const vs = strategy - btc;
  const cards = [
    { v: usd(value), label: 'Portfolio value', icon: IcWallet, cls: '', title: hidden ? 'Value hidden — tap the eye to show' : `SDCA ${usd(sdcaValue)} · RSPS ${usd(rspsValue)} — tap for details`, onClick: onOpenPortfolio, privacy: true },
    { v: pct(strategy), label: 'Strategy return', icon: IcTrend, cls: tone(strategy), title: 'Time-weighted return of the strategy' },
    { v: pct(btc), label: `${benchLabel} buy & hold`, icon: benchLabel === 'BTC' ? IcBtc : IcTrend, cls: tone(btc), title: `${benchLabel} price change since the first signal` },
    { v: Number.isFinite(vs) ? `${(vs * 100).toFixed(1)}% pts` : '—', label: `Strategy vs ${benchLabel}`, icon: IcBolt, cls: tone(vs), title: `Strategy return minus ${benchLabel} buy & hold` },
    { v: pct(gains), label: 'Portfolio gains', icon: IcCase, cls: tone(gains), title: 'Portfolio value vs net money put in (deposits − withdrawals)' }
  ];
  return (
    <div className="kpis">
      {cards.map((c) => (
        <div className={`card kpi ${'onClick' in c ? 'clickable' : ''}`} key={c.label} title={c.title}
          onClick={'onClick' in c ? c.onClick : undefined} role={'onClick' in c ? 'button' : undefined}>
          <div>
            <div className={`kpi-v ${c.cls} ${'privacy' in c && hidden ? 'blurred' : ''}`} aria-hidden={'privacy' in c && hidden}>{c.v}</div>
            <div className="kpi-l">{c.label}
              {'privacy' in c && (
                <button className="eye-btn" aria-label={hidden ? 'Show portfolio value' : 'Hide portfolio value'} title={hidden ? 'Show value' : 'Hide value'}
                  onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}>{hidden ? <IcEyeOff width={17} /> : <IcEye width={17} />}</button>
              )}
            </div>
          </div>
          <c.icon className={`kpi-ic ${c.cls}`} />
        </div>
      ))}
    </div>
  );
}
