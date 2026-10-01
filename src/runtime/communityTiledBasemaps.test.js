/*! Open Historia — Tiled Basemap hub posts © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/communityTiledBasemaps.test.js
// The post the game prefills for a Tiled Basemap (docs/adr/0005), read back the
// way the hub lists it: this version finds a detailed map with its release link,
// size and preview; an older version (main) finds nothing it can install,
// because the post carries no picture for it to take for an image basemap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { basemapPostInstallable, fetchCommunityBasemaps, publishBasemap } from "./communityBasemaps.js";

const HASH = "a".repeat(64);
const PMTILES = "https://github.com/someone/maps/releases/download/v1/westeros.pmtiles";
const PREVIEW = "https://github.com/someone/maps/releases/download/v1/westeros-preview.png";

// What GitHub makes of a submitted issue form: each field under its label.
const submittedBody = (formUrl) => {
  const params = new URL(formUrl).searchParams;
  return `### Basemap name\n\n${params.get("name")}\n\n### Basemap image\n\n${params.get("image")}\n\n### Technical info (do not edit)\n\n${params.get("technical")}`;
};

const prefilledPost = async (meta) => {
  let opened = null;
  globalThis.window = { open: (url) => { opened = url; } };
  try {
    await publishBasemap(meta, null);
  } finally {
    delete globalThis.window;
  }
  assert.ok(opened, "the prefilled post opens");
  return submittedBody(opened);
};

const listedAs = async (body) => {
  const issue = { number: 7, title: "[Basemap] Westeros", body, user: { login: "someone" }, html_url: "https://github.com/x/y/issues/7", created_at: "2026-10-01T00:00:00Z", reactions: {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes("labels=basemap") ? [issue] : []) });
  try {
    return (await fetchCommunityBasemaps({ force: true }))[0];
  } finally {
    globalThis.fetch = realFetch;
  }
};

const META = { kind: "tiled", name: "Westeros", contentHash: HASH, bytes: 463431905, source: { payloadUrl: PMTILES, previewUrl: PREVIEW } };

test("a Tiled Basemap's prefilled post lists as a detailed map, with its release link, size and preview", async () => {
  const post = await listedAs(await prefilledPost(META));
  assert.equal(post.kind, "tiled");
  assert.equal(post.tiledUrl, PMTILES);
  assert.equal(post.bytes, 463431905);
  assert.equal(post.contentHash, HASH);
  assert.equal(post.coverImageUrl, PREVIEW);
  assert.ok(basemapPostInstallable(post));
});

test("an older game finds nothing to install in a Tiled Basemap's post", async () => {
  const body = await prefilledPost(META);
  // main's readers (src/runtime/communityBasemaps.js there): a post picture is
  // an image basemap, and these data-file links are a basemap bundle.
  const OLD_COVER_IMAGE = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)|<img[^>]+src=["']([^"']+)["']/i;
  const OLD_BUNDLE_LINK = /https:\/\/(?:github\.com\/[^\s)<>"']+\/releases\/download\/[^\s)<>"']+\.(?:json|geojson|zip)|github\.com\/[^\s)<>"']+\/files\/[^\s)<>"']+|github\.com\/user-attachments\/files\/[^\s)<>"']+|raw\.githubusercontent\.com\/[^\s)<>"']+\.(?:json|geojson))/i;
  assert.equal(OLD_COVER_IMAGE.test(body), false, "no picture an older game would install as the map");
  assert.equal(OLD_BUNDLE_LINK.test(body), false, "no link an older game would read as a basemap bundle");
});

test("a Tiled Basemap's post without a preview has no card picture rather than a wrong one", async () => {
  const post = await listedAs(await prefilledPost({ ...META, source: { payloadUrl: PMTILES } }));
  assert.equal(post.coverImageUrl, null);
  assert.equal(post.tiledUrl, PMTILES);
});
