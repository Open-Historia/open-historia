/*! Open Historia — stats-after-pregame ordering tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/pregameStatsOrdering.test.js
//
// Issue #724: opening the Stats pane on a fresh game while its pregame
// backstory was still generating ran a second AI call alongside it — an error
// for players whose provider refuses concurrent requests — and computed the
// national baseline from a world with no history in it yet, which then
// persisted as campaign canon.
//
// Two orderings fix it, and each is one misplaced line from coming undone, so
// both are pinned here:
//
//   1. generateCountryStatSheet waits for the simulation to go idle before it
//      reads the world or calls the model. The Stats pane calls it DIRECTLY,
//      not through ensureCountryStatSheet, so the wait has to live inside it.
//   2. maybeGeneratePregameHistory takes the lock before its first read. It
//      used to check the lock, read a whole bundle, and only then take it — so
//      anything that looked in between saw "idle" while the backstory was
//      already under way.
//
// gameplay.js pulls in the whole JSX chain and cannot be imported by
// `node --test`, so these read its source instead — the same trade
// server/desktopPortProbe.test.js makes with electron/main.cjs.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");

// One top-level function's CODE: from its declaration to the next declaration
// at column 0, with whole-line comments removed. Without that, the comment
// explaining this very fix — which says "first await" — sat above
// beginSimulation() and failed the ordering check it was describing.
const bodyOf = (name) => {
  const start = source.indexOf(`export const ${name} = async`);
  assert.notEqual(start, -1, `${name} is no longer in gameplay.js`);
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:export )?const [A-Za-z_$][\w$]* = /);
  const text = next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
  return text.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
};

test("the idle wait exists at all", () => {
  // Main never had it; this is the port. Everything below relies on it.
  assert.match(source, /const waitForSimulationIdle = async/);
});

test("a stat sheet waits for the simulation before reading or asking anything", () => {
  const body = bodyOf("generateCountryStatSheet");
  const wait = body.indexOf("await waitForSimulationIdle(");
  assert.notEqual(wait, -1, "generateCountryStatSheet no longer waits for the simulation to go idle");

  // The world it reads is the world the sheet is built from. Read before the
  // wait and the sheet describes the game as it was before the backstory.
  const firstRead = body.search(/await read[A-Za-z]+\(/);
  assert.notEqual(firstRead, -1, "could not find the world read in generateCountryStatSheet");
  assert.ok(wait < firstRead, "the world is read before the idle wait — the sheet would describe a stale world");

  const ask = body.indexOf("runJsonTask(");
  assert.notEqual(ask, -1, "could not find the model call in generateCountryStatSheet");
  assert.ok(wait < ask, "the model is asked before the idle wait — two AI calls would run at once");

  // Exactly once. Twice is harmless at runtime but means a patch was applied
  // over itself, which is exactly how the first attempt at this fix went wrong.
  assert.equal(body.split("await waitForSimulationIdle(").length - 1, 1, "the idle wait appears more than once");
});

test("pregame history takes the lock before its first await", () => {
  const body = bodyOf("maybeGeneratePregameHistory");
  const check = body.indexOf("if (isSimulationBusy()) return null;");
  const take = body.indexOf("beginSimulation();");
  const firstAwait = body.search(/\bawait\b/);
  assert.notEqual(check, -1, "pregame no longer refuses to start while something else is running");
  assert.notEqual(take, -1, "pregame no longer takes the simulation lock");
  assert.notEqual(firstAwait, -1, "pregame no longer awaits anything — this test is out of date");

  assert.ok(check < take, "the lock is taken before checking whether it is free");
  assert.ok(take < firstAwait, "an await runs before the lock is taken — anything looking in that gap sees idle");
});

test("every way out of pregame history releases the lock", () => {
  // Taking the lock earlier moved the "nothing to do" returns inside the try.
  // They are only safe because the finally releases it; without one, the first
  // game opened with no backstory to write would lock the simulation for good.
  const body = bodyOf("maybeGeneratePregameHistory");
  const take = body.indexOf("beginSimulation();");
  const tryAt = body.indexOf("try {", take);
  assert.notEqual(tryAt, -1, "no try follows beginSimulation()");
  assert.ok(
    body.slice(take, tryAt).trim() === "beginSimulation();",
    "code runs between taking the lock and the try that guarantees its release",
  );
  assert.match(body.slice(tryAt), /finally\s*\{\s*endSimulation\(\);\s*\}/, "the lock is not released in a finally");
});
