/*! Open Historia — suggestions travelling between players: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioSuggestion.test.js
//
// A suggestion goes from the player who edited a community scenario to its
// author as a comment on the post with a small .zip attached. What has to hold:
//   - the author's game recognises its own posts by the key Publish wrote, and
//     a suggestion by its file or its marker line, never any other comment;
//   - only a suggestion the hub has checked is kept or offered: one still
//     waiting for its check appears once it has passed;
//   - comments are read only for a post whose comment count moved;
//   - the .zip carries only the changes, and reads back exactly (a cover image
//     and a basemap travel as files of their own);
//   - a details change is "open", "conflict" or "applied" against the author's
//     scenario as it is now, and accepting builds the save that applies it.

import test from "node:test";
import assert from "node:assert/strict";

import { parsePost, parseSuggestionComment, refreshPublishedRecord } from "./hubPosts.js";
import {
  SUGGESTION_SCHEMA,
  buildSuggestion,
  buildSuggestionComment,
  buildSuggestionZip,
  newPublishKey,
  normalizeSuggestion,
  readSuggestionFile,
  suggestionFileName,
} from "./scenarioSuggestion.js";
import { buildScenarioSnapshot } from "./scenarioChanges.js";
import { buildDetailSave, detailChangeStatus } from "./suggestionApply.js";

const ZIP = "https://github.com/user-attachments/files/123/old-world-suggestion.zip";

test("a post carries its publisher's key; a comment with a suggestion file is a suggestion", () => {
  const key = newPublishKey();
  const post = parsePost({
    number: 12,
    title: "[Scenario] Old World",
    user: { login: "ann" },
    body: `### Description\n\nA world.\n[old-world-scenario.zip](https://github.com/user-attachments/files/1/old-world-scenario.zip)\n\n### Basemap info (auto-filled — leave blank)\n\nScenario-Key: ${key}`,
  });
  assert.equal(post.scenarioKey, key);
  assert.equal(post.description, "A world.", "the key never shows as the post's description");

  const found = parseSuggestionComment({
    id: 555,
    user: { login: "bob" },
    created_at: "2026-09-27T10:00:00Z",
    html_url: "https://github.com/Open-Historia/Open-historia-scenarios/issues/12#issuecomment-555",
    body: `**Suggested changes** to this scenario.\n\nFixed the Caucasus.\n\n- 2 regions change owner\n\n[old-world-suggestion.zip](${ZIP})\n\nOpen-Historia-Suggestion: sug-1234abcd`,
  }, 12);
  assert.equal(found.id, "c555");
  assert.equal(found.zipUrl, ZIP);
  assert.equal(found.author, "bob");
  assert.match(found.note, /Fixed the Caucasus/);
  assert.doesNotMatch(found.note, /Open-Historia-Suggestion|user-attachments/);

  const fileOnly = parseSuggestionComment({ id: 556, body: `Here you go [x-suggestion.zip](${ZIP})` }, 12);
  assert.equal(fileOnly?.zipUrl, ZIP, "a player who forgot the text but attached the file has still suggested");
  assert.equal(parseSuggestionComment({ id: 557, body: "Great scenario! [map.zip](https://github.com/user-attachments/files/9/map.zip)" }, 12), null, "any other zip is just a comment");
  assert.equal(parseSuggestionComment({ id: 558, body: "Open-Historia-Suggestion: sug-1 but no file" }, 12), null);
});

// What the hub's index says it has checked on a post: { comment id -> its zip }
// (hubFiles.js checkedSuggestionsOf, carried by each post as checkedSuggestions).
const checkedBy = (comments) => Object.fromEntries(comments.map((comment) => [comment.id, comment.body.match(/https:[^\s)]+\.zip/)[0]]));

test("the author's own posts are found by key, and comments read only when the count moved", async () => {
  const key = newPublishKey();
  const suggestion = { id: 2, user: { login: "bob" }, body: `[old-world-suggestion.zip](${ZIP})` };
  const posts = [
    { id: 12, title: "Old World", author: "ann", scenarioKey: key, comments: 2, checkedSuggestions: checkedBy([suggestion]) },
    { id: 13, title: "Other", author: "carl", scenarioKey: "", comments: 5 },
  ];
  const calls = [];
  const fetchComments = async (postId) => {
    calls.push(postId);
    return [{ id: 1, body: "Nice!" }, suggestion];
  };
  const first = await refreshPublishedRecord({ key, publishedAt: "2026-09-01T00:00:00Z" }, posts, { fetchComments });
  assert.equal(first.changed, true);
  assert.deepEqual(first.published.postIds, [12]);
  assert.equal(first.published.author, "ann");
  assert.deepEqual(first.published.suggestions.map((ref) => ref.id), ["c2"]);
  assert.deepEqual(first.published.commentCounts, { 12: 2 });
  assert.deepEqual(calls, [12]);

  const again = await refreshPublishedRecord(first.published, posts, { fetchComments });
  assert.equal(again.changed, false);
  assert.deepEqual(calls, [12], "an unchanged post costs no request");

  // The suggester deleted their comment: the suggestion goes with it.
  const later = await refreshPublishedRecord(first.published, [{ ...posts[0], comments: 1, checkedSuggestions: {} }], { fetchComments: async () => [{ id: 1, body: "Nice!" }] });
  assert.deepEqual(later.published.suggestions, []);
  assert.deepEqual(later.published.commentCounts, { 12: 1 });

  // A blocked contributor's new comments are never stored.
  const flood = Array.from({ length: 30 }, (_, index) => ({ id: 100 + index, user: { login: "spam-bot" }, body: `[x-suggestion.zip](https://github.com/user-attachments/files/${index}/x-suggestion.zip)` }));
  const blocked = { ...first.published, blocked: ["spam-bot"], commentCounts: {} };
  const crowded = { ...posts[0], comments: 32, checkedSuggestions: checkedBy([...flood, suggestion]) };
  const guarded = await refreshPublishedRecord(blocked, [crowded], { fetchComments: async () => [...flood, suggestion] });
  assert.deepEqual(guarded.published.suggestions.map((ref) => ref.author), ["bob"]);
  assert.deepEqual(guarded.published.commentCounts, { 12: 32 }, "every one of them was checked, so there is nothing to look again for");
});

test("only a suggestion the hub has checked is kept, and one still waiting appears once it has passed", async () => {
  const key = newPublishKey();
  const checked = { id: 2, user: { login: "bob" }, body: `[old-world-suggestion.zip](${ZIP})` };
  const waitingZip = "https://github.com/user-attachments/files/124/newer-suggestion.zip";
  const waiting = { id: 3, user: { login: "carl" }, body: `[newer-suggestion.zip](${waitingZip})\n\nOpen-Historia-Suggestion: sug-5678` };
  const comments = [{ id: 1, body: "Nice!" }, checked, waiting];
  let calls = 0;
  const fetchComments = async () => {
    calls += 1;
    return comments;
  };
  const post = { id: 12, title: "Old World", author: "ann", scenarioKey: key, comments: 3, checkedSuggestions: checkedBy([checked]) };

  // Carl's comment was posted a moment ago: the hub has not looked inside its
  // file yet, so it is neither stored nor offered.
  const first = await refreshPublishedRecord({ key, publishedAt: "2026-09-01T00:00:00Z" }, [post], { fetchComments });
  assert.deepEqual(first.published.suggestions.map((ref) => ref.id), ["c2"]);
  assert.equal(first.published.commentCounts, undefined, "the count is not recorded while a suggestion is waiting");

  // Nothing has moved on the hub, and the comments are still read again: that
  // is how the one that was waiting is found.
  const still = await refreshPublishedRecord(first.published, [post], { fetchComments });
  assert.equal(calls, 2);
  assert.equal(still.changed, false, "with nothing new, nothing is written");

  // A minute later the hub lists it. The comment count is what it was.
  const passed = { ...post, checkedSuggestions: checkedBy([checked, waiting]) };
  const second = await refreshPublishedRecord(still.published, [passed], { fetchComments });
  assert.deepEqual(second.published.suggestions.map((ref) => ref.id), ["c2", "c3"]);
  assert.deepEqual(second.published.commentCounts, { 12: 3 });
  const settled = await refreshPublishedRecord(second.published, [passed], { fetchComments });
  assert.equal(calls, 3, "and once nothing is waiting, an unchanged post is not read again");
  assert.equal(settled.changed, false);

  // The hub refused it instead: it deletes the comment, and nothing was ever stored.
  const refused = await refreshPublishedRecord(first.published, [{ ...post, comments: 2 }], { fetchComments: async () => [{ id: 1, body: "Nice!" }, checked] });
  assert.deepEqual(refused.published.suggestions.map((ref) => ref.id), ["c2"]);
  assert.deepEqual(refused.published.commentCounts, { 12: 2 });
});

test("a suggestion already held is put away when the hub no longer lists it, or lists another file for it", async () => {
  const key = newPublishKey();
  const comment = { id: 2, user: { login: "bob" }, body: `[old-world-suggestion.zip](${ZIP})` };
  const post = { id: 12, title: "Old World", author: "ann", scenarioKey: key, comments: 1, checkedSuggestions: checkedBy([comment]) };
  const held = (await refreshPublishedRecord({ key, publishedAt: "2026-09-01T00:00:00Z" }, [post], { fetchComments: async () => [comment] })).published;
  assert.deepEqual(held.suggestions.map((ref) => ref.id), ["c2"]);

  // Stored by a build from before the hub checked suggestions, and never
  // listed: put away, though the comment count has not moved.
  let reads = 0;
  const unlisted = await refreshPublishedRecord(held, [{ ...post, checkedSuggestions: {} }], { fetchComments: async () => { reads += 1; return [comment]; } });
  assert.deepEqual(unlisted.published.suggestions, []);
  assert.equal(reads, 1, "the comments are read again, to see what is there now");
  assert.equal(unlisted.published.commentCounts, undefined, "and again later, while the comment is still waiting for its check");

  // Bob edited his comment to carry another file. The hub has checked the new
  // one: the old reference goes, and the new one is found without a new comment.
  const editedZip = "https://github.com/user-attachments/files/125/old-world-suggestion.zip";
  const edited = { ...comment, body: `[old-world-suggestion.zip](${editedZip})` };
  const replaced = await refreshPublishedRecord(held, [{ ...post, checkedSuggestions: checkedBy([edited]) }], { fetchComments: async () => [edited] });
  assert.deepEqual(replaced.published.suggestions.map((ref) => ref.zipUrl), [editedZip]);
  assert.deepEqual(replaced.published.commentCounts, { 12: 1 });

  // A bot's comment is never checked by the hub, so it is never waited for.
  const bot = { id: 9, user: { login: "helper[bot]", type: "Bot" }, body: "[x-suggestion.zip](https://github.com/user-attachments/files/126/x-suggestion.zip)" };
  const withBot = await refreshPublishedRecord(held, [{ ...post, comments: 2 }], { fetchComments: async () => [comment, bot] });
  assert.deepEqual(withBot.published.suggestions.map((ref) => ref.id), ["c2"]);
  assert.deepEqual(withBot.published.commentCounts, { 12: 2 });

  // A post that is no longer on the hub's list: what is held is left alone.
  const off = await refreshPublishedRecord(held, [], { fetchComments: async () => { throw new Error("not read"); } });
  assert.deepEqual(off.published.suggestions.map((ref) => ref.id), ["c2"]);
  assert.equal(off.changed, false);
});

const bundle = () => ({
  schema: "open-historia-scenario-bundle/2",
  scenario: { name: "Old World", description: "A world.", features: {} },
  data: {
    game: { country: "Alpha", startDate: "1900-01-01" },
    prompts: { promptModel: 2, guidance: {} },
    world: { simulationRules: "", institutions: [{ id: "league", name: "The League", members: ["Alpha"] }] },
  },
  assets: { cover: { mode: "default" } },
});

test("the suggestion file carries only the changes and reads back exactly", async () => {
  const cover = Buffer.from("not really a jpeg").toString("base64");
  const suggestion = buildSuggestion({
    changes: [
      { id: "meta:name", area: "details", kind: "field", path: ["meta", "name"], from: "Old World", to: "New World" },
      { id: "cover", area: "details", kind: "cover", from: null, to: { hash: "h1", contentType: "image/jpeg", base64: cover } },
      { id: "map:background", area: "map", kind: "background", from: null, to: { kind: "vector", hash: "h2", data: { geojson: { type: "FeatureCollection", features: [] } } } },
      { id: "bogus", area: "map", kind: "not-a-kind" },
    ],
    scenario: { name: "My Old World" },
    origin: { postId: 12, bundleUrl: "https://github.com/user-attachments/files/1/old-world-scenario.zip", title: "Old World" },
    by: "Bob",
    note: "Fixed a few things.",
  });
  assert.equal(suggestion.schema, SUGGESTION_SCHEMA);
  assert.deepEqual(suggestion.changes.map((change) => change.id), ["meta:name", "cover", "map:background"], "an unknown kind is dropped");
  const zip = await buildSuggestionZip(suggestion);
  const back = await readSuggestionFile(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual(back, suggestion);
  assert.equal(suggestionFileName("Old World: Redux!"), "old-world-redux-suggestion.zip");
  await assert.rejects(readSuggestionFile(new TextEncoder().encode("{}")), /not a scenario suggestion/);

  const comment = buildSuggestionComment(suggestion, { fileName: "old-world-suggestion.zip" });
  assert.match(comment, /Fixed a few things\./);
  assert.match(comment, /- Name changed/);
  assert.match(comment, /old-world-suggestion\.zip/);
  assert.match(comment, new RegExp(`^Open-Historia-Suggestion: ${suggestion.id}$`, "m"));
  assert.throws(() => normalizeSuggestion({ schema: "something-else" }), /not a scenario suggestion/);
});

test("a suggestion made by a newer version: this version keeps what it can apply and skips the rest", () => {
  const suggestion = normalizeSuggestion({
    schema: SUGGESTION_SCHEMA,
    id: "sug-newer",
    changes: [
      { id: "meta:name", area: "details", kind: "field", path: ["meta", "name"], from: "Old World", to: "New World" },
      { id: "politics:institutions:league", area: "details", kind: "politics", field: "institutions", container: "list", entry: "league", op: "change", to: { id: "league" } },
      { id: "institutionLogos", area: "details", kind: "institutionLogos", to: null },
      { id: "group-add:Raiders", area: "map", kind: "group-add", key: "Raiders", to: { name: "Raiders" } },
      { id: "region-group:r1", area: "map", kind: "region-group", regionId: "r1", from: null, to: "Raiders" },
      { id: "marker-add:m1", area: "map", kind: "marker-add", key: "m1", to: { id: "m1", name: "Port" } },
      { id: "puppet-add:p1", area: "map", kind: "puppet-add", key: "p1", to: { id: "p1", overlord: "Alpha", puppet: "Beta" } },
      { id: "unit-add:u2", area: "map", kind: "unit-add", key: "u2", to: { id: "u2", name: "Fleet" } },
    ],
  });
  assert.deepEqual(suggestion.changes.map((change) => change.id), ["meta:name", "unit-add:u2"]);
});

test("against the author's scenario now, each details change is open, a conflict or already applied", () => {
  const snapshot = buildScenarioSnapshot({ ...bundle(), scenario: { ...bundle().scenario, description: "A world, by its author." } });
  const name = { id: "meta:name", area: "details", kind: "field", path: ["meta", "name"], from: "Old World", to: "New World" };
  const description = { id: "meta:description", area: "details", kind: "field", path: ["meta", "description"], from: "A world.", to: "A world, fixed." };
  const rules = { id: "world:simulationRules", area: "details", kind: "field", path: ["world", "simulationRules"], from: "", to: "No airships." };
  assert.equal(detailChangeStatus(name, snapshot), "open");
  assert.equal(detailChangeStatus(description, snapshot), "conflict", "the author rewrote it since posting");
  assert.equal(detailChangeStatus({ ...rules, to: "" }, snapshot), "applied");
});

test("accepting builds one save: meta, game, world, features, prompts, Politics entries and assets", () => {
  const details = {
    scenario: { features: {} },
    data: {
      prompts: { promptModel: 2, guidance: { leader: { tone: "Speak plainly." } } },
      world: { institutions: [{ id: "league", name: "The League", members: ["Alpha"] }, { id: "pact", name: "The Pact" }] },
    },
  };
  const { patch, uploads, clears } = buildDetailSave([
    { area: "details", kind: "field", path: ["meta", "name"], to: "New World" },
    { area: "details", kind: "field", path: ["game", "language"], to: "French" },
    { area: "details", kind: "field", path: ["world", "simulationRules"], to: "No airships." },
    { area: "details", kind: "field", path: ["features", "espionage", "enabled"], to: false },
    { area: "details", kind: "field", path: ["prompts", "advisor", "role"], to: "You are a gruff general." },
    { area: "details", kind: "field", path: ["prompts", "leader", "tone"], to: "" },
    { area: "details", kind: "politics", field: "institutions", container: "list", entry: "league", op: "change", to: { id: "league", name: "The Grand League", members: ["Alpha", "Beta"] } },
    { area: "details", kind: "politics", field: "institutions", container: "list", entry: "pact", op: "remove", to: null },
    { area: "details", kind: "stats", to: { version: 2, sections: [] } },
    { area: "details", kind: "cover", to: null },
  ], details);
  assert.equal(patch.name, "New World");
  assert.deepEqual(patch.gamePatch, { language: "French" });
  assert.equal(patch.worldPatch.language, "French", "the drawer keeps the language in both");
  assert.equal(patch.worldPatch.simulationRules, "No airships.");
  assert.equal(patch.features.espionage.enabled, false);
  assert.equal(patch.features.idleDiplomacy.enabled, true, "the rest of the configuration is kept");
  assert.deepEqual(patch.prompts, { promptModel: 2, guidance: { advisor: { role: "You are a gruff general." }, leader: {}, tasks: {} } });
  assert.deepEqual(patch.worldPatch.institutions, [{ id: "league", name: "The Grand League", members: ["Alpha", "Beta"] }]);
  assert.deepEqual(uploads, [{ key: "stats", json: { version: 2, sections: [] } }]);
  assert.deepEqual(clears, ["cover"]);
});

test("a change of projection is kept when it names one, and dropped when it does not", () => {
  const change = (to) => ({ id: "map:projection", area: "map", kind: "projection", from: { type: "mercator" }, to });
  const read = (to) => normalizeSuggestion({ schema: SUGGESTION_SCHEMA, changes: [change(to)] }).changes;
  assert.deepEqual(read({ type: "equirectangular", globe: false }).map((entry) => entry.kind), ["projection"]);
  assert.deepEqual(read(null), []);
  assert.deepEqual(read({ aspect: 2 }), []);
});
