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

if (want('dig')) {
  // Tunnels of every shape, to check the rounded edges, then a dig in progress.
  const page = await open({ width: 1280, height: 720 });
  page.on('dialog', (d) => d.accept());
  await page.getByText(/offline game|Play offline/).click();
  await wait(page, 500);
  for (const [d, name] of [[3, 'snow'], [70, 'glacier'], [180, 'permafrost'], [420, 'geothermal']]) {
    await page.evaluate((d) => {
      const s = window.pf.session;
      const w = s.world;
      const x = Math.floor(w.w * 0.25);
      const y = 10 + d;
      const dig = (xx, yy) => w.set(xx, yy, 0);
      for (let i = -6; i <= 6; i++) dig(x + i, y); // corridor
      for (let j = 1; j <= 5; j++) dig(x - 6, y - j); // shaft up
      for (let j = 1; j <= 4; j++) dig(x + 6, y + j); // shaft down
      dig(x + 7, y + 4); dig(x + 8, y + 4); // dog-leg
      dig(x - 2, y - 2); dig(x + 2, y + 2); // lone pockets
      for (let j = 1; j <= 3; j++) for (let i = 1; i <= 3; i++) dig(x + i - 1, y - j - 1); // room
      const r = s.player.rig;
      r.x = x + 0.5; r.y = y + 1 - 0.375; r.vx = 0; r.vy = 0; r.drill = null; r.fuel = 999; r.hull = 9999;
    }, d);
    await wait(page, 700);
    await shot(page, `30-dig-${name}`);
  }
  await page.keyboard.down('ArrowDown');
  await wait(page, 260);
  await shot(page, '31-drilling-down');
  await page.keyboard.up('ArrowDown');
  await wait(page, 1500);
  await page.keyboard.down('ArrowRight');
  await wait(page, 300);
  await shot(page, '32-drilling-right');
  await page.keyboard.up('ArrowRight');
}

if (want('living')) {
  // v0.3 hazards and light, set up by hand so each one is on screen.
  const page = await open({ width: 1280, height: 720 });
  page.on('dialog', (d) => d.accept());
  await page.getByText(/offline game|Play offline/).click();
  await wait(page, 400);
  const carve = (d, extra) => page.evaluate(({ d, extra }) => {
    const s = window.pf.session;
    const w = s.world;
    const x = Math.floor(w.w * 0.3);
    const y = 10 + d;
    for (let yy = y - 3; yy <= y; yy++) for (let xx = x - 4; xx <= x + 4; xx++) w.set(xx, yy, 0);
    const r = s.player.rig;
    r.x = x + 0.5; r.y = y + 1 - 0.375; r.vx = 0; r.vy = 0; r.drill = null; r.fuel = 999; r.hull = 9999;
    s.player.upgrades.radiator = 6; s.player.upgrades.heater = 3;
    s.player.items.flare = 5;
    if (extra) new Function('s', 'w', 'x', 'y', extra)(s, w, x, y);
  }, { d, extra });

  await carve(70);
  await wait(page, 700);
  await shot(page, '40-dark-glacier-stock-lamp');
  await carve(70, 's.player.upgrades.lamp = 4;');
  await wait(page, 500);
  await shot(page, '41-dark-glacier-arc-lamp');
  await carve(260, 's.player.upgrades.lamp = 0;');
  await wait(page, 700);
  await shot(page, '42-bedrock-pitch-black');
  await page.keyboard.press('Digit6');
  await wait(page, 1600);
  await shot(page, '43-bedrock-flare');

  // A boulder over a shaft: dig the tile under it and catch it falling.
  await carve(80, 's.player.upgrades.lamp = 4; w.set(x + 3, y - 4, 8); for (let k = 0; k < 4; k++) w.set(x + 3, y + 1 + k, 4); w.set(x + 3, y - 3, 3);');
  await wait(page, 400);
  await page.evaluate(() => {
    const s = window.pf.session; const w = s.world; const x = Math.floor(w.w * 0.3); const y = 10 + 80;
    w.set(x + 3, y - 3, 0);
  });
  await wait(page, 300);
  await shot(page, '44-boulder-loose');
  await wait(page, 450);
  await shot(page, '45-boulder-falling');
  await wait(page, 900);
  await shot(page, '46-boulder-landed');

  // Meltwater: a pocket above the room, dug open.
  await carve(90, 's.player.upgrades.lamp = 4; w.set(x - 2, y - 4, 15);');
  await wait(page, 300);
  await page.evaluate(() => {
    const s = window.pf.session; const w = s.world; const x = Math.floor(w.w * 0.3); const y = 10 + 90;
    w.set(x - 2, y - 4, 0);
  });
  await wait(page, 600);
  await shot(page, '47-meltwater');
  await wait(page, 9000);
  await shot(page, '48-meltwater-frozen');

  // A steam vent and magma in the Geothermal Zone.
  await carve(400, 's.player.upgrades.lamp = 2; w.set(x - 3, y + 1, 49); w.set(x + 3, y + 1, 49); w.set(x + 5, y - 1, 10); w.set(x + 5, y, 10);');
  await wait(page, 300);
  await page.evaluate(() => {
    const s = window.pf.session; const w = s.world; const x = Math.floor(w.w * 0.3); const y = 10 + 400;
    w.set(x + 4, y - 1, 6); w.set(x + 4, y - 1, 0); // open beside the magma so it pours
  });
  // Wait for a vent to blow (they run on a 6 s cycle).
  await page.waitForFunction(() => {
    const s = window.pf.session; const w = s.world; const x = Math.floor(w.w * 0.3); const y = 10 + 400;
    return [x - 3, x + 3].some((vx) => window.pf.ventActive(w, vx, y + 1));
  }, null, { timeout: 8000 });
  await wait(page, 500);
  await shot(page, '49-geothermal-vents-magma');

  // A blizzard at the station.
  await page.evaluate(() => {
    const s = window.pf.session;
    const w = s.world;
    let t = Date.now() / 1000;
    let k = 0;
    while (window.pf.blizzardAt(w.seed, t + k) < 0.95 && k < 400000) k += 30;
    window.pf.shiftClock(k);
    const sp = w.spawn();
    const r = s.player.rig;
    r.x = sp.x - 6; r.y = sp.y - 3; r.vx = 0; r.vy = 0;
  });
  await page.keyboard.down('ArrowUp');
  await wait(page, 1200);
  await page.keyboard.up('ArrowUp');
  await shot(page, '50-blizzard');
  // The Machine Shop with the new Headlamp line.
  await page.evaluate(() => {
    const s = window.pf.session;
    s.player.cash = 20000;
    window.pf.ui.openBuilding(s.world.station.find((b) => b.key === 'shop'));
  });
  await wait(page, 300);
  await shot(page, '51-shop');
}

await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
}
