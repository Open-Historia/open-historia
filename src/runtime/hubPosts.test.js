/*! Open Historia — reading the community hub: post tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { hubCopiesByPostId, hubCopyStatus, hubUpdateAvailable, parsePost } from "./hubPosts.js";

const FILE = "https://github.com/user-attachments/files/1/old-world-scenario.zip";
const post = (body) => parsePost({ number: 12, title: "[Scenario] Old World", user: { login: "ann" }, body });

test("the detail view gets the author's whole description, line breaks and all", () => {
  const setup = "Start as Rome.  Hold Sicily\tby 260 BC.";
  const body = [
    "### Description",
    "",
    "A world before the Punic Wars.",
    "",
    "",
    "",
    "How to play:",
    `- ${setup}`,
    "- Watch Carthage's fleet.",
    `[old-world-scenario.zip](${FILE})`,
    "",
    "### Made by",
    "",
    "ann",
  ].join("\r\n");
  const parsed = post(body);
  assert.equal(
    parsed.fullDescription,
    "A world before the Punic Wars.\n\nHow to play:\n- Start as Rome. Hold Sicily by 260 BC.\n- Watch Carthage's fleet.",
    "paragraphs and list lines kept; runs of spaces, tabs and blank lines squeezed; the file link and other sections gone",
  );
  assert.equal(parsed.description, "A world before the Punic Wars. How to play: - Start as Rome. Hold Sicily by 260 BC. - Watch Carthage's fleet.");
});

test("cards and search still get one line of at most 200 characters", () => {
  const long = Array.from({ length: 30 }, (_, index) => `Line ${index} of the notes.`).join("\n");
  const parsed = post(`### Description\n\n${long}\n\n### Basemap info\n\nBasemap-Hash: ${"a".repeat(64)}`);
  assert.equal(parsed.description.length, 200);
  assert.ok(parsed.description.endsWith("..."));
  assert.doesNotMatch(parsed.description, /\n/);
  assert.equal(parsed.fullDescription, long, "the whole text survives for the detail view");
  assert.doesNotMatch(parsed.fullDescription, /Basemap-Hash/);
});

test("a heading with nothing after it no longer swallows the line below it", () => {
  assert.equal(post("An old post with no form.\n##\nSecond line.").fullDescription, "An old post with no form.\n\nSecond line.");
  assert.equal(post("### Description\n\n_No response_\n\n### Made by\n\nann").description, "");
});

const OLD = "https://github.com/user-attachments/files/1/v1.zip";
const NEW = "https://github.com/user-attachments/files/2/v2.zip";
const copy = (id, hubOrigin, updatedAt = "2026-09-01T00:00:00.000Z") => ({ id, name: id, updatedAt, hubOrigin });
const hubPost = { id: 12, bundleUrl: NEW };

test("an unedited copy of an older file can update; an edited one, another post's or a current one cannot", () => {
  assert.equal(hubUpdateAvailable(copy("a", { postId: 12, bundleUrl: OLD }), hubPost), true);
  assert.equal(hubUpdateAvailable(copy("b", { postId: 12, bundleUrl: NEW }), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("c", { postId: 12, bundleUrl: OLD, editedAt: "2026-09-02T00:00:00.000Z" }), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("d", { postId: 13, bundleUrl: OLD }), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("e", null), hubPost), false);
  assert.equal(hubUpdateAvailable(copy("f", { postId: 12, bundleUrl: OLD }), null), false, "a post off the list offers nothing");
});

test("the library's copies are grouped by post, and a card says what the library holds", () => {
  const mine = copy("mine", null);
  const edited = copy("edited", { postId: 12, bundleUrl: OLD, editedAt: "2026-09-03T00:00:00.000Z" }, "2026-09-05T00:00:00.000Z");
  const stale = copy("stale", { postId: 12, bundleUrl: OLD }, "2026-09-02T00:00:00.000Z");
  const fresh = copy("fresh", { postId: 12, bundleUrl: NEW }, "2026-09-01T00:00:00.000Z");
  const other = copy("other", { postId: 40, bundleUrl: OLD });
  const byPost = hubCopiesByPostId([mine, edited, stale, fresh, other]);
  assert.deepEqual([...byPost.keys()].sort((a, b) => a - b), [12, 40]);
  assert.deepEqual(byPost.get(12).map((entry) => entry.id), ["edited", "stale", "fresh"]);

  assert.deepEqual(hubCopyStatus(byPost.get(12), hubPost), { status: "current", copy: fresh }, "a current copy wins");
  assert.deepEqual(hubCopyStatus([edited, stale], hubPost), { status: "update", copy: stale }, "an unedited copy wins over a newer edited one");
  assert.deepEqual(hubCopyStatus([edited], hubPost), { status: "edited", copy: edited });
  assert.deepEqual(hubCopyStatus(undefined, hubPost), { status: null, copy: null });

  const later = copy("later", { postId: 12, bundleUrl: NEW }, "2026-09-09T00:00:00.000Z");
  assert.equal(hubCopyStatus([fresh, later], hubPost).copy, later, "of several, the one touched last");
});
