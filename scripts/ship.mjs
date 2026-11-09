// Ship to the live server in one go:
//   npm run ship                 check, push, deploy, verify
//   npm run ship -- patch        bump 0.3.0 -> 0.3.1 first (also: minor, major)
//
// Steps: clean main branch -> typecheck, tests, builds -> optional version bump commit
// -> git push -> run the locked deploy key on the VM -> wait for /health to report the new version.
//
// The VM address and key live in .deploy.local.json (git-ignored), e.g.
//   { "host": "deb@<vm address>", "key": "~/.ssh/permafrost-deploy", "url": "https://permafrost.parbs.online" }

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const bump = process.argv[2];
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const step = (msg) => console.log(`\n== ${msg}`);
const fail = (msg) => {
  console.error(`\nShip stopped: ${msg}`);
  process.exit(1);
};
const run = (cmd) => {
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
  if (r.status !== 0) fail(`"${cmd}" failed.`);
};

if (!existsSync('.deploy.local.json')) fail('no .deploy.local.json (see the top of scripts/ship.mjs).');
const cfg = JSON.parse(readFileSync('.deploy.local.json', 'utf8'));
const key = cfg.key.replace(/^~/, os.homedir());

step('Checking git');
if (sh('git rev-parse --abbrev-ref HEAD') !== 'main') fail('not on main.');
if (sh('git status --porcelain')) fail('there are uncommitted changes. Commit them first.');

step('Typecheck, tests and builds');
run('npm run typecheck');
run('npx vitest run');
run('npx vite build --logLevel warn');
run('npm run build:server');

if (bump) {
  if (!['patch', 'minor', 'major'].includes(bump)) fail(`unknown bump "${bump}" (use patch, minor or major).`);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const [a, b, c] = pkg.version.split('.').map(Number);
  pkg.version = bump === 'major' ? `${a + 1}.0.0` : bump === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  run('npm install --package-lock-only --ignore-scripts --silent');
  run(`git commit -q -am "Release v${pkg.version}"`);
  console.log(`Bumped to v${pkg.version}`);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

step('Pushing');
run('git push -q origin main');
const commit = sh('git rev-parse --short HEAD');

step(`Deploying ${commit} (v${version})`);
run(`ssh -i "${key}" -o BatchMode=yes -o ConnectTimeout=10 ${cfg.host}`);

step('Waiting for the live site');
const deadline = Date.now() + 120_000;
let last = '';
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${cfg.url}/health`, { cache: 'no-store' });
    const h = await r.json();
    last = JSON.stringify(h);
    if (h.ok && h.version === version) {
      console.log(`\nLive: ${cfg.url} is on v${version} (${commit}), ${h.online} online.`);
      process.exit(0);
    }
  } catch (e) {
    last = String(e);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
fail(`the site didn't report v${version} within 2 minutes. Last answer: ${last}`);
