/*! Open Historia — a queued order given other words: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/actionEdit.test.js
//
// "add a button to edit your submitted actions instead of only being able to
// delete it" (the owner, 2026-11-19). An edit changes the same order, in its
// place, and what the old words alone made follows the new ones.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ORDER_GONE_NOTE,
  queueOrderIn,
  removeOrderFrom,
  rewordOrderIn,
  ORDER_CARRIED_OUT_NOTE,
  ORDER_EDIT_ROUND_NOTE,
  ORDER_EDIT_TURN_NOTE,
  hasOwnTitle,
  orderEditBlock,
  rewordAction,
  roundTakesOrderChanges,
  titleFromWords,
} from "./actionEdit.js";

// As the Actions panel queues a typed order (actions.jsx createManualAction): titled by its words.
const typed = (text) => ({ id: "action-1", kind: "action", source: "manual", status: "planned", text, rawInput: text, title: text });

test("a typed order takes the new words, and its title and raw words follow them", () => {
  const order = typed("Hold the line.");
  const edited = rewordAction(order, { text: "  Hold the line at the river.  " });
  assert.deepEqual(edited, { ...order, text: "Hold the line at the river.", rawInput: "Hold the line at the river.", title: "Hold the line at the river." });
  // Titled as it was titled before: by its words whole, as the Actions panel
  // queues one, or cut at 64, as the shared game's host does.
  const long = "Raise three new divisions in the south and march them to the border before winter.";
  assert.equal(rewordAction(order, { text: long }).title, long);
  const hosted = { ...typed(long), title: titleFromWords(long) };
  assert.equal(hosted.title, `${long.slice(0, 61)}...`);
  const longer = `${long} Then hold the passes.`;
  assert.equal(rewordAction(hosted, { text: longer }).title, `${longer.slice(0, 61)}...`);
  assert.equal(rewordAction(hosted, { text: "Short." }).title, "Short.");
});

test("an order keeps its id, its source, its troop order's way back and its overdue mark", () => {
  const order = {
    ...typed("Move the 3rd Army to Riga."),
    id: "order-9",
    overdue: true,
    unitRevert: { unitId: "unit-3", lng: 24.1, lat: 56.9 },
    ownerCode: "Russia",
    createdAt: "2026-11-19T10:00:00.000Z",
  };
  const edited = rewordAction(order, { text: "Move the 3rd Army to Riga and hold it." });
  for (const key of ["id", "overdue", "unitRevert", "ownerCode", "createdAt", "source", "status", "kind"]) {
    assert.deepEqual(edited[key], order[key], key);
  }
  // The order itself is left untouched: the edit is a new object.
  assert.equal(order.text, "Move the 3rd Army to Riga.");
});

test("a title of its own is kept unless a new one is given", () => {
  const suggested = { id: "s-1", kind: "action", source: "suggested", status: "planned", title: "Mobilise", text: "Call up the reserves.", rawInput: "Call up the reserves." };
  assert.equal(hasOwnTitle(suggested), true);
  assert.equal(hasOwnTitle(typed("Hold.")), false);
  assert.equal(rewordAction(suggested, { text: "Call up two classes of reserves." }).title, "Mobilise");
  assert.equal(rewordAction(suggested, { title: "Mobilise now" }).title, "Mobilise now");
  // Only the title changed: the words, and the raw words, stay.
  assert.equal(rewordAction(suggested, { title: "Mobilise now" }).rawInput, "Call up the reserves.");
});

test("a conversation's opening line is changed for an order that opens one, and its invitees kept", () => {
  const talks = { id: "c-1", kind: "chat", status: "planned", title: "Talks", text: "Open talks.", chatStarter: "Shall we talk?", invitees: ["Estonia"] };
  const edited = rewordAction(talks, { chatStarter: "Shall we trade?" });
  assert.deepEqual([edited.chatStarter, edited.invitees, edited.text], ["Shall we trade?", ["Estonia"], "Open talks."]);
  assert.equal("chatStarter" in rewordAction(typed("Hold."), { chatStarter: "Hi" }), false);
});

test("nothing changed, or nothing given, is the order itself", () => {
  const order = typed("Hold.");
  assert.equal(rewordAction(order, {}), order);
  assert.equal(rewordAction(order, { text: "  " }), order);
  assert.equal(rewordAction(order, { text: "Hold." }), order);
});

test("an order can be edited while it waits: not once carried out, not while a skip runs, not while a shared round resolves", () => {
  const order = typed("Hold.");
  assert.equal(orderEditBlock(order), "");
  assert.equal(orderEditBlock({ ...order, status: "resolved" }), ORDER_CARRIED_OUT_NOTE);
  assert.equal(orderEditBlock(order, { turnRunning: true }), ORDER_EDIT_TURN_NOTE);
  for (const phase of ["planning", "countdown", "revealing"]) {
    assert.equal(roundTakesOrderChanges(phase), true, phase);
    assert.equal(orderEditBlock(order, { sharedGame: true, roundPhase: phase }), "", phase);
  }
  for (const phase of ["resolving", "lobby", ""]) {
    assert.equal(orderEditBlock(order, { sharedGame: true, roundPhase: phase }), ORDER_EDIT_ROUND_NOTE, phase);
  }
  assert.equal(orderEditBlock({ ...order, status: "resolved" }, { sharedGame: true, roundPhase: "planning" }), ORDER_CARRIED_OUT_NOTE);
});

test("the Actions panel edits the order in place, through the host's reword in a shared game", () => {
  const panel = readFileSync(new URL("../Game/GameUI/actions.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const start = panel.indexOf("const handleEdit = async (id, fields) => {");
  assert.ok(start > 0);
  const handler = panel.slice(start, panel.indexOf("\n    };", start));
  assert.match(handler, /orderEditBlock\(current, \{ turnRunning: isSimulationBusy\(\), sharedGame: shared, roundPhase: sharedRoundPhase\(\) \}\)/);
  assert.match(handler, /requestFromHost\("reword", request\)/);
  // On this device: by its id, on the queue as stored when written, never a
  // whole list saved from what the panel drew (the review of 2026-11-19).
  assert.match(handler, /commitActions\(\(stored\) => rewordOrderIn\(stored, id, fields, \{ turnRunning: isSimulationBusy\(\) \}\)\)/);
  assert.doesNotMatch(handler, /actions\.map\(/);
  // Never withdrawn and queued again.
  assert.doesNotMatch(handler, /"unorder"|"order"|\.filter\(|\[\.\.\.actions,/);
  // The row's Edit button is disabled, with its reason as its tooltip.
  assert.match(panel, /disabled=\{Boolean\(editBlock\)\}\s*title=\{editBlock \|\| "Edit action"\}/);
});

// The review of 2026-11-19: the panel saved its whole list from what it last
// drew, so a change written meanwhile (the advisor's, a unit move's, a skip
// marking orders carried out) was undone. Every change the panel makes on this
// device is now one order's, by id, decided on the queue as stored.
const planned = (id, text, extra = {}) => ({ id, text, rawInput: text, title: text, status: "planned", ...extra });

test("an edit is decided on the queue as stored: what was written since the panel drew it stays", () => {
  const drawn = [planned("a", "Fortify the border"), planned("b", "Raise taxes")];
  // Meanwhile the advisor queued "c", and removed "b".
  const stored = [drawn[0], planned("c", "Open talks with Austria")];
  const { next, outcome } = rewordOrderIn(stored, "a", { text: "Fortify the eastern border" });
  assert.equal(outcome, "");
  assert.deepEqual(next.map((action) => action.id), ["a", "c"], "c kept, b not put back");
  assert.equal(next[0].text, "Fortify the eastern border");
  assert.equal(next[1], stored[1], "the other order untouched");
});

test("an edit of an order a skip carried out since, or one taken away, writes nothing and says why", () => {
  const stored = [planned("a", "Fortify the border", { status: "resolved" })];
  assert.deepEqual(rewordOrderIn(stored, "a", { text: "Something else" }), { next: null, outcome: ORDER_CARRIED_OUT_NOTE });
  assert.deepEqual(rewordOrderIn(stored, "gone", { text: "Something else" }), { next: null, outcome: ORDER_GONE_NOTE });
  assert.deepEqual(rewordOrderIn([planned("a", "x")], "a", { text: "y" }, { turnRunning: true }), { next: null, outcome: ORDER_EDIT_TURN_NOTE }, "a skip that began after the click");
  assert.deepEqual(rewordOrderIn([planned("a", "x")], "a", { text: "x" }), { next: null, outcome: "" }, "nothing changed, nothing written");
});

test("queueing adds to the queue as stored, once", () => {
  const stored = [planned("a", "x"), planned("c", "the advisor's")];
  assert.deepEqual(queueOrderIn(stored, planned("d", "new")).next.map((action) => action.id), ["a", "c", "d"]);
  assert.equal(queueOrderIn(stored, planned("c", "again")).next, null, "already queued: nothing written");
});

test("removing takes that order out of the queue as stored, and says what it is now", () => {
  const stored = [planned("a", "x"), planned("b", "troops", { status: "resolved", unitRevert: { unit: 1 } }), planned("c", "the advisor's")];
  const taken = removeOrderFrom(stored, "b");
  assert.deepEqual(taken.next.map((action) => action.id), ["a", "c"]);
  assert.equal(taken.removed.status, "resolved", "carried out since: its move is not undone");
  assert.deepEqual(removeOrderFrom(stored, "zz"), { next: null, outcome: ORDER_GONE_NOTE, removed: null });
});

test("the Actions panel writes the queue only through one-order changes on what is stored", () => {
  const panel = readFileSync(new URL("../Game/GameUI/actions.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(panel, /writeActionsState/);
  assert.match(panel, /mutateActionsState\(\(stored\) =>/);
  assert.match(panel, /persistChange\(\(stored\) => queueOrderIn\(stored, nextAction\)\)/);
  assert.match(panel, /persistChange\(\(stored\) => queueOrderIn\(stored, queuedAction\)\)/);
  assert.match(panel, /removeOrderFrom\(stored, removed\?\.id\)/);
  assert.doesNotMatch(panel, /\[\.\.\.actions, /);
});
