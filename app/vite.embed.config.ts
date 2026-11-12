import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Embedded build for the "Mój dzień" dashboard (claude.ai artifact): one script, styles and font inlined.
// `npm run build:embed` → app/dist-embed/portfolio-embed.js. The GitHub Pages build (vite.config.ts) is unchanged.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: {
    alias: [
      { find: /^\.\/lib\/theme$/, replacement: here('./embed/theme.ts') },
      { find: /^\.\.\/lib\/theme$/, replacement: here('./embed/theme.ts') },
      { find: /^\.\/components\/MatrixRain$/, replacement: here('./embed/nothing.tsx') },
      { find: /^\.\/lib\/platform$/, replacement: here('./embed/platform.ts') },
      { find: /^\.\.\/lib\/platform$/, replacement: here('./embed/platform.ts') }
    ]
  },
  build: {
    outDir: 'dist-embed', emptyOutDir: true, assetsInlineLimit: 200_000, cssCodeSplit: false,
    lib: { entry: here('./embed/main.tsx'), formats: ['iife'], name: 'PortfolioEmbedBundle', fileName: () => 'portfolio-embed.js' }
  }
});
