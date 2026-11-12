// v0.5 in headless Chrome, offline: the Comms Tower and a recorder, the gate, the Hearth fight
// (vents, a pulse, the heart), the climb out, the credits and the prestige restart. The rig is
// moved about by hand through window.pf, since the real trip down takes an evening.
// Builds first: `npm run hearthcheck`. Screenshots go to shots/hearth-*.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.CHECK_PORT ?? 8798);
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'shots';
fs.mkdirSync(OUT, { recursive: true });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'permafrost-hearth-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist-server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(dir, 'check.db'), ALLOWED_ORIGINS: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; ; i++) {
  try {
    await fetch(`${URL}health`);
    break;
  } catch {
    if (i > 50) throw new Error('the server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};

async function open(viewport, touch, tag) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.waitForTimeout(700);
  await page.evaluate(() => [...document.querySelectorAll('.title-btns .btn')].find((b) => /offline/i.test(b.textContent)).click());
  await skipScene(page);
  return page;
}
async function skipScene(page) {
  await page.waitForFunction(() => window.pf.cutscene, null, { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => window.pf.skip());
  await page.waitForFunction(() => !window.pf.cutscene, null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
}
/** Stand the rig on the ground whose top is row `groundY`, centred on x. */
const put = (page, x, groundY) => page.evaluate(([x, y]) => {
  const r = window.pf.session.player.rig;
  Object.assign(r, { x, y: y - 0.375, vx: 0, vy: 0, drill: null, grounded: true, thrusting: false });
}, [x, groundY]);
const panel = (page) => page.evaluate(() => {
  const p = document.querySelector('.panel:not(.hidden)');
  if (!p) return null;
  const card = p.querySelector('.card').getBoundingClientRect();
  return { title: p.querySelector('h2').textContent, text: p.querySelector('.body').innerText, top: card.top, bottom: card.bottom };
});
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
const SKY = 10;

try {
  const a = await open({ width: 960, height: 540 }, false, 'desktop');

  // ---- 1. The station has a Comms Tower.
  const comms = await a.evaluate(() => window.pf.session.world.station.find((b) => b.key === 'comms'));
  check(!!comms, `the station has a Comms Tower at x ${comms?.x}`);
  await put(a, comms.x + 2, SKY);
  await a.waitForTimeout(400);
  await a.screenshot({ path: `${OUT}/hearth-01-comms-tower.png` });
  await a.keyboard.press('KeyE');
  await a.waitForTimeout(200);
  let p = await panel(a);
  check(p?.title === 'Comms Tower' && /0 of 20/.test(p.text) && /Signals/.test(p.text), `the Comms Tower opens: ${p?.text.split('\n')[0]}`);
  await a.keyboard.press('Escape');

  // ---- 2. A recorder: drive into it, hear about it, read it at the tower.
  const spot = await a.evaluate(() => {
    const w = window.pf.session.world;
    const l = w.logs[0];
    w.set(l.x - 1, l.y, 0);
    w.set(l.x - 2, l.y, 0);
    return l;
  });
  await put(a, spot.x - 1.5, spot.y + 1);
  await a.waitForTimeout(300);
  await a.screenshot({ path: `${OUT}/hearth-02-recorder.png` });
  await a.keyboard.down('ArrowRight');
  await a.waitForFunction(() => window.pf.session.player.logs.length === 1, null, { timeout: 4000 }).catch(() => {});
  await a.keyboard.up('ArrowRight');
  check((await a.evaluate(() => window.pf.session.player.logs.length)) === 1, 'driving into a recorder picks up its log');
  await a.waitForTimeout(300);
  check((await toasts(a)).some((t) => /Recorder found/.test(t)), 'a toast says so');
  await a.waitForTimeout(3200);
  check((await toasts(a)).some((t) => /Assayer:/.test(t)), 'the Assayer comes on the radio about the first recorder');
  await put(a, comms.x + 2, SKY);
  await a.waitForTimeout(300);
  await a.keyboard.press('KeyE');
  await a.waitForTimeout(200);
  await a.evaluate(() => document.querySelector('.log .log-h').click());
  await a.waitForTimeout(150);
  p = await panel(a);
  check(/1 of 20/.test(p.text) && /Halvorsen Expedition, first entry/.test(p.text), 'the tower plays the log back');
  await a.screenshot({ path: `${OUT}/hearth-03-log.png` });
  await a.keyboard.press('Escape');

  // ---- 3. Down to the gate with a rig fit for it.
  await a.evaluate(() => {
    const s = window.pf.session;
    const p = s.player;
    p.upgrades = { drill: 5, hull: 5, engine: 4, tank: 6, cargo: 3, heater: 4, radiator: 6, lamp: 4 };
    p.rig.fuel = 85;
    p.rig.hull = 210;
    p.items.charge = 5;
    p.items.megacharge = 2;
    p.items.fuelcell = 5;
    p.cash = 4321;
  });
  const gate = await a.evaluate(() => ({ x: window.pf.session.world.shaftX + 5, y: 10 + 598 }));
  await put(a, gate.x, gate.y);
  await a.waitForTimeout(500);
  await a.screenshot({ path: `${OUT}/hearth-04-antechamber.png` });
  const prompt = await a.evaluate(() => document.querySelector('.prompt.show')?.textContent);
  check(/Enter/.test(prompt ?? '') && /Hearth/.test(prompt ?? ''), `the gate offers the way in (${prompt})`);
  await a.keyboard.press('KeyE');
  await a.waitForTimeout(200);
  p = await panel(a);
  check(p?.title === 'The Hearth' && /You carry 7 charges/.test(p.text), 'the gate panel says what it takes');
  await a.screenshot({ path: `${OUT}/hearth-05-gate-panel.png` });
  await a.keyboard.press('Space');
  await a.waitForFunction(() => window.pf.session.world.kind === 'hearth', null, { timeout: 3000 }).catch(() => {});
  await a.waitForTimeout(700);
  check((await a.evaluate(() => window.pf.session.world.kind)) === 'hearth', 'the rig is in the Hearth arena');
  let hud = await a.evaluate(() => document.querySelector('.hearth-hud.show')?.textContent);
  check(/Vents left: 4/.test(hud ?? ''), `the HUD shows the fight (${hud})`);
  await a.screenshot({ path: `${OUT}/hearth-06-chamber.png` });

  // ---- 4. The fight: four vents, staying off the ground for a pulse, then the heart.
  const A = { vents: [[6, 588], [24, 588], [8, 598], [22, 598]], heart: [15, 594] };
  for (const [x, d] of A.vents) {
    await put(a, x + 0.5, SKY + d);
    await a.waitForTimeout(120);
    await a.keyboard.press('Digit3');
    await a.waitForTimeout(350);
  }
  const vents = await a.evaluate(() => window.pf.session.hearth().vents);
  check(vents === 0, `four charges, four vents (${vents} left)`);
  check((await a.evaluate(() => window.pf.session.hearth().open)) === true, 'the heart is exposed');
  // Hover through the next pulse.
  await put(a, 10.5, SKY + 598);
  const hullBefore = await a.evaluate(() => window.pf.session.player.rig.hull);
  await a.keyboard.down('ArrowUp');
  const sawWarn = await a.waitForFunction(() => /Pulse!/.test(document.querySelector('.hearth-hud')?.textContent ?? ''), null, { timeout: 9000 }).then(() => true).catch(() => false);
  if (sawWarn) await a.screenshot({ path: `${OUT}/hearth-07-pulse.png` });
  await a.waitForFunction(() => window.pf.session.hearth().pulseIn > 3, null, { timeout: 9000 }).catch(() => {});
  await a.keyboard.up('ArrowUp');
  const frost = (await toasts(a)).some((t) => /Freezing pulse/.test(t));
  check(sawWarn && !frost, `the HUD warns of a pulse, and a rig in the air isn't frozen by it (hull ${Math.round(hullBefore)} -> ${Math.round(await a.evaluate(() => window.pf.session.player.rig.hull))})`);
  await put(a, A.heart[0] + 0.5, SKY + A.heart[1]);
  await a.waitForTimeout(150);
  await a.screenshot({ path: `${OUT}/hearth-08-heart.png` });
  await a.keyboard.press('Digit3');
  await a.waitForFunction(() => window.pf.session.hearth()?.phase === 'escape', null, { timeout: 3000 }).catch(() => {});
  check((await a.evaluate(() => window.pf.session.hearth()?.phase)) === 'escape', 'a charge on the heart starts the collapse');

  // ---- 5. The climb.
  await a.evaluate(() => { window.pf.session.player.rig.hull = 210; });
  await a.keyboard.down('ArrowUp');
  await a.waitForTimeout(6000);
  hud = await a.evaluate(() => document.querySelector('.hearth-hud.show')?.textContent);
  check(/Climb/.test(hud ?? ''), `the HUD says climb (${hud})`);
  await a.screenshot({ path: `${OUT}/hearth-09-escape.png` });
  const out = await a.waitForFunction(() => !document.querySelector('.credits').classList.contains('hidden'), null, { timeout: 150000 }).then(() => true).catch(() => false);
  await a.keyboard.up('ArrowUp');
  const end = await a.evaluate(() => ({ kind: window.pf.session.world.kind, wrecked: window.pf.session.player.rig.wrecked, by: window.pf.session.player.rig.wreckedBy, prestige: window.pf.session.player.prestige, cash: window.pf.session.player.cash, engine: window.pf.session.player.upgrades.engine }));
  check(out, `the rig reaches the surface and the credits roll (${JSON.stringify(end)})`);
  await a.waitForTimeout(9000);
  await a.screenshot({ path: `${OUT}/hearth-10-credits.png` });
  check(end.prestige === 1 && end.cash === 0 && end.engine === 0 && end.kind === 'main', 'the run restarts with a star: no cash, stock rig, back in the dig site');
  await a.keyboard.press('Space');
  await a.waitForTimeout(300);
  check(await a.evaluate(() => document.querySelector('.credits').classList.contains('hidden')), 'Space ends the credits');
  await skipScene(a);
  await a.waitForTimeout(400);
  check((await toasts(a)).some((t) => /Prestige/.test(t) && /5% more/.test(t)), 'a new rig is set down on the pad, and the perk is explained');
  await a.screenshot({ path: `${OUT}/hearth-11-prestige.png` });
  // The save holds it.
  await a.reload();
  await a.waitForTimeout(700);
  await a.evaluate(() => [...document.querySelectorAll('.title-btns .btn')].find((b) => /Continue/i.test(b.textContent)).click());
  await a.waitForTimeout(600);
  const saved = await a.evaluate(() => ({ prestige: window.pf.session.player.prestige, logs: window.pf.session.player.logs.length }));
  check(saved.prestige === 1 && saved.logs === 1, `the star and the recorder are in the save (${JSON.stringify(saved)})`);

  // ---- 6. Phone: the tower and the gate panel fit 640x360, and a rig lost in the Hearth comes home.
  const b = await open({ width: 640, height: 360 }, true, 'phone');
  await b.evaluate(() => {
    const s = window.pf.session;
    s.player.logs = [0, 1, 2, 3, 4, 5, 6, 7];
    window.pf.ui.openBuilding(s.world.station.find((x) => x.key === 'comms'));
    document.querySelector('.log .log-h').click();
  });
  await b.waitForTimeout(250);
  p = await panel(b);
  check(p.top >= 0 && p.bottom <= 360, `phone: the Comms Tower fits (${Math.round(p.top)}..${Math.round(p.bottom)})`);
  await b.screenshot({ path: `${OUT}/hearth-12-phone-comms.png` });
  await b.evaluate(() => window.pf.ui.closePanel());
  const g2 = await b.evaluate(() => ({ x: window.pf.session.world.shaftX + 5, y: 10 + 598 }));
  await b.evaluate(() => { window.pf.session.player.upgrades.radiator = 6; window.pf.session.player.rig.hull = 20; });
  await put(b, g2.x, g2.y);
  await b.waitForTimeout(400);
  await b.tap('.prompt.show');
  await b.waitForTimeout(250);
  p = await panel(b);
  check(p?.title === 'The Hearth' && p.top >= 0 && p.bottom <= 360 && /You carry 0 charges/.test(p.text), 'phone: the gate panel fits and warns about charges');
  await b.screenshot({ path: `${OUT}/hearth-13-phone-gate.png` });
  await b.evaluate(() => [...document.querySelectorAll('.panel .btn')].find((x) => /Go in/.test(x.textContent)).click());
  await b.waitForFunction(() => window.pf.session.world.kind === 'hearth', null, { timeout: 3000 }).catch(() => {});
  await b.waitForTimeout(600);
  await b.screenshot({ path: `${OUT}/hearth-14-phone-chamber.png` });
  // Sit on the floor until the pulse (or the ice) finishes the weak hull.
  await b.waitForFunction(() => window.pf.session.player.rig.wrecked || window.pf.cutscene, null, { timeout: 30000 }).catch(() => {});
  await b.waitForTimeout(500);
  const card = await b.evaluate(() => document.querySelector('.death.show')?.innerText);
  check(/Flash-frozen|Crushed/i.test(card ?? ''), `a rig lost in the Hearth gets its death card (${(card ?? '').split('\n')[0]})`);
  await b.screenshot({ path: `${OUT}/hearth-15-phone-death.png` });
  await b.evaluate(() => window.pf.skip());
  await b.waitForFunction(() => window.pf.session.world.kind === 'main' && !window.pf.session.player.rig.wrecked, null, { timeout: 8000 }).catch(() => {});
  await skipScene(b);
  const home = await b.evaluate(() => ({ kind: window.pf.session.world.kind, x: window.pf.session.player.rig.x, spawn: window.pf.session.world.spawn().x, wrecked: window.pf.session.player.rig.wrecked }));
  check(home.kind === 'main' && !home.wrecked && Math.abs(home.x - home.spawn) < 0.01, 'and a new one on the pad in the dig site');
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(dir, { recursive: true, force: true });
}
if (errors.length) console.log('\nPage errors:\n' + [...new Set(errors)].join('\n'));
if (fails.length || errors.length) process.exitCode = 1;
