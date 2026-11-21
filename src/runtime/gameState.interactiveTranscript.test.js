/*! Open Historia - completed interactive transcript persistence regressions. AGPL-3.0-or-later. */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvents, writeCanonicalTurnState } from "./gameState.js";
import { JSON_URLS, readJson, setRuntimeAssetEndpoints } from "./assets.js";
import { buildEventHistoryText } from "../Game/AI/promptContext.js";
import { projectEvents } from "../multiplayer/host/projection.js";

const transcript = {
  version: 1,
  sourceEventId: "source-event",
  startedOn: "1912-02-01",
  title: "A tense audience",
  premise: "The cabinet awaits a decision.",
  firstOpening: "The minister enters.",
  request: "Hear the minister first.",
  endedBy: "scene",
  beats: [
    { choice: "Ask for evidence", summary: "The minister produces a letter.", before: "The minister enters.", offered: ["Ask for evidence", "Dismiss him"] },
    { choice: "Read it aloud", summary: "The audience concludes.", before: "The minister produces a letter.", offered: ["Read it", "Leave"] },
  ],
};
const outcome = { id: "event-ai-r0020-19120201-001", kind: "interactive", date: "1912-02-01", title: "The audience concludes", description: "The letter was read.", interactiveTranscript: transcript };

test("N030: the completed scene's exact accepted transcript survives canonical event normalization", () => {
  const [event] = normalizeEvents([outcome]);
  assert.deepEqual(event.interactiveTranscript, transcript);
  const [reloaded] = normalizeEvents(JSON.parse(JSON.stringify([event])));
  assert.deepEqual(reloaded, event);
});

test("N030: no transcript is invented for earlier completed events or admitted onto ordinary events", () => {
  const [legacy, ordinary] = normalizeEvents([{ ...outcome, interactiveTranscript: undefined }, { ...outcome, id: "world", kind: "world" }]);
  assert.equal("interactiveTranscript" in legacy, false);
  assert.equal("interactiveTranscript" in ordinary, false);
});

test("N030: a later shared game's guest may see the historical outcome, not the solo host's scene transcript", () => {
  const [guest] = projectEvents([outcome], "Romania", { host: "Bulgaria" });
  assert.equal(guest.title, outcome.title);
  assert.equal("interactiveTranscript" in guest, false);
  const [host] = projectEvents([outcome], "Bulgaria", { host: "Bulgaria" });
  assert.deepEqual(host.interactiveTranscript, transcript);
});

test("N030: ordinary event prompt reads only the outcome prose, not the dialogue", () => {
  const prompt = buildEventHistoryText([outcome]);
  assert.match(prompt, /The audience concludes/);
  assert.match(prompt, /The letter was read/);
  assert.doesNotMatch(prompt, /Ask for evidence|Dismiss him|Hear the minister first/);
});

test("N030: canonical turn commit publishes and reloads the transcript; a colliding edit cannot erase it", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let payload;
  globalThis.fetch = async (url, init = {}) => {
    assert.match(String(url), /api\/runtime\/turn-commit/);
    payload = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ assets: payload, transactionId: "archive-commit" }) };
  };
  setRuntimeAssetEndpoints({ token: "n030-archive-test" });
  const original = { ...outcome, id: "source-event", kind: "world", title: "A meeting", description: "The audience is requested.", interactiveTranscript: undefined };
  const state = { actions: [], chats: [], colors: {}, events: [original, outcome], game: { country: "Bulgaria", round: 20, gameDate: "1912-02-01" }, world: { activeInteractive: null } };
  await writeCanonicalTurnState(state, { expectedGameId: "n030-archive-test" });
  assert.deepEqual(payload.events[1].interactiveTranscript, transcript);
  assert.deepEqual((await readJson(JSON_URLS.events))[1].interactiveTranscript, transcript);
  assert.throws(() => writeCanonicalTurnState({ ...state, events: [{ ...outcome, id: original.id, kind: "world", interactiveTranscript: undefined }, outcome] }), /discard a completed interactive transcript/);
  // A rollback writes the previous canonical generation through this same seam.
  await writeCanonicalTurnState({ ...state, events: [original], game: { ...state.game, round: 19 } });
  assert.equal(payload.events.length, 1);
  assert.equal("interactiveTranscript" in payload.events[0], false);
});
