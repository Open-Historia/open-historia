import test from "node:test";
import assert from "node:assert/strict";
import { MAX_REGION_TYPES, normalizeRegionTypes } from "../runtime/regionTypes.js";
import {
  canCreateRegionType, filterRegionTypes, regionTypeDeletionReason, uniqueRegionTypeId,
} from "./regionTypeManagement.js";

const types = [
  { id: "land", name: "Land" },
  { id: "sea", name: "Sea", water: true },
  { id: "mountains", name: "Mountains", pathfindingSpeed: 0.5 },
];
const usage = { land: 4420, sea: 0, mountains: 6 };

test("type manager cannot delete referenced types, including ones not currently displayed", () => {
  assert.match(regionTypeDeletionReason(types, usage, "land"), /4,?420 regions/);
  assert.match(regionTypeDeletionReason(types, usage, "mountains"), /6 regions/);
  assert.equal(regionTypeDeletionReason(types, usage, "sea"), null);
  assert.match(regionTypeDeletionReason([types[0]], {}, "land"), /At least one/);
  assert.match(regionTypeDeletionReason(types, usage, "missing"), /no longer exists/);
});

test("region type creation honors native 64 type limit without silent export truncation", () => {
  assert.equal(MAX_REGION_TYPES, 64);
  assert.equal(canCreateRegionType(types), true);
  const full = Array.from({ length: MAX_REGION_TYPES }, (_, i) => ({ id: "type_" + i, name: "T" + i }));
  assert.equal(canCreateRegionType(full), false);
  assert.equal(normalizeRegionTypes(full).length, MAX_REGION_TYPES);
  assert.equal(normalizeRegionTypes([...full, { id: "overflow", name: "Overflow" }]).length, MAX_REGION_TYPES);
});

test("filter type catalog by name, stable ID and actual map usage", () => {
  assert.deepEqual(filterRegionTypes(types, usage, { query: "mount" }).map((x) => x.id), ["mountains"]);
  assert.deepEqual(filterRegionTypes(types, usage, { query: "SEA" }).map((x) => x.id), ["sea"]);
  assert.deepEqual(filterRegionTypes(types, usage, { scope: "unused" }).map((x) => x.id), ["sea"]);
  assert.deepEqual(filterRegionTypes(types, usage, { scope: "used" }).map((x) => x.id), ["land", "mountains"]);
});

test("new type IDs never duplicate existing canonical references", () => {
  assert.equal(uniqueRegionTypeId(types, "fresh"), "type_fresh");
  assert.equal(uniqueRegionTypeId([{ id: "type_fresh" }, { id: "type_fresh_2" }], "fresh"), "type_fresh_3");
});
