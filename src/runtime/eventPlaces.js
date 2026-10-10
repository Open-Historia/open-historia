/*! Open Historia — the places an event is about © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// An event's card links to the places it is about, and the camera goes to them
// when the event is revealed. Both used to be worked out by reading the
// event's title and description for any name the map has, so an event in
// which a scout tribe caught salmon linked to, and flew to, the region called
// Salmon.
//
// An event now SAYS what places it is about, each with its kind
// (`places: ["city: Kharkiv, country: Ukraine"]`, AI/eventPlaces.js), and the
// engine finds each on the map as that kind and no other while the turn is
// validated. What is kept on the event is what it found:
//
//   { kind: "city", name: "Kharkiv", lng: 36.23, lat: 49.99 }
//   { kind: "region", name: "Crimea", regionId: "4441" }
//   { kind: "country", name: "Poland" }
//
// Nothing the map could not find is kept, and nothing is ever looked for in
// the event's words.
//
// DELIBERATELY IMPORT-FREE, like unitMotion.js, so it runs under bare node.

// The kinds a place may be. "structure" is what the model writes "building:"
// or "structure:" for (AI/nameRefs.js); a group is no place.
export const EVENT_PLACE_KINDS = Object.freeze(["country", "region", "city", "structure", "unit", "sea"]);
// As many as an event may name: the schema asks for up to four.
export const MAX_EVENT_PLACES = 4;

const asText = (value) => String(value ?? "").trim();
const coordinate = (value, limit) => (value == null || value === "" || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit
    ? null
    : Number(Number(value).toFixed(5)));

// One found place, or null. A country is its name; a region is the map's key
// for it; everything else is a point. A country or a region may carry a point
// as well, for a map on which its outline cannot be had.
export const normalizeEventPlace = (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const kind = asText(entry.kind).toLowerCase();
    const name = asText(entry.name).slice(0, 120);
    if (!EVENT_PLACE_KINDS.includes(kind) || !name) return null;
    const lng = coordinate(entry.lng, 360);
    const lat = coordinate(entry.lat, 90);
    const point = lng !== null && lat !== null && !(lng === 0 && lat === 0) ? { lng, lat } : null;
    const regionId = asText(entry.regionId);
    if (kind === "country") return { kind, name, ...(point ?? {}) };
    if (kind === "region") return regionId ? { kind, name, regionId, ...(point ?? {}) } : null;
    return point ? { kind, name, ...point } : null;
};

// The places kept on an event. A string is a place nothing has found yet (a
// streamed card, an answer no engine read) and is not one of them.
export const normalizeEventPlaces = (list) => {
    const kept = [];
    const seen = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
        const place = normalizeEventPlace(entry);
        if (!place) continue;
        const key = `${place.kind}:${place.regionId ?? place.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(place);
        if (kept.length >= MAX_EVENT_PLACES) break;
    }
    return kept;
};
