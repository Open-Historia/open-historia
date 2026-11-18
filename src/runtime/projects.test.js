/*! Open Historia — portions (projects board derived-state tests) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Runs in a BARE CHECKOUT (no node_modules): projects.js is import-free on
// purpose, the same as unitMotion.js and eventFocus.js. Keep it that way —
// `node --test src/runtime/projects.test.js` is the whole point.
import test from "node:test";
import assert from "node:assert/strict";

import {
  PROJECT_SORTS,
  agentKnowledgeChanges,
  knowledgeOf,
  boardEntriesConcernedByEvent,
  boardPassCarriers,
  materiallyChangedEntryIds,
  collectProjectTags,
  deriveProjectFlags,
  filterProjects,
  canPlayerDirect,
  isKnownToPlayer,
  isProjectClosed,
  isProjectOpen,
  isForeignProject,
  isPlayerProject,
  nextMilestoneOf,
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
  const a = project({ id: "a", name: "Alpha", progress: 10, updatedAt: "2026-01-01T00:00:00.000Z", targetDate: "1970-01-01", plan: { monthlyCost: 5 } });
  const b = project({ id: "b", name: "Bravo", progress: 90, updatedAt: "2026-05-05T00:00:00.000Z", targetDate: "1963-01-01", plan: { monthlyCost: 50 } });
  assert.equal(sortProjects([a, b], "updated")[0].id, "b");
  assert.equal(sortProjects([a, b], "progress")[0].id, "b");
  assert.equal(sortProjects([a, b], "finish")[0].id, "b");
  assert.equal(sortProjects([a, b], "cost")[0].id, "b");
  assert.equal(sortProjects([b, a], "name")[0].id, "a");
  assert.equal(sortProjects([a, b], "status")[0].id, "a", "equal status falls back to name");
  assert.deepEqual(PROJECT_SORTS.map((sort) => sort.key), ["updated", "finish", "progress", "cost", "name", "status"]);
});

test("sortProjects puts a project with no expected finish last, not first", () => {
  const dated = project({ id: "dated", name: "Zulu", targetDate: "1963-01-01" });
  const undated = project({ id: "undated", name: "Alpha", targetDate: "" });
  assert.equal(sortProjects([undated, dated], "finish")[0].id, "dated");
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
    plan: { milestones: [{ id: "m1", title: "Sea trials", atProgress: 70 }] },
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
    ["planning", "active", "stalled", "paused", "complete", "failed", "cancelled"]
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

// ---- recurring milestones --------------------------------------------------

// --- priority sort ----------------------------------------------------------
//
// The player's own dial: how much attention they want a project to get. It is
// the one field on this board they author, and the jump and advisor prompts act
// on it, so the sort has to make it visible.

const byPriority = (list) => sortProjects(list, "priority").map((entry) => entry.id);

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

// Under the old a-z fold every name in another script folded to nothing, and a
// name that folded to nothing counted as blank: a programme owned by "中国"
// landed on the player's own Board, with the player's levers on it. Blank is
// the text itself, and a name in any script is that name.
test("an owner named in another script is that owner, never the player", () => {
  assert.equal(isPlayerProject(project({ ownerCode: "中国" }), "France"), false);
  assert.equal(isForeignProject(project({ ownerCode: "Россия" }), "France"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "РОССИЯ" }), "Россия"), true, "the player's own, in another case");
  assert.equal(isPlayerProject(project({ ownerCode: "中国" }), "中国"), true);
  assert.equal(isPlayerProject(project({ ownerCode: "!!!" }), "France"), false, "a name with no letters is nobody's, not the player's");
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

test("a suspected agent casts doubt on what it sourced, without saying why, and the programme runs on", () => {
  const linkedForeign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  const [op] = spyIntelDoubtOps([spy({ suspected: true })], [linkedForeign], { playerPolity: "France", date: "1741-06-01" });
  // The doubt is the player's service's (the panel's Doubtful badge), and all
  // that is written: Prussia's own programme is Prussia's, which the engine runs.
  assert.deepEqual(op, { op: "update", id: "f1", name: "Prussian Rocket Programme", verification: "doubted" });
});

test("doubt is cast once, so the model's verdict is never overwritten", () => {
  const settled = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"], verification: "confirmed" });
  assert.deepEqual(spyIntelDoubtOps([spy({ suspected: true })], [settled], { playerPolity: "France" }), []);
});

test("an agent that is merely live casts no doubt", () => {
  const linkedForeign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  assert.deepEqual(spyIntelDoubtOps([spy()], [linkedForeign], { playerPolity: "France" }), []);
});

test("a turned agent nobody suspects yet casts no doubt, so the board does not give it away", () => {
  const linkedForeign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  const turned = spy({ status: "turned", turnedAt: "1741-05-01" });
  assert.deepEqual(spyIntelDoubtOps([turned], [linkedForeign], { playerPolity: "France" }), []);
  // Once the analysts suspect it, the doubt follows.
  assert.equal(spyIntelDoubtOps([{ ...turned, suspected: true }], [linkedForeign], { playerPolity: "France" })[0]?.verification, "doubted");
});

test("an agent exposed after having been turned casts doubt; one exposed while loyal does not", () => {
  const linkedForeign = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  const burned = spy({ status: "exposed", turnedAt: "1741-05-01", exposedAt: "1741-06-01" });
  assert.equal(spyIntelDoubtOps([burned], [linkedForeign], { playerPolity: "France" })[0]?.verification, "doubted");
  const loyal = spy({ status: "exposed", exposedAt: "1741-06-01" });
  assert.deepEqual(spyIntelDoubtOps([loyal], [linkedForeign], { playerPolity: "France" }), []);
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

test("a recalled agent closes its own operation, never the intelligence it reported", () => {
  // linkedSpyIds is written by two mechanisms with different meanings: here the
  // entry IS the agent, in spyProvenanceOps it is what the agent reported. Sharing
  // the field without checking ownerCode had a recalled agent cancelling a rival's
  // programme and stamping "Our agent in X was withdrawn" on it — the wrong entry,
  // and a sentence that says out loud what the board must never say.
  const ownOperation = { id: "op1", name: "Agent in Prussia", ownerCode: "", status: "active", linkedSpyIds: ["spy-france-prussia-1"] };
  const reported = foreignEntry({ linkedSpyIds: ["spy-france-prussia-1"] });
  const ops = spyOperationOps([spy({ status: "recalled" })], [ownOperation, reported], { playerPolity: "France" });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].id, "op1");
  assert.equal(ops[0].op, "cancel");
});

// --- Which Board entries an event concerns ---------------------------------
//
// The open entries the event's own board ops address, by id or by the name the
// Board gives them: what the event says it did to the Board, never what its
// words resemble. Read by the world director's consequence check and by the
// board pass's reasons.

const concerned = (event, board) =>
  boardEntriesConcernedByEvent(event, board).map((entry) => entry.id);
const moving = (title, ...ops) => ({ title, description: "", impacts: { projectOps: ops } });

test("an event concerns the Board entries its own board ops address, by id or by the Board's name", () => {
  const board = [
    project({ id: "westbird", name: "Project Westbird", summary: "Agent recruitment drive." }),
    project({ id: "kingfisher", name: "Operation Kingfisher", summary: "Covert missile trials." }),
  ];
  assert.deepEqual(concerned(moving("Recruiters busy", { op: "update", projectId: "westbird", progress: 40 }), board), ["westbird"]);
  assert.deepEqual(concerned(moving("A test succeeds", { op: "milestone", name: "operation kingfisher", milestone: { title: "First flight", status: "done" } }), board), ["kingfisher"], "the Board's own name, case aside");
  assert.deepEqual(concerned(moving("Both move", { op: "update", projectId: "kingfisher" }, { op: "update", projectId: "westbird" }), board), ["westbird", "kingfisher"], "in the Board's order");
});

test("an event's words never make it concern an entry, in any language", () => {
  const board = [project({ id: "westbird", name: "Project Westbird", summary: "Agent recruitment drive." })];
  // Named outright in its words, the entry is still not what the event did.
  assert.deepEqual(concerned({ title: "Project Westbird recruits its first cell", description: "" }, board), []);
  assert.deepEqual(concerned({ title: "Le projet Westbird recrute sa première cellule", description: "" }, board), []);
  // And the French telling of the same op concerns it exactly as the English one.
  const op = { op: "update", projectId: "westbird", progress: 45 };
  assert.deepEqual(concerned(moving("Project Westbird recruits its first cell", op), board), ["westbird"]);
  assert.deepEqual(concerned(moving("Le projet Westbird recrute sa première cellule", op), board), ["westbird"]);
});

test("a Board kept in another script is addressed by its ids and names, whatever the event says", () => {
  // Two entries from a player's log (2026-10-05, the game in Russian), and one in Chinese.
  const board = [
    project({ id: "leviathan", name: "Проект Левиафан", summary: "Ключевая военно-морская программа." }),
    project({ id: "fortress", name: "Проект Береговая Крепость", summary: "Строительство оборонительных рубежей." }),
    project({ id: "dragon", name: "蛟龙计划", summary: "深海载人潜水器研制。" }),
  ];
  assert.deepEqual(concerned(moving("Установлен энергетический блок", { op: "update", projectId: "leviathan" }), board), ["leviathan"]);
  assert.deepEqual(concerned(moving("Работы ускорены", { op: "update", name: "проект береговая крепость" }), board), ["fortress"]);
  assert.deepEqual(concerned(moving("蛟龙计划完成首次下潜", { op: "milestone", name: "蛟龙计划", milestone: { title: "首次下潜", status: "done" } }), board), ["dragon"]);
  assert.deepEqual(concerned({ title: "“蛟龙计划”完成首次下潜", description: "" }, board), [], "its name in the words alone is nothing");
});

test("closed Board entries never match, an op naming nothing on the Board matches nothing, and an empty Board matches nothing", () => {
  const event = moving("Project Westbird is wound up", { op: "cancel", projectId: "w" });
  for (const status of ["complete", "failed", "cancelled"]) {
    assert.deepEqual(concerned(event, [project({ id: "w", name: "Project Westbird", status })]), [], status);
  }
  assert.deepEqual(concerned(moving("x", { op: "update", projectId: "elsewhere", name: "Project Elsewhere" }), [project({ id: "w", name: "Project Westbird" })]), []);
  assert.deepEqual(concerned(moving("x", { op: "create", name: "Project Nova", summary: "A new programme." }), [project({ id: "w", name: "Project Westbird" })]), [], "a new entry is not one on the Board");
  assert.deepEqual(concerned(event, []), []);
  assert.deepEqual(concerned(event, undefined), []);
  assert.deepEqual(concerned({ title: "No ops" }, [project({ id: "w" })]), []);
});

test("foreign Board entries are addressed like the player's own", () => {
  const board = [project({ id: "rival", name: "Project Leviathan", ownerCode: "Germany" })];
  assert.deepEqual(concerned(moving("Hull launched at Kiel", { op: "update", projectId: "rival", progress: 70 }), board), ["rival"]);
});

// --- Where the board pass's ops go ------------------------------------------
//
// The board pass reads the visible events, then the Hidden events, as one
// numbered list. Its ops are applied one event at a time, in date order, so a
// Hidden event that opens an entry comes before the visible one that moves it.

const at = (date, title) => ({ date, title, description: "" });

test("each event's ops travel together, and a Hidden event's are marked off the timeline", () => {
  const carriers = boardPassCarriers({
    ops: [
      { op: "update", name: "Project Westbird", progress: 45, eventIndex: 0 },
      { op: "update", name: "Project Westbird", lastUpdate: "Recruiters busy.", eventIndex: 0 },
      { op: "update", name: "Project Westbird", progress: 50, eventIndex: 2 },
    ],
    visibleEvents: [at("1963-01-05", "a"), at("1963-01-20", "b")],
    hiddenEvents: [at("1963-01-25", "c")],
  });
  assert.deepEqual(
    carriers.map((carrier) => [carrier.onTimeline, carrier.eventIndex, carrier.hiddenIndex, carrier.ops.length]),
    [[true, 0, null, 2], [false, null, 0, 1]],
  );
  assert.equal(carriers[0].ops[0].eventIndex, undefined, "the address is not content once the op sits on its event");
});

test("ops are applied in date order across visible and Hidden events", () => {
  const carriers = boardPassCarriers({
    ops: [
      { op: "update", name: "Project Kestrel", progress: 30, eventIndex: 0 },
      { op: "create", name: "Project Kestrel", summary: "A second network.", eventIndex: 1 },
    ],
    visibleEvents: [at("1963-02-10", "Kestrel expands")],
    hiddenEvents: [at("1963-02-01", "Kestrel is set up")],
  });
  assert.deepEqual(carriers.map((carrier) => carrier.ops[0].op), ["create", "update"]);
});

test("an op with no usable event number rides on the last visible event, and is marked as a fallback", () => {
  const carriers = boardPassCarriers({
    ops: [
      { op: "update", name: "Project Westbird", progress: 45, eventIndex: 1 },
      { op: "update", name: "Project Westbird", progress: 46 },
      { op: "update", name: "Project Westbird", progress: 47, eventIndex: 9 },
    ],
    visibleEvents: [at("1963-01-05", "a"), at("1963-01-20", "b")],
    hiddenEvents: [],
  });
  assert.deepEqual(
    carriers.map((carrier) => [carrier.eventIndex, carrier.fallback, carrier.ops.length]),
    [[1, false, 1], [1, true, 2]],
    "kept apart from the event's own ops, so it can never be what backs that event",
  );
});

// Seen in a live game (2026-09-19): three entries' routine reports named no
// event, rode on the turn's last one — an agent caught in Argentina — and that
// event sat in the Activity of an air-defence, a satellite and a drone Project.
test("only an event's own ops stamp it into an entry's activity, never a fallback", () => {
  const carriers = boardPassCarriers({
    ops: [
      { op: "update", name: "Project Westbird", progress: 45, eventIndex: 1 },
      { op: "update", name: "Project Kestrel", lastUpdate: "Quiet month." },
      { op: "update", name: "Project Westbird", progress: 50, eventIndex: 2 },
    ],
    visibleEvents: [at("1963-01-05", "a"), at("1963-01-20", "Spy ring rolled up")],
    hiddenEvents: [at("1963-01-10", "c")],
  });
  assert.deepEqual(
    carriers.map((carrier) => [carrier.onTimeline, carrier.fallback, carrier.stampsActivity]),
    [[false, false, false], [true, false, true], [true, true, false]],
  );
});

// ---- what the engine's board says of an entry ---------------------------------

test("the next checkpoint is the first one neither reached nor missed", () => {
  const entry = project({ plan: { milestones: [
    { id: "m1", title: "Keel laid", atProgress: 20, reached: true, reachedAt: "1963-01-01" },
    { id: "m2", title: "Launch", atProgress: 50, missed: false },
    { id: "m3", title: "Sea trials", atProgress: 80 },
  ] } });
  assert.deepEqual(nextMilestoneOf(entry), { title: "Launch", atProgress: 50 });
  assert.equal(nextMilestoneOf(project({ plan: { milestones: [{ title: "Done", atProgress: 10, reached: true }] } })), null);
  assert.equal(nextMilestoneOf(project({ plan: null })), null);
});

test("the card's flags are the engine's: stalled and why, underfunded, planning, running", () => {
  const stalled = deriveProjectFlags(project({ status: "stalled", stallReason: "funds" }));
  assert.equal(stalled.stalled, true);
  assert.equal(stalled.stallReason, "funds");
  assert.equal(deriveProjectFlags(project({ paidShare: 0.5 })).underfunded, true);
  assert.equal(deriveProjectFlags(project({ paidShare: 1 })).underfunded, false);
  assert.equal(deriveProjectFlags(project({ status: "planning" })).planning, true);
  assert.equal(deriveProjectFlags(project({ established: true, ongoing: true })).running, true);
  assert.equal(deriveProjectFlags(project({ status: "complete", paidShare: 0 })).underfunded, false, "a closed entry is never underfunded");
});

test("every helper tolerates junk without throwing", () => {
  for (const junk of [null, undefined, {}, 5, "x"]) {
    assert.doesNotThrow(() => deriveProjectFlags(junk));
    assert.doesNotThrow(() => nextMilestoneOf(junk));
    assert.doesNotThrow(() => isKnownToPlayer(junk, "France"));
  }
  assert.deepEqual(sortProjects(null), []);
  assert.deepEqual(filterProjects(undefined), []);
});

test("the player knows a project abroad that is public, that an agent told of, that was on the board before, or that their services have a view on", () => {
  const abroad = (overrides) => project({ ownerCode: "Germany", secrecy: "covert", ...overrides });
  assert.equal(isKnownToPlayer(project({ ownerCode: "" }), "France"), true, "their own, always");
  assert.equal(isKnownToPlayer(abroad({ secrecy: "public" }), "France"), true);
  assert.equal(isKnownToPlayer(abroad({}), "France"), false, "a covert one nobody told of runs unseen");
  assert.equal(isKnownToPlayer(abroad({ secrecy: "restricted" }), "France"), false);
  assert.equal(isKnownToPlayer(abroad({ linkedSpyIds: ["spy-1"] }), "France"), true);
  assert.equal(isKnownToPlayer(abroad({ known: true }), "France"), true);
  assert.equal(isKnownToPlayer(abroad({ verification: "doubted" }), "France"), true);
});

test("a material change is a new entry, a status or progress change, a plan given, a setback recorded or a checkpoint reached", () => {
  const base = project({ id: "a", plan: { milestones: [{ id: "m1", title: "Keel", atProgress: 20 }] }, adjustments: [] });
  assert.deepEqual(materiallyChangedEntryIds([], [base]), ["a"]);
  assert.deepEqual(materiallyChangedEntryIds([base], [{ ...base, lastUpdate: "Words only." }]), []);
  assert.deepEqual(materiallyChangedEntryIds([base], [{ ...base, status: "cancelled" }]), ["a"]);
  assert.deepEqual(materiallyChangedEntryIds([base], [{ ...base, progress: 70 }]), ["a"]);
  assert.deepEqual(materiallyChangedEntryIds([base], [{ ...base, adjustments: [{ kind: "setback", days: 30, round: 2 }] }]), ["a"]);
  assert.deepEqual(materiallyChangedEntryIds([base], [{ ...base, plan: { milestones: [{ id: "m1", title: "Keel", atProgress: 20, reached: true }] } }]), ["a"]);
  assert.deepEqual(materiallyChangedEntryIds([{ ...base, plan: null, status: "planning" }], [base]), ["a"], "a plan given is a change");
});

test("a covert operation an agent IS opens with a plan of its own: set up in a month, at no cost", () => {
  const [create] = spyOperationOps([{ id: "spy-1", owner: "France", target: "Germany", status: "active" }], [], { date: "1938-01-01", playerPolity: "France" });
  assert.equal(create.op, "create");
  assert.equal(create.ongoing, true);
  assert.deepEqual(create.plan, { durationDays: 30, monthlyCost: 0, ongoing: true, milestones: [], effects: [], yields: [] });
});

test("doubt never stops another country's work: the doubt is the knower's, the programme its owner's", () => {
  // Since the engine, another country's entry is that country's own work. A
  // doubt that stalled it as "blocked" stopped Germany's programme for good
  // because France's agent fell under suspicion (the review of 2026-11-18).
  const ops = spyIntelDoubtOps(
    [{ id: "spy-1", owner: "France", target: "Germany", status: "active", suspected: true }],
    [project({ id: "g", ownerCode: "Germany", linkedSpyIds: ["spy-1"] })],
    { playerPolity: "France", date: "1938-02-01" },
  );
  assert.equal(ops.length, 1);
  assert.equal(ops[0].verification, "doubted");
  for (const field of ["status", "stallReason", "lastUpdate"]) assert.equal(field in ops[0], false, `${field} is the owner's`);
});

test("an entry lent to the board for a skip is its lender's own work, never a file of the board's government", () => {
  // In a shared game each guest's open work is lent to the game's board for the
  // skip (seatBoards.js): it is France's own, whatever agents Germany has there.
  const lent = project({ id: "fr-1", name: "Maginot Extension", ownerCode: "France", lentFrom: "France", secrecy: "covert" });
  const germans = [{ id: "spy-germany-france-1", owner: "Germany", target: "France", status: "active", suspected: true }];
  assert.deepEqual(spyProvenanceOps(germans, [lent], { playerPolity: "Germany" }), []);
  assert.deepEqual(spyIntelDoubtOps(germans, [{ ...lent, linkedSpyIds: ["spy-germany-france-1"] }], { playerPolity: "Germany" }), []);
});

test("what another government's agents tell it is kept as its own knowledge of the work, never on the work", () => {
  const work = [
    { project: project({ id: "fr-1", name: "Maginot Extension", ownerCode: "", secrecy: "covert" }), owner: "France" },
    { project: project({ id: "it-1", name: "Alpine Wall", ownerCode: "Italy" }), owner: "Italy" },
    { project: project({ id: "de-1", name: "Autobahn", ownerCode: "" }), owner: "Germany" },
  ];
  const live = [{ id: "spy-de-fr", owner: "Germany", target: "France", status: "active" }];
  const [stamped] = agentKnowledgeChanges(live, work, { knower: "Germany" });
  assert.equal(stamped.index, 0);
  assert.equal(stamped.doubted, false);
  assert.deepEqual(stamped.project.knownBy, { Germany: { spyIds: ["spy-de-fr"] } });
  assert.deepEqual(knowledgeOf(stamped.project, "germany"), { spyIds: ["spy-de-fr"], verification: "" });
  for (const field of ["status", "stallReason", "linkedSpyIds", "verification", "lastUpdate", "updatedAt"]) {
    assert.deepEqual(stamped.project[field], work[0].project[field], `the work's own ${field} is untouched`);
  }
  // Its own country's work, a country it has no agent in, nothing.
  assert.equal(agentKnowledgeChanges(live, work, { knower: "Germany" }).length, 1);
  // Suspected, in the same pass: doubted, and only for Germany.
  const [doubted] = agentKnowledgeChanges([{ ...live[0], suspected: true }], work, { knower: "Germany" });
  assert.equal(doubted.doubted, true);
  assert.deepEqual(doubted.project.knownBy, { Germany: { spyIds: ["spy-de-fr"], verification: "doubted" } });
  assert.equal(doubted.project.status, "active");
  assert.equal(knowledgeOf(doubted.project, "Italy"), null);
  // Once only: a verdict is never overwritten, and another knower's is its own.
  const settled = { project: { ...doubted.project, knownBy: { ...doubted.project.knownBy, Germany: { spyIds: ["spy-de-fr"], verification: "confirmed" }, Italy: { spyIds: ["spy-it-fr"] } } }, owner: "France" };
  assert.deepEqual(agentKnowledgeChanges([{ ...live[0], suspected: true }], [settled], { knower: "Germany" }), []);
  // Another government's agents are never this one's.
  assert.deepEqual(agentKnowledgeChanges(live, work, { knower: "Italy" }), []);
});
