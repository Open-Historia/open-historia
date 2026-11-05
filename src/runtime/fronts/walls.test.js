/*! Open Historia — battlefields and fronts: fortified lines that must be broken through: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/fronts/walls.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { withFrontFortifications } from "../warGeography.js";
import { rehearsal, rehearseDay, rehearseOrders, runFronts } from "./engine.js";
import { frontInput, syntheticMap } from "./syntheticMap.js";
import { WALL_DAYS, brokenAt, standsOn } from "./walls.js";

const legend = { A: "Aland", B: "Borduria" };
const sheet = () => syntheticMap({ layout: ["AAAABBBB", "AAAABBBB", "AAAABBBB", "AAAABBBB"], legend, west: 20, north: 52, step: 1, stepLat: 0.5, key: "walls" });
// Aland advances along its whole line, Borduria holds behind its wall, whatever happens.
const fixed = (battle, side) => (battle.sides[side][0] === "Aland" ? { order: "advance", sector: "all" } : { order: "hold", sector: "all" });
// Borduria's wall, a degree inside its border, north to south across the sheet.
const wall = (level, extra = {}) => ({ id: "wall", name: "The Wall", owner: "Borduria", level, points: [[24.6, 52.3], [24.6, 49.7]], breaches: [], wear: [], ...extra });
const fight = (extra = {}) => {
  let last = null;
  const result = runFronts(frontInput(sheet(), {
    arenas: new Map(), staff: true, troops: 1, days: 20, strengthOf: (name) => (name === "Aland" ? 9 : 3), staffPolicy: fixed,
    watch: (seen) => { last = seen.holders; },
    ...extra,
  }));
  // The cells Aland holds east of the wall.
  const [record] = result.battlefields;
  const { lng0, cell, cols } = record.frame;
  let beyond = 0;
  last.forEach((holder, index) => {
    const lng = lng0 + ((index % cols) + 0.5) * cell;
    if (holder === record.sides.findIndex((members) => members[0] === "Aland") && lng > 24.75) beyond += 1;
  });
  return { result, beyond };
};

test("a staff that rehearses on a copy of the battle wears no real wall doing it", () => {
  // The copy kept the real run's walls, and the first day of each rehearsal wore and broke them: walls fell many
  // times faster in a war the staff that looks ahead led (found 2026-10-15).
  const plain = fight({ mechanics: { walls: true }, fortifications: [wall(3)], days: 20 });
  let rehearsed = 0;
  const rehearsing = (battle, side, context, run) => {
    if (run && battle.sides[side][0] === "Aland") {
      const day = run.day + 1;
      for (let again = 0; again < 3; again += 1) {
        const copy = rehearsal(run, battle);
        const live = copy.battle.troops[side].map((troop, index) => (troop.strength > 0 ? index : -1)).filter((index) => index >= 0);
        rehearseOrders(copy, side, [{ order: "advance", picked: live }], day);
        for (let days = 0; days < 4; days += 1) rehearseDay(copy, day + days, { morning: days > 0 });
        rehearsed += 1;
      }
    }
    return fixed(battle, side);
  };
  const watched = fight({ mechanics: { walls: true }, fortifications: [wall(3)], days: 20, staffPolicy: rehearsing });
  assert.ok(rehearsed >= 6);
  assert.ok(plain.result.fortifications?.length > 0, "the wall is worn by the war itself");
  assert.deepEqual(watched.result.fortifications, plain.result.fortifications);
  assert.equal(watched.beyond, plain.beyond);
});

test("a line stands once it is built and where it is not broken", () => {
  const line = { level: 5, building: { since: "2024-03-01", days: 10 }, breaches: [[5, 10]] };
  assert.equal(standsOn(line, "2024-03-05"), false);
  assert.equal(standsOn(line, "2024-03-11"), true);
  assert.equal(standsOn({ level: 2, building: null }, "2024-03-11"), false, "below level 3 it is no wall");
  assert.equal(brokenAt(line, 7), true);
  assert.equal(brokenAt(line, 12), false);
  assert.equal(WALL_DAYS[10], Infinity);
});

test("a wall that cannot be broken holds an advance that would otherwise go well past it", () => {
  const open = fight();
  assert.ok(open.beyond > 0, "without the wall Aland gets past where it stands");
  const never = fight({ mechanics: { walls: true }, fortifications: [wall(10)] });
  assert.equal(never.beyond, 0);
  assert.equal(never.result.fortifications, undefined, "and is not so much as scratched");
  // Without the mechanic, or with its owner in no part of the fight, a wall is nothing.
  assert.equal(fight({ fortifications: [wall(10)] }).beyond, open.beyond);
  assert.equal(fight({ mechanics: { walls: true }, fortifications: [wall(10, { owner: "Neutralia" })] }).beyond, open.beyond);
  // Nor is one still being built.
  assert.equal(fight({ mechanics: { walls: true }, fortifications: [wall(10, { building: { since: "2024-03-01", days: 400 } })] }).beyond, open.beyond);
});

test("a low wall is broken through, and the breach stays broken for the next turn", () => {
  const low = fight({ mechanics: { walls: true }, fortifications: [wall(3)], days: 30 });
  const [changed] = low.result.fortifications ?? [];
  assert.ok(changed && changed.breaches.length > 0, JSON.stringify(low.result.fortifications));
  assert.ok(low.beyond > 0, "and Aland went through");
  // The turn keeps it, and a later war over the same ground finds the wall open where it was broken.
  const kept = withFrontFortifications([wall(3)], low.result.fortifications);
  assert.deepEqual(kept[0].breaches, changed.breaches);
  const whole = fight({ mechanics: { walls: true }, fortifications: [wall(3)], days: 6 });
  const broken = fight({ mechanics: { walls: true }, fortifications: kept, days: 6 });
  assert.ok(broken.beyond > whole.beyond, `${broken.beyond} against ${whole.beyond}`);
  // A higher wall holds longer.
  const high = fight({ mechanics: { walls: true }, fortifications: [wall(7)], days: 30 });
  assert.ok(high.beyond < low.beyond, `${high.beyond} against ${low.beyond}`);
});
