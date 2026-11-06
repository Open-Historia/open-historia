/*! Open Historia — hover held still while a list scrolls, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scrollHoverFreeze.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { SCROLL_SETTLE_MS, SCROLLING_ATTRIBUTE, WHEEL_RECENT_MS, createScrollHoverFreeze } from "./scrollHoverFreeze.js";

const fakeTimers = () => {
  let next = 1;
  const due = new Map();
  return {
    setTimeout: (fn) => { due.set(next, fn); return next++; },
    clearTimeout: (id) => due.delete(id),
    runAll: () => { for (const [id, fn] of [...due]) { due.delete(id); fn(); } },
    count: () => due.size,
  };
};
const fakeElement = () => {
  const attributes = new Map();
  return { nodeType: 1, setAttribute: (k, v) => attributes.set(k, v), removeAttribute: (k) => attributes.delete(k), marked: () => attributes.has(SCROLLING_ATTRIBUTE) };
};

test("a list the wheel scrolls takes no hover until it has been still a moment", () => {
  const timers = fakeTimers();
  let clock = 1000;
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => clock });
  const list = fakeElement();
  onWheel();
  onScroll({ target: list });
  assert.equal(list.marked(), true);
  // Its glide goes on after the last wheel event, and it stays marked while it moves; one timer, reset each time.
  clock += WHEEL_RECENT_MS + 500;
  onScroll({ target: list });
  assert.equal(timers.count(), 1);
  timers.runAll();
  assert.equal(list.marked(), false);
  assert.ok(SCROLL_SETTLE_MS > 0 && SCROLL_SETTLE_MS <= 250, "short enough not to be felt as a click that missed");
});

test("a list that scrolls itself, as a chat does while an answer streams in, keeps taking clicks", () => {
  const timers = fakeTimers();
  let clock = 5000;
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => clock });
  const chat = fakeElement();
  onScroll({ target: chat });
  assert.equal(chat.marked(), false);
  onWheel();
  clock += WHEEL_RECENT_MS + 1;
  onScroll({ target: chat });
  assert.equal(chat.marked(), false, "a wheel long ago does not count");
});

test("the page scrolling marks its scrolling element; the rule and the install are in place", () => {
  const timers = fakeTimers();
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => 0 });
  const root = fakeElement();
  onWheel();
  onScroll({ target: { nodeType: 9, scrollingElement: root } });
  assert.equal(root.marked(), true);
  const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\[data-oh-scrolling\] \* \{\s*pointer-events: none !important;/);
  assert.match(fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8"), /installScrollHoverFreeze\(\);/);
});

test("the badges on the menu's cards carry no blur of their own", () => {
  const library = fs.readFileSync(new URL("../Game/GameUI/libraryBar.jsx", import.meta.url), "utf8");
  assert.equal((library.match(/backdropFilter: "blur\(8px\)"/g) ?? []).length, 0);
});
