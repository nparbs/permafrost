// A running game as the scene and UI see it. LocalSession runs the rules on this device;
// NetSession (src/net/netSession.ts) predicts locally and follows the server.

import { applyAction, type Action, type ActResult } from '../sim/actions';
import type { ItemKey } from '../sim/items';
import { newPlayer, type Player } from '../sim/player';
import { STEP, noInput, step, type Input, type SimEvent } from '../sim/rig';
import { World } from '../sim/world';

export const SOLO_WIDTH = 80;

export type SessionEvent =
  | SimEvent
  | { t: 'peer-dug'; x: number; y: number; tile: number }
  | { t: 'peer-blast'; x: number; y: number; r: number }
  | { t: 'chat'; id: string; name: string; text: string; mine: boolean }
  | { t: 'peer-join'; name: string }
  | { t: 'peer-leave'; name: string }
  | { t: 'refused'; act: Action; res: ActResult }
  | { t: 'disconnected'; reason: string };

export type Listener = (e: SessionEvent) => void;

export interface Peer {
  id: string;
  name: string;
  paint: number;
  x: number;
  y: number;
  facing: number;
  mode: number;
  flags: number;
  visible: boolean;
}

export interface GameSession {
  readonly online: boolean;
  readonly world: World;
  readonly player: Player;
  readonly input: Input;
  /** Offline: stops the clock. Online: the world keeps going, but your input is ignored. */
  paused: boolean;
  paint: number;
  update(dt: number): void;
  on(fn: Listener): void;
  act(a: Action): ActResult;
  releaseInput(): void;
  /** Where to draw your own rig (online this smooths out corrections). */
  renderPos(): { x: number; y: number };
  peers(): Iterable<Peer>;
  onlineCount(): number;
  myId(): string;
  chat(text: string): void;
  close(): void;
}

export class LocalSession implements GameSession {
  readonly online = false;
  readonly input: Input = noInput();
  paused = true;
  paint = 0;
  private acc = 0;
  private listeners: Listener[] = [];

  constructor(
    readonly world: World,
    readonly player: Player,
  ) {}

  static fresh(seed = (Math.random() * 2 ** 31) | 0): LocalSession {
    const world = new World(seed, SOLO_WIDTH);
    return new LocalSession(world, newPlayer(world));
  }

  on(fn: Listener): void {
    this.listeners.push(fn);
  }

  private emit(ev: SessionEvent[]): void {
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

  act(a: Action): ActResult {
    const ev: SimEvent[] = [];
    const res = applyAction(this.player, this.world, a, ev);
    this.emit(ev);
    return res;
  }

  releaseInput(): void {
    Object.assign(this.input, noInput());
  }

  renderPos() {
    return { x: this.player.rig.x, y: this.player.rig.y };
  }

  peers(): Iterable<Peer> {
    return [];
  }

  onlineCount(): number {
    return 0;
  }

  myId(): string {
    return 'me';
  }

  chat(): void {}

  close(): void {}
}

export function useItem(s: GameSession, k: ItemKey): ActResult {
  return s.act({ a: 'use', k });
}
