/*! Open Historia — a war's after-action report: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/afterActionData.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { isRecentReport, reportKey, reportsFor, talliesOf, turningPointsOf, daysFought } from "./afterActionData.js";

const moment = (d, k, s, at, extra = {}) => ({ d, k, s, at, ...extra });
const chronicle = {
  moments: [
    moment("2024-03-02", "offensive", 0, "the whole line"),
    moment("2024-03-05", "offensive", 0, "the north"),
    moment("2024-03-06", "breached", 0, "wall: The Wall"),
    moment("2024-03-09", "city", 0, "city: Midford", { size: 80000 }),
    moment("2024-03-12", "counter", 1, "city: Lowmarsh"),
    moment("2024-03-20", "pocket", 1, "city: Lowmarsh"),
    moment("2024-04-02", "city", 0, "city: Eastholm", { size: 250000, capital: true }),
    moment("2024-04-03", "assault", 0, "city: Eastholm"),
  ],
  strength: [["2024-03-31", 40, 30, 80, 70], ["2024-04-30", 38, 12, 74, 50]],
};

test("the turning points are the weightiest moments, told in the order they happened: a capital, a breach, a pocket before an assault", () => {
  const points = turningPointsOf(chronicle, { most: 5 });
  assert.equal(points.length, 5);
  assert.deepEqual(points.map((point) => point.k), ["offensive", "breached", "counter", "pocket", "city"]);
  assert.ok(points.at(-1).capital);
  // Of a side's many offensives, its first is told.
  assert.equal(turningPointsOf(chronicle).filter((point) => point.k === "offensive").length, 1);
  assert.deepEqual(turningPointsOf(null), []);
});

test("what each side came to: its towns, the largest first, the walls it broke and the troops it lost surrounded", () => {
  const [first, second] = talliesOf(chronicle);
  assert.deepEqual(first.towns.map((town) => town.at), ["city: Eastholm", "city: Midford"]);
  assert.equal(first.breached, 1);
  assert.equal(second.surrendered, 1);
  assert.equal(second.towns.length, 0);
});

test("a report is there for a closed battlefield the player fought on that kept its chronicle, and is put before them only lately", () => {
  const frame = { lng0: 20, lat0: 50, cell: 0.1, cols: 10, rows: 10, km: 7 };
  const record = (name, extra = {}) => ({ name, sides: [["Aland"], ["Borduria"]], frame, status: "closed", openedDate: "2024-03-01", closedDate: "2024-04-30", chronicle, ...extra });
  const battlefields = [
    record("The Border"),
    record("The Coast", { closedDate: "2024-05-30" }),
    record("Unkept", { chronicle: undefined }),
    record("Open", { status: "active" }),
    record("Theirs", { sides: [["Ruritania"], ["Borduria"]] }),
  ];
  assert.deepEqual(reportsFor(battlefields, "Aland").map((entry) => entry.name), ["The Coast", "The Border"]);
  assert.deepEqual(reportsFor(battlefields, "Borduria").map((entry) => entry.name), ["The Coast", "The Border", "Theirs"]);
  assert.equal(reportKey("campaign", battlefields[0]), "campaign|the border|2024-04-30");
  assert.equal(isRecentReport(battlefields[0], "2024-05-15"), true);
  assert.equal(isRecentReport(battlefields[0], "2025-05-15"), false, "a war of long ago is in the list, not put before them");
  assert.equal(daysFought(battlefields[0]), 60);
});
