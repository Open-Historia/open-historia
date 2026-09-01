/*! Open Historia — per-scenario stat sheet definition © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Which strategic indices a scenario's country sheets carry. The economy block
// (GDP, inflation, debt) is the same question in every era, but the indices are
// not: "Energy autonomy" is a modern concern, and a post-apocalyptic or ancient
// scenario wants Water, Radiation, Legitimacy or Grain instead.
//
// Lives in the scenario's stats.json (an optional asset like flags and tags). A
// scenario without one gets DEFAULT_INDEX_ROWS, so every existing scenario keeps
// exactly the panel it has today.

import { JSON_URLS, readJson } from "./assets.js";

// The stock six. Also the fallback, so this file is the single definition of
// "the normal sheet" rather than it living inline in the panel.
export const DEFAULT_INDEX_ROWS = [
  { key: "sovereignty", label: "Sovereignty", icon: "⚑", color: "#8b5cf6" },
  { key: "foodAutonomy", label: "Food autonomy", icon: "🌾", color: "#22c55e" },
  { key: "energyAutonomy", label: "Energy autonomy", icon: "⚡", color: "#eab308" },
  { key: "economicIndependence", label: "Economic independence", icon: "🏦", color: "#06b6d4" },
  { key: "internalSecurity", label: "Internal security", icon: "🛡", color: "#f43f5e" },
  { key: "internationalReputation", label: "International reputation", icon: "🤝", color: "#3b82f6" },
];

const FALLBACK_COLOR = "#8b5cf6";

// A key has to survive being a JSON property and an AI-written field name, so it
// is restricted rather than trusted: letters and digits only, camelCase by
// convention, first character a letter.
export const toIndexKey = (value) => {
  const cleaned = String(value ?? "").replace(/[^A-Za-z0-9 ]/g, " ").trim();
  if (!cleaned) return "";
  const [first, ...rest] = cleaned.split(/\s+/);
  const key = first.toLowerCase() + rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
  return /^[A-Za-z]/.test(key) ? key.slice(0, 40) : "";
};

export const normalizeIndexRows = (value) => {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.indices) ? value.indices : null;
  if (!rows) return null;
  const seen = new Set();
  const normalized = [];
  for (const row of rows) {
    const label = String(row?.label ?? "").trim().slice(0, 48);
    const key = toIndexKey(row?.key || label);
    // A row with no key is unaddressable by the AI and unreadable from the sheet,
    // and a duplicate key would silently shadow the row above it.
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      key,
      label,
      icon: String(row?.icon ?? "").trim().slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(String(row?.color ?? "")) ? row.color : FALLBACK_COLOR,
    });
    if (normalized.length >= 12) break; // a panel, not a spreadsheet
  }
  return normalized.length ? normalized : null;
};

let cached = null;
let cacheKey = "";

// Reads the active scenario's definition, falling back to the stock rows. Cached
// on the runtime token like the other scenario assets, so switching scenarios
// refetches and a poll does not.
export const loadIndexRows = async () => {
  const key = JSON_URLS.stats;
  if (cached && cacheKey === key) return cached;
  let rows = null;
  try {
    rows = normalizeIndexRows(await readJson(key, { defaultValue: {} }));
  } catch {
    rows = null; // no stats.json, or unreadable — the stock sheet is the answer
  }
  cacheKey = key;
  cached = rows ?? DEFAULT_INDEX_ROWS;
  return cached;
};

// The list handed to the AI so it writes the fields this scenario actually has.
export const describeIndexRows = (rows) =>
  (rows ?? DEFAULT_INDEX_ROWS).map((row) => `${row.key} (${row.label})`).join(", ");
