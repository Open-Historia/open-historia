/*! Open Historia — the hub's index, its posts and its checked files: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubFiles.test.js
//
// The hub checks every file before it gives it out, and publishes what passed
// in its index: the posts, each file's checked copy in its releases, the
// counts, the suggestions it has checked. What has to hold:
//   - the index is read as a stranger's file: a field of the wrong type or
//     length is left out, a copy can only be in the hub's own releases, a
//     post's page only that hub's issue;
//   - an index from before the hub kept a list lists nothing, and none of its
//     copies is used: they were made without a look inside;
//   - a file is downloaded from its checked copy or not at all. The post's own
//     attachment is never fetched, whatever fails;
//   - a suggestion is fetched from its comment only once the index lists it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUB_FILE_TEXTS,
  HUB_INDEX_URL,
  MAX_POST_BODY,
  checkedSuggestionsOf,
  fetchHubFile,
  fetchHubIndex,
  hubIndexProblem,
  imageTypeOfBytes,
  importCountOf,
  normalizeHubIndex,
  releaseCopyOf,
  requireReleaseCopy,
  resetHubIndexCache,
} from "./hubFiles.js";
import { HUB_URL } from "./hubIssues.js";
import { parsePost } from "./hubPosts.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASES = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download";
const ATTACHMENT = "https://github.com/user-attachments/files/501/world-scenario.zip";
const COPY = `${RELEASES}/scenarios-1/p12-501-world-scenario-1a2b3c4d.zip`;
const COVER = "https://github.com/user-attachments/assets/aaaa-cover";
const COVER_COPY = `${RELEASES}/scenarios-1/p12-aaaa-9f8e7d6c.png`;
const SUGGESTION = "https://github.com/user-attachments/files/900/world-suggestion.zip";

// A post as the hub's index lists it: the field names of a GitHub issue.
const indexPost = (number, extra = {}) => ({
  number,
  kind: "scenario",
  state: "open",
  title: `[Scenario] Post ${number}`,
  body: `### Description\n\nA world.\n![cover](${COVER})\n[file](${ATTACHMENT})`,
  user: { login: "ann", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
  html_url: `${HUB_URL}/issues/${number}`,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-02T10:00:00Z",
  labels: ["scenario"],
  author_association: "NONE",
  reactions: { "+1": 3 },
  comments: 2,
  ...extra,
});
const INDEX = {
  version: 2,
  generatedAt: "2026-10-06T12:00:00.000Z",
  files: { [ATTACHMENT]: COPY, [COVER]: COVER_COPY },
  imports: { 12: 345 },
  posts: [indexPost(12)],
  suggestions: { 7001: { post: 12, zip: SUGGESTION } },
};

// fetch, answered by `routes` (URL -> Response | Error | function); every call recorded.
const mockFetch = (t, routes) => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    const answer = typeof route === "function" ? route() : route;
    if (answer instanceof Error) throw answer;
    if (!answer) return new Response("not found", { status: 404 });
    return answer.clone();
  };
  t.after(() => {
    globalThis.fetch = original;
    resetHubIndexCache();
  });
  resetHubIndexCache();
  return calls;
};
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const proxy = (url) => `/api/hub/file?url=${encodeURIComponent(url)}`;

test("the index is read from the hub's own branch", () => {
  assert.equal(HUB_INDEX_URL, "https://raw.githubusercontent.com/Open-Historia/Open-historia-scenarios/hub-index/index.json");
});

test("an index from before the hub kept a list lists nothing, and none of its copies is used", () => {
  const old = normalizeHubIndex({ version: 1, files: { [ATTACHMENT]: COPY }, imports: { 12: 345 } });
  assert.equal(old.listed, false);
  assert.deepEqual(old.files, {}, "a version 1 copy was made without a look inside it");
  assert.deepEqual(old.posts, []);
  assert.deepEqual(old.imports, { 12: 345 });
  assert.equal(releaseCopyOf(old, ATTACHMENT), null);
  assert.equal(hubIndexProblem(old), HUB_FILE_TEXTS.notListed);
  // A version that says 2 with no list is no better.
  assert.equal(normalizeHubIndex({ version: 2, files: { [ATTACHMENT]: COPY } }).listed, false);
  for (const junk of [null, undefined, [], "text", 4]) {
    assert.deepEqual(normalizeHubIndex(junk), { listed: false, files: {}, imports: {}, posts: [], suggestions: {} });
  }
});

test("only copies in the hub's own releases are taken from the index", () => {
  const index = normalizeHubIndex({
    ...INDEX,
    files: {
      [ATTACHMENT]: COPY,
      "https://github.com/user-attachments/files/9/a.zip": "https://evil.example/releases/download/x/a.zip",
      "https://github.com/user-attachments/files/10/b.zip": "https://github.com/someone/else/releases/download/x/b.zip",
      "https://github.com/user-attachments/files/11/c.zip": "http://github.com/Open-Historia/Open-historia-scenarios/releases/download/x/c.zip",
      "https://github.com/user-attachments/files/12/d.zip": 7,
      "https://github.com/user-attachments/files/13/e.zip": `${COPY}?download=https://evil.example/e.zip`,
      "https://github.com/user-attachments/files/14/f.zip": `${RELEASES}/x/${"f".repeat(700)}.zip`,
      "not an address": COPY,
    },
    imports: { 12: 345, 13: 0, 14: -2, 15: "many", 16: 1.5, title: 9 },
  });
  assert.equal(index.listed, true);
  assert.deepEqual(index.files, { [ATTACHMENT]: COPY });
  assert.deepEqual(index.imports, { 12: 345, 13: 0 });
});

test("a post of the index is read as a stranger's: types, lengths, GitHub's own avatar, this hub's own page", () => {
  const index = normalizeHubIndex({
    ...INDEX,
    posts: [
      indexPost(12, {
        title: "T".repeat(500),
        body: "b".repeat(MAX_POST_BODY + 500),
        user: { login: "  ann  ", avatar_url: "https://tracker.example/pixel.png" },
        html_url: "https://evil.example/issues/12",
        labels: ["scenario", "pinned", 5, "", "pinned", "x".repeat(200)],
        author_association: "EMPEROR",
        reactions: { "+1": "many", heart: 4 },
        comments: -3,
        state: "closed",
        pull_request: {},
      }),
      // Its kind only as `kind`: read as the label it stands for.
      indexPost(13, { kind: "flag", labels: [] }),
      indexPost(12, { title: "the same post twice" }),
      indexPost(0),
      indexPost(1.5),
      indexPost("14"),
      indexPost(15, { body: null }),
      indexPost(16, { created_at: "yesterday" }),
      indexPost(17, { user: "ann", reactions: null, labels: "scenario", updated_at: 5 }),
      "not a post",
      null,
    ],
  });
  assert.deepEqual(index.posts.map((post) => post.number), [12, 13, 17]);

  const [post, flag, bare] = index.posts;
  assert.equal(post.title.length, 300);
  assert.equal(post.body.length, MAX_POST_BODY);
  assert.deepEqual(post.user, { login: "ann", avatar_url: null }, "an avatar anywhere but GitHub's own host is not shown");
  assert.equal(post.html_url, `${HUB_URL}/issues/12`, "a card links to this hub's issue of that number, whatever the index says");
  assert.deepEqual(post.labels, ["scenario", "pinned"]);
  assert.equal(post.author_association, "NONE", "an association GitHub does not have makes nobody official");
  assert.deepEqual(post.reactions, { "+1": 0 });
  assert.equal(post.comments, 0);
  assert.equal(post.state, "closed", "a released post may be a closed issue");
  assert.equal(post.pull_request, undefined, "nothing the game does not read is carried");

  assert.deepEqual(flag.labels, ["flag"]);
  assert.equal(flag.user.avatar_url, "https://avatars.githubusercontent.com/u/1?v=4");
  assert.deepEqual(bare.user, { avatar_url: null });
  assert.deepEqual(bare.labels, ["scenario"], "its kind, at least");
  assert.equal(bare.updated_at, bare.created_at);
});

test("only a suggestion with a comment, a post and a .zip on GitHub is taken from the index", () => {
  const index = normalizeHubIndex({
    ...INDEX,
    suggestions: {
      7001: { post: 12, zip: SUGGESTION },
      7002: { post: 12, zip: "https://evil.example/x-suggestion.zip" },
      7003: { post: "12", zip: SUGGESTION },
      7004: { post: 12, zip: "https://github.com/user-attachments/files/901/notes.txt" },
      7005: { post: 13, zip: "https://github.com/user-attachments/files/902/other-suggestion.zip" },
      "c7006": { post: 12, zip: SUGGESTION },
      7007: SUGGESTION,
    },
  });
  assert.deepEqual(Object.keys(index.suggestions), ["7001", "7005"]);
  assert.deepEqual(checkedSuggestionsOf(index, 12), { 7001: SUGGESTION });
  assert.deepEqual(checkedSuggestionsOf(index, "13"), { 7005: "https://github.com/user-attachments/files/902/other-suggestion.zip" });
  assert.deepEqual(checkedSuggestionsOf(index, 14), {});
  assert.deepEqual(checkedSuggestionsOf(null, 12), {});
});

test("a copy and a count are looked up by the attachment's address and the post's number", () => {
  const index = normalizeHubIndex(INDEX);
  assert.equal(releaseCopyOf(index, ATTACHMENT), COPY);
  assert.equal(releaseCopyOf(index, ` ${ATTACHMENT} `), COPY);
  assert.equal(releaseCopyOf(index, "https://github.com/user-attachments/files/999/other.zip"), null);
  assert.equal(releaseCopyOf(index, "constructor"), null);
  assert.equal(releaseCopyOf(null, ATTACHMENT), null);
  assert.equal(releaseCopyOf(index, null), null);
  // A link keeps the copy it downloaded (hubOrigin.release): while the hub
  // still has that copy, it is asked for by its own address.
  assert.equal(releaseCopyOf(index, COPY), COPY);
  assert.equal(releaseCopyOf(index, `${RELEASES}/scenarios-1/p12-500-older-00000000.zip`), null, "a copy the hub has replaced is gone");
  assert.equal(importCountOf(index, 12), 345);
  assert.equal(importCountOf(index, "12"), 345);
  assert.equal(importCountOf(index, 13), null, "not counted yet is not zero");
  assert.equal(importCountOf(index, "constructor"), null);
});

test("the index is fetched once, kept, and shared by callers asking together", async (t) => {
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX) });
  const [a, b] = await Promise.all([fetchHubIndex(), fetchHubIndex()]);
  assert.equal(a, b);
  assert.deepEqual(a.imports, { 12: 345 });
  await fetchHubIndex();
  assert.equal(calls.length, 1);
  const [c, d] = await Promise.all([fetchHubIndex({ force: true }), fetchHubIndex({ force: true })]);
  assert.equal(c, d);
  assert.equal(calls.length, 2, "Refresh asks again, once for everyone who pressed it together");
});

test("an index that cannot be read lists nothing, says why, and is asked for again", async (t) => {
  let answer = new TypeError("Failed to fetch");
  const calls = mockFetch(t, { [HUB_INDEX_URL]: () => answer });
  const none = await fetchHubIndex();
  assert.equal(none.listed, false);
  assert.equal(hubIndexProblem(none), HUB_FILE_TEXTS.unreachable);
  answer = new Response("{ not json", { status: 200 });
  assert.equal(hubIndexProblem(await fetchHubIndex()), HUB_FILE_TEXTS.unreachable);
  assert.equal(calls.length, 2, "a miss is not kept for five minutes");
  // The hub's file as it was before it kept a list: read, and of no use yet.
  answer = json({ version: 1, files: { [ATTACHMENT]: COPY }, imports: {} });
  assert.equal(hubIndexProblem(await fetchHubIndex()), HUB_FILE_TEXTS.notListed);
  answer = json(INDEX);
  assert.equal(hubIndexProblem(await fetchHubIndex({ force: true })), null);
  // Once read, a later failure keeps the last.
  answer = new Response("busy", { status: 503 });
  assert.equal(releaseCopyOf(await fetchHubIndex({ force: true }), ATTACHMENT), COPY);
});

test("a post's file is downloaded from its checked copy, and its attachment is never touched", async (t) => {
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(COPY)]: new Response("copy bytes"), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  assert.equal(await requireReleaseCopy(ATTACHMENT), COPY);
  const response = await fetchHubFile(ATTACHMENT);
  assert.equal(await response.text(), "copy bytes");
  // Asked for by the copy's own address, it is the same download.
  assert.equal(await (await fetchHubFile(COPY)).text(), "copy bytes");
  assert.deepEqual(calls, [HUB_INDEX_URL, proxy(COPY), proxy(COPY)]);
});

test("a file with no checked copy is not downloaded at all", async (t) => {
  const other = "https://github.com/user-attachments/files/777/new-post.zip";
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(other)]: new Response("attachment bytes") });
  await assert.rejects(fetchHubFile(other), { message: HUB_FILE_TEXTS.notReleased });
  await assert.rejects(requireReleaseCopy(""), { message: HUB_FILE_TEXTS.notReleased });
  assert.deepEqual(calls, [HUB_INDEX_URL], "nothing was asked of the post instead");

  const offline = mockFetch(t, { [HUB_INDEX_URL]: new TypeError("Failed to fetch"), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  await assert.rejects(fetchHubFile(ATTACHMENT), { message: HUB_FILE_TEXTS.unreachable });
  assert.deepEqual(offline, [HUB_INDEX_URL]);

  const before = mockFetch(t, { [HUB_INDEX_URL]: json({ version: 1, files: { [ATTACHMENT]: COPY }, imports: {} }), [proxy(COPY)]: new Response("unchecked copy") });
  await assert.rejects(fetchHubFile(ATTACHMENT), { message: HUB_FILE_TEXTS.notListed });
  assert.deepEqual(before, [HUB_INDEX_URL], "a copy nobody looked inside is not downloaded either");
});

test("a copy that will not download fails as it is, with no second try at the attachment", async (t) => {
  const gone = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  const response = await fetchHubFile(ATTACHMENT);
  assert.equal(response.status, 404, "the caller reads the failure and says it");
  assert.deepEqual(gone, [HUB_INDEX_URL, proxy(COPY)]);

  const broken = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(COPY)]: new TypeError("Failed to fetch"), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  await assert.rejects(fetchHubFile(ATTACHMENT), /Failed to fetch/);
  assert.deepEqual(broken, [HUB_INDEX_URL, proxy(COPY)]);
});

test("a suggestion is fetched from its comment, once the hub has checked it", async (t) => {
  const waiting = "https://github.com/user-attachments/files/901/new-suggestion.zip";
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(SUGGESTION)]: new Response("suggestion bytes"), [proxy(waiting)]: new Response("unchecked bytes") });
  assert.equal(await (await fetchHubFile(SUGGESTION, { copy: false })).text(), "suggestion bytes");
  await assert.rejects(fetchHubFile(waiting, { copy: false }), { message: HUB_FILE_TEXTS.suggestionUnchecked });
  // A post's file is not a suggestion, and a suggestion is no post's file.
  await assert.rejects(fetchHubFile(ATTACHMENT, { copy: false }), { message: HUB_FILE_TEXTS.suggestionUnchecked });
  await assert.rejects(fetchHubFile(SUGGESTION), { message: HUB_FILE_TEXTS.notReleased });
  assert.deepEqual(calls, [HUB_INDEX_URL, proxy(SUGGESTION)]);

  const offline = mockFetch(t, { [HUB_INDEX_URL]: new TypeError("Failed to fetch"), [proxy(SUGGESTION)]: new Response("suggestion bytes") });
  await assert.rejects(fetchHubFile(SUGGESTION, { copy: false }), { message: HUB_FILE_TEXTS.unreachable });
  assert.deepEqual(offline, [HUB_INDEX_URL]);
});

test("a copy says what kind of image it is by its bytes", () => {
  assert.equal(imageTypeOfBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(imageTypeOfBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageTypeOfBytes(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(imageTypeOfBytes(new TextEncoder().encode("RIFF\u0010\u0000\u0000\u0000WEBPVP8 ")), "image/webp");
  assert.equal(imageTypeOfBytes(new TextEncoder().encode("RIFF\u0010\u0000\u0000\u0000WAVEfmt ")), "");
  assert.equal(imageTypeOfBytes(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), "", "the hub releases no SVG");
  assert.equal(imageTypeOfBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer), "image/png", "an ArrayBuffer is read too");
  assert.equal(imageTypeOfBytes(null), "");
});

test("a post reads its count, its file's copy, its cover's copy and its checked suggestions from the index", () => {
  const index = normalizeHubIndex(INDEX);
  const parsed = parsePost(index.posts[0], index);
  assert.equal(parsed.installs, 345);
  assert.equal(parsed.bundleUrl, ATTACHMENT, "the post's identity stays its attachment, so a new copy of the same file never looks like a new version");
  assert.equal(parsed.releaseUrl, COPY);
  assert.equal(parsed.coverImageUrl, COVER_COPY, "the cover is shown from its copy, never from the attachment");
  assert.deepEqual(parsed.checkedSuggestions, { 7001: SUGGESTION });

  const other = parsePost({ ...index.posts[0], number: 99 }, index);
  assert.equal(other.installs, null);
  assert.deepEqual(other.checkedSuggestions, {});
  // No copy, no picture and nothing to import.
  const bare = parsePost(index.posts[0], normalizeHubIndex({ ...INDEX, files: {} }));
  assert.equal(bare.coverImageUrl, null);
  assert.equal(bare.releaseUrl, null);
  assert.equal(parsePost(index.posts[0]).installs, null);
});

// Every hub download goes through fetchHubFile, nothing lists the hub through
// GitHub's API, and nothing calls the old counter.
test("the game downloads hub files through hubFiles.js only, asks GitHub's API for comments only, and reports imports nowhere", () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|jsx)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) sources.push(full);
    }
  };
  walk(path.join(ROOT, "src"));
  const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
  const code = (file) => fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const proxyCallers = sources.filter((file) => /fetch\(\s*[`"']\/api\/hub\/file/.test(fs.readFileSync(file, "utf8"))).map(rel);
  assert.deepEqual(proxyCallers, ["src/runtime/hubFiles.js"]);

  // GitHub's API: named in hubIssues.js (the address) and asked by
  // hubPosts.js, for one post's comments.
  const apiUsers = sources.filter((file) => /\bHUB_API\b|api\.github\.com/.test(code(file))).map(rel).sort();
  assert.deepEqual(apiUsers, ["src/runtime/hubIssues.js", "src/runtime/hubPosts.js"]);
  const apiCalls = code(path.join(ROOT, "src/runtime/hubPosts.js")).match(/`\$\{HUB_API\}[^`]*`/g);
  assert.deepEqual(apiCalls, ["`${HUB_API}/issues/${id}/comments?per_page=100`"]);
  for (const file of sources) assert.doesNotMatch(code(file), /issues\?state=|[?&]labels=/, `${rel(file)} lists no issues`);

  const counter = [...sources, path.join(ROOT, "server", "server.js")]
    .filter((file) => /api\/hub\/import-(?:log|counts)|IMPORT_COUNTER_URL|oh-import-counter/.test(code(file)))
    .map(rel);
  assert.deepEqual(counter, []);
  const suggestions = fs.readFileSync(path.join(ROOT, "src/Game/GameUI/ScenarioSuggestions.jsx"), "utf8");
  assert.match(suggestions, /downloadHubFile\(source\.ref\.zipUrl, \{ copy: false \}\)/);
});
