import test from "node:test";
import assert from "node:assert/strict";
import { historicalStatSourceLabel, nationalStatSourceRows } from "./statSourceView.js";
import { mergeCountryStatPatch, buildCountryStatHistorySample } from "../../runtime/countryStats.js";

const definition = { custom: true, sections: [{ key: "realm", label: "Realm", stats: [
  { key: "treasury", label: "Treasury", kind: "currency", suffix: "silver marks" },
  { key: "grain", label: "Grain reserves", kind: "number" },
] }] };

test("custom sources preserve historical labels and distinguish unknown and zero", () => {
  const sheet = mergeCountryStatPatch(null, { customStats: { treasury: 0 } }, { origin: { source: "manual", date: "1200-01-01", round: 0 } });
  const rows = nationalStatSourceRows({ sheet, definition });
  assert.equal(rows[0].label, "Treasury");
  assert.equal(rows[0].value, 0);
  assert.equal(rows[0].sourceLabel, "Manual edit");
  assert.equal(rows[0].round, 0);
  assert.equal(rows[1].sourceLabel, "Unknown");
  assert.equal(rows.some((row) => row.path === "economy.gdp"), false, "custom sheets do not expose hidden backend fields");
});

test("standard population, economy, indices, and sectors share the same source interface", () => {
  const sheet = mergeCountryStatPatch(null, { population: { total: 1200 }, economy: { gdp: 50000 }, indices: { sovereignty: 60 }, gdpBreakdown: { agriculture: 80, industry: 10, services: 10 } }, { origin: { source: "ai", round: 1 } });
  const rows = nationalStatSourceRows({ sheet });
  for (const path of ["population.total", "economy.gdp", "indices.sovereignty", "gdpBreakdown.agriculture"]) {
    assert.equal(rows.find((row) => row.path === path)?.source, "ai");
  }
  assert.equal(nationalStatSourceRows({ sheet: { stability: 50 } }).find((row) => row.path === "stability").sourceLabel, "Source unspecified");
});

test("derived and default military/intelligence figures do not impersonate observations", () => {
  const rows = nationalStatSourceRows({ world: {}, country: "Realm" });
  assert.equal(rows.find((row) => row.path === "intelligenceService").sourceLabel, "Game default");
  assert.equal(rows.find((row) => row.path === "military.quality").sourceLabel, "Game default");
  assert.equal(rows.find((row) => row.path === "militaryPower").sourceLabel, "Unknown");
});

test("historical tooltips use the snapshot origin rather than the current source", () => {
  const old = mergeCountryStatPatch(null, { customStats: { grain: 12 }, economy: { gdp: 50000 } }, { origin: { source: "ai", date: "1200-01-01" } });
  const sample = buildCountryStatHistorySample(old, { date: "1200-01-01", round: 1 });
  assert.equal(historicalStatSourceLabel(sample, { key: "grain", unit: "custom:number::sacks" }, 12), "AI estimate");
  assert.equal(historicalStatSourceLabel(sample, { key: "gdp", unit: "gdp" }, 50000), "AI estimate");
  assert.equal(historicalStatSourceLabel({ date: "1200-01-01" }, { key: "gdp" }, 50000), "Source unspecified");
  assert.equal(historicalStatSourceLabel(sample, { key: "grain" }, null), "Unknown");
});

test("legacy war ledgers stay unspecified while recorded native origins are shown", () => {
  const world = { warWeariness: [{ country: "Realm", value: 20 }] };
  const legacy = nationalStatSourceRows({ world, country: "Realm" });
  assert.equal(legacy.find((row) => row.path === "warWeariness").sourceLabel, "Source unspecified");
  const sheet = { statProvenance: { warWeariness: { source: "calculated", value: 20, round: 2 } } };
  const rows = nationalStatSourceRows({ world, country: "Realm", sheet });
  assert.equal(rows.find((row) => row.path === "warWeariness").sourceLabel, "Calculated");
});

test("legacy territorial aggregates expose their calculation method without inventing an origin", () => {
  const rows = nationalStatSourceRows({ sheet: { population: { total: 1000 }, economy: { gdp: 50000 }, territorialComponents: [{ geography: "Realm", population: 1000, gdpPerCapita: 50 }] } });
  const gdp = rows.find((row) => row.path === "economy.gdp");
  assert.equal(gdp.sourceLabel, "Source unspecified");
  assert.equal(gdp.calculated, true);
});
