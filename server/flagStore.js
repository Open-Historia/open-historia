/*! Open Historia — flag library store © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// The map-maker's own saved flags — the "My flags" shelf in the editor's flag
// picker, reusable across every map, exactly like "Your basemaps".
//
// Deliberately ONE json file, not basemapStore's meta/payload split. A basemap is
// megabytes, so its picker must list cards without touching the payloads; a flag is
// a 256px PNG (~5-15KB), so the whole library is smaller than a single basemap
// thumbnail sheet and the split would buy nothing but two more files to keep in step.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "./dataDir.js";

const FLAGS_PATH = path.join(DATA_DIR, "flags-library.json");

const readAll = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(FLAGS_PATH, "utf8"));
    return Array.isArray(parsed?.flags) ? parsed.flags : [];
  } catch {
    return [];
  }
};

const writeAll = (flags) => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FLAGS_PATH, JSON.stringify({ version: 1, flags }));
};

// Hash server-side and ignore any client-supplied value — the same reasoning as
// basemapStore.js:105-112: trusting a client hash lets a caller poison the dedup
// index so a later genuine upload is silently discarded.
const hashOf = (dataUrl) => crypto.createHash("sha256").update(String(dataUrl)).digest("hex");

const slug = (raw, fallback = "flag") =>
  String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || fallback;

export const listFlags = () => readAll();

// A flag is a 256px PNG — tens of kilobytes. The only check used to be that the
// string starts with "data:image/", which let anything up to the 64 MB body
// limit into a file that is read and rewritten IN FULL on every flag operation,
// so a few oversized entries slow down every request that touches the library.
// Pin the shape instead: a known image type, real base64, and a sane ceiling.
const FLAG_IMAGE_TYPES = new Set(["png", "jpeg", "jpg", "webp", "gif", "svg+xml"]);
const MAX_FLAG_BYTES = 2 * 1024 * 1024;
const DATA_URL_PATTERN = /^data:image\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

const validateFlagDataUrl = (dataUrl) => {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new Error("A flag must be a base64 image data URL.");
  if (!FLAG_IMAGE_TYPES.has(match[1].toLowerCase())) {
    throw new Error(`Unsupported flag image type: ${match[1]}`);
  }
  // base64 is 4 chars per 3 bytes; compare decoded size against the cap.
  const bytes = Math.floor((match[2].length * 3) / 4);
  if (bytes > MAX_FLAG_BYTES) {
    throw new Error(`That flag is too large (${Math.round(bytes / 1024)} KB; the limit is ${MAX_FLAG_BYTES / 1024} KB).`);
  }
};

export const createFlag = (body = {}) => {
  const dataUrl = String(body.dataUrl || "");
  validateFlagDataUrl(dataUrl);
  const flags = readAll();
  const contentHash = hashOf(dataUrl);
  // Same flag already saved: hand back the existing one rather than a duplicate.
  const existing = flags.find((f) => f.contentHash === contentHash);
  if (existing) return existing;

  const base = slug(body.name || body.code);
  let id = base;
  for (let n = 2; flags.some((f) => f.id === id); n += 1) id = `${base}-${n}`;

  const flag = {
    id,
    name: String(body.name || body.code || "Flag").slice(0, 80),
    code: String(body.code || "").toUpperCase().slice(0, 12),
    author: String(body.author || "").slice(0, 80),
    dataUrl,
    contentHash,
    // Provenance, mirroring basemapStore: { community: true, url } marks a flag
    // that came FROM the hub, so publishing a scenario doesn't offer it back to
    // the community as if it were new. Null for a flag the map-maker uploaded.
    source: body.source && typeof body.source === "object" ? JSON.parse(JSON.stringify(body.source)) : null,
    createdAt: new Date().toISOString(),
  };
  writeAll([flag, ...flags]);
  return flag;
};

export const deleteFlag = (id) => {
  // No path traversal surface here: ids only ever index into one json file, they
  // never become a filename (which is why this store needs no containment guard).
  const wanted = String(id ?? "");
  const flags = readAll();
  writeAll(flags.filter((f) => f.id !== wanted));
  return { id: wanted, deleted: true };
};
