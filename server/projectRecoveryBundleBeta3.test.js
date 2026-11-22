/*! Open Historia — desktop recovered-campaign round-trip tests; AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const storeUrl = pathToFileURL(path.join(serverDir, "libraryStore.js")).href;
const recoveryUrl = pathToFileURL(path.resolve(serverDir, "../src/runtime/projectRecovery.js")).href;
const gameStateUrl = pathToFileURL(path.resolve(serverDir, "../src/runtime/gameState.js")).href;
const save = (filepath, value) => {
  mkdirSync(path.dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(value));
};

test("an exported 121-active save becomes a new, portable and reversible copy; original and snapshots remain", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-project-recovery-"));
  try {
    const scenario = path.join(root, "scenarios", "default");
    save(path.join(scenario, "scenario.json"), { id: "default", name: "Recovery Test", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    save(path.join(scenario, "world.json"), { ownerSchema: 4 });
    save(path.join(scenario, "game.json"), {});
    save(path.join(root, "scenario-manifest.json"), { order: ["default"], selectedScenarioId: "default", version: 2 });
    const game = path.join(root, "games", "original");
    save(path.join(game, "game-instance.json"), { id: "original", name: "Original", scenarioId: "default", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    save(path.join(game, "game.json"), { country: "France", round: 10, gameDate: "1936-01-01" });
    save(path.join(game, "world.json"), {
      ownerSchema: 4,
      projectFundingMode: "nonmonetary",
      projects: Array.from({ length: 121 }, (_, index) => ({
        id: `p${index}`, name: `Road ${index}`, ownerCode: "France", status: "active",
        progress: Math.min(index, 80), secrecy: index === 42 ? "covert" : "public",
        funding: "normal", plan: { durationDays: 365, monthlyCost: 0, effects: [] },
        originalPayload: { index, source: "legacy" },
      })),
      notes: "record retained",
    });
    for (const key of ["actions", "chat", "events", "advisor"]) save(path.join(game, "storage", `${key}.json`), []);
    save(path.join(game, "storage", "snapshots.json"), [{ round: 9, world: { note: "before recovery" } }]);
    save(path.join(root, "game-manifest.json"), { activeGameId: "original", order: ["original"], version: 2 });

    const script = `
      const store = await import(${JSON.stringify(storeUrl)});
      const recovery = await import(${JSON.stringify(recoveryUrl)});
      const state = await import(${JSON.stringify(gameStateUrl)});
      const source = store.exportGameBundle("original");
      const before = JSON.stringify(source.data.world);
      const inspected = recovery.inspectProjectRecovery(source.data.world);
      const chosen = inspected.boards[0].rows[42].token;
      const newBundle = recovery.prepareProjectRecoveryBundle(source, { shelve: [chosen] });
      const snapshots = store.readGameSnapshots("original");
      const imported = store.importGameBundle(newBundle);
      store.writeGameSnapshots(imported.game.id, snapshots);
      const sourceAfter = store.exportGameBundle("original");
      const recovered = store.exportGameBundle(imported.game.id);
      const persistedArchive = recovered.data.world.projectRecoveryArchive;
      const activeId = store.getGameCatalog().activeGameId;
      // Real native project clock, then actual desktop runtime asset write
      // and disk re-read. A shelved project must never tick while the 120
      // surviving live projects advance in the recovered game.
      const activeBefore = state.normalizeWorldState(recovered.data.world);
      const afterTurn = state.advanceProjectsInWorld({
        baseWorld: activeBefore, world: activeBefore,
        fromDate: "1936-01-01", toDate: "1936-02-01", host: "France", round: 11,
      });
      store.setActiveGame(imported.game.id);
      store.writeRuntimeJsonAsset("world", afterTurn.world);
      const persistedAfterRound = store.exportGameBundle(imported.game.id);
      const progressBefore = activeBefore.projects.find((p) => p.id === "p20").progress;
      const progressAfter = persistedAfterRound.data.world.projects.find((p) => p.id === "p20").progress;
      const untouchedArchive = JSON.stringify(persistedAfterRound.data.world.projectRecoveryArchive) === JSON.stringify(persistedArchive);
      // A full board can swap an archived project back in only by shelving
      // another named record; create yet another independent campaign.
      const toShelve = recovery.inspectProjectRecovery(persistedAfterRound.data.world).boards[0].rows.find((r) => r.id === "p50").token;
      const swappedBundle = recovery.prepareProjectRecoveryBundle(persistedAfterRound, { shelve: [toShelve], restore: ["p42"] });
      const swapped = store.importGameBundle(swappedBundle);
      const swappedWorld = store.exportGameBundle(swapped.game.id).data.world;
      const sourceAfterTick = store.exportGameBundle("original");
      const originalActive = sourceAfter.data.world.projects.length;
      const recoveredActive = recovered.data.world.projects.length;
      process.stdout.write("\\n@@" + JSON.stringify({
        originalUnchanged: JSON.stringify(sourceAfter.data.world) === before,
        originalActive, recoveredActive, activeId,
        recoveredId: imported.game.id, sourceId: "original",
        archive: persistedArchive,
        snapshots: store.readGameSnapshots(imported.game.id),
        exportedRoundTrip: JSON.stringify(recovered.data.world) === JSON.stringify(newBundle.data.world),
        progressed: progressAfter > progressBefore,
        persistedAfterRound: persistedAfterRound.data.world.projects.length === 120,
        archiveUnchangedOnTick: untouchedArchive,
        swapRestored: swappedWorld.projects.some((p) => p.id === "p42"),
        swapShelved: swappedWorld.projectRecoveryArchive.length === 1 && swappedWorld.projectRecoveryArchive[0].id === "p50",
        swappedOriginalProgress: swappedWorld.projects.find((p) => p.id === "p42")?.progress === persistedArchive[0].project.progress,
        originalUnchangedAfterTick: JSON.stringify(sourceAfterTick.data.world) === before,
      }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: path.resolve(serverDir, ".."), env: { ...process.env, OH_DATA_DIR: root }, encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"], timeout: 30000,
    });
    const result = JSON.parse(output.slice(output.lastIndexOf("\n@@") + 3));
    assert.equal(result.originalUnchanged, true);
    assert.equal(result.originalActive, 121);
    assert.equal(result.recoveredActive, 120);
    assert.equal(result.activeId, "original", "imported recovery must not activate a new game");
    assert.notEqual(result.recoveredId, result.sourceId);
    assert.equal(result.exportedRoundTrip, true);
    assert.equal(result.progressed, true, "native time-skip work must progress after recovery");
    assert.equal(result.persistedAfterRound, true, "the board must survive runtime persistence");
    assert.equal(result.archiveUnchangedOnTick, true, "shelved covert work must remain unchanged");
    assert.equal(result.swapRestored, true);
    assert.equal(result.swapShelved, true);
    assert.equal(result.swappedOriginalProgress, true, "restoration must not invent retrospective work");
    assert.equal(result.originalUnchangedAfterTick, true);
    assert.equal(result.archive.length, 1);
    assert.equal(result.archive[0].id, "p42");
    assert.equal(result.archive[0].board, "world");
    assert.equal(result.archive[0].project.secrecy, "covert");
    assert.deepEqual(result.archive[0].project.originalPayload, { index: 42, source: "legacy" });
    assert.deepEqual(result.snapshots, [{ round: 9, world: { note: "before recovery" } }]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
