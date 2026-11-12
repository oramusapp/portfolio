// Nightly summary for the "Mój dzień" dashboard (run by a scheduled Claude task at 23:55 Warsaw time).
// Input: the app's saved data (the pp.* documents the dashboard keeps on the user's account), as a folder of
// ArtifactData JSON files or one JSON object {"pp.signals": "<string>", ...}. Prices come straight from Hyperliquid.
// Output (stdout, JSON): { stats, subject, text, html, png } — `stats` is the same dashboard-stats object the app's
// "Copy stats" / the dashboard's "Zaktualizuj" produce; `text` / `html` are the e-mail (Polish, amounts never shown,
// only %); `png` is the chart of SDCA and RSPS since the first signal (sent as a normal attachment; the HTML only mentions it, so mail apps show it once).
// Usage: npx tsx scripts/daily-report.ts <folder-or-file> [--now=ISO] [--png=path] [--week]
// --week: the weekly summary (last 7 days) instead of the daily one.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { benchmark, bySignalOrder, simulate, type PerpData, type Signal } from '../src/lib/engine';
import { fetchDaily, fetchFunding, fetchHighs, fetchLive, fetchMaintenance, priceOn, type PriceBook } from '../src/lib/prices';
import { CASH } from '../src/lib/tokens';
import { addDays, todayUtc } from '../src/lib/utc';
import { dashboardStats } from '../src/lib/dashboardStats';
import type { Holdings, Flow } from '../src/components/HoldingsPanel';

const PRICE_DAYS = 365;

export function readSaved(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (key: string, obj: any) => {
    if (typeof obj === 'string') { out[key] = obj; return; }
    const v = obj?.data?.v ?? obj?.v;
    if (typeof v === 'string') out[obj?.id ?? key] = v;
  };
  if (statSync(path).isDirectory()) {
    for (const f of readdirSync(path)) if (f.endsWith('.json')) take(basename(f, '.json'), JSON.parse(readFileSync(join(path, f), 'utf8')));
  } else {
    const obj = JSON.parse(readFileSync(path, 'utf8'));
    for (const [k, v] of Object.entries(obj)) take(k, v);
  }
  return out;
}

const parse = <T,>(saved: Record<string, string>, key: string, fallback: T): T => {
  try { return saved[key] != null ? (JSON.parse(saved[key]) as T) : fallback; } catch { return fallback; }
};

const usd = (v: number) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(d) + '%');

export async function dailyReport(saved: Record<string, string>, nowMs = Date.now(), opts: { week?: boolean } = {}) {
  const today = todayUtc(nowMs);
  const signals = parse<Signal[]>(saved, 'pp.signals', []);
  const holdings = parse<Holdings | null>(saved, 'pp.holdings', null);
  const flows = parse<Flow[]>(saved, 'pp.flows', []);
  const hide = true;   // the e-mail never shows amounts, only %
  const sorted = [...signals].sort(bySignalOrder);
  const first = sorted[0]?.date;
  const from = addDays(first && first < addDays(today, -PRICE_DAYS) ? first : addDays(today, -PRICE_DAYS), -3);
  const syms = [...new Set(['BTC', ...Object.keys(holdings?.rsps.units ?? {}), ...sorted.flatMap((s) => [...Object.keys(s.rsps.alloc), ...Object.keys(s.rsps.units)])])].filter((s) => s !== CASH);

  // prices: daily closes + the live price as today's value (as the app does)
  const book: PriceBook = {};
  for (const sym of syms) { try { book[sym] = await fetchDaily(sym, from); } catch { book[sym] = {}; } }
  try { const live = await fetchLive(); for (const [sym, v] of Object.entries(live)) if (book[sym]) book[sym][today] = v; } catch { /* closes only */ }

  // perp data for coins that are or were short
  const shortSyms = [...new Set(sorted.flatMap((s) => [...Object.entries(s.rsps.alloc), ...Object.entries(s.rsps.units)].filter(([k, v]) => v < 0 && k !== CASH).map(([k]) => k)))];
  const perp: PerpData = { high: {}, funding: {}, mm: {} };
  if (shortSyms.length) {
    try { perp.mm = await fetchMaintenance(); } catch { /* default */ }
    for (const sym of shortSyms) { try { perp.high[sym] = await fetchHighs(sym, from); perp.funding[sym] = await fetchFunding(sym, from); } catch { /* closes as highs */ } }
  }

  const sim = simulate(sorted, book, today, perp);
  const rows = sim?.rows ?? [];
  const last = rows.at(-1);
  const btcBh = sim ? benchmark(book, 'BTC', sim.start, rows.map((r) => r.date)).at(-1) ?? 0 : NaN;
  const hSdca = holdings ? holdings.sdca.cash + holdings.sdca.btc * priceOn(book, 'BTC', today) : 0;
  const hRsps = holdings ? holdings.rsps.cash + Object.entries(holdings.rsps.units).reduce((t, [k, u]) => t + u * priceOn(book, k, today), 0) : 0;
  const lastSigTime = signals.reduce((t, s) => Math.max(t, s.createdAt), 0);
  const invested = (last?.invested ?? 0) + flows.filter((f) => f.time > lastSigTime).reduce((t, f) => t + f.amount, 0);
  const valueNow = holdings ? hSdca + hRsps : last?.value ?? 0;
  const sdcaValue = holdings ? hSdca : last?.sdcaValue ?? 0, rspsValue = holdings ? hRsps : last?.rspsValue ?? 0;

  const stats = dashboardStats({
    now: nowMs, today, rows,
    btcDaily: rows.map((r) => { const a = priceOn(book, 'BTC', addDays(r.date, -1)), b = priceOn(book, 'BTC', r.date); return a > 0 && b > 0 ? b / a - 1 : 0; }),
    value: valueNow, sdcaValue, rspsValue, invested, btcBuyHold: btcBh, signalDates: sorted.map((s) => s.date)
  });

  // the e-mail
  const day = last && last.date === today ? last : null;
  const btcNow = priceOn(book, 'BTC', today), btcPrev = priceOn(book, 'BTC', addDays(today, -1));
  const money = (v: number) => (hide ? '•••' : usd(v));
  const dayUsd = day ? valueNow - valueNow / (1 + day.r) : NaN;
  const todays = sorted.filter((s) => s.date === today);
  const dateTxt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' }).format(new Date(nowMs));
  const DASH = 'https://claude.ai/artifact/AbZFSxu5kJMLF1PTCNm97k';
  const btcDay = btcNow > 0 && btcPrev > 0 ? btcNow / btcPrev - 1 : null;
  const vsBtcTxt = stats.vsBtc == null ? '—' : (stats.vsBtc > 0 ? '+' : '') + (stats.vsBtc * 100).toFixed(1) + ' pkt';
  const sharpeTxt = stats.risk.portfolio.sharpe == null ? '—' : stats.risk.portfolio.sharpe.toFixed(2);
  const sigTxt = todays.length ? todays.map((s) => [s.sdcaNew !== false ? 'SDCA' : '', s.rspsNew !== false ? 'RSPS' : ''].filter(Boolean).join(' + ') || 'bez zmian').join(', ') : null;
  const alerts: string[] = [];
  if (day?.fundingUsd) alerts.push(`Funding shortów dziś: ${hide ? (day.fundingUsd >= 0 ? 'otrzymany' : 'zapłacony') : (day.fundingUsd >= 0 ? '+' : '') + usd(day.fundingUsd)}`);
  for (const l of day?.liquidations ?? []) alerts.push(`Likwidacja shorta ${l.sym}: ${hide ? '' : `strata ${usd(l.loss)}, `}cena ${usd(l.price)}`);

  // plain-text version
  const lines: string[] = [];
  lines.push(`PODSUMOWANIE DNIA — ${dateTxt}`, '');
  if (!sim) lines.push('W aplikacji Portfolio nie ma jeszcze sygnałów.');
  else {
    lines.push('DZIŚ');
    lines.push(`  Portfel krypto   ${day ? pct(day.r, 2) : '—'}${hide ? '' : `  (${money(valueNow)})`}`);
    if (day) lines.push(`  SDCA             ${pct(day.rSdca, 2)}`, `  RSPS             ${pct(day.rRsps, 2)}`);
    if (btcDay != null) lines.push(`  BTC              ${pct(btcDay, 2)}  (${usd(btcNow)})`);
    lines.push('', `OD STARTU (${sim.start})`);
    lines.push(`  Strategia        ${pct(stats.strategyReturn)}`, `  SDCA             ${pct(stats.sdcaReturn)}`, `  RSPS             ${pct(stats.rspsReturn)}`);
    lines.push(`  BTC buy & hold   ${pct(stats.btcBuyHold)}`, `  Strategia vs BTC ${vsBtcTxt}`);
    lines.push('', 'RYZYKO', `  Max drawdown     ${pct(stats.risk.portfolio.maxDD)}`, `  Sharpe           ${sharpeTxt}`);
    if (alerts.length) lines.push('', 'UWAGA', ...alerts.map((a) => `  ⚠ ${a}`));
    lines.push('', sigTxt ? `Sygnały dziś: ${sigTxt}` : 'Dziś nie zapisano sygnału.');
  }
  lines.push('', `Dashboard: ${DASH}`);
  const subject = `Portfolio ${today}: ${day ? pct(day.r, 2) + ' dziś · ' : ''}strategia ${pct(stats.strategyReturn)}`;
  const text = lines.join('\n');

  // HTML version (table layout + inline styles so it renders the same in Gmail, Apple Mail and Outlook)
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) < 5e-5 ? '#1c1c1e' : v > 0 ? '#1a7f37' : '#c62828');
  const F = 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
  const tile = (label: string, v: number | null, d = 2, sub = '') => `<td width="33%" style="padding:6px" valign="top"><div style="background:#f5f5f7;border-radius:12px;padding:14px 12px;text-align:center">`
    + `<div style="font-size:12px;color:#6e6e73;text-transform:uppercase;letter-spacing:.04em">${esc(label)}</div>`
    + `<div style="font-size:24px;font-weight:700;color:${tone(v)};margin-top:4px">${pct(v, d)}</div>`
    + `<div style="font-size:12px;color:#6e6e73;margin-top:2px">${sub ? esc(sub) : '&nbsp;'}</div>` + '</div></td>';
  const row = (label: string, val: string, color = '#1c1c1e', strong = false) => `<tr><td style="padding:9px 0;border-bottom:1px solid #ececf0;color:#3a3a3c">${esc(label)}</td>`
    + `<td align="right" style="padding:9px 0;border-bottom:1px solid #ececf0;color:${color};font-weight:${strong ? 700 : 600};white-space:nowrap">${esc(val)}</td></tr>`;
  const section = (title: string, body: string) => `<div style="font-size:13px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.05em;margin:24px 0 4px">${esc(title)}</div>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px">${body}</table>`;
  if (opts.week) {
    const wFrom = addDays(today, -7);
    const wk = sim ? rows.filter((r) => r.date > wFrom) : [];
    const comp = (k: 'r' | 'rSdca' | 'rRsps') => (wk.length ? wk.reduce((t, r) => t * (1 + (Number(r[k]) || 0)), 1) - 1 : null);
    const wP = comp('r'), wS = comp('rSdca'), wR = comp('rRsps');
    const b0 = priceOn(book, 'BTC', wFrom), b1 = priceOn(book, 'BTC', today);
    const wB = b0 > 0 && b1 > 0 ? b1 / b0 - 1 : null;
    const wSig = sorted.filter((sg) => sg.date > wFrom && sg.date <= today);
    const nS = wSig.filter((sg) => sg.sdcaNew !== false).length, nR = wSig.filter((sg) => sg.rspsNew !== false).length;
    const best = wk.reduce<(typeof wk)[number] | null>((m, r) => (!m || r.r > m.r ? r : m), null);
    const worst = wk.reduce<(typeof wk)[number] | null>((m, r) => (!m || r.r < m.r ? r : m), null);
    const dshort = (d: string) => new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
    const range = `${dshort(addDays(wFrom, 1))} – ${dshort(today)}`;
    const vsB = wP != null && wB != null ? (wP - wB > 0 ? '+' : '') + ((wP - wB) * 100).toFixed(1) + ' pkt' : '—';
    const wl: string[] = [`PODSUMOWANIE TYGODNIA — ${range}`, ''];
    if (!sim) wl.push('W aplikacji Portfolio nie ma jeszcze sygnałów.');
    else {
      wl.push('TYDZIEŃ', `  Portfel krypto   ${pct(wP, 2)}`, `  SDCA             ${pct(wS, 2)}`, `  RSPS             ${pct(wR, 2)}`, `  BTC              ${pct(wB, 2)}`, `  Portfel vs BTC   ${vsB}`);
      if (best && worst) wl.push('', `Najlepszy dzień: ${dshort(best.date)} ${pct(best.r, 2)}`, `Najgorszy dzień: ${dshort(worst.date)} ${pct(worst.r, 2)}`);
      wl.push('', `Rotacje (zapisane sygnały): ${wSig.length} · SDCA ${nS} · RSPS ${nR}`);
      wl.push('', `OD STARTU (${sim.start})`, `  Strategia        ${pct(stats.strategyReturn)}`, `  BTC buy & hold   ${pct(stats.btcBuyHold)}`, `  Max drawdown     ${pct(stats.risk.portfolio.maxDD)}`);
    }
    wl.push('', `Dashboard: ${DASH}`);
    let wb = `<div style="font-size:22px;font-weight:700;color:#1c1c1e">Podsumowanie tygodnia</div><div style="font-size:14px;color:#6e6e73;margin-top:2px">${esc(range)}</div>`;
    if (!sim) wb += '<p style="font-size:15px;margin:20px 0">W aplikacji Portfolio nie ma jeszcze sygnałów.</p>';
    else {
      wb += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px -6px 0;width:calc(100% + 12px)"><tr>`
        + tile('Portfel', wP) + tile('BTC', wB, 2, b1 > 0 ? usd(b1) : '') + tile('Strategia', stats.strategyReturn, 1, `od ${sim.start}`) + '</tr></table>';
      wb += section('Tydzień', row('SDCA', pct(wS, 2), tone(wS)) + row('RSPS', pct(wR, 2), tone(wR)) + row('Portfel vs BTC', vsB, tone(wP != null && wB != null ? wP - wB : null))
        + (best && worst ? row('Najlepszy dzień · ' + dshort(best.date), pct(best.r, 2), tone(best.r)) + row('Najgorszy dzień · ' + dshort(worst.date), pct(worst.r, 2), tone(worst.r)) : ''));
      wb += section('Rotacje', row('Zapisane sygnały', String(wSig.length)) + row('SDCA', String(nS)) + row('RSPS', String(nR)));
      wb += section(`Od startu (${sim.start})`, row('Strategia', pct(stats.strategyReturn), tone(stats.strategyReturn), true) + row('BTC buy & hold', pct(stats.btcBuyHold), tone(stats.btcBuyHold)) + row('Max drawdown', pct(stats.risk.portfolio.maxDD), tone(stats.risk.portfolio.maxDD)));
      if (rows.length > 1) wb += `<div style="font-size:13px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.05em;margin:24px 0 8px">Wykres od pierwszego sygnału</div><div style="font-size:14px;color:#3a3a3c">SDCA i RSPS od pierwszego sygnału: w załączniku <b>wykres-strategii.png</b>.</div>`;
    }
    wb += `<div style="margin-top:24px;text-align:center"><a href="${DASH}" style="display:inline-block;background:#1c1c1e;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:999px">Otwórz dashboard</a></div>`;
    return {
      stats, subject: `Portfolio tydzień ${addDays(wFrom, 1)}–${today}: ${pct(wP, 2)} · strategia ${pct(stats.strategyReturn)}`, text: wl.join('\n'),
      html: `<div style="background:#ffffff;padding:8px 0"><div style="${F};color:#1c1c1e;max-width:600px;margin:0 auto;padding:0 16px">${wb}</div></div>`,
      svg: rows.length > 1 && sim ? chartSvg(sim.start, rows.map((r) => [r.date, r.sdcaGain, r.rspsGain] as [string, number, number])) : null
    };
  }
  let body = `<div style="font-size:22px;font-weight:700;color:#1c1c1e">Podsumowanie dnia</div><div style="font-size:14px;color:#6e6e73;margin-top:2px">${esc(dateTxt)}</div>`;
  if (!sim) body += '<p style="font-size:15px;margin:20px 0">W aplikacji Portfolio nie ma jeszcze sygnałów.</p>';
  else {
    body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px -6px 0;width:calc(100% + 12px)"><tr>`
      + tile('Portfel dziś', day ? day.r : null) + tile('BTC dziś', btcDay, 2, btcNow > 0 ? usd(btcNow) : '') + tile('Strategia', stats.strategyReturn, 1, `od ${sim.start}`) + '</tr></table>';
    if (alerts.length) body += `<div style="margin-top:16px;background:#fff4e5;border-left:4px solid #f59e0b;border-radius:8px;padding:12px 14px;font-size:14px;color:#7a4a00">${alerts.map((a) => '⚠ ' + esc(a)).join('<br>')}</div>`;
    if (day) body += section('Dziś', row('SDCA', pct(day.rSdca, 2), tone(day.rSdca)) + row('RSPS', pct(day.rRsps, 2), tone(day.rRsps)));
    body += section(`Od startu (${sim.start})`, row('Strategia', pct(stats.strategyReturn), tone(stats.strategyReturn), true) + row('SDCA', pct(stats.sdcaReturn), tone(stats.sdcaReturn))
      + row('RSPS', pct(stats.rspsReturn), tone(stats.rspsReturn)) + row('BTC buy & hold', pct(stats.btcBuyHold), tone(stats.btcBuyHold)) + row('Strategia vs BTC', vsBtcTxt, tone(stats.vsBtc)));
    body += section('Ryzyko', row('Max drawdown', pct(stats.risk.portfolio.maxDD), tone(stats.risk.portfolio.maxDD)) + row('Sharpe', sharpeTxt));
    body += `<div style="margin-top:18px;font-size:14px;color:#3a3a3c"><b>Sygnały dziś:</b> ${sigTxt ? esc(sigTxt) : '<span style="color:#6e6e73">brak nowego sygnału</span>'}</div>`;
  }
  if (rows.length > 1) body += `<div style="font-size:13px;font-weight:700;color:#6e6e73;text-transform:uppercase;letter-spacing:.05em;margin:24px 0 8px">Wykres od pierwszego sygnału</div><div style="font-size:14px;color:#3a3a3c">SDCA i RSPS od pierwszego sygnału: w załączniku <b>wykres-strategii.png</b>.</div>`;
  body += `<div style="margin-top:24px;text-align:center"><a href="${DASH}" style="display:inline-block;background:#1c1c1e;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:999px">Otwórz dashboard</a></div>`;
  const html = `<div style="background:#ffffff;padding:8px 0"><div style="${F};color:#1c1c1e;max-width:600px;margin:0 auto;padding:0 16px">${body}</div></div>`;
  return { stats, subject, text, html, svg: rows.length > 1 && sim ? chartSvg(sim.start, rows.map((r) => [r.date, r.sdcaGain, r.rspsGain] as [string, number, number])) : null };
}

/** SDCA and RSPS cumulative return since the first signal (0% on the day before it). Light background for e-mail. */
export function chartSvg(start: string, data: [string, number, number][]): string {
  const pts: [string, number, number][] = [[start, 0, 0], ...data];
  const W = 640, H = 300, L = 48, R = 16, T = 44, B = 30;
  let lo = 0, hi = 0;
  for (const [, a, b] of pts) { lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); }
  const span = hi - lo || 0.01; lo -= span * 0.08; hi += span * 0.08;
  const x = (i: number) => L + (W - L - R) * (i / Math.max(1, pts.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
  for (const m of [1, 2, 2.5, 5, 10]) if ((hi - lo) / (step * m) <= 5) { step *= m; break; }
  const fmtD = (d: string) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
  let g = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
    const yy = y(v).toFixed(1);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${Math.abs(v) < step / 2 ? '#c7c7cc' : '#ececf0'}" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#6e6e73">${Math.round(v * 1000) / 10}%</text>`;
  }
  for (const [i, anchor] of [[0, 'start'], [Math.floor((pts.length - 1) / 2), 'middle'], [pts.length - 1, 'end']] as [number, string][])
    g += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${anchor}" font-size="12" fill="#6e6e73">${fmtD(pts[i][0])}</text>`;
  const line = (k: 1 | 2, color: string) => `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[k]).toFixed(1)).join('')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const last = pts[pts.length - 1];
  const p1 = (v: number) => (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const legend = `<rect x="${L}" y="14" width="16" height="4" rx="2" fill="#eb6834"/><text x="${L + 22}" y="20" font-size="13" font-weight="700" fill="#1c1c1e">SDCA ${p1(last[1])}</text>`
    + `<rect x="${L + 150}" y="14" width="16" height="4" rx="2" fill="#1baf7a"/><text x="${L + 172}" y="20" font-size="13" font-weight="700" fill="#1c1c1e">RSPS ${p1(last[2])}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Roboto,sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>${g}${line(1, '#eb6834')}${line(2, '#1baf7a')}${legend}</svg>`;
}

/** Renders the chart SVG to a PNG with the pre-installed Playwright Chromium (2× for sharp text). */
export async function svgToPng(svg: string, out: string) {
  const req = createRequire(import.meta.url);
  let pw: any;
  try { pw = req('playwright'); } catch { pw = await import('playwright'); }
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 300 }, deviceScaleFactor: 2 });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: out });
  } finally { await browser.close(); }
}

if (process.argv[2]) {
  const nowArg = process.argv.find((a) => a.startsWith('--now='));
  const nowMs = nowArg ? Date.parse(nowArg.slice(6)) : Date.now();
  const pngArg = process.argv.find((a) => a.startsWith('--png='));
  dailyReport(readSaved(process.argv[2]), nowMs, { week: process.argv.includes('--week') }).then(async (r) => {
    let png: string | null = null;
    if (pngArg && r.svg) { png = pngArg.slice(6); await svgToPng(r.svg, png); }
    const { svg: _svg, ...rest } = r;
    process.stdout.write(JSON.stringify({ ...rest, png }) + '\n');
  }, (e) => { console.error(e); process.exit(1); });
}
