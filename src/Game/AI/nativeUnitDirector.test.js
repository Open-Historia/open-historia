/*! Open Historia — native unit director tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RAISED_COMBATANTS, buildUnitDirectorInput, eventNeedsNativeUnitDirector, landHolders, missingCombatantSpawns, nativeCombatantSpawn, nearestOwnRegion, orderRaisesForces, pickCombatantPlace, pruneWarUnits, sanitizeDirectorOrders } from "./nativeUnitDirector.js";
import { normalizeUnitEntry } from "../../runtime/gameState.js";

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

test("a combatant with no unit at all is named to the director, so the war gets a counter", () => {
  const input = buildUnitDirectorInput({
    events: [{
      title: "Russian Forces Capture Melitopol and Advance Toward Mariupol",
      description: "Russian armoured columns advance from Crimea and capture Melitopol after heavy fighting with Ukrainian defenders.",
      kind: "military",
      combatants: ["Russia", "Ukraine"],
    }],
    world: { units: [{ id: "u-ukr", name: "Ukrainian 93rd Brigade", type: "infantry", ownerCode: "Ukraine", strength: 80, lng: 35.4, lat: 47.1 }] },
  });
  assert.deepEqual(input.candidates[0].combatantsWithoutUnits, ["Russia"]);
});

// Seen in a live check on that Game (2026-10-02): the events named only the
// player and Russia as combatants, and the review, told Russia had no unit,
// moved another unit instead. Both sides of the event's war count, and the
// engine raises the missing formation itself.
const warEvent = {
  title: "Russian Forces Capture Melitopol and Advance Toward Mariupol",
  description: "Russian armoured columns advance from Crimea and capture Melitopol after heavy fighting with Ukrainian defenders.",
  kind: "military",
  warId: "war-russia-ukraine-2022",
  combatants: ["British Empire", "Russia"],
};
const warWorld = {
  units: [{ id: "u-be", name: "Black Sea Vanguard Task Group", type: "naval", ownerCode: "British Empire", strength: 90, lng: 30.9, lat: 45.5 }],
  wars: [{ id: "war-russia-ukraine-2022", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] }],
};

test("both sides of the event's war count as its combatants", () => {
  const input = buildUnitDirectorInput({ events: [warEvent], world: warWorld });
  assert.deepEqual(input.candidates[0].combatantsWithoutUnits, ["Russia", "Ukraine"]);
  const ended = buildUnitDirectorInput({ events: [warEvent], world: { ...warWorld, wars: [{ ...warWorld.wars[0], status: "ended" }] } });
  assert.deepEqual(ended.candidates[0].combatantsWithoutUnits, ["Russia"]);
});

test("a warring power the director left without a spawn is raised by the engine, once", () => {
  const input = buildUnitDirectorInput({ events: [warEvent, { ...warEvent, title: "Second clash" }], world: warWorld });
  const answer = { eventOrders: [{ eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "Russian 58th Army", type: "infantry", ownerCode: "Russia" }, at: "Kherson, Ukraine" }] }] };
  const missing = missingCombatantSpawns(input, answer);
  assert.deepEqual(missing.map(({ power }) => power), ["Ukraine"]);
  assert.deepEqual(missing[0].events.map(({ eventIndex }) => eventIndex), [0, 1], "every event naming it, to find a place in");
  assert.deepEqual(missingCombatantSpawns(input, { eventOrders: [] }).map(({ power }) => power), ["Russia", "Ukraine"]);
});

test("the raised formation goes where the event puts the power's forces", () => {
  const places = [
    { place: "Kherson", regionId: "318", controller: "Russia", lawfulOwner: "Ukraine" },
    { place: "Mykolaiv", regionId: "300", controller: "Ukraine" },
    { place: "Atlantis", region: "not on this map" },
  ];
  assert.deepEqual(pickCombatantPlace("Russia", places), { at: "Kherson" });
  assert.deepEqual(pickCombatantPlace("Ukraine", places), { at: "Mykolaiv" }, "a place the power holds, never one it only claims");
  assert.deepEqual(pickCombatantPlace("Moldova", places), { anchorRegionId: "318" }, "holding none: where the fighting is, to find its own land near");
  assert.equal(pickCombatantPlace("Russia", [{ place: "Atlantis", region: "not on this map" }]), null);
  const spawn = nativeCombatantSpawn("Ukraine", "Mykolaiv");
  assert.equal(spawn.op, "spawn");
  assert.equal(spawn.at, "Mykolaiv");
  assert.equal(spawn.unit.ownerCode, "Ukraine");
});

test("the engine's own spawn passes the director's rules: a power with no unit may be raised", () => {
  const events = [{ ...warEvent, impacts: { unitOps: [] } }];
  const spawn = { ...nativeCombatantSpawn("Ukraine", "Mykolaiv"), unit: { ...nativeCombatantSpawn("Ukraine", "Mykolaiv").unit, lng: 32, lat: 47 } };
  const { acceptedByEvent } = sanitizeDirectorOrders({ events, orders: [{ eventIndex: 0, unitOps: [spawn] }], units: warWorld.units, game: {} });
  assert.equal(acceptedByEvent.get(0)?.length, 1);
});

// Seen in a live check (2026-10-02): with no place it held named, Russia's
// raised army was put in Kyiv, which reads as Russia having taken it.
test("a power that holds none of the named places is raised on its own side, nearest the fighting", () => {
  const rows = [
    { id: "kyiv", name: "Kyiv", owner: "Ukraine", centroid: [30.5, 50.45] },
    { id: "moscow", name: "Moscow", owner: "Russia", centroid: [37.6, 55.75] },
    { id: "belgorod", name: "Belgorod", owner: "Russia", centroid: [36.6, 50.6] },
    { id: "bryansk", name: "Bryansk", owner: "Russia", centroid: [34.4, 53.25] },
  ];
  assert.equal(nearestOwnRegion({ power: "Russia", anchor: [30.5, 50.45], rows }), "Bryansk", "about 400 km from Kyiv, against 430 for Belgorod and 750 for Moscow");
  assert.equal(nearestOwnRegion({ power: "Moldova", anchor: [30.5, 50.45], rows }), null);
  assert.equal(nearestOwnRegion({ power: "Russia", anchor: undefined, rows }), null);
});

test("the engine raises at most a couple of formations a skip, the wars' leading powers first", () => {
  const world = {
    units: [],
    wars: [{ id: "war-big", status: "active", sideA: ["Russia", "Belarus", "Chechnya"], sideB: ["Ukraine", "Moldova"] }],
  };
  const input = buildUnitDirectorInput({ events: [{ ...warEvent, warId: "war-big", combatants: ["Belarus", "Moldova"] }], world });
  assert.deepEqual(input.candidates[0].combatantsWithoutUnits.slice(0, 2), ["Russia", "Ukraine"], "principals first");
  const raised = missingCombatantSpawns(input, { eventOrders: [] }).map(({ power }) => power);
  assert.equal(raised.length, MAX_RAISED_COMBATANTS);
  assert.deepEqual(raised, ["Russia", "Ukraine"]);
});

// Seen in a live check (2026-10-02): a month of fighting in Ukraine written as
// "world" events bound to no war and naming no combatants, so no counter came.
test("an unbound military event is read as the active war whose powers it names", () => {
  const unbound = {
    title: "Ukrainian Forces Advance Along Frontlines Following Allied Strike Operations",
    description: "Ukrainian mechanized brigades advance against Russian positions near Kherson after heavy fighting.",
    kind: "world",
  };
  const world = { units: [], wars: [{ id: "war-ru-ua", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] }, { id: "war-uk-sy", status: "active", sideA: ["United Kingdom"], sideB: ["Syria"] }] };
  assert.deepEqual(buildUnitDirectorInput({ events: [unbound], world }).candidates[0].combatantsWithoutUnits, ["Russia", "Ukraine"]);
  // Bound to a war, it is that war, whatever it names.
  assert.deepEqual(buildUnitDirectorInput({ events: [{ ...unbound, warId: "war-uk-sy" }], world }).candidates[0].combatantsWithoutUnits, ["United Kingdom", "Syria"]);
  // Naming no warring power, it is no war.
  const elsewhere = { ...unbound, title: "Mechanized Brigades Advance in a Border Clash", description: "Brigades advance after heavy fighting." };
  assert.equal(buildUnitDirectorInput({ events: [elsewhere], world }).candidates[0].combatantsWithoutUnits, undefined);
});

// Mark asked (2026-10-02): if you win the war, do the units disappear? They did
// not: a unit left the map only when an event destroyed or disbanded it.
test("a counter the engine raises remembers its war, and keeps it through a save", () => {
  const world = { units: [], wars: [{ id: "war-ru-ua", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] }] };
  const input = buildUnitDirectorInput({ events: [{ ...warEvent, warId: "war-ru-ua" }], world });
  assert.equal(input.candidates[0].warId, "war-ru-ua");
  const [missing] = missingCombatantSpawns(input, { eventOrders: [] });
  assert.equal(missing.warId, "war-ru-ua");
  const spawn = nativeCombatantSpawn(missing.power, "Kerch", missing.warId);
  assert.equal(spawn.unit.raisedForWar, "war-ru-ua");
  assert.equal(normalizeUnitEntry({ ...spawn.unit, lng: 36.5, lat: 45.3 }).raisedForWar, "war-ru-ua");
  assert.equal(normalizeUnitEntry({ name: "1st Army", ownerCode: "Russia", lng: 36.5, lat: 45.3 }).raisedForWar, undefined, "no other unit carries it");
});

test("when a war ends its raised counters are disbanded; a ceasefire keeps them", () => {
  const units = [
    { id: "ru", name: "Russia Field Army", ownerCode: "Russia", raisedForWar: "war-ru-ua" },
    { id: "ua", name: "Ukraine Field Army", ownerCode: "Ukraine", raisedForWar: "war-ru-ua" },
    { id: "bsv", name: "Black Sea Vanguard", ownerCode: "British Empire" },
    { id: "ru-built", name: "58th Combined Arms Army", ownerCode: "Russia" },
  ];
  const orders = [{ id: "o1", unitId: "ru" }, { id: "o2", unitId: "bsv" }];
  const held = new Set(["russia", "ukraine", "british empire"]);
  const ended = pruneWarUnits({ units, orders, wars: [{ id: "war-ru-ua", status: "ended" }], heldBefore: held, heldAfter: held });
  assert.deepEqual(ended.units.map((unit) => unit.id), ["bsv", "ru-built"], "the war's own formations go; ones built otherwise stay");
  assert.deepEqual(ended.orders.map((order) => order.id), ["o2"], "and their standing orders with them");
  assert.deepEqual(ended.removed.map(({ reason }) => reason), ["war-ended", "war-ended"]);
  const ceasefire = pruneWarUnits({ units, orders, wars: [{ id: "war-ru-ua", status: "ceasefire" }], heldBefore: held, heldAfter: held });
  assert.equal(ceasefire.units.length, 4);
});

test("a country that loses all its land loses its units; one that never held land keeps them", () => {
  const before = { regionOwnershipOverrides: { r1: "Ukraine", r2: "Russia" } };
  const after = { regionOwnershipOverrides: { r1: "Russia", r2: "Russia" } };
  const units = [
    { id: "ua", name: "Ukraine Field Army", ownerCode: "Ukraine" },
    { id: "ua-2", name: "93rd Brigade", ownerCode: "Ukraine" },
    { id: "ru", name: "1st Guards", ownerCode: "Russia" },
    { id: "host", name: "Mance Rayder's Host", ownerCode: "Mance Rayder's Host" },
  ];
  const pruned = pruneWarUnits({ units, wars: [], heldBefore: landHolders(before), heldAfter: landHolders(after) });
  assert.deepEqual(pruned.units.map((unit) => unit.id), ["ru", "host"]);
  assert.deepEqual(pruned.removed.map(({ reason }) => reason), ["lost-all-land", "lost-all-land"]);
  // An occupied homeland is still a homeland: lawful sovereignty counts as holding land.
  const occupied = { ...after, regionSovereigntyOverrides: { r1: "Ukraine" } };
  assert.equal(pruneWarUnits({ units, wars: [], heldBefore: landHolders(before), heldAfter: landHolders(occupied) }).removed.length, 0);
});

test("every turn clears the map after its wars and borders are applied, before anything is written", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const apply = source.slice(source.indexOf("const applySimulationResult = async"));
  const prune = apply.indexOf("const pruned = pruneWarUnits({");
  assert.ok(prune > 0);
  assert.ok(prune > apply.indexOf("worldWithImpacts = storylineMerge.world;"), "after the wars and storylines");
  assert.ok(prune < apply.indexOf("await writeCanonicalTurnState("), "before the write");
  assert.match(apply, /heldBefore: landHolders\(baseWorld\),\s+heldAfter: landHolders\(worldWithImpacts\),/);
});
