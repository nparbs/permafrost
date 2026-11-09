// One player's game: the world, the player, input and a fixed-step clock. Online play will
// swap this for a session that sends input to the server and applies what comes back.

import type { ItemKey } from '../sim/items';
import { newPlayer, type Player } from '../sim/player';
import { STEP, noInput, step, useItem, type Input, type SimEvent } from '../sim/rig';
import { World } from '../sim/world';

export const SOLO_WIDTH = 80;

export type Listener = (e: SimEvent) => void;

export class Session {
  readonly input: Input = noInput();
  paused = true;
  private acc = 0;
  private listeners: Listener[] = [];

  constructor(
    readonly world: World,
    readonly player: Player,
  ) {}

  static fresh(seed = (Math.random() * 2 ** 31) | 0): Session {
    const world = new World(seed, SOLO_WIDTH);
    return new Session(world, newPlayer(world));
  }

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(ev: SimEvent[]): void {
    for (const e of ev) for (const l of this.listeners) l(e);
  }

  update(dt: number): void {
    if (this.paused) return;
    this.acc = Math.min(this.acc + dt, 0.25);
    const ev: SimEvent[] = [];
    while (this.acc >= STEP) {
      step(this.player, this.world, this.input, STEP, ev);
      this.acc -= STEP;
    }
    this.emit(ev);
  }

  use(item: ItemKey): boolean {
    const ev: SimEvent[] = [];
    const ok = useItem(this.player, this.world, item, ev);
    this.emit(ev);
    return ok;
  }

  releaseInput(): void {
    Object.assign(this.input, noInput());
  }
}
