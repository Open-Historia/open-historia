import test from "node:test";
import assert from "node:assert/strict";
import { holdUntilSourceLoaded } from "./regionsSourceMemory.js";

const fakeMap = (source = null) => {
  const listeners = new Map();
  return {
    source,
    getSource: (id) => (id === "custom-regions-source" ? source : undefined),
    on: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    off: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== fn)),
    fire: (type, event) => (listeners.get(type) ?? []).forEach((fn) => fn(event)),
    listenerCount: (type) => (listeners.get(type) ?? []).length,
  };
};

const fakeTimers = () => {
  const pending = new Map();
  let next = 0;
  return {
    setTimer: (fn, ms) => {
      next += 1;
      pending.set(next, { fn, ms });
      return next;
    },
    clearTimer: (id) => pending.delete(id),
    fire: () => {
      for (const [id, { fn }] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
    pending,
  };
};

test("the worker's parse waits for MapLibre's to finish", () => {
  let loaded = false;
  const map = fakeMap({ loaded: () => loaded });
  const timers = fakeTimers();
  const releases = [];
  holdUntilSourceLoaded({ map, sourceId: "custom-regions-source", onRelease: (reason) => releases.push(reason), ...timers });
  assert.deepEqual(releases, []);

  map.fire("sourcedata", { sourceId: "custom-regions-source", sourceDataType: "metadata" });
  assert.deepEqual(releases, [], "still parsing");
  loaded = true;
  map.fire("sourcedata", { sourceId: "other-source" });
  assert.deepEqual(releases, [], "another source's event");
  map.fire("sourcedata", { sourceId: "custom-regions-source", sourceDataType: "content" });
  assert.deepEqual(releases, ["source-loaded"]);

  map.fire("sourcedata", { sourceId: "custom-regions-source" });
  timers.fire();
  assert.deepEqual(releases, ["source-loaded"], "released once");
  assert.equal(map.listenerCount("sourcedata"), 0);
  assert.equal(timers.pending.size, 0);
});

test("a source that never loads is waited for 30 seconds at most", () => {
  const map = fakeMap(null);
  const timers = fakeTimers();
  const releases = [];
  holdUntilSourceLoaded({ map, sourceId: "custom-regions-source", onRelease: (reason) => releases.push(reason), ...timers });
  assert.equal([...timers.pending.values()][0].ms, 30000);
  timers.fire();
  assert.deepEqual(releases, ["timeout"]);
  assert.equal(map.listenerCount("sourcedata"), 0);
});

test("a source already loaded (a worker restart) releases at once; cancel releases nothing", () => {
  const releases = [];
  const ready = fakeMap({ loaded: () => true });
  const timers = fakeTimers();
  holdUntilSourceLoaded({ map: ready, sourceId: "custom-regions-source", onRelease: (reason) => releases.push(reason), ...timers });
  assert.deepEqual(releases, ["source-loaded"]);
  assert.equal(timers.pending.size, 0);

  const waiting = fakeMap({ loaded: () => false });
  const hold = holdUntilSourceLoaded({ map: waiting, sourceId: "custom-regions-source", onRelease: (reason) => releases.push(reason), ...timers });
  hold.cancel();
  timers.fire();
  assert.deepEqual(releases, ["source-loaded"]);
  assert.equal(waiting.listenerCount("sourcedata"), 0);
});
