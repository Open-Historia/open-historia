import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGameMasterStatsPreview, reviewGameMasterEconomicPreview } from "./gameMasterStatsPreview.js";
import { normalizeEvents } from "../../runtime/gameState.js";

const world = {
  countryStats: {
    Germany: {
      economy: { gdp: 150000000000, gdpGrowth: 3, publicDebt: 60000000000 },
      population: { total: 65000000 }, stability: 75,
      indices: { military: 65 }, customStats: { resilience: 60 },
    },
  },
};
const direct = { country: "Germany", patch: { economy: { gdp: 515000000000 } }, reason: "Administrator explicitly corrects the historical baseline." };
const event = {
  title: "Ruhr strike",
  impacts: { polityChanges: [{ operation: "update", code: "Germany",
    statsEffects: { annualRealGrowthDelta: -0.2, durationDays: 30,
      gdpCause: "production", reason: "A documented coal output disruption." } }] },
};

test("GM Stats preview includes event-embedded effects with actual baseline and dated unit, not invented final GDP", () => {
  const frozen = JSON.stringify({ world, event });
  const actual = buildGameMasterStatsPreview({ world, events: [event] });
  assert.equal(actual.count, 1);
  assert.deepEqual(actual.rows.map((row) => [row.country, row.field, row.source]), [
    ["Germany", "statsEffects.annualRealGrowthDelta", "Dated event effect"],
  ]);
  assert.equal(actual.rows[0].before, "3");
  assert.match(actual.rows[0].proposed, /-0.2 percentage points \/ 30 days/);
  assert.equal(actual.rows[0].reason, "A documented coal output disruption.");
  assert.equal(JSON.stringify({ world, event }), frozen, "preview must be read-only");
});

test("accepted canonical event normalization preserves embedded Stats effects for GM preview", () => {
  const normalized = normalizeEvents([event]);
  assert.equal(normalized.length, 1);
  const actual = buildGameMasterStatsPreview({ world, events: normalized });
  assert.equal(actual.count, 1);
  assert.equal(actual.rows[0].field, "statsEffects.annualRealGrowthDelta");
  assert.match(actual.rows[0].proposed, /30 days/);
});

test("GM Stats preview shows direct GDP before and proposed 150B → 515B without performing rebase", () => {
  const actual = buildGameMasterStatsPreview({ world, countryStatPatches: [direct] });
  assert.equal(actual.count, 1);
  assert.equal(actual.rows[0].before, "150,000,000,000");
  assert.equal(actual.rows[0].proposed, "515,000,000,000");
  assert.equal(actual.rows[0].field, "economy.gdp");
  assert.equal(actual.rows[0].source, "Direct baseline");
  assert.equal(world.countryStats.Germany.economy.gdp, 150000000000);
});

test("GM Stats preview shows event absolute changes and direct patches separately with provenance", () => {
  const eventAbsolute = { title: "GDP reset event", impacts: { polityChanges: [{
    operation: "update", code: "Germany", stats: { economy: { gdp: 175000000000 } },
  }] } };
  const actual = buildGameMasterStatsPreview({ world, events: [eventAbsolute], countryStatPatches: [direct] });
  assert.equal(actual.count, 2);
  assert.deepEqual(actual.rows.map((row) => row.source), ["Event baseline", "Direct baseline"]);
  assert.equal(actual.rows[0].before, actual.rows[1].before);
  assert.equal(actual.rows[0].proposed, "175,000,000,000");
  assert.equal(actual.rows[1].proposed, "515,000,000,000");
});

test("GM Stats preview reads populated independent indices, custom keys, and preserves an unset baseline", () => {
  const customEvent = { impacts: { polityChanges: [{ code: "Germany", statsEffects: {
    indexDeltas: { military: -4 }, customStatDeltas: { resilience: 3, unknown: -2 },
    reason: "Measured targeted effect.",
  } }] } };
  const actual = buildGameMasterStatsPreview({ world, events: [customEvent] });
  assert.equal(actual.count, 3);
  assert.deepEqual(actual.rows.map((row) => row.before), ["65", "60", "Not recorded"]);
  assert.deepEqual(actual.rows.map((row) => row.proposed), ["-4", "3", "-2"]);
  assert.equal(actual.rows[0].kind, "effect");
});

test("empty or prose-only GM operations do not manufacture Stats changes", () => {
  assert.deepEqual(buildGameMasterStatsPreview({ world, events: [{ impacts: {
    polityChanges: [{ code: "Germany", statsEffects: { reason: "No numerical effect." } }],
  } }] }), { count: 0, rows: [] });
  assert.deepEqual(buildGameMasterStatsPreview({ world, events: [] }), { count: 0, rows: [] });
});

test("GM economic disclosure reports Economy-tagged events lacking typed native effects", () => {
  const events = [
    { title: "Texas oil output expands 10%", tags: ["Economy"], impacts: {} },
    { title: "Kansas wheat harvest declines", tags: ["Economy"],
      economicAccounting: { status: "unquantified", reason: "No country-level attribution established." },
      impacts: { projectOps: [{ op: "create", name: "Farm support" }] } },
    { title: "Pipeline outage", tags: ["Economy"], impacts: { polityChanges: [
      { code: "United States", operation: "update",
        statsEffects: { annualRealGrowthDelta: -0.15, durationDays: 30, gdpCause: "production", reason: "Evidence." } }] } },
    { title: "Strategic security alert", tags: ["Politics"], impacts: {} },
    { title: "Custom production series adjustment", tags: ["Economy"], impacts: { polityChanges: [
      { code: "United States", operation: "update", statsEffects: { customStatDeltas: { steelOutput: 3 }, reason: "Evidence." } }] } },
  ];
  const original = structuredClone(events);
  const notes = reviewGameMasterEconomicPreview(events, { mode: "world-intervention" });
  assert.deepEqual(notes.map((note) => [note.eventIndex, note.title, note.declaredStatus]), [
    [0, "Texas oil output expands 10%", "unspecified"],
    [1, "Kansas wheat harvest declines", "unquantified"],
    [4, "Custom production series adjustment", "unspecified"],
  ]);
  assert.equal(notes[1].reason, "No country-level attribution established.");
  assert.deepEqual(events, original, "disclosure must never modify the generated transaction");
  assert.deepEqual(reviewGameMasterEconomicPreview(events, { mode: "direct" }), [],
    "Direct baseline corrections have separate authority");
  assert.deepEqual(reviewGameMasterEconomicPreview([], { mode: "exact-event" }), []);
});

test("a non-Economy-tagged event with explicit economic accounting is disclosed before GM Apply", () => {
  const events = [
    { title: "Major flood relief authorized", tags: ["Disaster"],
      economicAccounting: { status: "unquantified", reason: "No booked national Stats effect established." },
      impacts: { projectOps: [{ op: "create", name: "Relief fund" }] } },
    { title: "Cabinet appointment", tags: ["Politics"],
      economicAccounting: { status: "none", reason: "Political appointment has no established economy effect." },
      impacts: {} },
    { title: "Railway disruption measured", tags: ["Disaster"],
      economicAccounting: { status: "applied", reason: "Dated quantified output effect." },
      impacts: { polityChanges: [{ code: "Alba", statsEffects: {
        annualRealGrowthDelta: -1, durationDays: 14, reason: "Documented closure",
      } }] } },
  ];
  const snapshot = structuredClone(events);
  const notes = reviewGameMasterEconomicPreview(events, { mode: "world-intervention" });
  assert.deepEqual(notes.map((note) => [note.eventIndex, note.title, note.declaredStatus]), [
    [0, "Major flood relief authorized", "unquantified"],
  ]);
  assert.deepEqual(events, snapshot);
});

test("a population-only event cannot masquerade as an economic or fiscal GM mutation", () => {
  const proposal = [{ title: "Migration programme", tags: ["Economy"], impacts: {
    polityChanges: [{ code: "Alba", operation: "update", statsEffects: {
      populationChange: 2_500, populationCause: "immigration", reason: "Documented arrivals",
    } }],
  } }];
  assert.equal(reviewGameMasterEconomicPreview(proposal, { mode: "world-intervention" }).length, 1,
    "a population change does not establish a GDP, growth, debt or fiscal effect");
});

test("a security-only change in an Economy-tagged event does not falsely count as GDP mutation", () => {
  const events = [{ title: "Bank rescue", tags: ["Economy"], impacts: { polityChanges: [{
    code: "Germany", operation: "update", statsEffects: { stabilityDelta: 3, reason: "Improved confidence." },
  }] } }];
  assert.equal(reviewGameMasterEconomicPreview(events).length, 1);
});

test("GM canonical preview attaches a separate read-only summary, not a new mutation", () => {
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../GameUI/cheats.jsx", import.meta.url), "utf8");
  assert.match(gameplay, /buildGameMasterStatsPreview\(\{/);
  assert.match(ui, /All Stats changes/);
  assert.match(gameplay, /economicPreviewNotes = reviewGameMasterEconomicPreview\(events, \{ mode: effectiveMode \}\)/);
  assert.match(ui, /data-gm-economic-disclosure="true"/);
  assert.doesNotMatch(ui, /Economy-tagged event\(s\)/,
    "Disaster-tagged events with typed economic accounting can also require disclosure");
  assert.match(ui, /event\(s\) require economic accounting review/,
    "GM preview must not mislabel the event category");
  assert.match(ui, /Apply will not invent a GDP, growth or fiscal mutation/);
  assert.match(ui, /statsPreview/);
  assert.match(ui, /Current reading: \{row\.before\}.*Proposed dated effect: \{row\.proposed\}/,
    "temporary economic influence must not look like a baseline replacement");
  assert.match(ui, /\{row\.before\} → \{row\.proposed\}/,
    "explicit Direct baseline correction retains before-to-after display");
});
