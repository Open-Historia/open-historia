/*! Open Historia — military feasibility doctrine tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/militaryFeasibility.test.js
//
// The reach and logistics rules ride along with any turn that has forces on
// the map or an order queued, whatever language the order is written in.

import assert from "node:assert/strict";
import test from "node:test";

import { buildMilitaryFeasibilityText } from "./militaryFeasibility.js";

const order = (description, extra = {}) => ({ id: `a-${description.length}`, kind: "action", title: description, description, status: "planned", ...extra });

test("an order in any language brings the doctrine along", () => {
  for (const text of [
    "Invade Belgium through the Ardennes",
    "Envahir la Belgique par les Ardennes",
    "Die Truppen nach Belgien verlegen",
    "Вторгнуться в Бельгию",
  ]) {
    assert.match(buildMilitaryFeasibilityText({ units: [] }, [order(text)]), /MILITARY FEASIBILITY/, text);
  }
});

test("units on the map bring it along even with no orders", () => {
  assert.match(buildMilitaryFeasibilityText({ units: [{ id: "u1" }] }, []), /^\nMILITARY FEASIBILITY/);
});

test("a turn with no units and no queued order does not pay for it", () => {
  assert.equal(buildMilitaryFeasibilityText({ units: [] }, []), "");
  assert.equal(buildMilitaryFeasibilityText({}, undefined), "");
  assert.equal(buildMilitaryFeasibilityText({ units: [] }, [order("Invade Belgium", { status: "resolved" })]), "", "a resolved order is history");
  assert.equal(buildMilitaryFeasibilityText({ units: [] }, [order("Write to Paris", { kind: "chat" })]), "", "a message is not an order to forces");
});
