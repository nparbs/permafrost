// One shared world: runs every connected rig from its inputs at 60 ticks a second, owns the
// tiles, cash and cargo, and tells each player what they need to see.

import {
  PAINT_COUNT, PROTOCOL_VERSION, RIG_THRUST, RIG_WRECKED, RigMode, cleanChat, cleanName, encodeDiffs, unpackInput,
  type ClientMsg, type PeerInfo, type RigView, type ServerMsg,
} from '../src/net/protocol';
import { applyAction, isAction } from '../src/sim/actions';
import { Environment } from '../src/sim/env';
import { newPlayer, type Player } from '../src/sim/player';
import { revivePlayer } from '../src/sim/revive';
import { STEP, noInput, step, type SimEvent } from '../src/sim/rig';
import { World } from '../src/sim/world';
import type { Store } from './db';

export const PUBLIC_WIDTH = 240;
/** How far away (in tiles) other rigs are sent to you. */
const VIEW_X = 40;
const VIEW_Y = 28;
/** Inputs held per player before old ones are dropped (1.5 s). */
const MAX_QUEUE = 90;
/** Steps a player may bank, so a lag spike can catch up but a sped-up client can't run ahead. */
const MAX_BUDGET = 20;
const IDLE_AFTER_MS = 300;
const SAVE_EVERY_MS = 30_000;

export interface Sock {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export class Client {
  id = '';
  name = '';
  paint = 0;
  player: Player | null = null;
  queue: [number, number][] = [];
  ack = 0;
  /** Simulation steps run for this player, for tests and stats. */
  steps = 0;
  budget = 0;
  lastInputAt = 0;
  chatAt = 0;
  meDirty = false;

  constructor(
    readonly sock: Sock,
    readonly ip: string,
  ) {}

  send(m: ServerMsg): void {
    try {
      this.sock.send(JSON.stringify(m));
    } catch {
      /* socket already gone */
    }
  }

  info(): PeerInfo {
    return { id: this.id, name: this.name, paint: this.paint };
  }
}

const clampPaint = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < PAINT_COUNT ? v : 0);

export class Game {
  readonly world: World;
  readonly season: number;
  private clients = new Set<Client>();
  private byAccount = new Map<string, Client>();
  private tickNo = 0;
  private worldDirty = false;
  private lastSave = Date.now();
  private env: Environment;
  now: () => number = Date.now;

  constructor(
    private store: Store,
    readonly worldId = 'public',
    width = PUBLIC_WIDTH,
    seed = (Math.random() * 2 ** 31) | 0,
  ) {
    const row = store.world(worldId) ?? store.createWorld(worldId, seed, width);
    this.world = new World(row.seed, row.width);
    this.world.applyDiffs(row.diffs);
    this.world.dirty.length = 0;
    this.season = row.season;
    this.world.time = this.now() / 1000;
    this.env = new Environment(this.world);
  }

  get online(): number {
    return this.clients.size;
  }

  handle(c: Client, m: ClientMsg): void {
    if (m.t === 'hello') {
      this.hello(c, m);
      return;
    }
    if (!c.player || !this.clients.has(c)) return;
    switch (m.t) {
      case 'in':
        this.inputs(c, m);
        break;
      case 'act':
        this.act(c, m);
        break;
      case 'chat':
        this.chat(c, m.text);
        break;
      case 'profile':
        this.profile(c, m.name, m.paint);
        break;
      default:
        break;
    }
  }

  private hello(c: Client, m: Extract<ClientMsg, { t: 'hello' }>): void {
    if (c.player) return;
    if (m.v !== PROTOCOL_VERSION) {
      c.send({ t: 'error', code: 'version', msg: 'A new version of Permafrost is out. Refresh the page.' });
      c.sock.close(4000, 'version');
      return;
    }
    let token = typeof m.token === 'string' ? m.token : '';
    let acc = token ? this.store.byToken(token) : null;
    if (token && !acc) {
      c.send({ t: 'error', code: 'token', msg: "That code doesn't match any miner." });
      c.sock.close(4002, 'token');
      return;
    }
    if (!acc) {
      const created = this.store.create(cleanName(m.name) || `Miner ${100 + Math.floor(Math.random() * 900)}`, clampPaint(m.paint));
      acc = created.account;
      token = created.token;
    } else {
      const name = cleanName(m.name);
      const paint = m.paint === undefined ? acc.paint : clampPaint(m.paint);
      if ((name && name !== acc.name) || paint !== acc.paint) {
        acc.name = name || acc.name;
        acc.paint = paint;
        this.store.profile(acc.id, acc.name, acc.paint);
      }
    }
    const old = this.byAccount.get(acc.id);
    if (old) {
      old.send({ t: 'error', code: 'replaced', msg: 'You signed in on another screen.' });
      this.drop(old);
      old.sock.close(4001, 'replaced');
    }
    c.id = acc.id;
    c.name = acc.name;
    c.paint = acc.paint;
    const saved = this.store.loadPlayer(acc.id, this.worldId, this.season);
    const p = saved ? revivePlayer(this.world, saved) : newPlayer(this.world, c.name);
    p.name = c.name;
    c.player = p;
    c.lastInputAt = this.now();
    const peers = [...this.clients].map((o) => o.info());
    this.clients.add(c);
    this.byAccount.set(c.id, c);
    c.send({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      token,
      you: c.info(),
      world: { id: this.worldId, seed: this.world.seed, width: this.world.w, season: this.season, diffs: encodeDiffs(this.world.diffs) },
      player: p,
      peers,
      online: this.clients.size,
      now: this.now(),
    });
    this.broadcast({ t: 'peer', p: c.info() }, c);
  }

  private inputs(c: Client, m: Extract<ClientMsg, { t: 'in' }>): void {
    if (!Number.isInteger(m.s) || m.s < 1 || !Array.isArray(m.i) || m.i.length > 30) return;
    let last = c.queue.length ? c.queue[c.queue.length - 1][0] : c.ack;
    for (let k = 0; k < m.i.length; k++) {
      const seq = m.s + k;
      if (seq <= last) continue;
      c.queue.push([seq, (m.i[k] | 0) & 15]);
      last = seq;
    }
    if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
    c.lastInputAt = this.now();
  }

  private act(c: Client, m: Extract<ClientMsg, { t: 'act' }>): void {
    if (!Number.isInteger(m.id) || !isAction(m.act)) return;
    const p = c.player!;
    const ev: SimEvent[] = [];
    const res = applyAction(p, this.world, m.act, ev);
    c.send({ t: 'res', id: m.id, res });
    if (ev.length) {
      c.send({ t: 'ev', e: ev });
      for (const e of ev) this.shareEvent(c, e);
    }
    c.send({ t: 'me', player: p });
    c.meDirty = false;
    if (res.ok) this.savePlayer(c);
  }

  private chat(c: Client, text: unknown): void {
    const now = this.now();
    const clean = cleanChat(text);
    if (!clean || now - c.chatAt < 1000) return;
    c.chatAt = now;
    this.broadcast({ t: 'chat', id: c.id, name: c.name, text: clean });
  }

  private profile(c: Client, name: unknown, paint: unknown): void {
    const n = cleanName(name) || c.name;
    const pt = clampPaint(paint);
    if (n === c.name && pt === c.paint) return;
    c.name = n;
    c.paint = pt;
    c.player!.name = n;
    this.store.profile(c.id, n, pt);
    this.broadcast({ t: 'peer', p: c.info() });
  }

  /** Effects other players should see, like blasts. */
  private shareEvent(c: Client, e: SimEvent): void {
    if (e.t === 'blast' || e.t === 'flare') this.broadcast({ t: 'fx', e, by: c.id }, c);
  }

  tick(): void {
    this.tickNo++;
    const now = this.now();
    this.world.time = now / 1000;
    for (const c of this.clients) {
      const p = c.player!;
      c.budget = Math.min(c.budget + 1.05, MAX_BUDGET);
      const ev: SimEvent[] = [];
      let n = 0;
      while (c.budget >= 1 && c.queue.length) {
        const [seq, bits] = c.queue.shift()!;
        step(p, this.world, unpackInput(bits), STEP, ev);
        c.ack = seq;
        c.budget--;
        c.steps++;
        n++;
      }
      // A player who stops sending (a hidden tab, a dropped connection) still falls.
      if (n === 0 && c.budget >= 1 && now - c.lastInputAt > IDLE_AFTER_MS) {
        step(p, this.world, noInput(), STEP, ev);
        c.budget--;
        c.steps++;
      }
      for (const e of ev) {
        this.shareEvent(c, e);
        if (e.t === 'pickup') c.meDirty = true;
      }
    }

    const out = this.env.step([...this.clients].map((c) => c.player!), STEP);
    for (const e of out.fx) this.broadcast({ t: 'fx', e, by: '' });
    for (const [p, e] of out.personal) {
      for (const c of this.clients) if (c.player === p) c.send({ t: 'ev', e: [e] });
    }

    const w = this.world;
    if (w.dirty.length) {
      const d: number[] = [];
      const seen = new Set<number>();
      for (const i of w.dirty) {
        if (seen.has(i)) continue;
        seen.add(i);
        d.push(i, w.tiles[i]);
      }
      w.dirty.length = 0;
      this.worldDirty = true;
      this.broadcast({ t: 'tiles', d });
    }

    if (this.tickNo % 3 === 0) {
      for (const c of this.clients) c.send({ t: 'snap', ack: c.ack, rig: c.player!.rig, cargo: c.player!.cargo, stats: c.player!.stats });
    }
    if (this.tickNo % 6 === 0) this.sendRigs();
    if (this.tickNo % 300 === 0) {
      for (const c of this.clients) {
        if (!c.meDirty) continue;
        c.meDirty = false;
        c.send({ t: 'me', player: c.player! });
      }
    }
    if (now - this.lastSave > SAVE_EVERY_MS) this.save();
  }

  private sendRigs(): void {
    const views: { c: Client; v: RigView }[] = [];
    for (const c of this.clients) {
      const r = c.player!.rig;
      const mode = r.drill ? (r.drill.dir === 'down' ? RigMode.DrillDown : RigMode.DrillSide) : r.grounded && Math.abs(r.vx) > 0.3 ? RigMode.Moving : RigMode.Idle;
      const flags = (r.thrusting ? RIG_THRUST : 0) | (r.wrecked ? RIG_WRECKED : 0);
      views.push({ c, v: [c.id, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, r.facing, mode, flags] });
    }
    for (const c of this.clients) {
      const me = c.player!.rig;
      const r = views.filter((o) => o.c !== c && Math.abs(o.v[1] - me.x) < VIEW_X && Math.abs(o.v[2] - me.y) < VIEW_Y).map((o) => o.v);
      c.send({ t: 'rigs', r, online: this.clients.size });
    }
  }

  private broadcast(m: ServerMsg, except?: Client): void {
    const data = JSON.stringify(m);
    for (const c of this.clients) {
      if (c === except) continue;
      try {
        c.sock.send(data);
      } catch {
        /* gone */
      }
    }
  }

  drop(c: Client): void {
    if (!this.clients.has(c)) return;
    this.savePlayer(c);
    this.clients.delete(c);
    if (this.byAccount.get(c.id) === c) this.byAccount.delete(c.id);
    this.broadcast({ t: 'leave', id: c.id });
  }

  private savePlayer(c: Client): void {
    if (!c.player) return;
    const p = c.player;
    // Save where the dig started, so a reload never lands half inside rock.
    const state = p.rig.drill ? { ...p, rig: { ...p.rig, x: p.rig.drill.sx, y: p.rig.drill.sy, drill: null } } : p;
    this.store.savePlayer(c.id, this.worldId, this.season, state);
  }

  save(): void {
    this.lastSave = this.now();
    if (this.worldDirty) {
      this.store.saveWorld(this.worldId, this.world.diffs);
      this.worldDirty = false;
    }
    for (const c of this.clients) this.savePlayer(c);
  }
}
