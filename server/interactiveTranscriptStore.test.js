/*! Open Historia - N030 completed scene save portability. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeEvents } from "../src/runtime/gameState.js";
import { projectTimelineHistory, olderLedgerEvents } from "../src/Game/GameUI/olderEventHistory.js";

test("a completed transcript travels with the actual desktop turn commit and exported/imported game bundle", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-interactive-archive-"));
  process.env.OH_DATA_DIR = dir;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = await import("./libraryStore.js");
  const gameId = store.createGame({ id: "scene-archive", name: "Scene Archive QA", setActive: true }).game.id;
  const source = { id: "source", kind: "world", date: "1912-01-01", title: "A meeting" };
  const transcript = {
    version: 1, sourceEventId: source.id, startedOn: "1912-01-01", title: "The meeting", premise: "A visit", firstOpening: "An official enters.", request: "Hear their proposal.", endedBy: "scene",
    beats: [{ choice: "Ask", summary: "They respond.", before: "An official enters.", offered: ["Ask", "Leave"] }],
  };
  const outcome = { id: "outcome", kind: "interactive", date: "1912-01-01", title: "The meeting ends", interactiveTranscript: transcript };
  const base = { actions: [], chat: [], colors: {}, events: normalizeEvents([source]), game: { country: "", round: 1, gameDate: "1912-01-01" }, world: { ownerSchema: 4, customRegions: true, activeInteractive: null } };
  const turn = { mode: "jump", round: 1, fromDate: "1911-12-31", toDate: "1912-01-01", eventIds: [source.id] };
  base.world.simulationHistory = [turn];
  store.writeRuntimeTurnState(base);
  const scene = { mode: "interactive", round: 2, fromDate: "1912-01-01", toDate: "1912-01-01", eventIds: [outcome.id] };
  const resolved = { ...base, game: { ...base.game, round: 2 }, events: normalizeEvents([source, outcome]), world: { ...base.world, simulationHistory: [scene, turn] } };
  store.writeRuntimeTurnState(resolved);
  assert.deepEqual(store.readRuntimeJsonAsset("events").data[1].interactiveTranscript, transcript);
  const exported = store.exportGameBundle(gameId);
  // Re-reading the same committed page does not make another canonical event,
  // even if the projection is performed repeatedly or its returned ids edited.
  const onDisk = JSON.stringify(store.readRuntimeJsonAsset("events").data);
  for (let i = 0; i < 3; i++) {
    const ledger = store.readRuntimeJsonAsset("events").data;
    const history = store.readRuntimeJsonAsset("world").data.simulationHistory;
    const pages = projectTimelineHistory(history);
    assert.equal(pages.length, 1);
    assert.deepEqual(pages[0].eventIds, ["source", "outcome"]);
    assert.deepEqual(olderLedgerEvents(ledger, pages), []);
    pages[0].eventIds.push("not-a-canonical-event");
    assert.equal(JSON.stringify(store.readRuntimeJsonAsset("events").data), onDisk);
    assert.deepEqual(store.readRuntimeJsonAsset("world").data.simulationHistory, history);
  }
  assert.equal(new Set(exported.data.events.map(event => event.id)).size, 2);
  assert.deepEqual(exported.data.events[1].interactiveTranscript, transcript);
  const imported = store.importGameBundle(JSON.parse(JSON.stringify(exported))).game.id;
  const importedEvents = store.exportGameBundle(imported).data.events;
  assert.deepEqual(normalizeEvents(importedEvents)[1].interactiveTranscript, transcript);
  store.setActiveGame(gameId);
  // Restore the exact earlier generation through the canonical commit path.
  store.writeRuntimeTurnState(base);
  assert.equal(store.readRuntimeJsonAsset("events").data.length, 1);
  assert.equal("interactiveTranscript" in store.readRuntimeJsonAsset("events").data[0], false);
  assert.deepEqual(projectTimelineHistory(store.readRuntimeJsonAsset("world").data.simulationHistory)[0].eventIds, ["source"]);
  // The imported campaign is independent of the original restoration.
  assert.deepEqual(store.exportGameBundle(imported).data.events[1].interactiveTranscript, transcript);
});
