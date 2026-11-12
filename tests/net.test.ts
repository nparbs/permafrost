import { describe, expect, it } from 'vitest';
import { Store } from '../server/db';
import { Client, Game } from '../server/game';
import { NetSession, type Transport, type Welcome } from '../src/net/netSession';
import { PROTOCOL_VERSION, RIG_SOS, RIG_STALLED, cleanChat, cleanName, decodeDiffs, encodeDiffs, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { cargoCount, newPlayer, placeRig } from '../src/sim/player';
import { AID_REACH, aid, rescueFee } from '../src/sim/station';
import { World } from '../src/sim/world';
import { STEP } from '../src/sim/rig';
import { MINERALS, MINERAL_BASE, MINERAL_INDEX, T } from '../src/sim/tiles';
import { BOUNTY_BONUS, MARKET, bountyOf, glutNow, marketFactor, priceOf, recordSale, trend, type Market } from '../src/sim/market';
import { sellAll } from '../src/sim/station';

const GOLD = MINERALS[MINERAL_INDEX.gold];
const TIN = MINERALS[MINERAL_INDEX.tin];
import { SKY } from '../src/sim/world';

/** A server and any number of clients in one process, joined by links with a set delay. */
class Lab {
  tick = 0;
  readonly store = new Store(':memory:');
  readonly game: Game;
  private inflight: { at: number; deliver: () => void }[] = [];

  constructor(width = 80, seed = 1234) {
    this.game = new Game(this.store, 'test', width, seed);
    this.game.now = () => (this.tick * 1000) / 60;
  }

  /** Connect a player. `lag` is the one-way delay in ticks; `jitter` adds up to that many more. */
  join(opts: { lag?: number; jitter?: number; hello?: Partial<Extract<ClientMsg, { t: 'hello' }>> } = {}) {
    const lag = opts.lag ?? 0;
    const jitter = opts.jitter ?? 0;
    let lastUp = 0;
    let lastDown = 0;
    const delay = (last: number) => Math.max(last, this.tick + lag + Math.floor(Math.random() * (jitter + 1)));
    const received: ServerMsg[] = [];
    let session: NetSession | null = null;
    let closed: string | null = null;
    const transport: Transport = {
      send: (m) => {
        lastUp = delay(lastUp);
        const copy = JSON.parse(JSON.stringify(m));
        this.inflight.push({ at: lastUp, deliver: () => this.game.handle(client, copy) });
      },
      close: () => {},
    };
    const client = new Client(
      {
        send: (data) => {
          lastDown = delay(lastDown);
          this.inflight.push({
            at: lastDown,
            deliver: () => {
              const m = JSON.parse(data) as ServerMsg;
              received.push(m);
              if (session) transport.onMessage?.(m);
            },
          });
        },
        close: (_code, reason) => {
          closed = reason ?? 'closed';
        },
      },
      'test',
    );
    this.game.handle(client, { t: 'hello', v: PROTOCOL_VERSION, ...opts.hello });
    this.flushAll();
    const welcome = received.find((m) => m.t === 'welcome') as Welcome | undefined;
    if (welcome) session = new NetSession(transport, welcome);
    return { client, session, received, closed: () => closed };
  }

  private flushAll(): void {
    for (const f of this.inflight.splice(0)) f.deliver();
  }

  /** One 1/60 s frame for everybody. */
  frame(sessions: NetSession[]): void {
    this.tick++;
    const due = this.inflight.filter((f) => f.at <= this.tick);
    this.inflight = this.inflight.filter((f) => f.at > this.tick);
    for (const f of due) f.deliver();
    this.game.tick();
    for (const s of sessions) s.update(STEP);
  }

  run(sessions: NetSession[], frames: number, each?: () => void): void {
    for (let i = 0; i < frames; i++) {
      this.frame(sessions);
      each?.();
    }
  }
}

describe('protocol', () => {
  it('packs world changes and cleans names and chat', () => {
    const pairs: [number, number][] = [[0, 0], [146639, 27], [12345, 3]];
    expect(decodeDiffs(encodeDiffs(pairs))).toEqual(pairs);
    expect(cleanName('  <b>Ice   Queen</b>!!  ')).toBe('bIce Queenb');
    expect(cleanName('x'.repeat(40)).length).toBe(14);
    expect(cleanChat('hi\u0000 <script>')).toBe('hi script');
  });
});

describe('server', () => {
  it('creates an account on first hello and recognises the code later', () => {
    const lab = new Lab();
    const a = lab.join({ hello: { name: 'Frost Pilot', paint: 2 } });
    expect(a.session).not.toBeNull();
    expect(a.session!.me.name).toBe('Frost Pilot');
    expect(a.session!.me.paint).toBe(2);
    const token = a.session!.token;
    expect(token).toMatch(/^[A-Z2-9]{16}$/);
    lab.game.drop(a.client);
    const b = lab.join({ hello: { token } });
    expect(b.session!.me.id).toBe(a.session!.me.id);
    expect(b.session!.me.name).toBe('Frost Pilot');
  });

  it('turns away unknown codes and old pages', () => {
    const lab = new Lab();
    const bad = lab.join({ hello: { token: 'AAAAAAAAAAAAAAAA' } });
    expect(bad.session).toBeNull();
    expect(bad.received.some((m) => m.t === 'error' && m.code === 'token')).toBe(true);
    const old = lab.join({ hello: { v: PROTOCOL_VERSION - 1 } });
    expect(old.session).toBeNull();
    expect(old.received.some((m) => m.t === 'error' && m.code === 'version')).toBe(true);
  });

  it('signing in twice kicks the older screen', () => {
    const lab = new Lab();
    const a = lab.join();
    const b = lab.join({ hello: { token: a.session!.token } });
    expect(b.session).not.toBeNull();
    expect(a.received.some((m) => m.t === 'error' && m.code === 'replaced')).toBe(true);
    expect(lab.game.online).toBe(1);
  });

  it('only sells at the Assay Office', () => {
    const lab = new Lab();
    const a = lab.join();
    a.client.player!.cargo = { gold: 2 };
    const goldPrice = priceOf(lab.game.world, GOLD);
    lab.game.handle(a.client, { t: 'act', id: 1, act: { a: 'sell' } });
    lab.run([], 1);
    const res = a.received.find((m) => m.t === 'res' && m.id === 1);
    expect(res).toMatchObject({ res: { ok: false, why: 'where' } });
    const assay = lab.game.world.station.find((b) => b.key === 'assay')!;
    placeRig(a.client.player!.rig, assay.x + 1.5, SKY);
    lab.game.handle(a.client, { t: 'act', id: 2, act: { a: 'sell' } });
    lab.run([], 1);
    expect(a.received.find((m) => m.t === 'res' && m.id === 2)).toMatchObject({ res: { ok: true, total: 2 * goldPrice } });
    expect(a.client.player!.cash).toBe(2 * goldPrice);
  });

  it('ignores junk actions', () => {
    const lab = new Lab();
    const a = lab.join();
    lab.game.handle(a.client, { t: 'act', id: 1, act: { a: 'upgrade', k: 'toString' } } as never);
    lab.game.handle(a.client, { t: 'act', id: 2, act: { a: 'refuel', litres: -50 } } as never);
    lab.run([], 1);
    expect(a.received.some((m) => m.t === 'res')).toBe(false);
  });

  it("won't run a sped-up client faster than real time", () => {
    const lab = new Lab();
    const a = lab.join();
    // 10 seconds of inputs sent at once, in batches.
    for (let s = 1; s <= 600; s += 30) lab.game.handle(a.client, { t: 'in', s, i: new Array(30).fill(1) });
    const before = a.client.steps;
    lab.run([], 60);
    // One second of server time allows about 60 steps plus the banked burst.
    expect(a.client.steps - before).toBeLessThanOrEqual(60 * 1.05 + 20);
  });

  it('saves the world and the players, and loads them back', () => {
    const lab = new Lab();
    const a = lab.join({ hello: { name: 'Saver' } });
    const x = lab.game.world.station[0].x - 4;
    lab.game.world.set(x, SKY + 3, T.AIR);
    lab.run([], 1);
    a.client.player!.cash = 4321;
    lab.game.save();
    const again = new Game(lab.store, 'test', 80, 999);
    expect(again.world.seed).toBe(lab.game.world.seed);
    expect(again.world.get(x, SKY + 3)).toBe(T.AIR);
    const lab2 = Object.assign(Object.create(Lab.prototype), lab, { game: again, inflight: [] }) as Lab;
    const b = lab2.join({ hello: { token: a.session!.token } });
    expect(b.session!.player.cash).toBe(4321);
  });
});

describe('days', () => {
  it('only pass while somebody is online, and survive a restart', () => {
    const lab = new Lab();
    /** Seconds since day 1 began, as a joining miner is told. The session then runs its own clock from there. */
    const age = (j: ReturnType<Lab['join']>) => j.session!.world.time - j.session!.world.dayStart;
    const a = lab.join({ hello: { name: 'Early' } });
    expect(age(a)).toBeCloseTo(0, 0);
    lab.run([a.session!], 600); // 10 s online
    expect(lab.game.dayClock()).toBeCloseTo(10000, -2);
    lab.game.drop(a.client);
    lab.run([], 6000); // 100 s with nobody on
    expect(lab.game.dayClock()).toBeCloseTo(10000, -2);
    const b = lab.join({ hello: { name: 'Late' } });
    expect(age(b)).toBeCloseTo(10, 0);
    lab.run([b.session!], 300);
    // A second miner joining mid-way gets the same clock.
    const c = lab.join({ hello: { name: 'Third' } });
    expect(age(c)).toBeCloseTo(15, 0);
    // One leaving doesn't stop it while the other stays.
    lab.game.drop(b.client);
    lab.run([c.session!], 300);
    expect(lab.game.dayClock()).toBeCloseTo(20000, -2);
    lab.game.save();
    const again = new Game(lab.store, 'test', 80, 999);
    expect(again.dayClock()).toBeCloseTo(20000, -2);
  });
});

describe('prediction', () => {
  /** Drive left off the pad, then dig down; track the largest visible correction. */
  function dig(lag: number, jitter: number) {
    const lab = new Lab();
    const a = lab.join({ lag, jitter });
    const s = a.session!;
    let worst = 0;
    const measure = () => {
      const p = s.renderPos();
      worst = Math.max(worst, Math.hypot(p.x - s.player.rig.x, p.y - s.player.rig.y));
    };
    s.input.left = true;
    lab.run([s], 60, measure);
    s.input.left = false;
    lab.run([s], 20, measure);
    s.input.down = true;
    lab.run([s], 60 * 5, measure);
    s.input.down = false;
    lab.run([s], 60, measure);
    return { lab, a, s, worst };
  }

  it('the predicted rig matches the server exactly on a steady connection', () => {
    const { a, s, worst } = dig(6, 0);
    const srv = a.client.player!;
    expect(srv.stats.dug).toBeGreaterThan(5);
    expect(s.player.rig.x).toBeCloseTo(srv.rig.x, 6);
    expect(s.player.rig.y).toBeCloseTo(srv.rig.y, 6);
    expect(cargoCount(s.player)).toBe(cargoCount(srv));
    expect(s.player.stats).toEqual(srv.stats);
    expect(worst).toBeLessThan(0.001);
  });

  it('stays close with a jittery connection and settles to the same place', () => {
    const { a, s, worst } = dig(4, 8);
    const srv = a.client.player!.rig;
    expect(Math.hypot(s.player.rig.x - srv.x, s.player.rig.y - srv.y)).toBeLessThan(0.001);
    expect(worst).toBeLessThan(0.05);
  });

  it('the client world ends up identical to the server world', () => {
    const { lab, s } = dig(5, 3);
    expect(Buffer.from(s.world.tiles).equals(Buffer.from(lab.game.world.tiles))).toBe(true);
  });
});

describe('two miners', () => {
  it('see each other, see each other dig, and chat', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 3, hello: { name: 'Ada' } });
    const b = lab.join({ lag: 3, hello: { name: 'Bo' } });
    const sa = a.session!;
    const sb = b.session!;
    lab.run([sa, sb], 10);
    expect([...sa.peers()].map((p) => p.name)).toEqual(['Bo']);
    expect([...sb.peers()].map((p) => p.name)).toEqual(['Ada']);

    sa.input.left = true;
    lab.run([sa, sb], 60);
    sa.input.left = false;
    sa.input.down = true;
    lab.run([sa, sb], 120);
    sa.input.down = false;
    lab.run([sa, sb], 30);
    expect(a.client.player!.stats.dug).toBeGreaterThan(2);
    expect(Buffer.from(sb.world.tiles).equals(Buffer.from(lab.game.world.tiles))).toBe(true);
    const seen = [...sb.peers()][0];
    expect(seen.x).toBeCloseTo(a.client.player!.rig.x, 1);
    expect(seen.y).toBeCloseTo(a.client.player!.rig.y, 1);

    const heard: string[] = [];
    sb.on((e) => {
      if (e.t === 'chat') heard.push(`${e.name}: ${e.text}`);
    });
    sa.chat('mind the gas at 900 m');
    sa.chat('spam');
    lab.run([sa, sb], 20);
    expect(heard).toEqual(['Ada: mind the gas at 900 m']);
  });

  it('two rigs drilling the same ore: only one gets it', () => {
    const lab = new Lab();
    const a = lab.join();
    const b = lab.join();
    const w = lab.game.world;
    const x = w.station[0].x - 5;
    for (let y = SKY - 2; y < SKY; y++) for (let xx = x - 1; xx <= x + 1; xx++) w.set(xx, y, T.AIR);
    w.set(x, SKY, MINERAL_BASE + 5);
    w.set(x, SKY + 1, T.ROCK);
    for (const c of [a.client, b.client]) placeRig(c.player!.rig, x + 0.5, SKY);
    lab.run([], 2);
    for (const c of [a.client, b.client]) lab.game.handle(c, { t: 'in', s: c.ack + 1, i: new Array(30).fill(8) });
    lab.run([], 120);
    expect(w.get(x, SKY)).toBe(T.AIR);
    expect(cargoCount(a.client.player!) + cargoCount(b.client.player!)).toBe(1);
  });

  it('the server runs the living ice: everyone sees a rockfall, and only the miner it lands on is hurt', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 2 });
    const b = lab.join({ lag: 2 });
    const sa = a.session!;
    const sb = b.session!;
    const w = lab.game.world;
    const x = 12;
    const y = SKY + 60;
    for (let yy = y - 2; yy <= y + 6; yy++) for (let xx = x - 2; xx <= x + 2; xx++) w.set(xx, yy, T.ICE);
    for (let k = 2; k <= 4; k++) w.set(x, y + k, T.AIR);
    w.set(x, y, T.BOULDER); // resting on the ice at y + 1 for now
    placeRig(a.client.player!.rig, x + 0.5, y + 5);
    lab.run([sa, sb], 5);
    const seenA: string[] = [];
    const seenB: string[] = [];
    sa.on((e) => seenA.push(e.t === 'hurt' ? `hurt:${e.cause}` : e.t));
    sb.on((e) => seenB.push(e.t === 'hurt' ? `hurt:${e.cause}` : e.t));
    const hull = a.client.player!.rig.hull;
    // Knock the floor out from under it.
    w.set(x, y + 1, T.AIR);
    lab.run([sa, sb], 150);
    expect(seenA).toEqual(expect.arrayContaining(['loose', 'fall', 'crash', 'hurt:rock']));
    expect(seenB).toEqual(expect.arrayContaining(['loose', 'fall', 'crash']));
    expect(seenB).not.toContain('hurt:rock');
    expect(a.client.player!.rig.hull).toBeLessThan(hull);
    expect(sa.player.rig.hull).toBe(a.client.player!.rig.hull);
    expect(Buffer.from(sb.world.tiles).equals(Buffer.from(w.tiles))).toBe(true);
  });

  it('a flare one miner drops shows up for the others', () => {
    const lab = new Lab();
    const a = lab.join();
    const b = lab.join();
    const sb = b.session!;
    const flares: number[] = [];
    sb.on((e) => {
      if (e.t === 'flare') flares.push(e.x);
    });
    a.client.player!.items.flare = 1;
    lab.game.handle(a.client, { t: 'act', id: 1, act: { a: 'use', k: 'flare' } });
    lab.run([sb], 5);
    expect(flares).toEqual([a.client.player!.rig.x]);
    expect(a.client.player!.items.flare).toBe(0);
  });
  it('everyone gets a once-a-second map of where the others are, even far out of sight', () => {
    const lab = new Lab();
    const a = lab.join({ hello: { name: 'Ada', paint: 3 } });
    const b = lab.join({ hello: { name: 'Bo' } });
    const sa = a.session!;
    const w = lab.game.world;
    // Bo is parked in a pocket far below and to the side.
    const x = 70;
    const y = SKY + 200;
    for (let xx = x - 1; xx <= x + 1; xx++) w.set(xx, y, T.AIR);
    w.set(x, y + 1, T.ROCK);
    placeRig(b.client.player!.rig, x + 0.5, y + 1);
    lab.run([sa], 70);
    expect([...sa.peers()]).toEqual([]);
    const dots = sa.mapPeers();
    expect(dots.map((d) => d.name)).toEqual(['Bo']);
    expect(dots[0].x).toBeCloseTo(x + 0.5, 0);
    expect(dots[0].y).toBeCloseTo(b.client.player!.rig.y, 0);
    // And Bo sees Ada, with her paint.
    lab.run([b.session!], 70);
    expect(b.session!.mapPeers().map((d) => [d.name, d.paint])).toEqual([['Ada', 3]]);
  });

  it('nobody gets map messages while they are alone', () => {
    const lab = new Lab();
    const a = lab.join();
    lab.run([a.session!], 130);
    expect(a.received.some((m) => m.t === 'map')).toBe(false);
  });

  it('the SOS of a stalled miner goes out by itself, and a miner with a Fuel Cell parked beside them refuels them for the rescue fee', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 2, hello: { name: 'Ada' } });
    const b = lab.join({ lag: 2, hello: { name: 'Bo' } });
    const sa = a.session!;
    const sb = b.session!;
    const w = lab.game.world;
    const x = 20;
    const y = SKY + 40;
    for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x + 4; xx++) w.set(xx, yy, T.AIR);
    for (let xx = x - 1; xx <= x + 4; xx++) w.set(xx, y + 1, T.ICE);
    const pa = a.client.player!;
    const pb = b.client.player!;
    placeRig(pa.rig, x + 0.5, y + 1);
    placeRig(pb.rig, x + 2.5, y + 1);
    pa.rig.fuel = 0;
    pa.items.fuelcell = 0;
    sa.player.items.fuelcell = 0;
    pa.cash = 1000;
    pb.items.fuelcell = 1;

    const heardA: string[] = [];
    const heardB: string[] = [];
    sa.on((e) => {
      if (e.t === 'peer-sos') heardA.push(`sos:${e.name}:${e.mine}`);
      if (e.t === 'rescue') heardA.push(`rescue:${e.role}:${e.fee}`);
    });
    sb.on((e) => {
      if (e.t === 'peer-sos') heardB.push(`sos:${e.name}:${e.mine}`);
      if (e.t === 'rescue') heardB.push(`rescue:${e.role}:${e.fee}`);
    });
    // The SOS goes out by itself when the rig stalls, once. Asking again changes nothing.
    lab.run([sa, sb], 20);
    expect(pa.rig.stalled).toBe(true);
    expect(sa.player.rig.stalled).toBe(true);
    sa.sos();
    expect(sa.sosSent).toBe(true);
    lab.run([sa, sb], 15);
    expect(heardA).toEqual(['sos:Ada:true']);
    expect(heardB).toEqual(['sos:Ada:false']);
    const seen = [...sb.peers()].find((p) => p.name === 'Ada')!;
    expect(seen.flags & RIG_STALLED).toBeTruthy();
    expect(seen.flags & RIG_SOS).toBeTruthy();

    const fee = rescueFee(pa);
    sb.aid(sa.me.id);
    lab.run([sa, sb], 15);
    expect(pa.rig.stalled).toBe(false);
    expect(pa.rig.fuel).toBeGreaterThan(4);
    expect(pa.cash).toBe(1000 - fee);
    expect(cargoCount(pa)).toBe(0);
    expect(pb.cash).toBe(fee);
    expect(pb.items.fuelcell).toBe(0);
    expect(pb.stats.rescues).toBe(1);
    expect(heardA).toContain(`rescue:helped:${fee}`);
    expect(heardB).toContain(`rescue:helper:${fee}`);
    expect(sb.player.cash).toBe(fee);
    expect(sa.sosSent).toBe(false);
    // Rig flags clear once the miner has fuel again.
    lab.run([sa, sb], 10);
    expect([...sb.peers()].find((p) => p.name === 'Ada')!.flags & (RIG_STALLED | RIG_SOS)).toBe(0);
  });

  it('alone online, an empty tank ends the rig, and a respawn puts a fuelled one on the pad with the ore gone', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 2 });
    const s = a.session!;
    const w = lab.game.world;
    const p = a.client.player!;
    const x = 20;
    const y = SKY + 40;
    for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x + 1; xx++) w.set(xx, yy, T.AIR);
    w.set(x, y + 1, T.ICE);
    placeRig(p.rig, x + 0.5, y + 1);
    p.rig.fuel = 0.02;
    p.items.fuelcell = 0;
    s.player.items.fuelcell = 0;
    p.cargo = { tin: 2 };
    p.cash = 300;
    lab.run([s], 40);
    expect(p.rig.wrecked).toBe(true);
    expect(s.player.rig.wrecked).toBe(true);
    expect(s.player.rig.wreckedBy).toBe('fuel');
    expect(s.act({ a: 'respawn' }).ok).toBe(true);
    lab.run([s], 20);
    const sp = w.spawn();
    for (const pl of [p, s.player]) {
      expect(pl.rig.wrecked).toBe(false);
      expect(pl.rig.x).toBeCloseTo(sp.x);
      expect(pl.rig.fuel).toBe(10);
      expect(cargoCount(pl)).toBe(0);
      expect(pl.cash).toBe(300);
    }
    expect(p.stats.deaths).toBe(1);
  });

  it('online, a carried Fuel Cell cuts in on both sides without the page losing count', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 3, jitter: 2 });
    const s = a.session!;
    const w = lab.game.world;
    const p = a.client.player!;
    const x = 20;
    const y = SKY + 40;
    for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x + 1; xx++) w.set(xx, yy, T.AIR);
    w.set(x, y + 1, T.ICE);
    placeRig(p.rig, x + 0.5, y + 1);
    p.rig.fuel = 0.05;
    p.items.fuelcell = 1;
    s.player.items.fuelcell = 1;
    let reserves = 0;
    s.on((e) => {
      if (e.t === 'reserve') reserves++;
    });
    lab.run([s], 120);
    expect(reserves).toBe(1);
    for (const pl of [p, s.player]) {
      expect(pl.rig.wrecked).toBe(false);
      expect(pl.items.fuelcell).toBe(0);
      expect(pl.rig.fuel).toBeGreaterThan(4);
    }
  });

  it('a miner who stalls in the air with someone else online comes down on the parachute and can give up', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 2, hello: { name: 'Ada' } });
    const b = lab.join({ lag: 2, hello: { name: 'Bo' } });
    const sa = a.session!;
    const w = lab.game.world;
    const pa = a.client.player!;
    const x = 20;
    const y = SKY + 40;
    for (let yy = y - 12; yy <= y; yy++) w.set(x, yy, T.AIR);
    w.set(x, y + 1, T.ICE);
    placeRig(pa.rig, x + 0.5, y + 1);
    pa.rig.y -= 10;
    pa.rig.grounded = false;
    pa.rig.fuel = 0;
    pa.items.fuelcell = 0;
    sa.player.items.fuelcell = 0;
    pa.cargo = { tin: 2 };
    const hull = pa.rig.hull;
    lab.run([sa, b.session!], 60 * 5);
    expect(pa.rig.stalled).toBe(true);
    expect(pa.rig.grounded).toBe(true);
    expect(pa.rig.hull).toBe(hull);
    expect(sa.player.rig.stalled).toBe(true);
    expect(sa.act({ a: 'respawn' }).ok).toBe(true);
    lab.run([sa, b.session!], 20);
    expect(pa.rig.stalled).toBe(false);
    expect(pa.rig.x).toBeCloseTo(w.spawn().x);
    expect(cargoCount(pa)).toBe(0);
  });

  it('miners nearby are told when a rig is lost, and how', () => {
    const lab = new Lab();
    const a = lab.join({ lag: 2, hello: { name: 'Ada' } });
    const b = lab.join({ lag: 2, hello: { name: 'Bo' } });
    const w = lab.game.world;
    const pa = a.client.player!;
    const x = 20;
    const y = SKY + 40;
    for (let yy = y - 22; yy <= y; yy++) for (let xx = x - 1; xx <= x + 3; xx++) w.set(xx, yy, T.AIR);
    for (let xx = x - 1; xx <= x + 3; xx++) w.set(xx, y + 1, T.ICE);
    placeRig(b.client.player!.rig, x + 2.5, y + 1);
    placeRig(pa.rig, x + 0.5, y + 1);
    lab.run([a.session!, b.session!], 20);
    // Ada drops 20 tiles with a hull that can't take it.
    pa.rig.y -= 20;
    pa.rig.grounded = false;
    pa.rig.hull = 1;
    const heard: string[] = [];
    b.session!.on((e) => {
      if (e.t === 'peer-wrecked') heard.push(`${e.name}:${e.cause}:${Math.round(e.x)}`);
    });
    a.session!.on((e) => {
      if (e.t === 'peer-wrecked') heard.push('Ada heard her own');
    });
    lab.run([a.session!, b.session!], 60 * 3);
    expect(pa.rig.wrecked).toBe(true);
    expect(heard).toEqual([`Ada:fall:${Math.round(x + 0.5)}`]);
  });

  it("an SOS from a rig that isn't stalled goes nowhere", () => {
    const lab = new Lab();
    const a = lab.join();
    const b = lab.join();
    lab.game.handle(a.client, { t: 'sos' });
    lab.run([b.session!], 5);
    expect(b.received.some((m) => m.t === 'sos')).toBe(false);
  });
});

describe('refuelling another miner', () => {
  function pair() {
    const w = new World(5, 80);
    const helper = newPlayer(w);
    const target = newPlayer(w);
    placeRig(target.rig, 20.5, SKY + 30);
    placeRig(helper.rig, 21.5, SKY + 30);
    target.rig.fuel = 0;
    target.rig.stalled = true;
    target.cash = 400;
    helper.items.fuelcell = 2;
    return { helper, target };
  }

  it('works next to a stalled miner and moves the rescue fee across', () => {
    const { helper, target } = pair();
    const fee = rescueFee(target);
    const r = aid(helper, target);
    expect(r).toEqual({ ok: true, fee, litres: 5 });
    expect(helper.items.fuelcell).toBe(1);
    expect(helper.cash).toBe(fee);
    expect(target.cash).toBe(400 - fee);
    expect(target.rig.stalled).toBe(false);
  });

  it('needs a Fuel Cell, needs to be close, and only helps a stalled rig', () => {
    let t = pair();
    t.helper.items.fuelcell = 0;
    expect(aid(t.helper, t.target)).toEqual({ ok: false, why: 'item' });
    t = pair();
    t.helper.rig.x += AID_REACH + 1;
    expect(aid(t.helper, t.target)).toEqual({ ok: false, why: 'far' });
    t = pair();
    t.target.rig.stalled = false;
    expect(aid(t.helper, t.target)).toEqual({ ok: false, why: 'state' });
    t = pair();
    t.target.rig.wrecked = true;
    expect(aid(t.helper, t.target)).toEqual({ ok: false, why: 'state' });
    expect(aid(t.helper, t.helper)).toEqual({ ok: false, why: 'state' });
  });
});

describe('market and bounty', () => {
  /** A time (in seconds) when the day's bounty for this seed isn't on tin or gold. */
  function quietTime(seed: number): number {
    for (let day = 0; ; day++) {
      const k = bountyOf(seed, day * 86400 + 10).key;
      if (k !== 'tin' && k !== 'gold') return day * 86400 + 10;
    }
  }

  it('offline, ore sells at list price whatever was sold before', () => {
    const w = new World(5, 80);
    w.time = quietTime(5);
    const p = newPlayer(w);
    p.cargo = { tin: 30 };
    expect(sellAll(p, w).total).toBe(30 * TIN.value);
    p.cargo = { tin: 30 };
    expect(sellAll(p, w).total).toBe(30 * TIN.value);
  });

  it('a sale pushes the price down, never below the floor, and it recovers', () => {
    const w = new World(5, 80);
    w.time = quietTime(5);
    w.market = {};
    const p = newPlayer(w);
    p.cargo = { tin: 60 };
    expect(sellAll(p, w).total).toBe(60 * TIN.value);
    const after = priceOf(w, TIN);
    expect(after).toBeLessThan(TIN.value);
    expect(trend(w.market, TIN, w.time)).toBe(-1);
    // Gold wasn't sold, so it hasn't moved.
    expect(priceOf(w, GOLD)).toBe(GOLD.value);
    recordSale(w.market, 'tin', 100000, w.time);
    expect(marketFactor(w.market, TIN, w.time)).toBeCloseTo(MARKET.floor, 5);
    // One half-life later the glut has halved, and the price is on its way back up.
    const g = glutNow(w.market, 'tin', w.time);
    w.time += MARKET.halfLife;
    expect(glutNow(w.market, 'tin', w.time)).toBeCloseTo(g / 2, 5);
    expect(trend(w.market, TIN, w.time)).toBe(1);
    w.time += MARKET.halfLife * 40;
    expect(priceOf(w, TIN)).toBe(TIN.value);
    expect(trend(w.market, TIN, w.time)).toBe(0);
  });

  it('relics always pay in full', () => {
    const w = new World(5, 80);
    w.time = quietTime(5);
    w.market = {};
    const p = newPlayer(w);
    const cache = MINERALS[MINERAL_INDEX.cache];
    p.cargo = { cache: 3 };
    sellAll(p, w);
    expect(priceOf(w, cache)).toBe(cache.value);
    expect(Object.keys(w.market)).toEqual([]);
  });

  it("the day's bounty ore pays extra, is the same all day, and is never a relic", () => {
    const w = new World(77, 80);
    const seen = new Set<string>();
    for (let day = 0; day < 200; day++) {
      w.time = day * 86400 + 5;
      const b = bountyOf(w.seed, w.time);
      seen.add(b.key);
      expect(b.kind).not.toBe('relic');
      expect(bountyOf(w.seed, w.time + 86000).key).toBe(b.key);
      expect(priceOf(w, b)).toBe(Math.round(b.value * BOUNTY_BONUS));
    }
    expect(seen.size).toBeGreaterThan(6);
  });

  it("one miner's sale moves the price on everyone's screen, and it survives a restart", () => {
    const lab = new Lab();
    const a = lab.join();
    const b = lab.join();
    const assay = lab.game.world.station.find((x) => x.key === 'assay')!;
    placeRig(a.client.player!.rig, assay.x + 1.5, SKY);
    a.client.player!.cargo = { tin: 50 };
    lab.run([a.session!, b.session!], 3);
    const before = priceOf(lab.game.world, TIN);
    expect(priceOf(b.session!.world, TIN)).toBe(before);
    lab.game.handle(a.client, { t: 'act', id: 1, act: { a: 'sell' } });
    lab.run([a.session!, b.session!], 5);
    expect(a.client.player!.cash).toBe(50 * before);
    const m = b.session!.world.market as Market;
    expect(m.tin.g).toBeCloseTo(50, 3);
    expect(marketFactor(m, TIN, m.tin.at)).toBeLessThan(1);
    expect(marketFactor(a.session!.world.market, TIN, m.tin.at)).toBeCloseTo(marketFactor(m, TIN, m.tin.at), 6);
    lab.game.save();
    const again = new Game(lab.store, 'test', 80, 1234);
    expect((again.world.market as Market).tin.g).toBeCloseTo(50, 3);
  });
});

describe('finds and leaderboards', () => {
  /** Put a mineral under the rig and drill it. */
  function digUp(lab: Lab, who: ReturnType<Lab['join']>, key: string, x: number): void {
    const w = lab.game.world;
    const y = SKY + 20;
    w.set(x, y, T.AIR);
    w.set(x, y + 1, MINERAL_BASE + MINERAL_INDEX[key]);
    w.set(x, y + 2, T.ICE);
    placeRig(who.client.player!.rig, x + 0.5, y + 1);
    who.session!.input.down = true;
    lab.run([who.session!], 60 * 6);
    who.session!.input.down = false;
  }

  it("tells everyone about the season's first of each mineral, and about every relic", () => {
    const lab = new Lab();
    const a = lab.join({ hello: { name: 'Ada' } });
    const b = lab.join({ hello: { name: 'Bo' } });
    const heard: string[] = [];
    b.session!.on((e) => {
      if (e.t === 'find') heard.push(`${e.name}:${e.mineral}:${e.first}:${e.mine}`);
    });
    lab.run([a.session!, b.session!], 5);
    digUp(lab, a, 'tin', 12);
    digUp(lab, a, 'tin', 14);
    digUp(lab, a, 'cache', 16);
    digUp(lab, a, 'cache', 18);
    lab.run([a.session!, b.session!], 10);
    expect(heard).toEqual(['Ada:tin:true:false', 'Ada:cache:true:false', 'Ada:cache:false:false']);
    expect(a.client.player!.stats.relics).toBe(2);
  });

  it('ranks miners by depth, earnings, relics and rescues, including those offline', () => {
    const lab = new Lab();
    const a = lab.join({ hello: { name: 'Ada' } });
    const b = lab.join({ hello: { name: 'Bo' } });
    const c = lab.join({ hello: { name: 'Cy' } });
    Object.assign(a.client.player!.stats, { deepest: 120, earned: 500, relics: 1 });
    Object.assign(b.client.player!.stats, { deepest: 300, earned: 200, rescues: 2 });
    Object.assign(c.client.player!.stats, { deepest: 40 });
    // Cy goes home: the saved rig still counts.
    lab.game.drop(c.client);
    digUp(lab, a, 'tin', 12);
    lab.game.handle(a.client, { t: 'boards' });
    lab.run([a.session!, b.session!], 3);
    const info = a.session!.boards()!;
    expect(info.now.season).toBe(1);
    expect(info.now.miners).toBe(3);
    expect(info.now.boards.deepest.map((r) => r.name)).toEqual(['Bo', 'Ada', 'Cy']);
    expect(info.now.boards.earned.map((r) => [r.name, r.v])).toEqual([['Ada', 500], ['Bo', 200]]);
    expect(info.now.boards.relics.map((r) => r.name)).toEqual(['Ada']);
    expect(info.now.boards.rescues.map((r) => r.name)).toEqual(['Bo']);
    expect(info.now.firsts.map((f) => `${f.name}:${f.mineral}`)).toEqual(['Ada:tin']);
    expect(info.last).toBeNull();
    expect(a.session!.season()).toEqual({ n: 1, ends: info.ends });
  });
});

describe('seasons', () => {
  it('rolls over to a new map, keeps the final boards, and starts everyone again', () => {
    const lab = new Lab();
    // Put the clock one second before the end of the season.
    const base = Date.now() + lab.game.seasonMs - 1000;
    lab.game.now = () => base + (lab.tick * 1000) / 60;
    lab.game.nextSeed = () => 4321;
    const a = lab.join({ hello: { name: 'Ada' } });
    const b = lab.join({ hello: { name: 'Bo' } });
    const tokenA = a.session!.token;
    Object.assign(a.client.player!.stats, { deepest: 200, earned: 900 });
    Object.assign(b.client.player!.stats, { deepest: 350, earned: 100 });
    a.client.player!.cash = 5000;
    a.client.player!.upgrades.drill = 2;
    lab.game.world.set(10, SKY + 3, T.AIR);
    recordSale(lab.game.world.market!, 'tin', 80, lab.game.world.time);
    lab.run([a.session!, b.session!], 30);
    expect(lab.game.season).toBe(1);
    const gone: string[] = [];
    a.session!.on((e) => {
      if (e.t === 'disconnected') gone.push(e.reason);
    });
    lab.run([a.session!, b.session!], 120);

    expect(lab.game.season).toBe(2);
    expect(lab.game.world.seed).toBe(4321);
    expect(lab.game.world.diffs.size).toBe(0);
    expect(lab.game.world.market).toEqual({});
    expect(lab.game.online).toBe(0);
    expect(gone).toEqual(['Season 1 is over. A new map is ready.']);
    expect(a.closed()).toBe('season');

    // Ada comes back: a new rig, and a summary of the season she played.
    const a2 = lab.join({ hello: { token: tokenA } });
    expect(a2.session!.world.seed).toBe(4321);
    expect(a2.client.player!.cash).toBe(0);
    expect(a2.client.player!.upgrades.drill).toBe(0);
    expect(a2.client.player!.stats.deepest).toBe(0);
    const recap = a2.session!.recap!;
    expect(recap.record.season).toBe(1);
    expect(recap.record.boards.deepest.map((r) => r.name)).toEqual(['Bo', 'Ada']);
    expect(recap.you.deepest).toEqual({ v: 200, rank: 2 });
    expect(recap.you.earned).toEqual({ v: 900, rank: 1 });
    expect(recap.you.relics).toEqual({ v: 0, rank: 0 });
    expect(a2.session!.season()!.n).toBe(2);
    expect(a2.session!.season()!.ends).toBeGreaterThan(lab.game.now() + lab.game.seasonMs - 5000);

    // The old boards stay on show, and the summary isn't repeated once she has a rig this season.
    lab.game.handle(a2.client, { t: 'boards' });
    lab.run([a2.session!], 3);
    expect(a2.session!.boards()!.last!.boards.earned[0]).toMatchObject({ name: 'Ada', v: 900 });
    expect(a2.session!.boards()!.now.boards.deepest).toEqual([]);
    lab.game.drop(a2.client);
    const a3 = lab.join({ hello: { token: tokenA } });
    expect(a3.session!.recap).toBeNull();
    // A newcomer gets no summary either.
    expect(lab.join().session!.recap).toBeNull();
  });
});
