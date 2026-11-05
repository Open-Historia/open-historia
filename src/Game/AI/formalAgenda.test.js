/*! Open Historia — a Council's formal agenda shows its current business © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/formalAgenda.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { formalAgendaProposals } from "./formalAgenda.js";

const proposal = (id, status, lastUpdatedDate) => ({ id, title: `Proposal ${id}`, status, lastUpdatedDate });

// Twenty settled proposals inserted first, as an old institution's map holds
// them, and the live business after them.
const history = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => {
    const id = `old-${index + 1}`;
    return [id, proposal(id, index % 2 ? "archived" : "passed", `1990-01-${String(index + 1).padStart(2, "0")}`)];
  }),
);
const live = {
  "fisheries-accord": proposal("fisheries-accord", "debate", "1994-05-01"),
  "border-commission": proposal("border-commission", "voting", "1994-06-10"),
  "customs-union": proposal("customs-union", "amendment", "1993-11-20"),
};

test("current business is on the agenda however many settled proposals came before it", () => {
  const { open } = formalAgendaProposals({ ...history, ...live });
  assert.deepEqual(open.map((entry) => entry.id), ["border-commission", "fisheries-accord", "customs-union"]);
});

test("the most recently settled proposals fill a few of the remaining slots", () => {
  const { closed } = formalAgendaProposals({ ...history, ...live });
  assert.deepEqual(closed.map((entry) => entry.id), ["old-20", "old-19", "old-18", "old-17"]);
});

test("open business takes every slot before anything settled is shown", () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => {
    const id = `live-${index + 1}`;
    return [id, proposal(id, "debate", `1994-01-${String(index + 1).padStart(2, "0")}`)];
  }));
  const { open, closed } = formalAgendaProposals({ ...history, ...many });
  assert.equal(open.length, 16);
  assert.equal(open[0].id, "live-20", "the newest activity first");
  assert.deepEqual(closed, []);
});

test("activity is read as game dates, so a BC agenda sorts by the calendar", () => {
  const { open } = formalAgendaProposals({
    older: proposal("older", "debate", "-0490-08-12"),
    newer: proposal("newer", "debate", "-0480-09-20"),
    undated: proposal("undated", "draft", ""),
  });
  assert.deepEqual(open.map((entry) => entry.id), ["newer", "older", "undated"]);
});

test("no proposals is an empty agenda", () => {
  assert.deepEqual(formalAgendaProposals(undefined), { open: [], closed: [] });
  assert.deepEqual(formalAgendaProposals({ junk: null }), { open: [], closed: [] });
});
