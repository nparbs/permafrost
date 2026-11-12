// Things a player asks for besides moving: station services, items and respawns. Offline the
// client applies them directly; online the server applies the same function and has the
// final say. Each one checks where the rig is, so you can't sell ore from 2 km down.

import { ITEMS, type ItemKey } from './items';
import type { Player } from './player';
import { useItem, type SimEvent } from './rig';
import { buildingAt, buyItem, buyUpgrade, refuel, repair, respawn, sellAll } from './station';
import { UPGRADES, type UpgradeKey } from './upgrades';
import type { BuildingKey, World } from './world';

export type Action =
  | { a: 'sell' }
  | { a: 'refuel'; litres?: number }
  | { a: 'repair' }
  | { a: 'upgrade'; k: UpgradeKey }
  | { a: 'buy'; k: ItemKey }
  /** Start over at the station after a wreck, or give up on a stall. */
  | { a: 'respawn' }
  | { a: 'use'; k: ItemKey };

export type Why = 'cash' | 'max' | 'where' | 'state' | 'bad';

export interface ActResult {
  ok: boolean;
  why?: Why;
  /** Cash earned (sell). */
  total?: number;
  /** Litres or hull points bought, or ore lost (respawn). */
  amount?: number;
}

const NEEDS: Partial<Record<Action['a'], BuildingKey>> = {
  sell: 'assay',
  refuel: 'fuel',
  repair: 'repair',
  upgrade: 'shop',
  buy: 'supply',
};

/** Checks an action that arrived over the network. */
export function isAction(x: unknown): x is Action {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  switch (o.a) {
    case 'sell':
    case 'repair':
    case 'respawn':
      return true;
    case 'refuel':
      return o.litres === undefined || (typeof o.litres === 'number' && o.litres > 0 && o.litres <= 1000);
    case 'upgrade':
      return typeof o.k === 'string' && Object.hasOwn(UPGRADES, o.k);
    case 'buy':
    case 'use':
      return typeof o.k === 'string' && Object.hasOwn(ITEMS, o.k);
    default:
      return false;
  }
}

export function applyAction(p: Player, world: World, act: Action, ev: SimEvent[]): ActResult {
  const need = NEEDS[act.a];
  if (need && buildingAt(world, p)?.key !== need) return { ok: false, why: 'where' };
  switch (act.a) {
    case 'sell': {
      const r = sellAll(p, world);
      return r.total > 0 ? { ok: true, total: r.total } : { ok: false, why: 'state' };
    }
    case 'refuel': {
      const got = refuel(p, act.litres ?? Infinity);
      return got > 0 ? { ok: true, amount: got } : { ok: false, why: p.cash <= 0 ? 'cash' : 'max' };
    }
    case 'repair': {
      const got = repair(p);
      return got > 0 ? { ok: true, amount: got } : { ok: false, why: p.cash <= 0 ? 'cash' : 'max' };
    }
    case 'upgrade': {
      const r = buyUpgrade(p, act.k);
      return r === 'ok' ? { ok: true } : { ok: false, why: r };
    }
    case 'buy': {
      const r = buyItem(p, act.k);
      return r === 'ok' ? { ok: true } : { ok: false, why: r };
    }
    case 'respawn':
      if (!p.rig.stalled && !p.rig.wrecked) return { ok: false, why: 'state' };
      return { ok: true, amount: respawn(p, world) };
    case 'use':
      return useItem(p, world, act.k, ev) ? { ok: true } : { ok: false, why: 'state' };
  }
}
