/*! Open Historia — the host's engine and turns held for a player: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/engineHolds.test.js
//
// In single player a turn can be HELD, unwritten, for the player to Retry,
// Continue or Discard from the Timeline (Game/AI/simulationStatus.js). The
// engine that hosts a shared game has no Timeline and nobody at it: a held
// turn there would fail the round for everyone, keep the game busy, and be
// asked again whole. So in that engine a failed check lands the turn as
// written, the host's own "Stop when my events fail" does not apply, and a
// skip that fails anyway leaves nothing held.
//
// gameplay.js and engineMain.js cannot be imported without the whole app, so
// they are read as source, like checksHold.test.js; what is pinned is where
// each rule sits. The same goes for the round's espionage, which is told every
// country a person plays (runtime/spycraftShared.test.js has what it does).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { hostingSharedGame, humanCountriesOf, setHostingSharedGame } from "../../runtime/humanPolities.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const gameplay = read("../../Game/AI/gameplay.js");
const engine = read("./engineMain.js");

test("the engine says when it hosts a shared game, and only then are a save's other players counted", () => {
  const game = { country: "France", humanCountries: ["France", "Germany"] };
  assert.equal(hostingSharedGame(), false);
  assert.deepEqual(humanCountriesOf(game), ["France"]);
  setHostingSharedGame(true);
  try {
    assert.equal(hostingSharedGame(), true);
    assert.deepEqual(humanCountriesOf(game), ["France", "Germany"]);
  } finally {
    setHostingSharedGame(false);
  }
  assert.equal(hostingSharedGame(), false);
});

test("in the host's engine a failed check lands the turn as written, and is decided before any check is asked", () => {
  const finish = gameplay.slice(gameplay.indexOf("const finishTimelineJump = async"));
  const made = finish.indexOf("const checks = state.checks ?? (state.checks = createTurnChecks());");
  const accepted = finish.indexOf("if (hostingSharedGame()) checks.accept();");
  // Every check is asked inside the apply (the turn review that came first went on 2026-11-07).
  const applied = finish.indexOf("applySimulationResult(");
  assert.ok(made > -1 && accepted > made, "after the turn's checks are made");
  assert.ok(applied > accepted, "and before the first of them is asked");
});

test("a shared round never stops on the host's own \"Stop when my events fail\"", () => {
  assert.match(gameplay, /stopOnPlayerFailures: getMapSetting\(MAP_SETTING_KEYS\.stopOnPlayerFailures\) && !hostingSharedGame\(\),/);
});

test("a skip that fails in the host's engine leaves no turn held, and the round still hears of the failure", () => {
  const resolve = engine.slice(engine.indexOf("resolveRound: async"));
  const jump = resolve.indexOf("await simulateTimelineJump({ days: daysPerRound, signal, cannedTurn: false });");
  const discard = resolve.indexOf("discardHeldTurns();");
  const rethrown = resolve.indexOf("throw error;", discard);
  assert.ok(jump > -1 && discard > jump, "a held turn is let go when the skip fails");
  assert.ok(rethrown > discard, "and the round is told it failed, so it is planned again");
  assert.match(engine, /import \{ discardHeldTurns, endSimulation, enterSimulation \} from "\.\.\/\.\.\/Game\/AI\/simulationStatus\.js";/);
});

// The review of 2026-11-18, core 2: the round lent every other player's open
// projects to the game's board by writing them into the stored world, and took
// them home in a `finally` an engine closed mid-round never ran. The lending is
// the skip's own copy now (runtime/seatBoards.js), and the round writes none.
test("a round never writes the players' boards lent: the skip lends them at its one read and takes them home in its one commit", () => {
  const resolve = engine.slice(engine.indexOf("resolveRound: async"), engine.indexOf("readCountry: async"));
  assert.doesNotMatch(engine, /lendBoards|returnBoards|seatBoards\.js"/, "the engine writes no lending");
  assert.doesNotMatch(resolve, /mutateWorldState/);
  const jump = gameplay.slice(gameplay.indexOf("export const simulateTimelineJump = async"));
  assert.match(jump, /^[\s\S]{0,2500}?const bundle = withBoardsLent\(await readGameStateBundle\(\{ force: true \}\)\);/, "lent at the skip's read, in its own copy");
  const apply = gameplay.slice(gameplay.indexOf("const applySimulationResult = async"), gameplay.indexOf("const readSeenGameStateBundle = async"));
  const home = apply.indexOf("nextWorld = withBoardsHome(nextWorld, { before: baseWorld, game: baseGame });");
  const snapshot = apply.indexOf("world: withBoardsHome(baseWorld, { before: baseWorld, game: baseGame }),");
  const commit = apply.indexOf("await writeCanonicalTurnState({");
  assert.ok(home > -1 && snapshot > home && commit > snapshot, "home before the restore point and the commit are written");
  // And every service's own board passes, the host's alone no more.
  assert.match(apply, /syncBoardsWithAgents\(worldWithImpacts, \{\n\s*spymasters: spymastersOf\(baseGame\),/);
  assert.doesNotMatch(apply, /spyProvenanceOps|spyIntelDoubtOps/);
});

// The owner, 2026-11-15: "never a canned turn". A shared round the AI could not
// write fails and says why; the game's own canned turn is single player's.
test("a shared round never lands as a canned turn, and takes the game's lock in turn for its whole run", () => {
  const resolve = engine.slice(engine.indexOf("resolveRound: async"), engine.indexOf("readCountry: async"));
  assert.match(resolve, /cannedTurn: false/);
  const entered = resolve.indexOf("await enterSimulation({ signal });");
  const jumped = resolve.indexOf("await simulateTimelineJump(");
  const ended = resolve.lastIndexOf("endSimulation();");
  assert.ok(entered > -1 && jumped > entered, "the lock is taken before the world is read");
  assert.ok(ended > jumped, "and given back after the skip has written its turn");
  // The skip itself: no fallback offered, and the whole-period canned turn refused.
  assert.match(gameplay, /scriptedPoliticalRequirements\.length \|\| context\.cannedTurn === false\n\s*\? \{\}\n\s*: \{ fallback: \(\) => fallbackJumpSimulation/);
  assert.match(gameplay, /if \(state\.structuralScriptedFallbackBlocked \|\| context\.cannedTurn === false\) throw error;/);
});

test("the engine names every country a person plays to the round's espionage, with each one's own candidates", () => {
  // Each against the polities the skip named for that person (spiesOnPlayers.js), or the ledgers' rivals.
  assert.match(gameplay, /const espionageCandidatesFor = \(person\) => espionageCandidatesAgainst\(canonicalEspionagePolity\(person\), namedAgainst\(person\)\);/);
  assert.match(gameplay, /playerPolity: normalizeString\(baseGame\.country\),\n\s*candidates: espionageCandidates,[\s\S]{0,400}?playerPolities: humanCountriesOf\(baseGame\),\n\s*candidatesFor: espionageCandidatesFor,/);
});

// A host whose map's checksum could not be read hosted all the same, and its guests drew whatever their libraries held
// under the scenario's id or name (the review of 2026-11-18, wars 10): it is not shared, and says why.
test("a game whose map's checksum cannot be read is not shared", () => {
  const open = engine.slice(engine.indexOf("const openGame = async"), engine.indexOf("gameHost = createGameHost({"));
  assert.match(open, /if \(!fingerprint\) \{[\s\S]*?throw new Error\(MAP_UNCHECKED\);/);
  assert.match(engine, /const MAP_UNCHECKED = "This game's map could not be read to check it against your guests' copies, so it is not shared/);
});
