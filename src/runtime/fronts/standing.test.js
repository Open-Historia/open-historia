// Run: node --test src/runtime/fronts/standing.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { decodeTroops } from "./codec.js";
import { runFronts } from "./engine.js";
import { normalizeBattlefields } from "./record.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { readBattlefield } from "./testKit.js";

// "You can also just deploy units to fortify borders without actually
// attacking or anything": a border fortified in peace is a battlefield that
// is STANDING. An order for `border: A / B` opens it.

const legend = { A: "Aland", B: "Borduria", N: "Neutralia", "~": null };
const sheet = () => syntheticMap({ layout: ["AAABBB", "AAABBB", "NNNNNN"], legend, west: 20, north: 51, step: 1, stepLat: 0.5 });
const peace = (world, overrides = {}) => frontInput(world, { wars: [], days: 5, ...overrides });
const order = (day, battlefield, side, word, extra = {}) => ({ day, type: "order", battlefield, side, order: word, sector: "all", ...extra });
const BORDER = "Aland / Borduria border";

test("a border is fortified in peace: troops are deployed along it and dug in, and nothing fights", () => {
  const world = sheet();
  const opened = runFronts(peace(world, { moments: [order(0, "border: Aland / Borduria", "Aland", "dig in")] }));
  assert.deepEqual(opened.notes, []);
  assert.equal(opened.battlefields.length, 1);
  const [record] = opened.battlefields;
  assert.equal(record.name, BORDER);
  assert.equal(record.status, "standing");
  assert.equal(record.warId, "");
  assert.deepEqual(record.sides, [["Aland"], ["Borduria"]]);
  assert.deepEqual(normalizeBattlefields(opened.battlefields), opened.battlefields, "the record's own check keeps it as it is");
  // Only the side that deployed has troops there: two dozen for a small state, on its own side, dug in.
  const seen = readBattlefield(record, world);
  assert.equal(seen.troops[0].length, 24);
  assert.equal(seen.troops[1].length, 0);
  for (const troop of seen.troops[0]) {
    assert.equal(troop.state, 4, "dug in");
    assert.equal(troop.dig, 1);
    assert.equal(seen.holderAt(troop.lng, troop.lat), 0);
    assert.ok(troop.lng > 22.5 && troop.lng < 23, `along the border (${troop.lng})`);
  }
  assert.deepEqual(record.orders, [{ s: 0, sector: "all", order: "dig in", since: "2024-03-01", by: "Aland" }]);
  // Nothing fought, nothing moved, no ground changed hands.
  assert.deepEqual(opened.flips, []);
  assert.equal(opened.stats.steps, 0);
  const atOnce = runFronts(peace(world, { days: 0, moments: [order(0, "border: Aland / Borduria", "Aland", "dig in")] })).battlefields[0];
  assert.deepEqual(record.field, atOnce.field);
  assert.deepEqual(record.troops, atOnce.troops);

  // The next turn: the other side may deploy too, by either name of the
  // border. (An order to ATTACK there is the war beginning: attackFirst.test.js.)
  const later = runFronts(peace(world, {
    battlefields: opened.battlefields,
    fromDate: "2024-03-06",
    moments: [order(2, "border: Borduria / Aland", "Borduria", "hold")],
  }));
  assert.deepEqual(later.notes, []);
  assert.deepEqual(later.starts, [], "nobody is at war");
  assert.equal(later.battlefields.length, 1, "one battlefield for the one border");
  const [both] = later.battlefields;
  assert.equal(both.status, "standing");
  assert.deepEqual(both.field, record.field);
  assert.deepEqual(both.troops[0], record.troops[0], "Aland's troops are where they dug in");
  const theirs = decodeTroops(both.troops[1]);
  assert.equal(theirs.length, 24);
  assert.ok(theirs.every((troop) => troop.state === 0 && troop.strength === 100), "Borduria's hold, and are not dug in");
  assert.deepEqual(later.flips, []);

  // With no shapes of the map a border that has no battlefield yet cannot be laid out: the engine says so.
  assert.deepEqual(runFronts(peace(world, { map: { ...world.map, regions: null }, moments: [order(0, "border: Aland / Borduria", "Aland", "dig in")] })), { needsRegions: true });
  // Two that do not touch have no border to fortify.
  assert.deepEqual(runFronts(peace(world, { moments: [order(0, "border: Aland / Atlantis", "Aland", "dig in", { ref: 1 })] })).notes, [{ kind: "border-not-found", battlefield: "border: Aland / Atlantis", side: "Aland", ref: 1 }]);
  // Somebody who is neither of the two has nothing to order on it.
  assert.deepEqual(runFronts(peace(world, { moments: [order(0, "border: Aland / Borduria", "Neutralia", "advance", { ref: 2 })] })).notes, [{ kind: "not-at-war", battlefield: "border: Aland / Borduria", side: "Neutralia", ref: 2 }]);
});

test("when war comes a fortified border is fought over as it stands, with whoever is dug in there", () => {
  const world = sheet();
  const opened = runFronts(peace(world, { moments: [order(0, "border: Aland / Borduria", "Aland", "dig in")] }));
  const dug = opened.battlefields[0].troops[0];
  // The war is declared the other way round: Borduria against Aland.
  const wars = [{ id: "war-9", title: "border-war", status: "active", sideA: ["Borduria"], sideB: ["Aland"] }];
  const atWar = runFronts(frontInput(world, { battlefields: opened.battlefields, wars, fromDate: "2024-03-06", days: 4 }));
  assert.equal(atWar.battlefields.length, 1, "no second battlefield is opened on the same border");
  const [record] = atWar.battlefields;
  assert.equal(record.name, BORDER);
  assert.equal(record.status, "active");
  assert.equal(record.warId, "war-9");
  assert.deepEqual(record.sides, [["Aland"], ["Borduria"]]);
  assert.deepEqual(decodeTroops(record.troops[0]).map(({ x, y, state }) => [x, y, state]), decodeTroops(dug).map(({ x, y }) => [x, y, 4]), "Aland's troops are dug in where they were");
  assert.equal(decodeTroops(record.troops[1]).length, 24, "and Borduria has raised its own");
  // Now it is a battlefield like any other: an attack is an attack.
  const fought = runFronts(frontInput(world, { battlefields: atWar.battlefields, wars, fromDate: "2024-03-10", days: 10, moments: [order(0, BORDER, "Borduria", "advance")] }));
  assert.deepEqual(fought.notes, []);
  assert.equal(fought.battlefields[0].orders.some((entry) => entry.s === 1 && entry.order === "advance"), true);
  assert.ok(fought.stats.steps > 0, "and it is fought");
  // A war that begins during a run takes the border over on its day.
  const during = runFronts(peace(world, { battlefields: opened.battlefields, fromDate: "2024-03-06", days: 3, moments: [{ day: 2, type: "war", warId: "war-9", op: "start", names: ["Aland"], opponents: ["Borduria"] }] }));
  assert.equal(during.battlefields.length, 1);
  assert.equal(during.battlefields[0].status, "active");
  assert.equal(during.battlefields[0].warId, "war-9");
});

test("a fortified border is given up when every side on it is told to leave, or after thirty quiet days at token effort", () => {
  const world = sheet();
  const opened = runFronts(peace(world, { moments: [order(0, "border: Aland / Borduria", "Aland", "dig in")] }));
  const left = runFronts(peace(world, { battlefields: opened.battlefields, fromDate: "2024-03-06", days: 2, moments: [order(1, BORDER, "Aland", "fall back")] }));
  assert.equal(left.battlefields[0].status, "closed");
  assert.equal(left.battlefields[0].closedDate, "2024-03-07");
  assert.deepEqual(left.notes, [{ kind: "closed", battlefield: BORDER, detail: "" }]);
  // Kept at its ordinary effort it stands as long as it is left alone.
  const kept = runFronts(peace(world, { battlefields: opened.battlefields, fromDate: "2024-03-06", days: 40 }));
  assert.equal(kept.battlefields[0].status, "standing");
  // At token effort, thirty days with nothing ordered there: it is stood down.
  const token = runFronts(peace(world, { days: 5, moments: [order(0, "border: Aland / Borduria", "Aland", "dig in", { effort: "token" })] }));
  assert.equal(decodeTroops(token.battlefields[0].troops[0]).length, 7, "a token force: three tenths of two dozen");
  const quiet = runFronts(peace(world, { battlefields: token.battlefields, fromDate: "2024-03-06", days: 20 }));
  assert.equal(quiet.battlefields[0].status, "standing", "twenty-five days in");
  const gone = runFronts(peace(world, { battlefields: quiet.battlefields, fromDate: "2024-03-26", days: 10 }));
  assert.equal(gone.battlefields[0].status, "closed");
  assert.equal(gone.battlefields[0].closedDate, "2024-03-31");
});

test("between two that are at war already the border is the front: an order for it goes to the battlefield they share", () => {
  const world = sheet();
  const front = runFronts(frontInput(world, { days: 0 })).battlefields;
  assert.equal(front.length, 1);
  assert.equal(front[0].status, "active");
  // "Fortify the border with Borduria", said of a border that is a front already: Aland's troops there dig in.
  const dug = runFronts(frontInput(world, { battlefields: front, days: 3, moments: [order(1, "border: Aland / Borduria", "Aland", "dig in", { ref: 5 })] }));
  assert.deepEqual(dug.notes, []);
  assert.equal(dug.battlefields.length, 1, "no second battlefield is opened on a border that is fought over");
  assert.equal(dug.battlefields[0].name, front[0].name);
  assert.deepEqual(dug.battlefields[0].orders, [{ s: 0, sector: "all", order: "dig in", since: "2024-03-02", by: "Aland" }]);
  const [theirs, others] = dug.battlefields[0].troops.map((text) => decodeTroops(text));
  assert.ok(theirs.length > 0 && theirs.every((troop) => troop.state === 4), "every one of Aland's is dug in");
  assert.ok(others.every((troop) => troop.state !== 4), "and none of Borduria's");
  // An attack ordered the same way is an attack there, either name first.
  const attacked = runFronts(frontInput(world, { battlefields: front, days: 6, moments: [order(0, "border: Borduria / Aland", "Borduria", "advance")] }));
  assert.deepEqual(attacked.notes, []);
  assert.equal(attacked.battlefields[0].orders.some((entry) => entry.s === 1 && entry.order === "advance"), true);
  assert.ok(attacked.stats.steps > 0);
  // At war with nothing between them to fight over (the war is with a country that is nowhere near): the order says so.
  const apart = runFronts(frontInput(world, {
    wars: [{ id: "war-3", title: "far", status: "active", sideA: ["Aland"], sideB: ["Atlantis"] }],
    days: 1,
    moments: [order(0, "border: Aland / Atlantis", "Aland", "dig in", { ref: 6 })],
  }));
  assert.deepEqual(apart.notes, [{ kind: "border-at-war", battlefield: "border: Aland / Atlantis", side: "Aland", ref: 6 }]);
});
