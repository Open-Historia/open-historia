import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKSPACE_PAGE_SIZE, filterRegionsForWorkspace, filterMapFeaturesForWorkspace,
  filterUnitsForWorkspace, groupRowsForWorkspace, selectionAfterWorkspacePick, pageOf,
} from "./editorWorkspaceFilters.js";

test("region browser queries all 4426 canonical rows instead of truncating the registry to 300", () => {
  const regions = Array.from({ length: 4426 }, (_, n) => ({
    id: String(n + 1), name: `Region ${n + 1}`, owner: n % 2 ? "DEU" : "FRA",
    group: n % 3 ? "" : "Rebels", typeId: n % 5 ? "land" : "sea",
  }));
  assert.equal(filterRegionsForWorkspace(regions).length, 4426);
  assert.equal(pageOf(filterRegionsForWorkspace(regions)).length, WORKSPACE_PAGE_SIZE);
  assert.equal(filterRegionsForWorkspace(regions, { owner: "DEU" }).length, 2213);
  assert.equal(filterRegionsForWorkspace(regions, { group: "Rebels" }).length, 1476);
  assert.equal(filterRegionsForWorkspace(regions, { typeId: "sea" }).length, 886);
  assert.deepEqual(filterRegionsForWorkspace(regions, { selectedOnly: true, selectedIds: ["5", "8"] }).map((r) => r.id), ["5", "8"]);
});

test("region filtering preserves stable IDs and matches polity display aliases", () => {
  const rows = [
    { id: "a", name: "Brandenburg", owner: "DEU", group: "Insurgency", typeId: "land" },
    { id: "b", name: "Prussia", owner: "RUS", group: "", typeId: "land" },
    { id: "c", name: "Ocean", owner: null, typeId: "sea" },
  ];
  const polities = { DEU: { name: "German Empire", aliases: ["Kaiserreich"] }, RUS: { name: "Russian Empire" } };
  assert.deepEqual(filterRegionsForWorkspace(rows, { query: "Kaiserreich", polities }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterRegionsForWorkspace(rows, { owner: "", polities }).map((r) => r.id), ["c"]);
  assert.deepEqual(filterRegionsForWorkspace(rows, { group: "Insurgency" }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterRegionsForWorkspace(rows, { sort: "id" }).map((r) => r.id), ["a", "b", "c"]);
});

test("list selection distinguishes click, Ctrl toggle, Shift range, and additive range", () => {
  const shown = ["a", "b", "c", "d"];
  assert.deepEqual(selectionAfterWorkspacePick(["a"], shown, "c"), ["c"]);
  assert.deepEqual(selectionAfterWorkspacePick(["a"], shown, "b", { additive: true }), ["a", "b"]);
  assert.deepEqual(selectionAfterWorkspacePick(["a", "b"], shown, "b", { additive: true }), ["a"]);
  assert.deepEqual(selectionAfterWorkspacePick(["d"], shown, "c", { range: true, anchor: "a" }), ["a", "b", "c"]);
  assert.deepEqual(selectionAfterWorkspacePick(["d"], shown, "c", { range: true, anchor: "a", additive: true }), ["d", "a", "b", "c"]);
  assert.deepEqual(selectionAfterWorkspacePick(["d"], shown, "c", { range: true, anchor: "missing" }), ["c"]);
});

test("places can filter city/marker, kind, owner, tags and selection without truncation", () => {
  const rows = [
    { id: "a", name: "Berlin", country: "DEU", coord: [13, 52], tags: ["city", "capital"] },
    { id: "b", name: "Port A", owner: "DEU", kind: "port", coord: [14, 50], tags: ["feature"] },
    { id: "c", name: "Fort B", owner: "FRA", kind: "fortress", tags: ["feature"] },
  ];
  assert.deepEqual(filterMapFeaturesForWorkspace(rows, { category: "city" }).map((f) => f.id), ["a"]);
  assert.deepEqual(filterMapFeaturesForWorkspace(rows, { category: "feature" }).map((f) => f.id), ["c", "b"]);
  assert.deepEqual(filterMapFeaturesForWorkspace(rows, { category: "port" }).map((f) => f.id), ["b"]);
  assert.deepEqual(filterMapFeaturesForWorkspace(rows, { owner: "DEU" }).map((f) => f.id), ["a", "b"]);
  assert.deepEqual(filterMapFeaturesForWorkspace(rows, { query: "capital" }).map((f) => f.id), ["a"]);
  assert.deepEqual(filterMapFeaturesForWorkspace(rows, { selectedOnly: true, selectedIds: ["b"] }).map((f) => f.id), ["b"]);
});

test("starting unit list searches composition and custom unit names, retains original objects", () => {
  const units = [
    { id: "1", name: "3rd Army", ownerCode: "DEU", type: "infantry", unitType: "foot", composition: "grenadiers" },
    { id: "2", name: "Northern Fleet", ownerCode: "RUS", type: "naval", note: "Arctic patrol" },
  ];
  const options = { unitTypes: [{ id: "foot", name: "Historical infantry" }], polityName: (key) => key === "DEU" ? "German Empire" : key };
  assert.deepEqual(filterUnitsForWorkspace(units, { ...options, query: "historical" }).map((u) => u.id), ["1"]);
  assert.deepEqual(filterUnitsForWorkspace(units, { ...options, query: "arctic" }).map((u) => u.id), ["2"]);
  assert.deepEqual(filterUnitsForWorkspace(units, { ...options, owner: "DEU", kind: "naval" }), []);
  assert.equal(filterUnitsForWorkspace(units, options)[0], units[0]);
});

test("nonterritorial groups remain full actors and searchable by description and sponsor", () => {
  const groups = {
    "Labour Union": { description: "Trade union movement", color: "#ff0000" },
    "Foreign Legion": { description: "Overseas volunteers", owner: "FRA" },
  };
  const usage = { "Foreign Legion": 3 };
  assert.equal(groupRowsForWorkspace(groups, usage).length, 2);
  assert.deepEqual(groupRowsForWorkspace(groups, usage, { scope: "landless" }).map((r) => r.key), ["Labour Union"]);
  assert.deepEqual(groupRowsForWorkspace(groups, usage, { scope: "territorial" }).map((r) => r.key), ["Foreign Legion"]);
  assert.deepEqual(groupRowsForWorkspace(groups, usage, { query: "trade" }).map((r) => r.key), ["Labour Union"]);
  assert.deepEqual(groupRowsForWorkspace(groups, usage, { query: "fra" }).map((r) => r.key), ["Foreign Legion"]);
});
