/*! Open Historia — Cheats annexation © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Annex Country and Annex Regions (Cheats): which regions a country holds now,
// the same way the panel's country list reads them (cheats.jsx loadPolities).

import COUNTRY_NAMES from "./generated/countryNames.js";

const clean = (value) => String(value ?? "").trim();

// The owner a catalog region shows now: its ownership override, else the
// owner the map itself gives it (a hand-drawn region has no country code and
// carries its owner as `country`; a scenario may bake a stock region's owner
// the same way), else its stock country. Names are exact.
export const regionOwnerNow = (region, overrides = {}) => {
    const id = clean(region?.id);
    const override = id && overrides && typeof overrides === "object" ? overrides[id] : undefined;
    if (override != null) return clean(override);
    const code = clean(region?.countryCode);
    return clean(region?.country) || clean(COUNTRY_NAMES[code]) || code;
};

// Every region `source` holds now: [{ id, name }] from the catalog, plus any
// region an override hands it that the catalog does not list.
export const regionsHeldBy = (catalog, overrides = {}, source = "") => {
    const owner = clean(source);
    if (!owner) return [];
    const held = new Map();
    for (const region of Array.isArray(catalog) ? catalog : []) {
        const id = clean(region?.id);
        if (id && regionOwnerNow(region, overrides) === owner) held.set(id, { id, name: clean(region?.name) || id });
    }
    for (const [id, code] of Object.entries(overrides && typeof overrides === "object" ? overrides : {})) {
        if (clean(code) === owner && !held.has(id)) held.set(id, { id, name: id });
    }
    return [...held.values()];
};

// The impacts that annex `regions` ([{ id, name, from }], `from` being who
// holds each now) into `owner`, for applyEventImpactsToWorld — the seam a time
// skip's annexation and the Region Inspector go through, so the tools leave
// the world as they do: the title moves, the old claims are settled (the
// map's baked claimants with them), and the new owner is the sovereign.
// A region `from` holds without being its lawful sovereign (an occupation)
// would keep `from` in control after a transfer alone, so it is taken as
// well, and `from` is not left behind as a claimant.
export const annexationImpacts = (world, regions, owner, note = "Annexed by hand in the Cheats panel") => {
    const to = clean(owner);
    const sovereignty = world?.regionSovereigntyOverrides && typeof world.regionSovereigntyOverrides === "object"
        ? world.regionSovereigntyOverrides
        : {};
    const regionTransfers = [];
    const regionControlOps = [];
    if (!to) return { regionTransfers, regionControlOps };
    for (const region of Array.isArray(regions) ? regions : []) {
        const regionId = clean(region?.id);
        const regionName = clean(region?.name);
        const from = clean(region?.from);
        if (!regionId || from === to) continue;
        regionTransfers.push({ regionId, regionName, fromCode: from, toCode: to, note });
        const sovereign = clean(sovereignty[regionId]);
        if (from && sovereign && sovereign !== from) {
            regionControlOps.push(
                { op: "control", regionId, regionName, fromCode: from, toCode: to, note },
                { op: "clear_contest", regionId, regionName, fromCode: to, claimantCode: from, clearAll: false, note },
            );
        }
    }
    return { regionTransfers, regionControlOps };
};
