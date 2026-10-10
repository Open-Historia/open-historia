/*! Open Historia — a territory named by its own name © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A territory or dependency is written by its own name: "country: Greenland".
//
// The map is made of regions, and a region knows two things about whose it is:
// who holds it now, and which country it belongs to by geography (the code its
// row carries: GRL for the eighteen regions of Greenland, all held by Denmark;
// PRI for Puerto Rico, held by the United States). Until now only the first
// could be written. An order to buy Greenland had no name to put in a transfer:
// the map has no region called Greenland, and "country: Greenland" meant the
// whole of a polity called Greenland, which holds nothing. In a 45-skip test
// (2026-10-09) the player granted Puerto Rico independence and the model moved
// "British Virgin Islands": the United States holds 285 regions, the prompt
// listed the first 120 by the alphabet, and that was the nearest name in it.
//
// So the regions that share a country of geography are an AREA, and the area's
// name stands for all of them:
//
//   country: Puerto Rico, from United States   every region of Puerto Rico the
//                                               United States holds
//   country: Greenland, from Denmark           the eighteen regions of Greenland
//
// It never reaches further than that. The name of a polity that holds land
// today is that polity, as it always was; an area is read only where the name
// would otherwise mean nothing, or where it is said beside a different losing
// side ("country: Ukraine" from Russia is the Ukrainian land Russia holds, and
// never the whole of Russia).
//
// DELIBERATELY IMPORT-FREE, like nameRefs.js, so it runs under bare node. The
// caller hands in how a code becomes a name (`toName`) and how two spellings of
// a name are told to be the same (`fold`).

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const plainFold = (value) => asText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

// The country a region belongs to by geography: the one its code names. A code
// nothing can name (a hand-drawn map's own) says nothing, and the region is
// then of the country the map bakes in for it.
export const baseCountryOf = (region, toName = asText) => {
    const code = asText(region?.countryCode);
    const named = code ? asText(toName(code)) : "";
    return (named && named !== code ? named : "") || asText(region?.country) || asText(region?.owner);
};

// Every area of a map, by its folded name: { name, regions }.
export const buildAreaIndex = (catalog, { toName = asText, fold = plainFold } = {}) => {
    const index = new Map();
    for (const region of asArray(catalog)) {
        if (!asText(region?.id)) continue;
        const name = baseCountryOf(region, toName);
        const key = fold(name);
        if (!key) continue;
        let area = index.get(key);
        if (!area) {
            area = { name, regions: [] };
            index.set(key, area);
        }
        area.regions.push(region);
    }
    return index;
};

// The area a written name means, or null: the name itself, or the country a
// code written out of habit stands for.
export const findArea = (index, written, { toName = asText, fold = plainFold } = {}) => {
    const raw = asText(written).replace(/^the\s+/i, "");
    if (!raw || !index?.size) return null;
    return index.get(fold(raw)) ?? index.get(fold(toName(raw))) ?? null;
};

// How a name written in a region field is to be read, once it is known to be
// no region of its own.
//   "area"     the regions of that area the losing side holds
//   "country"  the whole of that polity's land, as "country: <name>" always was
//   "none"     neither: nothing may be moved on this name's say-so
//
//   tagged     it was written "country: <name>"
//   named      what the name is, as the map knows it:
//                isArea        an area of that name exists
//                isOwner       a polity of that name is known to the map
//                holdsLand     and holds at least one region
//   loser      the losing side, when one was written:
//                given         a losing side was written
//                sameAsNamed   and it is the polity the name means
export const readAreaName = ({ tagged = false, named = {}, loser = {} } = {}) => {
    const { isArea = false, isOwner = false, holdsLand = false } = named;
    const { given = false, sameAsNamed = false } = loser;
    if (tagged) {
        // The losing side is someone else: the name is the land of that name
        // which the loser holds, and never the loser's own whole country.
        if (given && !sameAsNamed) return isArea ? "area" : isOwner ? "none" : "country";
        if (holdsLand || !isArea) return "country";
        return "area";
    }
    // A bare name, or one said to be a region: an area only where the name is
    // no polity with land of its own, which keeps every older rule as it was.
    return isArea && !holdsLand ? "area" : "none";
};

// The regions of an area that an operation may move: the losing side's when
// one was named, else all of it that the receiver does not already hold.
//   holderKeyOf(regionId): who holds the region now, folded for comparison
export const areaRegionsFor = (area, { holderKeyOf = () => "", fromKey = "", toKey = "" } = {}) => asArray(area?.regions)
    .filter((region) => {
        const holder = asText(holderKeyOf(region?.id));
        if (toKey && holder === toKey) return false;
        return fromKey ? holder === fromKey : true;
    });

// What a power holds beyond its own country, for the lists a model is shown:
// its regions split into `home` (listed by name, as before) and `territories`
// ([{ name, regions }], shown by name and size alone). An area is a territory
// of the power that holds it when it is not that power's own country and the
// game knows no polity of the area's name: Greenland under Denmark, Puerto Rico
// under the United States. Crimea under Russia is not one, since Ukraine is a
// country of the game, and neither is a country conquered in play, which keeps
// its record: their regions stay in the list by name, because a war over them
// is fought town by town.
//
// A power's own country is the area that carries its name. Where none does
// (the map calls the power "Czech Republic" and its regions' country "Czechia")
// it is the area most of its regions belong to.
//   regions: the power's regions, each with `base` (baseCountryOf)
//   ownerKey: the power's folded name
//   isPolity(key): whether the game knows a polity of that folded name, with
//     land or without
export const splitTerritories = (regions, { ownerKey = "", isPolity = () => false, fold = plainFold } = {}) => {
    const byBase = new Map();
    for (const region of asArray(regions)) {
        const key = fold(region?.base);
        if (!byBase.has(key)) byBase.set(key, { name: asText(region?.base), regions: [] });
        byBase.get(key).regions.push(region);
    }
    let homeKey = byBase.has(ownerKey) ? ownerKey : "";
    if (!homeKey) {
        let most = 0;
        for (const [key, group] of byBase) {
            if (key && group.regions.length > most) { most = group.regions.length; homeKey = key; }
        }
    }
    const territories = [];
    const apart = new Set();
    for (const [key, group] of byBase) {
        if (!key || key === homeKey || key === ownerKey || isPolity(key)) continue;
        territories.push(group);
        for (const region of group.regions) apart.add(region);
    }
    // The rest in the order they came, so a list is cut where it always was.
    const home = asArray(regions).filter((region) => !apart.has(region));
    territories.sort((a, b) => b.regions.length - a.regions.length || a.name.localeCompare(b.name));
    return { home, territories };
};
