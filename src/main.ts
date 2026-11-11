import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import './ui/style.css';
import Phaser from 'phaser';
import { Sfx } from './game/audio';
import { GameScene, type Cue, type SceneData } from './game/GameScene';
import { setQuality } from './game/gfx';
import { clearSave, hasSave, loadSession, prefs, saveSession } from './game/save';
import { LocalSession, type GameSession, type SessionEvent } from './game/session';
import { connect } from './net/connect';
import { NetSession } from './net/netSession';
import { PAINT_COUNT } from './net/protocol';
import { dayNumber } from './sim/daytime';
import { ITEMS, ITEM_ORDER } from './sim/items';
import { cargoCount, cargoValue, statsOf, type HurtCause } from './sim/player';
import { fuelToSurface, rigDepth, type Input } from './sim/rig';
import { MINERALS, T, tileDef } from './sim/tiles';
import { blizzardAt, ventActive } from './sim/weather';
import { UI, esc, layerForDepth, money, whyText, type TitleInfo } from './ui/ui';
import { METERS_PER_TILE, SKY } from './sim/world';

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
  float: (text, color) => scene()?.floatAtRig(text, color),
  giveUp: () => die('fuel'),
  setQuality: (q) => {
    setQuality(q);
    // The scene rebuilds itself with the other art. The session carries on untouched.
    scene()?.scene.restart({ session, onFrame, onCue } satisfies SceneData);
    ui.toast(q === 'high' ? 'Graphics: high' : 'Graphics: low. Lighter on phones and older computers.', '', 2200);
  },
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
game.scene.add('Game', GameScene, true, { session, onFrame, onCue } satisfies SceneData);
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
  // Any cutscene belonged to the old session.
  cine = false;
  queued = null;
  homeWarned = false;
  lastDay = 0;
  ui.setBusy(false);
  ui.hideDeath();
  scene()?.scene.restart({ session: s, onFrame, onCue } satisfies SceneData);
}

function play(): void {
  sfx.unlock();
  ui.hideTitle();
  session.paused = false;
  const p = session.player;
  const r = p.rig;
  const sp = session.world.spawn();
  if (r.wrecked) {
    // Left the game with a wrecked rig: start again from the station.
    session.act({ a: 'respawn' });
    arrive('respawn');
  } else if (p.stats.dug === 0 && Math.abs(r.x - sp.x) < 0.01 && rigDepth(r) <= 0.01) {
    arrive('new');
  } else if (r.stalled) {
    ui.showStalled();
  }
}

// ------------------------------------------------------------ cutscenes

/** A death or arrival scene is playing: the rig is out of the player's hands. */
let cine = false;
/** A scene to start on the next frame, once the game scene is showing this session. */
let queued: (() => void) | null = null;

/** The sky crane sets the rig down on the pad: at the start of a game, and after every death. */
function arrive(kind: 'new' | 'respawn'): void {
  const s = session;
  cine = true;
  ui.setBusy(true);
  s.releaseInput();
  s.paused = true;
  if (kind === 'new') ui.showBanner('Rime Station', 'Boreal Combine dig site');
  queued = () => {
    scene()!.playArrival(() => {
      if (session !== s) return;
      cine = false;
      ui.setBusy(false);
      s.paused = false;
      if (s instanceof LocalSession) saveSession(s);
      if (kind === 'new') ui.toast('Depot: "Tank\'s full. Sell what you dig at the Assay Office, and watch that gauge."', '', 5000);
      else ui.toast('A fresh rig on the pad: full tank, full hull.', 'good', 3200);
    });
  };
}

/** Play the rig's end, then put a new one on the pad. The ore on board is the only thing lost. */
function die(cause: HurtCause): void {
  if (cine) return;
  const s = session;
  const p = s.player;
  cine = true;
  ui.closePanel(false);
  ui.closeChat();
  ui.setBusy(true);
  s.releaseInput();
  s.paused = true;
  ui.showDeath(cause, rigDepth(p.rig), cargoCount(p), cargoValue(p));
  scene()!.playDeath(cause, () => {
    if (session !== s) return;
    s.act({ a: 'respawn' });
    ui.hideDeath();
    arrive('respawn');
  });
}

function onCue(cue: Cue): void {
  switch (cue) {
    case 'sputter':
      sfx.sputter();
      break;
    case 'freeze':
      sfx.freeze();
      break;
    case 'crash':
      sfx.boom();
      sfx.thud(1);
      break;
    case 'boom':
      sfx.boom();
      break;
    case 'hiss':
      sfx.hiss();
      break;
    case 'rotor':
      sfx.rotor();
      break;
    case 'land':
      sfx.thud(0.4);
      break;
  }
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
/** The "just enough fuel to get home" warning went out on this trip down. */
let homeWarned = false;
/** The day the last frame was in, to announce sunrise. 0 until the first frame of a session. */
let lastDay = 0;

function onFrame(game: GameScene): void {
  const r = session.player.rig;
  ui.frame();
  if (game.session === session && !ui.titleOpen) {
    if (queued) {
      const start = queued;
      queued = null;
      start();
    } else if (r.wrecked && !cine) {
      die(r.wreckedBy ?? 'fall');
    }
  }
  const idle = ui.titleOpen || cine || (session.paused && !session.online);
  sfx.musicFrame(layerForDepth(rigDepth(r)), !ui.titleOpen);
  const tile = r.drill ? session.world.get(r.drill.tx, r.drill.ty) : 0;
  sfx.drill(!!r.drill && !idle, tileDef(tile).hardness);
  sfx.thrust(r.thrusting && !idle);
  if (idle) return;

  const today = dayNumber(session.world);
  if (lastDay && today > lastDay) ui.toast(`Sunrise. <b>Day ${today}</b> at Rime Station.`, '', 2600);
  lastDay = today;
  const now = performance.now();
  const st = statsOf(session.player);
  if (rigDepth(r) > 0.5 && r.fuel / st.tank < 0.15 && r.fuel > 0 && now - lastAlarm > 2500) {
    lastAlarm = now;
    sfx.alarm();
  }
  // One warning per trip, while there's still (just) enough in the tank to fly home.
  const depth = rigDepth(r);
  if (depth < 1) homeWarned = false;
  else if (!homeWarned && depth > 6 && r.fuel < fuelToSurface(session.player, session.world) * 1.15 + 0.3) {
    homeWarned = true;
    sfx.alarm();
    const cells = session.player.items.fuelcell ?? 0;
    ui.toast(`Fuel check: just enough left to fly home. Head up now.${cells ? ` (${cells} Fuel Cell${cells > 1 ? 's' : ''} in reserve.)` : ''}`, 'warn', 4500);
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

const LOST_TO: Record<HurtCause, string> = {
  fuel: 'out of fuel',
  fall: 'hard landing',
  rock: 'rockfall',
  gas: 'gas pocket',
  magma: 'magma',
  heat: 'overheated',
  steam: 'steam vent',
};

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
    case 'peer-wrecked': {
      if (near(e.x - 0.5, e.y - 0.5, 14)) {
        if (e.cause === 'gas') sfx.boom();
        else if (e.cause === 'fuel') sfx.freeze();
        else if (e.cause === 'fall' || e.cause === 'rock') sfx.thud(0.9);
        else sfx.hiss();
      }
      const depth = Math.max(0, Math.floor(e.y - SKY)) * METERS_PER_TILE;
      ui.toast(`${esc(e.name)} lost a rig at ${depth} m: ${LOST_TO[e.cause]}.`, '', 2800);
      break;
    }
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
    case 'refill':
      sfx.splash();
      ui.toast(`Meltwater cracked into fuel: <b>+${e.litres.toFixed(1)} L</b>`, 'good', 1800);
      hint('refill', 'Meltwater pockets are free fuel. Look for the blue glints in the glacier.');
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
    case 'reserve':
      sfx.alarm();
      ui.toast(`Tank ran dry: the rig burned a Fuel Cell. <b>${e.left} left.</b>`, 'warn', 3600);
      break;
    case 'stalled':
      // Only happens online with someone else around. The server sends the SOS.
      sfx.error();
      ui.showStalled();
      break;
    case 'refused':
      sfx.error();
      if (e.act.a === 'use') ui.toast(`Can't use a ${ITEMS[e.act.k].name} right now.`, 'warn');
      else ui.toast(`The station says no: ${whyText(e.res)}`, 'warn');
      break;
    case 'peer-sos':
      if (!e.mine) {
        sfx.alarm();
        ui.toast(`${esc(e.name)} is out of fuel at ${e.depth * METERS_PER_TILE} m. Follow the red arrow with a Fuel Cell and earn a rescue fee.`, 'bad', 5000);
      }
      break;
    case 'rescue':
      if (e.role === 'helper') {
        sfx.sell();
        ui.toast(`You refuelled ${esc(e.toName)}. They paid you <b>${money(e.fee)}</b>.`, 'good', 3600);
      } else if (e.role === 'helped') {
        sfx.buy();
        ui.closeIf('stall');
        ui.toast(`${esc(e.byName)} refuelled you for ${money(e.fee)}. Your ore is still on board.`, 'good', 3600);
      } else {
        ui.toast(`${esc(e.byName)} refuelled ${esc(e.toName)}.`, '', 2200);
      }
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

/** Keys pressed for a panel or a cutscene. They don't drive the rig until they're let go. */
const eaten = new Set<string>();
const SKIP_KEYS = new Set(['Space', 'Enter', 'KeyE', 'Escape']);

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.code === 'KeyM' && !e.repeat && !ui.titleOpen && !ui.chatOpen) {
    sfx.setMuted(!sfx.muted);
    ui.toast(sfx.muted ? 'Sound off' : 'Sound on', '', 1000);
    return;
  }
  if (cine && !ui.titleOpen) {
    eaten.add(e.code);
    if (SKIP_KEYS.has(e.code)) {
      if (!e.repeat) scene()?.skipCutscene();
      e.preventDefault();
    }
    return;
  }
  if (ui.handleKey(e)) {
    eaten.add(e.code);
    return;
  }
  const k = KEYS[e.code];
  if (k) {
    if (!eaten.has(e.code)) session.input[k] = true;
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyE' || e.code === 'Enter') ui.interact();
  const digit = /^Digit([1-6])$/.exec(e.code);
  if (digit) ui.useItem(ITEM_ORDER[Number(digit[1]) - 1]);
});
window.addEventListener('keyup', (e) => {
  eaten.delete(e.code);
  const k = KEYS[e.code];
  if (k) session.input[k] = false;
});
// A tap or click skips a cutscene too.
window.addEventListener('pointerdown', () => {
  if (cine && !ui.titleOpen) scene()?.skipCutscene();
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
  /** Skip the cutscene that's playing, if any (headless checks). */
  skip() {
    scene()?.skipCutscene();
  },
  get cutscene() {
    return cine;
  },
};
