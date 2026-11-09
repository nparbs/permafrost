import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './ui/style.css';
import Phaser from 'phaser';
import { Sfx } from './game/audio';
import { GameScene, type SceneData } from './game/GameScene';
import { clearSave, hasSave, loadSession, prefs, saveSession } from './game/save';
import { LocalSession, type GameSession, type SessionEvent } from './game/session';
import { connect } from './net/connect';
import { NetSession } from './net/netSession';
import { PAINT_COUNT } from './net/protocol';
import { ITEMS, ITEM_ORDER } from './sim/items';
import { statsOf } from './sim/player';
import { rigDepth, type Input } from './sim/rig';
import { MINERALS, T, tileDef } from './sim/tiles';
import { blizzardAt, ventActive } from './sim/weather';
import { UI, layerForDepth, money, whyText, type TitleInfo } from './ui/ui';

const sfx = new Sfx();
const paintPref = () => {
  const n = Number(prefs.get('paint'));
  return Number.isInteger(n) && n >= 0 && n < PAINT_COUNT ? n : 0;
};

let session: GameSession = loadSession() ?? LocalSession.fresh();
session.paint = paintPref();

const ui = new UI(sfx, {
  save: () => {
    if (session instanceof LocalSession) saveSession(session);
  },
  newOffline: () => {
    clearSave();
    const s = LocalSession.fresh();
    use(s);
    saveSession(s);
    play();
  },
  continueOffline: () => {
    const s = loadSession();
    if (!s) return;
    use(s);
    play();
  },
  goOnline: (o) => void goOnline(o),
  leave: () => {
    session.close();
    if (session instanceof LocalSession) saveSession(session);
    ui.closePanel(false);
    ui.showTitle(titleInfo());
  },
  setPaint: (i) => {
    prefs.set('paint', String(i));
    session.paint = i;
    scene()?.setPaint(i);
  },
  setName: (n) => prefs.set('name', n),
});

function titleInfo(error?: string): TitleInfo {
  return { hasSave: hasSave(), name: prefs.get('name') ?? '', paint: paintPref(), token: prefs.get('token'), error };
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
const scene = () => game.scene.getScene('Game') as GameScene | null;
game.scene.add('Game', GameScene, true, { session, onFrame } satisfies SceneData);
session.on(onEvent);
ui.bind(session);
ui.showTitle(titleInfo());

/** Switch the game over to a new session. */
function use(s: GameSession): void {
  if (s !== session) session.close();
  if (!s.online) s.paint = paintPref();
  session = s;
  s.on(onEvent);
  ui.bind(s);
  scene()?.scene.restart({ session: s, onFrame } satisfies SceneData);
}

function play(): void {
  sfx.unlock();
  ui.hideTitle();
  session.paused = false;
  const r = session.player.rig;
  if (r.wrecked) ui.showWrecked();
  else if (r.stalled) ui.showStalled();
}

async function join(o: { name?: string; paint: number; token?: string }): Promise<NetSession> {
  const token = o.token ?? prefs.get('token') ?? undefined;
  const { transport, welcome } = await connect({ token, name: o.name || undefined, paint: o.paint });
  prefs.set('token', welcome.token);
  prefs.set('name', welcome.you.name);
  prefs.set('paint', String(welcome.you.paint));
  ui.code = welcome.token;
  return new NetSession(transport, welcome);
}

async function goOnline(o: { name: string; paint: number; token?: string }): Promise<void> {
  sfx.unlock();
  ui.showConnecting();
  try {
    const s = await join(o);
    use(s);
    play();
    ui.toast(`Welcome to Rime Station, ${s.me.name}. ${s.onlineCount()} online.`, 'good', 3000);
  } catch (e) {
    ui.showTitle(titleInfo(e instanceof Error ? e.message : String(e)));
  }
}

let retrying = false;
async function reconnect(reason: string): Promise<void> {
  if (retrying) return;
  retrying = true;
  const old = session;
  for (const wait of [800, 2000, 4000]) {
    ui.toast('Reconnecting…', 'warn', wait);
    await new Promise((r) => setTimeout(r, wait));
    if (session !== old) break; // the player went somewhere else meanwhile
    try {
      const s = await join({ paint: paintPref() });
      use(s);
      play();
      ui.toast('Reconnected.', 'good');
      retrying = false;
      return;
    } catch {
      /* try again */
    }
  }
  retrying = false;
  if (session === old) ui.showDisconnected(reason, () => {
    ui.closePanel(false);
    void reconnect(reason);
  });
}

let lastSave = 0;
let lastAlarm = 0;
let lastFull = 0;
let wasCold = false;
let wasHot = false;
let wasScald = false;
let wasStorm = false;

function onFrame(): void {
  const r = session.player.rig;
  ui.frame();
  const idle = ui.titleOpen || (session.paused && !session.online);
  sfx.musicFrame(layerForDepth(rigDepth(r)), !ui.titleOpen);
  const tile = r.drill ? session.world.get(r.drill.tx, r.drill.ty) : 0;
  sfx.drill(!!r.drill && !idle, tileDef(tile).hardness);
  sfx.thrust(r.thrusting && !idle);
  if (idle) return;

  const now = performance.now();
  const st = statsOf(session.player);
  if (rigDepth(r) > 0.5 && r.fuel / st.tank < 0.15 && r.fuel > 0 && now - lastAlarm > 2500) {
    lastAlarm = now;
    sfx.alarm();
  }
  if (r.cold && !wasCold) ui.toast(`Too cold for your heater (${st.minTemp}°C). The engine is burning extra fuel.`, 'warn', 3200);
  if (r.hot && !wasHot) ui.toast(`Overheating! Your radiator is rated to ${st.maxTemp}°C. The hull is taking damage.`, 'bad', 3200);
  if (r.scald && !wasScald) ui.toast('Steam vent! It scalds the hull and shoves you upward.', 'bad', 2600);
  wasCold = r.cold;
  wasHot = r.hot;
  wasScald = r.scald;
  const w = session.world;
  const storm = blizzardAt(w.seed, w.time) > 0.05;
  if (storm && !wasStorm && rigDepth(r) < 15) {
    ui.toast('Blizzard rolling in. Colder at the surface, and flying burns more fuel.', 'warn', 4200);
    sfx.rumble();
  }
  wasStorm = storm;
  if (session instanceof LocalSession && now - lastSave > 10000) {
    lastSave = now;
    saveSession(session);
  }
}

function near(x: number, y: number, dist: number): boolean {
  const r = session.player.rig;
  return Math.abs(x + 0.5 - r.x) < dist && Math.abs(y + 0.5 - r.y) < dist;
}

/** Explain a new hazard the first time it shows up in a session. */
const hintsShown = new Map<string, number>();
function hint(key: string, text: string): void {
  const n = hintsShown.get(key) ?? 0;
  if (n >= 1) return;
  hintsShown.set(key, n + 1);
  ui.toast(text, 'warn', 4200);
}

function onEvent(e: SessionEvent): void {
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
      if (e.tile === T.RIME) sfx.crunch();
      else sfx.dug();
      break;
    case 'hurt':
      if (e.cause === 'gas') ui.toast(`Gas pocket! −${Math.ceil(e.amount)} hull`, 'bad');
      else if (e.cause === 'rock') ui.toast(`Rockfall! −${Math.ceil(e.amount)} hull`, 'bad');
      else if (e.amount >= 1) ui.toast(`Hard landing: −${Math.ceil(e.amount)} hull`, 'bad');
      sfx.thud(Math.min(1, e.amount / 20));
      break;
    case 'land':
      if (e.speed > 7) sfx.thud(0.15);
      break;
    case 'blast':
      sfx.boom();
      break;
    case 'peer-blast': {
      const r = session.player.rig;
      if (Math.hypot(e.x - r.x, e.y - r.y) < 16) sfx.boom();
      break;
    }
    case 'loose':
      if (near(e.x, e.y, 10)) sfx.creak();
      break;
    case 'fall':
      if (near(e.x, e.y, 12)) sfx.rumble();
      break;
    case 'crash':
    case 'thump':
      if (near(e.x, e.y, 12)) sfx.thud(e.t === 'crash' ? 0.6 : 0.3);
      break;
    case 'flood':
      if (near(e.x, e.y, 12)) {
        sfx.splash();
        hint('flood', 'Meltwater! It freezes into rime in a few seconds. Thrust up into rime to break through.');
      }
      break;
    case 'pour':
      if (near(e.x, e.y, 10)) {
        sfx.hiss();
        hint('pour', "Magma's pouring in. It cools to slag in half a minute, and slag can be dug.");
      }
      break;
    case 'flare':
      if (near(e.x, e.y, 14)) sfx.fizz();
      break;
    case 'item':
      if (e.item === 'flare') break;
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
    case 'refused':
      sfx.error();
      ui.toast(`The station says no: ${whyText(e.res)}`, 'warn');
      break;
    case 'chat':
      ui.addChat(e.name, e.text, e.mine);
      if (!e.mine) sfx.click();
      break;
    case 'peer-join':
      ui.toast(`${e.name} arrived at Rime Station`, '', 1800);
      break;
    case 'peer-leave':
      ui.toast(`${e.name} headed home`, '', 1800);
      break;
    case 'disconnected':
      if (!session.online || ui.titleOpen) break;
      if (/another screen|new version|code/i.test(e.reason)) {
        ui.showDisconnected(e.reason, () => {
          ui.closePanel(false);
          void reconnect(e.reason);
        });
      } else void reconnect(e.reason);
      break;
    default:
      break;
  }
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
  if (e.code === 'KeyM' && !e.repeat && !ui.titleOpen && !ui.chatOpen) {
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
  const digit = /^Digit([1-6])$/.exec(e.code);
  if (digit) ui.useItem(ITEM_ORDER[Number(digit[1]) - 1]);
});
window.addEventListener('keyup', (e) => {
  const k = KEYS[e.code];
  if (k) session.input[k] = false;
});
window.addEventListener('blur', () => session.releaseInput());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session instanceof LocalSession) saveSession(session);
});
window.addEventListener('pagehide', () => {
  if (session instanceof LocalSession) saveSession(session);
});

// Handles for headless checks in scripts/.
(window as unknown as Record<string, unknown>).pf = {
  game,
  ui,
  get session() {
    return session;
  },
  /** Shift the clock that weather and vents run on, in seconds (headless checks only). */
  shiftClock(seconds: number) {
    const real = Date.now.bind(Date);
    Date.now = () => real() + seconds * 1000;
  },
  blizzardAt,
  ventActive,
};
