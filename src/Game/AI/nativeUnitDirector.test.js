/*! Open Historia — native unit director tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { eventNeedsNativeUnitDirector, orderRaisesForces, sanitizeDirectorOrders } from "./nativeUnitDirector.js";

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

// Seen in a harness run (2026-09-27) on a player's Burkina Faso Game: the unit
// director asked to raise "1st Dori VDP Rapid-Reaction Battalion" and the rule
// threw it away, because the new-formation cue only knew armies down to
// regiments and only with nothing between "new" and the noun.
const burkinaUnit = {
  id: "unit-bf", name: "Burkinabe Army Northern Group", type: "infantry",
  ownerCode: "Burkina Faso", strength: 100, lng: -1.5, lat: 12.4,
};
const raising = (title, description = "") => sanitizeDirectorOrders({
  events: [{ title, description, kind: "military", impacts: {} }],
  orders: [{ eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "New formation", type: "infantry", ownerCode: "Burkina Faso", strength: 100, lng: -0.05, lat: 14.03 } }] }],
  units: [burkinaUnit],
  game: {},
});

test("a new formation is raised whatever its size, with words between 'new' and the noun", () => {
  for (const title of [
    "Burkina Faso Activates New VDP Rapid-Reaction Battalion at Dori",
    "Burkinabe Forces Raise a New Rapid-Reaction Battalion and Deploy It to Dori",
    "Army Forms a Mechanized Company to Guard the Northern Road",
    "Government Raises a Volunteer Militia in Soum Province",
    "Ouagadougou Stands Up a New Joint Border Force",
  ]) {
    const { acceptedByEvent, diagnostics } = raising(title);
    assert.equal(acceptedByEvent.get(0)?.length, 1, `${title}: ${JSON.stringify(diagnostics)}`);
  }
});

test("a formation that already exists fighting again is still not a new one", () => {
  const { acceptedByEvent, diagnostics } = raising(
    "Burkinabe Battalion Holds Its Positions Near Dori",
    "The battalion repelled an attack on the northern road.",
  );
  assert.equal(acceptedByEvent.get(0), undefined);
  assert.match(diagnostics[0]?.reason ?? "", /no explicit new-formation cue/);
});

test("an event that raises a new formation is one the director is asked about", () => {
  assert.equal(eventNeedsNativeUnitDirector({ title: "Burkina Faso Activates New VDP Rapid-Reaction Battalion at Dori" }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "Government Raises a Volunteer Militia in Soum Province" }), true);
});

// Seen in a player's Game (2026-09-29): an order to place a garrison became
// "British Army Deploys New Strategic Garrison to <town>", and the director
// marched the one armoured division there instead. A garrison placed at a named
// spot is a new fixed formation, not a move of one that exists.
const britishDivision = {
  id: "unit-uk", name: "1st British Assault Division", type: "armor",
  ownerCode: "British Empire", strength: 80, lng: -4.25, lat: 55.86,
};
const garrisoning = (title, description = "") => sanitizeDirectorOrders({
  events: [{ title, description, kind: "player", impacts: {} }],
  orders: [{ eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "Stranraer Garrison", type: "garrison", ownerCode: "British Empire", strength: 100, lng: -5.03, lat: 54.9 } }] }],
  units: [britishDivision],
  game: {},
});

test("a garrison placed, stationed or established at a named place is a new formation", () => {
  assert.equal(orderRaisesForces("Place a garrison in Stranraer"), true);
  assert.equal(orderRaisesForces("Station a garrison at Ayr"), true);
  for (const [title, description] of [
    ["British Army Deploys New Strategic Garrison to Stranraer", ""],
    ["British Army Establishes a Garrison at Stranraer", "The British Army executes an operational deployment to establish a permanent military garrison in Stranraer."],
    ["Britain Places a Garrison in Stranraer", ""],
  ]) {
    assert.equal(eventNeedsNativeUnitDirector({ title, description }), true, title);
    const { acceptedByEvent, diagnostics } = garrisoning(title, description);
    assert.equal(acceptedByEvent.get(0)?.length, 1, `${title}: ${JSON.stringify(diagnostics)}`);
  }
});

test("an existing garrison holding or reinforced is not a new one", () => {
  const { acceptedByEvent } = garrisoning("Stranraer Garrison Holds Firm", "The garrison repelled a probe at dawn.");
  assert.equal(acceptedByEvent.get(0), undefined);
  assert.equal(orderRaisesForces("Place sanctions on Russia"), false);
});

test("money or votes raised for an army are not a new formation", () => {
  assert.equal(eventNeedsNativeUnitDirector({ title: "Parliament Raises Funds for the Army" }), false);
  const { acceptedByEvent } = raising("Parliament Raises Funds for the Army", "The defence budget grows for the troops.");
  assert.equal(acceptedByEvent.get(0), undefined);
});
