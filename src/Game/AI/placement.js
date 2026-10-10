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
//   "120 km north-east of Kharkiv"   a VECTOR: that far, that way, from the place
//   "120 km on a bearing of 045 from Kharkiv"   the same, by compass degrees
//   "80 km from Kyiv toward Kharkiv"  that far along the line to another place
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
// A VECTOR is a distance and a direction from a reference point: "120 km
// north-east of Kharkiv". "East of Kharkiv" alone is a short way off
// (DIRECTION_KM); a vector says how far, which is what puts a thing where
// nothing has a name: a camp out in a desert, a fleet's station, a world of a
// drawn galaxy two sectors off the last one the map marks. The direction is
// one of the sixteen points of the compass, or a bearing in degrees (0 north,
// 90 east), or the line toward a second place.
const COMPASS_16 = Object.freeze({
    n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5,
    s: 180, ssw: 202.5, sw: 225, wsw: 247.5, w: 270, wnw: 292.5, nw: 315, nnw: 337.5,
});
// "north-north-east", "NNE", "south west": the words down to their letters.
const readBearingWord = (word) => {
    const letters = asText(word).toLowerCase().replace(/north/g, "n").replace(/south/g, "s").replace(/east/g, "e").replace(/west/g, "w").replace(/[\s-]+/g, "");
    return Object.hasOwn(COMPASS_16, letters) ? COMPASS_16[letters] : null;
};
const COMPASS_16_PATTERN = "((?:north|south|east|west|[nsew])(?:[\\s-]?(?:north|south|east|west|[nsew])){0,2})";
const DISTANCE_PATTERN = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(km|kms|kilomet(?:er|re)s?|mi|miles?|nm|nmi|nautical miles?)";
const KM_PER_UNIT = { km: 1, mi: 1.609344, nm: 1.852 };
// The farthest a vector reaches: a quarter of the way round the world.
export const VECTOR_MAX_KM = 10000;
const readDistanceKm = (amount, unit) => {
    const digits = /^\d{1,3}(?:,\d{3})+$/.test(amount) ? amount.replace(/,/g, "") : amount.replace(",", ".");
    const word = asText(unit).toLowerCase();
    const per = word.startsWith("k") ? KM_PER_UNIT.km : word.startsWith("n") ? KM_PER_UNIT.nm : KM_PER_UNIT.mi;
    const km = Number(digits) * per;
    return Number.isFinite(km) && km > 0 ? Math.min(VECTOR_MAX_KM, km) : null;
};
// The compass bearing from one point to another, on the same flat reckoning
// distanceKm uses.
const bearingBetween = (from, to) => {
    let dLng = to[0] - from[0];
    if (dLng > 180) dLng -= 360;
    if (dLng < -180) dLng += 360;
    const dx = dLng * kmPerDegLng((from[1] + to[1]) / 2);
    const dy = (to[1] - from[1]) * KM_PER_DEG_LAT;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

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

const COORDINATES = /^[[(]?\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*[\])]?$/;

// Every reading of the phrase that its words allow, most specific first. The
// resolver takes the first whose names are on the map.
// `home`: whose thing is being placed, unit or structure, when the caller knows
// — what "the northern border" is the north of.
export const readPlacement = (phrase, { home: whose = "" } = {}) => {
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
    // A vector: "120 km north-east of Kharkiv", "about 80 miles due south of
    // the Don", "40 nm WNW of Malta".
    const rough = "^(?:about |around |roughly |some |approximately |nearly |~\\s?)?";
    if ((match = text.match(new RegExp(`${rough}${DISTANCE_PATTERN},? (?:to the |due |directly )?${COMPASS_16_PATTERN}(?:ward|wards)? (?:of|from) (.+)$`, "i")))) {
        const km = readDistanceKm(match[1], match[2]);
        const bearing = readBearingWord(match[3]);
        if (km && bearing !== null) add({ kind: "vector", km, bearing, name: stripArticle(match[4]) });
    }
    // "120 km on a bearing of 045 from Kharkiv", "120 km at 45 degrees from
    // Kharkiv", "bearing 045, 120 km from Kharkiv".
    if ((match = text.match(new RegExp(`${rough}${DISTANCE_PATTERN},? (?:on |at |along )?(?:a |an )?(?:bearing|heading|azimuth|course)?(?: of)? ?(\\d{1,3}(?:\\.\\d+)?)\\s?(?:°|º|deg|degs|degrees)?(?: true)? (?:from|of) (.+)$`, "i")))) {
        const km = readDistanceKm(match[1], match[2]);
        const bearing = Number(match[3]);
        if (km && bearing >= 0 && bearing <= 360) add({ kind: "vector", km, bearing: bearing % 360, name: stripArticle(match[4]) });
    }
    if ((match = text.match(new RegExp(`^(?:on |at |along )?(?:a |an )?(?:bearing|heading|azimuth|course)(?: of)? (\\d{1,3}(?:\\.\\d+)?)\\s?(?:°|º|deg|degs|degrees)?(?: true)?,? (?:and |for |at )?${DISTANCE_PATTERN} (?:from|of) (.+)$`, "i")))) {
        const km = readDistanceKm(match[2], match[3]);
        const bearing = Number(match[1]);
        if (km && bearing >= 0 && bearing <= 360) add({ kind: "vector", km, bearing: bearing % 360, name: stripArticle(match[4]) });
    }
    // "80 km from Kyiv toward Kharkiv", "80 km out of Kyiv on the road to Kharkiv".
    if ((match = text.match(new RegExp(`${rough}${DISTANCE_PATTERN} (?:from|out of|beyond|past) (.+?) (?:toward|towards|in the direction of|on the way to|on the road to|heading for) (.+)$`, "i")))) {
        const km = readDistanceKm(match[1], match[2]);
        if (km) add({ kind: "vector", km, name: stripArticle(match[3]), toward: stripArticle(match[4]) });
    }

    if ((match = text.match(/^(?:at sea |in the waters |in waters |waters |offshore |just )?off(?: the coast of| the shore of| of)? (.+)$/i))) add({ kind: "offshore", name: stripArticle(match[1]) });
    if ((match = text.match(/^(?:on |along |at )?(?:the )?(?:coast|coastline|shore|seaboard|littoral) of (.+)$/i))) add({ kind: "coast", name: stripArticle(match[1]) });
    if ((match = text.match(/^(?:the )?(.+?)(?:'s)? (?:coast|coastline|shore|seaboard)$/i))) add({ kind: "coast", name: stripArticle(match[1]) });
    if ((match = text.match(/^coastal (.+)$/i))) add({ kind: "coast", name: stripArticle(match[1]) });

    // "Donetsk Oblast facing Russia", "the border of Poland with Germany".
    if ((match = text.match(/^(?:the )?(?:border|frontier) of (.+?) with (.+)$/i))) add({ kind: "facing", name: stripArticle(match[1]), toward: stripArticle(match[2]) });
    if ((match = text.match(/^(.+?),? (?:facing|toward|towards|opposite|on the border with|on the frontier with|bordering|border with|nearest to|nearest|closest to) (.+)$/i))) {
        add({ kind: "facing", name: stripArticle(match[1]), toward: stripArticle(match[2]) });
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

const resolveReading = (reading, gazetteer, seed) => {
    if (reading.kind === "coordinates") return done(reading.point, "coordinates", gazetteer, "");
    if (reading.kind === "between") {
        const first = positionOf(gazetteer.find(reading.first), seed);
        const second = positionOf(gazetteer.find(reading.second), seed);
        if (!first || !second) return null;
        return done([(first[0] + second[0]) / 2, (first[1] + second[1]) / 2], "between", gazetteer, `between ${reading.first} and ${reading.second}`);
    }

    const thing = gazetteer.find(reading.name, { exact: Boolean(reading.exact) });
    if (!thing) return null;

    if (reading.kind === "place") {
        const point = reading.interior && !thing.point ? positionOf({ ...thing, point: null }, seed) : positionOf(thing, seed);
        return point ? done(point, thing.point ? "at" : "inside", gazetteer, thing.name) : null;
    }

    if (reading.kind === "vector") {
        // From where the thing is: a city, a unit or a structure is its own
        // point, a region the middle of it, a country its heartland.
        const origin = positionOf(thing, seed);
        if (!origin) return null;
        let { bearing, km } = reading;
        if (reading.toward) {
            const target = positionOf(gazetteer.find(reading.toward), seed);
            if (!target) return null;
            // Never past the place it is heading for: that far or farther is the place.
            if (km >= distanceKm(origin, target)) return done(target, "vector", gazetteer, thing.name);
            bearing = bearingBetween(origin, target);
        }
        return done(offsetPoint(origin, bearing, km), "vector", gazetteer, thing.name);
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

const resolveAddress = (phrase, gazetteer, seed, home) => {
    const parts = asText(phrase).split(",").map((part) => stripArticle(part.replace(/\s+/g, " ").trim())).filter(Boolean);
    if (parts.length < 2) return null;
    const find = (name) => gazetteer.find(name, { exact: true }) ?? gazetteer.find(name);
    const place = (name) => {
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
    const within = new Set(parts.slice(1).flatMap((name) => regionIdsOf(find(name), gazetteer)));
    const spot = place(parts[0]);
    if (spot && within.size && within.has(spot.regionId)) return spot;
    if (spot && !within.size) {
        const own = new Set(asText(home) ? regionIdsOf(find(home), gazetteer) : []);
        if (!own.size || own.has(spot.regionId)) return spot;
    }
    for (let index = 1; index < parts.length; index += 1) {
        const container = place(parts[index]);
        if (container) return container;
    }
    return null;
};

// { lng, lat, regionId, regionName, how, label } — or { error } saying what could
// not be found, in words the model can act on next turn.
// `home`: whose thing is being placed, for a side of their own land with no
// country named (readPlacement) and for an address the map cannot check
// (resolveAddress).
export const resolvePlacement = (phrase, gazetteer, { seedText = "", home = "" } = {}) => {
    const readings = readPlacement(phrase, { home });
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
    if (hasComma) {
        // The whole phrase, then what each reading took for its name: "near
        // Fort Drum, New York" is an address after its first word.
        const candidates = [...new Set([asText(phrase), ...readings.map((reading) => asText(reading.name))].filter((text) => text.includes(",")))];
        for (const candidate of candidates) {
            const address = resolveAddress(candidate, gazetteer, seed, home);
            if (address) return address;
        }
    }
    return { error: `no city, region, unit or structure on this map is called "${asText(readings[0].name ?? phrase)}"` };
};

// What the model is told. Short, because it rides on every jump.
export const PLACEMENT_DIRECTIVE = [
    "[Placing Things — say WHERE in words]",
    "Every unit you spawn or move and every structure you build can be placed with `at`: a phrase naming places the map knows. The engine finds the exact point, keeps it inside the right borders, and moves it clear of anything already standing there. Prefer `at` to coordinates: a guessed longitude puts an army in the sea.",
    "- \"Kharkiv\" — a city, a region, an existing structure or unit, exactly as the map spells it.",
    "- \"near Kharkiv\" — beside it. \"east of Kharkiv\" — a short way off in that direction. \"toward Kharkiv\" — a move's objective; it gets as far as the days allow.",
    "- \"120 km north-east of Kharkiv\" or \"120 km on a bearing of 045 from Kharkiv\" — an exact distance and direction from any place the map knows: a city, a structure, a unit, the middle of a region. \"80 km from Kyiv toward Kharkiv\" — that far along the line to another. Use it when where something stands matters and no name is there.",
    "- \"eastern Ukraine\", \"Donetsk Oblast, north\" — that part of a country or region.",
    "- \"Donetsk Oblast facing Russia\" — the side of one place nearest another: a front, a border garrison.",
    "- \"coast of Crimea\" — on land at the sea's edge. \"off Sevastopol\" — AT SEA, for fleets.",
    "- \"between Kyiv and Kharkiv\" — halfway.",
    "Give lng and lat only for a point you actually know that no name describes (open ocean, a spot in a desert). If you give both, `at` wins.",
].join("\n");
