/*! Open Historia — the vault door's sounds © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The sounds of the vault door the app opens on (GameUI/VaultDoor.jsx): the
// rattle when it shakes to be clicked, the ratchet of the wheel turning, the
// bolts drawing back, and the three leaves of the door grinding apart.
//
// They are MADE here, not played from files: noise and a few tones shaped by
// the Web Audio API. That keeps them the project's own (no licence to carry
// and no credit to owe) and adds nothing to the download.
//
// A browser lets a page make no sound before the player's first click, and
// the door is on screen before that: until then a sound asked for is simply
// not heard (the context stays suspended), and the click on the door is what
// lets the rest sound. The desktop app allows sound from the start, so there
// the rattle is heard too.

import { MAP_SETTING_KEYS, getMapSettingDefaultOn } from "./mapSettings.js";

export const soundEffectsEnabled = () => getMapSettingDefaultOn(MAP_SETTING_KEYS.soundEffects);

// How loud the door is, of full: under the music, never over a voice call.
const LEVEL = 0.5;

// One second of noise, made once and played in slices.
const noiseBuffer = (context) => {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
};

// `makeContext` makes an AudioContext (or a stand-in under test); `enabled`
// says whether sound effects are on now. Every method is safe to call when
// there is no audio at all: it does nothing.
export const createVaultSounds = ({ makeContext, enabled = soundEffectsEnabled } = {}) => {
  let context = null;
  let master = null;
  let noise = null;

  const ready = () => {
    if (!enabled()) return false;
    if (!context) {
      try {
        context = makeContext();
      } catch {
        context = null;
      }
      if (!context) return false;
      master = context.createGain();
      master.gain.value = LEVEL;
      master.connect(context.destination);
      noise = noiseBuffer(context);
    }
    // Suspended until the first gesture: asked to resume at every sound, which
    // costs nothing once it is running.
    if (context.state === "suspended") context.resume?.().catch?.(() => {});
    return true;
  };

  // A slice of noise through a filter, with a sharp attack and a decay.
  const hiss = ({ at, length, type, frequency, q = 1, peak }) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.006, length / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(master);
    source.start(at, Math.random() * 0.5);
    source.stop(at + length + 0.02);
    return { filter, gain };
  };

  // A tone that falls (or holds) and dies away.
  const tone = ({ at, length, type = "sine", from, to = from, peak }) => {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
  };

  // One tooth of the ratchet.
  const click = (at, peak = 0.5) => {
    hiss({ at, length: 0.022, type: "highpass", frequency: 1800, peak });
    tone({ at, length: 0.03, type: "square", from: 1250, to: 700, peak: peak * 0.18 });
  };

  return {
    // The door shudders on its bolts: three loose knocks and a low thud.
    rattle: () => {
      if (!ready()) return;
      const now = context.currentTime;
      for (const [offset, peak] of [[0, 0.35], [0.07, 0.28], [0.15, 0.22]]) {
        hiss({ at: now + offset, length: 0.05, type: "bandpass", frequency: 2400, q: 4, peak });
        tone({ at: now + offset, length: 0.09, type: "triangle", from: 420, to: 300, peak: peak * 0.25 });
      }
      tone({ at: now, length: 0.28, from: 95, to: 60, peak: 0.3 });
    },

    // The wheel turns: a ratchet that starts quick and slows as it comes home,
    // over a low whirr. `seconds` is how long the wheel takes.
    spin: (seconds = 1.5) => {
      if (!ready()) return;
      const now = context.currentTime;
      let at = 0;
      let gap = 0.045;
      while (at < seconds - 0.05) {
        click(now + at, 0.42);
        at += gap;
        gap *= 1.045;
      }
      const whirr = hiss({ at: now, length: seconds, type: "bandpass", frequency: 520, q: 1.2, peak: 0.12 });
      whirr.filter.frequency.exponentialRampToValueAtTime(260, now + seconds);
    },

    // The bolts draw back: a heavy clunk, and the ring of struck steel.
    unlock: () => {
      if (!ready()) return;
      const now = context.currentTime;
      tone({ at: now, length: 0.42, from: 150, to: 42, peak: 0.9 });
      hiss({ at: now, length: 0.18, type: "lowpass", frequency: 420, peak: 0.7 });
      tone({ at: now + 0.01, length: 0.6, type: "triangle", from: 930, to: 900, peak: 0.1 });
      tone({ at: now + 0.012, length: 0.45, type: "triangle", from: 1410, to: 1380, peak: 0.05 });
    },

    // The three leaves pull apart: the seal lets go with a hiss, stone and
    // steel grind for as long as they move, and they come to rest with a boom.
    open: (seconds = 1.8) => {
      if (!ready()) return;
      const now = context.currentTime;
      hiss({ at: now, length: 0.5, type: "highpass", frequency: 3200, peak: 0.16 });
      // The grind: low noise that swells and falls, with a scrape above it.
      const rumble = context.createBufferSource();
      rumble.buffer = noise;
      rumble.loop = true;
      const low = context.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 170;
      const swell = context.createGain();
      swell.gain.setValueAtTime(0.0001, now);
      swell.gain.exponentialRampToValueAtTime(0.9, now + seconds * 0.3);
      swell.gain.exponentialRampToValueAtTime(0.5, now + seconds * 0.85);
      swell.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.25);
      rumble.connect(low).connect(swell).connect(master);
      rumble.start(now);
      rumble.stop(now + seconds + 0.3);
      const scrape = hiss({ at: now + 0.05, length: seconds, type: "bandpass", frequency: 850, q: 2.5, peak: 0.1 });
      scrape.filter.frequency.exponentialRampToValueAtTime(520, now + seconds);
      // Home, against their stops.
      tone({ at: now + seconds, length: 0.7, from: 78, to: 38, peak: 0.85 });
      hiss({ at: now + seconds, length: 0.25, type: "lowpass", frequency: 300, peak: 0.5 });
    },

    // Lets go of the audio once the door is gone.
    dispose: () => {
      const old = context;
      context = null;
      master = null;
      noise = null;
      try { old?.close?.(); } catch { /* already closed */ }
    },
    get context() { return context; },
  };
};

// The page's own: null where there is no Web Audio (a test, an old browser).
export const makeVaultSounds = (win = typeof window === "undefined" ? null : window) => {
  const Context = win?.AudioContext ?? win?.webkitAudioContext;
  return createVaultSounds({ makeContext: () => (Context ? new Context() : null) });
};
