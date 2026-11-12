import { describe, expect, it } from 'vitest';
import { Store } from '../server/db';
import { Client, Game } from '../server/game';
import { LocalSession } from '../src/game/session';
import { NetSession, type Transport, type Welcome } from '../src/net/netSession';
import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { HEARTH, atExit, atGate, enterHearth, hearthStep, winHearth, type HearthRun } from '../src/sim/hearth';
import { starBonus } from '../src/sim/market';
import { RIG_H, newPlayer, placeRig, type Player } from '../src/sim/player';
import { STEP, noInput, step, useItem, type Input, type SimEvent } from '../src/sim/rig';
import { sellAll } from '../src/sim/station';
import { LOGS, RADIO_DEPTH, RADIO_LOGS } from '../src/sim/story';
import { T, isSolid } from '../src/sim/tiles';
import { ANTE, ARENA, SHAFT, SKY, World, stationLayout } from '../src/sim/world';

const world = (w = 80, seed = 1234) => new World(seed, w);

/** A miner kitted out for the bottom of the world. */
function veteran(w: World): Player {
  const p = newPlayer(w);
  p.upgrades = { drill: 5, hull: 5, engine: 4, tank: 6, cargo: 3, heater: 4, radiator: 6, lamp: 4 };
  p.rig.fuel = 85;
  p.rig.hull = 210;
  p.items.charge = 5;
  p.items.megacharge = 2;
  p.items.fuelcell = 5;
  return p;
}

/** Put the rig in the Hearth's gate in the dig site. */
function toGate(w: World, p: Player): void {
  placeRig(p.rig, w.shaftX + 5, SKY + ANTE.floor);
}

function run(p: Player, w: World, input: Partial<Input>, frames: number, each?: () => boolean | void): SimEvent[] {
  const ev: SimEvent[] = [];
  const i = { ...noInput(), ...input };
  for (let k = 0; k < frames; k++) {
    step(p, w, i, STEP, ev);
    if (each?.()) break;
  }
  return ev;
}

describe('the story in the ground', () => {
  it('has twenty recorders in order of depth, and a radio line for each beat', () => {
    expect(LOGS.length).toBe(20);
    for (let i = 1; i < LOGS.length; i++) expect(LOGS[i].depth).toBeGreaterThan(LOGS[i - 1].depth);
    for (const l of RADIO_LOGS) expect(l.count).toBeLessThanOrEqual(LOGS.length);
    expect(RADIO_DEPTH.every((l, i) => i === 0 || l.depth > RADIO_DEPTH[i - 1].depth)).toBe(true);
  });

  it('places every recorder as a tile a rig can reach into, the same for every seed and width', () => {
    for (const [seed, width] of [[1234, 80], [99, 240], [7, 80]]) {
      const w = world(width, seed);
      expect(w.logs.length).toBe(LOGS.length);
      for (const l of w.logs) {
        expect(w.get(l.x, l.y)).toBe(T.LOG);
        expect(isSolid(T.LOG)).toBe(false);
        expect(l.x).toBeGreaterThan(0);
        expect(l.x).toBeLessThan(width - 1);
        expect(Math.abs(l.y - SKY - LOGS[l.id].depth)).toBeLessThanOrEqual(6);
        expect(w.logIdAt(l.x, l.y)).toBe(l.id);
      }
      // Same seed, same places.
      expect(world(width, seed).logs).toEqual(w.logs);
    }
  });

  it('a rig that touches a recorder gets its log once, and the recorder stays for the next miner', () => {
    const w = world();
    const spot = w.logs[2];
    w.set(spot.x - 1, spot.y, T.AIR);
    w.set(spot.x - 1, spot.y + 1, T.ICE);
    const p = newPlayer(w);
    placeRig(p.rig, spot.x - 0.5, spot.y + 1);
    const ev = run(p, w, {}, 5);
    expect(p.logs).toEqual([2]);
    expect(ev.filter((e) => e.t === 'log')).toEqual([{ t: 'log', id: 2 }]);
    expect(w.get(spot.x, spot.y)).toBe(T.LOG);
    const q = newPlayer(w);
    placeRig(q.rig, spot.x - 0.5, spot.y + 1);
    run(q, w, {}, 2);
    expect(q.logs).toEqual([2]);
    // Charges don't destroy it.
    q.items.megacharge = 1;
    useItem(q, w, 'megacharge', []);
    expect(w.get(spot.x, spot.y)).toBe(T.LOG);
  });

  it('keeps the five old buildings where they were and adds the Comms Tower at the end', () => {
    const s = stationLayout(80);
    expect(s.map((b) => b.key)).toEqual(['fuel', 'assay', 'shop', 'repair', 'supply', 'comms']);
    expect(s.slice(0, 5).map((b) => b.x)).toEqual([24, 31, 38, 45, 52]);
    expect(s[5].x).toBe(59);
    const w = world();
    expect(w.spawn().x).toBe(40);
    expect(w.get(s[5].x, SKY)).toBe(T.PAD);
  });

  it('a hole from an old save never swallows a pad, a recorder or the gate', () => {
    const w = world();
    const l = w.logs[0];
    const gateI = (SKY + ANTE.floor - 1) * w.w + w.shaftX + 4;
    const padI = SKY * w.w + stationLayout(80)[5].x;
    w.applyDiffs([[l.y * w.w + l.x, T.AIR], [gateI, T.AIR], [padI, T.AIR]]);
    expect(w.get(l.x, l.y)).toBe(T.LOG);
    expect(w.tiles[gateI]).toBe(T.GATE);
    expect(w.tiles[padI]).toBe(T.PAD);
  });
});

describe('the Hollow', () => {
  it('has a straight tunnel from the Geothermal Zone down to an antechamber with the gate in it', () => {
    for (const [seed, width] of [[1234, 80], [5, 240]]) {
      const w = world(width, seed);
      const sx = w.shaftX;
      expect(sx).toBeGreaterThan(8);
      expect(sx).toBeLessThan(width - 10);
      for (let d = SHAFT.top; d < ANTE.floor; d++) {
        expect(w.get(sx, SKY + d)).toBe(T.AIR);
        expect(w.get(sx + 1, SKY + d)).toBe(T.AIR);
      }
      for (let d = SHAFT.top; d < SHAFT.bottom; d++) {
        expect(isSolid(w.get(sx - 1, SKY + d)) || w.get(sx - 1, SKY + d) === T.LOG).toBe(true);
        expect(isSolid(w.get(sx + 2, SKY + d)) || w.get(sx + 2, SKY + d) === T.LOG).toBe(true);
      }
      expect(w.get(sx + 4, SKY + ANTE.floor - 1)).toBe(T.GATE);
      expect(isSolid(w.get(sx + 4, SKY + ANTE.floor))).toBe(true);
      const p = newPlayer(w);
      toGate(w, p);
      expect(atGate(w, p)).toBe(true);
      placeRig(p.rig, sx - 3, SKY + ANTE.floor);
      expect(atGate(w, p)).toBe(false);
    }
  });

  it('has halls of cut stone, some with a relic left on the floor', () => {
    const w = world(240, 77);
    let carved = 0;
    for (let y = SKY + 468; y < SKY + 578; y++) for (let x = 0; x < w.w; x++) if (w.get(x, y) === T.CARVED) carved++;
    expect(carved).toBeGreaterThan(400);
  });
});

describe('the Hearth', () => {
  function inside(seed = 1234) {
    const main = world(80, seed);
    const p = veteran(main);
    toGate(main, p);
    const run = enterHearth(p, main);
    return { main, p, run };
  }

  /** Stand the rig on a spot in the arena and set off a charge there. */
  function chargeAt(run: HearthRun, p: Player, x: number, groundD: number): void {
    placeRig(p.rig, x + 0.5, SKY + groundD);
    expect(useItem(p, run.world, 'charge', [])).toBe(true);
  }

  function breakVents(run: HearthRun, p: Player): SimEvent[] {
    const ev: SimEvent[] = [];
    for (const v of ARENA.vents) {
      // Ledge vents: stand on the ledge beside them. Floor vents: stand on the floor above them.
      if (v.d === ARENA.ledge) chargeAt(run, p, v.x + (v.x < 15 ? 1 : -1), ARENA.ledge);
      else chargeAt(run, p, v.x, ARENA.floor);
      p.rig.grounded = false;
      hearthStep(run, p, STEP, ev);
    }
    return ev;
  }

  it('is a private arena: a chamber with four vents and the machine, a gate out, and a shaft to the surface', () => {
    const { p, run, main } = inside();
    const w = run.world;
    expect(w.kind).toBe('hearth');
    expect(w).not.toBe(main);
    for (const v of ARENA.vents) expect(w.get(v.x, SKY + v.d)).toBe(T.HVENT);
    expect(w.get(ARENA.heart.x, SKY + ARENA.heart.d)).toBe(T.HCORE);
    for (let d = 1; d < ARENA.roof; d++) expect(w.get(15, SKY + d)).toBe(T.AIR);
    expect(p.rig.grounded).toBe(true);
    expect(run.vents).toBe(4);
    expect(atExit(run, p)).toBe(false);
    placeRig(p.rig, ARENA.gate.x + 0.6, SKY + ARENA.floor);
    expect(atExit(run, p)).toBe(true);
    // Nothing in the arena touches the dig site.
    expect(main.diffs.size).toBe(0);
  });

  it('pulses on a clock with a warning: a rig on the ground is hurt, one in the air is not', () => {
    const { p, run } = inside();
    const ev: SimEvent[] = [];
    const hull = p.rig.hull;
    // On the ground for the first pulse.
    while (!ev.some((e) => e.t === 'hearth-pulse')) hearthStep(run, p, STEP, ev);
    const warn = ev.findIndex((e) => e.t === 'hearth-charge');
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(warn).toBeLessThan(ev.findIndex((e) => e.t === 'hearth-pulse'));
    expect(ev.find((e) => e.t === 'hearth-pulse')).toEqual({ t: 'hearth-pulse', hit: true });
    expect(run.t).toBeCloseTo(HEARTH.pulseEvery, 1);
    expect(p.rig.hull).toBeLessThanOrEqual(hull - HEARTH.pulseHit);
    // In the air for the second.
    const before = p.rig.hull;
    ev.length = 0;
    while (!ev.some((e) => e.t === 'hearth-pulse')) {
      p.rig.grounded = false;
      hearthStep(run, p, STEP, ev);
    }
    expect(ev.find((e) => e.t === 'hearth-pulse')).toEqual({ t: 'hearth-pulse', hit: false });
    // Ice may have clipped it, but the pulse didn't.
    expect(ev.some((e) => e.t === 'hurt' && e.cause === 'frost')).toBe(false);
    expect(p.rig.hull).toBeGreaterThan(before - HEARTH.pulseHit);
  });

  it('shakes ice off the roof near the rig', () => {
    const { p, run } = inside();
    const ev: SimEvent[] = [];
    for (let k = 0; k < 60 * 6; k++) {
      p.rig.grounded = false;
      hearthStep(run, p, STEP, ev);
    }
    const falls = ev.filter((e) => e.t === 'fall');
    expect(falls.length).toBeGreaterThanOrEqual(1);
    for (const f of falls) if (f.t === 'fall') expect(Math.abs(f.x - Math.floor(p.rig.x))).toBeLessThanOrEqual(2);
  });

  it('charges break the vents, then the heart is exposed, and only then can it be broken', () => {
    const { p, run } = inside();
    const w = run.world;
    const hx = ARENA.heart.x;
    const hy = SKY + ARENA.heart.d;
    // A charge on top of the machine does nothing while the vents stand.
    p.items.megacharge = 3;
    placeRig(p.rig, hx + 0.5, hy);
    expect(useItem(p, w, 'megacharge', [])).toBe(true);
    expect(w.get(hx, hy)).toBe(T.HCORE);
    const ev = breakVents(run, p);
    expect(ev.filter((e) => e.t === 'hearth-vent').map((e) => (e.t === 'hearth-vent' ? e.left : -1))).toEqual([3, 2, 1, 0]);
    expect(ev.some((e) => e.t === 'hearth-open')).toBe(true);
    expect(run.open).toBe(true);
    expect(w.get(hx, hy)).toBe(T.HEART);
    expect(run.phase).toBe('fight');
    placeRig(p.rig, hx + 0.5, hy);
    expect(useItem(p, w, 'megacharge', [])).toBe(true);
    const ev2: SimEvent[] = [];
    hearthStep(run, p, STEP, ev2);
    expect(ev2.some((e) => e.t === 'hearth-broken')).toBe(true);
    expect(run.phase).toBe('escape');
    // The way back out is shut now.
    placeRig(p.rig, ARENA.gate.x + 0.6, SKY + ARENA.floor);
    expect(atExit(run, p)).toBe(false);
  });

  it('the escape: a rig that sits still is cooked by the heat front', () => {
    const { p, run } = inside();
    breakVents(run, p);
    placeRig(p.rig, ARENA.heart.x + 0.5, SKY + ARENA.heart.d);
    useItem(p, run.world, 'megacharge', []);
    const ev: SimEvent[] = [];
    for (let k = 0; k < 60 * 40 && !p.rig.wrecked; k++) {
      step(p, run.world, noInput(), STEP, ev);
      hearthStep(run, p, STEP, ev);
    }
    expect(p.rig.wrecked).toBe(true);
    expect(p.rig.wreckedBy).toBe('heat');
  });

  it('the escape: a rig that flies straight up outruns the heat front to the surface and wins', () => {
    for (const engine of [2, 4, 6]) {
      const { p, run, main } = inside(engine * 11);
      p.upgrades.engine = engine;
      breakVents(run, p);
      placeRig(p.rig, ARENA.heart.x + 0.5, SKY + ARENA.heart.d);
      useItem(p, run.world, 'megacharge', []);
      p.rig.hull = 210;
      const ev: SimEvent[] = [];
      let won = false;
      let gap = Infinity;
      const up = { ...noInput(), up: true };
      for (let k = 0; k < 60 * 240 && !won && !p.rig.wrecked; k++) {
        step(p, run.world, up, STEP, ev);
        won = hearthStep(run, p, STEP, ev);
        if (run.phase === 'escape') gap = Math.min(gap, run.wave - (p.rig.y + RIG_H / 2));
      }
      expect(p.rig.wrecked, `engine tier ${engine}`).toBe(false);
      expect(won, `engine tier ${engine}`).toBe(true);
      // The front never caught the rig, but it stayed in sight.
      expect(gap).toBeGreaterThan(0);
      p.cash = 123456;
      const time = winHearth(run, p, main);
      expect(time).toBeGreaterThan(20);
      expect(p.prestige).toBe(1);
      expect(p.stats.hearths).toBe(1);
      expect(p.stats.hearthBest).toBe(time);
      expect(p.cash).toBe(0);
      expect(p.upgrades.engine).toBe(0);
      expect(p.items.charge).toBe(0);
      expect(p.rig.x).toBe(main.spawn().x);
    }
  });

  it('a prestige star adds 5% to a sale, up to five stars', () => {
    expect(starBonus(0, 1000)).toBe(0);
    expect(starBonus(1, 1000)).toBe(50);
    expect(starBonus(9, 1000)).toBe(250);
    const w = world();
    const p = newPlayer(w);
    const q = newPlayer(w);
    q.prestige = 2;
    p.cargo = { cache: 2 };
    q.cargo = { cache: 2 };
    expect(sellAll(q, w).total).toBe(Math.round(sellAll(p, w).total * 1.1));
  });

  it('offline: through the gate and back, a recall brings the rig home, and a win restarts the run with a star', () => {
    const main = world();
    const s = new LocalSession(main, veteran(main));
    s.paused = false;
    const seen: string[] = [];
    s.on((e) => {
      if (e.t.startsWith('hearth-')) seen.push(e.t);
    });
    expect(s.act({ a: 'enter' })).toEqual({ ok: false, why: 'where' });
    toGate(main, s.player);
    const gate = { x: s.player.rig.x, y: s.player.rig.y };
    expect(s.act({ a: 'enter' })).toEqual({ ok: true });
    expect(s.world.kind).toBe('hearth');
    expect(s.hearth()).toMatchObject({ phase: 'fight', vents: 4, open: false });
    expect(s.sitePos()).toEqual(gate);
    // Not at the way out.
    expect(s.act({ a: 'leave' }).ok).toBe(false);
    placeRig(s.player.rig, ARENA.gate.x + 0.6, SKY + ARENA.floor);
    expect(s.act({ a: 'leave' })).toEqual({ ok: true });
    expect(s.world).toBe(main);
    expect(s.hearth()).toBeNull();
    expect(s.player.rig.x).toBe(gate.x);
    // In again, and recalled from inside.
    s.act({ a: 'enter' });
    s.player.items.beacon = 1;
    expect(s.act({ a: 'use', k: 'beacon' }).ok).toBe(true);
    expect(s.world).toBe(main);
    expect(s.player.rig.x).toBe(main.spawn().x);
    expect(seen).toEqual(['hearth-enter', 'hearth-leave', 'hearth-enter', 'hearth-leave']);
  });
});

// ---------------------------------------------------------------- online

/** A server and clients in one process (a small copy of the one in net.test.ts, with no lag). */
class Lab {
  tick = 0;
  readonly store = new Store(':memory:');
  readonly game = new Game(this.store, 'test', 80, 1234);
  private queue: (() => void)[] = [];

  constructor() {
    this.game.now = () => (this.tick * 1000) / 60;
  }

  join(hello: Partial<Extract<ClientMsg, { t: 'hello' }>> = {}) {
    const received: ServerMsg[] = [];
    let session: NetSession | null = null;
    const transport: Transport = {
      send: (m) => {
        const copy = JSON.parse(JSON.stringify(m));
        this.queue.push(() => this.game.handle(client, copy));
      },
      close: () => {},
    };
    const client = new Client({ send: (data) => this.queue.push(() => {
      const m = JSON.parse(data) as ServerMsg;
      received.push(m);
      if (session) transport.onMessage?.(m);
    }), close: () => {} }, 'test');
    this.game.handle(client, { t: 'hello', v: PROTOCOL_VERSION, ...hello });
    this.flush();
    session = new NetSession(transport, received.find((m) => m.t === 'welcome') as Welcome);
    return { client, session, received };
  }

  flush(): void {
    while (this.queue.length) this.queue.shift()!();
  }

  run(sessions: NetSession[], frames: number): void {
    for (let i = 0; i < frames; i++) {
      this.tick++;
      this.flush();
      this.game.tick();
      for (const s of sessions) s.update(STEP);
    }
    this.flush();
  }
}

describe('the Hearth online', () => {
  function atTheGate() {
    const lab = new Lab();
    const a = lab.join({ name: 'Ada' });
    const b = lab.join({ name: 'Bo' });
    lab.run([a.session, b.session], 5);
    const p = a.client.player!;
    Object.assign(p, { upgrades: veteran(lab.game.world).upgrades });
    p.rig.fuel = 85;
    p.rig.hull = 210;
    p.items.charge = 5;
    toGate(lab.game.world, p);
    lab.game.handle(a.client, { t: 'act', id: 900, act: { a: 'refuel' } });
    lab.run([a.session, b.session], 12);
    return { lab, a, b };
  }

  it("a miner's fight is their own: the arena, its tiles and its pulses reach only them", () => {
    const { lab, a, b } = atTheGate();
    expect(atGate(a.session.world, a.session.player)).toBe(true);
    const seen: string[] = [];
    a.session.on((e) => {
      if (e.t.startsWith('hearth-')) seen.push(e.t);
    });
    b.session.on((e) => {
      if (e.t.startsWith('hearth-') || e.t === 'peer-blast') seen.push(`Bo:${e.t}`);
    });
    expect(a.session.act({ a: 'enter' })).toEqual({ ok: true });
    expect(a.session.world.kind).toBe('hearth');
    lab.run([a.session, b.session], 30);
    expect(a.client.hearth).not.toBeNull();
    expect(a.session.hearth()).toMatchObject({ phase: 'fight', vents: 4 });
    // The page's rig and the server's agree inside the arena.
    expect(a.session.player.rig.x).toBeCloseTo(a.client.player!.rig.x, 3);
    expect(a.session.player.rig.y).toBeCloseTo(a.client.player!.rig.y, 3);
    // Bo can't see Ada any more, and Ada sees nobody.
    expect([...b.session.peers()]).toEqual([]);
    expect(b.session.mapPeers()).toEqual([]);
    expect([...a.session.peers()]).toEqual([]);

    // A charge on a floor vent: the vent goes on the server and on Ada's page, and Bo hears nothing.
    const v = ARENA.vents[2];
    placeRig(a.client.player!.rig, v.x + 0.5, SKY + ARENA.floor);
    lab.run([a.session, b.session], 6);
    a.session.act({ a: 'use', k: 'charge' });
    lab.run([a.session, b.session], 20);
    expect(a.client.hearth!.world.get(v.x, SKY + v.d)).toBe(T.AIR);
    expect(a.session.world.get(v.x, SKY + v.d)).toBe(T.AIR);
    expect(a.session.hearth()!.vents).toBe(3);
    expect(lab.game.world.diffs.size).toBe(0);
    expect(b.session.world.kind).toBe('main');
    // Through the first pulse.
    lab.run([a.session, b.session], 60 * 9);
    expect(seen).toContain('hearth-vent');
    expect(seen).toContain('hearth-charge');
    expect(seen).toContain('hearth-pulse');
    expect(seen.filter((s) => s.startsWith('Bo:'))).toEqual([]);

    // Out through the gate: the server takes the rig back to where it went in.
    placeRig(a.client.player!.rig, ARENA.gate.x + 0.6, SKY + ARENA.floor);
    lab.run([a.session, b.session], 6);
    expect(a.session.act({ a: 'leave' })).toEqual({ ok: true });
    lab.run([a.session, b.session], 70);
    expect(a.client.hearth).toBeNull();
    expect(a.session.world.kind).toBe('main');
    expect(atGate(a.session.world, a.session.player)).toBe(true);
    expect(a.session.player.rig.x).toBeCloseTo(a.client.player!.rig.x, 3);
    expect([...b.session.peers()].length + b.session.mapPeers().length).toBeGreaterThan(0);
  });

  it('a rig lost in the Hearth comes back on the pad, and one that drops out mid-fight is saved at the gate', () => {
    const { lab, a, b } = atTheGate();
    const gate = { x: a.client.player!.rig.x, y: a.client.player!.rig.y };
    a.session.act({ a: 'enter' });
    lab.run([a.session, b.session], 10);
    a.client.player!.rig.hull = 1;
    // On the ground for the first pulse.
    lab.run([a.session, b.session], 60 * 9);
    expect(a.session.player.rig.wrecked).toBe(true);
    // The pulse, unless a slab of ice got there first.
    expect(['frost', 'rock']).toContain(a.session.player.rig.wreckedBy);
    expect(a.session.act({ a: 'respawn' }).ok).toBe(true);
    expect(a.session.world.kind).toBe('main');
    lab.run([a.session, b.session], 20);
    expect(a.client.hearth).toBeNull();
    expect(a.client.player!.rig.wrecked).toBe(false);
    expect(a.session.player.rig.x).toBeCloseTo(lab.game.world.spawn().x, 3);

    // Back down, in, and the connection drops.
    toGate(lab.game.world, a.client.player!);
    lab.run([a.session, b.session], 12);
    a.session.act({ a: 'enter' });
    lab.run([a.session, b.session], 30);
    const token = a.session.token;
    lab.game.drop(a.client);
    const again = lab.join({ token });
    expect(again.client.hearth).toBeNull();
    expect(again.client.player!.rig.x).toBeCloseTo(gate.x, 3);
    expect(again.client.player!.rig.y).toBeCloseTo(gate.y, 3);
  });

  it('breaking the Hearth: everyone hears, the star stays on the account, and the run starts over', () => {
    const { lab, a, b } = atTheGate();
    const heard: string[] = [];
    for (const [who, s] of [['Ada', a.session], ['Bo', b.session]] as const) {
      s.on((e) => {
        if (e.t === 'hearth-won') heard.push(`${who}:${e.name}:${e.stars}:${e.mine}`);
      });
    }
    a.client.player!.cash = 9000;
    a.session.act({ a: 'enter' });
    lab.run([a.session, b.session], 10);
    // Skip to the end of the climb.
    const run = a.client.hearth!;
    run.phase = 'escape';
    run.escapeAt = run.t;
    run.t = 200;
    placeRig(a.client.player!.rig, 15.5, SKY + 0.4);
    lab.run([a.session, b.session], 30);

    expect(heard.sort()).toEqual(['Ada:Ada:1:true', 'Bo:Ada:1:false']);
    expect(a.client.hearth).toBeNull();
    expect(a.session.world.kind).toBe('main');
    expect(a.session.hearth()).toBeNull();
    expect(a.session.player.prestige).toBe(1);
    expect(a.session.player.cash).toBe(0);
    expect(a.session.player.upgrades.engine).toBe(0);
    expect(a.session.player.stats.hearthBest).toBeGreaterThan(190);
    expect(a.session.player.rig.x).toBeCloseTo(lab.game.world.spawn().x, 3);
    // Bo sees the star on Ada's name.
    lab.run([a.session, b.session], 10);
    expect([...b.session.peers()].find((p) => p.name === 'Ada')?.stars).toBe(1);
    // The fastest Hearth is on the board.
    lab.game.handle(b.client, { t: 'boards' });
    lab.run([a.session, b.session], 3);
    expect(b.session.boards()!.now.boards.hearth.map((r) => r.name)).toEqual(['Ada']);
    // The star is the account's: it's there after signing in again.
    const token = a.session.token;
    lab.game.drop(a.client);
    const again = lab.join({ token });
    expect(again.client.player!.prestige).toBe(1);
    expect(again.session.me.stars).toBe(1);
  });

  it('a recorder touched online is kept through the server round trip and a reload', () => {
    const lab = new Lab();
    const a = lab.join({ name: 'Ada' });
    const w = lab.game.world;
    const spot = w.logs[0];
    w.set(spot.x - 1, spot.y, T.AIR);
    lab.run([a.session], 3);
    placeRig(a.client.player!.rig, spot.x - 0.5, spot.y + 1);
    const got: number[] = [];
    a.session.on((e) => {
      if (e.t === 'log') got.push(e.id);
    });
    lab.run([a.session], 60 * 6);
    expect(a.client.player!.logs).toEqual([0]);
    expect(a.session.player.logs).toEqual([0]);
    expect(got).toEqual([0]);
    const token = a.session.token;
    lab.game.drop(a.client);
    expect(lab.join({ token }).session.player.logs).toEqual([0]);
  });
});
