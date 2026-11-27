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
    `Northern Fleet refit/${RUSSIA}`, `Arctic rail link/${RUSSIA}`, `riga PORT (${RUSSIA})/${RUSSIA}`,
  ]);
  assert.deepEqual(lent.projects.map((row) => row.lentFrom ?? ""), ["", "", RUSSIA, RUSSIA, RUSSIA]);
  // Not lent: finished work and what its services know of others. A name the
  // game's board already has is lent with its country's after it: the board
  // keeps one entry of a name, and that work went without a skip.
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
  assert.equal(russia.find((row) => row.id === "ru-same").name, "riga PORT", "home under its own name");
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

// Lending stopped short of the game's board's limit, so the seats whose work came
// last had a skip that did not advance it (the follow-ups of 2026-11-18). Lent
// entries are the skip's alone, and count toward no limit (gameState.js capProjectList).
test("every player's open work is lent, however full the game's board is", () => {
  const crowded = world();
  crowded.projects = Array.from({ length: 120 }, (_, n) => project(`lv-${n}`, `Host project ${n}`, "", { status: n % 2 ? "complete" : "active" }));
  crowded.seatBoards.Poland = [project("pl-1", "Baltic pipeline"), project("pl-2", "Host project 3")];
  const lent = lendBoards(crowded, { host: LATVIA, humans: [LATVIA, RUSSIA, "Poland"] });
  assert.deepEqual(lent.projects.slice(120).map((row) => `${row.name}/${row.lentFrom}`), [
    `Northern Fleet refit/${RUSSIA}`, `Arctic rail link/${RUSSIA}`, `riga PORT/${RUSSIA}`,
    "Baltic pipeline/Poland", "Host project 3 (Poland)/Poland",
  ]);
});

test("the skip's two ends lend and home for the people the game names", () => {
  setHostingSharedGame(true, { host: LATVIA });
  try {
    const game = { country: LATVIA, humanCountries: [LATVIA, RUSSIA] };
    const bundle = { world: world(), game };
    const lent = withBoardsLent(bundle);
    assert.notEqual(lent, bundle);
    assert.equal(bundle.world.projects.length, 2, "the world it was read from is not touched");
    assert.equal(lent.world.projects.filter((row) => row.lentFrom === RUSSIA).length, 3);
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
    `game:lv-1:${LATVIA}`, `game:lv-on-ee:${ESTONIA}`, `game:ru-1:${RUSSIA}`, `game:ru-2:${RUSSIA}`, `game:ru-same:${RUSSIA}`,
    `${RUSSIA}:ru-done:${RUSSIA}`,
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

// A programme opened from material planted on a service through its turned agent
// is that service's belief, never another country's real work (the follow-ups of
// 2026-11-18): the skip names the service (believedBy), and the commit takes it
// to that service's own board, as that board's government's (belief).
test("a belief a skip opened goes home to its believer's board, and is nobody's work", () => {
  const spies = [
    { id: "spy-lv-ee", owner: LATVIA, target: ESTONIA, status: "turned", turnedAt: "2026-01-01" },
    { id: "spy-ru-ee", owner: RUSSIA, target: ESTONIA, status: "turned", turnedAt: "2026-01-01" },
    { id: "spy-lv-ru", owner: LATVIA, target: RUSSIA, status: "active" },
  ];
  const before = { ...lendBoards(world(), who), spies };
  const skipped = {
    ...before,
    projects: [
      ...before.projects,
      project("b-lv", "Estonian atom bomb", ESTONIA, { believedBy: LATVIA }),
      project("b-ru", "Estonian navy", ESTONIA, { believedBy: RUSSIA.toUpperCase() }),
      project("b-ai", "Estonian moon shot", ESTONIA, { believedBy: "Finland" }),
      project("b-loyal", "Russian rail gun", RUSSIA, { believedBy: LATVIA }),
    ],
  };
  const home = returnBoards(skipped, { ...who, before });
  const hostBelief = home.projects.find((row) => row.id === "b-lv");
  assert.deepEqual([hostBelief.belief, "believedBy" in hostBelief, hostBelief.ownerCode, hostBelief.linkedSpyIds], [true, false, ESTONIA, ["spy-lv-ee"]]);
  const guestBelief = home.seatBoards[RUSSIA].find((row) => row.id === "b-ru");
  assert.deepEqual([guestBelief.belief, "believedBy" in guestBelief, guestBelief.ownerCode, guestBelief.linkedSpyIds], [true, false, ESTONIA, ["spy-ru-ee"]]);
  assert.equal(home.projects.some((row) => row.id === "b-ru"), false);
  // An AI country's service keeps no board; a loyal agent carried nothing planted.
  assert.equal(JSON.stringify(home).includes("Estonian moon shot"), false);
  assert.equal(JSON.stringify(home).includes("Russian rail gun"), false, "and never Russia's own work, sent to its board");
  // Nobody's work, wherever it is kept, and nobody's but its believer's to see.
  assert.equal(workOfEveryCountry(home, { host: LATVIA }).some(({ project: row }) => row.belief), false);
  const lv = boardSeenBy(home, LATVIA, { host: LATVIA });
  const seen = lv.find((row) => row.id === "b-lv");
  assert.deepEqual([seen.ownerCode, seen.linkedSpyIds, "belief" in seen], [ESTONIA, ["spy-lv-ee"], false], "its service is never told it was planted");
  assert.equal(lv.some((row) => row.id === "b-ru"), false);
  const ru = boardSeenBy(home, RUSSIA, { host: LATVIA });
  assert.deepEqual([ru.some((row) => row.id === "b-ru"), ru.some((row) => row.id === "b-lv"), "belief" in ru.find((row) => row.id === "b-ru")], [true, false, false]);
  // Never lent to a skip: nothing runs it.
  assert.equal(lendBoards(home, who).projects.some((row) => row.id === "b-ru"), false);
});

test("in single player a belief stays on the game's board as the player's service's", () => {
  const game = { country: LATVIA };
  const solo = { projects: [project("p", "Canal"), project("b", "Estonian atom bomb", ESTONIA, { believedBy: LATVIA })], spies: [{ id: "s", owner: LATVIA, target: ESTONIA, status: "turned" }] };
  const home = withBoardsHome(solo, { before: { projects: [solo.projects[0]] }, game });
  assert.deepEqual(home.projects.map((row) => [row.id, row.belief === true, "believedBy" in row]), [["p", false, false], ["b", true, false]]);
  assert.equal("seatBoards" in home, false, "a single-player save never gains the other boards' key");
});

// Ported from beta's "preserve identity during project seat lending" (thekernely,
// PR #1047): an id, not a name, is an entry's identity; a seat's entry that
// shares an id with the game's own never takes its place; and what a skip lends
// survives the game's own normalizer and comes home to the right board.
test("distinct entries of one name are all lent, each under a name of its own, and come home under theirs", () => {
  const record = world();
  record.seatBoards[RUSSIA] = [
    project("ru-a", "Riga port"),
    project("ru-b", "Riga port"),
    project("ru-c", "Tallinn shipyard", RUSSIA),
  ];
  const lent = lendBoards(record, who);
  assert.deepEqual(lent.projects.map((row) => row.id), ["lv-1", "lv-on-ee", "ru-a", "ru-b", "ru-c"], "a title cannot hide another seat's work");
  assert.equal(new Set(lent.projects.map((row) => row.name.toLowerCase())).size, lent.projects.length, "the skip can name each one");
  const home = returnBoards(lent, { ...who, before: lent });
  assert.deepEqual(home.seatBoards[RUSSIA].map((row) => [row.id, row.name]), [["ru-a", "Riga port"], ["ru-b", "Riga port"], ["ru-c", "Tallinn shipyard"]]);
  assert.deepEqual(home.projects.map((row) => row.id), ["lv-1", "lv-on-ee"]);
});

test("a seat's entry with the id of one of the game's own is never lent over it", () => {
  const record = world();
  record.seatBoards[RUSSIA].unshift(project("lv-1", "Unrelated foreign title"));
  const lent = lendBoards(record, who);
  assert.equal(lent.projects.filter((row) => row.id === "lv-1").length, 1);
  assert.deepEqual([lent.projects.find((row) => row.id === "lv-1").name, lent.projects.find((row) => row.id === "lv-1").ownerCode], ["Riga port", ""]);
  assert.deepEqual(record.seatBoards[RUSSIA][0], project("lv-1", "Unrelated foreign title"), "the other seat's record stays untouched");
});

test("what a skip lends survives the game's normalizer and goes home to the right board", async () => {
  const { normalizeWorldState } = await import("./gameState.js");
  const lent = lendBoards(world(), who);
  const normalized = normalizeWorldState(lent);
  assert.deepEqual(normalized.projects.filter((row) => row.lentFrom).map((row) => [row.id, row.lentFrom]), [["ru-1", RUSSIA], ["ru-2", RUSSIA], ["ru-same", RUSSIA]]);
  const home = returnBoards(normalized, { ...who, before: lent });
  assert.deepEqual(home.projects.map((row) => row.id), ["lv-1", "lv-on-ee"]);
  assert.equal(home.projects.some((row) => row.lentFrom) || home.seatBoards[RUSSIA].some((row) => row.lentFrom), false);
  assert.ok(home.seatBoards[RUSSIA].some((row) => row.id === "ru-same" && row.name === "riga PORT"));
});

test("an older lending's leftovers go home by what that lending recorded, never by a shared id alone", () => {
  // The game's own entry and a seat's share an id; the game's is no copy (its
  // owner is not that seat's country), and stays where it is.
  const clash = world();
  clash.seatBoards[RUSSIA].unshift(project("lv-1", "Unrelated foreign title"));
  const kept = settleBoards(clash);
  assert.equal(kept, clash, "nothing to settle");
  assert.equal(boardSeenBy(clash, LATVIA, { host: LATVIA }).find((row) => row.id === "lv-1")?.name, "Riga port");
  // A beta save recorded what it lent (id to seat): that, and only that, goes home.
  const beta = world();
  beta.seatBoards[RUSSIA].unshift(project("lv-1", "Unrelated foreign title"));
  beta.projects.push({ ...project("ru-1", "Northern Fleet refit", RUSSIA), progress: 40 });
  beta.projectSeatLoans = { "ru-1": RUSSIA };
  const settled = settleBoards(beta);
  assert.deepEqual(settled.projects.map((row) => [row.id, row.name]), [["lv-1", "Riga port"], ["lv-on-ee", "Tallinn shipyard"]]);
  assert.equal(settled.seatBoards[RUSSIA].find((row) => row.id === "ru-1").progress, 40);
  assert.equal(settled.seatBoards[RUSSIA].find((row) => row.id === "lv-1").name, "Unrelated foreign title");
  assert.equal("projectSeatLoans" in settled, false, "the record is read and dropped");
  // An empty record is dropped too, and lending again lends once.
  const empty = { ...world(), projectSeatLoans: {} };
  assert.equal("projectSeatLoans" in settleBoards(empty), false);
  assert.equal(lendBoards(beta, who).projects.filter((row) => row.id === "ru-1").length, 1);
});

test("no view shows an older lending's record", async () => {
  const { projectWorld } = await import("../multiplayer/host/projection.js");
  const beta = { ...world(), projectSeatLoans: { "ru-1": RUSSIA } };
  for (const viewer of [LATVIA, RUSSIA, ESTONIA]) {
    assert.equal(projectWorld(beta, viewer, { host: LATVIA }).projectSeatLoans, undefined);
  }
});
