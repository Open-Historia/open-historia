/*! Open Historia — canonical whole-turn commit atomicity regressions © 2026. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-turn-commit-test-"));
process.env.OH_DATA_DIR = DATA_DIR;

let store;
let gameId;
const readData = (key) => store.readRuntimeJsonAsset(key).data;

const generation = (n) => ({
  actions: [{ id: `action-${n}`, status: "planned", text: `Action ${n}` }],
  chat: [{ id: `chat-${n}`, countries: [], messages: [] }],
  events: [{ id: `event-${n}`, date: `2000-01-${String(n).padStart(2, "0")}`, title: `Event ${n}` }],
  game: { country: "", gameDate: `2000-01-${String(n).padStart(2, "0")}`, round: n },
  colors: { [`polity-${n}`]: [n, n, n] },
  world: { ownerSchema: 4, customRegions: true, notes: `generation-${n}` },
});

before(async () => {
  store = await import("./libraryStore.js");
  const created = store.createGame({ id: "turn-commit-atomicity", name: "Atomicity Test", setActive: true });
  gameId = created.game.id;
});

after(() => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test("whole-turn commit publishes all six canonical assets as one generation", () => {
  const expected = generation(1);
  const result = store.writeRuntimeTurnState(expected);
  assert.ok(result.transactionId);
  for (const key of ["actions", "chat", "events", "game", "colors", "world"]) {
    assert.deepEqual(readData(key), result.assets[key], key);
  }
  const journal = path.join(DATA_DIR, "games", gameId, "storage", "turn-commit-journal.json");
  assert.equal(fs.existsSync(journal), false, "successful publication must remove the journal");
});

test("an interruption after every file stage recovers to the complete accepted generation before reads", () => {
  const journal = path.join(DATA_DIR, "games", gameId, "storage", "turn-commit-journal.json");

  for (let failAfterAssetIndex = 0; failAfterAssetIndex < 6; failAfterAssetIndex += 1) {
    store.writeRuntimeTurnState(generation(10 + failAfterAssetIndex));
    const intended = generation(20 + failAfterAssetIndex);

    assert.throws(
      () => store.writeRuntimeTurnState(intended, { failAfterAssetIndex }),
      /Injected turn-commit failure/,
      `failure stage ${failAfterAssetIndex}`,
    );
    assert.equal(fs.existsSync(journal), true, `stage ${failAfterAssetIndex} must leave recovery journal`);

    // Any canonical runtime read is a publication boundary. It must complete the
    // journal first, so callers never receive a permanently mixed generation.
    readData("game");
    assert.equal(fs.existsSync(journal), false, `stage ${failAfterAssetIndex} recovery must clear journal`);

    for (const key of ["actions", "chat", "events", "game", "colors", "world"]) {
      assert.deepEqual(
        readData(key),
        intended[key],
        `${key} must belong to generation ${20 + failAfterAssetIndex} after recovery`,
      );
    }
  }
});

test("a pending journal is recovered before a later single-asset runtime write", () => {
  const intended = generation(40);
  assert.throws(
    () => store.writeRuntimeTurnState(intended, { failAfterAssetIndex: 1 }),
    /Injected turn-commit failure/,
  );

  store.writeRuntimeJsonAsset("actions", [{ id: "after-recovery", status: "planned" }]);
  assert.deepEqual(readData("actions"), [{ id: "after-recovery", status: "planned" }]);
  // The other five domains must first have been rolled forward from the journal.
  for (const key of ["chat", "events", "game", "colors", "world"]) {
    assert.deepEqual(readData(key), intended[key], key);
  }
});

test("whole-turn commit refuses a generation stamped for a different active campaign", () => {
  const baseline = generation(50);
  store.writeRuntimeTurnState(baseline);
  assert.throws(
    () => store.writeRuntimeTurnState({ ...generation(51), expectedGameId: "some-other-campaign" }),
    /belongs to game .*some-other-campaign.*active/,
  );
  for (const key of ["actions", "chat", "events", "game", "colors", "world"]) {
    assert.deepEqual(readData(key), baseline[key], `${key} must remain on the active campaign generation`);
  }
});

test("the save catalog recovers a pending generation before exposing date/action/event metadata", () => {
  const intended = generation(60);
  assert.throws(
    () => store.writeRuntimeTurnState(intended, { failAfterAssetIndex: 0 }),
    /Injected turn-commit failure/,
  );
  const journal = path.join(DATA_DIR, "games", gameId, "storage", "turn-commit-journal.json");
  assert.equal(fs.existsSync(journal), true);

  const catalog = store.getGameCatalog();
  const entry = catalog.games.find((game) => game.id === gameId);
  assert.equal(fs.existsSync(journal), false, "catalog read must recover before reading generation files");
  assert.equal(entry.currentDate, intended.game.gameDate);
  assert.equal(entry.eventCount, intended.events.length);
  assert.equal(entry.pendingActions, intended.actions.length);
});
