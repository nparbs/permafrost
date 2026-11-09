// The HTML layer over the game: HUD, station panels, dialogs, chat, title screen and touch controls.

import type { Sfx } from '../game/audio';
import type { GameSession } from '../game/session';
import { PAINTS } from '../game/textures';
import { CHAT_MAX, NAME_MAX, PAINT_COUNT, cleanName } from '../net/protocol';
import type { Action, ActResult } from '../sim/actions';
import { ITEMS, ITEM_ORDER, ITEM_STACK, type ItemKey } from '../sim/items';
import { cargoCount, cargoValue, statsOf } from '../sim/player';
import { rigDepth, type Input } from '../sim/rig';
import { FUEL_PRICE, buildingAt, refuelCost, repairCost, saleLines, towFee } from '../sim/station';
import { tempAtDepth } from '../sim/temperature';
import { ambientTemp, blizzardAt } from '../sim/weather';
import { LAYERS, MINERALS } from '../sim/tiles';
import { UPGRADES, UPGRADE_ORDER } from '../sim/upgrades';
import { METERS_PER_TILE, type Building } from '../sim/world';

declare const __APP_VERSION__: string;

export const money = (n: number) => '$' + Math.floor(n).toLocaleString('en-US');
export const meters = (tiles: number) => `${Math.max(0, Math.floor(tiles)) * METERS_PER_TILE} m`;
export const prettyCode = (t: string) => t.replace(/(.{4})(?=.)/g, '$1-');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function button(label: string, onClick: () => void, cls = '', disabled = false): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label);
  b.disabled = disabled;
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
  private nearBuilding: Building | null = null;
  private textCache = new WeakMap<HTMLElement, string>();
  private highestLayer = 0;
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
    this.chatLog = left.appendChild(el('div', 'chat-log'));
    const read = top.appendChild(el('div', 'readout'));
    this.cash = read.appendChild(el('div', 'cash'));
    this.depth = read.appendChild(el('div', 'depth'));
    this.temp = read.appendChild(el('div', 'temp'));
    this.onlineEl = read.appendChild(el('div', 'online'));
    const btns = read.appendChild(el('div', 'hud-btns'));
    this.chatBtn = btns.appendChild(button('Chat', () => this.openChat(), 'menu-btn chat-btn'));
    this.chatBtn.title = 'Chat (T)';
    btns.appendChild(button('Menu', () => this.openMenu(), 'menu-btn')).title = 'Menu (Esc)';

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
         <p><kbd>E</kbd> enter a building · <kbd>1</kbd>–<kbd>6</kbd> items · <kbd>T</kbd> chat · <kbd>M</kbd> mute · <kbd>Esc</kbd> menu</p>`,
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
    this.setGauge(this.gauges.fuel, fuelK, `${r.fuel.toFixed(1)} / ${st.tank} L`, fuelK < 0.2 && d > 0.5);
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
    this.setText(this.onlineEl, this.s.online ? `● ${this.s.onlineCount()} online` : 'Offline');
    this.root.classList.toggle('cold', r.cold);
    this.root.classList.toggle('hot', r.hot);


    for (const [k, b] of this.itemBtns) {
      const c = p.items[k] ?? 0;
      this.setText(b.querySelector('span')!, c ? String(c) : '');
      b.classList.toggle('empty', c === 0);
    }

    const near = this.render ? null : buildingAt(this.s.world, p);
    if (near !== this.nearBuilding) {
      this.nearBuilding = near;
      this.prompt.classList.toggle('show', !!near);
      if (near) this.prompt.innerHTML = `<kbd>E</kbd><b>Enter</b><span>${near.name}</span>`;
    }

    const layer = layerForDepth(d);
    if (layer > this.highestLayer) {
      this.highestLayer = layer;
      const L = LAYERS[layer];
      this.showBanner(L.name, `${meters(L.top)} · ${Math.round(tempAtDepth(L.top))}°C`);
    }
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
    if (this.render || this.titleOpen) return;
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

  interact(): void {
    if (this.render || this.titleOpen) return;
    const b = buildingAt(this.s.world, this.s.player);
    if (b) this.openBuilding(b);
  }

  openPanel(title: string, render: () => HTMLElement, closable = true): void {
    this.render = render;
    this.closable = closable;
    this.panelTitle.textContent = title;
    this.panelClose.classList.toggle('hidden', !closable);
    this.panel.classList.remove('hidden');
    this.closeChat();
    this.s.releaseInput();
    this.s.paused = true;
    this.prompt.classList.remove('show');
    this.nearBuilding = null;
    this.rerender();
  }

  rerender(): void {
    if (this.render) this.panelBody.replaceChildren(this.render());
  }

  closePanel(save = true): void {
    if (!this.render) return;
    this.render = null;
    this.panel.classList.add('hidden');
    if (this.s && !this.titleOpen) this.s.paused = false;
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
    if (this.chatOpen) return true;
    if (this.render) {
      if (e.code === 'Escape' || (e.code === 'KeyE' && this.closable)) {
        if (this.closable) this.closePanel();
        e.preventDefault();
      }
      return true;
    }
    if (e.code === 'Escape') {
      this.openMenu();
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
    };
    this.sfx.click();
    this.openPanel(b.name, panels[b.key]);
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
    const fill = () => this.run({ a: 'refuel' });
    if (cost <= 0) row.appendChild(button('Tank is full', () => {}, '', true));
    else if (p.cash >= cost) row.appendChild(button(`Fill up · ${money(cost)}`, fill, 'primary'));
    else row.appendChild(button(p.cash > 0 ? `Buy ${money(p.cash)} worth` : 'No cash', fill, 'primary', p.cash <= 0));
    const five = Math.min(5, st.tank - p.rig.fuel);
    row.appendChild(button(`+${five.toFixed(0)} L · ${money(Math.ceil(five * FUEL_PRICE))}`, () => this.run({ a: 'refuel', litres: 5 }), '', five < 0.5 || p.cash < 1));
    box.appendChild(el('p', 'note', `Fuel is ${money(FUEL_PRICE)} a litre. Cold below your heater's range makes the engine burn more.`));
    box.appendChild(this.cashLine());
    return box;
  }

  private assayPanel(): HTMLElement {
    const p = this.s.player;
    const box = el('div', 'pnl');
    const lines = saleLines(p);
    if (!lines.length) {
      box.appendChild(el('p', 'empty-note', 'Your cargo bay is empty. Bring up ore and we will weigh it.'));
    } else {
      const tbl = box.appendChild(el('table', 'sale'));
      for (const l of lines) {
        const m = MINERALS.find((mm) => mm.key === l.key)!;
        tbl.appendChild(el('tr', '', `<td><i class="sw" style="background:${m.color}"></i>${l.name}</td><td>${l.count} × ${money(l.each)}</td><td>${money(l.total)}</td>`));
      }
      box.appendChild(button(`Sell everything · ${money(cargoValue(p))}`, () => this.run({ a: 'sell' }, (r) => this.toast(`Sold for <b>${money(r.total ?? 0)}</b>`, 'good')), 'primary wide'));
    }
    const list = el('details', 'prices');
    list.appendChild(el('summary', '', 'Price list'));
    const tbl = list.appendChild(el('table', 'sale'));
    for (const m of MINERALS) {
      const seen = p.seen.includes(m.key);
      tbl.appendChild(el('tr', seen ? '' : 'unknown', `<td><i class="sw" style="background:${seen ? m.color : '#333'}"></i>${seen ? m.name : '???'}</td><td></td><td>${seen ? money(m.value) : '?'}</td>`));
    }
    box.appendChild(list);
    box.appendChild(this.cashLine());
    return box;
  }

  private shopPanel(): HTMLElement {
    const p = this.s.player;
    const box = el('div', 'pnl');
    const grid = box.appendChild(el('div', 'ups'));
    for (const key of UPGRADE_ORDER) {
      const line = UPGRADES[key];
      const tier = p.upgrades[key];
      const cur = line.tiers[tier];
      const next = line.tiers[tier + 1];
      const card = grid.appendChild(el('div', 'up'));
      const pips = line.tiers.map((_, i) => `<i class="${i <= tier ? 'on' : ''}"></i>`).join('');
      card.appendChild(el('div', 'up-h', `<b>${line.name}</b><span class="pips">${pips}</span>`));
      card.appendChild(el('div', 'up-cur', `${cur.name} · ${line.format(cur.value)}`));
      if (next) {
        card.appendChild(el('div', 'up-next', `Next: ${next.name} · <b>${line.format(next.value)}</b>`));
        card.appendChild(button(money(next.cost), () => this.run({ a: 'upgrade', k: key }, () => this.toast(`Installed: ${next.name}`, 'good')), p.cash >= next.cost ? 'primary' : '', p.cash < next.cost));
      } else {
        card.appendChild(el('div', 'up-next', 'Fully upgraded'));
      }
      card.title = line.blurb;
    }
    box.appendChild(this.cashLine());
    return box;
  }

  private repairPanel(): HTMLElement {
    const p = this.s.player;
    const st = statsOf(p);
    const box = el('div', 'pnl');
    box.appendChild(this.meter('Hull', p.rig.hull / st.maxHull, `${Math.ceil(p.rig.hull)} / ${st.maxHull}`, 'g-hull'));
    const cost = repairCost(p);
    const fix = () => this.run({ a: 'repair' });
    if (cost <= 0) box.appendChild(button('No damage', () => {}, 'wide', true));
    else if (p.cash >= cost) box.appendChild(button(`Repair · ${money(cost)}`, fix, 'primary wide'));
    else box.appendChild(button(p.cash > 0 ? `Repair ${money(p.cash)} worth` : 'No cash', fix, 'primary wide', p.cash <= 0));
    box.appendChild(el('p', 'note', 'Falls, rockfalls, gas pockets, steam, magma and heat all wear down the hull. At zero the rig is wrecked and towed home, and the cargo is lost.'));
    box.appendChild(this.cashLine());
    return box;
  }

  private supplyPanel(): HTMLElement {
    const p = this.s.player;
    const box = el('div', 'pnl');
    const grid = box.appendChild(el('div', 'shop-items'));
    for (const k of ITEM_ORDER) {
      const it = ITEMS[k];
      const have = p.items[k] ?? 0;
      const card = grid.appendChild(el('div', 'it'));
      card.appendChild(el('div', 'it-h', `${icon(k)}<b>${it.name}</b><span class="dim">${have}/${ITEM_STACK}</span>`));
      card.appendChild(el('p', 'note', `${it.blurb} Key ${it.hotkey}.`));
      card.appendChild(button(money(it.cost), () => this.run({ a: 'buy', k }), '', p.cash < it.cost || have >= ITEM_STACK));
    }
    box.appendChild(this.cashLine());
    return box;
  }

  showStalled(): void {
    this.openPanel('Out of fuel', () => {
      const p = this.s.player;
      const box = el('div', 'pnl');
      box.appendChild(el('p', '', `Your tank is dry at <b>${meters(rigDepth(p.rig))}</b>. The rig won't move.`));
      if ((p.items.fuelcell ?? 0) > 0) {
        box.appendChild(button(`Use a Fuel Cell (${p.items.fuelcell} left)`, () => {
          this.closePanel();
          this.s.act({ a: 'use', k: 'fuelcell' });
        }, 'primary wide'));
      }
      box.appendChild(this.towButton('Call a tow'));
      box.appendChild(el('p', 'note', 'Soon other miners will be able to answer an SOS and bring you fuel.'));
      return box;
    }, false);
  }

  showWrecked(): void {
    this.openPanel('Rig wrecked', () => {
      const box = el('div', 'pnl');
      box.appendChild(el('p', '', 'The hull gave out. A salvage crew can haul what is left back to the station.'));
      box.appendChild(this.towButton('Call salvage'));
      return box;
    }, false);
  }

  private towButton(label: string): HTMLElement {
    const p = this.s.player;
    const fee = towFee(p);
    const lost = cargoCount(p);
    return button(`${label} · ${money(fee)}${lost ? `, lose ${lost} ore` : ''}`, () => {
      const r = this.s.act({ a: 'tow' });
      this.closePanel();
      if (r.ok) this.toast(`Towed back to Rime Station for ${money(r.total ?? fee)}.`, 'warn', 3200);
    }, 'wide');
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
    this.openPanel('Menu', () => {
      const p = this.s.player;
      const box = el('div', 'pnl');
      box.appendChild(button('Resume', () => this.closePanel(), 'primary wide'));
      box.appendChild(button(this.sfx.muted ? 'Sound: off' : 'Sound: on', () => {
        this.sfx.setMuted(!this.sfx.muted);
        this.rerender();
      }, 'wide'));
      box.appendChild(button(this.sfx.musicOn ? 'Music: on' : 'Music: off', () => {
        this.sfx.setMusic(!this.sfx.musicOn);
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
        el('p', 'note', `Deepest: <b>${meters(p.stats.deepest)}</b> · Earned: <b>${money(p.stats.earned)}</b> · Trips sold: <b>${p.stats.trips}</b> · Tiles dug: <b>${p.stats.dug}</b>`),
      );
      box.appendChild(el('p', 'note dim', `Permafrost v${__APP_VERSION__}. ${this.s.online ? 'Saved on the server.' : 'Saved in this browser.'}`));
      return box;
    });
  }
}

export function layerForDepth(d: number): number {
  let i = 0;
  for (let k = 0; k < LAYERS.length; k++) if (d >= LAYERS[k].top) i = k;
  return i;
}
