/*! Open Historia — the server's copies of the game's wire rules stay the game's © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test test/validateParity.test.js
//
// server-mp is deployed on its own, so it carries copies of two things from
// the game rather than importing them:
//   - src/validate.js, a byte-for-byte copy of src/multiplayer/protocol/validate.js;
//   - the signaling payload schemas in src/schemas.js, copied line for line
//     from src/multiplayer/session/messages.js between two marker comments.
// A copy that drifts from the game's would let the server pass what the game
// refuses, or refuse what it sends, so each is checked against the original.
//
// Line endings are compared as LF: git stores both files with LF and writes
// both out alike on checkout, so a CRLF-only difference is a checkout
// setting, not drift. In a deployed copy the game's files are not there, and
// the checks are skipped (with the reason shown).

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const GAME_VALIDATE = here("../../src/multiplayer/protocol/validate.js");
const GAME_MESSAGES = here("../../src/multiplayer/session/messages.js");
const SERVER_VALIDATE = here("../src/validate.js");
const SERVER_SCHEMAS = here("../src/schemas.js");

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const outsideRepo = (path) => (existsSync(path) ? false : `the game's source is not beside this copy (${path})`);

test("src/validate.js is the game's validate.js, byte for byte", { skip: outsideRepo(GAME_VALIDATE) }, () => {
  const game = read(GAME_VALIDATE);
  const server = read(SERVER_VALIDATE);
  if (server !== game) {
    const serverLines = server.split("\n");
    const gameLines = game.split("\n");
    const differs = serverLines.findIndex((line, index) => line !== gameLines[index]);
    const first = differs === -1 ? serverLines.length : differs;
    assert.fail(`server-mp/src/validate.js differs from src/multiplayer/protocol/validate.js from line ${first + 1}: copy the game's file over it.`);
  }
});

// The variants of `export const SIGNAL = union("t", { … });` in `lines`, by
// name, each as its line; null if there is no such union.
const signalVariants = (lines) => {
  const start = lines.findIndex((line) => line.trim() === 'export const SIGNAL = union("t", {');
  if (start < 0) return null;
  const variants = new Map();
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line === "});") return variants;
    const match = /^(\w+):/.exec(line);
    if (match) variants.set(match[1], line);
  }
  return null;
};

// Every `const NAME = …` / `export const NAME = …` in `lines`, by name.
const constants = (lines) => {
  const found = new Map();
  for (const raw of lines) {
    const match = /^(?:export )?const (\w+) = /.exec(raw.trim());
    if (match) found.set(match[1], raw.trim());
  }
  return found;
};

// Compared both ways, so a change on either side fails: a field or a variant
// the game adds (the server would refuse what the game sends), one the server
// has that the game dropped, and any constant the copy defines differently.
test("the signaling schemas in src/schemas.js are the game's messages.js, variant for variant", { skip: outsideRepo(GAME_MESSAGES) }, () => {
  const lines = read(SERVER_SCHEMAS).split("\n");
  const begin = lines.indexOf("// copy of messages.js: begin");
  const end = lines.indexOf("// copy of messages.js: end");
  assert.ok(begin >= 0 && end > begin, "the copy markers are missing from src/schemas.js");
  const copy = lines.slice(begin + 1, end);
  const game = read(GAME_MESSAGES).split("\n");

  const relayed = signalVariants(copy);
  const theGame = signalVariants(game);
  assert.ok(relayed, "no SIGNAL union between the copy markers in src/schemas.js");
  assert.ok(theGame, "no SIGNAL union in src/multiplayer/session/messages.js");
  // The beacon is the one variant the server leaves out: a public room is
  // found through the listing.
  theGame.delete("beacon");
  assert.deepEqual([...relayed.keys()].sort(), [...theGame.keys()].sort(), "the game's SIGNAL variants and the server's differ");
  for (const [name, line] of theGame) assert.equal(relayed.get(name), line, `the ${name} variant differs from the game's`);

  const gameConstants = constants(game);
  const copied = constants(copy);
  assert.ok(copied.size >= 8, "the copy is unexpectedly short");
  for (const [name, line] of copied) assert.equal(gameConstants.get(name), line, `${name} differs from the game's`);
});
