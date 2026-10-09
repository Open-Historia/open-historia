/*! Open Historia — queued-order outcome attribution tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_OUTCOME_ASSOCIATION_TOOL,
  applyActionOutcomeAssociations,
  buildActionOutcomeAssociationPlan,
  normalizeActionOutcomeAssociationAnswer,
  pendingOutcomeActions,
  validateQueuedActionIds,
} from "./actionOutcomeAssociations.js";
import { settleOrders } from "./playerFocus.js";

const action = (id, text, extra = {}) => ({ id, text, title: text, status: "planned", kind: "action", ...extra });
const event = (title, description = "", actionIds = []) => ({
  date: "1914-09-01",
  title,
  description,
  impacts: { actionIds },
  playerRelated: true,
});

test("association job prompt stays transport-neutral so it can ride inside combined turn review", () => {
  const plan = buildActionOutcomeAssociationPlan({
    actions: [action("a1", "Fortify the coast")],
    events: [event("Coastal works begin")],
  });
  assert.ok(plan);
  assert.equal(plan.prompt.includes(ACTION_OUTCOME_ASSOCIATION_TOOL), false);
});

test("a semantic review can restore an omitted exact actionId, after which normal settlement resolves the order", () => {
  const actions = [action("order-qingdao", "Deploy the Qingdao siege division as Beijing garrison")];
  const events = [event("Qingdao siege division deployed as Beijing garrison", "The division takes up temporary garrison duty in Beijing.")];
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  assert.ok(plan);
  const repaired = applyActionOutcomeAssociations({
    events,
    plan,
    answer: { associations: [{ actionId: "order-qingdao", eventIndex: 0 }] },
  });
  assert.deepEqual(repaired.events[0].impacts.actionIds, ["order-qingdao"]);
  assert.equal(settleOrders(actions, repaired.events)[0].status, "resolved");
});

test("an event that only begins a longer operation may be linked without claiming the whole objective succeeded", () => {
  const actions = [action("order-marshalls", "we start a series of landion on marshall islands")];
  const events = [event("Operation Eastern Barrier begins in the Marshall Islands", "The fleet begins the expeditionary operation; the islands are not yet subdued.")];
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  const repaired = applyActionOutcomeAssociations({
    events,
    plan,
    answer: { associations: [{ actionId: "order-marshalls", eventIndex: 0 }] },
  });
  assert.deepEqual(repaired.events[0].impacts.actionIds, ["order-marshalls"]);
  assert.match(repaired.events[0].description, /not yet subdued/);
  assert.equal(settleOrders(actions, repaired.events)[0].status, "resolved");
});

test("truly unanswered orders remain planned and become overdue", () => {
  const actions = [action("a1", "Fortify the capital")];
  const events = [event("Foreign markets rally", "Nothing here answers the fortification order.")];
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  const repaired = applyActionOutcomeAssociations({ events, plan, answer: { associations: [] } });
  assert.deepEqual(repaired.events[0].impacts.actionIds, []);
  assert.deepEqual(settleOrders(actions, repaired.events)[0], { ...actions[0], overdue: true });
});

test("two similar queued orders stay separate because native application uses exact ids, not text similarity", () => {
  const actions = [
    action("a-north", "Fortify the northern approaches"),
    action("a-south", "Fortify the southern approaches"),
  ];
  const events = [event("Northern approaches fortified", "Engineers complete the northern works.")];
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  const repaired = applyActionOutcomeAssociations({
    events,
    plan,
    answer: { associations: [{ actionId: "a-north", eventIndex: 0 }] },
  });
  const settled = settleOrders(actions, repaired.events);
  assert.equal(settled[0].status, "resolved");
  assert.equal(settled[1].status, "planned");
  assert.equal(settled[1].overdue, true);
});

test("one retained event may answer several exact orders", () => {
  const actions = [action("a1", "Fund the shipyard"), action("a2", "Hire shipyard workers")];
  const events = [event("Shipyard programme funded and staffed")];
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  const repaired = applyActionOutcomeAssociations({
    events,
    plan,
    answer: { associations: [{ actionId: "a1", eventIndex: 0 }, { actionId: "a2", eventIndex: 0 }] },
  });
  assert.deepEqual(repaired.events[0].impacts.actionIds, ["a1", "a2"]);
  assert.deepEqual(settleOrders(actions, repaired.events).map((row) => row.status), ["resolved", "resolved"]);
});

test("invalid ids, duplicate rows and out-of-range event indexes are ignored rather than guessed", () => {
  const actions = [action("a1", "Do one thing"), action("a2", "Do another")];
  const events = [event("One thing happens")];
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  const normalized = normalizeActionOutcomeAssociationAnswer({ associations: [
    { actionId: "missing", eventIndex: 0 },
    { actionId: "a1", eventIndex: 99 },
    { actionId: "a1", eventIndex: 0 },
    { actionId: "a1", eventIndex: 0 },
  ] }, plan);
  assert.deepEqual(normalized.associations, [{ actionId: "a1", eventIndex: 0 }]);
  assert.equal(normalized.removed, 3);
});

test("an action already cited by a retained event is not sent back for semantic attribution", () => {
  const actions = [action("a1", "Fund the shipyard"), action("a2", "Recall the ambassador")];
  const events = [event("Shipyard funded", "", ["a1"]), event("Ambassador returns")];
  assert.deepEqual(pendingOutcomeActions(actions, events).map((row) => row.id), ["a2"]);
  const plan = buildActionOutcomeAssociationPlan({ actions, events });
  assert.deepEqual([...plan.pendingIds], ["a2"]);
});

test("chat and unit-revert queue entries never ask a semantic event to resolve them", () => {
  const actions = [
    action("chat", "Open talks", { kind: "chat" }),
    action("deploy", "Deploy fleet", { unitRevert: { unitId: "u1" } }),
    action("ordinary", "Fortify the coast"),
  ];
  const events = [event("Coastal works begin")];
  assert.deepEqual(pendingOutcomeActions(actions, events).map((row) => row.id), ["ordinary"]);
});

test("queued action reference validation rejects invented ids strictly and strips them on salvage", () => {
  const actions = [action("a1", "Fortify the coast")];
  const strictEvents = [event("Works begin", "", ["a1", "stale-id"])];
  const strict = validateQueuedActionIds(strictEvents, actions, { strict: true });
  assert.match(strict.error, /stale-id/);

  const salvageEvents = [event("Works begin", "", ["a1", "stale-id", "a1"])];
  const salvage = validateQueuedActionIds(salvageEvents, actions, { strict: false });
  assert.equal(salvage.error, "");
  assert.equal(salvage.removed, 1);
  assert.deepEqual(salvage.events[0].impacts.actionIds, ["a1"]);
});

test("association application is idempotent and maps normalized candidates by stable event content, not temporary ids", () => {
  const actions = [action("a1", "Fortify the coast")];
  const raw = [event("Coastal works begin", "Engineers start construction.")];
  const normalizedCandidate = { ...raw[0], id: "temporary-random-id" };
  const plan = buildActionOutcomeAssociationPlan({ actions, events: [normalizedCandidate] });
  const first = applyActionOutcomeAssociations({ events: raw, plan, answer: { associations: [{ actionId: "a1", eventIndex: 0 }] } });
  const second = applyActionOutcomeAssociations({ events: first.events, plan, answer: { associations: [{ actionId: "a1", eventIndex: 0 }] } });
  assert.deepEqual(second.events[0].impacts.actionIds, ["a1"]);
});
