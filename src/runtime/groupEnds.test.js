/*! Open Historia — a group ends through one door: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/groupEnds.test.js
//
// "So I won the Cartel War (Group vs Group) as CJNG against Sinaloa, however
// Sinaloa can still be interacted with after death, their soldiers remain on
// the map, even if I can't find them in the diplomatic chat" (a player,
// 2026-11-26). A group's end deleted its record and area and nothing else.
// Every way a group ends now goes through gameState.js dissolveGroup.

import test from "node:test";
import assert from "node:assert/strict";

import { applyEventImpactsToWorld, dissolveDefeatedGroups, dissolveGroup, dissolvePolity, normalizeWorldState, settleEndedGroups } from "./gameState.js";
import { applyGroupOps, chatWithEndedGroupsOnly, describeGroupsForPrompt, isGroupName, isLiveGroup } from "./groups.js";
import { readWarEndings, warsAwaitingOutcome } from "./warEndings.js";
import { pickableGroupsOf } from "../Game/GameUI/groupBanner.js";
import { frontWorldReaders } from "../Game/AI/frontTurn.js";

const PLAYER = "CJNG";
const SINALOA = "Sinaloa Cartel";

// The player leads CJNG (a group and a landless polity, as "Play as a group"
// makes it); Sinaloa is an AI group. Their war is group against group.
const world = (extra = {}) => normalizeWorldState({
  polityOverrides: {
    [PLAYER]: { name: PLAYER, aliases: [], color: "#e11d48", note: "Jalisco New Generation Cartel." },
    Mexico: { name: "Mexico", aliases: [], color: "#15803d", note: "" },
  },
  regionOwnershipOverrides: { r1: "Mexico", r2: "Mexico", r3: "Mexico", r4: "Mexico" },
  groups: {
    [PLAYER]: { name: PLAYER, description: "Jalisco New Generation Cartel.", color: "#e11d48" },
    [SINALOA]: { name: SINALOA, description: "The Sinaloa cartel.", color: "#eab308" },
  },
  groupAreas: { r1: PLAYER, r2: SINALOA, r3: SINALOA },
  units: [
    { id: "u-cjng", name: "CJNG Sicarios", ownerCode: PLAYER, type: "infantry", lng: -103.3, lat: 20.6, strength: 100 },
    { id: "u-sin-1", name: "Los Chapitos", ownerCode: SINALOA, type: "infantry", lng: -107.4, lat: 24.8, strength: 100 },
    { id: "u-sin-2", name: "Gente Nueva", ownerCode: SINALOA, type: "infantry", lng: -106.4, lat: 23.2, strength: 100 },
  ],
  pendingUnitOrders: [{ id: "o1", unitId: "u-sin-1", toLng: -106, toLat: 24 }, { id: "o2", unitId: "u-cjng", toLng: -103, toLat: 21 }],
  markers: [{ id: "m1", name: "Culiacán safehouse", kind: "safehouse", ownerCode: SINALOA, lng: -107.39, lat: 24.8 }],
  wars: [{ id: "war-cartel", title: "Cartel War", status: "active", sideA: [PLAYER], sideB: [SINALOA], startDate: "2026-01-01" }],
  relations: [{ a: PLAYER, b: SINALOA, score: -90 }, { a: "Mexico", b: SINALOA, score: -60 }, { a: "Mexico", b: PLAYER, score: -70 }],
  agreements: [{ id: "ag1", title: "Sinaloa protection racket", type: "protection", status: "active", parties: ["Mexico", `group: ${SINALOA}`] }],
  peaceOffers: [{ id: "p1", warId: "war-cartel", from: SINALOA, to: PLAYER, status: "open", terms: {} }],
  spies: [{ id: "s1", owner: SINALOA, target: PLAYER, status: "active" }, { id: "s2", owner: PLAYER, target: SINALOA, status: "active" }],
  projects: [{ id: "pr1", name: "Narco sub", ownerCode: SINALOA, status: "active", progress: 20 }],
  ...extra,
});

const goneEverywhere = (next) => {
  assert.equal(next.groups[SINALOA], undefined, "no live record");
  assert.ok(next.defunctGroups[SINALOA], "kept for history");
  assert.equal(next.defunctGroups[SINALOA].description, "The Sinaloa cartel.");
  assert.ok(!Object.values(next.groupAreas).includes(SINALOA), "its area is gone");
  assert.deepEqual(next.units.map((unit) => unit.id), ["u-cjng"], "its soldiers leave the map");
  assert.ok(!next.pendingUnitOrders.some((order) => String(order.unitId).startsWith("u-sin")), "with their orders");
  assert.equal(next.markers[0].ownerCode, "", "its structure is nobody's");
  const war = next.wars.find((row) => row.id === "war-cartel");
  assert.equal(war.status, "ended", "its war ends");
  assert.deepEqual(war.sideB, [SINALOA], "the sides are kept, so the record says who fought");
  assert.ok(!next.relations.some((row) => row.a === SINALOA || row.b === SINALOA), "its relations go");
  assert.equal(next.agreements[0].status, "ended", "its deals end");
  assert.equal(next.peaceOffers[0].status, "lapsed");
  assert.deepEqual(next.spies.map((spy) => spy.status), ["recalled", "recalled"]);
  assert.equal(next.projects[0].status, "cancelled");
  assert.deepEqual(pickableGroupsOf(next, PLAYER).map((group) => group.name), [], "not in the Diplomacy picker");
  assert.doesNotMatch(describeGroupsForPrompt(next), /Sinaloa/, "never told to the AI as a group there is");
  assert.equal(isLiveGroup(next, SINALOA), false);
  assert.equal(isGroupName(next, SINALOA), true, "its name is still a group's, never a country's");
  assert.equal(frontWorldReaders(next).isGroup(SINALOA), true, "a front never founds a phantom polity under it");
  // The player's group stands, whole.
  assert.ok(next.groups[PLAYER]);
  assert.deepEqual(Object.entries(next.groupAreas), [["r1", PLAYER]]);
};

test("a time skip's groupOps dissolve ends a beaten group everywhere (group vs group)", () => {
  const { world: next } = applyEventImpactsToWorld({
    world: world(),
    round: 4,
    events: [{ id: "e-fall", date: "2026-06-01", title: "Sinaloa collapses", description: "The cartel is finished.", impacts: { groupOps: [{ op: "dissolve", name: SINALOA }] } }],
  });
  goneEverywhere(next);
  assert.equal(next.defunctGroups[SINALOA].dissolvedDate, "2026-06-01");
  assert.deepEqual(next.defunctGroups[SINALOA].sourceEventIds, ["e-fall"]);
});

test("a Game Master event and the cheats' Delete (admin events) go through the same door", () => {
  const { world: next } = applyEventImpactsToWorld({
    world: world(),
    events: [{ id: "gm-1", date: "2026-06-02", title: "[GM] Sinaloa removed", description: "", impacts: { groupOps: [{ op: "Dissolve", name: "sinaloa cartel" }] } }],
  });
  goneEverywhere(next);
});

test("a war ending that says the group was dissolved ends it; the player's group is never dissolved", () => {
  const ended = normalizeWorldState({ ...world(), wars: [{ ...world().wars[0], status: "ended", endedDate: "2026-06-01" }] });
  const asked = warsAwaitingOutcome(ended);
  assert.equal(asked.length, 1);
  const read = readWarEndings({ w1: { outcome: `${SINALOA} lost at the end; its government was dissolved` } }, asked);
  const settled = dissolveDefeatedGroups(ended, read, { date: "2026-06-01" });
  assert.deepEqual(settled.results, [{ name: SINALOA, ended: true }]);
  goneEverywhere({ ...settled.world, wars: settled.world.wars.map((war) => ({ ...war, sideB: war.sideB })) });
  assert.deepEqual(warsAwaitingOutcome(settled.world), [], "a war whose side has ended is not asked about again");

  const lostByPlayer = readWarEndings({ w1: { outcome: `${PLAYER} lost at the end; its government was dissolved` } }, asked);
  const refused = dissolveDefeatedGroups(ended, lostByPlayer, { date: "2026-06-01" });
  assert.deepEqual(refused.results, [{ name: PLAYER, ended: false }]);
  assert.ok(refused.world.groups[PLAYER]);
  assert.ok(refused.world.units.some((unit) => unit.ownerCode === PLAYER), "the player keeps its troops");
});

test("the player's group is refused on every path: groupOps, dissolvePolity, the door itself", () => {
  const base = world();
  assert.equal(dissolveGroup(base, PLAYER), "");
  assert.equal(dissolvePolity(base, PLAYER), false);
  const { world: next } = applyEventImpactsToWorld({ world: world(), events: [{ id: "e", date: "2026-06-01", title: "x", description: "", impacts: { groupOps: [{ op: "dissolve", name: PLAYER }] } }] });
  assert.ok(next.groups[PLAYER]);
  assert.equal(next.polityOverrides[PLAYER].status, undefined);
});

test("a polity dissolve that names a group ends the group through its door", () => {
  const base = world();
  assert.equal(dissolvePolity(base, SINALOA, { date: "2026-06-01" }), true);
  goneEverywhere(normalizeWorldState(base));
  assert.equal(base.polityOverrides[SINALOA], undefined, "no phantom polity record is made for it");
});

test("group against a country: the beaten group goes, the country stays; an heir takes its troops", () => {
  const base = world({ wars: [{ id: "war-state", title: "Culiacanazo", status: "active", sideA: ["Mexico"], sideB: [SINALOA] }] });
  const key = dissolveGroup(base, SINALOA, { date: "2026-07-01", heir: "Mexico" });
  assert.equal(key, SINALOA);
  assert.equal(base.wars[0].status, "ended");
  assert.deepEqual(base.units.filter((unit) => unit.ownerCode === "Mexico").map((unit) => unit.id), ["u-sin-1", "u-sin-2"]);
  assert.equal(base.markers[0].ownerCode, "Mexico");
  assert.ok(base.polityOverrides.Mexico);
});

test("an ended group is not raised by a stray take or update; a create brings it back with its record", () => {
  const { world: ended } = applyEventImpactsToWorld({ world: world(), events: [{ id: "e1", date: "2026-06-01", title: "x", description: "", impacts: { groupOps: [{ op: "dissolve", name: SINALOA }] } }] });
  const stray = applyGroupOps(ended, [{ op: "take", name: SINALOA, regionIds: ["r4"] }, { op: "update", name: SINALOA, description: "Back?" }]);
  assert.equal(stray.groups[SINALOA], undefined);
  assert.ok(stray.defunctGroups[SINALOA]);
  assert.deepEqual(stray.changes.map((change) => change.reason), ["dissolved", "dissolved"]);
  const back = applyGroupOps(ended, [{ op: "create", name: SINALOA, regionIds: ["r4"] }]);
  assert.equal(back.groups[SINALOA].description, "The Sinaloa cartel.", "its record comes back");
  assert.equal(back.defunctGroups[SINALOA], undefined);
  assert.deepEqual(back.changes.map((change) => change.op), ["restore", "take"]);
});

test("a thread with only an ended group is shown closed; one with a live party is not", () => {
  assert.equal(chatWithEndedGroupsOnly({ countries: [PLAYER, SINALOA] }, [SINALOA], PLAYER), true);
  assert.equal(chatWithEndedGroupsOnly({ countries: [PLAYER, SINALOA, "Mexico"] }, [SINALOA], PLAYER), false);
  assert.equal(chatWithEndedGroupsOnly({ countries: [PLAYER, "Mexico"] }, [], PLAYER), false);
});

test("a save from before the door: the group's record was deleted and its troops, war and relations stayed; the next turn clears them", () => {
  // What the old dissolve left: no record, no area, everything else.
  const old = world();
  delete old.groups[SINALOA];
  old.groupAreas = { r1: PLAYER };
  const events = [
    { id: "e0", date: "2026-02-01", title: "Sinaloa expands", impacts: { groupOps: [{ op: "take", name: SINALOA, regionIds: ["r2"] }] } },
    { id: "e1", date: "2026-06-01", title: "Sinaloa collapses", impacts: { groupOps: [{ op: "dissolve", name: SINALOA }] } },
  ];
  const repaired = normalizeWorldState(settleEndedGroups(old, events));
  assert.deepEqual(repaired.units.map((unit) => unit.id), ["u-cjng"]);
  assert.equal(repaired.wars[0].status, "ended");
  assert.ok(!repaired.relations.some((row) => row.a === SINALOA || row.b === SINALOA));
  assert.equal(repaired.defunctGroups[SINALOA].dissolvedDate, "2026-06-01");
  assert.equal(repaired.groups[SINALOA], undefined);
  // Once settled, nothing more to do; and a group created again after its dissolve is left alone.
  assert.equal(settleEndedGroups(repaired, events), repaired);
  const reborn = [...events, { id: "e2", date: "2026-08-01", title: "Sinaloa reborn", impacts: { groupOps: [{ op: "create", name: SINALOA }] } }];
  assert.equal(settleEndedGroups(old, reborn), old);
});
