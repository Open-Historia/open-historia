// Run: node --test src/runtime/web/coverUrls.test.js
//
// A cover is one object URL per version of its record, not a base64 data: URL
// rebuilt on every listing (coverUrls.js).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCoverUrlCache } from "./coverUrls.js";

const fakeUrls = () => {
  const made = [];
  const revoked = [];
  const urlFor = createCoverUrlCache({
    createObjectURL: (blob) => { made.push(blob); return `blob:test/${made.length}`; },
    revokeObjectURL: (url) => revoked.push(url),
  });
  return { urlFor, made, revoked };
};
const cover = (n = 4, contentType = "image/webp") => ({ contentType, bytes: new Uint8Array(n).fill(7) });

test("listing a cover again hands out the same URL, made once", () => {
  const { urlFor, made } = fakeUrls();
  const first = urlFor("scenario:a", "a-2026-09-26T10:00:00.000Z", cover());
  const again = urlFor("scenario:a", "a-2026-09-26T10:00:00.000Z", cover());
  assert.equal(first, "blob:test/1");
  assert.equal(again, first);
  assert.equal(made.length, 1);
  assert.equal(made[0].type, "image/webp");
  assert.equal(made[0].size, 4);
});

test("a changed cover gets a new URL and the old one is revoked", () => {
  const { urlFor, revoked } = fakeUrls();
  const first = urlFor("game:g", "g-1", cover(4));
  const second = urlFor("game:g", "g-2", cover(8));
  assert.notEqual(second, first);
  assert.deepEqual(revoked, [first]);
  assert.equal(urlFor("game:g", "g-3", undefined), null, "a removed cover has no URL");
  assert.deepEqual(revoked, [first, second]);
});

test("scenarios and games keep their own URLs", () => {
  const { urlFor } = fakeUrls();
  assert.notEqual(urlFor("scenario:x", "t", cover()), urlFor("game:x", "t", cover()));
});

test("the website's library never builds a cover data: URL", () => {
  const store = fs.readFileSync(new URL("./libraryStore.js", import.meta.url), "utf8");
  assert.ok(!/coverDataUrl|data:\$\{cover/.test(store), "covers are object URLs (coverUrls.js)");
  assert.equal((store.match(/coverObjectUrl\(`(?:scenario|game):/g) || []).length, 2, "the scenario and the game listings");
});
