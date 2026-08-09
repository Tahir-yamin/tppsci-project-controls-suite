// Synthesises the demo reel's backing track from scratch and writes a WAV.
//
//   node tools/make-music.mjs [seconds] [outfile]
//
// The track is generated rather than sourced so the reel carries no third-party
// licence: an A-minor pad progression, an arpeggio that enters once the app is
// on screen, and a soft pulse, arranged to the walkthrough's own beats.
import { writeFileSync } from 'node:fs';

const SR = 44100;
const DUR = Number(process.argv[2] || 56);
const OUT = process.argv[3] || '.demo-music.wav';
const N = Math.floor(SR * DUR);

const L = new Float64Array(N);
const R = new Float64Array(N);

const semitone = (n) => 440 * Math.pow(2, n / 12); // n = semitones from A4
// A minor: Am - F - Cmaj - G, two seconds per chord.
const PROG = [
  [-12, -5, 0],   // Am   A  D? -> A, E, A(oct) voicing below
  [-16, -9, -4],  // F
  [-9, -5, 0],    // C
  [-14, -7, -2],  // G
];
const CHORD_LEN = 2.0;

/** One-pole lowpass, used to keep the pad soft and the noise-based perc dull. */
function makeLP(cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / SR);
  let z = 0;
  return (x) => (z = x * (1 - a) + z * a);
}

/** Simple ADSR envelope value at time t within a note of length `len`. */
function env(t, len, a, d, s, r) {
  if (t < 0 || t > len) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len - r) return s;
  return s * Math.max(0, (len - t) / r);
}

/** Smooth 0..1 ramp, for section fades. */
const ramp = (t, from, to) => Math.max(0, Math.min(1, (t - from) / (to - from)));

const padLP = makeLP(1800);
const arpLP = makeLP(3200);

// --- pad -------------------------------------------------------------------
/** Sum of one chord's voices at absolute time t. */
function voices(chord, t) {
  let v = 0;
  for (const n of chord) {
    const f = semitone(n);
    // Two slightly detuned tones per note give the pad some width.
    v += Math.sin(2 * Math.PI * f * t) * 0.5;
    v += Math.sin(2 * Math.PI * f * 1.002 * t) * 0.35;
    v += Math.sin(2 * Math.PI * f * 2 * t) * 0.12;
  }
  return v / chord.length;
}

// Chords are crossfaded rather than switched: an instant change mid-waveform is
// a discontinuity, which is audible as a click on every bar line.
const XFADE = 0.14; // fraction of a chord spent blending out of the previous one
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const idx = Math.floor(t / CHORD_LEN);
  const x = (t % CHORD_LEN) / CHORD_LEN;
  const cur = PROG[idx % PROG.length];

  let v = voices(cur, t);
  if (x < XFADE && idx > 0) {
    const prev = PROG[(idx - 1) % PROG.length];
    const a = 0.5 * (1 - Math.cos((Math.PI * x) / XFADE)); // raised cosine, 0 → 1
    v = voices(prev, t) * (1 - a) + v * a;
  }

  // Gentle swell across each chord so the bed breathes instead of sitting flat.
  const swell = 0.72 + 0.28 * Math.sin(Math.PI * x);
  v = padLP(v) * swell * 0.28;

  L[i] += v;
  R[i] += v * 0.96;
}

// --- sub bass: root of each chord ------------------------------------------
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const idx = Math.floor(t / CHORD_LEN) % PROG.length;
  const f = semitone(PROG[idx][0] - 12);
  const e = env(t % CHORD_LEN, CHORD_LEN, 0.05, 0.3, 0.75, 0.35);
  const v = Math.sin(2 * Math.PI * f * t) * e * 0.3 * ramp(t, 2.5, 5);
  L[i] += v;
  R[i] += v;
}

// --- arpeggio: enters when the app appears, lifts for the simulation --------
const ARP_START = 3.4;
const STEP = 0.25;
const PATTERN = [0, 2, 1, 2]; // index into the chord
for (let s = 0; s * STEP < DUR; s++) {
  const t0 = s * STEP;
  if (t0 < ARP_START) continue;
  const chord = PROG[Math.floor(t0 / CHORD_LEN) % PROG.length];
  const note = chord[PATTERN[s % PATTERN.length]] + 12;
  const f = semitone(note);
  const len = 0.42;
  // Louder from the Monte Carlo section on, easing back for the end card.
  const lift = 0.75 + 0.35 * ramp(t0, 28, 33) - 0.35 * ramp(t0, 48, 52);
  const gain = 0.12 * ramp(t0, ARP_START, ARP_START + 2.5) * lift;

  for (let k = 0; k < len * SR && Math.floor(t0 * SR) + k < N; k++) {
    const i = Math.floor(t0 * SR) + k;
    const tt = k / SR;
    const e = env(tt, len, 0.004, 0.10, 0.30, 0.28);
    const v = arpLP(Math.sin(2 * Math.PI * f * (t0 + tt)) * 0.8 +
                    Math.sin(2 * Math.PI * f * 2 * (t0 + tt)) * 0.18) * e * gain;
    // Ping-pong the arpeggio gently across the stereo field.
    const pan = s % 2 ? 0.62 : 0.38;
    L[i] += v * (1 - pan);
    R[i] += v * pan;
  }
}

// --- pulse: soft kick on the beat, brushed tick offbeat ---------------------
const BEAT = 0.5;
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT;
  const on = ramp(t0, 8, 11) * (1 - ramp(t0, 50, 53));
  if (on <= 0) continue;
  const start = Math.floor(t0 * SR);

  // Kick: pitch-dropping sine.
  for (let k = 0; k < 0.16 * SR && start + k < N; k++) {
    const tt = k / SR;
    const f = 110 * Math.exp(-tt * 26) + 44;
    const v = Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 16) * 0.34 * on;
    L[start + k] += v;
    R[start + k] += v;
  }

  // Tick: filtered noise on the offbeat.
  const tickStart = Math.floor((t0 + BEAT / 2) * SR);
  const tickLP = makeLP(7000);
  for (let k = 0; k < 0.05 * SR && tickStart + k < N; k++) {
    const tt = k / SR;
    const v = tickLP((Math.random() * 2 - 1)) * Math.exp(-tt * 90) * 0.05 * on;
    L[tickStart + k] += v * 1.1;
    R[tickStart + k] += v * 0.9;
  }
}

// --- a little space: short feedback delay ----------------------------------
const DELAY = Math.floor(0.28 * SR);
for (let i = DELAY; i < N; i++) {
  L[i] += R[i - DELAY] * 0.20;
  R[i] += L[i - DELAY] * 0.17;
}

// --- master: fades, soft clip, normalise -----------------------------------
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(ramp(t, 0, 1.4), 1 - ramp(t, DUR - 3.2, DUR));
  L[i] = Math.tanh(L[i] * 1.05) * fade;
  R[i] = Math.tanh(R[i] * 1.05) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
// Leave headroom: this sits under captions as a bed, it is not the subject.
const norm = peak > 0 ? 0.72 / peak : 1;

// --- write 16-bit stereo WAV ------------------------------------------------
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);   // PCM
buf.writeUInt16LE(2, 22);   // stereo
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4);
}
writeFileSync(OUT, buf);
console.log(`${OUT} — ${DUR}s, ${SR} Hz stereo`);
