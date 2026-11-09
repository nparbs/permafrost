import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './ui/style.css';
import Phaser from 'phaser';
import { Sfx } from './game/audio';
import { GameScene, type SceneData } from './game/GameScene';
import { clearSave, hasSave, loadSession, saveSession } from './game/save';
import { Session } from './game/session';
import { ITEMS, ITEM_ORDER } from './sim/items';
import { statsOf } from './sim/player';
import { rigDepth, type Input, type SimEvent } from './sim/rig';
import { MINERALS, tileDef } from './sim/tiles';
import { UI, money } from './ui/ui';

const sfx = new Sfx();
let session = loadSession() ?? Session.fresh();
const ui = new UI(sfx, {
  save: () => saveSession(session),
  newGame: () => newGame(),
  start: () => start(),
});

let lastSave = 0;
let lastAlarm = 0;
let lastFull = 0;
let wasCold = false;
let wasHot = false;

function onFrame(scene: GameScene): void {
  const r = session.player.rig;
  ui.frame(scene.rigScreen());
  const tile = r.drill ? session.world.get(r.drill.tx, r.drill.ty) : 0;
  sfx.drill(!!r.drill && !session.paused, tileDef(tile).hardness);
  sfx.thrust(r.thrusting && !session.paused);
  if (session.paused) return;

  const now = performance.now();
  const st = statsOf(session.player);
  if (rigDepth(r) > 0.5 && r.fuel / st.tank < 0.15 && r.fuel > 0 && now - lastAlarm > 2500) {
    lastAlarm = now;
    sfx.alarm();
  }
  if (r.cold && !wasCold) ui.toast(`Too cold for your heater (${st.minTemp}°C). The engine is burning extra fuel.`, 'warn', 3200);
  if (r.hot && !wasHot) ui.toast(`Overheating! Your radiator is rated to ${st.maxTemp}°C. The hull is taking damage.`, 'bad', 3200);
  wasCold = r.cold;
  wasHot = r.hot;
  if (now - lastSave > 10000) {
    lastSave = now;
    saveSession(session);
  }
}

function onEvent(e: SimEvent): void {
  switch (e.t) {
    case 'pickup': {
      const m = MINERALS[e.mineral];
      sfx.pickup(e.mineral / (MINERALS.length - 1));
      if (m.value >= 500) ui.toast(`<b style="color:${m.light}">${m.name}</b> · ${money(m.value)}`, 'good');
      break;
    }
    case 'cargo-full':
      if (performance.now() - lastFull > 1500) {
        lastFull = performance.now();
        ui.toast(`Cargo bay full. That ${MINERALS[e.mineral].name} is lost.`, 'warn');
        sfx.error();
      }
      break;
    case 'dug':
      sfx.dug();
      break;
    case 'hurt':
      if (e.cause === 'gas') ui.toast(`Gas pocket! −${Math.ceil(e.amount)} hull`, 'bad');
      else if (e.amount >= 1) ui.toast(`Hard landing: −${Math.ceil(e.amount)} hull`, 'bad');
      sfx.thud(Math.min(1, e.amount / 20));
      break;
    case 'land':
      if (e.speed > 7) sfx.thud(0.15);
      break;
    case 'blast':
      sfx.boom();
      break;
    case 'item':
      sfx.buy();
      ui.toast(`Used ${ITEMS[e.item].name}`, '', 1400);
      break;
    case 'stalled':
      sfx.error();
      ui.showStalled();
      break;
    case 'wrecked':
      sfx.boom();
      setTimeout(() => ui.showWrecked(), 900);
      break;
    default:
      break;
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#04060f',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { keyboard: false, mouse: false, touch: false },
  banner: false,
});
game.scene.add('Game', GameScene, true, { session, onFrame } satisfies SceneData);
session.on(onEvent);
ui.bind(session);
ui.showTitle(hasSave());

function start(): void {
  sfx.unlock();
  ui.hideTitle();
  session.paused = false;
  const r = session.player.rig;
  if (r.wrecked) ui.showWrecked();
  else if (r.stalled) ui.showStalled();
}

function newGame(): void {
  clearSave();
  session = Session.fresh();
  session.on(onEvent);
  ui.bind(session);
  const scene = game.scene.getScene('Game') as GameScene;
  scene.scene.restart({ session, onFrame } satisfies SceneData);
  saveSession(session);
  start();
}

const KEYS: Record<string, keyof Input> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  Space: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
};

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.code === 'KeyM' && !e.repeat) {
    sfx.setMuted(!sfx.muted);
    ui.toast(sfx.muted ? 'Sound off' : 'Sound on', '', 1000);
    return;
  }
  if (ui.handleKey(e)) return;
  const k = KEYS[e.code];
  if (k) {
    session.input[k] = true;
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyE' || e.code === 'Enter') ui.interact();
  const digit = /^Digit([1-5])$/.exec(e.code);
  if (digit) ui.useItem(ITEM_ORDER[Number(digit[1]) - 1]);
});
window.addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (k) session.input[k] = false;
});
window.addEventListener('blur', () => session.releaseInput());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveSession(session);
});
window.addEventListener('pagehide', () => saveSession(session));

// Handles for headless checks in scripts/.
(window as unknown as Record<string, unknown>).pf = {
  game,
  ui,
  get session() {
    return session;
  },
};
