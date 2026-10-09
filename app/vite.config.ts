import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The build goes to the repository root (index.html + assets/), which GitHub Pages serves from `main`.
// Relative base works under https://oramusapp.github.io/portfolio/ and locally.
// PWA: the service worker caches only the app code. A new deploy replaces the code; user data in localStorage stays.
export default defineConfig({
  base: './',
  build: { outDir: '..', emptyOutDir: false },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png', 'holdings-icon.png', 'networth-icon.png'],
      manifest: {
        name: 'Portfolio Performance',
        short_name: 'Portfolio',
        description: 'SDCA + RSPS portfolio performance',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff,woff2}'],
        globIgnores: ['app/**', '**/node_modules/**'],
        cleanupOutdatedCaches: true
      }
    })
  ]
});
