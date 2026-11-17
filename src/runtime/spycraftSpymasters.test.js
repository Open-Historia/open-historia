/*! Open Historia — every player's agents report, each to its own government: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/spycraftSpymasters.test.js
//
// In a shared game a guest could place agents, and they never reported nor
// stole a document: the intercepts file was the host's, keyed by target alone
// (two players spying on one country shared an entry), the time skip asked
// reports of the host's agents only, and every guest's view held an empty file.
// Each spymaster now has a table and a seal of its own, and is sent those alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SEAT_INTERCEPTS, interceptTableOf, mapInterceptTables, normalizeIntercepts, withInterceptTable } from "./spycraft.js";
import { isSeal, sealOf, withSealFor } from "./spySeal.js";
import { normalizeWorldState } from "./gameState.js";
import { spymastersReportingWithSkip } from "../Game/AI/agentReports.js";
import { projectForViewer } from "../multiplayer/host/projection.js";

const LATVIA = "Republic of Latvia"; // the game's country, the host's seat
const RUSSIA = "Russian Federation"; // a second person
const ESTONIA = "Republic of Estonia"; // a third person
const FRANCE = "France"; // the AI's
const entry = (subject, round = 1) => ({ reportId: `r-${subject}`, spyId: "s", gatheredAt: "2014-03-30", round, planted: false, exchanges: [{ id: `x-${subject}`, counterpart: "Germany", subject, messages: [{ speaker: FRANCE, text: subject }] }] });
const home = { gameCountry: LATVIA };

test("single player's file is its own table, and stays exactly as it was", () => {
  const file = { [FRANCE]: entry("LV-ON-FR") };
  assert.deepEqual(interceptTableOf(file, LATVIA, home), file);
  assert.deepEqual(withInterceptTable(file, LATVIA, { ...file, [RUSSIA]: entry("LV-ON-RU") }, home), { ...file, [RUSSIA]: entry("LV-ON-RU") });
  assert.equal(SEAT_INTERCEPTS in withInterceptTable(file, LATVIA, file, home), false, "a single-player file never gains a seats member");
});

test("each spymaster has a table of its own: two players spying on one country never share an entry", () => {
  let file = { [FRANCE]: entry("LV-ON-FR") };
  file = withInterceptTable(file, RUSSIA, { [FRANCE]: entry("RU-ON-FR") }, home);
  file = withInterceptTable(file, ESTONIA, { [FRANCE]: entry("EE-ON-FR") }, home);
  assert.equal(normalizeIntercepts(interceptTableOf(file, LATVIA, home))[FRANCE].exchanges[0].subject, "LV-ON-FR");
  assert.equal(normalizeIntercepts(interceptTableOf(file, RUSSIA, home))[FRANCE].exchanges[0].subject, "RU-ON-FR");
  assert.equal(normalizeIntercepts(interceptTableOf(file, "russian federation", home))[FRANCE].exchanges[0].subject, "RU-ON-FR", "names as the game spells them, in any case");
  // The game country's table, as every older reader reads the whole file, holds none of the others'.
  assert.deepEqual(Object.keys(normalizeIntercepts(file)), [FRANCE]);
  // Writing one table leaves the others as they were.
  const after = withInterceptTable(file, LATVIA, { [FRANCE]: entry("LV-AGAIN", 2) }, home);
  assert.equal(normalizeIntercepts(interceptTableOf(after, RUSSIA, home))[FRANCE].exchanges[0].subject, "RU-ON-FR");
  assert.equal(normalizeIntercepts(interceptTableOf(after, LATVIA, home))[FRANCE].round, 2);
  // An empty table is no member at all.
  assert.deepEqual(Object.keys(withInterceptTable(after, RUSSIA, {}, home)[SEAT_INTERCEPTS]), [ESTONIA]);
  // An undo cleans every table, and leaves the file as it was when nothing changed.
  const dropRussia = (table) => (table[FRANCE]?.exchanges[0].subject === "RU-ON-FR" ? {} : table);
  const cleaned = mapInterceptTables(after, dropRussia);
  assert.deepEqual(Object.keys(cleaned[SEAT_INTERCEPTS]), [ESTONIA]);
  assert.equal(mapInterceptTables(after, (table) => table), after);
});

test("each spymaster's traffic has a seal of its own, and the game's country keeps the game's", () => {
  const world = withSealFor(withSealFor({}, LATVIA, home), RUSSIA, home);
  assert.ok(isSeal(world.spySeal));
  assert.ok(isSeal(world.seatSeals[RUSSIA]));
  assert.notEqual(world.spySeal, world.seatSeals[RUSSIA]);
  assert.equal(sealOf(world, LATVIA, home), world.spySeal);
  assert.equal(sealOf(world, RUSSIA, home), world.seatSeals[RUSSIA]);
  assert.equal(sealOf(world, ESTONIA, home), "", "none made before it is needed");
  assert.equal(withSealFor(world, RUSSIA, home), world, "one made is kept");
  // The world keeps the seats' seals, and a single-player world never gains the key.
  assert.equal(normalizeWorldState(world).seatSeals[RUSSIA], world.seatSeals[RUSSIA]);
  assert.equal("seatSeals" in normalizeWorldState({ spySeal: world.spySeal }), false);
});

test("a skip carries every player's agents in turn, each against its own table, up to the limit", () => {
  const agents = {
    [LATVIA]: ["lv-1", "lv-2", "lv-3"].map((id) => ({ id, owner: LATVIA, target: `${id}-target`, deployedAt: "2014-01-01" })),
    [RUSSIA]: ["ru-1", "ru-2"].map((id) => ({ id, owner: RUSSIA, target: `${id}-target`, deployedAt: "2014-01-01" })),
    [ESTONIA]: [],
  };
  const asked = [];
  const picked = spymastersReportingWithSkip({
    spymasters: [LATVIA, RUSSIA, ESTONIA],
    agentsOf: (owner) => agents[owner],
    filedOf: (owner) => { asked.push(owner); return {}; },
    round: 4, originDate: "2014-03-01", limit: 4,
  });
  assert.deepEqual(picked.map((spy) => spy.id), ["lv-1", "ru-1", "lv-2", "ru-2"]);
  assert.deepEqual(asked, [LATVIA, RUSSIA, ESTONIA], "each against its own file");
  // One spymaster (single player) is the one list it always was.
  assert.deepEqual(spymastersReportingWithSkip({ spymasters: [LATVIA], agentsOf: (owner) => agents[owner], filedOf: () => ({}), round: 4, originDate: "2014-03-01", limit: 4 }).map((spy) => spy.id), ["lv-1", "lv-2", "lv-3"]);
});

test("each player is sent its own agents' traffic and its own seal, never another's", () => {
  const seals = withSealFor(withSealFor({}, LATVIA, home), RUSSIA, home);
  let file = { [FRANCE]: entry("CANARY-LV-TRAFFIC") };
  file = withInterceptTable(file, RUSSIA, { [FRANCE]: entry("CANARY-RU-TRAFFIC") }, home);
  const state = { world: { ...seals, spies: [] }, game: { country: LATVIA, humanCountries: [LATVIA, RUSSIA, ESTONIA] }, events: [], chat: [], actions: [], intercepts: file };
  const lv = projectForViewer(state, LATVIA);
  const ru = projectForViewer(state, RUSSIA);
  const ee = projectForViewer(state, ESTONIA);
  assert.equal(lv.intercepts[FRANCE].exchanges[0].subject, "CANARY-LV-TRAFFIC");
  assert.equal(ru.intercepts[FRANCE].exchanges[0].subject, "CANARY-RU-TRAFFIC");
  assert.deepEqual(ee.intercepts, {});
  assert.equal(lv.world.spySeal, seals.spySeal);
  assert.equal(ru.world.spySeal, seals.seatSeals[RUSSIA], "its own seal, as its view's");
  assert.equal(ee.world.spySeal, undefined);
  for (const [view, others] of [[lv, ["CANARY-RU-TRAFFIC", seals.seatSeals[RUSSIA]]], [ru, ["CANARY-LV-TRAFFIC", seals.spySeal]], [ee, ["CANARY-LV-TRAFFIC", "CANARY-RU-TRAFFIC", seals.spySeal, seals.seatSeals[RUSSIA]]]]) {
    const text = JSON.stringify(view);
    for (const secret of others) assert.equal(text.includes(secret), false, `${secret} reached another player's view`);
    assert.equal(text.includes(SEAT_INTERCEPTS), false);
    assert.equal("seatSeals" in view.world, false);
  }
});

test("the time skip asks, files and steals for every player's agents, each into its own government's table", () => {
  const gameplay = readFileSync(new URL("../Game/AI/gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // Asked: every spymaster's agents, each against its own table.
  assert.match(gameplay, /spymastersReportingWithSkip\(\{\s*spymasters: spymastersOf\(bundle\.game\),\s*agentsOf: \(owner\) => activeSpies\(world, owner\),\s*filedOf: \(owner\) => normalizeIntercepts\(interceptTableOf\(file, owner, \{ gameCountry: playerCountry \}\)\)/);
  assert.match(gameplay, /agentJobs\.push\(\{ key: `agent_\$\{index \+ 1\}`, spy, owner: normalizeString\(spy\?\.owner\) \|\| playerCountry,/);
  // Briefed from its own government's side.
  assert.match(gameplay, /const prepareSpyReport = async \(bundle, spy, \{ sharedVariables = null \} = \{\}\) => \{\n  const name = normalizeString\(spy\?\.target\);\n  const player = normalizeString\(spy\?\.owner\) \|\| normalizeString\(bundle\.game\?\.country\);/);
  assert.match(gameplay, /const openQuestions = spymasterBoard\(bundle\.world, player, bundle\.game\?\.country\)/);
  // Filed into its own table, sealed with its own seal.
  const store = gameplay.slice(gameplay.indexOf("const storeSpyReport = async"), gameplay.indexOf("// How many stolen documents an agent's file keeps"));
  assert.match(store, /const owner = normalizeString\(spy\?\.owner\) \|\| gameCountry;/);
  assert.match(store, /const seal = sealOf\(bundle\.world, owner, \{ gameCountry \}\) \|\| await ensureSpySeal\(\{ owner, gameCountry \}\);/);
  assert.match(store, /return withInterceptTable\(latest, owner, \{ \.\.\.current, \[name\]: entry \}, \{ gameCountry \}\);/);
  // Stolen by every player's agents, each copy its owner's.
  assert.match(gameplay, /for \(const owner of spymastersOf\(baseGame\)\.filter\(\(name\) => regionKey\(name\) !== regionKey\(documentPlayer\)\)\) \{/);
  assert.match(gameplay, /await fileStolenDocuments\(\[\.\.\.reportDeliveries, \.\.\.seatThefts\]/);
  const steal = gameplay.slice(gameplay.indexOf("const fileStolenDocuments = async"), gameplay.indexOf("// The advisor's notices of the papers this turn put"));
  assert.match(steal, /sealExchange\(await sealFor\(owner\), exchange\)/);
  assert.match(steal, /file = withInterceptTable\(file, owner, next, \{ gameCountry \}\);/);
  // An undo cleans every table; each agent is named with its government when there are several.
  assert.match(gameplay, /mapInterceptTables\(base, \(table\) => withoutOrphanedDocuments\(table, restoredReports\)\)/);
  assert.match(gameplay, /one \? `\$\{job\.key\}: the agent inside \$\{job\.name\}\.` : `\$\{job\.key\}: \$\{ownerOf\(job\)\}'s agent inside \$\{job\.name\}\.`/);
});
