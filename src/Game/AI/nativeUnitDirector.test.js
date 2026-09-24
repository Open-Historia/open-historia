/*! Open Historia — native unit director tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDirectorOrders } from "./nativeUnitDirector.js";

// Seen in a live game (2026-09-21): the jump moved the Falklands garrison to
// Mount Pleasant, the turn review's director moved it there again, placement
// set the second a few hundred metres clear of the first, and the event listed
// "Falklands Joint Ground & Air Defence Force moves to 116 (holding)" twice.
const garrison = {
  id: "unit-g", name: "Falklands Joint Ground & Air Defence Force", type: "infantry",
  ownerCode: "British Empire", strength: 100, lng: -59.5, lat: -51.7,
};
const event = {
  title: "British Empire Finalizes Garrison Deployment at Mount Pleasant",
  description: "Imperial troops completed deployment of the garrison at Mount Pleasant.",
  kind: "military",
  impacts: { unitOps: [{ op: "move", unitId: "unit-g", toLng: -58.86089, toLat: -51.57846, regionId: "116", posture: "holding" }] },
};

test("a second move for a unit the event already moves is dropped, wherever placement set it", () => {
  const { acceptedByEvent, diagnostics } = sanitizeDirectorOrders({
    events: [event],
    orders: [{ eventIndex: 0, unitOps: [{ op: "move", unitId: "unit-g", toLng: -58.8631, toLat: -51.5801, regionId: "116", posture: "holding" }] }],
    units: [garrison],
    game: {},
  });
  assert.equal(acceptedByEvent.get(0), undefined);
  assert.match(diagnostics.find((entry) => entry.action === "DROP")?.reason ?? "", /duplicate/);
});

test("a move for a unit the event does not move yet is kept", () => {
  const other = { ...garrison, id: "unit-f", name: "South Atlantic Task Group", type: "naval" };
  const { acceptedByEvent } = sanitizeDirectorOrders({
    events: [event],
    orders: [{ eventIndex: 0, unitOps: [{ op: "move", unitId: "unit-f", toLng: -58.29, toLat: -51.48, posture: "patrol" }] }],
    units: [garrison, other],
    game: {},
  });
  assert.equal(acceptedByEvent.get(0)?.length, 1);
});
