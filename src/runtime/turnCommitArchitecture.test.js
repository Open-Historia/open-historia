/*! Open Historia — canonical turn-commit architecture regressions © 2026. */
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (url) => fs.readFileSync(new URL(url, import.meta.url), "utf8");
const gameState = read("./gameState.js");
const assets = read("./assets.js");
const gameplay = read("../Game/AI/gameplay.js");
const webStore = read("./web/libraryStore.js");
const webRouter = read("./web/router.js");
const desktopServer = read("../../server/server.js");

const between = (source, start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing source section ${start} -> ${end}`);
  return source.slice(a, b);
};

test("normal turns and rollback publish through one canonical generation seam", () => {
  const occurrences = gameplay.match(/writeCanonicalTurnState\s*\(/g) ?? [];
  assert.ok(occurrences.length >= 2, "forward turn and rollback must both use writeCanonicalTurnState");
  assert.doesNotMatch(
    gameplay,
    /Promise\.all\(\s*\[\s*writeActionsState\(nextActions\)[\s\S]{0,900}writeWorldState\(nextWorld\)/,
    "the old independent final writes must not return",
  );
  assert.match(gameplay, /expectedGameId:\s*campaignId/, "forward publication must keep the campaign guard at storage boundary");
});

test("client switches every canonical cache before broadcasting committed-generation events", () => {
  const batch = between(assets, "export const publishJsonWriteBatch", "export const writeJson = async");
  const prime = batch.indexOf("primeJson(");
  const invalidate = batch.indexOf("invalidateDerivedCachesForWrite(");
  const events = batch.indexOf("if (emitEvents && typeof window");
  assert.ok(prime >= 0 && invalidate > prime && events > invalidate);

  const commit = between(gameState, "const commitCanonicalTurnPayload", "const enqueueCanonicalGenerationWrite");
  assert.match(commit, /\/api\/runtime\/turn-commit/);
  assert.match(commit, /publishJsonWriteBatch\s*\(\s*\[/);
  for (const key of ["actions", "chat", "events", "game", "colors", "world"]) {
    assert.match(commit, new RegExp(`JSON_URLS\\.${key}`), `${key} cache must publish in the batch`);
  }
});

test("web turn publication updates one game record and commits it once", () => {
  const section = between(webStore, "const writeRuntimeTurnState", "const writeRuntimeJsonAsset =");
  for (const key of ["actions", "chat", "events", "game", "colors", "world"]) {
    assert.match(section, new RegExp(`${key}:`), `${key} must be in the generation`);
  }
  assert.match(section, /expectedGameId/);
  assert.equal((section.match(/await putGame\(activeGame\)/g) ?? []).length, 1);
  assert.match(webRouter, /segments\[0\]\s*===\s*"turn-commit"/);
  assert.match(webRouter, /handleRuntimeTurnCommit\(ctx\)/);
});

test("desktop exposes one whole-turn endpoint with journal recovery", () => {
  assert.match(desktopServer, /app\.put\("\/api\/runtime\/turn-commit"/);
  assert.match(desktopServer, /writeRuntimeTurnState\(req\.body\)/);
  const libraryStore = fs.readFileSync(new URL("../../server/libraryStore.js", import.meta.url), "utf8");
  assert.match(libraryStore, /TURN_COMMIT_JOURNAL_FILE/);
  assert.match(libraryStore, /recoverPendingTurnCommit/);
  assert.match(libraryStore, /writeJsonFileAtomic/);
});
