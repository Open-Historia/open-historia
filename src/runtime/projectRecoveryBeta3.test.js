/*! Open Historia — Projects recovery invariants; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorldState, PROJECT_BOARD_LIMIT } from "./gameState.js";
import { canCopyProjectRecoverySnapshots, inspectProjectRecovery, prepareProjectRecoveryBundle } from "./projectRecovery.js";

const entry = (index, extra = {}) => ({
  id: `p${index}`, name: `Port ${index}`, ownerCode: "France",
  status: "active", progress: index, spent: index * 3,
  secrecy: index === 80 ? "covert" : "public", historicalField: { arbitrary: index },
  ...extra,
});
const bundle = (world) => ({
  schema: "open-historia-game-bundle/1",
  game: { name: "Historical Test", createdAt: "2010-01-01T00:00:00Z" },
  scenarioRef: { scenarioId: "historical", missing: false },
  data: { world, game: { gameDate: "1936-01-01" }, actions: [{ id: "a" }] },
});
const overflowing = () => bundle({ projects: Array.from({ length: 121 }, (_, i) => entry(i)), notes: "keep this", countryStats: { France: { economy: { gdp: 0 } } } });

test("inspection finds every active over-cap entry without discarding or modifying source", () => {
  const source = overflowing();
  const snapshot = structuredClone(source);
  const inspected = inspectProjectRecovery(source.data.world);
  assert.equal(inspected.required, 1);
  assert.equal(inspected.boards[0].rows.length, 121);
  assert.equal(inspected.boards[0].rows.filter((row) => row.open).length, 121);
  assert.deepEqual(source, snapshot);
});

test("one explicitly selected live project is shelved in a recovered COPY with all source fields", () => {
  const source = overflowing();
  const selected = inspectProjectRecovery(source.data.world).boards[0].rows[80];
  const repaired = prepareProjectRecoveryBundle(source, { shelve: [selected.token] });
  assert.equal(repaired.data.world.projects.length, PROJECT_BOARD_LIMIT);
  assert.equal(repaired.data.world.projectRecoveryArchive.length, 1);
  const archived = repaired.data.world.projectRecoveryArchive[0];
  assert.equal(archived.id, "p80");
  assert.equal(archived.priorStatus, "active");
  assert.equal(archived.board, "world");
  assert.equal(archived.shelvedAt, "1936-01-01");
  assert.deepEqual(archived.project, source.data.world.projects[80], "all historical and secret fields survive");
  assert.ok(!repaired.data.world.projects.some((project) => project.id === "p80"));
  assert.equal(repaired.data.world.projects.filter((project) => project.status === "active").length, 120);
  assert.equal(repaired.data.world.countryStats.France.economy.gdp, 0);
  assert.equal(repaired.data.world.notes, "keep this");
  assert.deepEqual(repaired.data.actions, source.data.actions);
  assert.equal(repaired.data.game.gameDate, source.data.game.gameDate);
  assert.equal(source.data.world.projects.length, 121, "original save remains intact");
  assert.equal(source.data.world.projectRecoveryArchive, undefined);
  assert.equal(normalizeWorldState(repaired.data.world).projectRecoveryArchive[0].id, "p80");
});

test("explicit selection is required; an over-cap board never silently archives a running project", () => {
  const source = overflowing();
  assert.throws(() => prepareProjectRecoveryBundle(source), /Choose Projects/);
  const selected = inspectProjectRecovery(source.data.world).boards[0].rows;
  assert.throws(() => prepareProjectRecoveryBundle(source, { shelve: [] }), /Choose Projects/);
  assert.throws(() => prepareProjectRecoveryBundle(source, { shelve: [selected[0].token, selected[0].token] }), /duplicate shelving/);
  assert.throws(() => prepareProjectRecoveryBundle(source, { shelve: ['["world",999]'] }), /no longer exists/);
});

test("closed work can be explicitly chosen first without stopping any ongoing activity", () => {
  const source = overflowing();
  source.data.world.projects[120].status = "complete";
  const token = inspectProjectRecovery(source.data.world).boards[0].rows[120].token;
  const repaired = prepareProjectRecoveryBundle(source, { shelve: [token] });
  assert.equal(repaired.data.world.projectRecoveryArchive[0].priorStatus, "complete");
  assert.equal(repaired.data.world.projects.filter((project) => project.status === "active").length, 120);
});

test("shelved projects can be restored to their original board once a place is available", () => {
  const source = overflowing();
  const selected = inspectProjectRecovery(source.data.world).boards[0].rows[80];
  const first = prepareProjectRecoveryBundle(source, { shelve: [selected.token] });
  assert.throws(() => prepareProjectRecoveryBundle(first, { restore: ["p80"] }), /limit 120/);
  const later = structuredClone(first);
  later.data.world.projects.pop(); // simulated free board slot; ordinary game actions may close work but must remove it intentionally
  const restored = prepareProjectRecoveryBundle(later, { restore: ["p80"] });
  assert.equal(restored.data.world.projects.length, 120);
  assert.equal(restored.data.world.projectRecoveryArchive.length, 0);
  assert.deepEqual(restored.data.world.projects.at(-1), source.data.world.projects[80]);
  assert.equal(first.data.world.projectRecoveryArchive.length, 1, "source copy remains intact");
});

test("guest-board overflow can be repaired while preserving other country boards", () => {
  const source = bundle({
    projects: [entry(1000)],
    seatBoards: {
      Germany: Array.from({ length: 121 }, (_, index) => entry(index, { ownerCode: "Germany", id: `ger-${index}` })),
      Italy: [entry(300, { id: "italian" })],
    },
  });
  const inspected = inspectProjectRecovery(source.data.world);
  assert.equal(inspected.required, 1);
  const germany = inspected.boards.find((board) => board.key === "seat:Germany");
  const repaired = prepareProjectRecoveryBundle(source, { shelve: [germany.rows[9].token] });
  assert.equal(repaired.data.world.projects.length, 1);
  assert.equal(repaired.data.world.seatBoards.Germany.length, 120);
  assert.equal(repaired.data.world.seatBoards.Italy[0].id, "italian");
  assert.equal(repaired.data.world.projectRecoveryArchive[0].board, "seat:Germany");
  assert.equal(normalizeWorldState(repaired.data.world).projectRecoveryArchive[0].board, "seat:Germany");
});

test("every oversize board must be repaired in the SAME new campaign", () => {
  const source = bundle({
    projects: Array.from({ length: 121 }, (_, i) => entry(i)),
    seatBoards: { Germany: Array.from({ length: 121 }, (_, i) => entry(i, { id: `g${i}`, ownerCode: "Germany" })) },
  });
  const inspected = inspectProjectRecovery(source.data.world);
  const host = inspected.boards.find((board) => board.key === "world").rows[0].token;
  const guest = inspected.boards.find((board) => board.key === "seat:Germany").rows[0].token;
  assert.throws(() => prepareProjectRecoveryBundle(source, { shelve: [host] }), /Germany.*limit 120|Germany.*Explicitly shelve/i);
  const recovered = prepareProjectRecoveryBundle(source, { shelve: [host, guest] });
  assert.equal(recovered.data.world.projects.length, 120);
  assert.equal(recovered.data.world.seatBoards.Germany.length, 120);
  assert.equal(recovered.data.world.projectRecoveryArchive.length, 2);
});

test("invalid recovery archives fail closed, including ID collisions or excessive archive size", () => {
  const source = overflowing();
  const raw = source.data.world.projects[0];
  source.data.world.projectRecoveryArchive = [{ id: raw.id, board: "world", project: raw }];
  assert.throws(() => inspectProjectRecovery(source.data.world), /duplicate project recovery archive identity/i);
  const second = overflowing();
  second.data.world.projectRecoveryArchive = Array.from({ length: 513 }, (_, i) => ({
    id: `archive-${i}`, board: "world", project: entry(i, { id: `archive-${i}` }),
  }));
  assert.throws(() => inspectProjectRecovery(second.data.world), /at most 512/);
});

test("idless legacy entries become individually restoreable and stable after explicit recovery", () => {
  const source = bundle({ projects: Array.from({ length: 121 }, () => ({
    name: "Road", ownerCode: "France", status: "active", summary: "Identical legacy project",
  })) });
  const found = inspectProjectRecovery(source.data.world);
  assert.equal(new Set(found.boards[0].rows.map((row) => row.id)).size, 121);
  const recovered = prepareProjectRecoveryBundle(source, { shelve: [found.boards[0].rows[30].token] });
  assert.equal(new Set(recovered.data.world.projects.map((row) => row.id)).size, 120);
  assert.equal(recovered.data.world.projectRecoveryArchive[0].id, found.boards[0].rows[30].id);
  assert.deepEqual(inspectProjectRecovery(recovered.data.world).boards[0].rows.map((row) => row.id),
    recovered.data.world.projects.map((row) => row.id));
});

test("a shelved covert record never appears in multiplayer world projections", async () => {
  const { projectWorld } = await import("../multiplayer/host/projection.js");
  const source = overflowing();
  const token = inspectProjectRecovery(source.data.world).boards[0].rows[80].token;
  const repaired = prepareProjectRecoveryBundle(source, { shelve: [token] });
  const ownerArchive = repaired.data.world.projectRecoveryArchive;
  assert.equal(ownerArchive[0].project.secrecy, "covert");
  for (const country of ["France", "Germany", "Italy"]) {
    const projected = projectWorld(repaired.data.world, country, { host: "France" });
    assert.equal(projected.projectRecoveryArchive, undefined, "private save-management data must not be sent");
  }
});

test("malformed source rows are not silently skipped or matched to the wrong index during recovery", () => {
  const source = overflowing();
  source.data.world.projects.splice(5, 0, { id: "unnamed-but-saved", progress: 7, hiddenData: "preserve this" });
  assert.throws(() => inspectProjectRecovery(source.data.world), /unrecognized project row|cannot safely recover/i);
  assert.equal(source.data.world.projects.length, 122, "raw source remains untouched");
});

test("a recovery archive preserves extra wrapper provenance during world normalization", () => {
  const source = overflowing();
  const token = inspectProjectRecovery(source.data.world).boards[0].rows[80].token;
  const repaired = prepareProjectRecoveryBundle(source, { shelve: [token] });
  repaired.data.world.projectRecoveryArchive[0].historicalReceipt = { testimony: "verbatim" };
  assert.deepEqual(
    normalizeWorldState(repaired.data.world).projectRecoveryArchive[0].historicalReceipt,
    { testimony: "verbatim" },
  );
});

test("recovery refuses an in-flight multiplayer loan manifest rather than making a half-returned clone", () => {
  const source = overflowing();
  source.data.world.projectSeatLoans = { borrowed: "Germany" };
  const token = inspectProjectRecovery(source.data.world).boards[0].rows[80].token;
  assert.throws(() => prepareProjectRecoveryBundle(source, { shelve: [token] }), /multiplayer project lending|in progress/i);
});

test("a full recovered board can swap one selected live record with one archived record atomically", () => {
  const source = overflowing();
  const firstToken = inspectProjectRecovery(source.data.world).boards[0].rows[80].token;
  const first = prepareProjectRecoveryBundle(source, { shelve: [firstToken] });
  const nextToken = inspectProjectRecovery(first.data.world).boards[0].rows[50].token;
  const swapped = prepareProjectRecoveryBundle(first, { shelve: [nextToken], restore: ["p80"] });
  assert.equal(swapped.data.world.projects.length, 120);
  assert.ok(swapped.data.world.projects.some((row) => row.id === "p80"));
  assert.ok(!swapped.data.world.projects.some((row) => row.id === "p50"));
  assert.deepEqual(swapped.data.world.projectRecoveryArchive.map((row) => row.id), ["p50"]);
  assert.equal(first.data.world.projectRecoveryArchive[0].id, "p80", "prior recovered copy remains unchanged");
});

test("old ownership schemas keep incompatible rollback history in the original, while current schemas can copy it", () => {
  assert.equal(canCopyProjectRecoverySnapshots({ ownerSchema: 4, projects: [] }), true);
  assert.equal(canCopyProjectRecoverySnapshots({ ownerSchema: 3, projects: [] }), false);
  assert.equal(canCopyProjectRecoverySnapshots({ projects: [] }), false);
  assert.equal(canCopyProjectRecoverySnapshots(null), false);
});
