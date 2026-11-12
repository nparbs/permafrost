// One shared world: runs every connected rig from its inputs at 60 ticks a second, owns the
// tiles, cash and cargo, and tells each player what they need to see.

import {
  BOARD_KEYS, PAINT_COUNT, PROTOCOL_VERSION, RIG_SOS, RIG_STALLED, RIG_THRUST, RIG_WRECKED, RigMode, cleanChat, cleanName, encodeDiffs, unpackInput,
  type BoardKey, type ClientMsg, type First, type MapDot, type PeerInfo, type Recap, type RigView, type SeasonRecord, type ServerMsg,
} from '../src/net/protocol';
import { applyAction, isAction } from '../src/sim/actions';
import { Environment } from '../src/sim/env';
import { pruneMarket, reviveMarket } from '../src/sim/market';
import { newPlayer, type Player, type Rig } from '../src/sim/player';
import { revivePlayer } from '../src/sim/revive';
import { STEP, noInput, rigDepth, step, type SimEvent } from '../src/sim/rig';
import { aid } from '../src/sim/station';
import { MINERALS, MINERAL_INDEX } from '../src/sim/tiles';
import { World } from '../src/sim/world';
import { allRanks, standings, type Entry } from './boards';
import type { Store, WorldRow } from './db';

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
/** A season lasts four weeks unless the server is told otherwise. */
export const SEASON_MS = 28 * 86_400_000;
/** The leaderboards are worked out at most this often. */
const BOARDS_EVERY_MS = 3000;

/** What's kept about a finished season: the final boards, and every miner's numbers and ranks in BOARD_KEYS order. */
interface SeasonFile {
  record: SeasonRecord;
  ranks: Record<string, { v: number; rank: number }[]>;
}

function reviveFirsts(raw: unknown): First[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is First => !!f && typeof f.mineral === 'string' && Object.hasOwn(MINERAL_INDEX, f.mineral) && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.depth === 'number' && typeof f.at === 'number');
}

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
  /** Stalled, and everyone has been told. Cleared once the rig has fuel again. */
  sos = false;
  sosAt = -Infinity;
  boardsAt = -Infinity;

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
  world!: World;
  season!: number;
  /** When this season began, in ms. */
  private started!: number;
  /** The first miner to dig up each mineral this season. */
  private firsts: First[] = [];
  /** The market or the firsts changed since the last save. */
  private extraDirty = false;
  private boardsMsg: { at: number; msg: Extract<ServerMsg, { t: 'boards' }> } | null = null;
  /** The season before this one, read once. Undefined until it's been looked up. */
  private lastSeason: SeasonFile | null | undefined;
  /** Picks the seed of the next season's map. */
  nextSeed: () => number = () => (Math.random() * 2 ** 31) | 0;
  /** Milliseconds the world has had somebody online, up to the last time it emptied. Days run on this. */
  private played!: number;
  /** When the world last went from empty to occupied, or null while it's empty. */
  private occupiedAt: number | null = null;
  private clients = new Set<Client>();
  private byAccount = new Map<string, Client>();
  private tickNo = 0;
  private worldDirty = false;
  private lastSave = Date.now();
  private env!: Environment;
  now: () => number = Date.now;

  constructor(
    private store: Store,
    readonly worldId = 'public',
    width = PUBLIC_WIDTH,
    seed = (Math.random() * 2 ** 31) | 0,
    readonly seasonMs = SEASON_MS,
  ) {
    this.open(store.world(worldId) ?? store.createWorld(worldId, seed, width));
  }

  /** Load a world as stored: at start-up, and again when a new season begins. */
  private open(row: WorldRow): void {
    this.env?.detach();
    this.world = new World(row.seed, row.width);
    this.world.applyDiffs(row.diffs);
    this.world.dirty.length = 0;
    this.season = row.season;
    this.started = row.started;
    this.world.time = this.now() / 1000;
    this.played = row.played;
    this.world.dayStart = (this.now() - this.played) / 1000;
    const extra = (row.extra && typeof row.extra === 'object' ? row.extra : {}) as { market?: unknown; firsts?: unknown };
    this.world.market = reviveMarket(extra.market);
    this.firsts = reviveFirsts(extra.firsts);
    this.extraDirty = false;
    this.worldDirty = false;
    this.boardsMsg = null;
    this.lastSeason = undefined;
    this.env = new Environment(this.world);
  }

  /** When this season ends, in ms. */
  get ends(): number {
    return this.started + this.seasonMs;
  }

  /** Milliseconds of days gone by. The clock only runs while somebody is online. */
  dayClock(): number {
    return this.played + (this.occupiedAt === null ? 0 : this.now() - this.occupiedAt);
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
      case 'sos':
        this.sos(c);
        break;
      case 'aid':
        this.aid(c, m.id);
        break;
      case 'boards':
        this.boards(c);
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
    const recap = this.recapFor(acc.id);
    const saved = this.store.loadPlayer(acc.id, this.worldId, this.season);
    const p = saved ? revivePlayer(this.world, saved) : newPlayer(this.world, c.name);
    p.name = c.name;
    c.player = p;
    c.lastInputAt = this.now();
    const peers = [...this.clients].map((o) => o.info());
    if (!this.clients.size) {
      // First one in: the day clock picks up where it stopped.
      this.occupiedAt = this.now();
      this.world.dayStart = (this.occupiedAt - this.played) / 1000;
    }
    this.clients.add(c);
    this.byAccount.set(c.id, c);
    c.send({
      t: 'welcome',
      v: PROTOCOL_VERSION,
      token,
      you: c.info(),
      world: { id: this.worldId, seed: this.world.seed, width: this.world.w, season: this.season, started: this.now() - this.dayClock(), ends: this.ends, market: this.world.market ?? {}, diffs: encodeDiffs(this.world.diffs) },
      player: p,
      peers,
      online: this.clients.size,
      now: this.now(),
      ...(recap ? { recap } : {}),
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
    if (res.ok && m.act.a === 'sell') {
      // The sale moved prices for everyone.
      this.extraDirty = true;
      this.broadcast({ t: 'market', m: this.world.market ?? {} });
    }
  }

  /** A miner picked something up: note the season's first of each mineral, and tell everyone about firsts and big finds. */
  private found(c: Client, mineral: number): void {
    const m = MINERALS[mineral];
    if (!m) return;
    const depth = Math.max(0, Math.floor(rigDepth(c.player!.rig)));
    const first = !this.firsts.some((f) => f.mineral === m.key);
    if (first) {
      this.firsts.push({ mineral: m.key, id: c.id, name: c.name, depth, at: this.now() });
      this.extraDirty = true;
      this.boardsMsg = null;
    }
    if (first || m.kind === 'relic' || m.key === 'heartshard') this.broadcast({ t: 'find', id: c.id, name: c.name, mineral: m.key, first, depth });
  }

  /** Everyone with a rig this season, with the numbers of those online taken live. */
  private entries(): Entry[] {
    const all = new Map<string, Entry>();
    for (const r of this.store.seasonPlayers(this.worldId, this.season)) {
      const stats = (r.state && typeof r.state === 'object' ? (r.state as { stats?: Entry['stats'] }).stats : undefined) ?? {};
      all.set(r.id, { id: r.id, name: r.name, stats });
    }
    for (const c of this.clients) all.set(c.id, { id: c.id, name: c.name, stats: c.player!.stats });
    return [...all.values()];
  }

  private lastFile(): SeasonFile | null {
    if (this.lastSeason === undefined) {
      const f = this.store.seasonRecord(this.worldId, this.season - 1) as SeasonFile | null;
      this.lastSeason = f && f.record && f.ranks ? f : null;
    }
    return this.lastSeason;
  }

  /** The season summary for a miner whose last rig here was in the season that just ended. */
  private recapFor(account: string): Recap | null {
    if (this.store.playerSeason(account, this.worldId) !== this.season - 1) return null;
    const ranks = this.lastFile()?.ranks[account];
    if (!ranks) return null;
    const you = {} as Record<BoardKey, { v: number; rank: number }>;
    BOARD_KEYS.forEach((k, i) => (you[k] = ranks[i] ?? { v: 0, rank: 0 }));
    return { record: this.lastFile()!.record, you };
  }

  private boards(c: Client): void {
    const now = this.now();
    if (now - c.boardsAt < 1000) return;
    c.boardsAt = now;
    if (!this.boardsMsg || now - this.boardsMsg.at > BOARDS_EVERY_MS) {
      this.boardsMsg = { at: now, msg: { t: 'boards', now: standings(this.season, this.entries(), this.firsts), ends: this.ends, last: this.lastFile()?.record ?? null } };
    }
    c.send(this.boardsMsg.msg);
  }

  /**
   * The season is over: keep the final boards, send everyone back to the title for a moment, and
   * open a new map. Players' saved rigs carry the old season number, so they all start over.
   */
  private rollover(): void {
    const ended = this.now();
    this.save();
    const entries = this.entries();
    const record: SeasonRecord = { ...standings(this.season, entries, this.firsts), ended };
    this.store.saveSeason(this.worldId, this.season, ended, { record, ranks: allRanks(entries) } satisfies SeasonFile);
    const msg = `Season ${this.season} is over. A new map is ready.`;
    for (const c of [...this.clients]) {
      c.send({ t: 'error', code: 'season', msg });
      this.drop(c);
      c.sock.close(4003, 'season');
    }
    this.occupiedAt = null;
    this.store.rollWorld(this.worldId, this.nextSeed(), this.season + 1, ended);
    this.open(this.store.world(this.worldId)!);
    console.log(`Season ${this.season} of ${this.worldId} began with seed ${this.world.seed}`);
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

  private sos(c: Client): void {
    const r = c.player!.rig;
    const now = this.now();
    if (!r.stalled || r.wrecked || c.sos || now - c.sosAt < 5000) return;
    c.sos = true;
    c.sosAt = now;
    this.broadcast({ t: 'sos', id: c.id, name: c.name, depth: Math.max(0, Math.floor(rigDepth(r))) });
  }

  private aid(c: Client, id: unknown): void {
    if (typeof id !== 'string') return;
    const other = this.byAccount.get(id);
    if (!other?.player || other === c) return;
    // The page checks the same rules before asking, so a refusal here is a race: say nothing.
    const r = aid(c.player!, other.player);
    if (!r.ok) return;
    other.sos = false;
    for (const x of [c, other]) {
      x.send({ t: 'me', player: x.player! });
      x.meDirty = false;
      this.savePlayer(x);
    }
    this.broadcast({ t: 'rescue', by: c.id, byName: c.name, to: other.id, toName: other.name, fee: r.fee });
  }

  /** Effects other players should see, like blasts and a rig's end. */
  private shareEvent(c: Client, e: SimEvent): void {
    if (e.t === 'blast' || e.t === 'flare' || e.t === 'wrecked') this.broadcast({ t: 'fx', e, by: c.id }, c);
  }

  tick(): void {
    this.tickNo++;
    const now = this.now();
    if (this.tickNo % 60 === 0 && now >= this.ends) this.rollover();
    this.world.time = now / 1000;
    // An empty tank only strands a rig while somebody else is around to bring fuel.
    this.world.rescue = this.clients.size > 1;
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
        if (e.t === 'pickup' || e.t === 'reserve') c.meDirty = true;
        if (e.t === 'pickup') this.found(c, e.mineral);
      }
      // A stalled rig calls for help by itself. (The page can't be trusted to time it: its
      // prediction stalls a few ticks before the rig does here.)
      if (p.rig.stalled && !c.sos) this.sos(c);
      else if (c.sos && !p.rig.stalled) c.sos = false;
    }

    const out = this.env.step([...this.clients].map((c) => c.player!), STEP);
    for (const e of out.fx) this.broadcast({ t: 'fx', e, by: '' });
    for (const [p, e] of out.personal) {
      for (const c of this.clients) {
        if (c.player !== p) continue;
        c.send({ t: 'ev', e: [e] });
        if (e.t === 'wrecked') this.shareEvent(c, e);
      }
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
      for (const c of this.clients) c.send({ t: 'snap', ack: c.ack, rig: c.player!.rig, cargo: c.player!.cargo, items: c.player!.items, stats: c.player!.stats });
    }
    if (this.tickNo % 6 === 0) this.sendRigs();
    if (this.tickNo % 60 === 0) this.sendMap();
    if (this.tickNo % 300 === 0) {
      for (const c of this.clients) {
        if (!c.meDirty) continue;
        c.meDirty = false;
        c.send({ t: 'me', player: c.player! });
      }
    }
    if (now - this.lastSave > SAVE_EVERY_MS) this.save();
  }

  private flags(c: Client): number {
    const r: Rig = c.player!.rig;
    return (r.thrusting ? RIG_THRUST : 0) | (r.wrecked ? RIG_WRECKED : 0) | (r.stalled ? RIG_STALLED : 0) | (c.sos ? RIG_SOS : 0);
  }

  /** Everyone's position for the map, about once a second. Only worth sending when there's someone to find. */
  private sendMap(): void {
    if (this.clients.size < 2) return;
    const p: MapDot[] = [...this.clients].map((c) => [c.id, Math.round(c.player!.rig.x * 10) / 10, Math.round(c.player!.rig.y * 10) / 10, this.flags(c)]);
    this.broadcast({ t: 'map', p });
  }

  private sendRigs(): void {
    const views: { c: Client; v: RigView }[] = [];
    for (const c of this.clients) {
      const r = c.player!.rig;
      const mode = r.drill ? (r.drill.dir === 'down' ? RigMode.DrillDown : RigMode.DrillSide) : r.grounded && Math.abs(r.vx) > 0.3 ? RigMode.Moving : RigMode.Idle;
      const flags = this.flags(c);
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
    if (!this.clients.size && this.occupiedAt !== null) {
      // Last one out: the day clock stops until somebody comes back.
      this.played = this.dayClock();
      this.occupiedAt = null;
      this.store.savePlayed(this.worldId, this.played);
    }
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
    if (this.occupiedAt !== null) this.store.savePlayed(this.worldId, this.dayClock());
    if (this.worldDirty) {
      this.store.saveWorld(this.worldId, this.world.diffs);
      this.worldDirty = false;
    }
    if (this.extraDirty) {
      if (this.world.market) pruneMarket(this.world.market, this.world.time);
      this.store.saveExtra(this.worldId, { market: this.world.market, firsts: this.firsts });
      this.extraDirty = false;
    }
    for (const c of this.clients) this.savePlayer(c);
  }
}
