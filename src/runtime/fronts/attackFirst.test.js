/*! Open Historia — battlefields and fronts: a war that begins with an attack: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/attackFirst.test.js
//
// "Make it so enemies can deploy troops to attack you first without you
// instigating": a side may send its troops at a country it is not at war
// with, and that IS the war beginning (engine.js attackOpensWar). An order to
// attack across a border in peace, an order aimed at a place another holds, a
// transporter bound for its land. The run says which wars began (`starts`)
// and who was brought into one (`joins`), for the war ledger.

import test from "node:test";
import assert from "node:assert/strict";
import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { orderTransport } from "./transports.js";

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const cities = [{ name: "Alba", lng: 21.5, lat: 50.5, capital: true }, { name: "Brod", lng: 24.5, lat: 50.5, capital: true }];
const sheet = (extra = {}) => syntheticMap({ layout: ["AAABBB", "AAABBB", "NNNNNN"], legend, west: 20, north: 51, step: 1, stepLat: 0.5, cities, ...extra });
const peace = (world, overrides = {}) => frontInput(world, { wars: [], days: 10, ...overrides });
// (An attack that begins a war is a real offensive: effort major. One with no effort is a border incident, tested at the foot.)
const ATTACKS = ["advance", "blitz", "spearhead", "flank", "encircle", "assault", "land"];
const order = (day, battlefield, side, word, extra = {}) => ({ day, type: "order", battlefield, side, order: word, sector: "all", ...(ATTACKS.includes(word) ? { effort: "major" } : {}), ...extra });
const live = (record, side) => decodeTroops(record.troops[side]).filter((troop) => troop.strength > 0).length;

test("an order to attack across a border in peace is the war beginning", () => {
  const world = sheet();
  const run = runFronts(peace(world, { moments: [order(2, "border: Aland / Borduria", "Aland", "advance", { ref: 2 })] }));
  assert.deepEqual(run.notes, []);
  // A war between the two, from the day of the order, entered for the ledger.
  assert.deepEqual(run.starts, [{ day: 2, date: "2024-03-03", warId: "war-aland-borduria-2024-03-03", attacker: "Aland", defender: "Borduria" }]);
  assert.deepEqual(run.joins, []);
  // Its battlefield opens along the border, both sides raise their troops, and the attacker's are told to advance.
  assert.equal(run.battlefields.length, 1);
  const [field] = run.battlefields;
  assert.deepEqual([field.status, field.warId, field.openedDate], ["active", "war-aland-borduria-2024-03-03", "2024-03-03"]);
  assert.deepEqual(field.sides, [["Aland"], ["Borduria"]]);
  assert.ok(live(field, 0) > 0 && live(field, 1) > 0, `${live(field, 0)} against ${live(field, 1)}`);
  assert.deepEqual(field.orders.map((entry) => [entry.s, entry.order]), [[0, "advance"]]);
  // The battlefield's own log says who struck first.
  assert.deepEqual(field.log[0], { d: "2024-03-03", k: "attacked", s: 0, at: "country: Borduria" });
  // The same turn is the same war: a run made twice is one run.
  assert.deepEqual(runFronts(peace(world, { moments: [order(2, "border: Aland / Borduria", "Aland", "advance", { ref: 2 })] })), run);
  // Whoever is attacked: Borduria striking first is Borduria's war.
  const other = runFronts(peace(world, { moments: [order(1, "border: Aland / Borduria", "Borduria", "blitz")] }));
  assert.deepEqual(other.starts.map((start) => [start.attacker, start.defender]), [["Borduria", "Aland"]]);
  const struck = other.battlefields[0];
  assert.deepEqual(struck.orders.map((entry) => [struck.sides[entry.s][0], entry.order]), [["Borduria", "blitz"]]);
  // To dig in or to hold on a border is still no war.
  const quiet = runFronts(peace(world, { moments: [order(1, "border: Aland / Borduria", "Aland", "hold")] }));
  assert.deepEqual([quiet.starts, quiet.battlefields[0].status], [[], "standing"]);
  // Two that do not touch have no border to cross, and nobody who is neither of the two can order it.
  const apart = syntheticMap({ layout: ["AA~~BB"], legend, west: 20, north: 51, step: 1 });
  const far = runFronts(peace(apart, { days: 4, moments: [order(1, "border: Aland / Borduria", "Aland", "advance", { ref: 7 })] }));
  assert.deepEqual([far.starts, far.battlefields, far.notes], [[], [], [{ kind: "border-not-found", battlefield: "border: Aland / Borduria", side: "Aland", ref: 7 }]]);
  // Without the map's shapes the engine says it needs them.
  assert.deepEqual(runFronts(peace(world, { map: { ...world.map, regions: null }, moments: [order(1, "border: Aland / Borduria", "Aland", "advance")] })), { needsRegions: true });
});

test("a border fortified in peace becomes the front when one side is told to attack across it", () => {
  const world = sheet();
  const opened = runFronts(peace(world, { days: 5, moments: [order(0, "border: Aland / Borduria", "Aland", "dig in")] }));
  assert.equal(opened.battlefields[0].status, "standing");
  const dug = opened.battlefields[0].troops[0];
  // By the battlefield's own name, or by the border's.
  for (const name of ["Aland / Borduria border", "border: Borduria / Aland"]) {
    const run = runFronts(peace(world, { battlefields: opened.battlefields, fromDate: "2024-03-06", days: 3, moments: [order(1, name, "Borduria", "advance")] }));
    assert.deepEqual(run.notes, [], name);
    assert.deepEqual(run.starts, [{ day: 1, date: "2024-03-07", warId: "war-borduria-aland-2024-03-07", attacker: "Borduria", defender: "Aland" }], name);
    const [field] = run.battlefields;
    assert.deepEqual([run.battlefields.length, field.name, field.status, field.warId], [1, "Aland / Borduria border", "active", "war-borduria-aland-2024-03-07"], name);
    assert.equal(live(field, 0), decodeTroops(dug).length, "whoever was dug in there is there");
    assert.ok(live(field, 1) > 0, "and the attacker has raised its troops");
    assert.deepEqual(field.log.at(-1), { d: "2024-03-07", k: "attacked", s: 1, at: "country: Aland" });
  }
});

test("an order aimed at a place another country holds, on a battlefield nobody has, is an attack on that country", () => {
  const world = sheet();
  const run = runFronts(peace(world, { moments: [order(3, "Operation Dawn", "Aland", "spearhead", { objective: "city: Brod", ref: 5 })] }));
  assert.deepEqual(run.notes, []);
  assert.deepEqual(run.starts.map((start) => [start.attacker, start.defender, start.date]), [["Aland", "Borduria", "2024-03-04"]]);
  // The battlefield that opens for it takes the name the order gave.
  const [field] = run.battlefields;
  assert.deepEqual([field.name, field.status], ["Operation Dawn", "active"]);
  assert.deepEqual(field.orders.map((entry) => [entry.s, entry.order]), [[0, "spearhead"]]);
  // A place the turn found for it (the game's own reader of places) is taken where the map's own names fail.
  const found = runFronts(peace(world, { moments: [order(3, "Operation Dawn", "Aland", "advance", { objective: "city: Brodgrad", objectiveAt: { lng: 24.5, lat: 50.5 } })] }));
  assert.deepEqual(found.starts.map((start) => start.defender), ["Borduria"]);
  // Aimed at its own land, or at nothing the map knows, it is the unknown battlefield it always was.
  for (const objective of ["city: Alba", "city: Atlantis"]) {
    const none = runFronts(peace(world, { moments: [order(3, "Operation Dawn", "Aland", "advance", { objective, ref: 9 })] }));
    assert.deepEqual([none.starts, none.battlefields, none.notes], [[], [], [{ kind: "unknown-battlefield", battlefield: "Operation Dawn", side: "Aland", ref: 9 }]], objective);
  }
  // An order with no place to go by, likewise.
  assert.deepEqual(runFronts(peace(world, { moments: [order(3, "Operation Dawn", "Aland", "advance", { ref: 9 })] })).notes, [{ kind: "unknown-battlefield", battlefield: "Operation Dawn", side: "Aland", ref: 9 }]);
});

test("the war the story opens itself is that war: one war, begun on the day the troops went in", () => {
  const world = sheet();
  const told = { day: 5, type: "war", warId: "war-of-the-story", op: "start", names: ["Borduria"], opponents: ["Aland"], title: "The Told War" };
  const run = runFronts(peace(world, { moments: [order(2, "border: Aland / Borduria", "Aland", "advance"), told] }));
  // The engine opens no war of its own beside the story's.
  assert.deepEqual(run.starts, []);
  assert.equal(run.battlefields.length, 1);
  assert.deepEqual([run.battlefields[0].warId, run.battlefields[0].openedDate], ["war-of-the-story", "2024-03-03"]);
  // And one the story opened first is simply the war the order is given in.
  const first = runFronts(peace(world, { moments: [{ ...told, day: 1 }, order(2, "border: Aland / Borduria", "Aland", "advance")] }));
  assert.deepEqual([first.starts, first.battlefields.length, first.battlefields[0].warId], [[], 1, "war-of-the-story"]);
});

test("a country already fighting a war that attacks another begins a war with it alone", () => {
  const world = sheet();
  const run = runFronts(frontInput(world, { days: 10, moments: [order(2, "border: Aland / Neutralia", "Aland", "advance")] }));
  // A war of its own between the two: Neutralia is at war with Aland, who attacked it, and with nobody else.
  assert.deepEqual(run.joins, []);
  assert.deepEqual(run.starts, [{ day: 2, date: "2024-03-03", warId: "war-aland-neutralia-2024-03-03", attacker: "Aland", defender: "Neutralia" }]);
  const first = run.battlefields.find((field) => field.warId === "war-1");
  const second = run.battlefields.find((field) => field.warId === "war-aland-neutralia-2024-03-03");
  // The war Aland was fighting is as it was: Borduria has gained no ally and Neutralia no enemy but Aland.
  assert.deepEqual(first.sides, [["Aland"], ["Borduria"]]);
  assert.deepEqual(second.sides, [["Aland"], ["Neutralia"]]);
  assert.equal(second.status, "active");
  assert.ok(second.log.some((entry) => entry.k === "attacked" && entry.at === "country: Neutralia"));
  // Its own ally it cannot attack: the order is no order.
  const allied = frontInput(world, { days: 6, wars: [{ id: "war-1", status: "active", sideA: ["Aland", "Neutralia"], sideB: ["Borduria"] }], moments: [order(2, "border: Aland / Neutralia", "Aland", "advance", { ref: 4 })] });
  const refused = runFronts(allied);
  assert.deepEqual([refused.starts, refused.joins], [[], []]);
  assert.ok(refused.notes.some((note) => note.kind === "not-at-war" && note.ref === 4), JSON.stringify(refused.notes));
  // Nor is a ceasefire broken by an order: that is the ledger's to end.
  const frozen = runFronts(frontInput(world, { days: 6, wars: [{ id: "war-1", status: "ceasefire", sideA: ["Aland"], sideB: ["Borduria"] }], moments: [order(2, "border: Aland / Borduria", "Aland", "advance", { ref: 6 })] }));
  assert.deepEqual(frozen.starts, []);
});

test("a transporter sent in peace to another country's land is an attack: the war begins where its troops are put down", () => {
  const ports = [{ name: "Alba", lng: 23.5, lat: 51.5, capital: true }, { name: "Brod", lng: 30.5, lat: 51.5, capital: true }];
  const world = syntheticMap({ layout: ["~~~~~~~~~~~~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~AAA~~~~BBB~", "~~~~~~~~~~~~"], legend, west: 20, north: 54, step: 1, cities: ports, key: "apart in peace" });
  const sent = orderTransport([], { medium: "sea", owner: "Borduria", to: { name: "city: Alba" }, raise: 30, battlefield: "Operation Nightfall" }, { date: "2024-03-01", year: 2024 });
  assert.equal(sent.error, undefined);
  // The day it sets out nobody is at war: it is on its way, bound for Aland's land.
  const out = runFronts(peace(world, { days: 0, transports: sent.transports }));
  assert.deepEqual(out.transports.map((entry) => entry.status), ["ordered"]);
  const run = runFronts(peace(world, { days: 6, transports: sent.transports }));
  assert.deepEqual(run.voyages.map((voyage) => [voyage.k, voyage.at ?? ""]), [["sailed", ""], ["invaded", "country: Aland"], ["landed", "city: Alba"]]);
  assert.equal(run.voyages[1].opened, true, "a war that began with it, not one it joined");
  // The war begins on the day the troops come ashore, between the two, and its battlefield is the landing.
  const landedOn = run.voyages[2].d;
  assert.deepEqual(run.starts, [{ day: run.voyages[2].day, date: landedOn, warId: `war-borduria-aland-${landedOn}`, attacker: "Borduria", defender: "Aland" }]);
  const [field] = run.battlefields;
  assert.deepEqual([field.name, field.status, field.warId], ["Operation Nightfall", "active", `war-borduria-aland-${landedOn}`]);
  assert.equal(live(field, 0), 30, "the troops it carried");
  assert.ok(live(field, 1) > 0, "and the country attacked stands to");
  assert.deepEqual(field.log.map((entry) => entry.k), ["attacked", "landed"]);
  assert.deepEqual(run.transports.map((entry) => [entry.status, entry.warId]), [["landed", `war-borduria-aland-${landedOn}`]]);
  // Nobody hunts what nobody is at war with: a fleet of Aland's in its way lets it by.
  const fleet = [{ id: "u1", name: "Home Fleet", type: "naval", ownerCode: "Aland", lng: 25.5, lat: 51.5, strength: 100 }];
  const watched = runFronts(peace(world, { days: 6, transports: sent.transports, units: fleet }));
  assert.equal(watched.voyages.some((voyage) => voyage.k === "intercepted" || voyage.k === "lost"), false);
  assert.deepEqual(watched.starts, run.starts);
  // Bound for its own land, or with a ceasefire between the two, nothing sails.
  const home = orderTransport([], { medium: "sea", owner: "Borduria", to: { name: "city: Brod" }, raise: 6 }, { date: "2024-03-01", year: 2024 });
  assert.deepEqual(runFronts(peace(world, { days: 3, transports: home.transports })).transports.map((entry) => [entry.status, entry.note]), [["refused", "no-war"]]);
  const truce = runFronts(peace(world, { days: 3, transports: sent.transports, wars: [{ id: "war-1", status: "ceasefire", sideA: ["Aland"], sideB: ["Borduria"] }] }));
  assert.deepEqual(truce.transports.map((entry) => [entry.status, entry.note]), [["refused", "no-war"]]);
});

// "Border clashes, minor incidents and so forth also just cause war fronts to
// happen; have it so border fronts are for all war / serious conflicts."
test("an attack that is no real offensive is no war: nothing opens, and the run says why", () => {
  for (const effort of [undefined, "token", "limited"]) {
    const world = sheet();
    const across = runFronts(peace(world, { moments: [order(2, "border: Aland / Borduria", "Aland", "advance", { ref: 2, effort })] }));
    assert.deepEqual([across.starts, across.battlefields], [[], []], String(effort));
    assert.deepEqual(across.notes, [{ kind: "minor-attack", battlefield: "border: Aland / Borduria", side: "Aland", ref: 2 }]);
    // Aimed at a place the other holds, on a battlefield nobody has: the same.
    const at = runFronts(peace(world, { moments: [order(2, "Operation Dawn", "Aland", "spearhead", { ref: 5, objective: "city: Brod", effort })] }));
    assert.deepEqual([at.starts, at.battlefields], [[], []]);
    assert.deepEqual(at.notes.map((note) => [note.kind, note.side]), [["minor-attack", "Aland"]]);
  }
  // A person's own order is that person's decision: given through the skip's function, or a line for the country they play.
  const world = sheet();
  const given = runFronts(peace(world, { moments: [order(2, "border: Aland / Borduria", "Aland", "advance", { effort: undefined, given: true })] }));
  assert.deepEqual(given.starts.map((start) => [start.attacker, start.defender]), [["Aland", "Borduria"]]);
  const played = runFronts(peace(world, { players: ["Aland"], moments: [order(2, "border: Aland / Borduria", "Aland", "advance", { effort: undefined })] }));
  assert.deepEqual(played.starts.map((start) => [start.attacker, start.defender]), [["Aland", "Borduria"]]);
  // And a war the story opens in its own ledger the same period is that war, whatever the order's effort.
  const told = runFronts(peace(world, { moments: [
    order(2, "border: Aland / Borduria", "Aland", "advance", { effort: undefined }),
    { day: 4, type: "war", op: "start", warId: "war-told", names: ["Aland"], opponents: ["Borduria"], title: "The Dawn War" },
  ] }));
  assert.deepEqual([told.starts, told.battlefields.map((record) => [record.warId, record.status])], [[], [["war-told", "active"]]]);
});
