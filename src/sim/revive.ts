// Turn stored or received player data back into a valid Player, filling in anything added
// since it was written and never leaving the rig inside rock.

import { newItems } from './items';
import { newPlayer, placeRig, type Player } from './player';
import { rigBlocked } from './rig';
import { LOGS } from './story';
import { UPGRADES, UPGRADE_ORDER, newUpgrades } from './upgrades';
import type { World } from './world';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function revivePlayer(world: World, raw: unknown): Player {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Player>;
  const base = newPlayer(world, typeof src.name === 'string' ? src.name : 'Miner');
  const p: Player = {
    ...base,
    cash: Math.max(0, num(src.cash, 0)),
    upgrades: { ...newUpgrades(), ...(src.upgrades ?? {}) },
    items: { ...newItems(), ...(src.items ?? {}) },
    cargo: { ...(src.cargo ?? {}) },
    rig: { ...base.rig, ...(src.rig ?? {}) },
    stats: { ...base.stats, ...(src.stats ?? {}) },
    seen: Array.isArray(src.seen) ? src.seen.filter((k) => typeof k === 'string') : [],
    logs: Array.isArray(src.logs) ? [...new Set(src.logs.filter((k) => Number.isInteger(k) && k >= 0 && k < LOGS.length))] : [],
    prestige: Math.max(0, Math.floor(num(src.prestige, 0))),
  };
  for (const k of UPGRADE_ORDER) p.upgrades[k] = Math.max(0, Math.min(UPGRADES[k].tiers.length - 1, Math.floor(num(p.upgrades[k], 0))));
  const r = p.rig;
  if (r.drill) {
    r.x = r.drill.sx;
    r.y = r.drill.sy;
    r.drill = null;
  }
  if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || r.x < 1 || r.x > world.w - 1 || r.y < 0 || r.y > world.h - 1 || rigBlocked(world, r.x, r.y)) {
    const sp = world.spawn();
    placeRig(r, sp.x, sp.y);
  }
  return p;
}
