import type { PriceBook } from '../lib/prices';
import { TOKENS, emojiOf } from '../lib/tokens';
import { addDays, daysBetween } from '../lib/utc';
import { pct, price, tone } from '../lib/format';
import { LineChart } from './LineChart';
import { Cs2Panel } from './Cs2Panel';

export const CS2 = 'CS2';

export const PRICE_DAYS = 365;

/** Daily closes of one token; the last point is the still-open candle of today (live price). */
export function PriceChart({ sym, setSym, book, today }: { sym: string; setSym: (s: string) => void; book: PriceBook; today: string }) {
  const cs2 = sym === CS2;
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
            <option value={CS2}>🎮 CS2 market (skins)</option>
          </select>
          {!cs2 && <><b>{price(last)}</b>
          <span className={tone(last / prev - 1)}>{pct(last / prev - 1, 2)} today</span></>}
        </div>
      </div>
      {cs2 ? <Cs2Panel /> : dates.length > 1
        ? <LineChart dates={dates} lines={[{ key: sym, label: `${emojiOf(sym)} ${sym} daily close (USD)`, color: 'var(--accent)', values, glow: true, area: true }]} fmtY={price} height={320} liveLast />
        : <div className="empty">Loading {sym} prices…</div>}
    </section>
  );
}
