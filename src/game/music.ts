// Ambient music, one mood per layer, all synthesized: a low drone, slow pad chords and sparse
// bell notes through a feedback delay. Moving to a new layer retunes everything over a few seconds.

interface Mood {
  /** Root note in Hz. */
  root: number;
  /** Scale steps in semitones from the root. */
  scale: number[];
  pad: OscillatorType;
  bell: OscillatorType;
  /** Seconds per step. */
  beat: number;
  /** Chance of a bell note on each step. */
  bells: number;
  /** Lowpass cutoff for the pad, in Hz. */
  bright: number;
  /** Detune between the two pad voices, in cents. */
  detune: number;
  drone: number;
}

const MOODS: Mood[] = [
  // Snowpack: open air, wind and a little hope.
  { root: 220, scale: [0, 2, 3, 7, 10], pad: 'triangle', bell: 'sine', beat: 0.9, bells: 0.16, bright: 1400, detune: 6, drone: 0.05 },
  // Firn: quieter, sparser.
  { root: 207.65, scale: [0, 3, 5, 7, 10], pad: 'triangle', bell: 'sine', beat: 1.0, bells: 0.13, bright: 1100, detune: 8, drone: 0.06 },
  // Glacier: glassy bells.
  { root: 246.94, scale: [0, 2, 4, 6, 7, 11], pad: 'sine', bell: 'sine', beat: 0.75, bells: 0.24, bright: 2200, detune: 4, drone: 0.05 },
  // Permafrost: earthy, low and muffled.
  { root: 146.83, scale: [0, 2, 3, 5, 7, 9, 10], pad: 'sawtooth', bell: 'triangle', beat: 1.1, bells: 0.1, bright: 600, detune: 10, drone: 0.08 },
  // Bedrock: heavy and slow.
  { root: 130.81, scale: [0, 3, 5, 7, 8], pad: 'sawtooth', bell: 'triangle', beat: 1.3, bells: 0.07, bright: 480, detune: 12, drone: 0.1 },
  // Geothermal: warm, uneasy pulse.
  { root: 174.61, scale: [0, 1, 4, 5, 7, 8], pad: 'sawtooth', bell: 'square', beat: 0.8, bells: 0.09, bright: 700, detune: 16, drone: 0.11 },
  // The Hollow: something old is humming.
  { root: 155.56, scale: [0, 2, 4, 6, 8, 10], pad: 'sine', bell: 'sine', beat: 1.2, bells: 0.14, bright: 1600, detune: 22, drone: 0.12 },
];

const semi = (root: number, n: number) => root * Math.pow(2, n / 12);

export class Music {
  private out: GainNode;
  private wet: GainNode;
  private droneOsc: OscillatorNode;
  private droneGain: GainNode;
  private droneFilter: BiquadFilterNode;
  private layer = -1;
  private playing = false;
  private nextAt = 0;
  private step = 0;
  private timer: number;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    // A long feedback delay gives everything some cave space.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.62;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.wet.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(this.out);

    this.droneOsc = ctx.createOscillator();
    this.droneOsc.type = 'sawtooth';
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 180;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneOsc.connect(this.droneFilter).connect(this.droneGain).connect(this.out);
    this.droneOsc.start();
    // A slow wobble on the drone's filter so it breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 70;
    lfo.connect(lfoAmt).connect(this.droneFilter.frequency);
    lfo.start();

    this.timer = window.setInterval(() => this.schedule(), 200);
  }

  /** Call every frame with the layer the rig is in and whether the game is being played. */
  set(layer: number, playing: boolean): void {
    const t = this.ctx.currentTime;
    if (playing !== this.playing) {
      this.playing = playing;
      this.out.gain.setTargetAtTime(playing ? 0.32 : 0, t, playing ? 1.5 : 0.4);
      if (playing) this.nextAt = Math.max(this.nextAt, t + 0.1);
    }
    if (layer !== this.layer && layer >= 0) {
      this.layer = layer;
      const m = MOODS[Math.min(MOODS.length - 1, layer)];
      this.droneOsc.frequency.setTargetAtTime(m.root / 4, t, 2);
      this.droneGain.gain.setTargetAtTime(m.drone, t, 2);
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }

  private schedule(): void {
    if (!this.playing || this.layer < 0) return;
    const ctx = this.ctx;
    const m = MOODS[Math.min(MOODS.length - 1, this.layer)];
    if (this.nextAt < ctx.currentTime) this.nextAt = ctx.currentTime + 0.05;
    while (this.nextAt < ctx.currentTime + 0.6) {
      const at = this.nextAt;
      if (this.step % 8 === 0) this.chord(m, at);
      if (Math.random() < m.bells) this.bell(m, at);
      this.step++;
      this.nextAt += m.beat;
    }
  }

  private pick(m: Mood): number {
    return m.scale[Math.floor(Math.random() * m.scale.length)];
  }

  private chord(m: Mood, at: number): void {
    const ctx = this.ctx;
    const len = m.beat * 8;
    const base = this.pick(m);
    const notes = [base - 12, base - 5, base];
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = m.bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.06, at + len * 0.35);
    g.gain.linearRampToValueAtTime(0, at + len * 1.1);
    f.connect(g);
    g.connect(this.out);
    g.connect(this.wet);
    for (const n of notes) {
      for (const d of [-m.detune, m.detune]) {
        const o = ctx.createOscillator();
        o.type = m.pad;
        o.frequency.value = semi(m.root, n);
        o.detune.value = d;
        o.connect(f);
        o.start(at);
        o.stop(at + len * 1.15);
      }
    }
  }

  private bell(m: Mood, at: number): void {
    const ctx = this.ctx;
    const n = this.pick(m) + (Math.random() < 0.5 ? 12 : 24);
    const o = ctx.createOscillator();
    o.type = m.bell;
    o.frequency.value = semi(m.root, n);
    const g = ctx.createGain();
    const v = m.bell === 'square' ? 0.012 : 0.035;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(v, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
    o.connect(g);
    g.connect(this.out);
    g.connect(this.wet);
    o.start(at);
    o.stop(at + 1.7);
  }
}
