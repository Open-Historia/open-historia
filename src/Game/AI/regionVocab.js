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
//   Section 1 (FULL `name (id)` lists): only the powers currently IN PLAY — the
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

// Group the catalog by current owner. Returns Map(lowerKey -> {label, regions}).
const groupByOwner = (catalog, overrides) => {
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
    group.regions.push({ name: norm(region.name) || norm(region.id), id: norm(region.id) });
  }
  return groups;
};

export const FOCUS_INTRO =
  "Regions of the powers currently in play — each region as `name (id)`. To move any "
  + "of these territories in a regionTransfer, copy a region's name or id EXACTLY "
  + "(never invent or translate a region name):";
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
export const buildRegionOwnershipText = (regionCatalog, overrides, options = {}) => {
  const catalog = Array.isArray(regionCatalog) ? regionCatalog : [];
  if (catalog.length === 0) {
    return "No region catalog is available, so no per-region vocabulary can be listed.";
  }
  const ownerCap = Number.isFinite(options.ownerCap) ? options.ownerCap : 60;
  const focusTotalCap = Number.isFinite(options.focusTotalCap) ? options.focusTotalCap : 240;
  const rosterCap = Number.isFinite(options.rosterCap) ? options.rosterCap : 80;
  const polityNames = options.polityNames || {};

  const focus = (Array.isArray(options.focusCodes) ? options.focusCodes : [])
    .map(lower)
    .filter(Boolean);
  const focusRank = new Map();
  focus.forEach((code, index) => {
    if (!focusRank.has(code)) focusRank.set(code, index);
  });

  const groups = groupByOwner(catalog, overrides);
  if (groups.size === 0) {
    return "No region ownership could be determined from the current map.";
  }

  const nameFor = (key, label) => norm(polityNames[key]) || norm(polityNames[label]);
  const headerLabel = (key, label) => {
    const displayName = nameFor(key, label);
    return displayName && lower(displayName) !== key ? `${label} (${displayName})` : label;
  };
  const regionWord = (n) => `${n} region${n === 1 ? "" : "s"}`;

  // Section 1 — focus powers, full name(id) lists, in priority order, bounded.
  const focusEntries = [...groups.entries()]
    .filter(([key]) => focusRank.has(key))
    .sort((a, b) => focusRank.get(a[0]) - focusRank.get(b[0]));
  const focusLines = [];
  const focusListed = new Set();
  let emitted = 0;
  for (const [key, group] of focusEntries) {
    if (emitted >= focusTotalCap) break; // a focus power we cannot fit falls through to the roster
    const shown = group.regions.slice(0, ownerCap);
    const list = shown.map((r) => (r.id ? `${r.name} (${r.id})` : r.name)).join(", ");
    const moreInGroup = group.regions.length - shown.length;
    const suffix = moreInGroup > 0 ? `, (+${moreInGroup} more)` : "";
    focusLines.push(`- ${headerLabel(key, group.label)} [${regionWord(group.regions.length)}]: ${list}${suffix}`);
    focusListed.add(key);
    emitted += shown.length;
  }

  // Section 2 — every owner NOT fully listed above, codes + counts only (no province
  // names), ordered by size so the big/likely powers surface first, then code.
  const rosterEntries = [...groups.entries()]
    .filter(([key]) => !focusListed.has(key))
    .sort((a, b) => {
      if (b[1].regions.length !== a[1].regions.length) return b[1].regions.length - a[1].regions.length;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
  const rosterShown = rosterEntries.slice(0, rosterCap);
  const rosterLines = rosterShown.map(([key, group]) =>
    `- ${headerLabel(key, group.label)} — ${regionWord(group.regions.length)}`);
  const rosterOmitted = rosterEntries.length - rosterShown.length;

  const out = [];
  if (focusLines.length) {
    out.push(FOCUS_INTRO, ...focusLines);
  }
  if (rosterLines.length) {
    if (out.length) out.push("");
    out.push(ROSTER_INTRO, ...rosterLines);
    if (rosterOmitted > 0) {
      out.push(`(+${rosterOmitted} more power${rosterOmitted === 1 ? "" : "s"} not listed for brevity.)`);
    }
  }
  return out.join("\n");
};
