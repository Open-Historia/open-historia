/*! Open Historia — hub provenance tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/hubProvenance.test.js
//
// A scenario downloaded from the community hub keeps its link to the post
// through the player's edits (so they can suggest their changes back), and
// loses it only when they unlink it. What has to hold:
//   - an edit keeps the link and marks it edited; the Update button reads that
//     mark, so it never offers to overwrite the player's work;
//   - bookkeeping (the player's own post found, a suggestion reviewed) is not
//     an edit: no updatedAt, no edited mark;
//   - Unlink clears the link for good;
//   - a game exported from an edited copy carries its map, because the post's
//     file is no longer that map.
// Store cases run in a child process: OH_DATA_DIR is read once, at import time.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { OWNER_SCHEMA } from "./ownerMigration.js";
import {
  fetchableHubOrigin,
  hubOriginAfterWrite,
  isBlockedContributor,
  normalizeHubKey,
  normalizeHubLogin,
  normalizeHubOrigin,
  normalizeHubPublished,
  normalizeHubReviews,
  openHubSuggestions,
  scenarioCopyOfHubFile,
  withContributorBlocked,
} from "./hubProvenance.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const ORIGIN = { postId: 42, bundleUrl: "https://github.com/user-attachments/files/1/world.zip", syncedAt: "2026-08-01T00:00:00.000Z" };

test("the link keeps the post's title and author, and whether the copy was edited", () => {
  const origin = normalizeHubOrigin({ ...ORIGIN, title: "  The Long Winter ", author: "arkniem", editedAt: "2026-09-01T10:00:00.000Z" });
  assert.deepEqual(origin, { ...ORIGIN, title: "The Long Winter", author: "arkniem", editedAt: "2026-09-01T10:00:00.000Z" });
  assert.equal(normalizeHubOrigin({ postId: 0, bundleUrl: "x" }), null);
  assert.equal(normalizeHubOrigin({ postId: 3 }), null);
  assert.equal(normalizeHubOrigin({ ...ORIGIN, editedAt: "not a date" }).editedAt, undefined);
});

test("an edit keeps the link and marks it edited; bookkeeping and Unlink do what they say", () => {
  const edited = hubOriginAfterWrite(ORIGIN, { name: "Renamed" });
  assert.equal(edited.postId, 42, "the link survives an edit");
  assert.ok(edited.editedAt, "and is marked edited");
  assert.equal(hubOriginAfterWrite(edited, {}).editedAt, edited.editedAt, "the first edit's time is kept");
  assert.equal(hubOriginAfterWrite(ORIGIN, {}, { touch: false }).editedAt, undefined, "bookkeeping is not an edit");
  assert.equal(hubOriginAfterWrite(edited, { hubOrigin: null }), null, "Unlink clears it");
  assert.equal(hubOriginAfterWrite(edited, { hubOrigin: ORIGIN }).editedAt, undefined, "an Update stamps a clean link");
  assert.equal(hubOriginAfterWrite(null, { name: "x" }), null, "a scenario with no link gets none");
});

test("only an unedited copy is handed on as fetchable from the hub", () => {
  assert.deepEqual(fetchableHubOrigin({ ...ORIGIN, title: "T" }), ORIGIN);
  assert.equal(fetchableHubOrigin({ ...ORIGIN, editedAt: "2026-09-01T10:00:00.000Z" }), null);
  assert.equal(fetchableHubOrigin(null), null);
});

test("the player's own post record keeps only what it can trust", () => {
  assert.equal(normalizeHubKey("ab"), "", "too short to be a key");
  assert.equal(normalizeHubKey("oh-3f2a9c1e-77"), "oh-3f2a9c1e-77");
  assert.equal(normalizeHubPublished({ key: "no" }), null, "nothing to find the post by");
  const published = normalizeHubPublished({
    key: "oh-3f2a9c1e-77",
    postIds: [12, "12", 30, -1],
    suggestions: [
      { id: "c1", postId: 12, commentId: 1, author: "bob", zipUrl: "https://github.com/user-attachments/files/9/x-suggestion.zip", url: "https://github.com/Open-Historia/Open-historia-scenarios/issues/12#issuecomment-1", note: "Fixed Sonora" },
      { id: "c1", postId: 12, zipUrl: "https://github.com/user-attachments/files/9/x-suggestion.zip" },
      { id: "c2", postId: 12, zipUrl: "https://evil.example/x.zip" },
    ],
    commentCounts: { 12: 4, 99: 3 },
  });
  assert.deepEqual(published.postIds, [12, 30]);
  assert.deepEqual(published.suggestions.map((ref) => ref.id), ["c1"], "no duplicate, and nothing hosted off GitHub");
  assert.deepEqual(published.commentCounts, { 12: 4 }, "counts only for this scenario's posts");
  assert.ok(normalizeHubPublished({ postIds: [7] }), "a post linked by hand needs no key");
});

test("a review is accepted or rejected per change, and the open suggestions are the ones not finished", () => {
  const reviews = normalizeHubReviews({
    c1: { status: "done", accepted: ["a", "b"], rejected: ["b", "c"], updatedAt: "2026-09-02T00:00:00.000Z" },
    c2: { status: "bogus" },
  });
  assert.deepEqual(reviews.c1.rejected, ["c"], "accepted wins over rejected");
  assert.equal(reviews.c2.status, "reviewing");
  const published = {
    key: "oh-3f2a9c1e-77",
    postIds: [12],
    suggestions: ["c1", "c2", "c3"].map((id) => ({ id, postId: 12, zipUrl: `https://github.com/user-attachments/files/1/${id}.zip` })),
  };
  assert.deepEqual(openHubSuggestions(published, { ...reviews, c3: { status: "dismissed" } }).map((ref) => ref.id), ["c2"]);
});

test("a contributor flooding a post is rejected wholesale: everything of theirs hidden, now and later", () => {
  assert.equal(normalizeHubLogin("@Spam-Bot"), "Spam-Bot");
  assert.equal(normalizeHubLogin("not a login"), "");
  const zip = (n) => `https://github.com/user-attachments/files/${n}/x-suggestion.zip`;
  const published = {
    key: "oh-3f2a9c1e-77",
    postIds: [12],
    commentCounts: { 12: 40 },
    suggestions: [
      { id: "c1", postId: 12, author: "spam-bot", zipUrl: zip(1) },
      { id: "c2", postId: 12, author: "Spam-Bot", zipUrl: zip(2) },
      { id: "c3", postId: 12, author: "helper", zipUrl: zip(3) },
    ],
  };
  const blocked = withContributorBlocked(published, "spam-bot");
  assert.deepEqual(blocked.blocked, ["spam-bot"]);
  assert.deepEqual(blocked.suggestions.map((ref) => ref.id), ["c3"], "whatever the case of their login");
  assert.equal(blocked.commentCounts, undefined, "every comment is read again: the flood may have crowded out someone else");
  assert.equal(isBlockedContributor(blocked, "SPAM-BOT"), true);
  // Later suggestions from them are dropped as they arrive.
  const later = normalizeHubPublished({ ...blocked, suggestions: [...blocked.suggestions, { id: "c9", postId: 12, author: "spam-bot", zipUrl: zip(9) }] });
  assert.deepEqual(openHubSuggestions(later, {}).map((ref) => ref.id), ["c3"]);
  const unblocked = withContributorBlocked(blocked, "Spam-Bot", false);
  assert.equal(unblocked.blocked, undefined);
  assert.equal(isBlockedContributor(unblocked, "spam-bot"), false);
});

// ---- the desktop store ------------------------------------------------------

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), "utf-8");
};
const buildDataDir = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-hubprov-"));
  roots.push(root);
  const dir = path.join(root, "scenarios", "shared-world");
  writeJson(path.join(dir, "scenario.json"), {
    id: "shared-world",
    name: "Shared World",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    hubOrigin: { ...ORIGIN, title: "Shared World", author: "arkniem" },
  });
  writeJson(path.join(dir, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(dir, "game.json"), {});
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(dir, "storage", `${key}.json`), []);
  writeJson(path.join(root, "scenario-manifest.json"), { order: ["shared-world"], selectedScenarioId: "shared-world", version: 2 });
  const game = path.join(root, "games", "campaign");
  writeJson(path.join(game, "game-instance.json"), { id: "campaign", name: "Campaign", scenarioId: "shared-world", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" });
  writeJson(path.join(game, "world.json"), { ownerSchema: OWNER_SCHEMA });
  writeJson(path.join(game, "game.json"), { country: "Testland", gameDate: "2020-01-01", round: 1 });
  for (const key of ["actions", "advisor", "chat", "events"]) writeJson(path.join(game, "storage", `${key}.json`), []);
  writeJson(path.join(root, "game-manifest.json"), { activeGameId: "campaign", order: ["campaign"], version: 2 });
  return root;
};
const runStore = (root, body) => {
  const script = `const store = await import(${JSON.stringify(STORE_URL)});\n${body}`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
};
const report = (expression) => `process.stdout.write("\\n@@" + JSON.stringify(${expression}));`;

test("the store keeps the link through an edit, records bookkeeping quietly, and unlinks on request", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const before = store.exportGameBundle("campaign").scenarioRef.hubOrigin;
    store.updateScenario("shared-world", { hubPublished: { key: "oh-3f2a9c1e-77", postIds: [55] } });
    const afterBookkeeping = store.getScenarioDetails("shared-world").scenario;
    store.updateScenario("shared-world", { name: "My Shared World" });
    const afterEdit = store.getScenarioDetails("shared-world").scenario;
    const exported = store.exportGameBundle("campaign").scenarioRef;
    store.updateScenario("shared-world", { hubOrigin: null });
    const afterUnlink = store.getScenarioDetails("shared-world").scenario;
    ${report(`{ before, afterBookkeeping, afterEdit, exported, afterUnlink }`)}
  `);
  assert.equal(result.before.postId, 42, "an unedited copy can be fetched from the hub again");
  assert.equal(result.afterBookkeeping.updatedAt, "2026-08-01T00:00:00.000Z", "bookkeeping does not move updatedAt");
  assert.equal(result.afterBookkeeping.hubOrigin.editedAt, undefined, "nor mark the copy edited");
  assert.deepEqual(result.afterBookkeeping.hubPublished.postIds, [55]);
  assert.equal(result.afterEdit.name, "My Shared World");
  assert.equal(result.afterEdit.hubOrigin.postId, 42, "the edit keeps the link");
  assert.ok(result.afterEdit.hubOrigin.editedAt, "and marks it edited");
  assert.deepEqual(result.afterEdit.hubPublished.postIds, [55], "an edit keeps the player's own post too");
  assert.equal(result.exported.hubOrigin, null, "an edited copy's game carries the map itself");
  assert.equal(result.afterUnlink.hubOrigin, null, "Unlink clears the link");
  assert.deepEqual(result.afterUnlink.hubPublished.postIds, [55]);
});

test("a hub file's copy is an unedited scenario from the same post at the same file", () => {
  const scenarios = [
    { id: "new-scenario", hubOrigin: null },
    { id: "older", hubOrigin: { ...ORIGIN, bundleUrl: "https://github.com/user-attachments/files/0/world.zip" } },
    { id: "edited", hubOrigin: { ...ORIGIN, editedAt: "2026-09-01T10:00:00.000Z" } },
    { id: "other-post", hubOrigin: { ...ORIGIN, postId: 43 } },
    { id: "copy-a", hubOrigin: ORIGIN },
    { id: "copy-b", hubOrigin: { ...ORIGIN, postId: "42" } },
  ];
  assert.equal(scenarioCopyOfHubFile(ORIGIN, scenarios)?.id, "copy-a", "the first unedited copy of that very file");
  assert.equal(scenarioCopyOfHubFile(ORIGIN, scenarios, "copy-b")?.id, "copy-b", "the id the game names wins a tie");
  assert.equal(scenarioCopyOfHubFile(ORIGIN, scenarios.slice(0, 4)), null, "an older, an edited or another post's copy is not it");
  assert.equal(scenarioCopyOfHubFile(null, scenarios), null);
  assert.equal(scenarioCopyOfHubFile(ORIGIN, null), null);
});

test("the web store writes provenance through the same rules", () => {
  const source = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "libraryStore.js"), "utf-8");
  assert.match(source, /hubOrigin: hubOriginAfterWrite\(current\.hubOrigin, updates, \{ touch \}\)/);
  assert.match(source, /writeScenarioMeta\(record, provenance, \{ touch: false \}\)/);
  assert.match(source, /hubOrigin: fetchableHubOrigin\(scenario\?\.hubOrigin\)/);
  const models = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "models.js"), "utf-8");
  assert.match(models, /hubPublished: normalizeHubPublished\(raw\?\.hubPublished\)/);
  assert.match(models, /hubReviews: normalizeHubReviews\(raw\?\.hubReviews\)/);
});
