import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// In development, run `npm run server` alongside `npm run dev`; the page talks to it through /ws.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:8791', ws: true } },
  },
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' },
} as any);
