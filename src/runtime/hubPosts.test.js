/*! Open Historia — reading the community hub: post tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/hubPosts.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { parsePost } from "./hubPosts.js";

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
