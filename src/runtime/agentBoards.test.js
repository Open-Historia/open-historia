/*! Open Historia — every government's Projects board in step with its agents: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/agentBoards.test.js
//
// The skip's board passes as gameplay.js runs them: the other players' work
// lent to the game's board at the skip's read (seatBoards.js withBoardsLent),
// every service's passes (syncBoardsWithAgents), home in the turn's commit
// (withBoardsHome), and what each player's view then shows (projection.js).

import test from "node:test";
import assert from "node:assert/strict";

import { syncBoardsWithAgents } from "./agentBoards.js";
import { withBoardsHome, withBoardsLent } from "./seatBoards.js";
import { normalizeWorldState } from "./gameState.js";
import { spymastersOf } from "./spycraft.js";
import { setHostingSharedGame } from "./humanPolities.js";
import { projectForViewer } from "../multiplayer/host/projection.js";

const plan = { durationDays: 365, monthlyCost: 1, milestones: [], effects: [], yields: [] };
const DATE = "1936-02-01";
const view = (world, game, viewer) => projectForViewer({ world, game, events: [], chat: [], actions: [], intercepts: {}, colors: {}, flags: {}, advisor: [] }, viewer);

// The round as the engine runs it, for the board passes.
const round = (world, game) => {
  const lent = withBoardsLent({ world, game });
  const synced = syncBoardsWithAgents(lent.world, { spymasters: spymastersOf(game), host: game.country, date: DATE, round: 3 });
  return { ...synced, world: withBoardsHome(synced.world, { before: lent.world, game }) };
};

const shared = (fn) => () => {
  setHostingSharedGame(true, { host: "Germany" });
  try {
    fn();
  } finally {
    setHostingSharedGame(false);
  }
};

// The review of 2026-11-18, views 1 (P0) and simulation 1: Germany hosts and
// France is a guest; Germany's agent in France falls under suspicion. France's
// own covert programme came home stalled for good, doubted, and tagged with the
// German agent's id, which told France of an agent its own service never found.
test("the host's agents never touch a guest's own work: they only learn of it, and only the host's view says so", shared(() => {
  const game = { country: "Germany", humanCountries: ["Germany", "France"], gameDate: DATE, round: 3 };
  const world = normalizeWorldState({
    spies: [{ id: "spy-germany-france-1", owner: "Germany", target: "France", status: "active", suspected: true, deployedAt: "1936-01-01" }],
    projects: [],
    seatBoards: { France: [{ id: "proj-fr-1", name: "Maginot Extension", kind: "construction", secrecy: "covert", status: "active", plan, ownerCode: "" }] },
  });
  const { world: after } = round(world, game);

  const france = view(after, game, "France");
  const mine = france.world.projects.find((row) => row.id === "proj-fr-1");
  assert.deepEqual(
    { status: mine.status, stallReason: mine.stallReason, verification: mine.verification, linkedSpyIds: mine.linkedSpyIds, knownBy: mine.knownBy },
    { status: "active", stallReason: "", verification: "", linkedSpyIds: [], knownBy: undefined },
    "France's own programme runs on as France runs it",
  );
  assert.equal(JSON.stringify(france).includes("spy-germany-france-1"), false, "and France is never told of the German agent");

  // What Germany's service knows is Germany's, kept on the work, which is at home.
  assert.equal(JSON.stringify(after).includes("lentFrom"), false, "nothing lent is written");
  assert.deepEqual(after.projects.map((row) => `${row.name}/${row.ownerCode}`), ["Agent in France/"], "the host's own agent, on the host's own board");
  assert.deepEqual(after.seatBoards.France[0].knownBy, { Germany: { spyIds: ["spy-germany-france-1"], verification: "doubted" } });
  const germany = view(after, game, "Germany");
  const file = germany.world.projects.find((row) => row.id === "proj-fr-1");
  assert.deepEqual([file.ownerCode, file.linkedSpyIds, file.verification, file.known, file.status], ["France", ["spy-germany-france-1"], "doubted", true, "active"]);
}));

test("in single player the player's suspected agent doubts an AI country's programme and no longer stops it", () => {
  const game = { country: "France", gameDate: DATE, round: 3 };
  const world = normalizeWorldState({
    spies: [{ id: "spy-france-germany-1", owner: "France", target: "Germany", status: "active", suspected: true }],
    // An AI country's own programme, which the projects engine runs.
    projects: [{ id: "de-1", name: "Autobahn Network", kind: "construction", secrecy: "public", status: "active", plan, ownerCode: "Germany" }],
  });
  const { world: after, ops, doubted } = round(world, game);
  const autobahn = after.projects.find((row) => row.id === "de-1");
  assert.deepEqual([autobahn.status, autobahn.stallReason, autobahn.verification, autobahn.linkedSpyIds], ["active", "", "doubted", ["spy-france-germany-1"]]);
  assert.equal("knownBy" in autobahn, false, "single player's board keeps what its player knows, as it always has");
  // And the player's agent stands on the player's board as its own operation.
  assert.ok(after.projects.some((row) => row.name === "Agent in Germany" && !row.ownerCode));
  assert.deepEqual([ops, doubted], [2, 1]);
});

test("a guest's service keeps its own board in step with its own agents, and learns of the work of the countries they are in", shared(() => {
  const game = { country: "Germany", humanCountries: ["Germany", "France"], gameDate: DATE, round: 3 };
  const world = normalizeWorldState({
    spies: [
      // Placed this round by an order the skip carried out: no entry yet.
      { id: "spy-fr-es", owner: "France", target: "Spain", status: "active", deployedAt: "1936-01-20" },
      // Caught this round: its operation is over.
      { id: "spy-fr-it", owner: "France", target: "Italy", status: "exposed", exposedAt: "1936-01-25" },
      // From before owners were kept: the host seat's, never a guest's.
      { id: "spy-old", owner: "", target: "Portugal", status: "active" },
    ],
    projects: [
      { id: "es-1", name: "Armada Rebuilding", kind: "project", secrecy: "covert", status: "active", plan, ownerCode: "Spain" },
      { id: "pt-1", name: "Lisbon Forts", kind: "project", secrecy: "covert", status: "active", plan, ownerCode: "Portugal" },
    ],
    seatBoards: { France: [{ id: "fr-agent-it", name: "Agent in Italy", kind: "operation", secrecy: "covert", status: "active", ownerCode: "", linkedSpyIds: ["spy-fr-it"], plan: { ...plan, ongoing: true, monthlyCost: 0 } }] },
  });
  const { world: after } = round(world, game);

  const board = after.seatBoards.France;
  assert.equal(board.find((row) => row.id === "fr-agent-it").status, "failed", "the caught agent's operation ends");
  const placed = board.find((row) => row.name === "Agent in Spain");
  assert.deepEqual([placed?.ownerCode, placed?.linkedSpyIds, placed?.status], ["", ["spy-fr-es"], "active"], "the new agent stands on France's own board");
  assert.equal(board.some((row) => row.name === "Agent in Portugal"), false);
  assert.equal(after.projects.some((row) => /^Agent in/.test(row.name)), true, "the host's own old agent stands on the host's board");
  assert.equal(after.projects.some((row) => row.name === "Agent in Spain"), false, "and never France's");

  // Spain's covert work, which France's agent is in a position to see.
  const armada = after.projects.find((row) => row.id === "es-1");
  assert.deepEqual(armada.knownBy, { France: { spyIds: ["spy-fr-es"] } });
  assert.deepEqual(armada.linkedSpyIds, [], "the host's own file on it says nothing of France's agent");
  const france = view(after, game, "France");
  assert.deepEqual(france.world.projects.filter((row) => row.ownerCode).map((row) => [row.id, row.ownerCode, row.known]), [["es-1", "Spain", true]], "what France's service has learned abroad, and nothing else of Spain's or Portugal's");
  const germany = view(after, game, "Germany");
  const theirs = germany.world.projects.find((row) => row.id === "es-1");
  assert.equal("knownBy" in theirs, false, "nor does the host's view carry what France knows");
  assert.equal(JSON.stringify(germany).includes("spy-fr-es"), false);
}));

test("every player sees the work nobody hides: a guest the AI's and the host's, the host a guest's", shared(() => {
  const game = { country: "Germany", humanCountries: ["Germany", "France"], gameDate: DATE, round: 3 };
  const world = normalizeWorldState({
    projects: [
      { id: "de-1", name: "Westwall", secrecy: "public", status: "active", plan, ownerCode: "" },
      { id: "de-2", name: "Uranverein", secrecy: "covert", status: "active", plan, ownerCode: "" },
      { id: "it-1", name: "Alpine Wall", secrecy: "public", status: "active", plan, ownerCode: "Italy" },
    ],
    seatBoards: { France: [{ id: "fr-1", name: "Maginot Extension", secrecy: "public", status: "active", plan, ownerCode: "" }, { id: "fr-2", name: "Bureau Noir", secrecy: "covert", status: "active", plan, ownerCode: "" }] },
  });
  const ids = (viewer) => view(world, game, viewer).world.projects.map((row) => `${row.id}/${row.ownerCode}`);
  assert.deepEqual(ids("France"), ["fr-1/", "fr-2/", "de-1/Germany", "it-1/Italy"]);
  assert.deepEqual(ids("Germany"), ["de-1/", "de-2/", "it-1/Italy", "fr-1/France"]);
}));

// ---- the verdict on a doubt, and what was planted --------------------------------
// The follow-ups of 2026-11-18: the doubted-entry settlement was the host's alone,
// asked of the model, which was told to fail what it refuted (an AI country's real
// work); and a programme opened from a turned agent's planted material became that
// country's real work, which ran to completion. Each service's doubts are settled
// here, from its own agents' reports, and a planted programme is its belief.

const filedFrom = (target, planted) => ({ [target]: { gatheredAt: DATE, round: 3, planted, exchanges: [{ counterpart: "Portugal", subject: "trade", messages: [{ speaker: target, text: "x" }] }] } });
const turn = (world, game, { intercepts = {}, opened = [] } = {}) => {
  const lent = withBoardsLent({ world, game });
  const synced = syncBoardsWithAgents(lent.world, { spymasters: spymastersOf(game), host: game.country, date: DATE, round: 3, intercepts });
  // What the skip's board pass opened, after the passes (gameplay.js applySimulationResult).
  const skipped = opened.length ? { ...synced.world, projects: [...synced.world.projects, ...opened] } : synced.world;
  return withBoardsHome(skipped, { before: lent.world, game });
};

test("a guest's planted programme is its own service's belief, doubted with its agent, refuted by a clean one, and never anyone's work", shared(() => {
  const game = { country: "Germany", humanCountries: ["Germany", "France"], gameDate: DATE, round: 3 };
  const spain = (spies) => normalizeWorldState({ spies, projects: [{ id: "es-1", name: "Armada Rebuilding", secrecy: "covert", status: "active", plan, ownerCode: "Spain" }], seatBoards: {} });
  const turned = { id: "spy-fr-es-1", owner: "France", target: "Spain", status: "turned", turnedAt: "1936-01-10", deployedAt: "1936-01-01" };
  // The skip opens, from what Spain fed France's agent, a fleet that does not exist.
  const opened = [{ id: "b-1", name: "Spanish Phantom Fleet", kind: "project", secrecy: "covert", status: "active", plan, ownerCode: "Spain", believedBy: "France" }];
  let world = turn(spain([turned]), game, { opened });
  const phantom = () => world.seatBoards.France.find((row) => row.id === "b-1");
  assert.deepEqual([phantom().belief, phantom().linkedSpyIds, phantom().verification || ""], [true, ["spy-fr-es-1"], ""]);
  assert.equal(world.projects.some((row) => row.id === "b-1"), false, "never Spain's work on the game's board");
  const france = view(world, game, "France").world.projects.find((row) => row.id === "b-1");
  assert.deepEqual([france.ownerCode, france.linkedSpyIds, "belief" in france], ["Spain", ["spy-fr-es-1"], false], "France sees what its service believes, and nothing says it was planted");
  assert.equal(view(world, game, "Germany").world.projects.some((row) => row.id === "b-1"), false);

  // France's analysts come to suspect the agent: what it sent is doubted.
  world = turn({ ...world, spies: [{ ...turned, suspected: true }] }, game);
  assert.equal(phantom().verification, "doubted");
  assert.equal(world.projects.find((row) => row.id === "es-1").knownBy.France.verification, "doubted", "and so is what it told of Spain's real work");

  // A fresh agent, once it has filed clean material, settles both.
  const fresh = [{ ...turned, status: "recalled", suspected: true }, { id: "spy-fr-es-2", owner: "France", target: "Spain", status: "active", deployedAt: "1936-03-01" }];
  const stillPlanted = turn({ ...world, spies: fresh }, game, { intercepts: { "@seats": { France: filedFrom("Spain", true) } } });
  assert.equal(stillPlanted.seatBoards.France.find((row) => row.id === "b-1").verification, "doubted", "nothing clean filed yet");
  world = turn({ ...world, spies: fresh }, game, { intercepts: { "@seats": { France: filedFrom("Spain", false) } } });
  assert.deepEqual([phantom().verification, phantom().status], ["refuted", "failed"]);
  const armada = world.projects.find((row) => row.id === "es-1");
  assert.deepEqual([armada.knownBy.France.verification, armada.status, armada.verification], ["confirmed", "active", ""], "Spain's real work is confirmed, runs on, and is no verdict of the host's");
  // The host's own table settles nothing of France's.
  const hostsOnly = turn({ ...world, spies: fresh }, game, { intercepts: filedFrom("Spain", false) });
  assert.equal(hostsOnly.seatBoards.France.find((row) => row.id === "b-1").verification, "refuted");
}));

test("in single player a planted programme is the player's belief, refuted and closed once a clean agent reports, and real work confirmed", () => {
  const game = { country: "France", gameDate: DATE, round: 3 };
  const spies = [
    { id: "spy-fr-de-1", owner: "France", target: "Germany", status: "recalled", turnedAt: "1936-01-10", suspected: true },
    { id: "spy-fr-de-2", owner: "France", target: "Germany", status: "active" },
  ];
  const world = normalizeWorldState({
    spies,
    projects: [
      { id: "de-1", name: "Autobahn Network", secrecy: "public", status: "active", plan, ownerCode: "Germany", linkedSpyIds: ["spy-fr-de-1"], verification: "doubted" },
      { id: "b-1", name: "German Moon Gun", secrecy: "covert", status: "active", plan, ownerCode: "Germany", belief: true, linkedSpyIds: ["spy-fr-de-1"], verification: "doubted" },
    ],
  });
  const after = turn(world, game, { intercepts: filedFrom("Germany", false) });
  const [autobahn, gun] = ["de-1", "b-1"].map((id) => after.projects.find((row) => row.id === id));
  assert.deepEqual([autobahn.verification, autobahn.status], ["confirmed", "active"]);
  assert.deepEqual([gun.verification, gun.status, gun.belief], ["refuted", "failed", true]);
});
