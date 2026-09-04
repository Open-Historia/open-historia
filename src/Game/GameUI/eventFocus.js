/*! Open Historia — event camera focus © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
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
// here: resolve names through a proper name index (with region-ownership fallback
// so invented polities work too), match text on WORD boundaries with longest-match
// wins, and combine several candidates by picking the dominant cluster instead of
// unioning everything. Geometry gets the same treatment — antimeridian-aware
// merging so Russia/Fiji don't fit the whole globe, and outlying scraps (Hawaii,
// the Azores, the Galápagos) dropped so a country frames on its mainland.
//
// Kept free of browser/PMTiles imports so it is unit-testable: time.jsx does the
// tile reading and hands the decoded geometry in.

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
// polity NAME for anything the scenario or the AI invented.
export const buildNameIndex = (entries) => {
  const byName = new Map();
  const searchable = [];

  for (const entry of entries ?? []) {
    const token = String(entry?.token ?? "").trim();
    if (!token) {
      continue;
    }

    for (const name of entry?.names ?? []) {
      const tokens = focusTokens(name);
      const key = tokens.join(" ");
      // Names are seeded most-authoritative-first, so an alias never displaces
      // the real owner of a name.
      if (!key || byName.has(key)) {
        continue;
      }

      byName.set(key, token);
      // Very short names are noise in prose ("Fiji" is fine, a two-letter code
      // is not) — they stay resolvable by exact lookup, just not by text scan.
      if (key.length >= 4) {
        searchable.push({ kind: entry?.kind ?? "polity", token, tokens });
      }
    }
  }

  const byFirstToken = new Map();
  for (const entry of searchable) {
    const bucket = byFirstToken.get(entry.tokens[0]);
    if (bucket) bucket.push(entry);
    else byFirstToken.set(entry.tokens[0], [entry]);
  }
  // Longest name first, so "Papua New Guinea" is tried before "Guinea".
  for (const bucket of byFirstToken.values()) {
    bucket.sort((left, right) => right.tokens.length - left.tokens.length);
  }

  return { byFirstToken, byName };
};

export const lookupName = (index, value) => {
  const key = focusNameKey(value);
  return key ? index?.byName?.get(key) ?? "" : "";
};

// Whole-word matches of indexed names inside `text`, in reading order, with any
// match sitting inside a longer one dropped ("Guinea" inside "Papua New Guinea",
// "Ireland" inside "Northern Ireland"). Word-token matching is what keeps "Mali"
// out of "Somalia" and "Oman" out of "Romania".
//
// Countries and regions are searched TOGETHER (pass both indexes): "Northern
// Ireland" only outranks "Ireland" when both are candidates at the same moment.
export const findNameMentions = (text, indexes) => {
  const searched = (Array.isArray(indexes) ? indexes : [indexes]).filter(Boolean);
  const tokens = focusTokens(text);
  const matches = [];

  for (let start = 0; start < tokens.length; start += 1) {
    const candidates = searched.flatMap((index) => index.byFirstToken?.get(tokens[start]) ?? []);
    // Each index is already longest-first; only a mixed shortlist needs sorting.
    if (searched.length > 1) {
      candidates.sort((left, right) => right.tokens.length - left.tokens.length);
    }

    for (const entry of candidates) {
      const end = start + entry.tokens.length;
      if (end > tokens.length) {
        continue;
      }

      let matched = true;
      for (let offset = 1; offset < entry.tokens.length; offset += 1) {
        if (tokens[start + offset] !== entry.tokens[offset]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        matches.push({ end, kind: entry.kind, start, token: entry.token });
        // Longest first within a bucket, so the first hit here is the best one.
        break;
      }
    }
  }

  const seen = new Set();
  return matches
    .filter((match) => !matches.some((other) =>
      other !== match && other.start <= match.start && other.end >= match.end
      && (other.end - other.start) > (match.end - match.start)))
    .filter((match) => {
      const key = `${match.kind}:${match.token}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

const mentionBounds = (matches, resolve) => matches.map(resolve).filter(isBounds);

// Last resort: the places the event's own words name. Regions win over countries
// when the event names both and the region lies in one of those countries ("the
// siege of Donetsk" should frame Donetsk, not all of Ukraine).
const textFocusBounds = (event, context) => {
  const title = String(event?.title ?? "");
  const description = String(event?.description ?? "");

  for (const text of [title, `${title} ${description}`]) {
    const mentions = findNameMentions(text, [context?.polityIndex, context?.regionIndex]);
    const countryMatches = mentions.filter((match) => match.kind === "polity");
    const regionMatches = mentions.filter((match) => match.kind === "region");
    const countryTokens = new Set(countryMatches.map((match) => match.token));
    const insideNamedCountry = regionMatches.filter((match) =>
      countryTokens.has(context?.regionOwnerToken?.get(match.token) ?? ""));

    const preferred = countryMatches.length === 0 ? regionMatches : insideNamedCountry;
    const regionFocus = combineFocusBounds(
      mentionBounds(preferred, (match) => regionBoundsFor(match.token, context)),
    );
    if (regionFocus) {
      return regionFocus;
    }

    const countryFocus = combineFocusBounds(
      mentionBounds(countryMatches, (match) => resolvePolityBounds(match.token, context)),
    );
    if (countryFocus) {
      return countryFocus;
    }
  }

  return null;
};

// Every event moves the camera. Work from the most specific thing the event
// pins down to the least: the regions that changed hands, then any coordinate it
// states outright, then the polities it changes, then its chat participants, and
// only then the places its text merely mentions.
export const deriveEventFocusBounds = (event, context) => {
  const impacts = event?.impacts ?? {};

  const tiers = [
    () => (impacts.regionTransfers ?? []).map((transfer) => transferBounds(transfer, context)),
    () => impactPointBounds(impacts),
    () => (impacts.polityChanges ?? []).map((change) => resolvePolityBounds(change?.code, context)),
    // A transfer whose region we could not place still names who won and lost
    // it, and their territory frames the event far better than its prose does.
    () => (impacts.regionTransfers ?? []).flatMap((transfer) => [
      resolvePolityBounds(transfer?.toCode, context),
      resolvePolityBounds(transfer?.fromCode, context),
    ]),
    () => (impacts.createdChats ?? []).flatMap((chat) =>
      (chat?.countries ?? []).map((country) =>
        resolvePolityBounds(country?.code || country?.name, context))),
  ];

  for (const tier of tiers) {
    const bounds = combineFocusBounds(tier().filter(isBounds));
    if (bounds) {
      return bounds;
    }
  }

  return textFocusBounds(event, context);
};

// ---------------------------------------------------------------------------
// Context assembly (pure, so the lookups can be tested without PMTiles)
// ---------------------------------------------------------------------------

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
  const regionEntries = [];
  const regionOwners = [];

  for (const region of regions) {
    const id = String(region?.id ?? "");
    if (!id) {
      continue;
    }

    const nameKey = focusNameKey(region?.name);
    if (nameKey) {
      const bucket = regionIdsByName.get(nameKey);
      if (bucket) bucket.push(id);
      else regionIdsByName.set(nameKey, [id]);
      regionEntries.push({ kind: "region", nameKey, names: [region.name], token: id });
    }

    regionOwners.push({ baseOwner: String(region?.country ?? "") || String(region?.countryCode ?? ""), id });
  }

  // A region name shared by several places can't localise anything, so it never
  // enters the searchable index.
  const uniqueRegionEntries = regionEntries.filter((entry) =>
    (regionIdsByName.get(entry.nameKey) ?? []).length === 1);

  return {
    countryBounds,
    countryEntries,
    regionBounds,
    regionIdsByName,
    regionIndex: buildNameIndex(uniqueRegionEntries),
    regionOwners,
  };
};

// The catalog plus the live world: era/invented polity names, and who owns what
// right now. `catalog` may be omitted, in which case the raw catalogs are read
// straight from the same options.
export const buildFocusContext = ({ catalog = null, world = null, ...catalogOptions } = {}) => {
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
  const regionOwnerToken = new Map();
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

    // Which polity a region belongs to RIGHT NOW, as the same token the country
    // bounds and the text scan use — so "fighting in Donetsk" can be recognised
    // as being inside a Ukraine the same sentence names. Ownership is reachable
    // by that token too, so a legacy save or a text match that resolved to a
    // code still finds the territory and not only GADM's outline.
    let ownerToken = ownerTokens.get(owner);
    if (ownerToken === undefined) {
      ownerToken = lookupName(polityIndex, owner);
      ownerTokens.set(owner, ownerToken);
    }
    if (!ownerToken) {
      continue;
    }

    regionOwnerToken.set(id, ownerToken);
    const tokenKey = focusNameKey(ownerToken);
    if (tokenKey && tokenKey !== ownerKey) {
      addOwnership(tokenKey, id);
    }
  }

  return {
    countryBounds: places.countryBounds,
    polityIndex,
    regionBounds: places.regionBounds,
    regionIdsByName: places.regionIdsByName,
    regionIdsByOwner,
    regionIndex: places.regionIndex,
    regionOwnerToken,
  };
};
