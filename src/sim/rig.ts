// Rig physics and digging, one fixed step at a time. Pure logic: the client runs it now,
// and the server will run the same code to stay authoritative.

import { ITEMS, type ItemKey } from './items';
import { RIG_H, RIG_W, cargoCount, placeRig, statsOf, type DrillDir, type Player, type Rig } from './player';
import { tempAtDepth } from './temperature';
import { MINERALS, T, isBlastable, isDiggable, isSolid, tileDef } from './tiles';
import { SKY, type World } from './world';

export const STEP = 1 / 60;

export const PHYS = {
  gravity: 20,
  terminal: 22,
  accelX: 28,
  maxVX: 4.5,
  frictionGround: 30,
  frictionAir: 5,
  thrust: 34,
  maxUp: 5.5,
  /** Impact speed (tiles/s) that does no damage: about three tiles of free fall. */
  fallSafe: 11,
  fallDamage: 2.6,
  /** Seconds per unit of hardness with the stock drill. */
  digTime: 0.42,
  minDigTime: 0.1,
};

/** Fuel burn in litres per second. */
export const BURN = { idle: 0.03, move: 0.08, thrust: 0.22, drill: 0.18 };

export const HAZARD = {
  /** Extra fuel burn per °C below the heater's range. */
  coldBurn: 0.03,
  /** Drill slowdown per °C below the heater's range. */
  coldDrill: 0.015,
  /** Hull damage per second per °C above the radiator's range. */
  heat: 0.05,
  magma: 15,
  gasBase: 6,
  gasPerDepth: 0.06,
};

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export const noInput = (): Input => ({ left: false, right: false, up: false, down: false });

export type HurtCause = 'fall' | 'gas' | 'magma' | 'heat';

export type SimEvent =
  | { t: 'dig-start'; x: number; y: number; tile: number }
  | { t: 'dug'; x: number; y: number; tile: number }
  | { t: 'pickup'; mineral: number }
  | { t: 'cargo-full'; mineral: number }
  | { t: 'hurt'; amount: number; cause: HurtCause }
  | { t: 'land'; speed: number }
  | { t: 'blast'; x: number; y: number; r: number; cause: 'gas' | 'charge' }
  | { t: 'item'; item: ItemKey }
  | { t: 'stalled' }
  | { t: 'wrecked'; cause: HurtCause };

const EPS = 1e-6;

/** Depth in tiles of the rig's underside below the surface. */
export const rigDepth = (r: Rig) => r.y + RIG_H / 2 - SKY;

function hurt(p: Player, amount: number, cause: HurtCause, ev: SimEvent[], announce: boolean): void {
  const r = p.rig;
  if (r.wrecked || amount <= 0) return;
  r.hull = Math.max(0, r.hull - amount);
  if (announce) ev.push({ t: 'hurt', amount, cause });
  if (r.hull <= 0) {
    r.wrecked = true;
    r.drill = null;
    r.vx = 0;
    r.vy = 0;
    ev.push({ t: 'wrecked', cause });
  }
}

function overlapsSolid(world: World, x: number, y: number): { x0: number; x1: number; y0: number; y1: number; hit: boolean } {
  const x0 = Math.floor(x - RIG_W / 2 + EPS);
  const x1 = Math.floor(x + RIG_W / 2 - EPS);
  const y0 = Math.floor(y - RIG_H / 2 + EPS);
  const y1 = Math.floor(y + RIG_H / 2 - EPS);
  let hit = false;
  for (let ty = y0; ty <= y1 && !hit; ty++) for (let tx = x0; tx <= x1; tx++) if (isSolid(world.get(tx, ty))) { hit = true; break; }
  return { x0, x1, y0, y1, hit };
}

/** True if a rig centred at (x, y) would overlap solid ground. */
export function rigBlocked(world: World, x: number, y: number): boolean {
  return overlapsSolid(world, x, y).hit;
}

function moveX(r: Rig, world: World, dx: number): void {
  if (dx === 0) return;
  r.x += dx;
  const o = overlapsSolid(world, r.x, r.y);
  if (!o.hit) return;
  r.x = dx > 0 ? o.x1 - RIG_W / 2 : o.x0 + 1 + RIG_W / 2;
  r.vx = 0;
}

/** Returns the impact speed when the rig lands this step, else 0. */
function moveY(r: Rig, world: World, dy: number): number {
  let impact = 0;
  if (dy !== 0) {
    r.y += dy;
    if (r.y < RIG_H / 2) {
      r.y = RIG_H / 2;
      r.vy = Math.max(0, r.vy);
    }
    const o = overlapsSolid(world, r.x, r.y);
    if (o.hit) {
      if (dy > 0) {
        r.y = o.y1 - RIG_H / 2;
        impact = r.vy;
      } else {
        r.y = o.y0 + 1 + RIG_H / 2;
      }
      r.vy = 0;
    }
  }
  r.grounded = r.vy >= 0 && solidUnder(world, r);
  return impact;
}

function solidUnder(world: World, r: Rig): boolean {
  const ty = Math.floor(r.y + RIG_H / 2 + 0.02);
  const x0 = Math.floor(r.x - RIG_W / 2 + EPS);
  const x1 = Math.floor(r.x + RIG_W / 2 - EPS);
  for (let tx = x0; tx <= x1; tx++) if (isSolid(world.get(tx, ty))) return true;
  return false;
}

function touching(world: World, r: Rig, tile: number): boolean {
  const pad = 0.06;
  const x0 = Math.floor(r.x - RIG_W / 2 - pad);
  const x1 = Math.floor(r.x + RIG_W / 2 + pad);
  const y0 = Math.floor(r.y - RIG_H / 2 - pad);
  const y1 = Math.floor(r.y + RIG_H / 2 + pad);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (world.get(tx, ty) === tile) return true;
  return false;
}

export function digDuration(p: Player, tile: number, coldDeg = 0): number {
  const s = statsOf(p);
  const slow = 1 + coldDeg * HAZARD.coldDrill;
  return Math.max(PHYS.minDigTime, (PHYS.digTime * tileDef(tile).hardness * slow) / s.drill);
}

function startDrill(p: Player, world: World, tx: number, ty: number, dir: DrillDir, cold: number, ev: SimEvent[]): void {
  const r = p.rig;
  const tile = world.get(tx, ty);
  r.drill = {
    tx, ty, dir, t: 0,
    dur: digDuration(p, tile, cold),
    sx: r.x, sy: r.y,
    ex: tx + 0.5,
    ey: ty + 1 - RIG_H / 2,
  };
  r.vx = 0;
  r.vy = 0;
  if (dir !== 'down') r.facing = dir === 'right' ? 1 : -1;
  ev.push({ t: 'dig-start', x: tx, y: ty, tile });
}

/** Clear tiles around a point. Ore caught in the blast is destroyed. */
export function blast(world: World, cx: number, cy: number, radius: number, ev: SimEvent[], cause: 'gas' | 'charge'): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (radius > 1 && (x - cx) ** 2 + (y - cy) ** 2 > radius * radius + 0.5) continue;
      if (y < SKY) continue;
      if (isBlastable(world.get(x, y))) world.set(x, y, T.AIR);
    }
  }
  ev.push({ t: 'blast', x: cx, y: cy, r: radius, cause });
}

function finishDrill(p: Player, world: World, ev: SimEvent[]): void {
  const r = p.rig;
  const d = r.drill!;
  r.drill = null;
  r.x = d.ex;
  r.y = d.ey;
  const tile = world.get(d.tx, d.ty);
  if (!isDiggable(tile)) return; // someone else got there first
  world.set(d.tx, d.ty, T.AIR);
  p.stats.dug++;
  ev.push({ t: 'dug', x: d.tx, y: d.ty, tile });
  const m = tileDef(tile).mineral;
  if (m >= 0) {
    if (cargoCount(p) < statsOf(p).cargo) {
      const key = MINERALS[m].key;
      p.cargo[key] = (p.cargo[key] ?? 0) + 1;
      if (!p.seen.includes(key)) p.seen.push(key);
      ev.push({ t: 'pickup', mineral: m });
    } else {
      ev.push({ t: 'cargo-full', mineral: m });
    }
  }
  if (tile === T.GAS) {
    blast(world, d.tx, d.ty, 1, ev, 'gas');
    hurt(p, HAZARD.gasBase + (d.ty - SKY) * HAZARD.gasPerDepth, 'gas', ev, true);
  }
}

/** Advance one player by dt seconds. Events are appended to `ev`. */
export function step(p: Player, world: World, input: Input, dt: number, ev: SimEvent[]): void {
  const r = p.rig;
  if (r.wrecked) return;
  const s = statsOf(p);
  const depth = rigDepth(r);
  const underground = depth > 0.05;
  if (depth > p.stats.deepest) p.stats.deepest = depth;

  const temp = tempAtDepth(depth);
  const cold = Math.max(0, s.minTemp - temp);
  const hot = Math.max(0, temp - s.maxTemp);
  r.cold = cold > 0;
  r.hot = hot > 0;
  const burnMul = 1 + cold * HAZARD.coldBurn;
  if (hot > 0) hurt(p, hot * HAZARD.heat * dt, 'heat', ev, false);
  if (touching(world, r, T.MAGMA)) hurt(p, HAZARD.magma * dt, 'magma', ev, false);
  if (r.wrecked) return;

  if (r.drill) {
    const d = r.drill;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    r.x = d.sx + (d.ex - d.sx) * k;
    r.y = d.sy + (d.ey - d.sy) * k;
    r.fuel = Math.max(0, r.fuel - BURN.drill * burnMul * dt);
    if (k >= 1) finishDrill(p, world, ev);
    return;
  }

  const hasFuel = r.fuel > 0;
  if (!hasFuel && underground && !r.stalled) {
    r.stalled = true;
    ev.push({ t: 'stalled' });
  } else if (hasFuel || !underground) {
    r.stalled = false;
  }
  // With an empty tank the rig can still crawl along the surface, but not underground.
  const power = hasFuel ? 1 : underground ? 0 : 0.35;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // Start digging when pushing into diggable ground while standing on something.
  let align = 0;
  if (r.grounded && hasFuel && !input.up) {
    const col = Math.floor(r.x);
    const row = Math.floor(r.y);
    if (input.down && dir === 0) {
      const ty = Math.floor(r.y + RIG_H / 2 + 0.05);
      if (isDiggable(world.get(col, ty))) {
        const off = col + 0.5 - r.x;
        if (Math.abs(off) < 0.3) {
          startDrill(p, world, col, ty, 'down', cold, ev);
          return;
        }
        align = off; // slide over the column first
      }
    } else if (dir !== 0) {
      const tx = Math.floor(r.x + dir * (RIG_W / 2 + 0.05));
      if (tx !== col && isDiggable(world.get(tx, row))) {
        startDrill(p, world, tx, row, dir > 0 ? 'right' : 'left', cold, ev);
        return;
      }
    }
  }

  const eng = s.engine;
  if (align !== 0) {
    r.vx = Math.sign(align) * Math.min(3, Math.abs(align) * 14);
  } else if (dir !== 0 && power > 0) {
    r.vx += dir * PHYS.accelX * eng * power * dt;
    r.facing = dir > 0 ? 1 : -1;
  } else {
    const f = (r.grounded ? PHYS.frictionGround : PHYS.frictionAir) * dt;
    r.vx = Math.abs(r.vx) <= f ? 0 : r.vx - Math.sign(r.vx) * f;
  }
  const maxVX = PHYS.maxVX * eng * Math.max(power, 0.35);
  r.vx = Math.max(-maxVX, Math.min(maxVX, r.vx));

  r.thrusting = input.up && hasFuel;
  r.vy += PHYS.gravity * dt;
  if (r.thrusting) {
    r.vy -= PHYS.thrust * eng * dt;
    r.vy = Math.max(r.vy, -PHYS.maxUp * eng);
  }
  r.vy = Math.min(r.vy, PHYS.terminal);

  moveX(r, world, r.vx * dt);
  const impact = moveY(r, world, r.vy * dt);
  if (impact > 4) ev.push({ t: 'land', speed: impact });
  if (impact > PHYS.fallSafe) hurt(p, (impact - PHYS.fallSafe) * PHYS.fallDamage, 'fall', ev, true);

  if (underground || r.thrusting) {
    let burn = underground ? BURN.idle : 0;
    if (Math.abs(r.vx) > 0.2 || !r.grounded) burn += BURN.move;
    if (r.thrusting) burn += BURN.thrust;
    r.fuel = Math.max(0, r.fuel - burn * burnMul * dt);
  }
}

/** Use a consumable. Returns false if it can't be used right now. */
export function useItem(p: Player, world: World, key: ItemKey, ev: SimEvent[]): boolean {
  const r = p.rig;
  if (r.wrecked || (p.items[key] ?? 0) <= 0) return false;
  const s = statsOf(p);
  switch (key) {
    case 'fuelcell':
      if (r.fuel >= s.tank - 0.01) return false;
      r.fuel = Math.min(s.tank, r.fuel + s.tank * 0.5);
      r.stalled = false;
      break;
    case 'repairkit':
      if (r.hull >= s.maxHull - 0.01) return false;
      r.hull = Math.min(s.maxHull, r.hull + s.maxHull * 0.4);
      break;
    case 'charge':
    case 'megacharge':
      if (r.drill || rigDepth(r) < 0.5) return false;
      blast(world, Math.floor(r.x), Math.floor(r.y), key === 'charge' ? 1 : 2, ev, 'charge');
      break;
    case 'beacon': {
      if (rigDepth(r) < 0.5) return false;
      const sp = world.spawn();
      placeRig(r, sp.x, sp.y);
      r.stalled = false;
      break;
    }
  }
  p.items[key]--;
  ev.push({ t: 'item', item: key });
  return true;
}

export { ITEMS };
