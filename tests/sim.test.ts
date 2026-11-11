import { describe, expect, it } from 'vitest';
import { newPlayer, placeRig, statsOf, cargoCount, RIG_H } from '../src/sim/player';
import { BURN, PHYS, STEP, fuelToSurface, noInput, rigDepth, step, useItem, type Input, type SimEvent } from '../src/sim/rig';
import { buildingAt, buyItem, buyUpgrade, refuel, repair, respawn, sellAll } from '../src/sim/station';
import { TEMP_POINTS, tempAtDepth } from '../src/sim/temperature';
import { LAYERS, MINERALS, MINERAL_BASE, T, isMineral, isSolid } from '../src/sim/tiles';
import { UPGRADES, UPGRADE_ORDER } from '../src/sim/upgrades';
import { DEPTH, SKY, WORLD_H, World } from '../src/sim/world';

const W = 80;
const world = () => new World(1234, W);
/** A new miner without the starter Fuel Cell, for tests about an empty tank. */
function bare(w: World) {
  const p = newPlayer(w);
  p.items.fuelcell = 0;
  return p;
}

function run(w: World, p: ReturnType<typeof newPlayer>, input: Partial<Input>, seconds: number): SimEvent[] {
  const ev: SimEvent[] = [];
  const inp = { ...noInput(), ...input };
  for (let t = 0; t < seconds; t += STEP) step(p, w, inp, STEP, ev);
  return ev;
}

/** A column in the open ground outside the station. */
function openColumn(w: World): number {
  const x = w.station[0].x - 6;
  expect(w.get(x, SKY)).not.toBe(T.PAD);
  return x;
}

/** Clear a test area so physics checks don't depend on ore or caves. */
function fill(w: World, x0: number, x1: number, y0: number, y1: number, t: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w.set(x, y, t);
}

describe('world generation', () => {
  it('is the same for the same seed and differs between seeds', () => {
    const a = world();
    const b = world();
    const c = new World(99, W);
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
    expect(Buffer.from(a.tiles).equals(Buffer.from(c.tiles))).toBe(false);
  });

  it('has sky above, walls at the edges and an unbreakable floor', () => {
    const w = world();
    for (let x = 1; x < W - 1; x++) for (let y = 0; y < SKY; y++) expect(w.get(x, y)).toBe(T.AIR);
    for (let y = 0; y < WORLD_H; y++) {
      expect(w.get(0, y)).toBe(T.WALL);
      expect(w.get(W - 1, y)).toBe(T.WALL);
    }
    for (let x = 0; x < W; x++) expect(w.get(x, WORLD_H - 1)).toBe(T.WALL);
  });

  it('puts concrete pads under every station building', () => {
    const w = world();
    for (const b of w.station) for (let x = b.x; x < b.x + b.w; x++) expect(w.get(x, SKY)).toBe(T.PAD);
    const sp = w.spawn();
    expect(w.station.some((b) => sp.x >= b.x && sp.x < b.x + b.w)).toBe(true);
  });

  it('places every mineral, and only inside its depth range and layers', () => {
    // Several seeds, so the rarest finds show up at least once.
    const found = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = new World(seed, W);
      for (let y = SKY; y < WORLD_H; y++) {
        for (let x = 0; x < W; x++) {
          const t = w.get(x, y);
          if (!isMineral(t)) continue;
          const i = t - MINERAL_BASE;
          const m = MINERALS[i];
          const d = y - SKY;
          expect(d).toBeGreaterThanOrEqual(m.min);
          expect(d).toBeLessThanOrEqual(m.max);
          if (m.layers) expect(m.layers).toContain(w.layerAt(x, y));
          found.add(i);
        }
      }
    }
    expect([...found].sort((a, b) => a - b)).toEqual(MINERALS.map((_, i) => i));
  });

  it('has every layer and no gas near the surface', () => {
    const w = world();
    const seen = new Set<number>();
    for (let y = SKY; y < WORLD_H - 1; y++) {
      seen.add(w.layerAt(W >> 1, y));
      if (y - SKY <= 140) for (let x = 0; x < W; x++) expect(w.get(x, y)).not.toBe(T.GAS);
    }
    expect(seen.size).toBe(LAYERS.length);
  });

  it('records changes as diffs and forgets them when put back', () => {
    const w = world();
    const x = openColumn(w);
    const orig = w.get(x, SKY + 3);
    w.set(x, SKY + 3, T.AIR);
    expect(w.diffs.size).toBe(1);
    const copy = world();
    copy.applyDiffs([...w.diffs]);
    expect(copy.get(x, SKY + 3)).toBe(T.AIR);
    w.set(x, SKY + 3, orig);
    expect(w.diffs.size).toBe(0);
  });
});

describe('temperature', () => {
  it('follows the profile: coldest in the glacier, hottest at the bottom', () => {
    for (const [d, t] of TEMP_POINTS) expect(tempAtDepth(d)).toBeCloseTo(t);
    const coldest = Math.min(...TEMP_POINTS.map(([, t]) => t));
    expect(tempAtDepth(85)).toBe(coldest);
    expect(tempAtDepth(DEPTH)).toBe(Math.max(...TEMP_POINTS.map(([, t]) => t)));
  });

  it('the best heater and radiator cover the whole map', () => {
    const heat = UPGRADES.heater.tiers.at(-1)!.value;
    const rad = UPGRADES.radiator.tiers.at(-1)!.value;
    for (let d = 0; d <= DEPTH; d++) {
      expect(tempAtDepth(d)).toBeGreaterThanOrEqual(heat);
      expect(tempAtDepth(d)).toBeLessThanOrEqual(rad);
    }
  });
});

describe('upgrades', () => {
  it('cost more and do more at every tier', () => {
    for (const key of UPGRADE_ORDER) {
      const t = UPGRADES[key].tiers;
      expect(t[0].cost).toBe(0);
      for (let i = 1; i < t.length; i++) {
        expect(t[i].cost).toBeGreaterThan(t[i - 1].cost);
        if (key === 'heater') expect(t[i].value).toBeLessThan(t[i - 1].value);
        else expect(t[i].value).toBeGreaterThan(t[i - 1].value);
      }
    }
  });
});

describe('rig', () => {
  it('rests on the pad at spawn without damage or fuel use', () => {
    const w = world();
    const p = newPlayer(w);
    const fuel = p.rig.fuel;
    run(w, p, {}, 2);
    expect(p.rig.grounded).toBe(true);
    expect(p.rig.hull).toBe(statsOf(p).maxHull);
    expect(p.rig.fuel).toBe(fuel);
    expect(buildingAt(w, p)?.key).toBe('shop');
  });

  it('drills straight down and drops into the hole', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x - 1, x + 1, SKY, SKY + 6, T.SNOW);
    placeRig(p.rig, x + 0.5, SKY);
    const ev = run(w, p, { down: true }, 1.5);
    expect(ev.filter((e) => e.t === 'dug').length).toBeGreaterThanOrEqual(3);
    expect(w.get(x, SKY)).toBe(T.AIR);
    expect(rigDepth(p.rig)).toBeGreaterThan(2.9);
  });

  it('slides over to line up with a column before drilling down', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x - 2, x + 2, SKY, SKY + 4, T.SNOW);
    placeRig(p.rig, x + 0.05, SKY); // straddling two columns
    const ev = run(w, p, { down: true }, 0.6);
    expect(ev.some((e) => e.t === 'dug')).toBe(true);
  });

  it('drills sideways into a wall', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x - 2, x + 3, SKY - 1, SKY - 1, T.AIR);
    fill(w, x - 2, x + 3, SKY, SKY + 2, T.SNOW);
    fill(w, x, x, SKY + 1, SKY + 1, T.AIR); // a pocket to stand in
    placeRig(p.rig, x + 0.5, SKY + 2);
    run(w, p, {}, 0.3);
    const ev = run(w, p, { right: true }, 0.5);
    expect(ev.some((e) => e.t === 'dug' && e.x === x + 1 && e.y === SKY + 1)).toBe(true);
  });

  it("can't drill pads, walls or boulders", () => {
    const w = world();
    const p = newPlayer(w);
    const ev = run(w, p, { down: true }, 1);
    expect(ev.some((e) => e.t === 'dig-start')).toBe(false);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY, T.BOULDER);
    placeRig(p.rig, x + 0.5, SKY);
    expect(run(w, p, { down: true }, 1).some((e) => e.t === 'dig-start')).toBe(false);
  });

  it('picks up ore until the bay is full', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    const cap = statsOf(p).cargo;
    fill(w, x, x, SKY, SKY + cap + 2, MINERAL_BASE); // a column of tin
    placeRig(p.rig, x + 0.5, SKY);
    const ev = run(w, p, { down: true }, 12);
    expect(cargoCount(p)).toBe(cap);
    expect(ev.some((e) => e.t === 'cargo-full')).toBe(true);
  });

  it('takes no damage from a short drop and some from a long one', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x - 1, x + 1, SKY, SKY + 30, T.AIR);
    fill(w, x - 1, x + 1, SKY + 31, SKY + 31, T.ROCK);
    const max = statsOf(p).maxHull;
    placeRig(p.rig, x + 0.5, SKY + 31 - 2.5); // 2.5 tiles of free fall
    run(w, p, {}, 1.5);
    expect(p.rig.hull).toBe(max);
    placeRig(p.rig, x + 0.5, SKY + 12);
    const ev = run(w, p, {}, 2);
    expect(ev.some((e) => e.t === 'hurt' && e.cause === 'fall')).toBe(true);
    expect(p.rig.hull).toBeLessThan(max);
  });

  it('flies up with thrust and burns fuel doing it', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x - 1, x + 1, SKY, SKY + 20, T.AIR);
    fill(w, x - 1, x + 1, SKY + 21, SKY + 21, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 21);
    const fuel = p.rig.fuel;
    run(w, p, { up: true }, 4.5);
    expect(rigDepth(p.rig)).toBeLessThan(0);
    expect(p.rig.fuel).toBeLessThan(fuel - BURN.thrust * 3);
  });

  it('stalls underground with an empty tank while another miner is around, and a fuel cell gets it going', () => {
    const w = world();
    w.rescue = true;
    const p = bare(w);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY + 3, T.AIR);
    fill(w, x, x, SKY + 4, SKY + 4, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 4);
    p.rig.fuel = 0;
    const ev = run(w, p, { up: true }, 0.5);
    expect(ev.some((e) => e.t === 'stalled')).toBe(true);
    expect(rigDepth(p.rig)).toBeCloseTo(4, 1);
    p.items.fuelcell = 1;
    expect(useItem(p, w, 'fuelcell', [])).toBe(true);
    expect(p.rig.stalled).toBe(false);
    expect(p.rig.fuel).toBeCloseTo(statsOf(p).tank / 2);
  });

  it('a new rig carries one Fuel Cell', () => {
    expect(newPlayer(world()).items.fuelcell).toBe(1);
  });

  it('an empty tank with nobody around wrecks the rig', () => {
    const w = world();
    const p = bare(w);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY + 3, T.AIR);
    fill(w, x, x, SKY + 4, SKY + 4, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 4);
    p.rig.fuel = 0.01;
    const ev = run(w, p, { up: true }, 0.5);
    expect(ev.some((e) => e.t === 'wrecked' && e.cause === 'fuel')).toBe(true);
    expect(ev.some((e) => e.t === 'stalled')).toBe(false);
    expect(p.rig.wrecked).toBe(true);
    expect(p.rig.wreckedBy).toBe('fuel');
  });

  it('a dry tank on the surface is not a wreck: the rig can still crawl to the depot', () => {
    const w = world();
    const p = newPlayer(w);
    p.rig.fuel = 0;
    const x0 = p.rig.x;
    run(w, p, { right: true }, 1);
    expect(p.rig.wrecked).toBe(false);
    expect(p.rig.x).toBeGreaterThan(x0 + 0.5);
  });

  it('burns a carried Fuel Cell by itself when the tank runs dry', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY + 3, T.AIR);
    fill(w, x, x, SKY + 4, SKY + 4, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 4);
    p.rig.fuel = 0;
    p.items.fuelcell = 2;
    const ev = run(w, p, {}, 0.1);
    expect(ev.filter((e) => e.t === 'reserve')).toEqual([{ t: 'reserve', left: 1 }]);
    expect(p.items.fuelcell).toBe(1);
    expect(p.rig.wrecked).toBe(false);
    expect(p.rig.stalled).toBe(false);
    expect(p.rig.fuel).toBeGreaterThan(statsOf(p).tank * 0.45);
  });

  it('a rig that stalls in the air comes down on a parachute, unhurt', () => {
    const w = world();
    w.rescue = true;
    const p = bare(w);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY + 30, T.AIR);
    fill(w, x, x, SKY + 31, SKY + 31, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 31);
    p.rig.y = SKY + 3;
    p.rig.grounded = false;
    p.rig.fuel = 0;
    const hull = p.rig.hull;
    let fastest = 0;
    for (let i = 0; i < 60 * 20 && !p.rig.grounded; i++) {
      run(w, p, {}, STEP);
      fastest = Math.max(fastest, p.rig.vy);
    }
    expect(p.rig.grounded).toBe(true);
    expect(p.rig.stalled).toBe(true);
    expect(fastest).toBeLessThanOrEqual(PHYS.chute + 0.001);
    expect(p.rig.hull).toBe(hull);
    expect(p.rig.wrecked).toBe(false);
  });

  it('a stalled rig is lost once the last other miner leaves', () => {
    const w = world();
    w.rescue = true;
    const p = bare(w);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY + 3, T.AIR);
    fill(w, x, x, SKY + 4, SKY + 4, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 4);
    p.rig.fuel = 0;
    run(w, p, {}, 0.2);
    expect(p.rig.stalled).toBe(true);
    w.rescue = false;
    run(w, p, {}, 0.1);
    expect(p.rig.wrecked).toBe(true);
    expect(p.rig.wreckedBy).toBe('fuel');
  });

  it('estimates the fuel for the flight home a little on the safe side', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x, x, SKY, SKY + 24, T.AIR);
    fill(w, x, x, SKY + 25, SKY + 25, T.ROCK);
    placeRig(p.rig, x + 0.5, SKY + 25);
    const need = fuelToSurface(p, w);
    const before = p.rig.fuel;
    for (let i = 0; i < 4000 && rigDepth(p.rig) > 0; i++) run(w, p, { up: true }, STEP);
    const used = before - p.rig.fuel;
    expect(need).toBeGreaterThan(used);
    expect(need).toBeLessThan(used * 1.6);
    placeRig(p.rig, x + 0.5, SKY);
    expect(fuelToSurface(p, w)).toBe(0);
  });

  it('a starting rig can reach the glacier and fly home on one tank', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    // Dig 40 tiles through whatever is there (boulders cleared for the test).
    for (let y = SKY; y <= SKY + 40; y++) if (!isSolid(w.get(x, y)) || w.get(x, y) === T.BOULDER || w.get(x, y) === T.GAS) w.set(x, y, T.ICE);
    placeRig(p.rig, x + 0.5, SKY);
    for (let i = 0; i < 2000 && rigDepth(p.rig) < 40; i++) run(w, p, { down: true }, STEP * 5);
    expect(rigDepth(p.rig)).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < 2000 && rigDepth(p.rig) > -1; i++) run(w, p, { up: true }, STEP * 5);
    expect(rigDepth(p.rig)).toBeLessThan(0);
    expect(p.rig.fuel).toBeGreaterThan(0);
    expect(p.rig.wrecked).toBe(false);
  });

  it('heat damages a rig that goes deeper than its radiator allows', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    const y = SKY + 450;
    fill(w, x - 1, x + 1, y - 2, y - 1, T.AIR);
    fill(w, x - 1, x + 1, y, y, T.BASALT);
    placeRig(p.rig, x + 0.5, y);
    p.rig.fuel = 999;
    run(w, p, {}, 3);
    expect(p.rig.hot).toBe(true);
    expect(p.rig.hull).toBeLessThan(statsOf(p).maxHull);
  });

  it('a thermal charge clears boulders around the rig', () => {
    const w = world();
    const p = newPlayer(w);
    const x = openColumn(w);
    fill(w, x - 1, x + 1, SKY + 4, SKY + 6, T.BOULDER);
    w.set(x, SKY + 5, T.AIR);
    placeRig(p.rig, x + 0.5, SKY + 6);
    p.rig.y = SKY + 5 + 0.5;
    p.items.charge = 1;
    expect(useItem(p, w, 'charge', [])).toBe(true);
    for (let yy = SKY + 4; yy <= SKY + 6; yy++) for (let xx = x - 1; xx <= x + 1; xx++) expect(w.get(xx, yy)).toBe(T.AIR);
  });
});

describe('station', () => {
  it('sells cargo, refuels, repairs and buys upgrades', () => {
    const w = world();
    const p = newPlayer(w);
    p.cargo = { tin: 4, gold: 1 };
    const sale = sellAll(p);
    expect(sale.total).toBe(4 * 15 + 320);
    expect(p.cash).toBe(sale.total);
    expect(cargoCount(p)).toBe(0);

    p.rig.fuel = 2;
    p.rig.hull = 10;
    refuel(p);
    repair(p);
    expect(p.rig.fuel).toBe(statsOf(p).tank);
    expect(p.rig.hull).toBe(statsOf(p).maxHull);

    p.cash = 1000;
    expect(buyUpgrade(p, 'drill')).toBe('ok');
    expect(p.upgrades.drill).toBe(1);
    expect(p.cash).toBe(1000 - UPGRADES.drill.tiers[1].cost);
    expect(buyUpgrade(p, 'radiator')).toBe('cash');
    expect(buyItem(p, 'fuelcell')).toBe('ok');
    expect(p.items.fuelcell).toBe(2);
  });

  it('only sells what you can afford when short on cash', () => {
    const w = world();
    const p = newPlayer(w);
    p.rig.fuel = 0;
    p.cash = 5;
    refuel(p);
    expect(p.rig.fuel).toBeCloseTo(2.5);
    expect(p.cash).toBe(0);
  });

  it('a respawn costs the ore on board and nothing else, and the rig comes back fuelled and repaired', () => {
    const w = world();
    const p = newPlayer(w);
    p.cash = 1000;
    p.cargo = { copper: 3 };
    p.items.charge = 2;
    p.upgrades.tank = 1;
    p.rig.y = SKY + 100;
    p.rig.wrecked = true;
    p.rig.wreckedBy = 'fall';
    p.rig.hull = 0;
    p.rig.fuel = 1;
    expect(respawn(p, w)).toBe(3);
    expect(p.cash).toBe(1000);
    expect(p.items.charge).toBe(2);
    expect(p.upgrades.tank).toBe(1);
    expect(cargoCount(p)).toBe(0);
    expect(p.rig.wrecked).toBe(false);
    expect(p.rig.wreckedBy).toBeNull();
    expect(p.rig.hull).toBe(statsOf(p).maxHull);
    expect(p.rig.fuel).toBe(statsOf(p).tank);
    expect(p.stats.deaths).toBe(1);
    expect(p.rig.y + RIG_H / 2).toBeCloseTo(SKY);
  });

  it('the first tier of every upgrade is within reach of an early trip or two', () => {
    for (const key of UPGRADE_ORDER) {
      if (key === 'radiator') continue; // not needed until the hot zones
      expect(UPGRADES[key].tiers[1].cost).toBeLessThanOrEqual(400);
    }
  });
});
