import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoricalTrackingCandidateRows,
  buildHistoricalTrackingIndex,
  filterHistoricalTrackingCandidateRows,
  historySamplesInRange,
  historyMetricValue,
  historyMetricPath,
  historyMetricChange,
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

test("the Advanced Statistics time range filters campaigns before 1970 and BC", () => {
  const dates = (samples) => samples.map((sample) => sample.date);
  const interwar = [{ date: "1930-01-01" }, { date: "1935-06-01" }, { date: "1936-03-01" }];
  assert.deepEqual(dates(historySamplesInRange(interwar, "1y")), ["1935-06-01", "1936-03-01"]);
  assert.deepEqual(dates(historySamplesInRange(interwar, "5y")), ["1935-06-01", "1936-03-01"]);
  assert.deepEqual(dates(historySamplesInRange(interwar, "10y")), dates(interwar));
  assert.deepEqual(dates(historySamplesInRange(interwar, "all")), dates(interwar));

  const ancient = [{ date: "-0220-01-01" }, { date: "-0217-02-01" }, { date: "-0217-12-01" }];
  assert.deepEqual(dates(historySamplesInRange(ancient, "1y")), ["-0217-02-01", "-0217-12-01"]);

  const modern = [{ date: "2010-01-01" }, { date: "2016-01-01" }];
  assert.deepEqual(dates(historySamplesInRange(modern, "5y")), ["2016-01-01"]);
  assert.deepEqual(historySamplesInRange([{ date: "not a date" }], "1y"), [{ date: "not a date" }]);
});

test("the Stats pane's one identity index serves Diplomacy names and the tracking list", () => {
  const index = buildHistoricalTrackingIndex(world);
  assert.equal(index.canonicalKey("Latvia"), "Republic of Latvia");
  assert.equal(index.displayName("latvia"), "Republic of Latvia");
  assert.equal(index.displayName(""), "Unknown polity");
  assert.equal(index.canonicalKey("Nowhere Else"), "Nowhere Else", "an unknown name stays as written");

  let lookups = 0;
  const counted = {
    ...index,
    canonicalKey: (value) => { lookups += 1; return index.canonicalKey(value); },
  };
  const { index: used, rows } = buildHistoricalTrackingCandidateRows({ world, playerCountry: "Latvia", index: counted });
  assert.equal(used, counted, "a provided index is used, not rebuilt");
  assert.ok(lookups > 0);
  assert.ok(rows.some((row) => row.key === "Republic of Latvia"));
});

test("every land-holding polity can be tracked, not only those already opened in Stats", () => {
  const ledgerWorld = {
    polityOverrides: {},
    countryStats: {},
    regionOwnershipOverrides: { A_1: "Kingdom of Aragon", A_2: "Kingdom of Aragon", C_1: "Crown of Castile" },
    regionSovereigntyOverrides: { N_1: "Kingdom of Navarre" },
  };
  const { rows } = buildHistoricalTrackingCandidateRows({ world: ledgerWorld, stockNames: ["France"] });
  assert.deepEqual(rows.map((row) => row.key), ["Crown of Castile", "Kingdom of Aragon", "Kingdom of Navarre"]);

  const stockWorld = { polityOverrides: {}, countryStats: {}, regionOwnershipOverrides: {}, regionSovereigntyOverrides: {} };
  const stock = buildHistoricalTrackingCandidateRows({ world: stockWorld, playerCountry: "France", stockNames: ["France", "Germany", "Spain"] });
  assert.deepEqual(stock.rows.map((row) => row.key), ["France", "Germany", "Spain"]);
});

test("sparse medieval observations leave chart gaps and retain genuine zeros", () => {
  const samples = [
    { date: "1200-01-01", x: 0, customStats: { grain: 5 } },
    { date: "1200-02-01", x: 1, customStats: { grain: null } },
    { date: "1200-03-01", x: 2, customStats: { grain: 0 } },
    { date: "1200-04-01", x: 3, customStats: { grain: 3 } },
  ];
  assert.equal(historyMetricPath(samples, "grain", (s) => s.x, (v) => v), "M0.00,5.00 M2.00,0.00 L3.00,3.00");
  assert.deepEqual(historyMetricChange(samples, "grain"), { end: 3, delta: -2 });
  assert.deepEqual(historyMetricChange(samples.slice(0, 2), "grain"), { end: 5, delta: null });
  assert.deepEqual(historyMetricChange(samples, "unrecorded"), { end: null, delta: null });
  for (const value of [null, "", " ", false, [], undefined]) {
    assert.equal(historyMetricValue({ customStats: { grain: value } }, "grain"), null);
  }
  assert.equal(historyMetricValue({ indices: { security: 0 } }, "security"), 0);
  assert.equal(historyMetricValue({ population: 1200 }, "population"), 1200);
});

test("scenario metrics with stock names use their own history values and gaps", () => {
  const samples = [{ date: "1200-01-01", x: 0, gdp: 1000000, customStats: { gdp: 12 } },
    { date: "1200-02-01", x: 1, gdp: 2000000 },
    { date: "1200-03-01", x: 2, gdp: 3000000, customStats: { gdp: 20 } }];
  const options = { custom: true };
  assert.equal(historyMetricValue(samples[0], "gdp", options), 12);
  assert.equal(historyMetricValue(samples[1], "gdp", options), null);
  assert.equal(historyMetricValue(samples[0], "gdp"), 1000000);
  assert.equal(historyMetricPath(samples, "gdp", (s) => s.x, (v) => v, options), "M0.00,12.00 M2.00,20.00");
  assert.deepEqual(historyMetricChange(samples, "gdp", options), { end: 20, delta: 8 });
});
