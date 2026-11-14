/*! Open Historia — battlefields and fronts: the air strikes the war room orders: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/airStrike.test.js
//
// "make it so in the war room you can Deploy Aircraft ... you should be able to
// bomb enemy troops (your troops can get caught in the bombing if your not
// careful) or you can bomb buildings and things your opponents have built or
// cities ... make it so they can be intercepted and if they are, the
// "fighters" in the air unit have a simulated battle" (the owner, 2026-11-01).

import test from "node:test";
import assert from "node:assert/strict";

import {
  AIR_BLAST_KM,
  AIR_FLAK,
  AIR_FLAK_MODERN,
  AIR_STRIKE_RADIUS_LEAST,
  AIR_STRIKE_RADIUS_MOST,
  AIR_STRIKE_RADIUS_STEP,
  AIR_STRIKE_TOLD_NARROW,
  AIR_STRIKE_TOLD_WIDE,
  AIR_VISUAL_SPREAD_KM,
  radiusConcentration,
  strikeRadiusOf,
  airStrikeVisuals,
  airStrikesBlock,
  airWarLine,
  bombTroops,
  cityLosses,
  fightersShareOf,
  normalizeAirStrikeOrders,
  normalizeAirStrikes,
  resolveAirStrikes,
  structureAfter,
  wearinessFromStrikes,
  withTroopHits,
  withTurnAirStrikes,
} from "./airStrike.js";
import { airUnitsOf, applyAirStrikeOp, cleanAirStrikeOp, strikableStructures } from "./airStrikeOps.js";
import { runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { withTurnWeariness } from "../warWeariness.js";

const WAR = { id: "war-1", title: "The War", status: "active", sideA: ["Aland"], sideB: ["Borduria"] };
const air = (id, ownerCode, extra = {}) => ({ id, name: id, type: "air", ownerCode, strength: 100, lng: 21, lat: 51, ...extra });
const order = (extra = {}) => ({ id: "s1", unit: "bombers", owner: "Aland", kind: "city", lng: 23, lat: 51, target: "Brod", country: "Borduria", ...extra });
const fly = (units, orders = [order()], extra = {}) => resolveAirStrikes({ orders, units, wars: [WAR], seed: "campaign|2|2024-03-01", era: 3, date: "2024-03-01", ...extra });

// What an air unit flies is its airRole, never the words of its composition or name: "120 chasseurs" gave half
// where "120 fighters" gave all (the owner, 2026-11-13: no keywording anywhere). A unit that says none flies the
// mixed share, whatever language it is described in.
test("an air unit's fighters: as its airRole says, else half, and never by its words", () => {
  assert.equal(fightersShareOf({ airRole: "fighter" }), 0.85);
  assert.equal(fightersShareOf({ airRole: "Bomber" }), 0.15);
  assert.equal(fightersShareOf({ airRole: "mixed" }), 0.5);
  assert.equal(fightersShareOf({ airRole: "interceptor" }), 0.5, "not a role the game has");
  for (const unit of [
    { composition: "120 fighters, 40 bombers" },
    { composition: "120 chasseurs, 40 bombardiers" },
    { name: "1st Fighter Wing" },
    { name: "1re escadre de chasse" },
    { name: "Strategic Bomber Command" },
    { name: "Air Group 7" },
  ]) {
    assert.equal(fightersShareOf(unit), 0.5, JSON.stringify(unit));
  }
  assert.equal(fightersShareOf({ name: "1re escadre de chasse", airRole: "fighter" }), fightersShareOf({ name: "1st Fighter Wing", airRole: "fighter" }));
});

test("a strike nobody rises against bombs unopposed, and loses only what the flak takes", () => {
  const { strikes, moments, unitChanges } = fly([air("bombers", "Aland", { name: "1st Bomber Wing", airRole: "bomber" })], undefined, { peopleOf: () => 5000000 });
  assert.equal(strikes.length, 1);
  const [strike] = strikes;
  assert.equal(strike.outcome, "unopposed");
  assert.equal(strike.intercepted.length, 0);
  assert.equal(strike.lost, Math.round(AIR_FLAK.city * AIR_FLAK_MODERN));
  assert.ok(strike.power > 80, String(strike.power));
  assert.ok(strike.dead > 0 && strike.weariness > 0, "a city struck: its people killed, its country wearier");
  assert.deepEqual(unitChanges, [{ unitId: "bombers", strength: 100 - strike.lost }]);
  // Its bombs fall on whatever troops stand under the city, at half the weight of a strike on troops.
  assert.equal(moments.length, 1);
  assert.equal(moments[0].type, "airstrike");
  assert.equal(moments[0].day, 0);
});

test("the same strikes give the same air battle, to the last figure; another turn's seed throws other dice", () => {
  const units = [air("bombers", "Aland", { name: "Bomber Wing", airRole: "bomber" }), air("guard", "Borduria", { name: "Fighter Wing", airRole: "fighter", lng: 24 }), air("guard2", "Borduria", { name: "Fighter Wing 2", airRole: "fighter", lng: 24.5 })];
  const once = fly(units);
  assert.deepEqual(fly(units), once);
  assert.deepEqual(fly(structuredClone(units)), once, "nothing kept between runs");
  const seeds = ["a", "b", "c", "d", "e", "f"].map((seed) => JSON.stringify(fly(units, undefined, { seed }).strikes));
  assert.ok(new Set(seeds).size > 1, "the dice are the seed's");
});

test("intercepted, the fighters fight it out: bombers alone against a strong guard turn back, an escorted raid on a weak one gets through", () => {
  const guard = (count, strength = 100) => Array.from({ length: count }, (_, at) => air(`guard-${at}`, "Borduria", { name: `Fighter Wing ${at}`, airRole: "fighter", lng: 23.5, strength }));
  // A small raid of bombers alone under three wings of fighters.
  const mauled = fly([air("bombers", "Aland", { name: "Bomber Wing", airRole: "bomber", strength: 20 }), ...guard(3)]);
  assert.equal(mauled.strikes[0].outcome, "turned back");
  assert.equal(mauled.strikes[0].power, 0, "it drops nothing");
  assert.equal(mauled.moments.length, 0);
  assert.ok(mauled.strikes[0].intercepted.length >= 1);
  assert.equal(mauled.strikes[0].dead, undefined);
  // A strong escorted raid against one weak wing of fighters.
  const escorted = fly([air("bombers", "Aland", { name: "Air Group", composition: "60 fighters, 40 bombers", airRole: "mixed" }), ...guard(1, 25)]);
  assert.ok(["through", "unopposed"].includes(escorted.strikes[0].outcome), escorted.strikes[0].outcome);
  // What the fighters fought costs both sides: the raid, and the guard that rose.
  const fought = fly([air("bombers", "Aland", { name: "Air Group", strength: 80 }), ...guard(2, 60)]);
  const [strike] = fought.strikes;
  assert.ok(strike.intercepted.length > 0, "found by somebody");
  assert.ok(["through", "partly", "turned back"].includes(strike.outcome));
  assert.ok(strike.lost > 0 && strike.intercepted.some((entry) => entry.lost > 0));
  // The losses of both are changes to their air units.
  assert.ok(fought.unitChanges.some((change) => change.unitId === "bombers" && change.strength === 80 - strike.lost));
  const guarded = fought.unitChanges.filter((change) => change.unitId.startsWith("guard-"));
  assert.equal(guarded.length, strike.intercepted.filter((entry) => entry.lost > 0).length);
  for (const change of guarded) assert.ok(change.strength < 60);
  // A guard out of reach, or not at war, does not rise.
  const far = fly([air("bombers", "Aland", { name: "Bomber Wing", airRole: "bomber" }), air("guard", "Borduria", { name: "Fighter Wing", airRole: "fighter", lng: 60, lat: 30 })]);
  assert.equal(far.strikes[0].outcome, "unopposed");
  const neutral = fly([air("bombers", "Aland", { name: "Bomber Wing", airRole: "bomber" }), air("guard", "Cascadia", { name: "Fighter Wing", airRole: "fighter", lng: 23.5 })]);
  assert.equal(neutral.strikes[0].outcome, "unopposed");
});

test("a strike out of reach, or of an air unit gone, is not flown", () => {
  const far = fly([air("bombers", "Aland")], [order({ lng: 80, lat: 10 })]);
  assert.equal(far.strikes[0].outcome, "out of reach");
  assert.deepEqual(far.unitChanges, []);
  const gone = fly([], [order()]);
  assert.equal(gone.strikes[0].outcome, "gone");
  // Before there were aircraft, nothing reaches anywhere.
  assert.equal(fly([air("bombers", "Aland")], [order()], { era: 1 }).strikes[0].outcome, "out of reach");
  assert.equal(airStrikesBlock([...far.strikes, ...gone.strikes]), "", "neither is told");
});

test("a structure struck is damaged, and destroyed by a second strike or a heavy one; a second strike in a turn finds what the first left", () => {
  assert.equal(structureAfter("active", 10), "active");
  assert.equal(structureAfter("active", 40), "damaged");
  assert.equal(structureAfter("damaged", 40), "destroyed");
  assert.equal(structureAfter("active", 80), "destroyed");
  const markers = [{ id: "m1", name: "Fort Brod", ownerCode: "Borduria", lng: 23, lat: 51, status: "active" }];
  const units = [air("b1", "Aland", { name: "Bomber Wing", airRole: "bomber", strength: 40 }), air("b2", "Aland", { name: "Bomber Wing 2", airRole: "bomber", strength: 40 })];
  const both = fly(units, [order({ id: "s1", unit: "b1", kind: "structure", marker: "m1", target: "Fort Brod" }), order({ id: "s2", unit: "b2", kind: "structure", marker: "m1", target: "Fort Brod" })], { markers });
  assert.deepEqual(both.strikes.map((strike) => strike.status), ["damaged", "destroyed"]);
});

test("a city struck: its people killed and its economy hurt by how hard, and its country wearier for it", () => {
  const full = cityLosses({ power: 100, people: 1000000 });
  assert.equal(full.dead, 1000);
  assert.ok(Math.abs(full.gdpShare - 0.002) < 1e-12);
  assert.equal(full.weariness, 8);
  assert.equal(cityLosses({ power: 50, countryPeople: 10000000 }).dead, 100, "a city whose people are unknown is a share of its country's");
  const strikes = [{ id: "air:a", owner: "Aland", kind: "city", outcome: "unopposed", lng: 1, lat: 2, country: "Borduria", power: 90, weariness: 7.2 }];
  assert.deepEqual(wearinessFromStrikes(strikes), [{ country: "Borduria", value: 7.2 }]);
  const wars = [WAR];
  const after = withTurnWeariness([], { days: 30, wars, bombed: wearinessFromStrikes(strikes) });
  const before = withTurnWeariness([], { days: 30, wars });
  const of = (list, name) => list.find((entry) => entry.country === name)?.value ?? 0;
  assert.ok(Math.abs(of(after, "Borduria") - of(before, "Borduria") - 7.2) < 0.11, `${of(after, "Borduria")} against ${of(before, "Borduria")}`);
  assert.equal(of(after, "Aland"), of(before, "Aland"));
});

// ---- on the battlefield --------------------------------------------------------------------

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "air strike" });
const hold = () => ({ order: "hold", sector: "all" });
const fight = (moments = []) => runFronts(frontInput(sheet(), { arenas: new Map(), staff: true, troops: 1, days: 1, strengthOf: () => 4, staffPolicy: hold, moments }));
const strengthOn = (result) => result.battlefields[0].brief.strength.map((side) => side.n * side.pct);

test("the bombs fall on every troop under them, the striker's own too: friendly fire", () => {
  const plain = fight();
  const bombed = fight([{ type: "airstrike", day: 0, ref: "air:s1", owner: "Aland", lng: 24, lat: 51, km: 120, hit: 40, at: "the line" }]);
  const note = bombed.notes.find((entry) => entry.kind === "airstrike");
  assert.ok(note, "the run says what the bombs did");
  assert.equal(note.ref, "air:s1");
  const own = note.hits.find((hit) => hit.own);
  const theirs = note.hits.find((hit) => !hit.own);
  assert.equal(theirs?.country, "Borduria");
  assert.equal(own?.country, "Aland", "the striker's own troops near the line are caught under the bombs");
  assert.ok(own.n > 0 && own.lost > 0 && theirs.n > 0 && theirs.lost > 0);
  const [a, b] = [strengthOn(plain), strengthOn(bombed)];
  assert.ok(b[0] < a[0] && b[1] < a[1], `${b} against ${a}`);
  // And the battlefield's log tells it.
  assert.ok(bombed.news.some((entry) => entry.k === "bombed" && entry.at === "the line"));
  // The same moment is the same war.
  assert.deepEqual(fight([{ type: "airstrike", day: 0, ref: "air:s1", owner: "Aland", lng: 24, lat: 51, km: 120, hit: 40, at: "the line" }]).notes, bombed.notes);
  // Far from any battlefield, nothing is hit and nothing noted.
  const astray = fight([{ type: "airstrike", day: 0, ref: "air:s2", owner: "Aland", lng: 60, lat: 10, km: 20, hit: 40, at: "nowhere" }]);
  assert.equal(astray.notes.some((entry) => entry.kind === "airstrike"), false);
});

test("bombTroops: within the blast, the nearer the harder, the dug in the less; withTroopHits puts the hits on their strike", () => {
  const troops = [[{ x: 0.5, y: 0.5, strength: 80, owner: 0, dug: false }, { x: 3.5, y: 0.5, strength: 80, owner: 0, dug: false }], [{ x: 1.5, y: 0.5, strength: 80, owner: 0, dug: true }]];
  const run = {
    input: { map: { flat: true, scale: 10 } },
    notes: [],
    dateOf: () => "2024-03-01",
    battles: [{ status: "active", name: "The Front", sides: [["Aland"], ["Borduria"]], troops, field: { cols: 10, rows: 10 }, log: [], works: null, place: { toCell: (lng, lat) => [lng, lat], toLngLat: (x, y) => [x, y] } }],
  };
  bombTroops(run, { lng: 0.5, lat: 0.5, km: 20, hit: 20, owner: "Aland", ref: "air:s1", at: "the line" }, 0);
  assert.equal(troops[0][0].strength, 60, "at the middle: the whole of it");
  assert.equal(troops[0][1].strength, 80, "30 km off: out of the blast");
  assert.ok(Math.abs(troops[1][0].strength - (80 - 20 * 0.75 * 0.55)) < 1e-9, "10 km off, dug in: three quarters of it, the less for its works");
  assert.deepEqual(run.notes[0].hits.map((hit) => [hit.country, hit.n, hit.own === true]), [["Aland", 1, true], ["Borduria", 1, false]]);
  const told = withTroopHits([{ id: "air:s1", owner: "Aland", kind: "troops", outcome: "through", lng: 0.5, lat: 0.5, hits: [] }], run.notes);
  assert.deepEqual(told[0].hits.map((hit) => hit.country), ["Aland", "Borduria"]);
});

// ---- the strike radius ---------------------------------------------------------------------

test("the strike radius: anywhere from half to twice, in fine steps, the default the strike as it was, the bombs concentrated by 1 / radius²", () => {
  // "smaller radii result in greater lethality, while larger radii reduce the overall threat level", then "make the
  // bombing radius be a slider not buttons" (the owner, 2026-11-09).
  assert.deepEqual([AIR_STRIKE_RADIUS_LEAST, AIR_STRIKE_RADIUS_MOST, AIR_STRIKE_RADIUS_STEP], [0.5, 2, 0.05]);
  assert.equal(strikeRadiusOf(undefined), 1, "an order saved before there was a radius");
  assert.equal(strikeRadiusOf("bogus"), 1);
  assert.equal(strikeRadiusOf(""), 1);
  assert.equal(strikeRadiusOf(-2), 1);
  assert.equal(strikeRadiusOf(0), 1);
  // Held between the least and the most.
  assert.equal(strikeRadiusOf(0.1), 0.5);
  assert.equal(strikeRadiusOf(9), 2);
  // Anywhere between, rounded to the nearest step, and the number it reads as: the slider sends a string.
  assert.equal(strikeRadiusOf(0.6), 0.6);
  assert.equal(strikeRadiusOf("1.35"), 1.35);
  assert.equal(strikeRadiusOf(0.6249), 0.6);
  assert.equal(strikeRadiusOf(0.63), 0.65);
  assert.equal(strikeRadiusOf(1.1234), 1.1);
  for (let index = 0; index <= 30; index += 1) {
    const step = 0.5 + index * 0.05;
    const kept = strikeRadiusOf(step);
    assert.equal(String(kept).length <= 4, true, `${step} is kept as ${kept}`);
    assert.equal(strikeRadiusOf(kept), kept, "kept again, it is the same");
  }
  // The five radii the war room once offered as keys are kept as they were: orders saved then are still good.
  for (const step of [0.5, 0.75, 1, 1.5, 2]) assert.equal(strikeRadiusOf(step), step);
  assert.equal(radiusConcentration(0.5), 4);
  assert.equal(radiusConcentration(1), 1);
  assert.equal(radiusConcentration(2), 0.25);
  assert.ok(Math.abs(radiusConcentration(1.25) - 0.64) < 1e-12);
  // Kept on an order and a strike only when it is not the default: old saves and default orders are unchanged.
  assert.equal("radius" in normalizeAirStrikeOrders([order()])[0], false);
  assert.equal("radius" in normalizeAirStrikeOrders([order({ radius: 1 })])[0], false);
  assert.equal("radius" in normalizeAirStrikeOrders([order({ radius: 1.01 })])[0], false, "within a step of the default is the default");
  assert.equal(normalizeAirStrikeOrders([order({ radius: 2 })])[0].radius, 2);
  assert.equal(normalizeAirStrikeOrders([order({ radius: 0.75 })])[0].radius, 0.75, "an order saved with one of the old keys");
  assert.equal(normalizeAirStrikeOrders([order({ radius: 1.15 })])[0].radius, 1.15);
  assert.equal(normalizeAirStrikes([{ id: "x", owner: "Aland", kind: "city", outcome: "through", lng: 1, lat: 2, radius: 0.85 }])[0].radius, 0.85);
});

test("the story tells a strike narrow or wide only well off the usual circle", () => {
  assert.deepEqual([AIR_STRIKE_TOLD_NARROW, AIR_STRIKE_TOLD_WIDE], [0.8, 1.25]);
  const told = (radius) => airStrikesBlock([{ id: "air:x", owner: "Aland", unit: "1st Bomber Wing", kind: "city", target: "Brod", country: "Borduria", outcome: "unopposed", lng: 1, lat: 2, ...(radius ? { radius } : {}) }]);
  for (const radius of [0.5, 0.75, 0.8]) assert.match(told(radius), /its bombs concentrated on a narrow area/, String(radius));
  for (const radius of [1.25, 1.5, 2]) assert.match(told(radius), /its bombs spread over a wide area/, String(radius));
  for (const radius of [undefined, 0.85, 0.95, 1.05, 1.2]) assert.doesNotMatch(told(radius), /narrow area|wide area/, String(radius));
});

test("a smaller radius is deadlier to what is under it; a larger one reaches farther and hurts each thing less", () => {
  const bombers = [air("bombers", "Aland", { name: "1st Bomber Wing", airRole: "bomber" })];
  const at = (radius, kind = "troops", extra = {}) => fly(bombers, [order({ kind, ...(radius ? { radius } : {}), ...extra })], { peopleOf: () => 5000000, ...extra });
  const plain = at(undefined);
  const tight = at(0.5);
  const wide = at(2);
  // The same raid flies the same: the radius changes only where and how hard its bombs fall.
  assert.deepEqual([tight.strikes[0].outcome, tight.strikes[0].power, tight.strikes[0].lost], [plain.strikes[0].outcome, plain.strikes[0].power, plain.strikes[0].lost]);
  assert.equal(plain.moments[0].km, AIR_BLAST_KM[3]);
  assert.equal(tight.moments[0].km, AIR_BLAST_KM[3] * 0.5);
  assert.equal(wide.moments[0].km, AIR_BLAST_KM[3] * 2);
  assert.ok(Math.abs(tight.moments[0].hit - plain.moments[0].hit * 4) < 1e-9);
  assert.ok(Math.abs(wide.moments[0].hit - plain.moments[0].hit / 4) < 1e-9);
  assert.equal(tight.strikes[0].radius, 0.5, "the strike remembers its radius, for the map");
  assert.equal("radius" in plain.strikes[0], false);
  // A city: fewer killed, less weariness, the wider the bombs fall.
  const [cityTight, cityPlain, cityWide] = [0.5, undefined, 2].map((radius) => at(radius, "city", { people: 2000000 }).strikes[0]);
  assert.ok(cityTight.dead > cityPlain.dead && cityPlain.dead > cityWide.dead, `${cityTight.dead} ${cityPlain.dead} ${cityWide.dead}`);
  assert.ok(cityTight.weariness >= cityPlain.weariness && cityPlain.weariness > cityWide.weariness);
  // A structure: a light raid only damages it at the usual radius, destroys it concentrated, leaves it standing spread.
  const markers = [{ id: "m1", name: "Fort Brod", ownerCode: "Borduria", lng: 23, lat: 51, status: "active" }];
  const light = [air("bombers", "Aland", { name: "1st Bomber Wing", strength: 30 })];
  const fort = (radius) => fly(light, [order({ kind: "structure", marker: "m1", target: "Fort Brod", ...(radius ? { radius } : {}) })], { markers }).strikes[0].status;
  assert.deepEqual([fort(0.5), fort(undefined), fort(2)], ["destroyed", "damaged", "active"]);
  // On the battlefield: a tight strike hurts the troops at its middle more and reaches fewer.
  const moment = (radius) => ({ type: "airstrike", day: 0, ref: "air:s1", owner: "Aland", lng: 24, lat: 51, km: 120 * radius, hit: 40 / (radius * radius), at: "the line" });
  const count = (result) => result.notes.filter((entry) => entry.kind === "airstrike").flatMap((entry) => entry.hits).reduce((sum, hit) => sum + hit.n, 0);
  const lost = (result) => result.notes.filter((entry) => entry.kind === "airstrike").flatMap((entry) => entry.hits).reduce((sum, hit) => sum + hit.lost, 0) / Math.max(1, count(result));
  const [narrow, usual, broad] = [0.5, 1, 2].map((radius) => fight([moment(radius)]));
  assert.ok(count(narrow) <= count(usual) && count(usual) <= count(broad), `${count(narrow)} ${count(usual)} ${count(broad)}`);
  assert.ok(lost(narrow) > lost(usual) && lost(usual) > lost(broad), `${lost(narrow)} ${lost(usual)} ${lost(broad)}`);
  // The story is told how the bombs fell, where it was not the usual way; and the map scatters them as wide.
  assert.match(airStrikesBlock(tight.strikes), /its bombs concentrated on a narrow area/);
  assert.match(airStrikesBlock(wide.strikes), /its bombs spread over a wide area/);
  assert.doesNotMatch(airStrikesBlock(plain.strikes), /narrow area|wide area/);
  assert.equal(airStrikeVisuals(wide.strikes)[0].spreadKm, AIR_VISUAL_SPREAD_KM * 2);
  assert.equal("spreadKm" in airStrikeVisuals(plain.strikes)[0], false);
});

// ---- what is kept and told -----------------------------------------------------------------

test("what is kept: one strike a unit, the last given; the strikes of the last rounds", () => {
  const orders = normalizeAirStrikeOrders([order({ id: "a" }), order({ id: "b" }), { id: "c" }]);
  assert.deepEqual(orders.map((entry) => entry.id), ["b"]);
  const kept = withTurnAirStrikes([{ id: "air:old", owner: "Aland", kind: "city", outcome: "through", lng: 1, lat: 2, round: 1 }], [{ id: "air:new", owner: "Aland", kind: "city", outcome: "through", lng: 1, lat: 2, round: 5 }], 5);
  assert.deepEqual(kept.map((entry) => entry.id), ["air:new"]);
  assert.equal(normalizeAirStrikes([{ id: "x", owner: "A", kind: "bogus", outcome: "through", lng: 1, lat: 2 }]).length, 0);
});

test("the story is told each strike by name, and the map plays it as a bombing run", () => {
  const units = [air("bombers", "Aland", { name: "1st Bomber Wing", airRole: "bomber" }), air("guard", "Borduria", { name: "Home Fighter Wing", lng: 23.2 })];
  const flown = withTroopHits(fly(units, [order({ kind: "troops", target: "city: Brod", battlefield: "The Brod Front", country: "Borduria" })]).strikes, [
    { kind: "airstrike", ref: "air:s1", battlefield: "The Brod Front", hits: [{ country: "Borduria", n: 3, lost: 40 }, { country: "Aland", n: 1, lost: 9, own: true }] },
  ]);
  const block = airStrikesBlock(flown);
  assert.match(block, /^\[Air Strikes This Period\]\n/);
  assert.match(block, /Aland's 1st Bomber Wing struck Borduria's troops on The Brod Front near city: Brod/);
  if (flown[0].outcome !== "turned back") {
    assert.match(block, /it hit 3 formations of Borduria's/);
    assert.match(block, /1 of Aland's own/);
  }
  assert.doesNotMatch(block, /bombers"|guard"|air:s1|strike-/, "names, never ids");
  const [visual] = airStrikeVisuals(flown);
  assert.equal(visual.weapon, "bombing run");
  assert.deepEqual([visual.from.lng, visual.from.lat, visual.to.lng, visual.to.lat], [21, 51, 23, 51]);
  assert.match(airWarLine(flown, "Aland"), /it flew 1 air strike lately/);
  assert.match(airWarLine(flown, "Borduria"), /it was struck from the air 1 time/);
  assert.equal(airWarLine(flown, "Cascadia"), "");
});

// ---- the war room's orders ------------------------------------------------------------------

const world = () => {
  const result = fight();
  return {
    wars: [WAR],
    battlefields: result.battlefields,
    units: [air("bombers", "Aland", { name: "1st Bomber Wing", airRole: "bomber" }), air("theirs", "Borduria"), { id: "tanks", type: "armor", ownerCode: "Aland", strength: 90, lng: 21, lat: 51 }, air("new", "Aland", { status: "pending" })],
    markers: [{ id: "m1", name: "Fort Brod", ownerCode: "Borduria", lng: 25, lat: 51, status: "active" }, { id: "m2", name: "Old Keep", ownerCode: "Borduria", lng: 25, lat: 51, status: "destroyed" }, { id: "m3", name: "Our Fort", ownerCode: "Aland", lng: 21, lat: 51, status: "active" }],
  };
};
const ask = (op, extra = {}) => applyAirStrikeOp(world(), cleanAirStrikeOp(op), { player: "Aland", date: "2024-03-01", round: 2, ...extra });

test("the war room's orders: only the asker's own air units, at what an enemy has, within reach", () => {
  const w = world();
  assert.deepEqual(airUnitsOf(w, "Aland").map((unit) => [unit.id, unit.pending]), [["bombers", false], ["new", true]]);
  assert.deepEqual(strikableStructures(w, "Aland").map((marker) => marker.name), ["Fort Brod"]);
  const city = ask({ op: "airstrike", unit: "bombers", kind: "city", to: [25, 51], target: "Brod", country: "borduria", people: 50000 });
  assert.equal(city.error, undefined);
  assert.deepEqual([city.order.kind, city.order.target, city.order.country, city.order.people, city.order.owner], ["city", "Brod", "Borduria", 50000, "Aland"]);
  const structure = ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m1" });
  assert.deepEqual([structure.order.target, structure.order.country, structure.order.lng], ["Fort Brod", "Borduria", 25]);
  // One strike a unit: a second replaces the first; and it can be called off.
  const again = applyAirStrikeOp(city.world, { op: "airstrike", unit: "bombers", kind: "structure", marker: "m1" }, { player: "Aland", date: "2024-03-01" });
  assert.deepEqual(again.world.airStrikeOrders.map((entry) => entry.kind), ["structure"]);
  assert.deepEqual(applyAirStrikeOp(again.world, { op: "unairstrike", unit: "bombers" }, { player: "Aland" }).world.airStrikeOrders, []);
  // On the battlefield the asker fights on, within its frame.
  const field = w.battlefields[0].name;
  assert.equal(ask({ op: "airstrike", unit: "bombers", kind: "troops", to: [24, 51], battlefield: field, target: "the line" }).order.battlefield, field);
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "troops", to: [60, 10], battlefield: field }).error, /not on a battlefield/);
  // Refused: another's unit, a unit not yet confirmed, not an air unit, a structure of its own or one destroyed,
  // a city of nobody it is at war with, too far, and in a scenario without air units.
  assert.match(ask({ op: "airstrike", unit: "theirs", kind: "city", to: [25, 51], target: "Brod", country: "Borduria" }).error, /not an air unit of yours/);
  assert.match(ask({ op: "airstrike", unit: "new", kind: "city", to: [25, 51], target: "Brod", country: "Borduria" }).error, /not in your order of battle/);
  assert.match(ask({ op: "airstrike", unit: "tanks", kind: "city", to: [25, 51], target: "Brod", country: "Borduria" }).error, /not an air unit of yours/);
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m3" }).error, /no structure of a country you are at war with/);
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m2" }).error, /no structure/);
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "city", to: [25, 51], target: "Brod", country: "Cascadia" }).error, /which city of a country you are at war with/);
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "city", to: [80, 10], target: "Far", country: "Borduria" }).error, /beyond 1st Bomber Wing's reach: [\d,]+ km, and it reaches 900 km/);
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "city", to: [25, 51], target: "Brod", country: "Borduria" }, { air: false }).error, /no air units/);
  // The map's chart says whose the city is, where it could be read.
  const chart = { holds: (country) => country !== "Borduria" };
  assert.match(ask({ op: "airstrike", unit: "bombers", kind: "city", to: [25, 51], target: "Brod", country: "Borduria" }, { chart }).error, /not held by a country you are at war with/);
  // What crosses the wire is an op's own fields and nothing else.
  assert.deepEqual(cleanAirStrikeOp({ op: "airstrike", unit: "u", kind: "city", to: [1, 2, 3], target: "T", extra: 1, people: -5 }), { op: "airstrike", unit: "u", kind: "city", to: [1, 2], target: "T" });
  assert.equal(cleanAirStrikeOp({ op: "bomb" }), null);
});

test("strikes measure by the map's projection, as the rest of the engine does", async () => {
  const fs = await import("node:fs");
  const read = (file) => fs.readFileSync(new URL(file, import.meta.url), "utf8");
  assert.match(read("../../Game/AI/frontTurn.js"), /measure: measureOptions\(map\),/);
  assert.match(read("./airStrike.js"), /const measure = measureOptions\(run\.input\?\.map\);/);
  assert.match(read("./airStrikeOps.js"), /measureOptions\(engineMapOf\(worldMeasureOf\(world\)\)\)/);
  assert.match(read("../../Game/GameUI/warRoom.jsx"), /measureOptions\(engineMapOf\(currentMapMeasure\(\)\)\)/);
});

// "why is the aircraft button greyed out" ... "then why do I see planes flying around" (the owner, 2026-11-03): a
// country with no air unit on the map still flies its air arm over its fronts (air.js AIR ARMS), and the war room
// strikes with it.
test("a country with no air unit of its own strikes with its front's air arm, and one with an air unit does not", async () => {
  const { airArmsOf, airArmsForOrders, AIR_ARM_UNIT } = await import("./airStrikeOps.js");
  const { battlefieldOn } = await import("./testKit.js");
  const { decodeTroops } = await import("./codec.js");
  const { projectorOf } = await import("./frame.js");
  const legend = { A: "Aland", B: "Borduria", "~": null };
  const sheet = syntheticMap({ layout: ["ABBBBB", "ABBBBB"], legend, west: 20, north: 51, step: 1, stepLat: 1 });
  const row = (lng, count) => Array.from({ length: count }, (_, index) => ({ lng, lat: 49 + ((index + 0.5) * 2) / count }));
  const record = battlefieldOn(sheet, { troops: [row(20.9, 8), row(21.1, 5)], pool: [100, 100] });
  const [front] = runFronts(frontInput(sheet, { battlefields: [record], days: 2, steering: { even: true, wander: 0 } })).battlefields;
  const world = { wars: [WAR], battlefields: [front], units: [] };
  // Its air arm over the front, based among its troops there.
  const [arm] = airUnitsOf(world, "Aland");
  assert.equal(arm.id, `${AIR_ARM_UNIT}${front.name}`);
  assert.equal(arm.name, `${front.name} air arm`);
  assert.equal(arm.strength, 100);
  assert.ok(arm.lng > 20 && arm.lng < 22 && arm.lat > 49 && arm.lat < 51, `${arm.lng}, ${arm.lat}`);
  // A strike on the enemy's troops there is ordered, and flown with it.
  const { toLngLat } = projectorOf(front.frame);
  const enemy = decodeTroops(front.troops[1]).find((troop) => troop.strength > 0);
  const done = applyAirStrikeOp(world, { op: "airstrike", unit: arm.id, kind: "troops", to: toLngLat(enemy.x, enemy.y), battlefield: front.name, target: "their line" }, { player: "Aland", date: "2024-03-01", round: 2 });
  assert.equal(done.error, undefined, done.error);
  assert.equal(done.order.unit, arm.id);
  const flown = fly([...world.units, ...airArmsForOrders(done.world)], done.world.airStrikeOrders);
  assert.equal(flown.strikes.length, 1);
  assert.equal(flown.strikes[0].unit, arm.name);
  assert.equal(flown.moments.length, 1);
  // A country with an air unit of its own flies that, and no arm.
  assert.deepEqual(airArmsOf({ ...world, units: [air("wing", "Aland")] }, "Aland"), []);
  assert.deepEqual(airUnitsOf({ ...world, units: [air("wing", "Aland")] }, "Aland").map((unit) => unit.id), ["wing"]);
  // Nor one whose air arm is worth nothing, nor one not fighting there.
  assert.deepEqual(airArmsOf({ ...world, polityOverrides: { Aland: { name: "Aland", military: { air: 0 } } } }, "Aland"), []);
  assert.deepEqual(airArmsOf(world, "Cisland"), []);
});

test("the strike radius in the war room's orders: carried by the op, held to its range and steps, none for the default", () => {
  const tight = ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m1", radius: 0.5 });
  assert.equal(tight.order.radius, 0.5);
  const plain = ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m1" });
  assert.equal("radius" in plain.order, false);
  assert.notEqual(tight.order.id, plain.order.id);
  // A radius off the old keys, as the slider sends it (a string), is ordered as it was set.
  const slid = ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m1", radius: "1.35" });
  assert.equal(slid.order.radius, 1.35);
  assert.notEqual(slid.order.id, tight.order.id);
  assert.equal(ask({ op: "airstrike", unit: "bombers", kind: "structure", marker: "m1", radius: 1.3500001 }).order.id, slid.order.id, "the same radius, the same order");
  assert.equal(cleanAirStrikeOp({ op: "airstrike", unit: "u", kind: "city", radius: 1.6 }).radius, 1.6);
  assert.equal(cleanAirStrikeOp({ op: "airstrike", unit: "u", kind: "city", radius: 1.62 }).radius, 1.6);
  assert.equal(cleanAirStrikeOp({ op: "airstrike", unit: "u", kind: "city", radius: 7 }).radius, 2);
  assert.equal("radius" in cleanAirStrikeOp({ op: "airstrike", unit: "u", kind: "city", radius: 1 }), false);
});
