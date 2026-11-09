// Bundle the server and the game rules it shares with the page into one file.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // ws optionally loads native helpers; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'warning',
});
