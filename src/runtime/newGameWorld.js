/*! Open Historia — the world a new game starts from © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The pure part of the new game picker (GameUI/libraryBar.jsx): which
// countries a scenario offers, and the world a game led by an invented faction
// or by a group starts with. The picker reads the new game's world (seeded
// from its scenario), merges the player's polity into it and writes it back
// whole; a merge that dropped anything here would wipe every other country
// from the first save of the campaign.
import { normalizeGroups } from "./groups.js";

// Owner codes that are no country anyone can play: no-data and disputed
// placeholders in the stock world.
const TECHNICAL_OWNER_CODES = new Set([
  "NA",
  "XCA",
  "Z01",
  "Z02",
  "Z03",
  "Z04",
  "Z05",
  "Z06",
  "Z07",
  "Z08",
  "Z09",
]);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOR = "#a1a1aa";

// Build the start-country list for a scenario: only the factions that actually
// exist in it (world.ownerCodes), named as era polities where defined. Falls
// back to every country for scenarios without an owner list.
export const buildScenarioCountryOptions = (world, allCountries, nameOverrides = {}) => {
  const entries = Array.isArray(allCountries) ? allCountries : [];
  const entriesByCode = new Map();
  for (const entry of entries) {
    const code = String(entry?.code ?? "").trim();
    const name = String(entry?.name ?? "").trim();
    if (!code || !name || TECHNICAL_OWNER_CODES.has(code)) continue;
    const existing = entriesByCode.get(code);
    if (!existing || existing.name === code) entriesByCode.set(code, { code, name });
  }
  const list = [...entriesByCode.values()];
  const ownerCodes = Array.isArray(world?.ownerCodes) ? world.ownerCodes : null;
  const nameByCode = new Map(list.map((entry) => [entry.code, entry.name]));
  const polity = world?.polityOverrides ?? {};
  const overrides = nameOverrides ?? {};
  const resolveOption = (code, fallbackName = code) => {
    const scenarioName = overrides[code] || overrides[fallbackName];
    const polityName = polity[code]?.name;
    return {
      code,
      name: (polityName && polityName !== code ? polityName : null) || scenarioName || fallbackName,
    };
  };
  // ownerCodes lists only owners that hold territory (it is the deduped values of
  // regionOwnershipOverrides). A LANDLESS faction — a polity that owns no regions,
  // e.g. a government-in-exile — is defined in polityOverrides but appears in no
  // ownership override, so it would never reach this list. Union the two: a
  // faction is playable if it holds land OR exists as a polity. The map surface
  // needs no change — a landless faction has nothing to click, and the list
  // button is selection enough.
  const codes = new Set(ownerCodes && ownerCodes.length ? ownerCodes : list.map((e) => e.code));
  for (const code of Object.keys(polity)) codes.add(code);
  const options = [...codes]
    .filter((code) => !TECHNICAL_OWNER_CODES.has(code))
    .map((code) => resolveOption(code, nameByCode.get(code) || code));
  return options
    .sort((left, right) => left.name.localeCompare(right.name));
};

// The world of a game led by a player-invented faction: the faction joins the
// polity registry under its exact name, takes the regions it claimed, and is
// listed as playable even when it holds none. Everything else is kept. A
// faction named like a polity already there takes over that polity's record.
export const worldWithFaction = (world, faction) => {
  const next = { ...(world ?? {}) };
  const name = String(faction?.name ?? "");
  const color = HEX_COLOR.test(faction?.color ?? "") ? faction.color : FALLBACK_COLOR;
  const regionIds = Array.isArray(faction?.regionIds) ? faction.regionIds : [];

  next.polityOverrides = {
    ...(next.polityOverrides ?? {}),
    [name]: { name, aliases: [], color, note: faction?.lore || "" },
  };
  next.regionOwnershipOverrides = { ...(next.regionOwnershipOverrides ?? {}) };
  for (const regionId of regionIds) {
    next.regionOwnershipOverrides[regionId] = name;
  }
  // ownerCodes lists who is playable — include the faction even when landless.
  next.ownerCodes = [...new Set([...(next.ownerCodes ?? []), name])].sort();
  // A faction that claimed drawn/overridden territory needs the custom-region
  // renderer on so its regions paint; a landless faction leaves the flag as-is.
  if (regionIds.length) next.customRegions = true;
  return { world: next, name, color };
};

// The world of a game led by a group rather than a country (runtime/groups.js).
// The player's polity is a LANDLESS polity and the group of the same name: the
// polity carries everything keyed by the player (flag, colour, diplomacy,
// orders), the group the area the map draws and what the story knows the player
// is. One of the scenario's own groups (matched without case, as the registry
// does) keeps its name, area and polity record; a new one is added with the
// starting area it was given.
export const worldWithPlayerGroup = (world, group) => {
  const next = { ...(world ?? {}) };
  const name = String(group?.name ?? "").trim();
  const groups = normalizeGroups(next.groups);
  const known = Object.keys(groups).find((key) => key.toLowerCase() === name.toLowerCase());
  const color = HEX_COLOR.test(group?.color ?? "") ? group.color : (known ? groups[known].color : FALLBACK_COLOR);
  const description = String(group?.lore ?? group?.description ?? "").trim() || (known ? groups[known].description : "");
  const key = known || name;

  next.groups = { ...groups, [key]: { ...(groups[key] ?? {}), name: key, description, color } };
  if (!group?.existing) {
    next.groupAreas = { ...(next.groupAreas ?? {}) };
    for (const regionId of group?.regionIds ?? []) next.groupAreas[regionId] = key;
  }
  next.polityOverrides = {
    ...(next.polityOverrides ?? {}),
    [key]: { name: key, aliases: [], color, note: description, ...(next.polityOverrides?.[key] ?? {}) },
  };
  // ownerCodes lists who is playable — a group owns nothing, so name it here.
  next.ownerCodes = [...new Set([...(next.ownerCodes ?? []), key])].sort();
  return { world: next, key, color };
};
