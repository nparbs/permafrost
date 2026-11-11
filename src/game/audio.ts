// Sound effects synthesised with Web Audio. Nothing is loaded from files.

import { Music } from './music';

export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuf?: AudioBuffer;
  private drillGain?: GainNode;
  private drillFilter?: BiquadFilterNode;
  private drillOsc?: OscillatorNode;
  private thrustGain?: GainNode;
  private music?: Music;
  muted = false;
  musicOn = true;

  constructor() {
    try {
      this.muted = localStorage.getItem('permafrost.muted') === '1';
      this.musicOn = localStorage.getItem('permafrost.music') !== '0';
    } catch {
      /* storage blocked */
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    try {
      localStorage.setItem('permafrost.music', on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
  }

  /** Call every frame: which layer's music, and whether the game is being played. */
  musicFrame(layer: number, playing: boolean): void {
    this.music?.set(layer, playing && this.musicOn);
  }

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Drill loop: filtered noise plus a low grinding tone.
    const n = this.loopNoise();
    this.drillFilter = ctx.createBiquadFilter();
    this.drillFilter.type = 'bandpass';
    this.drillFilter.frequency.value = 400;
    this.drillFilter.Q.value = 1.2;
    this.drillGain = ctx.createGain();
    this.drillGain.gain.value = 0;
    n.connect(this.drillFilter).connect(this.drillGain).connect(this.master);
    this.drillOsc = ctx.createOscillator();
    this.drillOsc.type = 'sawtooth';
    this.drillOsc.frequency.value = 55;
    const og = ctx.createGain();
    og.gain.value = 0.25;
    this.drillOsc.connect(og).connect(this.drillGain);
    this.drillOsc.start();

    // Thruster loop: low rumble.
    const t = this.loopNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    t.connect(lp).connect(this.thrustGain).connect(this.master);

    this.music = new Music(ctx, this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('permafrost.muted', m ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf!;
    s.loop = true;
    s.start();
    return s;
  }

  drill(on: boolean, hardness = 1): void {
    if (!this.ctx || !this.drillGain) return;
    const t = this.ctx.currentTime;
    this.drillGain.gain.setTargetAtTime(on ? 0.22 : 0, t, on ? 0.02 : 0.05);
    if (on) {
      this.drillFilter!.frequency.setTargetAtTime(260 + hardness * 260, t, 0.05);
      this.drillOsc!.frequency.setTargetAtTime(40 + hardness * 18 + Math.random() * 6, t, 0.03);
    }
  }

  thrust(on: boolean): void {
    if (!this.ctx || !this.thrustGain) return;
    this.thrustGain.gain.setTargetAtTime(on ? 0.3 : 0, this.ctx.currentTime, 0.06);
  }

  tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.15, delay = 0, slide = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, vol: number, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.2), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur);
  }

  /** rank 0..1: how valuable the find is. */
  pickup(rank: number): void {
    const base = 520 + rank * 500;
    this.tone(base, 0.08, 'square', 0.09);
    this.tone(base * 1.5, 0.12, 'square', 0.09, 0.06);
    if (rank > 0.6) this.tone(base * 2, 0.18, 'triangle', 0.1, 0.12);
  }

  sell(): void {
    [660, 830, 990, 1320].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08, i * 0.07));
  }

  buy(): void {
    this.tone(440, 0.08, 'triangle', 0.15);
    this.tone(880, 0.16, 'triangle', 0.15, 0.07);
  }

  error(): void {
    this.tone(160, 0.18, 'square', 0.1, 0, -60);
  }

  click(): void {
    this.tone(900, 0.03, 'square', 0.05);
  }

  thud(strength: number): void {
    this.tone(90, 0.15 + strength * 0.1, 'sine', 0.2 + strength * 0.2, 0, -50);
    this.burst(0.12, 600, 0.1 + strength * 0.2);
  }

  boom(): void {
    this.burst(0.7, 1800, 0.6);
    this.tone(70, 0.5, 'sine', 0.4, 0, -40);
  }

  alarm(): void {
    this.tone(980, 0.09, 'square', 0.07);
    this.tone(740, 0.09, 'square', 0.07, 0.11);
  }

  dug(): void {
    this.burst(0.06, 1200, 0.06, 'bandpass');
  }

  /** A loose block grinding against the ice. */
  creak(): void {
    this.tone(140, 0.35, 'sawtooth', 0.05, 0, -50);
    this.tone(190, 0.25, 'sawtooth', 0.035, 0.12, -70);
  }

  rumble(): void {
    this.burst(0.5, 300, 0.25);
  }

  splash(): void {
    this.burst(0.45, 2400, 0.22, 'bandpass');
    this.tone(320, 0.2, 'sine', 0.08, 0.05, -180);
  }

  hiss(): void {
    this.burst(0.6, 5000, 0.12, 'highpass');
  }

  fizz(): void {
    this.burst(0.3, 3500, 0.15, 'highpass');
    this.tone(1200, 0.1, 'square', 0.04);
  }

  /** An engine coughing on fumes. */
  sputter(): void {
    [0, 0.17, 0.38, 0.68].forEach((d, i) => {
      this.tone(105 - i * 13, 0.1, 'sawtooth', 0.13 - i * 0.02, d, -35);
    });
    this.tone(60, 0.5, 'sawtooth', 0.06, 0.9, -30);
  }

  /** Ice closing over the rig. */
  freeze(): void {
    this.burst(0.5, 6000, 0.12, 'highpass');
    [2300, 1900, 2700, 1500].forEach((f, i) => this.tone(f, 0.05, 'triangle', 0.05, i * 0.06));
    this.tone(180, 0.6, 'sine', 0.1, 0.1, -120);
  }

  /** The sky crane's rotors, coming in and leaving. */
  rotor(): void {
    for (let i = 0; i < 26; i++) this.tone(72 + (i % 2) * 6, 0.07, 'sawtooth', 0.035 + 0.03 * Math.sin((i / 25) * Math.PI), i * 0.105);
    this.burst(2.6, 900, 0.07);
  }

  crunch(): void {
    this.burst(0.08, 2600, 0.1, 'bandpass');
    this.tone(1500, 0.04, 'square', 0.03);
  }
}
