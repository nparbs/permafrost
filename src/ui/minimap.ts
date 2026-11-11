// The map: a small window around your rig in the HUD (shown while other miners are online),
// and a full-width map of the dug-out world with everyone on it. Ore isn't drawn, so the map
// shows where people are and where the tunnels go, but it's no ore scanner.

import type { GameSession, MapPeer } from '../game/session';
import { LAYER_PAL, PAINTS } from '../game/textures';
import { RIG_SOS, RIG_STALLED, RIG_WRECKED } from '../net/protocol';
import { T } from '../sim/tiles';
import { METERS_PER_TILE, SKY, type World } from '../sim/world';

type RGB = [number, number, number];

const SKY_RGB: RGB = [16, 30, 54];
const TUNNEL: RGB = [5, 8, 14];
const FIXED: Partial<Record<number, RGB>> = {
  [T.MAGMA]: [255, 106, 32],
  [T.WATER]: [74, 154, 224],
  [T.PAD]: [150, 172, 196],
  [T.WALL]: [18, 18, 24],
  [T.RIME]: [150, 186, 210],
  [T.SLAG]: [44, 38, 42],
  [T.VENT]: [140, 90, 60],
};
const GROUND: RGB[] = LAYER_PAL.map((p) => p.base.map((v) => Math.round(v * 0.55)) as RGB);

function tileRGB(w: World, x: number, y: number): RGB {
  if (y < SKY) return SKY_RGB;
  if (x < 0 || x >= w.w || y >= w.h) return FIXED[T.WALL]!;
  const t = w.tiles[y * w.w + x];
  if (t === T.AIR) return TUNNEL;
  return FIXED[t] ?? GROUND[w.layerAt(x, y)];
}

const hexRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAINT_RGB = PAINTS.map(hexRGB);
const SOS_RGB: RGB = [255, 70, 60];

const needsHelp = (p: MapPeer) => (p.flags & RIG_STALLED) > 0 && !(p.flags & RIG_WRECKED);

/** "120 m down, 40 m left" from you to them. */
export function bearing(meX: number, meY: number, x: number, y: number): string {
  const dx = Math.round(x - meX);
  const dy = Math.round(y - meY);
  const parts: string[] = [];
  if (Math.abs(dy) >= 1) parts.push(`${Math.abs(dy) * METERS_PER_TILE} m ${dy > 0 ? 'down' : 'up'}`);
  if (Math.abs(dx) >= 1) parts.push(`${Math.abs(dx) * METERS_PER_TILE} m ${dx > 0 ? 'right' : 'left'}`);
  return parts.length ? parts.join(', ') : 'right here';
}

class Pixels {
  readonly img: ImageData;
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly w: number,
    readonly h: number,
  ) {
    this.img = ctx.createImageData(w, h);
  }
  set(x: number, y: number, c: RGB, a = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.img.data;
    d[i] = d[i] * (1 - a) + c[0] * a;
    d[i + 1] = d[i + 1] * (1 - a) + c[1] * a;
    d[i + 2] = d[i + 2] * (1 - a) + c[2] * a;
    d[i + 3] = 255;
  }
  /** A square marker with a dark outline, centred on (x, y). */
  dot(x: number, y: number, c: RGB, r: number): void {
    for (let j = -r - 1; j <= r + 1; j++) for (let i = -r - 1; i <= r + 1; i++) this.set(x + i, y + j, [0, 0, 0], 0.85);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) this.set(x + i, y + j, c);
  }
  ring(x: number, y: number, c: RGB, r: number): void {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (Math.max(Math.abs(i), Math.abs(j)) === r) this.set(x + i, y + j, c);
  }
  flush(): void {
    this.ctx.putImageData(this.img, 0, 0);
  }
}

/** The HUD minimap: a window around your rig, with arrows at the edge for miners outside it. */
export class Minimap {
  static readonly VW = 64;
  static readonly VH = 44;
  readonly root: HTMLButtonElement;
  private px: Pixels;
  private last = 0;
  private shown = false;

  constructor(onOpen: () => void) {
    this.root = document.createElement('button');
    this.root.className = 'minimap hidden';
    this.root.title = 'Map (N)';
    const cv = document.createElement('canvas');
    cv.width = Minimap.VW;
    cv.height = Minimap.VH;
    this.root.appendChild(cv);
    this.root.addEventListener('click', (e) => {
      e.stopPropagation();
      onOpen();
    });
    this.px = new Pixels(cv.getContext('2d')!, Minimap.VW, Minimap.VH);
  }

  frame(s: GameSession, show: boolean): void {
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('hidden', !show);
      this.last = 0;
    }
    if (!show) return;
    const now = performance.now();
    if (now - this.last < 150) return;
    this.last = now;
    const w = s.world;
    const me = s.renderPos();
    const { VW, VH } = Minimap;
    const ox = Math.floor(me.x) - (VW >> 1);
    const oy = Math.floor(me.y) - (VH >> 1);
    const px = this.px;
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) px.set(x, y, tileRGB(w, ox + x, oy + y));
    const blink = Math.floor(now / 400) % 2 === 0;
    for (const p of s.mapPeers()) {
      const c = PAINT_RGB[p.paint] ?? PAINT_RGB[0];
      const x = p.x - ox;
      const y = p.y - oy;
      const help = needsHelp(p);
      if (x >= 1 && y >= 1 && x < VW - 1 && y < VH - 1) {
        px.dot(x, y, help && blink ? SOS_RGB : c, 1);
        if (help) px.ring(x, y, SOS_RGB, 3);
        continue;
      }
      // Off the window: an arrow on the edge pointing at them.
      const cx = VW / 2;
      const cy = VH / 2;
      const dx = x - cx;
      const dy = y - cy;
      const k = Math.min((cx - 2) / Math.max(1e-6, Math.abs(dx)), (cy - 2) / Math.max(1e-6, Math.abs(dy)));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const col = help && blink ? SOS_RGB : c;
      px.dot(ex, ey, col, 1);
      px.set(ex - Math.sign(dx) * 2.4, ey - Math.sign(dy) * 2.4, col, 0.7);
    }
    px.dot(me.x - ox, me.y - oy, blink ? [255, 255, 255] : [190, 230, 255], 1);
    px.flush();
  }
}

/** The full map panel: who's where, then the whole dug-out world with everyone on it. */
export class WorldMap {
  readonly box: HTMLElement;
  private list: HTMLElement;
  private cv: HTMLCanvasElement;
  private px: Pixels | null = null;
  private rows = 0;
  private last = 0;

  constructor(private s: GameSession) {
    this.box = document.createElement('div');
    this.box.className = 'pnl world-map';
    this.list = this.box.appendChild(document.createElement('div'));
    this.list.className = 'map-list';
    this.cv = this.box.appendChild(document.createElement('canvas'));
    this.cv.className = 'map-cv';
    const key = this.box.appendChild(document.createElement('p'));
    key.className = 'note';
    key.textContent = 'You are the blinking white square. Ore is not shown. Miners out of fuel blink red: park next to them and hand over a Fuel Cell to earn a rescue fee.';
    this.draw(true);
  }

  /** Redraw, at most twice a second unless forced. */
  draw(force = false): void {
    const now = performance.now();
    if (!force && now - this.last < 500) return;
    this.last = now;
    const s = this.s;
    const w = s.world;
    const me = s.renderPos();
    const peers = s.mapPeers();

    // Everyone, nearest first.
    const dist = (p: MapPeer) => Math.hypot(p.x - me.x, p.y - me.y);
    const sorted = [...peers].sort((a, b) => Number(needsHelp(b)) - Number(needsHelp(a)) || dist(a) - dist(b));
    this.list.replaceChildren();
    if (!sorted.length) {
      const p = this.list.appendChild(document.createElement('p'));
      p.className = 'empty-note';
      p.textContent = s.online ? 'Nobody else is out on the ice right now.' : 'Offline: just you and the ice.';
    }
    for (const p of sorted) {
      const row = this.list.appendChild(document.createElement('div'));
      row.className = `map-row${needsHelp(p) ? ' sos' : ''}`;
      const depth = Math.max(0, Math.floor(p.y - SKY)) * METERS_PER_TILE;
      const sw = `<i class="sw" style="background:${PAINTS[p.paint] ?? PAINTS[0]}"></i>`;
      const tag = needsHelp(p) ? `<em>${p.flags & RIG_SOS ? 'SOS' : 'Stalled'}</em>` : '';
      const name = p.name.replace(/[&<>"']/g, '');
      row.innerHTML = `<b>${sw}${name}${tag}</b><span>${depth ? `${depth} m deep` : 'Surface'} · ${bearing(me.x, me.y, p.x, p.y)}</span>`;
    }

    // Draw from the sky down to a little below the deepest miner.
    let deepest = me.y;
    for (const p of peers) deepest = Math.max(deepest, p.y);
    const rows = Math.min(w.h, Math.max(SKY + 40, Math.ceil(deepest) + 16));
    if (!this.px || rows !== this.rows || this.cv.width !== w.w) {
      this.rows = rows;
      this.cv.width = w.w;
      this.cv.height = rows;
      this.px = new Pixels(this.cv.getContext('2d')!, w.w, rows);
    }
    const px = this.px;
    for (let y = 0; y < rows; y++) for (let x = 0; x < w.w; x++) px.set(x, y, tileRGB(w, x, y));
    const blink = Math.floor(now / 500) % 2 === 0;
    for (const p of peers) {
      const help = needsHelp(p);
      px.dot(p.x, p.y, help && blink ? SOS_RGB : PAINT_RGB[p.paint] ?? PAINT_RGB[0], 1);
      if (help) px.ring(p.x, p.y, SOS_RGB, 4);
    }
    // A faint line across at your depth, so you can find yourself at a glance.
    for (let x = 0; x < w.w; x += 2) px.set(x, me.y, [255, 255, 255], 0.25);
    px.dot(me.x, me.y, blink ? [255, 255, 255] : [150, 210, 255], 1);
    px.flush();
  }

  /** Where your rig sits on the canvas, as a share of its height, for scrolling it into view. */
  meShare(): number {
    return this.rows ? this.s.renderPos().y / this.rows : 0;
  }

  get canvas(): HTMLCanvasElement {
    return this.cv;
  }
}
