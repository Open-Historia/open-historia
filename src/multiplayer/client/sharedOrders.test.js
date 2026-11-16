/*! Open Historia — a player's orders in a shared game: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/client/sharedOrders.test.js
//
// An order went to the host as its words alone: the host gave it a new id, so an
// AI suggestion's card never said it was queued (a second press queued it again),
// an advisor's proposal could not be approved, and an order opening a
// conversation lost whom it invites.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ORDER_MAX_CHARS, PLAYER_REQUESTS } from "../game/messages.js";
import { validate } from "../protocol/validate.js";
import { orderRequestFor } from "./sharedOrders.js";

const order = (fields) => validate(PLAYER_REQUESTS.order, { t: "order", id: "0123456789abcdef", ...fields });

test("an order goes to the host as the panel made it: its id, title and source", () => {
  const asked = orderRequestFor({ id: "suggestion-7", title: "Mobilise", text: "Call up the reserves.", source: "suggested", kind: "action", status: "planned" });
  assert.deepEqual(asked, { text: "Call up the reserves.", ref: "suggestion-7", title: "Mobilise", source: "suggested" });
  assert.equal(order(asked).ok, true);
  // A typed order with no words of its own takes what was typed; one too long is cut to what the host takes.
  assert.equal(orderRequestFor({ id: "action-1" }, "Hold the line.").text, "Hold the line.");
  assert.equal(orderRequestFor({ text: "x".repeat(ORDER_MAX_CHARS + 50) }).text.length, ORDER_MAX_CHARS);
  // A source the host does not know is left for it to fill.
  assert.equal("source" in orderRequestFor({ text: "a", source: "cheats" }), false);
});

test("an order that opens a conversation carries whom it invites and its opening line", () => {
  const asked = orderRequestFor({ id: "s-8", title: "Talks", text: "Open talks.", kind: "chat", invitees: ["Republic of Estonia", ""], chatStarter: "Shall we talk?" });
  assert.deepEqual(asked, { text: "Open talks.", ref: "s-8", title: "Talks", kind: "chat", invitees: ["Republic of Estonia"], chatStarter: "Shall we talk?" });
  assert.equal(order(asked).ok, true);
  assert.equal(order({ ...asked, ownerCode: "Republic of Latvia" }).ok, false, "never queued as another's");
});

test("the Actions panel and the advisor ask the host for orders by their own ids, and say a refusal", () => {
  const actions = readFileSync(new URL("../../Game/GameUI/actions.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(actions, /requestFromHost\("order", orderRequestFor\(nextAction, trimmed\)\)/);
  assert.match(actions, /requestFromHost\("order", orderRequestFor\(queuedAction\)\)/);
  assert.equal((actions.match(/requestFromHost\("order"/g) ?? []).length, 2, "no other send of an order in the panel");
  assert.match(actions, /setSaveError\(answer\.error \|\| ORDER_NOT_SAVED\)/);
  assert.match(actions, /setSaveError\(answer\.ok \? "" : answer\.error \|\| ORDER_NOT_REMOVED\)/);
  const advisor = readFileSync(new URL("../../Game/GameUI/advisor.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal((advisor.match(/readActions: \(\) => readActionsState\(\{ force: true \}\),\s*requestFromHost,/g) ?? []).length, 2, "Proceed and Cancel");
});
