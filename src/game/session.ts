// A running game as the scene and UI see it. LocalSession runs the rules on this device;
// NetSession (src/net/netSession.ts) predicts locally and follows the server.

import { applyAction, type Action, type ActResult } from '../sim/actions';
import { Environment } from '../sim/env';
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
  /** A miner (maybe you) is stalled and asking for fuel. `depth` is in tiles. */
  | { t: 'peer-sos'; id: string; name: string; depth: number; mine: boolean }
  /** Someone refuelled a stalled miner. `role` says whether that was you. */
  | { t: 'rescue'; byName: string; toName: string; fee: number; role: 'helper' | 'helped' | 'none' }
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

/** Another miner as the map shows them, wherever they are. */
export interface MapPeer {
  id: string;
  name: string;
  paint: number;
  x: number;
  y: number;
  /** RIG_* flags from src/net/protocol.ts. */
  flags: number;
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
  /** Every other miner in the world, for the map. Empty offline. */
  mapPeers(): MapPeer[];
  /** Ask everyone for fuel (online, while stalled). */
  sos(): void;
  /** True once an SOS went out for the current stall. */
  readonly sosSent: boolean;
  /** Hand a Fuel Cell to the stalled miner `id` (online). */
  aid(id: string): void;
  close(): void;
}

export class LocalSession implements GameSession {
  readonly online = false;
  readonly input: Input = noInput();
  paused = true;
  paint = 0;
  private acc = 0;
  private listeners: Listener[] = [];
  private env: Environment;

  constructor(
    readonly world: World,
    readonly player: Player,
  ) {
    this.env = new Environment(world);
    world.time = Date.now() / 1000;
  }

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
    this.world.time = Date.now() / 1000;
    this.acc = Math.min(this.acc + dt, 0.25);
    const ev: SimEvent[] = [];
    while (this.acc >= STEP) {
      step(this.player, this.world, this.input, STEP, ev);
      const out = this.env.step([this.player], STEP);
      ev.push(...out.fx);
      for (const [, e] of out.personal) ev.push(e);
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

  mapPeers(): MapPeer[] {
    return [];
  }

  readonly sosSent = false;
  sos(): void {}
  aid(): void {}

  close(): void {
    this.env.detach();
  }
}

export function useItem(s: GameSession, k: ItemKey): ActResult {
  return s.act({ a: 'use', k });
}
