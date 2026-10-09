/*! Open Historia — GM Console preview: every operation tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/gmPreviewOps.test.js
//
// The invariant: every operation a GM transaction would apply is counted and
// listed before Apply — groups and institutions included, and any family the
// event normalizer learns later.

import test from "node:test";
import assert from "node:assert/strict";

import { EVENT_IMPACT_KEYS } from "../../runtime/gameState.js";
import { GM_PREVIEW_SECTIONED_IMPACTS, collectImpactOps, countImpactOps, otherImpactFamilies } from "./gmPreviewOps.js";

const events = [
  {
    title: "The cartel rises",
    impacts: {
      groupOps: [{ op: "create", name: "Sinaloa Cartel", regionIds: ["MEX.25_1"] }],
      regionControlOps: [{ op: "control", regionId: "MEX.25_1", fromCode: "Mexico", toCode: "Rebels" }],
    },
  },
  {
    title: "A pact",
    impacts: {
      institutionLifecycleOps: [{ op: "found", name: "Northern Pact", actorPolity: "Norway" }],
      regionTransfers: [{ regionId: "SWE.1_1", toCode: "Norway" }],
      spyOps: [{ op: "plant", target: "Sweden" }],
    },
  },
];

test("groups and institutions are counted, and control ops count as territory", () => {
  const counts = countImpactOps(events);
  assert.equal(counts.groups, 1);
  assert.equal(counts.institutions, 1);
  assert.equal(counts.territory, 2);
  assert.equal(counts.other, 1);
});

test("each operation is tagged with the event that carries it", () => {
  const [op] = collectImpactOps(events, "institutionLifecycleOps");
  assert.equal(op.name, "Northern Pact");
  assert.equal(op._eventIndex, 1);
  assert.equal(op._eventTitle, "A pact");
});

test("a family without a section of its own is listed as another operation", () => {
  const other = otherImpactFamilies(events);
  assert.deepEqual(other.map((family) => family.field), ["spyOps"]);
  assert.equal(other[0].ops[0].target, "Sweden");
});

test("no impact family the normalizer knows can go unshown", () => {
  const shownSomewhere = new Set([...GM_PREVIEW_SECTIONED_IMPACTS, "actionIds"]);
  const unsectioned = EVENT_IMPACT_KEYS.filter((field) => !shownSomewhere.has(field));
  // Every one of them reaches "Other operations" when it carries something.
  const probe = [{ impacts: Object.fromEntries(unsectioned.map((field) => [field, [{ op: "probe" }]])) }];
  assert.deepEqual(otherImpactFamilies(probe).map((family) => family.field), unsectioned);
  for (const field of GM_PREVIEW_SECTIONED_IMPACTS) assert.ok(EVENT_IMPACT_KEYS.includes(field), field);
});
