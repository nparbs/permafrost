// Check the Graphics setting in headless Chrome: switch high -> low -> high from the menu
// mid-game, and make sure the scene comes back with the right art and the game carries on.
// Usage: node scripts/gfx-check.mjs   (needs `npm run dev` on :5173, or URL=...)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(1200);
await page.getByText(/offline game|Play offline/).click();
await page.waitForFunction(() => window.pf.cutscene, null, { timeout: 5000 }).catch(() => {});
await page.evaluate(() => window.pf.skip());
await page.waitForTimeout(500);

const fail = (msg) => { errors.push(msg); console.log('FAIL', msg); };
const state = () => page.evaluate(() => {
  const scene = window.pf.game.scene.getScene('Game');
  const rig = scene.children.list.find((o) => o.type === 'Sprite');
  return { rig: rig.texture.key, tiles: scene.children.list.find((o) => o.type === 'TilemapLayer').tileset[0].image.key, gfx: localStorage.getItem('permafrost.gfx'), x: window.pf.session.player.rig.x };
});
const toggle = async (label) => {
  await page.evaluate(() => window.pf.ui.openMenu());
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.evaluate(() => window.pf.ui.closePanel());
  await page.waitForTimeout(400);
};

let s = await state();
if (s.rig !== 'righd0' || s.tiles !== 'tiles-hd') fail(`default should be high: ${JSON.stringify(s)}`);
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(700);
await page.keyboard.up('ArrowLeft');
await page.waitForTimeout(600); // let it roll to a stop
const x0 = (await state()).x;

await toggle('Graphics: high');
s = await state();
if (s.rig !== 'rig0' || s.tiles !== 'tiles' || s.gfx !== 'low') fail(`low not applied: ${JSON.stringify(s)}`);
if (Math.abs(s.x - x0) > 0.01) fail(`the rig moved on a graphics switch: ${x0} -> ${s.x}`);
await page.screenshot({ path: 'shots/gfx-low.png' });

// A dig in low, to see one event still makes one burst (the scene must not listen twice).
const dug = await page.evaluate(async () => {
  const s = window.pf.session;
  let n = 0;
  s.on((e) => { if (e.t === 'dug') n++; });
  s.input.down = true;
  await new Promise((r) => setTimeout(r, 1800));
  s.input.down = false;
  return n;
});
if (dug < 1) fail('digging stopped working after the switch');

await toggle('Graphics: low');
s = await state();
if (s.rig !== 'righd0' || s.tiles !== 'tiles-hd' || s.gfx !== 'high') fail(`high not restored: ${JSON.stringify(s)}`);
await page.screenshot({ path: 'shots/gfx-high.png' });

// The setting sticks across a reload.
await toggle('Graphics: high');
await page.reload();
await page.waitForTimeout(1200);
s = await state();
if (s.rig !== 'rig0') fail(`low should stick across a reload: ${JSON.stringify(s)}`);

await browser.close();
if (errors.length) {
  console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));
  process.exitCode = 1;
} else console.log('graphics setting ok');
