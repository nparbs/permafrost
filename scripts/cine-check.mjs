// Deaths, respawns, the arrival scene and the Space key at the station, offline in headless Chrome.
// Needs `npm run dev` (or URL=...). Usage: node scripts/cine-check.mjs   (screenshots go to shots/cine-*)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};
const wait = (p, ms) => p.waitForTimeout(ms);

async function open(viewport, touch = false) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await wait(page, 900);
  return page;
}
const startOffline = (page) => page.evaluate(() => [...document.querySelectorAll('.title-btns .btn')].find((b) => /offline/i.test(b.textContent)).click());
const state = (page) => page.evaluate(() => {
  const s = window.pf.session;
  const r = s.player.rig;
  const sp = s.world.spawn();
  return {
    cine: window.pf.cutscene, wrecked: r.wrecked, fuel: r.fuel, hull: r.hull, cash: s.player.cash,
    cargo: Object.values(s.player.cargo).reduce((a, b) => a + b, 0), atSpawn: Math.abs(r.x - sp.x) < 0.01 && Math.abs(r.y - (sp.y - 0.375)) < 0.01,
    panel: !document.querySelector('.panel').classList.contains('hidden'), deaths: s.player.stats.deaths, paused: s.paused,
    cells: s.player.items.fuelcell, upgrades: { ...s.player.upgrades },
  };
});
/** Carve a pocket at depth d and put the rig in it (on the floor, or `up` tiles above it). */
const jump = (page, d, up = 0) => page.evaluate(({ d, up }) => {
  const s = window.pf.session;
  const w = s.world;
  const x = Math.floor(w.w * 0.25);
  const y = 10 + d;
  for (let yy = y - 2 - up; yy <= y; yy++) for (let xx = x - 2; xx <= x + 2; xx++) w.set(xx, yy, 0);
  const r = s.player.rig;
  r.x = x + 0.5; r.y = y + 1 - 0.375 - up; r.vx = 0; r.vy = 0; r.drill = null; r.grounded = up === 0;
}, { d, up });

// ---- 1. A new game opens with the sky crane.
const page = await open({ width: 1280, height: 720 });
await startOffline(page);
await wait(page, 700);
const starter = await page.evaluate(() => { const p = window.pf.session.player; const n = p.items.fuelcell; p.items.fuelcell = 0; return n; });
check(starter === 1, 'a new rig carries one Fuel Cell');
let st = await state(page);
check(st.cine && st.paused, 'a new game starts with the arrival scene, and the rig is out of your hands');
await page.screenshot({ path: `${OUT}/cine-arrive-1.png` });
await wait(page, 1000);
await page.screenshot({ path: `${OUT}/cine-arrive-2.png` });
await wait(page, 2200);
st = await state(page);
check(!st.cine && !st.paused && st.atSpawn, 'the arrival ends by itself with the rig on the pad');
await page.screenshot({ path: `${OUT}/cine-arrive-3.png` });

// ---- 2. Space at the station: sell, refuel, buy.
const park = (key) => page.evaluate((key) => {
  const s = window.pf.session;
  const b = s.world.station.find((b) => b.key === key);
  const r = s.player.rig;
  r.x = b.x + b.w / 2; r.vx = 0;
}, key);
await page.evaluate(() => { const p = window.pf.session.player; p.cargo = { tin: 4, copper: 2 }; p.rig.fuel = 3; });
await park('assay');
await wait(page, 200);
await page.keyboard.press('KeyE');
await wait(page, 200);
await page.screenshot({ path: `${OUT}/cine-assay.png` });
await page.keyboard.press('Space');
await wait(page, 250);
st = await state(page);
check(st.cash === 4 * 15 + 2 * 30 && st.cargo === 0 && !st.panel, `E then Space sells everything and closes the panel (cash ${st.cash})`);
await page.screenshot({ path: `${OUT}/cine-float-cash.png` });
await park('fuel');
await wait(page, 200);
await page.keyboard.press('KeyE');
await wait(page, 150);
await page.keyboard.press('Space');
await wait(page, 250);
st = await state(page);
check(st.fuel === 10 && !st.panel && st.cash === 120 - 14, `E then Space fills the tank and closes the panel (fuel ${st.fuel}, cash ${st.cash})`);
await page.screenshot({ path: `${OUT}/cine-float-fuel.png` });
// Holding Space after the panel shuts must not fire the thruster.
await page.keyboard.down('Space');
await wait(page, 100);
const up = await page.evaluate(() => window.pf.session.input.up);
await page.keyboard.up('Space');
check(up === true, 'Space still thrusts when no panel is open');
await page.evaluate(() => { window.pf.session.player.cash = 400; });
await park('shop');
await wait(page, 200);
await page.keyboard.press('KeyE');
await wait(page, 200);
await page.screenshot({ path: `${OUT}/cine-shop.png` });
await page.keyboard.press('ArrowRight');
await wait(page, 100);
await page.keyboard.press('Space');
await wait(page, 250);
st = await state(page);
check(st.upgrades.hull === 1 && st.panel, `arrow then Space buys the highlighted upgrade, and the shop stays open while more is affordable (cash ${st.cash})`);
await page.keyboard.press('Space');
await wait(page, 250);
st = await state(page);
check(st.upgrades.drill === 1 && !st.panel, `the shop closes once nothing else is affordable (cash ${st.cash})`);
await page.screenshot({ path: `${OUT}/cine-float-gear.png` });

// ---- 3. Every way to go.
for (const [cause, up] of [['fuel', 0], ['fuel', 6], ['fall', 0], ['gas', 0], ['magma', 0], ['rock', 0], ['steam', 0]]) {
  const tag = `${cause}${up ? '-air' : ''}`;
  await jump(page, 60, up);
  await page.evaluate(() => { const p = window.pf.session.player; p.cargo = { copper: 3 }; p.cash = 500; });
  await wait(page, 500);
  if (cause === 'fuel') await page.evaluate(() => { window.pf.session.player.rig.fuel = 0; });
  else await page.evaluate((cause) => { const r = window.pf.session.player.rig; r.hull = 0; r.wrecked = true; r.wreckedBy = cause; }, cause);
  await wait(page, 500);
  st = await state(page);
  check(st.cine && st.wrecked, `${tag}: the death scene starts`);
  await page.screenshot({ path: `${OUT}/cine-death-${tag}-1.png` });
  await wait(page, 1500);
  await page.screenshot({ path: `${OUT}/cine-death-${tag}-2.png` });
  await wait(page, 6200);
  st = await state(page);
  check(!st.cine && !st.wrecked && st.atSpawn && st.cargo === 0 && st.cash === 500 && st.fuel === 10 && st.hull === 45,
    `${tag}: back on the pad with a full tank and hull, ore gone, cash kept (fuel ${st.fuel}, hull ${st.hull}, cash ${st.cash}, cargo ${st.cargo})`);
}
st = await state(page);
check(st.deaths === 7, `rigs lost are counted (${st.deaths})`);

// ---- 4. A Fuel Cell cuts in by itself, and a cutscene can be skipped.
await jump(page, 60);
await page.evaluate(() => { const p = window.pf.session.player; p.items.fuelcell = 1; p.rig.fuel = 0; });
await wait(page, 400);
st = await state(page);
check(!st.wrecked && !st.cine && st.cells === 0 && st.fuel > 4, `an empty tank burns the Fuel Cell instead of ending the rig (fuel ${st.fuel.toFixed(1)})`);
await page.screenshot({ path: `${OUT}/cine-reserve.png` });
await page.evaluate(() => { window.pf.session.player.rig.fuel = 0; });
await wait(page, 900);
await page.keyboard.press('Space');
await wait(page, 700);
await page.keyboard.press('Space');
await wait(page, 300);
st = await state(page);
check(!st.cine && st.atSpawn, 'Space skips the death scene and then the arrival');

// ---- 5. The fuel gauge marks the flight home.
await jump(page, 80);
await wait(page, 400);
const mark = await page.evaluate(() => { const u = document.querySelector('.g-fuel u'); return { shown: getComputedStyle(u).display !== 'none', left: u.style.left }; });
check(mark.shown && parseFloat(mark.left) > 5, `the fuel gauge marks the fuel for the flight home (${mark.left})`);
await page.screenshot({ path: `${OUT}/cine-home-mark.png` });

// ---- 6. Phone sizes: the death card fits.
for (const [w, h, name] of [[640, 360, 'landscape'], [360, 640, 'portrait']]) {
  const ph = await open({ width: w, height: h }, true);
  await startOffline(ph);
  await wait(ph, 600);
  await ph.screenshot({ path: `${OUT}/cine-phone-${name}-arrive.png` });
  await ph.evaluate(() => window.pf.skip());
  await wait(ph, 200);
  await jump(ph, 60);
  await ph.evaluate(() => { const p = window.pf.session.player; p.cargo = { copper: 3 }; p.items.fuelcell = 0; p.rig.fuel = 0; });
  await wait(ph, 1800);
  const box = await ph.evaluate(() => { const b = document.querySelector('.death').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; });
  check(box.top >= 0 && box.bottom < h * 0.5 && box.left >= 0 && box.right <= w, `${name}: the death card fits above the rig (${Math.round(box.top)}..${Math.round(box.bottom)} of ${h})`);
  await ph.screenshot({ path: `${OUT}/cine-phone-${name}-death.png` });
  await ph.context().close();
}

await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'));
console.log(fails.length || errors.length ? `\n${fails.length} failed, ${errors.length} page errors` : '\nall good');
process.exit(fails.length || errors.length ? 1 : 0);
