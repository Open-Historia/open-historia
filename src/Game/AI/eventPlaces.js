/*! Open Historia — the places an event names, found on the map © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What an event's `places` says, read and found (runtime/eventPlaces.js keeps
// the result). Each entry is one place, written with its kind:
//
//   "city: Kharkiv, country: Ukraine"     "region: Crimea"
//   "country: Poland"                     "building: Camp Humphreys"
//   "sea: Black Sea"                      "unit: 3rd Infantry Division"
//
// The kind is the whole point. A name with none is not looked up at all: "the
// salmon run" is a thing an event may be about, and the map has a region
// called Salmon. And a name is looked up as the kind it was given and as
// nothing else, by the same rules that place a unit: a city is a city the map
// marks, in the country it was said to be in or nowhere; a building is a
// structure standing on the map, or one this event builds.
//
// A place that is not found is left out, and nobody is told: this is what a
// card links to, and no part of what happened.
//
// Its one import, nameRefs.js, has none of its own, so this runs under bare node.

import { kindOfName, stripKindTags } from "./nameRefs.js";

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => asText(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

const PLACE_KINDS = new Set(["country", "region", "city", "structure", "unit", "sea"]);

// One written entry: { kind, name, country }, or null for one with no kind (or
// a kind that is no place). `country` is what a city or a region was said to
// be in: the part tagged as a country, else the last part after a comma. Each
// name is kept as it was written, an article and all: "the" is no more taken
// off an English name than "la" off a French one (nameRefs.js).
export const readEventPlace = (written) => {
    const { text, kinds } = stripKindTags(written);
    const parts = text.split(",").map((part) => asText(part)).filter(Boolean);
    if (!parts.length) return null;
    const name = parts[0];
    const kind = kindOfName(kinds, name);
    if (!PLACE_KINDS.has(kind)) return null;
    const rest = parts.slice(1);
    const country = kind === "city" || kind === "region"
        ? rest.find((part) => kindOfName(kinds, part) === "country") ?? rest.at(-1) ?? ""
        : "";
    return { kind, name, country };
};

const finite = (lng, lat) => lng != null && lat != null && Number.isFinite(Number(lng)) && Number.isFinite(Number(lat))
    && !(Number(lng) === 0 && Number(lat) === 0);
const centreOf = (regions) => {
    let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
    const walk = (coordinates) => {
        if (!Array.isArray(coordinates)) return;
        if (typeof coordinates[0] === "number") {
            const [lng, lat] = coordinates;
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                west = Math.min(west, lng); east = Math.max(east, lng);
                south = Math.min(south, lat); north = Math.max(north, lat);
            }
            return;
        }
        for (const inner of coordinates) walk(inner);
    };
    for (const region of asArray(regions)) walk(region?.geometry?.coordinates);
    return Number.isFinite(west) && Number.isFinite(south) ? { lng: (west + east) / 2, lat: (south + north) / 2 } : null;
};

// The place a read entry is, on this map: what runtime/eventPlaces.js keeps,
// or null.
//   gazetteer   the map's names (gameplay.js buildPlacementGazetteer): `find`
//               with a kind, and `seaPoint(name)` for a sea the map knows
//   impacts     the event's own operations: a structure it builds and a
//               formation it raises or moves are where the event puts them
//   units       the world's units, for the name of one an operation moves
export const findEventPlace = (ref, gazetteer, { impacts = null, units = [] } = {}) => {
    if (!ref || !PLACE_KINDS.has(ref.kind) || !asText(ref.name)) return null;
    const { kind, name, country } = ref;
    const key = fold(name);
    const asCountry = (found) => {
        // Where the land is, for a map on which a territory's outline cannot
        // be had by its name (Greenland, held by Denmark).
        const centre = centreOf(found.regions);
        return { kind: "country", name: asText(found.name) || name, ...(centre ?? {}) };
    };
    if (kind === "country") {
        const found = gazetteer?.find?.(name, { kind: "country" });
        return found?.kind === "polity" ? asCountry(found) : null;
    }
    if (kind === "region") {
        const found = gazetteer?.find?.(name, { kind: "region", country });
        if (found?.kind === "region" && asText(found.region?.id)) return { kind: "region", name: asText(found.name) || name, regionId: asText(found.region.id) };
        // A territory said as a region: the regions that belong to it.
        return found?.kind === "polity" ? asCountry(found) : null;
    }
    if (kind === "city") {
        const found = gazetteer?.find?.(name, { kind: "city", country });
        return found?.kind === "city" && Array.isArray(found.point) && finite(found.point[0], found.point[1])
            ? { kind: "city", name: asText(found.name) || name, lng: found.point[0], lat: found.point[1] }
            : null;
    }
    if (kind === "structure") {
        for (const op of asArray(impacts?.markerOps)) {
            const marker = op?.marker && typeof op.marker === "object" ? op.marker : op;
            if (fold(marker?.name) === key && finite(marker?.lng, marker?.lat)) return { kind, name: asText(marker.name), lng: Number(marker.lng), lat: Number(marker.lat) };
        }
        const found = gazetteer?.find?.(name, { kind: "structure" });
        return found?.kind === "marker" && Array.isArray(found.point) && finite(found.point[0], found.point[1])
            ? { kind, name: asText(found.name) || name, lng: found.point[0], lat: found.point[1] }
            : null;
    }
    if (kind === "unit") {
        // Where this event puts it, before where it stands now.
        for (const op of asArray(impacts?.unitOps)) {
            const type = asText(op?.op).toLowerCase();
            if (type === "spawn") {
                const unit = op?.unit && typeof op.unit === "object" ? op.unit : op;
                if (fold(unit?.name) === key && finite(unit?.lng, unit?.lat)) return { kind, name: asText(unit.name), lng: Number(unit.lng), lat: Number(unit.lat) };
            } else if (type === "move" && finite(op?.toLng, op?.toLat)) {
                const moved = asArray(units).find((unit) => asText(unit?.id) && asText(unit.id) === asText(op?.unitId));
                if (moved && fold(moved.name) === key) return { kind, name: asText(moved.name), lng: Number(op.toLng), lat: Number(op.toLat) };
            }
        }
        const found = gazetteer?.find?.(name, { kind: "unit" });
        return found?.kind === "unit" && Array.isArray(found.point) && finite(found.point[0], found.point[1])
            ? { kind, name: asText(found.name) || name, lng: found.point[0], lat: found.point[1] }
            : null;
    }
    // A sea, on a map that knows it.
    const sea = gazetteer?.seaPoint?.(name);
    return sea && Array.isArray(sea.point) && finite(sea.point[0], sea.point[1])
        ? { kind: "sea", name: asText(sea.name) || name, lng: sea.point[0], lat: sea.point[1] }
        : null;
};

// An entry a model wrote as the parts of one, { kind, name, country }, in the words it stands for:
// "city: Istanbul, country: Ottoman Empire". Anything else as it was.
const placeAsWritten = (entry) => {
    // A found place carries where it is (a point, or a region's id).
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || finite(entry.lng, entry.lat) || asText(entry.regionId)) return entry;
    const kind = asText(entry.kind || entry.type).toLowerCase();
    const name = asText(entry.name);
    if (!kind || !name) return entry;
    const country = asText(entry.country);
    return `${kind}: ${name}${country && country !== name ? `, country: ${country}` : ""}`;
};

// A skip's answer with every event's places in the form the contract asks for. Gemini writes them as objects of
// their parts in a whole answer at a time, and one such entry failed the answer, its retry and the skip (a
// player's year-long skips, 2026-11-03). { payload, rewritten }: the same payload where nothing was rewritten.
export const placesAsWritten = (payload) => {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.events)) return { payload, rewritten: 0 };
    let rewritten = 0;
    const events = payload.events.map((event) => {
        if (!event || typeof event !== "object" || !Array.isArray(event.places)) return event;
        const places = event.places.map(placeAsWritten);
        const changed = places.filter((place, index) => place !== event.places[index]).length;
        if (!changed) return event;
        rewritten += changed;
        return { ...event, places };
    });
    return rewritten ? { payload: { ...payload, events }, rewritten } : { payload, rewritten };
};

// Every entry of an event's `places`, found. An entry that is already a found
// place (a turn validated twice) is kept as it is; one that only names its parts
// is looked up like the words it stands for.
export const findEventPlaces = (places, gazetteer, options = {}) => asArray(places)
    .slice(0, 12)
    .map(placeAsWritten)
    .map((entry) => (entry && typeof entry === "object" ? entry : findEventPlace(readEventPlace(entry), gazetteer, options)))
    .filter(Boolean);

// What the model is told, in the rules of a skip that finishes its own events.
export const EVENT_PLACES_RULE = "• Places. `places` lists the places the event happens at, up to four, each with its kind and, for a city or a region, its country: \"city: Kharkiv, country: Ukraine\", \"region: Crimea, country: Ukraine\", \"country: Poland\", \"building: Camp Humphreys\", \"sea: Black Sea\", \"unit: 3rd Infantry Division\". The player's map goes to them and the event's card links to them, so list only places on the map, by the names the map uses; a thing that is not a place on the map (a person, a ministry, a treaty, a commodity) is never listed, and an event that happens nowhere in particular lists none. A region is one [Game Map Description] lists by name, copied exactly; in a power listed without its regions, name one of its cities from [City Coordinates], or the country. The country after a city or a region is the power that holds it now, as the map says.";
