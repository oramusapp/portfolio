import { useEffect, useRef } from 'react';

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789$₿ΞΣ';
const FONT = 16, FPS = 18;

/** Background "digital rain". Faint, low frame rate, paused when the app is hidden, static with reduced motion. */
export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d')!;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let drops: number[] = [], w = 0, h = 0, raf = 0, last = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drops = Array.from({ length: Math.ceil(w / FONT) }, () => Math.random() * -h / FONT);
    };
    // colours come from the theme (CSS variables), so day / dark mode switches without a reload
    let fade = 'rgba(0, 0, 0, 0.09)', glyph = '#00ff41', lead = '#c8ffd4';
    const readTheme = () => {
      const cs = getComputedStyle(document.documentElement);
      fade = cs.getPropertyValue('--rain-fade').trim() || fade;
      glyph = cs.getPropertyValue('--rain').trim() || glyph;
      lead = document.documentElement.dataset.theme === 'light' ? '#04461f' : '#c8ffd4';
    };
    readTheme();
    const themeObs = new MutationObserver(readTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const step = () => {
      ctx.fillStyle = fade; ctx.fillRect(0, 0, w, h);
      ctx.font = `${FONT}px 'Share Tech Mono', monospace`;
      drops.forEach((y, i) => {
        const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
        ctx.fillStyle = Math.random() > 0.975 ? lead : glyph;
        ctx.fillText(ch, i * FONT, y * FONT);
        drops[i] = y * FONT > h && Math.random() > 0.975 ? 0 : y + 1;
      });
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 1000 / FPS) return;
      last = t; step();
    };
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !still) raf = requestAnimationFrame(loop); };
    resize();
    if (still) for (let i = 0; i < 60; i++) step(); else raf = requestAnimationFrame(loop);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    return () => { themeObs.disconnect(); cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return <canvas ref={ref} className="matrix-rain" aria-hidden="true" />;
}
