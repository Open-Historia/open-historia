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
//   - Unlink clears the link for good: the scenario remembers what it was
//     unlinked from, and nothing attaches it again, whoever writes (a check for
//     suggestions that was still running, another window, a hand-made request);
//   - a link is only ever made by the game, on a download and on Publish: a
//     scenario write can unlink, never link, and an Update only renews the link
//     a copy has;
//   - the link remembers the checked copy it was downloaded from, in the hub's
//     own releases and nowhere else, through every write that keeps the link;
//     a link without one is an old link, and an Update gives it one;
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
  HUB_OWNER,
  HUB_REPO,
  fetchableHubOrigin,
  hubLinksAfterWrite,
  hubOriginAfterWrite,
  hubOriginForUpdate,
  hubReleaseUrl,
  importedGameScenarioId,
  isBlockedContributor,
  missingBasemapOfBundle,
  normalizeHubKey,
  normalizeHubLogin,
  normalizeHubOrigin,
  normalizeHubPublished,
  normalizeHubReviews,
  normalizeHubUnlinked,
  normalizeMissingBasemap,
  openHubSuggestions,
  pickHubProvenance,
  scenarioCopyOfHubFile,
  withContributorBlocked,
} from "./hubProvenance.js";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const ORIGIN = { postId: 42, bundleUrl: "https://github.com/user-attachments/files/1/world.zip", syncedAt: "2026-08-01T00:00:00.000Z" };
// The checked copies of the post's file in the hub's releases: of the file
// ORIGIN names, and of a newer one.
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
const RELEASE = `${RELEASES}/scenarios-1/p42-1-world-1a2b3c4d.zip`;
const NEWER_RELEASE = `${RELEASES}/scenarios-1/p42-2-world-5e6f7a8b.zip`;

test("the link keeps the post's title and author, and whether the copy was edited", () => {
  const origin = normalizeHubOrigin({ ...ORIGIN, title: "  The Long Winter ", author: "arkniem", editedAt: "2026-09-01T10:00:00.000Z" });
  assert.deepEqual(origin, { ...ORIGIN, title: "The Long Winter", author: "arkniem", editedAt: "2026-09-01T10:00:00.000Z" });
  assert.equal(normalizeHubOrigin({ postId: 0, bundleUrl: "x" }), null);
  assert.equal(normalizeHubOrigin({ postId: 3 }), null);
  assert.equal(normalizeHubOrigin({ ...ORIGIN, editedAt: "not a date" }).editedAt, undefined);
});

test("the link keeps the checked copy it was downloaded from, and only one in this hub's own releases", () => {
  assert.equal(`https://github.com/${HUB_OWNER}/${HUB_REPO}/releases/download`, RELEASES, "the one and only hub");
  assert.deepEqual(normalizeHubOrigin({ ...ORIGIN, release: RELEASE }), { ...ORIGIN, release: RELEASE });
  assert.equal(normalizeHubOrigin({ ...ORIGIN, release: `  ${RELEASE} ` }).release, RELEASE);
  assert.equal(hubReleaseUrl(RELEASE), RELEASE);
  for (const elsewhere of [
    "https://github.com/someone/else/releases/download/x/world.zip",
    "http://github.com/Open-Historia/Open-historia-scenarios/releases/download/x/world.zip",
    "https://github.com.evil.example/Open-Historia/Open-historia-scenarios/releases/download/x/world.zip",
    "https://evil.example/?https://github.com/Open-Historia/Open-historia-scenarios/releases/download/x/world.zip",
    `${RELEASE}?then=https://evil.example/world.zip`,
    `${RELEASE}#fragment`,
    `${RELEASE} https://evil.example/world.zip`,
    "https://github.com/Open-Historia/Open-historia-scenarios/releases/tag/scenarios-1",
    // The post's own attachment is what an old link came from: no release.
    "https://github.com/user-attachments/files/1/world.zip",
    // Too long to be one: cut short it would name another file.
    `${RELEASES}/x/${"w".repeat(600)}.zip`,
    7,
    {},
    null,
  ]) {
    assert.equal(hubReleaseUrl(elsewhere), "", `${String(elsewhere).slice(0, 80)} is no copy of this hub's`);
    const origin = normalizeHubOrigin({ ...ORIGIN, release: elsewhere });
    assert.equal(origin.postId, 42, "the link itself is kept");
    assert.equal(origin.release, undefined, "as an old link: it names no checked copy");
  }
});

test("the release stays through every write that keeps the link, and an Update stamps the one it downloaded", () => {
  const origin = { ...ORIGIN, release: RELEASE };
  const edited = hubOriginAfterWrite(origin, { name: "Renamed" });
  assert.equal(edited.release, RELEASE, "an edit keeps it");
  assert.ok(edited.editedAt);
  assert.equal(hubOriginAfterWrite(edited, { name: "Renamed again" }).release, RELEASE);
  assert.equal(hubOriginAfterWrite(origin, {}, { touch: false }).release, RELEASE, "bookkeeping keeps it");
  assert.equal(hubLinksAfterWrite({ hubOrigin: origin }, { hubPublished: { key: "oh-3f2a9c1e5d7b9a01" } }, { touch: false }).hubOrigin.release, RELEASE);
  assert.equal(hubOriginAfterWrite(origin, { hubOrigin: null }), null, "an Unlink takes the whole link");

  const newer = { ...ORIGIN, bundleUrl: "https://github.com/user-attachments/files/2/world.zip", release: NEWER_RELEASE };
  assert.equal(hubOriginForUpdate(origin, newer).release, NEWER_RELEASE);
  assert.equal(hubOriginAfterWrite(edited, { hubOrigin: newer }).release, NEWER_RELEASE);
  // An old link has none. Its Update gives it one, edited or not, and takes
  // the edited mark away with the changes it replaced.
  const oldLink = { ...ORIGIN, editedAt: "2026-09-01T10:00:00.000Z" };
  assert.equal(normalizeHubOrigin(oldLink).release, undefined);
  assert.deepEqual(hubOriginForUpdate(oldLink, origin), origin);
  // An Update whose bundle names no checked copy stamps none: nothing vouches for one.
  assert.equal(hubOriginForUpdate(origin, ORIGIN).release, undefined);
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
  // Unlinking cannot be taken back, so only an explicit null does it.
  assert.equal(hubOriginAfterWrite(edited, { hubOrigin: { postId: 0 } }).postId, 42, "a value that is no link is passed over");
  assert.equal(hubOriginAfterWrite(edited, { hubOrigin: undefined }).postId, 42);
});

const KEY = "oh-3f2a9c1e5d7b9a01";
const NEW_KEY = "oh-0a1b2c3d4e5f6a7b";
const NEWER_FILE = "https://github.com/user-attachments/files/2/world.zip";
const suggestionZip = (n) => `https://github.com/user-attachments/files/${n}/x-suggestion.zip`;
// A bookkeeping write, as updateScenario makes one of a body that only names links.
const write = (current, updates) => hubLinksAfterWrite(current, updates, { touch: false });

test("what a scenario was unlinked from is kept as post numbers and publish keys", () => {
  assert.equal(normalizeHubUnlinked(null), null);
  assert.equal(normalizeHubUnlinked({ postIds: [], keys: ["no"] }), null, "nothing unlinked is no record");
  assert.deepEqual(normalizeHubUnlinked({ postIds: [12, "12", -1, 30], keys: [KEY, KEY, "x"] }), { postIds: [12, 30], keys: [KEY] });
});

test("unlinking the player's own post is for good: neither its key nor its posts come back", () => {
  const record = {
    key: KEY,
    publishedAt: "2026-09-01T00:00:00.000Z",
    postIds: [12, 30],
    suggestions: [{ id: "c1", postId: 12, zipUrl: suggestionZip(1) }],
    commentCounts: { 12: 4 },
  };
  const unlinked = write({ hubPublished: record }, { hubPublished: null });
  assert.equal(unlinked.hubPublished, null);
  assert.deepEqual(unlinked.hubUnlinked, { postIds: [12, 30], keys: [KEY] }, "the posts and their key are remembered");

  // A check for suggestions that was still running when the player unlinked,
  // or another window, writes back the record it read before.
  const stale = write(unlinked, { hubPublished: { ...record, commentCounts: { 12: 5 } } });
  assert.equal(stale.hubPublished, null, "the unlinked record is not written back");
  assert.deepEqual(stale.hubUnlinked, unlinked.hubUnlinked);

  // Publishing again is a new key and a new post, followed as usual.
  const again = write(unlinked, { hubPublished: { key: NEW_KEY, publishedAt: "2026-10-01T00:00:00.000Z" } });
  assert.equal(again.hubPublished.key, NEW_KEY);
  const found = write(again, { hubPublished: { ...again.hubPublished, postIds: [41] } });
  assert.deepEqual(found.hubPublished.postIds, [41]);

  // The old post edited to carry the new key, or named in a hand-made request.
  const sneaked = write(found, {
    hubPublished: {
      ...found.hubPublished,
      postIds: [41, 12],
      suggestions: [{ id: "c1", postId: 12, zipUrl: suggestionZip(1) }, { id: "c2", postId: 41, zipUrl: suggestionZip(2) }],
      commentCounts: { 12: 4, 41: 1 },
    },
  });
  assert.deepEqual(sneaked.hubPublished.postIds, [41], "the old post never comes back");
  assert.deepEqual(sneaked.hubPublished.suggestions.map((ref) => ref.id), ["c2"], "nor its suggestions");
  assert.deepEqual(sneaked.hubPublished.commentCounts, { 41: 1 });

  const twice = write(found, { hubPublished: null });
  assert.deepEqual(twice.hubUnlinked, { postIds: [12, 30, 41], keys: [KEY, NEW_KEY] }, "a second Unlink adds to what is remembered");
});

test("only an explicit null unlinks: a write that is no record changes nothing", () => {
  const record = { key: KEY, postIds: [12] };
  for (const junk of [undefined, {}, [], "nope", { key: "no" }]) {
    const after = write({ hubPublished: record }, { hubPublished: junk });
    assert.deepEqual(after.hubPublished.postIds, [12], `${JSON.stringify(junk)} leaves the record alone`);
    assert.equal(after.hubUnlinked, null, "and nothing is remembered as unlinked");
  }
  assert.deepEqual(write({ hubPublished: record }, { name: "Renamed" }).hubPublished.postIds, [12], "a write that names no link keeps them");
});

test("a post linked by hand, while that was possible, stays until it is unlinked; none can be made", () => {
  assert.equal(write({}, { hubPublished: { postIds: [7] } }).hubPublished, null, "a record with no key is the manual link: a write makes none");
  const legacy = { key: "", postIds: [7] };
  const checked = write({ hubPublished: legacy }, {
    hubPublished: {
      postIds: [7, 8],
      suggestions: [{ id: "c1", postId: 7, zipUrl: suggestionZip(1) }, { id: "c2", postId: 8, zipUrl: suggestionZip(2) }],
      commentCounts: { 7: 2, 8: 9 },
    },
  });
  assert.deepEqual(checked.hubPublished.postIds, [7], "the one that exists is kept and checked, but gains no post");
  assert.deepEqual(checked.hubPublished.suggestions.map((ref) => ref.id), ["c1"]);
  assert.deepEqual(checked.hubPublished.commentCounts, { 7: 2 });

  const keyed = write({ hubPublished: legacy }, { hubPublished: { ...legacy, key: KEY } });
  assert.deepEqual([keyed.hubPublished.key, keyed.hubPublished.postIds], [KEY, [7]], "Publish gives it a key, and its post stays");
  assert.deepEqual(
    write(keyed, { hubPublished: { postIds: [7, 99] } }).hubPublished,
    keyed.hubPublished,
    "a write cannot take the key off a record to hand it other posts",
  );

  const unlinked = write({ hubPublished: legacy }, { hubPublished: null });
  assert.deepEqual(unlinked.hubUnlinked, { postIds: [7], keys: [] });
  assert.equal(write(unlinked, { hubPublished: legacy }).hubPublished, null, "unlinked, it is gone for good like any other");
  assert.deepEqual(write(unlinked, { hubPublished: { key: KEY, postIds: [7] } }).hubPublished.postIds, []);
});

test("unlinking the post a scenario was downloaded from is for good, and touches no other link", () => {
  const unlinked = write({ hubOrigin: ORIGIN }, { hubOrigin: null });
  assert.equal(unlinked.hubOrigin, null);
  assert.deepEqual(unlinked.hubUnlinked, { postIds: [42], keys: [] });
  assert.equal(hubLinksAfterWrite(unlinked, { hubOrigin: { ...ORIGIN, bundleUrl: NEWER_FILE } }).hubOrigin, null, "nothing stamps that post on it again");
  assert.deepEqual(
    write(unlinked, { hubPublished: { key: KEY, postIds: [42, 43] } }).hubPublished.postIds,
    [43],
    "and it never becomes one of the player's own posts of this scenario",
  );

  // One post in both places: a player who downloaded their own post, and had
  // linked it by hand. Each Unlink removes the link it names and no other.
  const both = { hubOrigin: ORIGIN, hubPublished: { key: "", postIds: [42] } };
  const ownUnlinked = write(both, { hubPublished: null });
  assert.equal(ownUnlinked.hubOrigin.postId, 42, "the download was not what was unlinked");
  assert.equal(
    hubLinksAfterWrite(ownUnlinked, { hubOrigin: { ...ORIGIN, bundleUrl: NEWER_FILE } }).hubOrigin.bundleUrl,
    NEWER_FILE,
    "so an Update still renews it",
  );
  const originUnlinked = write(both, { hubOrigin: null });
  assert.deepEqual(
    write(originUnlinked, { hubPublished: { postIds: [42], commentCounts: { 42: 3 } } }).hubPublished.postIds,
    [42],
    "and a post already the player's own stays so",
  );
});

test("a scenario write can unlink, never link; an Update only renews the link a copy has", () => {
  assert.deepEqual(pickHubProvenance({ name: "x", hubOrigin: null, hubReviews: {} }), { hubOrigin: null, hubReviews: {} });
  assert.deepEqual(
    pickHubProvenance({ hubPublished: undefined, hubUnlinked: { postIds: [] } }),
    {},
    "an absent value is no write, and what was unlinked is never a request's to say",
  );
  assert.throws(() => pickHubProvenance({ hubOrigin: ORIGIN }), /cannot be linked/);
  assert.throws(() => pickHubProvenance({ hubOrigin: {} }), /cannot be linked/);

  const newer = { ...ORIGIN, bundleUrl: NEWER_FILE };
  assert.equal(hubOriginForUpdate(ORIGIN, newer).bundleUrl, NEWER_FILE);
  assert.equal(hubOriginForUpdate({ ...ORIGIN, editedAt: "2026-09-01T10:00:00.000Z" }, newer).editedAt, undefined, "the renewed link is a clean one");
  assert.equal(hubOriginForUpdate(ORIGIN, null), null, "a bundle that names no post stamps nothing");
  assert.throws(() => hubOriginForUpdate(null, newer), /not linked to that community post/, "an unlinked scenario is its player's own");
  assert.throws(() => hubOriginForUpdate({ ...ORIGIN, postId: 43 }, newer), /not linked to that community post/);
});

test("only an unedited copy is handed on as fetchable from the hub", () => {
  assert.deepEqual(fetchableHubOrigin({ ...ORIGIN, title: "T" }), ORIGIN);
  assert.equal(fetchableHubOrigin({ ...ORIGIN, editedAt: "2026-09-01T10:00:00.000Z" }), null);
  assert.equal(fetchableHubOrigin(null), null);
  // The post and its file, never this library's download of it: whoever
  // fetches the map stamps the copy they download.
  assert.deepEqual(fetchableHubOrigin({ ...ORIGIN, release: RELEASE }), ORIGIN);
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
  assert.ok(normalizeHubPublished({ postIds: [7] }), "a record of a post linked by hand, while that was possible, is still read");
  const many = normalizeHubPublished({
    key: "oh-3f2a9c1e-77",
    postIds: [12],
    suggestions: Array.from({ length: 55 }, (_, index) => ({ id: `c${index + 1}`, postId: 12, zipUrl: `https://github.com/user-attachments/files/${index + 1}/x-suggestion.zip` })),
  });
  assert.equal(many.suggestions.length, 50);
  assert.equal(many.suggestions[0].id, "c6", "past fifty the newest are kept, not the oldest");
  assert.equal(many.suggestions.at(-1).id, "c55");
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

test("the store keeps an Unlink for good, whoever writes afterwards", () => {
  const root = buildDataDir();
  const result = runStore(root, `
    const scenario = () => store.getScenarioDetails("shared-world").scenario;
    const refusal = (run) => { try { run(); return ""; } catch (error) { return error.message; } };
    const bundle = (name, file) => ({
      schema: "open-historia-scenario-bundle/2",
      scenario: { name },
      data: { world: { ownerSchema: ${OWNER_SCHEMA} }, game: {} },
      assets: {},
      hubOrigin: { postId: 42, bundleUrl: "https://github.com/user-attachments/files/" + file + "/world.zip" },
    });

    // The player's own post: published and found, then unlinked.
    store.updateScenario("shared-world", { hubPublished: { key: "${KEY}", postIds: [55] } });
    store.updateScenario("shared-world", { hubPublished: null });
    const ownUnlinked = scenario();
    // A check that read the record before the Unlink writes it back.
    store.updateScenario("shared-world", { hubPublished: { key: "${KEY}", postIds: [55], commentCounts: { 55: 2 } } });
    const afterStaleWrite = scenario();
    // Published again: a new key, and the old post named beside the new one.
    store.updateScenario("shared-world", { hubPublished: { key: "${NEW_KEY}", postIds: [55, 60] } });
    const republished = scenario();

    // The post it was downloaded from.
    const linkRefused = refusal(() => store.updateScenario("shared-world", { hubOrigin: { postId: 99, bundleUrl: "https://github.com/user-attachments/files/9/other.zip" } }));
    const afterLinkRefused = scenario();
    store.updateScenarioFromBundle("shared-world", bundle("Shared World v2", 2));
    const updated = scenario();
    store.updateScenario("shared-world", { hubOrigin: null });
    const originUnlinked = scenario();
    const relinkRefused = refusal(() => store.updateScenario("shared-world", { hubOrigin: bundle("x", 3).hubOrigin }));
    const updateRefused = refusal(() => store.updateScenarioFromBundle("shared-world", bundle("Shared World v3", 3)));
    ${report(`{ ownUnlinked, afterStaleWrite, republished, linkRefused, afterLinkRefused, updated, originUnlinked, relinkRefused, updateRefused, afterAll: scenario() }`)}
  `);
  assert.equal(result.ownUnlinked.hubPublished, null);
  assert.deepEqual(result.ownUnlinked.hubUnlinked, { postIds: [55], keys: [KEY] }, "the scenario remembers the post and its key");
  assert.equal(result.ownUnlinked.updatedAt, "2026-08-01T00:00:00.000Z", "an Unlink is bookkeeping, not an edit");
  assert.equal(result.afterStaleWrite.hubPublished, null, "a record read before the Unlink is not written back");
  assert.equal(result.republished.hubPublished.key, NEW_KEY, "publishing again is followed as usual");
  assert.deepEqual(result.republished.hubPublished.postIds, [60], "but the unlinked post never comes back");

  assert.match(result.linkRefused, /cannot be linked/, "a scenario write cannot link a scenario to a post");
  assert.equal(result.afterLinkRefused.hubOrigin.postId, 42, "and it leaves the link the scenario has");
  assert.equal(result.afterLinkRefused.updatedAt, "2026-08-01T00:00:00.000Z", "and writes nothing");
  assert.equal(result.updated.name, "Shared World v2", "a copy still linked takes its post's newer file");
  assert.equal(result.updated.hubOrigin.bundleUrl, "https://github.com/user-attachments/files/2/world.zip");
  assert.equal(result.updated.hubOrigin.editedAt, undefined);
  assert.equal(result.originUnlinked.hubOrigin, null);
  assert.deepEqual(result.originUnlinked.hubUnlinked, { postIds: [55, 42], keys: [KEY] });
  assert.match(result.relinkRefused, /cannot be linked/);
  assert.match(result.updateRefused, /not linked to that community post/, "an Update cannot link it again either");
  assert.equal(result.afterAll.name, "Shared World v2", "and the refused Update wrote nothing over the player's scenario");
  assert.equal(result.afterAll.hubOrigin, null);
  assert.deepEqual(result.afterAll.hubPublished.postIds, [60]);
});

test("the store keeps the checked copy a scenario was downloaded from, and an Update gives an old link one", () => {
  // The scenario in this library has an old link: downloaded when the game
  // still took the post's own attachment, so it names no release.
  const root = buildDataDir();
  const result = runStore(root, `
    const scenario = (id) => store.getScenarioDetails(id).scenario;
    const bundle = (name, file, release) => ({
      schema: "open-historia-scenario-bundle/2",
      scenario: { name },
      data: { world: { ownerSchema: ${OWNER_SCHEMA} }, game: {} },
      assets: {},
      hubOrigin: { postId: 42, bundleUrl: "https://github.com/user-attachments/files/" + file + "/world.zip", ...(release ? { release } : {}) },
    });
    const oldLink = scenario("shared-world").hubOrigin;
    // The player changes it, and then takes the Update its card asks for.
    store.updateScenario("shared-world", { name: "My Shared World" });
    const edited = scenario("shared-world").hubOrigin;
    store.updateScenarioFromBundle("shared-world", bundle("Shared World", 1, "${RELEASE}"));
    const updated = scenario("shared-world");
    const exported = store.exportGameBundle("campaign").scenarioRef.hubOrigin;
    store.updateScenario("shared-world", { hubPublished: { key: "${KEY}", postIds: [55] } });
    store.updateScenario("shared-world", { name: "Mine Again" });
    const editedAgain = scenario("shared-world").hubOrigin;
    // A newer file of the post, and a download stamped with a copy that is not the hub's.
    const imported = store.importScenarioBundle(bundle("Second Copy", 2, "${NEWER_RELEASE}"), { setSelected: false }).scenario.hubOrigin;
    const elsewhere = store.importScenarioBundle(bundle("Elsewhere", 3, "https://evil.example/releases/download/x/world.zip"), { setSelected: false }).scenario.hubOrigin;
    ${report(`{ oldLink, edited, updated, exported, editedAgain, imported, elsewhere }`)}
  `);
  assert.equal(result.oldLink.release, undefined);
  assert.ok(result.edited.editedAt);
  assert.equal(result.edited.release, undefined, "an edit does not make an old link a checked one");
  assert.equal(result.updated.name, "Shared World", "the Update put the hub's file in place of the player's changes");
  assert.equal(result.updated.hubOrigin.release, RELEASE, "and stamped the copy it downloaded");
  assert.equal(result.updated.hubOrigin.editedAt, undefined);
  assert.deepEqual(Object.keys(result.exported).sort(), ["bundleUrl", "postId", "syncedAt"], "a game export hands on the post and its file, not this download");
  assert.equal(result.editedAgain.release, RELEASE, "bookkeeping and a later edit keep it");
  assert.ok(result.editedAgain.editedAt);
  assert.equal(result.imported.release, NEWER_RELEASE, "an import keeps the copy it came from");
  assert.equal(result.elsewhere.postId, 42);
  assert.equal(result.elsewhere.release, undefined, "an address outside the hub's releases is not kept as one");
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

test("an imported hub game names this library's copy of the file, never merely the same id", () => {
  const ref = { builtIn: false, hubOrigin: ORIGIN, scenarioId: "new-scenario" };
  const own = { id: "new-scenario", hubOrigin: null };
  const copy = { id: "world-2", hubOrigin: ORIGIN };
  assert.equal(importedGameScenarioId(ref, [own, copy]), "world-2", "the copy of that file, whatever its id");
  assert.equal(importedGameScenarioId(ref, [{ ...own, hubOrigin: ORIGIN }, copy]), "new-scenario", "the named id when it is a copy");
  assert.equal(importedGameScenarioId(ref, [own]), "new-scenario-hub-42", "an unrelated holder of the id: a free id, so the map shows missing");
  assert.equal(importedGameScenarioId(ref, [own, { id: "new-scenario-hub-42" }]), "new-scenario-hub-42-2");
  assert.equal(importedGameScenarioId(ref, []), "new-scenario", "a free id stays");
  assert.equal(importedGameScenarioId({ ...ref, builtIn: true }, [own]), "new-scenario", "a built-in map is on every install");
  assert.equal(importedGameScenarioId({ scenarioId: "mine" }, [{ id: "mine" }]), "mine", "no hub file: the sender's id");
});

test("the web store writes provenance through the same rules", () => {
  // What the two stores do with a link is decided in hubProvenance.js, and
  // neither keeps a rule of its own: the web store's behaviour is run in
  // src/runtime/web/libraryStore.test.js.
  const desktop = readFileSync(path.join(SERVER_DIR, "libraryStore.js"), "utf-8");
  const source = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "libraryStore.js"), "utf-8");
  for (const [name, store] of [["the desktop store", desktop], ["the web store", source]]) {
    assert.match(store, /\.\.\.hubLinksAfterWrite\(current, updates(?: \?\? \{\})?, \{ touch \}\)/, `${name} writes links by the one rule`);
    assert.match(store, /const provenance = pickHubProvenance\(body\);/, `${name} takes from a request only what the one rule allows`);
    assert.match(store, /const hubOrigin = hubOriginForUpdate\(/, `${name} lets an Update renew a link, never make one`);
    assert.doesNotMatch(store, /const pickHubProvenance|HUB_PROVENANCE_KEYS|hubOriginAfterWrite|normalizeHubPublished\(updates/, `${name} has no rule of its own`);
  }
  assert.match(source, /writeScenarioMeta\(record, provenance, \{ touch: false \}\)/);
  assert.match(source, /hubOrigin: fetchableHubOrigin\(scenario\?\.hubOrigin\)/);
  assert.match(source, /serializeByKey\(`scenario-write:\$\{id\}`/, "one write to a scenario at a time, as on the desktop");
  const models = readFileSync(path.join(SERVER_DIR, "..", "src", "runtime", "web", "models.js"), "utf-8");
  assert.match(models, /hubPublished: normalizeHubPublished\(raw\?\.hubPublished\)/);
  assert.match(models, /hubReviews: normalizeHubReviews\(raw\?\.hubReviews\)/);
  // A field a meta reader does not name is dropped by the next meta write.
  assert.match(models, /hubUnlinked: normalizeHubUnlinked\(raw\?\.hubUnlinked\)/);
  assert.match(desktop, /hubUnlinked: normalizeHubUnlinked\(raw\?\.hubUnlinked\)/);
});

test("a missing community basemap is kept as its reference, and nothing else is", () => {
  const reference = { mode: "communityRef", via: "image", hash: "abc", url: "https://github.com/user-attachments/assets/b.png", fileName: "background.json" };
  const bundle = {
    data: { world: { background: { kind: "image", extent: [0, 0, 1, 1] } } },
    assets: { backgroundData: { ...reference, missingReason: "Download failed (HTTP 502).", stray: "x" } },
  };
  assert.deepEqual(missingBasemapOfBundle(bundle), {
    reference,
    background: { kind: "image", extent: [0, 0, 1, 1] },
    reason: "Download failed (HTTP 502).",
  });
  assert.equal(missingBasemapOfBundle({ assets: { backgroundData: { mode: "embedded", data: "e30=" } } }), null, "a basemap in the bundle is not missing");
  assert.equal(missingBasemapOfBundle({}), null);
  assert.equal(normalizeMissingBasemap({ reference: { mode: "communityRef", url: "http://example.com/b.png" } }), null, "https only");
  assert.equal(normalizeMissingBasemap({ reference: { mode: "embedded", url: reference.url } }), null);
  assert.deepEqual(normalizeMissingBasemap({ reference: { mode: "communityRef", url: reference.url }, background: [1] }), { reference: { mode: "communityRef", url: reference.url } });
});
