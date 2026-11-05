import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// base './' — одинаково работает на GitHub Pages, в Capacitor (iOS/Android) и в Electron (file://)
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 2000 },
  server: { host: true, port: 5180, strictPort: true },
});
