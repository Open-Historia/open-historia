import test from "node:test";
import assert from "node:assert/strict";
import { classifyDevice, mapRuntimeLimits } from "./deviceProfile.js";

test("the Android app and touch-only screens take the constrained path", () => {
  assert.equal(classifyDevice({ native: true }), true);
  assert.equal(classifyDevice({ touchOnly: true, deviceMemoryGb: 8 }), true);
});

test("deviceMemory can say small but never big: 8 is the spec's cap, not a desktop", () => {
  assert.equal(classifyDevice({ deviceMemoryGb: 2 }), true);
  assert.equal(classifyDevice({ deviceMemoryGb: 4 }), true);
  assert.equal(classifyDevice({ deviceMemoryGb: 8 }), false);
  // A browser that does not report it (Firefox, Safari) is not guessed small.
  assert.equal(classifyDevice({ deviceMemoryGb: null }), false);
  assert.equal(classifyDevice({ deviceMemoryGb: 0 }), false);
  assert.equal(classifyDevice({}), false);
});

test("the stored override wins over every signal", () => {
  assert.equal(classifyDevice({ native: true, override: "full" }), false);
  assert.equal(classifyDevice({ deviceMemoryGb: 16, override: "constrained" }), true);
  assert.equal(classifyDevice({ native: true, override: "something else" }), true);
});

test("a phone gets two MapLibre workers and eight requests; a desktop what it had", () => {
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 8, constrained: true }), { workerCount: 2, parallelImageRequests: 8 });
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 8 }), { workerCount: 4, parallelImageRequests: 16 });
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 16 }), { workerCount: 6, parallelImageRequests: 24 });
  assert.deepEqual(mapRuntimeLimits({ hardwareThreads: 2 }), { workerCount: 2, parallelImageRequests: 16 });
  assert.deepEqual(mapRuntimeLimits({}), { workerCount: 2, parallelImageRequests: 16 });
});

test("only the map imports maplibre-gl, so the first download goes without it", async () => {
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  assert.doesNotMatch(read("./assets.js"), /from "maplibre-gl"/);
  assert.doesNotMatch(read("../main.jsx"), /configureMapRuntime/);
  assert.match(read("../App.jsx"), /const WorldMap = lazy\(\(\) => import\("\.\/Game\/Map\/World\.jsx"\)\)/);
  assert.match(read("../Game/Map/World.jsx"), /\nconfigureMapRuntime\(\);/);
});
