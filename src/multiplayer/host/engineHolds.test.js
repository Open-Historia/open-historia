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
  const boardsHome = resolve.indexOf("returnBoards(");
  assert.ok(jump > -1 && discard > jump, "a held turn is let go when the skip fails");
  assert.ok(rethrown > discard, "and the round is told it failed, so it is planned again");
  assert.ok(boardsHome > rethrown, "the players' boards go home either way");
  assert.match(engine, /import \{ discardHeldTurns, endSimulation, enterSimulation \} from "\.\.\/\.\.\/Game\/AI\/simulationStatus\.js";/);
});

// The owner, 2026-11-15: "never a canned turn". A shared round the AI could not
// write fails and says why; the game's own canned turn is single player's.
test("a shared round never lands as a canned turn, and takes the game's lock in turn for its whole run", () => {
  const resolve = engine.slice(engine.indexOf("resolveRound: async"), engine.indexOf("readCountry: async"));
  assert.match(resolve, /cannedTurn: false/);
  const entered = resolve.indexOf("await enterSimulation({ signal });");
  const lent = resolve.indexOf("lendBoards(");
  const ended = resolve.lastIndexOf("endSimulation();");
  assert.ok(entered > -1 && lent > entered, "the lock is taken before the world is read");
  assert.ok(ended > resolve.lastIndexOf("returnBoards("), "and given back after the boards are home");
  // The skip itself: no fallback offered, and the whole-period canned turn refused.
  assert.match(gameplay, /scriptedPoliticalRequirements\.length \|\| context\.cannedTurn === false\n\s*\? \{\}\n\s*: \{ fallback: \(\) => fallbackJumpSimulation/);
  assert.match(gameplay, /if \(state\.structuralScriptedFallbackBlocked \|\| context\.cannedTurn === false\) throw error;/);
});

test("the engine names every country a person plays to the round's espionage, with each one's own candidates", () => {
  assert.match(gameplay, /const espionageCandidatesFor = \(person\) => espionageCandidatesAgainst\(canonicalEspionagePolity\(person\)\);/);
  assert.match(gameplay, /playerPolity: normalizeString\(baseGame\.country\),\n\s*candidates: espionageCandidates,[\s\S]{0,400}?playerPolities: humanCountriesOf\(baseGame\),\n\s*candidatesFor: espionageCandidatesFor,/);
});
