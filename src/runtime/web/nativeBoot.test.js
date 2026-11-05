/*! Open Historia — Android boot screen tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/nativeBoot.test.js
//
// The boot screen stands between the player and their games, so the two ways it
// can go wrong are both "the app never opens": it decides it is native when it is
// not (the website would lose its home page), or it stays up because nothing ever
// settled. nativeBoot.js is deliberately import-free so both are testable here.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOT_DEADLINE_MS,
  MIN_VISIBLE_MS,
  bootStatusText,
  isNativeApp,
  showNativeBoot,
} from "./nativeBoot.js";

const withWindow = (value, body) => {
  const had = Object.hasOwn(globalThis, "window");
  const previous = globalThis.window;
  if (value === undefined) delete globalThis.window;
  else globalThis.window = value;
  try {
    body();
  } finally {
    if (had) globalThis.window = previous;
    else delete globalThis.window;
  }
};

test("only a Capacitor shell counts as the app", () => {
  withWindow(undefined, () => assert.equal(isNativeApp(), false, "server-side render / no window"));
  withWindow({}, () => assert.equal(isNativeApp(), false, "an ordinary browser tab keeps the home page"));
  withWindow({ Capacitor: undefined }, () => assert.equal(isNativeApp(), false));
  withWindow({ Capacitor: { Plugins: {} } }, () => assert.equal(isNativeApp(), true));
});

test("the status line says what the app is doing, then what is true", () => {
  // The map is inside the APK: there is no connection to report, only the
  // seeding to wait for.
  assert.equal(bootStatusText(false), "Getting the world ready…");
  assert.equal(bootStatusText(true), "Everything is on this device");
});

test("the deadline is a wait a player would give up on, and the floor is shorter than it", () => {
  assert.ok(BOOT_DEADLINE_MS >= 4000 && BOOT_DEADLINE_MS <= 15000);
  assert.ok(MIN_VISIBLE_MS < BOOT_DEADLINE_MS, "the anti-flash floor must not become the wait");
  assert.ok(MIN_VISIBLE_MS <= 1000, "a floor above a second is a delay the player can feel");
});

test("showNativeBoot is inert without a document, and settling it is still safe", () => {
  // installWebBackend calls this before anything else. If it threw where there is
  // no DOM it would take the whole web backend — seeding, the /api interceptor —
  // down with it, and the app would show nothing at all.
  assert.equal(typeof globalThis.document, "undefined", "this test asserts the no-DOM path");
  const boot = showNativeBoot();
  assert.equal(typeof boot.settle, "function");
  assert.doesNotThrow(() => boot.settle());
  assert.doesNotThrow(() => boot.settle());
  // index.js relabels it once the language pack has loaded.
  assert.doesNotThrow(() => boot.relabel());
});
