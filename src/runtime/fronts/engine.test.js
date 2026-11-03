// Run: node --test src/runtime/fronts/engine.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { decodeTroops } from "./codec.js";
import { MAX_BATTLEFIELDS } from "./constants.js";
import { createFrontRun, runFronts } from "./engine.js";
import { normalizeBattlefields } from "./record.js";
import { applyFlips, enlarge, frontInput, syntheticMap } from "./syntheticMap.js";
import { battlefieldOn, readBattlefield } from "./testKit.js";
import { sideRadiusKm, sizeSides } from "./troops.js";

const legend = { A: "Aland", B: "Borduria", C: "Cisland", N: "Neutralia", "~": null };
const cities = [
  { name: "Alba", lng: 20.6, lat: 51.4, capital: true },
  { name: "Brod", lng: 23.3, lat: 51.2, capital: true },
  { name: "Mid", lng: 21.7, lat: 50.9 },
];
// Aland in the west, Borduria in the east, the sea to the south: a border 220 km long.
const sheet = (layout = ["AAABBB", "AAABBB", "AAABBB", "AAABBB", "~~~~~~"], options = {}) =>
  syntheticMap({ layout: enlarge(layout, 2), legend, west: 20, north: 52, step: 0.25, cities, ...options });

const withoutReplay = (battlefields) => battlefields.map(({ replay: _replay, ...rest }) => rest);
const order = (day, side, word, extra = {}) => ({ day, type: "order", battlefield: "Aland - Borduria front", side, order: word, sector: "all", ...extra });

test("a battlefield opens by itself where two sides at war touch, each side sized by its own strength", () => {
  const world = sheet();
  // Aland brings four points of strength and Borduria two: twelve counters a point.
  const sized = (aland, borduria) => frontInput(world, { days: 0, strengthOf: (name) => (name === "Aland" ? aland : borduria) });
  const result = runFronts(sized(4, 2));
  assert.equal(result.battlefields.length, 1);
  const [record] = result.battlefields;
  assert.equal(record.name, "Aland - Borduria front");
  assert.equal(record.status, "active");
  assert.equal(record.warId, "war-1");
  assert.deepEqual(record.sides, [["Aland"], ["Borduria"]]);
  assert.equal(record.openedDate, "2024-03-01");
  assert.deepEqual(result.flips, []);
  const seen = readBattlefield(record, world);
  const [ours, theirs] = seen.troops;
  assert.ok(Math.abs(record.brief.km - 222) < 12, `${record.brief.km} km of line`);
  assert.equal(ours.length, 48);
  assert.equal(theirs.length, 24);
  assert.deepEqual(record.pool, [48 * 30, 24 * 30]);
  assert.deepEqual(record.quality, [1, 1]);
  for (const troop of ours) {
    assert.equal(seen.holderAt(troop.lng, troop.lat), 0, "on its own side of the line");
    assert.ok(troop.lng > 21.05 && troop.lng < 21.5, `near the line (${troop.lng})`);
  }
  for (const troop of theirs) assert.ok(troop.lng > 21.5 && troop.lng < 21.95 && troop.strength === 100);
  // A modern force: three in ten armour, three in twenty artillery.
  assert.equal(ours.filter((troop) => troop.kind === 1).length, Math.round(ours.length * 0.3));
  assert.equal(ours.filter((troop) => troop.kind === 2).length, Math.round(ours.length * 0.15));
  // A great power and a middling one on so short a front: each has a counter
  // for every kilometre and a half of it and no more, and what one has over
  // the other is carried by its quality.
  const [crowded] = runFronts(sized(24, 13)).battlefields;
  const most = decodeTroops(crowded.troops[0]).length;
  assert.ok(most >= 140 && most <= 155 && Math.abs(most - crowded.brief.km / 1.5) <= 1, `${most} counters on ${crowded.brief.km} km`);
  assert.equal(decodeTroops(crowded.troops[1]).length, most);
  assert.deepEqual(crowded.quality, [1.5, 1]);
  // And a state too small for the least still has six, the worse for it.
  const [uneven] = runFronts(sized(0.2, 2)).battlefields;
  assert.deepEqual(uneven.troops.map((list) => decodeTroops(list).length), [6, 24]);
  assert.deepEqual(uneven.quality, [0.5, 1]);
  // On a line long enough for them: a great power fields hundreds, more or
  // fewer as its effort is, a middling one half as many, a small state a dozen or two.
  // ("By default have half as many troops as right now": these are half what they were, and a run
  // told to raise twice the usual, as this file's own runs are, raises the numbers of before.)
  assert.deepEqual(sizeSides(1500, [24, 13], ["major", "major"]), { counts: [144, 78], quality: [1, 1] });
  assert.deepEqual(sizeSides(1500, [24, 13], ["total", "token"]).counts, [202, 23]);
  assert.deepEqual(sizeSides(1500, [1.5, 1], ["major", "limited"]).counts, [9, 4]);
  assert.deepEqual(sizeSides(1500, [24, 13], ["major", "major"], 2), { counts: [288, 156], quality: [1, 1] });
  assert.deepEqual(sizeSides(1500, [24, 13], ["total", "token"], 2).counts, [400, 47]);
  assert.deepEqual(sizeSides(1500, [1.5, 1], ["major", "limited"], 2).counts, [18, 7]);
  // How wide a strip a troop takes follows from how close its side stands: nine
  // tenths of the line each has, never under 6 km nor over 16.
  assert.equal(sideRadiusKm(1500, 288), 6);
  assert.equal(sideRadiusKm(1500, 156), 0.9 * 1500 / 156);
  assert.equal(sideRadiusKm(1500, 18), 16);
  // What the game is handed is what its own check of the world would keep.
  assert.deepEqual(normalizeBattlefields(result.battlefields), result.battlefields);
  assert.equal(record.frames, undefined);
  assert.ok(record.replay && record.replay.names.length === 2);
  // Two sides that are not at war, or do not touch, open nothing.
  assert.deepEqual(runFronts(frontInput(world, { days: 3, wars: [] })).battlefields, []);
  assert.deepEqual(runFronts(frontInput(sheet(["AA~~BB", "AA~~BB"]), { days: 3 })).battlefields, []);
  assert.deepEqual(runFronts(frontInput(world, { days: 3, wars: [{ id: "w", status: "ceasefire", sideA: ["Aland"], sideB: ["Borduria"] }] })).battlefields, []);
});

test("a front nobody pushes is the same, to the saved string, after a year", () => {
  const world = sheet();
  const opened = runFronts(frontInput(world, { days: 0 })).battlefields;
  const next = (days) => runFronts(frontInput(world, { battlefields: opened, days, fromDate: "2024-03-01" }));
  const day = next(1);
  const year = next(365);
  assert.deepEqual(year.battlefields[0].field, opened[0].field);
  assert.deepEqual(day.battlefields[0].field, opened[0].field);
  assert.deepEqual(year.flips, []);
  assert.equal(year.stats.steps, 0, "nobody stepped forward");
  for (const side of [0, 1]) {
    const before = decodeTroops(opened[0].troops[side]);
    const after = decodeTroops(year.battlefields[0].troops[side]);
    assert.deepEqual(after.map(({ x, y }) => [x, y]), before.map(({ x, y }) => [x, y]), "nobody moved");
    // (How far a troop has dug is saved in sevenths: a half is saved as four of them.)
    assert.ok(after.every((troop) => troop.strength > 99 && troop.dig > 0.45 && troop.dig < 0.6), "they dug in as far as a hold allows");
  }
  assert.equal(year.battlefields[0].asOf, "2025-03-01");
  // And a third run from that year's end still saves the same field.
  const again = runFronts(frontInput(world, { battlefields: year.battlefields, days: 30, fromDate: "2025-03-01" }));
  assert.deepEqual(again.battlefields[0].field, opened[0].field);
});

test("two runs of one input are the same to the last character", () => {
  const world = sheet();
  const moments = [
    order(0, "Aland", "advance"),
    order(3, "Borduria", "dig in", { sector: "south" }),
    order(5, "Aland", "blitz", { sector: "north" }),
    order(8, "Aland", "spearhead", { sector: "centre", objective: "city: Brod", result: "captured" }),
  ];
  const input = () => frontInput(world, { days: 14, moments, strengthOf: (name) => (name === "Aland" ? 3.6 : 2) });
  const first = runFronts(input());
  const second = runFronts(input());
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.ok(first.flips.length > 0, "and something happened in it");
  assert.notEqual(JSON.stringify(runFronts({ ...input(), seed: "another" })), JSON.stringify(first), "the seed is the one source of variation");
});

test("a run cut at day k ends as the full run stood after day k", () => {
  const world = sheet();
  const moments = [
    order(0, "Aland", "advance"),
    order(2, "Borduria", "advance", { sector: "south" }),
    order(4, "Aland", "blitz", { sector: "north", effort: "total" }),
    order(6, "Aland", "advance", { result: "breakthrough", sector: "centre" }),
    order(9, "Borduria", "fall back"),
    { day: 9, type: "control", regionId: "r0-0", to: "Borduria" },
  ];
  const input = (days) => frontInput(world, { days, moments: moments.filter((moment) => moment.day <= days), strengthOf: (name) => (name === "Aland" ? 3.2 : 2) });
  const run = createFrontRun(input(12));
  for (const k of [0, 1, 2, 5, 6, 9, 12]) {
    while (run.snapshot().stats.days < k) run.advance(1);
    const full = run.snapshot();
    const cut = runFronts(input(k));
    assert.equal(cut.stats.days, k);
    assert.equal(JSON.stringify(withoutReplay(cut.battlefields)), JSON.stringify(withoutReplay(full.battlefields)), `the battlefields after day ${k}`);
    assert.deepEqual(cut.flips, full.flips, `the flips up to day ${k}`);
    assert.deepEqual(cut.unitChanges, full.unitChanges);
    assert.deepEqual(cut.notes, full.notes);
  }
  assert.equal(run.advance(1), true, "finished");
  assert.equal(JSON.stringify(run.finish()), JSON.stringify(runFronts(input(12))), "in steps or in one go");
  // Nothing dated later changes anything earlier: a flip is dated the day it happened.
  const whole = runFronts(input(12));
  for (const flip of whole.flips) {
    assert.ok(flip.day >= 1 && flip.day <= 12);
    assert.equal(flip.battlefield, "Aland - Borduria front");
    assert.ok(["control", "groupTake", "groupRelease"].includes(flip.kind));
  }
});

test("a named formation is taken in, and comes back when the war ends", () => {
  const world = sheet();
  const units = [
    { id: "unit-1", name: "1st Guards Tank Army", type: "armor", ownerCode: "Aland", strength: 80, lng: 21.1, lat: 51.3 },
    { id: "unit-2", name: "Home Fleet", type: "naval", ownerCode: "Aland", strength: 90, lng: 21.0, lat: 51.0 },
    { id: "unit-3", name: "Far Garrison", type: "infantry", ownerCode: "Aland", strength: 90, lng: 20.05, lat: 51.9, committedTo: "A front long gone" },
    { id: "unit-4", name: "Their Rifles", type: "infantry", ownerCode: "Borduria", strength: 55, lng: 21.9, lat: 51.6 },
    { id: "unit-5", name: "Bystanders", type: "infantry", ownerCode: "Neutralia", strength: 70, lng: 21.2, lat: 51.3 },
  ];
  const opened = runFronts(frontInput(world, { days: 2, units }));
  const [record] = opened.battlefields;
  assert.deepEqual(opened.unitChanges, [
    { unitId: "unit-3", committedTo: "" },
    { unitId: "unit-1", committedTo: "Aland - Borduria front" },
    { unitId: "unit-4", committedTo: "Aland - Borduria front" },
  ], "one committed to a battlefield that is gone is given back; the land formations of the two sides are taken in");
  assert.deepEqual(record.named.map(({ s, name, unitId }) => [s, name, unitId]), [[0, "1st Guards Tank Army", "unit-1"], [1, "Their Rifles", "unit-4"]]);
  const seen = readBattlefield(record, world);
  const tanks = seen.troops[0][record.named[0].i];
  assert.equal(tanks.named, true);
  assert.equal(tanks.kind, 1);
  assert.ok(tanks.strength >= 79 && tanks.strength < 84, "at its own strength, and the first reserves on their way");
  assert.equal(seen.troops[0].filter((troop) => troop.named).length, 1);

  // The next run begins with them already committed: nothing new to report.
  const committed = units.map((unit) => (unit.id === "unit-1" || unit.id === "unit-4" ? { ...unit, committedTo: record.name } : unit)).filter((unit) => unit.id !== "unit-3");
  const quiet = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 3, units: committed, fromDate: "2024-03-03" }));
  assert.deepEqual(quiet.unitChanges, []);
  assert.equal(quiet.battlefields[0].named.length, 2);

  // The war ends: the battlefield closes, and the formations go back where they stand.
  const ended = runFronts(frontInput(world, {
    battlefields: quiet.battlefields,
    days: 5,
    units: committed,
    fromDate: "2024-03-06",
    moments: [{ day: 2, type: "war", warId: "war-1", op: "end", names: [] }],
  }));
  const [closed] = ended.battlefields;
  assert.equal(closed.status, "closed");
  assert.equal(closed.closedDate, "2024-03-08");
  assert.equal(closed.field, undefined);
  assert.ok(closed.replay && closed.replay.e === 2, "its replay ends on its last day");
  assert.deepEqual(ended.unitChanges.map(({ unitId, committedTo }) => [unitId, committedTo]), [["unit-1", ""], ["unit-4", ""]]);
  const back = ended.unitChanges[0];
  assert.ok(Math.abs(back.lng - tanks.lng) < 0.2 && Math.abs(back.lat - tanks.lat) < 0.2 && back.strength >= 79 && back.remove === undefined);
  assert.deepEqual(ended.notes, [{ kind: "closed", battlefield: "Aland - Borduria front", detail: "" }]);
  assert.deepEqual(ended.flips, [], "the war ending moves no border");
  assert.deepEqual(normalizeBattlefields(ended.battlefields), ended.battlefields);
  // A closed battlefield has been through its one more run: it is not carried on.
  const after = runFronts(frontInput(world, { battlefields: ended.battlefields, days: 1, wars: [], fromDate: "2024-03-11" }));
  assert.deepEqual(after.battlefields, []);
});

test("a ceasefire freezes a battlefield, and the war resuming thaws it", () => {
  const world = sheet();
  const moments = [
    order(0, "Aland", "advance"),
    { day: 3, type: "war", warId: "war-1", op: "ceasefire", names: [] },
    { day: 7, type: "war", warId: "war-1", op: "resume", names: [] },
  ];
  const input = (days) => frontInput(world, { days, moments: moments.filter((moment) => moment.day <= days), strengthOf: (name) => (name === "Aland" ? 6 : 2) });
  const atThree = runFronts(input(3)).battlefields[0];
  const atSeven = runFronts(input(6)).battlefields[0];
  const atTen = runFronts(input(10)).battlefields[0];
  assert.equal(atThree.status, "frozen");
  assert.equal(atSeven.status, "frozen");
  assert.deepEqual(atSeven.field, atThree.field, "nothing moves while it is frozen");
  assert.deepEqual(atSeven.troops, atThree.troops);
  assert.equal(atTen.status, "active");
  assert.notDeepEqual(atTen.field, atThree.field, "and the advance goes on when the war does");
  // A war that is in a ceasefire when the run begins keeps its battlefield frozen.
  applyFlips(world, runFronts(input(3)).flips);
  const later = runFronts(frontInput(world, { battlefields: [atThree], days: 4, fromDate: "2024-03-04", wars: [{ id: "war-1", status: "ceasefire", sideA: ["Aland"], sideB: ["Borduria"] }] }));
  assert.equal(later.battlefields[0].status, "frozen");
  assert.deepEqual(later.battlefields[0].field, atThree.field);
});

test("a join, a leave, and a control change made by someone else", () => {
  const layout = ["AAABBB", "AAABBB", "CCCBBB", "CCCBBB", "~~~~~~"];
  const world = sheet(layout);
  const opened = runFronts(frontInput(world, { days: 1 }));
  const before = readBattlefield(opened.battlefields[0], world);
  assert.equal(before.holderAt(20.4, 50.6), 2, "Cisland is outside the war: its land is a wall");
  const lineBefore = opened.battlefields[0].brief.km;

  // Cisland joins Aland: its land in the frame becomes that side's ground, with troops of its own.
  const joined = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 3, fromDate: "2024-03-02", moments: [{ day: 1, type: "war", warId: "war-1", op: "join-a", names: ["Cisland"] }] }));
  const [record] = joined.battlefields;
  assert.deepEqual(record.sides, [["Aland", "Cisland"], ["Borduria"]]);
  const after = readBattlefield(record, world);
  assert.equal(after.holderAt(20.4, 50.6), 0);
  assert.ok(record.brief.km > lineBefore * 1.6, "the line now runs along its border too");
  assert.ok(after.troops[0].filter((troop) => troop.owner === 1).length >= 2, "and it has brought troops");
  assert.ok(after.troops[0].length > before.troops[0].length);

  // It leaves again: its troops go, and its land is a wall once more.
  const wars = [{ id: "war-1", status: "active", sideA: ["Aland", "Cisland"], sideB: ["Borduria"] }];
  const left = runFronts(frontInput(world, { battlefields: joined.battlefields, wars, days: 2, fromDate: "2024-03-05", moments: [{ day: 0, type: "war", warId: "war-1", op: "leave", names: ["Cisland"] }] }));
  assert.deepEqual(left.battlefields[0].sides, [["Aland"], ["Borduria"]]);
  const gone = readBattlefield(left.battlefields[0], world);
  assert.equal(gone.holderAt(20.4, 50.6), 2);
  assert.ok(gone.troops[0].every((troop) => troop.strength === 0 || troop.owner === 0), "every troop left standing is Aland's");
  assert.ok(gone.troops[0].some((troop) => troop.strength === 0), "the leaver's counters are spent");

  // Someone else hands a border region of Borduria's to Aland: the world wins over the field.
  const handed = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 2, fromDate: "2024-03-02", moments: [{ day: 1, type: "control", regionId: "r6-1", to: "Aland" }] }));
  const taken = readBattlefield(handed.battlefields[0], world);
  assert.equal(before.holderAt(21.6, 51.6), 1);
  assert.equal(taken.holderAt(21.6, 51.6), 0, "the region is repainted for the side the world gave it to");
  assert.deepEqual(handed.flips, [], "it was not the engine that took it");
  // ...and to a country outside the war: its cells become wall.
  const lost = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 2, fromDate: "2024-03-02", moments: [{ day: 0, type: "control", regionId: "r6-1", to: "Neutralia" }] }));
  assert.equal(readBattlefield(lost.battlefields[0], world).holderAt(21.6, 51.6), 2);
  // The same change found at the start of a run, with no moment to say so, is honoured too.
  const found = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 1, fromDate: "2024-03-02", controllerOf: (id) => (id === "r6-1" ? "Aland" : world.controllerOf(id)) }));
  assert.equal(readBattlefield(found.battlefields[0], world).holderAt(21.6, 51.6), 0);
});

test("the engine says when it needs the map's shapes, and does without them when it can", () => {
  const world = sheet();
  const arenas = new Map();
  const full = frontInput(world, { days: 2, arenas });
  const bare = (overrides = {}) => frontInput(world, { days: 2, arenas, ...overrides, map: { ...world.map, regions: null } });
  // Nothing drawn yet and a war to look at: it must have the shapes.
  assert.deepEqual(runFronts(bare({ arenas: new Map() })), { needsRegions: true });
  const run = createFrontRun(bare({ arenas: new Map() }));
  assert.equal(run.advance(5), true, "there is nothing to wait for");
  assert.deepEqual(run.finish(), { needsRegions: true });
  assert.deepEqual(run.snapshot(), { needsRegions: true });

  const opened = runFronts(full);
  assert.equal(opened.battlefields.length, 1);
  // The arena is kept and the war has been looked at: the next run needs no shapes.
  const next = runFronts(bare({ battlefields: opened.battlefields, fromDate: "2024-03-03", moments: [order(0, "Aland", "advance")] }));
  assert.equal(next.needsRegions, undefined);
  assert.equal(next.battlefields.length, 1);
  assert.equal(JSON.stringify(next), JSON.stringify(runFronts({ ...full, battlefields: opened.battlefields, fromDate: "2024-03-03", moments: [order(0, "Aland", "advance")] })), "with the shapes or without, the same result");
  // An arena that was not kept, a war that starts, a member that joins: shapes again.
  assert.deepEqual(runFronts(bare({ battlefields: opened.battlefields, arenas: new Map() })), { needsRegions: true });
  assert.deepEqual(runFronts(bare({ battlefields: opened.battlefields, moments: [{ day: 1, type: "war", warId: "war-2", op: "start", names: ["Aland"], opponents: ["Neutralia"] }] })), { needsRegions: true });
  assert.deepEqual(runFronts(bare({ battlefields: opened.battlefields, moments: [{ day: 1, type: "war", warId: "war-1", op: "join-b", names: ["Neutralia"] }] })), { needsRegions: true });
  // A war ending or freezing needs none.
  assert.equal(runFronts(bare({ battlefields: opened.battlefields, moments: [{ day: 1, type: "war", warId: "war-1", op: "end", names: [] }] })).battlefields[0].status, "closed");

  // A war whose sides do not touch has no battlefield. Once that has been found
  // with the shapes, it is not asked again until the war or its land changes.
  const apart = sheet(["AA~~BB", "AA~~BB", "AANNBB"]);
  const kept = new Map();
  const overseas = (overrides = {}) => frontInput(apart, { days: 2, arenas: kept, ...overrides });
  const without = (overrides = {}) => overseas({ ...overrides, map: { ...apart.map, regions: null } });
  assert.deepEqual(runFronts(without()), { needsRegions: true });
  assert.deepEqual(runFronts(overseas()).battlefields, []);
  assert.deepEqual(runFronts(without()).battlefields, [], "the answer is remembered");
  assert.deepEqual(runFronts(without({ wars: [{ id: "war-1", status: "active", sideA: ["Aland", "Neutralia"], sideB: ["Borduria"] }] })), { needsRegions: true }, "a member more: asked again");
  assert.deepEqual(runFronts(without({ controllerOf: (id) => (id === "r8-0" ? "Aland" : apart.controllerOf(id)) })), { needsRegions: true }, "land changed hands: asked again");
});

test("orders the engine cannot carry out are refused with a note, and stand corrected where they can", () => {
  const world = sheet();
  const moments = [
    order(0, "Aland", "advance", { battlefield: "The Somme", ref: 4 }),
    order(0, "Neutralia", "advance", { ref: 5 }),
    order(0, "Aland", "advance", { sector: "west", ref: 6 }),
    order(0, "Borduria", "spearhead", { sector: "north", objective: "city: Atlantis", ref: 7 }),
    order(0, "Borduria", "hold", { sector: "CENTER" }),
    order(0, "Aland", "land", { objective: "city: Atlantis", ref: 8 }),
    order(0, "Aland", "charge", { ref: 9 }),
  ];
  const opened = runFronts(frontInput(world, { days: 0 }));
  const result = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 1, moments }));
  assert.deepEqual(result.notes, [
    { kind: "unknown-battlefield", battlefield: "The Somme", side: "Aland", ref: 4 },
    { kind: "side-not-fighting", battlefield: "Aland - Borduria front", side: "Neutralia", ref: 5 },
    { kind: "sector-read-as-all", battlefield: "Aland - Borduria front", side: "Aland", ref: 6, detail: "all, north, centre, south" },
    { kind: "objective-not-found", battlefield: "Aland - Borduria front", side: "Borduria", ref: 7, detail: "city: Atlantis" },
    { kind: "objective-not-found", battlefield: "Aland - Borduria front", side: "Aland", ref: 8, detail: "city: Atlantis" },
  ]);
  assert.deepEqual(result.battlefields[0].orders, [
    { s: 0, sector: "all", order: "advance", since: "2024-03-01", by: "Aland" },
    { s: 1, sector: "north", order: "spearhead", since: "2024-03-01", by: "Borduria" },
    { s: 1, sector: "centre", order: "hold", since: "2024-03-01", by: "Borduria" },
  ]);
  // A battlefield that opened by itself this run takes the name its first order gives it.
  const named = runFronts(frontInput(world, { days: 2, moments: [order(0, "Aland", "advance", { battlefield: "Eastern Front" }), order(1, "Borduria", "dig in", { battlefield: "eastern  front" })] }));
  assert.equal(named.battlefields[0].name, "Eastern Front");
  assert.deepEqual(named.notes, []);
  assert.deepEqual(named.battlefields[0].orders.map(({ s, order: word }) => [s, word]), [[0, "advance"], [1, "dig in"]]);
  // A new order for a sector replaces the one that stood there; one for the whole line replaces them all.
  const replaced = runFronts(frontInput(world, { battlefields: result.battlefields, days: 1, fromDate: "2024-03-02", moments: [order(0, "Borduria", "advance", { sector: "north" }), order(0, "Aland", "hold", { sector: "south" }), order(1, "Aland", "dig in")] }));
  assert.deepEqual(replaced.battlefields[0].orders.map(({ s, sector, order: word }) => [s, sector, word]), [[1, "centre", "hold"], [1, "north", "advance"], [0, "all", "dig in"]]);
});

// A real-key test (2026-10-28): the model named the front it ordered with its
// war's id, and the War Room's header read "WAR-FRANCE-ITALY-2016".
test("an order naming a battlefield with a war's id leaves it the name it would have had", () => {
  const world = sheet();
  const opened = runFronts(frontInput(world, { days: 2, moments: [order(0, "Aland", "advance", { battlefield: "WAR-1" }), order(1, "Borduria", "dig in", { battlefield: "war-aland-borduria-2024" })] }));
  assert.equal(opened.battlefields[0].name, "Aland - Borduria front");
  assert.deepEqual(opened.battlefields[0].orders.map(({ s, order: word }) => [s, word]), [[0, "advance"], [1, "dig in"]], "both orders still reach it");
  // On a later run, the war's id still finds the war's battlefield, which keeps its name.
  const later = runFronts(frontInput(world, { battlefields: opened.battlefields, days: 1, fromDate: "2024-03-03", moments: [order(0, "Aland", "hold", { battlefield: "war-1" })] }));
  assert.equal(later.battlefields[0].name, "Aland - Borduria front");
  assert.deepEqual(later.notes.filter((note) => note.kind === "unknown-battlefield"), []);
  assert.ok(later.battlefields[0].orders.some(({ s, order: word }) => s === 0 && word === "hold"));
});

test("no more battlefields are open than the world may hold", () => {
  assert.equal(MAX_BATTLEFIELDS, 12);
  const world = sheet();
  const many = Array.from({ length: MAX_BATTLEFIELDS }, (_, index) => battlefieldOn(world, { name: `Front ${index}` }));
  const wars = [{ id: "war-1", status: "active", sideA: ["Aland"], sideB: ["Borduria"] }, { id: "war-2", status: "active", sideA: ["Neutralia"], sideB: ["Borduria"] }];
  const crowded = sheet(["AAABBB", "AAABBB", "NNNBBB", "~~~~~~"]);
  const result = runFronts(frontInput(crowded, { battlefields: many.map((record) => ({ ...record, frame: battlefieldOn(crowded).frame, field: battlefieldOn(crowded).field })), wars, days: 1 }));
  assert.equal(result.battlefields.length, MAX_BATTLEFIELDS);
  assert.deepEqual(result.notes.filter((note) => note.kind === "too-many-battlefields").length, 1);
});

test("the engine's files keep to arithmetic every machine does alike", () => {
  const folder = new URL(".", import.meta.url);
  // The engine's own files: what works a day out. frame.js places points with
  // logarithms, outside any day's work; the record, its packing and its replay
  // keep what the engine hands them and decide nothing; the tests and what
  // they share are not the engine.
  const beside = ["frame.js", "codec.js", "record.js", "replay.js", "view.js", "syntheticMap.js", "testKit.js"];
  const files = readdirSync(folder).filter((name) => name.endsWith(".js") && !name.endsWith(".test.js") && !beside.includes(name));
  assert.ok(["arena.js", "field.js", "troops.js", "sectors.js", "combat.js", "orders.js", "brief.js", "engine.js", "day.js", "battle.js", "supply.js", "line.js", "contact.js", "constants.js"].every((name) => files.includes(name)));
  const forbidden = /Math\.(random|sin|cos|tan|asin|acos|atan|atan2|hypot|exp|expm1|pow|log|log2|log10|log1p|cbrt|sinh|cosh|tanh)\b|\*\*|Date\.now|new Date|performance\.now/;
  for (const name of files) {
    const source = readFileSync(new URL(name, folder), "utf8").split("\n");
    source.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      assert.ok(!forbidden.test(code), `${name}:${index + 1} ${line.trim()}`);
    });
  }
});
