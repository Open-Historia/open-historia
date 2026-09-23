import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WholeFileSource } from "./wholeFileSource.js";

const archive = Uint8Array.from({ length: 256 }, (_, index) => index);
const bytesOf = (result) => [...new Uint8Array(result.data)];

test("a read returns exactly the requested bytes, never the rest of the file", async () => {
  const source = new WholeFileSource("/api/runtime/pmtiles/regions", async () => archive.buffer);
  const result = await source.getBytes(100, 16);
  assert.equal(result.data.byteLength, 16);
  assert.deepEqual(bytesOf(result), Array.from({ length: 16 }, (_, index) => 100 + index));
});

test("reads are clamped at the end of the archive", async () => {
  const source = new WholeFileSource("x", async () => archive.buffer);
  assert.deepEqual(bytesOf(await source.getBytes(250, 16)), [250, 251, 252, 253, 254, 255]);
  assert.equal((await source.getBytes(300, 16)).data.byteLength, 0);
  assert.deepEqual(bytesOf(await source.getBytes(-5, 2)), [0, 1]);
});

test("a Uint8Array view is sliced from its own start, not its buffer's", async () => {
  const view = archive.subarray(64);
  const source = new WholeFileSource("x", async () => view);
  assert.deepEqual(bytesOf(await source.getBytes(0, 3)), [64, 65, 66]);
});

test("every read goes through the loader with the archive's URL, and the key is the URL", async () => {
  const seen = [];
  const source = new WholeFileSource("/api/runtime/pmtiles/countries?v=7", async (url) => {
    seen.push(url);
    return archive;
  });
  assert.equal(source.getKey(), "/api/runtime/pmtiles/countries?v=7");
  await Promise.all([source.getBytes(0, 127), source.getBytes(127, 10)]);
  assert.deepEqual(seen, ["/api/runtime/pmtiles/countries?v=7", "/api/runtime/pmtiles/countries?v=7"]);
});

test("a failed load fails the read instead of answering with nothing", async () => {
  const source = new WholeFileSource("x", async () => {
    throw new Error("offline");
  });
  await assert.rejects(source.getBytes(0, 4), /offline/);
});

test("the Android build opens archives through it, and only the Android build", () => {
  const assets = fs.readFileSync(new URL("./assets.js", import.meta.url), "utf8");
  const body = assets.slice(assets.indexOf("const createPmtilesArchive"), assets.indexOf("export const registerPmtilesArchive"));
  assert.match(body, /import\.meta\.env\.VITE_OH_NATIVE\s*\?\s*new WholeFileSource\(url, loadWholeArchive\)\s*:\s*url/);
  assert.match(assets, /const loadWholeArchive = async \(url\) => \{\s*await warmPmtilesArchive\(url\);\s*const buffer = binaryValueCache\.get\(url\);/);
  assert.match(assets, /if \(!buffer\) throw new Error\(`\$\{url\} was released while it was being read\.`\);\s*return buffer;/);
});

test("on Android an archive MapLibre asks for first is still opened here, not by pmtiles over Range", () => {
  // pmtiles' Protocol opens any URL it was not handed as its own FetchSource.
  const assets = fs.readFileSync(new URL("./assets.js", import.meta.url), "utf8");
  assert.match(assets, /if \(isNativeBuild\(\) && pmtilesProtocol\.tiles instanceof Map\) \{\s*const opened = pmtilesProtocol\.tiles;\s*const lookup = opened\.get\.bind\(opened\);\s*opened\.get = \(url\) => lookup\(url\) \?\? getPmtilesArchive\(url\);/);
  const protocol = fs.readFileSync(new URL("../../node_modules/pmtiles/dist/esm/index.js", import.meta.url), "utf8");
  assert.match(protocol, /this\.tiles\.get\(/, "pmtiles still looks archives up in Protocol.tiles");
});
