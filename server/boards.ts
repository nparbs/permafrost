// Season leaderboards, worked out from every miner's saved stats.

import { BOARD_KEYS, type BoardKey, type BoardRow, type First, type Standings } from '../src/net/protocol';
import type { PlayerStats } from '../src/sim/player';

export const BOARD_SIZE = 10;

export interface Entry {
  id: string;
  name: string;
  stats: Partial<PlayerStats>;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A miner's number on a board. The Hearth board is their fastest time in seconds. */
export const scoreOf = (stats: Partial<PlayerStats> | undefined, key: BoardKey) => (key === 'hearth' ? Math.round(num(stats?.hearthBest)) : Math.floor(num(stats?.[key])));

/** Everyone with something to show on a board, best first. Ties go to the name, so the order is stable. */
export function ranked(entries: Entry[], key: BoardKey): BoardRow[] {
  // The fastest Hearth wins; every other board is "most".
  const dir = key === 'hearth' ? -1 : 1;
  return entries
    .map((e) => ({ id: e.id, name: e.name, v: scoreOf(e.stats, key) }))
    .filter((r) => r.v > 0)
    .sort((a, b) => (b.v - a.v) * dir || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function standings(season: number, entries: Entry[], firsts: First[]): Standings {
  const boards = {} as Record<BoardKey, BoardRow[]>;
  for (const k of BOARD_KEYS) boards[k] = ranked(entries, k).slice(0, BOARD_SIZE);
  return { season, miners: entries.length, boards, firsts };
}

/** Every miner's rank (1 is top, 0 is not on the board) on each board, in BOARD_KEYS order. */
export function allRanks(entries: Entry[]): Record<string, { v: number; rank: number }[]> {
  const out: Record<string, { v: number; rank: number }[]> = {};
  for (const e of entries) out[e.id] = BOARD_KEYS.map((k) => ({ v: scoreOf(e.stats, k), rank: 0 }));
  BOARD_KEYS.forEach((k, i) => ranked(entries, k).forEach((r, n) => (out[r.id][i].rank = n + 1)));
  return out;
}
