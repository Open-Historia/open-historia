/*! Open Historia — the microphone's three-second rule © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/speechSilence.test.js
//
// The clock is mocked and stepped a block at a time, the way a turn really
// passes (mock timers fire an interval once per tick, not once per period).

import test from "node:test";
import assert from "node:assert/strict";

import { LONGEST_TURN_MS, NO_SPEECH_GIVE_UP_MS, SILENCE_TO_SEND_MS, createEnergyVad, createSilenceWatch, rmsLevel, silenceVerdict } from "./speechSilence.js";
import { createResampler } from "./speechCapture.js";

const step = (timers, ms, every = 100) => {
  for (let passed = 0; passed < ms; passed += every) timers.tick(every);
};

const clock = (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  return t.mock.timers;
};

test("the verdict: three seconds after the last word sends, silence before any word does not", () => {
  assert.equal(SILENCE_TO_SEND_MS, 3000);
  assert.equal(silenceVerdict({ startedAt: 0, lastSpeechAt: 1000, now: 3999 }), null);
  assert.equal(silenceVerdict({ startedAt: 0, lastSpeechAt: 1000, now: 4000 }), "send");
  assert.equal(silenceVerdict({ startedAt: 0, lastSpeechAt: null, now: 10000 }), null);
  assert.equal(silenceVerdict({ startedAt: 0, lastSpeechAt: null, now: NO_SPEECH_GIVE_UP_MS }), "give-up");
  // A turn that never pauses is cut off and sent.
  assert.equal(silenceVerdict({ startedAt: 0, lastSpeechAt: LONGEST_TURN_MS - 10, now: LONGEST_TURN_MS }), "send");
});

test("a turn sends three seconds after the player stops speaking, and not before", (t) => {
  const timers = clock(t);
  const verdicts = [];
  const watch = createSilenceWatch({ onVerdict: (verdict) => verdicts.push(verdict) });
  // Two seconds of thinking first: nothing happens.
  step(timers, 2000);
  assert.deepEqual(verdicts, []);
  // Speech for two seconds, with a 1.5 s pause in the middle that must not send.
  for (let i = 0; i < 10; i += 1) { watch.heard(); step(timers, 100); }
  step(timers, 1500);
  assert.deepEqual(verdicts, []);
  for (let i = 0; i < 10; i += 1) { watch.heard(); step(timers, 100); }
  assert.ok(watch.spoke);
  // 2.9 s of silence: still listening. 3 s: sent, once.
  step(timers, 2800);
  assert.deepEqual(verdicts, []);
  step(timers, 300);
  assert.deepEqual(verdicts, ["send"]);
  step(timers, 5000);
  assert.deepEqual(verdicts, ["send"]);
});

test("a turn that hears nothing gives up instead of holding the microphone open", (t) => {
  const timers = clock(t);
  const verdicts = [];
  const watch = createSilenceWatch({ onVerdict: (verdict) => verdicts.push(verdict) });
  step(timers, NO_SPEECH_GIVE_UP_MS - 200);
  assert.deepEqual(verdicts, []);
  step(timers, 400);
  assert.deepEqual(verdicts, ["give-up"]);
  assert.equal(watch.spoke, false);
});

test("a stopped watch never fires", (t) => {
  const timers = clock(t);
  const verdicts = [];
  const watch = createSilenceWatch({ onVerdict: (verdict) => verdicts.push(verdict) });
  watch.heard();
  watch.stop();
  step(timers, 10000);
  assert.deepEqual(verdicts, []);
});

test("voice activity: a voice over a quiet room is speech, the room and a steady hum are not", () => {
  const vad = createEnergyVad();
  for (let i = 0; i < 20; i += 1) assert.equal(vad(0.003), false);
  assert.equal(vad(0.08), true);
  assert.equal(vad(0.05), true);
  assert.equal(vad(0.004), false);
  // A fan that never stops: once it fills the window it sets the bar.
  const fan = createEnergyVad();
  const heard = [];
  for (let i = 0; i < 60; i += 1) heard.push(fan(0.03));
  assert.equal(heard.slice(-30).some(Boolean), false);
  assert.equal(fan(0.15), true);
});

test("the level of a block", () => {
  assert.equal(rmsLevel(new Float32Array(0)), 0);
  assert.equal(rmsLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5])), 0.5);
});

test("resampling to 16 kHz keeps the length and the signal across blocks", () => {
  const resample = createResampler(48000, 16000);
  let total = 0;
  const out = [];
  for (let b = 0; b < 10; b += 1) {
    const block = Float32Array.from({ length: 480 }, (_, i) => Math.sin(((b * 480 + i) / 48000) * 2 * Math.PI * 200));
    const chunk = resample(block);
    total += chunk.length;
    out.push(...chunk);
  }
  assert.equal(total, 1600);
  // A 200 Hz tone stays a 200 Hz tone (one input sample behind, from the carry).
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(Math.abs(out[i] - Math.sin((i / 16000 - 1 / 48000) * 2 * Math.PI * 200)) < 0.01, `sample ${i}`);
  }
  const same = createResampler(16000, 16000);
  const block = new Float32Array(8);
  assert.equal(same(block), block);
});
