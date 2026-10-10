/*! Open Historia — event camera focus © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Where the camera goes when an event is revealed.
//
// This used to live inline in time.jsx and it aimed at the wrong country far more
// often than the right one. Three separate faults stacked up:
//
//  1. The country bounds table is keyed by GADM code ("IRL"), but everything the
//     event actually carries is a FULL COUNTRY NAME ("Ireland") — impacts
//     .polityChanges[].code, a chat participant's code, a transfer's owner: all
//     names, canonicalised on the way in by runtime/ownerNames.js. So every
//     country lookup missed and the precise, impact-driven focus never ran.
//  2. With the good path dead, nearly every event fell through to the last-resort
//     scan of the event TEXT, which matched country names as bare substrings.
//     "Mali" is inside "Somalia", "Niger" inside "Nigeria", "Oman" inside
//     "Romania", "Guinea" inside "Papua New Guinea", "India" inside "Indiana".
//  3. That scan then UNIONED every hit into one box, so a single false match
//     dragged the camera to the midpoint of two continents.
//
// Hence "an event in Ireland zooms into a completely different country". The fixes
// then: resolve names through a proper name index (with region-ownership fallback
// so invented polities work too), and combine several candidates by picking the
// dominant cluster instead of unioning everything. Geometry gets the same
// treatment — antimeridian-aware merging so Russia/Fiji don't fit the whole
// globe, and outlying scraps (Hawaii, the Azores, the Galápagos) dropped so a
// country frames on its mainland.
//
// The scan of the event's TEXT is gone altogether. Matching whole words fixed
// "Mali" inside "Somalia" and did nothing for a word that is a place's whole
// name: an event in which a scout tribe caught salmon flew to the region called
// Salmon, and its card linked there. Nothing here reads a title or a
// description now. A place comes from what the event SAYS it is about, each
// place with its kind and found on the map by the engine
// (runtime/eventPlaces.js); from the event's own operations; and from the
// polities its structured fields name. An event with none of those moves no
// camera and shows no link.
//
// Kept free of browser/PMTiles imports so it is unit-testable: time.jsx does the
// tile reading and hands the decoded geometry in.

import { normalizeEventPlaces } from "../../runtime/eventPlaces.js";
import { normalizeGroupOp } from "../../runtime/groups.js";
// ---------------------------------------------------------------------------
// Bounds helpers. A bounds is [[west, south], [east, north]]; `east` may exceed
// 180 for a box that crosses the antimeridian, which is what MapLibre's
// fitBounds expects.
// ---------------------------------------------------------------------------

const west = (bounds) => bounds[0][0];
const south = (bounds) => bounds[0][1];
const east = (bounds) => bounds[1][0];
const north = (bounds) => bounds[1][1];

const isBounds = (value) =>
  Array.isArray(value)
  && Array.isArray(value[0])
  && Array.isArray(value[1])
  && [value[0][0], value[0][1], value[1][0], value[1][1]].every(Number.isFinite);

export const extendBounds = (currentBounds, nextBounds) => {
  if (!nextBounds) {
    return currentBounds;
  }

  if (!currentBounds) {
    return nextBounds;
  }

  return [
    [Math.min(west(currentBounds), west(nextBounds)), Math.min(south(currentBounds), south(nextBounds))],
    [Math.max(east(currentBounds), east(nextBounds)), Math.max(north(currentBounds), north(nextBounds))],
  ];
};

// Longitude span of a set of boxes read in one frame (no wrapping applied).
const frameSpan = (list) =>
  Math.max(...list.map(east)) - Math.min(...list.map(west));

const shiftEast = (bounds) => [
  [west(bounds) + 360, south(bounds)],
  [east(bounds) + 360, north(bounds)],
];

// Pieces of one country can sit either side of the antimeridian (Russia, Fiji,
// New Zealand, the Aleutians). Read naively they span -180..180 and the camera
// fits the entire globe. Re-read the whole set in a 0..360 frame and keep
// whichever frame is TIGHTER, so those countries come out as the narrow box they
// really are.
const alignFrame = (list) => {
  if (list.length < 2) {
    return list;
  }

  const shifted = list.map((bounds) => (west(bounds) < 0 ? shiftEast(bounds) : bounds));
  return frameSpan(shifted) < frameSpan(list) ? shifted : list;
};

// Bring the western edge back into [-180, 180) while keeping the box's width, so
// a wrapped result stays a valid MapLibre bounds (east may legitimately be > 180).
const normalizeFrame = (bounds) => {
  const width = east(bounds) - west(bounds);
  let left = west(bounds);

  while (left >= 180) {
    left -= 360;
  }
  while (left < -180) {
    left += 360;
  }

  return [[left, south(bounds)], [left + width, north(bounds)]];
};

// Gap between two boxes on one axis; 0 when they touch or overlap.
const axisGap = (aMin, aMax, bMin, bMax) => Math.max(0, Math.max(aMin, bMin) - Math.min(aMax, bMax));

const lngGap = (a, b) => {
  const direct = axisGap(west(a), east(a), west(b), east(b));
  // Wrap-around distance, so a box at 179 and one at -179 read as neighbours.
  return Math.min(direct, Math.max(0, 360 - (Math.max(east(a), east(b)) - Math.min(west(a), west(b)))));
};

const isNear = (a, b, gap) => lngGap(a, b) <= gap && axisGap(south(a), north(a), south(b), north(b)) <= gap;

// ---------------------------------------------------------------------------
// Feature geometry -> one bounds per key
// ---------------------------------------------------------------------------

export const tilePointToLngLat = (px, py, extent = 4096) => {
  const lng = (px / extent) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / extent)));
  return [lng, latRad * (180 / Math.PI)];
};

// One entry per ring of a decoded vector-tile feature: its box plus a weight
// (the ring's area in tile units) used to tell a mainland from an outlying speck.
export const tileGeometryParts = (geometry, extent = 4096) => {
  const parts = [];

  for (const ring of geometry ?? []) {
    if (!ring?.length) {
      continue;
    }

    let minLng = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    let twiceArea = 0;

    for (let index = 0; index < ring.length; index += 1) {
      const point = ring[index];
      const next = ring[(index + 1) % ring.length];
      const [lng, lat] = tilePointToLngLat(point.x, point.y, extent);
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      twiceArea += point.x * next.y - next.x * point.y;
    }

    if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) {
      continue;
    }

    parts.push({
      bounds: [[minLng, minLat], [maxLng, maxLat]],
      // A ring simplified down to a line has no area but still marks a real
      // place, so give it a floor rather than a weight of zero.
      weight: Math.max(Math.abs(twiceArea) / 2, 1),
    });
  }

  return parts;
};

// Share of a feature's area that has to be inside the frame. The remainder is
// what gets dropped: Hawaii and the Aleutians off the United States, the Azores
// off Portugal, the Galápagos off Ecuador, Easter Island off Chile — specks that
// otherwise drag the box a thousand miles out to sea and leave the country
// itself a smudge at the edge of the screen.
const MAINLAND_AREA_SHARE = 0.92;

export const mergeFeatureParts = (parts) => {
  const usable = (parts ?? []).filter((part) => isBounds(part?.bounds));
  if (usable.length === 0) {
    return null;
  }

  const ordered = [...usable].sort((left, right) => right.weight - left.weight);
  const total = ordered.reduce((sum, part) => sum + part.weight, 0);
  const kept = [];
  let covered = 0;

  for (const part of ordered) {
    if (kept.length > 0 && covered >= total * MAINLAND_AREA_SHARE) {
      break;
    }

    kept.push(part.bounds);
    covered += part.weight;
  }

  const aligned = alignFrame(kept);
  return normalizeFrame(aligned.reduce((merged, bounds) => extendBounds(merged, bounds), null));
};

// ---------------------------------------------------------------------------
// Combining several candidate places into one camera target
// ---------------------------------------------------------------------------

// Two candidates this far apart (degrees, on either axis) are separate places.
const CLUSTER_GAP_DEGREES = 15;

// Candidates arrive most-important-first. Rather than union them all — which is
// how one stray match used to send the camera to the middle of the Atlantic —
// group them into clusters of things that are actually near each other and keep
// the biggest cluster, breaking ties towards the primary (first) candidate.
export const combineFocusBounds = (candidates) => {
  const usable = (candidates ?? []).filter(isBounds);
  if (usable.length === 0) {
    return null;
  }
  if (usable.length === 1) {
    return normalizeFrame(usable[0]);
  }

  const aligned = alignFrame(usable);
  const clusters = [];

  for (let index = 0; index < aligned.length; index += 1) {
    const bounds = aligned[index];
    // Compared against each cluster's running box rather than its every member:
    // linear instead of quadratic, and a chain of stepping stones cannot quietly
    // stretch one cluster across a continent.
    const matched = clusters.filter((cluster) => isNear(cluster.bounds, bounds, CLUSTER_GAP_DEGREES));

    if (matched.length === 0) {
      clusters.push({ bounds, count: 1, firstIndex: index });
      continue;
    }

    // Bridging candidate: fold every cluster it reaches into the first of them.
    const [target, ...rest] = matched;
    target.bounds = extendBounds(target.bounds, bounds);
    target.count += 1;
    for (const cluster of rest) {
      target.bounds = extendBounds(target.bounds, cluster.bounds);
      target.count += cluster.count;
      target.firstIndex = Math.min(target.firstIndex, cluster.firstIndex);
      clusters.splice(clusters.indexOf(cluster), 1);
    }
  }

  const best = clusters.reduce((winner, cluster) => {
    if (cluster.count !== winner.count) {
      return cluster.count > winner.count ? cluster : winner;
    }
    return cluster.firstIndex < winner.firstIndex ? cluster : winner;
  });

  return normalizeFrame(best.bounds);
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

// Diacritic- and punctuation-insensitive word tokens. Both the names we search
// for and the text we search in go through this, so "Côte d'Ivoire" in the index
// matches "Cote d Ivoire" in the prose.
export const focusTokens = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

export const focusNameKey = (value) => focusTokens(value).join(" ");

// name/alias -> the token the bounds tables are keyed by. `entries` is
// [{ token, names: [...] }]; the token is a GADM code for a stock country and a
// polity NAME for anything the scenario or the AI invented. Looked up whole and
// exactly, never searched for inside a text.
export const buildNameIndex = (entries) => {
  const byName = new Map();

  for (const entry of entries ?? []) {
    const token = String(entry?.token ?? "").trim();
    if (!token) {
      continue;
    }

    for (const name of entry?.names ?? []) {
      const key = focusNameKey(name);
      // Names are seeded most-authoritative-first, so an alias never displaces
      // the real owner of a name.
      if (!key || byName.has(key)) {
        continue;
      }

      byName.set(key, token);
    }
  }

  return { byName };
};

export const lookupName = (index, value) => {
  const key = focusNameKey(value);
  return key ? index?.byName?.get(key) ?? "" : "";
};

// ---------------------------------------------------------------------------
// Event -> bounds
// ---------------------------------------------------------------------------

// A named place with no polygon we can find still deserves a sensible frame.
const POINT_PAD_LNG = 0.6;
const POINT_PAD_LAT = 0.45;

const pointBounds = (lng, lat) => {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [[lng - POINT_PAD_LNG, lat - POINT_PAD_LAT], [lng + POINT_PAD_LNG, lat + POINT_PAD_LAT]];
};

const regionBoundsFor = (regionId, context) => {
  const id = String(regionId ?? "").trim();
  return id ? context?.regionBounds?.get(id) ?? null : null;
};

// A region reference the AI never resolved to an id (older saves, or a transfer
// that arrived as a plain name) is still worth a look-up by name — but only when
// the name belongs to exactly one region, since "Santa Cruz" and "Georgia" are
// several places at once.
const regionBoundsByName = (name, context) => {
  const key = focusNameKey(name);
  const ids = key ? context?.regionIdsByName?.get(key) ?? [] : [];
  return ids.length === 1 ? regionBoundsFor(ids[0], context) : null;
};

const transferBounds = (transfer, context) =>
  regionBoundsFor(transfer?.regionId, context)
  ?? regionBoundsByName(transfer?.regionName, context)
  ?? regionBoundsByName(transfer?.regionId, context);

// Every region a polity currently holds, merged. This is the LIVE map rather than
// GADM's modern one, which is the whole point of the game: it is the only way to
// frame an invented or era polity ("Free Ireland", "the Soviet Union") that has
// no country geometry of its own, and it follows a country that has been
// partitioned or has conquered its way across a border. Outlying exclaves are
// dropped the same way stray islands are, so one distant holding cannot pull the
// camera off the polity's heartland.
const ownedRegionBounds = (ownerName, context) => {
  const key = focusNameKey(ownerName);
  const ids = key ? context?.regionIdsByOwner?.get(key) ?? [] : [];
  return ids.length ? combineFocusBounds(ids.map((id) => regionBoundsFor(id, context))) : null;
};

// The fix at the heart of this module: a polity is named ("Ireland") while the
// country bounds table is keyed by GADM code ("IRL"), so nothing used to match.
// Territory first, then the name index, then the raw value as a code for saves
// written before owners became names.
export const resolvePolityBounds = (value, context) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const owned = ownedRegionBounds(raw, context);
  if (owned) {
    return owned;
  }

  const direct = context?.countryBounds?.get(raw);
  if (direct) {
    return direct;
  }

  const code = lookupName(context?.polityIndex, raw);
  if (!code) {
    return null;
  }

  return context?.countryBounds?.get(code) ?? ownedRegionBounds(code, context) ?? null;
};

// Coordinates the event states outright — a battalion spawned or moved, a base
// or city built. Nothing localises an event better than the spot it names.
const impactPointBounds = (impacts) => {
  const points = [];

  for (const op of impacts?.unitOps ?? []) {
    if (op?.op === "spawn") {
      points.push(pointBounds(Number(op?.unit?.lng), Number(op?.unit?.lat)));
    } else if (op?.op === "move") {
      points.push(pointBounds(Number(op?.toLng), Number(op?.toLat)));
    }
  }

  for (const op of impacts?.markerOps ?? []) {
    if (op?.op === "build") {
      points.push(pointBounds(Number(op?.marker?.lng), Number(op?.marker?.lat)));
    }
  }

  return points.filter(isBounds);
};

// The frame of one place the event says it is about (runtime/eventPlaces.js):
// a region by the map's key for it, a country by the land it holds, anything
// else by the point the engine found for it. A region or a country whose
// outline cannot be had falls back to its point, when it has one.
const placeBounds = (place, context) => {
  const point = () => pointBounds(Number(place?.lng), Number(place?.lat));
  if (place?.kind === "region") return regionBoundsFor(place.regionId, context) ?? point();
  if (place?.kind === "country") return resolvePolityBounds(place.name, context) ?? point();
  return point();
};

// The regions a group operation names (runtime/groups.js), as the region
// references a transfer carries. Read through the normalizer, so a streamed
// card's loose shape (`regions`, a lone `regionId`) names the same places.
const groupOpRegions = (impacts) => (impacts?.groupOps ?? []).flatMap((raw) =>
  (normalizeGroupOp(raw)?.regionIds ?? []).map((regionId) => ({ regionId })));

const eventPlaces = (event) => normalizeEventPlaces(event?.places);

// The polities a chat the event opens is between.
const chatPolities = (impacts) => (impacts?.createdChats ?? []).flatMap((chat) =>
  (Array.isArray(chat?.countries) ? chat.countries : [])
    .map((country) => (typeof country === "string" ? country : country?.code || country?.name)));

// The sides the event says are fighting in it (its `combatants`).
const eventCombatants = (event) => (Array.isArray(event?.combatants) ? event.combatants : []);

// Where the camera goes for an event, from the most specific thing it pins
// down to the least: the regions that changed hands, control or claimant, or
// came under a group; any coordinate its operations state outright; the places
// it says it is about; then the polities its structured fields name (the ones
// it changes, the winner and loser of a transfer the map could not place, a
// chat's participants, the sides of its fighting).
//
// Never from its words. An event with none of these returns null, and the
// camera stays where it is.
export const deriveEventFocusBounds = (event, context) => {
  const impacts = event?.impacts ?? {};

  const tiers = [
    () => [...(impacts.regionTransfers ?? []), ...groupOpRegions(impacts)].map((transfer) => transferBounds(transfer, context)),
    () => impactPointBounds(impacts),
    () => eventPlaces(event).map((place) => placeBounds(place, context)),
    () => (impacts.polityChanges ?? []).map((change) => resolvePolityBounds(change?.code, context)),
    // A transfer whose region we could not place still names who won and lost
    // it, and their territory frames the event.
    () => (impacts.regionTransfers ?? []).flatMap((transfer) => [
      resolvePolityBounds(transfer?.toCode, context),
      resolvePolityBounds(transfer?.fromCode, context),
    ]),
    () => chatPolities(impacts).map((polity) => resolvePolityBounds(polity, context)),
    () => eventCombatants(event).map((polity) => resolvePolityBounds(polity, context)),
  ];

  for (const tier of tiers) {
    const bounds = combineFocusBounds(tier().filter(isBounds));
    if (bounds) {
      return bounds;
    }
  }

  return null;
};

// ---------------------------------------------------------------------------
// Event -> links
// ---------------------------------------------------------------------------
//
// The powers, places, formations and structures an event is about, each with
// the frame the map flies to when the player clicks it on the event's card. The
// camera already flies to an event as it is revealed; these are for afterwards,
// for an event with several places in it, and for a player who switched the
// event camera off.
//
// Derived, never stored, and from three sources only: the places the event
// says it is about, each with its kind (runtime/eventPlaces.js); its own
// operations (what it moved, raised, built or changed); and the polities its
// structured fields name (a chat's participants, the sides of its fighting).
// Never from its words: a name that merely appears in the title or the
// description links to nothing. A link the map cannot place is left out: a
// chip that goes nowhere is noise.

export const EVENT_LINKS_MAX = 8;

const polityLabel = (value, context) => {
  const raw = String(value ?? "").trim();
  return context?.polityNameByToken?.get(raw)
    ?? context?.polityNameByToken?.get(lookupName(context?.polityIndex, raw))
    ?? raw;
};

const regionLabel = (entry, context) => String(
  entry?.regionName
  || context?.regionNameById?.get(String(entry?.regionId ?? ""))
  || entry?.regionId
  || "",
).trim();

// [{ kind: "polity"|"region"|"city"|"structure"|"unit"|"sea", label, bounds }],
// in the order above. `unitName(id)` names a unit an operation refers to by id
// only. An event from before events named their places has no `places`, and
// links to what its operations and its structured fields name.
export const deriveEventLinks = (event, context, { max = EVENT_LINKS_MAX, unitName = () => "" } = {}) => {
  const impacts = event?.impacts ?? {};
  const links = [];
  const seen = new Set();
  const add = (kind, label, bounds) => {
    const name = String(label ?? "").trim();
    if (!name || !isBounds(bounds)) return;
    const key = `${kind}:${focusNameKey(name)}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ bounds, kind, label: name });
  };
  const addPolity = (value) => {
    const raw = String(value ?? "").trim();
    if (raw) add("polity", polityLabel(raw, context), resolvePolityBounds(raw, context));
  };
  const addRegion = (entry) => add("region", regionLabel(entry, context), transferBounds(entry, context));

  // What the event says it is about, first: a country is a power like any other.
  for (const place of eventPlaces(event)) {
    if (place.kind === "country") {
      add("polity", polityLabel(place.name, context), placeBounds(place, context));
    } else {
      add(place.kind, place.name, placeBounds(place, context));
    }
  }

  for (const transfer of impacts.regionTransfers ?? []) {
    addRegion(transfer);
    addPolity(transfer?.toCode);
    addPolity(transfer?.fromCode);
  }
  for (const op of impacts.regionControlOps ?? []) {
    addRegion(op);
    addPolity(op?.toCode || op?.actorCode);
  }
  for (const claim of impacts.regionClaims ?? []) {
    addRegion(claim);
    addPolity(claim?.claimantCode);
  }
  for (const entry of groupOpRegions(impacts)) addRegion(entry);
  for (const change of impacts.polityChanges ?? []) addPolity(change?.name || change?.code);
  for (const op of impacts.unitOps ?? []) {
    if (op?.op === "spawn") add("unit", op?.unit?.name, pointBounds(Number(op?.unit?.lng), Number(op?.unit?.lat)));
    else if (op?.op === "move") add("unit", op?.unit?.name || unitName(op?.unitId), pointBounds(Number(op?.toLng), Number(op?.toLat)));
  }
  for (const op of impacts.markerOps ?? []) {
    if (op?.op === "build") add("structure", op?.marker?.name, pointBounds(Number(op?.marker?.lng), Number(op?.marker?.lat)));
  }

  for (const polity of chatPolities(impacts)) addPolity(polity);
  for (const polity of eventCombatants(event)) addPolity(polity);

  return links.slice(0, Math.max(0, max));
};

// ---------------------------------------------------------------------------
// Context assembly (pure, so the lookups can be tested without PMTiles)
// ---------------------------------------------------------------------------

// The bounds table comes from the stock tile archive, keyed by GADM id. A drawn
// map's regions are not in it — and the archive may not be installed at all —
// so on such a map nothing could be framed: not the event camera, not an event
// card's links. The map's own records know each drawn region's box (or at least
// its centre, around which a small frame is enough to fly to), and a polity
// framed by the regions it holds is framed well. Stock outlines win where they
// exist; a centre that is missing is null, never 0,0.
export const withDrawnRegionBounds = (regionBounds, regions) => {
  let merged = null;
  for (const region of regions ?? []) {
    const id = String(region?.id ?? "");
    if (!id || regionBounds?.has?.(id) || merged?.has(id)) continue;
    const bounds = isBounds(region?.bounds)
      ? region.bounds
      : typeof region?.lng === "number" && typeof region?.lat === "number"
        ? pointBounds(region.lng, region.lat)
        : null;
    if (!bounds) continue;
    if (!merged) merged = new Map(regionBounds ?? []);
    merged.set(id, bounds);
  }
  return merged ?? regionBounds ?? new Map();
};

// The merge above over the map's primed records, once per pair of tables: the
// world a context is built against is replaced every few seconds, the tables
// only when the map data is.
let drawnBoundsCache = { stock: null, drawn: null, merged: null };
const drawnRegionBoundsFor = (stock, drawn) => {
  if (drawnBoundsCache.stock !== stock || drawnBoundsCache.drawn !== drawn) {
    drawnBoundsCache = { stock, drawn, merged: withDrawnRegionBounds(stock, drawn) };
  }
  return drawnBoundsCache.merged;
};

// The half of the lookup tables that only changes when the map data does:
// country names, region names, and each region's base owner. Kept separate
// because it is the expensive half (thousands of regions) and the world state it
// is combined with below is re-read every few seconds.
//
// countries: [{ code, name }] from loadCountryNames — the code is the GADM GID_0
// the bounds table is keyed by. regions: the loadRegionCatalog entries.
export const buildPlaceCatalog = ({
  countries = [],
  countryBounds = new Map(),
  regionBounds = new Map(),
  regions = [],
} = {}) => {
  const countryEntries = [];
  for (const country of countries) {
    if (country?.code && country?.name) {
      countryEntries.push({ kind: "polity", names: [country.name], token: country.code });
    }
  }

  const regionIdsByName = new Map();
  const regionNameById = new Map();
  const regionOwners = [];

  for (const region of regions) {
    const id = String(region?.id ?? "");
    if (!id) {
      continue;
    }

    if (region?.name) regionNameById.set(id, String(region.name));
    const nameKey = focusNameKey(region?.name);
    if (nameKey) {
      const bucket = regionIdsByName.get(nameKey);
      if (bucket) bucket.push(id);
      else regionIdsByName.set(nameKey, [id]);
    }

    regionOwners.push({ baseOwner: String(region?.country ?? "") || String(region?.countryCode ?? ""), id });
  }

  return {
    countryBounds,
    countryEntries,
    regionBounds: withDrawnRegionBounds(regionBounds, regions),
    regionIdsByName,
    regionNameById,
    regionOwners,
  };
};

// The catalog plus the live world: era/invented polity names, and who owns what
// right now. `catalog` may be omitted, in which case the raw catalogs are read
// straight from the same options.
//
// `drawnRegions` are the map's own region records (assets.js
// getPrimedScenarioRegionCatalog), whose boxes frame a drawn map's regions.
export const buildFocusContext = ({ catalog = null, world = null, drawnRegions = null, ...catalogOptions } = {}) => {
  const places = catalog ?? buildPlaceCatalog(catalogOptions);
  const polityEntries = [...places.countryEntries];

  // A scenario or the AI can rename, create or alias a polity; those names are
  // what the event text and impacts will use, so they have to resolve too. The
  // override's own key IS the owner name (see runtime/ownerNames.js), which is
  // exactly what region ownership is keyed by.
  for (const [key, polity] of Object.entries(world?.polityOverrides ?? {})) {
    const token = polity?.code || key;
    if (token) {
      polityEntries.push({
        kind: "polity",
        names: [polity?.name, key, ...(polity?.aliases ?? [])].filter(Boolean),
        token,
      });
    }
  }

  const polityIndex = buildNameIndex(polityEntries);
  const overrides = world?.regionOwnershipOverrides ?? {};
  const regionIdsByOwner = new Map();
  // One owner names hundreds of regions, so both the normalisation and the index
  // lookup are worth caching across the walk.
  const ownerKeys = new Map();
  const ownerTokens = new Map();

  const addOwnership = (key, id) => {
    const bucket = regionIdsByOwner.get(key);
    if (bucket) bucket.push(id);
    else regionIdsByOwner.set(key, [id]);
  };

  for (const { baseOwner, id } of places.regionOwners) {
    const owner = overrides[id] || baseOwner;
    if (!owner) {
      continue;
    }

    let ownerKey = ownerKeys.get(owner);
    if (ownerKey === undefined) {
      ownerKey = focusNameKey(owner);
      ownerKeys.set(owner, ownerKey);
    }
    if (!ownerKey) {
      continue;
    }

    addOwnership(ownerKey, id);

    // Ownership is reachable by the polity's token too (a GADM code for a stock
    // country), so a legacy save whose operations still carry a code finds the
    // territory and not only GADM's outline.
    let ownerToken = ownerTokens.get(owner);
    if (ownerToken === undefined) {
      ownerToken = lookupName(polityIndex, owner);
      ownerTokens.set(owner, ownerToken);
    }
    if (!ownerToken) {
      continue;
    }

    const tokenKey = focusNameKey(ownerToken);
    if (tokenKey && tokenKey !== ownerKey) {
      addOwnership(tokenKey, id);
    }
  }

  // What a polity token is CALLED now, for a link's label: an override's current
  // name first (a renamed stock country is shown by its new name), then the
  // stock name.
  const polityNameByToken = new Map();
  for (const entry of [...polityEntries.slice(places.countryEntries.length), ...places.countryEntries]) {
    const name = entry.names.find(Boolean);
    if (entry.token && name && !polityNameByToken.has(entry.token)) polityNameByToken.set(entry.token, String(name));
  }

  return {
    countryBounds: places.countryBounds,
    polityIndex,
    polityNameByToken,
    regionBounds: Array.isArray(drawnRegions) && drawnRegions.length
      ? drawnRegionBoundsFor(places.regionBounds, drawnRegions)
      : places.regionBounds,
    regionIdsByName: places.regionIdsByName,
    regionIdsByOwner,
    regionNameById: places.regionNameById ?? new Map(),
  };
};
