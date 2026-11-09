// Drive the game in headless Chrome and save screenshots to ./shots.
// Usage: node scripts/screenshots.mjs [scenario...]   (needs `npm run dev` on :5173, or URL=...)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync('shots', { recursive: true });

const scenarios = process.argv.slice(2);
const want = (s) => !scenarios.length || scenarios.includes(s);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: opts.dpr ?? 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(1200);
  return page;
}

const wait = (page, ms) => page.waitForTimeout(ms);
const hold = async (page, key, ms) => { await page.keyboard.down(key); await wait(page, ms); await page.keyboard.up(key); };
const shot = async (page, name) => { await page.screenshot({ path: `shots/${name}.png` }); console.log('shot', name); };

/** Carve a pocket at depth d (tiles) and drop the rig into it. */
async function jump(page, d, opts = {}) {
  await page.evaluate(({ d, opts }) => {
    const s = window.pf.session;
    const w = s.world;
    const x = opts.x ?? Math.floor(w.w * 0.25);
    const y = 10 + d;
    for (let yy = y - 2; yy <= y; yy++) for (let xx = x - 2; xx <= x + 2; xx++) w.set(xx, yy, 0);
    w.set(x - 3, y, 0);
    const r = s.player.rig;
    r.x = x + 0.5; r.y = y + 1 - 0.375; r.vx = 0; r.vy = 0; r.drill = null;
    r.fuel = 999; r.hull = 9999;
    Object.assign(s.player.upgrades, opts.upgrades ?? {});
    if (opts.cargo) s.player.cargo = opts.cargo;
    if (opts.cash != null) s.player.cash = opts.cash;
  }, { d, opts });
  await wait(page, 900);
}

if (want('desktop')) {
  const page = await open({ width: 1280, height: 720 });
  await shot(page, '01-title');
  await page.keyboard.press('Enter');
  await wait(page, 600);
  await shot(page, '02-surface');
  await hold(page, 'ArrowLeft', 900);
  await wait(page, 300);
  await shot(page, '03-station-left');
  await hold(page, 'ArrowLeft', 4200);
  await hold(page, 'ArrowDown', 3500);
  await shot(page, '04-dug-down');
  await hold(page, 'ArrowRight', 1500);
  await shot(page, '05-dug-right');
  for (const [d, name] of [[60, 'glacier'], [170, 'permafrost'], [280, 'bedrock'], [400, 'geothermal'], [520, 'hollow']]) {
    await jump(page, d);
    await shot(page, `06-depth-${d}-${name}`);
  }
  // panels
  await page.evaluate(() => {
    const s = window.pf.session;
    const sp = s.world.spawn();
    const r = s.player.rig;
    r.x = sp.x; r.y = sp.y - 0.375; r.vx = r.vy = 0; r.fuel = 4; r.hull = 12;
    s.player.cash = 5200;
    s.player.cargo = { tin: 3, copper: 4, gold: 2, glacite: 1 };
    s.player.seen = ['tin', 'copper', 'gold', 'glacite'];
  });
  await wait(page, 400);
  await shot(page, '07-at-shop');
  await page.keyboard.press('KeyE');
  await wait(page, 300);
  await shot(page, '08-panel-shop');
  await page.keyboard.press('Escape');
  for (const key of ['assay', 'fuel', 'repair', 'supply']) {
    await page.evaluate((key) => {
      const s = window.pf.session;
      const b = s.world.station.find((b) => b.key === key);
      window.pf.ui.openBuilding(b);
    }, key);
    await wait(page, 250);
    await shot(page, `09-panel-${key}`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { const r = window.pf.session.player.rig; r.y += 30; r.fuel = 0; });
  await wait(page, 500);
  await shot(page, '10-stalled');
}

if (want('phone')) {
  for (const [w, h, name] of [[640, 360, 'landscape'], [360, 640, 'portrait']]) {
    const page = await open({ width: w, height: h }, { touch: true, dpr: 2 });
    await shot(page, `20-phone-${name}-title`);
    await page.evaluate(() => document.querySelector('.title .btn.primary').click());
    await wait(page, 600);
    await shot(page, `21-phone-${name}-surface`);
    await jump(page, 90, { cargo: { cryolite: 3 } });
    await shot(page, `22-phone-${name}-glacier`);
    await page.evaluate(() => {
      const s = window.pf.session;
      s.player.cash = 3000;
      window.pf.ui.openBuilding(s.world.station.find((b) => b.key === 'shop'));
    });
    await wait(page, 300);
    await shot(page, `23-phone-${name}-shop`);
  }
}

await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
}
