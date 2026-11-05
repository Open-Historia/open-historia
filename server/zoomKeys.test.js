/*! Open Historia — the page's zoom keys: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/zoomKeys.test.js
//
// "Pressing ctrl + "-" in the main menu shrinks the text, but ctrl + "+" does
// not increase the size" (a player, 2026-10-27).

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { ZOOM_LEAST, ZOOM_MOST, attachZoomKeys, nextZoomLevel, zoomKeyOf } = require("../electron/zoomKeys.cjs");

const press = (fields) => ({ type: "keyDown", control: true, ...fields });

test("Ctrl with = or + zooms in, with - zooms out, with 0 puts it back, on the main row and the keypad", () => {
  for (const input of [press({ key: "=", code: "Equal" }), press({ key: "+", code: "Equal", shift: true }), press({ key: "+", code: "NumpadAdd" })]) {
    assert.equal(zoomKeyOf(input), "in", JSON.stringify(input));
  }
  for (const input of [press({ key: "-", code: "Minus" }), press({ key: "-", code: "NumpadSubtract" })]) assert.equal(zoomKeyOf(input), "out");
  assert.equal(zoomKeyOf(press({ key: "0", code: "Digit0" })), "reset");
  // Cmd on a Mac.
  assert.equal(zoomKeyOf({ type: "keyDown", meta: true, key: "=", code: "Equal" }), "in");
  // Nothing else: no modifier, Alt held, a key let go, another key.
  for (const input of [{ type: "keyDown", key: "=" }, press({ key: "=", alt: true }), { ...press({ key: "=" }), type: "keyUp" }, press({ key: "s", code: "KeyS" }), null]) {
    assert.equal(zoomKeyOf(input), "");
  }
});

test("each press is half a step, held between the smallest and the largest", () => {
  assert.equal(nextZoomLevel(0, "in"), 0.5);
  assert.equal(nextZoomLevel(-1.5, "in"), -1);
  assert.equal(nextZoomLevel(0, "out"), -0.5);
  assert.equal(nextZoomLevel(-2.5, "reset"), 0);
  assert.equal(nextZoomLevel(ZOOM_MOST, "in"), ZOOM_MOST);
  assert.equal(nextZoomLevel(ZOOM_LEAST, "out"), ZOOM_LEAST);
  assert.equal(nextZoomLevel(undefined, "in"), 0.5);
});

test("a page shrunk with Ctrl+- grows again with Ctrl+=, and the keys go no further", () => {
  const page = new EventEmitter();
  let level = 0;
  page.getZoomLevel = () => level;
  page.setZoomLevel = (next) => { level = next; };
  attachZoomKeys(page);
  const send = (input) => {
    let stopped = false;
    page.emit("before-input-event", { preventDefault: () => { stopped = true; } }, input);
    return stopped;
  };
  for (let times = 0; times < 3; times += 1) assert.equal(send(press({ key: "-", code: "Minus" })), true);
  assert.equal(level, -1.5);
  for (let times = 0; times < 3; times += 1) send(press({ key: "=", code: "Equal" }));
  assert.equal(level, 0);
  assert.equal(send(press({ key: "s", code: "KeyS" })), false, "other keys pass through");
  // The main window has them.
  const main = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(main, /const \{ attachZoomKeys \} = require\("\.\/zoomKeys\.cjs"\);/);
  assert.match(main, /attachZoomKeys\(win\.webContents\);/);
});
