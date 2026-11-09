// Tile ids, layers and minerals. One byte per tile.

export const T = {
  AIR: 0,
  SNOW: 1,
  FIRN: 2,
  ICE: 3,
  PERMA: 4,
  ROCK: 5,
  BASALT: 6,
  RUIN: 7,
  BOULDER: 8,
  GAS: 9,
  MAGMA: 10,
  WALL: 11,
  PAD: 12,
  /** Thin new ice where a tunnel froze over. Thrusting up into it breaks it. */
  RIME: 13,
  /** A loose block of glacier ice. Falls if the space under it opens up. */
  SLAB: 14,
  /** Meltwater trapped in the glacier. Drilling it tops up the tank: the rig cracks water into fuel. */
  MELT: 15,
  // Minerals take 16 to 47.
  /** Standing meltwater. No longer made (pockets used to flood tunnels before v0.3.1); any left in a saved world slows the rig, then freezes into rime. */
  WATER: 48,
  /** A steam vent: blows scalding steam straight up every few seconds. */
  VENT: 49,
  /** Magma that flowed into a tunnel and cooled. Diggable. */
  SLAG: 50,
} as const;

/** Minerals take ids MINERAL_BASE + index into MINERALS. */
export const MINERAL_BASE = 16;

export interface Layer {
  key: string;
  name: string;
  /** Depth in tiles below the surface where this layer starts. */
  top: number;
  tile: number;
  /** How far the boundary wanders up and down, in tiles. */
  wobble: number;
}

export const LAYERS: Layer[] = [
  { key: 'snow', name: 'Snowpack', top: 0, tile: T.SNOW, wobble: 0 },
  { key: 'firn', name: 'Firn', top: 6, tile: T.FIRN, wobble: 2 },
  { key: 'ice', name: 'Glacier', top: 30, tile: T.ICE, wobble: 5 },
  { key: 'perma', name: 'Permafrost', top: 125, tile: T.PERMA, wobble: 6 },
  { key: 'rock', name: 'Bedrock', top: 220, tile: T.ROCK, wobble: 8 },
  { key: 'basalt', name: 'Geothermal Zone', top: 340, tile: T.BASALT, wobble: 8 },
  { key: 'ruin', name: 'The Hollow', top: 460, tile: T.RUIN, wobble: 5 },
];

export const L = { SNOW: 0, FIRN: 1, ICE: 2, PERMA: 3, ROCK: 4, BASALT: 5, RUIN: 6 } as const;

export type MineralKind = 'ore' | 'gem' | 'relic';

export interface Mineral {
  key: string;
  name: string;
  kind: MineralKind;
  value: number;
  hardness: number;
  /** Depth range in tiles, with the most common depth at `peak`. */
  min: number;
  peak: number;
  max: number;
  /** Chance per tile at the peak, before vein clustering. */
  freq: number;
  /** Only appears in these layers. */
  layers?: number[];
  color: string;
  light: string;
}

export const MINERALS: Mineral[] = [
  { key: 'tin', name: 'Tin', kind: 'ore', value: 15, hardness: 0.8, min: 2, peak: 25, max: 150, freq: 0.035, color: '#8f989e', light: '#dfe5e8' },
  { key: 'copper', name: 'Copper', kind: 'ore', value: 30, hardness: 1.0, min: 5, peak: 60, max: 210, freq: 0.03, color: '#b8643a', light: '#f3a578' },
  { key: 'cobalt', name: 'Cobalt', kind: 'ore', value: 60, hardness: 1.2, min: 30, peak: 120, max: 270, freq: 0.024, color: '#2f55c8', light: '#88a8ff' },
  { key: 'cryolite', name: 'Cryolite', kind: 'gem', value: 95, hardness: 1.1, min: 30, peak: 75, max: 130, freq: 0.02, layers: [L.ICE], color: '#d6f4ff', light: '#ffffff' },
  { key: 'silver', name: 'Silver', kind: 'ore', value: 150, hardness: 1.5, min: 80, peak: 180, max: 340, freq: 0.018, color: '#c6ccd6', light: '#ffffff' },
  { key: 'gold', name: 'Gold', kind: 'ore', value: 320, hardness: 1.7, min: 140, peak: 260, max: 420, freq: 0.014, color: '#e0a81c', light: '#ffe68a' },
  { key: 'glacite', name: 'Glacite', kind: 'gem', value: 600, hardness: 1.4, min: 85, peak: 110, max: 135, freq: 0.006, layers: [L.ICE], color: '#1fc4e0', light: '#c8fbff' },
  { key: 'platinum', name: 'Platinum', kind: 'ore', value: 850, hardness: 2.2, min: 220, peak: 360, max: 500, freq: 0.011, color: '#e4ebf2', light: '#ffffff' },
  { key: 'sunstone', name: 'Sunstone', kind: 'gem', value: 1600, hardness: 2.6, min: 320, peak: 420, max: 560, freq: 0.008, color: '#ff9a1f', light: '#fff2a8' },
  { key: 'emberite', name: 'Emberite', kind: 'gem', value: 2800, hardness: 2.9, min: 380, peak: 480, max: 600, freq: 0.0065, color: '#e2283a', light: '#ffa0a8' },
  { key: 'voidglass', name: 'Voidglass', kind: 'gem', value: 4800, hardness: 3.3, min: 460, peak: 540, max: 600, freq: 0.005, color: '#7a33e0', light: '#dcc0ff' },
  { key: 'heartshard', name: 'Heartshard', kind: 'gem', value: 9500, hardness: 3.6, min: 520, peak: 595, max: 600, freq: 0.0035, color: '#ff4fa8', light: '#ffd8ee' },
  { key: 'fossil', name: 'Frozen Fossil', kind: 'relic', value: 700, hardness: 1.5, min: 120, peak: 170, max: 230, freq: 0.0012, layers: [L.PERMA], color: '#e8dcc0', light: '#fffaf0' },
  { key: 'cache', name: 'Expedition Cache', kind: 'relic', value: 2200, hardness: 1.2, min: 60, peak: 200, max: 340, freq: 0.0006, color: '#c84a2a', light: '#ffd040' },
  { key: 'relic', name: 'Hollow Relic', kind: 'relic', value: 14000, hardness: 3.5, min: 460, peak: 530, max: 600, freq: 0.0008, layers: [L.RUIN], color: '#30e0c0', light: '#c8fff2' },
];

export const MINERAL_INDEX: Record<string, number> = Object.fromEntries(MINERALS.map((m, i) => [m.key, i]));

export interface TileDef {
  name: string;
  solid: boolean;
  diggable: boolean;
  hardness: number;
  /** Index into MINERALS, or -1. */
  mineral: number;
}

const WALL_DEF: TileDef = { name: 'Bedrock wall', solid: true, diggable: false, hardness: 0, mineral: -1 };

export const TILES: TileDef[] = [];
function def(id: number, name: string, solid: boolean, diggable: boolean, hardness: number, mineral = -1) {
  TILES[id] = { name, solid, diggable, hardness, mineral };
}
def(T.AIR, 'Air', false, false, 0);
def(T.SNOW, 'Snow', true, true, 0.35);
def(T.FIRN, 'Firn', true, true, 0.6);
def(T.ICE, 'Glacier ice', true, true, 0.9);
def(T.PERMA, 'Frozen soil', true, true, 1.3);
def(T.ROCK, 'Granite', true, true, 1.9);
def(T.BASALT, 'Basalt', true, true, 2.5);
def(T.RUIN, 'Hollow stone', true, true, 3.1);
def(T.BOULDER, 'Boulder', true, false, 0);
def(T.GAS, 'Gas pocket', true, true, 1.5);
def(T.MAGMA, 'Magma', true, false, 0);
def(T.WALL, 'Bedrock wall', true, false, 0);
def(T.PAD, 'Station pad', true, false, 0);
def(T.RIME, 'Rime', true, true, 0.3);
def(T.SLAB, 'Ice slab', true, true, 0.8);
def(T.MELT, 'Meltwater pocket', true, true, 0.6);
def(T.WATER, 'Meltwater', false, false, 0);
def(T.VENT, 'Steam vent', true, false, 0);
def(T.SLAG, 'Slag', true, true, 1.6);
MINERALS.forEach((m, i) => def(MINERAL_BASE + i, m.name, true, true, m.hardness, i));

export function tileDef(t: number): TileDef {
  return TILES[t] ?? WALL_DEF;
}
export const isSolid = (t: number) => tileDef(t).solid;
export const isMineral = (t: number) => t >= MINERAL_BASE && t < MINERAL_BASE + MINERALS.length;
export const isDiggable = (t: number) => tileDef(t).diggable;
/** Tiles a thermal charge can clear. */
export const isBlastable = (t: number) => t === T.BOULDER || t === T.VENT || isDiggable(t);
/** Tiles that drop when nothing holds them up. */
export const isLoose = (t: number) => t === T.BOULDER || t === T.SLAB;
