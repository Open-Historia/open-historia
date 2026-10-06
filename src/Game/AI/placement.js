/*! Open Historia — placement: where a thing goes, said in words © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A model knows that the 1st Guards Tank Army is "massing east of Kharkiv". It
// does not know that Kharkiv is at 36.23 E, 49.99 N, and when it is made to say
// so it guesses: units in the sea, bases in the wrong country, and a (0, 0) the
// engine has to refuse. Names are what a model is good at, and names are what
// this map is good at resolving. So a unit or a structure may be placed with a
// phrase — `at` — and the engine works out the point:
//
//   "Kharkiv"                        the place itself (a city, a base, a unit, a region)
//   "near Kharkiv"                   beside it, not on top of it
//   "east of Kharkiv"                a short way off in that direction
//   "eastern Ukraine" / "Donetsk Oblast, north"   that part of a region or a country
//   "coast of Crimea"                on land, at the sea's edge
//   "off Sevastopol"                 at sea, a short way out
//   "Donetsk Oblast facing Russia"   the side of one place nearest another
//   "between Kyiv and Kharkiv"       halfway
//   "[36.2, 50.0]"                   longitude, latitude, when it really is known
//
// The WHOLE phrase is tried as a name before any of it is read as grammar, so
// North Korea, South Ossetia, the Ivory Coast and the West Bank are places and
// not directions — but only as the map spells it: a lookup loose enough to take
// "off Sevastopol" for the region Sevastopol would put every fleet ashore.
//
// DELIBERATELY IMPORT-FREE. The caller hands in a gazetteer — find(name, { exact })
// and regionAt(point) — built from the map it already has (gameplay.js
// buildPlacementGazetteer), so everything here runs under bare node. Every
// result is deterministic: the same phrase for the same thing on the same map is
// the same point, because a unit that twitches each time the save is read is a
// bug the player can see.

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// ---------------------------------------------------------------------------
// Geometry, on GeoJSON longitude/latitude
// ---------------------------------------------------------------------------

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat) => 111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));

export const distanceKm = (a, b) => {
    const meanLat = (a[1] + b[1]) / 2;
    let dLng = Math.abs(a[0] - b[0]);
    if (dLng > 180) dLng = 360 - dLng;
    const dx = dLng * kmPerDegLng(meanLat);
    const dy = (a[1] - b[1]) * KM_PER_DEG_LAT;
    return Math.hypot(dx, dy);
};

const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
const clampLat = (lat) => Math.max(-89.9, Math.min(89.9, lat));

// Halfway between two points the short way round: across the antimeridian,
// Fiji and Samoa meet in the Pacific, not off Angola.
const midpoint = (a, b) => {
    const [westLng, eastLng] = a[0] <= b[0] ? [a[0], b[0]] : [b[0], a[0]];
    const lng = eastLng - westLng > 180 ? wrapLng((westLng + 360 + eastLng) / 2) : (a[0] + b[0]) / 2;
    return [lng, (a[1] + b[1]) / 2];
};

// bearing in compass degrees: 0 north, 90 east.
export const offsetPoint = (point, bearingDegrees, km) => {
    const radians = (bearingDegrees * Math.PI) / 180;
    const lat = clampLat(point[1] + (Math.cos(radians) * km) / KM_PER_DEG_LAT);
    const lng = wrapLng(point[0] + (Math.sin(radians) * km) / kmPerDegLng(point[1]));
    return [lng, lat];
};

const polygonsOf = (geometry) => {
    if (!geometry) return [];
    if (geometry.type === "Polygon") return [asArray(geometry.coordinates)];
    if (geometry.type === "MultiPolygon") return asArray(geometry.coordinates);
    return [];
};

const inRing = (point, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
};

export const pointInGeometry = (point, geometry) => polygonsOf(geometry).some((polygon) => {
    const [outer, ...holes] = polygon;
    return Array.isArray(outer) && inRing(point, outer) && !holes.some((hole) => inRing(point, hole));
});

export const bboxOfGeometry = (geometry) => {
    let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
    for (const polygon of polygonsOf(geometry)) {
        for (const [lng, lat] of asArray(polygon[0])) {
            if (lng < west) west = lng;
            if (lng > east) east = lng;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
        }
    }
    return Number.isFinite(west) ? [west, south, east, north] : null;
};

// The largest ring's vertices, thinned: what "the edge" of a region is, for
// measuring how far inside a point sits and for walking its coast.
const outline = (geometry, limit = 160) => {
    let longest = [];
    for (const polygon of polygonsOf(geometry)) {
        if (asArray(polygon[0]).length > longest.length) longest = polygon[0];
    }
    if (longest.length <= limit) return longest;
    const step = longest.length / limit;
    return Array.from({ length: limit }, (_unused, index) => longest[Math.floor(index * step)]);
};

// A low-discrepancy sequence: samples that cover a box evenly and are the same
// every time, which random ones are not.
const halton = (index, base) => {
    let result = 0; let fraction = 1 / base; let i = index;
    while (i > 0) { result += fraction * (i % base); i = Math.floor(i / base); fraction /= base; }
    return result;
};

export const hashText = (text) => {
    let hash = 2166136261;
    for (const char of asText(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
};

// Points inside the geometry (optionally inside `box`, a part of its bbox).
const samplesInside = (geometry, { box = null, count = 96, seed = 0 } = {}) => {
    const bbox = box ?? bboxOfGeometry(geometry);
    if (!bbox) return [];
    const [west, south, east, north] = bbox;
    const found = [];
    const offset = seed % 997;
    for (let index = 1; index <= count * 6 && found.length < count; index += 1) {
        const point = [west + halton(index + offset, 2) * (east - west), south + halton(index + offset, 3) * (north - south)];
        if (pointInGeometry(point, geometry)) found.push(point);
    }
    return found;
};

const edgeDistanceKm = (point, edge) => edge.reduce((least, vertex) => Math.min(least, distanceKm(point, vertex)), Infinity);

// The most comfortable point inside: the sample that sits furthest from the edge.
// (A centroid can fall outside a crescent-shaped region, or in its lake.)
export const interiorPoint = (geometry, { box = null, seed = 0 } = {}) => {
    const samples = samplesInside(geometry, { box, seed });
    if (!samples.length) return null;
    const edge = outline(geometry);
    let best = samples[0]; let bestDistance = -1;
    for (const sample of samples) {
        const distance = edgeDistanceKm(sample, edge);
        if (distance > bestDistance) { bestDistance = distance; best = sample; }
    }
    return best;
};

// The point inside that is nearest to a target (a point, or another geometry),
// kept a little way in from the edge so a counter does not sit on a border line.
export const nearestInteriorPoint = (geometry, target, { seed = 0 } = {}) => {
    const samples = samplesInside(geometry, { count: 160, seed });
    if (!samples.length) return null;
    const targetPoints = Array.isArray(target) ? [target] : outline(target, 60);
    if (!targetPoints.length) return interiorPoint(geometry, { seed });
    const edge = outline(geometry);
    const span = bboxOfGeometry(geometry);
    const margin = span ? Math.min(12, distanceKm([span[0], span[1]], [span[2], span[3]]) * 0.03) : 0;
    let best = null; let bestScore = Infinity;
    for (const sample of samples) {
        const toTarget = targetPoints.reduce((least, point) => Math.min(least, distanceKm(sample, point)), Infinity);
        // A sample hugging the edge pays for it, so the winner is just inside.
        const score = toTarget + Math.max(0, margin - edgeDistanceKm(sample, edge)) * 4;
        if (score < bestScore) { bestScore = score; best = sample; }
    }
    return best;
};

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

const COMPASS = Object.freeze({
    north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315,
});
const DIRECTION_WORDS = Object.freeze({
    n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest",
    north: "north", south: "south", east: "east", west: "west",
    northern: "north", southern: "south", eastern: "east", western: "west",
    northeast: "northeast", northwest: "northwest", southeast: "southeast", southwest: "southwest",
    northeastern: "northeast", northwestern: "northwest", southeastern: "southeast", southwestern: "southwest",
    // What a model says when it is thinking of the map as a picture.
    top: "north", upper: "north", bottom: "south", lower: "south", left: "west", right: "east",
});
const readDirection = (word) => DIRECTION_WORDS[asText(word).toLowerCase().replace(/[\s-]+/g, "")] ?? "";

// The part of a bbox on that side: a half for a cardinal, a quarter for a diagonal.
const partOfBox = ([west, south, east, north], direction) => {
    const midLng = (west + east) / 2; const midLat = (south + north) / 2;
    return [
        direction.includes("east") ? midLng : west,
        direction.includes("north") ? midLat : south,
        direction.includes("west") ? midLng : east,
        direction.includes("south") ? midLat : north,
    ];
};

// ---------------------------------------------------------------------------
// Reading the phrase
// ---------------------------------------------------------------------------

const DIRECTION_PATTERN = "(north|south|east|west|n|s|e|w)(?:[\\s-]?(east|west|e|w))?";
const stripArticle = (text) => asText(text).replace(/^(?:the|a|an)\s+/i, "");

// Words for a kind of ground after a place name — "Putumayo jungle frontier",
// "the Donbas region" — which no map spells as part of the name.
const GROUND_WORDS = /\s+(?:jungles?|frontiers?|borders?|borderlands?|regions?|areas?|sectors?|front|zones?|countryside|hinterland|outskirts)$/i;
const stripGround = (text) => {
    let out = asText(text);
    for (let guard = 0; guard < 4; guard += 1) {
        const next = out.replace(GROUND_WORDS, "");
        if (next === out || !next) break;
        out = next;
    }
    return out;
};

const COORDINATES = /^[[(]?\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*[\])]?$/;

// Every reading of the phrase that its words allow, most specific first. The
// resolver takes the first whose names are on the map.
// `owner`: whose unit is being placed, when the caller knows — what "the border
// with Colombia" is measured from. `home`: whose thing it is, unit or structure
// — what "the northern border" is the north of.
export const readPlacement = (phrase, { owner = "", home: whose = owner } = {}) => {
    const text = asText(phrase).replace(/\s+/g, " ").replace(/[.;]+$/, "");
    if (!text) return [];
    const coordinates = text.match(COORDINATES);
    if (coordinates) {
        const lng = Number(coordinates[1]); const lat = Number(coordinates[2]);
        return Math.abs(lng) <= 180 && Math.abs(lat) <= 90 && !(lng === 0 && lat === 0) ? [{ kind: "coordinates", point: [lng, lat] }] : [];
    }

    const readings = [{ kind: "place", name: stripArticle(text) }];
    const add = (reading) => readings.push(reading);
    let match;

    if ((match = text.match(/^(?:half ?way |midway )?between (.+?) and (.+)$/i))) add({ kind: "between", first: stripArticle(match[1]), second: stripArticle(match[2]) });
    if ((match = text.match(/^(?:at sea |in the waters |in waters |waters |offshore |just )?off(?: the coast of| the shore of| of)? (.+)$/i))) add({ kind: "offshore", name: stripArticle(match[1]) });
    if ((match = text.match(/^(?:on |along |at )?(?:the )?(?:coast|coastline|shore|seaboard|littoral) of (.+)$/i))) add({ kind: "coast", name: stripArticle(match[1]) });
    if ((match = text.match(/^(?:the )?(.+?)(?:'s)? (?:coast|coastline|shore|seaboard)$/i))) add({ kind: "coast", name: stripArticle(match[1]) });
    if ((match = text.match(/^coastal (.+)$/i))) add({ kind: "coast", name: stripArticle(match[1]) });

    // "Donetsk Oblast facing Russia", "the border of Poland with Germany".
    if ((match = text.match(/^(?:the )?(?:border|frontier) of (.+?) with (.+)$/i))) add({ kind: "facing", name: stripArticle(match[1]), toward: stripArticle(match[2]) });
    if ((match = text.match(/^(.+?),? (?:facing|toward|towards|opposite|on the border with|on the frontier with|bordering|border with|nearest to|nearest|closest to) (.+)$/i))) {
        add({ kind: "facing", name: stripArticle(match[1]), toward: stripArticle(match[2]) });
    }
    // "the northern frontier with Colombia", "along the border with Russia",
    // "the Colombia border": a border with no first place named. To a person it
    // is the unit's own side of it, so given the owner it reads as "<owner>
    // facing <the other place>". A player's Ecuador lost the brigade it had just
    // mobilised, twice, to "northern frontier with Colombia" and "northern border
    // with Colombia", which named no first place for the grammar above.
    const home = asText(owner);
    if (home) {
        const lead = "^(?:on |along |at |near |by |to |toward |towards |into |onto )?(?:the )?";
        if ((match = text.match(new RegExp(`${lead}(?:${DIRECTION_PATTERN}(?:ern)? )?(?:border|frontier|boundary|borderlands?|border (?:area|region|zone)) (?:with|facing|toward|towards|against) (.+)$`, "i")))) {
            add({ kind: "facing", name: home, toward: stripArticle(match[3]) });
        }
        if ((match = text.match(new RegExp(`${lead}(.+?) (?:border|frontier|borderlands?)$`, "i")))) {
            add({ kind: "facing", name: home, toward: stripArticle(match[1]) });
        }
    }

    // "the northern border", "our eastern frontier", "the southern provinces":
    // a side of a country with no country named. To a person it is the side of
    // whoever is speaking, so given whose thing is being placed it reads as
    // that part of their own land. A real skip (2026-10-05) held an exercise
    // and opened a depot at "northern border": the brigade was raised in the
    // middle of the country and the depot was not built at all.
    const land = asText(whose);
    if (land && (match = text.match(new RegExp(
        `^(?:on |along |at |near |by |to |toward |towards |into |onto |in )?(?:the |our |its |their )?${DIRECTION_PATTERN}(?:ern)? `
        + "(?:border|frontier|boundary|borderlands?|flank|front|sector|territor(?:y|ies)|provinces?|regions?|districts?|marches)s?$", "i")))) {
        const direction = readDirection(`${match[1]}${match[2] ?? ""}`);
        if (direction) add({ kind: "part", direction, name: land });
    }

    // "east of Kharkiv", "north-west of Lviv", "just south of the Don".
    if ((match = text.match(new RegExp(`^(?:just |immediately |directly |to the |some way )*${DIRECTION_PATTERN}(?:ward)? of (.+)$`, "i")))) {
        const direction = readDirection(`${match[1]}${match[2] ?? ""}`);
        if (direction) add({ kind: "direction", direction, name: stripArticle(match[3]) });
    }
    // "eastern Ukraine", "the north of Donetsk Oblast", "Donetsk Oblast, north".
    if ((match = text.match(/^(?:in |the |in the )*(north|south|east|west)(?:[\s-]?(east|west))?(?:ern)? (?:part of |half of |of )?(.+)$/i))) {
        const direction = readDirection(`${match[1]}${match[2] ?? ""}`);
        if (direction) add({ kind: "part", direction, name: stripArticle(match[3]) });
    }
    if ((match = text.match(/^(.+?)[,(]\s*(?:the |in the |its )?([a-z\s-]+?)(?: part| half| side| sector| end)?\)?$/i))) {
        const direction = readDirection(match[2]);
        if (direction) add({ kind: "part", direction, name: stripArticle(match[1]) });
        else if (/^(?:coast|coastal|shore|seaside)$/i.test(asText(match[2]))) add({ kind: "coast", name: stripArticle(match[1]) });
        else if (/^(?:centre|center|central|middle|interior|heart)$/i.test(asText(match[2]))) add({ kind: "place", name: stripArticle(match[1]), interior: true });
    }
    if ((match = text.match(/^(?:the )?(?:centre|center|middle|heart|interior) of (.+)$/i))) add({ kind: "place", name: stripArticle(match[1]), interior: true });
    if ((match = text.match(/^central (.+)$/i))) add({ kind: "place", name: stripArticle(match[1]), interior: true });

    if ((match = text.match(/^(?:near|nearby|close to|outside|just outside|beside|by|around|outskirts of|the outskirts of|on the outskirts of|in the vicinity of|vicinity of|approaches to|the approaches to) (.+)$/i))) {
        add({ kind: "near", name: stripArticle(match[1]) });
    }
    // "toward Kharkiv", "against Kharkiv", "advancing on Kharkiv": an objective. The
    // destination is beside the place; a move gets there as far as its days allow.
    if ((match = text.match(/^(?:toward|towards|against|targeting|target|onto|on to|advancing on|advance on|marching on|attacking|to attack|to take) (.+)$/i))) {
        add({ kind: "near", name: stripArticle(match[1]) });
    }
    if ((match = text.match(/^(?:at|in|inside|within|on|into|to) (.+)$/i))) add({ kind: "place", name: stripArticle(match[1]) });
    // "near Putumayo jungle frontier": every reading is tried again with the
    // words for a kind of ground taken off its names, after every reading as
    // written — so a real name that ends in one ("Northern Region") still wins.
    for (const reading of [...readings]) {
        const bare = { ...reading };
        let changed = false;
        for (const key of ["name", "toward", "first", "second"]) {
            if (typeof reading[key] !== "string") continue;
            const stripped = stripGround(reading[key]);
            if (stripped && stripped !== reading[key]) {
                bare[key] = stripped;
                changed = true;
            }
        }
        if (changed) add(bare);
    }
    // Where the words could be grammar, the whole phrase is a name only as the
    // map spells it; a phrase that can be nothing else may be matched loosely.
    if (readings.length > 1) readings[0].exact = true;
    return readings;
};

// ---------------------------------------------------------------------------
// Resolving it against the map
// ---------------------------------------------------------------------------
//
// gazetteer.find(name, { exact }) -> null, or
//   { kind: "unit" | "marker" | "city", name, point: [lng, lat] }
//   { kind: "region", name, region: { id, name, geometry } }
//   { kind: "polity", name, regions: [{ id, name, geometry }] }
//   (`exact`: the name as the map spells it, or an alias — no near misses)
// gazetteer.regionAt(point) -> { id, name, geometry } | null
// gazetteer.worldCities(name) -> [[lng, lat], …]: where each town of that name
//   stands in the wider world, for a name the map does not carry (resolveWorldTown).
//   Optional, and [] for a name its list does not have.

export const NEAR_KM = 22;
export const DIRECTION_KM = 35;
export const OFFSHORE_KM = 30;

const centreOf = (region) => {
    const box = bboxOfGeometry(region?.geometry);
    return box ? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2] : null;
};

// A country's heartland: of its regions, the one nearest the middle of them all.
const heartland = (regions) => {
    const centres = asArray(regions).map((region) => ({ region, centre: centreOf(region) })).filter((entry) => entry.centre);
    if (!centres.length) return null;
    const mean = [
        centres.reduce((sum, entry) => sum + entry.centre[0], 0) / centres.length,
        centres.reduce((sum, entry) => sum + entry.centre[1], 0) / centres.length,
    ];
    return centres.reduce((best, entry) => (distanceKm(entry.centre, mean) < distanceKm(best.centre, mean) ? entry : best)).region;
};

// Where a thing IS, as one point (a region's is its comfortable interior).
const positionOf = (thing, seed) => {
    if (!thing) return null;
    if (thing.point) return thing.point;
    const region = thing.region ?? heartland(thing.regions);
    return region ? interiorPoint(region.geometry, { seed }) : null;
};

// What "nearest to Y" is measured against: a point, or the nearest of Y's regions.
const targetOf = (thing, from) => {
    if (!thing) return null;
    if (thing.point) return thing.point;
    if (thing.region) return thing.region.geometry;
    const regions = asArray(thing.regions).filter((region) => centreOf(region));
    if (!regions.length) return null;
    return regions.reduce((best, region) => (distanceKm(centreOf(region), from) < distanceKm(centreOf(best), from) ? region : best)).geometry;
};

// Is this stretch of a region's edge the sea? Step outward from it; on this map
// the sea is simply where no region is.
const seawardPoint = (region, vertex, inner, gazetteer, km) => {
    const bearing = (Math.atan2((vertex[0] - inner[0]) * kmPerDegLng(vertex[1]), (vertex[1] - inner[1]) * KM_PER_DEG_LAT) * 180) / Math.PI;
    const out = offsetPoint(vertex, bearing, km);
    return gazetteer.regionAt(out) ? null : out;
};

const coastOf = (region, gazetteer, { toward = null, seed = 0 } = {}) => {
    const inner = interiorPoint(region.geometry, { seed });
    if (!inner) return null;
    const shore = outline(region.geometry, 48)
        .map((vertex) => ({ vertex, sea: seawardPoint(region, vertex, inner, gazetteer, 9) }))
        .filter((entry) => entry.sea);
    if (!shore.length) return null;
    // The stretch facing the target when there is one; otherwise the home coast,
    // the one nearest the region's own interior.
    const anchor = toward ?? inner;
    const chosen = shore.reduce((best, entry) => (distanceKm(entry.vertex, anchor) < distanceKm(best.vertex, anchor) ? entry : best));
    return { vertex: chosen.vertex, inner };
};

const regionFor = (thing, toward) => {
    if (thing?.region) return thing.region;
    const regions = asArray(thing?.regions);
    if (!regions.length) return null;
    if (!toward) return heartland(regions);
    const anchor = Array.isArray(toward) ? toward : centreOf({ geometry: toward });
    return regions.reduce((best, region) => (distanceKm(centreOf(region) ?? [0, 0], anchor) < distanceKm(centreOf(best) ?? [0, 0], anchor) ? region : best));
};

const done = (point, how, gazetteer, label) => {
    const region = gazetteer.regionAt(point);
    return { lng: Number(point[0].toFixed(5)), lat: Number(point[1].toFixed(5)), regionId: region?.id ?? "", regionName: region?.name ?? "", how, label };
};

// `found`: what the reading's name stands for, when the caller has settled that
// itself and the map is not to be asked (a town of the wider world).
const resolveReading = (reading, gazetteer, seed, found = null) => {
    if (reading.kind === "coordinates") return done(reading.point, "coordinates", gazetteer, "");
    if (reading.kind === "between") {
        const first = positionOf(gazetteer.find(reading.first), seed);
        const second = positionOf(gazetteer.find(reading.second), seed);
        if (!first || !second) return null;
        return done(midpoint(first, second), "between", gazetteer, `between ${reading.first} and ${reading.second}`);
    }

    const thing = found ?? gazetteer.find(reading.name, { exact: Boolean(reading.exact) });
    if (!thing) return null;

    if (reading.kind === "place") {
        const point = reading.interior && !thing.point ? positionOf({ ...thing, point: null }, seed) : positionOf(thing, seed);
        return point ? done(point, thing.point ? "at" : "inside", gazetteer, thing.name) : null;
    }

    if (reading.kind === "near" || reading.kind === "direction") {
        const km = reading.kind === "near" ? NEAR_KM : DIRECTION_KM;
        if (!thing.point) {
            // Beside a region is inside it, off its centre; a direction is that part of it.
            const region = regionFor(thing, null);
            const box = bboxOfGeometry(region?.geometry);
            const point = region && interiorPoint(region.geometry, reading.kind === "direction" && box
                ? { box: partOfBox(box, reading.direction), seed }
                : { seed: seed + 17 });
            return point ? done(point, reading.kind === "near" ? "inside" : "part", gazetteer, thing.name) : null;
        }
        const home = gazetteer.regionAt(thing.point);
        const first = reading.kind === "near" ? (seed % 360) : COMPASS[reading.direction];
        // A named direction is kept; "near" tries the compass round until it finds land beside land.
        const bearings = reading.kind === "near" ? Array.from({ length: 8 }, (_unused, step) => (first + step * 45) % 360) : [first];
        for (const bearing of bearings) {
            const point = offsetPoint(thing.point, bearing, km);
            if (!home || reading.kind === "direction" || gazetteer.regionAt(point)) return done(point, reading.kind, gazetteer, thing.name);
        }
        return done(thing.point, "at", gazetteer, thing.name);
    }

    if (reading.kind === "part") {
        if (thing.point) return done(offsetPoint(thing.point, COMPASS[reading.direction], DIRECTION_KM), "direction", gazetteer, thing.name);
        if (thing.region) {
            const box = bboxOfGeometry(thing.region.geometry);
            const point = box && (interiorPoint(thing.region.geometry, { box: partOfBox(box, reading.direction), seed }) ?? interiorPoint(thing.region.geometry, { seed }));
            return point ? done(point, "part", gazetteer, thing.name) : null;
        }
        // "eastern Ukraine": of the country's regions, those in that part of it; of those, the most central to the part.
        const regions = asArray(thing.regions).filter((region) => centreOf(region));
        if (!regions.length) return null;
        const all = regions.map(centreOf);
        const whole = [Math.min(...all.map((c) => c[0])), Math.min(...all.map((c) => c[1])), Math.max(...all.map((c) => c[0])), Math.max(...all.map((c) => c[1]))];
        const part = partOfBox(whole, reading.direction);
        const middle = [(part[0] + part[2]) / 2, (part[1] + part[3]) / 2];
        const inPart = regions.filter((region) => {
            const centre = centreOf(region);
            return centre[0] >= part[0] && centre[0] <= part[2] && centre[1] >= part[1] && centre[1] <= part[3];
        });
        const pool = inPart.length ? inPart : regions;
        const chosen = pool.reduce((best, region) => (distanceKm(centreOf(region), middle) < distanceKm(centreOf(best), middle) ? region : best));
        const point = interiorPoint(chosen.geometry, { seed });
        return point ? done(point, "part", gazetteer, thing.name) : null;
    }

    if (reading.kind === "coast" || reading.kind === "offshore") {
        if (thing.point) {
            // A port: its own region's coast nearest the town.
            const region = gazetteer.regionAt(thing.point);
            const coast = region && coastOf(region, gazetteer, { toward: thing.point, seed });
            if (!coast) return reading.kind === "coast" ? done(thing.point, "at", gazetteer, thing.name) : null;
            if (reading.kind === "coast") return done(nearestInteriorPoint(region.geometry, coast.vertex, { seed }) ?? thing.point, "coast", gazetteer, thing.name);
            for (const km of [OFFSHORE_KM, 16, 8]) {
                const out = seawardPoint(region, coast.vertex, coast.inner, gazetteer, km);
                if (out) return done(out, "offshore", gazetteer, thing.name);
            }
            return null;
        }
        const ordered = thing.region ? [thing.region] : [...asArray(thing.regions)].sort((a, b) => {
            const home = centreOf(heartland(thing.regions)) ?? [0, 0];
            return distanceKm(centreOf(a) ?? home, home) - distanceKm(centreOf(b) ?? home, home);
        }).slice(0, 16);
        for (const region of ordered) {
            const coast = coastOf(region, gazetteer, { seed });
            if (!coast) continue;
            if (reading.kind === "coast") {
                const point = nearestInteriorPoint(region.geometry, coast.vertex, { seed });
                if (point) return done(point, "coast", gazetteer, thing.name);
            } else {
                for (const km of [OFFSHORE_KM, 16, 8]) {
                    const out = seawardPoint(region, coast.vertex, coast.inner, gazetteer, km);
                    if (out) return done(out, "offshore", gazetteer, thing.name);
                }
            }
        }
        // Landlocked: "the coast of Hungary" is somewhere in Hungary, and nothing is at sea.
        if (reading.kind === "offshore") return null;
        const fallback = positionOf(thing, seed);
        return fallback ? done(fallback, "inside", gazetteer, thing.name) : null;
    }

    if (reading.kind === "facing") {
        const other = gazetteer.find(reading.toward);
        if (!other) return null;
        const from = positionOf(thing, seed);
        if (!from) return null;
        const target = targetOf(other, from);
        if (!target) return null;
        if (thing.point) {
            // A point cannot be "the side of" anything: go a short way toward the other place.
            const aim = Array.isArray(target) ? target : centreOf({ geometry: target });
            const bearing = (Math.atan2((aim[0] - thing.point[0]) * kmPerDegLng(thing.point[1]), (aim[1] - thing.point[1]) * KM_PER_DEG_LAT) * 180) / Math.PI;
            return done(offsetPoint(thing.point, bearing, NEAR_KM), "facing", gazetteer, thing.name);
        }
        const region = regionFor(thing, target);
        const point = region && nearestInteriorPoint(region.geometry, target, { seed });
        return point ? done(point, "facing", gazetteer, thing.name) : null;
    }
    return null;
};

// "Fort Drum, New York", "Norfolk, Virginia, United States": a spot and what it
// is in, the way a person gives an address. No map carries every base and
// town, so the spot is often not on it while the state it is in is. A real
// time skip (2026-10-05) opened a depot at "Fort Drum, New York" and lost it,
// and raised the brigade beside it in Kansas, because the phrase as a whole
// named nothing.
//
// Read part by part, each name as the map spells it first and loosely after
// ("Minot Air Force Base" finds a region called Minot):
//   - the spot itself, when the map has it AND it lies in the place the address
//     says it is in. A namesake elsewhere is not it: the map's only Paris may be
//     in France, and "Paris, Texas" is not there;
//   - otherwise the innermost of the places after the comma that the map has.
// When the map knows NONE of the places after the comma (its regions may be
// named after cities, with no "Texas" on it at all), nothing says where the
// spot is. It is taken only if it lies in `home`, the land of whoever is
// placing the thing; with no `home` given there is nothing to test it against,
// and it is taken, as a loose match of the whole phrase always took it.
const regionIdsOf = (found, gazetteer) => (found?.kind === "region" ? [found.region?.id]
    : found?.kind === "polity" ? asArray(found.regions).map((region) => region?.id)
        // A town is where it stands: "…, Kharkiv" is the region Kharkiv is in.
        : Array.isArray(found?.point) ? [gazetteer.regionAt(found.point)?.id] : []).filter(Boolean);

const addressParts = (phrase) => asText(phrase).split(",").map((part) => stripArticle(part.replace(/\s+/g, " ").trim())).filter(Boolean);
const findNamed = (name, gazetteer) => gazetteer.find(name, { exact: true }) ?? gazetteer.find(name);
const placeNamed = (name, gazetteer, seed) => {
    for (const exact of [true, false]) {
        try {
            const resolved = resolveReading({ kind: "place", name, exact }, gazetteer, seed);
            if (resolved) return resolved;
        } catch {
            // one odd polygon costs this reading only
        }
    }
    return null;
};

// The spot itself: the first part of the address, when the map has it where
// the rest says it is.
const addressSpot = (parts, gazetteer, seed, home) => {
    const within = new Set(parts.slice(1).flatMap((name) => regionIdsOf(findNamed(name, gazetteer), gazetteer)));
    const spot = placeNamed(parts[0], gazetteer, seed);
    if (spot && within.size && within.has(spot.regionId)) return spot;
    if (spot && !within.size) {
        const own = new Set(asText(home) ? regionIdsOf(findNamed(home, gazetteer), gazetteer) : []);
        if (!own.size || own.has(spot.regionId)) return spot;
    }
    return null;
};

// What the spot is in: the innermost of the places after the comma that the
// map has. Asked apart from the spot because a town of the wider world
// (resolveWorldTown) is tried between the two.
const addressContainer = (parts, gazetteer, seed) => {
    for (let index = 1; index < parts.length; index += 1) {
        const container = placeNamed(parts[index], gazetteer, seed);
        if (container) return container;
    }
    return null;
};

// "A", "A and B", "A, B and C"; past `limit`, "A, B, C and 4 more".
const inWords = (names, limit = 6) => {
    const shown = names.slice(0, limit);
    if (names.length > shown.length) return `${shown.join(", ")} and ${names.length - shown.length} more`;
    return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("");
};

// A town the map does not carry. No map has every town, and one whose regions
// are named after cities has no "North Dakota" to fall back on either: a real
// skip (2026-10-05) opened a depot at "Grand Forks, North Dakota" and lost it,
// and the unit it raised "near Grand Forks, North Dakota" was put somewhere in
// its owner's land instead.
//
// The game ships a list of seventy thousand of the world's towns
// (gazetteer.worldCities, from worldCities.js). It knows where Grand Forks
// is. It also has sixteen Springfields, and says of none of them what country
// it is in, so a name alone settles nothing. A town is taken only when it is
// the ONE town of that name which stands
//   - on land this map has (in the sea, or off the edge of a regional map, it
//     is no town of this world), and
//   - inside every place the address says it is in that the map knows ("X,
//     Kharkiv Oblast"); or, when the map knows none of them or the phrase
//     gives none, inside `home`, the land of whoever is placing the thing:
//     the test addressSpot puts a map city to. With nobody's land to test it
//     against, a town of the list is not taken at all (a map city then is,
//     but only because a loose match of the whole phrase always took it).
// Two such towns are refused, and so is a town that stands only outside
// `home`: nothing is picked by its size, and nothing crosses a border on a
// name's say-so. The refusal names the regions those towns stand in, so the
// next answer can say which one, as "Springfield, <region>". An address
// whose place the map knows is not refused: it falls back to that place, as it
// did before there was a list to ask.
//
// The readings are the ones the map was asked, each with its grammar: "near
// Grand Forks, North Dakota" is beside the town, not on it. Those whose name
// has no comma go first, as they do for the map's own names ("Grand Forks,
// north" is the north of it, not a town in a place called North). The first
// reading whose town stands on this map's land decides, taken or refused: a
// later one would be a second guess at what was meant.
//
// Only what the map lacks is asked of the list. A name the map has an answer
// for is the map's, even where the list has a namesake that would fit.
const resolveWorldTown = (readings, gazetteer, seed, home) => {
    if (typeof gazetteer.worldCities !== "function") return null;
    const land = asText(home) ? findNamed(home, gazetteer) : null;
    const own = new Set(regionIdsOf(land, gazetteer));
    const named = readings.filter((reading) => typeof reading.name === "string");
    const ordered = [...named.filter((reading) => !reading.name.includes(",")), ...named.filter((reading) => reading.name.includes(","))];
    for (const reading of ordered) {
        const [spot, ...rest] = addressParts(reading.name);
        if (!spot) continue;
        const onMap = rest.length ? addressSpot([spot, ...rest], gazetteer, seed, home) : gazetteer.find(spot, { exact: Boolean(reading.exact) });
        if (onMap) continue;
        const within = rest.map((name) => new Set(regionIdsOf(findNamed(name, gazetteer), gazetteer))).filter((ids) => ids.size);
        // Nothing says where it would have to stand, so the list is not asked.
        if (!within.length && !own.size) continue;
        const standing = asArray(gazetteer.worldCities(spot))
            .map((point) => ({ point, region: gazetteer.regionAt(point) }))
            .filter((town) => town.region);
        if (!standing.length) continue;
        const fitting = standing.filter((town) => (within.length ? within.every((ids) => ids.has(town.region.id)) : own.has(town.region.id)));
        if (fitting.length === 1) return resolveReading({ ...reading, name: spot }, gazetteer, seed, { kind: "city", name: spot, point: fitting[0].point });
        if (within.length) return null;
        const regions = [...new Set((fitting.length ? fitting : standing).map((town) => asText(town.region.name) || asText(town.region.id)))];
        const where = `in the region${regions.length > 1 ? "s" : ""} ${inWords(regions)}`;
        const whose = asText(land?.name) || asText(home);
        const refused = fitting.length
            ? `${fitting.length} towns called ${spot} lie in ${whose}, ${where}`
            : `no town called ${spot} lies in ${whose}: ${standing.length > 1 ? `the ${standing.length} on this map are` : "the one on this map is"} ${where}`;
        return { error: `${refused}; name the region it is in, as "${spot}, <region>"` };
    }
    return null;
};

// { lng, lat, regionId, regionName, how, label } — or { error } saying what could
// not be found, in words the model can act on next turn.
// `home`: whose thing is being placed, for an address the map cannot check
// (addressSpot) and for a town it does not carry (resolveWorldTown); it
// defaults to `owner`, which also reads a border phrase.
export const resolvePlacement = (phrase, gazetteer, { seedText = "", owner = "", home = owner } = {}) => {
    const readings = readPlacement(phrase, { owner, home });
    if (!readings.length) return { error: `"${asText(phrase)}" is not a place` };
    const seed = hashText(`${asText(phrase).toLowerCase()}|${asText(seedText).toLowerCase()}`);
    // A phrase with a comma in it is a name only as the map spells it. Past
    // that it is grammar ("Donetsk Oblast, north") or an address, and never a
    // loose guess at the whole of it: that guess is what put "Paris, Texas" in
    // France.
    const hasComma = readings[0]?.kind === "place" && asText(phrase).includes(",");
    for (const written of readings) {
        const reading = hasComma && asText(written.name).includes(",") ? { ...written, exact: true } : written;
        let resolved = null;
        try {
            resolved = resolveReading(reading, gazetteer, seed);
        } catch {
            resolved = null; // one odd polygon must not cost the turn its other placements
        }
        if (resolved) return resolved;
    }
    // What an address's spot is in, where the map has that and not the spot.
    // It is the answer only after the world's towns have been asked: the town
    // itself is nearer the mark than the middle of its state.
    let container = null;
    if (hasComma) {
        // The whole phrase, then what each reading took for its name: "near
        // Fort Drum, New York" is an address after its first word.
        const candidates = [...new Set([asText(phrase), ...readings.map((reading) => asText(reading.name))].filter((text) => text.includes(",")))];
        for (const candidate of candidates) {
            const parts = addressParts(candidate);
            if (parts.length < 2) continue;
            const spot = addressSpot(parts, gazetteer, seed, home);
            if (spot) return spot;
            container = addressContainer(parts, gazetteer, seed);
            if (container) break;
        }
    }
    let town = null;
    try {
        town = resolveWorldTown(readings, gazetteer, seed, home);
    } catch {
        town = null; // as above: one odd polygon costs this reading only
    }
    if (town && !town.error) return town;
    if (container) return container;
    // `names` is every place the phrase could be read as naming — the whole of
    // "off Falkland Islands", and the "Falkland Islands" inside it — so a caller
    // can say what the phrase nearly matched. The message quotes the first, which
    // is the whole phrase, because that is what the model actually wrote.
    const names = [...new Set(readings.flatMap((reading) => [reading.name, reading.first, reading.second]).map(asText).filter(Boolean))];
    const name = names[0] || asText(phrase);
    // A town refused has said which regions the choice lies between. It names
    // no near misses: "did you mean Paris?" after "three towns called Paris"
    // would send the next answer to the one Paris the map does have.
    if (town) return { error: town.error, name, names: [] };
    return { error: `no city, region, unit or structure on this map is called "${name}"`, name, names };
};

// A destination given as a region id instead of a phrase. The schema offers
// `regionId` on both a spawn and a move, and a model just told its `at` phrase
// is not on the map reaches for it next — so it has to land somewhere. Before
// this it landed nowhere: nothing turned an id into a point, and the operation
// was dropped for having no coordinates, silently, every time.
//
// The point is the one a bare region NAME would have given: inside it, off
// centre, stable for the same id and unit.
export const resolveRegionPlacement = (regionId, gazetteer, { seedText = "" } = {}) => {
    const id = asText(regionId);
    if (!id) return { error: "no region id" };
    const region = gazetteer.findRegionId?.(id);
    if (!region) return { error: `no region on this map has the id "${id}"` };
    const point = interiorPoint(region.geometry, { seed: hashText(`${id}|${asText(seedText).toLowerCase()}`) });
    return point ? done(point, "region", gazetteer, region.name) : { error: `region "${region.name || id}" has no shape to stand in` };
};

// What the model is told. Short, because it rides on every jump.
export const PLACEMENT_DIRECTIVE = [
    "[Placing Things — say WHERE in words]",
    "Every unit you spawn or move and every structure you build can be placed with `at`: a phrase naming places the map knows. The engine finds the exact point, keeps it inside the right borders, and moves it clear of anything already standing there. Prefer `at` to coordinates: a guessed longitude puts an army in the sea.",
    "- \"Kharkiv\" — a city, a region, an existing structure or unit, exactly as the map spells it.",
    "- \"near Kharkiv\" — beside it. \"east of Kharkiv\" — a short way off in that direction. \"toward Kharkiv\" — a move's objective; it gets as far as the days allow.",
    "- \"eastern Ukraine\", \"Donetsk Oblast, north\" — that part of a country or region.",
    "- \"Donetsk Oblast facing Russia\" — the side of one place nearest another: a front, a border garrison. \"the border with Russia\" puts a unit on its own country's side of that border.",
    "- \"coast of Crimea\" — on land at the sea's edge. \"off Sevastopol\" — AT SEA, for fleets.",
    "- \"between Kyiv and Kharkiv\" — halfway.",
    "Give lng and lat only for a point you actually know that no name describes (open ocean, a spot in a desert). If you give both, `at` wins. A `regionId` copied exactly from the map also places a unit, and is used when `at` names nothing the map knows.",
].join("\n");
