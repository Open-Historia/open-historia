/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Region search (the Regions panel and the bottom-bar search box). A region's
// owner is a polity key, and a roster polity's key can be a code ("DEU")
// while its record carries the name people search for ("Germany") and its
// aliases. So a search matches the region's id and name, the owner key, and
// the owner's display name and aliases; and the lists show the display name.
// This is text search only: the key itself is never rewritten or folded.

const clean = (value) => String(value ?? "").trim();

// The name a polity shows under: its record's name, else the key itself.
export const polityDisplayName = (polities, key) => {
  const owner = clean(key);
  if (!owner) return "";
  return clean(polities?.[owner]?.name) || owner;
};

// Owner keys whose record's name or an alias contains the query (lower-case).
export const ownersMatchingQuery = (polities, query) => {
  const q = clean(query).toLowerCase();
  const out = new Set();
  if (!q) return out;
  for (const [key, record] of Object.entries(polities || {})) {
    const aliases = Array.isArray(record?.aliases) ? record.aliases : [];
    const hay = [record?.name, ...aliases].map(clean).join(" ").toLowerCase();
    if (hay.includes(q)) out.add(key);
  }
  return out;
};

// Whether a region ({ id, name, owner }) matches the query. `owners` is the
// set ownersMatchingQuery returned for the same query.
export const regionMatchesQuery = (region, query, owners) => {
  const q = clean(query).toLowerCase();
  if (!q) return true;
  const hay = `${region?.id ?? ""} ${region?.name || ""} ${region?.owner || ""}`.toLowerCase();
  if (hay.includes(q)) return true;
  return !!(region?.owner && owners?.has(region.owner));
};
