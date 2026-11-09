// The world: a seeded grid of tiles plus the list of tiles changed since generation.
// Generation is per tile and order-free, so a server can build it in chunks later.

import { fbm, hash3, valueNoise } from './rng';
import { LAYERS, L, MINERALS, MINERAL_BASE, T, type Mineral } from './tiles';

/** Rows of sky above the ground. Row SKY is the surface row. */
export const SKY = 10;
/** Rows of diggable ground below the surface. */
export const DEPTH = 600;
/** The bottom row is an unbreakable floor. */
export const WORLD_H = SKY + DEPTH + 1;
/** One tile is this many metres, for display. */
export const METERS_PER_TILE = 5;

export type BuildingKey = 'fuel' | 'assay' | 'shop' | 'repair' | 'supply';
export interface Building {
  key: BuildingKey;
  name: string;
  x: number;
  w: number;
}

const BUILDINGS: [BuildingKey, string][] = [
  ['fuel', 'Fuel Depot'],
  ['assay', 'Assay Office'],
  ['shop', 'Machine Shop'],
  ['repair', 'Repair Bay'],
  ['supply', 'Supply Store'],
];
const BUILDING_W = 4;
const BUILDING_GAP = 3;

/** Rime Station: five buildings in a row, centred, with diggable gaps between them. */
export function stationLayout(width: number): Building[] {
  const total = BUILDINGS.length * BUILDING_W + (BUILDINGS.length - 1) * BUILDING_GAP;
  let x = Math.floor((width - total) / 2);
  return BUILDINGS.map(([key, name]) => {
    const b = { key, name, x, w: BUILDING_W };
    x += BUILDING_W + BUILDING_GAP;
    return b;
  });
}

function mineralChance(m: Mineral, d: number, layer: number): number {
  if (d < m.min || d > m.max) return 0;
  if (m.layers && !m.layers.includes(layer)) return 0;
  const k = d <= m.peak ? (d - m.min) / Math.max(1, m.peak - m.min) : (m.max - d) / Math.max(1, m.max - m.peak);
  return m.freq * (0.2 + 0.8 * k);
}

const BOULDER_CHANCE = [0, 0, 0.004, 0.008, 0.015, 0.012, 0.008];

export class World {
  readonly seed: number;
  readonly w: number;
  readonly h = WORLD_H;
  readonly tiles: Uint8Array;
  readonly station: Building[];
  /** Tile index -> tile, for every tile that differs from generation. */
  readonly diffs = new Map<number, number>();
  /** Indices changed since the renderer last looked. */
  readonly dirty: number[] = [];
  /** layerTop[x * LAYERS.length + i] = depth where layer i starts in column x. */
  private readonly layerTop: Int16Array;
  private readonly padCols = new Set<number>();

  constructor(seed: number, width: number) {
    this.seed = seed | 0;
    this.w = width;
    this.tiles = new Uint8Array(width * WORLD_H);
    this.station = stationLayout(width);
    for (const b of this.station) for (let x = b.x; x < b.x + b.w; x++) this.padCols.add(x);
    this.layerTop = new Int16Array(width * LAYERS.length);
    for (let x = 0; x < width; x++) {
      for (let i = 0; i < LAYERS.length; i++) {
        const lay = LAYERS[i];
        const off = (valueNoise(x / 11, i * 7.3, this.seed + 31) - 0.5) * 2 * lay.wobble;
        this.layerTop[x * LAYERS.length + i] = Math.round(lay.top + off);
      }
    }
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < width; x++) this.tiles[y * width + x] = this.generate(x, y);
  }

  /** Layer index at a depth (in tiles below the surface) in column x. */
  layerAtDepth(x: number, d: number): number {
    const cx = Math.max(0, Math.min(this.w - 1, x));
    for (let i = LAYERS.length - 1; i > 0; i--) if (d >= this.layerTop[cx * LAYERS.length + i]) return i;
    return 0;
  }

  layerAt(x: number, y: number): number {
    return this.layerAtDepth(x, y - SKY);
  }

  /** What generation puts at (x, y). */
  generate(x: number, y: number): number {
    const seed = this.seed;
    if (x <= 0 || x >= this.w - 1 || y >= WORLD_H - 1) return T.WALL;
    if (y < SKY) return T.AIR;
    const d = y - SKY;
    if (d === 0 && this.padCols.has(x)) return T.PAD;
    const layer = this.layerAtDepth(x, d);
    const base = LAYERS[layer].tile;
    if (d < 2) return base;

    // Caves: wide ice caverns in the glacier, smaller pockets deeper down.
    if (d > 10) {
      if (layer === L.ICE) {
        if (valueNoise(x / 7, d / 3.5, seed + 101) > 0.8) return T.AIR;
      } else if (layer >= L.PERMA && fbm(x / 6, d / 5, seed + 202) > 0.72) {
        return T.AIR;
      }
    }

    if (layer >= L.BASALT && valueNoise(x / 5, d / 2.5, seed + 303) > 0.83 - (d - 340) * 0.0003) return T.MAGMA;
    if (d > 40 && hash3(x, y, seed + 404) < BOULDER_CHANCE[layer]) return T.BOULDER;
    if (d > 140 && hash3(x, y, seed + 505) < 0.006) return T.GAS;

    const roll = hash3(x, y, seed + 606);
    const vein = valueNoise(x / 3, d / 3, seed + 707) > 0.6 ? 2.5 : 0.5;
    let acc = 0;
    for (let i = 0; i < MINERALS.length; i++) {
      acc += mineralChance(MINERALS[i], d, layer) * vein;
      if (roll < acc) return MINERAL_BASE + i;
    }
    return base;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): number {
    if (y < 0) return T.AIR;
    if (!this.inBounds(x, y)) return T.WALL;
    return this.tiles[y * this.w + x];
  }

  set(x: number, y: number, t: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.tiles[i] === t) return;
    this.tiles[i] = t;
    if (this.generate(x, y) === t) this.diffs.delete(i);
    else this.diffs.set(i, t);
    this.dirty.push(i);
  }

  /** Re-apply saved changes, e.g. after loading. */
  applyDiffs(pairs: [number, number][]): void {
    for (const [i, t] of pairs) {
      if (i < 0 || i >= this.tiles.length) continue;
      this.set(i % this.w, Math.floor(i / this.w), t);
    }
  }

  /** Where a fresh rig appears: on the pad in the middle of the station. */
  spawn(): { x: number; y: number } {
    const mid = this.station[Math.floor(this.station.length / 2)];
    return { x: mid.x + mid.w / 2, y: SKY };
  }
}

/** Depth in tiles of a point below the surface (negative in the sky). */
export const depthOf = (y: number) => y - SKY;
