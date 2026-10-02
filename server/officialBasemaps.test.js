/*! Open Historia — the official list of detailed basemaps © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/officialBasemaps.test.js
// The list is read from GitHub, so every entry is checked as it is read
// (docs/adr/0006-official-basemap-list.md): a bad entry is dropped on its own,
// and nothing outside the official repository's releases is ever downloadable.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OFFICIAL_RELEASES_PREFIX,
  createOfficialCatalogReader,
  findOfficialEntry,
  isOfficialReleaseUrl,
  latestOfficialVersion,
  parseOfficialCatalog,
} from "./officialBasemaps.js";

const HASH = (c) => c.repeat(64);
const release = (file) => `${OFFICIAL_RELEASES_PREFIX}got-world-v9/${file}`;
const good = (version, extra = {}) => ({ version, url: release(`terrain-v${version}.pmtiles`), bytes: 1000 + version, sha256: HASH(String(version % 10)), ...extra });

test("only the official repository's release downloads count", () => {
  assert.equal(isOfficialReleaseUrl(release("terrain-v9.pmtiles")), true);
  for (const bad of [
    "https://github.com/someone/maps/releases/download/v1/terrain.pmtiles",
    "https://github.com/Open-Historia/Open-Historia-basemaps-evil/releases/download/v1/x.pmtiles",
    "http://github.com/Open-Historia/Open-Historia-basemaps/releases/download/v1/x.pmtiles",
    `${release("x.pmtiles")}?redirect=https://example.com`,
    "https://example.com/Open-Historia/Open-Historia-basemaps/releases/download/v1/x.pmtiles",
    "not a link",
    "",
  ]) assert.equal(isOfficialReleaseUrl(bad), false, bad);
});

test("each map's versions are checked, sorted, and one per number", () => {
  const { basemaps } = parseOfficialCatalog({
    format: 1,
    basemaps: [{
      id: "got-world",
      name: "Game of Thrones world map",
      author: "Mark",
      license: "CC BY-NC-SA 3.0",
      versions: [
        good(10, { notes: "Sharper coasts", preview: release("preview.png") }),
        good(9),
        good(9, { bytes: 1 }),
        { ...good(11), url: "https://github.com/someone/maps/releases/download/v1/terrain.pmtiles" },
        { ...good(12), sha256: "not-a-hash" },
        { ...good(13), bytes: 0 },
        { ...good(14), version: 1.5 },
      ],
    }],
  });
  assert.equal(basemaps.length, 1);
  const [entry] = basemaps;
  assert.equal(entry.name, "Game of Thrones world map");
  assert.equal(entry.license, "CC BY-NC-SA 3.0");
  assert.deepEqual(entry.versions.map((v) => v.version), [9, 10]);
  assert.equal(entry.versions[0].bytes, 1009, "the first listing of a number wins");
  assert.equal(entry.versions[1].notes, "Sharper coasts");
  assert.equal(entry.versions[1].preview, release("preview.png"));
  assert.equal(latestOfficialVersion(entry).version, 10);
  assert.equal(findOfficialEntry({ basemaps }, "got-world"), entry);
  assert.equal(findOfficialEntry({ basemaps }, "nowhere"), null);
});

test("a bad map is dropped on its own; the rest of the list stands", () => {
  const { basemaps } = parseOfficialCatalog({
    basemaps: [
      { id: "Bad Id!", versions: [good(1)] },
      { id: "no-versions", versions: [] },
      { id: "only-bad-versions", versions: [{ ...good(1), sha256: "x" }] },
      { id: "kept", versions: [good(1)] },
      { id: "kept", versions: [good(2)] },
    ],
  });
  assert.deepEqual(basemaps.map((entry) => entry.id), ["kept"]);
  assert.equal(basemaps[0].name, "kept", "the id stands in for a missing name");
  assert.deepEqual(parseOfficialCatalog(null), { basemaps: [] });
  assert.deepEqual(parseOfficialCatalog({ basemaps: "nope" }), { basemaps: [] });
});

test("a version larger than the download cap is not offered", () => {
  const { basemaps } = parseOfficialCatalog({ basemaps: [{ id: "big", versions: [good(1, { bytes: 600 })] }] }, { cap: 500 });
  assert.deepEqual(basemaps, []);
});

const respond = (status, body = "", headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: new Headers(headers),
  text: async () => body,
});

test("the list is read once for a while, and the last good one is kept when it cannot be read", async () => {
  let calls = 0;
  let next = () => respond(200, JSON.stringify({ basemaps: [{ id: "kept", versions: [good(1)] }] }));
  let saved = null;
  const read = createOfficialCatalogReader({
    fetchHop: async () => { calls += 1; return next(); },
    isAllowed: () => true,
    readSaved: () => saved,
    save: (catalog) => { saved = catalog; },
    cap: 0,
  });
  const first = await read();
  assert.deepEqual(first.basemaps.map((entry) => entry.id), ["kept"]);
  assert.equal(first.stale, false);
  await read();
  assert.equal(calls, 1, "read again only after a while");

  next = () => respond(503);
  const stale = await read({ force: true });
  assert.equal(stale.stale, true);
  assert.match(stale.error, /HTTP 503/);
  assert.deepEqual(stale.basemaps.map((entry) => entry.id), ["kept"]);
});

test("with no list ever read, an unreachable one is empty, never an error", async () => {
  const read = createOfficialCatalogReader({
    fetchHop: async () => { throw new Error("offline"); },
    isAllowed: () => true,
    readSaved: () => { throw new Error("no file"); },
    save: () => {},
    cap: 0,
  });
  const list = await read();
  assert.deepEqual(list.basemaps, []);
  assert.equal(list.stale, true);
  assert.match(list.error, /offline/);
});

test("a list that redirects off GitHub is refused", async () => {
  const read = createOfficialCatalogReader({
    fetchHop: async () => respond(302, "", { location: "https://example.com/basemaps.json" }),
    isAllowed: (url) => url.hostname.endsWith("github.com") || url.hostname.endsWith("githubusercontent.com"),
    readSaved: () => null,
    save: () => {},
    cap: 0,
  });
  const list = await read();
  assert.deepEqual(list.basemaps, []);
  assert.match(list.error, /redirected off GitHub/);
});
