// Rime Station services. Every function checks money and limits itself, so the server can
// call the same ones when players buy things online.

import { ITEMS, ITEM_STACK, type ItemKey } from './items';
import { RIG_H, cargoCount, placeRig, statsOf, type Player } from './player';
import { onMarket, priceOf, recordSale } from './market';
import { MINERALS, MINERAL_INDEX } from './tiles';
import { UPGRADES, type UpgradeKey } from './upgrades';
import { SKY, type Building, type World } from './world';

export const FUEL_PRICE = 2; // per litre
export const REPAIR_PRICE = 3; // per hull point
/** What a stalled miner pays whoever refuels them: a share of their cash plus a flat part. */
export const RESCUE_SHARE = 0.15;
export const RESCUE_FLAT = 50;

/** The building the rig is parked in front of, if any. */
export function buildingAt(world: World, p: Player): Building | null {
  const r = p.rig;
  if (r.drill || r.wrecked || !r.grounded) return null;
  if (Math.abs(r.y + RIG_H / 2 - SKY) > 0.05) return null;
  const col = Math.floor(r.x);
  return world.station.find((b) => col >= b.x && col < b.x + b.w) ?? null;
}

export interface SaleLine {
  key: string;
  name: string;
  count: number;
  each: number;
  total: number;
}

/** The cargo at today's prices (see market.ts). */
export function saleLines(p: Player, world: World): SaleLine[] {
  const lines: SaleLine[] = [];
  for (const m of MINERALS) {
    const count = p.cargo[m.key] ?? 0;
    if (count <= 0) continue;
    const each = priceOf(world, m);
    lines.push({ key: m.key, name: m.name, count, each, total: count * each });
  }
  return lines;
}

/** Sell the whole cargo at the price each ore has right now. Online, the sale then pushes those prices down. */
export function sellAll(p: Player, world: World): { lines: SaleLine[]; total: number } {
  const lines = saleLines(p, world);
  const total = lines.reduce((s, l) => s + l.total, 0);
  if (total > 0) {
    p.cash += total;
    p.stats.earned += total;
    p.stats.trips++;
    p.cargo = {};
    if (world.market) for (const l of lines) if (onMarket(MINERALS[MINERAL_INDEX[l.key]])) recordSale(world.market, l.key, l.count, world.time);
  }
  return { lines, total };
}

export function refuelCost(p: Player): number {
  return Math.ceil((statsOf(p).tank - p.rig.fuel) * FUEL_PRICE);
}

/** Buy fuel, as much as `budget` allows (default: fill up). Returns litres bought. */
export function refuel(p: Player, litres = Infinity): number {
  const s = statsOf(p);
  const want = Math.min(litres, s.tank - p.rig.fuel);
  const afford = p.cash / FUEL_PRICE;
  const buy = Math.max(0, Math.min(want, afford));
  if (buy <= 0) return 0;
  p.cash = Math.max(0, p.cash - Math.ceil(buy * FUEL_PRICE));
  p.rig.fuel = Math.min(s.tank, p.rig.fuel + buy);
  p.rig.stalled = false;
  return buy;
}

export function repairCost(p: Player): number {
  return Math.ceil((statsOf(p).maxHull - p.rig.hull) * REPAIR_PRICE);
}

/** Repair as much as you can afford. Returns hull points restored. */
export function repair(p: Player): number {
  const s = statsOf(p);
  const want = s.maxHull - p.rig.hull;
  const buy = Math.max(0, Math.min(want, p.cash / REPAIR_PRICE));
  if (buy <= 0) return 0;
  p.cash = Math.max(0, p.cash - Math.ceil(buy * REPAIR_PRICE));
  p.rig.hull = Math.min(s.maxHull, p.rig.hull + buy);
  return buy;
}

export type BuyResult = 'ok' | 'cash' | 'max';

export function buyUpgrade(p: Player, key: UpgradeKey): BuyResult {
  const line = UPGRADES[key];
  const next = p.upgrades[key] + 1;
  if (next >= line.tiers.length) return 'max';
  const cost = line.tiers[next].cost;
  if (p.cash < cost) return 'cash';
  p.cash -= cost;
  p.upgrades[key] = next;
  // A new hull arrives fully repaired; other upgrades keep what's in the tank.
  if (key === 'hull') p.rig.hull = statsOf(p).maxHull;
  return 'ok';
}

export function buyItem(p: Player, key: ItemKey): BuyResult {
  if ((p.items[key] ?? 0) >= ITEM_STACK) return 'max';
  const cost = ITEMS[key].cost;
  if (p.cash < cost) return 'cash';
  p.cash -= cost;
  p.items[key] = (p.items[key] ?? 0) + 1;
  return 'ok';
}

export function rescueFee(p: Player): number {
  return Math.min(p.cash, Math.round(RESCUE_FLAT + p.cash * RESCUE_SHARE));
}

/** How close (in tiles, each way) a helper must park to hand over fuel. */
export const AID_REACH = 2.5;

export type AidResult = { ok: true; fee: number; litres: number } | { ok: false; why: 'item' | 'far' | 'state' };

/**
 * One miner hands a Fuel Cell to a stalled one parked next to them. The stalled miner keeps
 * their cargo and spot, and pays the helper the rescue fee.
 */
export function aid(helper: Player, target: Player): AidResult {
  const h = helper.rig;
  const t = target.rig;
  if (helper === target || !t.stalled || t.wrecked || h.stalled || h.wrecked || h.drill) return { ok: false, why: 'state' };
  if ((helper.items.fuelcell ?? 0) <= 0) return { ok: false, why: 'item' };
  if (Math.abs(h.x - t.x) > AID_REACH || Math.abs(h.y - t.y) > AID_REACH) return { ok: false, why: 'far' };
  const tank = statsOf(target).tank;
  const litres = Math.min(tank - t.fuel, tank * 0.5);
  helper.items.fuelcell--;
  t.fuel += litres;
  t.stalled = false;
  const fee = rescueFee(target);
  target.cash -= fee;
  helper.cash += fee;
  helper.stats.earned += fee;
  helper.stats.rescues++;
  return { ok: true, fee, litres };
}

/**
 * A new rig at the station after a wreck, or after giving up on a stall. The ore on board is
 * lost; cash, upgrades and items are kept, and the rig arrives fuelled and repaired.
 * Returns how much ore was lost.
 */
export function respawn(p: Player, world: World): number {
  const lost = cargoCount(p);
  const s = statsOf(p);
  p.cargo = {};
  p.stats.deaths++;
  const r = p.rig;
  r.wrecked = false;
  r.wreckedBy = null;
  r.stalled = false;
  r.cold = r.hot = r.scald = false;
  r.fuel = s.tank;
  r.hull = s.maxHull;
  const sp = world.spawn();
  placeRig(r, sp.x, sp.y);
  return lost;
}

export const cargoFree = (p: Player) => statsOf(p).cargo - cargoCount(p);
