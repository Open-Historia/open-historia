/*! Open Historia — the Android app rests in the background: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/native/backgroundPause.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { BACKGROUND_POLL_MS, installBackgroundPause, installNativeBackgroundPause } from "./backgroundPause.js";

// A document whose visibility the test sets, and timers the test runs by hand.
const setup = ({ generating = false } = {}) => {
  const listeners = new Set();
  const doc = {
    visibilityState: "visible",
    addEventListener: (type, fn) => { if (type === "visibilitychange") listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === "visibilitychange") listeners.delete(fn); },
  };
  const timers = new Map();
  let nextId = 1;
  const state = { generating, pauses: 0 };
  const stop = installBackgroundPause({
    doc,
    isGenerating: () => state.generating,
    requestPause: () => { state.pauses += 1; },
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
  });
  const show = (visibility) => { doc.visibilityState = visibility; for (const fn of [...listeners]) fn(); };
  // Runs every timer that is due now, and the ones those schedule, `rounds` times.
  const tick = (rounds = 1) => {
    for (let round = 0; round < rounds; round += 1) {
      const due = [...timers.entries()];
      timers.clear();
      for (const [, { fn }] of due) fn();
    }
  };
  return { state, show, tick, timers, stop, listeners };
};

test("hidden with nothing generating: the app is told it can rest", () => {
  const { state, show, tick } = setup();
  show("hidden");
  assert.equal(state.pauses, 0, "not before the check runs");
  tick();
  assert.equal(state.pauses, 1);
  tick(3);
  assert.equal(state.pauses, 1, "once per hidden spell");
});

test("a turn still being written finishes first, then the app rests", () => {
  const { state, show, tick, timers } = setup({ generating: true });
  show("hidden");
  tick(4);
  assert.equal(state.pauses, 0, "no pause while the turn runs");
  assert.equal([...timers.values()][0]?.ms, BACKGROUND_POLL_MS, "it asks again later");
  state.generating = false;
  tick();
  assert.equal(state.pauses, 1);
});

test("coming back before the check runs cancels it", () => {
  const { state, show, tick, timers } = setup({ generating: true });
  show("hidden");
  tick();
  show("visible");
  assert.equal(timers.size, 0);
  state.generating = false;
  tick(3);
  assert.equal(state.pauses, 0);
});

test("every trip to the background asks again", () => {
  const { state, show, tick } = setup();
  show("hidden");
  tick();
  show("visible");
  show("hidden");
  tick();
  assert.equal(state.pauses, 2);
});

test("a throwing busy check or pause call never breaks the page", () => {
  const listeners = new Set();
  const doc = {
    visibilityState: "visible",
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  let run = null;
  installBackgroundPause({
    doc,
    isGenerating: () => { throw new Error("not loaded"); },
    requestPause: () => { throw new Error("no bridge"); },
    setTimer: (fn) => { run = fn; return 1; },
    clearTimer: () => {},
  });
  doc.visibilityState = "hidden";
  for (const fn of listeners) fn();
  assert.doesNotThrow(() => run());
});

test("stopping it removes the listener", () => {
  const { stop, listeners } = setup();
  assert.equal(listeners.size, 1);
  stop();
  assert.equal(listeners.size, 0);
});

test("outside the app it does nothing", () => {
  assert.equal(typeof installNativeBackgroundPause(() => false), "function");
});

test("the app wires both halves: the page calls OhBackground.idle, the activity pauses and resumes", () => {
  const read = (relative) => fs.readFileSync(new URL(`../../../${relative}`, import.meta.url), "utf8");
  const main = read("src/main.jsx");
  assert.match(main, /if \(import\.meta\.env\.VITE_OH_NATIVE\) installNativeBackgroundPause\(isGenerating\)/);
  const javaDir = "mobile/android/app/src/main/java/io/github/arkniem/openhistoria";
  const plugin = read(`${javaDir}/BackgroundPausePlugin.java`);
  assert.match(plugin, /@CapacitorPlugin\(name = "OhBackground"\)/);
  assert.match(plugin, /public void idle\(PluginCall call\)/);
  const activity = read(`${javaDir}/MainActivity.java`);
  assert.match(activity, /registerPlugin\(BackgroundPausePlugin\.class\);(\s*registerPlugin\(\w+\.class\);)*\s*super\.onCreate\(savedInstanceState\);/, "registered before super.onCreate");
  assert.match(activity, /view\.pauseTimers\(\)/);
  assert.match(activity, /view\.resumeTimers\(\)/);
});
