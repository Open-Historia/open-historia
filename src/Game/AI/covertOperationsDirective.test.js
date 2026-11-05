/*! Open Historia — what a time skip is told of the agents' operations: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";

import { COVERT_OPERATIONS_HEADER, collectionOrders, covertOperationsBlock, untracedTargets } from "./covertOperationsDirective.js";

const op = (fields) => ({ id: "op-1", spyId: "a", owner: "France", target: "Germany", kind: "sabotage", instructions: "the Krupp works", outcome: "success", caught: false, identified: false, ...fields });

test("an operation nobody traced is told without its owner", () => {
  const block = covertOperationsBlock([op({})]);
  assert.ok(block.startsWith(COVERT_OPERATIONS_HEADER));
  assert.match(block, /In Germany, an operation to sabotage "the Krupp works" SUCCEEDED and was never traced/);
  assert.match(block, /name no culprit/);
  assert.doesNotMatch(block, /France/);
  assert.match(block, /no actionIds/);
});

test("an agent caught and never identified is told without its owner, and dies", () => {
  for (const outcome of ["success", "failure"]) {
    const block = covertOperationsBlock([op({ kind: "assassinate", instructions: "the \"Minister\"\nof War", outcome, caught: true, identified: false })]);
    assert.match(block, /to assassinate "the 'Minister' of War"/);
    assert.match(block, /died under interrogation without revealing who sent them/);
    assert.match(block, outcome === "success" ? /after carrying it out/ : /the attempt failed/);
    assert.doesNotMatch(block, /France/);
  }
});

test("an agent caught and identified names its owner", () => {
  const block = covertOperationsBlock([op({ outcome: "failure", caught: true, identified: true })]);
  assert.match(block, /an agent of France was caught trying to sabotage "the Krupp works", and the attempt failed, and Germany established that France sent them/);
});

test("a failure nobody noticed is not told at all, and a recruit is secret", () => {
  assert.equal(covertOperationsBlock([op({ outcome: "failure" })]), "");
  assert.equal(covertOperationsBlock([]), "");
  const recruit = covertOperationsBlock([op({ kind: "recruit", instructions: "a senior rocket engineer" })]);
  assert.match(recruit, /a foreign service secretly recruited "a senior rocket engineer"/);
  assert.match(recruit, /Make no public event of it/);
  assert.doesNotMatch(recruit, /France/);
});

test("a turned agent's order is known to the country that turned it", () => {
  const block = covertOperationsBlock([op({ outcome: "foiled", identified: true })]);
  assert.match(block, /had been turned by Germany, which therefore knows that France ordered it/);
  assert.match(block, /France does not know its agent was turned/);
});

test("the countries an untraced operation took place in", () => {
  assert.deepEqual(untracedTargets([
    op({ target: "Germany" }),
    op({ target: "Italy", outcome: "failure" }),
    op({ target: "Spain", caught: true, identified: false }),
    op({ target: "Austria", caught: true, identified: true }),
    op({ target: "Japan", outcome: "foiled", identified: true }),
    op({ target: "Germany" }),
  ]), ["Germany", "Italy", "Spain"]);
});

test("a report follows the agent's collection orders and its sources", () => {
  assert.equal(collectionOrders({ target: "Germany" }), "");
  assert.equal(collectionOrders({ target: "Germany", focus: "diplomacy" }), "");
  const military = collectionOrders({ target: "Germany", focus: "military", assets: [{ who: "a staff officer" }] }, "Germany");
  assert.match(military, /COLLECTION PRIORITY — the service has tasked this agent to collect on Germany's armed forces/);
  assert.match(military, /RECRUITED SOURCES — the agent runs "a staff officer"/);
  for (const focus of ["research", "economy", "politics"]) assert.match(collectionOrders({ target: "Japan", focus }), /COLLECTION PRIORITY/);
});
