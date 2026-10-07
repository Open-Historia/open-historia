/*! Open Historia — the community hub's issue lists: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubIssues.test.js
//
// Every hub screen reads the same lists of posts, and the lists are the hub's
// own: its index holds a post once its file has been checked and released.
// What has to hold: a list is the index's posts carrying a label, open or
// closed; it is read once and shared (callers at the same moment too); when
// the hub has no list to give, the read fails with a sentence and GitHub's API
// is not asked instead; and a post's comments, the one thing still read
// through that API, are read to the end or not at all.

import test from "node:test";
import assert from "node:assert/strict";

import { HUB_FILE_TEXTS, HUB_INDEX_URL, normalizeHubIndex, resetHubIndexCache } from "./hubFiles.js";
import { HUB_API, HUB_URL, fetchHubIssues, fetchHubPages, fetchHubScenarioIssues, firstHubImage, hubImageUrl, nextPageUrl } from "./hubIssues.js";
import { fetchPostComments, parsePost } from "./hubPosts.js";

// GitHub's list API over plain arrays: `pages[url]` is a page, or a status.
// The hub's index is served from `pages[HUB_INDEX_URL]` as it is.
const serve = (pages) => {
  const calls = [];
  resetHubIndexCache();
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const page = pages[url];
    if (typeof page === "number") return { ok: false, status: page, headers: new Map(), json: async () => ({}) };
    if (!page) throw new TypeError("offline");
    if (url === HUB_INDEX_URL) return { ok: true, status: 200, headers: new Map(), json: async () => page };
    const headers = new Map(page.next ? [["link", `<${page.next}>; rel="next", <${page.next}>; rel="last"`]] : []);
    return { ok: true, status: 200, headers, json: async () => page.items };
  };
  return calls;
};
const post = (number, labels, extra = {}) => ({
  number,
  kind: labels[0],
  state: "open",
  title: `Post ${number}`,
  body: "",
  user: { login: "ann" },
  created_at: "2026-10-01T10:00:00Z",
  labels,
  ...extra,
});
const index = (posts) => ({ version: 2, files: {}, imports: {}, posts, suggestions: {} });

test("the next page is read from GitHub's Link header, and only GitHub's API is followed", () => {
  assert.equal(nextPageUrl('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'), "https://api.github.com/x?page=2");
  assert.equal(nextPageUrl('<https://api.github.com/x?page=1>; rel="prev"'), null);
  assert.equal(nextPageUrl('<https://example.com/x?page=2>; rel="next"'), null);
  assert.equal(nextPageUrl(null), null);
});

test("a list is the index's posts carrying a label, open or closed, read once for every caller", async () => {
  const calls = serve({
    [HUB_INDEX_URL]: index([
      post(31, ["scenario", "pinned"]),
      // Released, and closed by the hub for it: still a post.
      post(30, ["scenario"], { state: "closed" }),
      post(29, ["flag"]),
      post(28, ["basemap"]),
    ]),
  });
  const [a, b, flags] = await Promise.all([fetchHubIssues("scenario"), fetchHubScenarioIssues(), fetchHubIssues("flag")]);
  assert.deepEqual(a.map((entry) => entry.number), [31, 30], "newest first, as the hub lists them");
  assert.deepEqual(b, a);
  assert.deepEqual(flags.map((entry) => entry.number), [29]);
  assert.deepEqual((await fetchHubIssues("basemap")).map((entry) => entry.number), [28]);
  assert.deepEqual(await fetchHubIssues("pinned").then((list) => list.map((entry) => entry.number)), [31]);
  assert.deepEqual(calls, [HUB_INDEX_URL], "one read for every list, callers at the same moment included, and kept five minutes");
  assert.equal(a[0].html_url, `${HUB_URL}/issues/31`);

  await fetchHubIssues("scenario", { force: true });
  assert.deepEqual(calls, [HUB_INDEX_URL, HUB_INDEX_URL], "a forced read (Refresh) asks the hub again");
  assert.ok(calls.every((url) => !url.includes("api.github.com")), "GitHub's API is not asked for a list");
});

test("when the hub has no list to give, the read says why, and GitHub's API is not asked instead", async () => {
  // The index as the hub published it before it checked anything.
  const before = serve({ [HUB_INDEX_URL]: { version: 1, files: {}, imports: { 12: 3 } } });
  await assert.rejects(fetchHubIssues("scenario"), { message: HUB_FILE_TEXTS.notListed });
  assert.deepEqual(before, [HUB_INDEX_URL]);

  const offline = serve({});
  await assert.rejects(fetchHubIssues("flag"), { message: HUB_FILE_TEXTS.unreachable });
  assert.deepEqual(offline, [HUB_INDEX_URL]);

  const missing = serve({ [HUB_INDEX_URL]: 404 });
  await assert.rejects(fetchHubScenarioIssues({ force: true }), { message: HUB_FILE_TEXTS.unreachable });
  assert.deepEqual(missing, [HUB_INDEX_URL]);
});

test("a post's image is one GitHub hosts, and a card shows its checked copy or nothing", () => {
  assert.equal(hubImageUrl("https://github.com/user-attachments/assets/abc"), "https://github.com/user-attachments/assets/abc");
  assert.equal(hubImageUrl("https://camo.githubusercontent.com/x/y"), "https://camo.githubusercontent.com/x/y");
  assert.equal(hubImageUrl("https://private-user-images.githubusercontent.com/1/2.png"), "https://private-user-images.githubusercontent.com/1/2.png");
  for (const url of ["https://tracker.example/pixel.png", "http://github.com/user-attachments/assets/abc", "https://github.com.evil.example/x.png", "https://github.com@evil.example/x.png", "//tracker.example/x.png", "https://evilgithubusercontent.com/x.png"]) {
    assert.equal(hubImageUrl(url), null, url);
  }
  const body = [
    '<img src="https://tracker.example/pixel.png">',
    "![map](https://tracker.example/map.png)",
    '<img width="600" src="https://github.com/user-attachments/assets/cover-1">',
  ].join("\n");
  assert.equal(firstHubImage(body), "https://github.com/user-attachments/assets/cover-1", "the first image GitHub hosts, past any other");
  assert.equal(firstHubImage("![x](https://tracker.example/x.png)"), null);

  // The cover a card shows is the image's copy in the hub's releases: an
  // image the hub has not copied is not loaded from its post instead.
  const copy = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download/scenarios-1/p5-cover-1-0a1b2c3d.png";
  const issue = { number: 5, title: "[Scenario] X", body, html_url: `${HUB_URL}/issues/5` };
  const noCopies = normalizeHubIndex(index([]));
  assert.equal(parsePost(issue, noCopies).coverImageUrl, null, "no copy, no picture: the Community tab falls back to its default cover");
  const withCopy = normalizeHubIndex({ ...index([]), files: { "https://github.com/user-attachments/assets/cover-1": copy } });
  assert.equal(parsePost(issue, withCopy).coverImageUrl, copy);
  assert.equal(parsePost({ ...issue, body: '<img src="https://tracker.example/pixel.png">' }, withCopy).coverImageUrl, null);
});

test("a post's comments are read to the last page, or not at all", async () => {
  const url = `${HUB_API}/issues/41/comments?per_page=100`;
  const calls = serve({
    [url]: { items: Array.from({ length: 100 }, (_, number) => ({ id: number + 1 })), next: `${url}&page=2` },
    [`${url}&page=2`]: { items: [{ id: 101, body: "the newest" }] },
  });
  const comments = await fetchPostComments(41, { force: true });
  assert.equal(comments.length, 101);
  assert.equal(comments.at(-1).body, "the newest", "a suggestion after the hundredth comment is found");
  assert.equal(calls.length, 2);

  serve({ [`${HUB_API}/issues/42/comments?per_page=100`]: { items: [{ id: 1 }], next: `${HUB_API}/issues/42/comments?per_page=100&page=2` } });
  await assert.rejects(fetchPostComments(42, { force: true }), /offline/);

  // A later page that fails fails the read, whatever came before it.
  const paged = `${HUB_API}/issues/7/comments?per_page=100`;
  serve({ [paged]: { items: [{ id: 1 }], next: `${paged}&page=2` }, [`${paged}&page=2`]: 500 });
  await assert.rejects(fetchHubPages(paged), (error) => error.status === 500);
  serve({ [`${HUB_API}/issues/43/comments?per_page=100`]: 403 });
  await assert.rejects(fetchPostComments(43, { force: true }), /rate limit/);
});
