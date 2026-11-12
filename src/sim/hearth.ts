// The Hearth: the machine at the bottom of the world, and the fight to break it.
//
// Every miner fights their own. Stepping through the gate in the antechamber moves the rig
// into a private arena (a small World of its own): a chamber with the machine in it, and a
// shaft straight up to the surface. No guns. The fight is:
//   1. Break the four heat vents with charges, while the machine sends out freezing pulses
//      (be off the ground when one lands) and shakes ice off the roof.
//   2. With the vents gone the heart is exposed. One more charge, from on top of the machine.
//   3. The Hollow comes down. A wall of heat climbs the shaft behind you: fly to the surface.
// Offline the LocalSession runs this; online only the server does, and the page is sent what
// it needs to draw (HearthView) with its snapshots.

import { Environment } from './env';
import { newItems } from './items';
import { RIG_H, placeRig, statsOf, type Player } from './player';
import { PHYS, hurt, rigDepth, type SimEvent } from './rig';
import { hash3 } from './rng';
import { T } from './tiles';
import { newUpgrades } from './upgrades';
import { ARENA, SKY, World } from './world';

export const HEARTH = {
  /** Seconds between freezing pulses, while the vents stand and once the heart is exposed. */
  pulseEvery: 8,
  pulseEveryOpen: 5.5,
  /** Seconds of warning before a pulse. */
  warn: 1.8,
  /** Hull a pulse takes off a rig that's on the ground. */
  pulseHit: 30,
  /** Seconds between slabs of ice shaken off the chamber roof. */
  iceEvery: 2.4,
  /** In the escape: seconds between slabs coming down the shaft, and how far above the rig they start. */
  rubbleEvery: 3.2,
  rubbleAhead: 15,
  /** The heat front climbs at this share of the rig's own top climbing speed, after a slow start. */
  waveShare: 0.82,
  waveStartShare: 0.4,
  waveRamp: 12,
  /** How far below the chamber floor the heat front starts, in tiles. */
  waveLead: 7,
  /** Hull per second lost inside the heat front. */
  waveBurn: 90,
  /** In the escape, thin ice plugs the shaft every this many tiles. */
  plugEvery: 55,
};

export type HearthPhase = 'fight' | 'escape';

export interface HearthRun {
  world: World;
  env: Environment;
  phase: HearthPhase;
  /** Seconds since the rig came through the gate. */
  t: number;
  /** Vents still standing. */
  vents: number;
  /** The heart is exposed. */
  open: boolean;
  /** When (run.t) the next pulse lands, and whether its warning has gone out. */
  pulseAt: number;
  warned: boolean;
  iceAt: number;
  /** The top of the heat front, as a y in tiles. Only moves in the escape. */
  wave: number;
  waveSpeed: number;
  escapeAt: number;
  /** Where the rig goes back to in the dig site. */
  back: { x: number; y: number };
  /** A counter for this run's dice. */
  n: number;
}

/** What the page needs to draw the fight. Sent with snapshots online. */
export interface HearthView {
  phase: HearthPhase;
  vents: number;
  open: boolean;
  /** Seconds until the next pulse. */
  pulseIn: number;
  /** The top of the heat front, as a y in tiles (escape only). */
  wave: number;
  t: number;
}

export const viewOf = (run: HearthRun): HearthView => ({ phase: run.phase, vents: run.vents, open: run.open, pulseIn: Math.max(0, run.pulseAt - run.t), wave: run.wave, t: run.t });

function touchingGate(world: World, p: Player): boolean {
  const r = p.rig;
  if (r.wrecked || r.drill) return false;
  const x0 = Math.floor(r.x - 0.4);
  const x1 = Math.floor(r.x + 0.4);
  const y0 = Math.floor(r.y - 0.4);
  const y1 = Math.floor(r.y + 0.4);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.get(x, y) === T.GATE) return true;
  return false;
}

/** True when the rig stands in the Hearth's gate in the dig site and could go in. */
export const atGate = (world: World, p: Player) => world.kind === 'main' && touchingGate(world, p);

/** True when the rig stands in the gate inside the arena and could go back out. The way out shuts once the heart breaks. */
export const atExit = (run: Pick<HearthRun, 'phase' | 'world'>, p: Player) => run.phase === 'fight' && touchingGate(run.world, p);

/** A fresh arena for this dig site. The page builds one too (without running the fight) so it can predict the rig. */
export function arenaFor(main: World): World {
  const w = new World(main.seed, ARENA.w, 'hearth');
  w.time = main.time;
  w.dayStart = main.dayStart;
  return w;
}

/** Take the rig through the gate. The caller has checked atGate. */
export function enterHearth(p: Player, main: World): HearthRun {
  const world = arenaFor(main);
  const r = p.rig;
  const run: HearthRun = {
    world,
    env: new Environment(world),
    phase: 'fight',
    t: 0,
    vents: ARENA.vents.length,
    open: false,
    pulseAt: HEARTH.pulseEvery,
    warned: false,
    iceAt: HEARTH.iceEvery * 1.5,
    wave: SKY + ARENA.floor + HEARTH.waveLead,
    waveSpeed: 0,
    escapeAt: 0,
    back: { x: r.x, y: r.y },
    n: 0,
  };
  moveIn(p, world);
  return run;
}

/** Put the rig where a rig arrives in the arena. Used by the page too, to follow the server. */
export function moveIn(p: Player, arena: World): void {
  const sp = arena.spawn();
  placeRig(p.rig, sp.x, sp.y);
  p.rig.stalled = false;
}

/** Back out through the gate, to where the rig stood in the dig site. */
export function leaveHearth(back: { x: number; y: number }, p: Player): void {
  const r = p.rig;
  r.x = back.x;
  r.y = back.y;
  r.vx = r.vy = 0;
  r.drill = null;
  r.thrusting = false;
  r.grounded = true;
}

const roll = (run: HearthRun, salt: number) => hash3(run.world.seed + salt, run.n++, 5501);

/** Hang a slab of ice at (x, y) if there's room, and let it go. */
function dropIce(run: HearthRun, x: number, y: number): void {
  const w = run.world;
  if (w.get(x, y) !== T.AIR || w.get(x, y + 1) !== T.AIR) return;
  w.set(x, y, T.SLAB);
  run.env.checkLoose(x, y);
}

/**
 * Advance the fight by dt seconds, after the rig has moved. Events for the page are appended
 * to `ev`. Returns true on the step the rig reaches the surface in the escape: the Hearth is won.
 */
export function hearthStep(run: HearthRun, p: Player, dt: number, ev: SimEvent[]): boolean {
  const w = run.world;
  const r = p.rig;
  const A = ARENA;
  run.t += dt;
  const out = run.env.step([p], dt);
  ev.push(...out.fx);
  for (const [, e] of out.personal) ev.push(e);
  if (r.wrecked) return false;

  if (run.phase === 'fight') {
    const left = A.vents.filter((v) => w.get(v.x, SKY + v.d) === T.HVENT).length;
    if (left !== run.vents) {
      run.vents = left;
      ev.push({ t: 'hearth-vent', left });
    }
    const hx = A.heart.x;
    const hy = SKY + A.heart.d;
    if (left === 0 && !run.open) {
      run.open = true;
      w.set(hx, hy, T.HEART);
      run.pulseAt = Math.min(run.pulseAt, run.t + HEARTH.pulseEveryOpen);
      ev.push({ t: 'hearth-open' });
    }
    if (run.open && w.get(hx, hy) !== T.HEART) {
      startEscape(run, p, ev);
      return false;
    }

    // Freezing pulses: frost runs through the floor and walls, so the place to be is the air.
    if (!run.warned && run.t >= run.pulseAt - HEARTH.warn) {
      run.warned = true;
      ev.push({ t: 'hearth-charge', inSeconds: Math.max(0, run.pulseAt - run.t) });
    }
    if (run.t >= run.pulseAt) {
      const hit = r.grounded || !!r.drill;
      ev.push({ t: 'hearth-pulse', hit });
      if (hit) hurt(p, HEARTH.pulseHit, 'frost', ev, true);
      run.pulseAt = run.t + (run.open ? HEARTH.pulseEveryOpen : HEARTH.pulseEvery);
      run.warned = false;
    }

    // Ice off the roof, over or near the rig.
    if (run.t >= run.iceAt) {
      run.iceAt = run.t + HEARTH.iceEvery * (0.7 + roll(run, 1) * 0.6);
      const x = Math.max(A.left, Math.min(A.right, Math.floor(r.x) + Math.floor(roll(run, 2) * 5) - 2));
      dropIce(run, x, SKY + A.roof);
    }
    return false;
  }

  // The escape: the heat front climbs, rubble comes down the shaft, and the surface is the way out.
  const since = run.t - run.escapeAt;
  const k = Math.min(1, since / HEARTH.waveRamp);
  run.wave -= run.waveSpeed * (HEARTH.waveStartShare + (HEARTH.waveShare - HEARTH.waveStartShare) * k) * dt;
  if (r.y + RIG_H / 2 > run.wave) hurt(p, HEARTH.waveBurn * dt, 'heat', ev, false);
  if (r.wrecked) return false;
  if (run.t >= run.iceAt) {
    run.iceAt = run.t + HEARTH.rubbleEvery * (0.7 + roll(run, 3) * 0.6);
    const y = Math.floor(r.y) - HEARTH.rubbleAhead;
    if (y > SKY + 4) dropIce(run, A.shaft[0] + Math.floor(roll(run, 4) * 3), y);
  }
  return rigDepth(r) <= 0.5;
}

function startEscape(run: HearthRun, p: Player, ev: SimEvent[]): void {
  const w = run.world;
  const A = ARENA;
  run.phase = 'escape';
  run.escapeAt = run.t;
  run.waveSpeed = PHYS.maxUp * statsOf(p).engine;
  run.iceAt = run.t + HEARTH.rubbleEvery;
  // Thin ice across the shaft here and there: thrusting up into it breaks it, but it costs a moment.
  for (let d = A.roof - HEARTH.plugEvery; d > 20; d -= HEARTH.plugEvery) {
    for (let x = A.shaft[0]; x <= A.shaft[1]; x++) w.set(x, SKY + d, T.RIME);
  }
  ev.push({ t: 'hearth-broken' });
}

/**
 * The Hearth is broken and the rig is out. The run ends in a prestige restart: a star, and a
 * new rig on the pad with nothing in the bank. Stats, the price list and the logs are kept.
 * Returns the time the Hearth took, in seconds.
 */
export function winHearth(run: HearthRun, p: Player, main: World): number {
  const time = Math.round(run.t * 10) / 10;
  p.prestige++;
  p.stats.hearths++;
  if (!p.stats.hearthBest || time < p.stats.hearthBest) p.stats.hearthBest = time;
  p.cash = 0;
  p.upgrades = newUpgrades();
  p.items = newItems();
  p.items.fuelcell = 1;
  p.cargo = {};
  const r = p.rig;
  const s = statsOf(p);
  r.fuel = s.tank;
  r.hull = s.maxHull;
  r.cold = r.hot = r.scald = false;
  r.stalled = false;
  const sp = main.spawn();
  placeRig(r, sp.x, sp.y);
  return time;
}
