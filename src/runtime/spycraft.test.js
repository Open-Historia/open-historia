/*! Open Historia — spycraft tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTELLIGENCE, MAX_ACTIVE_SPIES, MAX_FOREIGN_SPIES,
  activeSpies, applySpyOps, deploySpy, detectionChance, espionageBrief, expelSpy, foreignAgentBrief, foreignDeployChance,
  foreignSpies, intelligenceOf, normalizeIntercepts, normalizeSpies, recallSpy, redactExchange, redactText,
  resolveEspionage, setCoverStory, signalClarity, suspicionChance, turnChance, turnSpy,
} from "./spycraft.js";
import { isSeal, newSeal, openExchange, openText, sealExchange, sealText } from "./spySeal.js";

const P = "France";

test("intelligence defaults to ordinary, clamps, and rounds", () => {
  assert.equal(intelligenceOf({}, P), DEFAULT_INTELLIGENCE);
  assert.equal(intelligenceOf({ intelligence: { France: 77.6 } }, P), 78);
  assert.equal(intelligenceOf({ intelligence: { France: 140 } }, P), 100);
  assert.equal(intelligenceOf({ intelligence: { France: "nonsense" } }, P), DEFAULT_INTELLIGENCE);
});

test("deploying a spy: limits, duplicates, self, and ownership", () => {
  let world = { spies: [] };
  world = { spies: deploySpy(world, "Germany", { date: "1938-01-01", playerPolity: P }) };
  const [spy] = activeSpies(world, P);
  assert.equal(spy.target, "Germany");
  assert.equal(spy.owner, P);
  assert.equal(spy.deployedAt, "1938-01-01");

  assert.throws(() => deploySpy(world, "Germany", { playerPolity: P }), /already deployed/);
  assert.throws(() => deploySpy(world, P, { playerPolity: P }), /yourself/);
  assert.throws(() => deploySpy(world, "", {}), /Choose/);

  world = { spies: deploySpy(world, "Italy", { playerPolity: P }) };
  world = { spies: deploySpy(world, "Poland", { playerPolity: P }) };
  assert.equal(activeSpies(world, P).length, MAX_ACTIVE_SPIES);
  assert.throws(() => deploySpy(world, "Spain", { playerPolity: P }), /at most 3/);
  // Another owner's spies do not count against the player's cap.
  const withForeign = { spies: [...world.spies, { id: "g1", owner: "Germany", target: P, status: "active" }] };
  assert.equal(activeSpies(withForeign, P).length, 3);
  assert.equal(foreignSpies(withForeign, P).length, 1);
});

test("you cannot spy on your own country, however it is spelled", () => {
  // The picker shows display names; the game stores its country verbatim. An
  // exact comparison let the two drift apart and a player plant an agent at home.
  for (const spelling of ["France", "france", "  FRANCE  "]) {
    assert.throws(() => deploySpy({}, spelling, { playerPolity: P }), /yourself/, spelling);
  }
  // And the same tolerance for a second agent in one country.
  const world = { spies: deploySpy({}, "Germany", { playerPolity: P }) };
  assert.throws(() => deploySpy(world, "  germany ", { playerPolity: P }), /already deployed/);
});

test("recall keeps the record, frees the slot, and a redeploy gets a new id", () => {
  let world = { spies: deploySpy({}, "Germany", { playerPolity: P }) };
  const [first] = activeSpies(world, P);
  world = { spies: recallSpy(world, first.id) };
  assert.equal(activeSpies(world, P).length, 0);
  assert.equal(normalizeSpies(world.spies).length, 1, "history is kept");
  world = { spies: deploySpy(world, "Germany", { playerPolity: P }) };
  assert.notEqual(activeSpies(world, P)[0].id, first.id);
});

test("the player's answers to a caught foreign agent: expel, or turn with a cover story", () => {
  let world = { spies: [{ id: "g1", owner: "Germany", target: P, status: "discovered" }] };
  assert.equal(foreignSpies(world, P)[0].status, "discovered");
  const expelled = { spies: expelSpy(world, "g1", { date: "1938-04-01" }) };
  assert.equal(normalizeSpies(expelled.spies)[0].status, "exposed");
  assert.equal(foreignSpies(expelled, P).length, 0, "an expelled agent is finished");

  world = { spies: turnSpy(world, "g1", { date: "1938-04-01", coverStory: "France will not mobilise." }) };
  const [turned] = foreignSpies(world, P);
  assert.equal(turned.status, "turned");
  assert.equal(turned.coverStory, "France will not mobilise.");
  world = { spies: setCoverStory(world, "g1", "The Maginot line is undermanned.") };
  assert.equal(foreignSpies(world, P)[0].coverStory, "The Maginot line is undermanned.");
});

test("the odds move the right way", () => {
  assert.ok(detectionChance(80, 30) > detectionChance(40, 40), "a better target service catches more");
  assert.ok(detectionChance(30, 80) < detectionChance(40, 40), "a better owner service is caught less");
  assert.ok(detectionChance(100, 0) <= 0.6 && detectionChance(0, 100) >= 0.02, "floored and capped");
  assert.ok(turnChance(90) > turnChance(20), "turning takes skill");
  assert.ok(suspicionChance(90, 30) > suspicionChance(30, 90), "a good service notices it is being fed");
  assert.ok(foreignDeployChance(60, { hostile: true }) > foreignDeployChance(60), "hostility goes looking");
  assert.equal(foreignDeployChance(0), 0);
});

test("resolution is deterministic: same world, same round, same outcome", () => {
  const world = {
    intelligence: { France: 40, Germany: 95, Italy: 30 },
    spies: [
      { id: "f-g", owner: P, target: "Germany", status: "active" },
      { id: "f-i", owner: P, target: "Italy", status: "active" },
      { id: "g-f", owner: "Germany", target: P, status: "active" },
    ],
  };
  const a = resolveEspionage(world, { round: 7, date: "1938-05-01", playerPolity: P, candidates: [{ polity: "Italy" }] });
  const b = resolveEspionage(world, { round: 7, date: "1938-05-01", playerPolity: P, candidates: [{ polity: "Italy" }] });
  assert.deepEqual(a, b);
});

test("over many rounds a weak service against a strong one loses its agent, and the strong one plants agents back", () => {
  let world = { intelligence: { France: 20, Germany: 95 }, spies: deploySpy({}, "Germany", { playerPolity: P, date: "1938-01-01" }) };
  let exposedOrTurned = false;
  let planted = false;
  const allEvents = [];
  for (let round = 1; round <= 40 && !(exposedOrTurned && planted); round += 1) {
    const out = resolveEspionage(world, { round, date: `1938-${String(round).padStart(2, "0")}-01`, playerPolity: P, candidates: [{ polity: "Germany", hostile: true }] });
    world = { ...world, spies: out.spies };
    allEvents.push(...out.events);
    const mine = normalizeSpies(world.spies).find((s) => s.owner === P);
    if (mine.status === "exposed" || mine.status === "turned") exposedOrTurned = true;
    if (foreignSpies(world, P).length > 0) planted = true;
  }
  assert.ok(exposedOrTurned, "a 20-vs-95 agent does not survive forty rounds");
  assert.ok(planted, "a hostile 95 service gets an agent into a 20 service within forty rounds");
  // A public expulsion is an event the AI will see; a turning is silent.
  const mine = normalizeSpies(world.spies).find((s) => s.owner === P);
  if (mine.status === "exposed") assert.ok(allEvents.some((e) => /rolled up in Germany/.test(e.title)));
  if (mine.status === "turned") assert.ok(!allEvents.some((e) => /rolled up in Germany/.test(e.title)));
});

test("a caught foreign agent waits for the PLAYER's decision and stops reporting", () => {
  // Force detection: a hopeless owner service against a perfect target one.
  let world = { intelligence: { France: 100, Germany: 0 }, spies: [{ id: "g-f", owner: "Germany", target: P, status: "active" }] };
  let caught = null;
  for (let round = 1; round <= 60 && !caught; round += 1) {
    const out = resolveEspionage(world, { round, date: "d", playerPolity: P });
    world = { ...world, spies: out.spies };
    if (out.notices.some((n) => n.kind === "discovered")) caught = out;
  }
  assert.ok(caught, "a 0-vs-100 agent is caught");
  const [spy] = foreignSpies(world, P);
  assert.equal(spy.status, "discovered");
  assert.ok(caught.events.some((e) => /uncovers a Germany agent/.test(e.title)));
  // Nothing is decided for the player: the next round leaves it waiting.
  const next = resolveEspionage(world, { round: 99, date: "d", playerPolity: P });
  assert.equal(normalizeSpies(next.spies)[0].status, "discovered");
});

test("the foreign-spy cap and the one-agent-per-polity rule hold", () => {
  let world = { intelligence: { A: 100, B: 100, C: 100, D: 100, France: 0 }, spies: [] };
  for (let round = 1; round <= 30; round += 1) {
    const out = resolveEspionage(world, { round, date: "d", playerPolity: P, candidates: ["A", "B", "C", "D"].map((polity) => ({ polity, hostile: true })) });
    world = { ...world, spies: out.spies };
  }
  const inFrance = foreignSpies(world, P);
  assert.ok(inFrance.length <= MAX_FOREIGN_SPIES);
  assert.equal(new Set(inFrance.map((s) => s.owner)).size, inFrance.length, "one agent per polity");
});

test("clarity: reader's service helps, target's hurts at half weight, never zero", () => {
  assert.equal(signalClarity(100, 0), 1);
  assert.ok(signalClarity(0, 100) >= 0.06);
  assert.ok(signalClarity(60, 40) > signalClarity(40, 40));
  assert.ok(signalClarity(40, 80) < signalClarity(40, 40));
  assert.ok(signalClarity(60, 40) - signalClarity(40, 40) > signalClarity(40, 40) - signalClarity(40, 60));
});

test("redaction is deterministic and monotonic in clarity", () => {
  const text = "We will not honour the pact if Berlin moves on Danzig before the harvest.";
  assert.equal(redactText(text, 0.4, "x"), redactText(text, 0.4, "x"));
  assert.notEqual(redactText(text, 0.4, "x"), text);
  const low = redactText(text, 0.4, "x").split(/\s+/);
  const high = redactText(text, 0.7, "x").split(/\s+/);
  low.forEach((w, i) => { if (!w.includes("█")) assert.equal(high[i], w); });
  assert.equal(redactText(text, 1, "x"), text);
  assert.equal(redactText(text, 0, "x").replace(/[█\s.,]/g, ""), "");
  assert.match(redactText("Yes, sir. Immediately!", 0, "s"), /^█+, █+\. █+!$/);
  assert.notEqual(redactText("Sign the treaty tomorrow", 0.5, "a"), redactText("Sign the treaty tomorrow", 0.5, "b"));
});

test("an exchange keeps its counterpart and date legible and redacts only the text", () => {
  const exchange = { id: "ex1", counterpart: "Italy", date: "1938-03-02", subject: "Austria",
    messages: [{ speaker: "Germany", text: "Stay out of Vienna." }, { speaker: "Italy", text: "Agreed, for a price." }] };
  const out = redactExchange(exchange, 0);
  assert.equal(out.counterpart, "Italy");
  assert.equal(out.messages[0].speaker, "Germany");
  assert.ok(out.messages.every((m) => m.text.includes("█")));
});

test("intercepts at rest are sealed: the file holds ciphertext, not words", async () => {
  const seal = newSeal();
  assert.ok(isSeal(seal));
  const exchange = { id: "germany:3:0", counterpart: "Italy", date: "1938-03-04", subject: "Austria",
    messages: [{ speaker: "Germany", text: "Rome must stay out of Vienna." }, { speaker: "Italy", text: "Agreed, for the Tyrol." }] };
  const sealed = await sealExchange(seal, exchange);
  assert.ok(sealed.messages.every((m) => m.cipher && !("text" in m)), "no plaintext survives sealing");
  const stored = JSON.stringify({ Germany: { exchanges: [sealed] } });
  for (const word of ["Vienna", "Tyrol", "Rome", "Agreed"]) assert.ok(!stored.includes(word), `${word} must not appear in the stored file`);
  // Deterministic: re-sealing the same message yields the same bytes, so a re-save does not churn.
  assert.equal((await sealExchange(seal, exchange)).messages[0].cipher, sealed.messages[0].cipher);

  const opened = await openExchange(seal, sealed);
  assert.deepEqual(opened.messages.map((m) => m.text), exchange.messages.map((m) => m.text));
  // The wrong key does not throw the whole tab away — it marks the message.
  const wrong = await openExchange(newSeal(), sealed);
  assert.ok(wrong.messages.every((m) => m.text === "[unreadable]"));
  // A different label (different message slot) under the same key is a different ciphertext.
  assert.notEqual(await sealText(seal, "a", "same words"), await sealText(seal, "b", "same words"));
  assert.equal(await openText(seal, "a", await sealText(seal, "a", "same words")), "same words");
});

test("normalizeIntercepts accepts sealed and plain messages and drops empty envelopes", () => {
  const out = normalizeIntercepts({
    Germany: { round: 4, planted: true, exchanges: [
      { counterpart: "Italy", messages: [{ speaker: "Germany", cipher: "AAAA" }] },
      { counterpart: "", messages: [{ speaker: "x", text: "orphan" }] },
      { counterpart: "Japan", messages: [] },
    ] },
    "": { exchanges: [{ counterpart: "Italy", messages: [{ speaker: "a", text: "b" }] }] },
    junk: "not an object",
  });
  assert.deepEqual(Object.keys(out), ["Germany"]);
  assert.equal(out.Germany.exchanges.length, 1);
  assert.equal(out.Germany.planted, true);
  assert.equal(out.Germany.exchanges[0].messages[0].cipher, "AAAA");
  assert.deepEqual(normalizeIntercepts(null), {});
});

test("what the simulator is told, and what a foreign leader is told", () => {
  const world = {
    intelligence: { France: 50, Germany: 70 },
    spies: [
      { id: "f-g", owner: P, target: "Germany", status: "turned" },
      { id: "g-f", owner: "Germany", target: P, status: "turned", coverStory: "France will not mobilise." },
      { id: "i-f", owner: "Italy", target: P, status: "active" },
      { id: "f-p", owner: P, target: "Poland", status: "exposed", exposedAt: "1938-02-01" },
    ],
  };
  const intercepts = { Germany: { planted: true, exchanges: [{ id: "x", counterpart: "Italy", subject: "Austria", messages: [{ speaker: "Germany", text: "Nothing planned." }] }] } };
  const brief = espionageBrief(world, intercepts, { playerPolity: P });
  assert.match(brief, /France has agents in: Germany \(TURNED/);
  assert.match(brief, /Germany's agent in France has been turned by France.*"France will not mobilise\."/);
  assert.match(brief, /Italy has a live agent in France/);
  assert.match(brief, /Poland publicly expelled a France agent on 1938-02-01/);
  assert.match(brief, /PLANTED \(false.*Germany↔Italy on Austria: Germany: Nothing planned\./);

  // Italy, live agent: gets the material, redacted by its clarity against France.
  const italy = foreignAgentBrief(world, "Italy", { playerPolity: P, material: "France plans to garrison the Rhine in May." });
  assert.match(italy, /Your agent inside France has obtained/);
  assert.ok(italy.includes("█"), "partial, not the whole thing");
  // Germany, turned agent: gets the cover story and nothing real.
  const germany = foreignAgentBrief(world, "Germany", { playerPolity: P, material: "France plans to garrison the Rhine in May." });
  assert.match(germany, /reports: "France will not mobilise\."/);
  assert.ok(!germany.includes("Rhine"));
  assert.equal(foreignAgentBrief(world, "Spain", { playerPolity: P, material: "x" }), "");
});

test("applySpyOps: the turn's orders follow the Spy tab's rules and never throw", () => {
  const date = "1938-03-01";
  let world = { spies: [] };
  let outcome = applySpyOps(world, [
    { op: "deploy", target: "Germany", coverStory: "a trade attaché" },
    { op: "deploy", target: "Germany" },          // already there
    { op: "deploy", target: "france" },           // the player's own country
    { op: "sabotage", target: "Italy" },          // not a spy operation
    { op: "recall", target: "Italy" },            // nobody there to recall
  ], { date, playerPolity: P });
  world = { spies: outcome.spies };
  assert.deepEqual(outcome.applied, [{ op: "deploy", target: "Germany" }]);
  assert.equal(outcome.rejected.length, 4);
  assert.match(outcome.rejected[0].reason, /already deployed/);
  assert.match(outcome.rejected[1].reason, /yourself/);
  assert.match(outcome.rejected[2].reason, /Unknown spy operation/);
  assert.match(outcome.rejected[3].reason, /No agent of yours/);
  const [spy] = activeSpies(world, P);
  assert.equal(spy.target, "Germany");
  assert.equal(spy.deployedAt, date);
  assert.equal(spy.coverStory, "a trade attaché");

  // The cap holds across one order list, and a recall frees the slot.
  outcome = applySpyOps(world, [
    { op: "deploy", target: "Italy" },
    { op: "deploy", target: "Spain" },
    { op: "deploy", target: "Belgium" },
    { op: "recall", target: "GERMANY" },
    { op: "deploy", target: "Belgium" },
  ], { date, playerPolity: P });
  world = { spies: outcome.spies };
  assert.equal(outcome.rejected.length, 1);
  assert.match(outcome.rejected[0].reason, /at most/);
  assert.deepEqual(activeSpies(world, P).map((entry) => entry.target).sort(), ["Belgium", "Italy", "Spain"]);
  assert.equal(world.spies.find((entry) => entry.target === "Germany").status, "recalled");

  // No orders, no change; no player, nothing applied.
  assert.deepEqual(applySpyOps(world, [], { playerPolity: P }).spies, world.spies);
  assert.equal(applySpyOps(world, [{ op: "deploy", target: "Japan" }], {}).applied.length, 0);
});
