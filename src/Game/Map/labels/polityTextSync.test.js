import test from "node:test";
import assert from "node:assert/strict";

import { POLITY_TEXT_RENDERER_LAYER_ID } from "./polityTextCustomLayer.js";
import { createPolityTextRuntime } from "./polityTextSync.js";

const fakeMap = () => {
  const layers = new Map();
  return {
    style: {},
    layers,
    getStyle: () => ({}),
    getLayer: (id) => layers.get(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    triggerRepaint: () => {},
    getProjection: () => ({ type: "mercator" }),
  };
};

const fakeLayer = ({ preparedEntries }) => ({
  id: POLITY_TEXT_RENDERER_LAYER_ID,
  entries: preparedEntries,
  replacements: 0,
  replacePreparedEntries(next) {
    this.entries = next;
    this.replacements += 1;
  },
});

// Stands in for measuring and the placement worker. A quick pass (no
// optimizer) answers at once; a refining pass waits until the test finishes or
// the runtime cancels it, and a cancelled pass answers null like the real one.
const fakePreparer = () => {
  const calls = [];
  const solves = [];
  const answer = (records, refined) => ({
    entries: records.map((record) => ({ key: record.id, entry: { record, refined } })),
    preparationMs: 0,
    placementWorkerMs: 0,
    placementTaskCount: refined ? records.length : 0,
    optimizableTaskCount: records.length,
  });
  const prepareRecords = async ({ records, onWorker, optimizePlacement = true }) => {
    calls.push({ ids: records.map((record) => record.id), refined: optimizePlacement });
    if (!optimizePlacement) return answer(records, false);
    return new Promise((resolve) => {
      const solve = {
        ids: records.map((record) => record.id),
        cancelled: false,
        finish: () => {
          onWorker(null, null);
          resolve(answer(records, true));
        },
      };
      solves.push(solve);
      onWorker({ terminate() {} }, () => {
        solve.cancelled = true;
        onWorker(null, null);
        resolve(null);
      });
    });
  };
  return { prepareRecords, calls, solves };
};

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const record = (id, text = id.toUpperCase()) => ({ id, owner: id, text });

const setup = (initialRecords) => {
  const map = fakeMap();
  const preparer = fakePreparer();
  let current = initialRecords;
  const runtime = createPolityTextRuntime({
    mapInstance: map,
    mode: "ptr1",
    getRecords: () => current,
    fontFamilies: ["serif"],
    prepareRecords: preparer.prepareRecords,
    createLayer: fakeLayer,
    waitForFonts: async () => {},
    enforceLayerOrder: () => {},
  });
  const publish = (next) => {
    current = next;
    return runtime.syncRecords({ invalidateInFlight: true });
  };
  const layer = () => map.layers.get(POLITY_TEXT_RENDERER_LAYER_ID);
  const shown = () => Object.fromEntries(layer().entries.map((entry) => [entry.record.id, entry.record.text + (entry.refined ? "" : " (quick)")]));
  return { map, runtime, preparer, publish, layer, shown };
};

const mounted = async (records) => {
  const harness = setup(records);
  harness.runtime.syncRecords();
  await settle();
  harness.preparer.solves.at(-1).finish();
  await settle();
  return harness;
};

test.afterEach(() => {
  delete globalThis.__OH_MAP_SOURCE_PERF__;
  delete globalThis.__OH_POLITY_TEXT_PTR0__;
});

test("style wakeups never cancel the placement solve in flight", async () => {
  const { runtime, preparer, layer, shown } = setup([record("japan"), record("china")]);
  runtime.syncRecords();
  await settle();
  assert.equal(preparer.solves.length, 1);

  runtime.syncRecords({ invalidateInFlight: false });
  runtime.syncRecords({ invalidateInFlight: true });
  await settle();
  assert.equal(preparer.solves[0].cancelled, false, "the same records are not a revision");

  preparer.solves[0].finish();
  await settle();
  assert.ok(layer(), "the layer mounts from the first solve");
  assert.deepEqual(shown(), { japan: "JAPAN", china: "CHINA" });
  assert.equal(preparer.calls.length, 1);
  runtime.dispose();
});

test("newer records cancel the solve, and the follow-up sync runs exactly once", async () => {
  const { runtime, preparer, publish, shown } = await mounted([record("japan"), record("china")]);

  publish([record("japan", "NIPPON"), record("china")]);
  await settle();
  const refining = preparer.solves.at(-1);
  assert.deepEqual(refining.ids, ["japan"]);

  publish([record("japan", "NIPPON"), record("china", "ZHONGGUO")]);
  publish([record("japan", "NIPPON"), record("china", "ZHONGGUO")]);
  await settle();
  assert.equal(refining.cancelled, true);

  const followUps = preparer.calls.slice(3);
  assert.deepEqual(followUps, [
    { ids: ["china"], refined: false },
    { ids: ["china", "japan"], refined: true },
  ], "one follow-up pass for both invalidations");
  preparer.solves.at(-1).finish();
  await settle();
  assert.deepEqual(shown(), { japan: "NIPPON", china: "ZHONGGUO" });
  runtime.dispose();
});

test("a label whose refinement was cancelled is still refined by the next pass", async () => {
  const { runtime, preparer, publish, shown } = await mounted([record("japan"), record("indonesia"), record("china")]);

  publish([record("japan", "NIPPON"), record("indonesia", "NUSANTARA"), record("china")]);
  await settle();
  assert.deepEqual(shown(), { japan: "NIPPON (quick)", indonesia: "NUSANTARA (quick)", china: "CHINA" });

  // A second world write arrives while the first one is being refined.
  publish([record("japan", "NIPPON"), record("indonesia", "NUSANTARA"), record("china", "ZHONGGUO")]);
  await settle();
  preparer.solves.at(-1).finish();
  await settle();

  assert.deepEqual(shown(), { japan: "NIPPON", indonesia: "NUSANTARA", china: "ZHONGGUO" });
  assert.equal(runtime.unrefinedKeys.size, 0);
  runtime.dispose();
});

test("an unchanged snapshot publishes nothing", async () => {
  const { runtime, preparer, publish, layer } = await mounted([record("japan"), record("china")]);
  const callsBefore = preparer.calls.length;

  await publish([record("japan"), record("china")]);
  await settle();
  runtime.syncRecords({ invalidateInFlight: false });
  await settle();

  assert.equal(preparer.calls.length, callsBefore);
  assert.equal(layer().replacements, 0);
  runtime.dispose();
});

test("a removed polity leaves the layer without preparing anything", async () => {
  const { runtime, preparer, publish, shown } = await mounted([record("japan"), record("china")]);
  const callsBefore = preparer.calls.length;

  publish([record("china")]);
  await settle();
  preparer.solves.at(-1)?.finish();
  await settle();

  assert.deepEqual(shown(), { china: "CHINA" });
  assert.deepEqual(preparer.calls.slice(callsBefore).flatMap((call) => call.ids), []);
  runtime.dispose();
});
