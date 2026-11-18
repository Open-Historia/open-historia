/*! Open Historia — what a shared game's world task is told of every player: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/worldTaskPeople.test.js
//
// The review of 2026-11-18, simulation 4: the skip's standing and
// intelligence, military strength, diplomatic slice, political capsules and
// the board's espionage were the host's alone. Single player's prompt is
// what it always was: with one person every builder returns single player's
// text (and standingContext.test.js, militaryStanding.test.js and
// spycraftPeople.test.js prove theirs); the wiring below is read from
// gameplay.js, which does not load under bare node.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { setHostingSharedGame } from "../../runtime/humanPolities.js";
import { buildBoundedDiplomaticContext } from "./nativeDiplomaticDirector.js";
import {
  DIPLOMATIC_SLICE_ACTORS,
  diplomaticSliceOptions,
  otherPeople,
  peoplesPressureLine,
  politicalCapsuleBound,
  politicalCapsulePeople,
  sharedBoardServiceLine,
  worldTaskPeople,
} from "./worldTaskPeople.js";

const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const game = { country: "France", humanCountries: ["France", "Spain", "Italy"] };

test("a shared game's world task is built for every person; every other task, and single player, for none", () => {
  setHostingSharedGame(true, { host: "France" });
  try {
    for (const task of ["jumpForward", "autoJumpForward", "worldMotionRepair", "worldBreadthRepair"]) {
      assert.deepEqual(worldTaskPeople(game, task), ["France", "Spain", "Italy"]);
    }
    for (const task of ["chatActions", "projects", "actions", "spyIntercept", ""]) assert.deepEqual(worldTaskPeople(game, task), []);
  } finally {
    setHostingSharedGame(false);
  }
  assert.deepEqual(worldTaskPeople(game, "jumpForward"), ["France"], "a save opened anywhere but its host's engine is single player");
  assert.deepEqual(otherPeople("France", ["france", "Spain", "Spain", ""]), ["Spain"]);
});

test("the diplomatic slice asks for every other player too, each adding one actor to its bound; one person's is as before", () => {
  assert.deepEqual(diplomaticSliceOptions("France", { focusActors: ["Germany"], people: [] }), { playerPolity: "France", focusActors: ["Germany"], maxActors: DIPLOMATIC_SLICE_ACTORS });
  assert.deepEqual(diplomaticSliceOptions("France", { focusActors: ["Germany"], people: ["France"] }), { playerPolity: "France", focusActors: ["Germany"], maxActors: 8 });
  const shared = diplomaticSliceOptions("France", { focusActors: ["Germany"], people: ["France", "Spain", "Italy"] });
  assert.deepEqual(shared, { playerPolity: "France", focusActors: ["Spain", "Italy", "Germany"], maxActors: 10 });
  // A guest is an attention actor though nothing ties it to the host, and its relations with the others are in view.
  const world = { relations: [{ id: "r", a: "France", b: "Spain", score: -50, status: "strained" }], agreements: [], wars: [] };
  assert.doesNotMatch(buildBoundedDiplomaticContext(world, diplomaticSliceOptions("France", { people: ["France"] })).text, /France ↔ Spain/);
  const text = buildBoundedDiplomaticContext(world, diplomaticSliceOptions("France", { people: ["France", "Spain"] })).text;
  assert.match(text, /Attention actors \(2\/9 max\): France, Spain/);
  assert.match(text, /France ↔ Spain \| strained -50/);
});

test("the political capsules put every person first, each other player adding one to the bound", () => {
  assert.deepEqual(politicalCapsulePeople("France", []), ["France"]);
  assert.equal(politicalCapsuleBound(["France"]), 8);
  assert.deepEqual(politicalCapsulePeople("France", ["Spain", "France", "Italy"]), ["France", "Spain", "Italy"]);
  assert.equal(politicalCapsuleBound(["France", "Spain", "Italy"]), 10);
  assert.deepEqual(politicalCapsulePeople("", []), []);
  const line = peoplesPressureLine(["France", "Spain"]);
  assert.match(line, /^For each HUMAN-controlled polity \(France; Spain\), internal pressure may produce non-sovereign social, party, institutional or public developments, but it is NOT consent or authority/);
  assert.match(line, /exact prior authority from that polity's own player/);
});

test("the board pass's espionage is the board's own service's, and says so where several people play", () => {
  const line = sharedBoardServiceLine("France");
  assert.match(line, /^What France's service has read, uncensored: the board below is France's/);
  assert.match(line, /never France's intelligence/);
});

test("gameplay.js builds each block for every person in a world task, and single player's as before", () => {
  // The variables: people only for a world task, and each block given them.
  assert.match(gameplay, /const people = worldTaskPeople\(bundle\?\.game, taskKey\);/);
  assert.match(gameplay, /buildBoundedDiplomaticContext\(bundle\.world,\n\s+diplomaticSliceOptions\(normalizeString\(bundle\?\.game\?\.country\), \{ focusActors, people \}\)\)\.text;/);
  assert.match(gameplay, /buildPlayerPolityReputationText\(bundle, \{ people \}\)/);
  assert.match(gameplay, /buildPlayerPolityIntelligenceText\(bundle, \{ people \}\)/);
  assert.match(gameplay, /describeMilitaryStanding\(bundle\.world && typeof bundle\.world === "object" \? bundle\.world : \{\}, normalizeString\(bundle\.game\.country\), \{ people \}\)/);
  // A later segment's slice, the capsules and the covert operations: every person of the skip.
  assert.match(gameplay, /diplomaticSliceOptions\(normalizeString\(bundle\.game\.country\), \{ people: humanCountriesOf\(bundle\.game\) \}\)/);
  assert.match(gameplay, /playerPolity: normalizeString\(bundle\.game\?\.country\),\n\s+people: humanCountriesOf\(bundle\.game\),\n\s+\}\);/);
  assert.match(gameplay, /persons\.length > 1 \? peoplesPressureLine\(persons\) : "For the HUMAN-controlled polity, internal pressure/);
  assert.match(gameplay, /covertOperationsBlock\(state\.covertOperations, \{ people: humanCountriesOf\(bundle\.game\) \}\)/);
  // The board pass: the board's own service, a person's agent inside it told as a person's.
  assert.match(gameplay, /espionageBrief\(normalizeWorldState\(world\), await readOpenedIntercepts\(\), \{ playerPolity: normalizeString\(game\.country\), people \}\);/);
  assert.match(gameplay, /people\.length > 1\n\s+\? sharedBoardServiceLine\(normalizeString\(game\.country\)\)\n\s+: "What the player's service has read, uncensored — the player sees only what it could decode\.";/);
  assert.match(gameplay, /const framing = `\\n\\n\[Espionage\]\\n\$\{whose\}` \+ " Never write that an agent has been turned, or that an entry came from a spy at all\.\\n\[Doubted intelligence\]\\n/);
});

test("a departed guest's thread has its owner seated whenever the engine hosts a shared game", () => {
  assert.match(gameplay, /const threadOwner = !statedGovernments && \(peopleKeys\.size > 1 \|\| hostingSharedGame\(\)\)/);
});

test("the post-turn ballots read each voter against the person whose institution it votes in", () => {
  assert.match(gameplay, /counterpartByActor: Object\.fromEntries\(actors\.map\(\(name\) => \[name, work\.find\(\(item\) => item\.actors\.includes\(name\)\)\?\.person \|\| player\]\)\),/);
  assert.match(gameplay, /playerCountry: baseGame\.country \|\| "",\n\s+people: humanCountriesOf\(baseGame\),/);
});
