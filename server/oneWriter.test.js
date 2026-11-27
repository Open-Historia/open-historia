/*! Open Historia — one writer for a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/oneWriter.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { HOSTED_GAME_WRITE_REFUSED, hostedWriteRefusal } from "./oneWriter.js";

const CREDENTIAL = "q1w2e3r4t5y6u7i8o9p0a1s2";
const engineOf = (open) => ({ status: () => ({ open }), credential: () => (open ? CREDENTIAL : "") });
const hosted = { gameId: "game-baltic", scenarioId: "fault-lines" };

test("while a game is shared, only its engine window writes it, or its scenario", () => {
  const engine = engineOf(true);
  const refused = (target, offered = "") => hostedWriteRefusal({ engine, hosted, target, offered });
  assert.equal(refused({ gameId: "game-baltic", key: "world" }), HOSTED_GAME_WRITE_REFUSED, "the host's screen, a second window, another device");
  assert.equal(refused({ gameId: "game-baltic", key: "world" }, CREDENTIAL), "", "the engine window");
  assert.equal(refused({ gameId: "game-baltic", key: "world" }, `${CREDENTIAL}x`), HOSTED_GAME_WRITE_REFUSED);
  assert.equal(refused({ gameId: "game-baltic", key: "world" }, CREDENTIAL.slice(0, -1)), HOSTED_GAME_WRITE_REFUSED);
  assert.equal(refused({ scenarioId: "fault-lines" }), HOSTED_GAME_WRITE_REFUSED, "the map it is played on, in the Workshop");
  assert.equal(refused({ gameId: "another-game" }), "", "another game is not the shared one");
  assert.equal(refused({ scenarioId: "another-scenario" }), "");
  // The adviser's conversation too: the engine keeps it with each seat, and a screen's save of it is a request.
  assert.equal(refused({ gameId: "game-baltic", key: "advisor" }), HOSTED_GAME_WRITE_REFUSED, "the host's screen writes no adviser beside the engine");
  assert.equal(refused({ gameId: "game-baltic", key: "advisor" }, CREDENTIAL), "");
});

test("nothing is refused when no game is shared, and nothing is let through without a credential to match", () => {
  assert.equal(hostedWriteRefusal({ engine: null, hosted, target: { gameId: "game-baltic" } }), "");
  assert.equal(hostedWriteRefusal({ engine: engineOf(false), hosted, target: { gameId: "game-baltic" } }), "");
  const noCredential = { status: () => ({ open: true }), credential: () => "" };
  assert.equal(hostedWriteRefusal({ engine: noCredential, hosted, target: { gameId: "game-baltic" } }, ""), HOSTED_GAME_WRITE_REFUSED);
  assert.equal(hostedWriteRefusal({ engine: noCredential, hosted, target: { gameId: "game-baltic" }, offered: "" }), HOSTED_GAME_WRITE_REFUSED, "an empty credential is never one");
});
