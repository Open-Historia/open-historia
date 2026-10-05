/*! Open Historia — a target's standing in the ledgers, and how much land its dossier says it holds: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/targetDossier.test.js
//
// Needs a full install: nativeDiplomaticDirector.js -> gameState.js.
//
// The briefing, the spy reports and the intelligence assessment were given a
// name, some regions and a unit count, and could contradict the Stats tab and
// the ledgers. These pin what the dossier now says of the target, and that it
// says no more than the player may know.
//
// The dossier is the one line about a polity's territory that intelligence
// briefings, spy intercepts and repairs are given. It used to count only
// regionOwnershipOverrides, so on a map where most regions keep their base owner
// one annexation left France "holding no regions", the annexer holding only what
// it took, and with no override at all every polity "held its modern-day
// territory", even in 1871.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorldState } from "../../runtime/gameState.js";
import { buildTargetLedgerLines } from "./targetDossier.js";
import { buildTargetDossierKernel } from "./countryStatsWorkerKernel.js";

const PLAYER = "France";
const polities = {
    France: { code: "France", name: "France" },
    Russia: { code: "Russia", name: "Russia" },
    Germany: { code: "Germany", name: "Germany" },
    Belarus: { code: "Belarus", name: "Belarus" },
    Ukraine: { code: "Ukraine", name: "Ukraine" },
};
const worldOf = (extra = {}) => normalizeWorldState({
    polityOverrides: polities,
    regionOwnershipOverrides: { r1: "France", r2: "Russia", r3: "Germany", r4: "Russia", r5: "Belarus" },
    ...extra,
});
const ledger = (world, target = "Russia", options = {}) => buildTargetLedgerLines(world, target, { playerPolity: PLAYER, ...options });
const line = (lines, prefix) => lines.find((entry) => entry.startsWith(prefix)) ?? "";

test("the target's wars, with whom and whether a ceasefire holds; ended wars are left out", () => {
    const world = worldOf({
        wars: [
            { id: "w1", title: "Russo-Ukrainian War", status: "active", sideA: ["Russia", "Belarus"], sideB: ["Ukraine"] },
            { id: "w2", title: "Border War", status: "ceasefire", sideA: ["Germany"], sideB: ["Russia"] },
            { id: "w3", title: "Old War", status: "ended", sideA: ["Russia"], sideB: ["France"] },
        ],
    });
    assert.equal(line(ledger(world), "Wars:"), "Wars: Russo-Ukrainian War against Ukraine; Border War against Germany (ceasefire).");
    assert.equal(line(ledger(worldOf()), "Wars:"), "Wars: none recorded.");
});

test("its standing with the player: the relation and their agreements", () => {
    const world = worldOf({
        relations: [
            { a: "France", b: "Russia", score: -45, status: "strained", summary: "Sanctions over Ukraine." },
            { a: "Germany", b: "Russia", score: 70, status: "friendly" },
        ],
        agreements: [
            { id: "a1", title: "Grain Accord", type: "trade_economic", status: "active", parties: ["France", "Russia"] },
            { id: "a2", title: "Pact", type: "alliance", status: "active", parties: ["Germany", "Russia"] },
        ],
    });
    const lines = ledger(world);
    assert.equal(line(lines, "Standing with"), "Standing with France: strained (-45) — Sanctions over Ukraine.");
    assert.match(line(lines, "Agreements with"), /^Agreements with France: Grain Accord \(trade economic\)\.$/);
    assert.equal(line(ledger(worldOf(), "Germany"), "Standing with"), "Standing with France: no bilateral relation recorded.");
});

test("the player's own polity is not given a standing with itself", () => {
    assert.equal(line(ledger(worldOf(), "France"), "Standing with"), "");
});

test("an open subordination is named; a covert one the player has not found is not", () => {
    const open = worldOf({ puppets: [{ id: "p1", overlord: "Russia", puppet: "Belarus", kind: "satellite", secrecy: "open", status: "active", loyalty: 40 }] });
    assert.equal(line(ledger(open), "Directs:"), "Directs: Belarus (satellite, open).");
    assert.equal(line(ledger(open, "Belarus"), "Directed by:"), "Directed by: Russia (satellite, open).");
    const covert = worldOf({ puppets: [{ id: "p1", overlord: "Russia", puppet: "Belarus", kind: "satellite", secrecy: "covert", status: "active", loyalty: 40 }] });
    assert.equal(line(ledger(covert), "Directs:"), "");
    assert.equal(line(ledger(covert, "Belarus"), "Directed by:"), "");
    assert.equal(line(ledger(open, "Russia", { puppetStates: false }), "Directs:"), "");
});

test("the groups holding ground inside the target's borders", () => {
    const world = worldOf({
        groups: { "Wagner": { name: "Wagner" }, "Partisans": { name: "Partisans" } },
        groupAreas: { r2: "Wagner", r4: "Wagner", r3: "Partisans" },
    });
    assert.equal(line(ledger(world), "Groups controlling"), "Groups controlling part of its land: Wagner (2 regions).");
    // The map's own owner counts where no override says otherwise.
    const onTheMap = worldOf({ groups: { "Partisans": { name: "Partisans" } }, groupAreas: { r9: "Partisans" } });
    assert.equal(line(ledger(onTheMap, "Russia", { ownerOf: (id) => (id === "r9" ? "Russia" : "") }), "Groups controlling"), "Groups controlling part of its land: Partisans (1 region).");
});

test("reputation and a rated service; an unrated service is not given the default as a judgement", () => {
    const world = worldOf({ internationalReputation: { Russia: 31 }, intelligence: { Russia: 72 } });
    const lines = ledger(world);
    assert.equal(line(lines, "International reputation"), "International reputation: 31/100.");
    assert.equal(line(lines, "Intelligence service"), "Intelligence service: 72/100.");
    assert.equal(line(ledger(world, "Russia", { espionage: false }), "Intelligence service"), "");
    assert.equal(line(ledger(worldOf()), "Intelligence service"), "");
});

test("the stat sheet is quoted as the Stats tab shows it, except to the tasks that write it", () => {
    const world = worldOf({
        countryStats: {
            Russia: {
                economy: { gdp: 2.1e12, gdpGrowth: 1.2, inflation: 7.4, unemployment: 3.9, publicDebt: 18, budgetBalance: -2.1 },
            },
        },
    });
    const sheet = line(ledger(world), "STAT SHEET");
    assert.match(sheet, /quote these rather than estimating/);
    assert.match(sheet, /growth 1\.2%/);
    assert.equal(line(ledger(world, "Russia", { statSheet: false }), "STAT SHEET"), "");
    assert.equal(line(ledger(worldOf()), "STAT SHEET"), "");
});

test("polity names are exact: Russia is not Russian Federation", () => {
    const world = worldOf({
        wars: [{ id: "w1", title: "Winter War", status: "active", sideA: ["Russian Federation"], sideB: ["Ukraine"] }],
    });
    assert.equal(line(ledger(world), "Wars:"), "Wars: none recorded.");
});

test("the standing is the band of the score, and a treaty with a third party still counts", () => {
    const world = worldOf({
        // A declared status the score contradicts: the ledger reads the band.
        relations: [{ a: "France", b: "Russia", score: 30, status: "hostile" }],
        agreements: [
            { id: "a1", title: "Channel Pact", type: "alliance", status: "active", parties: ["France", "Russia", "Germany"] },
            { id: "a2", title: "Old Accord", type: "trade_economic", status: "ended", parties: ["France", "Russia"] },
            { id: "a3", title: "Eastern Pact", type: "alliance", status: "suspended", parties: ["Belarus", "Russia"] },
        ],
    });
    const lines = ledger(world);
    assert.equal(line(lines, "Standing with"), "Standing with France: cordial (+30).");
    assert.equal(line(lines, "Agreements with"), "Agreements with France: Channel Pact (alliance).");
});

// Every name used to be resolved from scratch (canonicalDiplomaticPolity, several
// ms each on a real map) against every war side, agreement party and group
// region, and three more whole-world normalizations came with the diplomatic
// slice: seconds on the main thread per briefing, sheet or agent report.
test("a world with many ledger rows is read in well under a second", () => {
    const names = Object.keys(polities);
    const regionOwnershipOverrides = {};
    const groupAreas = {};
    for (let i = 0; i < 4000; i += 1) {
        regionOwnershipOverrides[`r${i}`] = names[i % names.length];
        if (i % 3 === 0) groupAreas[`r${i}`] = "Wagner";
    }
    const world = worldOf({
        regionOwnershipOverrides,
        groups: { Wagner: { name: "Wagner" } },
        groupAreas,
        wars: Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, title: `War ${i}`, status: "active", sideA: [names[i % 5]], sideB: [names[(i + 1) % 5]] })),
        agreements: Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, title: `Pact ${i}`, type: "alliance", status: "active", parties: [names[i % 5], names[(i + 2) % 5]] })),
    });
    const started = performance.now();
    const lines = ledger(world);
    assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
    assert.match(line(lines, "Groups controlling"), /^Groups controlling part of its land: Wagner \(\d+ regions\)\.$/);
});

// How much land the dossier says a target holds (buildTargetDossierKernel).

const region = (id, country) => ({ id, name: `${country} ${id}`, country, countryCode: "" });
const CATALOG = [
  region("f1", "France"), region("f2", "France"), region("f3", "France"),
  region("g1", "German Empire"), region("g2", "German Empire"),
];

const dossier = (code, world = {}, catalog = CATALOG) =>
  buildTargetDossierKernel({ bundle: { world }, code, scenarioCatalog: catalog });
const territoryLines = (text) => text.split("\n").filter((line) => !line.startsWith("Deployed forces"));

test("with no changes recorded, each polity holds its starting regions, and nobody's map is 'modern-day'", () => {
  const text = dossier("France");
  assert.match(text, /Territory: holds 3 regions on the current map, and is their lawful sovereign\./);
  assert.doesNotMatch(text, /modern-day/);
  assert.doesNotMatch(text, /beyond its starting territory|held by others/);
});

test("one annexation elsewhere leaves everybody else's land where it was", () => {
  const world = { regionOwnershipOverrides: { g1: "France" } };
  const france = dossier("France", world);
  assert.match(france, /holds 4 regions/);
  assert.match(france, /Held beyond its starting territory in this scenario: 1 region: German Empire g1 \(German Empire\)/);
  const germany = dossier("German Empire", world);
  assert.match(germany, /holds 1 region/);
  assert.match(germany, /Of its starting territory in this scenario, 1 region is now held by others\./);
});

test("an occupation is held, but its lawful sovereign keeps the title", () => {
  const world = { regionOwnershipOverrides: { f1: "German Empire" }, regionSovereigntyOverrides: { f1: "France" } };
  assert.match(dossier("France", world), /holds 2 regions on the current map, and is the lawful sovereign of 3\./);
  assert.match(dossier("German Empire", world), /holds 3 regions on the current map, and is the lawful sovereign of 2\./);
});

test("equal counts over different regions do not make it the lawful sovereign of what it holds", () => {
  // France occupies g1 (still German by law) and has lost f1 to a German
  // occupation (still French by law): 3 held, 3 by law, but not the same 3.
  const world = {
    regionOwnershipOverrides: { g1: "France", f1: "German Empire" },
    regionSovereigntyOverrides: { g1: "German Empire", f1: "France" },
  };
  const text = dossier("France", world);
  assert.match(text, /holds 3 regions on the current map, and is the lawful sovereign of 3\./);
  assert.doesNotMatch(text, /is their lawful sovereign/);
});

test("a polity with no land says so", () => {
  assert.deepEqual(territoryLines(dossier("Kingdom of Aurelia")), ["Territory: holds no regions on the current map."]);
});

test("names are exact: a near-miss is a different polity", () => {
  const catalog = [region("r1", "Russian Federation")];
  assert.match(dossier("Russian Federation", {}, catalog), /holds 1 region/);
  assert.match(dossier("Russia", {}, catalog), /holds no regions/);
});

test("without a catalog it counts only what changed, and says so", () => {
  const text = dossier("France", { regionOwnershipOverrides: { g1: "France" } }, []);
  assert.match(text, /holds at least 1 region \(the region catalog was unavailable/);
  assert.match(dossier("France", {}, []), /could not be counted/);
});

test("the fallback catalog is used when there is no rendered scenario catalog", () => {
  const text = buildTargetDossierKernel({ bundle: { world: {} }, code: "France", scenarioCatalog: [], fallbackCatalog: CATALOG });
  assert.match(text, /holds 3 regions/);
});
