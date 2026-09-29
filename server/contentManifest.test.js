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
