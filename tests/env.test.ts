import { describe, expect, it } from 'vitest';
import { ENV, Environment } from '../src/sim/env';
import { newPlayer, placeRig, RIG_H, type Player } from '../src/sim/player';
import { STEP, noInput, step, useItem, type Input, type SimEvent } from '../src/sim/rig';
import { L, T, isMineral, isSolid } from '../src/sim/tiles';
import { DAY_LENGTH, dayNumber, dayPart, dayPhase, daylight } from '../src/sim/daytime';
import { BLIZZARD, STEAM, WEATHER_SLOT, ambientTemp, blizzardAt, ventActive } from '../src/sim/weather';
import { SKY, World } from '../src/sim/world';

const W = 80;

/** A world with a clean test block: everything in [x0, x1] x [y0, y1] set to `t`. */
function setup(t: number = T.ICE) {
  const w = new World(99, W);
  const x = 10;
  const y = SKY + 60;
  for (let yy = y - 8; yy <= y + 8; yy++) for (let xx = x - 6; xx <= x + 6; xx++) w.set(xx, yy, t);
  const env = new Environment(w);
  return { w, env, x, y };
}

/** A player parked far away, so it doesn't block refreeze or get hit. */
function bystander(w: World): Player {
  const p = newPlayer(w);
  placeRig(p.rig, 60.5, SKY);
  return p;
}

function tick(env: Environment, players: Player[], seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < seconds; t += STEP) {
    const o = env.step(players, STEP);
    out.push(...o.fx, ...o.personal.map(([, e]) => e));
  }
  return out;
}

function run(w: World, env: Environment, p: Player, input: Partial<Input>, seconds: number): SimEvent[] {
  const ev: SimEvent[] = [];
  const inp = { ...noInput(), ...input };
  for (let t = 0; t < seconds; t += STEP) {
    step(p, w, inp, STEP, ev);
    const o = env.step([p], STEP);
    ev.push(...o.fx, ...o.personal.map(([, e]) => e));
  }
  return ev;
}

describe('falling tiles', () => {
  it('a boulder drops after a moment when the tile under it is dug, and lands on the floor', () => {
    const { w, env, x, y } = setup();
    w.set(x, y, T.BOULDER);
    for (let k = 1; k <= 4; k++) w.set(x, y + k, T.AIR);
    // Nothing happens yet: the boulder only notices the hole when it opens.
    expect(w.get(x, y)).toBe(T.BOULDER);
    w.set(x, y + 1, T.ICE);
    w.set(x, y + 1, T.AIR);
    const ev = tick(env, [bystander(w)], ENV.wobble * 0.5);
    expect(ev.some((e) => e.t === 'loose')).toBe(true);
    expect(w.get(x, y)).toBe(T.BOULDER);
    const later = tick(env, [bystander(w)], 3);
    expect(later.some((e) => e.t === 'fall')).toBe(true);
    expect(w.get(x, y)).toBe(T.AIR);
    expect(w.get(x, y + 4)).toBe(T.BOULDER);
  });

  it('a slab hanging over a cave drops when you dig beside it', () => {
    const { w, env: first, x, y } = setup();
    first.detach();
    // The cave and the slab were there from the start, like generation puts them.
    w.set(x, y, T.SLAB);
    w.set(x, y + 1, T.AIR);
    w.set(x, y + 2, T.AIR);
    const env = new Environment(w);
    tick(env, [bystander(w)], 2);
    expect(w.get(x, y)).toBe(T.SLAB); // it hung there quite happily
    w.set(x + 1, y, T.AIR);
    tick(env, [bystander(w)], 2);
    expect(w.get(x, y)).toBe(T.AIR);
    expect(w.get(x, y + 2)).toBe(T.SLAB);
  });

  it('a stack of loose tiles comes down one after another', () => {
    const { w, env, x, y } = setup();
    w.set(x, y, T.BOULDER);
    w.set(x, y - 1, T.SLAB);
    for (let k = 1; k <= 3; k++) w.set(x, y + k, T.AIR);
    w.set(x, y + 1, T.ICE);
    w.set(x, y + 1, T.AIR);
    tick(env, [bystander(w)], 5);
    expect(w.get(x, y + 3)).toBe(T.BOULDER);
    expect(w.get(x, y + 2)).toBe(T.SLAB);
    expect(w.get(x, y)).toBe(T.AIR);
  });

  it('a boulder that lands on a rig hurts it and breaks', () => {
    const { w, env, x, y } = setup();
    const p = newPlayer(w);
    w.set(x, y, T.BOULDER);
    for (let k = 1; k <= 3; k++) w.set(x, y + k, T.AIR);
    placeRig(p.rig, x + 0.5, y + 4);
    const hull = p.rig.hull;
    w.set(x, y + 1, T.ICE);
    w.set(x, y + 1, T.AIR);
    const ev = run(w, env, p, {}, 3);
    expect(ev.some((e) => e.t === 'hurt' && e.cause === 'rock')).toBe(true);
    expect(ev.some((e) => e.t === 'crash')).toBe(true);
    expect(p.rig.hull).toBe(hull - ENV.rockHit[T.BOULDER]);
    for (let k = 0; k <= 3; k++) expect(w.get(x, y + k)).toBe(T.AIR);
  });
});

describe('refreeze', () => {
  it('a dug tunnel in the glacier frosts over into rime, but not while a rig is near', () => {
    const { w, env, x, y } = setup();
    expect(w.layerAt(x, y)).toBe(L.ICE);
    const near = newPlayer(w);
    placeRig(near.rig, x + 0.5, y + 1);
    w.set(x, y, T.AIR);
    w.set(x + 4, y - 4, T.AIR);
    tick(env, [near], ENV.refreeze[L.ICE] * 1.6);
    expect(w.get(x, y)).toBe(T.AIR); // the rig is right there
    expect([T.RIME, T.AIR]).toContain(w.get(x + 4, y - 4)); // that one may have refrozen or regrown
    expect(isSolid(w.get(x + 4, y - 4)) || w.get(x + 4, y - 4) === T.AIR).toBe(true);
    tick(env, [bystander(w)], 60);
    const t = w.get(x, y);
    expect(t === T.RIME || isMineral(t)).toBe(true);
  });

  it("doesn't refreeze tunnels below the glacier", () => {
    const w = new World(99, W);
    const env = new Environment(w);
    const y = SKY + 300;
    expect(w.layerAt(10, y)).toBeGreaterThan(L.ICE);
    w.set(10, y, T.AIR);
    tick(env, [bystander(w)], ENV.refreeze[L.ICE] * 2);
    expect(w.get(10, y)).toBe(T.AIR);
  });

  it('ore only regrows with solid ground under it, so it never caps a shaft', () => {
    const { w, env, x, y } = setup();
    // A shaft: every tile in it has another tunnel tile under it.
    for (let k = 0; k < 6; k++) w.set(x, y - 6 + k, T.AIR);
    tick(env, [bystander(w)], ENV.refreeze[L.ICE] * 1.6);
    for (let k = 0; k < 5; k++) {
      const t = w.get(x, y - 6 + k);
      expect(isMineral(t)).toBe(false);
    }
  });

  it('thrusting up into rime breaks through it', () => {
    const { w, env, x, y } = setup();
    for (let k = 0; k <= 4; k++) w.set(x, y - k, T.AIR);
    w.set(x, y - 3, T.RIME);
    const p = newPlayer(w);
    placeRig(p.rig, x + 0.5, y + 1);
    const ev = run(w, env, p, { up: true }, 1.5);
    expect(ev.some((e) => e.t === 'dug' && e.tile === T.RIME)).toBe(true);
    expect(w.get(x, y - 3)).toBe(T.AIR);
    expect(p.rig.y).toBeLessThan(y - 3);
  });

  it("can't thrust through ordinary ice", () => {
    const { w, env, x, y } = setup();
    for (let k = 0; k <= 2; k++) w.set(x, y - k, T.AIR);
    const p = newPlayer(w);
    placeRig(p.rig, x + 0.5, y + 1);
    run(w, env, p, { up: true }, 0.8);
    expect(w.get(x, y - 3)).toBe(T.ICE);
    expect(p.rig.y - RIG_H / 2).toBeGreaterThanOrEqual(y - 2 - 1e-6);
  });
});

describe('meltwater and magma', () => {
  it('drilling a meltwater pocket tops up the tank and leaves a plain tunnel, with no flood', () => {
    const { w, env, x, y } = setup();
    for (let k = 1; k <= 3; k++) w.set(x, y + k, T.AIR);
    w.set(x, y, T.AIR);
    w.set(x, y + 1, T.MELT);
    const p = newPlayer(w);
    placeRig(p.rig, x + 0.5, y + 1);
    p.rig.fuel = 2;
    const ev = run(w, env, p, { down: true }, 1.2);
    const refill = ev.find((e) => e.t === 'refill');
    expect(refill).toBeTruthy();
    expect(p.rig.fuel).toBeGreaterThan(5.5);
    expect(w.get(x, y + 1)).toBe(T.AIR);
    for (let k = 2; k <= 3; k++) expect(w.get(x, y + k)).toBe(T.AIR);
  });

  it('a meltwater pocket never overfills the tank', () => {
    const { w, env, x, y } = setup();
    w.set(x, y, T.AIR);
    w.set(x, y + 1, T.MELT);
    const p = newPlayer(w);
    placeRig(p.rig, x + 0.5, y + 1);
    const ev = run(w, env, p, { down: true }, 1.2);
    expect(w.get(x, y + 1)).toBe(T.AIR);
    // Drilling burned a little, and the pocket only tops that back up.
    const refill = ev.find((e) => e.t === 'refill');
    expect(refill && refill.t === 'refill' && refill.litres).toBeLessThan(1);
    expect(p.rig.fuel).toBeLessThanOrEqual(10);
    expect(p.rig.fuel).toBeGreaterThan(9);
  });

  it('standing water left in an old save freezes into rime, but never around a rig in it', () => {
    const w = new World(99, W);
    const x = 10;
    const y = SKY + 60;
    for (let i = -3; i <= 3; i++) w.set(x + i, y, T.WATER);
    w.set(x, y + 1, T.ICE);
    const env = new Environment(w);
    const p = newPlayer(w);
    placeRig(p.rig, x + 0.5, y + 1);
    tick(env, [p], ENV.freeze + 5);
    expect(w.get(x, y)).toBe(T.WATER);
    expect(w.get(x + 3, y)).toBe(T.RIME);
  });

  it('magma pours into a tunnel opened next to it, runs a little way, then cools to slag', () => {
    const { w, env, x, y } = setup(T.BASALT);
    w.set(x - 1, y, T.MAGMA);
    w.set(x, y + 1, T.AIR);
    w.set(x, y + 2, T.AIR);
    w.set(x, y, T.AIR); // dug right beside it
    const ev = tick(env, [bystander(w)], ENV.pour * 3);
    expect(ev.some((e) => e.t === 'pour')).toBe(true);
    expect(w.get(x, y)).toBe(T.MAGMA);
    expect(w.get(x, y + 2)).toBe(T.MAGMA); // it ran downhill
    tick(env, [bystander(w)], ENV.cool + 10);
    expect(w.get(x, y)).toBe(T.SLAG);
    expect(w.get(x, y + 2)).toBe(T.SLAG);
    expect(w.get(x - 1, y)).toBe(T.MAGMA); // the source stays
  });
});

describe('weather and vents', () => {
  it('blizzards come and go on the clock, the same for every screen', () => {
    const seed = 7;
    let storms = 0;
    for (let s = 0; s < 200; s++) if (blizzardAt(seed, s * WEATHER_SLOT + WEATHER_SLOT / 2) > 0.99) storms++;
    expect(storms).toBeGreaterThan(200 * BLIZZARD.chance * 0.5);
    expect(storms).toBeLessThan(200 * BLIZZARD.chance * 1.6);
    // Fades in and out at the slot edges.
    for (let s = 0; s < 50; s++) {
      expect(blizzardAt(seed, s * WEATHER_SLOT + 1)).toBeLessThan(0.05);
    }
  });

  it('a blizzard chills the surface but not the deep', () => {
    const w = new World(7, W);
    let s = 0;
    while (blizzardAt(w.seed, s * WEATHER_SLOT + WEATHER_SLOT / 2) === 0) s++;
    w.time = s * WEATHER_SLOT + WEATHER_SLOT / 2;
    const calm = new World(7, W);
    let c = 0;
    while (blizzardAt(calm.seed, c * WEATHER_SLOT + WEATHER_SLOT / 2) > 0) c++;
    calm.time = c * WEATHER_SLOT + WEATHER_SLOT / 2;
    expect(ambientTemp(w, 0)).toBeCloseTo(ambientTemp(calm, 0) - BLIZZARD.chill);
    expect(ambientTemp(w, 100)).toBe(ambientTemp(calm, 100));
  });

  it('an active steam vent scalds and lifts a rig above it', () => {
    const { w, env, x, y } = setup(T.BASALT);
    w.set(x, y + 1, T.VENT);
    for (let k = 0; k <= 3; k++) w.set(x, y - k, T.AIR);
    // Find a moment when the vent is blowing.
    let t = 0;
    while (!ventActive(w, x, y + 1)) t += 0.05;
    w.time = t;
    const p = newPlayer(w);
    placeRig(p.rig, x + 0.5, y + 1);
    const hull = p.rig.hull;
    const startY = p.rig.y;
    run(w, env, p, {}, 0.2);
    expect(p.rig.scald).toBe(true);
    expect(p.rig.hull).toBeLessThan(hull);
    expect(p.rig.y).toBeLessThan(startY);
    expect(STEAM.burn).toBeGreaterThan(0);
  });
});

describe('flares', () => {
  it('a flare is used up and lights the spot it was dropped', () => {
    const { w, x, y } = setup();
    const p = newPlayer(w);
    w.set(x, y, T.AIR);
    placeRig(p.rig, x + 0.5, y + 1);
    p.items.flare = 2;
    const ev: SimEvent[] = [];
    expect(useItem(p, w, 'flare', ev)).toBe(true);
    expect(p.items.flare).toBe(1);
    expect(ev.find((e) => e.t === 'flare')).toMatchObject({ x: x + 0.5 });
  });
});

describe('day and night', () => {
  it('counts days from dayStart, an hour each', () => {
    const w = new World(7, W);
    w.dayStart = 1000;
    w.time = 1000;
    expect(dayNumber(w)).toBe(1);
    expect(dayPhase(w)).toBe(0);
    w.time = 1000 + DAY_LENGTH - 0.5;
    expect(dayNumber(w)).toBe(1);
    w.time = 1000 + DAY_LENGTH;
    expect(dayNumber(w)).toBe(2);
    w.time = 1000 + DAY_LENGTH * 6.5;
    expect(dayNumber(w)).toBe(7);
    expect(dayPhase(w)).toBeCloseTo(0.5);
    // A clock that's slightly behind never shows day 0.
    w.time = 990;
    expect(dayNumber(w)).toBe(1);
    expect(dayPhase(w)).toBe(0);
  });

  it('runs sunrise, day, dusk, night', () => {
    // 40 minutes of day, 20 of night.
    expect(DAY_LENGTH).toBe(3600);
    const at = (minutes: number) => (minutes * 60) / DAY_LENGTH;
    expect(dayPart(at(0))).toBe('Dawn');
    expect(dayPart(at(2))).toBe('Day');
    expect(daylight(at(20))).toBe(1);
    expect(dayPart(at(38))).toBe('Day');
    expect(dayPart(at(40))).toBe('Dusk');
    expect(daylight(at(40))).toBeCloseTo(0.5);
    expect(dayPart(at(42))).toBe('Night');
    expect(daylight(at(50))).toBe(0);
    expect(dayPart(at(58))).toBe('Night');
    expect(dayPart(at(59.5))).toBe('Dawn');
    // Light never jumps: dawn and dusk take three minutes each.
    for (let s = 0; s < DAY_LENGTH; s += 10) expect(Math.abs(daylight((s + 10) / DAY_LENGTH) - daylight(s / DAY_LENGTH))).toBeLessThan(0.06);
  });
});
