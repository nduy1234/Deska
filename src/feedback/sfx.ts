/**
 * Procedural sound kit. Hand tracking has no haptics, so every hand action
 * gets a short, soft sound. Synthesised with WebAudio: nothing to download,
 * nothing that delays the cold start.
 */

type Voice = 'sine' | 'triangle' | 'square' | 'sawtooth';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { gain: GainNode; filter: BiquadFilterNode } | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  return ctx;
}

/** Browsers start audio suspended until a user gesture; call on any input. */
export function unlockAudio(): void {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume();
}

function tone(
  freq: number,
  dur: number,
  {
    type = 'sine' as Voice,
    gain = 0.18,
    attack = 0.005,
    slideTo = 0,
    delay = 0,
  } = {},
): void {
  const a = audio();
  if (!a || !master || a.state !== 'running') return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, cutoff: number, gain: number): void {
  const a = audio();
  if (!a || !master || a.state !== 'running') return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start();
}

export const sfx = {
  /** Pinch landed on something grabbable. */
  pick: () => tone(620, 0.09, { type: 'triangle', slideTo: 880, gain: 0.12 }),
  /** Object set down on the desk. */
  place: () => {
    tone(180, 0.12, { type: 'sine', slideTo: 120, gain: 0.22 });
    noise(0.06, 900, 0.05);
  },
  /** Clay returned to the tray. */
  dissolve: () => tone(520, 0.25, { type: 'sine', slideTo: 200, gain: 0.1 }),
  /** Continuous sculpt tick, rate-limited by caller. */
  squish: (amount = 0.5) => noise(0.05, 400 + amount * 900, 0.04 + amount * 0.04),
  /** Archetype locked in. */
  lock: () => {
    tone(523, 0.18, { gain: 0.12 });
    tone(784, 0.3, { gain: 0.1, delay: 0.09 });
  },
  /** Generic soft confirm (poke/button). */
  tap: () => tone(900, 0.05, { type: 'triangle', gain: 0.08 }),
  /** Dial/turn detent. */
  detent: () => tone(1400, 0.025, { type: 'square', gain: 0.025 }),
  /** Calm end-of-focus chime. */
  chime: () => {
    [659, 880, 1319].forEach((f, i) =>
      tone(f, 1.8, { gain: 0.09, attack: 0.02, delay: i * 0.35 }),
    );
  },
  /** Recenter / system action. */
  whoosh: () => noise(0.35, 1400, 0.06),
  /** Error / invalid. */
  bonk: () => tone(220, 0.15, { type: 'triangle', slideTo: 160, gain: 0.12 }),
  /** Agent success sparkle. */
  sparkle: () => {
    [1046, 1318, 1568, 2093].forEach((f, i) =>
      tone(f, 0.25, { gain: 0.05, delay: i * 0.06 }),
    );
  },
};

/**
 * Ambient bed (soft filtered noise). `level` 0..1 maps focus level to a
 * quieter, darker sound: higher focus, calmer room.
 */
export function setAmbient(level: number): void {
  const a = audio();
  if (!a || !master) return;
  if (!ambient) {
    const len = a.sampleRate * 4;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown noise: soft, rain-like.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const src = a.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    const gain = a.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    ambient = { gain, filter };
  }
  const t = a.currentTime;
  const l = Math.max(0, Math.min(1, level));
  ambient.gain.gain.setTargetAtTime(0.04 + 0.1 * l, t, 0.4);
  ambient.filter.frequency.setTargetAtTime(1600 - 1200 * l, t, 0.4);
}
