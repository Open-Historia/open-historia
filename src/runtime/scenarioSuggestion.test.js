/*! Open Historia — suggestions travelling between players: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scenarioSuggestion.test.js
//
// A suggestion goes from the player who edited a community scenario to its
// author as a comment on the post with a small .zip attached. What has to hold:
//   - the author's game recognises its own posts by the key Publish wrote, and
//     a suggestion by its file or its marker line, never any other comment;
//   - comments are read only for a post whose comment count moved;
//   - the .zip carries only the changes, and reads back exactly (a cover image
//     and a basemap travel as files of their own);
//   - a details change is "open", "conflict" or "applied" against the author's
//     scenario as it is now, and accepting builds the save that applies it.

import test from "node:test";
import assert from "node:assert/strict";

import { parsePost, parseSuggestionComment, postIdFromInput, refreshPublishedRecord } from "./hubPosts.js";
import {
  KNOWN_KINDS,
  SUGGESTION_SCHEMA,
  buildSuggestion,
  buildSuggestionComment,
  buildSuggestionZip,
  newPublishKey,
  normalizeSuggestion,
  readSuggestionFile,
  suggestionFileName,
} from "./scenarioSuggestion.js";
import { buildScenarioSnapshot, summarizeChangesForComment } from "./scenarioChanges.js";
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

test("the author's own posts are found by key, and comments read only when the count moved", async () => {
  const key = newPublishKey();
  const posts = [
    { id: 12, title: "Old World", author: "ann", scenarioKey: key, comments: 2 },
    { id: 13, title: "Other", author: "carl", scenarioKey: "", comments: 5 },
  ];
  const calls = [];
  const fetchComments = async (postId) => {
    calls.push(postId);
    return [
      { id: 1, body: "Nice!" },
      { id: 2, user: { login: "bob" }, body: `[old-world-suggestion.zip](${ZIP})` },
    ];
  };
  const first = await refreshPublishedRecord({ key, publishedAt: "2026-09-01T00:00:00Z" }, posts, { fetchComments });
  assert.equal(first.changed, true);
  assert.deepEqual(first.published.postIds, [12]);
  assert.equal(first.published.author, "ann");
  assert.deepEqual(first.published.suggestions.map((ref) => ref.id), ["c2"]);
  assert.deepEqual(calls, [12]);

  const again = await refreshPublishedRecord(first.published, posts, { fetchComments });
  assert.equal(again.changed, false);
  assert.deepEqual(calls, [12], "an unchanged post costs no request");

  // The suggester deleted their comment: the suggestion goes with it.
  const later = await refreshPublishedRecord(first.published, [{ ...posts[0], comments: 1 }], { fetchComments: async () => [{ id: 1, body: "Nice!" }] });
  assert.deepEqual(later.published.suggestions, []);

  // A blocked contributor's new comments are never stored.
  const flood = Array.from({ length: 30 }, (_, index) => ({ id: 100 + index, user: { login: "spam-bot" }, body: `[x-suggestion.zip](https://github.com/user-attachments/files/${index}/x-suggestion.zip)` }));
  const blocked = { ...first.published, blocked: ["spam-bot"], commentCounts: {} };
  const guarded = await refreshPublishedRecord(blocked, [{ ...posts[0], comments: 32 }], { fetchComments: async () => [...flood, { id: 2, user: { login: "bob" }, body: `[old-world-suggestion.zip](${ZIP})` }] });
  assert.deepEqual(guarded.published.suggestions.map((ref) => ref.author), ["bob"]);
});

const bundle = () => ({
  schema: "pax-historia-scenario-bundle/2",
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

test("every kind of change has a line in the comment", () => {
  for (const kind of KNOWN_KINDS) {
    const change = kind === "field"
      ? { id: kind, area: "details", kind, path: ["meta", "name"] }
      : { id: kind, area: "details", kind };
    assert.ok(summarizeChangesForComment([change]).length > 0, `a suggestion of one ${kind} change says what it is`);
  }
  const comment = buildSuggestionComment({ id: "sug-1", note: "", changes: [{ id: "institutionLogos", area: "details", kind: "institutionLogos" }] });
  assert.match(comment, /^- Institution logos changed$/m);
});

test("Link my post reads the post's number from its address, however it was copied", () => {
  const post = "https://github.com/Open-Historia/Open-historia-scenarios/issues/412";
  assert.equal(postIdFromInput(post), 412);
  assert.equal(postIdFromInput(`${post}#issuecomment-2345678901`), 412, "a comment's anchor is not the post's number");
  assert.equal(postIdFromInput(`${post}/`), 412);
  assert.equal(postIdFromInput(`${post}?utm_source=x`), 412);
  assert.equal(postIdFromInput(`  ${post}  `), 412);
  assert.equal(postIdFromInput("412"), 412);
  assert.equal(postIdFromInput("#412"), 412);
  assert.equal(postIdFromInput(""), null);
  assert.equal(postIdFromInput("my post"), null);
  assert.equal(postIdFromInput("0"), null);
  assert.equal(postIdFromInput(`${post}abc`), null);
});
