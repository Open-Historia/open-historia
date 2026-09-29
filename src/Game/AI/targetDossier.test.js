/*! Open Historia — a target's standing in the ledgers: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/targetDossier.test.js
//
// Needs a full install: nativeDiplomaticDirector.js -> gameState.js.
//
// The briefing, the spy reports and the intelligence assessment were given a
// name, some regions and a unit count, and could contradict the Stats tab and
// the ledgers. These pin what the dossier now says of the target, and that it
// says no more than the player may know.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeWorldState } from "../../runtime/gameState.js";
import { buildTargetLedgerLines } from "./targetDossier.js";

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
