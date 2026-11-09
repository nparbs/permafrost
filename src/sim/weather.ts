// Surface weather and steam vents. Both run off the world's wall clock (world.time) and seed,
// so every screen and the server agree without sending anything.

import { hash3 } from './rng';
import { tempAtDepth } from './temperature';
import { T } from './tiles';
import type { World } from './world';

/** Weather comes in slots of this many seconds. Some slots are blizzards. */
export const WEATHER_SLOT = 420;

export const BLIZZARD = {
  /** Share of slots that are blizzards. */
  chance: 0.3,
  /** °C colder at the surface at full strength. */
  chill: 25,
  /** The chill fades out over this many tiles of depth. */
  depth: 12,
  /** Extra thrust fuel above ground, as a share, at full strength. */
  flyBurn: 0.6,
  /** Sideways push in tiles/s² while airborne above ground. */
  wind: 3,
  /** Seconds to build up and die down. */
  ramp: 45,
};

/** Blizzard strength from 0 to 1. */
export function blizzardAt(seed: number, time: number): number {
  const slot = Math.floor(time / WEATHER_SLOT);
  if (hash3(slot, 1, seed + 4242) >= BLIZZARD.chance) return 0;
  const into = time - slot * WEATHER_SLOT;
  return Math.max(0, Math.min(1, into / BLIZZARD.ramp, (WEATHER_SLOT - into) / BLIZZARD.ramp));
}

/** Which way the blizzard blows: -1 or 1. */
export function windDir(seed: number, time: number): number {
  return hash3(Math.floor(time / WEATHER_SLOT), 2, seed + 4242) < 0.5 ? -1 : 1;
}

/** Seconds until the next blizzard starts, or 0 if one is on. Looks a few hours ahead. */
export function nextBlizzard(seed: number, time: number): number {
  if (blizzardAt(seed, time) > 0) return 0;
  const slot = Math.floor(time / WEATHER_SLOT);
  for (let s = slot + 1; s < slot + 40; s++) if (hash3(s, 1, seed + 4242) < BLIZZARD.chance) return s * WEATHER_SLOT - time;
  return Infinity;
}

/** The air temperature at a depth in tiles, with the weather. */
export function ambientTemp(world: World, d: number): number {
  const t = tempAtDepth(d);
  if (d >= BLIZZARD.depth) return t;
  const b = blizzardAt(world.seed, world.time);
  return t - b * BLIZZARD.chill * Math.min(1, 1 - Math.max(0, d) / BLIZZARD.depth);
}

export const STEAM = {
  period: 6,
  on: 1.6,
  /** How far up the steam reaches, in tiles. */
  reach: 5,
  /** Upward push in tiles/s². */
  lift: 36,
  /** Hull damage per second in the column. */
  burn: 7,
};

/** True while the vent at (x, y) is blowing. */
export function ventActive(world: World, x: number, y: number): boolean {
  const phase = (world.time + hash3(x, y, world.seed + 77) * STEAM.period) % STEAM.period;
  return phase < STEAM.on;
}

/** The active vent whose steam reaches the tile (x, y), if any. */
export function steamAt(world: World, x: number, y: number): boolean {
  for (let k = 1; k <= STEAM.reach; k++) {
    const t = world.get(x, y + k);
    if (t === T.VENT) return ventActive(world, x, y + k);
    if (t !== T.AIR && t !== T.WATER) return false;
  }
  return false;
}
