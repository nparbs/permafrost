// Local saves for offline play. The world is stored as its seed plus the tiles that changed.

import { revivePlayer } from '../sim/revive';
import { World } from '../sim/world';
import { LocalSession } from './session';

const KEY = 'permafrost.save.v1';

interface SaveData {
  v: 1;
  seed: number;
  width: number;
  player: unknown;
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

export function saveSession(s: LocalSession): void {
  const p = s.player;
  const r = p.rig;
  // Don't save half a dig: put the rig back where the dig started.
  const player = r.drill ? { ...p, rig: { ...r, x: r.drill.sx, y: r.drill.sy, drill: null } } : p;
  const data: SaveData = { v: 1, seed: s.world.seed, width: s.world.w, player, diffs: [...s.world.diffs], at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: the game still runs */
  }
}

export function loadSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.v !== 1) return null;
    const world = new World(data.seed, data.width);
    world.applyDiffs(data.diffs);
    world.dirty.length = 0;
    return new LocalSession(world, revivePlayer(world, data.player));
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

/** Small preferences that live outside any one game. */
export const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`permafrost.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(`permafrost.${key}`);
      else localStorage.setItem(`permafrost.${key}`, value);
    } catch {
      /* ignore */
    }
  },
};
