/*! Open Historia — the Submit map button opens the official form, filled in © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/officialBasemapSubmission.test.js
// The basemap picker's ⤴ on an author's own detailed map opens the "Submit a map
// or a map update" form in the official repository (docs/adr/0006), with what
// the game knows about the file filled in by the form's field ids.
import assert from "node:assert/strict";
import { test } from "node:test";
import { officialBasemapSubmissionUrl } from "./tiledBasemaps.js";

const HASH = "a".repeat(64);
const fields = (url) => Object.fromEntries(new URL(url).searchParams);

test("a new map opens the form with its name, size and checksum", () => {
  const url = officialBasemapSubmissionUrl({ name: "Middle Earth", bytes: 463431905, contentHash: HASH });
  assert.ok(url.startsWith("https://github.com/Open-Historia/open-historia-basemaps/issues/new?"));
  assert.deepEqual(fields(url), {
    template: "map-request.yml",
    title: "[Submit map] Middle Earth",
    kind: "New map",
    name: "Middle Earth",
    size: "463431905 bytes (442 MB)",
    sha256: HASH,
  });
});

test("a newer copy of an official map is an update, with its map id", () => {
  const url = officialBasemapSubmissionUrl({ name: "Game of Thrones world map", bytes: 10, contentHash: HASH, official: { id: "got-world", version: 1 } });
  assert.equal(fields(url).kind, "Update to a map already on the list");
  assert.equal(fields(url)["map-id"], "got-world");
});

test("the link stays short: no long body, and nothing it does not know", () => {
  const url = officialBasemapSubmissionUrl({ name: "X" });
  assert.equal(fields(url).body, undefined);
  assert.equal(fields(url).size, undefined);
  assert.equal(fields(url).sha256, undefined);
  assert.ok(url.length < 400);
});
