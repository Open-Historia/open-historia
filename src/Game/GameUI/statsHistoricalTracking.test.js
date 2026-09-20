import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoricalTrackingCandidateRows,
  filterHistoricalTrackingCandidateRows,
} from "./statsHistoricalTracking.js";

const world = {
  polityOverrides: {
    "Republic of Latvia": { name: "Republic of Latvia", aliases: ["Latvia"], status: "active" },
    "Republic of Lithuania": { name: "Republic of Lithuania", aliases: ["Lithuania"], status: "active" },
    "Republic of Estonia": { name: "Republic of Estonia", code: "EST", aliases: ["Estonia"], status: "active" },
    "Government in Exile": { name: "Government in Exile", status: "active" },
  },
  countryStats: {
    Latvia: { population: 1 },
    Lithuania: { population: 1 },
    Estonia: { population: 1 },
  },
  regionOwnershipOverrides: {
    LVA_1: "Republic of Latvia",
    LTU_1: "Republic of Lithuania",
    EST_1: "Republic of Estonia",
  },
  regionSovereigntyOverrides: {},
};

test("historical tracking builds canonical rows once and excludes landless declared polities", () => {
  const { rows, index } = buildHistoricalTrackingCandidateRows({
    world,
    playerCountry: "Latvia",
    currentCountry: "Estonia",
  });
  assert.deepEqual(rows.map((row) => row.key).sort(), [
    "Republic of Estonia",
    "Republic of Latvia",
    "Republic of Lithuania",
  ]);
  assert.equal(index.canonicalKey("Lithuania"), "Republic of Lithuania");
  assert.equal(index.displayName("EST"), "Republic of Estonia");
  assert.equal(index.isLandless("Government in Exile"), true);
});

test("historical tracking search is string-only over precomputed rows", () => {
  const { rows } = buildHistoricalTrackingCandidateRows({ world, playerCountry: "Latvia" });
  assert.deepEqual(filterHistoricalTrackingCandidateRows(rows, "eston").map((row) => row.key), ["Republic of Estonia"]);
  assert.deepEqual(filterHistoricalTrackingCandidateRows(rows, "republic of lith").map((row) => row.key), ["Republic of Lithuania"]);
  assert.equal(filterHistoricalTrackingCandidateRows(rows, "zzzz").length, 0);
});

test("stock-map saves with no ownership override ledger do not mark undeclared countries landless", () => {
  const stockWorld = { polityOverrides: {}, countryStats: { EST: {} }, regionOwnershipOverrides: {}, regionSovereigntyOverrides: {} };
  const { rows } = buildHistoricalTrackingCandidateRows({ world: stockWorld, currentCountry: "EST" });
  assert.ok(rows.some((row) => row.key));
});
