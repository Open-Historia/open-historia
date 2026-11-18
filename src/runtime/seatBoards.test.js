/*! Open Historia — every player's Projects board: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/seatBoards.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
  boardSeenBy,
  lendBoards,
  returnBoards,
  seatBoardInSkip,
  settleBoards,
  withBoardsHome,
  withBoardsLent,
  withSeatBoardInSkip,
  workOfEveryCountry,
} from "./seatBoards.js";
import { setHostingSharedGame } from "./humanPolities.js";

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
  const bundle = { world: solo, game: { country: LATVIA } };
  assert.equal(withBoardsLent(bundle), bundle, "single player's skip reads its world as it is");
  assert.equal(withBoardsHome(solo, { before: solo, game: bundle.game }), solo);
});

test("before a skip each other player's own open work stands on the game's board, under its country's name, marked lent", () => {
  const lent = lendBoards(world(), who);
  assert.deepEqual(names(lent.projects), [
    "Riga port/", `Tallinn shipyard/${ESTONIA}`,
    `Northern Fleet refit/${RUSSIA}`, `Arctic rail link/${RUSSIA}`,
  ]);
  assert.deepEqual(lent.projects.map((row) => row.lentFrom ?? ""), ["", "", RUSSIA, RUSSIA]);
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
  const home = returnBoards(skipped, { ...who, before: lent });
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
  assert.equal(JSON.stringify(home).includes("lentFrom"), false, "nothing lent is left anywhere");
});

test("what the host's services had on file about a player's country stays the host's", () => {
  const before = world();
  before.projects.push(project("lv-on-ru", "Murmansk yard", RUSSIA));
  const lent = lendBoards(before, who);
  const home = returnBoards(lent, { ...who, before: lent });
  assert.ok(home.projects.some((row) => row.id === "lv-on-ru"));
  assert.equal(home.seatBoards[RUSSIA].some((row) => row.id === "lv-on-ru"), false);
});

test("the skip's own copy only: lending is never written, and an older version's leftovers go home as the skip left them", () => {
  // An older version wrote the lending into the stored world; an engine closed
  // during the skip left the copies there, unmarked, the skip's progress on them.
  const left = world();
  left.projects.push({ ...project("ru-1", "Northern Fleet refit", RUSSIA), progress: 40 });
  const settled = settleBoards(left);
  assert.deepEqual(names(settled.projects), ["Riga port/", `Tallinn shipyard/${ESTONIA}`]);
  assert.deepEqual(settled.seatBoards[RUSSIA].find((row) => row.id === "ru-1"), { ...project("ru-1", "Northern Fleet refit"), progress: 40 });
  // Lent again, it is lent once.
  assert.deepEqual(lendBoards(left, who).projects.filter((row) => row.id === "ru-1").length, 1);
});

test("an entry the skip dropped for want of room comes home as it left", () => {
  const lent = lendBoards(world(), who);
  const dropped = { ...lent, projects: lent.projects.filter((row) => row.id !== "ru-1") };
  const home = returnBoards(dropped, { ...who, before: lent });
  assert.deepEqual(home.seatBoards[RUSSIA].find((row) => row.id === "ru-1"), world().seatBoards[RUSSIA][0]);
});

test("the game's board is never lent past its room", () => {
  const crowded = world();
  crowded.projects = Array.from({ length: 107 }, (_, n) => project(`lv-${n}`, `Host project ${n}`));
  const lent = lendBoards(crowded, who);
  assert.equal(lent.projects.length, 108, "one more fits under the room kept for the skip itself");
});

test("the skip's two ends lend and home for the people the game names", () => {
  setHostingSharedGame(true, { host: LATVIA });
  try {
    const game = { country: LATVIA, humanCountries: [LATVIA, RUSSIA] };
    const bundle = { world: world(), game };
    const lent = withBoardsLent(bundle);
    assert.notEqual(lent, bundle);
    assert.equal(bundle.world.projects.length, 2, "the world it was read from is not touched");
    assert.equal(lent.world.projects.filter((row) => row.lentFrom === RUSSIA).length, 2);
    const home = withBoardsHome(lent.world, { before: lent.world, game });
    assert.deepEqual(home.projects, world().projects);
    assert.deepEqual(home.seatBoards, world().seatBoards);
  } finally {
    setHostingSharedGame(false);
  }
});

test("while its work is out, a player's board is its entries with the lent ones as the skip has them, and changes go back where each is", () => {
  const lent = lendBoards(world(), who);
  lent.projects = lent.projects.map((row) => (row.id === "ru-1" ? { ...row, progress: 30 } : row));
  const board = seatBoardInSkip(lent, RUSSIA);
  assert.deepEqual(board.map((row) => [row.id, row.ownerCode, row.progress, "lentFrom" in row]), [
    ["ru-1", "", 30, false], ["ru-2", RUSSIA, 10, false], ["ru-done", "", 10, false], ["ru-on-lv", LATVIA, 10, false], ["ru-same", "", 10, false],
  ]);
  const changed = [...board.map((row) => (row.id === "ru-1" ? { ...row, status: "cancelled" } : row)), project("ru-agent", "Agent in Estonia")];
  const back = withSeatBoardInSkip(lent, RUSSIA, changed);
  const out = back.projects.find((row) => row.id === "ru-1");
  assert.deepEqual([out.status, out.progress, out.ownerCode, out.lentFrom], ["cancelled", 30, RUSSIA, RUSSIA], "the lent copy carries the change home");
  assert.deepEqual(back.seatBoards[RUSSIA].map((row) => row.id), ["ru-1", "ru-2", "ru-done", "ru-on-lv", "ru-same", "ru-agent"]);
  assert.equal(back.seatBoards[RUSSIA][0].status, "active", "the entry at home waits for its copy");
  const home = returnBoards(back, { ...who, before: lent });
  assert.equal(home.seatBoards[RUSSIA].find((row) => row.id === "ru-1").status, "cancelled");
});

test("every country's work, wherever it is kept, each with its owner: a seat's files on others are no country's work", () => {
  const lent = lendBoards(world(), who);
  const work = workOfEveryCountry(lent, { host: LATVIA });
  assert.deepEqual(work.map(({ board, project: row, owner }) => `${board || "game"}:${row.id}:${owner}`), [
    `game:lv-1:${LATVIA}`, `game:lv-on-ee:${ESTONIA}`, `game:ru-1:${RUSSIA}`, `game:ru-2:${RUSSIA}`,
    `${RUSSIA}:ru-done:${RUSSIA}`, `${RUSSIA}:ru-same:${RUSSIA}`,
  ]);
});

test("each player's board as its screen shows it: its own, and every other country's work it may know of, with only what it knows", () => {
  const seen = {
    projects: [
      project("lv-1", "Riga port", "", { secrecy: "public", eventIds: ["e-public", "e-secret"] }),
      project("lv-agent", "Agent in Russia", "", { secrecy: "covert", linkedSpyIds: ["spy-lv-ru"] }),
      project("ee-1", "Tallinn shipyard", ESTONIA, { secrecy: "covert", linkedSpyIds: ["spy-lv-ee"], known: true, knownBy: { [RUSSIA]: { spyIds: ["spy-ru-ee"], verification: "doubted" } } }),
      project("ee-2", "Narva dam", ESTONIA, { secrecy: "covert" }),
    ],
    seatBoards: {
      [RUSSIA]: [
        project("ru-1", "Northern Fleet refit", "", { secrecy: "covert", knownBy: { [LATVIA]: { spyIds: ["spy-lv-ru"] } } }),
        project("ru-2", "Arctic rail link", "", { secrecy: "public" }),
        project("ru-3", "Kola works", "", { secrecy: "restricted" }),
        project("ru-on-ee", "Narva file", ESTONIA, { secrecy: "public" }),
      ],
    },
  };
  const hidden = new Set(["e-secret"]);
  const ru = boardSeenBy(seen, RUSSIA, { host: LATVIA, hiddenEventIds: hidden });
  assert.deepEqual(ru.map((row) => `${row.id}/${row.ownerCode}`), [
    "ru-1/", "ru-2/", "ru-3/", "ru-on-ee/" + ESTONIA,
    `lv-1/${LATVIA}`, `ee-1/${ESTONIA}`,
  ]);
  assert.equal("knownBy" in ru[0], false, "never what anyone else knows of its own work");
  const tallinn = ru.find((row) => row.id === "ee-1");
  assert.deepEqual([tallinn.linkedSpyIds, tallinn.verification, tallinn.known, "knownBy" in tallinn], [["spy-ru-ee"], "doubted", true, false], "what Russia knows, never what Latvia does");
  assert.deepEqual(ru.find((row) => row.id === "lv-1").eventIds, ["e-public"], "never an event it is not shown");

  const lv = boardSeenBy(seen, LATVIA, { host: LATVIA });
  assert.deepEqual(lv.map((row) => `${row.id}/${row.ownerCode}`), [
    "lv-1/", "lv-agent/", `ee-1/${ESTONIA}`, `ee-2/${ESTONIA}`,
    `ru-1/${RUSSIA}`, `ru-2/${RUSSIA}`,
  ], "the game's own board as single player keeps it, then what it may know of Russia's");
  assert.deepEqual(lv.find((row) => row.id === "ee-1").linkedSpyIds, ["spy-lv-ee"], "the host's own files as they are");
  assert.equal("knownBy" in lv.find((row) => row.id === "ee-1"), false);
  assert.deepEqual(lv.find((row) => row.id === "ru-1").linkedSpyIds, ["spy-lv-ru"]);
  assert.equal(JSON.stringify(lv).includes("Narva file"), false, "a seat's files on others are its own");
  // Single player's board is its own, as it was.
  assert.deepEqual(boardSeenBy({ projects: seen.projects }, LATVIA, { host: LATVIA }).map((row) => row.id), ["lv-1", "lv-agent", "ee-1", "ee-2"]);
});
