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

// Which events the director reads, and which of its operations it keeps, is
// decided by what an event CARRIES: unit operations, the Military tag or the
// engine's kind "military", a warId, combatants, or a player's order it carries
// out. Never by its words: the English word lists that stood here passed
// English events and no others (the owner, 2026-11-13: no keywording anywhere).
// Seen in a harness run (2026-09-27) on a player's Burkina Faso Game: the unit
// director asked to raise "1st Dori VDP Rapid-Reaction Battalion" and a word
// rule threw it away. The director's spawn is now taken as the new formation it
// says it is, on any event it was asked about.
const burkinaUnit = {
  id: "unit-bf", name: "Burkinabe Army Northern Group", type: "infantry",
  ownerCode: "Burkina Faso", strength: 100, lng: -1.5, lat: 12.4,
};
const raising = (event) => sanitizeDirectorOrders({
  events: [{ impacts: {}, ...event }],
  orders: [{ eventIndex: 0, unitOps: [{ op: "spawn", unit: { name: "1st Dori VDP Rapid-Reaction Battalion", type: "infantry", ownerCode: "Burkina Faso", strength: 100, lng: -0.05, lat: 14.03 } }] }],
  units: [burkinaUnit],
  game: {},
});

test("a spawn on an event the director reads is kept, whatever the event's words, in any language", () => {
  for (const event of [
    { title: "Burkina Faso Activates New VDP Rapid-Reaction Battalion at Dori", tags: ["Military"] },
    { title: "Le Burkina Faso active un nouveau bataillon d'intervention rapide à Dori", tags: ["Military"] },
    { title: "Burkinabe Battalion Holds Its Positions Near Dori", kind: "military" },
    { title: "Буркина-Фасо формирует новый батальон в Дори", warId: "war-sahel" },
    { title: "Ouagadougou bouge", combatants: ["Burkina Faso", "JNIM"] },
    { title: "The order is carried out", impacts: { actionIds: ["order-7"] } },
  ]) {
    const { acceptedByEvent, diagnostics } = raising(event);
    assert.equal(acceptedByEvent.get(0)?.length, 1, `${event.title}: ${JSON.stringify(diagnostics)}`);
  }
});

test("an event that carries nothing military takes no operation, in English as in French", () => {
  for (const title of ["Burkina Faso Activates New VDP Rapid-Reaction Battalion at Dori", "Le Burkina Faso active un nouveau bataillon à Dori"]) {
    const { acceptedByEvent, diagnostics } = raising({ title, kind: "world", tags: ["Politics"] });
    assert.equal(acceptedByEvent.get(0), undefined, title);
    assert.match(diagnostics[0]?.reason ?? "", /carries no unit operations, Military tag, war, combatants or player's order/, title);
  }
});

test("a strength change and a removal are taken as the director wrote them, with no casualty words asked of the event", () => {
  const unit = { id: "unit-1", name: "1st Army", type: "infantry", ownerCode: "Aland", strength: 90, lng: 10, lat: 50 };
  for (const description of ["The army held the line.", "L'armée a tenu la ligne.", ""]) {
    const { acceptedByEvent, diagnostics } = sanitizeDirectorOrders({
      events: [{ title: "Front", description, tags: ["Military"], impacts: {} }],
      orders: [{ eventIndex: 0, unitOps: [{ op: "strength", unitId: "unit-1", strength: 60 }, { op: "remove", unitId: "unit-1" }] }],
      units: [unit],
      game: {},
    });
    assert.deepEqual(acceptedByEvent.get(0)?.map((op) => op.op), ["strength", "remove"], `${description}: ${JSON.stringify(diagnostics)}`);
  }
  // What the op itself does not support is still refused: a unit that does not exist, an attack.
  const { diagnostics } = sanitizeDirectorOrders({
    events: [{ title: "Front", tags: ["Military"], impacts: {} }],
    orders: [{ eventIndex: 0, unitOps: [{ op: "strength", unitId: "nobody", strength: 10 }, { op: "attack", unitId: "unit-1", targetUnitId: "x" }] }],
    units: [unit],
    game: {},
  });
  assert.deepEqual(diagnostics.map((entry) => entry.action), ["DROP", "DROP"]);
});

test("the events the director is asked about are those carrying unit ops, the Military tag, a war, combatants or a player's order", () => {
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", tags: ["Military"] }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", tags: ["military", "Politics"] }), true, "the tag's case aside");
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", kind: "Military" }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", warId: "war-1" }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", combatants: ["Aland"] }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", impacts: { actionIds: ["a-1"] } }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", impacts: { unitOps: [{ op: "move", unitId: "u" }] } }), true);
  assert.equal(eventNeedsNativeUnitDirector({ title: "x", kind: "world", tags: ["Economy"], warId: " ", combatants: [""], impacts: { actionIds: [] } }), false);
  assert.equal(eventNeedsNativeUnitDirector(null), false);
});

// Seen in a player's Game (2026-09-29): an order to place a garrison became
// "British Army Deploys New Strategic Garrison to <town>". The event that
// carries out a player's order is the director's to read whatever the order or
// the event says: by the order it cites, and never by the order's words.
test("an event carrying out a player's order reaches the director by its citation, never by the order's words", () => {
  for (const text of ["Place a garrison in Stranraer", "Station a garrison at Ayr", "Installer une garnison à Stranraer", "Place sanctions on Russia"]) {
    assert.equal(orderRaisesForces(text), false, text);
  }
  for (const title of ["British Army Deploys New Strategic Garrison to Stranraer", "L'armée britannique installe une garnison à Stranraer"]) {
    assert.equal(eventNeedsNativeUnitDirector({ title, kind: "player", impacts: { actionIds: ["order-1"] } }), true, title);
    assert.equal(eventNeedsNativeUnitDirector({ title, kind: "player", impacts: {} }), false, title);
  }
});

test("words alone, in any language, never wake the director", () => {
  for (const title of [
    "Parliament Raises Funds for the Army",
    "Government Raises a Volunteer Militia in Soum Province",
    "Le gouvernement lève une milice de volontaires",
    "Khal Drogo's Khalasar Rides On West Along the Velvet Road",
    "Brazil hosts a trade summit and reaches a deal on tariffs",
  ]) {
    assert.equal(eventNeedsNativeUnitDirector({ title, kind: "world" }), false, title);
    assert.equal(buildUnitDirectorInput({ events: [{ title, kind: "world", impacts: {} }], world: {} }), null, title);
  }
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
// "world" events bound to no war. The war an event is about is the one it is
// bound to, and who fought is its combatants: a war is never guessed from the
// powers its words mention (an English stem, "Russian" for Russia, did that).
test("an unbound event is about no war, whatever powers its words mention; its combatants still count", () => {
  const unbound = {
    title: "Ukrainian Forces Advance Along Frontlines Following Allied Strike Operations",
    description: "Ukrainian mechanized brigades advance against Russian positions near Kherson after heavy fighting.",
    kind: "world",
    tags: ["Military"],
  };
  const twin = {
    title: "Українські сили просуваються вздовж лінії фронту",
    description: "Українські механізовані бригади наступають на російські позиції біля Херсона.",
    kind: "world",
    tags: ["Military"],
  };
  const world = { units: [], wars: [{ id: "war-ru-ua", status: "active", sideA: ["Russia"], sideB: ["Ukraine"] }, { id: "war-uk-sy", status: "active", sideA: ["United Kingdom"], sideB: ["Syria"] }] };
  for (const event of [unbound, twin]) {
    assert.equal(buildUnitDirectorInput({ events: [event], world }).candidates[0].combatantsWithoutUnits, undefined, event.title);
    assert.deepEqual(buildUnitDirectorInput({ events: [{ ...event, combatants: ["Ukraine", "Russia"] }], world }).candidates[0].combatantsWithoutUnits, ["Ukraine", "Russia"], event.title);
    // Bound to a war, it is that war, whatever it names.
    assert.deepEqual(buildUnitDirectorInput({ events: [{ ...event, warId: "war-uk-sy" }], world }).candidates[0].combatantsWithoutUnits, ["United Kingdom", "Syria"], event.title);
  }
});

test("the units shown first are those of the powers the events say are fighting, never those their words mention", () => {
  const units = [
    { id: "u-sy", name: "Syrian 4th Division", type: "infantry", ownerCode: "Syria", strength: 90, lng: 36.3, lat: 33.5 },
    { id: "u-ru", name: "1st Guards Tank Army", type: "armor", ownerCode: "Russia", strength: 90, lng: 37.6, lat: 55.7 },
  ];
  const event = { title: "The 1st Guards Tank Army and the Syrian 4th Division are named here", tags: ["Military"], combatants: ["Russia"], impacts: {} };
  const input = buildUnitDirectorInput({ events: [event], world: { units } });
  assert.deepEqual(input.units.map((unit) => unit.id), ["u-ru", "u-sy"]);
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

// A Game of Thrones campaign (298 AC): 98 events moved a host, a khalasar or a
// ship, and only 25 moved a counter. The director only looked at events in a
// modern army's words, so "the khalasar rides west" never reached it. It now
// reads the event's Military tag, in whatever words the event is told.
const gotEvent = (title, description = "", extra = {}) => ({ title, description, kind: "world", impacts: {}, ...extra });

test("fantasy and historical movement reaches the unit director by its tag, in any language", () => {
  const moving = [
    "Khal Drogo's Khalasar Rides On West Along the Velvet Road With Daenerys at His Side",
    "Mance Rayder's Host Breaks Camp at the Fist of the First Men and Turns West Along the Milkwater",
    "Le khalasar de Khal Drogo chevauche vers l'ouest sur la route de Velours",
    "Ост Манса Налетчика снимается с лагеря у Кулака Первых Людей",
  ];
  for (const title of moving) {
    assert.ok(buildUnitDirectorInput({ events: [gotEvent(title, "", { tags: ["Military"] })], world: {} }), title);
    assert.equal(buildUnitDirectorInput({ events: [gotEvent(title)], world: {} }), null, `${title}: untagged, it is no military event`);
  }
});

test("a story ship leaves the map once its ten rounds are up", () => {
  const ship = { id: "ship-1", name: "Lantern Grace", ownerCode: "House Stark", storyVessel: true, expiresRound: 43 };
  const kept = pruneWarUnits({ units: [ship], round: 43 });
  assert.equal(kept.units.length, 1);
  const gone = pruneWarUnits({ units: [ship], orders: [{ unitId: "ship-1" }], round: 44 });
  assert.deepEqual(gone.units, []);
  assert.deepEqual(gone.orders, []);
  assert.equal(gone.removed[0].reason, "voyage-ended");
});

// The player's story ship (the Lantern Grace, a cog with a stolen dragon egg) is
// the director's to judge, from an event of the player's own it reads: the
// candidate says it is the player's (playerRelated), and the director decides
// whether a ship of the player's sets sail in it. No list of words for ships
// and sailing is read, in English or any other language.
test("a player's own event is shown to the director as the player's, where a story ship may sail", () => {
  const sailing = {
    title: "Lantern Grace Sails From Pentos With the Stolen Dragon Egg Before Noon",
    description: "The cog Lantern Grace cleared the outer quay at Pentos with the sealed chest aboard and set her course for White Harbor.",
    kind: "player",
    playerRelated: true,
    tags: ["Military"],
    impacts: {},
  };
  const twin = { ...sailing, title: "Le Lantern Grace quitte Pentos avec l'œuf de dragon volé", description: "La cogue a quitté le quai extérieur de Pentos." };
  for (const event of [sailing, twin]) {
    const input = buildUnitDirectorInput({ events: [event], world: {} });
    assert.equal(input.candidates[0].playerRelated, true, event.title);
    assert.equal(buildUnitDirectorInput({ events: [{ ...event, playerRelated: false }], world: {} }).candidates[0].playerRelated, undefined);
    assert.equal(buildUnitDirectorInput({ events: [{ ...event, tags: ["Culture"] }], world: {} }), null, "untagged and carrying nothing military, it is not read");
  }
});

// The army of the dead grows with every kill (the scenario's rule), but the
// wight counters stayed at 40 and 96 while events said the host passed two
// hundred: a host growing was not something the director was shown. An event
// of fighting carries the Military tag and its combatants, and is shown.
test("a host that grows in a fight reaches the unit director by what the event carries", () => {
  for (const title of [
    "The Dead Overrun Frozen Shore Riders on the Hardhome Headland and the Fallen Rise to Join Them",
    "Les morts submergent les cavaliers de la Côte gelée et les tombés se relèvent pour les rejoindre",
  ]) {
    assert.ok(buildUnitDirectorInput({ events: [gotEvent(title, "", { combatants: ["The Dead", "Free Folk"] })], world: {} }), title);
    assert.ok(buildUnitDirectorInput({ events: [gotEvent(title, "", { tags: ["Military"] })], world: {} }), title);
  }
});

// ---------------------------------------------------------------------------
// Wiring: gameplay.js does not load under bare node, so its part is checked in
// its source.
// ---------------------------------------------------------------------------

test("a Scene's record carries its tags, which its map check reads; the skip's function does not grow", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const record = gameplay.slice(gameplay.indexOf("const sceneRecordFrom = (payload) =>"), gameplay.indexOf("const resolveInteractiveScene = async"));
  assert.match(record, /tags: normalizeArray\(payload\?\.recordTags\)/);
  const scene = gameplay.slice(gameplay.indexOf("const resolveInteractiveScene = async"), gameplay.indexOf("const sceneMapConsequences = async"));
  assert.match(scene, /tags: normalizeArray\(summaryPayload\?\.tags\),/);
  const { INTERACTIVE_EXECUTOR_SCHEMA, INTERACTIVE_SUMMARY_SCHEMA } = await import("./gameplaySchemas.js");
  // Optional, and after every field the record already had (only the Scene's
  // map flag, recordMapChanged, comes after it).
  const executorKeys = Object.keys(INTERACTIVE_EXECUTOR_SCHEMA.properties);
  assert.ok(executorKeys.indexOf("recordTags") > executorKeys.indexOf("recordImportance"));
  assert.equal(INTERACTIVE_EXECUTOR_SCHEMA.required.includes("recordTags"), false);
  assert.deepEqual(INTERACTIVE_EXECUTOR_SCHEMA.properties.recordTags.items.enum, ["Military", "Diplomacy", "Economy", "Politics", "Culture", "Disaster"]);
  const summaryKeys = Object.keys(INTERACTIVE_SUMMARY_SCHEMA.properties);
  assert.ok(summaryKeys.indexOf("tags") > summaryKeys.indexOf("regionTransfers"));
  assert.equal(INTERACTIVE_SUMMARY_SCHEMA.required.includes("tags"), false);
});

test("a missing combatant is raised at a place the event's places field names, never one its words mention", async () => {
  const { readFileSync } = await import("node:fs");
  const gameplay = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const raise = gameplay.slice(gameplay.indexOf("const combatantPlacesOf = "), gameplay.indexOf("// The director's orders may say where in words too."));
  assert.match(raise, /eventPlacesOnMap\(event, gazetteer/);
  assert.match(raise, /pickCombatantPlace\(power, combatantPlacesOf\(normalizeArray\(events\)\[eventIndex\], gazetteer, bundle\?\.world\)\)/);
  assert.equal(/placesNamedIn|description|title/.test(raise.replace(/\/\/[^\n]*/g, "")), false, "no text is read");
  assert.match(gameplay, /await raiseMissingCombatants\(answer, input, bundle, events\);/);
  // The director is told which candidates are the player's own, where a story ship may sail.
  assert.match(gameplay, /A candidate marked playerRelated is the player's own story/);
});
