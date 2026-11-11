// Online play. The server runs the real game; this runs the same rules ahead of it so your
// rig answers instantly. Every server snapshot says "this is your rig after input N": we take
// it, then replay the inputs the server hasn't seen yet. Digs we predicted after input N are
// put back first, so the replay digs them again at the same moments the server will.

import type { GameSession, Listener, MapPeer, Peer, SessionEvent } from '../game/session';
import { applyAction, type Action, type ActResult } from '../sim/actions';
import type { Player } from '../sim/player';
import { revivePlayer } from '../sim/revive';
import { STEP, noInput, step, type SimEvent } from '../sim/rig';
import { T } from '../sim/tiles';
import { World } from '../sim/world';
import { decodeDiffs, packInput, unpackInput, type ClientMsg, type MapDot, type PeerInfo, type ServerMsg } from './protocol';

export interface Transport {
  send(m: ClientMsg): void;
  close(): void;
  onMessage?: (m: ServerMsg) => void;
  onClose?: (reason: string) => void;
}

export type Welcome = Extract<ServerMsg, { t: 'welcome' }>;

interface PeerState extends Peer {
  tx: number;
  ty: number;
}

/** World and other players' events the server forwards that we show as they are. */
const FX_PASS = new Set<SimEvent['t']>(['loose', 'fall', 'crash', 'thump', 'pour', 'flare']);

/** Past this many unanswered ticks (4 s) we stop predicting and wait for the server. */
const MAX_UNACKED = 240;

export class NetSession implements GameSession {
  readonly online = true;
  readonly world: World;
  readonly player: Player;
  readonly input = noInput();
  readonly me: PeerInfo;
  readonly token: string;
  paused = false;
  paint: number;
  private acc = 0;
  private seq = 0;
  private ticks = 0;
  private unacked: [number, number][] = [];
  private outbox: number[] = [];
  private outStart = 1;
  /** Digs we predicted that the server hasn't confirmed: tile index and what was there. */
  private pending: { seq: number; i: number; t: number }[] = [];
  private listeners: Listener[] = [];
  private peerMap = new Map<string, PeerState>();
  private count: number;
  private actId = 0;
  private acts = new Map<number, Action>();
  private offset = { x: 0, y: 0 };
  private closed = false;
  /** Everyone's last known spot from the server's once-a-second map message. */
  private dots = new Map<string, MapDot>();
  private sosFor = false;
  /** Server clock minus ours, in ms. */
  private clockSkew: number;

  constructor(
    private conn: Transport,
    w: Welcome,
  ) {
    this.world = new World(w.world.seed, w.world.width);
    this.world.applyDiffs(decodeDiffs(w.world.diffs));
    this.world.dirty.length = 0;
    this.player = revivePlayer(this.world, w.player);
    this.me = w.you;
    this.paint = w.you.paint;
    this.token = w.token;
    this.count = w.online;
    this.clockSkew = (w.now ?? Date.now()) - Date.now();
    this.world.time = (Date.now() + this.clockSkew) / 1000;
    // An older server doesn't say when day 1 began: then it starts now.
    this.world.dayStart = w.world.started != null ? w.world.started / 1000 : this.world.time;
    this.world.rescue = this.count > 1;
    for (const p of w.peers) this.addPeer(p);
    conn.onMessage = (m) => this.onMessage(m);
    conn.onClose = (reason) => {
      if (!this.closed) this.emit([{ t: 'disconnected', reason }]);
      this.closed = true;
    };
  }

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(ev: SessionEvent[]): void {
    for (const e of ev) for (const l of this.listeners) l(e);
  }

  update(dt: number): void {
    if (this.closed) return;
    this.world.time = (Date.now() + this.clockSkew) / 1000;
    this.world.rescue = this.count > 1;
    this.acc = Math.min(this.acc + dt, 0.25);
    const ev: SimEvent[] = [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (this.unacked.length >= MAX_UNACKED) continue;
      this.seq++;
      const bits = this.paused ? 0 : packInput(this.input);
      this.unacked.push([this.seq, bits]);
      if (!this.outbox.length) this.outStart = this.seq;
      this.outbox.push(bits);
      this.stepLocal(this.seq, bits, ev);
      if (++this.ticks % 2 === 0) this.flush();
    }
    const k = Math.exp(-dt * 10);
    this.offset.x *= k;
    this.offset.y *= k;
    const f = Math.min(1, dt * 12);
    for (const p of this.peerMap.values()) {
      if (Math.abs(p.tx - p.x) > 4 || Math.abs(p.ty - p.y) > 4) {
        p.x = p.tx;
        p.y = p.ty;
      } else {
        p.x += (p.tx - p.x) * f;
        p.y += (p.ty - p.y) * f;
      }
    }
    this.emit(ev);
  }

  private stepLocal(seq: number, bits: number, ev: SimEvent[]): void {
    const from = ev.length;
    step(this.player, this.world, unpackInput(bits), STEP, ev);
    for (let k = from; k < ev.length; k++) {
      const e = ev[k];
      if (e.t === 'dug') this.pending.push({ seq, i: e.y * this.world.w + e.x, t: e.tile });
    }
  }

  private flush(): void {
    if (!this.outbox.length) return;
    this.conn.send({ t: 'in', s: this.outStart, i: this.outbox });
    this.outbox = [];
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'snap':
        this.reconcile(m.ack, m);
        break;
      case 'me': {
        const p = m.player;
        Object.assign(this.player, { name: p.name, cash: p.cash, upgrades: p.upgrades, items: p.items, stats: p.stats, seen: p.seen });
        break;
      }
      case 'res': {
        const act = this.acts.get(m.id);
        this.acts.delete(m.id);
        if (act && !m.res.ok) this.emit([{ t: 'refused', act, res: m.res }]);
        break;
      }
      case 'tiles': {
        const w = this.world;
        const out: SessionEvent[] = [];
        let touched: Set<number> | null = null;
        for (let k = 0; k + 1 < m.d.length; k += 2) {
          const i = m.d[k];
          const t = m.d[k + 1];
          if (i < 0 || i >= w.tiles.length) continue;
          (touched ??= new Set()).add(i);
          const old = w.tiles[i];
          if (old === t) continue;
          const x = i % w.w;
          const y = Math.floor(i / w.w);
          w.set(x, y, t);
          if (t === T.AIR) out.push({ t: 'peer-dug', x, y, tile: old });
        }
        // The server has the last word on these tiles, so stop treating them as ours.
        if (touched) this.pending = this.pending.filter((p) => !touched!.has(p.i));
        this.emit(out);
        break;
      }
      case 'rigs': {
        this.count = m.online;
        for (const p of this.peerMap.values()) p.visible = false;
        for (const [id, x, y, facing, mode, flags] of m.r) {
          const p = this.peerMap.get(id);
          if (!p) continue;
          if (!p.visible && (Math.abs(p.x - x) > 0.01 || Math.abs(p.y - y) > 0.01)) {
            p.x = x;
            p.y = y;
          }
          Object.assign(p, { tx: x, ty: y, facing, mode, flags, visible: true });
        }
        break;
      }
      case 'peer': {
        const known = this.peerMap.has(m.p.id);
        this.addPeer(m.p);
        if (!known) this.emit([{ t: 'peer-join', name: m.p.name }]);
        break;
      }
      case 'leave': {
        const p = this.peerMap.get(m.id);
        this.peerMap.delete(m.id);
        this.dots.delete(m.id);
        if (p) this.emit([{ t: 'peer-leave', name: p.name }]);
        break;
      }
      case 'fx':
        if (m.e.t === 'blast') this.emit([{ t: 'peer-blast', x: m.e.x, y: m.e.y, r: m.e.r }]);
        else if (m.e.t === 'wrecked') {
          // Someone's rig was lost. We can only show it if we know where they are.
          const p = this.peerMap.get(m.by);
          const d = this.dots.get(m.by);
          if (p?.visible) this.emit([{ t: 'peer-wrecked', id: p.id, name: p.name, x: p.tx, y: p.ty, cause: m.e.cause }]);
          else if (p && d) this.emit([{ t: 'peer-wrecked', id: p.id, name: p.name, x: d[1], y: d[2], cause: m.e.cause }]);
        }
        else if (FX_PASS.has(m.e.t)) this.emit([m.e]);
        break;
      case 'ev':
        this.emit(m.e);
        break;
      case 'chat':
        this.emit([{ t: 'chat', id: m.id, name: m.name, text: m.text, mine: m.id === this.me.id }]);
        break;
      case 'map':
        this.dots = new Map(m.p.filter((d) => d[0] !== this.me.id).map((d) => [d[0], d]));
        break;
      case 'sos':
        this.emit([{ t: 'peer-sos', id: m.id, name: m.name, depth: m.depth, mine: m.id === this.me.id }]);
        break;
      case 'rescue': {
        const role = m.by === this.me.id ? 'helper' : m.to === this.me.id ? 'helped' : 'none';
        if (role === 'helped') this.sosFor = false;
        this.emit([{ t: 'rescue', byName: m.byName, toName: m.toName, fee: m.fee, role }]);
        break;
      }
      case 'error':
        this.closed = true;
        this.emit([{ t: 'disconnected', reason: m.msg }]);
        break;
      default:
        break;
    }
  }

  private reconcile(ack: number, m: Extract<ServerMsg, { t: 'snap' }>): void {
    const r = this.player.rig;
    const before = { x: r.x + this.offset.x, y: r.y + this.offset.y };
    while (this.unacked.length && this.unacked[0][0] <= ack) this.unacked.shift();
    const w = this.world;
    const redo = this.pending.filter((p) => p.seq > ack);
    for (let k = redo.length - 1; k >= 0; k--) {
      const p = redo[k];
      if (w.tiles[p.i] === T.AIR) w.set(p.i % w.w, Math.floor(p.i / w.w), p.t);
    }
    this.pending = [];
    Object.assign(r, m.rig);
    this.player.cargo = m.cargo;
    this.player.items = m.items;
    this.player.stats = m.stats;
    const scratch: SimEvent[] = [];
    for (const [s, b] of this.unacked) this.stepLocal(s, b, scratch);
    this.offset.x = before.x - r.x;
    this.offset.y = before.y - r.y;
    // Big jumps (a respawn, a recall beacon) shouldn't glide across the map.
    if (Math.hypot(this.offset.x, this.offset.y) > 3) this.offset.x = this.offset.y = 0;
  }

  /** How far the prediction is from the last confirmed input, for tests and the debug readout. */
  get lag(): number {
    return this.unacked.length;
  }

  act(a: Action): ActResult {
    if (this.closed) return { ok: false, why: 'state' };
    if (a.a === 'use') {
      // Items can blast tiles or move the rig, so wait for the server rather than guess.
      if ((this.player.items[a.k] ?? 0) <= 0) return { ok: false, why: 'state' };
      this.send(a);
      return { ok: true };
    }
    const ev: SimEvent[] = [];
    const res = applyAction(this.player, this.world, a, ev);
    if (res.ok) this.send(a);
    this.emit(ev);
    return res;
  }

  private send(a: Action): void {
    const id = ++this.actId;
    this.acts.set(id, a);
    this.conn.send({ t: 'act', id, act: a });
  }

  releaseInput(): void {
    Object.assign(this.input, noInput());
  }

  renderPos() {
    return { x: this.player.rig.x + this.offset.x, y: this.player.rig.y + this.offset.y };
  }

  peers(): Iterable<Peer> {
    return [...this.peerMap.values()].filter((p) => p.visible);
  }

  peerName(id: string): string | undefined {
    return id === this.me.id ? this.me.name : this.peerMap.get(id)?.name;
  }

  onlineCount(): number {
    return this.count;
  }

  mapPeers(): MapPeer[] {
    const out: MapPeer[] = [];
    for (const p of this.peerMap.values()) {
      const d = this.dots.get(p.id);
      // Close by, the smoothed position is better; further away, the map message is all we have.
      if (p.visible) out.push({ id: p.id, name: p.name, paint: p.paint, x: p.x, y: p.y, flags: p.flags });
      else if (d) out.push({ id: p.id, name: p.name, paint: p.paint, x: d[1], y: d[2], flags: d[3] });
    }
    return out;
  }

  /** The server sends the SOS itself when a rig stalls, so stalled means sent. */
  get sosSent(): boolean {
    if (!this.player.rig.stalled) this.sosFor = false;
    return this.player.rig.stalled;
  }

  sos(): void {
    if (this.closed || !this.player.rig.stalled || this.sosFor) return;
    this.sosFor = true;
    this.conn.send({ t: 'sos' });
  }

  aid(id: string): void {
    if (!this.closed) this.conn.send({ t: 'aid', id });
  }

  myId(): string {
    return this.me.id;
  }

  chat(text: string): void {
    this.conn.send({ t: 'chat', text });
  }

  setProfile(name: string, paint: number): void {
    this.paint = paint;
    this.me.name = name;
    this.me.paint = paint;
    this.conn.send({ t: 'profile', name, paint });
  }

  close(): void {
    this.closed = true;
    this.conn.close();
  }

  private addPeer(p: PeerInfo): void {
    const old = this.peerMap.get(p.id);
    if (old) {
      old.name = p.name;
      old.paint = p.paint;
      return;
    }
    this.peerMap.set(p.id, { ...p, x: 0, y: 0, tx: 0, ty: 0, facing: 1, mode: 0, flags: 0, visible: false });
  }
}
