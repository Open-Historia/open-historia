/*! Open Historia — portions (turn-pipeline ordering guard) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Reads gameplay.js as TEXT rather than importing it, and that is deliberate.
//
// applySimulationResult is not exported, and exporting it purely to test it would
// mean building an entire turn's worth of fixtures to assert something that is
// really a statement about ORDER. What matters here cannot be observed from
// outside the function anyway: three steps have to happen in one sequence, and
// every one of them is invisible if they do not.
//
// These are the cheapest possible guards against a refactor quietly undoing work
// that has no other alarm. Each failure message says what breaks, because a test
// that only says "order changed" is worse than no test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const source = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), "gameplay.js"),
  "utf8",
);

// The body of applySimulationResult, so a match somewhere else in the file (the
// idle pulse also resolves espionage-ish things) cannot satisfy these by accident.
const applyBody = (() => {
  const start = source.indexOf("const applySimulationResult = async ({");
  assert.notEqual(start, -1, "applySimulationResult has been renamed; this guard needs updating");
  const end = source.indexOf("\nconst ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
})();

const at = (needle, label) => {
  const index = applyBody.indexOf(needle);
  assert.notEqual(index, -1, `${label} is gone from applySimulationResult; this guard needs updating`);
  return index;
};

test("the board task runs AFTER espionage resolves", () => {
  // Espionage produces events partway through the turn. A board call made before
  // it never sees an exposure, so a covert operation can be rolled up in the story
  // while its entry carries on filling. Nothing else fails if this order flips.
  const espionage = at("const espionage = resolveEspionage(", "resolveEspionage");
  const board = at("if (projects) {", "the projects/board call");
  assert.ok(
    espionage < board,
    "the Projects board must run after resolveEspionage, or an exposed agent cannot move the board on the turn it happened",
  );
});

test("nextEvents is built AFTER espionage has appended its events", () => {
  // [...priorEvents, ...freshEvents] is a COPY. Taken before the espionage loop
  // it cannot see an exposure, and that copy is what writeEventsState persists —
  // so the events are never written anywhere and the player never sees them.
  const espionageAppend = at("freshEvents.push(entry);", "the espionage event append");
  const nextEvents = at("const nextEvents = [...priorEvents, ...freshEvents];", "the nextEvents copy");
  assert.ok(
    espionageAppend < nextEvents,
    "nextEvents must be built after the espionage loop, or espionage events are never persisted",
  );
});

test("the board runs BEFORE anything is written", () => {
  // The held-turn UX rests entirely on this: a board failure must mean nothing
  // happened, so the turn can be held and retried without applying twice.
  const board = at("if (projects) {", "the projects/board call");
  const write = at("await Promise.all([", "the state write");
  assert.ok(
    board < write,
    "the board must run before the state write, or a held turn cannot be retried safely",
  );
});

test("covert operations are synced to the board before the board is asked about them", () => {
  // Otherwise the model is shown an entry describing an agent that was caught a
  // moment ago, and asked to reason about it as though it were still in place.
  const sync = at("spyOperationOps(", "the covert-operation sync");
  const board = at("if (projects) {", "the projects/board call");
  assert.ok(sync < board, "spyOperationOps must run before the board task sees the entries");
});
