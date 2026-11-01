/*! Open Historia — what a time skip is told of war weariness, peace and alliances: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/peacePrompt.test.js
//
// "Alliances that pull members into wars ... Alpha's prompt currently says
// alliances do not create belligerency, so this is a rule change."

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PEACE_BLOCK_HEADING, PEACE_BLOCK_MAX, PEACE_TREATIES_FIELD, buildPeaceBlock } from "./peacePrompt.js";
import { WAR_STATS_HEADING, WAR_STATS_RULE } from "./warStatsPrompt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, relative), "utf8").split("\r\n").join("\n");

const world = (extra = {}) => ({
  wars: [{ id: "war-1", title: "The Border War", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }],
  agreements: [{ id: "pact-1", title: "The Northern Pact", type: "mutual_defense", status: "active", parties: ["Borduria", "Cisland"] }],
  warWeariness: [{ country: "Borduria", value: 64 }, { country: "Aland", value: 22 }, { country: "Dorland", value: 4 }],
  ...extra,
});

test("a world at peace with no alliance in it is told nothing; one with an alliance is told that alliances bind", () => {
  assert.equal(buildPeaceBlock({ world: {}, game: { round: 3 }, players: ["Aland"] }), "");
  assert.equal(buildPeaceBlock(), "");
  const allied = buildPeaceBlock({ world: world({ wars: [], warWeariness: [] }), game: { round: 3 }, players: ["Borduria"] });
  const lines = allied.split("\n");
  assert.equal(lines[0], PEACE_BLOCK_HEADING);
  assert.ok(lines[1].startsWith("Alliances bind, and the game acts on them."));
  assert.deepEqual(lines.slice(2), ["Bound to defend:", "- Borduria is defended by Cisland."], "a war that begins in this answer will bring the ally in: the story is told who");
});

test("in a war the skip is told the rules, who is bound to whom, and each side's own war to judge its diplomacy by", () => {
  const block = buildPeaceBlock({ world: world(), game: { round: 8 }, players: ["Aland"] });
  for (const rule of [
    "Write no join for them.",
    "An ally that will not come breaks the treaty: tell that in an event and end or suspend the agreement in the same answer, and the game takes it off the breaker's reputation.",
    "A country a person plays is asked by the game and answers for itself.",
    "The game keeps how weary of its war each country is, from 0 (fresh) to 100 (spent)",
    // "it should not be fully deterministic anymore" (the owner, 2026-10-30).
    "The game carries out a peace on terms, but never decides one: whether a country wants peace, when, and on what terms is yours to judge",
    "A weary or losing country may still fight on, and a strong one may still want peace.",
    "A country nobody plays that offers a player peace does it in a letter: an entry of diplomaticOutreach from that country to the player, its leader's own words in openingMessage, with peaceOffer holding the terms",
    `a line in ${PEACE_TREATIES_FIELD} for each, offering country | accepting country | terms`,
  ]) assert.ok(block.includes(rule), rule);
  assert.equal(block.includes("when one is spent"), false, "no formula is described");
  assert.ok(block.includes("Bound to defend:\n- Borduria is defended by Cisland.\n"));
  // Each side's own war, the player first, then its enemy: weariness is told there.
  const situation = block.slice(block.lastIndexOf(`\n${WAR_STATS_HEADING}\n`) + 1);
  assert.ok(situation.startsWith(`${WAR_STATS_HEADING}\n${WAR_STATS_RULE}\nAland:\n- The Border War: against Borduria, alone;`), situation);
  assert.ok(situation.includes("Borduria:\n- The Border War: against Aland, alone; it holds 0 of the enemy's regions and the enemy holds 0 of its own; weariness 64 (war-weary), Aland's 22 (uneasy)."));
  assert.equal(block.includes("War weariness:"), false, "a country at war has its weariness in its own lines, and one hardly touched is not told");
  assert.ok(block.length <= PEACE_BLOCK_MAX);
});

test("what the game did since the last period is told once, and what waits for a player is left to the player", () => {
  const terms = { territory: "as held", reparations: { payer: "Borduria", receiver: "Aland", share: 0.02, years: 5 } };
  const state = world({
    peaceTreaties: [
      { id: "t-new", warId: "war-0", title: "The Southern War", date: "1915-01-10", round: 8, from: "Dorland", to: "Aland", terms: { territory: "restored" }, by: "settled" },
      { id: "t-old", warId: "war-9", title: "An Older War", date: "1914-06-01", round: 5, from: "Eland", to: "Aland", terms: {}, by: "offer" },
    ],
    peaceOffers: [{ id: "o1", warId: "war-1", from: "Borduria", to: "Aland", terms, round: 8, status: "open" }, { id: "o2", warId: "war-1", from: "Borduria", to: "Aland", terms, round: 4, status: "declined", answeredRound: 7 }],
    callsToArms: [{ id: "c1", warId: "war-1", ally: "Cisland", defender: "Borduria", attackers: ["Aland"], via: { kind: "agreement", id: "pact-1", title: "The Northern Pact" }, round: 8, status: "open" }],
    reparations: [{ id: "r1", warId: "war-9", payer: "Eland", receiver: "Aland", share: 0.02, since: "1914-06-01", days: 1825, paidDays: 365 }],
  });
  const block = buildPeaceBlock({ world: state, game: { round: 8 }, players: ["Aland", "Cisland"] });
  assert.ok(block.includes("- The Southern War: Dorland and Aland made peace on 1915-01-10; every region goes back to whose it was before the war; nobody pays reparations."));
  assert.equal(block.includes("An Older War"), false, "a peace already told is not told again");
  assert.ok(block.includes("(the war is already ended in the ledger: tell each early in this answer as an event, write no warUpdates for it, and tell no fighting in that war after it)"));
  assert.ok(block.includes("Offers of peace that wait for an answer (the answer is theirs: write none, and the war goes on meanwhile):\n- Borduria has offered Aland peace: each side keeps the ground it holds; Borduria pays Aland reparations of 2% of its economy a year for 5 years."));
  assert.ok(block.includes("Offers of peace turned down lately:\n- Aland turned down Borduria's offer of peace (each side keeps the ground it holds; Borduria pays Aland reparations of 2% of its economy a year for 5 years)."), "a country that offered knows before it offers again");
  assert.ok(block.includes("Calls to arms that wait for a player's answer (theirs to give):\n- Cisland is called on to defend Borduria against Aland, under The Northern Pact."));
  assert.ok(block.includes("- Eland pays Aland 2% of its economy a year in reparations, for 4 more years."));
  // Names, never ids.
  for (const id of ["war-1", "war-0", "pact-1", "t-new", "o1", "c1", "r1"]) assert.equal(block.includes(id), false, id);
  // Next period, the peace has been told.
  assert.equal(buildPeaceBlock({ world: state, game: { round: 9 }, players: ["Aland"] }).includes("The Southern War"), false);
});

test("the rule that alliances do not make war is gone from every prompt, and the block is in the skip's records", () => {
  const gameplay = read("gameplay.js");
  assert.equal(gameplay.includes("tension, an alliance or a mobilisation does not"), false);
  assert.ok(gameplay.includes("Only this ledger makes polities belligerents: tension or a mobilisation does not, and an alliance does only through the game, which itself enters here those bound to defend a country that is attacked (see ${PEACE_BLOCK_HEADING} below)."));
  assert.ok(gameplay.includes("Nobody may join a war on ${playerName}'s behalf"), "a player is still asked, never joined");
  assert.ok(gameplay.includes("const peace = buildPeaceBlock({ world, game, players: humanCountriesOf(game) });\n  if (peace) blocks.push(peace);"));
  assert.ok(gameplay.indexOf("const fronts = frontsLiveBlock(world, game") < gameplay.indexOf("const peace = buildPeaceBlock("), "after the land's and the sea's");
  const ledger = read("nativeWarLedger.js");
  assert.equal(ledger.includes("A storyline, alliance, mobilization"), false);
  assert.ok(ledger.includes("This ledger is authoritative belligerency. A storyline, mobilization, historical expectation, or tense relationship does NOT itself create a war; an alliance does only through the game"));
  const diplomacy = read("nativeDiplomaticDirector.js");
  assert.equal(diplomacy.includes("A hostile relation or alliance does not itself start a war."), false);
  assert.ok(diplomacy.includes("An alliance, a mutual defence agreement or a guarantee binds: when a party is attacked the game itself enters the others in that war"));
  const console = read("gameplayPrompts.js");
  assert.equal(console.includes("alliances do not automatically create belligerency"), false);
  assert.ok(console.includes("A defensive alliance binds once a turn is played"));
});
