// Local saves. The world is stored as its seed plus the tiles that changed.

import { newItems } from '../sim/items';
import { newPlayer, type Player } from '../sim/player';
import { newUpgrades } from '../sim/upgrades';
import { World } from '../sim/world';
import { Session } from './session';

const KEY = 'permafrost.save.v1';

interface SaveData {
  v: 1;
  seed: number;
  width: number;
  player: Player;
  diffs: [number, number][];
  at: number;
}

export function hasSave(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function saveSession(s: Session): void {
  const r = s.player.rig;
  const player: Player = structuredClone(s.player);
  // Don't save half a dig: put the rig back where the dig started.
  if (r.drill) {
    player.rig.x = r.drill.sx;
    player.rig.y = r.drill.sy;
    player.rig.drill = null;
  }
  const data: SaveData = { v: 1, seed: s.world.seed, width: s.world.w, player, diffs: [...s.world.diffs], at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: the game still runs */
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.v !== 1) return null;
    const world = new World(data.seed, data.width);
    world.applyDiffs(data.diffs);
    world.dirty.length = 0;
    // Fill in anything added since the save was written.
    const base = newPlayer(world);
    const p = data.player;
    const player: Player = {
      ...base,
      ...p,
      upgrades: { ...newUpgrades(), ...p.upgrades },
      items: { ...newItems(), ...p.items },
      rig: { ...base.rig, ...p.rig, drill: null },
      stats: { ...base.stats, ...p.stats },
      seen: p.seen ?? [],
    };
    return new Session(world, player);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
