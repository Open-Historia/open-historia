/*! Open Historia — region ownership vocabulary for AI prompts © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// Why this exists: the jump prompt tells the model the map description contains
// "every polity, region ... separated by a comma ... ANALYZE THIS INCREDIBLY
// CAREFULLY", but the variable behind it (buildWorldSummary) only ever enumerated
// the regionOwnershipOverrides list (truncated to 24) and NOTHING on a stock map.
// So the model was told a full region vocabulary was present, given none, and
// forced to INVENT region names — which then fail resolveRegionTransfers' exact
// name/id match and get silently dropped, so a narrated capture never moves the map.
//
// The naive fix — dump all ~3000 GADM regions every jump — bloats the prompt and
// hands the model thousands of names it does not need this turn. Instead this is
// TIERED so the model gets names where it actually needs them, without "every name
// at once":
//
//   Section 1 (FULL lists of region NAMES): only the powers currently IN PLAY — the
//     player, anyone already re-owned via an override, scenario-defined actors, and
//     the player's active chat partners. These are the likely belligerents, so the
//     model can emit a resolvable transfer on the FIRST attempt.
//   Section 2 (NAMES ONLY, no province names): every other owner, as
//     `Name — N regions`. This gives the model the fromCode/toCode vocabulary
//     for the long tail WITHOUT listing thousands of province names. When it targets
//     one of these, it names the region as best it can and resolveRegionTransfers'
//     retry (buildTransferFeedback, made reliable by the ownerKeyOf base-owner
//     fallback) hands back that power's exact names — on demand, within the same jump.
//
// Every owner in both sections is the FULL COUNTRY NAME. GADM's codes are provenance
// on the region row, never an identity: the model is only ever shown, and only ever
// asked for, "Spain".
//
// A region is shown by its NAME alone, for the same reason. The lists used to
// read `name (id)`, and a model shown "Hamhung (4441)" wrote exactly that back
// as the region: it matched nothing and a treaty's four transfers were dropped
// (a 45-skip test, 2026-10-09). The map's key for a region is the save's
// business; what the model writes is "region: Hamhung" (nameRefs.js).
//
// A region's owner is `regionOwnershipOverrides[id] ?? region.country` (the base
// country from the catalog), so ownership is non-empty on stock maps, not just on
// re-ownership scenarios. The catalog `name` is the exact in-game name the resolver
// keys on (a GADM NAME_1 endonym like "Bayern"/"Ostpreussen"), so listing it — rather
// than relying on the model's exonym guess ("Bavaria") — is what makes the transfer
// resolvable.
//
// Unit-tested directly (regionVocab.test.js) without pulling in the browser-only asset
// layer that promptContext.js imports — its only import is the owner-name
// canonicaliser, which is plain data and safe to load anywhere.

import { toCountryName } from "../../runtime/ownerNames.js";
import { baseCountryOf, splitTerritories } from "./namedAreas.js";

const norm = (value) => String(value ?? "").trim();
const lower = (value) => norm(value).toLowerCase();

// The in-game owner of a region, ALWAYS as the full country name ("Spain"): an
// explicit override wins, else the base country from the catalog (so stock maps
// report real ownership, not ""). It used to answer with the GADM CODE, which is
// where the model learned to write "ESP" — and since a transfer's owner is stored
// verbatim, that minted a phantom "ESP" country beside the real Spain. A legacy
// override still holding a code is canonicalised here rather than handed on.
// It also has to be the name for the FOCUS matching to work at all: the focus set is
// built from the player's country and chat partners, which are names, so a code here
// never matched and the player's own regions were left out of the enumerated list.
export const regionOwnerName = (region, overrides) => {
  const override = norm(overrides?.[region?.id]);
  if (override) return toCountryName(override);
  return norm(region?.country) || toCountryName(norm(region?.countryCode));
};

// Group the catalog by current owner. Returns Map(lowerKey -> {label, regions,
// territories, total}). `polityNames`: the polities the game knows, by lower-case
// name, which are never anyone's territory (namedAreas.js splitTerritories).
const groupByOwner = (catalog, overrides, polityNames) => {
  const groups = new Map();
  for (const region of catalog) {
    const owner = regionOwnerName(region, overrides);
    if (!owner) continue; // unowned / ocean / malformed row
    const key = lower(owner);
    let group = groups.get(key);
    if (!group) {
      group = { label: owner, regions: [] };
      groups.set(key, group);
    }
    group.regions.push({
      name: norm(region.name) || norm(region.id),
      id: norm(region.id),
      base: baseCountryOf(region, toCountryName),
    });
  }
  // What each power holds beyond its own country (namedAreas.js): Greenland
  // under Denmark, Puerto Rico under the United States. Shown by name and size
  // and never region by region, because the name is what a model writes for
  // it: "country: Greenland" is all eighteen of its regions. A 45-skip test
  // (2026-10-09) lost Puerto Rico's independence to the cap below: the United
  // States holds 285 regions, the first 120 by the alphabet were listed, and
  // "Puerto Rico" was not among them.
  for (const [key, group] of groups) {
    const { home, territories } = splitTerritories(group.regions, {
      ownerKey: key,
      isPolity: (name) => groups.has(name) || Boolean(norm(polityNames?.[name])),
      fold: lower,
    });
    group.regions = home;
    group.territories = territories;
    group.total = home.length + territories.reduce((sum, territory) => sum + territory.regions.length, 0);
  }
  return groups;
};

export const FOCUS_INTRO =
  "Regions of the powers currently in play, each by its name as the map spells it. To "
  + "move any of these territories, copy the region's name EXACTLY and write it as "
  + "\"region: <name>\" (never invent or translate a region name, and never write an id). "
  + "A territory or dependency a power holds is given after its regions by its own name "
  + "and size, and is written \"country: <its name>\", which means all of it:";
export const ROSTER_INTRO =
  "All other powers, by full country name. Every owner field (fromCode, toCode, "
  + "ownerCode) takes the power's FULL NAME exactly as written here - \"Spain\", never "
  + "a country code like \"ESP\" and never an abbreviation. A power "
  + "here is NOT region-listed above: when you narrate a transfer involving it, name "
  + "the region as precisely as you can and the engine will resolve it to the exact "
  + "in-game name, correcting you on retry if needed:";

// Build the tiered ownership text.
//   regionCatalog: [{ id, name, country, countryCode }]
//   overrides:     { [regionId]: ownerCode }   (world.regionOwnershipOverrides)
//   options.focusCodes: owner codes to FULLY enumerate, in priority order (player,
//     override owners, defined actors, chat partners) — the theatre in play.
//   options.polityNames: { [code|label]: displayName } for nicer headers.
//   options.ownerCap / focusTotalCap / rosterCap: prompt-budget bounds.
//   options.regionIds: true adds each region's own key after its name; only
//     for a caller that is not a model's prompt. Names alone are the default.
//   options.focusIntro / rosterIntro: the section headers, for a task that is
//     not writing regionTransfers (FOCUS_INTRO and ROSTER_INTRO speak to one).
// Which regions share a border, read from the map's own shapes: regions drawn
// in the editor share their border's points, so two that share at least two
// (an edge, not a corner) are neighbours. The catalog's boxes cannot say this
// for water: a sea's box covers half the map. Map of id -> Set of ids; a map
// whose regions share no points gives an empty one. Kept per features array.
const touchingCache = new WeakMap();
export const regionTouchingMap = (features) => {
  if (!Array.isArray(features)) return new Map();
  if (touchingCache.has(features)) return touchingCache.get(features);
  const byPoint = new Map();
  for (const feature of features) {
    const id = norm(feature?.properties?.id);
    const geometry = feature?.geometry;
    if (!id || !geometry) continue;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const seen = new Set();
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
      for (const ring of Array.isArray(polygon) ? polygon : []) {
        for (const point of Array.isArray(ring) ? ring : []) {
          if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
          const key = `${point[0].toFixed(4)},${point[1].toFixed(4)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!byPoint.has(key)) byPoint.set(key, []);
          byPoint.get(key).push(id);
        }
      }
    }
  }
  const shared = new Map();
  for (const ids of byPoint.values()) {
    if (ids.length < 2) continue;
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        if (!shared.has(a)) shared.set(a, new Map());
        shared.get(a).set(b, (shared.get(a).get(b) || 0) + 1);
      }
    }
  }
  const touching = new Map([...shared].map(([id, counts]) => [id, new Set([...counts].filter(([, n]) => n >= 2).map(([other]) => other))]));
  touchingCache.set(features, touching);
  return touching;
};

// The land no power rules, by the powers it borders. The lists above are of
// what powers hold, so on a hand-drawn world with wild land between its realms
// a model told to take the unruled region next door was never shown its name:
// "Try to take Rustmoor Coast" came back as a column that could find Rustmoor
// Coast on no boundary roll (a fantasy scenario, 2026-10-28). Neighbours are
// the map's shared borders (`touching`, regionTouchingMap), else its declared
// adjacencies, else touching boxes (which can only add a diagonal neighbour,
// never drop a real one). Water is not land to take, but it joins: wild land
// one sea away from a power's coast is listed under that power as across that
// sea, so a fleet can carry settlers to it. Only by shared borders: a sea's
// box is half the map. "" when no land is unruled, as on the built-in world.
//   waterTypes   the ids of the region types that are water (regionTypes.js waterTypeIds)
//   perOwnerCap  how many a power is listed with at most, by land and by sea each
//   touching     the map's shared borders (regionTouchingMap), a function giving
//                them (called only when some land is unruled), or null
export const buildUnruledBordersText = (regionCatalog, overrides, { waterTypes = new Set(), perOwnerCap = 30, touching = null } = {}) => {
  const catalog = (Array.isArray(regionCatalog) ? regionCatalog : []).filter((region) => norm(region?.id));
  const water = (region) => waterTypes.has(norm(region.typeId)) || waterTypes.has(norm(region.type));
  const unruled = catalog.filter((region) => !regionOwnerName(region, overrides) && !water(region));
  if (!unruled.length) return "";
  const box = (region) => (Array.isArray(region.bounds) && region.bounds.length === 2 ? region.bounds : null);
  const touch = (a, b) => {
    const p = box(a), q = box(b);
    return Boolean(p && q) && p[0][0] <= q[1][0] && q[0][0] <= p[1][0] && p[0][1] <= q[1][1] && q[0][1] <= p[1][1];
  };
  const declared = new Map();
  for (const region of catalog) {
    for (const other of Array.isArray(region.adjacencies) ? region.adjacencies : []) {
      for (const [from, to] of [[region.id, norm(other)], [norm(other), region.id]]) {
        if (!declared.has(from)) declared.set(from, new Set());
        declared.get(from).add(to);
      }
    }
  }
  const given = typeof touching === "function" ? touching() : touching;
  const borders = given instanceof Map ? given : new Map();
  const byId = new Map(catalog.map((region) => [region.id, region]));
  const owned = catalog.filter((region) => regionOwnerName(region, overrides));
  const byOwner = new Map();
  const bySea = new Map();
  const add = (map, owner, entry) => {
    if (!map.has(owner)) map.set(owner, new Map());
    if (!map.get(owner).has(entry.name)) map.get(owner).set(entry.name, entry.text);
  };
  for (const wild of unruled) {
    const name = norm(wild.name) || wild.id;
    const shared = borders.get(wild.id);
    const near = shared?.size
      ? owned.filter((region) => shared.has(region.id))
      : declared.has(wild.id)
        ? owned.filter((region) => declared.get(wild.id).has(region.id))
        : owned.filter((region) => touch(wild, region));
    const byLand = new Set(near.map((region) => regionOwnerName(region, overrides)));
    for (const owner of byLand) add(byOwner, owner, { name, text: name });
    for (const seaId of shared ?? []) {
      const sea = byId.get(seaId);
      if (!sea || !water(sea)) continue;
      for (const coastId of borders.get(seaId) ?? []) {
        const coast = byId.get(coastId);
        const owner = coast && !water(coast) ? regionOwnerName(coast, overrides) : "";
        if (owner && !byLand.has(owner)) add(bySea, owner, { name, text: `${name} (across ${norm(sea.name) || sea.id})` });
      }
    }
  }
  if (!byOwner.size && !bySea.size) return "";
  const listed = (entries) => {
    const sorted = [...(entries ?? new Map())].sort((a, b) => a[0].localeCompare(b[0])).map(([, text]) => text);
    const shown = sorted.slice(0, perOwnerCap);
    return `${shown.join(", ")}${sorted.length > shown.length ? `, (+${sorted.length - shown.length} more)` : ""}`;
  };
  const lines = [...new Set([...byOwner.keys(), ...bySea.keys()])]
    .sort((a, b) => a.localeCompare(b))
    .map((owner) => {
      const parts = [];
      if (byOwner.has(owner)) parts.push(listed(byOwner.get(owner)));
      if (bySea.has(owner)) parts.push(`by sea: ${listed(bySea.get(owner))}`);
      return `- ${owner}: ${parts.join("; ")}`;
    });
  return [
    `Land no power rules (${unruled.length} regions), by the powers it borders. Such a region can be settled, `
      + "taken under a power's protection or subdued: a regionTransfers entry naming it \"region: <name>\" exactly as "
      + "written here (without the sea in brackets), with no fromCode. Each is listed beside every power it touches; "
      + "\"by sea\" is land across one stretch of water from that power's coast, reached by ships over the sea named:",
    ...lines,
  ].join("\n");
};

export const buildRegionOwnershipText = (regionCatalog, overrides, options = {}) => {
  const catalog = Array.isArray(regionCatalog) ? regionCatalog : [];
  if (catalog.length === 0) {
    return "No region catalog is available, so no per-region vocabulary can be listed.";
  }
  // A power in play gets its regions in full: a model told to copy names
  // exactly cannot annex a region it was never shown, and the top powers of a
  // turn are what the turn moves. A power that is listed is listed WHOLE.
  // There used to be a limit of 120 regions a power, taken by the alphabet:
  // the United States holds 285 on the built-in world, its list stopped at
  // "Houston", and a model asked to free Puerto Rico, which it was never
  // shown, handed over the British Virgin Islands (a 45-skip test,
  // 2026-10-09). A caller may still pass `ownerCap`. What bounds the prompt is
  // `focusTotalCap`: once that many regions are listed, the powers still
  // waiting go to the roster by name and size.
  const ownerCap = Number.isFinite(options.ownerCap) ? options.ownerCap : Infinity;
  const focusTotalCap = Number.isFinite(options.focusTotalCap) ? options.focusTotalCap : 480;
  const rosterCap = Number.isFinite(options.rosterCap) ? options.rosterCap : 80;
  const polityNames = options.polityNames || {};
  const withIds = options.regionIds === true;
  const focusIntro = options.focusIntro || FOCUS_INTRO;
  const rosterIntro = options.rosterIntro || ROSTER_INTRO;

  const focus = (Array.isArray(options.focusCodes) ? options.focusCodes : [])
    .map(lower)
    .filter(Boolean);
  const focusRank = new Map();
  focus.forEach((code, index) => {
    if (!focusRank.has(code)) focusRank.set(code, index);
  });

  const groups = groupByOwner(catalog, overrides, polityNames);
  if (groups.size === 0) {
    return "No region ownership could be determined from the current map.";
  }

  const nameFor = (key, label) => norm(polityNames[key]) || norm(polityNames[label]);
  const headerLabel = (key, label) => {
    const displayName = nameFor(key, label);
    return displayName && lower(displayName) !== key ? `${label} (${displayName})` : label;
  };
  const regionWord = (n) => `${n} region${n === 1 ? "" : "s"}`;
  // "; territories: Greenland (18 regions), Faroe Islands (4 regions)", or "".
  const territoriesOf = (group) => (group.territories.length
    ? `; territories: ${group.territories.map((territory) => `${territory.name} (${regionWord(territory.regions.length)})`).join(", ")}`
    : "");

  // Section 1 — focus powers, full lists of region names, in priority order, bounded.
  const focusEntries = [...groups.entries()]
    .filter(([key]) => focusRank.has(key))
    .sort((a, b) => focusRank.get(a[0]) - focusRank.get(b[0]));
  const focusLines = [];
  const focusListed = new Set();
  let emitted = 0;
  for (const [key, group] of focusEntries) {
    if (emitted >= focusTotalCap) break; // a focus power we cannot fit falls through to the roster
    const shown = group.regions.slice(0, ownerCap);
    const list = shown.map((r) => (r.id && withIds ? `${r.name} (${r.id})` : r.name)).join(", ");
    const moreInGroup = group.regions.length - shown.length;
    const suffix = moreInGroup > 0 ? `, (+${moreInGroup} more)` : "";
    focusLines.push(`- ${headerLabel(key, group.label)} [${regionWord(group.total)}]: ${list}${suffix}${territoriesOf(group)}`);
    focusListed.add(key);
    emitted += shown.length;
  }

  // Section 2 — every owner NOT fully listed above, codes + counts only (no province
  // names), ordered by size so the big/likely powers surface first, then code.
  const rosterEntries = [...groups.entries()]
    .filter(([key]) => !focusListed.has(key))
    .sort((a, b) => {
      if (b[1].total !== a[1].total) return b[1].total - a[1].total;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
  const rosterShown = rosterEntries.slice(0, rosterCap);
  const rosterLines = rosterShown.map(([key, group]) =>
    `- ${headerLabel(key, group.label)} — ${regionWord(group.total)}${territoriesOf(group)}`);
  const rosterOmitted = rosterEntries.length - rosterShown.length;

  const out = [];
  if (focusLines.length) {
    out.push(focusIntro, ...focusLines);
  }
  if (rosterLines.length) {
    if (out.length) out.push("");
    out.push(rosterIntro, ...rosterLines);
    if (rosterOmitted > 0) {
      out.push(`(+${rosterOmitted} more power${rosterOmitted === 1 ? "" : "s"} not listed for brevity.)`);
    }
  }
  return out.join("\n");
};
