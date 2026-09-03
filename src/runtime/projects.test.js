/*! Open Historia — portions (projects board derived-state tests) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Runs in a BARE CHECKOUT (no node_modules): projects.js is import-free on
// purpose, the same as unitMotion.js and eventFocus.js. Keep it that way —
// `node --test src/runtime/projects.test.js` is the whole point.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DUE_SOON_DAYS,
  PROJECT_SORTS,
  STALE_ROUNDS,
  advanceRecurringDate,
  normalizeMilestoneRepeat,
  collectProjectTags,
  deriveNextMilestone,
  deriveProjectFlags,
  describeTimeline,
  filterProjects,
  canPlayerDirect,
  isProjectClosed,
  isProjectOpen,
  isForeignProject,
  isPlayerProject,
  signedDaysBetween,
  sortProjects,
  describeDoubtedForPrompt,
  doubtedAwaitingFreshSource,
  spyIntelDoubtOps,
  spyOperationOps,
  spyProvenanceOps,
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
  priority: "normal",
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

// --- priority sort ----------------------------------------------------------
//
// The player's own dial: how much attention they want a project to get. It is
// the one field on this board they author, and the jump and advisor prompts act
// on it, so the sort has to make it visible.

const byPriority = (list) => sortProjects(list, "priority").map((entry) => entry.id);

test("sortProjects: priority orders high, then normal, then low", () => {
  const list = [
    project({ id: "low", name: "C", priority: "low" }),
    project({ id: "high", name: "A", priority: "high" }),
    project({ id: "normal", name: "B", priority: "normal" }),
  ];
  assert.deepEqual(byPriority(list), ["high", "normal", "low"]);
});

// Open work outranks closed work under EVERY sort — a board whose first screen is
// finished projects is not telling you anything, and a high-priority thing that
// has already been cancelled is not the most urgent item on it.
test("sortProjects: an abandoned high-priority project still sorts below live work", () => {
  const list = [
    project({ id: "dead", name: "A", priority: "high", status: "cancelled" }),
    project({ id: "live", name: "B", priority: "low", status: "active" }),
  ];
  assert.deepEqual(byPriority(list), ["live", "dead"]);
});

// A save written before the field existed has no priority at all. It must read as
// normal — sorting those to either end would reshuffle a board the player has
// never touched.
test("sortProjects: a project with no priority sorts as normal", () => {
  const noField = project({ id: "legacy", name: "B" });
  delete noField.priority;
  const list = [
    project({ id: "low", name: "C", priority: "low" }),
    noField,
    project({ id: "high", name: "A", priority: "high" }),
  ];
  assert.deepEqual(byPriority(list), ["high", "legacy", "low"]);
});

// The panel renders its sort menu by mapping PROJECT_SORTS, so a comparator with
// no entry here is a dead sort nobody can reach.
test("PROJECT_SORTS offers every comparator, priority included", () => {
  assert.ok(PROJECT_SORTS.some((entry) => entry.key === "priority"));
  for (const entry of PROJECT_SORTS) {
    assert.ok(entry.label, "every sort needs a label for the menu");
  }
});

// --- whose project it is ----------------------------------------------------

// A plain toLowerCase() compare was not enough. The model spells a country back
// the way it remembers it, so the player's own programme arrives owned by
// "Cote dIvoire" while game.country is "Côte d'Ivoire" — the entry files itself
// under Foreign and the player loses both levers over their own work.
test("owner identity ignores case, accents and punctuation", () => {
  const own = project({ ownerCode: "Cote dIvoire" });
  assert.equal(isPlayerProject(own, "Côte d'Ivoire"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "  SPAIN  " }), "Spain"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "Ruritania" }), "Spain"), false);
});

// A blank owner has always meant the player: the model is not made to restate
// their own country on every entry, since a field it has to repeat is a field it
// eventually gets wrong.
test("an unowned entry is the player's own", () => {
  assert.equal(isPlayerProject(project({ ownerCode: "" }), "Spain"), true);
  assert.equal(isForeignProject(project({ ownerCode: "" }), "Spain"), false);
  assert.equal(isForeignProject(project({ ownerCode: "Ruritania" }), "Spain"), true);
});

// The gate on the panel's two controls, and on the ops door behind them.
test("canPlayerDirect: their own running work, and nothing else", () => {
  assert.equal(canPlayerDirect(project({ ownerCode: "", status: "active" }), "Spain"), true);
  assert.equal(canPlayerDirect(project({ ownerCode: "Spain", status: "stalled" }), "Spain"), true);
  assert.equal(
    canPlayerDirect(project({ ownerCode: "Ruritania", status: "active" }), "Spain"),
    false,
    "a rival's running programme is not the player's to steer",
  );
  assert.equal(
    canPlayerDirect(project({ ownerCode: "", status: "complete" }), "Spain"),
    false,
    "neither lever means anything on work that has already ended",
  );
});

test("the Mine and Foreign filters partition the board exactly", () => {
  const board = [
    project({ id: "a", name: "Ours, unowned", ownerCode: "" }),
    project({ id: "b", name: "Ours, named", ownerCode: "Spain" }),
    project({ id: "c", name: "Theirs", ownerCode: "Ruritania" }),
  ];
  const mine = filterProjects(board, { owner: "mine", playerCountry: "Spain" });
  const foreign = filterProjects(board, { owner: "foreign", playerCountry: "Spain" });

  assert.deepEqual(mine.map((entry) => entry.id), ["a", "b"]);
  assert.deepEqual(foreign.map((entry) => entry.id), ["c"]);
  assert.equal(mine.length + foreign.length, board.length, "every entry belongs to exactly one column");
});

// ---- covert operations that track a real agent -----------------------------

const spy = (over = {}) => ({ id: "spy-france-prussia-1", owner: "France", target: "Prussia", status: "active", deployedAt: "1740-05-01", ...over });
const linked = (over = {}) => ({ id: "p1", name: "Agent in Prussia", status: "active", linkedSpyIds: ["spy-france-prussia-1"], ...over });

test("deploying an agent opens a covert operation on the board", () => {
  const [op] = spyOperationOps([spy()], [], { date: "1740-06-01", playerPolity: "France" });
  assert.equal(op.op, "create");
  assert.equal(op.name, "Agent in Prussia");
  assert.equal(op.kind, "operation");
  assert.equal(op.secrecy, "covert");
  assert.equal(op.ownerCode, "", "blank means the player's own");
  assert.equal(op.ongoing, true, "an agent runs until pulled or caught, so it can never be overdue");
  assert.equal(op.startedAt, "1740-05-01", "the deployment date, not today");
  assert.deepEqual(op.linkedSpyIds, ["spy-france-prussia-1"]);
});

test("an agent already on the board does not open a second entry", () => {
  assert.deepEqual(spyOperationOps([spy()], [linked()], { playerPolity: "France" }), []);
});

test("a caught agent fails its operation; a withdrawn one cancels it", () => {
  const [failed] = spyOperationOps([spy({ status: "exposed" })], [linked()], { playerPolity: "France" });
  assert.equal(failed.op, "fail");
  assert.equal(failed.id, "p1");
  assert.match(failed.note, /caught/);

  const [cancelled] = spyOperationOps([spy({ status: "recalled" })], [linked()], { playerPolity: "France" });
  assert.equal(cancelled.op, "cancel");
  assert.match(cancelled.note, /withdrawn/);
});

test("a turned agent changes nothing — ending the entry would leak the secret", () => {
  // The player is never told their agent has been turned. A board entry that
  // closed itself would say so louder than any message.
  assert.deepEqual(spyOperationOps([spy({ status: "turned" })], [linked()], { playerPolity: "France" }), []);
});

test("a suspected agent is left alone, so the board and the model cannot flip-flop", () => {
  assert.deepEqual(spyOperationOps([spy({ suspected: true })], [linked()], { playerPolity: "France" }), []);
});

test("an operation already closed is not closed twice", () => {
  const closed = linked({ status: "failed" });
  assert.deepEqual(spyOperationOps([spy({ status: "exposed" })], [closed], { playerPolity: "France" }), []);
});

test("another polity's agent inside the player is not the player's operation", () => {
  const foreign = spy({ id: "spy-prussia-france-1", owner: "Prussia", target: "France" });
  assert.deepEqual(spyOperationOps([foreign], [], { playerPolity: "France" }), []);
});

test("a pre-ownership record with no owner is treated as the player's", () => {
  const [op] = spyOperationOps([spy({ owner: "" })], [], { playerPolity: "France" });
  assert.equal(op?.op, "create");
});

test("owner matching ignores case, like the rest of the polity namespace", () => {
  const [op] = spyOperationOps([spy({ owner: "FRANCE" })], [], { playerPolity: "france" });
  assert.equal(op?.op, "create");
});

test("a spy with no id is skipped rather than opening a linkless entry", () => {
  assert.deepEqual(spyOperationOps([spy({ id: "" })], [], { playerPolity: "France" }), []);
});

test("recalling and redeploying opens a fresh operation, because the id changes", () => {
  // recallSpy keeps the record and a redeploy mints a new id (spycraft.js), so
  // the closed entry stays as history and the new agent gets its own.
  const ops = spyOperationOps(
    [spy({ status: "recalled" }), spy({ id: "spy-france-prussia-2" })],
    [linked()],
    { playerPolity: "France" },
  );
  assert.equal(ops.length, 2);
  assert.deepEqual(ops.map((o) => o.op).sort(), ["cancel", "create"]);
});

test("no spies and no board is no work", () => {
  assert.deepEqual(spyOperationOps([], [], {}), []);
  assert.deepEqual(spyOperationOps(null, null, {}), []);
});

// ---- doubting what a compromised agent told us -----------------------------

const foreignEntry = (over = {}) => ({
  id: "f1", name: "Prussian Rocket Programme", ownerCode: "Prussia", status: "active", verification: "", linkedSpyIds: [], ...over,
});

test("a foreign entry gets tied to the agent that must have produced it", () => {
  const [op] = spyProvenanceOps([spy()], [foreignEntry()], { playerPolity: "France" });
  assert.equal(op.op, "update");
  assert.equal(op.id, "f1");
  assert.deepEqual(op.linkedSpyIds, ["spy-france-prussia-1"]);
});

test("the player's own work is never attributed to a spy", () => {
  // A blank ownerCode is the player's; no agent told them about their own programme.
  assert.deepEqual(spyProvenanceOps([spy()], [foreignEntry({ ownerCode: "" })], { playerPolity: "France" }), []);
});

test("provenance is not restamped, and not applied where there is no agent", () => {
  assert.deepEqual(spyProvenanceOps([spy()], [foreignEntry({ linkedSpyIds: ["other"] })], { playerPolity: "France" }), []);
  assert.deepEqual(spyProvenanceOps([spy()], [foreignEntry({ ownerCode: "Austria" })], { playerPolity: "France" }), []);
  assert.deepEqual(spyProvenanceOps([spy({ status: "exposed" })], [foreignEntry()], { playerPolity: "France" }), []);
});

test("a suspected agent casts doubt on what it sourced, without saying why", () => {
  const linkedForeign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  const [op] = spyIntelDoubtOps([spy({ suspected: true })], [linkedForeign], { playerPolity: "France", date: "1741-06-01" });
  assert.equal(op.verification, "doubted");
  assert.equal(op.status, "stalled");
  assert.match(op.lastUpdate, /no longer trust how we came by this/);
  // The player is never told the agent was turned; neither is the board.
  assert.ok(!/turned|double agent|planted/i.test(op.lastUpdate));
});

test("doubt is cast once, so the model's verdict is never overwritten", () => {
  const settled = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"], verification: "confirmed" });
  assert.deepEqual(spyIntelDoubtOps([spy({ suspected: true })], [settled], { playerPolity: "France" }), []);
});

test("an agent that is merely live casts no doubt", () => {
  const linkedForeign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  assert.deepEqual(spyIntelDoubtOps([spy()], [linkedForeign], { playerPolity: "France" }), []);
});

// What the agent in Prussia has most recently filed. gatherIntelligence replaces
// the target's entry on every gather, so its planted flag describes the CURRENT channel.
const filed = (planted) => ({ Prussia: { gatheredAt: "1741-07-02", round: 12, planted, exchanges: [] } });

test("a doubted entry waits for a FRESH agent, not the one that caused the doubt", () => {
  const doubted = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"], verification: "doubted" });

  // The compromised agent is still the only one in place: nothing to settle with.
  assert.deepEqual(
    doubtedAwaitingFreshSource([spy({ suspected: true })], [doubted], { playerPolity: "France", intercepts: filed(true) }),
    [],
  );

  // A new, clean agent in the same polity, who has since filed, is what makes it
  // answerable.
  const pending = doubtedAwaitingFreshSource(
    [spy({ status: "recalled" }), spy({ id: "spy-france-prussia-2" })],
    [doubted],
    { playerPolity: "France", intercepts: filed(false) },
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].spy.id, "spy-france-prussia-2");
  assert.match(describeDoubtedForPrompt(pending), /Prussian Rocket Programme.*fresh agent inside Prussia/);
});

test("a replacement who has not reported yet cannot settle anything", () => {
  // The window between deploying someone and their first report: the only material
  // in hand is still the fabrication, so settling from it would use the very
  // evidence the doubt is about. The board is not asked at all until this clears.
  const doubted = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"], verification: "doubted" });
  const spies = [spy({ status: "recalled" }), spy({ id: "spy-france-prussia-2" })];

  assert.deepEqual(
    doubtedAwaitingFreshSource(spies, [doubted], { playerPolity: "France", intercepts: filed(true) }),
    [],
    "the newest report is still the turned agent's",
  );
  assert.deepEqual(
    doubtedAwaitingFreshSource(spies, [doubted], { playerPolity: "France", intercepts: {} }),
    [],
    "nothing filed at all is not a second opinion either",
  );
  assert.equal(
    doubtedAwaitingFreshSource(spies, [doubted], { playerPolity: "France", intercepts: filed(false) }).length,
    1,
    "once they file, the question can be asked",
  );
});

test("intercepts are matched to an entry's owner case-insensitively", () => {
  // Agents file under the target as they were given it ("china"); the board files
  // under the polity name ("China"). Everything else in this namespace compares
  // case-insensitively for exactly this reason.
  const doubted = foreignEntry({ ownerCode: "Prussia", linkedSpyIds: ["spy-france-prussia-1"], verification: "doubted" });
  const pending = doubtedAwaitingFreshSource(
    [spy({ id: "spy-france-prussia-2", target: "prussia" })],
    [doubted],
    { playerPolity: "France", intercepts: { prussia: { gatheredAt: "1741-07-02", round: 12, planted: false, exchanges: [] } } },
  );
  assert.equal(pending.length, 1);
});

test("a replacement agent who is themselves suspected cannot settle anything", () => {
  const doubted = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"], verification: "doubted" });
  const pending = doubtedAwaitingFreshSource(
    [spy({ id: "spy-france-prussia-2", suspected: true })],
    [doubted],
    { playerPolity: "France", intercepts: filed(false) },
  );
  assert.deepEqual(pending, [], "a suspect source is not a second opinion");
});

test("an entry nobody doubts is never offered for settling", () => {
  const pending = doubtedAwaitingFreshSource([spy()], [foreignEntry()], { playerPolity: "France", intercepts: filed(false) });
  assert.deepEqual(pending, []);
  assert.equal(describeDoubtedForPrompt(pending), "");
});

test("the operation the agent IS is never doubted, only what it reported", () => {
  // spyOperationOps links the covert operation to the same spy, so without a
  // guard the card representing the agent would be marked Doubtful alongside the
  // intelligence it sent. The operation is not in question: the agent really is
  // there. Only what they have been sending back can be a fabrication.
  const ownOperation = { id: "op1", name: "Agent in Prussia", ownerCode: "", status: "active", verification: "", linkedSpyIds: ["spy-france-prussia-1"] };
  const foreign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  const ops = spyIntelDoubtOps([spy({ suspected: true })], [ownOperation, foreign], { playerPolity: "France" });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].id, "f1", "only the foreign entry is doubted");
});
