import { describe, expect, it } from 'vitest';
import { Store } from '../server/db';
import { Client, Game } from '../server/game';
import { NetSession, type Transport, type Welcome } from '../src/net/netSession';
import { PROTOCOL_VERSION, cleanChat, cleanName, decodeDiffs, encodeDiffs, type ClientMsg, type ServerMsg } from '../src/net/protocol';
import { cargoCount, placeRig } from '../src/sim/player';
import { STEP } from '../src/sim/rig';
import { MINERAL_BASE, T } from '../src/sim/tiles';
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
    lab.game.handle(a.client, { t: 'act', id: 1, act: { a: 'sell' } });
    lab.run([], 1);
    const res = a.received.find((m) => m.t === 'res' && m.id === 1);
    expect(res).toMatchObject({ res: { ok: false, why: 'where' } });
    const assay = lab.game.world.station.find((b) => b.key === 'assay')!;
    placeRig(a.client.player!.rig, assay.x + 1.5, SKY);
    lab.game.handle(a.client, { t: 'act', id: 2, act: { a: 'sell' } });
    lab.run([], 1);
    expect(a.received.find((m) => m.t === 'res' && m.id === 2)).toMatchObject({ res: { ok: true, total: 640 } });
    expect(a.client.player!.cash).toBe(640);
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
});
