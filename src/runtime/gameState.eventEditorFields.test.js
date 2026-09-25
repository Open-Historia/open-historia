/*! Open Historia — what the Event Editor puts on an event survives a save © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: npm ci && node --test src/runtime/gameState.eventEditorFields.test.js
//
// Needs a full install: gameState.js -> assets.js -> maplibre-gl.
//
// The Event Editor (GameUI/cheats.jsx) can give an event a quotation and let
// one polity react to it (processPendingEventOutreach, AI/gameplay.js). The
// event normalizer returned a fixed set of fields without either, so every
// read dropped them: the quote vanished on save, and a queued reaction always
// found its event "disabled" and was cancelled, so none ever fired.

import test from "node:test";
import assert from "node:assert/strict";
import { setRuntimeAssetEndpoints } from "./assets.js";
import { dedupeEventLog, eventCanonicalKey } from "./eventDedup.js";
import {
  normalizeEventEntry,
  normalizeEvents,
  readGameStateBundle,
  writeEventsState,
} from "./gameState.js";

const edited = {
  id: "manual-1",
  createdAt: "2026-09-25T10:00:00.000Z",
  date: "2014-03-02",
  title: "The Duma authorises force in Ukraine",
  description: "The Federation Council approves the use of the armed forces abroad.",
  importance: "major",
  kind: "world",
  source: "manual",
  quote: { text: "  We reserve the right to use all means.  ", speaker: "The Kremlin", role: "press office", stray: 1 },
  npcReaction: { enabled: true, evaluatedAt: "2026-09-25T10:00:12.000Z", result: "sent", chatId: "ru-us-1", stray: "x" },
};

test("a quotation and a reaction switch survive a round trip, tidied", () => {
  const [event] = normalizeEvents(JSON.parse(JSON.stringify([edited])));
  assert.deepEqual(event.quote, { text: "We reserve the right to use all means.", speaker: "The Kremlin", role: "press office" });
  assert.deepEqual(event.npcReaction, { enabled: true, evaluatedAt: "2026-09-25T10:00:12.000Z", result: "sent", chatId: "ru-us-1" });
  // Normalizing what was normalized changes nothing.
  assert.deepEqual(normalizeEvents(JSON.parse(JSON.stringify([event])))[0], event);
});

test("junk is dropped: a quote with no text, a switch that is not true, a field that is not an object", () => {
  const base = { id: "e", date: "2014-03-02", title: "T", description: "D" };
  assert.equal("quote" in normalizeEventEntry({ ...base, quote: { speaker: "Nobody", text: "  " } }), false);
  assert.equal("quote" in normalizeEventEntry({ ...base, quote: "a string" }), false);
  assert.equal("npcReaction" in normalizeEventEntry({ ...base, npcReaction: ["enabled"] }), false);
  assert.deepEqual(normalizeEventEntry({ ...base, npcReaction: { enabled: "true" } }).npcReaction, { enabled: false });
  assert.deepEqual(normalizeEventEntry({ ...base, npcReaction: { enabled: false, result: "  " } }).npcReaction, { enabled: false });
});

test("an event without them saves exactly as before: neither key appears", () => {
  const event = normalizeEventEntry({ id: "e", date: "2014-03-02", title: "T", description: "D" });
  assert.equal("quote" in event, false);
  assert.equal("npcReaction" in event, false);
  assert.equal(normalizeEventEntry({ id: "e", title: "T", quote: null, npcReaction: null }).quote, undefined);
});

test("neither field is part of an event's identity: de-duplication is unchanged", () => {
  const [withFields] = normalizeEvents([edited]);
  const [without] = normalizeEvents([{ ...edited, quote: undefined, npcReaction: undefined }]);
  assert.equal(eventCanonicalKey(withFields), eventCanonicalKey(without));
  // A prose repeat is still folded, whichever of the two carries the switch.
  assert.equal(dedupeEventLog([withFields, { ...without, id: "manual-2" }]).length, 1);
});

// ---- The engine's read ------------------------------------------------------
// processPendingEventOutreach reads its events through readGameStateBundle;
// served from an in-memory store the way the local server answers the page.
const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  const match = /\/api\/runtime\/json\/(\w+)/.exec(String(url));
  if (!match) return new Response("not found", { status: 404 });
  const key = match[1];
  if (String(init.method || "GET").toUpperCase() === "PUT") {
    store.set(key, String(init.body));
    return new Response(String(init.body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!store.has(key)) return new Response("missing", { status: 404 });
  return new Response(store.get(key), { status: 200, headers: { "Content-Type": "application/json" } });
};

test("the engine reads a flagged event as flagged, and keeps the reaction's record when it writes it", async () => {
  setRuntimeAssetEndpoints({ token: "event-editor-fields" });
  store.set("events", JSON.stringify([{ ...edited, npcReaction: { enabled: true } }]));
  const bundle = await readGameStateBundle({ force: true });
  const event = bundle.events.find((entry) => entry.id === "manual-1");
  // The check that used to cancel every reaction: !event?.npcReaction?.enabled.
  assert.equal(event?.npcReaction?.enabled, true);
  assert.equal(event?.quote?.text, "We reserve the right to use all means.");

  // What processPendingEventOutreach writes once the reaction is decided.
  await writeEventsState(bundle.events.map((entry) => (entry.id === "manual-1"
    ? { ...entry, npcReaction: { ...entry.npcReaction, evaluatedAt: "2026-09-25T10:00:12.000Z", result: "sent", chatId: "ru-us-1" } }
    : entry)));
  const saved = JSON.parse(store.get("events")).find((entry) => entry.id === "manual-1");
  assert.deepEqual(saved.npcReaction, { enabled: true, evaluatedAt: "2026-09-25T10:00:12.000Z", result: "sent", chatId: "ru-us-1" });
  assert.equal(saved.quote.speaker, "The Kremlin");
});
