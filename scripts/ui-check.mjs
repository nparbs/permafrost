// Phone panels and the map in headless Chrome: the shop scrolls with a finger at both phone
// sizes, buying keeps the scroll, the stall panel's options, and the minimap and map with two
// miners online. Needs `npm run server` plus `npm run dev` (or URL=... for a built server).
// Usage: node scripts/ui-check.mjs   (screenshots go to shots/ui-*)
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

async function open(viewport, touch, tag) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await wait(page, 900);
  return page;
}

// ---- 1. Phone shop scrolls with a finger, at both phone sizes.
for (const [w, h, name] of [[640, 360, 'landscape'], [360, 640, 'portrait']]) {
  const page = await open({ width: w, height: h }, true, name);
  await page.evaluate(() => [...document.querySelectorAll('.title-btns .btn')].find((b) => /offline/i.test(b.textContent)).click());
  await page.waitForFunction(() => window.pf.cutscene, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.pf.skip());
  await wait(page, 500);
  await page.evaluate(() => {
    const s = window.pf.session;
    s.player.cash = 5000;
    window.pf.ui.openBuilding(s.world.station.find((b) => b.key === 'shop'));
  });
  await wait(page, 300);
  const before = await page.evaluate(() => {
    const card = document.querySelector('.card').getBoundingClientRect();
    const body = document.querySelector('.card .body');
    return { top: card.top, bottom: card.bottom, sh: body.scrollHeight, ch: body.clientHeight, st: body.scrollTop };
  });
  check(before.top >= 0 && before.bottom <= h, `${name}: shop card fits the screen (${Math.round(before.top)}..${Math.round(before.bottom)} of ${h})`);
  check(before.sh > before.ch, `${name}: shop body is scrollable (${before.sh} > ${before.ch})`);
  await page.screenshot({ path: `${OUT}/ui-phone-${name}-shop-top.png` });
  // A real finger swipe up over the list. (CDP's synthesizeScrollGesture does nothing headless.)
  const cdp = await page.context().newCDPSession(page);
  for (let k = 0; k < 4; k++) {
    const x = Math.round(w / 2);
    const y0 = Math.round(h * 0.8);
    const y1 = Math.round(h * 0.25);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12 }] });
      await wait(page, 16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(page, 150);
  }
  await wait(page, 400);
  const after = await page.evaluate(() => {
    const body = document.querySelector('.card .body');
    const last = [...document.querySelectorAll('.up')].pop().getBoundingClientRect();
    const b = body.getBoundingClientRect();
    return { st: body.scrollTop, lastVisible: last.bottom <= b.bottom + 2 && last.top >= b.top - 2 };
  });
  check(after.st > 50, `${name}: a finger swipe scrolls the shop (scrollTop ${after.st})`);
  check(after.lastVisible, `${name}: the last upgrade (Headlamp) can be scrolled into view`);
  await page.screenshot({ path: `${OUT}/ui-phone-${name}-shop-bottom.png` });
  // Buying keeps the scroll position.
  const st0 = after.st;
  await page.evaluate(() => [...document.querySelectorAll('.up .btn.primary')].pop()?.click());
  await wait(page, 200);
  const st1 = await page.evaluate(() => document.querySelector('.card .body').scrollTop);
  check(Math.abs(st1 - st0) < 30, `${name}: buying an upgrade keeps the scroll (${st0} -> ${st1})`);

  // Supply store and the stalled panel with a beacon.
  await page.evaluate(() => {
    window.pf.ui.closePanel();
    const s = window.pf.session;
    window.pf.ui.openBuilding(s.world.station.find((b) => b.key === 'supply'));
  });
  await wait(page, 300);
  await page.screenshot({ path: `${OUT}/ui-phone-${name}-supply.png` });
  await page.evaluate(() => {
    window.pf.ui.closePanel();
    const s = window.pf.session;
    s.player.items.beacon = 1;
    s.player.items.fuelcell = 1;
    s.player.cargo = { copper: 3 };
    window.pf.ui.showStalled();
  });
  await wait(page, 300);
  await page.screenshot({ path: `${OUT}/ui-phone-${name}-stalled.png` });
  const hasBeacon = await page.evaluate(() => [...document.querySelectorAll('.card .btn')].some((b) => /Recall Beacon/.test(b.textContent)));
  check(hasBeacon, `${name}: the stalled panel offers the Recall Beacon`);
  await page.context().close();
}

// ---- 2. Two miners online: minimap and map.
async function online(name, paint, viewport, touch) {
  const page = await open(viewport, touch, name);
  await page.fill('.name-in', name);
  await page.click(`.paints .paint:nth-child(${paint + 1})`);
  await page.evaluate(() => document.querySelector('.title .btn.primary').click());
  await page.waitForFunction(() => window.pf.cutscene, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => window.pf.skip());
  await page.waitForFunction(() => window.pf.session.online, null, { timeout: 8000 });
  await wait(page, 500);
  return page;
}
const hold = async (page, key, ms) => { await page.keyboard.down(key); await wait(page, ms); await page.keyboard.up(key); };

const ada = await online('Ada', 1, { width: 960, height: 540 }, false);
const alone = await ada.evaluate(() => !document.querySelector('.minimap').classList.contains('hidden'));
check(!alone, 'no minimap while alone');
const bo = await online('Bo', 2, { width: 640, height: 360 }, true);
// Bo drives off the station and digs down a way. (Focus matters: a window that loses focus
// releases its keys, so bring Bo's to the front first.)
await bo.bringToFront();
await hold(bo, 'ArrowRight', 4200); // past the station pads, which can't be dug
await hold(bo, 'ArrowDown', 7000);
await wait(ada, 1500);
const mm = await ada.evaluate(() => ({
  shown: !document.querySelector('.minimap').classList.contains('hidden'),
  dots: window.pf.session.mapPeers().map((p) => `${p.name}@${p.x.toFixed(1)},${p.y.toFixed(1)}`),
}));
check(mm.shown, 'minimap shows with two miners online');
check(mm.dots.length === 1 && mm.dots[0].startsWith('Bo@'), `Ada's map knows where Bo is: ${mm.dots}`);
check(mm.dots.length === 1 && Number(mm.dots[0].split(',')[1]) > 14, 'Bo dug down below the surface');
await ada.screenshot({ path: `${OUT}/ui-mp-ada-minimap.png` });
await bo.screenshot({ path: `${OUT}/ui-mp-bo-phone-minimap.png` });
await ada.bringToFront();
await ada.keyboard.press('KeyN');
await wait(ada, 500);
const mapOpen = await ada.evaluate(() => document.querySelector('.card h2').textContent);
check(mapOpen === 'Map', `N opens the map (${mapOpen})`);
await ada.screenshot({ path: `${OUT}/ui-mp-ada-map.png` });
await ada.keyboard.press('KeyN');
await wait(ada, 200);
check(await ada.evaluate(() => !window.pf.ui.panelOpen), 'N closes the map again');
// Bo taps the minimap on the phone.
await bo.evaluate(() => document.querySelector('.minimap').click());
await wait(bo, 500);
await bo.screenshot({ path: `${OUT}/ui-mp-bo-phone-map.png` });
check(await bo.evaluate(() => document.querySelector('.card h2').textContent === 'Map'), 'tapping the minimap opens the map on a phone');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
console.log(fails.length ? `${fails.length} FAILED` : 'all checks passed');
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
