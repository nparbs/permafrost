// v0.4 in headless Chrome, against a throwaway server whose season lasts about a minute:
// the Assay Office's bounty and market tags, the Standings panel on desktop and phone, and a
// season rollover (new map, everyone starts over, the season summary shows once).
// Builds first: `npm run seasoncheck`. Screenshots go to shots/season-*.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.CHECK_PORT ?? 8797);
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SEASON_SECONDS = 75;
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'permafrost-season-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist-server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(dir, 'check.db'), SEASON_DAYS: String(SEASON_SECONDS / 86400), ALLOWED_ORIGINS: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
const health = async () => (await fetch(`${URL}health`)).json();
for (let i = 0; ; i++) {
  try {
    await health();
    break;
  } catch {
    if (i > 50) throw new Error('the server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
}
const startedAt = Date.now();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};

async function player(name, paint, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 640, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  // A dropped socket at the rollover is expected.
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.fill('.name-in', name);
  await page.click(`.paints .paint:nth-child(${paint + 1})`);
  await page.click('.title-btns .btn.primary');
  await page.waitForFunction(() => window.pf.session.online, null, { timeout: 8000 });
  await skipScene(page);
  return page;
}
async function skipScene(page) {
  await page.waitForFunction(() => window.pf.cutscene, null, { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => window.pf.skip());
  await page.waitForFunction(() => !window.pf.cutscene, null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
}
const hold = async (page, key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector('.panel:not(.hidden)');
  if (!p) return null;
  const card = p.querySelector('.card').getBoundingClientRect();
  return { title: p.querySelector('h2').textContent, text: p.querySelector('.body').innerText, top: card.top, bottom: card.bottom, left: card.left, right: card.right };
});

try {
  const a = await player('Ada', 1, false);
  const b = await player('Bo', 2, true);

  // ---- 1. Ada digs, so she has a depth for the board.
  await hold(a, 'ArrowLeft', 900);
  await hold(a, 'ArrowDown', 2500);
  await a.waitForTimeout(600);
  const dug = await a.evaluate(() => window.pf.session.player.stats.dug);
  check(dug >= 3, `Ada dug ${dug} tiles`);

  // ---- 2. Standings on desktop (L) and on the phone (Menu).
  await a.keyboard.press('KeyL');
  await a.waitForSelector('.board', { timeout: 4000 });
  let p = await panel(a);
  check(p.title === 'Standings' && /Season 1/.test(p.text) && /2 miners/.test(p.text), `Standings opens with L: ${p.text.split('\n')[0]}`);
  const deepest = await a.evaluate(() => [...document.querySelectorAll('.board')].find((x) => /Deepest/i.test(x.textContent)).innerText);
  check(/Ada/.test(deepest) && / m/.test(deepest), `Ada is on the depth board: ${deepest.replace(/\s+/g, ' ')}`);
  check(await a.evaluate(() => !!document.querySelector('.board tr.me')), "Ada's own row is marked");
  await a.screenshot({ path: `${OUT}/season-01-standings.png` });
  await a.evaluate(() => [...document.querySelectorAll('.tabs .btn')].find((x) => /First/.test(x.textContent)).click());
  await a.waitForTimeout(200);
  p = await panel(a);
  check(/nobody yet/.test(p.text), 'First finds lists the minerals nobody has found');
  await a.screenshot({ path: `${OUT}/season-02-firsts.png` });
  await a.keyboard.press('KeyL');
  check((await panel(a)) === null, 'L closes it again');

  await b.evaluate(() => window.pf.ui.openMenu());
  await b.evaluate(() => [...document.querySelectorAll('.panel .btn')].find((x) => x.textContent === 'Standings').click());
  await b.waitForSelector('.board', { timeout: 4000 });
  p = await panel(b);
  check(p.top >= 0 && p.bottom <= 360 && p.left >= 0 && p.right <= 640, `phone: the Standings card fits 640x360 (${Math.round(p.top)}..${Math.round(p.bottom)})`);
  await b.screenshot({ path: `${OUT}/season-03-standings-phone.png` });
  await b.evaluate(() => window.pf.ui.closePanel());

  // ---- 3. The Assay Office: bounty line, and market tags on a flooded ore.
  // (The cargo and the glut are put in on the page only, to look at the panel. The server never sees them.)
  await a.evaluate(() => {
    const s = window.pf.session;
    s.world.market = { tin: { g: 90, at: s.world.time }, copper: { g: 40, at: s.world.time - 600 } };
    s.player.seen = ['tin', 'copper', 'cobalt'];
    s.player.cargo = { tin: 6, copper: 3 };
    window.pf.ui.openBuilding(s.world.station.find((x) => x.key === 'assay'));
    document.querySelector('details.prices').open = true;
  });
  await a.waitForTimeout(200);
  p = await panel(a);
  check(/Today's bounty/.test(p.text) && /50% extra/.test(p.text), `the Assay Office shows the bounty: ${p.text.split('\n')[0]}`);
  const tags = await a.evaluate(() => ({ down: document.querySelectorAll('.tag.down').length, up: document.querySelectorAll('.tag.up').length }));
  check(tags.down >= 1 && tags.up >= 1, `falling and recovering prices are tagged (${tags.down} down, ${tags.up} up)`);
  const tin = await a.evaluate(() => [...document.querySelectorAll('table.sale tr')].find((r) => /Tin/.test(r.textContent)).innerText);
  check(/6 × \$\d+/.test(tin) && !/\$15\b/.test(tin), `flooded tin sells under list: ${tin.replace(/\s+/g, ' ')}`);
  await a.screenshot({ path: `${OUT}/season-04-assay.png` });
  await a.evaluate(() => window.pf.ui.closePanel());

  // ---- 4. The season ends. Both are flown in to a new map and shown the summary.
  const seed1 = await a.evaluate(() => window.pf.session.world.seed);
  const wait = SEASON_SECONDS * 1000 - (Date.now() - startedAt) + 20000;
  console.log(`     waiting up to ${Math.round(wait / 1000)} s for the season to end…`);
  for (const [page, name] of [[a, 'Ada'], [b, 'Bo']]) {
    await page.waitForFunction(() => window.pf.session.online && window.pf.session.season()?.n === 2, null, { timeout: wait });
    await skipScene(page);
    await page.waitForFunction(() => document.querySelector('.panel:not(.hidden) h2')?.textContent === 'Season 1 is over', null, { timeout: 6000 }).catch(() => {});
    p = await panel(page);
    check(p?.title === 'Season 1 is over', `${name} gets the season summary (${p?.title})`);
    if (name === 'Ada') check(/Your season 1: Deepest dig/.test(p?.text ?? '') && /#1/.test(p?.text ?? ''), 'it shows her depth and rank');
    else check(p && p.top >= 0 && p.bottom <= 360, 'phone: the summary fits 640x360');
    await page.screenshot({ path: `${OUT}/season-05-recap-${name.toLowerCase()}.png` });
  }
  const now = await a.evaluate(() => ({ seed: window.pf.session.world.seed, dug: window.pf.session.player.stats.dug, diffs: window.pf.session.world.diffs.size, cash: window.pf.session.player.cash }));
  check(now.seed !== seed1 && now.dug === 0 && now.diffs === 0, `a new map and a new rig (seed ${seed1} -> ${now.seed}, dug ${now.dug})`);
  await a.keyboard.press('Space');
  await a.waitForTimeout(200);
  check((await panel(a)) === null, 'Space starts the new season');
  await a.keyboard.press('KeyL');
  await a.waitForSelector('.board', { timeout: 4000 });
  p = await panel(a);
  check(/Season 2/.test(p.text) && (await a.evaluate(() => [...document.querySelectorAll('.tabs .btn')].some((x) => x.textContent === 'Season 1'))), 'Standings now has a Season 1 tab');
  await a.evaluate(() => [...document.querySelectorAll('.tabs .btn')].find((x) => x.textContent === 'Season 1').click());
  await a.waitForTimeout(200);
  check(/Ada/.test((await panel(a)).text), "last season's boards still show Ada");
  await a.screenshot({ path: `${OUT}/season-06-last-season.png` });
  const h = await health();
  check(h.season === 2, `/health reports season ${h.season}, ending ${h.seasonEnds}`);
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dir, { recursive: true, force: true });
}
if (errors.length) console.log('\nPage errors:\n' + [...new Set(errors)].join('\n'));
if (fails.length) console.log('\nServer log:\n' + serverLog);
if (fails.length || errors.length) process.exitCode = 1;
