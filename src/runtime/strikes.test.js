/*! Open Historia — strikes: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/strikes.test.js
//
// A strike is what the story wrote of a missile launch or a bombing run, kept
// for the map to play (strikes.js). These pin what one is, how long the world
// keeps it, and how its places are found.

import test from "node:test";
import assert from "node:assert/strict";

import { buildWorldGrid, distanceTo, kmBetween, seasOf } from "./fronts/worldGrid.js";
import { syntheticMap } from "./fronts/syntheticMap.js";
import {
  AIRCRAFT_WEAPONS,
  NUCLEAR_WEAPONS,
  SEA_LAUNCH_KM,
  STRIKES_KEPT_MOST,
  STRIKE_COUNT_MOST,
  STRIKE_ROUNDS_KEPT,
  STRIKE_WEAPONS,
  findStrikePlace,
  fliesAsAircraft,
  isNuclear,
  normalizeStrike,
  normalizeStrikes,
  parsePlace,
  pickStrikeOrigin,
  seaLaunchPlace,
  strikeBounds,
  strikesOfEvent,
  withTurnStrikes,
} from "./strikes.js";

const strike = (extra = {}) => ({ id: "strike:2024-03-01:0", eventId: "e1", date: "2024-02-20", owner: "Aland", weapon: "silo missile", count: 3, down: 1, from: { name: "structure: Silo North", lng: 21.5, lat: 51.25 }, to: { name: "city: Brod", lng: 30.5, lat: 51.5 }, ...extra });

test("the weapons a strike is made with: three are nuclear, two fly as aircraft", () => {
  assert.deepEqual([...STRIKE_WEAPONS], ["silo missile", "submarine missile", "missile strike", "nuclear bomber", "bombing run"]);
  assert.deepEqual(STRIKE_WEAPONS.filter(isNuclear), [...NUCLEAR_WEAPONS]);
  assert.deepEqual([...NUCLEAR_WEAPONS], ["silo missile", "submarine missile", "nuclear bomber"]);
  assert.deepEqual(STRIKE_WEAPONS.filter(fliesAsAircraft), [...AIRCRAFT_WEAPONS]);
  assert.deepEqual([...AIRCRAFT_WEAPONS], ["nuclear bomber", "bombing run"]);
});

test("a strike is kept as what it is: who, with what, how many, how many shot down, and its two places", () => {
  assert.deepEqual(normalizeStrike(strike()), {
    id: "strike:2024-03-01:0",
    eventId: "e1",
    date: "2024-02-20",
    round: 0,
    owner: "Aland",
    weapon: "silo missile",
    count: 3,
    down: 1,
    from: { name: "structure: Silo North", lng: 21.5, lat: 51.25 },
    to: { name: "city: Brod", lng: 30.5, lat: 51.5 },
  });
  // A place the turn could not find is kept by its name alone.
  assert.deepEqual(normalizeStrike(strike({ to: { name: "city: Nowhere" } })).to, { name: "city: Nowhere", lng: null, lat: null });
  assert.equal(normalizeStrike(strike({ from: null })).from, null);
  // (An empty value is not the equator.)
  assert.deepEqual(normalizeStrike(strike({ to: { name: "city: Brod", lng: null, lat: "" } })).to, { name: "city: Brod", lng: null, lat: null });
  // No more shot down than there were, at least one of them, and no more than a strike is ever said to be of.
  assert.equal(normalizeStrike(strike({ count: 4, down: 9 })).down, 4);
  assert.equal(normalizeStrike(strike({ count: 0 })).count, 1);
  assert.equal(normalizeStrike(strike({ count: 100000 })).count, STRIKE_COUNT_MOST);
  // What is not a strike is nothing.
  for (const bad of [null, "strike", strike({ id: "" }), strike({ weapon: "trebuchet" }), strike({ owner: "" }), strike({ to: null }), strike({ to: { name: "" } })]) assert.equal(normalizeStrike(bad), null);
  // One of an id, and the newest when there are more than are kept.
  assert.equal(normalizeStrikes([strike(), strike(), strike({ id: "other" })]).length, 2);
  const many = Array.from({ length: STRIKES_KEPT_MOST + 5 }, (_, index) => strike({ id: `s${index}` }));
  assert.equal(normalizeStrikes(many).length, STRIKES_KEPT_MOST);
  assert.equal(normalizeStrikes(many).at(-1).id, `s${STRIKES_KEPT_MOST + 4}`);
  assert.deepEqual(normalizeStrikes(null), []);
});

test("the world keeps a strike for its own turn and the one after, and a turn applied again replaces its own", () => {
  assert.equal(STRIKE_ROUNDS_KEPT, 2);
  const first = withTurnStrikes([], [strike({ id: "a" })], 5);
  assert.deepEqual(first.map((entry) => [entry.id, entry.round]), [["a", 5]]);
  // The next turn adds its own and keeps the last one's.
  const second = withTurnStrikes(first, [strike({ id: "b" })], 6);
  assert.deepEqual(second.map((entry) => [entry.id, entry.round]), [["a", 5], ["b", 6]]);
  // The turn after that lets the first go.
  const third = withTurnStrikes(second, [], 7);
  assert.deepEqual(third.map((entry) => entry.id), ["b"]);
  assert.deepEqual(withTurnStrikes(third, [], 8), []);
  // The same turn applied twice is that turn once.
  const again = withTurnStrikes(second, [strike({ id: "c" })], 6);
  assert.deepEqual(again.map((entry) => [entry.id, entry.round]), [["a", 5], ["c", 6]]);
  // A turn that told of none leaves the earlier ones their time.
  assert.deepEqual(withTurnStrikes(first, undefined, 6).map((entry) => entry.id), ["a"]);
});

test("a strike's places are found among what its event placed, the cities, the structures and the formations", () => {
  assert.deepEqual(parsePlace("city: Kyiv"), { kind: "city", name: "Kyiv" });
  assert.deepEqual(parsePlace("Structure :  Silo North "), { kind: "structure", name: "Silo North" });
  assert.deepEqual(parsePlace("Kyiv"), { kind: "", name: "Kyiv" });
  const known = {
    places: [{ kind: "city", name: "Brod", lng: 30.5, lat: 51.5 }, { kind: "region", name: "Springfield", lng: 1, lat: 1 }],
    cities: [{ name: "Brod", lng: 99, lat: 9 }, { name: "Springfield", lng: 2, lat: 2 }, { name: "Alba", lng: 23.5, lat: 51.5 }],
    markers: [{ name: "Silo North", lng: 21.5, lat: 51.25 }, { name: "Alba", lng: 5, lat: 5 }],
    units: [{ name: "Northern Fleet", lng: 25, lat: 53 }],
  };
  // What the event itself placed comes first: the game has found that already.
  assert.deepEqual(findStrikePlace("city: Brod", known), { lng: 30.5, lat: 51.5 });
  // ...of the same kind: a region of a city's name is not that city.
  assert.deepEqual(findStrikePlace("city: Springfield", known), { lng: 2, lat: 2 });
  assert.deepEqual(findStrikePlace("Springfield", known), { lng: 1, lat: 1 });
  // A structure is looked for among the structures first, a city among the cities.
  assert.deepEqual(findStrikePlace("structure: Alba", known), { lng: 5, lat: 5 });
  assert.deepEqual(findStrikePlace("city: Alba", known), { lng: 23.5, lat: 51.5 });
  assert.deepEqual(findStrikePlace("unit: Northern Fleet", known), { lng: 25, lat: 53 });
  assert.deepEqual(findStrikePlace("  silo NORTH ", known), { lng: 21.5, lat: 51.25 });
  assert.equal(findStrikePlace("city: Atlantis", known), null);
  assert.equal(findStrikePlace("", known), null);
});

test("a strike nobody gave a launching place sets off from what its owner has for it, the nearer the target the better", () => {
  const to = { lng: 30.5, lat: 51.5 };
  const markers = [
    { name: "Silo North", kind: "missile silo", ownerCode: "Aland", lng: 21.5, lat: 53.5 },
    { name: "Silo East", kind: "missile silo", ownerCode: "Aland", lng: 23.5, lat: 51.5 },
    { name: "Old Silo", kind: "missile silo", ownerCode: "Aland", lng: 24, lat: 51.5, status: "destroyed" },
    { name: "Their Silo", kind: "missile silo", ownerCode: "Borduria", lng: 30, lat: 51 },
    { name: "Alba Air Base", kind: "airbase", ownerCode: "Aland", lng: 22.5, lat: 52 },
    { name: "Fort Alba", kind: "fortress", ownerCode: "Aland", lng: 22, lat: 51 },
    { name: "Port Alba", kind: "naval port", ownerCode: "Aland", lng: 23.9, lat: 52.5 },
  ];
  const units = [
    { name: "3rd Submarine Flotilla", type: "naval", ownerCode: "Aland", lng: 26, lat: 53 },
    { name: "Home Fleet", type: "naval", ownerCode: "Aland", lng: 25.5, lat: 51.5 },
    { name: "1st Bomber Wing", type: "air", ownerCode: "Aland", lng: 22, lat: 52.5 },
    { name: "Enemy Fleet", type: "naval", ownerCode: "Borduria", lng: 29, lat: 51.5 },
  ];
  const pick = (weapon, extra = {}) => pickStrikeOrigin({ weapon, owner: "Aland", to, markers, units, ...extra })?.name;
  // A missile from its silo: the one nearest what it is fired at, and never one that is rubble or another's.
  assert.equal(pick("silo missile"), "Silo East");
  assert.deepEqual(pickStrikeOrigin({ weapon: "silo missile", owner: "aland", to, markers, units }), { name: "Silo East", lng: 23.5, lat: 51.5 });
  // A submarine's from a formation at sea: its submarines before any other fleet, a port only when it has neither.
  assert.equal(pick("submarine missile"), "3rd Submarine Flotilla");
  assert.equal(pick("submarine missile", { units: units.filter((unit) => !/Submarine/.test(unit.name)) }), "Home Fleet");
  assert.equal(pick("submarine missile", { units: [] }), "Port Alba");
  // Aircraft from an airfield, then from an air formation.
  assert.equal(pick("bombing run"), "Alba Air Base");
  assert.equal(pick("nuclear bomber", { markers: markers.filter((marker) => marker.kind !== "airbase") }), "1st Bomber Wing");
  // With no silo, a missile sets off from a base; with nothing of its owner's, from nowhere the turn knows.
  assert.equal(pick("silo missile", { markers: markers.filter((marker) => marker.kind !== "missile silo") }), "Alba Air Base");
  assert.equal(pickStrikeOrigin({ weapon: "silo missile", owner: "Carpathia", to, markers, units }), null);
  assert.equal(pickStrikeOrigin({ weapon: "submarine missile", owner: "Aland", to, markers: [], units: [] }), null);
});

test("a submarine no fleet stands for fires from open water within reach of its target", () => {
  // Two countries and a wide sea, and a lake inside one of them.
  const legend = { A: "Aland", B: "Borduria", "~": null };
  const layout = [
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
    "~AAAA~~~~~~~~~~~~~~~~~~~BBBBB~",
    "~AAAA~~~~~~~~~~~~~~~~~~~BB~BB~",
    "~AAAA~~~~~~~~~~~~~~~~~~~BBBBB~",
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  ];
  const world = syntheticMap({ layout, legend, west: 0, north: 50, step: 2 });
  const grid = buildWorldGrid(world.regions, { step: 0.5 });
  const to = { lng: 49, lat: 45 };
  const at = seaLaunchPlace(grid, { to, seasOf, distanceTo });
  assert.ok(at, "a place is found");
  const cell = grid.cellOf(at.lng, at.lat);
  assert.equal(grid.land[cell], 0, "wholly water");
  const km = kmBetween(at.lng, at.lat, to.lng, to.lat);
  assert.ok(km >= SEA_LAUNCH_KM.least && km <= SEA_LAUNCH_KM.most, `${Math.round(km)} km from its target`);
  // In the open sea, not the lake shut inside Borduria (which is nearer).
  assert.equal(seasOf(grid)[cell], seasOf(grid)[grid.cellOf(20, 49)]);
  assert.notEqual(seasOf(grid)[cell], seasOf(grid)[grid.cellOf(53, 45)]);
  // Well off every shore.
  assert.ok(at.lng > 9.5 && at.lng < 47.5, `at ${at.lng}, ${at.lat}`);
  // The same place every time, and nearer its owner's own land when that is known.
  assert.deepEqual(seaLaunchPlace(grid, { to, seasOf, distanceTo }), at);
  const homeward = seaLaunchPlace(grid, { to, near: { lng: 4, lat: 45 }, seasOf, distanceTo });
  assert.ok(homeward.lng <= at.lng, `${homeward.lng} is no farther from home than ${at.lng}`);
  // A small map, where no water is that far from anything: the open water farthest from the target.
  const pond = syntheticMap({ layout: ["~~~~~", "~AAB~", "~~~~~"], legend, west: 10, north: 50, step: 1 });
  const small = buildWorldGrid(pond.regions, { step: 0.25 });
  const near = seaLaunchPlace(small, { to: { lng: 13.5, lat: 48.5 }, seasOf, distanceTo });
  assert.ok(near && small.land[small.cellOf(near.lng, near.lat)] === 0);
  // Nothing to fire at, a target off the map, or no sheet: nowhere.
  assert.equal(seaLaunchPlace(grid, { to: null, seasOf, distanceTo }), null);
  assert.equal(seaLaunchPlace(grid, { to: { lng: 170, lat: -60 }, seasOf, distanceTo }), null);
  assert.equal(seaLaunchPlace(null, { to, seasOf, distanceTo }), null);
});

test("an event's strikes, and the box round where they fly for the camera", () => {
  const all = [strike({ id: "a", eventId: "e1" }), strike({ id: "b", eventId: "e2" }), strike({ id: "c", eventId: "e1" })];
  assert.deepEqual(strikesOfEvent(all, "e1").map((entry) => entry.id), ["a", "c"]);
  assert.deepEqual(strikesOfEvent(all, ""), []);
  assert.deepEqual(strikesOfEvent(null, "e1"), []);
  const [[west, south], [east, north]] = strikeBounds([strike()]);
  assert.ok(west < 21.5 && east > 30.5 && south < 51.25 && north > 51.5, JSON.stringify([[west, south], [east, north]]));
  // A way over the date line is boxed as it goes: from 170 east to 170 west is 20 degrees, not 340.
  const over = strikeBounds([strike({ from: { name: "a", lng: 170, lat: 40 }, to: { name: "b", lng: -170, lat: 40 } })]);
  assert.ok(over[1][0] - over[0][0] < 40, JSON.stringify(over));
  // One with only its target placed is still somewhere to look, and one with nothing placed is not.
  assert.ok(strikeBounds([strike({ from: null })]));
  assert.equal(strikeBounds([strike({ to: { name: "city: Nowhere" } })]), null);
  assert.equal(strikeBounds([]), null);
});
