/*! Open Historia — a scenario's map, by its checksum © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What a scenario's map is, as one checksum: the files the game draws it from
// (its regions, cities, background and own basemaps, as the runtime serves
// them, the stock world's where it has none of its own) and the sizes of its
// own tiles. A shared game's host states it in its lobby, and each guest's
// screen checks its own copy against it before it takes a country: two copies
// that differ draw two different worlds, and nothing used to say so. A region
// the host had split in two stayed one on the guest's copy, which went on
// showing its old owner for the whole game while the events said otherwise.
//
// A file's own checksum is kept while its size and time stay the same, so a
// lobby asked again reads nothing; a file rewritten (its owners' schema, the
// first time it is served) is read again.
import crypto from "node:crypto";
import fs from "node:fs";

const kept = new Map(); // path -> { stamp, hash }

const stampOf = (filePath) => {
  const stat = fs.statSync(filePath);
  return `${stat.size}:${stat.mtimeMs}`;
};

export const fileChecksum = (filePath) => {
  const stamp = stampOf(filePath);
  const known = kept.get(filePath);
  if (known?.stamp === stamp) return known.hash;
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  kept.set(filePath, { stamp, hash });
  return hash;
};

// `parts`: [{ name, path, sizeOnly }] in a fixed order. A part with no file is
// "-"; one known by its size alone (a scenario's own tiles, hundreds of
// megabytes) is its size.
export const mapFingerprint = (parts) => {
  const lines = parts.map(({ name, path: filePath, sizeOnly = false }) => {
    if (!filePath || !fs.existsSync(filePath)) return `${name}:-`;
    return `${name}:${sizeOnly ? fs.statSync(filePath).size : fileChecksum(filePath)}`;
  });
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
};
