/*! Open Historia — the community hub's issue lists: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubIssues.test.js
//
// Every hub screen reads the same GitHub issue lists, 60 requests an hour per
// player. What has to hold: a list is read once and shared (callers at the
// same moment too), every page of it is read, and a post's comments are read
// to the end or not at all.

import test from "node:test";
import assert from "node:assert/strict";

import { HUB_API, fetchHubIssues, fetchHubPages, nextPageUrl } from "./hubIssues.js";
import { fetchPostComments } from "./hubPosts.js";

// GitHub's list API over plain arrays: `pages[url]` is a page, or a status.
const serve = (pages) => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const page = pages[url];
    if (typeof page === "number") return { ok: false, status: page, headers: new Map(), json: async () => ({}) };
    if (!page) throw new TypeError("offline");
    const headers = new Map(page.next ? [["link", `<${page.next}>; rel="next", <${page.next}>; rel="last"`]] : []);
    return { ok: true, status: 200, headers, json: async () => page.items };
  };
  return calls;
};
const issuesUrl = (label) => `${HUB_API}/issues?state=open&labels=${label}&per_page=100`;
const issue = (number, extra = {}) => ({ number, title: `Post ${number}`, body: "", ...extra });

test("the next page is read from GitHub's Link header, and only GitHub's API is followed", () => {
  assert.equal(nextPageUrl('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'), "https://api.github.com/x?page=2");
  assert.equal(nextPageUrl('<https://api.github.com/x?page=1>; rel="prev"'), null);
  assert.equal(nextPageUrl('<https://example.com/x?page=2>; rel="next"'), null);
  assert.equal(nextPageUrl(null), null);
});

test("an issue list is every page, without pull requests, read once for every caller", async () => {
  const first = issuesUrl("paged");
  const second = `${first}&page=2`;
  const calls = serve({
    [first]: { items: Array.from({ length: 100 }, (_, index) => issue(300 - index)), next: second },
    [second]: { items: [issue(150), issue(149, { pull_request: {} })] },
  });
  const [a, b] = await Promise.all([fetchHubIssues("paged"), fetchHubIssues("paged")]);
  assert.equal(a, b, "callers at the same moment share one read");
  assert.equal(a.length, 101, "the post past the first hundred is there");
  assert.equal(a.at(-1).number, 150);
  assert.deepEqual(calls, [first, second]);
  await fetchHubIssues("paged");
  assert.equal(calls.length, 2, "kept five minutes");
  await fetchHubIssues("paged", { force: true });
  assert.equal(calls.length, 4, "a forced read goes to GitHub again");
});

test("a list whose later page fails keeps what it read; a first page that fails says why", async () => {
  const first = issuesUrl("partial");
  const second = `${first}&page=2`;
  serve({ [first]: { items: [issue(2), issue(1)], next: second }, [second]: 403 });
  assert.deepEqual((await fetchHubIssues("partial")).map((entry) => entry.number), [2, 1]);

  serve({ [issuesUrl("limited")]: 403 });
  await assert.rejects(fetchHubIssues("limited"), (error) => error.status === 403);

  // Without `partial`, a later page failing fails the read.
  const url = `${HUB_API}/issues/7/comments?per_page=100`;
  serve({ [url]: { items: [{ id: 1 }], next: `${url}&page=2` }, [`${url}&page=2`]: 500 });
  await assert.rejects(fetchHubPages(url), (error) => error.status === 500);
});

test("a post's comments are read to the last page, or not at all", async () => {
  const url = `${HUB_API}/issues/41/comments?per_page=100`;
  const calls = serve({
    [url]: { items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })), next: `${url}&page=2` },
    [`${url}&page=2`]: { items: [{ id: 101, body: "the newest" }] },
  });
  const comments = await fetchPostComments(41, { force: true });
  assert.equal(comments.length, 101);
  assert.equal(comments.at(-1).body, "the newest", "a suggestion after the hundredth comment is found");
  assert.equal(calls.length, 2);

  serve({ [`${HUB_API}/issues/42/comments?per_page=100`]: { items: [{ id: 1 }], next: `${HUB_API}/issues/42/comments?per_page=100&page=2` } });
  await assert.rejects(fetchPostComments(42, { force: true }), /offline/);
});
