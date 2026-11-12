// All art is drawn here in code: the tileset, the rig, the station buildings and the sky.

import type Phaser from 'phaser';
import { hash3, valueNoise } from '../sim/rng';
import { LAYERS, MINERALS, MINERAL_BASE, T, isMineral, isSolid } from '../sim/tiles';
import { SKY, type BuildingKey, type World } from '../sim/world';

export const TS = 16;
const COLS = 64;
/** Tunnel backs: BACK_BASE + layer * 4 + (solid above ? 1 : 0) + (solid left ? 2 : 0). */
export const BACK_BASE = 64;
/** Things set into the ground: EMB_BASE + kind * 8 + layer. */
export const EMB_BASE = 96;
const EMB_GAS = MINERALS.length;
const EMB_BOULDER = MINERALS.length + 1;
/** Tiles with ids past the minerals: EXTRA_BASE + (vent 0-3, slag 4-7, water 8 + layer * 2 + (surface ? 0 : 1)). */
const EXTRA_BASE = EMB_BASE + (MINERALS.length + 2) * 8;
/**
 * What the Hollow's builders left (v0.5): BUILT_BASE + (cut stone 0-3, heat vent 4, Hearth body 5-8,
 * heart 9, gate 10, recorder 11 + layer).
 */
const BUILT_BASE = EXTRA_BASE + 8 + LAYERS.length * 2;
const TILE_COUNT = BUILT_BASE + 11 + LAYERS.length;
/**
 * Rounded tunnel edges use a second grid, offset by half a tile, so each cell sits on a tile corner
 * and sees the four tiles that meet there: OVER_BASE + layer * 32 + (top two are sky ? 16 : 0) + open,
 * where open has 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right.
 */
export const OVER_BASE = Math.ceil(TILE_COUNT / COLS) * COLS;
const OVER_COUNT = LAYERS.length * 32;
/** Overlay frames that come out empty, so the grid can leave them blank. */
const OVER_EMPTY = new Uint8Array(OVER_COUNT);
/** Corner radius of dug edges, in pixels. Keep it at or under TS / 2 - 2. */
const CORNER = 6;

type RGB = [number, number, number];

/** True while the high-detail art is being painted. The painters check it. */
let HD = false;
/** Which art the scene is showing now. */
let showHD = false;
/** The tileset texture in use. */
export const tilesKey = (): string => (showHD ? 'tiles-hd' : 'tiles');
/** The rig texture for a paint colour, in the art in use. */
export const rigKey = (paint: number): string => `${showHD ? 'righd' : 'rig'}${paint}`;
/** How much darker tunnel backs are in the high-detail art, so the rig and the ore stand out. */
const BACK_DIM = 0.24;
/** The tunnel-back colour of a layer in the art in use. */
export const backColor = (layer: number): RGB => (showHD ? shade(LAYER_PAL[layer].back, -BACK_DIM) : LAYER_PAL[layer].back);

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const shade = (a: RGB, k: number): RGB => (k >= 0 ? mix(a, [255, 255, 255], k) : mix(a, [0, 0, 0], -k));
export const rgbNum = (c: RGB) => ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);

interface Pal {
  base: RGB;
  dark: RGB;
  light: RGB;
  back: RGB;
  accent: RGB;
}
const pal = (base: string, dark: string, light: string, back: string, accent = light): Pal => ({
  base: hex(base), dark: hex(dark), light: hex(light), back: hex(back), accent: hex(accent),
});

export const LAYER_PAL: Pal[] = [
  pal('#e6eef7', '#b4c4d8', '#ffffff', '#56667e'),
  pal('#c2d2e3', '#94aac4', '#e8f0f8', '#46566e'),
  pal('#6cb2df', '#3d82b6', '#bfe6ff', '#1d3c5a', '#e8f8ff'),
  pal('#5b4737', '#3d2f24', '#7d6a58', '#2a2019', '#d2e2ec'),
  pal('#6a6a73', '#4a4a53', '#8c8c96', '#25252b'),
  pal('#3b3236', '#262024', '#574a4f', '#1c1416', '#ff6a20'),
  pal('#2d2a46', '#1c1a31', '#4b4872', '#141225', '#40e0c8'),
];

/** The colour of debris for a tile, for particles. */
export function debrisColor(world: World, x: number, y: number, tile: number): number {
  if (isMineral(tile)) return rgbNum(hex(MINERALS[tile - MINERAL_BASE].color));
  if (tile === T.MAGMA) return 0xff7a20;
  if (tile === T.RIME) return 0xdff2ff;
  if (tile === T.SLAB) return 0x9fd4f2;
  if (tile === T.MELT || tile === T.WATER) return 0x4a9ae0;
  if (tile === T.SLAG) return 0x3a3236;
  if (tile === T.VENT) return 0x8a8a90;
  if (tile === T.CARVED) return 0x4b4872;
  if (tile === T.HVENT || tile === T.HCORE) return 0x5a5a66;
  if (tile === T.HEART) return 0xff4fa8;
  return rgbNum(LAYER_PAL[world.layerAt(x, y)].base);
}

class Px {
  readonly img: ImageData;
  constructor(readonly w: number, readonly h: number) {
    this.img = new ImageData(w, h);
  }
  set(x: number, y: number, c: RGB, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.img.data;
    if (a >= 255) {
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    } else {
      const k = a / 255;
      d[i] = d[i] + (c[0] - d[i]) * k;
      d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * k;
      d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * k;
      d[i + 3] = Math.max(d[i + 3], a);
    }
  }
  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    const d = this.img.data;
    return [d[i], d[i + 1], d[i + 2]];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a);
  }
  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.img.data[(y * this.w + x) * 4 + 3];
  }
}

/** Draw a one-pixel outline around whatever is painted inside a box. */
function outline(px: Px, x0: number, y0: number, w: number, h: number, c: RGB, a = 255) {
  const solid = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h && px.alpha(x, y) > 200;
  const edge: [number, number][] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push([x, y]);
    }
  }
  for (const [x, y] of edge) px.set(x, y, c, a);
}

// ---------------------------------------------------------------- tiles

function paintLayer(px: Px, ox: number, oy: number, layer: number, v: number) {
  const p = LAYER_PAL[layer];
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const n = hash3(x + v * 17, y, 11 + layer);
      const m = valueNoise((x + v * 16) / 4, y / 4, 5 + layer);
      let c: RGB = p.base;
      switch (layer) {
        case 0: // snow: soft drifts and sparkles
          c = mix(p.base, p.dark, Math.max(0, m - 0.55) * 0.9);
          if (n > 0.95) c = p.light;
          break;
        case 1: { // firn: compacted bands
          const band = Math.floor((y + valueNoise(x / 6 + v * 3, 0.5, 9) * 4) / 4) % 2;
          c = band ? mix(p.base, p.dark, 0.35) : p.base;
          if (n > 0.96) c = p.light;
          break;
        }
        case 2: // glacier ice: streaks and cracks
          c = mix(p.base, p.light, m * 0.3);
          if ((x + y + v * 3) % 11 === 0) c = mix(c, p.light, 0.6);
          if ((x * 2 - y + v * 7 + 64) % 13 === 0 && n > 0.3) c = mix(c, p.dark, 0.6);
          if (n > 0.975) c = p.accent;
          break;
        case 3: // permafrost: frozen soil with pebbles and frost
          c = mix(p.base, p.dark, m * 0.7);
          if (n > 0.93) c = p.dark;
          else if (n < 0.05) c = p.accent;
          else if (n < 0.1) c = p.light;
          break;
        case 4: // granite
          c = mix(p.base, p.dark, m * 0.6);
          if (n > 0.92) c = p.light;
          else if (n < 0.08) c = p.dark;
          break;
        case 5: { // basalt with glowing seams
          c = mix(p.base, p.dark, m * 0.7);
          const seam = valueNoise((x + v * 16) / 3, y / 3, 77);
          if (Math.abs(seam - 0.5) < 0.03) c = mix(p.dark, p.accent, 0.55);
          if (n > 0.95) c = p.light;
          break;
        }
        case 6: { // hollow stone: cut blocks with glyphs
          c = mix(p.base, p.dark, m * 0.4);
          const row = Math.floor(y / 8);
          if (y % 8 === 0 || (x + (row % 2) * 8 + v * 4) % 16 === 0) c = p.dark;
          if (n > 0.985) c = p.accent;
          break;
        }
      }
      px.set(ox + x, oy + y, c);
    }
  }
  if (layer === 6 && v % 2 === 0) {
    // a small glyph
    const gx = ox + 4 + (v % 3) * 2;
    const gy = oy + 3;
    for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2], [0, 2], [2, 2]]) px.set(gx + dx, gy + dy, mix(p.accent, p.dark, 0.35));
  }
}

function paintMagma(px: Px, ox: number, oy: number, v: number) {
  const cols = [hex('#8a1406'), hex('#d43a0a'), hex('#ff7a14'), hex('#ffc23a'), hex('#fff0a0')];
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const m = valueNoise((x + v * 16) / 4, y / 4, 303);
      const n = hash3(x + v * 16, y, 304);
      let k = Math.min(4, Math.floor(m * 4.6));
      if (n > 0.97) k = 4;
      px.set(ox + x, oy + y, cols[k]);
    }
  }
}

function paintWall(px: Px, ox: number, oy: number, v: number) {
  const a = hex('#14141b');
  const b = hex('#22222c');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let c = (x + y + v) % 6 < 2 ? b : a;
      if (hash3(x + v * 16, y, 401) > 0.95) c = hex('#30303c');
      px.set(ox + x, oy + y, c);
    }
  }
}

function paintPad(px: Px, ox: number, oy: number, v: number) {
  const base = hex('#8d9096');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const n = hash3(x + v * 16, y, 501);
      let c = mix(base, hex('#6c6f75'), n * 0.4);
      if (x === 0 || y === 15) c = hex('#5c5f64');
      if (y < 3) c = (x + y) % 6 < 3 ? hex('#f2c230') : hex('#2a2a2e');
      if (y === 3) c = hex('#4a4c50');
      px.set(ox + x, oy + y, c);
    }
  }
}

function paintRime(px: Px, ox: number, oy: number, v: number) {
  const a = hex('#8fc6e6');
  const b = hex('#d6eefc');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const m = valueNoise((x + v * 16) / 3, y / 3, 1101);
      let c = mix(a, b, m);
      // feathery frost ferns
      if ((x * 3 + y * 2 + v * 5) % 9 === 0 && hash3(x + v * 16, y, 1102) > 0.35) c = hex('#ffffff');
      if (hash3(x + v * 16, y, 1103) > 0.93) c = shade(a, -0.15);
      px.set(ox + x, oy + y, c);
    }
  }
}

function paintSlab(px: Px, ox: number, oy: number, v: number) {
  const p = LAYER_PAL[2];
  const edge = shade(p.dark, -0.35);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const m = valueNoise((x + v * 16) / 5, y / 5, 1201);
      let c = mix(mix(p.base, p.light, 0.35), p.light, m * 0.4);
      if ((x + y + v) % 7 === 0) c = mix(c, hex('#ffffff'), 0.4);
      // a cracked outline so a loose block reads at a glance
      if (x === 0 || y === 0 || x === TS - 1 || y === TS - 1) c = edge;
      else if (x === 1 || y === 1) c = mix(c, hex('#ffffff'), 0.5);
      px.set(ox + x, oy + y, c);
    }
  }
  const cx = 4 + v * 2;
  for (let k = 0; k < 6; k++) px.set(ox + cx + (k >> 1), oy + 2 + k, edge);
}

function paintMelt(px: Px, ox: number, oy: number, v: number) {
  paintLayer(px, ox, oy, 2, v);
  const deep = hex('#1d5a9e');
  const mid = hex('#2f7dcc');
  const hi = hex('#bfe6ff');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const r = Math.hypot((x - 7.5) / 1.15, y - 8.5);
      if (r > 5.6) continue;
      let c = r > 4.6 ? shade(deep, -0.3) : y < 7 + Math.sin((x + v) * 1.3) * 0.8 ? mid : deep;
      if (y === 6 && (x + v) % 4 === 0) c = hi;
      px.set(ox + x, oy + y, c);
    }
  }
  px.set(ox + 5, oy + 9, hi);
  px.set(ox + 6, oy + 10, hi);
}

function paintVent(px: Px, ox: number, oy: number, v: number) {
  paintLayer(px, ox, oy, 5, v);
  const glow = hex('#ff8a30');
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < TS; x++) {
      const r = Math.hypot(x - 7.5, (y + 1) * 1.6);
      if (r < 3.4) px.set(ox + x, oy + y, hex('#120c0c'));
      else if (r < 4.6) px.set(ox + x, oy + y, mix(glow, hex('#3b3236'), 0.35));
      else if (r < 5.8) px.set(ox + x, oy + y, hex('#6a6a73'));
    }
  }
  for (const [x, y] of [[4, 9], [11, 10], [7, 12]]) px.set(ox + x, oy + y, mix(glow, hex('#262024'), 0.5));
}

function paintSlag(px: Px, ox: number, oy: number, v: number) {
  const a = hex('#2b2427');
  const b = hex('#463c40');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const m = valueNoise((x + v * 16) / 3, y / 3, 1301);
      let c = mix(a, b, m);
      const crack = valueNoise((x + v * 16) / 2.5, y / 2.5, 1302);
      if (Math.abs(crack - 0.5) < 0.035) c = hex('#a8401a');
      px.set(ox + x, oy + y, c);
    }
  }
}

/** Cut stone: fitted blocks with a thin teal inlay. The walls of the tunnel and the halls. */
function paintCarved(px: Px, ox: number, oy: number, v: number) {
  const p = LAYER_PAL[6];
  const face = shade(p.light, -0.12);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const row = Math.floor(y / 8);
      const bx = (x + (row ? 4 : 0) + v * 3) % 16;
      let c = mix(face, p.base, valueNoise((x + v * 16) / 3, y / 3, 1401) * 0.6);
      if (y % 8 === 0 || bx === 0) c = p.dark;
      else if (y % 8 === 1 || bx === 1) c = shade(face, 0.18);
      px.set(ox + x, oy + y, c);
    }
  }
  if (v % 2 === 0) for (let x = 4; x < 12; x++) px.set(ox + x, oy + 12, mix(p.accent, p.dark, x === 4 || x === 11 ? 0.6 : 0.25));
}

/** The body of the Hearth: dark plates, rivets and a seam that glows. */
function paintCore(px: Px, ox: number, oy: number, v: number) {
  const a = hex('#23232c');
  const b = hex('#3c3c4a');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let c = mix(a, b, valueNoise((x + v * 16) / 5, y / 5, 1411) * 0.8);
      if (x === 0 || y === 0) c = shade(b, 0.2);
      if (x === TS - 1 || y === TS - 1) c = hex('#14141a');
      px.set(ox + x, oy + y, c);
    }
  }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) px.set(ox + x, oy + y, hex('#6a6a7a'));
  const seam = hex('#ff4fa8');
  if (v % 2 === 0) for (let x = 4; x < 12; x++) px.set(ox + x, oy + 8, mix(seam, a, 0.35 + Math.abs(x - 7.5) * 0.08));
  else for (let y = 4; y < 12; y++) px.set(ox + 8, oy + y, mix(seam, a, 0.35 + Math.abs(y - 7.5) * 0.08));
}

/** A heat vent: a grate over a furnace mouth. */
function paintHeatVent(px: Px, ox: number, oy: number) {
  paintCore(px, ox, oy, 1);
  const hot = hex('#ff8a30');
  for (let y = 3; y < 13; y++) {
    for (let x = 3; x < 13; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r > 5) continue;
      const c = mix(hex('#fff0b0'), hot, Math.min(1, r / 4));
      px.set(ox + x, oy + y, x % 3 === 0 ? hex('#1a1a20') : c);
    }
  }
  outline(px, ox + 2, oy + 2, 12, 12, hex('#7a7a8a'));
}

/** The heart: a pink crystal in a broken housing. */
function paintHeart(px: Px, ox: number, oy: number) {
  paintCore(px, ox, oy, 0);
  const core = hex('#ff4fa8');
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      const r = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (r > 6) continue;
      px.set(ox + x, oy + y, r < 2 ? hex('#fff0f8') : mix(hex('#ffd8ee'), core, Math.min(1, (r - 1) / 4)));
    }
  }
}

/** The gate: an arch of cut stone with a warm light in it, over the tunnel back. */
function paintGate(px: Px, ox: number, oy: number) {
  paintBack(px, ox, oy, 6, false, false);
  const p = LAYER_PAL[6];
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const k = 1 - Math.abs(x - 7.5) / 8;
      px.set(ox + x, oy + y, mix(hex('#3a1630'), hex('#ff9ac8'), Math.max(0, k * 0.8 - (y % 4 === 0 ? 0.15 : 0))));
    }
  }
  for (let y = 0; y < TS; y++) {
    px.set(ox, oy + y, p.accent);
    px.set(ox + TS - 1, oy + y, p.accent);
  }
}

/** A Halvorsen recorder: an orange case with an aerial and a red light, sitting in a pocket. */
function paintRecorder(px: Px, ox: number, oy: number, layer: number) {
  paintBack(px, ox, oy, layer, true, false);
  const orange = hex('#e0762a');
  px.rect(ox + 4, oy + 8, 8, 7, orange);
  px.rect(ox + 4, oy + 8, 8, 1, shade(orange, 0.3));
  px.rect(ox + 4, oy + 14, 8, 1, shade(orange, -0.4));
  px.rect(ox + 5, oy + 10, 4, 2, hex('#1b2232'));
  px.set(ox + 10, oy + 10, hex('#ff3030'));
  px.set(ox + 10, oy + 12, hex('#e8e8e8'));
  px.rect(ox + 11, oy + 2, 1, 6, hex('#c8ccd4'));
  px.set(ox + 11, oy + 1, hex('#ff3030'));
  outline(px, ox + 3, oy + 7, 10, 9, hex('#20120a'));
}

function paintWater(px: Px, ox: number, oy: number, layer: number, surface: boolean) {
  paintBack(px, ox, oy, layer, false, false);
  const blue = hex('#2f7dcc');
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let c = mix(px.get(ox + x, oy + y), blue, 0.6);
      if (surface && y < 2) c = mix(hex('#9fd8ff'), blue, y * 0.4);
      else if ((x * 2 + y * 3) % 13 === 0) c = mix(c, hex('#9fd8ff'), 0.35);
      px.set(ox + x, oy + y, c);
    }
  }
}

function paintBack(px: Px, ox: number, oy: number, layer: number, above: boolean, left: boolean) {
  const p = LAYER_PAL[layer];
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const m = valueNoise(x / 4, y / 4, 600 + layer);
      const back = HD ? shade(p.back, -BACK_DIM) : p.back;
      let c = mix(back, shade(back, -0.35), m * 0.7);
      if (hash3(x, y, 610 + layer) > 0.96) c = shade(back, 0.12);
      let dark = 0;
      if (above && y < 5) dark = Math.max(dark, ((5 - y) / 5) * 0.55);
      if (left && x < 3) dark = Math.max(dark, ((3 - x) / 3) * 0.4);
      px.set(ox + x, oy + y, shade(c, -dark));
    }
  }
}

function blob(px: Px, cx: number, cy: number, col: RGB, light: RGB) {
  const dark = shade(col, -0.45);
  const cells = [[0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [2, 0], [0, 1], [1, 1]];
  for (const [dx, dy] of cells) px.set(cx + dx, cy + dy, col);
  px.set(cx + 1, cy + 2, dark);
  px.set(cx + 2, cy + 1, dark);
  px.set(cx, cy - 1, light);
  px.set(cx - 1, cy, mix(col, light, 0.5));
}

function crystal(px: Px, cx: number, cy: number, col: RGB, light: RGB) {
  const dark = shade(col, -0.45);
  const rows: [number, number][] = [[-3, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 0]];
  for (const [dy, hw] of rows) for (let dx = -hw; dx <= hw; dx++) px.set(cx + dx, cy + dy, dx < 0 ? mix(col, light, 0.45) : col);
  px.set(cx, cy - 3, light);
  px.set(cx + 1, cy + 1, dark);
  px.set(cx, cy + 2, dark);
  px.set(cx - 1, cy - 1, light);
}

function paintBoulder(px: Px, ox: number, oy: number, layer: number) {
  const base = mix(hex('#7a7470'), LAYER_PAL[layer].base, 0.25);
  const dark = shade(base, -0.5);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const dx = x - 7.5;
    const dy = y - 8;
    const r = Math.sqrt(dx * dx * 1.0 + dy * dy * 1.15);
    if (r > 7.2) continue;
    let c = mix(base, shade(base, 0.35), Math.max(0, (-dx - dy) / 12));
    if (r > 6.3) c = dark;
    else if (hash3(x, y, 808) > 0.9) c = shade(base, -0.2);
    px.set(ox + x, oy + y, c);
  }
  for (const [x, y] of [[9, 5], [10, 6], [10, 7], [6, 10], [7, 11]]) px.set(ox + x, oy + y, dark);
}

/** Loose boulders on their own, one per layer, for falling sprites. */
function buildBoulders(): HTMLCanvasElement {
  const px = new Px(TS * LAYERS.length, TS);
  for (let l = 0; l < LAYERS.length; l++) paintBoulder(px, l * TS, 0, l);
  return toCanvas(px);
}

function paintEmbedded(px: Px, ox: number, oy: number, kind: number, layer: number) {
  paintLayer(px, ox, oy, layer, 1);
  if (kind === EMB_GAS) {
    const tint = hex('#c8e04a');
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const m = valueNoise(x / 3, y / 3, 707 + layer);
      if (m > 0.55) px.set(ox + x, oy + y, mix(px.get(ox + x, oy + y), tint, 0.22));
    }
    for (const [x, y] of [[4, 5], [10, 9], [7, 12]]) px.set(ox + x, oy + y, mix(tint, hex('#ffffff'), 0.3), 200);
    return;
  }
  if (kind === EMB_BOULDER) {
    paintBoulder(px, ox, oy, layer);
    return;
  }
  if (!HD) {
    paintMineral(px, ox, oy, kind);
    return;
  }
  // High detail: a dark edge around the ore, so it reads against any ground.
  const s = new Px(TS, TS);
  paintMineral(s, 0, 0, kind);
  outline(s, 0, 0, TS, TS, shade(hex(MINERALS[kind].color), -0.72), 215);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const a = s.alpha(x, y);
    if (a) px.set(ox + x, oy + y, s.get(x, y), a);
  }
}

function paintMineral(px: Px, ox: number, oy: number, kind: number) {
  const m = MINERALS[kind];
  const col = hex(m.color);
  const light = hex(m.light);
  if (m.kind === 'ore') {
    const spots: [number, number][] = [[3, 3], [9, 2], [6, 7], [11, 9], [3, 11], [8, 12]];
    spots.forEach(([x, y], i) => {
      if (hash3(kind, i, 900) < 0.8) blob(px, ox + x, oy + y, col, light);
    });
  } else if (m.kind === 'gem') {
    const spots: [number, number][] = [[4, 5], [10, 4], [7, 10], [12, 11]];
    spots.forEach(([x, y], i) => {
      if (i < 3 || hash3(kind, i, 901) < 0.5) crystal(px, ox + x, oy + y, col, light);
    });
  } else if (m.key === 'fossil') {
    const dark = shade(col, -0.5);
    px.rect(ox + 4, oy + 7, 8, 2, col);
    for (const x of [2, 12]) {
      px.rect(ox + x, oy + 6, 2, 2, col);
      px.rect(ox + x, oy + 8, 2, 2, col);
    }
    px.rect(ox + 4, oy + 9, 8, 1, dark);
    for (const x of [6, 8, 10]) px.set(ox + x, oy + 6, light);
  } else if (m.key === 'cache') {
    const dark = shade(col, -0.5);
    px.rect(ox + 3, oy + 5, 10, 7, col);
    px.rect(ox + 3, oy + 7, 10, 1, light);
    px.rect(ox + 3, oy + 11, 10, 1, dark);
    px.rect(ox + 12, oy + 5, 1, 7, dark);
    px.rect(ox + 7, oy + 6, 2, 3, hex('#2a2a2e'));
  } else {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r < 5.2) px.set(ox + x, oy + y, r < 1.6 ? light : r > 4.2 ? shade(col, -0.4) : r > 3 ? col : shade(col, -0.25));
    }
  }
}

/**
 * One overlay cell: the rounded boundary where four tiles meet at the cell's centre. Open corners
 * of rock get cut away to show tunnel, closed corners of tunnel get filled in with rock, and a dark
 * rim runs along the edge. Sky cells count as open for the shape but never get a rim.
 * Returns false if nothing was drawn.
 */
function paintOver(px: Px, dst: [number, number], ground: [number, number], back: [number, number], layer: number, open: number, sky: number): boolean {
  const H = TS / 2;
  const M = 2;
  const N = TS + M * 2;
  const bit = (qx: number, qy: number) => 1 << (qy * 2 + qx);
  // 0 rock, 1 tunnel, 2 sky.
  const state = new Uint8Array(N * N);
  const changed = new Uint8Array(N * N);
  for (let v = -M; v < TS + M; v++) {
    for (let u = -M; u < TS + M; u++) {
      const qx = u < H ? 0 : 1;
      const qy = v < H ? 0 : 1;
      const me = bit(qx, qy);
      const side = bit(1 - qx, qy);
      const vert = bit(qx, 1 - qy);
      const diag = bit(1 - qx, 1 - qy);
      const isOpen = (b: number) => (open & b) > 0;
      let st = sky & me ? 2 : isOpen(me) ? 1 : 0;
      const dx = Math.abs(u + 0.5 - H);
      const dy = Math.abs(v + 0.5 - H);
      if (dx < CORNER && dy < CORNER && Math.hypot(CORNER - dx, CORNER - dy) > CORNER) {
        if (st === 1 && !isOpen(side) && !isOpen(vert)) st = 0; // tunnel corner filled with rock
        else if (st === 0 && isOpen(side) && isOpen(vert) && isOpen(diag)) st = 1; // rock corner cut away
        if (st !== (sky & me ? 2 : isOpen(me) ? 1 : 0)) changed[(v + M) * N + u + M] = 1;
      }
      state[(v + M) * N + u + M] = st;
    }
  }
  const p = LAYER_PAL[layer];
  const rim = shade(p.dark, -0.45);
  let drew = false;
  for (let v = 0; v < TS; v++) {
    for (let u = 0; u < TS; u++) {
      const k = (v + M) * N + u + M;
      const tx = (u + H) % TS;
      const ty = (v + H) % TS;
      const x = dst[0] + u;
      const y = dst[1] + v;
      if (state[k] === 1) {
        if (changed[k]) {
          px.set(x, y, shade(px.get(back[0] + tx, back[1] + ty), -0.06));
          drew = true;
        }
        continue;
      }
      if (state[k] === 2) continue;
      let d = 9;
      // Whether the nearest bit of tunnel is above this pixel: then it's a floor, and it catches the light.
      let floor = false;
      for (let j = -M; j <= M; j++) for (let i = -M; i <= M; i++) {
        if (state[(v + M + j) * N + u + M + i] !== 1) continue;
        const h = Math.hypot(i, j);
        if (h < d) {
          d = h;
          floor = j < 0 && -j >= Math.abs(i);
        }
      }
      const fill = changed[k] > 0;
      const base = px.get(ground[0] + tx, ground[1] + ty);
      if (d < 1.5) px.set(x, y, rim);
      else if (d < 2.5) {
        if (HD && floor) px.set(x, y, mix(base, p.light, 0.5));
        else if (fill) px.set(x, y, mix(base, rim, 0.45));
        else px.set(x, y, [0, 0, 0], 70);
      } else if (fill) px.set(x, y, base);
      else continue;
      drew = true;
    }
  }
  return drew;
}

function buildTileset(): HTMLCanvasElement {
  const rows = Math.ceil((OVER_BASE + OVER_COUNT) / COLS);
  const px = new Px(COLS * TS, rows * TS);
  const at = (i: number): [number, number] => [(i % COLS) * TS, Math.floor(i / COLS) * TS];
  for (let v = 0; v < 4; v++) {
    for (let layer = 0; layer < LAYERS.length; layer++) {
      const [x, y] = at(LAYERS[layer].tile * 4 + v);
      paintLayer(px, x, y, layer, v);
    }
    paintMagma(px, ...at(T.MAGMA * 4 + v), v);
    paintWall(px, ...at(T.WALL * 4 + v), v);
    paintPad(px, ...at(T.PAD * 4 + v), v);
    paintRime(px, ...at(T.RIME * 4 + v), v);
    paintSlab(px, ...at(T.SLAB * 4 + v), v);
    paintMelt(px, ...at(T.MELT * 4 + v), v);
    paintVent(px, ...at(EXTRA_BASE + v), v);
    paintSlag(px, ...at(EXTRA_BASE + 4 + v), v);
    paintCarved(px, ...at(BUILT_BASE + v), v);
    paintCore(px, ...at(BUILT_BASE + 5 + v), v);
  }
  paintHeatVent(px, ...at(BUILT_BASE + 4));
  paintHeart(px, ...at(BUILT_BASE + 9));
  paintGate(px, ...at(BUILT_BASE + 10));
  for (let layer = 0; layer < LAYERS.length; layer++) paintRecorder(px, ...at(BUILT_BASE + 11 + layer), layer);
  for (let layer = 0; layer < LAYERS.length; layer++) {
    for (let f = 0; f < 4; f++) paintBack(px, ...at(BACK_BASE + layer * 4 + f), layer, (f & 1) > 0, (f & 2) > 0);
    for (let k = 0; k < MINERALS.length + 2; k++) paintEmbedded(px, ...at(EMB_BASE + k * 8 + layer), k, layer);
    paintWater(px, ...at(EXTRA_BASE + 8 + layer * 2), layer, true);
    paintWater(px, ...at(EXTRA_BASE + 8 + layer * 2 + 1), layer, false);
  }
  for (let layer = 0; layer < LAYERS.length; layer++) {
    for (let f = 0; f < 32; f++) {
      const i = layer * 32 + f;
      OVER_EMPTY[i] = paintOver(px, at(OVER_BASE + i), at(LAYERS[layer].tile * 4), at(BACK_BASE + layer * 4), layer, f & 15, f & 16 ? 3 : 0) ? 0 : 1;
    }
  }
  return toCanvas(px);
}

function toCanvas(px: Px): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = px.w;
  c.height = px.h;
  c.getContext('2d')!.putImageData(px.img, 0, 0);
  return c;
}

/** The tileset frame for a world tile, or -1 for open sky. */
export function visIndex(world: World, x: number, y: number): number {
  const t = world.get(x, y);
  if (t === T.AIR) {
    if (y < SKY) return -1;
    const above = isSolid(world.get(x, y - 1)) ? 1 : 0;
    const left = isSolid(world.get(x - 1, y)) ? 2 : 0;
    return BACK_BASE + world.layerAt(x, y) * 4 + above + left;
  }
  if (isMineral(t)) return EMB_BASE + (t - MINERAL_BASE) * 8 + world.layerAt(x, y);
  const v = Math.floor(hash3(x, y, 12) * 4);
  if (t === T.VENT) return EXTRA_BASE + v;
  if (t === T.SLAG) return EXTRA_BASE + 4 + v;
  if (t === T.WATER) return EXTRA_BASE + 8 + world.layerAt(x, y) * 2 + (world.get(x, y - 1) === T.WATER ? 1 : 0);
  if (t === T.CARVED) return BUILT_BASE + v;
  if (t === T.HVENT) return BUILT_BASE + 4;
  if (t === T.HCORE) return BUILT_BASE + 5 + v;
  if (t === T.HEART) return BUILT_BASE + 9;
  if (t === T.GATE) return BUILT_BASE + 10;
  if (t === T.LOG) return BUILT_BASE + 11 + world.layerAt(x, y);
  if (t === T.GAS) return EMB_BASE + EMB_GAS * 8 + world.layerAt(x, y);
  if (t === T.BOULDER) return EMB_BASE + EMB_BOULDER * 8 + world.layerAt(x, y);
  return t * 4 + v;
}

/**
 * The overlay frame for the corner at the top-left of tile (i, j), where tiles (i-1, j-1), (i, j-1),
 * (i-1, j) and (i, j) meet, or -1 if nothing needs drawing there.
 */
export function overIndex(world: World, i: number, j: number): number {
  if (j < SKY) return -1;
  const cells: [number, number][] = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]];
  let open = 0;
  let layer = -1;
  cells.forEach(([x, y], k) => {
    if (y < SKY || !isSolid(world.get(x, y))) open |= 1 << k;
    else if (layer < 0) layer = world.layerAt(x, y);
  });
  if (open === 15 || layer < 0) return -1;
  const f = layer * 32 + (j === SKY ? 16 : 0) + open;
  return OVER_EMPTY[f] ? -1 : OVER_BASE + f;
}

// ---------------------------------------------------------------- rig

export const RIG_FRAME = 20;
export const RIG_FRAMES = ['idle0', 'idle1', 'side0', 'side1', 'down0', 'down1'] as const;

function paintRig(px: Px, ox: number, mode: 'idle' | 'side' | 'down', anim: number, paint: RGB) {
  const dark = shade(paint, -0.38);
  const light = shade(paint, 0.3);
  const steel = hex('#5a5a62');
  const P = (x: number, y: number, c: RGB) => px.set(ox + x, y, c);
  const R = (x: number, y: number, w: number, h: number, c: RGB) => px.rect(ox + x, y, w, h, c);
  // exhaust stack
  R(5, 1, 2, 6, steel);
  P(5, 1, hex('#3a3a40'));
  P(6, 1, hex('#3a3a40'));
  // cab
  R(7, 3, 7, 5, dark);
  R(8, 4, 5, 3, hex('#8fe0fb'));
  P(8, 4, hex('#ffffff'));
  P(12, 6, hex('#5ab4d8'));
  // chassis
  R(4, 7, 12, 5, paint);
  R(4, 7, 12, 1, light);
  R(4, 11, 12, 1, dark);
  for (const x of [5, 8, 11, 14]) P(x, 9, dark);
  P(15, 8, hex('#ffe680'));
  // tracks
  R(4, 12, 12, 4, hex('#26262c'));
  R(5, 12, 10, 1, hex('#3c3c44'));
  for (let i = 0; i < 4; i++) R(5 + i * 3, 13, 2, 2, hex('#8a8a94'));
  for (let x = 4; x < 16; x++) if ((x + anim) % 2 === 0) P(x, 15, hex('#4a4a54'));
  for (const [x, y] of [[4, 12], [15, 12], [4, 15], [15, 15]]) px.set(ox + x, y, [0, 0, 0], 0);
  const bitA = hex('#d6dae0');
  const bitB = hex('#767c86');
  if (mode === 'down') {
    R(9, 16, 2, 1, steel);
    const rows: [number, number, number][] = [[17, 7, 6], [18, 8, 4], [19, 9, 2]];
    for (const [y, x0, w] of rows) for (let x = x0; x < x0 + w; x++) P(x, y, (x + anim) % 2 ? bitA : bitB);
  } else {
    R(16, 8, 1, 3, steel);
    const len = mode === 'side' ? 3 : 1;
    const cols: [number, number, number][] = [[17, 7, 5], [18, 8, 3], [19, 9, 1]];
    for (const [x, y0, h] of cols.slice(0, len)) for (let y = y0; y < y0 + h; y++) P(x, y, (y + anim) % 2 ? bitA : bitB);
  }
}

/** The high-detail rig has a dark outline, so its frames are two pixels bigger each way. */
const RIG_PAD = 2;
export const RIG_FRAME_HD = RIG_FRAME + RIG_PAD * 2;

/** The same rig on the same pixel grid, with more shading, brighter paint and a dark outline. */
function paintRigHD(px: Px, fx: number, mode: 'idle' | 'side' | 'down', anim: number, paint: RGB) {
  const ox = fx + RIG_PAD;
  const oy = RIG_PAD;
  const dark = shade(paint, -0.42);
  const light = shade(paint, 0.32);
  const hi = shade(paint, 0.66);
  const P = (x: number, y: number, c: RGB) => px.set(ox + x, oy + y, c);
  const R = (x: number, y: number, w: number, h: number, c: RGB) => px.rect(ox + x, oy + y, w, h, c);
  // exhaust stack
  R(5, 1, 2, 6, hex('#6c7482'));
  R(5, 2, 1, 5, hex('#a2aab8'));
  R(5, 1, 2, 1, hex('#2e323a'));
  // cab
  R(7, 3, 7, 5, dark);
  R(7, 3, 7, 1, paint);
  R(8, 4, 5, 3, hex('#7fd8f8'));
  R(8, 4, 3, 1, hex('#ffffff'));
  P(8, 5, hex('#d6f6ff'));
  R(11, 6, 2, 1, hex('#3f9cc8'));
  P(12, 5, hex('#5ab8e0'));
  // beacon on the roof (the scene makes it blink)
  P(12, 2, hex('#ffb020'));
  // chassis
  R(4, 7, 12, 5, paint);
  R(4, 7, 12, 1, hi);
  R(4, 8, 12, 1, light);
  R(4, 11, 12, 1, dark);
  for (const x of [6, 9, 12]) P(x, 9, dark);
  // headlamp
  R(14, 8, 2, 2, hex('#fff8c8'));
  P(14, 9, hex('#ffd45a'));
  // tracks
  R(5, 12, 10, 4, hex('#1c1e26'));
  R(4, 13, 12, 2, hex('#1c1e26'));
  R(5, 12, 10, 1, hex('#565c68'));
  for (let i = 0; i < 4; i++) {
    R(5 + i * 3, 13, 2, 2, hex('#9ea4b2'));
    P(5 + i * 3, 13, hex('#e6eaf2'));
  }
  for (let x = 5; x < 15; x++) if ((x + anim) % 2 === 0) P(x, 15, hex('#5a606c'));
  const bitA = hex('#f2f5f9');
  const bitB = hex('#8a93a2');
  const steel = hex('#6c7482');
  if (mode === 'down') {
    R(9, 16, 2, 1, steel);
    const rows: [number, number, number][] = [[17, 7, 6], [18, 8, 4], [19, 9, 2]];
    for (const [y, x0, w] of rows) for (let x = x0; x < x0 + w; x++) P(x, y, (x + anim) % 2 ? bitA : bitB);
  } else {
    R(16, 8, 1, 3, steel);
    const len = mode === 'side' ? 3 : 1;
    const cols: [number, number, number][] = [[17, 7, 5], [18, 8, 3], [19, 9, 1]];
    for (const [x, y0, h] of cols.slice(0, len)) for (let y = y0; y < y0 + h; y++) P(x, y, (y + anim) % 2 ? bitA : bitB);
  }
  outline(px, fx, 0, RIG_FRAME_HD, RIG_FRAME_HD, hex('#080b12'));
}

function buildRig(paint: string, hd = false): HTMLCanvasElement {
  const size = hd ? RIG_FRAME_HD : RIG_FRAME;
  const px = new Px(size * RIG_FRAMES.length, size);
  const col = hex(paint);
  RIG_FRAMES.forEach((name, i) => {
    const mode = name.startsWith('idle') ? 'idle' : name.startsWith('side') ? 'side' : 'down';
    if (hd) paintRigHD(px, i * size, mode, Number(name.slice(-1)), col);
    else paintRig(px, i * size, mode, Number(name.slice(-1)), col);
  });
  return toCanvas(px);
}

function buildFlame(): HTMLCanvasElement {
  const px = new Px(16, 8);
  const c = [hex('#fff4b8'), hex('#ffd040'), hex('#ff8a20'), hex('#ff4a10')];
  for (let f = 0; f < 2; f++) {
    const ox = f * 8;
    const rows: [number, number, number, number][] = [[0, 2, 4, 0], [1, 1, 6, 1], [2, 1, 6, 1], [3, 2, 4, 2], [4, 2, 4, 2], [5, 3, 2, 3]];
    if (f === 1) rows.push([6, 3, 2, 3]);
    for (const [y, x, w, k] of rows) px.rect(ox + x, y, w, 1, c[k]);
  }
  return toCanvas(px);
}

/** The station's sky crane, which sets new rigs down on the pad. Two frames, 32x12 each: rotors wide and narrow. */
export const LIFTER_W = 32;
export const LIFTER_H = 12;
function buildLifter(): HTMLCanvasElement {
  const px = new Px(LIFTER_W * 2, LIFTER_H);
  const steel = hex('#5a6270');
  const hull = hex('#3d4654');
  for (let f = 0; f < 2; f++) {
    const ox = f * LIFTER_W;
    const R = (x: number, y: number, w: number, h: number, c: RGB, a = 255) => px.rect(ox + x, y, w, h, c, a);
    const blade = hex('#cfd8e4');
    if (f === 0) {
      R(0, 0, 10, 1, blade, 170);
      R(22, 0, 10, 1, blade, 170);
    } else {
      R(3, 0, 4, 1, blade, 220);
      R(25, 0, 4, 1, blade, 220);
    }
    R(4, 1, 2, 2, steel);
    R(26, 1, 2, 2, steel);
    R(2, 3, 6, 3, hex('#262c36'));
    R(24, 3, 6, 3, hex('#262c36'));
    R(8, 4, 16, 2, steel);
    R(10, 2, 12, 6, hull);
    R(10, 2, 12, 1, hex('#5b6678'));
    R(10, 7, 12, 1, hex('#262c36'));
    R(12, 4, 4, 2, hex('#8fe0fb'));
    R(12, 4, 1, 1, hex('#ffffff'));
    R(17, 4, 4, 1, hex('#f2a81d'));
    R(15, 8, 2, 2, steel);
    R(14, 10, 4, 1, hex('#8a8a94'));
    if (f === 0) R(22, 2, 1, 1, hex('#ff4a3a'));
  }
  return toCanvas(px);
}

/** The parachute a stalled rig comes down on, 20x12: striped canopy and its lines. */
function buildChute(): HTMLCanvasElement {
  const px = new Px(20, 12);
  const a = hex('#f2a81d');
  const b = hex('#f4f4f4');
  const rows: [number, number][] = [[6, 13], [3, 16], [1, 18], [0, 19], [0, 19]];
  rows.forEach(([x0, x1], y) => {
    for (let x = x0; x <= x1; x++) {
      if (y === 4 && x % 5 === 2) continue; // scalloped hem
      const c = Math.floor((x + 2) / 4) % 2 ? a : b;
      px.set(x, y, y === 0 ? shade(c, 0.25) : y >= 3 ? shade(c, -0.18) : c);
    }
  });
  const line = hex('#cfd6e0');
  for (let y = 5; y < 12; y++) {
    const k = (y - 4) / 7;
    px.set(Math.round(9 * k), y, line, 200);
    px.set(Math.round(19 - 9 * k), y, line, 200);
    if (y % 2) px.set(Math.round(6 + 3 * k), y, line, 130);
    if (y % 2) px.set(Math.round(13 - 3 * k), y, line, 130);
  }
  return toCanvas(px);
}

// ---------------------------------------------------------------- buildings

function snowCap(px: Px, x: number, y: number, w: number) {
  const s = hex('#f2f6fb');
  const d = hex('#c4d2e2');
  px.rect(x, y, w, 2, s);
  for (let i = x; i < x + w; i += 3) px.set(i, y + 2, d);
}

function paintBuilding(px: Px, key: BuildingKey) {
  const lit = hex('#ffd36a');
  const glass = hex('#2b3b52');
  const R = (x: number, y: number, w: number, h: number, c: RGB) => px.rect(x, y, w, h, c);
  const sign = (cx: number, cy: number, col: RGB, draw: () => void) => {
    R(cx - 6, cy - 6, 12, 12, hex('#1b2232'));
    R(cx - 5, cy - 5, 10, 10, col);
    draw();
    R(cx - 1, cy + 6, 2, 4, hex('#3a3f4a'));
  };
  switch (key) {
    case 'fuel': {
      // storage tank
      const red = hex('#c8402a');
      R(3, 18, 26, 30, red);
      R(3, 18, 3, 30, shade(red, 0.25));
      R(26, 18, 3, 30, shade(red, -0.3));
      R(3, 28, 26, 4, hex('#efefef'));
      R(5, 16, 22, 2, red);
      snowCap(px, 5, 14, 22);
      R(12, 40, 8, 8, shade(red, -0.45));
      // canopy and pump
      R(32, 20, 30, 3, hex('#2a3a50'));
      snowCap(px, 32, 18, 30);
      R(59, 23, 2, 25, hex('#4a5568'));
      R(40, 30, 9, 18, hex('#e6e6e6'));
      R(41, 32, 7, 4, hex('#3ad0ff'));
      R(48, 38, 3, 1, hex('#222'));
      R(50, 38, 1, 8, hex('#222'));
      sign(53, 8, hex('#e8a020'), () => {
        R(52, 4, 2, 2, hex('#1b2232'));
        R(51, 6, 4, 4, hex('#1b2232'));
        R(52, 10, 2, 1, hex('#1b2232'));
      });
      break;
    }
    case 'assay': {
      const wall = hex('#3c5a78');
      R(4, 16, 56, 32, wall);
      R(4, 16, 56, 2, shade(wall, 0.2));
      R(2, 12, 60, 4, hex('#24384c'));
      snowCap(px, 2, 10, 60);
      R(27, 32, 10, 16, hex('#1a2430'));
      R(29, 34, 6, 5, lit);
      for (const x of [9, 44]) {
        R(x, 22, 11, 8, glass);
        R(x + 1, 23, 9, 6, lit);
        R(x + 5, 23, 1, 6, glass);
      }
      R(4, 46, 56, 2, shade(wall, -0.35));
      sign(32, 4, hex('#2b3b52'), () => {
        for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 10) px.set(32 + x, 4 + y, hex('#f0c030'));
        R(31, 2, 2, 5, hex('#a07010'));
      });
      break;
    }
    case 'shop': {
      const wall = hex('#c86a1e');
      R(2, 14, 60, 34, wall);
      R(2, 14, 60, 2, shade(wall, 0.25));
      R(0, 10, 64, 4, hex('#5a3010'));
      snowCap(px, 0, 8, 64);
      R(8, 22, 38, 26, hex('#4a4f58'));
      for (let y = 24; y < 48; y += 3) R(9, y, 36, 1, hex('#6a707a'));
      R(8, 22, 38, 1, hex('#2a2e34'));
      for (let x = 10; x < 46; x += 6) R(x, 20, 3, 2, hex('#f2c230'));
      R(50, 24, 9, 7, glass);
      R(51, 25, 7, 5, lit);
      sign(54, 4, hex('#2b3b52'), () => {
        for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
          const r = Math.hypot(x, y);
          const ang = Math.atan2(y, x);
          const tooth = Math.cos(ang * 6) > 0.3 ? 4.4 : 3.2;
          if (r <= tooth && r > 1.2) px.set(54 + x, 4 + y, hex('#c8ccd4'));
        }
      });
      break;
    }
    case 'repair': {
      const wall = hex('#3a7a4a');
      R(6, 18, 44, 30, wall);
      R(6, 18, 44, 2, shade(wall, 0.25));
      R(4, 14, 48, 4, hex('#204a2c'));
      snowCap(px, 4, 12, 48);
      R(14, 28, 26, 20, hex('#2a3530'));
      R(16, 30, 22, 2, hex('#44544c'));
      // crane
      R(54, 4, 3, 44, hex('#e0b020'));
      R(34, 4, 22, 3, hex('#e0b020'));
      for (let x = 35; x < 55; x += 3) px.set(x, 5, hex('#8a6a10'));
      R(38, 7, 1, 10, hex('#30343a'));
      R(36, 17, 5, 2, hex('#30343a'));
      sign(22, 6, hex('#e8e8e8'), () => {
        R(21, 2, 2, 9, hex('#d03030'));
        R(18, 5, 8, 2, hex('#d03030'));
      });
      break;
    }
    case 'comms': {
      // A hut with a lattice mast and a dish.
      const wall = hex('#4a5a78');
      R(4, 24, 30, 24, wall);
      R(4, 24, 30, 2, shade(wall, 0.25));
      R(2, 20, 34, 4, hex('#27324a'));
      snowCap(px, 2, 18, 34);
      R(14, 34, 9, 14, hex('#1b2232'));
      R(8, 28, 6, 5, lit);
      R(25, 28, 6, 5, lit);
      const steel = hex('#c8ccd4');
      R(46, 2, 1, 46, steel);
      R(54, 2, 1, 46, steel);
      for (let y = 4; y < 46; y += 6) {
        R(46, y, 9, 1, steel);
        for (let i = 0; i < 6; i++) px.set(47 + i, y + 1 + i, shade(steel, -0.35));
      }
      R(49, 0, 3, 2, hex('#ff3030'));
      // dish
      for (let y = 0; y < 9; y++) {
        const w = Math.round(Math.sqrt(Math.max(0, 16 - (y - 4) ** 2)));
        R(40 - w, 8 + y, w, 1, shade(hex('#e8e8f0'), -y * 0.03));
      }
      R(40, 12, 6, 1, steel);
      sign(12, 8, hex('#2b3b52'), () => {
        R(11, 5, 2, 7, hex('#9fe8ff'));
        px.set(9, 6, hex('#9fe8ff'));
        px.set(14, 6, hex('#9fe8ff'));
        px.set(8, 4, hex('#9fe8ff'));
        px.set(15, 4, hex('#9fe8ff'));
      });
      break;
    }
    case 'supply': {
      const wood = hex('#7a5232');
      R(4, 18, 40, 30, wood);
      for (let y = 20; y < 48; y += 4) R(4, y, 40, 1, shade(wood, -0.3));
      R(2, 14, 44, 4, hex('#3a2416'));
      snowCap(px, 2, 12, 44);
      R(18, 30, 10, 18, hex('#2a1a10'));
      R(8, 24, 7, 6, lit);
      R(33, 24, 7, 6, lit);
      // crates
      const crate = hex('#a8783a');
      for (const [x, y, s] of [[46, 36, 12], [50, 26, 10], [58, 40, 6]] as [number, number, number][]) {
        R(x, y, s, s, crate);
        R(x, y, s, 1, shade(crate, 0.3));
        R(x, y + s - 1, s, 1, shade(crate, -0.4));
        R(x + s - 1, y, 1, s, shade(crate, -0.4));
        for (let i = 1; i < s - 1; i++) px.set(x + i, y + i, shade(crate, -0.25));
      }
      snowCap(px, 50, 24, 10);
      sign(12, 6, hex('#2b3b52'), () => {
        R(9, 3, 7, 6, hex('#c89048'));
        R(9, 5, 7, 1, hex('#7a5232'));
        R(12, 3, 1, 6, hex('#7a5232'));
      });
      break;
    }
  }
}

function buildBuilding(key: BuildingKey): HTMLCanvasElement {
  const px = new Px(64, 48);
  paintBuilding(px, key);
  return toCanvas(px);
}

// ---------------------------------------------------------------- sky

/** Night, top to bottom. */
const SKY_NIGHT: [number, string][] = [[0, '#04060f'], [0.45, '#0d1b3a'], [0.8, '#1d3f63'], [1, '#3a6a8a']];
/** A pale polar day. */
const SKY_DAY: [number, string][] = [[0, '#2f66a8'], [0.5, '#6aa4d6'], [0.85, '#b4d8ee'], [1, '#e2f0f8']];
/** Dawn and dusk: laid over the others, clear at the top and warm at the horizon. */
const SKY_DUSK: [number, string][] = [[0, 'rgba(70,40,110,0)'], [0.4, 'rgba(120,60,130,0.35)'], [0.75, 'rgba(240,120,90,0.75)'], [1, 'rgba(255,196,120,0.95)']];

function buildSky(stops: [number, string][] = SKY_NIGHT): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 160;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 160);
  for (const [at, col] of stops) grad.addColorStop(at, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 160);
  return c;
}

function buildStars(): HTMLCanvasElement {
  const px = new Px(128, 96);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash3(i, 1, 41) * 128);
    const y = Math.floor(hash3(i, 2, 41) * 96);
    const b = hash3(i, 3, 41);
    px.set(x, y, [220, 232, 255], Math.floor(90 + b * 165));
  }
  return toCanvas(px);
}

function buildAurora(): HTMLCanvasElement {
  const px = new Px(256, 64);
  const green = hex('#5cffb0');
  const teal = hex('#3ad6ff');
  for (let x = 0; x < 256; x++) {
    const a = (x / 256) * Math.PI * 2;
    const top = 14 + Math.sin(a * 2) * 8 + Math.sin(a * 5 + 1) * 4;
    const len = 26 + Math.sin(a * 3 + 2) * 10;
    const bright = 0.5 + 0.5 * Math.sin(a * 7);
    for (let y = Math.floor(top); y < top + len && y < 64; y++) {
      const k = (y - top) / len;
      const alpha = (1 - k) * (0.25 + 0.75 * bright) * 120;
      px.set(x, y, mix(green, teal, k), Math.floor(alpha));
    }
  }
  return toCanvas(px);
}

function buildMountains(day = false): HTMLCanvasElement {
  const px = new Px(256, 80);
  const far = hex(day ? '#7f9cc0' : '#1b2a46');
  const near = hex(day ? '#5f7ea8' : '#26385a');
  const snow = hex(day ? '#f4f9ff' : '#9fb4d0');
  const ridge = (x: number, seed: number, base: number, amp: number) =>
    base - (valueNoise(x / 22, 0.5, seed) * amp + valueNoise(x / 7, 0.5, seed + 1) * amp * 0.3);
  // tileable: noise wraps by blending the ends
  const wrap = (x: number, seed: number, base: number, amp: number) => {
    const k = x / 256;
    return ridge(x, seed, base, amp) * (1 - k) + ridge(x - 256, seed, base, amp) * k;
  };
  for (let x = 0; x < 256; x++) {
    const h1 = wrap(x, 21, 54, 50);
    const h2 = wrap(x, 37, 78, 34);
    for (let y = 0; y < 80; y++) {
      if (y >= h2) px.set(x, y, y < h2 + 3 ? snow : near);
      else if (y >= h1) px.set(x, y, y < h1 + 2 ? mix(snow, far, 0.4) : far);
    }
  }
  return toCanvas(px);
}

/** A soft round light, white in the middle and fading to nothing, for erasing darkness. */
function buildLight(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** The headlamp's beam: a soft cone that opens to the right from its left edge. */
function buildBeam(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 48;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  // Stacked wedges, so the cone is brightest along its middle.
  for (const half of [22, 15, 8]) {
    g.globalAlpha = 0.34;
    g.beginPath();
    g.moveTo(0, 23);
    g.lineTo(64, 24 - half);
    g.lineTo(64, 24 + half);
    g.lineTo(0, 25);
    g.closePath();
    g.fill();
  }
  return c;
}

/** A small four-point glint for ore, 5x5. */
function buildTwinkle(): HTMLCanvasElement {
  const px = new Px(5, 5);
  const w: RGB = [255, 255, 255];
  px.set(2, 2, w);
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) px.set(x, y, w, 190);
  for (const [x, y] of [[0, 2], [4, 2], [2, 0], [2, 4]]) px.set(x, y, w, 90);
  return toCanvas(px);
}

/** The moon: a pale disc with a few craters, lit from the upper left. */
function buildMoon(): HTMLCanvasElement {
  const S = 22;
  const px = new Px(S, S);
  const lit = hex('#e4eefc');
  const mid = hex('#b9c8e2');
  const dim = hex('#8496b8');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - 10.5;
    const dy = y - 10.5;
    if (Math.hypot(dx, dy) > 10.2) continue;
    const k = (dx + dy) / 15 + valueNoise(x / 3, y / 3, 1701) * 0.5;
    px.set(x, y, k > 0.75 ? dim : k > 0.3 ? mid : lit);
  }
  for (const [cx, cy, cr] of [[7, 8, 2.2], [13, 13, 2.8], [12, 6, 1.4], [6, 14, 1.3]]) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r < cr && px.alpha(x, y)) px.set(x, y, r > cr - 1 && x + y < cx + cy ? dim : mid);
    }
  }
  return toCanvas(px);
}

/** The sun: a small pale disc. The scene adds its glow. */
function buildSun(): HTMLCanvasElement {
  const S = 14;
  const px = new Px(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - 6.5, y - 6.5);
    if (r < 6.2) px.set(x, y, r < 4.6 ? hex('#fffdf0') : hex('#ffe9a8'));
  }
  return toCanvas(px);
}

/** A few bright stars with points, for a layer that twinkles. */
function buildBrightStars(): HTMLCanvasElement {
  const px = new Px(128, 96);
  const c: RGB = [235, 242, 255];
  for (let i = 0; i < 16; i++) {
    const x = 2 + Math.floor(hash3(i, 1, 43) * 124);
    const y = 2 + Math.floor(hash3(i, 2, 43) * 78);
    px.set(x, y, c);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) px.set(x + dx, y + dy, c, 110);
  }
  return toCanvas(px);
}

/** A soft shadow for under a rig, 16x4. */
function buildShadow(): HTMLCanvasElement {
  const px = new Px(16, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) {
    const r = Math.hypot((x - 7.5) / 8, (y - 1.5) / 2.2);
    if (r < 1) px.set(x, y, [0, 0, 0], Math.floor((1 - r) * 190));
  }
  return toCanvas(px);
}

/** A flare stick, 4x6. */
function buildFlare(): HTMLCanvasElement {
  const px = new Px(4, 6);
  px.rect(1, 2, 2, 4, hex('#c83a2a'));
  px.rect(1, 1, 2, 1, hex('#ffd040'));
  px.rect(1, 0, 2, 1, hex('#fffbe0'));
  return toCanvas(px);
}

/** A soft puff for steam and blizzard fog. */
function buildPuff(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(4, 4, 0, 4, 4, 4);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 8);
  return c;
}

/** The tileset frame for a tile index, registered on first use, for sprites that look like tiles. */
export function tileFrame(scene: Phaser.Scene, index: number): string {
  const tex = scene.textures.get(tilesKey());
  const name = `t${index}`;
  if (!tex.has(name)) tex.add(name, 0, (index % COLS) * TS, Math.floor(index / COLS) * TS, TS, TS);
  return name;
}

/** The plain frame a tile would show at (x, y), ignoring what's there now. */
export function frameFor(world: World, x: number, y: number, tile: number): number {
  if (isMineral(tile)) return EMB_BASE + (tile - MINERAL_BASE) * 8 + world.layerAt(x, y);
  if (tile === T.BOULDER) return EMB_BASE + EMB_BOULDER * 8 + world.layerAt(x, y);
  return tile * 4;
}

function buildDot(size: number, color = '#ffffff'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  return c;
}

export const PAINTS = ['#f2a81d', '#e24a3a', '#3a8ae2', '#46c86a', '#b05ae0', '#e8e8f0'];

/** The high-detail art, built the first time it's asked for. */
function makeHD(scene: Phaser.Scene): void {
  const tx = scene.textures;
  if (tx.exists('tiles-hd')) return;
  HD = true;
  try {
    tx.addCanvas('tiles-hd', buildTileset());
    PAINTS.forEach((paint, i) => {
      const t = tx.addCanvas(`righd${i}`, buildRig(paint, true))!;
      RIG_FRAMES.forEach((name, f) => t.add(name, 0, f * RIG_FRAME_HD, 0, RIG_FRAME_HD, RIG_FRAME_HD));
    });
  } finally {
    HD = false;
  }
  tx.addCanvas('beam', buildBeam());
  tx.addCanvas('twinkle', buildTwinkle());
  tx.addCanvas('moon', buildMoon());
  tx.addCanvas('sun', buildSun());
  tx.addCanvas('stars2', buildBrightStars());
  tx.addCanvas('shadow', buildShadow());
}

/** Register every texture with Phaser once, and pick which art the scene shows. */
export function makeTextures(scene: Phaser.Scene, high = false): void {
  showHD = high;
  if (high) makeHD(scene);
  const tx = scene.textures;
  if (tx.exists('tiles')) return;
  tx.addCanvas('tiles', buildTileset());
  PAINTS.forEach((paint, i) => {
    const t = tx.addCanvas(`rig${i}`, buildRig(paint))!;
    RIG_FRAMES.forEach((name, f) => t.add(name, 0, f * RIG_FRAME, 0, RIG_FRAME, RIG_FRAME));
  });
  const flame = tx.addCanvas('flame', buildFlame())!;
  flame.add('f0', 0, 0, 0, 8, 8);
  flame.add('f1', 0, 8, 0, 8, 8);
  for (const key of ['fuel', 'assay', 'shop', 'repair', 'supply', 'comms'] as BuildingKey[]) tx.addCanvas(`b-${key}`, buildBuilding(key));
  tx.addCanvas('sky', buildSky());
  tx.addCanvas('sky-day', buildSky(SKY_DAY));
  tx.addCanvas('sky-dusk', buildSky(SKY_DUSK));
  tx.addCanvas('mountains-day', buildMountains(true));
  tx.addCanvas('stars', buildStars());
  tx.addCanvas('aurora', buildAurora());
  tx.addCanvas('mountains', buildMountains());
  tx.addCanvas('px', buildDot(2));
  tx.addCanvas('px1', buildDot(1));
  tx.addCanvas('light', buildLight());
  tx.addCanvas('flare', buildFlare());
  tx.addCanvas('puff', buildPuff());
  const lifter = tx.addCanvas('lifter', buildLifter())!;
  lifter.add('l0', 0, 0, 0, LIFTER_W, LIFTER_H);
  lifter.add('l1', 0, LIFTER_W, 0, LIFTER_W, LIFTER_H);
  tx.addCanvas('chute', buildChute());
  // Added after the first release of the tileset: an older page's cached scene never sees it.
  if (!tx.exists('b-comms')) tx.addCanvas('b-comms', buildBuilding('comms'));
  const boulders = tx.addCanvas('boulders', buildBoulders())!;
  for (let l = 0; l < LAYERS.length; l++) boulders.add(`b${l}`, 0, l * TS, 0, TS, TS);
}
