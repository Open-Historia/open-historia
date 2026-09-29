/*! Open Historia — country info panel rules © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the map's country panel (Game/Selection/CountryPanel.jsx) shows, kept
// out of React so node can test it: which polity a click means and which
// regions it holds.
import { buildOwnerAliasMap, createOwnerResolver, regionBaseOwner } from "./ownerNames.js";
import { resolvePolityIdentity } from "./polityIdentity.js";

const clean = (value) => String(value ?? "").trim();

// The polity a panel opened on `country` ({ code, name, polityKey }) means in
// this world: its stable key, its record and the name it goes by now.
export const resolvePanelPolity = (country, world) => {
  const requested = country?.polityKey || country?.name || country?.code || "";
  const identity = resolvePolityIdentity(requested, world ?? {}, {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  const stableKey = identity?.resolved || requested;
  const polity = world?.polityOverrides?.[stableKey] ?? null;
  return { stableKey, polity, currentName: polity?.name || country?.name || stableKey };
};

// The panel's three region lists for one polity. The catalog is the one Stats
// counts territory from: the rendered scenario partition, or the merged stock
// catalog when the scenario draws none. Every owner - baked in, controller or
// legal sovereign - goes through the world's own owner folding (a GADM code
// becomes its country name, a display name or alias its key) before it is
// compared with the key, which is exact.
//
// `includeUncatalogued` also lists regions the overrides name but the catalog
// lacks, by id. Only for the merged catalog: against a rendered partition such
// a row is a region the map does not draw.
export const classifyPolityRegions = ({ catalog = [], world = {}, polityKey = "", includeUncatalogued = false } = {}) => {
  const key = clean(polityKey);
  const sovereign = [];
  const controlledForeign = [];
  const occupiedSovereign = [];
  if (!key) return { sovereign, controlledForeign, occupiedSovereign };

  const ownership = world?.regionOwnershipOverrides ?? {};
  const sovereignty = world?.regionSovereigntyOverrides ?? {};
  const owner = createOwnerResolver(buildOwnerAliasMap(world?.polityOverrides));
  const seen = new Set();

  const classify = (regionId, regionName, baseOwner) => {
    const controller = ownership[regionId] != null ? owner(ownership[regionId]) : baseOwner;
    const legalOwner = sovereignty[regionId] != null ? owner(sovereignty[regionId]) : controller;
    if (legalOwner === key) sovereign.push(regionName);
    if (controller === key && legalOwner && legalOwner !== key) controlledForeign.push(regionName);
    if (legalOwner === key && controller && controller !== key) occupiedSovereign.push(regionName);
    seen.add(regionId);
  };

  for (const region of Array.isArray(catalog) ? catalog : []) {
    const id = clean(region?.id);
    if (!id) continue;
    classify(id, clean(region?.name) || id, owner(regionBaseOwner(region)));
  }

  if (includeUncatalogued) {
    for (const regionId of new Set([...Object.keys(ownership), ...Object.keys(sovereignty)])) {
      if (!seen.has(regionId)) classify(regionId, regionId, "");
    }
  }

  return {
    sovereign: [...new Set(sovereign)],
    controlledForeign: [...new Set(controlledForeign)],
    occupiedSovereign: [...new Set(occupiedSovereign)],
  };
};
