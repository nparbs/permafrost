// The living ice: everything the world does on its own. Loose boulders and slabs fall,
// tunnels near the surface refreeze, and magma pours into fresh tunnels and cools. (Standing
// water left in a saved world from before v0.3.1 still freezes into rime.) Offline the LocalSession runs this; online only the server does,
// and clients see the results as tile changes and fx events.

import { RIG_H, RIG_W, type Player } from './player';
import { hurt, type SimEvent } from './rig';
import { hash3 } from './rng';
import { L, T, isLoose, isSolid } from './tiles';
import { SKY, type World } from './world';

export const ENV = {
  /** Seconds a loose tile wobbles before it drops. */
  wobble: 0.55,
  gravity: 18,
  terminal: 16,
  /** Hull damage when a falling tile lands on a rig. */
  rockHit: { [T.BOULDER]: 16, [T.SLAB]: 9 } as Record<number, number>,
  /** Seconds before a dug tunnel refreezes, by layer (snow, firn, glacier). */
  refreeze: [8 * 60, 12 * 60, 18 * 60],
  /** Chance a refrozen tile grows ore instead of rime, if it has solid ground under it. */
  regrow: 0.08,
  /** Keep refreeze and magma this far (in tiles) from any rig. */
  clearance: 2.5,
  /** Seconds before standing water (only in worlds saved before v0.3.1) freezes into rime. */
  freeze: 7,
  /** Seconds before magma pours into a tunnel opened next to it. */
  pour: 1.4,
  /** How many tiles a pour can run from its source. */
  pourReach: 3,
  /** Seconds before poured magma cools to slag. */
  cool: 30,
};

interface Faller {
  x: number;
  /** Top of the tile, in tiles. */
  y: number;
  vy: number;
  tile: number;
}

type Job = { at: number; i: number; kind: 'freeze' | 'refreeze' | 'pour' | 'cool' | 'drop'; level?: number };

/** A small binary heap of timed jobs, soonest first. */
class Jobs {
  private a: Job[] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): Job | undefined {
    return this.a[0];
  }
  push(j: Job): void {
    const a = this.a;
    a.push(j);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p].at <= a[k].at) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): Job | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l].at < a[m].at) m = l;
        if (r < a.length && a[r].at < a[m].at) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

export interface EnvOut {
  /** Everyone nearby should see these. */
  fx: SimEvent[];
  /** Events for one player only, like being hit by a rock. */
  personal: [Player, SimEvent][];
}

export class Environment {
  /** Seconds this environment has run. Only used for its own timers. */
  clock = 0;
  readonly fallers: Faller[] = [];
  private jobs = new Jobs();
  /** Indices with a drop already queued, so a tile isn't queued twice. */
  private dropping = new Set<number>();
  /** Poured magma: tile index -> how much further it can run. */
  private poured = new Map<number, number>();
  private out: EnvOut = { fx: [], personal: [] };
  private players: Player[] = [];
  private n = 0;

  constructor(readonly world: World) {
    world.onSet = (x, y, _was, now) => this.changed(x, y, now);
    // Tunnels dug before now (a loaded save, a server restart) start their refreeze clocks afresh.
    for (const [i, t] of world.diffs) {
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      if (t === T.AIR) this.scheduleRefreeze(x, y);
      else if (t === T.WATER) this.jobs.push({ at: this.clock + ENV.freeze, i, kind: 'freeze' });
      else if (t === T.MAGMA) {
        this.poured.set(i, 0);
        this.jobs.push({ at: this.clock + ENV.cool, i, kind: 'cool' });
      }
    }
  }

  detach(): void {
    if (this.world.onSet) this.world.onSet = undefined;
  }

  /** Advance by dt seconds. `players` are the rigs that can be hit or block a refreeze. */
  step(players: Player[], dt: number): EnvOut {
    this.players = players;
    this.clock += dt;
    for (;;) {
      const j = this.jobs.peek();
      if (!j || j.at > this.clock) break;
      this.jobs.pop();
      this.run(j);
    }
    this.stepFallers(dt);
    // Changes between steps (a rig digging) can raise events too, so they collect here until now.
    const out = this.out;
    this.out = { fx: [], personal: [] };
    return out;
  }

  // ---------------------------------------------------------------- reacting to changes

  private changed(x: number, y: number, now: number): void {
    const w = this.world;
    if (isSolid(now)) return;
    // Something opened up. Anything loose above or beside it may be hanging free now.
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) this.checkLoose(x + dx, y + dy);
    if (now !== T.AIR) return;
    this.scheduleRefreeze(x, y);
    // Magma above or beside a new hole pours in.
    let best = 0;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) {
      const i = (y + dy) * w.w + x + dx;
      if (w.get(x + dx, y + dy) !== T.MAGMA) continue;
      best = Math.max(best, this.poured.get(i) ?? ENV.pourReach);
    }
    if (best > 0) this.jobs.push({ at: this.clock + ENV.pour, i: y * w.w + x, kind: 'pour', level: best - 1 });
  }

  /** Start a loose tile wobbling if nothing holds it up. The Hearth uses this to drop ice it has just hung. */
  checkLoose(x: number, y: number): void {
    const w = this.world;
    if (!isLoose(w.get(x, y)) || isSolid(w.get(x, y + 1))) return;
    const i = y * w.w + x;
    if (this.dropping.has(i)) return;
    this.dropping.add(i);
    this.jobs.push({ at: this.clock + ENV.wobble, i, kind: 'drop' });
    this.out.fx.push({ t: 'loose', x, y });
  }

  private scheduleRefreeze(x: number, y: number): void {
    const w = this.world;
    if (y < SKY) return;
    const layer = w.layerAt(x, y);
    if (layer > L.ICE) return;
    const jitter = 0.75 + hash3(x, y, w.seed + (this.n++ & 0xffff)) * 0.75;
    this.jobs.push({ at: this.clock + ENV.refreeze[layer] * jitter, i: y * w.w + x, kind: 'refreeze' });
  }

  // ---------------------------------------------------------------- timed jobs

  private run(j: Job): void {
    const w = this.world;
    const x = j.i % w.w;
    const y = Math.floor(j.i / w.w);
    const t = w.tiles[j.i];
    switch (j.kind) {
      case 'drop': {
        this.dropping.delete(j.i);
        if (!isLoose(t) || isSolid(w.get(x, y + 1))) return;
        w.set(x, y, T.AIR);
        this.fallers.push({ x, y, vy: 0, tile: t });
        this.out.fx.push({ t: 'fall', x, y, tile: t });
        return;
      }
      case 'refreeze': {
        if (t !== T.AIR) return;
        if (this.nearRig(x, y) || this.fallers.some((f) => f.x === x)) {
          j.at = this.clock + 20;
          this.jobs.push(j);
          return;
        }
        w.set(x, y, this.regrowth(x, y) ?? T.RIME);
        return;
      }
      case 'freeze': {
        if (t !== T.WATER) return;
        if (this.rigIn(x, y)) {
          j.at = this.clock + 1;
          this.jobs.push(j);
          return;
        }
        w.set(x, y, T.RIME);
        return;
      }
      case 'pour': {
        if (t !== T.AIR) return;
        if (this.rigIn(x, y)) {
          j.at = this.clock + 0.5;
          this.jobs.push(j);
          return;
        }
        const level = j.level ?? 0;
        this.poured.set(j.i, level);
        w.set(x, y, T.MAGMA);
        this.out.fx.push({ t: 'pour', x, y });
        this.jobs.push({ at: this.clock + ENV.cool + hash3(x, y, 99) * 8, i: j.i, kind: 'cool' });
        if (level > 0) {
          // Run downhill first, sideways only if it can't.
          const down = w.get(x, y + 1) === T.AIR;
          const next = down ? [[0, 1]] : [[-1, 0], [1, 0]];
          for (const [dx, dy] of next) {
            if (w.get(x + dx, y + dy) !== T.AIR) continue;
            this.jobs.push({ at: this.clock + ENV.pour * 0.7, i: (y + dy) * w.w + x + dx, kind: 'pour', level: level - 1 });
          }
        }
        return;
      }
      case 'cool': {
        if (t !== T.MAGMA || !this.poured.has(j.i)) return;
        this.poured.delete(j.i);
        w.set(x, y, T.SLAG);
        return;
      }
    }
  }

  /** Sometimes ore grows back in refrozen ice, but never where it could cap a shaft someone needs. */
  private regrowth(x: number, y: number): number | null {
    const w = this.world;
    const under = w.get(x, y + 1);
    if (!isSolid(under) || under === T.RIME) return null;
    const roll = hash3(x, y, w.seed + 1717 + Math.floor(this.clock));
    if (roll >= ENV.regrow) return null;
    const d = y - SKY;
    return w.pickMineral(d, w.layerAt(x, y), roll / ENV.regrow, 1.5);
  }

  // ---------------------------------------------------------------- falling tiles

  private stepFallers(dt: number): void {
    const w = this.world;
    for (let k = this.fallers.length - 1; k >= 0; k--) {
      const f = this.fallers[k];
      f.vy = Math.min(ENV.terminal, f.vy + ENV.gravity * dt);
      const ny = f.y + f.vy * dt;
      const hit = this.players.find((p) => {
        const r = p.rig;
        return !r.wrecked && Math.abs(r.x - (f.x + 0.5)) < (RIG_W + 0.9) / 2 && r.y - RIG_H / 2 < ny + 1 && r.y + RIG_H / 2 > ny;
      });
      if (hit) {
        const ev: SimEvent[] = [];
        hurt(hit, ENV.rockHit[f.tile] ?? 15, 'rock', ev, true);
        for (const e of ev) this.out.personal.push([hit, e]);
        this.out.fx.push({ t: 'crash', x: f.x, y: Math.floor(ny), tile: f.tile });
        this.fallers.splice(k, 1);
        continue;
      }
      const row = Math.floor(ny);
      if (isSolid(w.get(f.x, row + 1)) || row + 1 >= w.h - 1) {
        this.fallers.splice(k, 1);
        if (w.get(f.x, row) === T.AIR) {
          w.set(f.x, row, f.tile);
          if (f.vy > 6) this.out.fx.push({ t: 'thump', x: f.x, y: row });
        } else {
          this.out.fx.push({ t: 'crash', x: f.x, y: row, tile: f.tile });
        }
        continue;
      }
      f.y = ny;
    }
  }

  // ---------------------------------------------------------------- rigs

  private nearRig(x: number, y: number): boolean {
    const c = ENV.clearance;
    return this.players.some((p) => Math.abs(p.rig.x - (x + 0.5)) < c && Math.abs(p.rig.y - (y + 0.5)) < c);
  }

  private rigIn(x: number, y: number): boolean {
    return this.players.some((p) => {
      const r = p.rig;
      return r.x + RIG_W / 2 > x && r.x - RIG_W / 2 < x + 1 && r.y + RIG_H / 2 > y && r.y - RIG_H / 2 < y + 1;
    });
  }
}
