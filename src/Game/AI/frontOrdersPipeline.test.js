/*! Open Historia — the battlefields' orders through a turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/frontOrdersPipeline.test.js
//
// An order a time skip gives a battlefield has to survive everything a ledger
// record survives, or the front engine never hears of it: the contract the
// skip is sent, the answer's validation, the join of a skip's segments, the
// screen and the curator that can remove the event it rests on, the turn's
// result, and the journal a turn is cut short from.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { FEATURE_KEYS } from "../../../server/gameFeatures.js";
import { GAMEPLAY_SCHEMAS, GAMEPLAY_TOOLS, foldJumpTool, validateGameplayPayload, withFrontOrders, withoutGroupOps } from "./gameplaySchemas.js";
import { frontsOn, frontsPace } from "./frontsGate.js";
import { journalTurn, truncateTurn } from "./intervene.js";
import { mergeSegmentPayloads } from "./jumpSegments.js";
import { bindFrontOrdersToEvents } from "./nativeFrontLedger.js";
import { screenGeneratedWorldEvents } from "./nativeWorldIntegrity.js";

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), "utf8");

test("the lean contract does not carry the field, and the field costs the contract little over a hundred characters", () => {
  const lean = GAMEPLAY_TOOLS.jumpForward;
  assert.equal("frontOrders" in lean.schema.properties, false);
  const shown = withFrontOrders(lean);
  assert.deepEqual(shown.schema.properties.frontOrders, { type: "string", description: "Fronts; format in prompt. Empty if none." });
  assert.equal(Object.keys(shown.schema.properties).at(-1), "frontOrders", "after the ledgers, before anything a fold adds");
  // The lean contract is held to a size of its own (projectOpSchema.test.js),
  // and other fields are written into what room that leaves, so what is held
  // here is what THIS field adds: one line saying what it is. It is sent only
  // while the game fights on battlefields, where it stands in for a move
  // operation a formation and a control operation a region.
  const cost = JSON.stringify(shown.schema).length - JSON.stringify(lean.schema).length;
  assert.ok(cost > 0 && cost < 120, `front orders cost the jump schema ${cost} chars`);
  // In what is sent the field must be written, if only as "": a model that may
  // leave it out does (a live skip with a battle in every other event came
  // back without one). The lean contract's own list is not touched.
  assert.ok(shown.schema.required.includes("frontOrders"));
  assert.equal(lean.schema.required.includes("frontOrders"), false);
  assert.equal(GAMEPLAY_SCHEMAS.jumpForward.required.includes("frontOrders"), false, "and an answer without it is still read");
  assert.equal(withFrontOrders(shown), shown, "added once");
  assert.equal(withFrontOrders(GAMEPLAY_TOOLS.actions), GAMEPLAY_TOOLS.actions, "no other task's tool is touched");
  // With the other reshapings a skip's tool goes through.
  const folded = foldJumpTool(withFrontOrders(withoutGroupOps(lean)), { board: true, agentReports: true, history: true });
  assert.ok("frontOrders" in folded.schema.properties);
  assert.ok(Object.keys(folded.schema.properties).indexOf("frontOrders") < Object.keys(folded.schema.properties).indexOf("history"));
});

test("an answer is valid with the field and without it", () => {
  const answer = (extra) => ({ events: [], stopDate: "2024-04-01", summary: "A quiet month.", ...extra });
  assert.equal(validateGameplayPayload("jumpForward", answer({})).valid, true);
  const withOrders = validateGameplayPayload("jumpForward", answer({ frontOrders: "Eastern Ukraine~Russia~advance~north~1" }));
  assert.equal(withOrders.valid, true, withOrders.error);
  assert.equal(validateGameplayPayload("autoJumpForward", answer({ frontOrders: "" })).valid, true);
});

test("fronts are off in a build whose feature list does not have them", () => {
  assert.equal(frontsOn(), FEATURE_KEYS.includes("fronts"));
  assert.equal(frontsPace(), 0.4, "the built-in pace of a front: four tenths of a formation's on the move");
});

test("a skip's segments hand their orders on together", () => {
  const first = { events: [{ id: "s1-e1" }], frontOrders: bindFrontOrdersToEvents("Eastern Ukraine~Russia~advance~north~1", [{ id: "s1-e1" }]) };
  const second = { events: [{ id: "s2-e1" }], frontOrders: "Eastern Ukraine~Ukraine~dig in~all" };
  const merged = mergeSegmentPayloads([first, second, { events: [] }]);
  assert.equal(merged.frontOrders.length, 2);
  assert.deepEqual(merged.frontOrders[0].eventIds, ["s1-e1"]);
  assert.equal(merged.frontOrders[1], "Eastern Ukraine~Ukraine~dig in~all", "a raw line is carried as a line; the decoder reads both");
  assert.deepEqual(mergeSegmentPayloads([]).frontOrders, []);
});

test("the skip hands the orders the merge carries on to the apply, which keeps and renames them with the ledgers", () => {
  const gameplay = read("./gameplay.js");
  const finish = gameplay.slice(gameplay.indexOf("const finishTimelineJump = async"));
  const result = finish.slice(finish.indexOf("const result = {"), finish.indexOf("const applyArgs = {"));
  assert.match(result, /\bfrontOrders: merged\.frontOrders\b/, "frontOrders is not handed to the apply");
  assert.match(gameplay, /const keptFrontOrders = filterBoundLedgerUpdatesToKeptEvents\(result\.frontOrders, dedupedEvents, curatedEvents\);/);
  assert.match(gameplay, /const frontOrders = remapLedgerEventIds\(normalizeArray\(keptFrontOrders\), canonicalEventIdentity\.idMap\);/);
  assert.match(gameplay, /payload\.frontOrders = filterBoundLedgerUpdatesToKeptEvents\(payload\?\.frontOrders, taggedEvents, screened\.events\);/);
  assert.match(gameplay, /return frontsOn\(\) \? withWarFigures\(withFrontOrders\(shown\)\) : shown;/, "the contract carries the field only while fronts are on");
});

test("a turn cut short keeps the orders of the events that happened", () => {
  const event = (id, date) => ({ id, date, title: id, description: "x", impacts: {} });
  const journal = journalTurn({
    events: [event("e1", "2024-03-02"), event("e2", "2024-03-10"), event("e3", "2024-03-20")],
    frontOrders: [
      { id: "front-0", battlefield: "Eastern Ukraine", side: "Russia", order: "advance", sector: "north", eventIds: ["e1"] },
      { id: "front-1", battlefield: "Eastern Ukraine", side: "Russia", order: "spearhead", sector: "centre", eventIds: ["e3"] },
      { id: "front-2", battlefield: "Eastern Ukraine", side: "Ukraine", order: "dig in", sector: "all", eventIds: [] },
    ],
    stopDate: "2024-03-31",
  });
  assert.equal(journal.frontOrders.length, 3);
  const cut = truncateTurn(journal, 2, { originDate: "2024-03-01" });
  assert.deepEqual(cut.result.frontOrders.map((order) => order.id), ["front-0", "front-2"], "the order of an event that never happened goes; one that named no event stays");
  assert.deepEqual(journalTurn({}).frontOrders, []);
});

test("an event an order rests on is not filed away as routine military news", () => {
  const world = { polityOverrides: {}, wars: [{ id: "war-1", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] }] };
  const game = { country: "France", gameDate: "2024-03-01" };
  const event = {
    id: "e1",
    date: "2024-03-05",
    title: "Russian columns probe the northern sector",
    description: "Reconnaissance patrols and artillery exchanges continue along the line north of Kharkiv.",
    kind: "world",
    warId: "war-1",
    combatants: ["Russia", "Ukraine"],
    impacts: {},
  };
  // Nor on its own: the screen once hid it for its English words, and kept it
  // in any other language. No word list reads an event for the war now.
  const alone = screenGeneratedWorldEvents({ events: [event], world, game });
  assert.deepEqual(alone.events.map((kept) => kept.id), ["e1"]);
  assert.deepEqual(alone.hidden, []);
  const integrity = read("./nativeWorldIntegrity.js");
  assert.ok(!/frontOrders = \[\]/.test(integrity.slice(integrity.indexOf("export const screenGeneratedWorldEvents"))), "the screen needs no orders to keep it");
});

test("the curator spares it too, and the screen reads an order's raw line the way it reads a ledger's", () => {
  const gameplay = read("./gameplay.js");
  assert.match(gameplay, /const spareForFocus = \(event\) => spareForPlayer\(event\) \|\| frontOrderedEventIds\.has\(normalizeString\(event\?\.id\)\);/);
  const integrity = read("./nativeWorldIntegrity.js");
  // The ledgers an event rests on, the battlefields' orders among them, read
  // as `~` lines or as the records they are pinned to (eventHasLedgerTrigger).
  assert.match(integrity, /const EVENT_LEDGERS = Object\.freeze\(\[[^\]]*"frontOrders"[^\]]*\]\);/);
  const trigger = integrity.slice(integrity.indexOf("const eventHasLedgerTrigger"), integrity.indexOf("const ledgerRecordPolities"));
  assert.match(trigger, /EVENT_LEDGERS\.some/);
});
