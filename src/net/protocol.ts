// Messages between the page and the server. Both sides import this file.

import type { Action, ActResult } from '../sim/actions';
import type { Player, PlayerStats, Rig } from '../sim/player';
import type { Input, SimEvent } from '../sim/rig';

/** Bump when old pages can't talk to a new server. They're told to refresh. */
export const PROTOCOL_VERSION = 4;

export const packInput = (i: Input): number => (i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.up ? 4 : 0) | (i.down ? 8 : 0);
export const unpackInput = (b: number): Input => ({ left: (b & 1) > 0, right: (b & 2) > 0, up: (b & 4) > 0, down: (b & 8) > 0 });

export const PAINT_COUNT = 6;
export const NAME_MAX = 14;
export const CHAT_MAX = 90;

export interface PeerInfo {
  id: string;
  name: string;
  paint: number;
}

export const RigMode = { Idle: 0, Moving: 1, DrillSide: 2, DrillDown: 3 } as const;
export const RIG_THRUST = 1;
export const RIG_WRECKED = 2;
/** Out of fuel underground, waiting for help. */
export const RIG_STALLED = 4;
/** Stalled, and the SOS has gone out. */
export const RIG_SOS = 8;

/** Another rig, as nearby players see it: [id, x, y, facing, mode, flags]. */
export type RigView = [string, number, number, number, number, number];

/** Every miner in the world, for the map, about once a second: [id, x, y, flags]. */
export type MapDot = [string, number, number, number];

export interface WorldInfo {
  id: string;
  seed: number;
  width: number;
  season: number;
  /** Changed tiles, packed by encodeDiffs. */
  diffs: string;
}

export type ClientMsg =
  | { t: 'hello'; v: number; token?: string; name?: string; paint?: number }
  /** Inputs for ticks s, s+1, ... (one per 1/60 s). */
  | { t: 'in'; s: number; i: number[] }
  | { t: 'act'; id: number; act: Action }
  | { t: 'chat'; text: string }
  | { t: 'profile'; name: string; paint: number }
  /** Ask everyone for fuel. Only works while stalled. The server also sends one out by itself when a rig stalls. */
  | { t: 'sos' }
  /** Give a Fuel Cell to the stalled miner `id` parked next to you. */
  | { t: 'aid'; id: string };

export type ServerMsg =
  /** `now` is the server's clock in ms, so weather and steam vents line up. */
  | { t: 'welcome'; v: number; token: string; you: PeerInfo; world: WorldInfo; player: Player; peers: PeerInfo[]; online: number; now: number }
  /** Your rig as the server has it after input `ack`. Items are here because an empty tank burns a Fuel Cell. */
  | { t: 'snap'; ack: number; rig: Rig; cargo: Record<string, number>; items: Player['items']; stats: PlayerStats }
  /** Your full state, after anything changes your cash, upgrades or items. */
  | { t: 'me'; player: Player }
  | { t: 'res'; id: number; res: ActResult }
  /** Tile changes as flat pairs: [index, tile, index, tile, ...]. */
  | { t: 'tiles'; d: number[] }
  | { t: 'rigs'; r: RigView[]; online: number }
  | { t: 'peer'; p: PeerInfo }
  | { t: 'leave'; id: string }
  /** Something another player set off, like a blast, or the world did (by is ''), like a rockfall. */
  | { t: 'fx'; e: SimEvent; by: string }
  /** Events from your own action, like using a charge. */
  | { t: 'ev'; e: SimEvent[] }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'map'; p: MapDot[] }
  /** A miner is stalled and asking for help. `depth` is in tiles. */
  | { t: 'sos'; id: string; name: string; depth: number }
  /** `by` refuelled `to`, who paid `fee`. Everyone hears about it. */
  | { t: 'rescue'; by: string; byName: string; to: string; toName: string; fee: number }
  | { t: 'error'; code: 'version' | 'token' | 'replaced' | 'full'; msg: string };

/** Pack [index, tile] pairs into base64: 4 bytes each, little-endian, index << 8 | tile. */
export function encodeDiffs(pairs: Iterable<[number, number]>): string {
  const list = [...pairs];
  const bytes = new Uint8Array(list.length * 4);
  const view = new DataView(bytes.buffer);
  list.forEach(([i, t], k) => view.setUint32(k * 4, ((i << 8) | (t & 255)) >>> 0, true));
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(bin);
}

export function decodeDiffs(s: string): [number, number][] {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  const view = new DataView(bytes.buffer);
  const out: [number, number][] = [];
  for (let k = 0; k + 4 <= bytes.length; k += 4) {
    const v = view.getUint32(k, true);
    out.push([v >>> 8, v & 255]);
  }
  return out;
}

/** Keep names short and printable. Returns '' if nothing usable is left. */
export function cleanName(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[^A-Za-z0-9 _.'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

export function cleanChat(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX);
}
