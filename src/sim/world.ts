// The world: a seeded grid of tiles plus the list of tiles changed since generation.
// Generation is per tile and order-free, so a server can build it in chunks later.

import { fbm, hash3, valueNoise } from './rng';
import type { Market } from './market';
import { LOGS } from './story';
import { LAYERS, L, MINERALS, MINERAL_BASE, MINERAL_INDEX, T, type Mineral } from './tiles';

/** Rows of sky above the ground. Row SKY is the surface row. */
export const SKY = 10;
/** Rows of diggable ground below the surface. */
export const DEPTH = 600;
/** The bottom row is an unbreakable floor. */
export const WORLD_H = SKY + DEPTH + 1;
/** One tile is this many metres, for display. */
export const METERS_PER_TILE = 5;

export type BuildingKey = 'fuel' | 'assay' | 'shop' | 'repair' | 'supply' | 'comms';
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

/**
 * Rime Station: five buildings in a row, centred, with diggable gaps between them, and the Comms
 * Tower (added in v0.5) past the right-hand end, so the first five stayed where they were.
 */
export function stationLayout(width: number): Building[] {
  const total = BUILDINGS.length * BUILDING_W + (BUILDINGS.length - 1) * BUILDING_GAP;
  let x = Math.floor((width - total) / 2);
  const out: Building[] = BUILDINGS.map(([key, name]) => {
    const b = { key, name, x, w: BUILDING_W };
    x += BUILDING_W + BUILDING_GAP;
    return b;
  });
  out.push({ key: 'comms', name: 'Comms Tower', x, w: BUILDING_W });
  return out;
}

/** The straight tunnel: two columns of open shaft from the top of the Geothermal Zone down to the Hearth's antechamber. */
export const SHAFT = { top: 345, bottom: 586 };
/** The antechamber at the foot of the tunnel, where the Hearth's gate stands. Depths in tiles. */
export const ANTE = { top: 586, floor: 598, left: -7, right: 8 };
/** The halls of the Hollow sit on a grid of cells this big, between these depths. */
const RUINS = { top: 468, bottom: 578, cw: 22, ch: 12 };

/** The Hearth arena: a private pocket world a miner fights in. Depths in tiles, x in tiles. */
export const ARENA = {
  w: 31,
  /** The shaft runs up the middle, three tiles wide, from the chamber roof to the surface. */
  shaft: [14, 16] as const,
  left: 3,
  right: 27,
  /** The chamber is open from `roof` down to the row above `floor`. */
  roof: 580,
  floor: 598,
  /** The machine: columns and its top row. The heart is the middle of the top row. */
  core: [13, 17] as const,
  coreTop: 594,
  heart: { x: 15, d: 594 },
  /** The four vents: two on side ledges, two set into the floor. */
  ledge: 588,
  vents: [{ x: 5, d: 588 }, { x: 25, d: 588 }, { x: 8, d: 598 }, { x: 22, d: 598 }],
  /** Where a rig stands when it comes in. */
  start: { x: 10.5, d: 598 },
  /** The gate back out, on the left wall. */
  gate: { x: 3, d: 596 },
};

export type WorldKind = 'main' | 'hearth';

export interface LogSpot {
  /** Index into LOGS. */
  id: number;
  x: number;
  y: number;
}

function mineralChance(m: Mineral, d: number, layer: number): number {
  if (d < m.min || d > m.max) return 0;
  if (m.layers && !m.layers.includes(layer)) return 0;
  const k = d <= m.peak ? (d - m.min) / Math.max(1, m.peak - m.min) : (m.max - d) / Math.max(1, m.max - m.peak);
  return m.freq * (0.2 + 0.8 * k);
}

const BOULDER_CHANCE = [0, 0, 0.004, 0.008, 0.015, 0.012, 0.008];
/** Chance per glacier tile of a meltwater pocket. */
const MELT_CHANCE = 0.011;

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
  /** Called after every tile change. The environment (src/sim/env.ts) listens here. */
  onSet?: (x: number, y: number, was: number, now: number) => void;
  /** Wall-clock seconds, the same on every screen. Steam vents and blizzards run off it. */
  time = 0;
  /** The wall-clock second when day 1 began here (see daytime.ts). */
  dayStart = 0;
  /** True while another miner is online who could bring fuel. Then an empty tank stalls the rig; otherwise it's the end of the rig. */
  rescue = false;
  /** The live ore market (see market.ts). Null offline, where ore always sells at list price. */
  market: Market | null = null;
  /** layerTop[x * LAYERS.length + i] = depth where layer i starts in column x. */
  private readonly layerTop: Int16Array;
  private readonly padCols = new Set<number>();
  /** The left column of the straight tunnel. */
  readonly shaftX: number;
  /** Where the Halvorsen recorders sit. Empty in the Hearth arena. */
  readonly logs: LogSpot[] = [];
  private readonly logAt = new Map<number, number>();

  constructor(
    seed: number,
    width: number,
    /** 'hearth' builds the Hearth arena instead of the dig site. */
    readonly kind: WorldKind = 'main',
  ) {
    this.seed = seed | 0;
    this.w = width;
    this.tiles = new Uint8Array(width * WORLD_H);
    this.station = kind === 'main' ? stationLayout(width) : [];
    this.shaftX = 10 + Math.floor(hash3(this.seed, 1, 7001) * (width - 22));
    if (kind === 'main') this.placeLogs();
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

  /** Pick a spot for each recorder: most by depth at a random column, three at fixed places on the way to the Hearth. */
  private placeLogs(): void {
    const sx = this.shaftX;
    LOGS.forEach((log, id) => {
      let x: number;
      let y = SKY + log.depth;
      if (log.depth === 347) x = sx + 2; // a niche in the wall at the top of the tunnel
      else if (log.depth === 470) x = sx - 1; // a niche halfway down it
      else if (log.depth === 592) {
        // on the antechamber floor
        x = sx + ANTE.left + 2;
        y = SKY + ANTE.floor - 1;
      } else {
        x = 3 + Math.floor(hash3(this.seed, id, 9001) * (this.w - 6));
        // Keep clear of the tunnel and its walls.
        if (Math.abs(x - sx) < 4) x = sx + (x <= sx ? -4 : 5);
        x = Math.max(2, Math.min(this.w - 3, x));
        y += Math.floor(hash3(this.seed, id, 9002) * 4);
      }
      this.logs.push({ id, x, y });
      this.logAt.set(y * this.w + x, id);
    });
  }

  /** The recorder at a tile, as an index into LOGS, or -1. */
  logIdAt(x: number, y: number): number {
    return this.logAt.get(y * this.w + x) ?? -1;
  }

  /** The Hearth arena: solid wall, a shaft to the surface, and the chamber with the machine in it. */
  private arenaTile(x: number, y: number): number {
    if (x <= 0 || x >= this.w - 1 || y >= WORLD_H - 1) return T.WALL;
    if (y < SKY) return T.AIR;
    const A = ARENA;
    const d = y - SKY;
    if (d < A.roof) return x >= A.shaft[0] && x <= A.shaft[1] ? T.AIR : T.WALL;
    if (x < A.left || x > A.right || d > A.floor) return T.WALL;
    if (A.vents.some((v) => v.x === x && v.d === d)) return T.HVENT;
    if (d === A.floor) return T.WALL;
    if (x >= A.core[0] && x <= A.core[1] && d >= A.coreTop) return T.HCORE;
    if (d === A.ledge && (x <= A.left + 3 || x >= A.right - 3)) return T.HCORE;
    if (x === A.gate.x && (d === A.gate.d || d === A.gate.d + 1)) return T.GATE;
    return T.AIR;
  }

  /** What the Hollow's builders left: the straight tunnel, the antechamber and the halls. -1 for ordinary ground. */
  private builtAt(x: number, d: number): number {
    const sx = this.shaftX;
    if (d >= SHAFT.top && d < SHAFT.bottom) {
      if (x === sx || x === sx + 1) return T.AIR;
      if (x === sx - 1 || x === sx + 2) return T.CARVED;
    }
    if (d >= ANTE.top && d <= ANTE.floor && x >= sx + ANTE.left && x <= sx + ANTE.right) {
      if (d === ANTE.top) return x === sx || x === sx + 1 ? T.AIR : T.CARVED;
      if (d === ANTE.floor || x === sx + ANTE.left || x === sx + ANTE.right) return T.CARVED;
      if ((x === sx + 4 || x === sx + 5) && d >= ANTE.floor - 2) return T.GATE;
      return T.AIR;
    }
    if (d < RUINS.top || d >= RUINS.bottom) return -1;
    const cx = Math.floor(x / RUINS.cw);
    const cy = Math.floor((d - RUINS.top) / RUINS.ch);
    if (hash3(cx, cy, this.seed + 7100) >= 0.55) return -1;
    const w = 8 + Math.floor(hash3(cx, cy, this.seed + 7101) * 5);
    const h = 4 + Math.floor(hash3(cx, cy, this.seed + 7102) * 2);
    const lx = x - cx * RUINS.cw - 2 - Math.floor(hash3(cx, cy, this.seed + 7103) * (RUINS.cw - w - 4));
    const ly = d - RUINS.top - cy * RUINS.ch - 2 - Math.floor(hash3(cx, cy, this.seed + 7104) * (RUINS.ch - h - 4));
    if (lx < -1 || lx > w || ly < -1 || ly > h) return -1;
    // Halls stop short of the tunnel and the map's edge.
    if (x < 2 || x > this.w - 3 || Math.abs(x - sx - 0.5) < 4) return -1;
    if (lx === -1 || lx === w || ly === -1 || ly === h) return T.CARVED;
    // Pillars every fourth column, and now and then something left on the floor in the middle.
    if (lx % 4 === 3 && lx < w - 1) return T.CARVED;
    if (ly === h - 1 && lx === Math.floor(w / 2) - 1 && hash3(cx, cy, this.seed + 7105) < 0.17) return MINERAL_BASE + MINERAL_INDEX.relic;
    return T.AIR;
  }

  /** What generation puts at (x, y). */
  generate(x: number, y: number): number {
    if (this.kind === 'hearth') return this.arenaTile(x, y);
    const seed = this.seed;
    if (x <= 0 || x >= this.w - 1 || y >= WORLD_H - 1) return T.WALL;
    if (y < SKY) return T.AIR;
    const d = y - SKY;
    if (d === 0 && this.padCols.has(x)) return T.PAD;
    if (this.logAt.has(y * this.w + x)) return T.LOG;
    const built = d >= SHAFT.top ? this.builtAt(x, d) : -1;
    if (built >= 0) return built;
    const layer = this.layerAtDepth(x, d);
    const base = LAYERS[layer].tile;
    if (d < 2) return base;
    // Plain ground over a recorder, so nothing loose or molten sits on it.
    if (this.logAt.has((y + 1) * this.w + x)) return base;

    // Caves: wide ice caverns in the glacier, smaller pockets deeper down.
    if (d > 10) {
      if (layer === L.ICE) {
        if (this.iceCave(x, d)) return T.AIR;
      } else if (layer >= L.PERMA && fbm(x / 6, d / 5, seed + 202) > 0.72) {
        return T.AIR;
      }
    }

    if (layer >= L.BASALT && valueNoise(x / 5, d / 2.5, seed + 303) > 0.83 - (d - 340) * 0.0003) return T.MAGMA;
    if (d > 40 && hash3(x, y, seed + 404) < BOULDER_CHANCE[layer]) return T.BOULDER;
    if (d > 140 && hash3(x, y, seed + 505) < 0.006) return T.GAS;
    if (layer === L.ICE) {
      // Slabs hang over the ice caverns; meltwater pockets (fuel) sit through the glacier.
      if (d > 12 && this.iceCave(x, d + 1) && hash3(x, y, seed + 808) < 0.45) return T.SLAB;
      if (d > 32 && hash3(x, y, seed + 909) < MELT_CHANCE) return T.MELT;
    }
    if (layer === L.BASALT && hash3(x, y, seed + 1010) < 0.007) return T.VENT;

    const roll = hash3(x, y, seed + 606);
    const vein = valueNoise(x / 3, d / 3, seed + 707) > 0.6 ? 2.5 : 0.5;
    return this.pickMineral(d, layer, roll, vein) ?? base;
  }

  /** A mineral for this depth and layer from a roll in [0, 1), or null for plain ground. */
  pickMineral(d: number, layer: number, roll: number, vein = 1): number | null {
    let acc = 0;
    for (let i = 0; i < MINERALS.length; i++) {
      acc += mineralChance(MINERALS[i], d, layer) * vein;
      if (roll < acc) return MINERAL_BASE + i;
    }
    return null;
  }

  private iceCave(x: number, d: number): boolean {
    return d > 10 && this.layerAtDepth(x, d) === L.ICE && valueNoise(x / 7, d / 3.5, this.seed + 101) > 0.8;
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
    const was = this.tiles[i];
    if (was === t) return;
    this.tiles[i] = t;
    if (this.generate(x, y) === t) this.diffs.delete(i);
    else this.diffs.set(i, t);
    this.dirty.push(i);
    this.onSet?.(x, y, was, t);
  }

  /** Re-apply saved changes, e.g. after loading. */
  applyDiffs(pairs: [number, number][]): void {
    for (const [i, t] of pairs) {
      if (i < 0 || i >= this.tiles.length) continue;
      // A world saved before v0.5 may have a hole where a pad, a recorder or the gate now is. Those stay.
      const gen = this.tiles[i];
      if (gen === T.PAD || gen === T.LOG || gen === T.GATE) continue;
      this.set(i % this.w, Math.floor(i / this.w), t);
    }
  }

  /** Where a fresh rig appears: on the pad in the middle of the station. */
  spawn(): { x: number; y: number } {
    if (this.kind === 'hearth') return { x: ARENA.start.x, y: SKY + ARENA.start.d };
    const mid = this.station[2];
    return { x: mid.x + mid.w / 2, y: SKY };
  }
}

/** Depth in tiles of a point below the surface (negative in the sky). */
export const depthOf = (y: number) => y - SKY;
