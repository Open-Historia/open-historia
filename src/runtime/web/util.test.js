/*! Open Historia — web-mode store utilities © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/web/util.test.js
//
// binaryResponse is what the interceptor answers a pmtiles range read with when
// a scenario carries its own archive — and, in the Android app, the shape every
// archive read takes. pmtiles asks for byte ranges; a wrong 206 is a map that
// renders nothing, silently.
import test from "node:test";
import assert from "node:assert/strict";
import { binaryResponse, sha256Hex } from "./util.js";

const bytes = new Uint8Array(100).map((_, index) => index);

test("no Range header: the whole thing, 200, with the length and Accept-Ranges", async () => {
  const response = binaryResponse(bytes, "application/octet-stream");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), "100");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await response.arrayBuffer()).byteLength, 100);
});

test("a closed range is a 206 with exactly those bytes and a Content-Range", async () => {
  const response = binaryResponse(bytes, "application/octet-stream", "bytes=10-19");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 10-19/100");
  assert.equal(response.headers.get("Content-Length"), "10");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});

test("an open-ended range runs to the end, and a suffix range takes the last bytes", async () => {
  const open = binaryResponse(bytes, "x/y", "bytes=95-");
  assert.equal(open.status, 206);
  assert.equal(open.headers.get("Content-Range"), "bytes 95-99/100");
  const suffix = binaryResponse(bytes, "x/y", "bytes=-3");
  assert.equal(suffix.status, 206);
  assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())], [97, 98, 99]);
});

test("a range past the end is 416 with the total, and a malformed one is the whole thing", async () => {
  assert.equal(binaryResponse(bytes, "x/y", "bytes=200-300").status, 416);
  assert.equal(binaryResponse(bytes, "x/y", "bytes=200-300").headers.get("Content-Range"), "bytes */100");
  assert.equal(binaryResponse(bytes, "x/y", "garbage").status, 200);
});

test("sha256Hex is the shared one, so it works without WebCrypto", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
