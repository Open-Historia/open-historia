import test from "node:test";
import assert from "node:assert/strict";
import { fallbackOrderEventFields } from "./fallbackOrderEvent.js";
import { settleOrders } from "./playerFocus.js";

test("failed AI turn cannot resolve an ordinary player order just by narrating a placeholder", () => {
  const order = { id: "action-0-mvuekcip-eewaoki", title: "Enact a global equine population directive",
    kind: "action", status: "planned" };
  const fallback = fallbackOrderEventFields(order, "United States");
  assert.deepEqual(fallback.actionIds, []);
  assert.equal(fallback.title, "Order still awaiting an outcome");
  assert.match(fallback.description, /No execution is confirmed/);
  const next = settleOrders([order], [{ impacts: { actionIds: fallback.actionIds } }], { round: 13 });
  assert.equal(next[0].status, "planned");
  assert.equal(next[0].overdue, true, "the next turn must reattempt rather than treating this as fulfilled");
  assert.equal(next[0].resolvedRound, undefined);
});

test("fallback preserves exact attribution for native chat and deploy operations", () => {
  for (const order of [
    { id: "chat-12", kind: "chat", status: "planned", title: "Ask about a treaty" },
    { id: "deploy-12", kind: "action", status: "planned", title: "Deploy a unit", unitRevert: { remove: true, unitId: "unit-2" } },
  ]) {
    const fields = fallbackOrderEventFields(order, "United States");
    assert.deepEqual(fields.actionIds, [order.id]);
    assert.equal(settleOrders([order], [{ impacts: { actionIds: fields.actionIds } }])[0].status, "resolved");
  }
});

test("long ordinary orders do not become unreadable fallback timeline titles", () => {
  const title = "Unusually long player order ".repeat(50);
  const fields = fallbackOrderEventFields({ id: "a", title, kind: "action" }, "United States");
  assert.ok(fields.title.length < 80);
  assert.ok(fields.description.includes(title), "full order context stays in the description");
});
