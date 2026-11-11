// Draws the session: tilemap, station, rig, particles and the polar sky.

import Phaser from 'phaser';
import { RIG_H, RIG_W, statsOf, type HurtCause } from '../sim/player';
import { RIG_SOS, RIG_STALLED, RIG_THRUST, RIG_WRECKED, RigMode } from '../net/protocol';
import { FLARE } from '../sim/items';
import { rigDepth } from '../sim/rig';
import { MINERALS, T, isDiggable, isSolid } from '../sim/tiles';
import { blizzardAt, ventActive, windDir } from '../sim/weather';
import { SKY } from '../sim/world';
import type { GameSession, SessionEvent } from './session';
import { LAYER_PAL, PAINTS, TS, debrisColor, frameFor, makeTextures, overIndex, rgbNum, tileFrame, visIndex } from './textures';

/** Moments in a cutscene that want a sound. */
export type Cue = 'sputter' | 'freeze' | 'crash' | 'boom' | 'hiss' | 'rotor' | 'land';

export interface SceneData {
  session: GameSession;
  onFrame?: (scene: GameScene) => void;
  onCue?: (cue: Cue) => void;
}

/** A cutscene in progress. While one runs, it moves the rig sprite and the simulation doesn't. */
interface Cine {
  kind: 'death' | 'arrive';
  cause: HurtCause;
  /** Death: 'drop' (the wreck falls), 'main' (the scene for its cause), 'fade'. Arrival: 'main'. */
  phase: 'drop' | 'main' | 'fade';
  /** Seconds into the current phase. */
  t: number;
  x: number;
  y: number;
  vy: number;
  /** Where the sprite comes to rest, in pixels. */
  rest: number;
  /** Countdown to the next puff or spark. */
  tick: number;
  /** One-off moments already played. */
  marks: Set<string>;
  done: () => void;
}

interface PeerSprite {
  rig: Phaser.GameObjects.Sprite;
  flame: Phaser.GameObjects.Image;
  chute: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  paint: number;
  /** How this miner's rig was lost and when (scene clock), while the wreck is still lying there. */
  dead: { cause: HurtCause; at: number } | null;
}

const lerpColor = (a: number, b: number, k: number): number => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** Radius of the hole a drilling rig carves, in pixels. */
const BITE_R = 8.5;

/** How dark it is outside your lights at a depth in tiles: 0 at the surface, pitch black by the bedrock. */
export function darkness(d: number): number {
  if (d < 2) return 0;
  if (d < 32) return (0.85 * (d - 2)) / 30;
  return Math.min(1, 0.85 + (0.15 * (d - 32)) / 190);
}

interface FallingTile {
  x: number;
  y: number;
  vy: number;
  img: Phaser.GameObjects.Image;
  falling: boolean;
  born: number;
}

interface Flare {
  x: number;
  y: number;
  vx: number;
  vy: number;
  until: number;
  img: Phaser.GameObjects.Image;
}

export class GameScene extends Phaser.Scene {
  session!: GameSession;
  private hooks!: SceneData;
  private layer!: Phaser.Tilemaps.TilemapLayer;
  /** Rounded tunnel edges, on a grid offset by half a tile (see overIndex). */
  private over!: Phaser.Tilemaps.TilemapLayer;
  private rig!: Phaser.GameObjects.Sprite;
  private flame!: Phaser.GameObjects.Image;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snowZone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private stars!: Phaser.GameObjects.TileSprite;
  private aurora!: Phaser.GameObjects.TileSprite;
  private mountains!: Phaser.GameObjects.TileSprite;
  private bites!: Phaser.GameObjects.Graphics;
  private steam!: Phaser.GameObjects.Particles.ParticleEmitter;
  private storm!: Phaser.GameObjects.Particles.ParticleEmitter;
  private fog!: Phaser.GameObjects.Rectangle;
  /** Darkness, with lights erased out of it. Covers the camera view, in world pixels. */
  private dark?: Phaser.GameObjects.RenderTexture;
  private loose = new Map<string, FallingTile>();
  private flares: Flare[] = [];
  private steamTimer = 0;
  private dustTimer = 0;
  private flash = 0;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private chute!: Phaser.GameObjects.Image;
  private lifter!: Phaser.GameObjects.Image;
  private cable!: Phaser.GameObjects.Graphics;
  private cine: Cine | null = null;
  /** How much of the headlamp is left: a dying rig's lamp flickers out. */
  private lampK = 1;
  private floatAt = 0;
  private floatN = 0;
  private peerSprites = new Map<string, PeerSprite>();
  private bubbles = new Map<string, { text: Phaser.GameObjects.Text; until: number }>();

  constructor() {
    super('Game');
  }

  create(data: SceneData): void {
    this.hooks = data;
    this.session = data.session;
    // The scene is restarted, not rebuilt, when the session changes: drop anything left from before.
    this.dark = undefined;
    this.loose = new Map();
    this.flares = [];
    this.peerSprites = new Map();
    this.bubbles = new Map();
    this.cine = null;
    this.lampK = 1;
    makeTextures(this);
    const world = this.session.world;
    const W = world.w * TS;
    const H = world.h * TS;

    this.add.image(0, 0, 'sky').setOrigin(0).setDisplaySize(W, SKY * TS).setDepth(-10);
    this.stars = this.add.tileSprite(0, 0, W, SKY * TS * 0.7, 'stars').setOrigin(0).setDepth(-9);
    this.aurora = this.add.tileSprite(0, 6, W, 64, 'aurora').setOrigin(0).setDepth(-8).setBlendMode(Phaser.BlendModes.ADD);
    this.mountains = this.add.tileSprite(0, SKY * TS - 80, W, 80, 'mountains').setOrigin(0).setDepth(-7);

    const grid: number[][] = [];
    for (let y = 0; y < world.h; y++) {
      const row: number[] = new Array(world.w);
      for (let x = 0; x < world.w; x++) row[x] = visIndex(world, x, y);
      grid.push(row);
    }
    const map = this.make.tilemap({ data: grid, tileWidth: TS, tileHeight: TS });
    const tiles = map.addTilesetImage('tiles', 'tiles', TS, TS, 0, 0)!;
    this.layer = map.createLayer(0, tiles, 0, 0)!;
    this.layer.setDepth(0);

    const ogrid: number[][] = [];
    for (let j = 0; j <= world.h; j++) {
      const row: number[] = new Array(world.w + 1);
      for (let i = 0; i <= world.w; i++) row[i] = overIndex(world, i, j);
      ogrid.push(row);
    }
    // insertNull keeps the mostly empty overlay cheap.
    const omap = this.make.tilemap({ data: ogrid, tileWidth: TS, tileHeight: TS, insertNull: true });
    const otiles = omap.addTilesetImage('tiles', 'tiles', TS, TS, 0, 0)!;
    this.over = omap.createLayer(0, otiles, -TS / 2, -TS / 2)!;
    this.over.setDepth(0.2);
    world.dirty.length = 0;

    this.bites = this.add.graphics().setDepth(0.5);

    for (const b of world.station) this.add.image(b.x * TS, SKY * TS, `b-${b.key}`).setOrigin(0, 1).setDepth(1);

    this.rig = this.add.sprite(0, 0, `rig${this.session.paint}`, 'idle0').setDepth(5);
    this.flame = this.add.image(0, 0, 'flame', 'f0').setDepth(4).setVisible(false);

    this.dust = this.add.particles(0, 0, 'px', {
      emitting: false,
      lifespan: { min: 250, max: 600 },
      speed: { min: 20, max: 75 },
      angle: { min: 0, max: 360 },
      gravityY: 180,
      scale: { start: 1, end: 0.5 },
      alpha: { start: 1, end: 0 },
    }).setDepth(6);
    this.sparks = this.add.particles(0, 0, 'px', {
      emitting: false,
      lifespan: 650,
      speed: { min: 25, max: 90 },
      angle: { min: 200, max: 340 },
      gravityY: 140,
      scale: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(7);
    this.snow = this.add.particles(0, 0, 'px1', {
      frequency: 35,
      lifespan: 7000,
      speedY: { min: 10, max: 24 },
      speedX: { min: -10, max: 3 },
      alpha: { min: 0.35, max: 0.9 },
      emitZone: { type: 'random', source: this.snowZone, quantity: 1 } as Phaser.Types.GameObjects.Particles.EmitZoneData,
      deathZone: { type: 'onLeave', source: new Phaser.Geom.Rectangle(0, 0, W, SKY * TS) },
    }).setDepth(3);

    this.storm = this.add.particles(0, 0, 'px1', {
      emitting: false,
      frequency: 6,
      lifespan: 2600,
      speedY: { min: 30, max: 60 },
      speedX: { min: 90, max: 160 },
      alpha: { min: 0.5, max: 1 },
      emitZone: { type: 'random', source: this.snowZone, quantity: 1 } as Phaser.Types.GameObjects.Particles.EmitZoneData,
      deathZone: { type: 'onLeave', source: new Phaser.Geom.Rectangle(0, 0, W, SKY * TS) },
    }).setDepth(3);
    this.steam = this.add.particles(0, 0, 'puff', {
      emitting: false,
      lifespan: { min: 500, max: 900 },
      speedY: { min: -75, max: -45 },
      speedX: { min: -8, max: 8 },
      scale: { start: 0.9, end: 2.4 },
      alpha: { start: 0.6, end: 0 },
    }).setDepth(6.5);
    this.smoke = this.add.particles(0, 0, 'puff', {
      emitting: false,
      lifespan: { min: 700, max: 1300 },
      speedY: { min: -34, max: -14 },
      speedX: { min: -10, max: 10 },
      scale: { start: 0.8, end: 2.6 },
      alpha: { start: 0.75, end: 0 },
      tint: 0x343840,
    }).setDepth(6.4);
    this.chute = this.add.image(0, 0, 'chute').setOrigin(0.5, 1).setDepth(5.1).setVisible(false);
    this.lifter = this.add.image(0, 0, 'lifter', 'l0').setOrigin(0.5, 0).setDepth(5.2).setVisible(false);
    this.cable = this.add.graphics().setDepth(5.05);
    this.fog = this.add.rectangle(0, 0, 8, 8, 0xdde8f4, 0).setOrigin(0).setScrollFactor(0).setDepth(7.7);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    cam.setBackgroundColor('#04060f');
    cam.setRoundPixels(true);
    cam.resetFX();
    this.applyZoom();
    this.syncRig(0);
    cam.startFollow(this.rig, true, 0.2, 0.2);
    cam.centerOn(this.rig.x, this.rig.y);
    this.scale.on('resize', this.applyZoom, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.applyZoom, this));
    this.session.on((e) => this.onEvent(e));
  }

  private applyZoom(): void {
    const m = Math.min(this.scale.width, this.scale.height);
    const cam = this.cameras.main;
    cam.setZoom(Math.max(1, Math.round(m / 220)));
    // A resized RenderTexture stops filling properly (Phaser 3.90), so make a new one instead.
    const w = Math.ceil(cam.width / cam.zoom) + 4;
    const h = Math.ceil(cam.height / cam.zoom) + 4;
    if (!this.dark || this.dark.width !== w || this.dark.height !== h) {
      this.dark?.destroy();
      this.dark = this.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(7.8);
    }
    this.fog.setSize(cam.width, cam.height);
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.session.update(dt);
    this.refreshTiles();
    this.syncRig(dt);
    this.syncPeers();
    this.syncBites();
    this.syncLoose(dt);
    this.syncFlares(dt);
    this.syncSteam(dt);
    this.syncBubbles();
    this.syncSky();
    this.syncLight();
    this.hooks.onFrame?.(this);
  }

  /** The rig's position on screen in CSS pixels, and the zoom. */
  rigScreen(): { x: number; y: number; zoom: number } {
    const cam = this.cameras.main;
    return { x: (this.rig.x - cam.worldView.x) * cam.zoom, y: (this.rig.y - cam.worldView.y) * cam.zoom, zoom: cam.zoom };
  }

  private refreshTiles(): void {
    const w = this.session.world;
    if (!w.dirty.length) return;
    const done = new Set<number>();
    for (const i of w.dirty) {
      const x = i % w.w;
      const y = Math.floor(i / w.w);
      // A tile's look depends on its four neighbours (rounded edges, tunnel shadows), so refresh them too.
      for (const [xx, yy] of [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (!w.inBounds(xx, yy)) continue;
        const k = yy * w.w + xx;
        if (done.has(k)) continue;
        done.add(k);
        const v = visIndex(w, xx, yy);
        if (v < 0) this.layer.removeTileAt(xx, yy);
        else this.layer.putTileAt(v, xx, yy);
      }
      // The four overlay corners around the tile.
      for (const [i, j] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
        const k = -1 - (j * (w.w + 1) + i);
        if (done.has(k)) continue;
        done.add(k);
        const v = overIndex(w, i, j);
        if (v < 0) this.over.removeTileAt(i, j);
        else this.over.putTileAt(v, i, j);
      }
    }
    w.dirty.length = 0;
  }

  private syncRig(dt: number): void {
    if (this.cine) {
      this.stepCine(this.cine, dt);
      return;
    }
    const r = this.session.player.rig;
    const pos = this.session.renderPos();
    const px = pos.x * TS;
    const py = pos.y * TS;
    const anim = Math.floor(this.time.now / 70) % 2;
    let frame = 'idle0';
    if (r.drill) frame = `${r.drill.dir === 'down' ? 'down' : 'side'}${anim}`;
    else if (r.grounded && Math.abs(r.vx) > 0.3) frame = `idle${anim}`;
    this.rig.setFrame(frame);
    this.rig.setFlipX(r.facing < 0);
    this.rig.setPosition(px + (r.drill && anim ? 1 : 0), py);

    this.flame.setVisible(r.thrusting);
    if (r.thrusting) this.flame.setPosition(px, py + (RIG_H / 2) * TS + 4).setFrame(`f${anim}`);
    // Out of fuel in the air: the parachute is out.
    const chute = r.stalled && !r.grounded && !r.wrecked;
    this.chute.setVisible(chute);
    if (chute) this.chute.setPosition(px + Math.round(Math.sin(this.time.now / 400)), py - 7);

    if (r.wrecked) this.rig.setTint(0x3a3a3a);
    else if (this.flash > 0) {
      this.flash -= dt;
      this.rig.setTint(0xff7070);
    } else this.rig.clearTint();

    if (r.drill) {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.045;
        const d = r.drill;
        const tile = this.session.world.get(d.tx, d.ty);
        const fx = d.dir === 'down' ? px : px + (d.dir === 'right' ? 9 : -9);
        const fy = d.dir === 'down' ? py + 9 : py + 1;
        this.dust.setParticleTint(debrisColor(this.session.world, d.tx, d.ty, tile));
        this.dust.emitParticleAt(fx, fy, 2);
      }
    }
  }

  /** While a rig drills, carve a round hole around it in the tile it's eating into. */
  private syncBites(): void {
    const g = this.bites;
    g.clear();
    const r = this.session.player.rig;
    if (r.drill) {
      const pos = this.session.renderPos();
      this.bite(r.drill.tx, r.drill.ty, pos.x * TS, pos.y * TS);
    }
    for (const p of this.session.peers()) {
      if (p.mode < RigMode.DrillSide || !p.visible) continue;
      const tx = p.mode === RigMode.DrillDown ? Math.floor(p.x) : Math.floor(p.x + p.facing * 0.45);
      const ty = p.mode === RigMode.DrillDown ? Math.floor(p.y + RIG_H / 2 + 0.05) : Math.floor(p.y);
      this.bite(tx, ty, p.x * TS, p.y * TS);
    }
  }

  private bite(tx: number, ty: number, cx: number, cy: number): void {
    const world = this.session.world;
    if (!isDiggable(world.get(tx, ty))) return;
    const pal = LAYER_PAL[world.layerAt(tx, ty)];
    const back = rgbNum(pal.back.map((v) => v * 0.82) as [number, number, number]);
    const rim = rgbNum(pal.dark.map((v) => v * 0.55) as [number, number, number]);
    const g = this.bites;
    const x0 = tx * TS;
    const x1 = x0 + TS;
    for (let j = 0; j < TS; j++) {
      const y = ty * TS + j;
      const dy = y + 0.5 - cy;
      for (const [rad, col] of [[BITE_R + 1.5, rim], [BITE_R, back]]) {
        if (Math.abs(dy) >= rad) continue;
        const hw = Math.sqrt(rad * rad - dy * dy);
        const a = Math.max(x0, Math.round(cx - hw));
        const b = Math.min(x1, Math.round(cx + hw));
        if (b > a) g.fillStyle(col).fillRect(a, y, b - a, 1);
      }
    }
  }

  private syncSky(): void {
    const cam = this.cameras.main;
    const sx = cam.scrollX;
    this.stars.tilePositionX = -0.92 * sx;
    this.aurora.tilePositionX = -0.85 * sx + this.time.now * 0.004;
    this.aurora.setAlpha(0.55 + Math.sin(this.time.now / 2300) * 0.2);
    this.mountains.tilePositionX = -0.6 * sx;
    const view = cam.worldView;
    const skyVisible = view.y < SKY * TS;
    this.snow.emitting = skyVisible;
    if (skyVisible) this.snowZone.setTo(view.x - 160, Math.max(0, view.y - 10), view.width + 320, Math.max(1, SKY * TS - view.y));
    const w = this.session.world;
    const b = blizzardAt(w.seed, w.time);
    this.storm.emitting = skyVisible && b > 0.05;
    if (this.storm.emitting) {
      const dir = windDir(w.seed, w.time);
      this.storm.frequency = Math.max(2, 14 - b * 12);
      this.storm.speedX = { min: dir * 90 * b, max: dir * 170 * b };
    }
    // Whiteout near the surface, fading out below it.
    const depth = view.centerY / TS - SKY;
    const near = Math.max(0, Math.min(1, 1 - depth / 10));
    this.fog.setFillStyle(0xdde8f4, b * near * 0.42);
  }

  /** Paint the dark, then erase pools of light: your headlamp, other rigs, flares, magma and vents. */
  private syncLight(): void {
    const r = this.session.player.rig;
    const a = darkness(rigDepth(r));
    if (a <= 0.01 || !this.dark) {
      this.dark?.setVisible(false);
      return;
    }
    const view = this.cameras.main.worldView;
    const rt = this.dark!;
    rt.setVisible(true).setPosition(Math.floor(view.x) - 2, Math.floor(view.y) - 2);
    rt.clear();
    rt.fill(0x02040a, a);
    const pad = 8 * TS;
    const light = (x: number, y: number, radius: number, alpha: number) => {
      if (x < view.x - pad || x > view.right + pad || y < view.y - pad || y > view.bottom + pad) return;
      rt.stamp('light', undefined, x - rt.x, y - rt.y, { scale: (radius * 2) / 128, alpha, erase: true });
    };
    const lamp = statsOf(this.session.player).lamp;
    if (this.lampK > 0.02) light(this.rig.x, this.rig.y, lamp * TS * 1.3 * this.lampK, 1);
    light(this.rig.x, this.rig.y, 1.4 * TS, Math.max(0.5, this.lampK));
    for (const s of this.peerSprites.values()) if (s.rig.visible) light(s.rig.x, s.rig.y, 5 * TS * 1.3, 0.9);
    const t = this.time.now;
    for (const f of this.flares) {
      const fade = Math.min(1, (f.until - t) / 6000);
      light(f.x, f.y, FLARE.radius * TS * 1.3 * (0.94 + Math.sin(t / 60 + f.x) * 0.04) * (0.6 + fade * 0.4), 0.85 + fade * 0.15);
    }
    // Magma and vents glow.
    const w = this.session.world;
    const x0 = Math.max(0, Math.floor(view.x / TS) - 2);
    const x1 = Math.min(w.w - 1, Math.ceil(view.right / TS) + 2);
    const y0 = Math.max(SKY, Math.floor(view.y / TS) - 2);
    const y1 = Math.min(w.h - 1, Math.ceil(view.bottom / TS) + 2);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = w.tiles[y * w.w + x];
        if (tile === T.MAGMA) light((x + 0.5) * TS, (y + 0.5) * TS, 2.1 * TS, 0.5);
        // Meltwater pockets catch a little light, so you can spot fuel in the dark glacier.
        else if (tile === T.MELT) light((x + 0.5) * TS, (y + 0.5) * TS, 1.15 * TS, 0.4);
        else if (tile === T.VENT) light((x + 0.5) * TS, y * TS, (ventActive(w, x, y) ? 2.6 : 1.4) * TS, 0.5);
      }
    }
  }

  // ------------------------------------------------------------ the living ice

  private looseAt(x: number, y: number, tile: number): FallingTile {
    const key = `${x},${y}`;
    let f = this.loose.get(key);
    if (!f) {
      // While it shakes it covers its own tile, so it shows the whole tile.
      const img = this.add.image(x * TS, y * TS, 'tiles', tileFrame(this, frameFor(this.session.world, x, y, tile))).setOrigin(0).setDepth(4.2);
      f = { x, y: y * TS, vy: 0, img, falling: false, born: this.time.now };
      this.loose.set(key, f);
    }
    return f;
  }

  private syncLoose(dt: number): void {
    const w = this.session.world;
    for (const [key, f] of this.loose) {
      if (!f.falling) {
        f.img.setX(f.x * TS + Math.round(Math.sin(this.time.now / 25)));
        if (this.time.now - f.born > 2500) {
          f.img.destroy();
          this.loose.delete(key);
        }
        continue;
      }
      f.vy = Math.min(16 * TS, f.vy + 18 * TS * dt);
      f.y += f.vy * dt;
      f.img.setPosition(f.x * TS, Math.round(f.y));
      const row = Math.floor(f.y / TS);
      const landed = (w.get(f.x, row) !== T.AIR && f.y >= row * TS - 3) || isSolid(w.get(f.x, row + 1));
      if (landed || this.time.now - f.born > 6000) {
        f.img.destroy();
        this.loose.delete(key);
      }
    }
  }

  private dropLoose(x: number, y: number, tile: number): void {
    const f = this.looseAt(x, y, tile);
    this.loose.delete(`${x},${y}`);
    f.falling = true;
    f.born = this.time.now;
    f.img.setX(x * TS);
    // Once it drops, a boulder leaves its bit of ground behind.
    if (tile === T.BOULDER) f.img.setTexture('boulders', `b${this.session.world.layerAt(x, y)}`);
    this.loose.set(`fall:${x},${y},${f.born}`, f);
  }

  private crash(x: number, y: number, tile: number): void {
    for (const [key, f] of this.loose) {
      if (f.falling && f.x === x) {
        f.img.destroy();
        this.loose.delete(key);
      }
    }
    const cx = (x + 0.5) * TS;
    const cy = (y + 0.5) * TS;
    this.dust.setParticleTint(debrisColor(this.session.world, x, y, tile));
    this.dust.emitParticleAt(cx, cy, 16);
    this.shakeNear(x, y, 180, 0.008);
  }

  private shakeNear(x: number, y: number, ms: number, k: number): void {
    const r = this.session.player.rig;
    const dist = Math.hypot(x + 0.5 - r.x, y + 0.5 - r.y);
    if (dist < 10) this.cameras.main.shake(ms, k * (1 - dist / 12));
  }

  private syncFlares(dt: number): void {
    const w = this.session.world;
    const t = this.time.now;
    for (let k = this.flares.length - 1; k >= 0; k--) {
      const f = this.flares[k];
      if (t > f.until) {
        f.img.destroy();
        this.flares.splice(k, 1);
        continue;
      }
      if (f.vx || f.vy) {
        f.vy = Math.min(10 * TS, f.vy + 16 * TS * dt);
        const nx = f.x + f.vx * dt;
        const ny = f.y + f.vy * dt;
        if (isSolid(w.get(Math.floor(nx / TS), Math.floor(f.y / TS)))) f.vx = 0;
        else f.x = nx;
        if (f.vy > 0 && isSolid(w.get(Math.floor(f.x / TS), Math.floor((ny + 3) / TS)))) {
          f.vy = 0;
          f.vx = 0;
          f.y = Math.floor((ny + 3) / TS) * TS - 3;
        } else if (f.vy < 0 && isSolid(w.get(Math.floor(f.x / TS), Math.floor((ny - 3) / TS)))) {
          f.vy = 0;
        } else f.y = ny;
      } else if (!isSolid(w.get(Math.floor(f.x / TS), Math.floor((f.y + 4) / TS)))) {
        f.vy = 1; // the ground under it was dug out
      }
      f.img.setPosition(Math.round(f.x), Math.round(f.y));
      if (Math.random() < dt * 14) {
        this.sparks.setParticleTint(0xffc040);
        this.sparks.emitParticleAt(f.x, f.y - 3, 1);
      }
    }
  }

  private addFlare(x: number, y: number, facing: number): void {
    const img = this.add.image(x * TS, y * TS, 'flare').setOrigin(0.5, 0.5).setDepth(4.6);
    this.flares.push({ x: x * TS, y: y * TS, vx: facing * 40, vy: -70, until: this.time.now + FLARE.life * 1000, img });
    if (this.flares.length > 24) this.flares.shift()!.img.destroy();
  }

  private syncSteam(dt: number): void {
    this.steamTimer -= dt;
    if (this.steamTimer > 0) return;
    this.steamTimer = 0.07;
    const w = this.session.world;
    const view = this.cameras.main.worldView;
    if (view.bottom / TS - SKY < 300) return; // vents only live in the Geothermal Zone
    const x0 = Math.max(0, Math.floor(view.x / TS));
    const x1 = Math.min(w.w - 1, Math.ceil(view.right / TS));
    const y0 = Math.max(SKY, Math.floor(view.y / TS));
    const y1 = Math.min(w.h - 1, Math.ceil(view.bottom / TS) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (w.tiles[y * w.w + x] !== T.VENT || !ventActive(w, x, y)) continue;
        if (isSolid(w.get(x, y - 1))) continue;
        this.steam.emitParticleAt((x + 0.5) * TS, y * TS, 2);
      }
    }
  }


  private syncPeers(): void {
    const live = new Set<string>();
    const anim = Math.floor(this.time.now / 70) % 2;
    const world = this.session.world;
    for (const p of this.session.peers()) {
      live.add(p.id);
      let s = this.peerSprites.get(p.id);
      if (!s) {
        s = {
          rig: this.add.sprite(0, 0, `rig${p.paint}`, 'idle0').setDepth(4.5),
          flame: this.add.image(0, 0, 'flame', 'f0').setDepth(4.4),
          chute: this.add.image(0, 0, 'chute').setOrigin(0.5, 1).setDepth(4.6).setVisible(false),
          tag: this.label(p.name, '#cfe6ff', 6).setOrigin(0.5, 1).setDepth(8).setAlpha(0.85),
          paint: p.paint,
          dead: null,
        };
        this.peerSprites.set(p.id, s);
      }
      if (s.paint !== p.paint) {
        s.rig.setTexture(`rig${p.paint}`);
        s.paint = p.paint;
      }
      const stuck = (p.flags & RIG_STALLED) > 0 && !(p.flags & RIG_WRECKED);
      const label = stuck ? `${p.name} · ${p.flags & RIG_SOS ? 'SOS' : 'out of fuel'}` : p.name;
      if (s.tag.text !== label) s.tag.setText(label).setColor(stuck ? '#ff8a7a' : '#cfe6ff');
      if (stuck) s.tag.setAlpha(Math.floor(this.time.now / 450) % 2 ? 1 : 0.55);
      else s.tag.setAlpha(0.85);
      const px = p.x * TS;
      const py = p.y * TS;
      let frame = 'idle0';
      if (p.mode === RigMode.DrillDown) frame = `down${anim}`;
      else if (p.mode === RigMode.DrillSide) frame = `side${anim}`;
      else if (p.mode === RigMode.Moving) frame = `idle${anim}`;
      s.rig.setFrame(frame).setFlipX(p.facing < 0).setPosition(px, py);
      if (p.flags & RIG_WRECKED) this.wreckLook(s, px, py, p.facing);
      else if (s.dead || s.rig.isTinted) {
        s.dead = null;
        s.rig.setScale(1).setAngle(0).clearTint();
      }
      s.flame.setVisible((p.flags & RIG_THRUST) > 0).setPosition(px, py + (RIG_H / 2) * TS + 4).setFrame(`f${anim}`);
      const floating = stuck && !isSolid(world.get(Math.floor(p.x), Math.floor(p.y + RIG_H / 2 + 0.1)));
      s.chute.setVisible(floating).setPosition(px, py - 7);
      s.tag.setPosition(px, py - (floating ? 20 : 8));
      if (p.mode >= RigMode.DrillSide && Math.random() < 0.35) {
        const tx = p.mode === RigMode.DrillDown ? Math.floor(p.x) : Math.floor(p.x + p.facing * 0.45);
        const ty = p.mode === RigMode.DrillDown ? Math.floor(p.y + RIG_H / 2 + 0.05) : Math.floor(p.y);
        this.dust.setParticleTint(debrisColor(world, tx, ty, world.get(tx, ty)));
        this.dust.emitParticleAt(p.mode === RigMode.DrillDown ? px : px + p.facing * 9, p.mode === RigMode.DrillDown ? py + 9 : py + 1, 1);
      }
    }
    for (const [id, s] of this.peerSprites) {
      if (live.has(id)) continue;
      s.rig.destroy();
      s.flame.destroy();
      s.chute.destroy();
      s.tag.destroy();
      this.peerSprites.delete(id);
    }
  }

  private label(text: string, color: string, size = 8): Phaser.GameObjects.Text {
    return this.add.text(0, 0, text, { fontFamily: 'Silkscreen, monospace', fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 2, resolution: 4 });
  }

  private showBubble(id: string, text: string): void {
    this.bubbles.get(id)?.text.destroy();
    const t = this.add
      .text(0, 0, text, {
        fontFamily: 'Silkscreen, monospace',
        fontSize: '7px',
        color: '#e6f2ff',
        backgroundColor: '#0b1626',
        padding: { x: 3, y: 2 },
        wordWrap: { width: 110 },
        resolution: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(9);
    this.bubbles.set(id, { text: t, until: this.time.now + 5000 });
  }

  private syncBubbles(): void {
    for (const [id, b] of this.bubbles) {
      if (this.time.now > b.until) {
        b.text.destroy();
        this.bubbles.delete(id);
        continue;
      }
      if (id === this.session.myId()) {
        b.text.setVisible(true).setPosition(this.rig.x, this.rig.y - 10);
      } else {
        const s = this.peerSprites.get(id);
        b.text.setVisible(!!s);
        if (s) b.text.setPosition(s.rig.x, s.rig.y - 16);
      }
    }
  }

  private onEvent(e: SessionEvent): void {
    const r = this.session.player.rig;
    const world = this.session.world;
    switch (e.t) {
      case 'dug':
        this.dust.setParticleTint(debrisColor(world, e.x, e.y, e.tile));
        this.dust.emitParticleAt((e.x + 0.5) * TS, (e.y + 0.5) * TS, 7);
        break;
      case 'pickup': {
        const m = MINERALS[e.mineral];
        this.sparks.setParticleTint(Phaser.Display.Color.HexStringToColor(m.light).color);
        this.sparks.emitParticleAt(r.x * TS, r.y * TS - 4, 12);
        this.floatText(r.x * TS, r.y * TS - 8, `+${m.name}`, m.light);
        break;
      }
      case 'cargo-full':
        this.floatText(r.x * TS, r.y * TS - 8, 'FULL', '#ffb020');
        break;
      case 'hurt':
        this.flash = 0.18;
        if (e.cause === 'fall') this.cameras.main.shake(140, 0.006);
        break;
      case 'land':
        this.dust.setParticleTint(0xc8d4e4);
        this.dust.emitParticleAt(r.x * TS, (r.y + RIG_H / 2) * TS, 6);
        break;
      case 'blast': {
        this.cameras.main.shake(260, 0.012);
        const cx = (e.x + 0.5) * TS;
        const cy = (e.y + 0.5) * TS;
        this.sparks.setParticleTint(0xffa030);
        this.sparks.emitParticleAt(cx, cy, 30);
        this.dust.setParticleTint(0x8a8a90);
        this.dust.emitParticleAt(cx, cy, 30);
        const ring = this.add.circle(cx, cy, 4, 0xffd060, 0.8).setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ring, radius: (e.r + 1) * TS, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
        break;
      }
      case 'peer-dug':
        this.dust.setParticleTint(debrisColor(world, e.x, e.y, e.tile));
        this.dust.emitParticleAt((e.x + 0.5) * TS, (e.y + 0.5) * TS, 5);
        break;
      case 'peer-blast': {
        const cx = (e.x + 0.5) * TS;
        const cy = (e.y + 0.5) * TS;
        if (Math.hypot(e.x - r.x, e.y - r.y) < 10) this.cameras.main.shake(200, 0.006);
        this.sparks.setParticleTint(0xffa030);
        this.sparks.emitParticleAt(cx, cy, 20);
        const ring = this.add.circle(cx, cy, 4, 0xffd060, 0.7).setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ring, radius: (e.r + 1) * TS, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
        break;
      }
      case 'chat':
        this.showBubble(e.id, e.text);
        break;
      case 'peer-wrecked': {
        const s = this.peerSprites.get(e.id);
        if (!s) break;
        s.dead = { cause: e.cause, at: this.time.now };
        this.wreckBurst(e.x * TS, e.y * TS, e.cause, s.paint);
        this.shakeNear(Math.floor(e.x), Math.floor(e.y), e.cause === 'gas' ? 320 : 200, e.cause === 'fuel' ? 0 : 0.012);
        break;
      }
      case 'loose': {
        const t = world.get(e.x, e.y);
        if (t !== T.AIR) this.looseAt(e.x, e.y, t);
        break;
      }
      case 'fall':
        this.dropLoose(e.x, e.y, e.tile);
        break;
      case 'crash':
        this.crash(e.x, e.y, e.tile);
        break;
      case 'thump':
        this.dust.setParticleTint(debrisColor(world, e.x, e.y, world.get(e.x, e.y)));
        this.dust.emitParticleAt((e.x + 0.5) * TS, (e.y + 1) * TS, 8);
        this.shakeNear(e.x, e.y, 120, 0.004);
        break;
      case 'refill':
        this.sparks.setParticleTint(0x7ac8ff);
        this.sparks.emitParticleAt(r.x * TS, r.y * TS - 2, 16);
        this.floatText(r.x * TS, r.y * TS - 8, `+${e.litres.toFixed(1)} L`, '#9fe8ff');
        break;
      case 'pour':
        this.sparks.setParticleTint(0xff8a20);
        this.sparks.emitParticleAt((e.x + 0.5) * TS, (e.y + 0.3) * TS, 8);
        break;
      case 'flare':
        this.addFlare(e.x, e.y, 0);
        break;
      default:
        break;
    }
  }

  floatText(x: number, y: number, text: string, color: string, ms = 1000, rise = 16): void {
    const t = this.add
      .text(x, y, text, { fontFamily: 'Silkscreen, monospace', fontSize: '8px', color, stroke: '#000000', strokeThickness: 2, resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(9);
    this.tweens.add({ targets: t, y: y - rise, alpha: 0, duration: ms, ease: 'Quad.easeIn', onComplete: () => t.destroy() });
  }

  /** A "+$240" or "+12 L" over your rig, for station sales and purchases. Quick ones stack upward. */
  floatAtRig(text: string, color: string): void {
    const now = this.time.now;
    this.floatN = now - this.floatAt < 900 ? this.floatN + 1 : 0;
    this.floatAt = now;
    this.floatText(this.rig.x, this.rig.y - 9 - this.floatN * 9, text, color, 1500, 22);
  }

  // ------------------------------------------------------------ other miners' wrecks

  /** The burst when another miner's rig is lost near you. Your own end is a full cutscene (below). */
  private wreckBurst(x: number, y: number, cause: HurtCause, paint: number): void {
    if (cause === 'fuel') {
      this.sparks.setParticleTint(0xcfeeff);
      this.sparks.emitParticleAt(x, y, 16);
      return;
    }
    if (cause === 'gas') {
      for (const [delay, color] of [[0, 0xffe090], [90, 0xff8a30]]) {
        const ring = this.add.circle(x, y, 4, color, 0.85).setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ring, radius: 3.2 * TS, alpha: 0, duration: 420, delay, onComplete: () => ring.destroy() });
      }
    }
    const crushed = cause === 'fall' || cause === 'rock';
    this.sparks.setParticleTint(crushed ? Phaser.Display.Color.HexStringToColor(PAINTS[paint] ?? PAINTS[0]).color : cause === 'gas' ? 0xffa030 : 0xff6020);
    this.sparks.emitParticleAt(x, y, crushed ? 22 : 36);
    this.dust.setParticleTint(0x8a8a90);
    this.dust.emitParticleAt(x, y + 4, 22);
    this.smoke.emitParticleAt(x, y, 4);
  }

  /** How a wrecked miner's rig lies there until they respawn: frozen, crushed, charred or melted. */
  private wreckLook(s: PeerSprite, px: number, py: number, facing: number): void {
    const rig = s.rig;
    if (!s.dead) {
      // We weren't near when it happened.
      rig.setTint(0x3a3a3a);
      return;
    }
    const age = (this.time.now - s.dead.at) / 1000;
    const k = Math.min(1, age / 1.4);
    switch (s.dead.cause) {
      case 'fuel':
        rig.setTint(lerpColor(0xffffff, 0x7fc4ff, k));
        break;
      case 'fall':
      case 'rock': {
        const sy = s.dead.cause === 'rock' ? 0.4 : 0.6;
        rig.setScale(1.2, sy).setPosition(px, py + (1 - sy) * 8).setTint(0x6a6a6a);
        break;
      }
      case 'gas':
        rig.setTint(0x2a2a2a).setAngle(16 * facing);
        break;
      default: {
        const sy = 1 - 0.5 * k;
        rig.setScale(1 + 0.15 * k, sy).setPosition(px, py + (1 - sy) * 8);
        rig.setTint(k < 0.5 ? lerpColor(0xffffff, 0xff8a30, k * 2) : lerpColor(0xff8a30, 0x3a1408, (k - 0.5) * 2));
        break;
      }
    }
    if (s.dead.cause !== 'fuel' && age < 2.5 && Math.random() < 0.12) this.smoke.emitParticleAt(px + (Math.random() - 0.5) * 10, py - 2, 1);
  }

  // ------------------------------------------------------------ cutscenes

  get inCutscene(): boolean {
    return this.cine !== null;
  }

  private cue(c: Cue): void {
    this.hooks.onCue?.(c);
  }

  private resetRigLook(): void {
    this.rig.setScale(1).setAngle(0).clearTint();
    this.flame.setVisible(false);
    this.chute.setVisible(false);
    this.lampK = 1;
  }

  /** The pixel row where a rig falling from (x, y) in tiles would come to rest. */
  private restBelow(x: number, y: number): number {
    const w = this.session.world;
    const x0 = Math.floor(x - RIG_W / 2 + 0.001);
    const x1 = Math.floor(x + RIG_W / 2 - 0.001);
    for (let ty = Math.floor(y + RIG_H / 2 + 0.02); ty < w.h; ty++) {
      for (let tx = x0; tx <= x1; tx++) if (isSolid(w.get(tx, ty))) return (ty - RIG_H / 2) * TS;
    }
    return y * TS;
  }

  /**
   * The rig's last moments, by what killed it: a dry tank freezes over in the dark, a hard
   * landing or a rockfall crushes it, gas blows it apart, and heat melts it down. A wreck in
   * mid-air drops first. `done` runs once the screen has faded out.
   */
  playDeath(cause: HurtCause, done: () => void): void {
    const pos = this.session.renderPos();
    this.resetRigLook();
    const y = pos.y * TS;
    const rest = this.restBelow(pos.x, pos.y);
    this.cine = { kind: 'death', cause, phase: rest - y > 3 ? 'drop' : 'main', t: 0, x: pos.x * TS, y, vy: 0, rest, tick: 0, marks: new Set(), done };
    this.rig.setFrame('idle0').setPosition(this.cine.x, y);
  }

  /** The station's sky crane sets the rig down on the pad, then leaves. */
  playArrival(done: () => void): void {
    const sp = this.session.world.spawn();
    this.resetRigLook();
    const rest = (sp.y - RIG_H / 2) * TS;
    const x = sp.x * TS;
    const y = rest - 6.5 * TS;
    this.cine = { kind: 'arrive', cause: 'fall', phase: 'main', t: 0, x, y, vy: 0, rest, tick: 0, marks: new Set(), done };
    this.rig.setFrame('idle0').setFlipX(this.session.player.rig.facing < 0).setPosition(x, y);
    const cam = this.cameras.main;
    cam.centerOn(x, y + 2 * TS);
    cam.fadeIn(450, 2, 4, 10);
  }

  /** Cut a cutscene short: a death jumps to its fade, an arrival to the rig on the pad. */
  skipCutscene(): void {
    const c = this.cine;
    if (!c) return;
    if (c.kind === 'arrive') this.endArrival(c);
    else if (c.phase !== 'fade' && (c.phase === 'drop' || c.t > 0.5)) this.fadeOut(c);
  }

  private fadeOut(c: Cine): void {
    c.phase = 'fade';
    c.t = 0;
    this.cameras.main.fadeOut(320, 2, 4, 10);
  }

  private endArrival(c: Cine): void {
    this.rig.setPosition(c.x, c.rest);
    this.lifter.setVisible(false);
    this.cable.clear();
    this.cine = null;
    c.done();
  }

  private stepCine(c: Cine, dt: number): void {
    c.t += dt;
    c.tick -= dt;
    if (c.kind === 'arrive') {
      this.stepArrival(c);
    } else if (c.phase === 'drop') {
      const facing = this.session.player.rig.facing;
      c.vy = Math.min(15 * TS, c.vy + 22 * TS * dt);
      c.y += c.vy * dt;
      this.rig.angle += 240 * dt * facing;
      if (c.tick <= 0) {
        c.tick = 0.07;
        this.smoke.emitParticleAt(c.x, c.y - 6, 1);
      }
      if (c.y >= c.rest) {
        c.y = c.rest;
        c.phase = 'main';
        c.t = 0;
        this.rig.setAngle(0);
        // A hard landing gets its own crash in the main scene; the others land with a thump first.
        if (c.cause !== 'fall' && c.cause !== 'rock') {
          this.cue('crash');
          this.cameras.main.shake(260, 0.014);
          this.dust.setParticleTint(0xc8d4e4);
          this.dust.emitParticleAt(c.x, c.y + 7, 14);
        }
      }
      this.rig.setPosition(c.x, c.y);
    } else if (c.phase === 'main') {
      this.stepDeath(c);
    } else if (c.t > 0.36) {
      // Faded out. The cutscene stays in charge until the arrival replaces it, so the sprite never jumps.
      c.t = -Infinity;
      c.done();
    }
  }

  private stepDeath(c: Cine): void {
    const t = c.t;
    const once = (k: string) => !c.marks.has(k) && !!c.marks.add(k);
    const every = (s: number) => c.tick <= 0 && ((c.tick = s), true);
    const cam = this.cameras.main;
    const rig = this.rig;
    const { x, y } = c;
    const r = this.session.player.rig;
    const ground = debrisColor(this.session.world, Math.floor(r.x), Math.floor(r.y + 1), this.session.world.get(Math.floor(r.x), Math.floor(r.y + 1)));
    let end = 2.2;
    switch (c.cause) {
      case 'fuel': {
        end = 2.9;
        if (once('start')) this.cue('sputter');
        if (t < 1) {
          // The engine coughs and the lamp flickers.
          this.lampK = (Math.sin(t * 38) > 0.1 ? 1 : 0.2) * (1 - t * 0.45);
          rig.setPosition(x + (Math.floor(t * 28) % 2), y);
          if (every(0.15)) this.smoke.emitParticleAt(x - 4 * r.facing, y - 9, 1);
        } else {
          // Then the cold moves in.
          const k = Math.min(1, (t - 1) / 1.3);
          this.lampK = 0.5 * (1 - k);
          rig.setPosition(x, y).setTint(lerpColor(0xffffff, 0x7fc4ff, k));
          if (every(0.06)) {
            this.dust.setParticleTint(0xe8f6ff);
            this.dust.emitParticleAt(x + (Math.random() - 0.5) * 22, y - 4 - Math.random() * 10, 1);
          }
          if (k >= 1 && once('ice')) {
            this.cue('freeze');
            this.sparks.setParticleTint(0xcfeeff);
            this.sparks.emitParticleAt(x, y, 22);
            cam.shake(120, 0.004);
          }
        }
        break;
      }
      case 'fall':
      case 'rock': {
        if (once('start')) {
          this.cue('crash');
          cam.shake(420, 0.02);
          cam.flash(110, 255, 255, 255);
          const sy = c.cause === 'rock' ? 0.4 : 0.6;
          rig.setScale(1.2, sy).setPosition(x, y + (1 - sy) * 8).setTint(0x6a6a6a);
          this.dust.setParticleTint(c.cause === 'rock' ? 0x8a8a90 : ground);
          this.dust.emitParticleAt(x, y + 6, 28);
          this.sparks.setParticleTint(Phaser.Display.Color.HexStringToColor(PAINTS[this.session.paint] ?? PAINTS[0]).color);
          this.sparks.emitParticleAt(x, y, 24);
        }
        if (t < 1.6 && every(0.11)) {
          this.smoke.emitParticleAt(x + (Math.random() - 0.5) * 10, y - 2, 1);
          if (Math.random() < 0.4) {
            this.sparks.setParticleTint(0xffb040);
            this.sparks.emitParticleAt(x + (Math.random() - 0.5) * 12, y, 2);
          }
        }
        break;
      }
      case 'gas': {
        if (once('start')) {
          this.cue('boom');
          cam.shake(500, 0.022);
          cam.flash(160, 255, 210, 130);
          rig.setTint(0x2a2a2a).setAngle(16 * r.facing);
          this.sparks.setParticleTint(0xffa030);
          this.sparks.emitParticleAt(x, y, 44);
          this.dust.setParticleTint(0x8a8a90);
          this.dust.emitParticleAt(x, y, 30);
          for (const [delay, color] of [[0, 0xffe090], [90, 0xff8a30]]) {
            const ring = this.add.circle(x, y, 4, color, 0.85).setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
            this.tweens.add({ targets: ring, radius: 3.2 * TS, alpha: 0, duration: 420, delay, onComplete: () => ring.destroy() });
          }
        }
        if (t < 1.7 && every(0.09)) this.smoke.emitParticleAt(x + (Math.random() - 0.5) * 14, y - 2, 1);
        break;
      }
      default: {
        // Magma, heat and steam: the rig glows, sags and gives out.
        end = 2.5;
        if (once('start')) this.cue('hiss');
        const k = Math.min(1, t / 1.7);
        const tint = k < 0.5 ? lerpColor(0xffffff, 0xff8a30, k * 2) : lerpColor(0xff8a30, 0x3a1408, (k - 0.5) * 2);
        const sy = 1 - 0.5 * k;
        rig.setScale(1 + 0.15 * k, sy).setPosition(x, y + (1 - sy) * 8).setTint(tint);
        if (k < 1 && every(0.06)) {
          if (c.cause === 'steam') this.steam.emitParticleAt(x + (Math.random() - 0.5) * 12, y, 1);
          else {
            this.sparks.setParticleTint(0xff7a20);
            this.sparks.emitParticleAt(x + (Math.random() - 0.5) * 14, y + 4, 1);
          }
        }
        if (k >= 1 && once('pop')) {
          this.cue('boom');
          cam.shake(260, 0.012);
          this.sparks.setParticleTint(0xff6020);
          this.sparks.emitParticleAt(x, y + 4, 34);
          this.smoke.emitParticleAt(x, y, 5);
        }
        break;
      }
    }
    if (t >= end) this.fadeOut(c);
  }

  private stepArrival(c: Cine): void {
    const DOWN = 1.9;
    const AWAY = 0.9;
    const t = c.t;
    const once = (k: string) => !c.marks.has(k) && !!c.marks.add(k);
    if (once('start')) this.cue('rotor');
    this.lifter.setVisible(true).setFrame(`l${Math.floor(this.time.now / 45) % 2}`);
    const g = this.cable;
    g.clear();
    if (t < DOWN) {
      const k = 1 - (1 - t / DOWN) ** 3;
      const sway = Math.sin(t * 5) * 2 * (1 - k);
      const y = c.y + (c.rest - c.y) * k;
      this.rig.setPosition(c.x + sway, y);
      this.lifter.setPosition(c.x + sway * 0.4, y - 34);
      g.lineStyle(1, 0x9aa4b2).lineBetween(c.x + sway * 0.4, y - 23, c.x + sway, y - 8);
      // Rotor wash kicks up snow as it nears the pad.
      if (k > 0.75 && c.tick <= 0) {
        c.tick = 0.05;
        this.dust.setParticleTint(0xe6eef7);
        this.dust.emitParticleAt(c.x + (Math.random() - 0.5) * 30, c.rest + 6, 1);
      }
      return;
    }
    if (once('land')) {
      this.cue('land');
      this.rig.setPosition(c.x, c.rest);
      this.dust.setParticleTint(0xe6eef7);
      this.dust.emitParticleAt(c.x, c.rest + 6, 12);
      this.cameras.main.shake(90, 0.004);
    }
    const u = (t - DOWN) / AWAY;
    const ly = c.rest - 34 - u * u * 9 * TS;
    const lx = c.x + u * u * 4 * TS;
    this.lifter.setPosition(lx, ly);
    const len = 11 * Math.max(0, 1 - u * 3);
    if (len > 0.5) g.lineStyle(1, 0x9aa4b2).lineBetween(lx, ly + 11, lx, ly + 11 + len);
    if (t >= DOWN + AWAY) this.endArrival(c);
  }

  setPaint(i: number): void {
    this.rig.setTexture(`rig${i}`, this.rig.frame.name);
  }
}
