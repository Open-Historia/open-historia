/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The Scenario Workshop's bulk polity import: a roster JSON from the Polities
// panel, the rows the Province Map Importer collects from an imported GeoJSON, or
// the built-in flags the Polities panel fills in. Kept out of the React hook so
// the merge can be tested in node, like cityMarkers.js; useMapDocument's
// importPolityRoster is the thin state wrapper around it.
//
// Polity keys are exact: a row is keyed by the first field that has a value,
// never by a folded or matched name, and the key is what regions own.

import { normalizeTagList } from "../runtime/countryTags.js";

const clean = (value) => String(value ?? "").trim();

// The spellings a roster may use for each field, in the order they win.
const KEY_FIELDS = ["key", "stableKey", "stable_key", "code", "id", "name"];
const NAME_FIELDS = ["name", "displayName", "display_name", "label"];
const COLOR_FIELDS = ["color", "rgb", "colour"];
const FLAG_FIELDS = ["flag", "flagUrl", "flag_url", "flagDataUrl"];

// The first field with a non-blank value. A blank column (a CSV-shaped JSON row
// with an empty "key") falls through to the next spelling rather than dropping
// the row.
const firstFilled = (raw, fields) => {
  for (const field of fields) {
    const value = raw?.[field];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number") {
      if (clean(value)) return value;
      continue;
    }
    return value;
  }
  return null;
};

// The stable key a roster row names, or "" when it names none. The Polities
// panel's preview uses this too, so what it counts is what gets imported.
export const rosterRowKey = (raw) => clean(firstFilled(raw, KEY_FIELDS));

// [r, g, b] from an array or a six-digit hex, or null.
export const parseRosterColor = (value) => {
  if (Array.isArray(value) && value.length >= 3) {
    const rgb = value.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
    return rgb.every(Number.isFinite) ? rgb : null;
  }
  const m = /^#?([a-f0-9]{6})$/i.exec(clean(value));
  if (!m) return null;
  return [
    Number.parseInt(m[1].slice(0, 2), 16),
    Number.parseInt(m[1].slice(2, 4), 16),
    Number.parseInt(m[1].slice(4, 6), 16),
  ];
};

// An array, or a pipe-separated string.
const pipeList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split("|");
  return [];
};

// Rows in any accepted shape -> { key, name, aliases, color, flag, tags, status,
// note, mapRefs }, one per key; the first row for a key wins. status and note
// are "" when the row has none, so the merge keeps what the polity already has.
export const normalizeRosterRows = (rows) => {
  const normalized = [];
  const seen = new Set();

  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const key = rosterRowKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const name = clean(firstFilled(raw, NAME_FIELDS)) || key;
    const aliases = [...new Set(
      [key, name, ...pipeList(raw.aliases)]
        .map((v) => String(v || "").trim())
        .filter(Boolean),
    )];
    const flag = clean(firstFilled(raw, FLAG_FIELDS));

    normalized.push({
      key,
      name,
      aliases,
      color: parseRosterColor(firstFilled(raw, COLOR_FIELDS)),
      flag: flag || null,
      tags: normalizeTagList(pipeList(raw.tags)),
      status: clean(raw.status),
      note: String(raw.note || ""),
      mapRefs: raw.mapRefs && typeof raw.mapRefs === "object" && !Array.isArray(raw.mapRefs)
        ? raw.mapRefs
        : null,
    });
  }

  return normalized;
};

const EMPTY_SUMMARY = Object.freeze({ count: 0, created: 0, updated: 0, colors: 0, flags: 0, tags: 0, firstKey: "" });

// Merges roster rows into a document in one pass. Returns the next document and
// the summary the panels report ({ count, created, updated, colors, flags, tags,
// firstKey }). An existing polity keeps its code, and its status and note where
// the row has none; its old name stays on as an alias. Territory ownership is
// not touched.
export const mergePolityRoster = (doc, rows) => {
  const normalized = normalizeRosterRows(rows);
  if (!normalized.length) return { doc, summary: { ...EMPTY_SUMMARY } };

  const existingBefore = new Set(Object.keys(doc?.polities || {}));
  const summary = {
    count: normalized.length,
    created: normalized.filter((row) => !existingBefore.has(row.key)).length,
    updated: normalized.filter((row) => existingBefore.has(row.key)).length,
    colors: normalized.filter((row) => row.color).length,
    flags: normalized.filter((row) => row.flag).length,
    tags: normalized.filter((row) => row.tags.length).length,
    firstKey: normalized[0]?.key || "",
  };

  const polities = { ...(doc?.polities || {}) };
  const colorOverrides = { ...(doc?.colorOverrides || {}) };
  const flags = { ...(doc?.flags || {}) };
  const tags = { ...(doc?.tags || {}) };

  for (const row of normalized) {
    const current = polities[row.key] || {};
    const aliases = [...new Set([
      ...(Array.isArray(current.aliases) ? current.aliases : []),
      current.name,
      ...row.aliases,
    ].map((v) => String(v || "").trim()).filter(Boolean))];

    polities[row.key] = {
      ...current,
      code: current.code || row.key,
      name: row.name,
      aliases,
      status: row.status || current.status || "active",
      note: row.note || current.note || "",
      ...(row.mapRefs ? { mapRefs: row.mapRefs } : {}),
    };

    if (row.color) colorOverrides[row.key] = row.color;
    if (row.flag) flags[row.key] = row.flag;
    if (row.tags.length) tags[row.key] = row.tags;
  }

  return { doc: { ...doc, polities, colorOverrides, flags, tags }, summary };
};
