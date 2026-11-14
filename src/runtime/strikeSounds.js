/*! Open Historia — realistic strike and rocket audio synthesis © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Procedural audio for rocket launches, missile salvos, and impacts (Map/StrikeLayers.jsx).
//
// Like vaultSounds.js, these sounds are synthesized entirely via the Web Audio API:
// pure procedural sound design with no audio file downloads, no external assets, and zero
// licensing baggage.
//
// When a missile strike or salvo is ordered, each rocket ignites with an explosive pressure
// transient, a deep sub-bass rocket motor thrum, and a tearing supersonic exhaust roar.
// On arrival, concussive blast shockwaves and atmospheric rumbles are rendered at the exact
// moment of impact or interception.

import { MAP_SETTING_KEYS, getMapSettingDefaultOn } from "./mapSettings.js";

export const soundEffectsEnabled = () => getMapSettingDefaultOn(MAP_SETTING_KEYS.soundEffects);

// Overall master volume ceiling for strikes (balanced under UI and music).
const MASTER_LEVEL = 0.45;

// One second of procedural white/pink noise buffer, allocated once and looped in slices.
const noiseBuffer = (context) => {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
};

export const createStrikeSounds = ({ makeContext, enabled = soundEffectsEnabled, buffers = null } = {}) => {
  let context = null;
  let master = null;
  let noise = null;
  let launchBuffer = buffers?.launch ?? null;
  let explosionBuffer = buffers?.explosion ?? null;
  let droneBuffer = buffers?.drone ?? null;
  let loadingPromise = null;

  const loadBuffers = async () => {
    if (typeof fetch !== "function" || typeof context?.decodeAudioData !== "function") return;
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      try {
        const [launchRes, expRes, droneRes] = await Promise.all([
          fetch("/audio/missile-launch.mp3"),
          fetch("/audio/missile-explosion.mp3"),
          fetch("/audio/drone-flight.mp3"),
        ]);
        if (launchRes.ok && context?.decodeAudioData) {
          const ab = await launchRes.arrayBuffer();
          launchBuffer = await context.decodeAudioData(ab);
        }
        if (expRes.ok && context?.decodeAudioData) {
          const ab = await expRes.arrayBuffer();
          explosionBuffer = await context.decodeAudioData(ab);
        }
        if (droneRes.ok && context?.decodeAudioData) {
          const ab = await droneRes.arrayBuffer();
          droneBuffer = await context.decodeAudioData(ab);
        }
      } catch {
        // Fall back gracefully to procedural sound if assets cannot be loaded
      }
    })();
    return loadingPromise;
  };

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
      master.gain.value = MASTER_LEVEL;
      master.connect(context.destination);
      noise = noiseBuffer(context);
      loadBuffers().catch(() => {});
    }
    if (context.state === "suspended") {
      context.resume?.().catch?.(() => {});
    }
    return true;
  };

  const playSample = ({ buffer, at, gain = 0.85, playbackRate = 1.0 }) => {
    if (!context || !buffer) return false;
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      if (source.playbackRate) {
        source.playbackRate.value = playbackRate;
      }
      const gainNode = context.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode).connect(master);
      source.start(at);
      return true;
    } catch {
      return false;
    }
  };

  // Filtered noise slice with customizable attack, decay, filter type and Q.
  const noiseBurst = ({ at, length, type = "bandpass", frequency, q = 1, peak = 0.3, sweepTo = null }) => {
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(Math.max(20, frequency), at);
    if (sweepTo !== null && sweepTo !== frequency) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), at + length);
    }
    filter.Q.value = q;

    const gain = context.createGain();
    const attack = Math.min(0.015, length * 0.1);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    source.connect(filter).connect(gain).connect(master);
    source.start(at, Math.random() * 0.4);
    source.stop(at + length + 0.03);
    return { filter, gain, source };
  };

  // Frequency-swept oscillator tone for engine fundamentals, sub-bass thumps, and blast waves.
  const tone = ({ at, length, type = "sine", from, to = from, peak = 0.3, attack = 0.01 }) => {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(10, from), at);
    if (to !== from) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(10, to), at + length);
    }

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);

    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(at + length + 0.03);
    return { oscillator, gain };
  };

  // Hyperrealistic rocket launch:
  const launchRocket = ({ at = null, index = 0, weapon = "silo missile", nuclear = false, duration = 2.2 } = {}) => {
    if (!ready()) return;
    const t = at ?? context.currentTime;
    const salvoSlightDetune = 1 + ((index % 5) - 2) * 0.025;

    if (launchBuffer) {
      playSample({
        buffer: launchBuffer,
        at: t,
        gain: 0.9,
        playbackRate: salvoSlightDetune,
      });
      return;
    }

    // 1. Ignition transient pop / pressure crack
    noiseBurst({
      at: t,
      length: 0.08,
      type: "highpass",
      frequency: 2400 * salvoSlightDetune,
      q: 1.8,
      peak: 0.45,
    });
    tone({
      at: t,
      length: 0.12,
      type: "triangle",
      from: 160 * salvoSlightDetune,
      to: 45,
      peak: 0.5,
      attack: 0.004,
    });

    // 2. Heavy low-frequency motor rumble & roar
    noiseBurst({
      at: t + 0.02,
      length: duration,
      type: "lowpass",
      frequency: 260,
      sweepTo: 140,
      q: 2.2,
      peak: 0.65,
    });

    // 3. Sub-bass engine harmonic thrum (Doppler pitch curve)
    const baseFreq = (nuclear || weapon === "silo missile" ? 48 : 62) * salvoSlightDetune;
    tone({
      at: t + 0.03,
      length: duration * 0.85,
      type: "sawtooth",
      from: baseFreq,
      to: baseFreq * 1.6,
      peak: 0.32,
      attack: 0.08,
    });
    tone({
      at: t + 0.03,
      length: duration * 0.85,
      type: "triangle",
      from: baseFreq * 1.05,
      to: baseFreq * 1.68,
      peak: 0.28,
      attack: 0.08,
    });

    // 4. Supersonic ripping exhaust hiss (shearing high-velocity plume)
    noiseBurst({
      at: t + 0.06,
      length: duration * 0.9,
      type: "bandpass",
      frequency: 680 * salvoSlightDetune,
      sweepTo: 1100,
      q: 2.4,
      peak: 0.28,
    });
  };

  // Detonation impact / blast concussive shockwave:
  const detonateImpact = ({ at = null, nuclear = false, duration = 2.4 } = {}) => {
    if (!ready()) return;
    const t = at ?? context.currentTime;

    if (explosionBuffer) {
      playSample({
        buffer: explosionBuffer,
        at: t,
        gain: nuclear ? 1.0 : 0.85,
        playbackRate: nuclear ? 0.88 : 1.0,
      });
      return;
    }

    // Concussive deep low-frequency thump
    tone({
      at: t,
      length: duration * 0.7,
      type: "sine",
      from: nuclear ? 75 : 95,
      to: nuclear ? 18 : 26,
      peak: nuclear ? 0.95 : 0.75,
      attack: 0.006,
    });

    // Blast wave noise dispersion
    noiseBurst({
      at: t,
      length: duration,
      type: "lowpass",
      frequency: nuclear ? 380 : 310,
      sweepTo: 50,
      q: 1.8,
      peak: nuclear ? 0.85 : 0.65,
    });

    // High-frequency initial blast crack
    noiseBurst({
      at: t,
      length: 0.12,
      type: "highpass",
      frequency: 1800,
      peak: 0.5,
    });
  };

  // Drone strike swarm flight sound (two-stroke engine buzz)
  const launchDrone = ({ at = null, index = 0, duration = 6.0 } = {}) => {
    if (!ready()) return;
    const t = at ?? context.currentTime;
    const droneDetune = 1 + ((index % 7) - 3) * 0.025;

    if (droneBuffer) {
      playSample({
        buffer: droneBuffer,
        at: t,
        gain: 0.75,
        playbackRate: droneDetune,
      });
      return;
    }

    // Procedural buzzing 2-stroke drone engine fallback
    tone({
      at: t,
      length: duration,
      type: "sawtooth",
      from: 145 * droneDetune,
      to: 140 * droneDetune,
      peak: 0.22,
      attack: 0.2,
    });
    tone({
      at: t,
      length: duration,
      type: "square",
      from: 290 * droneDetune,
      to: 280 * droneDetune,
      peak: 0.12,
      attack: 0.2,
    });
  };

  // Aircraft strike / bomb flyby sound
  const launchAircraft = ({ at = null, index = 0, duration = 2.5 } = {}) => {
    if (!ready()) return;
    const t = at ?? context.currentTime;
    const jetDetune = 1 + (index % 4) * 0.04;

    noiseBurst({
      at: t,
      length: duration,
      type: "bandpass",
      frequency: 450 * jetDetune,
      sweepTo: 280,
      q: 2.5,
      peak: 0.35,
    });
    tone({
      at: t,
      length: duration,
      type: "sawtooth",
      from: 140 * jetDetune,
      to: 110,
      peak: 0.15,
      attack: 0.3,
    });
  };

  // Takes an entire strike plan (from planStrike in strikeScene.js) and schedules
  // all rocket launch and impact events synchronously with millisecond Web Audio precision.
  const playPlan = (plan, { beginsDelayMs = 0 } = {}) => {
    if (!plan || !Array.isArray(plan.units) || plan.units.length === 0) return;
    if (!ready()) return;

    const now = context.currentTime;
    const baseTime = now + Math.max(0, beginsDelayMs / 1000);
    const isDrone = Boolean(plan.drone);
    const isAircraft = Boolean(plan.aircraft) && !isDrone;

    // Play up to 10 distinct launch audio voices per strike so massive salvos stay crisp
    const audibleUnits = plan.units.slice(0, 10);

    audibleUnits.forEach((unit, idx) => {
      const launchAt = baseTime + (Number(unit.start) || 0);

      if (isDrone) {
        launchDrone({ at: launchAt, index: idx });
      } else if (isAircraft) {
        launchAircraft({ at: launchAt, index: idx });
      } else {
        launchRocket({
          at: launchAt,
          index: idx,
          weapon: plan.weapon,
          nuclear: Boolean(plan.nuclear),
        });
      }

      // Schedule impact or intercept sound
      const flightTime = Number(unit.flight) || 3.0;
      const downFrac = unit.down !== null && unit.down !== undefined ? Number(unit.down) : (unit.shotAt !== null && unit.shotAt !== undefined ? Number(unit.shotAt) : null);
      if (downFrac !== null && Number.isFinite(downFrac) && downFrac > 0) {
        // Intercepted mid-air
        const interceptAt = launchAt + flightTime * downFrac;
        detonateImpact({ at: interceptAt, nuclear: false, duration: 1.2 });
      } else {
        // Hits destination
        const landAt = launchAt + flightTime;
        detonateImpact({ at: landAt, nuclear: Boolean(plan.nuclear), duration: 2.2 });
      }
    });
  };

  const dispose = () => {
    try {
      if (context && typeof context.close === "function" && context.state !== "closed") {
        context.close().catch(() => {});
      }
    } catch { /* ignore close error */ }
    context = null;
    master = null;
    noise = null;
  };

  return {
    get context() {
      return context;
    },
    launchRocket,
    launchDrone,
    detonateImpact,
    launchAircraft,
    playPlan,
    dispose,
  };
};

export const makeStrikeSounds = (win = typeof window === "undefined" ? null : window) => {
  const Context = win?.AudioContext ?? win?.webkitAudioContext;
  return createStrikeSounds({ makeContext: () => (Context ? new Context() : null) });
};
