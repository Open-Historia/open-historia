/*! Open Historia — does the Projects board need a pass this turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/projects.boardPass.test.js
//
// Runs in a bare checkout: projects.js is import-free on purpose.
//
// boardPassReasons decides whether a time skip pays a request for the board. Too
// eager and a player with one overdue programme pays double for every turn they
// ever play; too shy and the board stops opening entries and goes quiet, which
// is the failure the board exists to prevent. Both directions are pinned.

import test from "node:test";
import assert from "node:assert/strict";

import { BOARD_PASS_QUIET_ROUNDS, STALE_ROUNDS, boardPassReasons, eventStartsLongEffort } from "./projects.js";

const entry = (overrides = {}) => ({
  id: "p1",
  name: "Project Leviathan",
  summary: "A deep-water dreadnought squadron built at the Kronstadt yards.",
  status: "active",
  progress: 40,
  ownerCode: "",
  priority: "normal",
  targetDate: "2016-01-01",
  milestones: [],
  updatedRound: 9,
  ...overrides,
});

const event = (title, description = "", impacts = {}) => ({ title, description, date: "2014-03-10", impacts });

const NOW = { gameDate: "2014-03-30", round: 10, playerCountry: "Russian Federation" };

test("a quiet turn on a healthy board asks for nothing", () => {
  const reasons = boardPassReasons({
    ...NOW,
    board: [entry()],
    events: [event("Grain prices ease in Odessa", "A good harvest brings bread prices down across the south.")],
  });
  assert.deepEqual(reasons, []);
  assert.deepEqual(boardPassReasons(), []);
  assert.deepEqual(boardPassReasons({ ...NOW, board: [], events: [] }), []);
});

test("an event whose own board ops address an open entry asks for a pass, in any language", () => {
  const slips = { projectOps: [{ op: "update", projectId: "p1", status: "stalled", lastUpdate: "Steel shortages." }] };
  for (const told of [
    event("Project Leviathan slips", "Steel shortages delay Project Leviathan by a season.", slips),
    event("Le projet Léviathan prend du retard", "La pénurie d'acier le retarde d'une saison.", slips),
    event("Проект «Левиафан» задерживается", "Нехватка стали.", slips),
  ]) {
    const reasons = boardPassReasons({ ...NOW, board: [entry()], events: [told] });
    assert.equal(reasons.length, 1, told.title);
    assert.match(reasons[0], /concerns "Project Leviathan"/);
  }
});

// Its name in the words bought a request in English and none in French: a pass
// is never bought by words.
test("an event that only names an entry in its words asks for nothing", () => {
  for (const told of [
    event("Project Leviathan slips", "Steel shortages delay Project Leviathan by a season."),
    event("Le projet Leviathan prend du retard", "La pénurie d'acier retarde le projet Leviathan."),
  ]) {
    assert.deepEqual(boardPassReasons({ ...NOW, board: [entry()], events: [told] }), [], told.title);
  }
});

test("an event about a closed entry does not", () => {
  const reasons = boardPassReasons({
    ...NOW,
    board: [entry({ status: "complete" })],
    events: [event("Project Leviathan remembered", "Veterans of Project Leviathan gather for an anniversary.", { projectOps: [{ op: "update", projectId: "p1" }] })],
  });
  assert.deepEqual(reasons, []);
});

test("an event that opens an effort or carries out an order may start an entry, even on an empty board; its words never do", () => {
  const starts = [
    event("Moscow launches a rearmament programme", "", { projectOps: [{ op: "create", name: "Rearmament", kind: "project", summary: "Ten years of naval spending." }] }),
    event("La France lance un programme spatial", "", { projectOps: [{ op: "create", name: "Programme spatial", kind: "project", summary: "Des lanceurs." }] }),
    event("The cabinet carries out the order", "", { actionIds: ["order-1"] }),
    event("内阁执行了命令", "", { actionIds: ["order-1"] }),
  ];
  for (const candidate of starts) {
    assert.equal(eventStartsLongEffort(candidate), true, candidate.title);
    assert.match(boardPassReasons({ ...NOW, board: [], events: [candidate] })[0], /may start a new entry/);
  }
  const ordinary = [
    // "launches ... programme" bought a pass in English, and "lance un programme" none.
    event("Moscow launches a rearmament programme", "The cabinet approves ten years of naval spending."),
    event("La France lance un programme spatial", "Le gouvernement approuve dix ans de dépenses."),
    event("Border guards exchange fire near Luhansk", "Two soldiers are wounded in a brief clash."),
    event("A review of the fleet is ordered", "", { projectOps: [{ op: "update", projectId: "p1" }], actionIds: [] }),
  ];
  for (const candidate of ordinary) assert.equal(eventStartsLongEffort(candidate), false, candidate.title);
});

test("the calendar asks: an overdue entry, a slipped milestone, a long silence", () => {
  const overdue = boardPassReasons({ ...NOW, board: [entry({ targetDate: "2014-01-01", updatedRound: 8 })] });
  assert.match(overdue[0], /past its target date/);

  const slipped = boardPassReasons({
    ...NOW,
    board: [entry({ updatedRound: 8, milestones: [{ id: "m1", title: "Keel laid", date: "2014-02-01", status: "pending" }] })],
  });
  assert.match(slipped[0], /missed a milestone/);

  const silent = boardPassReasons({ ...NOW, board: [entry({ updatedRound: NOW.round - STALE_ROUNDS })] });
  assert.match(silent[0], /no report for 3 rounds/);
});

test("an entry looked at last round is left alone this round, however overdue it is", () => {
  const board = [entry({ targetDate: "2014-01-01", updatedRound: NOW.round - 1 })];
  assert.deepEqual(boardPassReasons({ ...NOW, board }), []);
  assert.equal(boardPassReasons({ ...NOW, board: [entry({ targetDate: "2014-01-01", updatedRound: NOW.round - BOARD_PASS_QUIET_ROUNDS })] }).length, 1);
});

test("a pass that ran last round and rightly touched nothing still buys the board a round of quiet", () => {
  const board = [entry({ targetDate: "2014-01-01", updatedRound: 3 })];
  assert.equal(boardPassReasons({ ...NOW, board, reviewedRound: 0 }).length, 1, "never reviewed");
  assert.deepEqual(boardPassReasons({ ...NOW, board, reviewedRound: NOW.round - 1 }), []);
  assert.equal(boardPassReasons({ ...NOW, board, reviewedRound: NOW.round - BOARD_PASS_QUIET_ROUNDS }).length, 1);
  // But never from an event: that is news, not the calendar.
  const withNews = boardPassReasons({
    ...NOW, board, reviewedRound: NOW.round - 1,
    events: [event("Project Leviathan slips", "Steel shortages delay Project Leviathan.", { projectOps: [{ op: "update", projectId: "p1", status: "stalled" }] })],
  });
  assert.equal(withNews.length, 1);
});

test("a reviewed round from another campaign's future counts as never", () => {
  const board = [entry({ targetDate: "2014-01-01", updatedRound: 0 })];
  assert.equal(boardPassReasons({ ...NOW, round: 2, board, reviewedRound: 41 }).length, 1);
});

test("the player's own HIGH PRIORITY entry is assessed at least every second skip", () => {
  const mine = entry({ priority: "high", updatedRound: NOW.round - BOARD_PASS_QUIET_ROUNDS });
  assert.match(boardPassReasons({ ...NOW, board: [mine] })[0], /HIGH PRIORITY/);
  assert.deepEqual(boardPassReasons({ ...NOW, board: [entry({ priority: "high", updatedRound: NOW.round - 1 })] }), []);
  // A rival's programme is not the player's to prioritise, and buys nothing.
  const theirs = entry({ priority: "high", ownerCode: "Ukraine", updatedRound: NOW.round - BOARD_PASS_QUIET_ROUNDS });
  assert.deepEqual(boardPassReasons({ ...NOW, board: [theirs] }), []);
});

test("an entry that has never carried a round is looked at once", () => {
  assert.match(boardPassReasons({ ...NOW, board: [entry({ targetDate: "2014-01-01", updatedRound: 0 })] })[0], /past its target date/);
});

// The false positive a live run turned up (2026-09-17): the engine's own covert
// entry is called "Agent in <country>", so in a campaign fought over that
// country every event naming it matched, and the board job bought a request a
// skip. The engine syncs those entries itself, before the board pass runs; and
// an event's words no longer match any entry at all.
test("the engine's own covert entries never buy the board a request", () => {
  const covertEntry = {
    id: "proj-spy-1",
    name: "Agent in Ukraine",
    kind: "operation",
    secrecy: "covert",
    status: "active",
    ongoing: true,
    summary: "An agent of ours is in place inside Ukraine, reading its private diplomacy.",
    linkedSpyIds: ["spy-1"],
    updatedRound: 1,
  };
  const event = {
    title: "Fighting spreads in eastern Ukraine",
    description: "Separatist columns push west of Donetsk; Ukraine mobilises two more brigades.",
  };

  assert.deepEqual(
    boardPassReasons({ board: [covertEntry], events: [event], round: 9, reviewedRound: 0, playerCountry: "Poland" }),
    [],
    "an ordinary war event must not wake the board just because the agent's entry names the country",
  );
  // ...and the calendar does not wake it for one either: it is never overdue,
  // never stale in a way the model could fix, and the engine closes it itself.
  assert.deepEqual(
    boardPassReasons({ board: [{ ...covertEntry, updatedRound: 1 }], events: [], round: 30, reviewedRound: 0, playerCountry: "Poland" }),
    [],
  );

  // Nor does an op on it: the engine moves it, not the model.
  assert.deepEqual(
    boardPassReasons({ board: [covertEntry], events: [{ ...event, impacts: { projectOps: [{ op: "update", projectId: "proj-spy-1" }] } }], round: 9, reviewedRound: 0, playerCountry: "Poland" }),
    [],
  );

  // A real entry of the player's own, which the event's op moves, still does.
  const realEntry = { ...covertEntry, id: "proj-2", name: "Ukraine Support Programme", linkedSpyIds: [], summary: "Arms and training for Ukraine's brigades.", updatedRound: 9 };
  assert.deepEqual(
    boardPassReasons({ board: [realEntry], events: [event], round: 9, reviewedRound: 0, playerCountry: "Poland" }),
    [],
    "its words alone are no reason",
  );
  assert.ok(
    boardPassReasons({ board: [realEntry], events: [{ ...event, impacts: { projectOps: [{ op: "update", projectId: "proj-2", progress: 30 }] } }], round: 9, reviewedRound: 0, playerCountry: "Poland" }).length > 0,
    "a genuine entry the event moves is still a reason",
  );
});
