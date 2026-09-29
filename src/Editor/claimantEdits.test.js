import { test } from "node:test";
import assert from "node:assert/strict";
import { commonClaimants, claimantDelta, applyClaimantDelta } from "./claimantEdits.js";

test("identical claimant lists are shown whole and not mixed", () => {
  assert.deepEqual(commonClaimants([["China", "India"], ["China", "India"]]), { shown: ["China", "India"], mixed: false });
  assert.deepEqual(commonClaimants([[], []]), { shown: [], mixed: false });
  assert.deepEqual(commonClaimants([]), { shown: [], mixed: false });
});

test("differing lists show only the claims every region shares", () => {
  assert.deepEqual(commonClaimants([["China", "India"], ["India"], ["India", "Pakistan"]]), { shown: ["India"], mixed: true });
  assert.deepEqual(commonClaimants([[], ["India"]]), { shown: [], mixed: true });
});

test("adding a claimant to a mixed selection keeps each region's own claims", () => {
  const lists = [[], ["China"], ["India", "Pakistan"]];
  const { shown } = commonClaimants(lists);
  const delta = claimantDelta(shown, [...shown, "Nepal"]);
  assert.deepEqual(delta, { add: ["Nepal"], remove: [] });
  assert.deepEqual(lists.map((list) => applyClaimantDelta(list, delta)), [["Nepal"], ["China", "Nepal"], ["India", "Pakistan", "Nepal"]]);
});

test("an added claimant a region already has is not doubled", () => {
  assert.deepEqual(applyClaimantDelta(["Nepal", "China"], { add: ["Nepal"], remove: [] }), ["Nepal", "China"]);
});

test("removing a shared claimant takes it out of every list and nothing else", () => {
  const lists = [["India", "China"], ["India"], ["Pakistan", "India"]];
  const { shown } = commonClaimants(lists);
  const delta = claimantDelta(shown, []);
  assert.deepEqual(delta, { add: [], remove: ["India"] });
  assert.deepEqual(lists.map((list) => applyClaimantDelta(list, delta)), [["China"], [], ["Pakistan"]]);
});

test("keys are exact: a claimant differing only in case is a different claimant", () => {
  const delta = claimantDelta(["Russia"], ["Russia", "russia"]);
  assert.deepEqual(delta, { add: ["russia"], remove: [] });
  assert.deepEqual(applyClaimantDelta(["Russian Federation"], { remove: ["Russia"] }), ["Russian Federation"]);
});
