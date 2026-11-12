// A running game as the scene and UI see it. LocalSession runs the rules on this device;
// NetSession (src/net/netSession.ts) predicts locally and follows the server.

import { applyAction, type Action, type ActResult } from '../sim/actions';
import { Environment } from '../sim/env';
import { atExit, atGate, enterHearth, hearthStep, leaveHearth, viewOf, winHearth, type HearthRun, type HearthView } from '../sim/hearth';
import type { ItemKey } from '../sim/items';
import { newPlayer, type HurtCause, type Player } from '../sim/player';
import { STEP, noInput, step, type Input, type SimEvent } from '../sim/rig';
import { World } from '../sim/world';
import type { Recap, SeasonRecord, Standings } from '../net/protocol';

export const SOLO_WIDTH = 80;

export type SessionEvent =
  | SimEvent
  | { t: 'peer-dug'; x: number; y: number; tile: number }
  | { t: 'peer-blast'; x: number; y: number; r: number }
  | { t: 'chat'; id: string; name: string; text: string; mine: boolean }
  /** Another miner's rig was lost at (x, y), in tiles. */
  | { t: 'peer-wrecked'; id: string; name: string; x: number; y: number; cause: HurtCause }
  | { t: 'peer-join'; name: string }
  | { t: 'peer-leave'; name: string }
  | { t: 'refused'; act: Action; res: ActResult }
  /** A miner (maybe you) is stalled and asking for fuel. `depth` is in tiles. */
  | { t: 'peer-sos'; id: string; name: string; depth: number; mine: boolean }
  /** Someone refuelled a stalled miner. `role` says whether that was you. */
  | { t: 'rescue'; byName: string; toName: string; fee: number; role: 'helper' | 'helped' | 'none' }
  /** A miner (maybe you) dug up something everyone hears about. `mineral` is its key, `depth` in tiles. */
  | { t: 'find'; name: string; mineral: string; first: boolean; depth: number; mine: boolean }
  /** Your rig went through the Hearth's gate: `session.world` is the arena now. */
  | { t: 'hearth-enter' }
  /** Your rig is back in the dig site (it left, was lost, or was recalled). */
  | { t: 'hearth-leave' }
  /** Somebody (maybe you) broke the Hearth and reached the surface. `time` is in seconds. */
  | { t: 'hearth-won'; name: string; time: number; stars: number; mine: boolean }
  /** Somebody sold ore and prices moved. */
  | { t: 'market' }
  /** The leaderboards arrived (see `boards()`). */
  | { t: 'boards' }
  | { t: 'disconnected'; reason: string };

/** The leaderboards as last sent by the server. */
export interface BoardsInfo {
  now: Standings;
  /** When the season ends, in ms on the world's clock (world.time * 1000). */
  ends: number;
  last: SeasonRecord | null;
}

export type Listener = (e: SessionEvent) => void;

export interface Peer {
  id: string;
  name: string;
  paint: number;
  /** Prestige stars. */
  stars: number;
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
  /** The world the rig is in right now: the dig site, or the Hearth arena. It changes on 'hearth-enter' and 'hearth-leave'. */
  readonly world: World;
  /** The fight, while the rig is in the Hearth arena. Null in the dig site. */
  hearth(): HearthView | null;
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
  /** Ask everyone for fuel again (online, while stalled). The server sends the first SOS by itself. */
  sos(): void;
  /** True while an SOS is out for this rig. */
  readonly sosSent: boolean;
  /** Hand a Fuel Cell to the stalled miner `id` (online). */
  aid(id: string): void;
  /** Online: this season's number and when it ends, in ms on the world's clock. Null offline. */
  season(): { n: number; ends: number } | null;
  /** The leaderboards as last received, or null. Call askBoards() to fetch them; a 'boards' event follows. */
  boards(): BoardsInfo | null;
  askBoards(): void;
  /** How last season ended, for a miner who played it and is joining the new one for the first time. */
  readonly recap: Recap | null;
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
  /** The Hearth fight, while the rig is in the arena. */
  private run: HearthRun | null = null;

  constructor(
    /** The dig site. `world` is this, or the Hearth arena while the rig is in it. */
    readonly main: World,
    readonly player: Player,
  ) {
    this.env = new Environment(main);
    main.time = Date.now() / 1000;
  }

  get world(): World {
    return this.run?.world ?? this.main;
  }

  hearth(): HearthView | null {
    return this.run ? viewOf(this.run) : null;
  }

  /** Where the rig is in the dig site: where it stands, or where it went through the gate. */
  sitePos(): { x: number; y: number } | null {
    return this.run ? this.run.back : null;
  }

  private endRun(): void {
    this.run?.env.detach();
    this.run = null;
  }

  static fresh(seed = (Math.random() * 2 ** 31) | 0): LocalSession {
    const world = new World(seed, SOLO_WIDTH);
    // A new game starts at sunrise on day 1.
    world.dayStart = Date.now() / 1000;
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
    this.main.time = Date.now() / 1000;
    this.acc = Math.min(this.acc + dt, 0.25);
    const ev: SessionEvent[] = [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      const run = this.run;
      if (run) {
        // In the Hearth: the arena's own clock and ice, and the dig site stands still.
        run.world.time = this.main.time;
        step(this.player, run.world, this.input, STEP, ev as SimEvent[]);
        if (hearthStep(run, this.player, STEP, ev as SimEvent[])) {
          const time = winHearth(run, this.player, this.main);
          this.endRun();
          ev.push({ t: 'hearth-won', name: this.player.name, time, stars: this.player.prestige, mine: true });
        }
        continue;
      }
      step(this.player, this.main, this.input, STEP, ev as SimEvent[]);
      const out = this.env.step([this.player], STEP);
      ev.push(...out.fx);
      for (const [, e] of out.personal) ev.push(e);
    }
    this.emit(ev);
  }

  act(a: Action): ActResult {
    const ev: SessionEvent[] = [];
    const p = this.player;
    if (a.a === 'enter') {
      if (this.run || !atGate(this.main, p)) return { ok: false, why: 'where' };
      this.run = enterHearth(p, this.main);
      this.emit([{ t: 'hearth-enter' }]);
      return { ok: true };
    }
    if (a.a === 'leave') {
      if (!this.run || !atExit(this.run, p)) return { ok: false, why: 'where' };
      leaveHearth(this.run.back, p);
      this.endRun();
      this.emit([{ t: 'hearth-leave' }]);
      return { ok: true };
    }
    if (this.run && (a.a === 'respawn' || (a.a === 'use' && a.k === 'beacon'))) {
      // A new rig, or a recall, comes out in the dig site. There's no recalling out of the collapse.
      if (a.a === 'use' && (this.run.phase !== 'fight' || (p.items.beacon ?? 0) <= 0 || p.rig.wrecked)) return { ok: false, why: 'state' };
      if (a.a === 'use') leaveHearth(this.run.back, p);
      this.endRun();
      ev.push({ t: 'hearth-leave' });
    }
    const res = applyAction(p, this.world, a, ev as SimEvent[]);
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
  readonly recap = null;
  season(): null {
    return null;
  }
  boards(): null {
    return null;
  }
  askBoards(): void {}

  close(): void {
    this.env.detach();
  }
}

export function useItem(s: GameSession, k: ItemKey): ActResult {
  return s.act({ a: 'use', k });
}
