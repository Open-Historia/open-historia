/*! Open Historia — every player's Projects board through a time skip: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/multiplayer/host/seatBoards.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { lendBoards, returnBoards, settleBoards } from "./seatBoards.js";

const LATVIA = "Republic of Latvia"; // the host's seat
const RUSSIA = "Russian Federation"; // a second person
const ESTONIA = "Republic of Estonia"; // the AI's
const who = { host: LATVIA, humans: [LATVIA, RUSSIA] };
const project = (id, name, ownerCode = "", extra = {}) => ({ id, name, kind: "project", ownerCode, status: "active", progress: 10, ...extra });
const world = () => ({
  projects: [project("lv-1", "Riga port"), project("lv-on-ee", "Tallinn shipyard", ESTONIA)],
  seatBoards: {
    [RUSSIA]: [
      project("ru-1", "Northern Fleet refit"),
      project("ru-2", "Arctic rail link", RUSSIA),
      project("ru-done", "Pipeline", "", { status: "complete" }),
      project("ru-on-lv", "Riga port file", LATVIA),
      project("ru-same", "riga PORT"),
    ],
  },
});
const names = (rows) => rows.map((row) => `${row.name}/${row.ownerCode}`);

test("a game with no other boards is left exactly as it is", () => {
  const solo = { projects: [project("p", "Canal")] };
  assert.equal(lendBoards(solo, { host: LATVIA, humans: [LATVIA] }), solo);
  assert.equal(returnBoards(solo, { host: LATVIA, humans: [LATVIA] }), solo);
  assert.equal(settleBoards(solo), solo);
});

test("before a skip each other player's own open work stands on the game's board, under its country's name", () => {
  const lent = lendBoards(world(), who);
  assert.deepEqual(names(lent.projects), [
    "Riga port/", `Tallinn shipyard/${ESTONIA}`,
    `Northern Fleet refit/${RUSSIA}`, `Arctic rail link/${RUSSIA}`,
  ]);
  // Not lent: finished work, what its services know of others, and a name the game's board already has.
  assert.deepEqual(lent.seatBoards, world().seatBoards, "nothing leaves home while it is out");
});

test("a country nobody plays just now lends nothing, and neither does the host's own", () => {
  assert.deepEqual(names(lendBoards(world(), { host: LATVIA, humans: [LATVIA] }).projects), ["Riga port/", `Tallinn shipyard/${ESTONIA}`]);
  const odd = { ...world(), seatBoards: { [LATVIA]: [project("x", "Odd")] } };
  assert.deepEqual(names(lendBoards(odd, who).projects), ["Riga port/", `Tallinn shipyard/${ESTONIA}`]);
});

test("after the skip each entry goes home as the skip left it, its owner as its own board keeps it", () => {
  const lent = lendBoards(world(), who);
  const hostHad = new Set(["lv-1", "lv-on-ee"]);
  // The skip moved one entry, finished another and opened three.
  const skipped = {
    ...lent,
    projects: [
      ...lent.projects.map((row) => (row.id === "ru-1" ? { ...row, progress: 55 } : row.id === "ru-2" ? { ...row, status: "complete", progress: 100 } : row)),
      project("new-ru", "Kaliningrad garrison", RUSSIA),
      project("new-lv", "Daugava bridge"),
      project("new-on-ee", "Estonian border wall", ESTONIA),
    ],
  };
  const home = returnBoards(skipped, { ...who, hostHad });
  assert.deepEqual(names(home.projects), ["Riga port/", `Tallinn shipyard/${ESTONIA}`, "Daugava bridge/", `Estonian border wall/${ESTONIA}`]);
  const russia = home.seatBoards[RUSSIA];
  assert.deepEqual(russia.map((row) => [row.id, row.ownerCode, row.status, row.progress]), [
    ["ru-1", "", "active", 55],
    ["ru-2", RUSSIA, "complete", 100],
    ["ru-done", "", "complete", 10],
    ["ru-on-lv", LATVIA, "active", 10],
    ["ru-same", "", "active", 10],
    ["new-ru", "", "active", 10],
  ]);
});

test("what the host's services had on file about a player's country stays the host's", () => {
  const before = world();
  before.projects.push(project("lv-on-ru", "Murmansk yard", RUSSIA));
  const lent = lendBoards(before, who);
  const home = returnBoards(lent, { ...who, hostHad: new Set(["lv-1", "lv-on-ee", "lv-on-ru"]) });
  assert.ok(home.projects.some((row) => row.id === "lv-on-ru"));
  assert.equal(home.seatBoards[RUSSIA].some((row) => row.id === "lv-on-ru"), false);
});

test("a skip that never finished leaves nothing behind: lending again settles first", () => {
  const stuck = lendBoards(world(), who);
  // The entries at home are as they were; the copies are still out.
  assert.deepEqual(names(settleBoards(stuck).projects), ["Riga port/", `Tallinn shipyard/${ESTONIA}`]);
  assert.deepEqual(names(lendBoards(stuck, who).projects), names(stuck.projects), "lent once, however often it is asked");
});

test("an entry the skip dropped for want of room comes home as it left", () => {
  const lent = lendBoards(world(), who);
  const dropped = { ...lent, projects: lent.projects.filter((row) => row.id !== "ru-1") };
  const home = returnBoards(dropped, { ...who, hostHad: new Set(["lv-1", "lv-on-ee"]) });
  assert.deepEqual(home.seatBoards[RUSSIA].find((row) => row.id === "ru-1"), world().seatBoards[RUSSIA][0]);
});

test("the game's board is never lent past its room", () => {
  const crowded = world();
  crowded.projects = Array.from({ length: 107 }, (_, n) => project(`lv-${n}`, `Host project ${n}`));
  const lent = lendBoards(crowded, who);
  assert.equal(lent.projects.length, 108, "one more fits under the room kept for the skip itself");
});
