/*! Open Historia — the hub index keeps when each scenario begins: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubIndexDates.test.js
//
// "the start date end date filtering just does not work on the community tab"
// (the owner, 2026-10-29): the index's posts carry scenario_date, and the
// game's reading of the index left it out, so every post had no start date
// and any From or To hid them all.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeHubIndex } from "./hubFiles.js";
import { parsePost } from "./hubPosts.js";
import { dateRangeBound, startsBetween } from "./scenarioDateRange.js";

const post = (number, scenarioDate) => ({
  number,
  kind: "scenario",
  state: "open",
  title: `[Scenario] Number ${number}`,
  body: "A scenario.",
  user: { login: "someone", avatar_url: null },
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  labels: ["scenario"],
  author_association: "NONE",
  reactions: { "+1": 0 },
  comments: 0,
  ...(scenarioDate === undefined ? {} : { scenario_date: scenarioDate }),
});

test("a post keeps its scenario's start date through the index, and the Community tab's range finds it", () => {
  const index = normalizeHubIndex({
    version: 2,
    files: {},
    imports: {},
    suggestions: {},
    posts: [post(1, "1935-12-01"), post(2, "2016-01-01"), post(3, "317-1-1"), post(4, "-218-03-01"), post(5)],
  });
  assert.deepEqual(index.posts.map((entry) => entry.scenario_date), ["1935-12-01", "2016-01-01", "317-1-1", "-218-03-01", undefined]);
  const posts = index.posts.map((issue) => parsePost(issue, index));
  const between = (from, to) => posts.filter((entry) => startsBetween(entry.startDate, dateRangeBound(from), dateRangeBound(to, { end: true }))).map((entry) => entry.id);
  assert.deepEqual(between("1900", "1950"), [1]);
  assert.deepEqual(between("1900", ""), [1, 2]);
  assert.deepEqual(between("", "1000"), [3, 4]);
  assert.deepEqual(between("300 BC", "100 BC"), [4]);
  assert.deepEqual(between("", ""), [1, 2, 3, 4, 5], "no range: every post, dated or not");
});

test("a start date that is not a short line of text is left out", () => {
  const index = normalizeHubIndex({ version: 2, posts: [post(1, "x".repeat(41)), post(2, "1914\n"), post(3, 1914)] });
  assert.deepEqual(index.posts.map((entry) => entry.scenario_date), [undefined, undefined, undefined]);
});
