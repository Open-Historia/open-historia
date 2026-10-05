/*! Open Historia — the hub's files, from its releases: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubFiles.test.js
//
// A post's file is downloaded from its copy in the hub's releases, found
// through the hub's index; import counts come from the same index. Nothing
// about the index may stop a download: without it, or without a copy, the
// post's own attachment is fetched as before.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUB_INDEX_URL,
  fetchHubFile,
  fetchHubIndex,
  importCountOf,
  normalizeHubIndex,
  releaseCopyOf,
  resetHubIndexCache,
} from "./hubFiles.js";
import { parsePost } from "./hubPosts.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ATTACHMENT = "https://github.com/user-attachments/files/501/world-scenario.zip";
const COPY = "https://github.com/Open-Historia/Open-historia-scenarios/releases/download/scenarios-1/p12-501-world-scenario.zip";
const INDEX = { version: 1, files: { [ATTACHMENT]: COPY }, imports: { 12: 345 }, generatedAt: "2026-10-05T12:00:00.000Z" };

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

test("only copies in the hub's own releases are taken from the index", () => {
  const index = normalizeHubIndex({
    files: {
      [ATTACHMENT]: COPY,
      "https://github.com/user-attachments/files/9/a.zip": "https://evil.example/releases/download/x/a.zip",
      "https://github.com/user-attachments/files/10/b.zip": "https://github.com/someone/else/releases/download/x/b.zip",
      "https://github.com/user-attachments/files/11/c.zip": "http://github.com/Open-Historia/Open-historia-scenarios/releases/download/x/c.zip",
      "https://github.com/user-attachments/files/12/d.zip": 7,
    },
    imports: { 12: 345, 13: 0, 14: -2, 15: "many", 16: 1.5, title: 9 },
  });
  assert.deepEqual(index.files, { [ATTACHMENT]: COPY });
  assert.deepEqual(index.imports, { 12: 345, 13: 0 });
  for (const junk of [null, undefined, [], "text", 4]) assert.deepEqual(normalizeHubIndex(junk), { files: {}, imports: {} });
});

test("a copy and a count are looked up by the attachment's address and the post's number", () => {
  const index = normalizeHubIndex(INDEX);
  assert.equal(releaseCopyOf(index, ATTACHMENT), COPY);
  assert.equal(releaseCopyOf(index, ` ${ATTACHMENT} `), COPY);
  assert.equal(releaseCopyOf(index, "https://github.com/user-attachments/files/999/other.zip"), null);
  assert.equal(releaseCopyOf(null, ATTACHMENT), null);
  assert.equal(importCountOf(index, 12), 345);
  assert.equal(importCountOf(index, "12"), 345);
  assert.equal(importCountOf(index, 13), null, "not counted yet is not zero");
});

test("the index is fetched once, kept, and shared by callers asking together", async (t) => {
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX) });
  const [a, b] = await Promise.all([fetchHubIndex(), fetchHubIndex()]);
  assert.equal(a, b);
  assert.deepEqual(a.imports, { 12: 345 });
  await fetchHubIndex();
  assert.equal(calls.length, 1);
  await fetchHubIndex({ force: true });
  assert.equal(calls.length, 2, "Refresh asks again");
});

test("an index that cannot be read is no index, never an error, and is asked for again", async (t) => {
  let answer = new TypeError("Failed to fetch");
  const calls = mockFetch(t, { [HUB_INDEX_URL]: () => answer });
  assert.deepEqual(await fetchHubIndex(), { files: {}, imports: {} });
  answer = new Response("{ not json", { status: 200 });
  assert.deepEqual(await fetchHubIndex(), { files: {}, imports: {} });
  answer = json(INDEX);
  assert.equal(releaseCopyOf(await fetchHubIndex(), ATTACHMENT), COPY);
  assert.equal(calls.length, 3, "a miss is not kept for five minutes");
  // Once read, a later failure keeps the last one.
  answer = new Response("busy", { status: 503 });
  assert.equal(releaseCopyOf(await fetchHubIndex({ force: true }), ATTACHMENT), COPY);
});

test("a post's file is downloaded from its release copy", async (t) => {
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(COPY)]: new Response("copy bytes") });
  const response = await fetchHubFile(ATTACHMENT);
  assert.equal(await response.text(), "copy bytes");
  assert.deepEqual(calls, [HUB_INDEX_URL, proxy(COPY)], "the attachment itself is not touched");
});

test("a file with no copy yet, or with no index at all, comes from the post as before", async (t) => {
  const other = "https://github.com/user-attachments/files/777/new-post.zip";
  const calls = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(other)]: new Response("attachment bytes") });
  assert.equal(await (await fetchHubFile(other)).text(), "attachment bytes");
  assert.deepEqual(calls, [HUB_INDEX_URL, proxy(other)]);

  const offline = mockFetch(t, { [HUB_INDEX_URL]: new TypeError("Failed to fetch"), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  assert.equal(await (await fetchHubFile(ATTACHMENT)).text(), "attachment bytes");
  assert.deepEqual(offline, [HUB_INDEX_URL, proxy(ATTACHMENT)]);
});

test("a copy that will not download falls back to the post's attachment", async (t) => {
  const gone = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  assert.equal(await (await fetchHubFile(ATTACHMENT)).text(), "attachment bytes");
  assert.deepEqual(gone, [HUB_INDEX_URL, proxy(COPY), proxy(ATTACHMENT)]);

  const broken = mockFetch(t, { [HUB_INDEX_URL]: json(INDEX), [proxy(COPY)]: new TypeError("Failed to fetch"), [proxy(ATTACHMENT)]: new Response("attachment bytes") });
  assert.equal(await (await fetchHubFile(ATTACHMENT)).text(), "attachment bytes");
  assert.equal(broken.at(-1), proxy(ATTACHMENT));
});

test("a suggestion is a comment's attachment: never looked up, always fetched as it is", async (t) => {
  const suggestion = "https://github.com/user-attachments/files/900/old-world-suggestion.zip";
  const calls = mockFetch(t, { [proxy(suggestion)]: new Response("suggestion bytes") });
  assert.equal(await (await fetchHubFile(suggestion, { copy: false })).text(), "suggestion bytes");
  assert.deepEqual(calls, [proxy(suggestion)], "the index is not even read");
});

test("a post's import count is the one the hub's index reports", () => {
  const issue = { number: 12, title: "[Scenario] Old World", user: { login: "ann" }, body: `### Description\n\nA world.\n[file](${ATTACHMENT})` };
  const parsed = parsePost(issue, normalizeHubIndex(INDEX));
  assert.equal(parsed.installs, 345);
  assert.equal(parsed.bundleUrl, ATTACHMENT, "the post's identity stays its attachment, so a copy never looks like a new version");
  assert.equal(parsePost({ ...issue, number: 99 }, normalizeHubIndex(INDEX)).installs, null);
  assert.equal(parsePost(issue).installs, null);
});

// Every hub download goes through fetchHubFile, and nothing calls the old counter.
test("the game downloads hub files through hubFiles.js only, and reports imports nowhere", () => {
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
  const proxyCallers = sources.filter((file) => /fetch\(\s*[`"']\/api\/hub\/file/.test(fs.readFileSync(file, "utf8"))).map(rel);
  assert.deepEqual(proxyCallers, ["src/runtime/hubFiles.js"]);
  const counter = [...sources, path.join(ROOT, "server", "server.js")]
    .filter((file) => /api\/hub\/import-(?:log|counts)|IMPORT_COUNTER_URL|oh-import-counter/.test(fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "")))
    .map(rel);
  assert.deepEqual(counter, []);
  const suggestions = fs.readFileSync(path.join(ROOT, "src/Game/GameUI/ScenarioSuggestions.jsx"), "utf8");
  assert.match(suggestions, /downloadHubFile\(source\.ref\.zipUrl, \{ copy: false \}\)/);
});
