import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeProjects,
  normalizeWorldState,
  applyProjectOps,
  applyProjectOpsToWorld,
  PROJECT_BOARD_LIMIT,
} from "./gameState.js";
import { ownerMeans, tickProjects } from "./projectEngine.js";
import { sameName } from "../../server/nameKey.js";

const PLAN = { durationDays: 100, monthlyCost: 2000, milestones: [], effects: [] };
const SHEET = { stability: 50, economy: { gdp: 1_200_000, budgetBalance: 0, publicDebt: 0, gdpGrowth: 0 } };
const project = (id, name, ownerCode, extra = {}) => ({
  id, name, ownerCode, status: "active", funding: "normal",
  summary: "Original description", secrecy: "public", plan: PLAN,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...extra,
});

test("different polities retain same-name projects and their distinct stable IDs", () => {
  const rows = normalizeProjects([
    project("fr", "Hospitals", "France"),
    project("de", "Hospitals", "Germany"),
  ]);
  assert.deepEqual(rows.map((row) => [row.id, row.ownerCode]), [["fr", "France"], ["de", "Germany"]]);
});

test("distinct IDs within one polity are never silently deduplicated by project title", () => {
  const rows = normalizeProjects([
    project("fr-1", "Public Works", "France"),
    project("fr-2", "Public Works", "France"),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["fr-1", "fr-2"]);
});

test("a French project create cannot rewrite an existing German project with the same name", () => {
  const world = normalizeWorldState({
    countryStats: { France: structuredClone(SHEET), Germany: structuredClone(SHEET) },
    projects: [project("german-hospitals", "Hospitals", "Germany")],
  });
  const actual = applyProjectOpsToWorld({
    world, actor: "player", playerCountry: "France", date: "2041-05-01",
    ops: [{ op: "create", name: "Hospitals", ownerCode: "France", summary: "French hospitals", plan: PLAN }],
  });
  assert.equal(actual.world.projects.length, 2);
  const german = actual.world.projects.find((row) => row.id === "german-hospitals");
  assert.equal(german.ownerCode, "Germany");
  assert.equal(german.summary, "Original description");
  const french = actual.world.projects.find((row) => row.ownerCode === "France");
  assert.equal(french?.summary, "French hospitals");
});

test("same-owner create still restates a running project instead of creating a duplicate", () => {
  const current = project("fr", "Hospitals", "France");
  const rows = applyProjectOps([current], [{
    op: "create", name: "Hospitals", ownerCode: "France", summary: "Updated French hospitals",
  }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "fr");
  assert.equal(rows[0].summary, "Updated French hospitals");
});

test("ambiguous name-only updates do not modify an arbitrary polity's project", () => {
  const rows = applyProjectOps([
    project("fr", "Hospitals", "France"),
    project("de", "Hospitals", "Germany"),
  ], [{ op: "update", name: "Hospitals", lastUpdate: "Unscoped change" }]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.lastUpdate !== "Unscoped change"));
  const targeted = applyProjectOps(rows, [{ op: "update", projectId: "de", name: "Hospitals", lastUpdate: "Authorized by ID" }]);
  assert.equal(targeted.find((row) => row.id === "de")?.lastUpdate, "Authorized by ID");
  assert.notEqual(targeted.find((row) => row.id === "fr")?.lastUpdate, "Authorized by ID");
});

test("alias-equivalent country names share one deterministic project budget", () => {
  const official = "Côte d'Ivoire";
  const alias = "Cote d Ivoire";
  assert.equal(sameName(official, alias), true);
  const board = [project("a", "Roads", official), project("b", "Schools", alias)];
  const world = { countryStats: { [official]: structuredClone(SHEET) } };
  const means = ownerMeans(world, official, board);
  assert.ok(Math.abs(means.budget - 2000) < 0.01);
  assert.ok(Math.abs(means.committed - 4000) < 0.01);
  const tick = tickProjects({ projects: board, world, host: official, fromDate: "2041-05-01", toDate: "2041-05-31" });
  const total = tick.projects.reduce((sum, row) => sum + row.spent, 0);
  assert.ok(total <= means.budget + 0.5, `spent ${total} on budget ${means.budget}`);
  assert.ok(tick.projects.every((row) => row.paidShare <= 0.51));
});

test("full active project board refuses a new create without losing an existing project", () => {
  const rows = Array.from({ length: PROJECT_BOARD_LIMIT }, (_, index) =>
    project(`existing-${index}`, `Public Works ${index}`, "France"));
  const world = normalizeWorldState({ projects: rows, countryStats: { France: structuredClone(SHEET) } });
  const actual = applyProjectOpsToWorld({
    world, actor: "player", playerCountry: "France", date: "2041-05-01",
    ops: [{ op: "create", name: "Public Works Overflow", ownerCode: "France", plan: PLAN }],
  });
  assert.equal(actual.world.projects.length, PROJECT_BOARD_LIMIT);
  assert.equal(actual.refusedProjectIds.length, 1);
  assert.deepEqual(actual.world.projects.map((row) => row.id), world.projects.map((row) => row.id));
  assert.equal(normalizeWorldState(actual.world).projects.length, PROJECT_BOARD_LIMIT);
});

test("player can deliberately change secrecy on their own running project, not a foreign one", () => {
  const world = normalizeWorldState({
    projects: [project("fr", "Domestic Lab", "France"), project("de", "Foreign Lab", "Germany")],
    countryStats: { France: structuredClone(SHEET), Germany: structuredClone(SHEET) },
  });
  const actual = applyProjectOpsToWorld({
    world, actor: "player", playerCountry: "France",
    ops: [
      { op: "update", projectId: "fr", name: "Domestic Lab", secrecy: "covert" },
      { op: "update", projectId: "de", name: "Foreign Lab", secrecy: "covert" },
    ],
  });
  assert.equal(actual.world.projects.find((row) => row.id === "fr").secrecy, "covert");
  assert.equal(actual.world.projects.find((row) => row.id === "de").secrecy, "public");
  assert.ok(actual.refusedProjectIds.includes("de"));
});

test("a create cannot spoof an existing foreign stable project ID", () => {
  const world = normalizeWorldState({ projects: [project("de-id", "German Hospitals", "Germany")] });
  const actual = applyProjectOpsToWorld({
    world, actor: "player", playerCountry: "France",
    ops: [{ op: "create", id: "de-id", name: "French Hospitals", ownerCode: "France", plan: PLAN }],
  });
  assert.equal(actual.world.projects.length, 1);
  assert.equal(actual.world.projects[0].name, "German Hospitals");
  assert.ok(actual.refusedProjectIds.length > 0);
});

test("a third name-only create is refused when one owner already has two entries with that title", () => {
  const world = normalizeWorldState({
    projects: [project("fr-1", "Roads", "France"), project("fr-2", "Roads", "France")],
  });
  const actual = applyProjectOpsToWorld({
    world, actor: "player", playerCountry: "France",
    ops: [{ op: "create", name: "Roads", ownerCode: "France", plan: PLAN }],
  });
  assert.equal(actual.world.projects.length, 2);
  assert.ok(actual.refusedProjectIds.length > 0);
});

test("authorized secrecy edits cannot carry unrelated description modifications", () => {
  const world = normalizeWorldState({ projects: [project("fr", "Private Work", "France")] });
  const actual = applyProjectOpsToWorld({
    world, actor: "player", playerCountry: "France",
    ops: [{ op: "update", projectId: "fr", name: "Private Work", secrecy: "covert", summary: "Smuggled description" }],
  });
  assert.equal(actual.world.projects[0].secrecy, "covert");
  assert.equal(actual.world.projects[0].summary, "Original description");
});
