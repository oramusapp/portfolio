import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The build goes to the repository root (index.html + assets/), which GitHub Pages serves from `main`.
// Relative base works under https://oramusapp.github.io/portfolio/ and locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '..', emptyOutDir: false }
});
