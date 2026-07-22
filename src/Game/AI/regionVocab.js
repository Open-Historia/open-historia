/*! Open Historia — region ownership vocabulary for AI prompts © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Why this exists: the jump prompt tells the model the map description contains
// "every polity, region ... separated by a comma ... ANALYZE THIS INCREDIBLY
// CAREFULLY", but the variable behind it (buildWorldSummary) only ever enumerated
// the regionOwnershipOverrides list (truncated to 24) and NOTHING on a stock map.
// So the model was told a full region vocabulary was present, given none, and
// forced to INVENT region names — which then fail resolveRegionTransfers' exact
// name/id match and get silently dropped, so a narrated capture never moves the map.
//
// This builds the vocabulary the prompt promises: regions listed as `name (id)`
// grouped by their CURRENT in-game owner. The crucial detail is that a region's
// owner is `regionOwnershipOverrides[id] ?? region.countryCode` — the base country
// from the catalog — so the list is non-empty on stock maps (where ownership lives
// in the base tiles, not an override), not just on re-ownership scenarios.
//
// Pure and dependency-free so it is unit-tested directly (regionVocab.test.js)
// without pulling in the browser-only asset layer that promptContext.js imports.
// The catalog `name` is the exact in-game name the resolver keys on (a GADM NAME_1
// endonym like "Bayern"/"Ostpreussen"), so listing it — rather than relying on the
// model's exonym guess ("Bavaria") — is what makes the emitted transfer resolvable.

const norm = (value) => String(value ?? "").trim();
const lower = (value) => norm(value).toLowerCase();

// The in-game owner code for a region: an explicit override wins, else the base
// country code from the catalog (so stock maps report real ownership, not "").
export const regionOwnerCode = (region, overrides) => {
  const override = norm(overrides?.[region?.id]);
  if (override) return override;
  return norm(region?.countryCode) || norm(region?.country);
};

// Build the owner-grouped region enumeration.
//   regionCatalog: [{ id, name, country, countryCode }]
//   overrides:     { [regionId]: ownerCode }   (world.regionOwnershipOverrides)
//   options.priorityCodes: owner codes to list FIRST, in order (player, then
//     override owners, tagged powers, catalyst participants) — the theatre the
//     model most needs a resolvable vocabulary for.
//   options.polityNames: { [code]: displayName } for nicer group headers.
//   options.ownerCap / options.totalCap: prompt-budget bounds.
export const buildRegionOwnershipText = (regionCatalog, overrides, options = {}) => {
  const catalog = Array.isArray(regionCatalog) ? regionCatalog : [];
  if (catalog.length === 0) {
    return "No region catalog is available, so no per-region vocabulary can be listed.";
  }
  const ownerCap = Number.isFinite(options.ownerCap) ? options.ownerCap : 40;
  const totalCap = Number.isFinite(options.totalCap) ? options.totalCap : 500;
  const polityNames = options.polityNames || {};
  const priority = (Array.isArray(options.priorityCodes) ? options.priorityCodes : [])
    .map(lower)
    .filter(Boolean);
  const priorityRank = new Map();
  priority.forEach((code, index) => {
    if (!priorityRank.has(code)) priorityRank.set(code, index);
  });

  // Group regions by their current owner code (preserving a display-case label).
  const groups = new Map(); // key(lowercased owner) -> { label, regions: [{name,id}] }
  for (const region of catalog) {
    const owner = regionOwnerCode(region, overrides);
    if (!owner) continue; // unowned / ocean / malformed row
    const key = lower(owner);
    let group = groups.get(key);
    if (!group) {
      group = { label: owner, regions: [] };
      groups.set(key, group);
    }
    group.regions.push({ name: norm(region.name) || norm(region.id), id: norm(region.id) });
  }
  if (groups.size === 0) {
    return "No region ownership could be determined from the current map.";
  }

  // Order: priority owners first (in the given order), then the rest by region
  // count descending, then owner code for a stable, deterministic result.
  const ordered = [...groups.entries()].sort((a, b) => {
    const ra = priorityRank.has(a[0]) ? priorityRank.get(a[0]) : Infinity;
    const rb = priorityRank.has(b[0]) ? priorityRank.get(b[0]) : Infinity;
    if (ra !== rb) return ra - rb;
    if (b[1].regions.length !== a[1].regions.length) return b[1].regions.length - a[1].regions.length;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  const lines = [];
  let emitted = 0;
  let ownersListed = 0;
  for (const [key, group] of ordered) {
    if (emitted >= totalCap) break;
    const displayName = norm(polityNames[key]) || norm(polityNames[group.label]);
    const header = displayName && lower(displayName) !== key
      ? `${group.label} (${displayName})`
      : group.label;
    const shown = group.regions.slice(0, ownerCap);
    const list = shown.map((r) => (r.id ? `${r.name} (${r.id})` : r.name)).join(", ");
    const moreInGroup = group.regions.length - shown.length;
    const suffix = moreInGroup > 0 ? `, (+${moreInGroup} more)` : "";
    lines.push(`- ${header} [${group.regions.length} region${group.regions.length === 1 ? "" : "s"}]: ${list}${suffix}`);
    emitted += shown.length;
    ownersListed += 1;
  }

  const ownersOmitted = ordered.length - ownersListed;
  if (ownersOmitted > 0) {
    lines.push(`(+${ownersOmitted} more owner${ownersOmitted === 1 ? "" : "s"} not listed for brevity — the powers above are the active theatre.)`);
  }
  return lines.join("\n");
};
