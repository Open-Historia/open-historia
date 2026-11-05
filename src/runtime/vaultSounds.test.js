import assert from "node:assert/strict";
import test from "node:test";
import { createVaultSounds, makeVaultSounds } from "./vaultSounds.js";

// A stand-in for the Web Audio context that writes down what was asked of it.
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
  const sounds = createVaultSounds({ makeContext: () => { contexts += 1; return fake.context; }, enabled: () => options.enabled ?? true });
  return { sounds, asked: fake.asked, contexts: () => contexts };
};

test("every part of the door has a sound of its own", () => {
  for (const name of ["rattle", "spin", "unlock", "open"]) {
    const { sounds, asked } = soundsWith();
    sounds[name]();
    assert.ok(asked.sources.length + asked.oscillators.length > 0, `${name} makes a sound`);
    for (const voice of [...asked.sources, ...asked.oscillators]) {
      assert.ok(voice.at >= 10, `${name} starts now or later, never in the past`);
      assert.ok(voice.until > voice.at, `${name} ends: nothing is left sounding`);
    }
  }
});

test("the wheel's ratchet lasts as long as the wheel turns, and slows", () => {
  const { sounds, asked } = soundsWith();
  sounds.spin(1.5);
  // Each tooth is a tone; they start quick and come further apart.
  const teeth = asked.oscillators.map((oscillator) => oscillator.at - 10).sort((a, b) => a - b);
  assert.ok(teeth.length > 12);
  assert.ok(teeth.at(-1) < 1.5);
  assert.ok(teeth.at(-1) > 1.2);
  assert.ok(teeth.at(-1) - teeth.at(-2) > teeth[1] - teeth[0]);
});

test("the leaves' grind lasts as long as they move, and ends on their stops", () => {
  const { sounds, asked } = soundsWith();
  sounds.open(1.8);
  const latestStart = Math.max(...asked.oscillators.map((oscillator) => oscillator.at));
  assert.equal(latestStart, 11.8);
  assert.ok(Math.max(...asked.sources.map((source) => source.until)) >= 11.8);
});

test("with sound effects off nothing is made, not even the audio", () => {
  const { sounds, asked, contexts } = soundsWith({ enabled: false });
  sounds.rattle();
  sounds.spin();
  sounds.unlock();
  sounds.open();
  assert.equal(contexts(), 0);
  assert.equal(asked.sources.length + asked.oscillators.length, 0);
});

test("audio a browser holds until the first click is asked to carry on at every sound", () => {
  const { sounds, asked } = soundsWith({ state: "suspended" });
  sounds.rattle();
  sounds.unlock();
  assert.equal(asked.resumed, 2);
});

test("one audio for the whole door, let go of when the door is gone", () => {
  const { sounds, asked, contexts } = soundsWith();
  sounds.rattle();
  sounds.spin();
  sounds.open();
  assert.equal(contexts(), 1);
  sounds.dispose();
  assert.equal(asked.closed, 1);
  assert.equal(sounds.context, null);
});

test("where there is no audio at all, the door is silent and nothing throws", () => {
  const none = makeVaultSounds({});
  for (const name of ["rattle", "spin", "unlock", "open", "dispose"]) assert.doesNotThrow(() => none[name]());
  const broken = createVaultSounds({ makeContext: () => { throw new Error("no audio device"); }, enabled: () => true });
  for (const name of ["rattle", "spin", "unlock", "open", "dispose"]) assert.doesNotThrow(() => broken[name]());
});
