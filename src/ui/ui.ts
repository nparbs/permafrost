// The HTML layer over the game: HUD, station panels, dialogs, chat, title screen and touch controls.

import type { Sfx } from '../game/audio';
import type { GameSession } from '../game/session';
import { BOARD_KEYS, type BoardKey, type Recap, type Standings } from '../net/protocol';
import { HEARTH, atExit, atGate } from '../sim/hearth';
import { LOGS } from '../sim/story';
import { STAR_MAX, STAR_SHARE, starBonus } from '../sim/market';
import { BOUNTY_BONUS, MARKET, bountyLeft, bountyOf, marketFactor, priceOf, trend } from '../sim/market';
import { quality, type Quality } from '../game/gfx';
import { PAINTS } from '../game/textures';
import { CHAT_MAX, NAME_MAX, PAINT_COUNT, RIG_SOS, RIG_STALLED, RIG_WRECKED, cleanName } from '../net/protocol';
import type { Action, ActResult } from '../sim/actions';
import { ITEMS, ITEM_ORDER, ITEM_STACK, type ItemKey } from '../sim/items';
import { cargoCount, cargoValue, statsOf, type HurtCause } from '../sim/player';
import { fuelToSurface, rigDepth, type Input } from '../sim/rig';
import { AID_REACH, FUEL_PRICE, buildingAt, refuelCost, repairCost, rescueFee, saleLines } from '../sim/station';
import { tempAtDepth } from '../sim/temperature';
import { dayNumber, dayPart, dayPhase } from '../sim/daytime';
import { ambientTemp, blizzardAt } from '../sim/weather';
import { LAYERS, MINERALS } from '../sim/tiles';
import { UPGRADES, UPGRADE_ORDER, type UpgradeKey } from '../sim/upgrades';
import { METERS_PER_TILE, SKY as SKY_ROW, type Building } from '../sim/world';
import { Minimap, WorldMap } from './minimap';

declare const __APP_VERSION__: string;

export const money = (n: number) => '$' + Math.floor(n).toLocaleString('en-US');
export const meters = (tiles: number) => `${Math.max(0, Math.floor(tiles)) * METERS_PER_TILE} m`;
/** "12 days", "5 hours", "under an hour" for a span in ms. */
export function timeLeft(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  if (h >= 24) return '1 day';
  if (h >= 2) return `${Math.floor(h)} hours`;
  if (h >= 1) return '1 hour';
  return 'under an hour';
}
/** Seconds as "4:07". */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(STAR_MAX, n)));
export const prettyCode = (t: string) => t.replace(/(.{4})(?=.)/g, '$1-');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function button(label: string, onClick: () => void, cls = '', disabled = false): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label);
  b.disabled = disabled;
  // Keep keyboard focus off buttons, so Space confirms the panel instead of re-pressing the last button clicked.
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

const ICONS: Record<ItemKey, string> = {
  fuelcell: '<rect x="5" y="4" width="10" height="13" fill="#e8a020"/><rect x="7" y="2" width="5" height="3" fill="#9a6a10"/><rect x="7" y="8" width="6" height="2" fill="#5a3a08"/>',
  repairkit: '<rect x="3" y="5" width="14" height="11" fill="#e8e8e8"/><rect x="9" y="7" width="2" height="7" fill="#d03030"/><rect x="6" y="10" width="8" height="2" fill="#d03030"/><rect x="7" y="3" width="6" height="2" fill="#9aa"/>',
  charge: '<rect x="8" y="6" width="5" height="11" fill="#d03a2a"/><rect x="9" y="3" width="1" height="3" fill="#ccc"/><rect x="10" y="1" width="2" height="2" fill="#ffd040"/>',
  megacharge: '<rect x="4" y="7" width="4" height="10" fill="#d03a2a"/><rect x="8" y="6" width="4" height="11" fill="#e04a3a"/><rect x="12" y="7" width="4" height="10" fill="#d03a2a"/><rect x="4" y="11" width="12" height="2" fill="#333"/><rect x="10" y="3" width="1" height="3" fill="#ccc"/>',
  beacon: '<rect x="9" y="4" width="2" height="12" fill="#9ab"/><rect x="6" y="15" width="8" height="2" fill="#567"/><rect x="8" y="2" width="4" height="3" fill="#3ad0ff"/><rect x="4" y="5" width="2" height="1" fill="#3ad0ff"/><rect x="14" y="5" width="2" height="1" fill="#3ad0ff"/>',
  flare: '<rect x="8" y="7" width="4" height="10" fill="#c83a2a"/><rect x="8" y="9" width="4" height="1" fill="#f0e0d0"/><rect x="8" y="5" width="4" height="2" fill="#ffd040"/><rect x="9" y="2" width="2" height="3" fill="#fff6c0"/><rect x="6" y="3" width="1" height="1" fill="#ffb030"/><rect x="13" y="4" width="1" height="1" fill="#ffb030"/>',
};
const icon = (k: ItemKey) => `<svg viewBox="0 0 20 20" width="20" height="20" shape-rendering="crispEdges">${ICONS[k]}</svg>`;

const WHY: Record<string, string> = {
  cash: 'Not enough cash.',
  max: "That's already maxed out.",
  where: 'Park in front of the right building first.',
  state: "That can't be done right now.",
  bad: 'Something went wrong.',
};
export const whyText = (r: ActResult) => WHY[r.why ?? 'bad'] ?? WHY.bad;

/** The leaderboards: a title and how to print a score. */
const BOARDS: Record<BoardKey, { title: string; show: (v: number) => string }> = {
  deepest: { title: 'Deepest dig', show: (v) => meters(v) },
  earned: { title: 'Most earned', show: (v) => money(v) },
  relics: { title: 'Relics found', show: (v) => String(v) },
  rescues: { title: 'Rescues', show: (v) => String(v) },
  hearth: { title: 'Fastest Hearth', show: (v) => clock(v) },
};

/** The key hint on the button Space presses. Hidden on touch screens along with every other <kbd>. */
const SPACE = '<kbd>Space</kbd> ';

/** Colours of the "+$240", "+12 L" texts that float over the rig. */
const FLOAT = { cash: '#ffd76a', fuel: '#ffc040', hull: '#7aff9a', gear: '#9fe8ff' };

/** The death card: what happened, and what the station has to say about it. */
const DEATHS: Record<HurtCause, { title: string; sub: string; radio: string[] }> = {
  fuel: {
    title: 'Out of fuel',
    sub: 'Frozen solid',
    radio: ['Depot: "The gauge on the left. That was the one that mattered."', 'Depot: "Fuel is two dollars a litre. Rigs run a little more."', 'Mechanic: "I\'ll fetch the ice pick."'],
  },
  fall: {
    title: 'Rig wrecked',
    sub: 'Hull split on landing',
    radio: ['Mechanic: "The thruster works on the way down too."', 'Mechanic: "That\'ll buff out. Into a different rig."', 'Assayer: "Gravity remains free of charge."'],
  },
  rock: {
    title: 'Crushed',
    sub: 'Rockfall',
    radio: ['Mechanic: "If it shakes, don\'t park under it."', 'Assayer: "For the record, the rock was worthless."'],
  },
  gas: {
    title: 'Gas pocket',
    sub: 'Blown apart',
    radio: ['Mechanic: "Found the gas, then."', 'Depot: "Not one of ours. We only sell the slow kind."'],
  },
  magma: {
    title: 'Melted down',
    sub: 'Lost to magma',
    radio: ['Mechanic: "The glowing rock is the bad rock."', 'Assayer: "We don\'t buy rigs by the puddle."'],
  },
  heat: {
    title: 'Cooked',
    sub: 'Overheated',
    radio: ['Mechanic: "Radiators. We sell them. Just saying."', 'Depot: "Warm down there? Must be nice."'],
  },
  frost: {
    title: 'Flash-frozen',
    sub: 'Caught on the ground by the Hearth',
    radio: ['Mechanic: "It breathes in, then it bites. Be in the air for the bite."', 'Depot: "Froze solid at three hundred degrees. That\'s a new one for the board."'],
  },
  steam: {
    title: 'Scalded',
    sub: 'Caught in a steam vent',
    radio: ['Mechanic: "The vents go off every six seconds. Count next time."'],
  },
};

export interface TitleInfo {
  hasSave: boolean;
  name: string;
  paint: number;
  /** The account code kept in this browser, if any. */
  token: string | null;
  error?: string;
}

interface Hooks {
  save: () => void;
  newOffline: () => void;
  continueOffline: () => void;
  goOnline: (opts: { name: string; paint: number; token?: string }) => void;
  leave: () => void;
  setPaint: (paint: number) => void;
  setName: (name: string) => void;
  /** Float a short text over the rig, like "+$240". */
  float: (text: string, color: string) => void;
  /** The stalled player gave up: lose the rig and respawn. */
  giveUp: () => void;
  /** Switch between the high and low graphics. */
  setQuality: (q: Quality) => void;
}

interface Gauge {
  root: HTMLElement;
  bar: HTMLElement;
  text: HTMLElement;
}

export class UI {
  readonly root = document.getElementById('ui')!;
  private s!: GameSession;
  private gauges: Record<'fuel' | 'hull' | 'cargo', Gauge>;
  private cash: HTMLElement;
  private depth: HTMLElement;
  private temp: HTMLElement;
  private day: HTMLElement;
  private onlineEl: HTMLElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private prompt: HTMLButtonElement;
  private itemBtns = new Map<ItemKey, HTMLButtonElement>();
  private panel: HTMLElement;
  private panelTitle: HTMLElement;
  private panelBody: HTMLElement;
  private panelClose: HTMLButtonElement;
  private title: HTMLElement;
  private chatLog: HTMLElement;
  private chatBox: HTMLFormElement;
  private chatInput: HTMLInputElement;
  private chatBtn: HTMLButtonElement;
  private render: (() => HTMLElement) | null = null;
  private closable = true;
  /** What the big prompt button offers right now ('' for nothing), so it's only redrawn on a change. */
  private promptKey = '';
  private minimap: Minimap;
  private worldMap: WorldMap | null = null;
  /** Which panel is open, so events can close the right one. */
  private panelKind = '';
  private textCache = new WeakMap<HTMLElement, string>();
  private highestLayer = 0;
  /** What Space or Enter does in the open panel, if anything. */
  private confirm: (() => void) | null = null;
  /** What the arrow keys do in the open panel, if anything. */
  private nav: ((dx: number, dy: number) => void) | null = null;
  /** The highlighted card in the Machine Shop or Supply Store. */
  private sel = 0;
  /** The Assay Office price list is unfolded. */
  private pricesOpen = false;
  /** Which page of the Standings panel is showing. */
  private boardTab: 'now' | 'firsts' | 'last' = 'now';
  /** Marks the fuel for the flight home on the fuel gauge. */
  private homeMark: HTMLElement;
  private sosArrow: HTMLElement;
  /** The state of the Hearth fight, under the top of the screen. */
  private hearthHud: HTMLElement;
  private credits: HTMLElement;
  private creditsDone: (() => void) | null = null;
  /** The recorder whose text is unfolded in the Comms Tower. */
  private logOpen = -1;
  /** Recorders found since the Comms Tower was last opened. */
  private newLogs = new Set<number>();
  private death: HTMLElement;
  /** A cutscene is playing: no panels, prompts or items. */
  busy = false;
  titleOpen = true;
  /** The account code, shown in the menu while online. */
  code: string | null = null;

  constructor(
    private sfx: Sfx,
    private hooks: Hooks,
  ) {
    const r = this.root;
    r.appendChild(el('div', 'frost'));

    const top = r.appendChild(el('div', 'hud-top'));
    const left = top.appendChild(el('div', 'hud-left'));
    const g = left.appendChild(el('div', 'gauges'));
    const gauge = (key: string, label: string): Gauge => {
      const root = g.appendChild(el('div', `gauge g-${key}`));
      root.appendChild(el('b', '', label));
      const track = root.appendChild(el('i'));
      const bar = track.appendChild(el('s'));
      const text = track.appendChild(el('span'));
      return { root, bar, text };
    };
    this.gauges = { fuel: gauge('fuel', 'Fuel'), hull: gauge('hull', 'Hull'), cargo: gauge('cargo', 'Cargo') };
    this.homeMark = this.gauges.fuel.bar.parentElement!.appendChild(el('u'));
    this.homeMark.title = 'Fuel needed to fly home from here';
    this.chatLog = left.appendChild(el('div', 'chat-log'));
    const read = top.appendChild(el('div', 'readout'));
    this.cash = read.appendChild(el('div', 'cash'));
    this.depth = read.appendChild(el('div', 'depth'));
    this.temp = read.appendChild(el('div', 'temp'));
    this.day = read.appendChild(el('div', 'day'));
    this.onlineEl = read.appendChild(el('div', 'online'));
    const btns = read.appendChild(el('div', 'hud-btns'));
    this.chatBtn = btns.appendChild(button('Chat', () => this.openChat(), 'menu-btn chat-btn'));
    this.chatBtn.title = 'Chat (T)';
    btns.appendChild(button('Menu', () => this.openMenu(), 'menu-btn')).title = 'Menu (Esc)';
    this.minimap = new Minimap(() => this.openMap());
    read.appendChild(this.minimap.root);

    r.appendChild(el('div', 'bars'));
    this.sosArrow = r.appendChild(el('div', 'sos-arrow', '<i></i><span></span>'));
    this.death = r.appendChild(el('div', 'death'));
    this.hearthHud = r.appendChild(el('div', 'hearth-hud'));
    this.credits = r.appendChild(el('div', 'credits hidden'));
    this.banner = r.appendChild(el('div', 'banner'));
    this.toasts = r.appendChild(el('div', 'toasts'));
    this.prompt = r.appendChild(button('', () => this.interact(), 'prompt'));
    const items = r.appendChild(el('div', 'items'));
    for (const k of ITEM_ORDER) {
      const b = button(`<kbd>${ITEMS[k].hotkey}</kbd>${icon(k)}<span></span>`, () => this.useItem(k), 'item');
      b.title = `${ITEMS[k].name}: ${ITEMS[k].blurb}`;
      items.appendChild(b);
      this.itemBtns.set(k, b);
    }

    this.chatBox = r.appendChild(el('form', 'chat-box hidden'));
    this.chatInput = this.chatBox.appendChild(el('input'));
    this.chatInput.maxLength = CHAT_MAX;
    this.chatInput.placeholder = 'Say something (Enter to send, Esc to cancel)';
    this.chatInput.autocomplete = 'off';
    this.chatBox.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (text) this.s.chat(text);
      this.closeChat();
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeChat();
    });
    this.chatInput.addEventListener('keyup', (e) => e.stopPropagation());

    this.buildTouch();

    this.panel = r.appendChild(el('div', 'panel hidden'));
    const card = this.panel.appendChild(el('div', 'card'));
    const head = card.appendChild(el('header'));
    this.panelTitle = head.appendChild(el('h2'));
    this.panelClose = head.appendChild(button('✕', () => this.closePanel(), 'x'));
    this.panelClose.title = 'Close (Esc)';
    this.panelBody = card.appendChild(el('div', 'body'));
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel && this.closable) this.closePanel();
    });

    this.title = r.appendChild(el('div', 'title'));
  }

  bind(s: GameSession): void {
    this.s = s;
    this.highestLayer = layerForDepth(s.player.stats.deepest);
    this.closePanel(false);
    this.closeChat();
    this.chatLog.innerHTML = '';
    this.root.classList.toggle('online', s.online);
  }

  // ------------------------------------------------------------ title

  showTitle(info: TitleInfo): void {
    this.titleOpen = true;
    this.root.classList.add('title-on');
    this.title.classList.remove('hidden');
    this.title.innerHTML = '';
    const box = this.title.appendChild(el('div', 'title-box'));
    box.appendChild(el('h1', '', 'Permafrost'));
    box.appendChild(el('p', 'tag', 'Drill deep. Mind the cold. Then mind the heat.'));
    if (info.error) box.appendChild(el('p', 'title-error', esc(info.error)));

    const who = box.appendChild(el('div', 'who'));
    const name = who.appendChild(el('input', 'name-in'));
    name.maxLength = NAME_MAX;
    name.placeholder = 'Your name';
    name.value = info.name;
    name.autocomplete = 'off';
    name.addEventListener('keydown', (e) => e.stopPropagation());
    name.addEventListener('change', () => this.hooks.setName(cleanName(name.value)));
    const sw = who.appendChild(el('div', 'paints'));
    let paint = info.paint;
    for (let i = 0; i < PAINT_COUNT; i++) {
      const b = sw.appendChild(button('', () => {
        paint = i;
        sw.querySelectorAll('.paint').forEach((x, k) => x.classList.toggle('on', k === i));
        this.hooks.setPaint(i);
      }, `paint${i === paint ? ' on' : ''}`));
      b.style.background = PAINTS[i];
      b.title = 'Rig paint';
    }

    const btns = box.appendChild(el('div', 'title-btns'));
    btns.appendChild(button('Play online', () => this.hooks.goOnline({ name: cleanName(name.value), paint }), 'primary'));
    if (info.hasSave) btns.appendChild(button('Continue offline', () => this.hooks.continueOffline()));
    btns.appendChild(
      button(info.hasSave ? 'New offline game' : 'Play offline', () => {
        if (info.hasSave && !confirm('Start a new offline game? Your offline rig and cash will be lost.')) return;
        this.hooks.newOffline();
      }),
    );

    const codeRow = box.appendChild(el('details', 'code-row'));
    codeRow.appendChild(el('summary', '', info.token ? 'Use a different code' : 'Have a code from another device?'));
    const form = codeRow.appendChild(el('form', 'code-form'));
    const code = form.appendChild(el('input'));
    code.placeholder = 'XXXX-XXXX-XXXX-XXXX';
    code.maxLength = 24;
    code.autocomplete = 'off';
    code.addEventListener('keydown', (e) => e.stopPropagation());
    form.appendChild(button('Use code', () => form.requestSubmit(), ''));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (t.length !== 16) {
        code.classList.add('bad');
        return;
      }
      this.hooks.goOnline({ name: '', paint, token: t });
    });

    box.appendChild(
      el(
        'div',
        'help',
        `<p><kbd>←</kbd><kbd>→</kbd> drive and drill sideways · <kbd>↓</kbd> drill down · <kbd>↑</kbd> or <kbd>Space</kbd> thrust</p>
         <p><kbd>E</kbd> enter a building, <kbd>Space</kbd> to sell or buy there · <kbd>1</kbd>–<kbd>6</kbd> items · <kbd>N</kbd> map · <kbd>L</kbd> standings · <kbd>T</kbd> chat · <kbd>M</kbd> mute · <kbd>Esc</kbd> menu</p>`,
      ),
    );
    box.appendChild(
      el(
        'div',
        'help help-touch',
        `<p><span>◀ ▶ drive and drill sideways</span> · <span>▼ drill down</span> · <span>▲ thrust</span></p>
         <p><span>Park on a building and tap Enter</span> · <span>tap an item to use it</span></p>`,
      ),
    );
    box.appendChild(el('p', 'ver', `v${__APP_VERSION__}`));
  }

  showConnecting(): void {
    this.title.querySelectorAll<HTMLButtonElement>('.btn').forEach((b) => (b.disabled = true));
    const p = this.title.querySelector('.title-btns .primary');
    if (p) p.textContent = 'Connecting…';
  }

  hideTitle(): void {
    this.titleOpen = false;
    this.root.classList.remove('title-on');
    this.title.classList.add('hidden');
  }

  // ------------------------------------------------------------ HUD

  private setText(e: HTMLElement, text: string): void {
    if (this.textCache.get(e) === text) return;
    this.textCache.set(e, text);
    e.textContent = text;
  }

  private setGauge(g: Gauge, k: number, text: string, warn: boolean): void {
    g.bar.style.width = `${Math.max(0, Math.min(1, k)) * 100}%`;
    this.setText(g.text, text);
    g.root.classList.toggle('warn', warn);
  }

  frame(): void {
    const p = this.s.player;
    const r = p.rig;
    const st = statsOf(p);
    const d = rigDepth(r);
    const fuelK = r.fuel / st.tank;
    // The white tick is what the flight home takes from here. Below it, the gauge blinks.
    const home = d > 3 ? fuelToSurface(p, this.s.world) : 0;
    this.setGauge(this.gauges.fuel, fuelK, `${r.fuel.toFixed(1)} / ${st.tank} L`, d > 0.5 && (fuelK < 0.2 || r.fuel < home));
    this.homeMark.style.display = home > 0 ? 'block' : 'none';
    if (home > 0) this.homeMark.style.left = `${Math.min(1, home / st.tank) * 100}%`;
    this.setGauge(this.gauges.hull, r.hull / st.maxHull, `${Math.ceil(r.hull)} / ${st.maxHull}`, r.hull / st.maxHull < 0.25);
    const n = cargoCount(p);
    this.setGauge(this.gauges.cargo, n / st.cargo, `${n} / ${st.cargo}`, n >= st.cargo);
    this.setText(this.cash, money(p.cash));
    this.setText(this.depth, d > 0.5 ? meters(d) : 'Surface');
    const w = this.s.world;
    const t = Math.round(ambientTemp(w, Math.max(0, d)));
    const storm = d < 12 && blizzardAt(w.seed, w.time) > 0.2;
    this.setText(this.temp, storm ? `${t}°C · Blizzard` : `${t}°C`);
    this.temp.className = `temp ${r.cold ? 'cold' : r.hot ? 'hot' : ''}`;
    this.temp.title = `Your rig works from ${st.minTemp}°C to ${st.maxTemp}°C`;
    const part = dayPart(dayPhase(w));
    this.setText(this.day, `Day ${dayNumber(w)} · ${part}`);
    this.day.className = `day ${part.toLowerCase()}`;
    this.setText(this.onlineEl, this.s.online ? `● ${this.s.onlineCount()} online` : 'Offline');
    this.root.classList.toggle('cold', r.cold);
    this.root.classList.toggle('hot', r.hot);


    for (const [k, b] of this.itemBtns) {
      const c = p.items[k] ?? 0;
      this.setText(b.querySelector('span')!, c ? String(c) : '');
      b.classList.toggle('empty', c === 0);
    }

    const pr = this.render || this.busy ? null : this.promptNow();
    const key = pr ? (pr.kind === 'building' ? `b:${pr.b.key}` : pr.kind === 'aid' ? `a:${pr.id}:${pr.name}` : pr.kind) : '';
    if (key !== this.promptKey) {
      this.promptKey = key;
      this.prompt.classList.toggle('show', !!pr);
      if (pr?.kind === 'building') this.prompt.innerHTML = `<kbd>E</kbd><b>Enter</b><span>${pr.b.name}</span>`;
      else if (pr?.kind === 'stall') this.prompt.innerHTML = `<kbd>E</kbd><b>Stalled</b><span>Options</span>`;
      else if (pr?.kind === 'aid') this.prompt.innerHTML = `<kbd>E</kbd><b>Refuel</b><span>${esc(pr.name)}</span>`;
      else if (pr?.kind === 'gate') this.prompt.innerHTML = `<kbd>E</kbd><b>Enter</b><span>The Hearth</span>`;
      else if (pr?.kind === 'exit') this.prompt.innerHTML = `<kbd>E</kbd><b>Leave</b><span>The Hearth</span>`;
    }
    const h = this.busy || this.titleOpen ? null : this.s.hearth();
    this.hearthHud.classList.toggle('show', !!h);
    if (h) {
      const soon = h.phase === 'fight' && h.pulseIn < HEARTH.warn;
      let text: string;
      if (h.phase === 'escape') text = `Climb! Heat ${Math.max(0, Math.round((h.wave - r.y) * METERS_PER_TILE))} m below`;
      else if (soon) text = 'Pulse! Get off the ground';
      else text = `${h.open ? 'Heart exposed' : `Vents left: ${h.vents}`} · pulse in ${Math.ceil(h.pulseIn)}`;
      this.setText(this.hearthHud, text);
      this.hearthHud.classList.toggle('warn', soon || h.phase === 'escape');
    }
    this.minimap.frame(this.s, this.s.online && !this.titleOpen && this.s.mapPeers().length > 0);
    this.frameSos();
    if (this.worldMap && this.panelKind === 'map') this.worldMap.draw();

    const layer = layerForDepth(d);
    if (layer > this.highestLayer) {
      this.highestLayer = layer;
      const L = LAYERS[layer];
      this.showBanner(L.name, `${meters(L.top)} · ${Math.round(tempAtDepth(L.top))}°C`);
    }
  }

  /** An arrow at the edge of the screen pointing at the nearest miner who sent an SOS. */
  private frameSos(): void {
    const a = this.sosArrow;
    const me = this.s.player.rig;
    let best: { name: string; dx: number; dy: number } | null = null;
    let near = Infinity;
    if (this.s.online && !this.busy && !this.titleOpen && !me.stalled) {
      for (const o of this.s.mapPeers()) {
        if (!(o.flags & RIG_SOS) || o.flags & RIG_WRECKED) continue;
        const dist = Math.hypot(o.x - me.x, o.y - me.y);
        if (dist < near) {
          near = dist;
          best = { name: o.name, dx: o.x - me.x, dy: o.y - me.y };
        }
      }
    }
    // Close enough to see them (and their SOS tag) on screen.
    if (!best || near < 6) {
      a.classList.remove('show');
      return;
    }
    const ang = Math.atan2(best.dy, best.dx);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const x = w / 2 + Math.cos(ang) * Math.max(40, w / 2 - 70);
    const y = h / 2 + Math.sin(ang) * Math.max(40, h / 2 - 84);
    a.classList.add('show');
    a.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    (a.firstElementChild as HTMLElement).style.transform = `rotate(${ang.toFixed(2)}rad)`;
    this.setText(a.lastElementChild as HTMLElement, `SOS · ${best.name} · ${Math.round(near) * METERS_PER_TILE} m`);
  }

  showBanner(title: string, sub: string): void {
    this.banner.innerHTML = `<b>${title}</b><small>${sub}</small>`;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  toast(html: string, cls = '', ms = 2200): void {
    const t = el('div', `toast ${cls}`, html);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  useItem(k: ItemKey): void {
    if (this.render || this.titleOpen || this.busy) return;
    if ((this.s.player.items[k] ?? 0) <= 0) {
      this.toast(`No ${ITEMS[k].name}s. The Supply Store sells them.`, 'warn');
      this.sfx.error();
      return;
    }
    if (!this.s.act({ a: 'use', k }).ok) {
      this.toast(`Can't use a ${ITEMS[k].name} right now.`, 'warn');
      this.sfx.error();
    }
  }

  // ------------------------------------------------------------ chat

  get chatOpen(): boolean {
    return !this.chatBox.classList.contains('hidden');
  }

  openChat(): void {
    if (!this.s?.online || this.titleOpen) return;
    this.s.releaseInput();
    this.chatBox.classList.remove('hidden');
    this.chatInput.placeholder = this.root.classList.contains('touch-on') ? 'Say something' : 'Say something (Enter to send, Esc to cancel)';
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat(): void {
    this.chatBox.classList.add('hidden');
    this.chatInput.blur();
  }

  addChat(name: string, text: string, mine: boolean): void {
    const line = el('div', `chat-line${mine ? ' mine' : ''}`, `<b>${esc(name)}</b> ${esc(text)}`);
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 6) this.chatLog.firstElementChild!.remove();
    setTimeout(() => line.classList.add('old'), 12000);
  }

  // ------------------------------------------------------------ touch

  private buildTouch(): void {
    const t = this.root.appendChild(el('div', 'touch'));
    const pad = t.appendChild(el('div', 'dpad'));
    const thrust = t.appendChild(el('div', 'tpad'));
    const hold = (parent: HTMLElement, label: string, key: keyof Input, cls: string) => {
      const b = parent.appendChild(el('button', `tbtn ${cls}`, label));
      const set = (v: boolean) => (e: Event) => {
        e.preventDefault();
        this.sfx.unlock();
        if (this.s) this.s.input[key] = v;
        b.classList.toggle('held', v);
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        set(true)(e);
      });
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('lostpointercapture', set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold(pad, '◀', 'left', 'left');
    hold(pad, '▼', 'down', 'down');
    hold(pad, '▶', 'right', 'right');
    hold(thrust, '▲', 'up', 'up');
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.root.classList.toggle('touch-on', coarse);
    window.addEventListener('touchstart', () => this.root.classList.add('touch-on'), { once: true, passive: true });
  }

  // ------------------------------------------------------------ panels

  get panelOpen(): boolean {
    return this.render !== null;
  }

  /** What the prompt button should offer right now, if anything. */
  private promptNow(): Prompt | null {
    const p = this.s.player;
    const b = buildingAt(this.s.world, p);
    if (b) return { kind: 'building', b };
    const r = p.rig;
    const h = this.s.hearth();
    if (h) return atExit({ phase: h.phase, world: this.s.world }, p) ? { kind: 'exit' } : null;
    if (atGate(this.s.world, p)) return { kind: 'gate' };
    if (r.stalled && !r.wrecked) return { kind: 'stall' };
    if (!this.s.online || r.wrecked || r.drill) return null;
    for (const o of this.s.peers()) {
      if (!(o.flags & RIG_STALLED) || o.flags & RIG_WRECKED) continue;
      if (Math.abs(o.x - r.x) <= AID_REACH && Math.abs(o.y - r.y) <= AID_REACH) return { kind: 'aid', id: o.id, name: o.name };
    }
    return null;
  }

  interact(): void {
    if (this.render || this.titleOpen || this.busy) return;
    const pr = this.promptNow();
    if (pr?.kind === 'building') this.openBuilding(pr.b);
    else if (pr?.kind === 'stall') this.showStalled();
    else if (pr?.kind === 'aid') this.giveFuel(pr.id, pr.name);
    else if (pr?.kind === 'gate') this.showGate();
    else if (pr?.kind === 'exit') this.s.act({ a: 'leave' });
  }

  /** At the Hearth's gate: what's inside, what it takes, and the way in. */
  private showGate(): void {
    this.sfx.click();
    this.openPanel('The Hearth', () => {
      const p = this.s.player;
      const box = el('div', 'pnl');
      const charges = (p.items.charge ?? 0) + (p.items.megacharge ?? 0);
      box.appendChild(el('p', '', 'The gate is warm. Behind it something very large is breathing in.'));
      box.appendChild(
        el('p', 'note', 'Break its four heat vents with charges, then the heart, from on top of the machine. It sends out freezing pulses: be off the ground when one lands. Ice comes off the roof. When the heart breaks the Hollow comes down, and the only way out is up.'),
      );
      box.appendChild(el('p', charges >= 5 ? '' : 'warn-line', `You carry <b>${charges}</b> ${charges === 1 ? 'charge' : 'charges'}. It takes five.`));
      box.appendChild(el('p', 'note', 'Breaking the Hearth ends this run: credits, a prestige star, and a new rig with nothing in the bank. Losing the rig in there costs the ore on board, as anywhere. You can come back out through the gate until the heart breaks.'));
      const go = () => {
        this.closePanel(false);
        const res = this.s.act({ a: 'enter' });
        if (!res.ok) this.toast('The gate stays shut. Park in it first.', 'warn');
      };
      box.appendChild(button(`${SPACE}Go in`, go, 'primary wide'));
      box.appendChild(button('Not yet', () => this.closePanel(), 'wide'));
      this.confirm = go;
      return box;
    }, true, 'gate');
  }

  /** A recorder was found: mark it new at the Comms Tower. */
  noteLog(id: number): void {
    this.newLogs.add(id);
  }

  /** The Comms Tower: play back the recorders you've found, and see the signals of the next few. */
  private commsPanel(): HTMLElement {
    const p = this.s.player;
    const w = this.s.world;
    const box = el('div', 'pnl');
    this.confirm = () => this.closePanel();
    const found = new Set(p.logs);
    box.appendChild(el('p', '', `Halvorsen recorders: <b>${found.size}</b> of ${LOGS.length}`));
    if (!found.size) box.appendChild(el('p', 'note', 'Forty years ago the Halvorsen Expedition dug here first and never came back. Their recorders are still down there. Touch one with the rig and the tower can play it.'));
    const list = box.appendChild(el('div', 'logs'));
    LOGS.forEach((log, id) => {
      if (!found.has(id)) return;
      const open = this.logOpen === id;
      const row = list.appendChild(el('div', `log${open ? ' open' : ''}${this.newLogs.has(id) ? ' new' : ''}`));
      row.appendChild(
        button(`<b>${id + 1}.</b> ${esc(log.title)} <span class="dim">· ${esc(log.who)}</span>${this.newLogs.has(id) ? ' <span class="tag bounty">New</span>' : ''}`, () => {
          this.logOpen = open ? -1 : id;
          this.newLogs.delete(id);
          this.sfx.click();
          this.rerender();
        }, 'log-h'),
      );
      if (open) row.appendChild(el('p', 'log-text', esc(log.text)));
    });
    // The tower holds the three shallowest signals it hasn't got yet.
    const next = w.logs.filter((l) => !found.has(l.id)).slice(0, 3);
    if (next.length) {
      box.appendChild(el('p', 'sig-h', 'Signals'));
      const tbl = box.appendChild(el('table', 'sale'));
      for (const l of next) {
        const dx = Math.round(l.x + 0.5 - p.rig.x);
        const side = dx === 0 ? 'right below' : `${Math.abs(dx) * METERS_PER_TILE} m ${dx < 0 ? 'left' : 'right'}`;
        tbl.appendChild(el('tr', '', `<td>Recorder ${l.id + 1}</td><td>${meters(l.y - SKY_ROW)} down</td><td>${side}</td>`));
      }
      box.appendChild(el('p', 'note', 'Distances are from the tower. A recorder blinks red in the dark. Drive the rig into it.'));
    } else {
      box.appendChild(el('p', 'note', 'That is all of them.'));
    }
    return box;
  }

  /** The credits, over whatever the game is showing. Space, Enter or a tap on the button ends them. */
  showCredits(lines: string[], foot: string, done: () => void): void {
    this.closePanel(false);
    this.creditsDone = done;
    const c = this.credits;
    c.innerHTML = '';
    const roll = c.appendChild(el('div', 'roll'));
    for (const l of lines) roll.appendChild(el('p', l === l.toUpperCase() ? 'big' : '', esc(l)));
    roll.appendChild(el('p', 'foot', foot));
    c.appendChild(button(`${SPACE}Back to the ice`, () => this.endCredits(), 'primary'));
    c.classList.remove('hidden');
  }

  get creditsOpen(): boolean {
    return this.creditsDone !== null;
  }

  endCredits(): void {
    const done = this.creditsDone;
    if (!done) return;
    this.creditsDone = null;
    this.credits.classList.add('hidden');
    done();
  }

  private giveFuel(id: string, name: string): void {
    if ((this.s.player.items.fuelcell ?? 0) <= 0) {
      this.toast(`You need a Fuel Cell to refuel ${esc(name)}. The Supply Store sells them.`, 'warn', 3000);
      this.sfx.error();
      return;
    }
    this.s.aid(id);
  }

  openMap(): void {
    if (this.titleOpen || this.busy) return;
    this.sfx.click();
    const map = new WorldMap(this.s);
    this.openPanel('Map', () => map.box, true, 'map');
    this.worldMap = map;
    // Start with your own rig in view.
    const body = this.panelBody;
    const cv = map.canvas;
    requestAnimationFrame(() => {
      const y = cv.offsetTop + cv.offsetHeight * map.meShare() - body.clientHeight / 2;
      body.scrollTop = Math.max(0, y);
    });
  }

  /** Redraw the panel if it's this kind: something it shows just changed. */
  refreshIf(kind: string): void {
    if (this.panelKind === kind) this.rerender();
  }

  /** The season's leaderboards (online only). */
  openBoards(): void {
    if (this.titleOpen || this.busy || !this.s.online) return;
    this.sfx.click();
    this.boardTab = 'now';
    this.s.askBoards();
    this.openPanel('Standings', () => this.boardsPanel(), true, 'boards');
  }

  /** One leaderboard as a table, with your own row marked. */
  private boardTable(st: Standings, key: BoardKey, mine?: { v: number; rank: number }): HTMLElement {
    const b = BOARDS[key];
    const box = el('div', 'board');
    box.appendChild(el('h3', '', b.title));
    const rows = st.boards[key] ?? [];
    const me = this.s.myId();
    if (!rows.length) box.appendChild(el('p', 'note', 'Nobody yet.'));
    else {
      const tbl = box.appendChild(el('table', 'sale rank'));
      rows.forEach((r, i) => tbl.appendChild(el('tr', r.id === me ? 'me' : '', `<td>${i + 1}</td><td>${esc(r.name)}</td><td>${b.show(r.v)}</td>`)));
    }
    if (mine && mine.v > 0 && !rows.some((r) => r.id === me)) box.appendChild(el('p', 'note', `You: ${b.show(mine.v)}${mine.rank ? ` · #${mine.rank}` : ''}`));
    return box;
  }

  private boardsPanel(): HTMLElement {
    const box = el('div', 'pnl');
    const info = this.s.boards();
    const se = this.s.season();
    if (!info || !se) {
      box.appendChild(el('p', 'empty-note', 'Radioing the station for the standings…'));
      return box;
    }
    const left = se.ends - this.s.world.time * 1000;
    box.appendChild(el('p', '', `<b>Season ${se.n}</b> · ${left > 0 ? `${timeLeft(left)} left` : 'ending now'} · ${info.now.miners} ${info.now.miners === 1 ? 'miner' : 'miners'}`));
    const tabs = box.appendChild(el('div', 'row tabs'));
    const tab = (key: typeof this.boardTab, label: string) =>
      tabs.appendChild(button(label, () => {
        this.boardTab = key;
        this.sfx.click();
        this.rerender();
        this.panelBody.scrollTop = 0;
      }, this.boardTab === key ? 'primary' : ''));
    tab('now', 'Boards');
    tab('firsts', 'First finds');
    if (info.last) tab('last', `Season ${info.last.season}`);
    if (this.boardTab === 'last' && !info.last) this.boardTab = 'now';

    if (this.boardTab === 'firsts') {
      const tbl = box.appendChild(el('table', 'sale'));
      const seen = this.s.player.seen;
      for (const m of MINERALS) {
        const f = info.now.firsts.find((x) => x.mineral === m.key);
        // A mineral you haven't dug up yourself stays unnamed, even when somebody else has found it.
        const known = seen.includes(m.key);
        const name = `<td><i class="sw" style="background:${known ? m.color : '#333'}"></i>${known ? m.name : '???'}</td>`;
        tbl.appendChild(el('tr', f ? (f.id === this.s.myId() ? 'me' : '') : 'unknown', f ? `${name}<td>${meters(f.depth)}</td><td>${esc(f.name)}</td>` : `${name}<td></td><td>nobody yet</td>`));
      }
      box.appendChild(el('p', 'note', 'The first miner to dig up each mineral this season. Everyone on the ice hears about it.'));
    } else {
      const st = this.boardTab === 'last' ? info.last! : info.now;
      const stats = this.s.player.stats;
      const grid = box.appendChild(el('div', 'boards'));
      for (const k of BOARD_KEYS) grid.appendChild(this.boardTable(st, k, this.boardTab === 'now' ? { v: Math.floor((k === 'hearth' ? stats.hearthBest : stats[k]) ?? 0), rank: 0 } : undefined));
      box.appendChild(
        el('p', 'note', this.boardTab === 'last' ? `How season ${info.last!.season} ended.` : 'When the season ends, the map is regenerated and rigs, cash and upgrades start over. The final boards are kept.'),
      );
    }
    this.confirm = () => this.closePanel();
    return box;
  }

  /** Shown once after a season rolls over, to a miner who played the one that ended. */
  showRecap(recap: Recap): void {
    const rec = recap.record;
    this.openPanel(`Season ${rec.season} is over`, () => {
      const box = el('div', 'pnl');
      box.appendChild(el('p', '', `Mechanic: "New ice, same pay. Everyone starts over." The map has been regenerated, and rigs, cash and upgrades were reset with it.`));
      const yours = BOARD_KEYS.filter((k) => recap.you[k].v > 0).map((k) => `${BOARDS[k].title}: <b>${BOARDS[k].show(recap.you[k].v)}</b>${recap.you[k].rank ? ` (#${recap.you[k].rank})` : ''}`);
      if (yours.length) box.appendChild(el('p', 'recap-you', `Your season ${rec.season}: ${yours.join(' · ')}`));
      const grid = box.appendChild(el('div', 'boards'));
      for (const k of BOARD_KEYS) grid.appendChild(this.boardTable(rec, k));
      const go = () => this.closePanel();
      box.appendChild(button(`${SPACE}Start season ${rec.season + 1}`, go, 'primary wide'));
      this.confirm = go;
      return box;
    }, true, 'recap');
  }

  /** Close the panel if it's this kind. */
  closeIf(kind: string): void {
    if (this.panelKind === kind) this.closePanel();
  }

  openPanel(title: string, render: () => HTMLElement, closable = true, kind = ''): void {
    this.worldMap = null;
    this.panelKind = kind;
    this.render = render;
    this.closable = closable;
    this.panelTitle.textContent = title;
    this.panelClose.classList.toggle('hidden', !closable);
    this.panel.classList.remove('hidden');
    this.closeChat();
    this.s.releaseInput();
    this.s.paused = true;
    this.prompt.classList.remove('show');
    this.promptKey = '';
    this.panelBody.scrollTop = 0;
    this.rerender();
  }

  rerender(): void {
    if (!this.render) return;
    // Keep the scroll position, so buying something at the bottom of the shop doesn't jump to the top.
    const top = this.panelBody.scrollTop;
    this.confirm = null;
    this.nav = null;
    this.panelBody.replaceChildren(this.render());
    this.panelBody.scrollTop = top;
  }

  closePanel(save = true): void {
    if (!this.render) return;
    this.render = null;
    this.confirm = null;
    this.nav = null;
    this.panelKind = '';
    this.worldMap = null;
    this.panel.classList.add('hidden');
    if (this.s && !this.titleOpen && !this.busy) this.s.paused = false;
    if (save) this.hooks.save();
  }

  /** Returns true when the UI used the key. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.titleOpen) {
      if (e.code === 'Enter') {
        this.title.querySelector<HTMLButtonElement>('.title-btns .btn.primary')?.click();
        e.preventDefault();
      }
      return true;
    }
    if (this.creditsDone) {
      if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') && !e.repeat) this.endCredits();
      e.preventDefault();
      return true;
    }
    if (this.busy || this.chatOpen) return true;
    if (this.render) {
      const arrow = NAV_KEYS[e.code];
      if (e.code === 'Escape' || (e.code === 'KeyE' && this.closable) || (e.code === 'KeyN' && this.panelKind === 'map') || (e.code === 'KeyL' && this.panelKind === 'boards')) {
        if (this.closable) this.closePanel();
        e.preventDefault();
      } else if (e.code === 'Space' || e.code === 'Enter') {
        // Space is also thrust, so a held key must not buy twice (or fire the engine once the panel shuts).
        if (!e.repeat) this.confirm?.();
        e.preventDefault();
      } else if (arrow && this.nav) {
        this.nav(arrow[0], arrow[1]);
        e.preventDefault();
      }
      return true;
    }
    if (e.code === 'Escape') {
      this.openMenu();
      return true;
    }
    if (e.code === 'KeyN') {
      this.openMap();
      return true;
    }
    if (e.code === 'KeyL' && this.s.online) {
      this.openBoards();
      return true;
    }
    if ((e.code === 'KeyT' || e.code === 'Slash') && this.s.online) {
      e.preventDefault();
      this.openChat();
      return true;
    }
    return false;
  }

  openBuilding(b: Building): void {
    const panels: Record<Building['key'], () => HTMLElement> = {
      fuel: () => this.fuelPanel(),
      assay: () => this.assayPanel(),
      shop: () => this.shopPanel(),
      repair: () => this.repairPanel(),
      supply: () => this.supplyPanel(),
      comms: () => this.commsPanel(),
    };
    this.sfx.click();
    // Start the highlight on the first thing you can afford.
    this.sel = Math.max(0, b.key === 'shop' ? UPGRADE_ORDER.findIndex((k) => this.canUpgrade(k)) : ITEM_ORDER.findIndex((k) => this.canBuyItem(k)));
    this.openPanel(b.name, panels[b.key], true, b.key);
  }

  private canUpgrade(key: UpgradeKey): boolean {
    const p = this.s.player;
    const next = UPGRADES[key].tiers[p.upgrades[key] + 1];
    return !!next && p.cash >= next.cost;
  }

  private canBuyItem(k: ItemKey): boolean {
    const p = this.s.player;
    return p.cash >= ITEMS[k].cost && (p.items[k] ?? 0) < ITEM_STACK;
  }

  /** Run a station action, play the right sound and redraw the panel. */
  private run(a: Action, ok?: (r: ActResult) => void): void {
    const r = this.s.act(a);
    if (r.ok) {
      if (a.a === 'sell') this.sfx.sell();
      else this.sfx.buy();
      ok?.(r);
    } else {
      this.sfx.error();
      this.toast(whyText(r), 'warn');
    }
    this.rerender();
  }

  /** Done at this building: close the panel and float what you got over the rig. */
  private finish(text: string, color: string): void {
    this.closePanel();
    this.hooks.float(text, color);
  }

  /** Arrow keys move the highlight through a grid of `count` cards. */
  private gridNav(count: number): (dx: number, dy: number) => void {
    return (dx, dy) => {
      const cards = [...this.panelBody.querySelectorAll<HTMLElement>('.up, .it')];
      const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]?.offsetTop).length);
      const to = this.sel + dx + dy * cols;
      if (to < 0 || to >= count) return;
      this.sel = to;
      this.sfx.click();
      this.rerender();
      this.panelBody.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
  }

  private meter(label: string, k: number, text: string, cls: string): HTMLElement {
    const m = el('div', `meter ${cls}`);
    m.appendChild(el('b', '', label));
    const track = m.appendChild(el('i'));
    track.appendChild(el('s')).style.width = `${Math.max(0, Math.min(1, k)) * 100}%`;
    track.appendChild(el('span', '', text));
    return m;
  }

  private cashLine(): HTMLElement {
    return el('p', 'cashline', `Cash: <b>${money(this.s.player.cash)}</b>`);
  }

  private fuelPanel(): HTMLElement {
    const p = this.s.player;
    const st = statsOf(p);
    const box = el('div', 'pnl');
    box.appendChild(this.meter('Tank', p.rig.fuel / st.tank, `${p.rig.fuel.toFixed(1)} / ${st.tank} L`, 'g-fuel'));
    const cost = refuelCost(p);
    const row = box.appendChild(el('div', 'row'));
    const litres = (r: ActResult) => `+${(r.amount ?? 0).toFixed(1)} L`;
    const fill = () => this.run({ a: 'refuel' }, (r) => this.finish(litres(r), FLOAT.fuel));
    if (cost <= 0) row.appendChild(button('Tank is full', () => {}, '', true));
    else if (p.cash >= cost) row.appendChild(button(`${SPACE}Fill up · ${money(cost)}`, fill, 'primary'));
    else row.appendChild(button(p.cash > 0 ? `${SPACE}Buy ${money(p.cash)} worth` : 'No cash', fill, 'primary', p.cash <= 0));
    this.confirm = cost > 0 && p.cash > 0 ? fill : () => this.closePanel();
    const five = Math.min(5, st.tank - p.rig.fuel);
    row.appendChild(button(`+${five.toFixed(0)} L · ${money(Math.ceil(five * FUEL_PRICE))}`, () => this.run({ a: 'refuel', litres: 5 }, (r) => this.hooks.float(litres(r), FLOAT.fuel)), '', five < 0.5 || p.cash < 1));
    box.appendChild(el('p', 'note', `Fuel is ${money(FUEL_PRICE)} a litre. Cold below your heater's range makes the engine burn more.`));
    box.appendChild(this.cashLine());
    return box;
  }

  /** How an ore's price stands against its list price, as a small tag: "▼ 82%", "▲ 91%", "Bounty +50%". */
  private priceTag(m: (typeof MINERALS)[number]): string {
    const w = this.s.world;
    const tags: string[] = [];
    if (bountyOf(w.seed, w.time).key === m.key) tags.push(`<span class="tag bounty">Bounty +${Math.round((BOUNTY_BONUS - 1) * 100)}%</span>`);
    const f = marketFactor(w.market, m, w.time);
    if (f <= 0.995) {
      const t = trend(w.market, m, w.time);
      tags.push(`<span class="tag ${t < 0 ? 'down' : 'up'}">${t < 0 ? '▼' : '▲'} ${Math.round(f * 100)}%</span>`);
    }
    return tags.join(' ');
  }

  private assayPanel(): HTMLElement {
    const p = this.s.player;
    const w = this.s.world;
    const box = el('div', 'pnl');
    const lines = saleLines(p, w);
    this.confirm = () => this.closePanel();
    const bounty = bountyOf(w.seed, w.time);
    const hours = Math.max(1, Math.ceil(bountyLeft(w.time) / 3600));
    const what = p.seen.includes(bounty.key) ? `<i class="sw" style="background:${bounty.color}"></i><b>${bounty.name}</b>` : "<b>???</b> (something you haven't dug up yet)";
    box.appendChild(el('p', 'bounty-line', `Today's bounty: ${what} pays ${Math.round((BOUNTY_BONUS - 1) * 100)}% extra · ${hours} h left`));
    if (!lines.length) {
      box.appendChild(el('p', 'empty-note', 'Your cargo bay is empty. Bring up ore and we will weigh it.'));
    } else {
      const tbl = box.appendChild(el('table', 'sale'));
      for (const l of lines) {
        const m = MINERALS.find((mm) => mm.key === l.key)!;
        tbl.appendChild(el('tr', '', `<td><i class="sw" style="background:${m.color}"></i>${l.name} ${this.priceTag(m)}</td><td>${l.count} × ${money(l.each)}</td><td>${money(l.total)}</td>`));
      }
      const bonus = starBonus(p.prestige, lines.reduce((s, l) => s + l.total, 0));
      if (bonus > 0) tbl.appendChild(el('tr', 'me', `<td>${stars(p.prestige)} Hearthbreaker bonus</td><td>+${Math.round(STAR_SHARE * Math.min(STAR_MAX, p.prestige) * 100)}%</td><td>${money(bonus)}</td>`));
      const sell = () => this.run({ a: 'sell' }, (r) => this.finish(`+${money(r.total ?? 0)}`, FLOAT.cash));
      box.appendChild(button(`${SPACE}Sell everything · ${money(cargoValue(p, w))}`, sell, 'primary wide'));
      this.confirm = sell;
    }
    const list = el('details', 'prices');
    // Keep the list open across redraws (prices move while you look at them).
    list.open = this.pricesOpen;
    list.addEventListener('toggle', () => (this.pricesOpen = list.open));
    list.appendChild(el('summary', '', w.market ? 'Price list and market' : 'Price list'));
    const tbl = list.appendChild(el('table', 'sale'));
    for (const m of MINERALS) {
      const seen = p.seen.includes(m.key);
      tbl.appendChild(el('tr', seen ? '' : 'unknown', `<td><i class="sw" style="background:${seen ? m.color : '#333'}"></i>${seen ? m.name : '???'}</td><td>${seen ? this.priceTag(m) : ''}</td><td>${seen ? money(priceOf(w, m)) : '?'}</td>`));
    }
    if (w.market) {
      list.appendChild(
        el('p', 'note', `Prices are shared. Every sale pushes that ore's price down for everyone, to ${Math.round(MARKET.floor * 100)}% of list at worst, and it climbs back by half every ${Math.round(MARKET.halfLife / 60)} minutes. Relics always pay in full.`),
      );
    }
    box.appendChild(list);
    box.appendChild(this.cashLine());
    return box;
  }

  private shopPanel(): HTMLElement {
    const p = this.s.player;
    const box = el('div', 'pnl');
    const grid = box.appendChild(el('div', 'ups'));
    this.sel = Math.max(0, Math.min(UPGRADE_ORDER.length - 1, this.sel));
    UPGRADE_ORDER.forEach((key, i) => {
      const line = UPGRADES[key];
      const tier = p.upgrades[key];
      const cur = line.tiers[tier];
      const next = line.tiers[tier + 1];
      const picked = i === this.sel;
      const card = grid.appendChild(el('div', `up${picked ? ' sel' : ''}`));
      const pips = line.tiers.map((_, k) => `<i class="${k <= tier ? 'on' : ''}"></i>`).join('');
      card.appendChild(el('div', 'up-h', `<b>${line.name}</b><span class="pips">${pips}</span>`));
      card.appendChild(el('p', 'up-blurb', line.blurb));
      card.appendChild(el('div', 'up-cur', `${cur.name} · ${line.format(cur.value)}`));
      if (next) {
        const buy = () => {
          this.sel = i;
          this.run({ a: 'upgrade', k: key }, () => {
            this.hooks.float(`+${next.name}`, FLOAT.gear);
            // Nothing else in reach: back to the ice. Otherwise move on to the next thing you can afford.
            if (!UPGRADE_ORDER.some((k) => this.canUpgrade(k))) this.closePanel();
            else {
              this.toast(`Installed: ${next.name}`, 'good');
              if (!this.canUpgrade(key)) this.sel = UPGRADE_ORDER.findIndex((k) => this.canUpgrade(k));
            }
          });
        };
        card.appendChild(el('div', 'up-next', `Next: ${next.name} · <b>${line.format(next.value)}</b>`));
        card.appendChild(button(`${picked ? SPACE : ''}${money(next.cost)}`, buy, p.cash >= next.cost ? 'primary' : '', p.cash < next.cost));
        if (picked) this.confirm = buy;
      } else {
        card.appendChild(el('div', 'up-next', 'Fully upgraded'));
      }
      card.title = line.blurb;
    });
    this.nav = this.gridNav(UPGRADE_ORDER.length);
    box.appendChild(el('p', 'note keys', '<kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> pick · <kbd>Space</kbd> buy · <kbd>E</kbd> leave'));
    box.appendChild(this.cashLine());
    return box;
  }

  private repairPanel(): HTMLElement {
    const p = this.s.player;
    const st = statsOf(p);
    const box = el('div', 'pnl');
    box.appendChild(this.meter('Hull', p.rig.hull / st.maxHull, `${Math.ceil(p.rig.hull)} / ${st.maxHull}`, 'g-hull'));
    const cost = repairCost(p);
    const fix = () => this.run({ a: 'repair' }, (r) => this.finish(`+${Math.max(1, Math.round(r.amount ?? 0))} hull`, FLOAT.hull));
    if (cost <= 0) box.appendChild(button('No damage', () => {}, 'wide', true));
    else if (p.cash >= cost) box.appendChild(button(`${SPACE}Repair · ${money(cost)}`, fix, 'primary wide'));
    else box.appendChild(button(p.cash > 0 ? `${SPACE}Repair ${money(p.cash)} worth` : 'No cash', fix, 'primary wide', p.cash <= 0));
    this.confirm = cost > 0 && p.cash > 0 ? fix : () => this.closePanel();
    box.appendChild(el('p', 'note', 'Falls, rockfalls, gas pockets, steam, magma and heat all wear down the hull. At zero the rig is lost with the ore on board, and you start again from the station.'));
    box.appendChild(this.cashLine());
    return box;
  }

  private supplyPanel(): HTMLElement {
    const p = this.s.player;
    const box = el('div', 'pnl');
    const grid = box.appendChild(el('div', 'shop-items'));
    this.sel = Math.max(0, Math.min(ITEM_ORDER.length - 1, this.sel));
    ITEM_ORDER.forEach((k, i) => {
      const it = ITEMS[k];
      const have = p.items[k] ?? 0;
      const picked = i === this.sel;
      const card = grid.appendChild(el('div', `it${picked ? ' sel' : ''}`));
      card.appendChild(el('div', 'it-h', `${icon(k)}<b>${it.name}</b><span class="dim">${have}/${ITEM_STACK}</span>`));
      card.appendChild(el('p', 'note', `${it.blurb} Key ${it.hotkey}.`));
      const buy = () => {
        this.sel = i;
        this.run({ a: 'buy', k }, () => this.hooks.float(`+${it.name}`, FLOAT.gear));
      };
      card.appendChild(button(`${picked ? SPACE : ''}${money(it.cost)}`, buy, '', p.cash < it.cost || have >= ITEM_STACK));
      if (picked) this.confirm = buy;
    });
    this.nav = this.gridNav(ITEM_ORDER.length);
    box.appendChild(el('p', 'note keys', '<kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> pick · <kbd>Space</kbd> buy · <kbd>E</kbd> leave'));
    box.appendChild(this.cashLine());
    return box;
  }

  /** Online, with other miners around: an empty tank strands you instead of ending the rig. */
  showStalled(): void {
    this.openPanel('Out of fuel', () => {
      const p = this.s.player;
      const box = el('div', 'pnl');
      const where = p.rig.grounded ? "The rig won't move." : 'The parachute is out and the rig is drifting down.';
      box.appendChild(el('p', '', `Your tank is dry at <b>${meters(rigDepth(p.rig))}</b>. ${where}`));
      const others = Math.max(1, this.s.onlineCount() - 1);
      box.appendChild(el('p', 'note', `Your SOS is out to ${others === 1 ? 'the other miner' : `the ${others} other miners`} on the ice, with an arrow pointing your way. Anyone with a Fuel Cell can park next to you and refuel you. You keep your ore and pay them ${money(rescueFee(p))}.`));
      box.appendChild(button(`${SPACE}Keep waiting`, () => this.closePanel(), 'primary wide'));
      this.confirm = () => this.closePanel();
      if ((p.items.beacon ?? 0) > 0) {
        box.appendChild(button(`Use a Recall Beacon and keep your ore (${p.items.beacon} left)`, () => {
          this.closePanel();
          this.s.act({ a: 'use', k: 'beacon' });
        }, 'wide'));
      }
      const lost = cargoCount(p);
      box.appendChild(button(`Give up and respawn${lost ? ` · lose ${lost} ore` : ''}`, () => {
        this.closePanel(false);
        this.hooks.giveUp();
      }, 'wide danger'));
      box.appendChild(el('p', 'note', 'Giving up costs the ore on board and nothing else. You start again at the station with a full tank and hull.'));
      return box;
    }, false, 'stall');
  }

  // ------------------------------------------------------------ cutscenes

  /** While a cutscene plays: black bars, no HUD, no panels. */
  setBusy(on: boolean): void {
    this.busy = on;
    this.root.classList.toggle('cine', on);
    if (on) {
      this.prompt.classList.remove('show');
      this.promptKey = '';
    }
  }

  showDeath(cause: HurtCause, depth: number, lost: number, value: number): void {
    const d = DEATHS[cause];
    const where = depth > 0.5 ? meters(depth) : 'the surface';
    const radio = d.radio[Math.floor(Math.random() * d.radio.length)];
    const loss = lost ? `Lost ${lost} ore worth ${money(value)}.` : 'The cargo bay was empty.';
    this.death.innerHTML = `<b>${d.title}</b><span>${d.sub} at ${where}</span><em>${radio}</em><small>${loss} Cash, upgrades and items are safe.</small>`;
    this.death.classList.add('show');
    // A layer banner would sit right on top of it.
    this.banner.classList.remove('show');
  }

  hideDeath(): void {
    this.death.classList.remove('show');
  }

  showDisconnected(reason: string, retry: () => void): void {
    this.openPanel('Connection lost', () => {
      const box = el('div', 'pnl');
      box.appendChild(el('p', '', esc(reason)));
      box.appendChild(button('Reconnect', retry, 'primary wide'));
      box.appendChild(button('Back to title', () => this.hooks.leave(), 'wide'));
      return box;
    }, false);
  }

  openMenu(): void {
    if (this.busy) return;
    this.openPanel('Menu', () => {
      const p = this.s.player;
      const box = el('div', 'pnl');
      this.confirm = () => this.closePanel();
      box.appendChild(button(`${SPACE}Resume`, () => this.closePanel(), 'primary wide'));
      box.appendChild(button('Map', () => this.openMap(), 'wide'));
      if (this.s.online) box.appendChild(button('Standings', () => this.openBoards(), 'wide'));
      box.appendChild(button(this.sfx.muted ? 'Sound: off' : 'Sound: on', () => {
        this.sfx.setMuted(!this.sfx.muted);
        this.rerender();
      }, 'wide'));
      box.appendChild(button(this.sfx.musicOn ? 'Music: on' : 'Music: off', () => {
        this.sfx.setMusic(!this.sfx.musicOn);
        this.rerender();
      }, 'wide'));
      box.appendChild(button(quality() === 'high' ? 'Graphics: high' : 'Graphics: low', () => {
        this.hooks.setQuality(quality() === 'high' ? 'low' : 'high');
        this.rerender();
      }, 'wide'));
      if (this.s.online && this.code) {
        const c = prettyCode(this.code);
        const row = box.appendChild(el('div', 'code-show'));
        row.appendChild(el('p', '', `Your code: <b>${c}</b>`));
        row.appendChild(button('Copy', () => {
          void navigator.clipboard?.writeText(c).then(() => this.toast('Code copied', 'good', 1400));
        }));
        box.appendChild(el('p', 'note', 'Enter this code on another phone or computer to play as the same miner. Keep it to yourself: anyone with it can play as you.'));
      }
      box.appendChild(button('Back to title', () => this.hooks.leave(), 'wide'));
      if (!this.s.online) {
        box.appendChild(button('Start over', () => {
          if (confirm('Start over? Your rig, cash and dug tunnels will be lost.')) this.hooks.newOffline();
        }, 'wide danger'));
      }
      box.appendChild(
        el('p', 'note', `Deepest: <b>${meters(p.stats.deepest)}</b> · Earned: <b>${money(p.stats.earned)}</b> · Trips sold: <b>${p.stats.trips}</b> · Tiles dug: <b>${p.stats.dug}</b>${p.stats.rescues ? ` · Rescues: <b>${p.stats.rescues}</b>` : ''}${p.stats.deaths ? ` · Rigs lost: <b>${p.stats.deaths}</b>` : ''} · Recorders: <b>${p.logs.length}/${LOGS.length}</b>${p.prestige ? ` · Prestige: <b>${stars(p.prestige)}</b>${p.stats.hearthBest ? ` · Fastest Hearth: <b>${clock(p.stats.hearthBest)}</b>` : ''}` : ''}`),
      );
      box.appendChild(el('p', 'note dim', `Permafrost v${__APP_VERSION__}. ${this.s.online ? 'Saved on the server.' : 'Saved in this browser.'}`));
      return box;
    });
  }
}

const NAV_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
};

type Prompt = { kind: 'building'; b: Building } | { kind: 'stall' } | { kind: 'aid'; id: string; name: string } | { kind: 'gate' } | { kind: 'exit' };

export function layerForDepth(d: number): number {
  let i = 0;
  for (let k = 0; k < LAYERS.length; k++) if (d >= LAYERS[k].top) i = k;
  return i;
}
