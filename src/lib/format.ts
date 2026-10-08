export const usd = (v: number, digits = 0) =>
  Number.isFinite(v) ? (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
export const pct = (v: number, digits = 1, sign = true) =>
  Number.isFinite(v) ? `${sign && v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%` : '—';
export const num = (v: number, digits = 6) =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
export const price = (v: number) =>
  !Number.isFinite(v) ? '—' : v >= 1000 ? usd(v, 0) : v >= 1 ? usd(v, 2) : '$' + v.toPrecision(4);
export const tone = (v: number) => (v > 1e-9 ? 'pos' : v < -1e-9 ? 'neg' : '');
