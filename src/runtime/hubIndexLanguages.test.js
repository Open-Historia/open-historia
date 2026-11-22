/*! Open Historia — the hub index keeps which languages a scenario ships: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubIndexLanguages.test.js
//
// The hub's check reads a scenario's language packs (server/scenarioLanguages.js)
// and its index lists their codes as `scenario_languages`; the Community tab
// says "Languages: …" on the scenario's page. The game's reading of the index
// keeps the codes, and only codes.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHubIndex } from "./hubFiles.js";
import { parsePost } from "./hubPosts.js";

const post = (number, languages) => ({
  number,
  kind: "scenario",
  state: "open",
  title: `[Scenario] Number ${number}`,
  body: "A scenario.",
  user: { login: "someone", avatar_url: null },
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
  labels: ["scenario"],
  author_association: "NONE",
  reactions: { "+1": 0 },
  comments: 0,
  ...(languages === undefined ? {} : { scenario_languages: languages }),
});

test("a post keeps the languages its scenario ships, as codes, through the index to the Community tab", () => {
  const index = normalizeHubIndex({
    version: 2,
    posts: [
      post(1, ["de", "fr", "zh-Hant"]),
      post(2),
      post(3, ["de", "de", "en", "__proto__", "<script>", 4, "x".repeat(20)]),
      post(4, "de"),
      post(5, Array.from({ length: 40 }, (_, index) => `a${String.fromCharCode(97 + (index % 26))}${index < 26 ? "" : "-x1"}`)),
    ],
  });
  assert.deepEqual(index.posts.map((entry) => entry.scenario_languages), [["de", "fr", "zh-Hant"], undefined, ["de"], undefined, index.posts[4].scenario_languages]);
  assert.equal(index.posts[4].scenario_languages.length, 24, "no more than a scenario can carry");
  const posts = index.posts.map((issue) => parsePost(issue, index));
  assert.deepEqual(posts[0].languages, ["de", "fr", "zh-Hant"]);
  assert.deepEqual(posts[1].languages, []);
});
