/*! Open Historia — agents' orders and operations: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ASSETS, MAX_OPERATIONS_KEPT, cancelOperation, espionageBrief, identifyChance, normalizeSpies, operationCaptureChance,
  operationSuccessChance, orderOperation, planCovertOperations, resolveEspionage, setSpyFocus,
} from "./spycraft.js";
import { normalizeWorldState } from "./gameState.js";

const P = "France";
const spy = (id, owner, target, status = "active", extra = {}) => ({ id, owner, target, status, deployedAt: "1938-01-01", turnedAt: "", exposedAt: "", coverStory: "", suspected: false, ...extra });
const rounds = Array.from({ length: 120 }, (_, n) => n + 1);

test("orders are given only to an agent in the field, and say what to do", () => {
  const world = { spies: [spy("a", P, "Germany"), spy("b", P, "Italy", "exposed")] };
  assert.throws(() => orderOperation(world, "a", { kind: "bribe", instructions: "x" }), /Choose an operation/);
  assert.throws(() => orderOperation(world, "a", { kind: "sabotage", instructions: "   " }), /Say what the agent should do/);
  assert.throws(() => orderOperation(world, "b", { kind: "sabotage", instructions: "the docks" }), /no longer in the field/);
  assert.throws(() => setSpyFocus(world, "a", "gossip"), /Choose what the agent should collect on/);

  const ordered = normalizeSpies(orderOperation(world, "a", { kind: "Sabotage", instructions: "  the naval\n yards at Kiel ", date: "1938-02-01" }));
  assert.deepEqual(ordered[0].mission, { kind: "sabotage", instructions: "the naval yards at Kiel", orderedAt: "1938-02-01" });
  const focused = normalizeSpies(setSpyFocus({ spies: ordered }, "a", "military"));
  assert.equal(focused[0].focus, "military");
  const cancelled = normalizeSpies(cancelOperation({ spies: focused }, "a"));
  assert.equal("mission" in cancelled[0], false);
  assert.equal(cancelled[0].focus, "military");
});

test("an agent's orders and record survive a save", () => {
  const tasked = spy("a", P, "Germany", "dead", {
    focus: "research",
    mission: { kind: "recruit", instructions: "a rocket engineer", orderedAt: "1938-02-01" },
    assets: [{ who: "a clerk", recruitedAt: "1938-01-15" }],
    operations: [{ id: "op-3-a", kind: "sabotage", instructions: "the docks", date: "1938-03-01", round: 3, outcome: "success", caught: true, identified: false }],
    identified: false,
  });
  const saved = normalizeWorldState({ spies: [tasked, spy("plain", P, "Italy")] }).spies;
  assert.deepEqual(normalizeSpies(saved), normalizeSpies([tasked, spy("plain", P, "Italy")]));
  assert.equal(saved[0].status, "dead");
  assert.equal(saved[0].identified, false);
  assert.equal(saved[0].operations[0].identified, false);
  assert.deepEqual(Object.keys(saved[1]).sort(), ["coverStory", "deployedAt", "exposedAt", "id", "owner", "status", "suspected", "target", "turnedAt"]);
});

test("the odds move the right way", () => {
  assert.ok(operationSuccessChance("sabotage", 80, 30) > operationSuccessChance("sabotage", 30, 80));
  assert.ok(operationSuccessChance("assassinate", 50, 50) < operationSuccessChance("sabotage", 50, 50));
  assert.ok(operationSuccessChance("recruit", 50, 50, { assets: 2 }) > operationSuccessChance("recruit", 50, 50));
  assert.ok(operationCaptureChance("assassinate", 50, 50) > operationCaptureChance("recruit", 50, 50));
  assert.ok(operationCaptureChance("sabotage", 50, 50, { succeeded: false }) > operationCaptureChance("sabotage", 50, 50));
  assert.ok(operationCaptureChance("sabotage", 30, 80) > operationCaptureChance("sabotage", 80, 30));
  assert.ok(identifyChance(80, 30) > identifyChance(30, 80));
  for (const kind of ["sabotage", "recruit", "assassinate", "operation"]) {
    for (const [o, t] of [[0, 100], [100, 0], [50, 50]]) {
      const s = operationSuccessChance(kind, o, t);
      const c = operationCaptureChance(kind, o, t);
      assert.ok(s >= 0.05 && s <= 0.9 && c >= 0.04 && c <= 0.85, `${kind} ${o}/${t}`);
    }
  }
});

test("the plan is decided before the turn, the same way every time, and a turned agent's order comes to nothing", () => {
  const world = {
    intelligence: { [P]: 60, Germany: 50 },
    spies: [
      spy("a", P, "Germany", "active", { mission: { kind: "sabotage", instructions: "the Krupp works", orderedAt: "1938-02-01" } }),
      spy("b", P, "Italy", "turned", { mission: { kind: "assassinate", instructions: "the foreign minister", orderedAt: "1938-02-01" } }),
      spy("c", P, "Spain"),
    ],
  };
  const first = planCovertOperations(world, { round: 5 });
  assert.deepEqual(planCovertOperations(world, { round: 5 }), first);
  assert.deepEqual(first.map((op) => op.spyId), ["a", "b"]);
  assert.deepEqual(first[1], { id: "op-5-b", spyId: "b", owner: P, target: "Italy", kind: "assassinate", instructions: "the foreign minister", outcome: "foiled", caught: false, identified: true });
  assert.ok(["success", "failure"].includes(first[0].outcome));
  assert.equal(first[0].identified && !first[0].caught, false);
  const legacy = planCovertOperations({ spies: [spy("d", "", "Germany", "active", { mission: { kind: "recruit", instructions: "a clerk" } })] }, { round: 1, playerPolity: P });
  assert.equal(legacy[0].owner, P);
});

test("over many turns every outcome happens, and each lands on the agent as the plan said", () => {
  const seen = new Set();
  for (const round of rounds) {
    const world = { intelligence: { [P]: 45, Germany: 55 }, spies: [spy("a", P, "Germany", "active", { mission: { kind: "sabotage", instructions: "the docks", orderedAt: `r${round}` } })] };
    const [plan] = planCovertOperations(world, { round });
    const out = resolveEspionage(world, { round, date: "1938-05-01", playerPolity: P, operations: [plan] });
    const agent = out.spies[0];
    const key = `${plan.outcome}:${plan.caught}:${plan.identified}`;
    seen.add(key);
    assert.equal("mission" in agent, false, "the order is carried out once");
    assert.deepEqual(agent.operations.at(-1), { id: plan.id, kind: "sabotage", instructions: "the docks", date: "1938-05-01", round, outcome: plan.outcome, caught: plan.caught, identified: plan.identified });
    assert.equal(out.operations.length, 1);
    assert.equal(out.events.length, 0, "the game writes no event of its own for an operation: the time skip was told");
    if (!plan.caught) assert.equal(agent.status, "active");
    else if (!plan.identified) {
      assert.equal(agent.status, "dead");
      assert.equal(agent.identified, false);
    } else assert.equal(agent.status, "exposed");
  }
  for (const key of ["success:false:false", "failure:false:false", "success:true:false", "failure:true:true"]) assert.ok(seen.has(key), `${key} happens`);
});

test("a recruit that works brings a source, which makes the agent harder to catch", () => {
  const round = rounds.find((r) => {
    const world = { spies: [spy("a", P, "Germany", "active", { mission: { kind: "recruit", instructions: "a senior rocket engineer", orderedAt: `x${r}` } })] };
    const [plan] = planCovertOperations(world, { round: r });
    return plan.outcome === "success" && !plan.caught;
  });
  assert.ok(round, "some round recruits");
  const world = { spies: [spy("a", P, "Germany", "active", { mission: { kind: "recruit", instructions: "a senior rocket engineer", orderedAt: `x${round}` } })] };
  const out = resolveEspionage(world, { round, date: "1938-06-01", playerPolity: P, operations: planCovertOperations(world, { round }) });
  assert.deepEqual(out.spies[0].assets, [{ who: "a senior rocket engineer", recruitedAt: "1938-06-01" }]);

  const many = { spies: [spy("a", P, "Germany", "active", { assets: Array.from({ length: 5 }, (_, i) => ({ who: `source ${i}` })) })] };
  assert.equal(normalizeSpies(many.spies)[0].assets.length, MAX_ASSETS);

  const caughtWith = (assets) => rounds.filter((r) => resolveEspionage({ intelligence: { Germany: 90, [P]: 30 }, spies: [spy("a", P, "Germany", "active", { assets })] }, { round: r, date: "d", playerPolity: P }).spies[0].status !== "active").length;
  assert.ok(caughtWith([{ who: "x" }, { who: "y" }, { who: "z" }]) < caughtWith([]));
});

test("an agent's record keeps its last operations", () => {
  const operations = Array.from({ length: MAX_OPERATIONS_KEPT + 3 }, (_, i) => ({ id: `op-${i}`, kind: "operation", instructions: "x", outcome: "failure", caught: false, round: i }));
  assert.equal(normalizeSpies([spy("a", P, "Germany", "active", { operations })])[0].operations.length, MAX_OPERATIONS_KEPT);
});

test("a caught agent is not always identified, from either side, and an unidentified one dies without naming anyone", () => {
  let lostAbroad = 0;
  let lostAtHome = 0;
  let exposed = 0;
  for (const round of rounds) {
    const world = { intelligence: { [P]: 70, Germany: 70, Italy: 70 }, spies: [spy("mine", P, "Germany"), spy("theirs", "Italy", P)] };
    const out = resolveEspionage(world, { round, date: "1938-07-01", playerPolity: P });
    const mine = out.spies.find((s) => s.id === "mine");
    const theirs = out.spies.find((s) => s.id === "theirs");
    if (mine.status === "dead") {
      lostAbroad += 1;
      assert.equal(mine.identified, false);
      const event = out.events.find((e) => /Germany/.test(e.title));
      assert.equal(event.title, "Foreign agent dies in custody in Germany");
      assert.doesNotMatch(event.description, /France/);
      assert.equal("audience" in event, false);
    }
    if (mine.status === "exposed") exposed += 1;
    if (theirs.status === "dead") {
      lostAtHome += 1;
      const event = out.events.find((e) => e.title === "A captured agent dies under interrogation");
      assert.ok(event);
      assert.doesNotMatch(event.description, /Italy/);
    }
    if (theirs.status === "discovered") assert.ok(out.events.some((e) => e.source === "espionage" && /Italy/.test(e.title)));
  }
  assert.ok(lostAbroad > 0 && lostAtHome > 0 && exposed > 0, `${lostAbroad} lost abroad, ${lostAtHome} at home, ${exposed} exposed`);
});

test("the simulator does not hear of an agent where an untraced operation just took place", () => {
  const world = { spies: [spy("a", P, "Germany"), spy("b", P, "Italy")] };
  const intercepts = {
    Germany: { gatheredAt: "1938-01-01", exchanges: [{ counterpart: "Austria", subject: "Railways", messages: [{ speaker: "Germany", text: "Hello" }] }] },
  };
  const plain = espionageBrief(world, intercepts, { playerPolity: P });
  assert.match(plain, /agents in: Germany; Italy/);
  assert.match(plain, /Intercepted Germany↔Austria/);
  const hidden = espionageBrief(world, intercepts, { playerPolity: P, hiddenTargets: ["germany"] });
  assert.match(hidden, /agents in: Italy\./);
  assert.doesNotMatch(hidden, /Germany/);
});
