/*!
 * Open Historia — the official list of detailed (tiled) basemaps.
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Detailed maps are hundreds of megabytes, so they never travel in a scenario or
// a hub post. Maintainers upload each one as a release of the project's own
// repository, Open-Historia/Open-Historia-basemaps, and list it in that
// repository's `basemaps.json` (docs/adr/0006-official-basemap-list.md):
//
//   { "format": 1, "basemaps": [ { "id": "westeros-relief", "name": "…",
//       "author": "…", "license": "…",
//       "versions": [ { "version": 9, "url": "https://github.com/Open-Historia/
//         Open-Historia-basemaps/releases/download/<tag>/<file>.pmtiles",
//         "bytes": 463431905, "sha256": "…", "preview": "…", "notes": "…" } ] } ] }
//
// A scenario names a map by its id and the lowest version it needs; the game
// looks the rest up here. This is the only place a detailed map is downloaded
// from: a version whose link is not one of that repository's releases is
// dropped, whatever the list says.

const OFFICIAL_REPO = "Open-Historia/Open-Historia-basemaps";
export const OFFICIAL_RELEASES_PREFIX = `https://github.com/${OFFICIAL_REPO}/releases/download/`;
export const OFFICIAL_CATALOG_URL =
  process.env.OH_BASEMAP_CATALOG_URL || `https://raw.githubusercontent.com/${OFFICIAL_REPO}/main/basemaps.json`;
// Tests and local checks only: one exact origin standing in for the releases
// (the same variable the hub download guard reads). Unset in every real run.
const TEST_ORIGIN = process.env.OH_HUB_TEST_ORIGIN || "";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_VERSIONS = 200;
const MAX_BASEMAPS = 500;

export const isOfficialReleaseUrl = (value) => {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (TEST_ORIGIN && url.origin === TEST_ORIGIN) return true;
  return url.href.startsWith(OFFICIAL_RELEASES_PREFIX) && !url.search && !url.hash && !url.pathname.includes("..");
};

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const cleanVersion = (raw, cap) => {
  const version = Number(raw?.version);
  const bytes = Number(raw?.bytes);
  const sha256 = String(raw?.sha256 || "").toLowerCase();
  if (!Number.isInteger(version) || version < 1) return null;
  if (!Number.isFinite(bytes) || bytes <= 0 || (cap && bytes > cap)) return null;
  if (!HASH_PATTERN.test(sha256) || !isOfficialReleaseUrl(raw?.url)) return null;
  const preview = isOfficialReleaseUrl(raw?.preview) ? String(raw.preview) : "";
  return {
    version,
    url: String(raw.url),
    bytes,
    sha256,
    ...(preview ? { preview } : {}),
    ...(text(raw?.notes, 500) ? { notes: text(raw.notes, 500) } : {}),
    ...(text(raw?.released, 32) ? { released: text(raw.released, 32) } : {}),
  };
};

// The list as the game uses it: every entry checked, anything malformed or
// pointing outside the official releases left out (never the whole list), and
// each map's versions in rising order, one per number.
export const parseOfficialCatalog = (raw, { cap = 0 } = {}) => {
  const basemaps = [];
  const seen = new Set();
  const entries = Array.isArray(raw?.basemaps) ? raw.basemaps.slice(0, MAX_BASEMAPS) : [];
  for (const entry of entries) {
    const id = String(entry?.id || "");
    if (!ID_PATTERN.test(id) || seen.has(id)) continue;
    const byNumber = new Map();
    for (const candidate of (Array.isArray(entry.versions) ? entry.versions.slice(0, MAX_VERSIONS) : [])) {
      const version = cleanVersion(candidate, cap);
      if (version && !byNumber.has(version.version)) byNumber.set(version.version, version);
    }
    if (!byNumber.size) continue;
    seen.add(id);
    basemaps.push({
      id,
      name: text(entry.name, 80) || id,
      ...(text(entry.author, 80) ? { author: text(entry.author, 80) } : {}),
      ...(text(entry.license, 200) ? { license: text(entry.license, 200) } : {}),
      versions: [...byNumber.values()].sort((a, b) => a.version - b.version),
    });
  }
  return { basemaps };
};

export const findOfficialEntry = (catalog, id) => catalog?.basemaps?.find((entry) => entry.id === id) || null;

export const latestOfficialVersion = (entry) => entry?.versions?.[entry.versions.length - 1] || null;

// ---- Fetching the list ----------------------------------------------------
// Read from GitHub at most every few minutes; the last good copy is kept on
// disk, so a player who is offline (or GitHub is down) still sees the maps they
// were offered before, marked stale.
const CACHE_MS = 10 * 60 * 1000;
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

export const createOfficialCatalogReader = ({ fetchHop, isAllowed, readSaved, save, cap }) => {
  let cached = null; // { catalog, at }
  let inFlight = null;

  const load = async () => {
    let current = new URL(OFFICIAL_CATALOG_URL);
    let response;
    for (let hop = 0; ; hop += 1) {
      if (hop > 5) throw new Error("Too many redirects fetching the official basemap list.");
      response = await fetchHop(current);
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) break;
      const next = new URL(location, current);
      if (!isAllowed(next)) throw new Error("The official basemap list redirected off GitHub.");
      current = next;
    }
    if (!response.ok) throw new Error(`The official basemap list could not be read (HTTP ${response.status}).`);
    const body = await response.text();
    if (body.length > MAX_CATALOG_BYTES) throw new Error("The official basemap list is too large.");
    return parseOfficialCatalog(JSON.parse(body), { cap });
  };

  return async ({ force = false } = {}) => {
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return { ...cached.catalog, stale: false };
    if (!inFlight) {
      inFlight = load()
        .then((catalog) => {
          cached = { catalog, at: Date.now() };
          try { save(catalog); } catch { /* the in-memory copy still serves */ }
          return { ...catalog, stale: false };
        })
        .finally(() => { inFlight = null; });
    }
    try {
      return await inFlight;
    } catch (error) {
      const saved = cached?.catalog || (() => {
        try { return readSaved(); } catch { return null; }
      })();
      if (saved?.basemaps) return { ...parseOfficialCatalog(saved, { cap }), stale: true, error: error.message };
      return { basemaps: [], stale: true, error: error.message };
    }
  };
};
