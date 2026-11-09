// Two browsers on the shared world: join, see each other, dig, chat, reconnect with a code.
// Needs `npm run server` (port 8791) and `npm run dev` (or URL=...).
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

async function player(name, paint, viewport = { width: 960, height: 540 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto(URL);
  await page.waitForTimeout(800);
  await page.fill('.name-in', name);
  await page.click(`.paints .paint:nth-child(${paint + 1})`);
  await page.click('.title-btns .btn.primary');
  await page.waitForFunction(() => window.pf.session.online, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  return page;
}

const hold = async (page, key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const state = (page) => page.evaluate(() => {
  const s = window.pf.session;
  return {
    online: s.online,
    name: s.me?.name,
    peers: [...s.peers()].map((p) => p.name),
    x: s.player.rig.x,
    y: s.player.rig.y,
    dug: s.player.stats.dug,
    lag: s.lag,
    count: s.onlineCount(),
    chat: [...document.querySelectorAll('.chat-line')].map((e) => e.textContent),
  };
});

const a = await player('Ada', 1);
const b = await player('Bo', 2);
await a.waitForTimeout(800);
let sa = await state(a);
let sb = await state(b);
check(sa.online && sa.name === 'Ada', `Ada is online as ${sa.name}`);
check(sb.peers.includes('Ada') && sa.peers.includes('Bo'), `they see each other (Ada sees ${sa.peers}, Bo sees ${sb.peers})`);
check(sa.count >= 2, `online count ${sa.count}`);
await a.screenshot({ path: 'shots/mp-01-ada-station.png' });

// Ada drives off the pad and digs down; Bo should see the hole.
await hold(a, 'ArrowLeft', 900);
await hold(a, 'ArrowDown', 2500);
await a.waitForTimeout(700);
sa = await state(a);
check(sa.dug >= 3, `Ada dug ${sa.dug} tiles`);
check(sa.lag < 30, `Ada's prediction is ${sa.lag} ticks ahead of the server`);
const same = await Promise.all([a, b].map((p) => p.evaluate(() => {
  const w = window.pf.session.world;
  let h = 0;
  for (let i = 0; i < w.tiles.length; i++) h = (h * 31 + w.tiles[i]) | 0;
  return h;
})));
check(same[0] === same[1], 'both browsers have the same world');
const bSeesA = await b.evaluate(() => [...window.pf.session.peers()].find((p) => p.name === 'Ada'));
const aPos = await a.evaluate(() => ({ x: window.pf.session.player.rig.x, y: window.pf.session.player.rig.y }));
check(bSeesA && Math.hypot(bSeesA.x - aPos.x, bSeesA.y - aPos.y) < 1.5, `Bo sees Ada where she is (${bSeesA?.x?.toFixed(2)},${bSeesA?.y?.toFixed(2)} vs ${aPos.x.toFixed(2)},${aPos.y.toFixed(2)})`);

// Bo follows to look at Ada's shaft.
await hold(b, 'ArrowLeft', 900);
await b.waitForTimeout(500);
await b.screenshot({ path: 'shots/mp-02-bo-watching.png' });

// Chat
await a.keyboard.press('KeyT');
await a.keyboard.type('anyone seen glacite yet?');
await a.keyboard.press('Enter');
await b.waitForTimeout(700);
sb = await state(b);
check(sb.chat.some((l) => l.includes('glacite')), `Bo got the chat: ${JSON.stringify(sb.chat)}`);
await b.screenshot({ path: 'shots/mp-03-bo-chat.png' });

// Selling through the server: Bo parks at the assay office with fake-free cargo? No: buy fuel instead.
const code = await a.evaluate(() => window.pf.session.token);
check(/^[A-Z2-9]{16}$/.test(code), 'Ada has an account code');

// Ada moves to a new device with her code.
const a2ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const a2 = await a2ctx.newPage();
a2.on('pageerror', (e) => errors.push(`Ada phone: ${e}`));
await a2.goto(URL);
await a2.waitForTimeout(800);
await a2.click('.code-row summary');
await a2.fill('.code-form input', code.replace(/(.{4})(?=.)/g, '$1-'));
await a2.click('.code-form .btn');
await a2.waitForFunction(() => window.pf.session.online, null, { timeout: 8000 });
await a2.waitForTimeout(800);
const s2 = await state(a2);
check(s2.name === 'Ada' && s2.dug === sa.dug, `the code brings Ada back on the phone (dug ${s2.dug})`);
await a.waitForTimeout(500);
const kicked = await a.evaluate(() => document.querySelector('.panel:not(.hidden) h2')?.textContent);
check(kicked === 'Connection lost', `the old screen was told (${kicked})`);
await a2.screenshot({ path: 'shots/mp-04-ada-phone.png' });

await browser.close();
if (errors.length) console.log('\nPage errors:\n' + [...new Set(errors)].join('\n'));
if (fails.length || errors.length) process.exitCode = 1;
