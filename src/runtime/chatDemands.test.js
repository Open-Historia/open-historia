/*! Open Historia — demand lifecycle tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/chatDemands.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChatEvents, projectChatThread } from "./chatThreads.js";

// A DEMAND is an Overlord telling its own Puppet to do something, in the
// one-on-one thread between them. It is kept the way a poll is: as events in the
// thread's log (demand_made, demand_answered), each appended rather than written
// over, with its state projected from them.
//
//   open ──accepted──────────────► accepted          (no cost)
//   open ──refused───────────────► refused           (costs Loyalty, once)
//   open ──alternative───────────► countered
//   countered ──alternative_accepted► settled         (no cost)
//   open | countered ──a new demand that supersedes it► superseded (no cost)
//
// An Overlord that declines an alternative does so by making a demand again —
// revised, or the same one restated — which replaces the old.

const room = [
  { id: "t-created", kind: "chat_created", time: "2016-01-01", title: "Minsk and Moscow" },
  { id: "t-join", kind: "member_joined", time: "2016-01-01", member: { name: "Belarus" } },
];
const demandsOf = (events) => projectChatThread(normalizeChatEvents([...room, ...events])).demands;
const made = (extra = {}) => ({
  id: "d1-made", kind: "demand_made", time: "2016-01-02", by: "Russia", demandId: "d1", target: "Belarus",
  summary: "Two brigades to the western front", messageId: "m1", ...extra,
});
const answered = (answer, extra = {}) => ({
  id: `d1-${answer}-${extra.by ?? "Belarus"}`, kind: "demand_answered", time: "2016-01-02", by: "Belarus", demandId: "d1", answer, ...extra,
});

test("a demand opens, naming who made it of whom and what it asks", () => {
  const [demand] = demandsOf([made()]);
  assert.deepEqual(
    { id: demand.id, by: demand.by, target: demand.target, summary: demand.summary, status: demand.status, messageId: demand.messageId },
    { id: "d1", by: "Russia", target: "Belarus", summary: "Two brigades to the western front", status: "open", messageId: "m1" },
  );
});

test("the Puppet accepts, or refuses", () => {
  assert.equal(demandsOf([made(), answered("accepted")])[0].status, "accepted");
  assert.equal(demandsOf([made(), answered("refused")])[0].status, "refused");
});

test("the Puppet offers an alternative, and the Overlord accepts it", () => {
  const countered = demandsOf([made(), answered("alternative", { text: "One brigade, for border duty only" })])[0];
  assert.equal(countered.status, "countered");
  assert.equal(countered.alternative, "One brigade, for border duty only");

  const settled = demandsOf([
    made(),
    answered("alternative", { text: "One brigade, for border duty only" }),
    answered("alternative_accepted", { by: "Russia" }),
  ])[0];
  assert.equal(settled.status, "settled");
});

test("an Overlord that declines an alternative demands again, and the new demand replaces the old", () => {
  const demands = demandsOf([
    made(),
    answered("alternative", { text: "One brigade" }),
    { id: "d2-made", kind: "demand_made", time: "2016-01-03", by: "Russia", demandId: "d2", target: "Belarus", summary: "Two brigades, as demanded", supersedes: "d1" },
  ]);
  const byId = Object.fromEntries(demands.map((demand) => [demand.id, demand]));
  assert.equal(byId.d1.status, "superseded");
  assert.equal(byId.d2.status, "open");
});

test("only the Puppet may answer a demand, and only the Overlord may accept its alternative", () => {
  // Russia cannot accept its own demand for Belarus, nor a third party refuse it.
  assert.equal(demandsOf([made(), answered("accepted", { by: "Russia" })])[0].status, "open");
  assert.equal(demandsOf([made(), answered("refused", { by: "France" })])[0].status, "open");
  // Belarus cannot accept its own alternative.
  assert.equal(demandsOf([made(), answered("alternative", { text: "One" }), answered("alternative_accepted")])[0].status, "countered");
});

test("a Puppet may change its mind after a refusal, but not after agreeing", () => {
  // A player who refuses, thinks again and accepts is answering the same demand
  // over, not being handed a new one. The refusal's Loyalty cost is charged by
  // the turn (gameState.chargeRefusals), so a change of mind inside the same
  // turn costs nothing and one after it has already been paid.
  const changed = demandsOf([made(), answered("refused"), answered("accepted", { id: "late" })])[0];
  assert.equal(changed.status, "accepted");
  const offered = demandsOf([made(), answered("refused"), answered("alternative", { id: "late", text: "One brigade" })])[0];
  assert.equal(offered.status, "countered");
  assert.equal(offered.alternative, "One brigade");

  // What is agreed is agreed: neither side may take an acceptance back.
  assert.equal(demandsOf([made(), answered("accepted"), answered("refused", { id: "late" })])[0].status, "accepted");
  const settled = demandsOf([
    made(),
    answered("alternative", { text: "One brigade" }),
    answered("alternative_accepted", { by: "Russia" }),
    answered("refused", { id: "late" }),
  ])[0];
  assert.equal(settled.status, "settled");
});

test("an answer to a demand that was never made is ignored", () => {
  assert.deepEqual(demandsOf([answered("refused")]), []);
});

test("a finished demand is not superseded — only open or countered ones are", () => {
  const demands = demandsOf([
    made(),
    answered("refused"),
    { id: "d2-made", kind: "demand_made", time: "2016-01-03", by: "Russia", demandId: "d2", target: "Belarus", summary: "Again", supersedes: "d1" },
  ]);
  assert.equal(demands.find((demand) => demand.id === "d1").status, "refused", "a refusal stands, and is still charged");
});

test("a demand needs both parties and something demanded", () => {
  assert.deepEqual(demandsOf([made({ target: "" })]), []);
  assert.deepEqual(demandsOf([made({ summary: "" })]), []);
  assert.deepEqual(demandsOf([made({ by: "" })]), []);
});
