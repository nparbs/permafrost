// A player's persistent state: the rig, its upgrades, cash, cargo and items.

import { newItems, type ItemKey } from './items';
import { MINERALS } from './tiles';
import { newUpgrades, tierOf, type Upgrades } from './upgrades';
import type { World } from './world';

/** The rig's collision box, in tiles. */
export const RIG_W = 0.75;
export const RIG_H = 0.75;

export type DrillDir = 'left' | 'right' | 'down';

/** What damaged or finished off a rig. 'fuel' is an empty tank with nobody around to help. */
export type HurtCause = 'fall' | 'gas' | 'magma' | 'heat' | 'rock' | 'steam' | 'fuel';

export interface Drill {
  tx: number;
  ty: number;
  dir: DrillDir;
  t: number;
  dur: number;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
}

export interface Rig {
  /** Centre of the collision box, in tiles. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: -1 | 1;
  grounded: boolean;
  thrusting: boolean;
  drill: Drill | null;
  fuel: number;
  hull: number;
  /** Out of fuel underground, waiting for another miner. In the air a parachute lets it down gently. */
  stalled: boolean;
  wrecked: boolean;
  /** What wrecked it, for the death scene. */
  wreckedBy: HurtCause | null;
  /** Below the heater's range: burns more fuel and digs slower. */
  cold: boolean;
  /** Above the radiator's range: the hull takes damage. */
  hot: boolean;
  /** In a steam vent's blast. */
  scald: boolean;
}

export interface PlayerStats {
  deepest: number;
  earned: number;
  trips: number;
  dug: number;
  /** Stalled miners you refuelled. */
  rescues: number;
  /** Rigs lost. */
  deaths: number;
}

export interface Player {
  name: string;
  cash: number;
  upgrades: Upgrades;
  /** Mineral key -> count. */
  cargo: Record<string, number>;
  items: Record<ItemKey, number>;
  rig: Rig;
  stats: PlayerStats;
  /** Mineral keys this player has dug up at least once. */
  seen: string[];
}

export interface Stats {
  drill: number;
  maxHull: number;
  engine: number;
  tank: number;
  cargo: number;
  minTemp: number;
  maxTemp: number;
  /** Headlamp reach in tiles. */
  lamp: number;
}

export function statsOf(p: Player): Stats {
  const u = p.upgrades;
  return {
    drill: tierOf(u, 'drill').value,
    maxHull: tierOf(u, 'hull').value,
    engine: tierOf(u, 'engine').value,
    tank: tierOf(u, 'tank').value,
    cargo: tierOf(u, 'cargo').value,
    minTemp: tierOf(u, 'heater').value,
    maxTemp: tierOf(u, 'radiator').value,
    lamp: tierOf(u, 'lamp').value,
  };
}

/** A rig resting on the ground at (x, groundY), where groundY is the top of the floor tile. */
export function placeRig(r: Rig, x: number, groundY: number): void {
  r.x = x;
  r.y = groundY - RIG_H / 2;
  r.vx = 0;
  r.vy = 0;
  r.drill = null;
  r.grounded = true;
  r.thrusting = false;
}

export function newPlayer(world: World, name = 'Miner'): Player {
  const upgrades = newUpgrades();
  const p: Player = {
    name,
    cash: 0,
    upgrades,
    cargo: {},
    items: newItems(),
    rig: {
      x: 0, y: 0, vx: 0, vy: 0, facing: 1, grounded: true, thrusting: false, drill: null,
      fuel: 0, hull: 0, stalled: false, wrecked: false, wreckedBy: null, cold: false, hot: false, scald: false,
    },
    stats: { deepest: 0, earned: 0, trips: 0, dug: 0, rescues: 0, deaths: 0 },
    seen: [],
  };
  // One Fuel Cell to start with: it fires by itself the first time the tank runs dry.
  p.items.fuelcell = 1;
  const s = statsOf(p);
  p.rig.fuel = s.tank;
  p.rig.hull = s.maxHull;
  const sp = world.spawn();
  placeRig(p.rig, sp.x, sp.y);
  return p;
}

export function cargoCount(p: Player): number {
  let n = 0;
  for (const k in p.cargo) n += p.cargo[k];
  return n;
}

export function cargoValue(p: Player): number {
  let v = 0;
  for (const m of MINERALS) v += (p.cargo[m.key] ?? 0) * m.value;
  return v;
}
