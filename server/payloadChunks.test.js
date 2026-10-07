// Run: node --test server/payloadChunks.test.js
//
// The app's files are cut into chunks so that an update fetches only what
// changed (electron/payloadChunks.cjs). These are the properties that makes
// true: the cuts follow the content, a file is always put back together from
// its parts, and an app that holds last release's files needs only the chunks
// around what was edited.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  CUT_EVERY_BYTES,
  FORMAT,
  LARGE_FILE_BYTES,
  MAX_CHUNK_BYTES,
  MIN_CHUNK_BYTES,
  PACKS,
  chunkAssetName,
  chunksOfFile,
  cutPoints,
  packOf,
  planPayload,
  planUpdate,
  readManifest,
  sha256,
  withoutBuildStamp,
} = require("../electron/payloadChunks.cjs");

// Bytes that look like a real file to the cutter: no two stretches alike, and
// the same for the same seed every run.
const noise = (bytes, seed = 1) => {
  const data = Buffer.alloc(bytes);
  let state = seed >>> 0;
  for (let index = 0; index < bytes; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[index] = state >>> 24;
  }
  return data;
};

const rebuild = (file, chunks) => Buffer.concat(file.parts.map((part) => chunks.get(part.chunk).subarray(part.at, part.at + part.size)));

test("a large file is cut within the size limits, and the cuts add up to the file", () => {
  const data = noise(9 * 1024 * 1024, 7);
  const points = cutPoints(data);
  assert.equal(points.at(-1), data.length);
  let start = 0;
  for (const [index, end] of points.entries()) {
    const size = end - start;
    assert.ok(size <= MAX_CHUNK_BYTES, `chunk ${index} is ${size} bytes`);
    if (index < points.length - 1) assert.ok(size >= MIN_CHUNK_BYTES, `chunk ${index} is ${size} bytes`);
    start = end;
  }
  // On average a chunk is the minimum and one cut interval long.
  const average = data.length / points.length;
  assert.ok(average > MIN_CHUNK_BYTES && average < 2 * (MIN_CHUNK_BYTES + CUT_EVERY_BYTES), `average ${Math.round(average)}`);
  assert.deepEqual(cutPoints(Buffer.alloc(0)), []);
  assert.deepEqual(cutPoints(noise(1000)), [1000]);
  assert.deepEqual(cutPoints(data), points, "the same file is cut the same way every time");
});

test("an edit moves the cuts around it and nowhere else", () => {
  const before = noise(12 * 1024 * 1024, 3);
  // Forty bytes put in near the middle: everything after them has moved.
  const at = 6 * 1024 * 1024 + 123;
  const after = Buffer.concat([before.subarray(0, at), Buffer.from("x".repeat(40)), before.subarray(at)]);
  const old = new Set(chunksOfFile(before).map((chunk) => chunk.id));
  const next = chunksOfFile(after);
  const fresh = next.filter((chunk) => !old.has(chunk.id));
  assert.ok(next.length >= 8, `${next.length} chunks`);
  assert.ok(fresh.length <= 2, `${fresh.length} of ${next.length} chunks are new`);
  const freshBytes = fresh.reduce((sum, chunk) => sum + chunk.size, 0);
  assert.ok(freshBytes <= 2 * MAX_CHUNK_BYTES);
  // Cut at fixed offsets instead, every chunk after the edit would be new.
  assert.ok(next.filter((chunk) => chunk.offset > at + MAX_CHUNK_BYTES).every((chunk) => old.has(chunk.id)));
});

test("a small file is packed with others of its part of the app, by its name without the build's stamp", () => {
  assert.equal(withoutBuildStamp("dist/assets/index-CsfAFC7-.js"), "dist/assets/index.js");
  assert.equal(withoutBuildStamp("dist/assets/gameplay-Bx9_k2Qa.js"), "dist/assets/gameplay.js");
  assert.equal(withoutBuildStamp("server/libraryStore.js"), "server/libraryStore.js");
  assert.equal(packOf("dist/assets/index-CsfAFC7-.js"), packOf("dist/assets/index-AAAAAAAA.js"), "a rebuilt file stays in its pack");
  assert.match(packOf("server/server.js"), /^server\/\d+$/);
  assert.match(packOf("node_modules/express/index.js"), /^node_modules\/\d+$/);
  assert.match(packOf("dist/index.html"), /^dist\/\d+$/);
  assert.match(packOf("package.json"), /^\/\d+$/);
  assert.match(packOf("electron/main.cjs"), /^\/\d+$/);
  // A file at the top level is never taken for a folder of that name.
  assert.match(packOf("server"), /^\/\d+$/);
  for (const [area, count] of Object.entries(PACKS)) {
    const used = new Set();
    for (let index = 0; index < 4000; index += 1) used.add(packOf(`${area ? `${area}/` : ""}file-${index}.js`));
    assert.equal(used.size, count, `every pack of "${area}" is used`);
  }
});

test("every file is put back together from its parts, large and small and empty", () => {
  const entries = [
    { path: "dist/assets/index-AAAAAAAA.js", data: noise(3 * 1024 * 1024, 11) },
    { path: "public/lang/de.json", data: noise(1400 * 1024, 12) },
    { path: "server/server.js", data: noise(90 * 1024, 13) },
    { path: "server/libraryStore.js", data: noise(60 * 1024, 14) },
    { path: "node_modules/express/index.js", data: noise(300, 15) },
    { path: "electron\\main.cjs", data: noise(40 * 1024, 16) },
    { path: "dist/empty.txt", data: Buffer.alloc(0) },
    { path: "package.json", data: Buffer.from("{}") },
  ];
  const { manifest, chunks } = planPayload(entries, { build: "100", channel: "stable" });
  assert.equal(manifest.format, FORMAT);
  assert.equal(manifest.build, "100");
  assert.deepEqual(manifest.files.map((file) => file.path), [...manifest.files.map((file) => file.path)].sort());
  assert.ok(manifest.files.some((file) => file.path === "electron/main.cjs"), "paths use forward slashes");
  assert.equal(manifest.bytes, entries.reduce((sum, entry) => sum + entry.data.length, 0));
  for (const entry of entries) {
    const file = manifest.files.find((candidate) => candidate.path === entry.path.replace(/\\/g, "/"));
    assert.equal(file.size, entry.data.length);
    assert.equal(file.sha256, sha256(entry.data));
    assert.ok(rebuild(file, chunks).equals(entry.data), file.path);
    if (entry.data.length >= LARGE_FILE_BYTES) assert.ok(file.parts.every((part) => part.at === 0 && part.size === manifest.chunks[part.chunk]), "a large file's parts are whole chunks");
    else assert.ok(file.parts.length <= 1, "a small file is one part of a pack");
  }
  assert.deepEqual(Object.keys(manifest.chunks).sort(), [...chunks.keys()].sort());
  for (const [id, data] of chunks) {
    assert.equal(sha256(data), id, "a chunk is named by its content");
    assert.equal(manifest.chunks[id], data.length);
  }
  assert.deepEqual(readManifest(manifest), { manifest, error: "" });
  assert.throws(() => planPayload([entries[0], entries[0]]), /twice/);
  assert.match(chunkAssetName("ab".repeat(32)), /^c-[0-9a-f]{40}\.bin$/);
});

test("the same files give the same manifest, whatever order they are listed in", () => {
  const entries = [
    { path: "server/a.js", data: noise(5000, 1) },
    { path: "server/b.js", data: noise(7000, 2) },
    { path: "dist/assets/big-AAAAAAAA.js", data: noise(900 * 1024, 3) },
  ];
  const forward = planPayload(entries).manifest;
  const backward = planPayload([...entries].reverse()).manifest;
  assert.deepEqual(backward, forward);
});

// What an update costs: last release's files are on disk, and the new release
// changed a few of them.
const release = (edits = {}) => {
  const files = [
    { path: "dist/assets/index-AAAAAAAA.js", data: noise(5 * 1024 * 1024, 21) },
    { path: "dist/assets/gameplay-BBBBBBBB.js", data: noise(4 * 1024 * 1024, 22) },
    { path: "dist/assets/logo-CCCCCCCC.png", data: noise(40 * 1024, 23) },
    { path: "public/lang/de.json", data: noise(1500 * 1024, 24) },
    { path: "public/lang/fr.json", data: noise(1500 * 1024, 25) },
    ...Array.from({ length: 60 }, (unused, index) => ({ path: `server/module${index}.js`, data: noise(20 * 1024 + index, 100 + index) })),
    ...Array.from({ length: 300 }, (unused, index) => ({ path: `node_modules/dep${index % 20}/file${index}.js`, data: noise(3000 + index, 500 + index) })),
  ];
  return files.flatMap((file) => {
    const edit = edits[file.path];
    if (edit === null) return [];
    if (!edit) return [file];
    return [{ path: edit.path ?? file.path, data: edit.data(file.data) }];
  });
};
const localOf = (entries) => {
  const files = new Map();
  const chunks = new Map();
  for (const entry of entries) {
    files.set(sha256(entry.data), entry.path);
    for (const chunk of chunksOfFile(entry.data)) chunks.set(chunk.id, { file: entry.path, offset: chunk.offset, size: chunk.size });
  }
  return { files, chunks };
};

test("an app that holds every file fetches nothing", () => {
  const entries = release();
  const plan = planUpdate(planPayload(entries).manifest, localOf(entries));
  assert.deepEqual(plan.fetch, []);
  assert.equal(plan.fetchBytes, 0);
  assert.equal(plan.build.length, 0);
  assert.equal(plan.copy.length, entries.length);
  assert.equal(plan.reusedBytes, plan.totalBytes);
});

test("an app with nothing fetches every chunk", () => {
  const { manifest } = planPayload(release());
  const plan = planUpdate(manifest, {});
  assert.deepEqual(plan.fetch, Object.keys(manifest.chunks).sort());
  assert.equal(plan.copy.length, 0);
});

test("an update fetches the chunks around what changed, and little else", () => {
  const before = release();
  const after = release({
    // A rebuilt bundle: a new name, and a few hundred bytes different in the middle.
    "dist/assets/index-AAAAAAAA.js": {
      path: "dist/assets/index-DDDDDDDD.js",
      data: (data) => Buffer.concat([data.subarray(0, 2_000_000), noise(300, 99), data.subarray(2_000_300)]),
    },
    // A language pack with strings added at its end.
    "public/lang/de.json": { data: (data) => Buffer.concat([data, noise(2000, 98)]) },
    // One source file of the server edited.
    "server/module7.js": { data: (data) => Buffer.concat([data, Buffer.from("// fixed\n")]) },
    // A file that is gone.
    "dist/assets/logo-CCCCCCCC.png": null,
  });
  const { manifest, chunks } = planPayload(after);
  const plan = planUpdate(manifest, localOf(before));
  // Three files have to be put together again; everything else is copied.
  assert.deepEqual(plan.build.map((file) => file.path).sort(), ["dist/assets/index-DDDDDDDD.js", "public/lang/de.json", "server/module7.js"]);
  assert.equal(plan.copy.length, after.length - 3);
  // The bundle and the pack are each mostly read from the copy on disk.
  const bundle = plan.build.find((file) => file.path === "dist/assets/index-DDDDDDDD.js");
  assert.ok(bundle.parts.filter((part) => !part.local).length <= 2, "the bundle needs the chunk around its edit");
  assert.ok(bundle.parts.filter((part) => part.local).length >= 3);
  assert.ok(bundle.parts.filter((part) => part.local).every((part) => part.local.file === "dist/assets/index-AAAAAAAA.js"), "read from the old bundle, whatever it was called");
  const pack = plan.build.find((file) => file.path === "public/lang/de.json");
  assert.equal(pack.parts.filter((part) => !part.local).length, 1, "the language pack needs its last chunk");
  // What is fetched is a small share of the whole.
  assert.ok(plan.fetchBytes < plan.totalBytes / 5, `${plan.fetchBytes} of ${plan.totalBytes}`);
  assert.equal(plan.fetchBytes, plan.fetch.reduce((sum, id) => sum + chunks.get(id).length, 0));
  // And it is enough: every file to build can be made from what is fetched and what is on disk.
  const disk = new Map(before.map((entry) => [entry.path, entry.data]));
  const fetched = new Map(plan.fetch.map((id) => [id, chunks.get(id)]));
  for (const file of plan.build) {
    const made = Buffer.concat(file.parts.map((part) => (part.local
      ? disk.get(part.local.file).subarray(part.local.offset, part.local.offset + part.local.size)
      : fetched.get(part.chunk).subarray(part.at, part.at + part.size))));
    assert.equal(sha256(made), file.sha256, file.path);
  }
});

test("a manifest that could write outside the app's folder, or read outside a chunk, is refused", () => {
  const { manifest } = planPayload([
    { path: "server/a.js", data: noise(5000, 1) },
    { path: "dist/assets/big-AAAAAAAA.js", data: noise(900 * 1024, 3) },
  ]);
  const altered = (change) => {
    const copy = JSON.parse(JSON.stringify(manifest));
    change(copy);
    return readManifest(copy).error;
  };
  assert.equal(readManifest(manifest).error, "");
  assert.match(readManifest(null).error, /not an object/);
  assert.match(altered((copy) => { copy.format = FORMAT + 1; }), /format/);
  assert.match(altered((copy) => { copy.files = []; }), /no files/);
  for (const bad of ["../outside.js", "server/../../outside.js", "/etc/passwd", "C:/Windows/x.dll", "server//a.js", "server\\a.js", "./server/a.js", ""]) {
    assert.notEqual(altered((copy) => { copy.files[1].path = bad; }), "", JSON.stringify(bad));
  }
  assert.match(altered((copy) => { copy.files[1].path = "DIST/assets/big-AAAAAAAA.js"; }), /twice/, "two names one file on a disk that ignores case");
  assert.match(altered((copy) => { copy.files[1].sha256 = "nope"; }), /not described/);
  assert.match(altered((copy) => { copy.files[1].parts[0].at = 1; }), /outside one of its chunks/);
  assert.match(altered((copy) => { copy.files[1].parts[0].size += 1; }), /outside one of its chunks/);
  assert.match(altered((copy) => { copy.files[1].parts[0].chunk = "0".repeat(64); }), /does not list/);
  assert.match(altered((copy) => { copy.files[1].size += 1; }), /add up/);
  assert.match(altered((copy) => { copy.chunks[Object.keys(copy.chunks)[0]] = -1; }), /./);
});
