/*! Open Historia — the map's trackpad and mouse controls: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/Map/mapGestures.test.js
//
// The steps below are the shapes browsers send: a Windows mouse notch is one
// 100 px event, a macOS one a multiple of 4.000244140625 px, Firefox's three
// lines, and a trackpad's scroll small steps 8 to 16 ms apart, fractional and
// often sideways. The map is a stand-in that records what is asked of it; the
// MapLibre side is read from maplibre-gl 5.19 (scroll_zoom.ts, camera.ts).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LONE_EVENT_MS,
  TILT_DEGREES_PER_PX,
  TURN_DEGREES_PER_PX,
  WHEEL_ZOOM_DELTA,
  asMouseWheel,
  attachMapGestures,
  createWheelSorter,
  passToMap,
  trackpadTurn,
  wheelPixels,
} from "./mapGestures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

// One scroll, step by step: [ms since the last step, deltaY, deltaX?, deltaMode?].
const sortAll = (steps, sorter = createWheelSorter(), start = 10_000) => {
  let time = start;
  return steps.map(([after, deltaY, deltaX = 0, deltaMode = 0]) => {
    time += after;
    return sorter.sort(wheelPixels({ deltaX, deltaY, deltaMode }), time);
  });
};

test("a wheel event's scroll is read in pixels, a line as 40 as MapLibre reads it", () => {
  assert.deepEqual(wheelPixels({ deltaX: 0, deltaY: 100, deltaMode: 0 }), { x: 0, y: 100 });
  assert.deepEqual(wheelPixels({ deltaX: -1, deltaY: 3, deltaMode: 1 }), { x: -40, y: 120 });
  assert.deepEqual(wheelPixels({ deltaX: 2.5, deltaY: -7.25 }), { x: 2.5, y: -7.25 });
  assert.deepEqual(wheelPixels({}), { x: 0, y: 0 });
  assert.deepEqual(wheelPixels(null), { x: 0, y: 0 });
});

test("a mouse wheel's notch is rounded to what MapLibre takes for a wheel at once", () => {
  for (const px of [100, -100, 120, 125, 53, 4.000244140625 * 3]) {
    const notch = asMouseWheel(px);
    // MapLibre's own test, `value % wheelZoomDelta === 0` (-0 passes it too).
    assert.ok(notch % WHEEL_ZOOM_DELTA === 0, `${px} px`);
    assert.ok(Math.abs(notch - px) <= WHEEL_ZOOM_DELTA / 2, `${px} px stays ${px} px, near enough`);
  }
  assert.equal(asMouseWheel(100), 25 * WHEEL_ZOOM_DELTA);
  assert.equal(asMouseWheel(120), 30 * WHEEL_ZOOM_DELTA);
});

test("a macOS mouse wheel's notch is a wheel's at once; a step under 4 px is a trackpad's at once", () => {
  assert.deepEqual(sortAll([[0, WHEEL_ZOOM_DELTA * 2]]), [{ verdict: "wheel", x: 0, y: WHEEL_ZOOM_DELTA * 2 }]);
  assert.deepEqual(sortAll([[0, -WHEEL_ZOOM_DELTA]]), [{ verdict: "wheel", x: 0, y: -WHEEL_ZOOM_DELTA }]);
  assert.deepEqual(sortAll([[0, 1.5]]), [{ verdict: "trackpad", x: 0, y: 1.5 }]);
  assert.deepEqual(sortAll([[0, -3.9]]), [{ verdict: "trackpad", x: 0, y: -3.9 }]);
});

test("a lone notch of a Windows mouse wheel is held, then zoomed as a wheel's once 40 ms pass", () => {
  const sorter = createWheelSorter();
  assert.deepEqual(sortAll([[0, 100]], sorter), [{ verdict: "wait", x: 0, y: 0 }]);
  assert.equal(sorter.holding(), true);
  assert.equal(sorter.expire(10_000 + LONE_EVENT_MS - 1), null, "not before its 40 ms");
  assert.deepEqual(sorter.expire(10_000 + LONE_EVENT_MS), { verdict: "wheel", x: 0, y: 100 });
  assert.equal(sorter.holding(), false);
  assert.equal(sorter.expire(), null, "nothing is held twice");

  // The timer says so with no time: at once.
  const timed = createWheelSorter();
  sortAll([[0, -100]], timed);
  assert.deepEqual(timed.expire(), { verdict: "wheel", x: 0, y: -100 });
});

test("Firefox's three lines are a mouse wheel's notch of 120 px", () => {
  const sorter = createWheelSorter();
  assert.deepEqual(sortAll([[0, 3, 0, 1]], sorter), [{ verdict: "wait", x: 0, y: 0 }]);
  assert.deepEqual(sorter.expire(), { verdict: "wheel", x: 0, y: 120 });
});

test("a step soon after the held one tells them apart by pace, and carries the held one's scroll", () => {
  // A wheel spun fast: 100 px 16 ms apart is 1,600, far over 200.
  assert.deepEqual(sortAll([[0, 100], [16, 100]]), [
    { verdict: "wait", x: 0, y: 0 },
    { verdict: "wheel", x: 0, y: 200 },
  ]);
  // A trackpad: 9 px 8 ms apart is 72.
  assert.deepEqual(sortAll([[0, 9.5], [8, 9]]), [
    { verdict: "wait", x: 0, y: 0 },
    { verdict: "trackpad", x: 0, y: 18.5 },
  ]);
});

test("a held step that a sure step settles goes the way that one is settled", () => {
  // MapLibre zooms the held 12 px as a wheel's after 40 ms though a 2 px trackpad step came first.
  assert.deepEqual(sortAll([[0, 12], [8, 2]]), [
    { verdict: "wait", x: 0, y: 0 },
    { verdict: "trackpad", x: 0, y: 14 },
  ]);
  assert.deepEqual(sortAll([[0, 100], [20, WHEEL_ZOOM_DELTA * 25]]), [
    { verdict: "wait", x: 0, y: 0 },
    { verdict: "wheel", x: 0, y: 100 + WHEEL_ZOOM_DELTA * 25 },
  ]);
});

test("a scroll stays what it was found to be until it pauses for 400 ms", () => {
  // A trackpad's flick of big steps is still a trackpad's...
  assert.deepEqual(sortAll([[0, 2], [8, 60], [8, 120]]).map((step) => step.verdict), ["trackpad", "trackpad", "trackpad"]);
  // ...a wheel's slower notches are still a wheel's...
  const sorter = createWheelSorter();
  sortAll([[0, 100]], sorter);
  sorter.expire();
  assert.deepEqual(sortAll([[120, 100], [150, 100]], sorter, 10_000).map((step) => step.verdict), ["wheel", "wheel"]);
  // ...and after 400 ms of quiet a step is held again.
  assert.deepEqual(sortAll([[0, 2], [500, 50]]).map((step) => step.verdict), ["trackpad", "wait"]);
});

test("a trackpad's sideways scroll is told by its sideways steps, which MapLibre never read", () => {
  assert.deepEqual(sortAll([[0, 0, -2.5]]), [{ verdict: "trackpad", x: -2.5, y: 0 }]);
  assert.deepEqual(sortAll([[0, 0.5, -14], [8, 0, -12]]), [
    { verdict: "wait", x: 0, y: 0 },
    { verdict: "trackpad", x: -26, y: 0.5 },
  ]);
  // A mouse wheel has no sideways part, so for it the test is MapLibre's to the number.
  assert.deepEqual(sortAll([[0, 3.2, 0]]), [{ verdict: "trackpad", x: 0, y: 3.2 }]);
});

test("fingers right turn the map as Shift+Right does, fingers up tilt it as Shift+Up does", () => {
  // Content follows the fingers: right is deltaX < 0, up is deltaY > 0.
  assert.deepEqual(trackpadTurn({ x: -10, y: 0 }), { bearing: 10 * TURN_DEGREES_PER_PX, pitch: 0 });
  assert.deepEqual(trackpadTurn({ x: 10, y: 0 }), { bearing: -10 * TURN_DEGREES_PER_PX, pitch: 0 });
  assert.deepEqual(trackpadTurn({ x: 0, y: 10 }), { bearing: 0, pitch: 10 * TILT_DEGREES_PER_PX });
  assert.deepEqual(trackpadTurn({ x: 0, y: -10 }), { bearing: 0, pitch: -10 * TILT_DEGREES_PER_PX });
  // Both at once.
  const both = trackpadTurn({ x: -4, y: 6 });
  assert.ok(both.bearing > 0 && both.pitch > 0);
  // A step is at most a quarter turn: easeTo would take the short way back round.
  assert.equal(trackpadTurn({ x: -5000, y: 0 }).bearing, 90);
  assert.equal(trackpadTurn({ x: 5000, y: 0 }).bearing, -90);
});

// A stand-in for a MapLibre map: what attachMapGestures uses of it.
const fakeMap = ({ bearing = 0, pitch = 0, minPitch = 0, maxPitch = 60, turnable = true, zooms = true } = {}) => {
  const listeners = [];
  const copies = [];
  const eases = [];
  const mapListeners = new Map();
  let easing = false;
  const map = {
    _removed: false,
    copies,
    eases,
    listeners,
    mapListeners,
    camera: { bearing, pitch },
    on: (type, handler) => mapListeners.set(type, [...(mapListeners.get(type) ?? []), handler]),
    off: (type, handler) => mapListeners.set(type, (mapListeners.get(type) ?? []).filter((entry) => entry !== handler)),
    fire: (type) => (mapListeners.get(type) ?? []).forEach((handler) => handler({ type })),
    getCanvasContainer: () => ({
      addEventListener: (type, handler, options) => listeners.push({ type, handler, options }),
      removeEventListener: (type, handler) => {
        const at = listeners.findIndex((entry) => entry.type === type && entry.handler === handler);
        if (at >= 0) listeners.splice(at, 1);
      },
    }),
    getCanvas: () => ({ dispatchEvent: (event) => copies.push(event) }),
    scrollZoom: { isEnabled: () => zooms },
    dragRotate: { isEnabled: () => turnable },
    getBearing: () => map.camera.bearing,
    getPitch: () => map.camera.pitch,
    getMinPitch: () => minPitch,
    getMaxPitch: () => maxPitch,
    isEasing: () => easing,
    easeTo: (options) => {
      eases.push(options);
      easing = true;
    },
    // The ease ran its course: the camera is where it was going, and the move ends.
    settle: () => {
      const last = eases.at(-1);
      if (last) map.camera = { bearing: last.bearing, pitch: last.pitch };
      easing = false;
      map.fire("moveend");
    },
    // A drag or another camera move stopped the ease part of the way.
    interrupt: (camera) => {
      map.camera = { ...map.camera, ...camera };
      easing = false;
      map.fire("moveend");
    },
  };
  return map;
};

const wheelEvent = (deltaY, { deltaX = 0, deltaMode = 0, ctrlKey = false, clientX = 300, clientY = 200, shiftKey = false } = {}) => ({
  type: "wheel",
  deltaX,
  deltaY,
  deltaMode,
  ctrlKey,
  shiftKey,
  clientX,
  clientY,
  stopped: false,
  prevented: false,
  stopPropagation() { this.stopped = true; },
  preventDefault() { this.prevented = true; },
});

// A trackpad step with Shift held: the scroll that turns and tilts the map.
const turnEvent = (deltaY, options = {}) => wheelEvent(deltaY, { ...options, shiftKey: true });

// The map with the gestures attached, a clock and timers of the test's own.
const rig = (mapOptions, options = {}) => {
  const map = fakeMap(mapOptions);
  const clock = { now: 50_000 };
  const timers = new Map();
  let nextTimer = 1;
  const detach = attachMapGestures(map, {
    now: () => clock.now,
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, at: clock.now + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    makeWheel: (init) => ({ type: "wheel", ...init }),
    ...options,
  });
  const wheel = (event, after = 0) => {
    clock.now += after;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= clock.now) {
        timers.delete(id);
        timer.run();
      }
    }
    for (const { type, handler } of [...map.listeners]) if (type === "wheel") handler(event);
    return event;
  };
  const wait = (ms) => {
    clock.now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= clock.now) {
        timers.delete(id);
        timer.run();
      }
    }
  };
  return { map, clock, timers, detach, wheel, wait };
};

test("the sorting listens on the canvas container in the capture phase, ahead of MapLibre", () => {
  const { map, detach } = rig();
  assert.equal(map.listeners.length, 1);
  assert.equal(map.listeners[0].type, "wheel");
  assert.deepEqual(map.listeners[0].options, { capture: true, passive: false });
  detach();
  assert.equal(map.listeners.length, 0);
});

test("a mouse wheel's notch is kept back 40 ms, then zoomed by MapLibre about the pointer", () => {
  const { map, wheel, wait } = rig();
  const notch = wheel(wheelEvent(100, { clientX: 412, clientY: 233, shiftKey: true }));
  assert.equal(notch.stopped, true, "MapLibre does not see the notch itself");
  assert.equal(notch.prevented, true);
  assert.equal(map.copies.length, 0, "not yet: it might be a trackpad's");
  wait(LONE_EVENT_MS);
  assert.equal(map.copies.length, 1);
  const [copy] = map.copies;
  assert.equal(copy.type, "wheel");
  assert.equal(copy.deltaMode, 0);
  assert.equal(copy.deltaY, 25 * WHEEL_ZOOM_DELTA);
  assert.equal(copy.deltaY % WHEEL_ZOOM_DELTA, 0, "MapLibre takes it for a wheel's at once");
  assert.equal(copy.clientX, 412);
  assert.equal(copy.clientY, 233);
  assert.equal(copy.shiftKey, true, "Shift still slows MapLibre's zoom");
  assert.equal(copy.bubbles, true);
  assert.equal(map.eases.length, 0, "a mouse wheel never turns the map");

  // The copy passes the sorting on its way to MapLibre.
  const passing = wheel(Object.assign(copy, wheelEvent(copy.deltaY), { type: "wheel" }));
  assert.equal(passing.stopped, false);
});

test("a wheel spun fast zooms at the second notch, with both notches' scroll", () => {
  const { map, wheel, timers } = rig();
  wheel(wheelEvent(-100));
  wheel(wheelEvent(-100), 16);
  assert.equal(map.copies.length, 1);
  assert.equal(map.copies[0].deltaY, asMouseWheel(-200));
  assert.equal(timers.size, 0, "the held notch's timer is let go");
  wheel(wheelEvent(-100), 30);
  assert.equal(map.copies.length, 2, "the rest of the spin zooms at once");
});

test("a timer that runs late does not lose the held notch", () => {
  const { map, clock, wheel, timers } = rig();
  wheel(wheelEvent(100));
  // The page was busy: 300 ms on, the timer has not run, and the next notch comes.
  for (const timer of timers.values()) timer.at = Infinity;
  clock.now += 300;
  map.listeners[0].handler(wheelEvent(100));
  assert.deepEqual(map.copies.map((copy) => copy.deltaY), [asMouseWheel(100), asMouseWheel(100)]);
  assert.equal(timers.size, 0);
});

test("two fingers on a trackpad with Shift held turn and tilt the map, and MapLibre never zooms on them", () => {
  const { map, wheel } = rig();
  const first = wheel(turnEvent(2, { deltaX: -1 }));
  assert.equal(first.stopped, true);
  assert.equal(first.prevented, true);
  assert.equal(map.copies.length, 0);
  assert.equal(map.eases.length, 1);
  const [ease] = map.eases;
  assert.equal(ease.bearing, 1 * TURN_DEGREES_PER_PX);
  assert.equal(ease.pitch, 2 * TILT_DEGREES_PER_PX);
  assert.equal(ease.easeId, "oh-trackpad-turn", "one move for the whole scroll");
  assert.equal(ease.essential, true);
  assert.ok(ease.duration > 0);
  assert.ok(ease.easing(0.5) > 0 && ease.easing(0.5) < 1, "eased");
  assert.equal(ease.easing(1), 1);
  assert.equal("zoom" in ease, false);
  assert.equal("center" in ease, false, "turned and tilted about the middle of the map");

  // Steps while it eases carry on from where the last was going, not from where the map has got to,
  // however long after the last they come (a slow machine's steps land 150 ms apart).
  map.camera = { bearing: 0.2, pitch: 0.3 };
  wheel(turnEvent(3, { deltaX: -2 }), 150);
  assert.equal(map.eases.length, 2);
  near(map.eases[1].bearing, 3 * TURN_DEGREES_PER_PX);
  near(map.eases[1].pitch, 5 * TILT_DEGREES_PER_PX);

  // After the ease has ended a step starts from where the map is.
  map.settle();
  map.camera.bearing = 40;
  wheel(turnEvent(1), 500);
  assert.equal(map.eases.at(-1).bearing, 40);
  // And after a drag stopped it part of the way.
  map.interrupt({ bearing: -12, pitch: 7 });
  wheel(turnEvent(1), 8);
  assert.equal(map.eases.at(-1).bearing, -12);
  near(map.eases.at(-1).pitch, 7 + TILT_DEGREES_PER_PX);
  assert.equal(map.copies.length, 0);
});

test("one step of a turn settles in 60% of its ease, the rest holding the move open", () => {
  const { map, wheel } = rig();
  wheel(turnEvent(2));
  const { easing, duration } = map.eases[0];
  assert.equal(duration, 200, "as long as MapLibre's wait before its zoomend");
  assert.equal(easing(0), 0);
  assert.ok(easing(0.3) > 0.5 && easing(0.3) < 1);
  assert.equal(easing(0.6), 1);
  assert.equal(easing(0.9), 1);
});

test("a trackpad's scroll whose first step is held turns the map with that step's scroll too", () => {
  const { map, wheel, timers } = rig();
  wheel(turnEvent(12));
  assert.equal(map.eases.length, 0);
  wheel(turnEvent(10), 8);
  assert.equal(timers.size, 0);
  assert.equal(map.copies.length, 0, "no zoom at the start of a turn");
  assert.equal(map.eases.length, 1);
  assert.equal(map.eases[0].pitch, 22 * TILT_DEGREES_PER_PX);
});

test("the tilt stops at the map's limits, and scrolling back moves it at once", () => {
  const { map, wheel } = rig({ pitch: 50, maxPitch: 60 });
  wheel(turnEvent(2));
  for (let step = 0; step < 40; step += 1) wheel(turnEvent(3.5), 8);
  assert.equal(map.eases.at(-1).pitch, 60);
  wheel(turnEvent(-3), 8);
  assert.equal(map.eases.at(-1).pitch, 60 - 3 * TILT_DEGREES_PER_PX, "the overshoot was not stored up");
  const flat = rig({ pitch: 1 });
  flat.wheel(turnEvent(-3.9));
  assert.equal(flat.map.eases.at(-1).pitch, 0);
});

test("with Reduce motion on, each step of a turn is taken at once", () => {
  let still = true;
  const { map, wheel } = rig({}, { still: () => still });
  wheel(turnEvent(2, { deltaX: -2 }));
  assert.equal(map.eases[0].easing(0), 1);
  assert.equal(map.eases[0].easeId, "oh-trackpad-turn", "still one move for the whole scroll");
  still = false;
  map.settle();
  wheel(turnEvent(2), 500);
  assert.ok(map.eases.at(-1).easing(0.1) < 1);
});

test("without Shift two fingers on a trackpad zoom: MapLibre has the scroll, and the map does not turn", () => {
  const { map, wheel, timers } = rig();
  const first = wheel(wheelEvent(2, { deltaX: -1 }));
  assert.equal(first.stopped, false, "MapLibre zooms on it at its trackpad rate");
  assert.equal(first.prevented, false);
  wheel(wheelEvent(3), 8);
  assert.equal(map.eases.length, 0, "no turn, no tilt");
  assert.equal(map.copies.length, 0);
  // A first step held 40 ms, then settled as a trackpad's, also leaves the next step to MapLibre.
  wheel(wheelEvent(12), 600);
  assert.equal(timers.size, 1);
  const settling = wheel(wheelEvent(10), 8);
  assert.equal(settling.stopped, false);
  assert.equal(timers.size, 0);
  assert.equal(map.eases.length, 0);
  // Shift pressed mid-scroll turns from that step on, and letting it go zooms again.
  wheel(turnEvent(2), 8);
  assert.equal(map.eases.length, 1);
  const after = wheel(wheelEvent(2), 8);
  assert.equal(after.stopped, false);
  assert.equal(map.eases.length, 1);
});

test("a mouse wheel with Shift held still zooms, also when the browser turned its scroll sideways", () => {
  const { map, wheel, wait } = rig();
  wheel(wheelEvent(0, { deltaX: 100, shiftKey: true }));
  wait(LONE_EVENT_MS);
  assert.equal(map.copies.length, 1);
  assert.equal(map.copies[0].deltaY, asMouseWheel(100));
  assert.equal(map.copies[0].shiftKey, true, "finer, as MapLibre zooms with Shift");
  assert.equal(map.eases.length, 0);
});

test("a pinch zooms as before: MapLibre has it untouched", () => {
  const { map, wheel } = rig();
  const pinch = wheel(wheelEvent(-1.25, { ctrlKey: true }));
  assert.equal(pinch.stopped, false);
  assert.equal(pinch.prevented, false);
  assert.equal(map.copies.length, 0);
  assert.equal(map.eases.length, 0);
});

test("a map that cannot be turned by a drag, or does not zoom on the wheel, is left as it was", () => {
  for (const options of [{ turnable: false }, { zooms: false }]) {
    const { map, wheel } = rig(options);
    const step = wheel(wheelEvent(2, { deltaX: -3 }));
    assert.equal(step.stopped, false);
    assert.equal(map.eases.length, 0);
  }
});

test("when anything goes wrong the event is MapLibre's, which zooms on it as before", () => {
  const { map, wheel } = rig();
  map.easeTo = () => {
    throw new Error("the map is between styles");
  };
  const step = wheel(turnEvent(2));
  assert.equal(step.stopped, false, "not stopped: MapLibre zooms on it");
  assert.equal(step.prevented, false);

  const broken = rig({}, { makeWheel: () => { throw new Error("no WheelEvent here"); } });
  const notch = broken.wheel(wheelEvent(WHEEL_ZOOM_DELTA * 25));
  assert.equal(notch.stopped, false);
});

test("letting go of the map lets go of a held notch", () => {
  const { map, wheel, timers, detach } = rig();
  wheel(wheelEvent(100));
  assert.equal(timers.size, 1);
  assert.equal(map.mapListeners.get("moveend").length, 1);
  detach();
  assert.equal(timers.size, 0);
  assert.equal(map.listeners.length, 0);
  assert.equal(map.mapListeners.get("moveend").length, 0);
  assert.equal(map.copies.length, 0);
  // A map with no canvas container gets nothing put on it.
  assert.equal(typeof attachMapGestures({}), "function");
  assert.equal(typeof attachMapGestures(null), "function");
});

test("the War Room's sheet hands the map its wheel and its right-button presses", () => {
  const copies = [];
  const map = { getCanvas: () => ({ dispatchEvent: (event) => copies.push(event) }) };
  const makers = {
    makeWheel: (init) => ({ type: "wheel", ...init }),
    makeMouse: (type, init) => ({ type, ...init }),
  };
  assert.equal(passToMap(map, { type: "wheel", deltaX: -2, deltaY: 3.5, deltaZ: 0, deltaMode: 0, clientX: 10, clientY: 20, ctrlKey: true }, makers), true);
  assert.equal(passToMap(map, { type: "mousedown", button: 2, buttons: 2, clientX: 11, clientY: 21 }, makers), true);
  assert.equal(copies[0].type, "wheel");
  assert.equal(copies[0].deltaX, -2);
  assert.equal(copies[0].deltaY, 3.5);
  assert.equal(copies[0].ctrlKey, true, "a pinch stays a pinch");
  assert.equal(copies[0].bubbles, true, "up to the canvas container, where the sorting and MapLibre listen");
  assert.equal(copies[1].type, "mousedown");
  assert.equal(copies[1].button, 2);
  assert.equal(copies[1].buttons, 2);
  assert.equal(copies[1].clientX, 11);
  assert.equal(passToMap({}, { type: "wheel" }, makers), false);
  assert.equal(passToMap(map, { type: "wheel" }, { makeWheel: () => { throw new Error("no WheelEvent"); } }), false);
});

test("the game's map turns and tilts with the right button and the trackpad, and touch is as it was", () => {
  const world = read("World.jsx");
  assert.match(world, /dragRotate=\{true\}/);
  assert.match(world, /pitchWithRotate=\{true\}/);
  assert.match(world, /maxPitch=\{60\}/);
  assert.match(world, /touchPitch=\{false\}/);
  // The camera reaches the whole Mercator square on a scenario's own map; the
  // real Earth stops at 80°S (Avatar: Resurrection lost its southern rows).
  assert.match(world, /maxBounds=\{maxBounds\}/);
  assert.match(world, /\[-Infinity, ownMapShown \? -MERCATOR_MAX_LAT : -80\]/);
  assert.match(world, /const ownMapShown = effectiveCustomBg\?\.kind === "image" \|\| effectiveCustomBg\?\.kind === "vector";/);
  assert.doesNotMatch(world, /dragRotate=\{false\}/);
  assert.match(world, /attachMapGestures\(mapInstance, \{ still: reduceMotionEnabled \}\)/);
  const tools = read("WarRoomTools.jsx");
  assert.match(tools, /sheet\.addEventListener\("wheel", wheel, \{ passive: false \}\)/);
  assert.match(tools, /const wheel = \(event\) => \{\n\s+event\.preventDefault\(\);\n\s+passToMap\(map, event\);/);
  assert.match(tools, /if \(event\.button === 2\) passToMap\(map, event\);/);
  assert.match(tools, /sheet\.addEventListener\("contextmenu", menu\)/);
  assert.match(read("GlobeEffects.jsx"), /"rotateend", "pitchend"/);
});
