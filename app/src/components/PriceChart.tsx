import type { PriceBook } from '../lib/prices';
import { TOKENS, emojiOf } from '../lib/tokens';
import { addDays, daysBetween } from '../lib/utc';
import { pct, price, tone } from '../lib/format';
import { LineChart } from './LineChart';

export const PRICE_DAYS = 365;

/** Daily closes of one token; the last point is the still-open candle of today (live price). */
export function PriceChart({ sym, setSym, book, today }: { sym: string; setSym: (s: string) => void; book: PriceBook; today: string }) {
  const s = book[sym] ?? {};
  const dates = daysBetween(addDays(today, -PRICE_DAYS), today).filter((d) => s[d] !== undefined);
  const values = dates.map((d) => s[d]);
  const last = values.at(-1) ?? NaN, prev = values.at(-2) ?? NaN;
  return (
    <section className="card panel">
      <div className="panel-head">
        <h2>Price chart</h2>
        <div className="price-now">
          <select value={sym} onChange={(e) => setSym(e.target.value)}>
            {TOKENS.map((t) => <option key={t.sym} value={t.sym}>{t.emoji} {t.sym}</option>)}
          </select>
          <b>{price(last)}</b>
          <span className={tone(last / prev - 1)}>{pct(last / prev - 1, 2)} today</span>
        </div>
      </div>
      {dates.length > 1
        ? <LineChart dates={dates} lines={[{ key: sym, label: `${emojiOf(sym)} ${sym} daily close (USD)`, color: '#00ff41', values, glow: true, area: true }]} fmtY={price} height={320} liveLast />
        : <div className="empty">Loading {sym} prices…</div>}
    </section>
  );
}
