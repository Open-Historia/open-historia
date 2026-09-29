/*! Open Historia — signed content manifest tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/contentManifest.test.js
//
// public/content-manifest.json is what the website checks every map archive
// against (src/runtime/web/contentTrust.js). A manifest whose signature does
// not cover it is rejected by every client, and nothing but a console line
// says so.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { verifySignedManifest } from "./trust.js";
import { assetListConflicts, buildContentManifest } from "../scripts/build-content-manifest.mjs";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

// The signature covers the LF bytes (.gitattributes keeps the file LF in every
// checkout, because the site serves it verbatim).
const lf = (text) => Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");

for (const name of ["public/content-manifest.json", "public/node-directory.json"]) {
  test(`${name} is signed by a pinned key over its LF bytes`, () => {
    const result = verifySignedManifest(lf(read(name)), read(`${name}.sig`));
    // An expired document is still a correct signature; tests.yml warns about expiry.
    assert.ok(result.valid || result.reason === "expired", `${name}: ${result.reason}`);
  });
}

// ---------------------------------------------------------------------------
// scripts/build-content-manifest.mjs builds the manifest from what the website
// fetches (scripts/map-assets.web.json). It used to build it from the desktop
// list, which names other files at other sizes, so following the docs would
// have signed hashes the website never receives.

const readJson = (relative) => JSON.parse(read(relative));

test("regenerating the manifest reproduces the committed one, stamps and all", () => {
  const committed = readJson("public/content-manifest.json");
  const { manifest, changed } = buildContentManifest({ web: readJson("scripts/map-assets.web.json"), previous: committed });
  assert.equal(changed, false, "scripts/map-assets.web.json and public/content-manifest.json have drifted apart: run node scripts/build-content-manifest.mjs and re-sign");
  assert.deepEqual(manifest, committed);
});

test("one release asset has one size and hash in every list that names it", () => {
  assert.deepEqual(assetListConflicts({
    "scripts/map-assets.web.json": readJson("scripts/map-assets.web.json"),
    "scripts/map-assets.json": readJson("scripts/map-assets.json"),
    "mobile/map-assets.android.json": readJson("mobile/map-assets.android.json"),
  }), []);
  assert.deepEqual(
    assetListConflicts({ a: { assets: [{ asset: "x.pmtiles", bytes: 1, sha256: "aa" }] }, b: { assets: [{ asset: "x.pmtiles", bytes: 2, sha256: "bb" }] } }),
    ["x.pmtiles: a and b disagree"],
  );
});

test("the manifest covers every archive the website asks for", () => {
  const { assets } = readJson("public/content-manifest.json");
  for (const key of ["regions", "countries", "cities"]) assert.ok(assets[`${key}.pmtiles`], `${key}.pmtiles`);
});

test("a changed asset list drops the old signing stamp so it cannot pass for signed", () => {
  const committed = readJson("public/content-manifest.json");
  const web = readJson("scripts/map-assets.web.json");
  const changedWeb = { ...web, assets: web.assets.map((entry) => (entry.asset === "cities.pmtiles" ? { ...entry, bytes: entry.bytes + 1 } : entry)) };
  const { manifest, changed } = buildContentManifest({ web: changedWeb, previous: committed });
  assert.equal(changed, true);
  assert.equal(manifest.keyid, undefined);
  assert.equal(manifest.expires, undefined);
  assert.equal(manifest.assets["cities.pmtiles"].bytes, committed.assets["cities.pmtiles"].bytes + 1);
});
