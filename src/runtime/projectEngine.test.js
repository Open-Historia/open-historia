/*! Open Historia — the projects engine: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/projectEngine.test.js
//
// "right now they dont actually effect the world actively and dont progress
// normally. it seems like they just sit doing nothing" (the owner, 2026-11-15).
// The engine runs the clock now: these pin that it moves every day, that money
// decides how fast, that a starved project stalls and takes up again by itself,
// that checkpoints are dated, that what a project does lands once and within
// bounds, and that the period a time skip is told is the period it gets.
import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_OPEN_PER_COUNTRY_MOST,
  BOOST_DAYS_MOST,
  CAPACITY_LEAST,
  CAPACITY_MOST,
  COST_SHARE_OF_BUDGET_MOST,
  DURATION_MOST,
  OVERRUN_PERCENT_MOST,
  RELATION_BOUNDS,
  SETBACK_DAYS_MOST,
  SKIP_CREATES_MOST,
  STALL_AFTER_DAYS,
  STAT_BOUNDS,
  boundPlanForOwner,
  capacityOf,
  describeOutcomes,
  legacyPlanFor,
  mergeTickedBoard,
  monthlyProjectBudget,
  normalizeAdjustment,
  normalizeProjectEffect,
  normalizeProjectPlan,
  ownerMeans,
  tickProjects,
  worldProjectGate,
} from "./projectEngine.js";

// A sheet with an ordinary economy: 1.2 trillion a year, a balanced budget and
// an easy debt (treasury factor 1), stability 50 and no growth (capacity 1).
// Its project budget is 2% of that a year: 2 billion a month.
const SHEET = { stability: 50, economy: { gdp: 1.2e12, gdpGrowth: 0, budgetBalance: 0, publicDebt: 40 } };
const world = (sheets = { France: SHEET }) => ({ countryStats: sheets });

const project = (overrides = {}) => ({
  id: "p1",
  name: "Project Leviathan",
  ownerCode: "",
  status: "active",
  funding: "normal",
  progress: 0,
  plan: normalizeProjectPlan({
    durationDays: 100,
    monthlyCost: 3e8,
    milestones: [{ title: "Keel laid", atProgress: 25 }, { title: "Launch", atProgress: 50 }, { title: "Sea trials", atProgress: 90 }],
    effects: [{ type: "stat", stat: "military.sea", change: 5 }],
  }),
  adjustments: [],
  ...overrides,
});

const run = (projects, fromDate, toDate, options = {}) => tickProjects({ projects, world: world(), fromDate, toDate, host: "France", round: 5, ...options });

test("the work moves every day by itself, and checkpoints are reached on their days", () => {
  const { projects, outcomes, days } = run([project()], "1936-01-01", "1936-03-01");
  assert.equal(days, 60);
  // 100 days of work at normal funding and capacity 1: one point a day.
  assert.equal(projects[0].progress, 60);
  assert.deepEqual(outcomes.map((outcome) => [outcome.type, outcome.date, outcome.milestone]), [
    ["milestone", "1936-01-26", "Keel laid"],
    ["milestone", "1936-02-20", "Launch"],
  ]);
  const reached = projects[0].plan.milestones.filter((milestone) => milestone.reached);
  assert.deepEqual(reached.map((milestone) => milestone.reachedAt), ["1936-01-26", "1936-02-20"]);
  assert.equal(projects[0].plan.milestones[2].reached, undefined);
});

test("the tick is deterministic, and a period run in two halves comes to the same days as run whole", () => {
  const board = [project(), project({ id: "p2", name: "Canal", funding: "low", plan: normalizeProjectPlan({ durationDays: 300, monthlyCost: 1.5e9 }) })];
  const whole = run(board, "1936-01-01", "1936-07-01");
  const again = run(board, "1936-01-01", "1936-07-01");
  assert.deepEqual(again, whole);
  assert.equal(board[0].plan.milestones.some((milestone) => milestone.reached), false, "the board it was handed comes out as it went in");
  const first = run(board, "1936-01-01", "1936-04-01");
  const second = run(first.projects, "1936-04-01", "1936-07-01");
  for (const [index, entry] of second.projects.entries()) {
    assert.ok(Math.abs(entry.progress - whole.projects[index].progress) < 0.001, `${entry.name}: ${entry.progress} against ${whole.projects[index].progress}`);
    assert.equal(entry.spent, whole.projects[index].spent);
    assert.equal(entry.status, whole.projects[index].status);
  }
  assert.deepEqual([...first.outcomes, ...second.outcomes], whole.outcomes);
});

test("a project completes on its day, with its effects named, and stops working", () => {
  const { projects, outcomes } = run([project({ progress: 95 })], "1936-01-01", "1936-02-01");
  const done = outcomes.find((outcome) => outcome.type === "complete");
  assert.equal(done.date, "1936-01-06");
  assert.deepEqual(done.effects, [{ type: "stat", stat: "military.sea", change: 5 }]);
  assert.equal(projects[0].status, "complete");
  assert.equal(projects[0].completedAt, "1936-01-06");
  assert.equal(projects[0].progress, 100);
  assert.match(describeOutcomes(outcomes), /1936-01-06: France · "Project Leviathan" is COMPLETED; it takes effect: military\.sea \+5/);
});

test("funding sets the cost and the speed alike: low is half of each, high one and a half, none nothing", () => {
  const at = (funding) => run([project({ funding })], "1936-01-01", "1936-01-21").projects[0];
  const normal = at("normal");
  const low = at("low");
  const high = at("high");
  assert.equal(normal.progress, 20);
  assert.equal(low.progress, 10);
  assert.equal(high.progress, 30);
  assert.equal(normal.spent, 2e8);
  assert.equal(low.spent, 1e8);
  assert.equal(high.spent, 3e8);
  const paused = run([project({ funding: "none", status: "paused" })], "1936-01-01", "1936-01-21").projects[0];
  assert.equal(paused.progress, 0);
  assert.equal(paused.spent ?? 0, 0);
});

test("a budget that cannot pay for everything pays the best funded first and slows the rest by the share it pays", () => {
  // 2 billion a month: a high project due 2.25 billion takes all of it.
  const dear = (overrides) => project({ plan: normalizeProjectPlan({ durationDays: 100, monthlyCost: 1.5e9 }), ...overrides });
  const board = [dear({ id: "a", name: "A", funding: "high" }), dear({ id: "b", name: "B", funding: "normal" })];
  const { projects } = run(board, "1936-01-01", "1936-01-11");
  const [a, b] = projects;
  assert.ok(a.progress > 13 && a.progress < 14, `the high one is paid 2/2.25 of its due: ${a.progress}`);
  assert.equal(b.progress, 0, "nothing is left for the normal one");
  assert.ok(a.paidShare < 1);
  assert.equal(b.paidShare, 0);
});

test("a project paid next to nothing for a month stalls for want of funds, and takes up again when the money is there", () => {
  const dear = project({ id: "hog", name: "Hog", funding: "high", plan: normalizeProjectPlan({ durationDays: 1000, monthlyCost: 1.5e9 }) });
  const starved = project({ id: "lean", name: "Lean", funding: "low" });
  const stalled = run([dear, starved], "1936-01-01", "1936-03-01");
  const lean = stalled.projects[1];
  assert.equal(lean.status, "stalled");
  assert.equal(lean.stallReason, "funds");
  const stall = stalled.outcomes.find((outcome) => outcome.type === "stall");
  assert.equal(stall.project, "Lean");
  // The thirtieth starved day is the thirtieth day after the period began.
  assert.equal(STALL_AFTER_DAYS, 30);
  assert.equal(stall.date, "1936-01-31");
  // The hog is cancelled: its money is free, and the stalled one resumes by itself.
  const freed = [{ ...stalled.projects[0], status: "cancelled" }, lean];
  const resumed = run(freed, "1936-03-01", "1936-03-11");
  assert.equal(resumed.projects[1].status, "active");
  assert.equal(resumed.outcomes[0].type, "resume");
  assert.equal(resumed.outcomes[0].date, "1936-03-02");
  assert.ok(resumed.projects[1].progress > lean.progress);
});

test("an owner with no native GDP baseline cannot spend unassessed funds", () => {
  const { projects } = tickProjects({ projects: [project({ ownerCode: "Atlantis" })], world: world(), fromDate: "1936-01-01", toDate: "1936-01-11", host: "France", round: 5 });
  assert.equal(projects[0].progress, 0);
  assert.equal(projects[0].spent, 0);
  assert.equal(projects[0].paidShare, 0);
});

test("capacity follows the economy and stability, within its bounds", () => {
  assert.equal(capacityOf(SHEET), 1);
  assert.equal(capacityOf(null), 1);
  assert.equal(capacityOf({ stability: 100, economy: { gdp: 1, gdpGrowth: 10, budgetBalance: 10, publicDebt: 0 } }), CAPACITY_MOST);
  assert.equal(capacityOf({ stability: 0, economy: { gdp: 1, gdpGrowth: -10, budgetBalance: -25, publicDebt: 300 } }), CAPACITY_LEAST);
  const strong = tickProjects({ projects: [project()], world: world({ France: { ...SHEET, stability: 90 } }), fromDate: "1936-01-01", toDate: "1936-01-11", host: "France" });
  assert.ok(strong.projects[0].progress > 10);
});

test("a setback and a boost take hold at the start of the next period, bounded, and never undo a checkpoint reached", () => {
  assert.equal(normalizeAdjustment({ kind: "setback", days: 999, overrun: 999 }).days, SETBACK_DAYS_MOST);
  assert.equal(normalizeAdjustment({ kind: "setback", days: 999, overrun: 999 }).overrun, OVERRUN_PERCENT_MOST);
  assert.equal(normalizeAdjustment({ kind: "boost", days: 999 }).days, BOOST_DAYS_MOST);
  assert.equal(normalizeAdjustment({ kind: "boost", days: 30, overrun: 40 }).overrun, undefined, "a boost never makes it dearer");
  assert.equal(normalizeAdjustment({ kind: "delay", days: 30 }), null);
  const told = project({ progress: 60, plan: { ...project().plan, milestones: project().plan.milestones.map((milestone, index) => (index < 2 ? { ...milestone, reached: true, reachedAt: "1936-01-01" } : milestone)) },
    adjustments: [{ kind: "setback", days: 30, overrun: 20, round: 5, date: "1936-02-01" }] });
  // The turn it was told in (round 5) does not move.
  const same = run([told], "1936-03-01", "1936-03-02", { round: 5 });
  assert.equal(same.projects[0].progress, 61);
  // The next turn's tick starts with it: thirty days of work lost (but not below
  // the checkpoint at 50 already reached), and the cost a fifth dearer.
  const next = run([told], "1936-03-01", "1936-03-02", { round: 6 });
  assert.equal(next.projects[0].progress, 51);
  assert.equal(next.projects[0].costOverrun, 20);
  assert.equal(next.projects[0].adjustments[0].applied, true);
  const boosted = run([project({ progress: 10, adjustments: [{ kind: "boost", days: 90, round: 1 }] })], "1936-03-01", "1936-03-02", { round: 2 });
  assert.equal(boosted.projects[0].progress, 100, "a breakthrough brings it to the brink (99.99), and the day's work finishes it");
  assert.equal(boosted.projects[0].status, "complete");
});

test("a programme that runs on is set up once, then pays its yields every month it is paid for", () => {
  const programme = project({
    ongoing: true,
    plan: normalizeProjectPlan({
      durationDays: 30,
      monthlyCost: 1e8,
      ongoing: true,
      effects: [{ type: "relation", country: "Italy", change: 5 }],
      yields: [{ type: "stat", stat: "stability", change: 0.4 }, { type: "stat", stat: "stability", change: 9 }],
    }),
  });
  assert.deepEqual(programme.plan.yields, [{ type: "stat", stat: "stability", change: STAT_BOUNDS.points.month }], "yields of one figure are summed, then bounded to a month's");
  const { projects, outcomes } = run([programme], "1936-01-01", "1936-04-01");
  assert.equal(outcomes[0].type, "established");
  assert.equal(outcomes[0].date, "1936-01-31");
  assert.deepEqual(outcomes.filter((outcome) => outcome.type === "yield").map((outcome) => [outcome.date, outcome.share]), [["1936-03-01", 1], ["1936-03-31", 1]]);
  assert.equal(projects[0].established, true);
  assert.equal(projects[0].status, "active");
  assert.equal(projects[0].targetDate, undefined);
});

test("effects are bounded on their own scale, whatever a plan says", () => {
  assert.deepEqual(normalizeProjectEffect({ type: "stat", stat: "Stability", change: 40 }), { type: "stat", stat: "stability", change: STAT_BOUNDS.points.once });
  assert.equal(normalizeProjectEffect({ type: "stat", stat: "economy.gdp", change: 25 }).change, STAT_BOUNDS.percentGdp.once);
  assert.equal(normalizeProjectEffect({ type: "stat", stat: "economy.inflation", change: -9 }).change, -STAT_BOUNDS.rate.once);
  assert.equal(normalizeProjectEffect({ type: "relation", country: "Italy", change: 80 }).change, RELATION_BOUNDS.once);
  assert.equal(normalizeProjectEffect({ type: "unitType", name: "Alpini", base: "infantry", attack: 9, toughness: 0.1 }).attack, 1.6);
  assert.equal(normalizeProjectEffect({ type: "unitType", name: "Alpini", attack: 9, toughness: 0.1 }).toughness, 0.5);
  assert.equal(normalizeProjectEffect({ type: "stat", stat: "economy.colour", change: 3 }), null, "a figure no sheet has is no effect");
  assert.equal(normalizeProjectEffect({ type: "magic", change: 3 }), null);
  assert.equal(normalizeProjectEffect({ type: "relation", change: 3 }), null, "a relation needs the other country");
  assert.deepEqual(normalizeProjectEffect({ type: "territory", region: "region: Savoy", country: "Italy" }), { type: "territory", region: "Savoy", country: "Italy" });
});

test("a plan is held to the engine's bounds, and to its owner's budget", () => {
  const plan = normalizeProjectPlan({ durationDays: 99999, monthlyCost: -5, milestones: ["A", { title: "B", atProgress: 150 }, { title: "A" }] });
  assert.equal(plan.durationDays, DURATION_MOST);
  assert.equal(plan.monthlyCost, 0);
  assert.deepEqual(plan.milestones.map((milestone) => [milestone.title, milestone.atProgress]), [["A", 26], ["B", 99]], "a checkpoint with no share of its own is spread, and one said twice is kept once");
  assert.equal(normalizeProjectPlan({ monthlyCost: 5 }), null, "a plan says how long it takes");
  const budget = monthlyProjectBudget(SHEET);
  assert.equal(budget, 2e9);
  assert.equal(boundPlanForOwner({ durationDays: 100, monthlyCost: 9e12 }, SHEET).monthlyCost, budget * COST_SHARE_OF_BUDGET_MOST);
  const custom = boundPlanForOwner({ durationDays: 100, monthlyCost: 1, effects: [{ type: "stat", stat: "customStats.grain", change: 5000 }] }, { customStats: { grain: 20000 } });
  assert.equal(custom.effects[0].change, 20000 * STAT_BOUNDS.percentCustom.once / 100, "a custom figure off the 0-100 footing moves by a share of itself");
  const means = ownerMeans(world(), "France", [project()], "France");
  assert.equal(means.budget, 2e9);
  assert.equal(means.committed, 3e8);
  assert.equal(means.covered, 1);
});

// ---- forecast and apply --------------------------------------------------------------

test("the period a skip is told is the period it gets, whatever the turn's ops did to the board meanwhile", () => {
  const base = [project({ progress: 40 }), project({ id: "p2", name: "Canal", ownerCode: "Italy", progress: 10, plan: normalizeProjectPlan({ durationDays: 900, monthlyCost: 1e8 }) })];
  const forecast = run(base, "1936-01-01", "1936-04-01");
  // The turn's ops, applied while it ran: one project set back, one cancelled,
  // one opened. None of it changes what the forecast said for this period.
  const current = [
    { ...base[0], adjustments: [{ kind: "setback", days: 60, round: 5, date: "1936-02-01" }], lastUpdate: "A fire." },
    { ...base[1], status: "cancelled" },
    project({ id: "p3", name: "New Dam", ownerCode: "Italy", progress: 0 }),
  ];
  const applied = run(base, "1936-01-01", "1936-04-01");
  assert.deepEqual(applied, forecast);
  const merged = mergeTickedBoard({ base, ticked: applied.projects, current });
  const [leviathan, canal, dam] = merged;
  assert.equal(leviathan.status, "complete", "completed as it was told, and its setback waits");
  assert.equal(leviathan.lastUpdate, "A fire.");
  assert.equal(leviathan.adjustments.length, 1);
  assert.equal(canal.status, "cancelled", "an ending the story gave stands where the engine finished nothing");
  assert.equal(canal.progress, forecast.projects[1].progress);
  assert.equal(dam.progress, 0, "a project the turn opened starts next period");
});

test("a project the engine completes is complete even if an event of the same turn called it off", () => {
  const base = [project({ progress: 99 })];
  const ticked = run(base, "1936-01-01", "1936-01-05").projects;
  const merged = mergeTickedBoard({ base, ticked, current: [{ ...base[0], status: "cancelled", plan: { ...base[0].plan, milestones: base[0].plan.milestones.map((milestone) => ({ ...milestone, missed: true })) } }] });
  assert.equal(merged[0].status, "complete");
  assert.ok(merged[0].plan.milestones.every((milestone) => !milestone.missed));
});

// ---- what the world opens -------------------------------------------------------------

test("a skip opens projects only for countries nobody plays, each with a plan, within the caps", () => {
  const plan = { durationDays: 200, monthlyCost: 1e8 };
  const gate = worldProjectGate({ board: [project({ ownerCode: "Italy" }), project({ id: "p2", name: "Two", ownerCode: "Italy" })], players: ["France"] });
  assert.equal(gate({ name: "Ours", ownerCode: "France", plan }), "theirs");
  assert.equal(gate({ name: "Nobody's", ownerCode: "", plan }), "theirs");
  assert.equal(gate({ name: "Planless", ownerCode: "Germany" }), "plan");
  assert.equal(gate({ name: "Third", ownerCode: "Italy", plan }), "", "Italy may run a third");
  assert.equal(AI_OPEN_PER_COUNTRY_MOST, 3);
  assert.equal(gate({ name: "Fourth", ownerCode: "Italy", plan }), "cap", "but not a fourth");
  const busy = worldProjectGate({ board: [], players: ["France"] });
  const answers = Array.from({ length: SKIP_CREATES_MOST + 2 }, (_, index) => busy({ name: `P${index}`, ownerCode: `Country ${index}`, plan }));
  assert.deepEqual(answers.filter((answer) => answer === "").length, SKIP_CREATES_MOST, "a skip opens so many at most");
  // A shared game's other players are people too.
  assert.equal(worldProjectGate({ board: [], players: ["France", "Spain"] })({ name: "S", ownerCode: "Spain", plan }), "theirs");
});

// ---- a board from before the engine -----------------------------------------------------
//
// Trimmed from a real Italy campaign (round 130): programmes that sat at 52% for
// weeks while their text said "testing advances", programmes targeted at 2031 to
// 2033 that had opened and closed inside a week, and a board of completions that
// changed nothing.
const ITALY_BOARD = [
  { id: "project-a1", name: "Tempest Fighter Programme", ownerCode: "", status: "active", priority: "high", progress: 52, startedAt: "2026-02-10", targetDate: "2031-06-30", lastUpdate: "Prototype testing advances.", milestones: [{ title: "Design freeze", date: "2026-09-01", status: "done" }, { title: "First flight", date: "2028-03-01", status: "pending" }, { title: "Initial operating capability", date: "2031-01-01", status: "pending" }] },
  { id: "project-a2", name: "Strait of Messina Bridge", ownerCode: "", status: "stalled", priority: "normal", progress: 52, startedAt: "2026-01-15", targetDate: "2032-12-31", lastUpdate: "Testing advances on the foundations." },
  { id: "project-a3", name: "Mediterranean Cable Initiative", ownerCode: "", status: "complete", priority: "normal", progress: 100, startedAt: "2026-03-01", targetDate: "2033-01-01" },
  { id: "project-a4", name: "Naval Drone Squadron", ownerCode: "", status: "paused", priority: "high", progress: 18, startedAt: "2026-02-01" },
  { id: "project-a5", name: "French Rafale Upgrade", ownerCode: "France", status: "proposed", progress: 0, startedAt: "2026-03-10", targetDate: "2027-03-10" },
  { id: "project-a6", name: "Annex the Ticino", ownerCode: "", status: "active", priority: "low", progress: 70, startedAt: "2026-01-01", targetDate: "2026-12-31", onComplete: { regionTransfers: [{ regionId: "region: Ticino", toCode: "Italy" }] } },
];

test("a save from before the engine takes up where it stood: its span, nothing a month, its progress kept, its priority its funding", () => {
  const plans = ITALY_BOARD.map((entry) => legacyPlanFor(entry));
  assert.ok(plans.every((plan) => plan && plan.legacy === true && plan.monthlyCost === 0 && plan.effects.length === 0));
  assert.equal(plans[0].durationDays, 1966, "from its start to its target date");
  assert.equal(plans[3].durationDays, 365, "a year where it had no target date");
  const tempest = plans[0].milestones;
  assert.deepEqual(tempest.map((milestone) => [milestone.title, Boolean(milestone.reached)]), [["Design freeze", true], ["First flight", false], ["Initial operating capability", false]]);
  assert.ok(tempest[1].atProgress > 52 && tempest[2].atProgress > tempest[1].atProgress, "what is still ahead lies ahead of where it stands, in order");
  // And then it moves: a year of the clock moves the stuck 52% programme.
  const board = ITALY_BOARD.map((entry) => ({ ...entry, plan: legacyPlanFor(entry), funding: { high: "high", low: "low" }[entry.priority] ?? "normal", adjustments: [] }));
  const { projects, outcomes } = tickProjects({ projects: board, world: world({ Italy: SHEET }), fromDate: "2027-01-01", toDate: "2028-01-01", host: "Italy", round: 131 });
  assert.ok(projects[0].progress > 52 + 18, `the fighter moves: ${projects[0].progress}`);
  assert.equal(outcomes.filter((outcome) => outcome.type === "milestone" && outcome.project === "Tempest Fighter Programme").length >= 0, true);
  assert.equal(projects[2].status, "complete", "a finished entry stays finished");
  assert.equal(projects[2].progress, 100);
});
