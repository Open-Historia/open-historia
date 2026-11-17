/*! Open Historia — legacy Projects identity regression tests; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectEntry, normalizeProjects, normalizeWorldState } from "./gameState.js";

const base = { name: "Highway", ownerCode: "France", progress: 15, summary: "Initial road", startedAt: "1930-01-01" };

test("a legacy ID-less project has stable identity across repeated normalizations", () => {
  const first = normalizeProjectEntry(base);
  const second = normalizeProjectEntry(base);
  assert.ok(first.id);
  assert.equal(first.id, second.id);
  assert.equal(normalizeProjectEntry(first).id, first.id);
  assert.equal(normalizeProjects([base])[0].id, first.id);
});

test("distinct owner identities do not reuse an ID for the same title", () => {
  const names = normalizeProjects([
    { ...base, ownerCode: "France" },
    { ...base, ownerCode: "Germany" },
  ]);
  assert.equal(new Set(names.map((entry) => entry.id)).size, 2);
});

test("distinct legacy same-owner programmes survive normalization and reorder", () => {
  const left = { ...base, summary: "North road", startedAt: "1930-01-01" };
  const right = { ...base, summary: "South road", startedAt: "1932-01-01" };
  const first = normalizeProjects([left, right]);
  const second = normalizeProjects([right, left]);
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.equal(first.find((row) => row.summary === "North road").id,
    second.find((row) => row.summary === "North road").id);
  assert.equal(first.find((row) => row.summary === "South road").id,
    second.find((row) => row.summary === "South road").id);
});

test("two indistinguishable ID-less legacy entries receive distinct repeatable ordinals", () => {
  const both = [{ ...base }, { ...base }];
  const first = normalizeProjects(both);
  const second = normalizeProjects(both);
  assert.equal(first.length, 2);
  assert.equal(new Set(first.map((row) => row.id)).size, 2);
  assert.deepEqual(first.map((row) => row.id), second.map((row) => row.id));
});

test("existing explicit project IDs remain exactly as saved", () => {
  const row = normalizeProjectEntry({ ...base, id: "historical-explicit-id" });
  assert.equal(row.id, "historical-explicit-id");
});

test("legacy guest IDs have a seat-country namespace when ownerCode is blank", () => {
  const world = normalizeWorldState({
    projects: [{ ...base, ownerCode: "" }],
    seatBoards: {
      France: [{ ...base, ownerCode: "" }],
      Germany: [{ ...base, ownerCode: "" }],
    },
  });
  assert.equal(world.projects.length, 1);
  assert.equal(world.seatBoards.France.length, 1);
  assert.equal(world.seatBoards.Germany.length, 1);
  const ids = [world.projects[0].id, world.seatBoards.France[0].id, world.seatBoards.Germany[0].id];
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(normalizeWorldState(world).seatBoards, world.seatBoards);
});

test("legacy ID migration does not invent country statistics or alter explicit zero", () => {
  const world = normalizeWorldState({
    projects: [{ ...base }],
    countryStats: { France: { economy: { gdp: 0 } } },
  });
  assert.equal(world.countryStats.France.economy.gdp, 0);
  assert.equal(normalizeWorldState(world).projects[0].id, world.projects[0].id);
});

test("a host's guest-board write namespaces ID-less seat projects consistently with world normalization", async () => {
  const { withSeatBoard } = await import("../multiplayer/host/gameHost.js");
  const raw = [{ name: "Same-named local work", ownerCode: "", summary: "No established ID" }];
  const world = withSeatBoard({ projects: [] }, "Germany", raw, { host: "France" });
  assert.equal(world.seatBoards.Germany.length, 1);
  const normalized = normalizeWorldState(world);
  assert.equal(normalized.seatBoards.Germany[0].id, world.seatBoards.Germany[0].id);
  const french = withSeatBoard(normalized, "France", raw, { host: "France" });
  assert.notEqual(french.projects[0].id, french.seatBoards.Germany[0].id);
});

test("over-cap legacy records fail closed, rather than silently evicting live projects", () => {
  const entries = Array.from({ length: 121 }, (_, index) => ({
    id: `legacy-${index}`,
    name: `Legacy Project ${index}`,
    ownerCode: "France",
    status: "active",
  }));
  const original = structuredClone(entries);
  assert.throws(() => normalizeProjects(entries), /project board.*120.*121/i);
  assert.throws(() => normalizeWorldState({ projects: entries }), /project board.*120.*121/i);
  assert.deepEqual(entries, original, "no input record was mutated or destroyed");
});

test("full legacy guest boards also refuse data-losing normalization", () => {
  const entries = Array.from({ length: 121 }, (_, index) => ({
    id: `guest-${index}`, name: `Guest Project ${index}`, ownerCode: "", status: "active",
  }));
  assert.throws(() => normalizeWorldState({ seatBoards: { Germany: entries } }), /project board.*120.*121/i);
});

test("conflicting canonical IDs in an imported project board cannot silently overwrite a record", () => {
  const corrupted = [
    { id: "same", name: "Hospitals", ownerCode: "France", status: "active" },
    { id: "same", name: "Hospitals", ownerCode: "Germany", status: "active" },
  ];
  assert.throws(() => normalizeProjects(corrupted), (error) =>
    error?.code === "PROJECT_ID_COLLISION" && error.projectId === "same");
  assert.equal(corrupted.length, 2);
});

test("legacy normalization is a pure repeatable read and does not invent wall-clock timestamps", () => {
  const row = { name: "Old Wharf", ownerCode: "France", summary: "Older than this computer", progress: 80 };
  const first = normalizeProjectEntry(row);
  const again = normalizeProjectEntry(row);
  assert.deepEqual(first, again);
  assert.equal(first.createdAt, "");
  assert.equal(first.updatedAt, "");
  assert.deepEqual(normalizeWorldState({ projects: [row] }).projects, normalizeWorldState({ projects: [row] }).projects);
});

test("legacy IDs preserve non-Latin distinctions and canonical owner aliases", () => {
  const first = normalizeProjectEntry({ name: "Строительство", ownerCode: "Россия" });
  const second = normalizeProjectEntry({ name: "Здравоохранение", ownerCode: "Россия" });
  assert.notEqual(first.id, second.id, "Cyrillic titles must not collapse onto one empty Latin slug");
  const china = normalizeProjectEntry({ name: "建设", ownerCode: "中国" });
  const japan = normalizeProjectEntry({ name: "建设", ownerCode: "日本" });
  assert.notEqual(china.id, japan.id, "owner identity contributes to the project key");
  const accented = normalizeProjectEntry({ name: "Hospitals", ownerCode: "Côte d'Ivoire" });
  const unaccented = normalizeProjectEntry({ name: "Hospitals", ownerCode: "Cote d'Ivoire" });
  assert.equal(accented.id, unaccented.id, "canonical name-key aliases generate the same legacy ID");
});
