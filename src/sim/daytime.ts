// The day and night cycle. Like the weather, it runs off the world's wall clock (world.time), so
// every screen agrees without sending anything. Days are counted from world.dayStart.
// It only changes how the surface looks: the rules are the same by day and by night.

import type { World } from './world';

/** Seconds of daylight and of night. Dawn and dusk sit across the two changeovers. */
export const DAY_SECONDS = 40 * 60;
export const NIGHT_SECONDS = 20 * 60;
/** Seconds in a full day and night. */
export const DAY_LENGTH = DAY_SECONDS + NIGHT_SECONDS;
/** Seconds dawn and dusk each take. */
export const TWILIGHT_SECONDS = 3 * 60;
/** The phase at sunset. */
export const SUNSET = DAY_SECONDS / DAY_LENGTH;

/** Which day it is, starting at 1. */
export function dayNumber(world: World): number {
  return Math.max(1, Math.floor((world.time - world.dayStart) / DAY_LENGTH) + 1);
}

/** How far through the day it is, from 0 to 1. A day starts at sunrise; the sun sets at SUNSET (two thirds). */
export function dayPhase(world: World): number {
  const t = (world.time - world.dayStart) / DAY_LENGTH;
  return t <= 0 ? 0 : t - Math.floor(t);
}

/** How light it is at a phase: 1 in full day, 0 at night, in between at dawn and dusk. */
export function daylight(phase: number): number {
  // How far inside the day (positive) or the night (negative) this is, as a share of the cycle.
  const inside = phase < SUNSET ? Math.min(phase, SUNSET - phase) : -Math.min(phase - SUNSET, 1 - phase);
  return Math.max(0, Math.min(1, 0.5 + inside / (TWILIGHT_SECONDS / DAY_LENGTH)));
}

export type DayPart = 'Dawn' | 'Day' | 'Dusk' | 'Night';

export function dayPart(phase: number): DayPart {
  const l = daylight(phase);
  if (l >= 1) return 'Day';
  if (l <= 0) return 'Night';
  return phase < SUNSET / 2 || phase > (1 + SUNSET) / 2 ? 'Dawn' : 'Dusk';
}
