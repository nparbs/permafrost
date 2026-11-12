// What the Assay Office pays. Two things move a price off its list value:
//  - The market (online only): every unit sold adds to that ore's glut, which pushes its price
//    down for everyone. The glut drains away by itself.
//  - The daily bounty: the Combine pays extra for one ore each day. It comes from the seed and
//    the date, so every screen agrees without sending anything, and it works offline too.

import { hash3 } from './rng';
import { MINERALS, type Mineral } from './tiles';
import type { World } from './world';

/** How much of one ore has been sold lately: `g` units as of `at` (wall-clock seconds, the time of the last sale). */
export interface Glut {
  g: number;
  at: number;
}

/** Mineral key -> glut. Ores nobody has sold lately aren't in it. */
export type Market = Record<string, Glut>;

export const MARKET = {
  /** A flooded market never pays less than this share of the list price. */
  floor: 0.45,
  /** Seconds for a glut to drain to half. */
  halfLife: 20 * 60,
  /** A glut smaller than this is forgotten. */
  dust: 0.5,
  /** A sale in the last this many seconds shows as a falling price. */
  fallingFor: 120,
};

/** What the day's bounty ore pays, as a multiple of its price. */
export const BOUNTY_BONUS = 1.5;
const DAY = 86400;

/** Relics always sell at list price: the Combine wants every one of them. */
export const onMarket = (m: Mineral) => m.kind !== 'relic';

/** Units sold that knock about 37% off the part of the price that can move. Common ores take more to flood. */
export const glutScale = (m: Mineral) => 30 + 2500 * m.freq;

export function glutNow(market: Market | null, key: string, time: number): number {
  const e = market?.[key];
  if (!e) return 0;
  return e.g * 0.5 ** (Math.max(0, time - e.at) / MARKET.halfLife);
}

/** The market's share of the list price right now, from MARKET.floor to 1. */
export function marketFactor(market: Market | null, m: Mineral, time: number): number {
  if (!market || !onMarket(m)) return 1;
  const g = glutNow(market, m.key, time);
  return MARKET.floor + (1 - MARKET.floor) * Math.exp(-g / glutScale(m));
}

/** Which way a price is heading: down right after a sale, back up while a glut drains. */
export function trend(market: Market | null, m: Mineral, time: number): -1 | 0 | 1 {
  const e = market?.[m.key];
  if (!e || !onMarket(m) || marketFactor(market, m, time) > 0.995) return 0;
  return time - e.at < MARKET.fallingFor ? -1 : 1;
}

/** Add a sale to the market. */
export function recordSale(market: Market, key: string, count: number, time: number): void {
  market[key] = { g: glutNow(market, key, time) + count, at: time };
}

/** Drop the ores whose glut has drained away, so the saved market stays small. */
export function pruneMarket(market: Market, time: number): void {
  for (const k in market) if (glutNow(market, k, time) < MARKET.dust) delete market[k];
}

/** Checks a market that came from storage or over the network. */
export function reviveMarket(raw: unknown): Market {
  const out: Market = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const m of MINERALS) {
    const e = (raw as Record<string, unknown>)[m.key] as Partial<Glut> | undefined;
    if (e && typeof e.g === 'number' && typeof e.at === 'number' && e.g > 0 && Number.isFinite(e.g) && Number.isFinite(e.at)) out[m.key] = { g: e.g, at: e.at };
  }
  return out;
}

const BOUNTY_POOL = MINERALS.filter(onMarket);

/** The ore the Combine pays extra for today. It changes at midnight UTC. */
export function bountyOf(seed: number, time: number): Mineral {
  const day = Math.floor(time / DAY);
  return BOUNTY_POOL[Math.floor(hash3(seed, day, 4177) * BOUNTY_POOL.length)];
}

/** Seconds until the bounty changes. */
export const bountyLeft = (time: number) => DAY - (((time % DAY) + DAY) % DAY);

/** What one unit sells for right now. */
export function priceOf(world: World, m: Mineral): number {
  const bonus = bountyOf(world.seed, world.time).key === m.key ? BOUNTY_BONUS : 1;
  return Math.max(1, Math.round(m.value * marketFactor(world.market, m, world.time) * bonus));
}
