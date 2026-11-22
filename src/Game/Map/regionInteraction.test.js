// N033: test the actual gameplay click dispatcher, with only MapLibre and
// the popup/command side effects substituted. Region types are real runtime
// objects, not a second implementation of hit testing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as typesModule from "../../runtime/regionTypes.js";

const source = readFileSync(new URL("./Nations.jsx", import.meta.url), "utf8");
const start = source.indexOf("  const handleRegionClick = useCallback(");
const end = source.indexOf("\n  useEffect(() => {", start);
assert.ok(start >= 0 && end > start, "gameplay click handler");
const types = [
  { id: "sea", water: true, interactable: false },
  { id: "inaccessible", interactable: false },
  { id: "territorial-sea", water: true, interactable: true },
];
const records = [
  { id: "sea-1", typeId: "sea" },
  { id: "land-1", typeId: "inaccessible" },
  { id: "sea-2", typeId: "territorial-sea" },
  { id: "land-2", typeId: "land" },
];
const policy = (...args) => typesModule.regionSelectionPolicy(...args);
const hit = (id, extra = {}) => ({ properties: { GID_1: id, name: id, owner: "France", ...extra } });
const marker = { layer: { id: "markers-shapes-rig" }, properties: { id: "rig", name: "Oil platform", ownerCode: "France", kind: "rig" }, geometry: { coordinates: [12, 43] } };
const fleet = { properties: { id: "fleet" } };

const runClick = async ({ region = null, unit = null, feature = null, mode = { kind: "idle" }, authored = true } = {}) => {
  const calls = [];
  const record = (name) => (...args) => { calls.push([name, ...args]); };
  const layers = new Set(["custom-regions-fill", "regions-fill", "units-fill", "markers-shapes-rig"]);
  const deps = {
    useCallback: (fn) => fn,
    map: {
      getLayer: (name) => layers.has(name),
      queryRenderedFeatures: (_point, { layers: requested }) => requested.includes("units-fill")
        ? (unit ? [unit] : [])
        : requested.includes("markers-shapes-rig")
          ? (feature ? [feature] : [])
          : (region ? [region] : []),
    },
    regionClaimants: {},
    scenarioOwnsRegionGeometryAtAllZooms: authored,
    canSelectRegion: policy(types, records),
    ownerLookupRef: { current: new Map() },
    trueOwnershipRef: { current: null },
    getWorldStateSnapshot: () => ({}),
    resolveRegionName: (_id, name) => name,
    toCountryName: (name) => name,
    V_NEXT_MARKER_SHAPE_LAYER_IDS: ["markers-shapes-rig"],
    diplomaticViewRef: { current: null },
    getInteractionMode: () => mode,
    clearInteractionMode: record("clear-mode"),
    dismissRegionPopup: record("dismiss-region"),
    dismissUnitPopup: record("dismiss-unit"),
    dismissFeaturePopup: record("dismiss-feature"),
    onUnitSelected: record("unit"),
    onFeatureSelected: record("feature"),
    onRegionSelected: record("region"),
    onOceanClicked: record("ocean"),
    saveSettledStructure: async (...args) => { record("settle")(...args); },
    placeUnitAdmin: async (...args) => { record("admin")(...args); return true; },
    deployUnit: async (...args) => { record("deploy")(...args); return { ok: true }; },
  };
  const keys = Object.keys(deps);
  const handler = new Function(...keys, source.slice(start, end) + "\nreturn handleRegionClick;")(...keys.map((key) => deps[key]));
  await handler({ point: { x: 20, y: 40 }, lngLat: { lng: 12, lat: 43 } });
  return calls;
};
const selection = (calls) => calls.filter(([name]) => ["region", "ocean", "unit", "feature", "deploy", "settle", "admin"].includes(name));

test("N033: canonical stable region ID wins over missing or stale rendered type metadata", () => {
  const canSelect = policy(types, records);
  assert.equal(canSelect({ GID_1: "sea-1" }), false);
  assert.equal(canSelect({ id: "sea-1", typeId: "land" }), false);
  assert.equal(canSelect({ id: "land-1" }), false);
  assert.equal(canSelect({ id: "sea-2", typeId: "sea" }), true);
  assert.equal(canSelect({ id: "land-2" }), true);
  assert.equal(canSelect({ id: "unknown", typeId: "sea" }), false, "rendered type fallback before catalog arrives");
  assert.equal(canSelect({ id: "legacy" }), true);
  assert.equal(policy([], records)({ id: "sea-1" }), true);
});
test("N033: bare non-interactable land and water take the ocean/background path, on authored and stock layer stacks", async () => {
  for (const authored of [true, false]) {
    for (const id of ["sea-1", "land-1"]) {
      assert.deepEqual(selection(await runClick({ region: hit(id), authored })), [["ocean"]]);
    }
    for (const id of ["sea-2", "land-2", "legacy"]) {
      const calls = selection(await runClick({ region: hit(id), authored }));
      assert.equal(calls[0][0], "region");
      assert.equal(calls[0][1].GID_1, id);
    }
  }
});
test("N033: independently clickable fleets and structures retain their identity over a disabled sea polygon", async () => {
  const unit = selection(await runClick({ region: hit("sea-1"), unit: fleet, feature: marker }));
  assert.equal(unit[0][0], "unit");
  assert.equal(unit[0][1].id, "fleet");
  const rig = selection(await runClick({ region: hit("sea-1"), feature: marker }));
  assert.equal(rig[0][0], "feature");
  assert.equal(rig[0][1].id, "rig");
  assert.equal(rig[0][1].hostRegionId, "sea-1");
  assert.equal(rig[0][1].hostRegionName, "sea-1");
  assert.equal(rig[0][1].hostRegion, null, "no link back into disabled territory");
  const enabled = selection(await runClick({ region: hit("sea-2"), feature: marker }));
  assert.equal(enabled[0][1].hostRegion.GID_1, "sea-2", "normal host link preserved");
});
test("N033: explicitly armed deployment and structure placement do not use territory selection", async () => {
  for (const [mode, action] of [
    [{ kind: "deploy", params: { type: "naval" } }, "deploy"],
    [{ kind: "structure-place", markerId: "rig" }, "settle"],
    [{ kind: "admin-place", unitId: "fleet" }, "admin"],
  ]) {
    const calls = selection(await runClick({ region: hit("sea-1"), mode }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], action);
  }
});
