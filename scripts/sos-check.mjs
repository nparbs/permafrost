// Two miners online: one digs until the tank is dry and stalls, the other gets the SOS arrow,
// and the stalled one gives up and respawns. Takes about a minute.
// Needs `npm run server` (port 8791) and `npm run dev` (or URL=...). Screenshots go to shots/sos-*.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync('shots', { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};

async function join(name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(900);
  await page.fill('.name-in', name);
  await page.evaluate(() => document.querySelector('.title .btn.primary').click());
  await page.waitForFunction(() => window.pf.session.online && window.pf.cutscene, null, { timeout: 8000 });
  await page.evaluate(() => window.pf.skip());
  await page.waitForTimeout(300);
  return page;
}

/**
 * Burn the tank dry without going anywhere dangerous: dig a few tiles down into the firn, then
 * tunnel left and right there (no caves, boulders or gas that shallow) until `done` is true in the page.
 */
async function burnDry(page, done, timeout = 200000) {
  const t0 = Date.now();
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(2200);
  await page.keyboard.up('ArrowDown');
  let side = 'ArrowLeft';
  while (Date.now() - t0 < timeout && !(await page.evaluate(done))) {
    await page.keyboard.down(side);
    for (let k = 0; k < 6 && !(await page.evaluate(done)); k++) await page.waitForTimeout(700);
    await page.keyboard.up(side);
    side = side === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }
  return page.evaluate(done);
}

const ada = await join('Ada');
const bo = await join('Bo');

// Ada flies up and drops onto the pad until the hull gives out, right next to Bo.
for (let k = 0; k < 4 && !(await ada.evaluate(() => window.pf.cutscene)); k++) {
  await ada.keyboard.down('ArrowUp');
  await ada.waitForTimeout(3200);
  await ada.keyboard.up('ArrowUp');
  await ada.waitForTimeout(2200);
}
await bo.waitForTimeout(300);
await bo.screenshot({ path: 'shots/sos-peer-wreck.png' });
const feed = await bo.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
check(/Ada lost a rig at 0 m: hard landing/.test(feed), `the other miner sees the wreck and hears about it ("${feed}")`);
await ada.waitForFunction(() => !window.pf.cutscene, null, { timeout: 15000 }).catch(() => {});
check(await ada.evaluate(() => !window.pf.session.player.rig.wrecked && window.pf.session.player.stats.deaths === 1), 'and she is back on the pad');

// Ada drives off the pad and digs until the tank runs dry.
await ada.keyboard.down('ArrowLeft');
await ada.waitForTimeout(2600);
await ada.keyboard.up('ArrowLeft');
const stalled = await burnDry(ada, () => window.pf.session.player.rig.stalled);
await ada.waitForTimeout(1500);
const a1 = await ada.evaluate(() => {
  const r = window.pf.session.player.rig;
  return { stalled: r.stalled, wrecked: r.wrecked, fuel: r.fuel, title: document.querySelector('.card h2').textContent, panel: !document.querySelector('.panel').classList.contains('hidden'), sos: window.pf.session.sosSent };
});
check(stalled && a1.stalled && !a1.wrecked, `with another miner online, an empty tank stalls the rig instead of ending it (fuel ${a1.fuel.toFixed(2)})`);
check(a1.panel && /out of fuel/i.test(a1.title) && a1.sos, 'the stalled miner gets the Out of fuel panel and the SOS goes out by itself');
await ada.screenshot({ path: 'shots/sos-stalled.png' });

const b1 = await bo.evaluate(() => {
  const a = document.querySelector('.sos-arrow');
  return { shown: a.classList.contains('show'), text: a.textContent };
});
check(b1.shown && /SOS · Ada/.test(b1.text), `the other miner gets an arrow to the stalled rig ("${b1.text}")`);
await bo.screenshot({ path: 'shots/sos-arrow.png' });

// Ada gives up.
await ada.evaluate(() => [...document.querySelectorAll('.card .btn')].find((b) => /Give up/.test(b.textContent)).click());
await ada.waitForTimeout(1200);
await ada.screenshot({ path: 'shots/sos-give-up.png' });
check(await ada.evaluate(() => window.pf.cutscene), 'giving up plays the death scene');
await ada.waitForFunction(() => !window.pf.cutscene, null, { timeout: 12000 }).catch(() => {});
await ada.waitForTimeout(500);
const a2 = await ada.evaluate(() => {
  const s = window.pf.session;
  const r = s.player.rig;
  const sp = s.world.spawn();
  return { cine: window.pf.cutscene, stalled: r.stalled, wrecked: r.wrecked, fuel: r.fuel, home: Math.abs(r.x - sp.x) < 0.05, cargo: Object.keys(s.player.cargo).length, deaths: s.player.stats.deaths };
});
check(!a2.cine && !a2.stalled && !a2.wrecked && a2.home && a2.fuel > 9.9 && a2.cargo === 0, `she is back on the pad with a full tank and no ore (fuel ${a2.fuel.toFixed(1)}, rigs lost ${a2.deaths})`);
await bo.waitForTimeout(1500);
check(await bo.evaluate(() => !document.querySelector('.sos-arrow').classList.contains('show')), "the other miner's arrow goes away");

// Alone on the ice, the same empty tank is the end of the rig.
await bo.context().close();
await ada.waitForTimeout(1500);
await ada.keyboard.down('ArrowRight');
await ada.waitForTimeout(2600);
await ada.keyboard.up('ArrowRight');
const died = await burnDry(ada, () => window.pf.cutscene);
await ada.waitForTimeout(1500);
await ada.screenshot({ path: 'shots/sos-alone-death.png' });
const a3 = await ada.evaluate(() => ({ title: document.querySelector('.death b')?.textContent, shown: document.querySelector('.death').classList.contains('show') }));
check(died && a3.shown && /out of fuel/i.test(a3.title ?? ''), 'alone online, an empty tank plays the Out of fuel death');
await ada.waitForFunction(() => !window.pf.cutscene, null, { timeout: 12000 }).catch(() => {});
const a4 = await ada.evaluate(() => { const r = window.pf.session.player.rig; return { wrecked: r.wrecked, fuel: r.fuel }; });
check(!a4.wrecked && a4.fuel > 9.9, 'and she respawns with a full tank');

await browser.close();
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'));
console.log(fails.length || errors.length ? `\n${fails.length} failed, ${errors.length} page errors` : '\nall good');
process.exit(fails.length || errors.length ? 1 : 0);
