/*! Open Historia — in-place closed Projects archival regression; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { PROJECT_BOARD_LIMIT, applyProjectOpsToWorld, normalizeWorldState } from "./gameState.js";
import { archiveClosedProjectsInWorld, restoreArchivedProjectInWorld } from "./projectRecovery.js";

const project = (index, status, extra = {}) => ({
  id: `nate-${index}`, name: `Reconstruction ${index}`,
  status, ownerCode: "United Socialist States", progress: status === "active" ? 12 : 100,
  ...(status === "complete" ? { effectsAppliedAt: "1962-12-31", onCompleteAppliedAt: "1962-12-31" } : {}),
  provenance: { lossless: `source-${index}` },
  ...extra,
});
const nateShape = () => ({
  ownerSchema: 4,
  projects: Array.from({ length: PROJECT_BOARD_LIMIT }, (_, i) =>
    project(i, i < 73 ? "complete" : i < 77 ? "cancelled" : i < 81 ? "failed" : "active")),
  seatBoards: { Germany: [project(1000, "active", { id: "g-1000", ownerCode: "Germany" })] },
  events: [{ id: "historical-event" }],
  countryStats: { "United Socialist States": { economy: { gdp: 1234 } } },
});

test("Nate's 120-slot shape: explicit archive frees 81 slots, preserves every ID and raw record", () => {
  const source = nateShape();
  const before = structuredClone(source);
  const next = archiveClosedProjectsInWorld(source, { date: "1963-01-01" });
  assert.equal(next.projects.length, 39);
  assert.equal(next.projectRecoveryArchive.length, 81);
  assert.deepEqual(new Set([...next.projects.map(p => p.id), ...next.projectRecoveryArchive.map(p => p.id)]),
    new Set(source.projects.map(p => p.id)));
  assert.ok(next.projects.every(p => p.status === "active"));
  assert.deepEqual(next.projectRecoveryArchive[0].project, source.projects[0]);
  assert.equal(next.projectRecoveryArchive[0].shelvedAt, "1963-01-01");
  assert.equal(next.projectRecoveryArchive[0].priorStatus, "complete");
  assert.equal(next.projectRecoveryArchive[0].board, "world");
  assert.equal(next.projectRecoveryArchive[0].project.effectsAppliedAt, "1962-12-31");
  assert.deepEqual(next.countryStats, source.countryStats);
  assert.deepEqual(next.seatBoards, source.seatBoards);
  assert.deepEqual(source, before, "source campaign state is never mutated");
  assert.equal(normalizeWorldState(next).projectRecoveryArchive.length, 81);
});

test("the recovered live board admits new work without recycling archived IDs", () => {
  const archived = archiveClosedProjectsInWorld(nateShape(), { date: "1963-01-01" });
  const applied = applyProjectOpsToWorld({
    actor: "player", date: "1963-01-01", round: 23, playerCountry: "United Socialist States",
    world: archived,
    ops: [{ op: "create", project: { id: "brand-new", name: "New Nuclear Power Plant", ownerCode: "United Socialist States" } }],
  });
  assert.deepEqual(applied.refusedProjectIds, []);
  assert.equal(applied.world.projects.length, 40);
  assert.equal(applied.world.projectRecoveryArchive.length, 81);
  assert.ok(applied.world.projects.some(p => p.id === "brand-new"));
});

test("restore returns one archived record to the same live board without mutating historical effects", () => {
  const archived = archiveClosedProjectsInWorld(nateShape(), { date: "1963-01-01" });
  const before = structuredClone(archived);
  const next = restoreArchivedProjectInWorld(archived, { projectId: "nate-0", date: "1963-01-01" });
  assert.equal(next.projects.length, 40);
  assert.equal(next.projectRecoveryArchive.length, 80);
  assert.equal(next.projects.at(-1).id, "nate-0");
  assert.equal(next.projects.at(-1).effectsAppliedAt, "1962-12-31");
  assert.equal(next.projects.at(-1).onCompleteAppliedAt, "1962-12-31");
  assert.deepEqual(archived, before);
});

test("archival fails closed for no closed work, over-cap archive, invalid IDs and loan manifests", () => {
  assert.throws(() => archiveClosedProjectsInWorld({ projects: [project(1, "active")] }), /no closed/i);
  const full = { projects: [project(1, "complete")], projectRecoveryArchive: Array.from({ length: 512 }, (_, i) => ({
    id: `archived-${i}`, board: "world", project: project(i, "complete", { id: `archived-${i}` }),
  })) };
  assert.throws(() => archiveClosedProjectsInWorld(full), /archive capacity|512/i);
  const world = nateShape();
  assert.throws(() => archiveClosedProjectsInWorld({ ...world, projectSeatLoans: { borrowed: "Germany" } }), /loan|lending/i);
  assert.throws(() => restoreArchivedProjectInWorld(world, { projectId: "nate-0" }), /archived|shelved/i);
  const archived = archiveClosedProjectsInWorld(world);
  assert.throws(() => restoreArchivedProjectInWorld(archived, { projectId: "not-a-project" }), /archived|shelved/i);
  const crowded = { ...archived, projects: Array.from({ length: 120 }, (_, i) => project(i+2000,"active")) };
  assert.throws(() => restoreArchivedProjectInWorld(crowded, { projectId: "nate-0" }), /limit 120/i);
});
