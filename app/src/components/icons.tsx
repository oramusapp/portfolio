import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...p });

export const IcWallet = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7a2 2 0 0 1 2-2h11v4" /><path d="M4 7v10a2 2 0 0 0 2 2h13V9H6a2 2 0 0 1-2-2Z" /><path d="M15 14h1" /></svg>;
export const IcTrend = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>;
export const IcBtc = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M8 5h6a3 3 0 0 1 0 6H8zM8 11h7a3 3 0 0 1 0 6H8zM8 5v12M10 3v2M13 3v2M10 17v2M13 17v2" /></svg>;
export const IcBolt = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>;
export const IcCase = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M8 7v13M16 7v13" /></svg>;
export const IcPlus = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IcPen = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" /></svg>;
export const IcChevron = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>;
export const IcClose = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const IcTrash = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const IcSun = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const IcMoon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>;
