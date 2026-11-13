/*! Open Historia — strike sounds tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/strikeSounds.test.js

import assert from "node:assert/strict";
import test from "node:test";
import { createStrikeSounds, makeStrikeSounds } from "./strikeSounds.js";

const fakeContext = ({ state = "running" } = {}) => {
  const asked = { sources: [], oscillators: [], resumed: 0, closed: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const node = (extra = {}) => ({ connect(next) { return next; }, ...extra });
  const context = {
    state,
    currentTime: 10,
    sampleRate: 8000,
    destination: node(),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: "", frequency: param(), Q: param() }),
    createBufferSource: () => {
      const source = node({ buffer: null, loop: false, start(at) { source.at = at; }, stop(at) { source.until = at; } });
      asked.sources.push(source);
      return source;
    },
    createOscillator: () => {
      const oscillator = node({ type: "sine", frequency: param(), start(at) { oscillator.at = at; }, stop(at) { oscillator.until = at; } });
      asked.oscillators.push(oscillator);
      return oscillator;
    },
    resume: () => { asked.resumed += 1; return Promise.resolve(); },
    close: () => { asked.closed += 1; },
  };
  return { context, asked };
};

const soundsWith = (options = {}) => {
  const fake = fakeContext(options);
  let contexts = 0;
  const sounds = createStrikeSounds({
    makeContext: () => { contexts += 1; return fake.context; },
    enabled: () => options.enabled ?? true,
    buffers: options.buffers ?? null,
  });
  return { sounds, asked: fake.asked, contexts: () => contexts };
};

test("launchRocket generates procedural ignition crack, motor roar, and engine thrum", () => {
  const { sounds, asked } = soundsWith();
  sounds.launchRocket({ at: 12 });
  assert.ok(asked.sources.length >= 2, "generates noise burst layers for rocket exhaust and ignition");
  assert.ok(asked.oscillators.length >= 2, "generates dual-oscillator sub-bass Doppler thrum");
  for (const voice of [...asked.sources, ...asked.oscillators]) {
    assert.ok(voice.until > voice.at, "each sound component has a bounded duration");
  }
});

test("detonateImpact generates concussive pressure tone and blast wave", () => {
  const { sounds, asked } = soundsWith();
  sounds.detonateImpact({ at: 15, nuclear: true });
  assert.ok(asked.sources.length >= 1, "generates blast noise");
  assert.ok(asked.oscillators.length >= 1, "generates deep sub-bass thump");
});

test("playPlan schedules audio for units in salvo and their impacts", () => {
  const { sounds, asked } = soundsWith();
  const plan = {
    weapon: "silo missile",
    nuclear: false,
    aircraft: false,
    units: [
      { index: 0, start: 0, flight: 3.5, down: false },
      { index: 1, start: 0.2, flight: 3.5, down: true, shotAt: 0.6 },
    ],
  };

  sounds.playPlan(plan, { beginsDelayMs: 500 });
  // Unit 0 launches at 10 + 0.5 = 10.5, lands at 14.0
  // Unit 1 launches at 10 + 0.5 + 0.2 = 10.7, intercepted at 10.7 + 2.1 = 12.8
  assert.ok(asked.sources.length >= 4, "salvo units and detonations trigger audio");
  assert.ok(asked.oscillators.length >= 4, "salvo units trigger tone components");
});

test("sound disabled makes no audio", () => {
  const { sounds, asked } = soundsWith({ enabled: false });
  sounds.launchRocket();
  sounds.detonateImpact();
  sounds.playPlan({ units: [{ start: 0, flight: 2 }] });
  assert.equal(asked.sources.length, 0);
  assert.equal(asked.oscillators.length, 0);
});

test("launchDrone generates 2-stroke engine buzz tone components", () => {
  const { sounds, asked } = soundsWith();
  sounds.launchDrone({ at: 11, index: 1 });
  assert.ok(asked.oscillators.length >= 2, "generates dual-oscillator buzz for drone engine");
});

test("plays sample buffers for rocket launch and explosion when present", () => {
  const dummyBuffer = {};
  const { sounds, asked } = soundsWith({ buffers: { launch: dummyBuffer, explosion: dummyBuffer } });
  sounds.launchRocket({ at: 10, index: 2 });
  sounds.detonateImpact({ at: 14, nuclear: false });
  assert.equal(asked.sources.length, 2, "plays both sample buffers");
  assert.equal(asked.sources[0].buffer, dummyBuffer);
  assert.equal(asked.sources[1].buffer, dummyBuffer);
  assert.equal(asked.oscillators.length, 0, "sample playback avoids synthetic oscillators");
});

test("dispose cleans up context", () => {
  const { sounds } = soundsWith();
  sounds.launchRocket();
  sounds.dispose();
  assert.equal(sounds.context, null);
});

test("makeStrikeSounds handles headless environments safely", () => {
  const none = makeStrikeSounds({});
  assert.equal(none.context, null);
});

