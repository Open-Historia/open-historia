import test from "node:test";
import assert from "node:assert/strict";
import { ownersMatchingQuery, polityDisplayName, regionMatchesQuery } from "./regionSearch.js";

const polities = {
  DEU: { name: "Germany", aliases: ["Federal Republic of Germany", "Deutschland"] },
  France: { name: "France", aliases: [] },
  Prussia: { aliases: ["Kingdom of Prussia"] },
};

const search = (regions, query) => {
  const owners = ownersMatchingQuery(polities, query);
  return regions.filter((region) => regionMatchesQuery(region, query, owners)).map((region) => region.id);
};

const regions = [
  { id: "r1", name: "Bavaria", owner: "DEU" },
  { id: "r2", name: "Alsace", owner: "France" },
  { id: "r3", name: "Brandenburg", owner: "Prussia" },
  { id: "r4", name: "Open sea", owner: null },
];

test("a region is found by its owner's display name, not only the owner key", () => {
  assert.deepEqual(search(regions, "germany"), ["r1"]);
  assert.deepEqual(search(regions, "DEU"), ["r1"]);
});

test("a region is found by one of its owner's aliases", () => {
  assert.deepEqual(search(regions, "deutschland"), ["r1"]);
  assert.deepEqual(search(regions, "kingdom of"), ["r3"]);
});

test("id, name and owner key still match, and an empty query matches everything", () => {
  assert.deepEqual(search(regions, "r2"), ["r2"]);
  assert.deepEqual(search(regions, "bavar"), ["r1"]);
  assert.deepEqual(search(regions, "prussia"), ["r3"]);
  assert.deepEqual(search(regions, "  "), ["r1", "r2", "r3", "r4"]);
});

test("an unowned region never matches through a polity", () => {
  assert.deepEqual(search(regions, "sea"), ["r4"]);
  assert.equal(ownersMatchingQuery(polities, "").size, 0);
});

test("the display name is the record's name, else the exact key", () => {
  assert.equal(polityDisplayName(polities, "DEU"), "Germany");
  assert.equal(polityDisplayName(polities, "Prussia"), "Prussia");
  assert.equal(polityDisplayName(polities, "Russian Federation"), "Russian Federation");
  assert.equal(polityDisplayName(polities, null), "");
  assert.equal(polityDisplayName(undefined, "DEU"), "DEU");
});
