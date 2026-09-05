/*! Open Historia — Android boot screen tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/runtime/web/nativeBoot.test.js
//
// The boot screen stands between the player and their games, so the two ways it
// can go wrong are both "the app never opens": it decides it is native when it is
// not (the website would lose its home page), or it stays up because nothing ever
// settled. nativeBoot.js is deliberately import-free so both are testable here -
// nodeConnect.js reads import.meta.env at module scope and cannot be loaded by
// `node --test`, which is why index.js passes the connection in rather than the
// boot screen importing it.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECT_DEADLINE_MS,
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

test("the status line reports every settled outcome as progress, not failure", () => {
  assert.match(bootStatusText(null), /Finding/);
  // The origin fallback is a playable answer: no node was reachable, the registry
  // proxy serves the map instead. Calling it an error would be a lie.
  assert.equal(bootStatusText({ origin: true }), "Connected to the main server");
  assert.equal(
    bootStatusText({ id: "n-7f3a", region: "eu-west", latency: 42 }),
    "Connected · n-7f3a · eu-west · 42 ms",
  );
  // A node the directory knows but that reports nothing about itself.
  assert.equal(bootStatusText({}), "Connected · a community node");
  // latency 0 is a real measurement; only a non-number is omitted.
  assert.match(bootStatusText({ id: "n-1", latency: 0 }), /0 ms$/);
  assert.equal(bootStatusText({ id: "n-1", latency: undefined }), "Connected · n-1");
});

test("the deadline outlasts a node probe, and the floor is shorter than the deadline", () => {
  // selectBestNode gives each probe 4s and runs them in parallel, so the deadline
  // has to clear one full probe plus the directory fetch in front of it, or the
  // screen would come down while the answer was still on its way every time.
  assert.ok(CONNECT_DEADLINE_MS > 4000, "would pre-empt a probe that was going to succeed");
  assert.ok(MIN_VISIBLE_MS < CONNECT_DEADLINE_MS, "the anti-flash floor must not become the wait");
  assert.ok(MIN_VISIBLE_MS <= 1000, "a floor above a second is a delay the player can feel");
});

test("showNativeBoot is inert without a document, and settling it is still safe", () => {
  // installWebBackend calls this before anything else. If it threw where there is
  // no DOM it would take the whole web backend — seeding, the /api interceptor —
  // down with it, and the app would show nothing at all.
  assert.equal(typeof globalThis.document, "undefined", "this test asserts the no-DOM path");
  const boot = showNativeBoot();
  assert.equal(typeof boot.settle, "function");
  assert.doesNotThrow(() => boot.settle(null));
  assert.doesNotThrow(() => boot.settle({ origin: true }));
});
