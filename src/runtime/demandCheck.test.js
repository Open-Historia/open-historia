/*! Open Historia — demand check tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/demandCheck.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  demandCheckContext,
  demandCheckPrompt,
  interpretDemandCheck,
  openDemandOf,
  playerAnswerEvent,
  playerDemandEvent,
} from "./demandCheck.js";

// WHY THIS EXISTS. A live run showed a model understand a refusal ("Belarus's
// refusal is noted") and still not add the optional hidden line that recorded
// it — two in three at best one-on-one, none in groups. So a demand is no longer
// something a reply may or may not mark. The PLAYER's side is buttons (explicit,
// free, unambiguous); the AI's side is one small request whose answer is a
// REQUIRED choice from a fixed list, made only in the one-on-one thread between
// the player and their own Overlord or Puppet.

const world = {
  puppets: [{ id: "p1", overlord: "Russia", puppet: "Belarus", kind: "satellite", loyalty: 30, secrecy: "open", status: "active" }],
};
const ids = () => { let n = 0; return (prefix) => `${prefix}-${n += 1}`; };

// ---- when to check ------------------------------------------------------

test("a reply from the player's own Overlord, one-on-one, is checked as the Overlord's", () => {
  assert.deepEqual(
    demandCheckContext({ world, speaker: "Russia", playerCountry: "Belarus", participants: ["Russia"] }),
    { role: "overlord", overlord: "Russia", puppet: "Belarus" },
  );
});

test("a reply from the player's own Puppet, one-on-one, is checked as the Puppet's", () => {
  assert.deepEqual(
    demandCheckContext({ world, speaker: "Belarus", playerCountry: "Russia", participants: ["Belarus"] }),
    { role: "puppet", overlord: "Russia", puppet: "Belarus" },
  );
});

test("nothing is checked outside that one thread", () => {
  // A group — even one with both of them in it.
  assert.equal(demandCheckContext({ world, speaker: "Russia", playerCountry: "Belarus", participants: ["Russia", "France"] }), null);
  // A country that is neither the player's Overlord nor their Puppet.
  assert.equal(demandCheckContext({ world, speaker: "France", playerCountry: "Belarus", participants: ["France"] }), null);
  // An arrangement that is over.
  const ended = { puppets: [{ ...world.puppets[0], status: "released" }] };
  assert.equal(demandCheckContext({ world: ended, speaker: "Russia", playerCountry: "Belarus", participants: ["Russia"] }), null);
});

test("the room may be given as chat country entries", () => {
  assert.ok(demandCheckContext({ world, speaker: "Russia", playerCountry: "Belarus", participants: [{ name: "Russia", code: "" }] }));
});

// ---- what to ask ----------------------------------------------------------

test("an Overlord's reply offers only the Overlord's outcomes, and a Puppet's only the Puppet's", () => {
  const overlord = demandCheckPrompt({ context: { role: "overlord", overlord: "Russia", puppet: "Belarus" }, reply: "Send two brigades.", openDemand: null });
  assert.match(overlord, /\bdemand\b/);
  assert.doesNotMatch(overlord, /\brefused\b/);
  const puppet = demandCheckPrompt({
    context: { role: "puppet", overlord: "Russia", puppet: "Belarus" },
    reply: "We will not.",
    openDemand: { id: "d1", summary: "Two brigades west", status: "open" },
  });
  assert.match(puppet, /\brefused\b/);
  assert.match(puppet, /Two brigades west/);
  assert.doesNotMatch(puppet, /accepts_alternative/);
});

test("the Overlord is only offered to accept an alternative when one is on the table", () => {
  const noAlternative = demandCheckPrompt({ context: { role: "overlord", overlord: "Russia", puppet: "Belarus" }, reply: "x", openDemand: { id: "d1", summary: "s", status: "open" } });
  assert.doesNotMatch(noAlternative, /accepts_alternative/);
  const withAlternative = demandCheckPrompt({
    context: { role: "overlord", overlord: "Russia", puppet: "Belarus" },
    reply: "x",
    openDemand: { id: "d1", summary: "Two brigades", status: "countered", alternative: "One brigade, border duty" },
  });
  assert.match(withAlternative, /accepts_alternative/);
  assert.match(withAlternative, /One brigade, border duty/);
});

// ---- what the answer becomes ---------------------------------------------

test("an Overlord's demand opens a demand, on the message that made it", () => {
  const [event] = interpretDemandCheck({
    payload: { outcome: "demand", summary: "Two brigades to the western front" },
    context: { role: "overlord", overlord: "Russia", puppet: "Belarus" },
    openDemand: null, messageId: "m7", time: "2016-01-02", idFor: ids(),
  });
  assert.equal(event.kind, "demand_made");
  assert.equal(event.by, "Russia");
  assert.equal(event.target, "Belarus");
  assert.equal(event.summary, "Two brigades to the western front");
  assert.equal(event.messageId, "m7");
});

test("an Overlord that declines an alternative and demands again replaces the old demand", () => {
  const [event] = interpretDemandCheck({
    payload: { outcome: "demand", summary: "Two brigades, as demanded" },
    context: { role: "overlord", overlord: "Russia", puppet: "Belarus" },
    openDemand: { id: "d1", status: "countered", summary: "Two brigades", alternative: "One" },
    messageId: "m9", time: "2016-01-03", idFor: ids(),
  });
  assert.equal(event.kind, "demand_made");
  assert.equal(event.supersedes, "d1");
});

test("an Overlord accepting the alternative settles it", () => {
  const [event] = interpretDemandCheck({
    payload: { outcome: "accepts_alternative", summary: "" },
    context: { role: "overlord", overlord: "Russia", puppet: "Belarus" },
    openDemand: { id: "d1", status: "countered", summary: "Two brigades", alternative: "One" },
    messageId: "m9", time: "2016-01-03", idFor: ids(),
  });
  assert.deepEqual({ kind: event.kind, by: event.by, demandId: event.demandId, answer: event.answer },
    { kind: "demand_answered", by: "Russia", demandId: "d1", answer: "alternative_accepted" });
});

test("an AI Puppet accepts, refuses, or offers an alternative", () => {
  const open = { id: "d1", status: "open", summary: "Two brigades" };
  const answer = (outcome, summary = "") => interpretDemandCheck({
    payload: { outcome, summary },
    context: { role: "puppet", overlord: "Russia", puppet: "Belarus" },
    openDemand: open, messageId: "m3", time: "2016-01-02", idFor: ids(),
  })[0];
  assert.equal(answer("refused").answer, "refused");
  assert.equal(answer("refused").by, "Belarus");
  assert.equal(answer("accepted").answer, "accepted");
  const alternative = answer("alternative", "One brigade, border duty only");
  assert.equal(alternative.answer, "alternative");
  assert.equal(alternative.text, "One brigade, border duty only");
});

test("an outcome the speaker may not give, or 'none', changes nothing", () => {
  const open = { id: "d1", status: "open", summary: "Two brigades" };
  const run = (role, outcome, openDemand = open) => interpretDemandCheck({
    payload: { outcome, summary: "x" },
    context: { role, overlord: "Russia", puppet: "Belarus" },
    openDemand, messageId: "m", time: "t", idFor: ids(),
  });
  assert.deepEqual(run("puppet", "none"), []);
  assert.deepEqual(run("overlord", "none"), []);
  assert.deepEqual(run("puppet", "demand"), [], "a Puppet does not make demands of its Overlord");
  assert.deepEqual(run("overlord", "refused"), [], "an Overlord does not refuse its own demand");
  assert.deepEqual(run("puppet", "refused", null), [], "nothing was demanded");
  assert.deepEqual(run("overlord", "accepts_alternative"), [], "no alternative was on the table");
  assert.deepEqual(run("puppet", "alternative", { ...open, status: "countered" }), [], "an answer is final");
  assert.deepEqual(run("puppet", "nonsense"), []);
});

test("a demand needs something demanded, and an alternative something offered", () => {
  const empty = (role, outcome, openDemand) => interpretDemandCheck({
    payload: { outcome, summary: "   " },
    context: { role, overlord: "Russia", puppet: "Belarus" },
    openDemand, messageId: "m", time: "t", idFor: ids(),
  });
  assert.deepEqual(empty("overlord", "demand", null), []);
  assert.deepEqual(empty("puppet", "alternative", { id: "d1", status: "open", summary: "s" }), []);
});

// ---- the player's own moves ----------------------------------------------

test("the player, as a Puppet, answers from the card: accept, refuse, or an alternative", () => {
  const demand = { id: "d1", by: "Russia", target: "Belarus", status: "open", summary: "Two brigades" };
  assert.equal(playerAnswerEvent({ demand, player: "Belarus", answer: "refused", time: "t", idFor: ids() }).answer, "refused");
  const alternative = playerAnswerEvent({ demand, player: "Belarus", answer: "alternative", text: "One brigade", time: "t", idFor: ids() });
  assert.equal(alternative.text, "One brigade");
  assert.equal(playerAnswerEvent({ demand, player: "Belarus", answer: "alternative", text: "  ", time: "t", idFor: ids() }), null);
});

test("the player, as an Overlord, accepts or rejects a Puppet's alternative", () => {
  const demand = { id: "d1", by: "Russia", target: "Belarus", status: "countered", summary: "Two brigades", alternative: "One" };
  const accepted = playerAnswerEvent({ demand, player: "Russia", answer: "alternative_accepted", time: "t", idFor: ids() });
  assert.equal(accepted.answer, "alternative_accepted");
  // Rejecting is demanding again: revised if the player wrote something, the
  // original restated if not — "this is the demand".
  const revised = playerDemandEvent({ player: "Russia", target: "Belarus", text: "Two brigades by Friday", openDemand: demand, messageId: "m", time: "t", idFor: ids() });
  assert.equal(revised.supersedes, "d1");
  assert.equal(revised.summary, "Two brigades by Friday");
  const restated = playerDemandEvent({ player: "Russia", target: "Belarus", text: "", openDemand: demand, messageId: "m", time: "t", idFor: ids() });
  assert.equal(restated.summary, "Two brigades");
});

test("the player cannot answer for the other side", () => {
  const demand = { id: "d1", by: "Russia", target: "Belarus", status: "open", summary: "s" };
  assert.equal(playerAnswerEvent({ demand, player: "Russia", answer: "refused", time: "t", idFor: ids() }), null);
  assert.equal(playerAnswerEvent({ demand: { ...demand, status: "countered" }, player: "Belarus", answer: "alternative_accepted", time: "t", idFor: ids() }), null);
});

test("the demand still in play is the newest one open or countered", () => {
  const chat = { demands: [
    { id: "d1", status: "superseded" },
    { id: "d2", status: "countered" },
    { id: "d3", status: "refused" },
  ] };
  assert.equal(openDemandOf(chat).id, "d2");
  assert.equal(openDemandOf({ demands: [{ id: "d1", status: "accepted" }] }), null);
  assert.equal(openDemandOf({}), null);
});
