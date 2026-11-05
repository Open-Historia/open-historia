/*! Open Historia — the Submit map button opens the hub's detailed map form, filled in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/officialBasemapSubmission.test.js
// The Maps window's ⤴ on an author's own detailed map opens the hub's "Share a
// detailed map" form (docs/adr/0006), with what the game knows about the file
// filled in by the form's field ids.
import assert from "node:assert/strict";
import { test } from "node:test";
import { officialBasemapSubmissionUrl } from "./tiledBasemaps.js";

const HASH = "a".repeat(64);
const fields = (url) => Object.fromEntries(new URL(url).searchParams);

test("a new map opens the form with its name, size and checksum", () => {
  const url = officialBasemapSubmissionUrl({ name: "Middle Earth", bytes: 463431905, contentHash: HASH });
  assert.ok(url.startsWith("https://github.com/Open-Historia/Open-historia-scenarios/issues/new?"));
  assert.deepEqual(fields(url), {
    template: "detailed-map.yml",
    title: "[Detailed map] Middle Earth",
    name: "Middle Earth",
    size: "463431905 bytes (442 MB)",
    sha256: HASH,
  });
});

test("the link stays short: no long body, and nothing it does not know", () => {
  const url = officialBasemapSubmissionUrl({ name: "X" });
  assert.equal(fields(url).body, undefined);
  assert.equal(fields(url).size, undefined);
  assert.equal(fields(url).sha256, undefined);
  assert.ok(url.length < 400);
});
