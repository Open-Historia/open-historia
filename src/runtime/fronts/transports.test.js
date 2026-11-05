/*! Open Historia — battlefields and fronts: transporters: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/transports.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, readBattlefield } from "./testKit.js";
import {
  CARRIERS,
  HUNT_BASE,
  INTERCEPT_CHANCE_MOST,
  MAX_TRANSPORTS,
  TRANSPORT_LOAD_MOST,
  cancelTransport,
  carrierFor,
  carriersOf,
  departuresFor,
  huntTransport,
  interceptionOf,
  loadOf,
  moveOn,
  normalizeTransport,
  normalizeTransports,
  orderTransport,
  setOut,
  struck,
  transportChance,
} from "./transports.js";
import { buildWorldGrid } from "./worldGrid.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", C: "Cisland", "~": null };
const cities = [
  { name: "Alba", lng: 23.5, lat: 51.5, capital: true },
  { name: "Port", lng: 28.4, lat: 51.5, population: 300000 },
  { name: "Brod", lng: 30.5, lat: 51.5, capital: true },
];
// Aland in the west and Borduria in the east, with the sea between them: at
// war, and with no border to fight over.
const apart = (extra = {}) => syntheticMap({ layout: ["~~~~~~~~~~~~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~~~~~~~~~~~~"], legend, west: 20, north: 54, step: 1, cities, key: "apart", ...extra });
const ARENAS = new Map();
const run = (world, extra = {}) => runFronts(frontInput(world, { arenas: ARENAS, ...extra }));
const convoy = (extra = {}, at = {}) => orderTransport([], { medium: "sea", owner: "Aland", to: { name: "city: Port" }, raise: 30, battlefield: "Operation Tide", ...extra }, { date: "2024-03-01", year: 2024, ...at });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0);

test("a transporter is a medium, a speed and a load: what it is called is free, and what exists goes by the year", () => {
  assert.deepEqual(Object.keys(CARRIERS), ["sea", "land", "air"]);
  assert.deepEqual([carrierFor("sea", 2024).kind, carrierFor("sea", 2024).speed, carrierFor("sea", 2024).capacity], ["troop convoy", 720, 6]);
  assert.deepEqual([carrierFor("sea", 1900).speed, carrierFor("sea", 1700).speed], [480, 190], "a steamer, and before it a sailing fleet");
  assert.deepEqual([carrierFor("land", 2024).speed, carrierFor("land", 1870).speed, carrierFor("land", 1700).kind], [800, 480, "wagon train"]);
  assert.equal(carrierFor("air", 1910), null, "nothing flew troops before the 1930s");
  assert.deepEqual([carrierFor("air", 1944).speed, carrierFor("air", 2024).speed], [5500, 15000]);
  assert.equal(carrierFor("rail", 2024), null);

  const { transports, transport, error } = convoy();
  assert.equal(error, undefined);
  assert.deepEqual([transport.id, transport.status, transport.medium, transport.kind, transport.speed, transport.capacity, transport.raise, transport.ordered], ["t1", "ordered", "sea", "troop convoy", 720, 6, 30, "2024-03-01"]);
  assert.deepEqual(transport.to, { lng: null, lat: null, name: "city: Port" }, "a place the story names is found when it sets out, not read as nought, nought");
  assert.equal(carriersOf(transport), 5, "as many carriers as the load needs: thirty formations, six a ship");
  assert.equal(loadOf(transport), 30);
  assert.equal(transports.length, 1);
  // Whatever it is called, with whatever speed it is given, held to what its medium can do.
  const odd = orderTransport(transports, { medium: "air", owner: "Aland", to: { lng: 28.4, lat: 51.5 }, kind: "war zeppelins", speed: 90, capacity: 99, raise: 500 }, { date: "2024-03-01", year: 1905 });
  assert.equal(odd.error, undefined, "a carrier that is named and given its speed is taken at its word, whatever the year");
  assert.deepEqual([odd.transport.id, odd.transport.kind, odd.transport.speed, odd.transport.capacity, odd.transport.raise], ["t2", "war zeppelins", 300, 12, TRANSPORT_LOAD_MOST]);
  assert.equal(orderTransport([], { medium: "air", owner: "Aland", to: { lng: 28.4, lat: 51.5 }, raise: 4 }, { year: 1905 }).error, "not-yet");
  assert.equal(orderTransport([], { medium: "balloon", owner: "Aland", to: { lng: 1, lat: 1 }, raise: 4 }).error, "medium");
  assert.equal(orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 1, lat: 1 } }, { year: 2024 }).error, "nothing-aboard");
  assert.equal(orderTransport([], { medium: "sea", to: { lng: 1, lat: 1 }, raise: 3 }, { year: 2024 }).error, "incomplete");

  // One not yet under way can be called off; one that is cannot.
  assert.deepEqual(cancelTransport(transports, "t1"), []);
  const moving = [{ ...transport, status: "moving" }];
  assert.equal(cancelTransport(moving, "t1").length, 1);
  // Somebody is told to go after it, once, and told to stop; its owner cannot hunt its own.
  const hunted = huntTransport(moving, "t1", "Borduria");
  assert.deepEqual(hunted[0].hunters, ["Borduria"]);
  assert.deepEqual(huntTransport(hunted, "t1", "borduria")[0].hunters, ["borduria"]);
  assert.deepEqual(huntTransport(hunted, "t1", "Borduria", false)[0].hunters, []);
  assert.deepEqual(huntTransport(moving, "t1", "Aland")[0].hunters, []);
  // What is kept is what a transporter is: anything else is not one.
  assert.equal(normalizeTransport({ id: "x", medium: "sea", owner: "Aland" }), null);
  assert.equal(normalizeTransport(null), null);
  assert.equal(normalizeTransports(Array.from({ length: 60 }, (_, index) => ({ ...transport, id: `t${index}` }))).length, MAX_TRANSPORTS);
  assert.equal(normalizeTransports([transport, transport]).length, 1);
  assert.deepEqual(normalizeTransport({ ...transport, load: [[250, 1], [0, 0], { strength: 60, kind: 2 }, [40, 9]] }).load, [[100, 1], [60, 2], [40, 0]]);
});

test("a sea drawn as regions: ships sail it, no army marches across it, and it is nobody's front", () => {
  // Every stretch of water here is a region: Aland's own waters and Borduria's
  // touch in the middle, and nothing else lies between the two countries.
  const realm = { A: "Aland", B: "Borduria", a: { owner: "Aland", typeId: "sea" }, b: { owner: "Borduria", typeId: "sea" }, o: { owner: "", typeId: "sea" } };
  const world = syntheticMap({ layout: ["oooooooooooo", "oAAAaabbBBBo", "oAAAaabbBBBo", "oAAAaabbBBBo", "oooooooooooo"], legend: realm, west: 20, north: 54, step: 1, cities, key: "pirate seas" });
  const sea = [{ id: "sea", name: "Sea" }];
  const { transports } = convoy();
  // At war across the water: with the sea known as sea, their waters touching opens no battlefield.
  assert.deepEqual(run(world, { days: 5, regionTypes: sea }).battlefields, []);
  // A convoy crosses it and puts its troops ashore.
  const crossed = run(world, { transports, days: 6, regionTypes: sea });
  assert.deepEqual(crossed.transports.map((transport) => transport.status), ["landed"]);
  const [field] = crossed.battlefields;
  assert.ok(field, "the landing opens a battlefield");
  assert.ok(live(field, 0).length >= 20, `${live(field, 0).length} formations ashore`);
  assert.deepEqual(crossed.voyages.map((voyage) => voyage.k), ["sailed", "landed"]);
  // Nothing of the land war ever stands on the water: every troop of both sides is on land.
  const read = readBattlefield(field, world, { regionTypes: sea });
  const onLand = (troop) => troop.strength <= 0 || (troop.lng >= 21 && troop.lng <= 24) || (troop.lng >= 28 && troop.lng <= 31);
  assert.ok(read.troops.flat().every(onLand), "no formation stands in the sea");
  // And no region of the sea changes hands, however the fighting goes.
  const fought = run(world, { transports, days: 40, regionTypes: sea });
  const names = new Map(world.regions.map((region) => [region.id, region.typeId ?? ""]));
  assert.equal(fought.flips.filter((flip) => names.get(flip.regionId) === "sea").length, 0);
  // The same map with its sea NOT water is all dry land: there is nothing between them to sail, and nobody is put ashore.
  const dry = run(world, { transports, days: 6, regionTypes: [{ id: "sea", name: "Sea", water: false }], arenas: new Map() });
  assert.ok(["refused", "returned"].includes(dry.transports[0].status), dry.transports[0].status);
  assert.equal(dry.voyages.some((voyage) => voyage.k === "landed"), false);
  // A lake, an ocean or plain water by name does as well as a sea.
  for (const name of ["Ocean", "Water", "Lake"]) {
    const other = run(world, { transports, days: 6, regionTypes: [{ id: "sea", name }], arenas: new Map() });
    assert.deepEqual(other.transports.map((transport) => transport.status), ["landed"], name);
  }
});

test("troops sent by ship to a country they have no border with land there and open a battlefield", () => {
  const world = apart();
  const { transports } = convoy();
  assert.deepEqual(run(world, { days: 5 }).battlefields, [], "at war across the sea: without a transporter there is nothing to fight over");

  // A run no day passes in leaves it as it was ordered.
  const still = run(world, { transports, days: 0 });
  assert.deepEqual(still.transports.map((transport) => transport.status), ["ordered"]);
  assert.deepEqual(still.voyages, []);

  const result = run(world, { transports, days: 25 });
  const [transport] = result.transports;
  // It set out on the first day from its owner's own city, by sea, and was due the day its way took.
  assert.deepEqual(result.voyages.map((voyage) => [voyage.d, voyage.k]), [["2024-03-01", "sailed"], ["2024-03-02", "landed"]]);
  assert.deepEqual([result.voyages[0].from, result.voyages[0].to, result.voyages[0].n, result.voyages[0].due], ["city: Alba", "city: Port", 30, "2024-03-02"]);
  assert.deepEqual([transport.status, transport.warId, transport.departed, transport.ended, transport.battlefield], ["landed", "war-1", "2024-03-01", "2024-03-02", "Operation Tide"]);
  assert.ok(transport.km > 200 && transport.km < 420, `${transport.km} km by sea from Alba's coast to Port`);
  assert.equal(transport.gone, transport.km);
  assert.equal(transport.raise, undefined, "what it was told to raise is what it carried");
  // The battlefield it opened: its thirty formations ashore at Port, and Borduria's raised against them.
  const [record] = result.battlefields;
  assert.deepEqual([record.name, record.status, record.openedDate, record.sides], ["Operation Tide", "active", "2024-03-02", [["Aland"], ["Borduria"]]]);
  assert.equal(live(record, 0).length, 30);
  assert.ok(live(record, 1).length >= 6);
  assert.deepEqual(record.log[0], { d: "2024-03-02", k: "landed", s: 0, at: "city: Port" });
  // And they go inland from there: nobody had ordered anything on that shore.
  const seen = readBattlefield(record, world);
  assert.equal(seen.holderAt(28.4, 51.5), 0, "Port is theirs");
  assert.equal(seen.holderAt(28.9, 51.5), 0, "and the ground east of it");
  assert.ok(result.flips.length >= 1 && result.flips.every((flip) => flip.from === "Borduria" && flip.to === "Aland"), `${result.flips.length} regions of Borduria's taken from the sea`);
  assert.deepEqual(record.orders.filter((order) => order.s === 0).map((order) => [order.sector, order.order]), [["all", "advance"]]);

  // The same again is the same again: nothing in it is left to chance.
  const again = run(world, { transports, days: 25 });
  assert.deepEqual(again.transports, result.transports);
  assert.deepEqual(again.voyages, result.voyages);
  assert.deepEqual(again.battlefields[0].troops, record.troops);
  // And a run cut at a day is the whole run as it stood that day.
  const cut = run(world, { transports, days: 1 });
  assert.deepEqual(cut.voyages, result.voyages.filter((voyage) => voyage.day <= 1));

  // The next run begins with the voyage over: it is let go once it has been told and shown.
  const after = run(world, { transports: result.transports, battlefields: result.battlefields, days: 2, fromDate: "2024-03-26" });
  assert.deepEqual(after.transports, []);
  // ... but one that ended on the last day of a run is still there for the run after to show.
  const late = run(world, { transports: cut.transports, battlefields: cut.battlefields, days: 0, fromDate: "2024-03-02" });
  assert.deepEqual(late.transports, []);
  const fresh = run(world, { transports: cut.transports, battlefields: cut.battlefields, days: 0, fromDate: "2024-03-01" });
  assert.deepEqual(fresh.transports.map((entry) => entry.status), ["landed"]);
});

test("a slow carrier takes its days, and is where its way has brought it on each of them", () => {
  const world = apart();
  const slow = convoy({ kind: "barges", speed: 60 });
  assert.equal(slow.transport.speed, 60);
  const days = (count) => run(world, { transports: slow.transports, days: count }).transports[0];
  const first = days(1);
  assert.deepEqual([first.status, first.gone, first.departed], ["moving", 60, "2024-03-01"], "it sets out on the run's first date and has a day's sailing behind it a day later");
  const third = days(3);
  assert.deepEqual([third.status, third.gone], ["moving", 180]);
  assert.ok(third.at[0] > first.at[0] + 1 && third.at[0] < 28.4, `on the third day it is at ${third.at}, east of where it set out (${first.at})`);
  const due = Math.ceil(first.km / 60);
  assert.equal(first.due, `2024-03-0${1 + due}`);
  assert.equal(days(due - 1).status, "moving", "the day before it is due it is still at sea");
  assert.deepEqual([days(due).status, days(due).ended], ["landed", first.due]);
  // moveOn alone: a day's sailing, and the day it comes in.
  const one = moveOn({ ...first, gone: first.km - 30 });
  assert.deepEqual([one.arrived, one.transport.gone], [true, first.km]);
});

test("troops taken off a battlefield go aboard: they are gone from it, and come ashore behind the other side's line", () => {
  // The two share a land border in the north as well as the sea.
  const world = syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AA~~~~BB", "AA~~~~BB", "AA~~~~BB"], legend, west: 20, north: 55, step: 1, cities: [{ name: "Southport", lng: 26.4, lat: 50.6 }], key: "bay" });
  const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));
  const front = run(world, { battlefields: [battlefieldOn(world, { troops: [row(23.9, 53.1, 54.9, 30), row(24.1, 53.1, 54.9, 12)], pool: [300, 300] })], days: 0 }).battlefields[0];
  const picked = Array.from({ length: 14 }, (_, index) => index);
  const ordered = orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 26.4, lat: 50.6, name: "city: Southport" }, embark: { battlefield: front.name, side: 0, troops: picked } }, { date: "2024-03-01", year: 2024 });
  assert.equal(ordered.error, undefined);
  assert.deepEqual(ordered.transport.embark, { battlefield: "The front", side: 0, troops: picked });

  const result = run(world, { battlefields: [front], transports: ordered.transports, days: 12 });
  assert.deepEqual(result.voyages.map((voyage) => voyage.k), ["sailed", "landed"]);
  const [transport] = result.transports;
  assert.equal(transport.embark, undefined);
  assert.equal(transport.load.length, 14, "the fourteen picked out are what it carried");
  const [record] = result.battlefields;
  assert.equal(result.battlefields.length, 1, "the place is on the battlefield they came from: no other opens");
  const seen = readBattlefield(record, world);
  const ashore = seen.troops[0].filter((troop) => troop.strength > 0 && troop.lat < 52.4 && troop.lng > 25.5);
  assert.ok(ashore.length >= 10, `${ashore.length} of them are ashore in the south-east, far from the line they left`);
  assert.equal(seen.holderAt(26.4, 50.6), 0, "Southport is taken from the sea");
  assert.ok(record.log.some((entry) => entry.k === "landed" && entry.s === 0 && entry.at === "city: Southport"));
  // While they were at sea they were on no battlefield.
  const sailing = run(world, { battlefields: [front], transports: orderTransport([], { medium: "sea", owner: "Aland", kind: "barges", speed: 50, to: { lng: 26.4, lat: 50.6 }, embark: { battlefield: front.name, side: 0, troops: picked } }, { date: "2024-03-01", year: 2024 }).transports, days: 2 });
  assert.equal(sailing.transports[0].status, "moving");
  assert.equal(live(sailing.battlefields[0], 0).length, live(front, 0).length - 14);
  // Troops that are not there cannot be embarked: the order is refused and says why.
  const nobody = run(world, { battlefields: [front], transports: orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 26.4, lat: 50.6 }, embark: { battlefield: "No such front", side: 0, troops: picked } }, { year: 2024 }).transports, days: 2 });
  assert.deepEqual([nobody.transports[0].status, nobody.transports[0].note, nobody.voyages[0].k], ["refused", "no-troops", "refused"]);
  assert.equal(live(nobody.battlefields[0], 0).length, live(front, 0).length);
});

test("troops picked out far from the sea go overland to a port of their country's on their way, and sail from there", () => {
  // Aland and Borduria fight along a border far inland; Aland's coast is in the south, and Borduria has a shore across the water from it.
  const layout = [
    ...Array.from({ length: 12 }, () => "AAAAAAAAAAAAAAABBBBBBBBBBBBBBB"),
    ...Array.from({ length: 3 }, () => "AA~~~~~~~~~~~~~~~~~~~~~~~~~~~~"),
    "AA~~~~~~~~~~~~BBBBBBBBBBBBBBBB",
    "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
  ];
  const places = [
    { name: "Alba", lng: 26, lat: 58.5, capital: true },
    { name: "Harbour", lng: 33.5, lat: 51.5 },
    { name: "Westhaven", lng: 21.5, lat: 48.5 },
    { name: "Southport", lng: 40.5, lat: 47.5 },
  ];
  const world = syntheticMap({ layout, legend, west: 20, north: 63, step: 1, cities: places, key: "inland" });
  const row = (lng, south, north, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: south + ((index + 0.5) * (north - south)) / count }));
  const front = run(world, { battlefields: [battlefieldOn(world, { troops: [row(34.9, 54.5, 58.5, 20), row(35.1, 54.5, 58.5, 12)], pool: [300, 300] })], days: 0 }).battlefields[0];
  const picked = Array.from({ length: 6 }, (_, index) => index);
  const sent = orderTransport([], { medium: "sea", owner: "Aland", to: { lng: 40.5, lat: 47.5, name: "city: Southport" }, embark: { battlefield: front.name, side: 0, troops: picked }, by: "Aland" }, { date: "2024-03-01", year: 2024 });
  const result = run(world, { battlefields: [front], transports: sent.transports, days: 6 });
  const [transport] = result.transports;
  // Where they stand is some 600 km from the water: they sail from Harbour, the port on their way to Southport.
  assert.deepEqual([transport.status, transport.note, transport.from?.name, transport.load.length], ["landed", "", "city: Harbour", 6]);
  assert.deepEqual(result.voyages.map((voyage) => [voyage.k, voyage.from ?? ""]), [["sailed", "city: Harbour"], ["landed", ""]]);
  const sailing = run(world, { battlefields: [front], transports: sent.transports, days: 1 });
  assert.ok(picked.every((index) => !(decodeTroops(sailing.battlefields[0].troops[0])[index]?.strength > 0)), "they left the front they were taken from");
  // A country with no city it can sail from at all is refused for why it could not sail where its troops stand, and nobody goes aboard.
  const portless = syntheticMap({ layout, legend, west: 20, north: 63, step: 1, cities: [places[0], places[3]], key: "inland, no port" });
  const stuck = run(portless, { battlefields: [front], transports: sent.transports, days: 1 });
  assert.deepEqual([stuck.transports[0].status, stuck.transports[0].note], ["refused", "no-coast"]);
  assert.ok(picked.every((index) => decodeTroops(stuck.battlefields[0].troops[0])[index]?.strength > 0));

  // The cities a dispatch may set out from: its owner's, by the way from its troops through each to where it is sent.
  const km = (lngA, latA, lngB, latB) => Math.hypot(lngA - lngB, latA - latB);
  const holderAt = (lng) => (lng < 35 ? "Aland" : "Borduria");
  assert.deepEqual(departuresFor({ cities: places, holderAt, owner: "aland", to: { lng: 40.5, lat: 47.5 }, near: [34.9, 56.5], km }).map((city) => city.name), ["city: Harbour", "city: Alba", "city: Westhaven"]);
  const two = [{ name: "Near", lng: 0, lat: 10 }, { name: "Far", lng: 0, lat: 0 }];
  assert.deepEqual(departuresFor({ cities: two, holderAt, owner: "Aland", to: { lng: 5, lat: 0 }, near: [0, 11], km }).map((city) => city.name), ["city: Near", "city: Far"], "the one by its troops, though it is further from where it is sent");
  assert.deepEqual(departuresFor({ cities: two, holderAt, owner: "Aland", to: { lng: 5, lat: 0 }, km, most: 1 }).map((city) => city.name), ["city: Far"], "with nobody standing anywhere, the nearest to where it is sent");
});

test("troops put down in a country that was in no war are an attack on it: it joins the other side that day", () => {
  const world = syntheticMap({ layout: ["~~~~~~~~~~~~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~~~~~~~~~~~~", "~~~~NNN~~~~~", "~~~~NNN~~~~~", "~~~~~~~~~~~~"], legend, west: 20, north: 56, step: 1, cities: [{ name: "Alba", lng: 23.5, lat: 54.5, capital: true }, { name: "Nord", lng: 25.5, lat: 51.4, capital: true }], key: "third" });
  const sent = orderTransport([], { medium: "sea", owner: "Aland", to: { name: "country: Neutralia" }, raise: 24 }, { date: "2024-03-01", year: 2024 });
  const result = run(world, { transports: sent.transports, days: 10 });
  const kinds = result.voyages.map((voyage) => voyage.k);
  assert.deepEqual(kinds, ["sailed", "invaded", "landed"]);
  const [join] = result.joins;
  assert.deepEqual([join.name, join.warId, join.side, join.by, join.date], ["Neutralia", "war-1", 1, "Aland", result.voyages[2].d]);
  assert.equal(result.voyages[1].at, "country: Neutralia");
  const [record] = result.battlefields;
  assert.deepEqual(record.sides, [["Aland"], ["Borduria", "Neutralia"]]);
  assert.equal(join.battlefield, record.name);
  assert.ok(live(record, 0).length >= 20);
  // It says so from the day it sets out: what it is bound for is an attack on that country.
  const sailing = run(world, { transports: orderTransport([], { medium: "sea", owner: "Aland", kind: "barges", speed: 45, to: { name: "city: Nord" }, raise: 24 }, { date: "2024-03-01", year: 2024 }).transports, days: 2 });
  assert.deepEqual([sailing.transports[0].status, sailing.transports[0].attacks], ["moving", ["Neutralia"]]);
  assert.deepEqual(sailing.joins, [], "and nobody is at war with it until the troops are put down");
  // The story naming an earlier day for it does not move the day.
  const told = run(world, { transports: sent.transports, days: 10, moments: [{ day: 0, type: "war", warId: "war-1", op: "join-b", names: ["Neutralia"] }] });
  assert.deepEqual(told.joins, result.joins);
  assert.deepEqual(told.battlefields[0].troops, record.troops);
});

test("a train takes troops through their own land to another front, and they arrive there as reinforcements", () => {
  // Aland fights Borduria in the east and has a long country behind it.
  const world = syntheticMap({ layout: ["AAAAAAAABB", "AAAAAAAABB", "AAAAAAAABB"], legend, west: 20, north: 53, step: 1, cities: [{ name: "Westend", lng: 20.5, lat: 51.5, capital: true }, { name: "Eastgate", lng: 27.4, lat: 51.5 }], key: "long" });
  const opened = run(world, { days: 0 }).battlefields[0];
  const before = live(opened, 0).length;
  const sent = orderTransport([], { medium: "land", owner: "Aland", from: { lng: 20.5, lat: 51.5, name: "city: Westend" }, to: { lng: 27.4, lat: 51.5, name: "city: Eastgate" }, raise: 10 }, { date: "2024-03-01", year: 2024 });
  assert.deepEqual([sent.transport.kind, sent.transport.speed], ["troop trains", 800]);
  const result = run(world, { battlefields: [opened], transports: sent.transports, days: 4 });
  assert.deepEqual(result.voyages.map((voyage) => voyage.k), ["sailed", "reinforced"]);
  const [record] = result.battlefields;
  assert.equal(result.battlefields.length, 1);
  assert.equal(live(record, 0).length, before + 10, "ten more stand on Aland's side of that battlefield");
  assert.ok(record.log.some((entry) => entry.k === "reinforced" && entry.at === "city: Eastgate"));
  assert.deepEqual(result.joins, []);
  // Sent to a place of its own that nobody is fighting over, it has nowhere to put them: they go home.
  const peace = syntheticMap({ layout: ["AAAAAAAA~~~~BB", "AAAAAAAA~~~~BB"], legend, west: 20, north: 52, step: 1, cities: [{ name: "Westend", lng: 20.5, lat: 51.5, capital: true }], key: "quiet" });
  const idle = run(peace, { transports: orderTransport([], { medium: "land", owner: "Aland", from: { lng: 20.5, lat: 51.5 }, to: { lng: 27.4, lat: 51.5 }, raise: 6 }, { date: "2024-03-01", year: 2024 }).transports, days: 4 });
  assert.deepEqual([idle.transports[0].status, idle.voyages.at(-1).k, idle.voyages.at(-1).why], ["returned", "returned", "no-landing"]);
});

test("a transporter that cannot set out says why, and nothing is taken from anybody", () => {
  const world = apart();
  const refused = (spec, extra = {}) => {
    const sent = orderTransport([], { owner: "Aland", raise: 6, ...spec }, { date: "2024-03-01", year: 2024 });
    assert.equal(sent.error, undefined);
    const result = run(world, { transports: sent.transports, days: 3, ...extra });
    return [result.transports[0].status, result.transports[0].note, result.voyages[0]?.k, result.battlefields.length];
  };
  // A place nobody knows, a country with nowhere to sail from, and a train with the sea in its way.
  assert.deepEqual(refused({ medium: "sea", to: { name: "city: Atlantis" } }), ["refused", "no-place", "refused", 0]);
  assert.deepEqual(refused({ medium: "sea", owner: "Neutralia", to: { name: "city: Port" } }), ["refused", "no-origin", "refused", 0]);
  // In peace nothing is carried to a country's own land, nor against one a ceasefire stands with.
  assert.deepEqual(refused({ medium: "sea", to: { name: "city: Alba" } }, { wars: [] }), ["refused", "no-war", "refused", 0]);
  assert.deepEqual(refused({ medium: "sea", to: { name: "city: Port" } }, { wars: [{ id: "war-1", status: "ceasefire", sideA: ["Aland"], sideB: ["Borduria"] }] }), ["refused", "no-war", "refused", 0]);
  // A train goes as far as its side's land does: sent across the water it stops at its own shore, and there is nobody there to fight.
  assert.deepEqual(refused({ medium: "land", to: { name: "city: Port" } }), ["returned", "railhead", "sailed", 0]);
  // Without the map's shapes the engine says it needs them, and changes nothing.
  const blind = runFronts(frontInput({ ...world, map: { ...world.map, regions: null, key: "never drawn" } }, { transports: convoy().transports, days: 3, arenas: new Map() }));
  assert.equal(blind.needsRegions, true);
});

test("a transporter is caught by what its enemies have near its way, and loses the troops aboard what is hit", () => {
  const world = apart();
  const grid = buildWorldGrid(world.regions, { step: 0.25 });
  const base = { ...convoy().transport, status: "moving", load: Array.from({ length: 30 }, () => [100, 0]), hunters: [] };
  const sides = { enemy: (name) => name === "Borduria", ally: (name) => name === "Aland", grid, holderOf: world.controllerOf };
  const risk = (at, extra = {}, transport = base) => interceptionOf(transport, at, { ...sides, ...extra });
  // In the middle of the sea, with nobody about, nothing can catch it.
  assert.deepEqual(risk([26, 51.5]), { chance: 0, by: "", with: "", threats: 0 });
  // Off the shore its enemies hold, their coast can.
  const shore = risk([27.6, 51.5]);
  assert.ok(shore.chance > 0 && shore.chance < 0.06 && shore.by === "Borduria" && shore.with === "", JSON.stringify(shore));
  // A fleet of theirs near it is the danger: the nearer, the stronger, the worse.
  const fleet = { type: "naval", ownerCode: "Borduria", name: "Home Fleet", lng: 26.2, lat: 51.5, strength: 100 };
  const near = risk([26, 51.5], { units: [fleet] });
  assert.ok(near.chance > 0.15 && near.chance < 0.3 && near.by === "Borduria" && near.with === "Home Fleet", JSON.stringify(near));
  assert.ok(risk([26, 51.5], { units: [{ ...fleet, lng: 29.8 }] }).chance < near.chance, "further off");
  assert.ok(risk([26, 51.5], { units: [{ ...fleet, strength: 40 }] }).chance < near.chance, "weaker");
  assert.equal(risk([26, 51.5], { units: [{ ...fleet, lng: 40 }] }).chance, 0, "out of reach");
  assert.equal(risk([26, 51.5], { units: [{ ...fleet, ownerCode: "Neutralia" }] }).chance, 0, "nobody's enemy");
  assert.equal(risk([26, 51.5], { units: [{ ...fleet, type: "infantry" }] }).chance, 0, "an army catches no ship");
  assert.equal(risk([26, 51.5], { units: [{ ...fleet, committedTo: "The front" }] }).chance, 0, "nor a formation that is fighting on a battlefield");
  // Aircraft reach further than ships, and reach a train or another aircraft as well.
  const wing = { type: "air", ownerCode: "Borduria", name: "1st Air Wing", lng: 30, lat: 51.5, strength: 100 };
  assert.ok(risk([24.5, 51.5], { units: [wing] }).chance > 0);
  assert.equal(risk([24.5, 51.5], { units: [{ ...wing, type: "naval" }] }).chance, 0);
  assert.ok(risk([24.5, 51.5], { units: [wing] }, { ...base, medium: "air" }).chance > risk([24.5, 51.5], { units: [wing] }).chance, "an aircraft is easier for aircraft to find than a ship");
  assert.ok(risk([23.5, 51.5], { units: [{ ...wing, lng: 26 }] }, { ...base, medium: "land" }).chance > 0);
  // Its own side's ships and aircraft beside it cover it.
  const escort = { type: "naval", ownerCode: "Aland", name: "Escort", lng: 26, lat: 51.4, strength: 100 };
  const covered = risk([26, 51.5], { units: [fleet, escort] });
  assert.ok(covered.chance < near.chance * 0.8 && covered.chance > 0, `${covered.chance} covered against ${near.chance} alone`);
  // Whoever was told to go after it does, while it has anything within reach of it.
  const hunted = risk([26, 51.5], { units: [fleet] }, { ...base, hunters: ["Borduria"] });
  assert.ok(hunted.chance > near.chance + 0.15, `${hunted.chance} hunted against ${near.chance}`);
  assert.equal(risk([26, 51.5], { units: [{ ...fleet, lng: 40 }] }, { ...base, hunters: ["Borduria"] }).chance > 0, true, "its shore is near enough to hunt from");
  assert.equal(risk([26, 51.5], {}, { ...base, hunters: ["Cisland"] }).chance, 0, "one with nothing anywhere near hunts nothing");
  assert.ok(HUNT_BASE > 0.3 && INTERCEPT_CHANCE_MOST < 1);
  const crowd = Array.from({ length: 40 }, (_, index) => ({ ...fleet, name: `Fleet ${index}`, strength: 150 }));
  assert.equal(risk([26, 51.5], { units: crowd }).chance, INTERCEPT_CHANCE_MOST, "nothing is ever certain to be caught");

  // A hit takes at least a carrier's load, and most of what is aboard at worst.
  const light = struck(base, 0, "2024-03-02");
  assert.deepEqual([light.lost, light.transport.load.length, light.transport.hits, light.transport.sunk, light.transport.status], [9, 21, 1, 9, "moving"]);
  const heavy = struck(base, 1, "2024-03-02");
  assert.deepEqual([heavy.lost, heavy.transport.load.length], [26, 4]);
  const last = struck({ ...base, load: [[100, 0], [100, 0]] }, 0.5, "2024-03-02");
  assert.deepEqual([last.lost, last.transport.status, last.transport.ended], [2, "lost", "2024-03-02"], "with nothing left aboard it is lost");
  // A transporter's chance is its own, the same in every run, and no other's.
  assert.equal(transportChance("seed", "t1", 3, "caught"), transportChance("seed", "t1", 3, "caught"));
  assert.notEqual(transportChance("seed", "t1", 3, "caught"), transportChance("seed", "t2", 3, "caught"));
  assert.ok(transportChance("seed", "t1", 3, "caught") >= 0 && transportChance("seed", "t1", 3, "caught") < 1);
  // setOut refuses one whose place nobody found.
  assert.deepEqual([setOut(convoy().transport, { grid, from: [23.5, 51.5], date: "2024-03-01" }).status, setOut(convoy().transport, { grid, from: [23.5, 51.5] }).note], ["refused", "no-place"]);
});

test("in the engine a hunted convoy is caught on the way, told where and by whom, and what is left of it still lands", () => {
  const world = apart();
  // Borduria's fleet lies on the way, and Borduria was told to go after the convoy.
  const fleet = { id: "u1", type: "naval", ownerCode: "Borduria", name: "Home Fleet", lng: 26.4, lat: 51.5, strength: 120 };
  const slow = convoy({ kind: "barges", speed: 45 });
  const hunted = huntTransport(slow.transports, "t1", "Borduria");
  const outcomes = { caught: 0, lost: 0, landed: 0, clean: 0 };
  let shown = null;
  for (let seed = 0; seed < 16; seed += 1) {
    const result = run(world, { transports: hunted, units: [fleet], days: 14, seed: `seed ${seed}` });
    const hits = result.voyages.filter((voyage) => voyage.k === "intercepted" || voyage.k === "lost");
    if (hits.length > 0) outcomes.caught += 1;
    else outcomes.clean += 1;
    if (result.transports[0].status === "lost") outcomes.lost += 1;
    if (result.transports[0].status === "landed") outcomes.landed += 1;
    if (hits.length > 0 && !shown) shown = { result, hit: hits[0] };
    // What is told is what happened to it: the troops it lost are off its load.
    assert.equal(result.transports[0].sunk, hits.reduce((sum, voyage) => sum + voyage.lost, 0));
    assert.equal(result.transports[0].load.length, 30 - result.transports[0].sunk);
    if (result.transports[0].status === "landed") assert.equal(live(result.battlefields[0], 0).length, 30 - result.transports[0].sunk, "what was left of it came ashore");
    if (result.transports[0].status === "lost") assert.deepEqual(result.battlefields, [], "nothing came ashore from a convoy that was lost");
  }
  assert.ok(outcomes.caught >= 12, `hunted across six days of sea with a fleet on its way, it was caught in ${outcomes.caught} of 16 runs`);
  assert.ok(outcomes.landed >= 1 && outcomes.landed + outcomes.lost === 16, JSON.stringify(outcomes));
  assert.deepEqual([shown.hit.by, shown.hit.with, shown.hit.owner, shown.hit.kind], ["Borduria", "Home Fleet", "Aland", "barges"]);
  assert.ok(shown.hit.lost >= 6 && Array.isArray(shown.hit.where) && shown.hit.where[0] > 23.9 && shown.hit.where[0] < 28.4, JSON.stringify(shown.hit));
  // With nobody on its way and nobody after it, it is never caught before it nears the shore.
  for (let seed = 0; seed < 6; seed += 1) {
    const quiet = run(world, { transports: slow.transports, days: 5, seed: `seed ${seed}` });
    assert.deepEqual(quiet.voyages.map((voyage) => voyage.k), ["sailed"]);
  }
});
