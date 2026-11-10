/*! Open Historia — hover held still while a list scrolls, tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scrollHoverFreeze.test.js

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  GLIDE_MAX_MS,
  INNER_SCROLLER_ATTRIBUTE,
  SCROLL_SETTLE_MS,
  SCROLLING_ATTRIBUTE,
  WHEEL_RECENT_MS,
  createScrollHoverFreeze,
  innerScrollersOf,
} from "./scrollHoverFreeze.js";

const fakeTimers = () => {
  let next = 1;
  let sets = 0;
  const due = new Map();
  return {
    setTimeout: (fn) => { sets += 1; due.set(next, fn); return next++; },
    sets: () => sets,
    clearTimeout: (id) => due.delete(id),
    runAll: () => { for (const [id, fn] of [...due]) { due.delete(id); fn(); } },
    count: () => due.size,
  };
};
// A node in a tiny tree: `contains` walks up the parents, as the DOM's does (an element contains itself).
const fakeElement = (parent = null) => {
  const attributes = new Map();
  const element = {
    nodeType: 1,
    parent,
    setAttribute: (k, v) => attributes.set(k, v),
    removeAttribute: (k) => attributes.delete(k),
    hasAttribute: (k) => attributes.has(k),
    marked: () => attributes.has(SCROLLING_ATTRIBUTE),
    contains: (other) => { for (let at = other; at; at = at.parent) if (at === element) return true; return false; },
  };
  return element;
};
const noInner = () => [];

test("a list the wheel scrolls takes no hover until it has been still a moment", () => {
  const timers = fakeTimers();
  let clock = 1000;
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => clock, innerScrollers: noInner });
  const list = fakeElement();
  const row = fakeElement(list);
  onWheel({ target: row });
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
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => clock, innerScrollers: noInner });
  const chat = fakeElement();
  onScroll({ target: chat });
  assert.equal(chat.marked(), false);
  onWheel({ target: fakeElement(chat) });
  clock += WHEEL_RECENT_MS + 1;
  onScroll({ target: chat });
  assert.equal(chat.marked(), false, "a wheel long ago does not count");
});

test("the wheel turning over the map marks no chat that happens to scroll at the same moment", () => {
  const timers = fakeTimers();
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => 0, innerScrollers: noInner });
  const map = fakeElement();
  const advisorLog = fakeElement();
  onWheel({ target: map });
  onScroll({ target: advisorLog });
  assert.equal(advisorLog.marked(), false);
  assert.equal(timers.count(), 0);
});

test("a log the Advisor keeps scrolling as it streams lets go soon after the wheel over it stops", () => {
  const timers = fakeTimers();
  let clock = 10_000;
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => clock, innerScrollers: noInner });
  const log = fakeElement();
  const message = fakeElement(log);
  onWheel({ target: message });
  onScroll({ target: log });
  assert.equal(log.marked(), true);
  // The stream's smooth scrollIntoView moves it every few frames; the wheel is long gone.
  let lastExtendedAt = clock;
  for (let i = 0; i < 100; i += 1) {
    clock += 50;
    const before = timers.sets();
    onScroll({ target: log });
    if (timers.sets() > before) lastExtendedAt = clock;
  }
  assert.ok(lastExtendedAt - 10_000 < GLIDE_MAX_MS, "no extension past the glide cap");
  assert.ok(lastExtendedAt - 10_000 >= GLIDE_MAX_MS - 50, "extended while the glide could still be the wheel's");
  timers.runAll();
  assert.equal(log.marked(), false, "unmarked once the last extension has settled");
  // And a later self-scroll does not mark it again.
  clock += 1000;
  onScroll({ target: log });
  assert.equal(log.marked(), false);
});

test("the wheel over it again keeps a long scroll marked: the cap counts from the last wheel, not the first", () => {
  const timers = fakeTimers();
  let clock = 0;
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => clock, innerScrollers: noInner });
  const list = fakeElement();
  const row = fakeElement(list);
  for (let i = 0; i < 40; i += 1) {
    onWheel({ target: row });
    onScroll({ target: list });
    clock += 100;
  }
  assert.ok(clock > GLIDE_MAX_MS);
  assert.equal(list.marked(), true);
  assert.equal(timers.count(), 1);
});

test("a list nested in the one scrolling keeps taking the wheel, and lets go with it", () => {
  const timers = fakeTimers();
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => 0, innerScrollers: (element) => element.innerLists ?? [] });
  const panel = fakeElement();
  const innerList = fakeElement(panel);
  const innerRow = fakeElement(innerList);
  panel.innerLists = [innerList];
  // The inner list at its end hands the wheel to the panel.
  onWheel({ target: innerRow });
  onScroll({ target: panel });
  assert.equal(panel.marked(), true);
  assert.equal(innerList.hasAttribute(INNER_SCROLLER_ATTRIBUTE), true);
  // Turning back, the wheel lands on the inner list (it kept its pointer), which scrolls and is marked in turn.
  onWheel({ target: innerList });
  onScroll({ target: innerList });
  assert.equal(innerList.marked(), true);
  timers.runAll();
  assert.equal(panel.marked(), false);
  assert.equal(innerList.marked(), false);
  assert.equal(innerList.hasAttribute(INNER_SCROLLER_ATTRIBUTE), false);
});

test("innerScrollersOf finds what scrolls on its own and skips what merely overflows", () => {
  const node = (sizes, overflowY = "visible", overflowX = "visible") => ({ ...sizes, style: { overflowY, overflowX } });
  const list = node({ scrollHeight: 900, clientHeight: 300, scrollWidth: 100, clientWidth: 100 }, "auto");
  const clipped = node({ scrollHeight: 900, clientHeight: 300, scrollWidth: 100, clientWidth: 100 }, "hidden");
  const ellipsis = node({ scrollHeight: 20, clientHeight: 20, scrollWidth: 400, clientWidth: 100 }, "visible", "hidden");
  const strip = node({ scrollHeight: 20, clientHeight: 20, scrollWidth: 400, clientWidth: 100 }, "hidden", "scroll");
  const plain = node({ scrollHeight: 20, clientHeight: 20, scrollWidth: 100, clientWidth: 100 });
  const all = [list, clipped, ellipsis, strip, plain];
  const view = { getComputedStyle: (one) => one.style };
  const outer = { getElementsByTagName: () => all };
  assert.deepEqual(innerScrollersOf(outer, { view }), [list, strip]);
  assert.deepEqual(innerScrollersOf(outer, { view, limit: 1 }), [list], "the walk is bounded");
  assert.deepEqual(innerScrollersOf({}, { view }), []);
});

test("the page scrolling marks its scrolling element; the rule and the install are in place", () => {
  const timers = fakeTimers();
  const { onScroll, onWheel } = createScrollHoverFreeze({ timers, now: () => 0, innerScrollers: noInner });
  const root = fakeElement();
  onWheel({ target: fakeElement(root) });
  onScroll({ target: { nodeType: 9, scrollingElement: root } });
  assert.equal(root.marked(), true);
  const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\[data-oh-scrolling\] \* \{\s*pointer-events: none !important;/);
  assert.match(css, /\[data-oh-scrolling\] \[data-oh-scroll-inner\] \{\s*pointer-events: auto !important;/);
  assert.match(fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8"), /installScrollHoverFreeze\(\);/);
});

test("the badges on the menu's cards carry no blur of their own", () => {
  const library = fs.readFileSync(new URL("../Game/GameUI/libraryBar.jsx", import.meta.url), "utf8");
  assert.equal((library.match(/backdropFilter: "blur\(8px\)"/g) ?? []).length, 0);
});
