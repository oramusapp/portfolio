import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface Line { key: string; label: string; color: string; values: number[]; dashed?: boolean; glow?: boolean; area?: boolean; }

interface Props {
  dates: string[]; lines: Line[]; height?: number;
  markers?: number[];                           // indexes that get a dot on the first line (signal days)
  fmtY: (v: number) => string; fmtTip?: (v: number) => string;
  zeroLine?: boolean; legend?: boolean; liveLast?: boolean;
}

const PAD = { l: 58, r: 18, t: 16, b: 34 };

/** Monotone cubic (Fritsch–Carlson) path: smooth like the mock-up without overshooting the data. */
function smooth(pts: [number, number][]) {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0][0]},${pts[0][1]}` : '';
  const dx: number[] = [], m: number[] = [], t: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

function niceTicks(min: number, max: number, count = 6) {
  if (min === max) { min -= 1e-2 * (Math.abs(min) || 1); max += 1e-2 * (Math.abs(max) || 1); }
  const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let k = 0; lo + k * step <= hi + step / 2; k++) { const v = Number((lo + k * step).toPrecision(12)); ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v); }
  return ticks;
}

export function LineChart({ dates, lines, height = 420, markers = [], fmtY, fmtTip = fmtY, zeroLine, legend = true, liveLast }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const all = lines.flatMap((l) => l.values).filter(Number.isFinite);
  if (zeroLine) all.push(0);
  const ticks = niceTicks(Math.min(...all), Math.max(...all));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const iw = w - PAD.l - PAD.r, ih = height - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const xTickN = Math.max(2, Math.min(7, Math.floor(iw / 120)));
  const xTicks = n > 1 ? [...new Set(Array.from({ length: xTickN }, (_, k) => Math.round((k * (n - 1)) / (xTickN - 1))))] : [0];

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - PAD.l) / iw) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };

  let tip: ReactNode = null;
  if (hover !== null) {
    const left = Math.min(Math.max(x(hover) + 12, 0), w - 190);
    tip = (
      <div className="tip" style={{ left }}>
        <div className="tip-date">{dates[hover]}{liveLast && hover === n - 1 ? ' · live' : ''}</div>
        {lines.map((l) => <div key={l.key} className="tip-row"><i style={{ background: l.color }} />{l.label}<b>{fmtTip(l.values[hover])}</b></div>)}
      </div>
    );
  }

  return (
    <div className="chart" ref={ref}>
      {legend && (
        <div className="legend">
          {lines.map((l) => <span key={l.key}><i className={l.dashed ? 'dash' : ''} style={{ color: l.color }} />{l.label}</span>)}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.22" /><stop offset="1" stopColor="#fff" stopOpacity="0.02" /></linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={PAD.l - 10} y={y(v) + 4} className="axis" textAnchor="end">{fmtY(v)}</text>
            </g>
          ))}
          {xTicks.map((i) => (
            <g key={i}>
              <line x1={x(i)} x2={x(i)} y1={PAD.t} y2={PAD.t + ih} className="grid" />
              <text x={x(i)} y={height - 10} className="axis" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dates[i]}</text>
            </g>
          ))}
          {zeroLine && <line x1={PAD.l} x2={w - PAD.r} y1={y(0)} y2={y(0)} className="zero" />}
          {[...lines].reverse().map((l) => {
            const pts = l.values.map((v, i) => [x(i), y(Number.isFinite(v) ? v : 0)] as [number, number]);
            const d = smooth(pts);
            const base = zeroLine ? y(0) : PAD.t + ih;
            return (
              <g key={l.key}>
                {l.area && n > 1 && <path d={`${d} L${pts[n - 1][0]},${base} L${pts[0][0]},${base} Z`} fill="url(#area)" />}
                <path d={d} fill="none" stroke={l.color} strokeWidth={l.glow ? 2.6 : 1.8} strokeDasharray={l.dashed ? '7 6' : undefined} filter={l.glow ? 'url(#glow)' : undefined} />
              </g>
            );
          })}
          {lines[0] && markers.map((i) => <circle key={i} cx={x(i)} cy={y(lines[0].values[i])} r={4.5} className="marker" />)}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="cursor" />
              {lines.map((l) => <circle key={l.key} cx={x(hover)} cy={y(l.values[hover])} r={3.5} fill={l.color} />)}
            </g>
          )}
        </svg>
        {tip}
      </div>
    </div>
  );
}
