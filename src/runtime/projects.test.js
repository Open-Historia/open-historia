/*! Open Historia — portions (projects board derived-state tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Runs in a BARE CHECKOUT (no node_modules): projects.js is import-free on
// purpose, the same as unitMotion.js and eventFocus.js. Keep it that way —
// `node --test src/runtime/projects.test.js` is the whole point.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DUE_SOON_DAYS,
  STALE_ROUNDS,
  advanceRecurringDate,
  normalizeMilestoneRepeat,
  collectProjectTags,
  deriveNextMilestone,
  deriveProjectFlags,
  describeTimeline,
  filterProjects,
  isProjectClosed,
  isProjectOpen,
  isPlayerProject,
  signedDaysBetween,
  sortProjects,
} from "./projects.js";

const project = (overrides = {}) => ({
  id: "p1",
  name: "Project Leviathan",
  kind: "project",
  ownerCode: "",
  summary: "Autonomous ship programme.",
  status: "active",
  progress: 58,
  tags: ["military", "naval"],
  secrecy: "public",
  startedAt: "1962-03-01",
  targetDate: "1965-06-01",
  milestones: [],
  nextMilestone: null,
  lastUpdate: "",
  eventIds: [],
  linkedUnitIds: [],
  linkedMarkerIds: [],
  focus: null,
  note: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedRound: 4,
  ...overrides,
});

test("signedDaysBetween keeps the sign, unlike daysBetweenDates", () => {
  assert.equal(signedDaysBetween("1963-01-01", "1963-01-31"), 30);
  assert.equal(signedDaysBetween("1963-01-31", "1963-01-01"), -30);
  assert.equal(signedDaysBetween("1963-01-01", "1963-01-01"), 0);
});

test("signedDaysBetween refuses anything that is not strict YYYY-MM-DD", () => {
  // Deliberately non-Gregorian scenario dates must yield no flags rather than
  // nonsense ones.
  assert.equal(signedDaysBetween("1200 BCE", "1963-01-01"), null);
  assert.equal(signedDaysBetween("1963-01-01", "December 31, 1963"), null);
  assert.equal(signedDaysBetween("", "1963-01-01"), null);
  assert.equal(signedDaysBetween("1963-1-1", "1963-01-01"), null);
});

test("deriveNextMilestone prefers the earliest dated pending milestone", () => {
  const next = deriveNextMilestone(project({
    milestones: [
      { id: "m1", title: "Keel laid", date: "1962-03-01", status: "done", note: "" },
      { id: "m2", title: "Fitting out", date: "1964-02-01", status: "pending", note: "" },
      { id: "m3", title: "Sea trials", date: "1963-11-04", status: "pending", note: "" },
    ],
  }));
  assert.equal(next.title, "Sea trials");
});

test("deriveNextMilestone returns null once everything is done", () => {
  assert.equal(deriveNextMilestone(project({
    milestones: [{ id: "m1", title: "Keel laid", date: "1962-03-01", status: "done", note: "" }],
  })), null);
});

test("overdue fires only while the project is still running", () => {
  const late = project({ targetDate: "1963-01-01" });
  assert.equal(deriveProjectFlags(late, "1964-01-01").overdue, true);
  assert.equal(deriveProjectFlags(late, "1962-01-01").overdue, false);
  // A finished project is never overdue, however far past its target date.
  assert.equal(deriveProjectFlags(project({ targetDate: "1963-01-01", status: "complete" }), "1970-01-01").overdue, false);
  assert.equal(deriveProjectFlags(project({ targetDate: "1963-01-01", status: "cancelled" }), "1970-01-01").overdue, false);
});

test("dueSoon spans exactly the look-ahead window", () => {
  const withMilestone = (date) => project({ nextMilestone: { title: "Sea trials", date, note: "" } });
  assert.equal(deriveProjectFlags(withMilestone("1963-01-31"), "1963-01-01").dueSoon, true);
  assert.equal(deriveProjectFlags(withMilestone("1963-01-01"), "1963-01-01").dueSoon, true);
  // One day past the window.
  assert.equal(deriveProjectFlags(withMilestone("1963-02-01"), "1963-01-01").dueSoon, false);
  assert.equal(DUE_SOON_DAYS, 30);
});

test("a milestone that slipped is flagged separately from an overdue project", () => {
  const flags = deriveProjectFlags(project({
    targetDate: "1970-01-01",
    milestones: [{ id: "m1", title: "Sea trials", date: "1963-01-01", status: "pending", note: "" }],
  }), "1964-01-01");
  assert.equal(flags.milestoneMissed, true);
  assert.equal(flags.overdue, false, "the programme still has years to run");
});

test("stale covers both an explicit stall and simple neglect", () => {
  assert.equal(deriveProjectFlags(project({ status: "stalled" }), "1963-01-01").stale, true);
  assert.equal(deriveProjectFlags(project({ updatedRound: 4 }), "1963-01-01", 4 + STALE_ROUNDS).stale, true);
  assert.equal(deriveProjectFlags(project({ updatedRound: 4 }), "1963-01-01", 5).stale, false);
  // Round 0 means "we were not told the round" — never guess a project is stale.
  assert.equal(deriveProjectFlags(project({ updatedRound: 4 }), "1963-01-01", 0).stale, false);
});

test("undateable projects get no date-derived flags", () => {
  const flags = deriveProjectFlags(project({ targetDate: "", startedAt: "", milestones: [] }), "1963-01-01");
  assert.equal(flags.overdue, false);
  assert.equal(flags.dueSoon, false);
  assert.equal(flags.daysToTarget, null);
});

test("sortProjects keeps running work above finished work under every sort", () => {
  const list = [
    project({ id: "done", name: "Aardvark", status: "complete", progress: 100, updatedAt: "2026-09-09T00:00:00.000Z" }),
    project({ id: "live", name: "Zulu", status: "active", progress: 10, updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  for (const key of ["updated", "milestone", "progress", "name", "status"]) {
    assert.equal(sortProjects(list, key)[0].id, "live", `sort "${key}" floated a finished project`);
  }
});

test("sortProjects orders by each key", () => {
  const a = project({ id: "a", name: "Alpha", progress: 10, updatedAt: "2026-01-01T00:00:00.000Z", nextMilestone: { title: "x", date: "1970-01-01", note: "" } });
  const b = project({ id: "b", name: "Bravo", progress: 90, updatedAt: "2026-05-05T00:00:00.000Z", nextMilestone: { title: "y", date: "1963-01-01", note: "" } });
  assert.equal(sortProjects([a, b], "updated")[0].id, "b");
  assert.equal(sortProjects([a, b], "progress")[0].id, "b");
  assert.equal(sortProjects([a, b], "milestone")[0].id, "b");
  assert.equal(sortProjects([b, a], "name")[0].id, "a");
  assert.equal(sortProjects([a, b], "status")[0].id, "a", "equal status falls back to name");
});

test("sortProjects puts undated milestones last, not first", () => {
  const dated = project({ id: "dated", name: "Zulu", nextMilestone: { title: "x", date: "1963-01-01", note: "" } });
  const undated = project({ id: "undated", name: "Alpha", nextMilestone: null, milestones: [] });
  assert.equal(sortProjects([undated, dated], "milestone")[0].id, "dated");
});

test("sortProjects does not mutate its input", () => {
  const list = [project({ id: "a", name: "Zulu" }), project({ id: "b", name: "Alpha" })];
  sortProjects(list, "name");
  assert.equal(list[0].id, "a");
});

test("a blank ownerCode means the player", () => {
  assert.equal(isPlayerProject(project({ ownerCode: "" }), "France"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "France" }), "France"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "france" }), "France"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "Soviet Union" }), "France"), false);
});

test("filterProjects splits mine from foreign", () => {
  const list = [project({ id: "mine", ownerCode: "" }), project({ id: "theirs", ownerCode: "Soviet Union" })];
  assert.deepEqual(filterProjects(list, { owner: "mine", playerCountry: "France" }).map((p) => p.id), ["mine"]);
  assert.deepEqual(filterProjects(list, { owner: "foreign", playerCountry: "France" }).map((p) => p.id), ["theirs"]);
  assert.equal(filterProjects(list, { owner: "all", playerCountry: "France" }).length, 2);
});

test("filterProjects ORs tag chips rather than ANDing them", () => {
  const list = [
    project({ id: "mil", tags: ["military"] }),
    project({ id: "pol", tags: ["political"] }),
    project({ id: "none", tags: [] }),
  ];
  assert.deepEqual(
    filterProjects(list, { tags: ["military", "political"] }).map((p) => p.id),
    ["mil", "pol"],
  );
});

test("filterProjects searches the fields a player would type at", () => {
  const list = [project({
    id: "lev",
    name: "Project Leviathan",
    summary: "Autonomous ship programme.",
    tags: ["naval"],
    nextMilestone: { title: "Sea trials", date: "1963-11-04", note: "" },
  })];
  for (const query of ["leviathan", "AUTONOMOUS", "naval", "sea trials"]) {
    assert.equal(filterProjects(list, { query }).length, 1, `query "${query}" found nothing`);
  }
  assert.equal(filterProjects(list, { query: "submarine" }).length, 0);
});

test("filterProjects combines filters", () => {
  const list = [
    project({ id: "a", ownerCode: "", tags: ["military"], status: "active" }),
    project({ id: "b", ownerCode: "", tags: ["military"], status: "complete" }),
    project({ id: "c", ownerCode: "Soviet Union", tags: ["military"], status: "active" }),
  ];
  assert.deepEqual(
    filterProjects(list, { owner: "mine", playerCountry: "France", tags: ["military"], statuses: ["active"] })
      .map((p) => p.id),
    ["a"],
  );
});

test("collectProjectTags returns the live vocabulary, most used first", () => {
  const tags = collectProjectTags([
    project({ tags: ["military", "naval"] }),
    project({ tags: ["military", "political"] }),
    project({ tags: ["military"] }),
  ]);
  assert.deepEqual(tags, ["military", "naval", "political"]);
});

test("describeTimeline says how much time is left, or how much was lost", () => {
  assert.equal(describeTimeline(project({ targetDate: "1963-02-01" }), "1963-01-01"), "1962-03-01 → 1963-02-01 (31d left)");
  assert.equal(describeTimeline(project({ targetDate: "1962-12-01" }), "1963-01-01"), "1962-03-01 → 1962-12-01 (31d overdue)");
  assert.equal(describeTimeline(project({ targetDate: "" }), "1963-01-01"), "Began 1962-03-01");
  assert.equal(describeTimeline(project({ startedAt: "", targetDate: "" }), "1963-01-01"), "");
});

test("every helper tolerates junk without throwing", () => {
  // These run against whatever a save happens to contain; a malformed entry must
  // degrade, never crash the panel.
  assert.equal(deriveNextMilestone(null), null);
  assert.equal(deriveProjectFlags(null, "").overdue, false);
  assert.deepEqual(sortProjects(null), []);
  assert.deepEqual(filterProjects(null, {}), []);
  assert.deepEqual(collectProjectTags(null), []);
  assert.equal(describeTimeline(null, ""), "");
  assert.deepEqual(filterProjects([null, undefined], {}), []);
});

// ---- open vs closed, the Closed view's definition ---------------------------
// The panel's Closed toggle, its count, and the sort all have to agree on what
// "closed" means. They used to each carry their own inline list of statuses.

test("isProjectClosed is exactly the complement of isProjectOpen", () => {
  for (const status of ["proposed", "active", "stalled", "paused", "complete", "failed", "cancelled"]) {
    const entry = project({ status });
    assert.equal(isProjectClosed(entry), !isProjectOpen(entry), `disagreed on "${status}"`);
  }
});

test("closed means finished, failed or cancelled — nothing else", () => {
  assert.deepEqual(
    ["proposed", "active", "stalled", "paused", "complete", "failed", "cancelled"]
      .filter((status) => isProjectClosed(project({ status }))),
    ["complete", "failed", "cancelled"],
  );
});

test("an entry with no status at all counts as running", () => {
  // normalizeProjectEntry defaults to "active", but the panel must not blow up
  // on a hand-edited save either.
  assert.equal(isProjectClosed({ name: "X" }), false);
  assert.equal(isProjectClosed(null), false);
});

// ---- overdue, audited ------------------------------------------------------

test("overdue fires the day AFTER the target, not on it", () => {
  const p = project({ targetDate: "2035-06-01" });
  assert.equal(deriveProjectFlags(p, "2035-05-31").overdue, false);
  assert.equal(deriveProjectFlags(p, "2035-06-01").overdue, false, "still has the day it is due");
  assert.equal(deriveProjectFlags(p, "2035-06-02").overdue, true);
});

test("overdue never fires for a closed project", () => {
  for (const status of ["complete", "failed", "cancelled"]) {
    assert.equal(deriveProjectFlags(project({ targetDate: "2020-01-01", status }), "2040-01-01").overdue, false, status);
  }
});

test("overdue does fire for every running status, paused included", () => {
  for (const status of ["proposed", "active", "stalled", "paused"]) {
    assert.equal(deriveProjectFlags(project({ targetDate: "2020-01-01", status }), "2040-01-01").overdue, true, status);
  }
});

test("an ongoing effort is never overdue, however old", () => {
  const p = project({ targetDate: "", ongoing: true, startedAt: "1900-01-01" });
  const flags = deriveProjectFlags(p, "2040-01-01");
  assert.equal(flags.overdue, false);
  assert.equal(flags.ongoing, true);
});

test("ongoing does not suppress a missed milestone", () => {
  const flags = deriveProjectFlags(project({
    ongoing: true, targetDate: "",
    milestones: [{ id: "m", title: "Quarterly review", date: "2030-01-01", status: "pending", note: "" }],
  }), "2040-01-01");
  assert.equal(flags.overdue, false, "no end date to be late against");
  assert.equal(flags.milestoneMissed, true, "but a slipped checkpoint still matters");
});

test("describeTimeline says ongoing rather than showing a bare start date", () => {
  assert.equal(describeTimeline(project({ ongoing: true, targetDate: "" }), "2033-01-01"), "Began 1962-03-01 · ongoing");
  assert.equal(describeTimeline(project({ ongoing: true, targetDate: "", startedAt: "" }), "2033-01-01"), "Ongoing");
});

// ---- recurring milestones --------------------------------------------------

test("advanceRecurringDate steps each cadence", () => {
  assert.equal(advanceRecurringDate("2033-06-01", "annual", "2033-06-01"), "2034-06-01");
  assert.equal(advanceRecurringDate("2033-06-01", "biennial", "2033-06-01"), "2035-06-01");
  assert.equal(advanceRecurringDate("2033-01-15", "quarterly", "2033-01-15"), "2033-04-15");
  assert.equal(advanceRecurringDate("2033-01-15", "monthly", "2033-01-15"), "2033-02-15");
  assert.equal(advanceRecurringDate("2033-01-01", "weekly", "2033-01-01"), "2033-01-08");
});

test("a month-end date clamps rather than overflowing, and recovers after", () => {
  // A drill on the 31st must not skip February or slide to March 3rd.
  assert.equal(advanceRecurringDate("2033-01-31", "monthly", "2033-01-31"), "2033-02-28");
  assert.equal(advanceRecurringDate("2033-01-31", "monthly", "2033-02-28"), "2033-03-31");
  assert.equal(advanceRecurringDate("2032-01-31", "monthly", "2032-01-31"), "2032-02-29", "leap year");
});

test("a commitment missed for years catches up past the clock", () => {
  assert.equal(advanceRecurringDate("2020-06-01", "annual", "2033-01-01"), "2033-06-01");
  // And keeps its day of the year rather than drifting to when it was noticed.
  assert.ok(advanceRecurringDate("2020-06-01", "annual", "2033-09-20").endsWith("-06-01"));
});

test("advanceRecurringDate refuses what it cannot compute", () => {
  assert.equal(advanceRecurringDate("2033-06-01", ""), "", "not recurring");
  assert.equal(advanceRecurringDate("1200 BCE", "annual"), "", "non-Gregorian");
  assert.equal(advanceRecurringDate("", "annual"), "");
  assert.equal(advanceRecurringDate("2033-13-45", "annual"), "", "impossible date");
});

test("normalizeMilestoneRepeat accepts the synonyms a model reaches for", () => {
  for (const [input, expected] of [
    ["annual", "annual"], ["yearly", "annual"], ["Annually", "annual"], ["every year", "annual"],
    ["quarter", "quarterly"], ["month", "monthly"], ["week", "weekly"], ["biannual", "biennial"],
  ]) {
    assert.equal(normalizeMilestoneRepeat(input), expected, `"${input}"`);
  }
  assert.equal(normalizeMilestoneRepeat("fortnightly"), "", "an unsupported cadence is not guessed at");
  assert.equal(normalizeMilestoneRepeat(""), "");
});

test("deriveNextMilestone carries the recurrence through to the card", () => {
  const next = deriveNextMilestone(project({
    nextMilestone: null,
    milestones: [{ id: "m", title: "Annual drill", date: "2034-06-01", status: "pending", note: "", repeat: "annual", completedCount: 2 }],
  }));
  assert.equal(next.repeat, "annual");
  assert.equal(next.completedCount, 2);
});
