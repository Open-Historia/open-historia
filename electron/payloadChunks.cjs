/*! Open Historia — the app's files cut into chunks, so an update fetches only what changed © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An update used to be the whole installer again, about 140 MB, although the
// Electron runtime in it had not changed and most of the game's own files had
// not either. This cuts the game's files (everything inside app.asar: the
// built client, the server, the language packs, the node modules) into chunks.
// A release publishes each chunk as a file of its own, named by its content,
// beside a manifest that says which chunks make up which file. The app compares
// that manifest with the files it already has and downloads only the chunks it
// cannot make from them (electron/payloadUpdate.cjs).
//
// Two kinds of chunk, one representation. A file is a list of parts, and a part
// is a run of bytes inside a chunk:
//
//   a large file    is cut where its own content says to (content-defined
//                   chunking), so an edit moves the cut points around the edit
//                   and nowhere else: the chunks before and after it are the
//                   same chunks as last release. Each part is a whole chunk.
//   a small file    shares a chunk (a pack) with other small files of its own
//                   part of the app. Each is one part somewhere inside it.
//
// Every number here is fixed. The same file must be cut the same way by the
// release that publishes it and by the app that looks for its chunks a year
// later, so nothing is derived from the size of the payload, and none of these
// may change without a new FORMAT (an app reads only the format it knows, and
// otherwise updates with the installer as it always did).
//
// DELIBERATELY DEPENDENCY-FREE: node's crypto only. Required by the main
// process, by the release script and by the tests.

const crypto = require("node:crypto");

const FORMAT = 1;

// A file this size or larger is cut by its content; a smaller one is packed.
const LARGE_FILE_BYTES = 256 * 1024;
// Content-defined cuts: never before MIN, always by MAX, and in between
// wherever the rolling hash's low bits are all zero, which happens once in
// CUT_EVERY bytes on average. So a chunk averages MIN + CUT_EVERY.
const MIN_CHUNK_BYTES = 256 * 1024;
const CUT_EVERY_BYTES = 512 * 1024;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const CUT_MASK = CUT_EVERY_BYTES - 1;

// How many packs each part of the app is spread over. Files that change with
// every release (the server's own code) and files that almost never do (the
// node modules) are kept in different packs, so one edited source file costs a
// pack of its own area and not a slice of everything. A path's first folder
// picks the row; the rest go under "".
const PACKS = Object.freeze({
  node_modules: 24,
  server: 16,
  dist: 24,
  "": 4,
});

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// The rolling hash's table: 256 fixed 32-bit numbers. Generated, not listed,
// from a seed that must never change (see FORMAT).
const GEAR = (() => {
  const table = new Int32Array(256);
  let state = 0x4f48_6368; // "OHch"
  for (let index = 0; index < 256; index += 1) {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    table[index] = (mixed ^ (mixed >>> 14)) | 0;
  }
  return table;
})();

// Where a buffer is cut: the end offset of each chunk, the last being its
// length. An empty buffer has no chunks.
const cutPoints = (buffer) => {
  const points = [];
  const length = buffer.length;
  let start = 0;
  while (start < length) {
    const remaining = length - start;
    if (remaining <= MIN_CHUNK_BYTES) {
      points.push(length);
      break;
    }
    const limit = start + Math.min(remaining, MAX_CHUNK_BYTES);
    let hash = 0;
    let cut = limit;
    // The hash is only looked at past the minimum, but it is fed from a little
    // before it so the first test already stands on a full window (the hash
    // remembers 32 bytes: each step shifts one bit out).
    for (let index = start + MIN_CHUNK_BYTES - 32; index < limit; index += 1) {
      hash = ((hash << 1) + GEAR[buffer[index]]) | 0;
      if (index >= start + MIN_CHUNK_BYTES && (hash & CUT_MASK) === 0) {
        cut = index + 1;
        break;
      }
    }
    points.push(cut);
    start = cut;
  }
  return points;
};

// A build's own stamp in a file name ("index-CsfAFC7-.js", "gameplay-Bx9_k2Qa.js")
// is not part of what the file is: next release's index has another. Packs are
// chosen by the name without it, so a rebuilt file stays in the pack it was in.
const withoutBuildStamp = (file) => file.replace(/-[A-Za-z0-9_-]{8}(?=\.[A-Za-z0-9]+$)/, "");

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

// The pack a small file belongs to: "<area>/<number>".
const packOf = (file) => {
  const first = file.split("/")[0];
  const area = Object.hasOwn(PACKS, first) && file.includes("/") ? first : "";
  return `${area}/${fnv1a(withoutBuildStamp(file)) % PACKS[area]}`;
};

const normalPath = (file) => String(file).replace(/\\/g, "/").replace(/^\.?\//, "");

// The manifest of a payload and the chunks it is made of.
//   entries: [{ path, data: Buffer }]   every file, any order
//   -> { manifest, chunks: Map(id -> Buffer) }
// manifest.files is sorted by path and each file's parts are in order;
// manifest.chunks gives each chunk's size, so a download can be checked for
// length before it is hashed.
const planPayload = (entries, details = {}) => {
  const files = entries.map((entry) => ({ path: normalPath(entry.path), data: entry.data }));
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (let index = 1; index < files.length; index += 1) {
    if (files[index].path === files[index - 1].path) throw new Error(`the payload lists ${files[index].path} twice`);
  }
  const chunks = new Map();
  const keep = (data) => {
    const id = sha256(data);
    if (!chunks.has(id)) chunks.set(id, data);
    return id;
  };
  const byPath = new Map();
  const packs = new Map();
  for (const file of files) {
    const record = { path: file.path, size: file.data.length, sha256: sha256(file.data), parts: [] };
    byPath.set(file.path, record);
    if (file.data.length >= LARGE_FILE_BYTES) {
      let start = 0;
      for (const end of cutPoints(file.data)) {
        record.parts.push({ chunk: keep(file.data.subarray(start, end)), at: 0, size: end - start });
        start = end;
      }
    } else if (file.data.length > 0) {
      const pack = packOf(file.path);
      if (!packs.has(pack)) packs.set(pack, []);
      packs.get(pack).push(file);
    }
  }
  for (const members of packs.values()) {
    const id = keep(Buffer.concat(members.map((member) => member.data)));
    let at = 0;
    for (const member of members) {
      byPath.get(member.path).parts.push({ chunk: id, at, size: member.data.length });
      at += member.data.length;
    }
  }
  const sizes = {};
  for (const id of [...chunks.keys()].sort()) sizes[id] = chunks.get(id).length;
  return {
    manifest: {
      format: FORMAT,
      ...details,
      bytes: files.reduce((sum, file) => sum + file.data.length, 0),
      files: files.map((file) => byPath.get(file.path)),
      chunks: sizes,
    },
    chunks,
  };
};

// What an app reads to learn whether there is anything newer: the head, a few
// hundred bytes under a fixed name. The manifest lists every file of the app
// (nearly ten thousand, close to two megabytes) and would otherwise be fetched
// at every start to learn, almost always, that nothing changed. The head says
// which build is published, what it runs on, and which manifest describes it;
// the manifest is published under a name made from its own content, like a
// chunk, and is fetched only by an app that is going to update.
const manifestAssetName = (hash) => `m-${String(hash).slice(0, 40)}.json`;

// The head for a manifest, given the manifest as it will be published.
const headOf = (manifest, manifestText) => {
  const hash = sha256(Buffer.from(manifestText, "utf8"));
  return {
    format: FORMAT,
    build: manifest.build,
    version: manifest.version,
    channel: manifest.channel,
    platform: manifest.platform,
    shell: manifest.shell,
    bytes: manifest.bytes,
    manifest: { name: manifestAssetName(hash), size: Buffer.byteLength(manifestText, "utf8"), sha256: hash },
  };
};

// A head as an app may act on it, or the reason it may not.
const readHead = (value) => {
  const fail = (reason) => ({ head: null, error: reason });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("the update's head is not an object");
  if (!String(value.build ?? "")) return fail("the update's head names no build");
  if (value.format !== FORMAT) return fail(`the update is format ${value.format}, and this app reads format ${FORMAT}`);
  const named = value.manifest;
  if (!named || !isHash(named.sha256) || !Number.isSafeInteger(named.size) || named.size <= 0 || named.name !== manifestAssetName(named.sha256)) {
    return fail("the update's head does not say which manifest describes it");
  }
  return { head: value, error: "" };
};

// The name a chunk is published under. Forty hex digits of its sha256 are
// more than enough to tell chunks apart; the full hash is still what a
// download is checked against.
const chunkAssetName = (id) => `c-${String(id).slice(0, 40)}.bin`;

const isHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

// A manifest as an app may act on it, or the reason it may not. Everything a
// path or a number could do to the disk is refused here, once, so the code
// that writes files does not have to ask again.
const readManifest = (value) => {
  const fail = (reason) => ({ manifest: null, error: reason });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("the manifest is not an object");
  if (value.format !== FORMAT) return fail(`the manifest is format ${value.format}, and this app reads format ${FORMAT}`);
  if (!Array.isArray(value.files) || !value.files.length) return fail("the manifest lists no files");
  if (!value.chunks || typeof value.chunks !== "object") return fail("the manifest lists no chunks");
  const seen = new Set();
  for (const file of value.files) {
    const name = file?.path;
    if (typeof name !== "string" || !name || name !== normalPath(name)) return fail("a file has no usable path");
    if (name.split("/").some((part) => part === "" || part === "." || part === "..") || /^[A-Za-z]:/.test(name) || name.includes("\0")) {
      return fail(`the path ${name} leaves the app's folder`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return fail(`the manifest lists ${name} twice`);
    seen.add(key);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || !isHash(file.sha256) || !Array.isArray(file.parts)) return fail(`${name} is not described`);
    let total = 0;
    for (const part of file.parts) {
      const chunkSize = value.chunks[part?.chunk];
      if (!isHash(part?.chunk) || !Number.isSafeInteger(chunkSize)) return fail(`${name} is made of a chunk the manifest does not list`);
      if (!Number.isSafeInteger(part.at) || !Number.isSafeInteger(part.size) || part.at < 0 || part.size <= 0 || part.at + part.size > chunkSize) {
        return fail(`${name} reads outside one of its chunks`);
      }
      total += part.size;
    }
    if (total !== file.size) return fail(`${name}'s parts do not add up to its size`);
  }
  for (const [id, size] of Object.entries(value.chunks)) {
    if (!isHash(id) || !Number.isSafeInteger(size) || size <= 0) return fail("a chunk is not described");
  }
  return { manifest: value, error: "" };
};

// What an app that holds `local` has to fetch to become `manifest`.
//   local.files:  Map(sha256 -> where that file is)      whole files it has
//   local.chunks: Map(chunk id -> { file, offset, size }) chunks it can read
//                 out of the large files it has (indexLocalChunks)
// -> { copy:   [{ path, from }]                 files it already has, as they are
//      build:  [{ path, size, sha256, parts }]  files to put together; each part
//              is { chunk, at, size, local }, `local` being where on disk that
//              chunk can be read, or null when it has to be downloaded
//      fetch:  [chunk id]                       the chunks to download
//      fetchBytes, reusedBytes, totalBytes }
const planUpdate = (manifest, local = {}) => {
  const haveFiles = local.files instanceof Map ? local.files : new Map();
  const haveChunks = local.chunks instanceof Map ? local.chunks : new Map();
  const copy = [];
  const build = [];
  const fetch = new Set();
  let reusedBytes = 0;
  for (const file of manifest.files) {
    if (haveFiles.has(file.sha256)) {
      copy.push({ path: file.path, from: haveFiles.get(file.sha256) });
      reusedBytes += file.size;
      continue;
    }
    const parts = file.parts.map((part) => {
      // Only a part that is a whole chunk can be read from a local file: that
      // is what the local index holds (the cuts of large files).
      const source = part.at === 0 && part.size === manifest.chunks[part.chunk] ? haveChunks.get(part.chunk) ?? null : null;
      if (source) reusedBytes += part.size;
      else fetch.add(part.chunk);
      return { ...part, local: source };
    });
    build.push({ path: file.path, size: file.size, sha256: file.sha256, parts });
  }
  const list = [...fetch].sort();
  return {
    copy,
    build,
    fetch: list,
    fetchBytes: list.reduce((sum, id) => sum + manifest.chunks[id], 0),
    reusedBytes,
    totalBytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
  };
};

// The chunks a large local file is made of, as the release's cutter would cut
// it: how the app finds, in a file it already has, the unchanged chunks of the
// newer file that replaces it.
//   -> [{ id, offset, size }]
const chunksOfFile = (data) => {
  if (data.length < LARGE_FILE_BYTES) return [];
  const found = [];
  let start = 0;
  for (const end of cutPoints(data)) {
    found.push({ id: sha256(data.subarray(start, end)), offset: start, size: end - start });
    start = end;
  }
  return found;
};

module.exports = {
  FORMAT,
  LARGE_FILE_BYTES,
  MIN_CHUNK_BYTES,
  CUT_EVERY_BYTES,
  MAX_CHUNK_BYTES,
  PACKS,
  chunkAssetName,
  chunksOfFile,
  headOf,
  manifestAssetName,
  readHead,
  cutPoints,
  packOf,
  planPayload,
  planUpdate,
  readManifest,
  sha256,
  withoutBuildStamp,
};
