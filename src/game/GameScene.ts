// Draws the session: tilemap, station, rig, particles and the polar sky.

import Phaser from 'phaser';
import { RIG_H } from '../sim/player';
import { RIG_THRUST, RIG_WRECKED, RigMode } from '../net/protocol';
import { MINERALS } from '../sim/tiles';
import { SKY } from '../sim/world';
import type { GameSession, SessionEvent } from './session';
import { TS, debrisColor, makeTextures, visIndex } from './textures';

export interface SceneData {
  session: GameSession;
  onFrame?: (scene: GameScene) => void;
}

export class GameScene extends Phaser.Scene {
  session!: GameSession;
  private hooks!: SceneData;
  private layer!: Phaser.Tilemaps.TilemapLayer;
  private rig!: Phaser.GameObjects.Sprite;
  private flame!: Phaser.GameObjects.Image;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
  private snowZone = new Phaser.Geom.Rectangle(0, 0, 1, 1);
  private stars!: Phaser.GameObjects.TileSprite;
  private aurora!: Phaser.GameObjects.TileSprite;
  private mountains!: Phaser.GameObjects.TileSprite;
  private dustTimer = 0;
  private flash = 0;
  private peerSprites = new Map<string, { rig: Phaser.GameObjects.Sprite; flame: Phaser.GameObjects.Image; tag: Phaser.GameObjects.Text; paint: number }>();
  private bubbles = new Map<string, { text: Phaser.GameObjects.Text; until: number }>();

  constructor() {
    super('Game');
  }

  create(data: SceneData): void {
    this.hooks = data;
    this.session = data.session;
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
    world.dirty.length = 0;

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

    const cam = this.cameras.main;
    cam.setBounds(0, 0, W, H);
    cam.setBackgroundColor('#04060f');
    cam.setRoundPixels(true);
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
    this.cameras.main.setZoom(Math.max(1, Math.round(m / 220)));
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.session.update(dt);
    this.refreshTiles();
    this.syncRig(dt);
    this.syncPeers();
    this.syncBubbles();
    this.syncSky();
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
      // A tile's look depends on the tiles above and left of it, so refresh its right and lower neighbours too.
      for (const [xx, yy] of [[x, y], [x + 1, y], [x, y + 1]]) {
        if (!w.inBounds(xx, yy)) continue;
        const k = yy * w.w + xx;
        if (done.has(k)) continue;
        done.add(k);
        const v = visIndex(w, xx, yy);
        if (v < 0) this.layer.removeTileAt(xx, yy);
        else this.layer.putTileAt(v, xx, yy);
      }
    }
    w.dirty.length = 0;
  }

  private syncRig(dt: number): void {
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
    if (skyVisible) this.snowZone.setTo(view.x - 30, Math.max(0, view.y - 10), view.width + 60, Math.max(1, SKY * TS - view.y));
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
          tag: this.label(p.name, '#cfe6ff', 6).setOrigin(0.5, 1).setDepth(8).setAlpha(0.85),
          paint: p.paint,
        };
        this.peerSprites.set(p.id, s);
      }
      if (s.paint !== p.paint) {
        s.rig.setTexture(`rig${p.paint}`);
        s.paint = p.paint;
      }
      if (s.tag.text !== p.name) s.tag.setText(p.name);
      const px = p.x * TS;
      const py = p.y * TS;
      let frame = 'idle0';
      if (p.mode === RigMode.DrillDown) frame = `down${anim}`;
      else if (p.mode === RigMode.DrillSide) frame = `side${anim}`;
      else if (p.mode === RigMode.Moving) frame = `idle${anim}`;
      s.rig.setFrame(frame).setFlipX(p.facing < 0).setPosition(px, py);
      if (p.flags & RIG_WRECKED) s.rig.setTint(0x3a3a3a);
      else s.rig.clearTint();
      s.flame.setVisible((p.flags & RIG_THRUST) > 0).setPosition(px, py + (RIG_H / 2) * TS + 4).setFrame(`f${anim}`);
      s.tag.setPosition(px, py - 8);
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
      case 'wrecked':
        this.cameras.main.shake(400, 0.015);
        this.sparks.setParticleTint(0xff6020);
        this.sparks.emitParticleAt(r.x * TS, r.y * TS, 40);
        break;
      default:
        break;
    }
  }

  floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, { fontFamily: 'Silkscreen, monospace', fontSize: '8px', color, stroke: '#000000', strokeThickness: 2, resolution: 4 })
      .setOrigin(0.5, 1)
      .setDepth(9);
    this.tweens.add({ targets: t, y: y - 16, alpha: 0, duration: 1000, ease: 'Quad.easeOut', onComplete: () => t.destroy() });
  }

  setPaint(i: number): void {
    this.rig.setTexture(`rig${i}`, this.rig.frame.name);
  }
}
