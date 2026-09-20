/*!
 * Open Historia — PMTiles zoom-level trimmer
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Drops the zoom levels the game never asks for out of a PMTiles v3 archive.
//
// public/assets/regions.pmtiles and countries.pmtiles were both built with
// `tippecanoe -Z0 -z10`, so they carry tiles all the way down to zoom 10. The
// map mounts them as vector sources capped at `maxzoom: 8` (see
// src/Game/Map/Nations.jsx), which means MapLibre never requests a z9 or z10
// tile at all - past z8 it overzooms the z8 tile instead. Those two levels are
// therefore pure download weight. They are 80% of the two archives: trimming
// both to z8 takes regions.pmtiles from 105.8 MB to 21.1 MB and
// countries.pmtiles from 62.7 MB to 12.6 MB, 134.9 MB off the 288.7 MB a player
// pulls down on first launch (scripts/map-assets.json), for tiles that were
// never drawn. cities.pmtiles was built with -zg and already stops at z3, so
// there is nothing in it to trim.
//
// This script rewrites an archive keeping only z0..maxzoom. It is a pure
// repack: tile bodies are copied across still compressed, byte for byte, so no
// tile is ever re-encoded and nothing about how the map looks can change. What
// it preserves from the source header: tile type, tile compression, internal
// (directory/metadata) compression, bounds, center, minZoom and the JSON
// metadata blob. What it rewrites: maxZoom, the tile/entry/content counts, the
// directories and every offset.
//
// Run:
//   node scripts/trim-pmtiles.mjs <input.pmtiles> <output.pmtiles> <maxzoom>
//   node scripts/trim-pmtiles.mjs in.pmtiles out.pmtiles 8 --verify
//   node scripts/trim-pmtiles.mjs in.pmtiles out.pmtiles 8 --verify=5000
//
// --verify re-opens both archives afterwards through the pmtiles reader and
// compares tile bytes: every tile of z0..z6 exhaustively, then N random tiles
// (default 2000) of each zoom above that, plus a walk of the output's
// directories asserting no entry survives above the new cap.
//
// The pmtiles package is a reader only - it has no writer - so the v3 container
// is emitted here: the 127-byte header, the varint directories, and the
// header/directory field layout all mirror the decoders in
// node_modules/pmtiles/src/index.ts so that what we write is exactly what that
// reader (and therefore the game) expects to parse.
//
// De-duplication matters more than anything else here. The source archives lean
// on it hard - countries.pmtiles addresses 578k tiles with only 90k distinct
// bodies, because oceans and continental interiors repeat - and that happens two
// ways in the format: a directory entry carries a runLength so one entry can
// cover a run of consecutive tile ids, and separate entries can point at one
// shared offset in the tile data section. A writer that ignored either would
// turn a 60 MB archive into a several-hundred-MB one. So identical bodies are
// folded onto a single offset (by source range first, then by content hash, to
// also catch duplicates the source itself missed) and adjacent entries that end
// up pointing at the same body are merged back into a single run.

import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PMTiles, bytesToHeader, readVarint, tileIdToZxy } from "pmtiles";

const HEADER_SIZE_BYTES = 127;
// The reader fetches the first 16 KiB and expects the header and the whole root
// directory to be inside it, so the compressed root has to fit in what is left.
const ROOT_DIRECTORY_BUDGET = 16384 - HEADER_SIZE_BYTES;
const MAX_DIRECTORY_DEPTH = 3;

// Compression ids from the v3 spec (pmtiles' Compression enum).
const COMPRESSION_NONE = 1;
const COMPRESSION_GZIP = 2;
const COMPRESSION_BROTLI = 3;

const usage = () => {
  console.error("usage: node scripts/trim-pmtiles.mjs <input.pmtiles> <output.pmtiles> <maxzoom> [--verify[=N]]");
  process.exit(2);
};

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positional = argv.filter((a) => !a.startsWith("--"));
if (positional.length !== 3) usage();

const INPUT = path.resolve(positional[0]);
const OUTPUT = path.resolve(positional[1]);
const REQUESTED_MAX_ZOOM = Number.parseInt(positional[2], 10);
if (!Number.isInteger(REQUESTED_MAX_ZOOM) || REQUESTED_MAX_ZOOM < 0 || REQUESTED_MAX_ZOOM > 26) usage();

const verifyFlag = flags.find((f) => f === "--verify" || f.startsWith("--verify="));
const VERIFY = Boolean(verifyFlag);
const VERIFY_SAMPLES = verifyFlag?.includes("=") ? Math.max(1, Number.parseInt(verifyFlag.split("=")[1], 10) || 2000) : 2000;

// The first tile id of a zoom level. Tile ids are a Hilbert curve laid out zoom
// by zoom, so "everything at or below zoom Z" is simply "tile id < first(Z+1)".
const firstTileIdOfZoom = (z) => (4 ** z - 1) / 3;

const decompress = (buf, compression) => {
  if (compression === COMPRESSION_NONE || compression === 0) return Buffer.from(buf);
  if (compression === COMPRESSION_GZIP) return zlib.gunzipSync(buf);
  if (compression === COMPRESSION_BROTLI) return zlib.brotliDecompressSync(buf);
  throw new Error(`unsupported internal compression id ${compression}`);
};

const compress = (buf, compression) => {
  if (compression === COMPRESSION_NONE || compression === 0) return Buffer.from(buf);
  if (compression === COMPRESSION_GZIP) return zlib.gzipSync(buf, { level: 9 });
  if (compression === COMPRESSION_BROTLI) return zlib.brotliCompressSync(buf);
  throw new Error(`unsupported internal compression id ${compression}`);
};

// A growable byte buffer. Directories run to hundreds of thousands of varints,
// so appending into a doubling Buffer beats building a JS number array.
class ByteWriter {
  constructor(initial = 1 << 16) {
    this.buf = Buffer.allocUnsafe(initial);
    this.len = 0;
  }

  ensure(extra) {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.len + extra) size *= 2;
    const next = Buffer.allocUnsafe(size);
    this.buf.copy(next, 0, 0, this.len);
    this.buf = next;
  }

  varint(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`cannot encode ${value} as a varint`);
    let n = value;
    this.ensure(10);
    // Divide rather than shift: offsets can exceed 2^31 and >>> would wrap.
    while (n >= 0x80) {
      this.buf[this.len] = (n % 128) | 0x80;
      this.len += 1;
      n = Math.floor(n / 128);
    }
    this.buf[this.len] = n;
    this.len += 1;
  }

  bytes() {
    return this.buf.subarray(0, this.len);
  }
}

// Mirrors the package's (unexported) deserializeIndex: four varint columns -
// delta-coded tile ids, run lengths, lengths, then offsets where a 0 means
// "directly after the previous entry".
const deserializeIndex = (buffer) => {
  const p = { buf: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), pos: 0 };
  const numEntries = readVarint(p);
  const entries = new Array(numEntries);
  let lastId = 0;
  for (let i = 0; i < numEntries; i += 1) {
    lastId += readVarint(p);
    entries[i] = { tileId: lastId, offset: 0, length: 0, runLength: 1 };
  }
  for (let i = 0; i < numEntries; i += 1) entries[i].runLength = readVarint(p);
  for (let i = 0; i < numEntries; i += 1) entries[i].length = readVarint(p);
  for (let i = 0; i < numEntries; i += 1) {
    const v = readVarint(p);
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
};

const serializeIndex = (entries) => {
  const w = new ByteWriter(Math.max(1 << 16, entries.length * 8));
  w.varint(entries.length);
  let lastId = 0;
  for (const e of entries) {
    w.varint(e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) w.varint(e.runLength);
  for (const e of entries) w.varint(e.length);
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const prev = entries[i - 1];
    if (i > 0 && e.offset === prev.offset + prev.length) w.varint(0);
    else w.varint(e.offset + 1);
  }
  return w.bytes();
};

// Split the entry list into a root directory plus leaf directories, growing the
// leaf size until the compressed root fits the reader's 16 KiB prefetch. Same
// shape as go-pmtiles' optimize_directories.
const buildDirectories = (entries, internalCompression) => {
  if (entries.length < 16384) {
    const root = compress(serializeIndex(entries), internalCompression);
    if (root.length <= ROOT_DIRECTORY_BUDGET) return { root, leaves: Buffer.alloc(0), numLeaves: 0, leafSize: 0 };
  }
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries = [];
    const chunks = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const slice = entries.slice(i, i + leafSize);
      const leaf = compress(serializeIndex(slice), internalCompression);
      // runLength 0 is how the format marks an entry as a leaf pointer.
      rootEntries.push({ tileId: slice[0].tileId, offset: leafOffset, length: leaf.length, runLength: 0 });
      chunks.push(leaf);
      leafOffset += leaf.length;
    }
    const root = compress(serializeIndex(rootEntries), internalCompression);
    if (root.length <= ROOT_DIRECTORY_BUDGET) {
      return { root, leaves: Buffer.concat(chunks), numLeaves: rootEntries.length, leafSize };
    }
    if (leafSize >= entries.length) throw new Error("cannot pack the root directory into 16 KiB");
  }
};

const putUint64 = (buf, offset, value) => {
  buf.writeUInt32LE(value % 0x100000000, offset);
  buf.writeUInt32LE(Math.floor(value / 0x100000000), offset + 4);
};

const putCoordinate = (buf, offset, degrees) => buf.writeInt32LE(Math.round(degrees * 10000000), offset);

// Field-for-field inverse of the package's bytesToHeader.
const serializeHeader = (h) => {
  const b = Buffer.alloc(HEADER_SIZE_BYTES);
  b.write("PMTiles", 0, "ascii");
  b.writeUInt8(3, 7);
  putUint64(b, 8, h.rootDirectoryOffset);
  putUint64(b, 16, h.rootDirectoryLength);
  putUint64(b, 24, h.jsonMetadataOffset);
  putUint64(b, 32, h.jsonMetadataLength);
  putUint64(b, 40, h.leafDirectoryOffset);
  putUint64(b, 48, h.leafDirectoryLength);
  putUint64(b, 56, h.tileDataOffset);
  putUint64(b, 64, h.tileDataLength);
  putUint64(b, 72, h.numAddressedTiles);
  putUint64(b, 80, h.numTileEntries);
  putUint64(b, 88, h.numTileContents);
  b.writeUInt8(h.clustered ? 1 : 0, 96);
  b.writeUInt8(h.internalCompression, 97);
  b.writeUInt8(h.tileCompression, 98);
  b.writeUInt8(h.tileType, 99);
  b.writeUInt8(h.minZoom, 100);
  b.writeUInt8(h.maxZoom, 101);
  putCoordinate(b, 102, h.minLon);
  putCoordinate(b, 106, h.minLat);
  putCoordinate(b, 110, h.maxLon);
  putCoordinate(b, 114, h.maxLat);
  b.writeUInt8(h.centerZoom, 118);
  putCoordinate(b, 119, h.centerLon);
  putCoordinate(b, 123, h.centerLat);
  return b;
};

// Walk root plus leaf directories in tile-id order and return every tile entry
// at or below the cap. Entries are sorted, so the first id past the cap ends the
// walk; a run that straddles the cap is clipped rather than dropped.
const collectEntries = (file, header, limitTileId) => {
  const out = [];
  let stopped = false;
  const walk = (entries, depth) => {
    if (depth > MAX_DIRECTORY_DEPTH) throw new Error("maximum directory depth exceeded");
    for (const e of entries) {
      if (e.tileId >= limitTileId) {
        stopped = true;
        return;
      }
      if (e.runLength === 0) {
        const start = header.leafDirectoryOffset + e.offset;
        walk(deserializeIndex(decompress(file.subarray(start, start + e.length), header.internalCompression)), depth + 1);
        if (stopped) return;
      } else {
        out.push({
          tileId: e.tileId,
          offset: e.offset,
          length: e.length,
          runLength: Math.min(e.runLength, limitTileId - e.tileId),
        });
      }
    }
  };
  const rootStart = header.rootDirectoryOffset;
  walk(deserializeIndex(decompress(file.subarray(rootStart, rootStart + header.rootDirectoryLength), header.internalCompression)), 1);
  return out;
};

// Minimal Node source for the pmtiles reader, as in scripts/extract-regions.mjs.
class MemorySource {
  constructor(buffer, key) {
    this.bytes = buffer;
    this.key = key;
  }

  getKey() {
    return this.key;
  }

  async getBytes(offset, length) {
    const end = Math.min(this.bytes.byteLength, offset + length);
    const slice = this.bytes.subarray(offset, end);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) };
  }
}

const openArchive = (buffer, key) => new PMTiles(new MemorySource(buffer, key));

const fmtBytes = (n) => `${n.toLocaleString("en-US")} bytes (${(n / 1024 / 1024).toFixed(2)} MB)`;

// A small deterministic PRNG so a --verify run is reproducible.
const makeRandom = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const verify = async (sourceBuffer, outputBuffer, maxZoom) => {
  const src = openArchive(sourceBuffer, "src");
  const out = openArchive(outputBuffer, "out");
  const srcHeader = await src.getHeader();
  const outHeader = await out.getHeader();

  const carried = [
    "clustered",
    "internalCompression",
    "tileCompression",
    "tileType",
    "minZoom",
    "minLon",
    "minLat",
    "maxLon",
    "maxLat",
    "centerZoom",
    "centerLon",
    "centerLat",
  ];
  for (const field of carried) {
    if (srcHeader[field] !== outHeader[field]) {
      throw new Error(`header field ${field} changed: ${srcHeader[field]} -> ${outHeader[field]}`);
    }
  }
  if (outHeader.maxZoom !== maxZoom) throw new Error(`output maxZoom is ${outHeader.maxZoom}, expected ${maxZoom}`);

  const srcMeta = JSON.stringify(await src.getMetadata());
  const outMeta = JSON.stringify(await out.getMetadata());
  if (srcMeta !== outMeta) throw new Error("metadata JSON differs");

  // No entry may survive above the cap, whatever the reader would do with it.
  const outFileHeader = bytesToHeader(outputBuffer.buffer.slice(outputBuffer.byteOffset, outputBuffer.byteOffset + HEADER_SIZE_BYTES));
  const allOut = collectEntries(outputBuffer, outFileHeader, Number.MAX_SAFE_INTEGER);
  let highest = -1;
  for (const e of allOut) highest = Math.max(highest, e.tileId + e.runLength - 1);
  const [highestZoom] = tileIdToZxy(highest);
  if (highestZoom > maxZoom) throw new Error(`output still holds a z${highestZoom} entry`);

  const random = makeRandom(0x5eed);
  let compared = 0;
  let present = 0;
  for (let z = 0; z <= maxZoom; z += 1) {
    const side = 2 ** z;
    const total = side * side;
    const exhaustive = total <= 4096;
    const picks = [];
    if (exhaustive) {
      for (let i = 0; i < total; i += 1) picks.push(i);
    } else {
      const seen = new Set();
      while (seen.size < Math.min(VERIFY_SAMPLES, total)) seen.add(Math.floor(random() * total));
      picks.push(...seen);
    }
    for (const i of picks) {
      const x = i % side;
      const y = Math.floor(i / side);
      const a = await src.getZxy(z, x, y);
      const b = await out.getZxy(z, x, y);
      if (!a?.data) {
        if (b?.data) throw new Error(`z${z}/${x}/${y} is absent from the source but present in the output`);
      } else {
        if (!b?.data) throw new Error(`z${z}/${x}/${y} is missing from the output`);
        if (Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) !== 0) {
          throw new Error(`z${z}/${x}/${y} bytes differ`);
        }
        present += 1;
      }
      compared += 1;
    }
    console.log(`[trim-pmtiles] verify z${z}: ${picks.length} tiles ${exhaustive ? "(all)" : "(random sample)"} match`);
  }

  // And the levels we dropped must now be empty.
  for (let z = maxZoom + 1; z <= srcHeader.maxZoom; z += 1) {
    const side = 2 ** z;
    const total = side * side;
    let checked = 0;
    let wasInSource = 0;
    const seen = new Set();
    while (seen.size < Math.min(VERIFY_SAMPLES, total)) seen.add(Math.floor(random() * total));
    for (const i of seen) {
      const x = i % side;
      const y = Math.floor(i / side);
      if ((await src.getZxy(z, x, y))?.data) wasInSource += 1;
      if ((await out.getZxy(z, x, y))?.data) throw new Error(`z${z}/${x}/${y} survived the trim`);
      checked += 1;
    }
    console.log(`[trim-pmtiles] verify z${z}: ${checked} tiles absent from the output (${wasInSource} of them existed in the source)`);
  }

  console.log(`[trim-pmtiles] verify: ${compared} tile ids compared, ${present} of them held tiles, all byte-identical`);
};

const main = async () => {
  const file = readFileSync(INPUT);
  const header = bytesToHeader(file.buffer.slice(file.byteOffset, file.byteOffset + HEADER_SIZE_BYTES));
  if (header.specVersion !== 3) throw new Error(`${path.basename(INPUT)} is spec version ${header.specVersion}, not 3`);

  const maxZoom = Math.min(REQUESTED_MAX_ZOOM, header.maxZoom);
  if (maxZoom < header.minZoom) throw new Error(`maxzoom ${maxZoom} is below the archive's minZoom ${header.minZoom}`);
  console.log(
    `[trim-pmtiles] ${path.basename(INPUT)}: ${fmtBytes(file.length)}, z${header.minZoom}-${header.maxZoom}, ` +
      `${header.numAddressedTiles.toLocaleString("en-US")} addressed tiles`,
  );
  if (maxZoom === header.maxZoom) {
    console.log(`[trim-pmtiles] note: the archive already stops at z${header.maxZoom}; this is a repack, not a trim.`);
  }

  const kept = collectEntries(file, header, firstTileIdOfZoom(maxZoom + 1));
  if (kept.length === 0) throw new Error("no tiles left after trimming");

  // Copy the surviving bodies across, still compressed, folding duplicates onto
  // one offset and merging adjacent entries back into runs.
  const blobs = [];
  const byRange = new Map();
  const byHash = new Map();
  const entries = [];
  let dataLength = 0;
  for (const e of kept) {
    const rangeKey = `${e.offset}:${e.length}`;
    let offset = byRange.get(rangeKey);
    if (offset === undefined) {
      const start = header.tileDataOffset + e.offset;
      const body = file.subarray(start, start + e.length);
      const hash = createHash("sha256").update(body).digest("base64");
      offset = byHash.get(hash);
      if (offset === undefined) {
        offset = dataLength;
        blobs.push(body);
        dataLength += body.length;
        byHash.set(hash, offset);
      }
      byRange.set(rangeKey, offset);
    }
    const last = entries[entries.length - 1];
    if (last && last.offset === offset && last.length === e.length && last.tileId + last.runLength === e.tileId) {
      last.runLength += e.runLength;
    } else {
      entries.push({ tileId: e.tileId, offset, length: e.length, runLength: e.runLength });
    }
  }

  let numAddressedTiles = 0;
  for (const e of entries) numAddressedTiles += e.runLength;

  const metadata = compress(
    decompress(file.subarray(header.jsonMetadataOffset, header.jsonMetadataOffset + header.jsonMetadataLength), header.internalCompression),
    header.internalCompression,
  );
  const { root, leaves, numLeaves, leafSize } = buildDirectories(entries, header.internalCompression);

  const rootDirectoryOffset = HEADER_SIZE_BYTES;
  const jsonMetadataOffset = rootDirectoryOffset + root.length;
  const leafDirectoryOffset = jsonMetadataOffset + metadata.length;
  const tileDataOffset = leafDirectoryOffset + leaves.length;

  const outHeader = serializeHeader({
    rootDirectoryOffset,
    rootDirectoryLength: root.length,
    jsonMetadataOffset,
    jsonMetadataLength: metadata.length,
    leafDirectoryOffset,
    leafDirectoryLength: leaves.length,
    tileDataOffset,
    tileDataLength: dataLength,
    numAddressedTiles,
    numTileEntries: entries.length,
    numTileContents: blobs.length,
    // We emit bodies in ascending tile-id order of first use, so the output is
    // clustered whatever the input was.
    clustered: true,
    internalCompression: header.internalCompression,
    tileCompression: header.tileCompression,
    tileType: header.tileType,
    minZoom: header.minZoom,
    maxZoom,
    minLon: header.minLon,
    minLat: header.minLat,
    maxLon: header.maxLon,
    maxLat: header.maxLat,
    // centerZoom is carried over untouched even when it is above the new cap:
    // it is only a viewer hint, and clamping it would be an edit, not a trim.
    centerZoom: header.centerZoom,
    centerLon: header.centerLon,
    centerLat: header.centerLat,
  });

  const fd = openSync(OUTPUT, "w");
  try {
    writeSync(fd, outHeader);
    writeSync(fd, root);
    writeSync(fd, metadata);
    if (leaves.length) writeSync(fd, leaves);
    // Tile bodies go out in batches so a hundred thousand tiny writes do not
    // turn into a hundred thousand syscalls.
    let batch = [];
    let batchLength = 0;
    for (const body of blobs) {
      batch.push(body);
      batchLength += body.length;
      if (batchLength >= 8 << 20) {
        writeSync(fd, Buffer.concat(batch, batchLength));
        batch = [];
        batchLength = 0;
      }
    }
    if (batchLength) writeSync(fd, Buffer.concat(batch, batchLength));
  } finally {
    closeSync(fd);
  }

  const outSize = statSync(OUTPUT).size;
  console.log(
    `[trim-pmtiles] ${path.basename(OUTPUT)}: ${fmtBytes(outSize)}, z${header.minZoom}-${maxZoom}, ` +
      `${numAddressedTiles.toLocaleString("en-US")} addressed tiles, ${entries.length.toLocaleString("en-US")} entries, ` +
      `${blobs.length.toLocaleString("en-US")} distinct bodies, ${numLeaves} leaf directories` +
      (leafSize ? ` of ${leafSize} entries` : ""),
  );
  const saved = file.length - outSize;
  console.log(`[trim-pmtiles] saved ${fmtBytes(saved)} (${((saved / file.length) * 100).toFixed(1)}% smaller)`);

  if (VERIFY) await verify(file, readFileSync(OUTPUT), maxZoom);
};

main().catch((error) => {
  console.error(`[trim-pmtiles] ${error.message}`);
  process.exit(1);
});
