/*! Open Historia — a tiny PMTiles v3 writer for tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Test helper, not a test: builds a real (tiny) PMTiles v3 archive in memory,
// with uncompressed directories and one root directory, for the tiled basemap
// and scenario relief tests. Tiles are whatever bytes the caller gives.
import { zxyToTileId } from "pmtiles";

const varint = (out, n) => {
  while (n >= 0x80) { out.push((n % 0x80) | 0x80); n = Math.floor(n / 0x80); }
  out.push(n);
};
export const buildPmtiles = ({ tiles, tileType = 4, minzoom, maxzoom, bounds = [-10, -20, 30, 40] }) => {
  const sorted = tiles.map((t) => ({ ...t, id: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.id - b.id);
  const dir = [];
  varint(dir, sorted.length);
  let last = 0;
  for (const t of sorted) { varint(dir, t.id - last); last = t.id; }
  for (let i = 0; i < sorted.length; i += 1) varint(dir, 1);
  for (const t of sorted) varint(dir, t.bytes.length);
  // Offsets: the first tile at 0 (written +1), every later one straight after.
  sorted.forEach((_, i) => varint(dir, i === 0 ? 1 : 0));
  const root = Buffer.from(dir);
  const meta = Buffer.from("{}");
  const data = Buffer.concat(sorted.map((t) => t.bytes));
  const h = Buffer.alloc(127);
  h.write("PMTiles", 0, "ascii");
  h.writeUInt8(3, 7);
  const u64 = (v, at) => h.writeBigUInt64LE(BigInt(v), at);
  u64(127, 8); u64(root.length, 16);
  u64(127 + root.length, 24); u64(meta.length, 32);
  u64(0, 40); u64(0, 48);
  u64(127 + root.length + meta.length, 56); u64(data.length, 64);
  u64(sorted.length, 72); u64(sorted.length, 80); u64(sorted.length, 88);
  h.writeUInt8(1, 96); h.writeUInt8(1, 97); h.writeUInt8(1, 98); h.writeUInt8(tileType, 99);
  h.writeUInt8(minzoom, 100); h.writeUInt8(maxzoom, 101);
  const e7 = (v, at) => h.writeInt32LE(Math.round(v * 1e7), at);
  e7(bounds[0], 102); e7(bounds[1], 106); e7(bounds[2], 110); e7(bounds[3], 114);
  h.writeUInt8(minzoom, 118); e7((bounds[0] + bounds[2]) / 2, 119); e7((bounds[1] + bounds[3]) / 2, 123);
  return Buffer.concat([h, root, meta, data]);
};
