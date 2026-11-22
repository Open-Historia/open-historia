/*! Open Historia — does the Projects board need a pass this turn: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/projects.boardPass.test.js
//
// Runs in a bare checkout: projects.js is import-free on purpose.
//
// boardPassReasons decides whether a turn's board is looked at (a Scene's map
// check): only when one of its events says, in its own board ops, that it did
// something to an entry or opened one. The engine runs the board, so the
// calendar never asks.

import test from "node:test";
import assert from "node:assert/strict";

import { boardPassReasons, eventOpensEffort } from "./projects.js";

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

test("an event that opens an effort asks for a look, even on an empty board; its words never do", () => {
  const starts = [
    event("Moscow launches a rearmament programme", "", { projectOps: [{ op: "create", name: "Rearmament", kind: "project", summary: "Ten years of naval spending." }] }),
    event("La France lance un programme spatial", "", { projectOps: [{ op: "create", name: "Programme spatial", kind: "project", summary: "Des lanceurs." }] }),
  ];
  for (const candidate of starts) {
    assert.equal(eventOpensEffort(candidate), true, candidate.title);
    assert.match(boardPassReasons({ ...NOW, board: [], events: [candidate] })[0], /opens a new entry/);
  }
  const ordinary = [
    event("Moscow launches a rearmament programme", "The cabinet approves ten years of naval spending."),
    event("The cabinet carries out the order", "", { actionIds: ["order-1"] }),
    event("A review of the fleet is ordered", "", { projectOps: [{ op: "update", name: "Elsewhere" }], actionIds: [] }),
  ];
  for (const candidate of ordinary) assert.equal(eventOpensEffort(candidate), false, candidate.title);
});

test("the calendar never asks: an entry long past its old target date, untouched for rounds, is the engine's to run", () => {
  const old = entry({ targetDate: "2010-01-01", updatedRound: 1, milestones: [{ title: "x", date: "2011-01-01", status: "pending" }], priority: "high" });
  assert.deepEqual(boardPassReasons({ ...NOW, board: [old], events: [] }), []);
});
