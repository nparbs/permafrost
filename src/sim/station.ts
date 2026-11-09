// Rime Station services. Every function checks money and limits itself, so the server can
// call the same ones when players buy things online.

import { ITEMS, ITEM_STACK, type ItemKey } from './items';
import { RIG_H, cargoCount, placeRig, statsOf, type Player } from './player';
import { MINERALS } from './tiles';
import { UPGRADES, type UpgradeKey } from './upgrades';
import { SKY, type Building, type World } from './world';

export const FUEL_PRICE = 2; // per litre
export const REPAIR_PRICE = 3; // per hull point
/** Share of your cash a tow costs, plus a flat part. */
export const TOW_SHARE = 0.15;
export const TOW_FLAT = 50;

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

export function saleLines(p: Player): SaleLine[] {
  const lines: SaleLine[] = [];
  for (const m of MINERALS) {
    const count = p.cargo[m.key] ?? 0;
    if (count > 0) lines.push({ key: m.key, name: m.name, count, each: m.value, total: count * m.value });
  }
  return lines;
}

export function sellAll(p: Player): { lines: SaleLine[]; total: number } {
  const lines = saleLines(p);
  const total = lines.reduce((s, l) => s + l.total, 0);
  if (total > 0) {
    p.cash += total;
    p.stats.earned += total;
    p.stats.trips++;
    p.cargo = {};
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

export function towFee(p: Player): number {
  return Math.min(p.cash, Math.round(TOW_FLAT + p.cash * TOW_SHARE));
}

/** Haul a stranded or wrecked rig back to the station. Cargo is lost. */
export function tow(p: Player, world: World): number {
  const fee = towFee(p);
  const s = statsOf(p);
  p.cash -= fee;
  p.cargo = {};
  const r = p.rig;
  r.wrecked = false;
  r.stalled = false;
  r.fuel = Math.max(r.fuel, s.tank * 0.3);
  r.hull = Math.max(r.hull, s.maxHull * 0.3);
  const sp = world.spawn();
  placeRig(r, sp.x, sp.y);
  return fee;
}

export const cargoFree = (p: Player) => statsOf(p).cargo - cargoCount(p);
