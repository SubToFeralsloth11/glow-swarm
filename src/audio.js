// Tiny WebAudio synth: procedural sound effects and a generative music loop.
// No audio files, so the game stays small and fully offline.

let ctx = null;
let master, sfxBus, musicBus;
const lastPlayed = new Map();
let gemStreak = 0;
let gemStreakAt = 0;
let musicOn = false;
let musicTimer = null;
let nextBeat = 0;
let beat = 0;
let musicHue = 0;

export const audio = { sound: true, music: true };

export function unlockAudio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.55;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.22;
    musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

function tone({ type = 'sine', f0, f1 = f0, dur = 0.1, vol = 0.3, when = 0, bus = sfxBus }) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise({ dur = 0.2, vol = 0.3, freq = 1200, when = 0, bus = sfxBus }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t);
  src.stop(t + dur);
}

// Minimum spacing (ms) per sound so 200 simultaneous hits don't clip.
const THROTTLE = { shoot: 70, hit: 45, kill: 40, gem: 35, coin: 50, zap: 80, boom: 60, missile: 120 };

export function sfx(name) {
  if (!ctx || !audio.sound || ctx.state !== 'running') return;
  const now = performance.now();
  const th = THROTTLE[name];
  if (th) {
    if (now - (lastPlayed.get(name) || 0) < th) return;
    lastPlayed.set(name, now);
  }
  switch (name) {
    case 'shoot': tone({ type: 'square', f0: 880, f1: 440, dur: 0.05, vol: 0.05 }); break;
    case 'hit': tone({ type: 'triangle', f0: 300, f1: 160, dur: 0.05, vol: 0.08 }); break;
    case 'kill': tone({ type: 'square', f0: 520, f1: 90, dur: 0.09, vol: 0.07 }); break;
    case 'bigkill': noise({ dur: 0.5, vol: 0.4, freq: 2400 }); tone({ type: 'sawtooth', f0: 200, f1: 40, dur: 0.5, vol: 0.2 }); break;
    case 'gem': {
      gemStreak = now - gemStreakAt < 400 ? Math.min(gemStreak + 1, 24) : 0;
      gemStreakAt = now;
      const f = 660 * Math.pow(2, gemStreak / 12);
      tone({ type: 'sine', f0: f, f1: f * 1.5, dur: 0.07, vol: 0.09 });
      break;
    }
    case 'coin': tone({ type: 'square', f0: 988, dur: 0.05, vol: 0.06 }); tone({ type: 'square', f0: 1319, dur: 0.12, vol: 0.06, when: 0.05 }); break;
    case 'heal': [523, 659, 784].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.15, vol: 0.12, when: i * 0.06 })); break;
    case 'zap': noise({ dur: 0.12, vol: 0.2, freq: 6000 }); tone({ type: 'sawtooth', f0: 1400, f1: 300, dur: 0.1, vol: 0.06 }); break;
    case 'nova': tone({ type: 'sine', f0: 180, f1: 50, dur: 0.35, vol: 0.35 }); noise({ dur: 0.25, vol: 0.15, freq: 900 }); break;
    case 'missile': tone({ type: 'sawtooth', f0: 200, f1: 600, dur: 0.15, vol: 0.05 }); break;
    case 'boom': noise({ dur: 0.3, vol: 0.25, freq: 1600 }); break;
    case 'hurt': tone({ type: 'sawtooth', f0: 220, f1: 70, dur: 0.22, vol: 0.25 }); noise({ dur: 0.15, vol: 0.2, freq: 800 }); break;
    case 'levelup': [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.2, vol: 0.16, when: i * 0.07 })); break;
    case 'chest': [392, 523, 659, 784, 1047].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.16, vol: 0.08, when: i * 0.06 })); break;
    case 'vacuum': tone({ type: 'sine', f0: 200, f1: 1600, dur: 0.5, vol: 0.15 }); break;
    case 'warn': [0, 0.25].forEach((w) => tone({ type: 'square', f0: 440, f1: 330, dur: 0.18, vol: 0.1, when: w })); break;
    case 'boss': tone({ type: 'sawtooth', f0: 110, f1: 55, dur: 1.4, vol: 0.3 }); tone({ type: 'sawtooth', f0: 116, f1: 58, dur: 1.4, vol: 0.25 }); break;
    case 'bossfire': tone({ type: 'square', f0: 300, f1: 120, dur: 0.2, vol: 0.12 }); break;
    case 'revive': [262, 392, 523, 784].forEach((f, i) => tone({ type: 'sine', f0: f, dur: 0.4, vol: 0.18, when: i * 0.08 })); break;
    case 'death': tone({ type: 'sawtooth', f0: 400, f1: 40, dur: 1.2, vol: 0.3 }); noise({ dur: 0.8, vol: 0.3, freq: 1200 }); break;
    case 'victory': [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.35, vol: 0.18, when: i * 0.1 })); break;
    case 'click': tone({ type: 'triangle', f0: 700, dur: 0.04, vol: 0.08 }); break;
    case 'buy': [659, 988].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.1, vol: 0.08, when: i * 0.07 })); break;
    case 'deny': tone({ type: 'square', f0: 160, dur: 0.15, vol: 0.1 }); break;
  }
}

// ---------- music: minor-key arpeggio + bass, scheduled ahead of time ----------
const SCALES = [
  [0, 3, 7, 10, 12, 15, 19, 22],
  [0, 2, 3, 7, 8, 12, 14, 15],
  [0, 1, 5, 7, 8, 12, 13, 17],
];
const PROG = [0, -4, -2, -5];

function scheduleMusic() {
  if (!ctx || !musicOn) return;
  const spb = 60 / 128 / 2; // eighth notes at 128 bpm
  while (nextBeat < ctx.currentTime + 0.2) {
    const bar = Math.floor(beat / 8) % PROG.length;
    const root = 45 + PROG[bar];
    const scale = SCALES[musicHue % SCALES.length];
    const when = nextBeat - ctx.currentTime;
    if (beat % 8 === 0 || beat % 8 === 3 || beat % 8 === 6) {
      tone({ type: 'sawtooth', f0: midi(root - 12), dur: spb * 1.8, vol: 0.18, when, bus: musicBus });
    }
    const idx = [0, 2, 4, 6, 7, 6, 4, 2][beat % 8] + (Math.floor(beat / 32) % 2);
    tone({ type: 'triangle', f0: midi(root + 12 + scale[idx % scale.length]), dur: spb * 0.9, vol: 0.09, when, bus: musicBus });
    if (beat % 4 === 0) noise({ dur: 0.08, vol: 0.05, freq: 300, when, bus: musicBus });
    nextBeat += spb;
    beat++;
  }
}

function midi(n) {
  return 440 * Math.pow(2, (n - 69) / 12);
}

export function startMusic(stageIdx = 0) {
  musicHue = stageIdx;
  if (!ctx || !audio.music || musicOn) return;
  musicOn = true;
  nextBeat = ctx.currentTime + 0.1;
  musicTimer = setInterval(scheduleMusic, 50);
}

export function stopMusic() {
  musicOn = false;
  clearInterval(musicTimer);
  musicTimer = null;
}
