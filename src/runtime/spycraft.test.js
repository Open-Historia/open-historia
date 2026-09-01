/*! Open Historia — spycraft tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTELLIGENCE, MAX_ACTIVE_SPIES,
  activeSpies, deploySpy, intelligenceOf, normalizeIntercepts, normalizeSpies,
  recallSpy, redactExchange, redactText, signalClarity,
} from "./spycraft.js";

test("intelligence defaults to ordinary, clamps, and rounds", () => {
  assert.equal(intelligenceOf({}, "France"), DEFAULT_INTELLIGENCE);
  assert.equal(intelligenceOf({ intelligence: { France: 77.6 } }, "France"), 78);
  assert.equal(intelligenceOf({ intelligence: { France: 140 } }, "France"), 100);
  assert.equal(intelligenceOf({ intelligence: { France: "nonsense" } }, "France"), DEFAULT_INTELLIGENCE);
});

test("deploying a spy: limits, duplicates, self", () => {
  let world = { spies: [] };
  world = { spies: deploySpy(world, "Germany", { date: "1938-01-01", playerPolity: "France" }) };
  assert.equal(activeSpies(world).length, 1);
  assert.equal(activeSpies(world)[0].target, "Germany");
  assert.equal(activeSpies(world)[0].deployedAt, "1938-01-01");

  assert.throws(() => deploySpy(world, "Germany", { playerPolity: "France" }), /already deployed/);
  assert.throws(() => deploySpy(world, "France", { playerPolity: "France" }), /yourself/);
  assert.throws(() => deploySpy(world, "", {}), /Choose/);

  world = { spies: deploySpy(world, "Italy", {}) };
  world = { spies: deploySpy(world, "Poland", {}) };
  assert.equal(activeSpies(world).length, MAX_ACTIVE_SPIES);
  assert.throws(() => deploySpy(world, "Spain", {}), /at most 3/);
});

test("recalling keeps the record but frees the slot, and a redeploy gets a new id", () => {
  let world = { spies: deploySpy({}, "Germany", {}) };
  const [first] = activeSpies(world);
  world = { spies: recallSpy(world, first.id) };
  assert.equal(activeSpies(world).length, 0);
  assert.equal(normalizeSpies(world.spies).length, 1, "history is kept");
  world = { spies: deploySpy(world, "Germany", {}) };
  assert.equal(activeSpies(world).length, 1);
  assert.notEqual(activeSpies(world)[0].id, first.id);
});

test("clarity: my service helps, theirs hurts at half weight, never zero", () => {
  assert.ok(signalClarity(100, 0) === 1, "a perfect service against none reads everything");
  assert.ok(signalClarity(0, 100) >= 0.06, "the worst case still yields something");
  assert.ok(signalClarity(60, 40) > signalClarity(40, 40), "better service, clearer signal");
  assert.ok(signalClarity(40, 80) < signalClarity(40, 40), "harder target, murkier signal");
  // The asymmetry: a 20-point edge in MY service is worth more than a 20-point
  // edge in THEIRS costs — spying on a peer is meant to be worthwhile.
  assert.ok(signalClarity(60, 40) - signalClarity(40, 40) > signalClarity(40, 40) - signalClarity(40, 60));
});

test("redaction is deterministic and monotonic in clarity", () => {
  const text = "We will not honour the pact if Berlin moves on Danzig before the harvest.";
  const a = redactText(text, 0.4, "x");
  const b = redactText(text, 0.4, "x");
  assert.equal(a, b, "same clarity, same seed, same output — no flicker between renders");
  assert.notEqual(a, text);

  // Raising clarity only ever reveals more: every word visible at 0.4 is still
  // visible at 0.7, because each word keeps its own draw.
  const wordsAt = (s) => s.split(/\s+/);
  const low = wordsAt(redactText(text, 0.4, "x"));
  const high = wordsAt(redactText(text, 0.7, "x"));
  low.forEach((w, i) => { if (!w.includes("█")) assert.equal(high[i], w, `"${w}" must stay visible as clarity rises`); });
  assert.ok(high.filter((w) => w.includes("█")).length <= low.filter((w) => w.includes("█")).length);

  assert.equal(redactText(text, 1, "x"), text, "full clarity is the plain text");
  assert.equal(redactText(text, 0, "x").replace(/[█\s.,]/g, ""), "", "zero clarity hides every word");
});

test("redaction keeps punctuation and shape, and seeds differ per message", () => {
  const out = redactText("Yes, sir. Immediately!", 0, "seed");
  assert.match(out, /^█+, █+\. █+!$/);
  const one = redactText("Sign the treaty tomorrow", 0.5, "a");
  const two = redactText("Sign the treaty tomorrow", 0.5, "b");
  // Same words, different seeds: the pattern of what survives differs, so two
  // intercepts with identical wording do not reveal the same holes.
  assert.notEqual(one, two);
});

test("an exchange keeps its counterpart and date legible and redacts only the text", () => {
  const exchange = {
    id: "ex1", counterpart: "Italy", date: "1938-03-02", subject: "Austria",
    messages: [{ speaker: "Germany", text: "Stay out of Vienna." }, { speaker: "Italy", text: "Agreed, for a price." }],
  };
  const out = redactExchange(exchange, 0);
  assert.equal(out.counterpart, "Italy");
  assert.equal(out.date, "1938-03-02");
  assert.equal(out.messages[0].speaker, "Germany");
  assert.ok(out.messages.every((m) => m.text.includes("█")));
  assert.equal(out.clarity, 0);
});

test("intercept normalization drops empty envelopes and mints ids", () => {
  const raw = {
    Germany: { gatheredAt: "1938-03-12", round: 4, exchanges: [
      { counterpart: "Italy", date: "1938-03-02", messages: [{ speaker: "Germany", text: "Hello" }] },
      { counterpart: "", messages: [{ speaker: "x", text: "orphan" }] },
      { counterpart: "Japan", messages: [] },
    ] },
    "": { exchanges: [{ counterpart: "Italy", messages: [{ speaker: "a", text: "b" }] }] },
    Poland: { exchanges: [] },
    junk: "not an object",
  };
  const out = normalizeIntercepts(raw);
  assert.deepEqual(Object.keys(out), ["Germany"]);
  assert.equal(out.Germany.exchanges.length, 1);
  assert.equal(out.Germany.round, 4);
  assert.ok(out.Germany.exchanges[0].id.length > 0);
  assert.deepEqual(normalizeIntercepts(null), {});
  assert.deepEqual(normalizeIntercepts([1, 2]), {});
});
