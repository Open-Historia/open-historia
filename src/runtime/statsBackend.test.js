/*! Open Historia — the two layers of a country's statistics, and sheets for the countries a player comes into conflict with: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/statsBackend.test.js
//
// "Stats should be generated for countries you're going into conflict with,
// either if you deploy a front on them, if you redirect a front to attack them
// or anything else so that the stats can be used. Account for the fact that
// certain scenarios have custom stats, how does this work for that? I would
// say that there are 2 layers of stats, the backend layer which is what the
// war stuff reads, and that backend layer gets translated into the frontend
// layer (if there is a frontend custom stats layer)."
//
// Needs node_modules: frontTurn.js reaches gameState.js, which reaches assets.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { frontWorldReaders } from "../Game/AI/frontTurn.js";
import { STATS_BACKEND_SCHEMA, getGameplayToolForCustomStatSheet } from "../Game/AI/gameplaySchemas.js";
import { isCompleteCustomCountryStatSheet, mergeCountryStatPatch, normalizeCountryStatSheet } from "./countryStats.js";
import { fundingFactor, militaryFunding } from "./militaryFunding.js";
import {
  STATS_BACKEND_FIELD,
  STATS_BACKEND_KEYS,
  conflictSheetTargets,
  hasStatsBackend,
  readStatsBackend,
  statsBackendInstruction,
  statsBackendOf,
  statsBackendPatch,
} from "./statsBackend.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").replace(/\r\n/g, "\n");

// ---- the backend ------------------------------------------------------------------------

test("the backend is four figures: a country's people, its economy, the balance of its budget and its debt", () => {
  assert.deepEqual([...STATS_BACKEND_KEYS], ["population", "gdp", "budgetBalance", "publicDebt"]);
  assert.equal(STATS_BACKEND_FIELD, "backend");
  assert.deepEqual(readStatsBackend({ population: "5200000", gdp: 3e9, budgetBalance: -2.5, publicDebt: 35 }), { population: 5200000, gdp: 3e9, budgetBalance: -2.5, publicDebt: 35 });
  // Held to what each can be; what is not a number is left out, and with no people there is no backend.
  assert.deepEqual(readStatsBackend({ population: 9e12, gdp: -4, budgetBalance: 900, publicDebt: -3 }), { population: 2e10, budgetBalance: 100, publicDebt: 0 });
  assert.deepEqual(readStatsBackend({ population: 1000, gdp: "much" }), { population: 1000 });
  for (const nothing of [null, undefined, [], "x", {}, { population: 0 }, { gdp: 5 }]) assert.equal(readStatsBackend(nothing), null, JSON.stringify(nothing));
  // As a patch for a sheet, and read back from one.
  assert.deepEqual(statsBackendPatch({ population: 5200000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 }), { population: { total: 5200000 }, economy: { gdp: 3e9, budgetBalance: -2, publicDebt: 35 } });
  assert.deepEqual(statsBackendPatch({ population: 5200000 }), { population: { total: 5200000 } });
  assert.deepEqual(statsBackendPatch(null), {});
  assert.deepEqual(statsBackendOf({ population: { total: 5200000 }, economy: { gdp: 3e9, budgetBalance: -2, publicDebt: 35 } }), { population: 5200000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 });
  assert.equal(statsBackendOf({ customStats: { legions: 12 } }), null);
  assert.deepEqual([hasStatsBackend({ population: { total: 9 } }), hasStatsBackend({ customStats: { legions: 12 } }), hasStatsBackend(null)], [true, false, false]);
});

test("a scenario's own sheet is asked for WITH its backend, in the same request", () => {
  const rows = [{ key: "legions", label: "Legions", min: 0, max: 60 }, { key: "grain", label: "Grain", min: 0, max: 100 }];
  const tool = getGameplayToolForCustomStatSheet("countryStatSheet", rows, { custom: true });
  assert.deepEqual(Object.keys(tool.schema.properties), ["customStats", "backend"]);
  assert.deepEqual(tool.schema.required, ["customStats", "backend"]);
  assert.equal(tool.schema.properties.backend, STATS_BACKEND_SCHEMA);
  assert.deepEqual(STATS_BACKEND_SCHEMA.required, [...STATS_BACKEND_KEYS]);
  // The standard sheet has the four figures as its own fields: nothing is added to it.
  assert.equal(getGameplayToolForCustomStatSheet("countryStatSheet", rows, { custom: false }).schema.properties?.backend, undefined);

  // What the request is told: the backend first, the scenario's values saying the same thing.
  const fresh = statsBackendInstruction(null);
  assert.match(fresh, /^HIDDEN BACKEND \(`backend`\), the one exception to the rule that nothing modern is kept: the game's own arithmetic needs four figures for every polity, which this scenario's player never sees\./);
  assert.match(fresh, /Work these four out FIRST, from the era, the world and this polity's place in it; then write the scenario's own values so that they say the same thing/);
  assert.match(fresh, /It has no backend yet: establish one that fits the era and this polity's size\.$/);
  assert.match(statsBackendInstruction({ population: 5200000, gdp: 3e9 }), /Its backend as it stands \(campaign canon; move it only by what has happened since\): \{"population":5200000,"gdp":3000000000\}$/);

  const turn = read("../Game/AI/gameplay.js");
  assert.ok(turn.includes("      statsBackendInstruction(statsBackendOf(previous)),"));
  assert.ok(turn.includes("const sheet = mergeCountryStatPatch(previous, { customStats, ...statsBackendPatch(payload?.[STATS_BACKEND_FIELD]) }, {"));
  // And the periodic refresh of a scenario's own sheets shows it and moves it with them.
  assert.ok(turn.includes('`HIDDEN BACKEND: ${statsBackendOf(entry.previous) ? JSON.stringify(statsBackendOf(entry.previous)) : "none yet"}`,'));
  assert.ok(turn.includes("const backend = statsBackendPatch(update?.[STATS_BACKEND_FIELD]);"));
  assert.ok(turn.includes("if (!Object.keys(patchValues).length && !Object.keys(backend).length) continue;"));
});

test("a sheet keeps both layers, and the war reads the one under the scenario's own", () => {
  const sheet = mergeCountryStatPatch(null, { customStats: { legions: 12, grain: 40 }, ...statsBackendPatch({ population: 5200000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 }) }, { continuity: { assessedDate: "0050-01-01", assessedRound: 1 } });
  assert.ok(isCompleteCustomCountryStatSheet(sheet, ["legions", "grain"]), "the scenario's own sheet is whole");
  const kept = normalizeCountryStatSheet(JSON.parse(JSON.stringify(sheet)));
  assert.deepEqual(kept.customStats, { legions: 12, grain: 40 });
  assert.deepEqual(statsBackendOf(kept), { population: 5200000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 });
  // What its troops are raised from, what it has to spend, and how it weighs: all from the backend.
  const readers = frontWorldReaders({ regionOwnershipOverrides: { r1: "Roma" }, countryStats: { Roma: kept } }, { regionIds: ["r1"] });
  assert.equal(readers.peopleOf("Roma"), 5200000);
  assert.ok(militaryFunding(kept) > 0 && fundingFactor(kept) < 1, "a deficit tells");
  assert.ok(readers.strengthOf("Roma") > 4 && readers.strengthOf("Roma") < 4.6);
  // The stats pane of such a scenario shows the scenario's own sheet and nothing of the backend.
  assert.ok(read("../Game/GameUI/stats.jsx").includes("{statSheetDefinition.custom ? ("));
});

// ---- the countries a player comes into conflict with ------------------------------------

const world = (extra = {}) => ({
  battlefields: [
    { name: "The Northern Front", status: "active", sides: [["Aland", "Cisland"], ["Borduria", "Syldavia"]], orders: [{ s: 0, chosen: true, order: "advance", attacks: ["Neutralia"] }, { s: 1, chosen: true, order: "advance", attacks: ["Elsewhere"] }] },
    { name: "A border", status: "standing", sides: [["Dacia"], ["Aland"]], orders: [] },
    { name: "Somebody else's war", status: "active", sides: [["Xanadu"], ["Yonder"]], orders: [] },
    { name: "An old war", status: "closed", sides: [["Aland"], ["Oldland"]], orders: [] },
  ],
  countryStats: { Syldavia: { population: { total: 3e6 } }, Dacia: { customStats: { legions: 4 } } },
  groups: {},
  ...extra,
});

test("a country the player's own is on a battlefield with is asked for its sheet when it has nothing the war can read", () => {
  // Those it fights first, then those a route of its troops goes into, then its own side as that side lists it.
  assert.deepEqual(conflictSheetTargets(world(), ["Aland"]), ["Borduria", "Dacia", "Neutralia", "Aland", "Cisland"]);
  // Syldavia has a sheet with its people on it: nothing to ask. Dacia's is the scenario's own with no backend: it is asked.
  assert.equal(conflictSheetTargets(world(), ["Aland"]).includes("Syldavia"), false);
  // A route drawn and not yet marched names who it goes into.
  assert.deepEqual(conflictSheetTargets(world(), ["Aland"], { extra: ["Ruritania", "borduria"] }), ["Borduria", "Dacia", "Neutralia", "Ruritania", "Aland", "Cisland"]);
  // A group is not a country; a war nobody plays in is nobody's to ask for; and with nobody playing, nothing.
  assert.equal(conflictSheetTargets(world({ groups: { Borduria: { name: "Borduria" } } }), ["Aland"]).includes("Borduria"), false);
  assert.deepEqual(conflictSheetTargets(world(), ["Zembla"]), []);
  assert.deepEqual(conflictSheetTargets(world(), []), []);
  assert.deepEqual(conflictSheetTargets(null, ["Aland"]), []);
  // Once every one of them has its backend there is nothing left to ask.
  const known = Object.fromEntries(["Aland", "Cisland", "Borduria", "Syldavia", "Dacia", "Neutralia"].map((name) => [name, { population: { total: 1e6 } }]));
  assert.deepEqual(conflictSheetTargets(world({ countryStats: known }), ["Aland"]), []);
});

test("it is asked after a turn, when a scenario's fronts are built, and when a route is drawn into a country", () => {
  const turn = read("../Game/AI/gameplay.js");
  // (All of them in one request: Game/AI/conflictBackends.test.js.)
  assert.ok(turn.includes("const names = conflictSheetTargets(world, players, { extra }).slice(0, CONFLICT_BACKENDS_MOST);"));
  assert.ok(turn.includes('if (names.length > 0) void ensureConflictBackends(names, { reason: "in conflict with the player" });'));
  // And every other country at war whose people or figures nobody knows is rated against the others (militaryRating.js).
  assert.ok(turn.includes('const others = militaryTargets(world, { skip: names });\n  if (others.length > 0) void ensureMilitaryFigures(others, { reason: "at war" });'));
  assert.ok(turn.includes("  requestConflictSheets(nextWorld, nextGame);\n"), "after a turn");
  assert.ok(turn.includes("    if (written) requestConflictSheets({ ...world, battlefields: built.battlefields }, bundle.game);"), "when a scenario's fronts are built");
  assert.ok(turn.includes("    if (attacked.length > 0) requestConflictSheets(world, game, attacked);"), "when a route is drawn into a country");
  // A sheet wanted for the war is one with a backend: a scenario's own sheet written before it kept one is written again.
  assert.ok(turn.includes("if (complete && (!needBackend || hasStatsBackend(persisted))) return persisted;"));
  // And the player's own country, tracked from the first skip, is asked for the same.
  assert.ok(turn.includes('if (waiting) agentClient.holdSkip(ensureCountryStatSheet(waiting, { reason: "historical tracking", needBackend: true, agentKind: "skip" }));'));
});

// "I meant update both layers of the stats in one request."
test("a patch that moves a country's own values moves its backend in the same patch", async () => {
  const { STATS_BACKEND_PATCH_SCHEMA } = await import("../Game/AI/gameplaySchemas.js");
  const { statsBackendTurnRule } = await import("./statsBackend.js");
  const sheet = mergeCountryStatPatch(null, { customStats: { legions: 12, grain: 40 }, backend: { population: 5200000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 } });
  assert.deepEqual(statsBackendOf(sheet), { population: 5200000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 });
  // A war's losses: fewer legions on the sheet, fewer people under it, in the one patch; what was not named stays.
  const after = mergeCountryStatPatch(sheet, { customStats: { legions: 9 }, backend: { population: 4900000 } });
  assert.deepEqual(after.customStats, { legions: 9, grain: 40 });
  assert.deepEqual(statsBackendOf(after), { population: 4900000, gdp: 3e9, budgetBalance: -2, publicDebt: 35 });
  // A backend that says nothing usable changes nothing.
  assert.deepEqual(statsBackendOf(mergeCountryStatPatch(after, { backend: { population: "many" } })), statsBackendOf(after));
  assert.deepEqual(readStatsBackend({ gdp: 5e9 }, { partial: true }), { gdp: 5e9 });
  assert.equal(readStatsBackend({ gdp: 5e9 }), null, "a whole backend says how many people");

  // A time skip of such a scenario may write it: its stats patch has the field, and it is told which backends there are.
  const tool = getGameplayToolForCustomStatSheet("jumpForward", [{ key: "legions", label: "Legions", min: 0, max: 60 }], { custom: true });
  const patches = [];
  const walk = (value, key) => {
    if (Array.isArray(value)) return value.forEach((entry) => walk(entry, key));
    if (!value || typeof value !== "object") return undefined;
    if (key === "stats" && value.properties) patches.push(value.properties);
    for (const [name, inner] of Object.entries(value)) walk(inner, name);
    return undefined;
  };
  walk(tool.schema, "");
  assert.ok(patches.length > 0 && patches.every((properties) => properties.customStats && properties.backend === STATS_BACKEND_PATCH_SCHEMA));
  assert.equal(STATS_BACKEND_PATCH_SCHEMA.required, undefined, "only the figures that changed");
  const rule = statsBackendTurnRule({ Roma: sheet, Parthia: { customStats: { legions: 20 } } });
  assert.match(rule, /^\[Hidden Backend\]\n/);
  assert.match(rule, /The two are moved TOGETHER, in this one answer: when an event changes a polity's values above for a reason that also moves its people or its economy \(a war's losses, a plague, a famine, a boom, a default\), write the backend's new figures in the same stats patch, as `backend`, beside its customStats\./);
  assert.ok(rule.endsWith('- Roma: {"population":5200000,"gdp":3000000000,"budgetBalance":-2,"publicDebt":35}'), "only a polity that has one is shown");
  assert.equal(statsBackendTurnRule({ Parthia: { customStats: { legions: 20 } } }), "");
  const turn = read("../Game/AI/gameplay.js");
  assert.ok(turn.includes("    const backends = statsBackendTurnRule(world?.countryStats);\n    if (backends) blocks.push(backends);"));
});
