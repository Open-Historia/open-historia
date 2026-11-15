/*! Open Historia — portions (project op application tests) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Needs node_modules: gameState.js reaches assets.js, which imports maplibre-gl.
// Run with `npm ci && node --test src/runtime/projectOps.test.js`.
//
// What a project op may still do, now that the engine runs every project
// (runtime/projectEngine.js): open one (with its plan, or to be planned), say
// what it IS, fund it, set it back or bring it on (taking hold next period), end
// it. Never its progress, status or dates. The engine's own tests are
// projectEngine.test.js.
import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceProjectsInWorld,
  applyEventImpactsToWorld,
  applyProjectOps,
  applyProjectOutcomesToWorld,
  applyProjectOpsToWorld,
  normalizeProjectEntry,
  normalizeWorldState,
} from "./gameState.js";

const PLAN = {
  durationDays: 400,
  monthlyCost: 1e9,
  milestones: [{ title: "Keel laid", atProgress: 30 }, { title: "Sea trials", atProgress: 80 }],
  effects: [{ type: "stat", stat: "military.sea", change: 5 }],
};

const leviathan = { op: "create", name: "Project Leviathan", summary: "A new battleship class.", kind: "project", plan: PLAN };
const open = (ops = [leviathan], ctx = { date: "1936-01-01", round: 3 }) => applyProjectOps([], ops, ctx);

test("a create opens a project with its plan, at nothing done, dated by its event", () => {
  const [entry] = open();
  assert.equal(entry.status, "active");
  assert.equal(entry.progress, 0);
  assert.equal(entry.funding, "normal");
  assert.equal(entry.startedAt, "1936-01-01");
  assert.equal(entry.plan.durationDays, 400);
  assert.equal(entry.plan.monthlyCost, 1e9);
  assert.deepEqual(entry.plan.milestones.map((milestone) => [milestone.title, milestone.atProgress]), [["Keel laid", 30], ["Sea trials", 80]]);
  assert.deepEqual(entry.plan.effects, [{ type: "stat", stat: "military.sea", change: 5 }]);
});

test("a create never sets its own progress, status or dates", () => {
  const [entry] = open([{ ...leviathan, progress: 90, status: "complete", targetDate: "1936-02-01" }]);
  assert.equal(entry.progress, 0);
  assert.equal(entry.status, "active");
  assert.notEqual(entry.targetDate, "1936-02-01");
});

test("a create with no plan waits, planning, until it is given one", () => {
  const [entry] = open([{ op: "create", name: "Project Leviathan", summary: "A new battleship class." }]);
  assert.equal(entry.status, "planning");
  assert.equal(entry.plan, null);
  const [planned] = applyProjectOps([entry], [{ op: "update", name: "Project Leviathan", plan: PLAN }], { date: "1936-02-01" });
  assert.equal(planned.status, "active");
  assert.equal(planned.plan.durationDays, 400);
});

test("a plan is held to the owner's means by whoever opens it", () => {
  const [entry] = applyProjectOps([], [leviathan], { date: "1936-01-01", boundPlan: (plan) => ({ ...plan, monthlyCost: 5 }) });
  assert.equal(entry.plan.monthlyCost, 5);
});

test("a restatement of a running project changes only what it said, never its course", () => {
  const [running] = open();
  const ticked = { ...running, progress: 40 };
  const [after] = applyProjectOps([ticked], [{ op: "create", name: "Project Leviathan", summary: "Restated.", plan: { durationDays: 20, monthlyCost: 1 } }], { date: "1936-06-01" });
  assert.equal(after.summary, "Restated.");
  assert.equal(after.progress, 40);
  assert.equal(after.plan.durationDays, 400, "a plan is taken only by an entry still planning");
});

test("an update may say what it is and how it is funded, never its progress, status or dates", () => {
  const [entry] = open();
  const [after] = applyProjectOps([entry], [{
    op: "update", name: "Project Leviathan", progress: 99, status: "complete", targetDate: "1936-02-01",
    lastUpdate: "The yards are busy.", funding: "high", summary: "A faster battleship class.",
  }], { date: "1936-01-15" });
  assert.equal(after.progress, 0);
  assert.equal(after.status, "active");
  assert.equal(after.lastUpdate, "The yards are busy.");
  assert.equal(after.funding, "high");
  assert.equal(after.summary, "A faster battleship class.");
});

test("funding none pauses a project, and funding it again takes it up", () => {
  const [entry] = open();
  const [paused] = applyProjectOps([entry], [{ op: "update", name: "Project Leviathan", funding: "none" }]);
  assert.equal(paused.status, "paused");
  const [again] = applyProjectOps([paused], [{ op: "update", name: "Project Leviathan", funding: "low" }]);
  assert.equal(again.status, "active");
  assert.equal(again.funding, "low");
});

test("a save's priority becomes its funding, and a paused entry is one funded with nothing", () => {
  assert.equal(normalizeProjectEntry({ name: "A", priority: "high" }).funding, "high");
  assert.equal(normalizeProjectEntry({ name: "B", priority: "low" }).funding, "low");
  assert.equal(normalizeProjectEntry({ name: "C" }).funding, "normal");
  const paused = normalizeProjectEntry({ name: "D", status: "paused", priority: "high" });
  assert.equal(paused.funding, "none");
  assert.equal(paused.status, "paused");
});

test("a setback and a boost are recorded with their round, bounded, to take hold next period", () => {
  const [entry] = open();
  const [after] = applyProjectOps([entry], [
    { op: "setback", name: "Project Leviathan", days: 400, overrun: 90, lastUpdate: "A fire in the yard." },
    { op: "boost", name: "Project Leviathan", days: 500 },
  ], { date: "1936-03-01", round: 4 });
  assert.equal(after.progress, 0, "nothing moves now");
  assert.deepEqual(after.adjustments.map(({ kind, days, overrun, round }) => ({ kind, days, overrun, round })), [
    { kind: "setback", days: 180, overrun: 50, round: 4 },
    { kind: "boost", days: 90, overrun: undefined, round: 4 },
  ]);
  assert.equal(after.lastUpdate, "A fire in the yard.");
});

test("a setback on a project that has ended changes nothing", () => {
  const [entry] = open();
  const [ended] = applyProjectOps([entry], [{ op: "cancel", name: "Project Leviathan" }]);
  const [after] = applyProjectOps([ended], [{ op: "setback", name: "Project Leviathan", days: 30 }]);
  assert.deepEqual(after.adjustments, []);
});

test("cancel and fail end a project and leave it on the board; complete is the engine's alone", () => {
  const [entry] = open();
  const [cancelled] = applyProjectOps([entry], [{ op: "cancel", name: "Project Leviathan", note: "The budget went." }], { date: "1936-05-01" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.lastUpdate, "The budget went.");
  assert.ok(cancelled.plan.milestones.every((milestone) => milestone.missed), "a checkpoint still ahead of an ended project is missed");
  const [failed] = applyProjectOps([entry], [{ op: "fail", name: "Project Leviathan" }]);
  assert.equal(failed.status, "failed");
  const [notCompleted] = applyProjectOps([entry], [{ op: "complete", name: "Project Leviathan" }, { op: "close", name: "Project Leviathan", status: "complete" }]);
  assert.equal(notCompleted.status, "active");
});

test("an op finds its project by name when its id names nothing on the board", () => {
  const [entry] = open();
  const [after] = applyProjectOps([entry], [{ op: "update", projectId: "project-wrong", name: "Project Leviathan", lastUpdate: "Found by name." }]);
  assert.equal(after.lastUpdate, "Found by name.");
});

test("an op finds its project by name, case and accents aside, and as a prompt might quote it", () => {
  const [entry] = open([{ ...leviathan, name: "Opération Kingfisher" }]);
  for (const name of ["opération kingfisher", "Operation Kingfisher", "Opération \"Opération Kingfisher\""]) {
    const [after] = applyProjectOps([entry], [{ op: "update", name, lastUpdate: name }]);
    assert.equal(after.lastUpdate, name, name);
  }
});

test("an op naming nothing on the board is dropped, never a phantom project", () => {
  const [entry] = open();
  const after = applyProjectOps([entry], [{ op: "setback", name: "Project Kraken", days: 10 }]);
  assert.equal(after.length, 1);
  assert.deepEqual(after[0].adjustments, []);
});

test("the old verbs are no ops: milestone, complete, remove and English synonyms are left out", () => {
  const [entry] = open();
  const after = applyProjectOps([entry], [
    { op: "milestone", name: "Project Leviathan", milestone: { title: "Keel laid", status: "done" } },
    { op: "remove", name: "Project Leviathan" },
    { op: "finish", name: "Project Leviathan" },
  ]);
  assert.equal(after.length, 1);
  assert.equal(after[0].status, "active");
  assert.ok(after[0].plan.milestones.every((milestone) => !milestone.reached));
});

// ---- the doors ----------------------------------------------------------------

const worldWith = (projects) => normalizeWorldState({ projects, countryStats: { France: { economy: { gdp: 1.2e12, budgetBalance: 0, publicDebt: 40 }, stability: 60 } } });

test("the player's door opens their own project, with its plan held to their budget", () => {
  const { world } = applyProjectOpsToWorld({ actor: "player", date: "1936-01-01", playerCountry: "France", world: worldWith([]), ops: [leviathan] });
  const [entry] = world.projects;
  assert.equal(entry.name, "Project Leviathan");
  // 2% of 1.2 trillion a year is 2 billion a month; one project may cost half of it.
  assert.equal(entry.plan.monthlyCost, 1e9);
  const dear = applyProjectOpsToWorld({ actor: "player", playerCountry: "France", world: worldWith([]), ops: [{ ...leviathan, plan: { ...PLAN, monthlyCost: 9e12 } }] }).world.projects[0];
  assert.equal(dear.plan.monthlyCost, 1e9);
});

test("the player's door steers only their own work: funding, a plan, calling it off", () => {
  const theirs = normalizeProjectEntry({ name: "Rocket Programme", ownerCode: "Germany", plan: PLAN, secrecy: "public" });
  const mine = normalizeProjectEntry({ name: "Project Leviathan", plan: PLAN });
  const { refusedProjectIds, world } = applyProjectOpsToWorld({
    actor: "player",
    playerCountry: "France",
    world: worldWith([theirs, mine]),
    ops: [
      { op: "update", name: "Rocket Programme", funding: "none" },
      { op: "cancel", name: "Rocket Programme" },
      { op: "update", name: "Project Leviathan", funding: "high" },
      { op: "update", name: "Project Leviathan", summary: "The player does not rewrite what it is." },
    ],
  });
  assert.deepEqual(refusedProjectIds.sort(), [theirs.id, mine.id].sort());
  const byName = new Map(world.projects.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("Rocket Programme").status, "active");
  assert.equal(byName.get("Project Leviathan").funding, "high");
  assert.equal(byName.get("Project Leviathan").summary, mine.summary);
});

test("the advisor opens and steers the player's work and reports on any; it neither sets back nor opens another country's", () => {
  const theirs = normalizeProjectEntry({ name: "Rocket Programme", ownerCode: "Germany", plan: PLAN });
  const { world } = applyProjectOpsToWorld({
    actor: "ai",
    playerCountry: "France",
    world: worldWith([theirs]),
    ops: [
      { op: "create", name: "Counter-Rocket Effort", summary: "Ours.", plan: PLAN },
      { op: "create", name: "German Jets", ownerCode: "Germany", summary: "Theirs.", plan: PLAN },
      { op: "update", name: "Rocket Programme", lastUpdate: "Our sources say it is behind." },
      { op: "setback", name: "Rocket Programme", days: 60 },
      { op: "cancel", name: "Rocket Programme" },
    ],
  });
  const byName = new Map(world.projects.map((entry) => [entry.name, entry]));
  assert.ok(byName.has("Counter-Rocket Effort"));
  assert.equal(byName.has("German Jets"), false);
  const rocket = byName.get("Rocket Programme");
  assert.equal(rocket.lastUpdate, "Our sources say it is behind.");
  assert.deepEqual(rocket.adjustments, []);
  assert.equal(rocket.status, "active");
});

test("the engine's own ops may stall an entry whose intelligence is in doubt; a confirmation takes it up", () => {
  const theirs = normalizeProjectEntry({ name: "Rocket Programme", ownerCode: "Germany", plan: PLAN, linkedSpyIds: ["spy-1"] });
  const doubted = applyProjectOpsToWorld({
    actor: "engine",
    world: worldWith([theirs]),
    ops: [{ op: "update", name: "Rocket Programme", verification: "doubted", status: "stalled", stallReason: "blocked" }],
  }).world.projects[0];
  assert.equal(doubted.status, "stalled");
  assert.equal(doubted.stallReason, "blocked");
  const confirmed = applyProjectOps([doubted], [{ op: "update", name: "Rocket Programme", verification: "confirmed" }])[0];
  assert.equal(confirmed.status, "active");
  assert.equal(confirmed.verification, "confirmed");
});

// ---- the event path ---------------------------------------------------------------

test("an event opens a country's project on an empty board, its plan held to that country's means", () => {
  const world = normalizeWorldState({ projects: [], countryStats: { Germany: { economy: { gdp: 6e11 } } } });
  const result = applyEventImpactsToWorld({
    world,
    events: [{ id: "e1", date: "1936-04-01", title: "Germany lays down a fleet", description: "", impacts: { projectOps: [{ op: "create", name: "Plan Z", ownerCode: "Germany", summary: "A fleet.", plan: { ...PLAN, monthlyCost: 1e12 } }] } }],
    round: 3,
  });
  const [entry] = result.world.projects;
  assert.equal(entry.ownerCode, "Germany");
  assert.equal(entry.startedAt, "1936-04-01");
  assert.deepEqual(entry.eventIds, ["e1"]);
  assert.equal(entry.plan.monthlyCost, 6e11 * 0.02 / 12 / 2);
});

// ---- what a finished project does to the world --------------------------------------

const statsWorld = (projects) => normalizeWorldState({
  projects,
  countryStats: {
    France: { stability: 50, economy: { gdp: 1.2e12, gdpGrowth: 1, budgetBalance: 0, publicDebt: 40 }, military: { sea: 50 } },
    Italy: { stability: 60 },
  },
  relations: [],
  markers: [],
  unitTypes: [],
});

const finished = (overrides = {}) => normalizeProjectEntry({
  id: "p1",
  name: "Project Leviathan",
  progress: 99,
  focus: { lng: 5.9, lat: 43.1 },
  plan: {
    durationDays: 100,
    monthlyCost: 1e8,
    effects: [
      { type: "stat", stat: "military.sea", change: 6 },
      { type: "stat", stat: "economy.gdp", change: 2 },
      { type: "relation", country: "Italy", change: -10 },
      { type: "structure", name: "Toulon Dry Dock", kind: "shipyard" },
      { type: "unitType", name: "Leviathan Battleship", base: "naval", attack: 1.4, toughness: 1.5 },
    ],
  },
  ...overrides,
});

test("a project the engine completes changes the world once, by its effects, bounded and on its owner", () => {
  const before = statsWorld([finished()]);
  const advanced = advanceProjectsInWorld({ baseWorld: before, world: before, fromDate: "1936-01-01", toDate: "1936-01-10", host: "France", round: 2 });
  assert.equal(advanced.outcomes.find((outcome) => outcome.type === "complete").date, "1936-01-02");
  const { world, applied } = applyProjectOutcomesToWorld({ world: advanced.world, outcomes: advanced.outcomes, date: "1936-01-10", round: 2, host: "France" });
  assert.equal(world.countryStats.France.military.sea, 56);
  assert.equal(Math.round(world.countryStats.France.economy.gdp), Math.round(1.2e12 * 1.02));
  const relation = world.relations.find((entry) => [entry.a, entry.b].includes("Italy"));
  assert.equal(relation.score, -10);
  const dock = world.markers.find((marker) => marker.name === "Toulon Dry Dock");
  assert.deepEqual([dock.lng, dock.lat, dock.ownerCode], [5.9, 43.1, "France"], "a structure with no place of its own stands at the project's focus");
  const type = world.unitTypes.find((entry) => entry.name === "Leviathan Battleship");
  assert.deepEqual([type.base, type.attack, type.toughness, type.owners], ["naval", 1.4, 1.5, ["France"]]);
  assert.equal(applied.length, 5);
  assert.equal(world.projects[0].effectsAppliedAt, "1936-01-02");
  // Told again (a turn applied a second time, a replay), nothing lands twice.
  const twice = applyProjectOutcomesToWorld({ world, outcomes: advanced.outcomes, date: "1936-01-10", round: 2, host: "France" });
  assert.equal(twice.world.countryStats.France.military.sea, 56);
  assert.equal(twice.applied.length, 0);
});

test("a completion's effects are bounded against the world as it stands when they land", () => {
  const world = statsWorld([finished({ plan: { durationDays: 100, monthlyCost: 1, effects: [{ type: "stat", stat: "stability", change: 90 }, { type: "stat", stat: "military.sea", change: 6 }] } })]);
  world.countryStats.France.military.sea = 98;
  const advanced = advanceProjectsInWorld({ baseWorld: world, world, fromDate: "1936-01-01", toDate: "1936-01-03", host: "France", round: 2 });
  const after = applyProjectOutcomesToWorld({ world: advanced.world, outcomes: advanced.outcomes, host: "France" }).world;
  assert.equal(after.countryStats.France.stability, 58, "eight points at most");
  assert.equal(after.countryStats.France.military.sea, 100, "and never past the scale");
});

test("a programme that runs on pays its yields every month it is paid for, whole points as they bank", () => {
  const programme = normalizeProjectEntry({
    id: "p9",
    name: "Coastal Watch",
    progress: 100,
    established: true,
    plan: { durationDays: 30, monthlyCost: 1e6, ongoing: true, yields: [{ type: "stat", stat: "stability", change: 0.5 }] },
  });
  let world = statsWorld([programme]);
  for (const [from, to] of [["1936-01-01", "1936-01-31"], ["1936-01-31", "1936-03-01"], ["1936-03-01", "1936-03-31"], ["1936-03-31", "1936-04-30"]]) {
    const advanced = advanceProjectsInWorld({ baseWorld: world, world, fromDate: from, toDate: to, host: "France", round: 2 });
    world = applyProjectOutcomesToWorld({ world: advanced.world, outcomes: advanced.outcomes, host: "France" }).world;
  }
  assert.equal(world.countryStats.France.stability, 52, "half a point a month: one point every second month");
  assert.equal(world.projects[0].status, "active");
});

test("a project from before the engine still releases its own completion's territory, once, for the map to place", () => {
  const legacy = normalizeProjectEntry({ id: "old", name: "Annex the Ticino", progress: 99.5, startedAt: "1936-01-01", targetDate: "1936-12-31", onComplete: { regionTransfers: [{ regionId: "region: Ticino", toCode: "Italy" }] } });
  const world = statsWorld([legacy]);
  const advanced = advanceProjectsInWorld({ baseWorld: world, world, fromDate: "1936-06-01", toDate: "1936-06-10", host: "Italy", round: 2 });
  const released = applyProjectOutcomesToWorld({ world: advanced.world, outcomes: advanced.outcomes, host: "Italy" });
  assert.equal(released.territory.length, 1);
  assert.deepEqual(released.territory[0].regionTransfers.map((transfer) => transfer.toCode), ["Italy"]);
  assert.ok(released.world.projects[0].onCompleteAppliedAt);
  assert.equal(applyProjectOutcomesToWorld({ world: released.world, outcomes: advanced.outcomes, host: "Italy" }).territory.length, 0);
});

test("another country's entry from before the engine stays known to the player; one the world opens now is known only if public", () => {
  const legacy = normalizeProjectEntry({ name: "Rocket Programme", ownerCode: "Germany", secrecy: "covert", progress: 40 });
  assert.equal(legacy.known, true);
  assert.equal(legacy.plan.legacy, true);
  assert.equal(normalizeProjectEntry(legacy).known, true, "and stays so");
  const [opened] = applyProjectOps([], [{ op: "create", name: "Jet Programme", ownerCode: "Germany", secrecy: "covert", summary: "s", plan: PLAN }]);
  assert.equal(opened.known, false);
});
