/*! Open Historia — names already in use © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Add Country (Cheats) creates a polity whose NAME is its key. A name the game
// already uses anywhere is refused rather than quietly turned into an override
// of the existing country — which recoloured it and told the next time skip a
// new polity had been founded. Changing an existing country is the Country
// Editor's job. Names are exact, as everywhere: nothing is folded.

const clean = (value) => String(value ?? "").trim();
const valuesOf = (record) => (record && typeof record === "object" ? Object.values(record) : []);

// `mapPolities` is the panel's country list ([{ code, name }]: every region
// owner the map and the world know, stock countries included on a stock map).
export const polityNameInUse = (world, name, mapPolities = []) => {
    const wanted = clean(name);
    if (!wanted) return false;
    const is = (value) => clean(value) === wanted;
    const overrides = world?.polityOverrides && typeof world.polityOverrides === "object" ? world.polityOverrides : {};
    if (Object.keys(overrides).some(is) || valuesOf(overrides).some((polity) => is(polity?.name) || is(polity?.code))) return true;
    if ((Array.isArray(world?.ownerCodes) ? world.ownerCodes : []).some(is)) return true;
    if (valuesOf(world?.regionOwnershipOverrides).some(is)) return true;
    if (valuesOf(world?.regionSovereigntyOverrides).some(is)) return true;
    if (valuesOf(world?.regionClaimants).some((list) => Array.isArray(list) && list.some(is))) return true;
    return (Array.isArray(mapPolities) ? mapPolities : []).some((polity) => is(polity?.code) || is(polity?.name));
};
