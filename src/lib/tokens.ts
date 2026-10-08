// Closed set of RSPS assets: names and emoji copied from the RSPS list (37 tokens + CASH).
// `hl` = Hyperliquid perp name; k-prefixed perps are quoted per 1000 tokens (`scale` converts to one token).
export interface TokenDef { sym: string; emoji: string; hl: string; scale: number; }

const t = (sym: string, emoji: string, hl = sym, scale = 1): TokenDef => ({ sym, emoji, hl, scale });

export const TOKENS: TokenDef[] = [
  t('BTC', '🟠'), t('ETH', '🔷'), t('SOL', '🟣'), t('AVAX', '🔺'), t('BNB', '🟧'),
  t('LTC', '🥈'), t('DOGE', '🐶'), t('SUI', '💧'), t('PEPE', '🐸', 'kPEPE', 1000), t('CRV', '🌈'),
  t('LINK', '🔗'), t('XRP', '💀'), t('APT', '🅰️'), t('AAVE', '👻'), t('WLD', '🌍'),
  t('TRX', '🔴'), t('SHIB', '🐕', 'kSHIB', 1000), t('UNI', '🦄'), t('DOT', '💗'), t('ADA', '🔵'),
  t('PENDLE', '⏳'), t('NEAR', '🌐'), t('ONDO', '🏦'), t('TAO', '🧠'), t('ENA', '🔹'),
  t('HYPE', '🟢'), t('FARTCOIN', '💨'), t('PAXG', '🟡'), t('PUMP', '💊'), t('XPL', '🔌'),
  t('WLFI', '🦅'), t('ASTER', '✳️'), t('ZEC', '🛡️'), t('MON', '👾'), t('AERO', '✈️'),
  t('LIT', '🔥'), t('XMR', '🕶️')
];

export const CASH = 'CASH';
export const CASH_EMOJI = '💵';
export const ALL_ASSETS = [...TOKENS.map((x) => x.sym), CASH];
export const tokenBySym = new Map(TOKENS.map((x) => [x.sym, x]));
export const emojiOf = (sym: string) => (sym === CASH ? CASH_EMOJI : tokenBySym.get(sym)?.emoji ?? '');
export const isAllowed = (sym: string) => sym === CASH || tokenBySym.has(sym);
