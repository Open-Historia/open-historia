// Lookup tools: what the model can ASK for instead of being handed everything.
//
// A structured task (a timeline jump, a game-master command, action
// suggestions) used to receive the whole campaign inline and then guess the
// exact names and ids it needed for map operations. With these tools declared
// beside the task's output tool, the model looks things up first — the exact
// powers on the map, one power's regions, a region by name, a region's
// neighbours, a city's region, a power's situation, recent events, the war
// ledger, a chat, the units — and only then calls the output tool. Every
// answer here is built from the live campaign and the rendered map, and every
// name in it is spelled as the map spells it.
//
// Import-light on purpose: the executor is a pure function of a context the
// caller builds (lookupContext), so it runs in node tests and in the harness.

import { foldRegionKey, matchRegionName, stripRegionAffixes, editDistance } from "./regionMatch.js";

const clean = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

const text = (description) => ({ type: "string", description });
const integer = (description) => ({ type: "integer", description });
const object = (description, properties, required = []) => ({
  type: "object",
  description,
  properties,
  required,
  additionalProperties: false,
});

export const LOOKUP_TOOL_NAMES = Object.freeze([
  "list_powers",
  "list_regions",
  "find_region",
  "region_info",
  "find_city",
  "power_info",
  "recent_events",
  "war_ledger",
  "chat_history",
  "list_units",
  "contested_regions",
]);

export const LOOKUP_TOOLS = Object.freeze([
  {
    name: "list_powers",
    description:
      "Every power on the map, by its EXACT name (the only spelling any owner field accepts), with how many "
      + "regions it holds. Call this before naming a power you have not seen spelled in this conversation.",
    schema: object("Optional filter.", { query: text("Optional substring to filter names by (case-insensitive).") }),
  },
  {
    name: "list_regions",
    description:
      "The regions one power currently holds, as {id, name}. Use the exact power name from list_powers. Paged: "
      + "pass offset to continue. Copy ids or names EXACTLY into regionTransfers / regionControlOps / regionClaims.",
    schema: object("Which power.", {
      owner: text("The power's exact name."),
      offset: integer("First region to return (default 0)."),
      limit: integer("How many to return (default 200, max 300)."),
    }, ["owner"]),
  },
  {
    name: "find_region",
    description:
      "Find map regions by name — exact, with an administrative suffix ('Kharkiv Oblast'), or a transliteration "
      + "a letter or two off. Returns up to 8 candidates with their ids and current owners; choose one and use "
      + "its id. Optionally restrict to one power's regions.",
    schema: object("What to find.", {
      name: text("The region name as you know it."),
      owner: text("Optional: only regions held by this exact power name."),
    }, ["name"]),
  },
  {
    name: "region_info",
    description:
      "One region in full: exact name, controller, legal sovereign, claimants, cities inside it, and its "
      + "neighbouring regions with their owners (who could reach it, whose land it borders).",
    schema: object("Which region.", { regionId: text("The region id (from list_regions / find_region).") }, ["regionId"]),
  },
  {
    name: "find_city",
    description:
      "Find a city by name and learn which region contains it (the region to move if the city changes hands), "
      + "with the region's owner and the city's population.",
    schema: object("Which city.", { name: text("The city name.") }, ["name"]),
  },
  {
    name: "power_info",
    description:
      "One power's situation: regions held, wars it is in, its relations ledger, claims it asserts and claims "
      + "against it, reputation, intelligence rating, tags, its authored description, and unit count. "
      + "Use the exact name from list_powers.",
    schema: object("Which power.", { name: text("The power's exact name.") }, ["name"]),
  },
  {
    name: "recent_events",
    description:
      "The most recent timeline events (newest last): date, title, summary, and what each moved on the map. "
      + "Optionally only events mentioning a power or place.",
    schema: object("How many, about what.", {
      limit: integer("How many events (default 12, max 40)."),
      about: text("Optional exact power name or region/city name to filter by."),
    }),
  },
  {
    name: "war_ledger",
    description: "Every war the world records, with its status and participants, plus formal agreements in force.",
    schema: object("No arguments.", {}),
  },
  {
    name: "chat_history",
    description: "The diplomatic conversation between the player and one power: the last messages, newest last.",
    schema: object("Which power.", {
      with: text("The other power's exact name."),
      limit: integer("How many messages (default 12, max 40)."),
    }, ["with"]),
  },
  {
    name: "list_units",
    description: "Military units on the map (id, name, type, owner, strength, posture, region), optionally one power's.",
    schema: object("Optional filter.", { owner: text("Optional exact power name.") }),
  },
  {
    name: "contested_regions",
    description:
      "Every region whose controller differs from its legal sovereign or that carries active claims: "
      + "occupations, disputes, irredentist claims — the map's non-normal territorial state.",
    schema: object("No arguments.", {}),
  },
]);

// The instruction that goes with the tools.
export const LOOKUP_DIRECTIVE = [
  "[Lookup tools]",
  "You have lookup functions beside your output function. They answer from the live campaign and the rendered map, and every name they return is spelled exactly as the map spells it.",
  "Rules:",
  "1. Before you write ANY regionTransfers, regionControlOps or regionClaims entry, look the region up (find_region or list_regions) and copy its id and exact name into the entry. Never guess a region name.",
  "2. Every owner field (fromCode, toCode, ownerCode, claimantCode, actorCode) must be a power's exact name as returned by list_powers or power_info. A short form, a translation or a code names nobody.",
  "3. Use region_info to learn who borders a region before moving forces or borders there; use find_city when you know the city but not the region.",
  "4. Look up what you need, then call the output function once with the complete answer. Do not narrate your lookups.",
].join("\n");

// ---------------------------------------------------------------------------
// Context: the indexes the executor answers from. Built once per task by the
// caller from the bundle, the rendered region catalog and the cities.
// ---------------------------------------------------------------------------

const STOCK_REGION_ID = /^[A-Z]{3}\.\d+(?:_\d+)?$/;

const bboxOf = (geometry) => {
  if (!geometry) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const visit = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number") {
      const x = coords[0]; const y = coords[1];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      return;
    }
    for (const entry of coords) visit(entry);
  };
  visit(geometry.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
};

const ADJACENCY_GAP_DEGREES = 0.05;
const bboxesTouch = (a, b) =>
  a && b && a[0] <= b[2] + ADJACENCY_GAP_DEGREES && b[0] <= a[2] + ADJACENCY_GAP_DEGREES
  && a[1] <= b[3] + ADJACENCY_GAP_DEGREES && b[1] <= a[3] + ADJACENCY_GAP_DEGREES;

const pointInRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi)) inside = !inside;
  }
  return inside;
};
const pointInGeometry = (point, geometry) => {
  if (!geometry || !Array.isArray(point)) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some((polygon) => Array.isArray(polygon) && polygon.length && pointInRing(point, polygon[0])
    && !polygon.slice(1).some((hole) => pointInRing(point, hole)));
};

const centroidOf = (region, bbox) => {
  const lng = Number(region?.lng); const lat = Number(region?.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
};
const NEAREST_CENTROID_DEGREES = 2.5;
const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/**
 * Build the executor's context.
 *   regions   [{ id, name, geometry?, lng?, lat?, adjacencies?, aliases?, country? }] — the RENDERED map's regions
 *   world     the world state (regionOwnershipOverrides, regionSovereigntyOverrides,
 *             regionClaimants, polityOverrides, wars, relations, agreements, storylines,
 *             countryStats, units?, customCities)
 *   cities    [{ name, coordinates: [lng, lat], population?, capital? }]
 *   events    the save's events (array or round-keyed object), oldest first
 *   chats     the save's chats
 *   units     [{ id, name, type, ownerCode, strength, posture, regionId, lng, lat }]
 *   player    the player's polity name
 */
export const buildLookupContext = ({ regions = [], world = {}, cities = [], events = [], chats = [], units = [], player = "" } = {}) => {
  const overrides = world?.regionOwnershipOverrides ?? {};
  const sovereignty = world?.regionSovereigntyOverrides ?? {};
  const claimants = world?.regionClaimants ?? {};
  const polities = world?.polityOverrides ?? {};

  const list = array(regions).filter((region) => region && clean(region.id));
  const byId = new Map();
  const ownerOf = (region) => clean(overrides[clean(region.id)] ?? region.owner ?? region.country ?? "");
  const rows = list.map((region) => {
    const id = clean(region.id);
    const row = {
      id,
      name: clean(region.name) || id,
      owner: ownerOf(region),
      sovereign: clean(sovereignty[id]) || "",
      aliases: array(region.aliases).map(clean).filter(Boolean),
      geometry: region.geometry ?? null,
      bbox: bboxOf(region.geometry ?? null),
      adjacencies: array(region.adjacencies).map(clean).filter(Boolean),
      stock: STOCK_REGION_ID.test(id),
    };
    row.centroid = centroidOf(region, row.bbox);
    byId.set(id, row);
    return row;
  });

  // Owner index: exact names only (the standardised-name rule).
  const ownerRows = new Map(); // owner label -> rows
  for (const row of rows) {
    if (!row.owner) continue;
    if (!ownerRows.has(row.owner)) ownerRows.set(row.owner, []);
    ownerRows.get(row.owner).push(row);
  }
  const ownerByFold = new Map();
  const declareOwner = (raw, label) => { const key = foldRegionKey(raw); if (key && !ownerByFold.has(key)) ownerByFold.set(key, label); };
  for (const label of ownerRows.keys()) declareOwner(label, label);
  for (const [token, record] of Object.entries(polities)) {
    // A record keyed by a legacy code maps onto the label the map's owners use.
    const label = ownerRows.has(token) ? token : ownerRows.has(clean(record?.name)) ? clean(record.name) : token;
    declareOwner(token, label);
    declareOwner(record?.name, label);
    for (const alias of array(record?.aliases)) declareOwner(alias, label);
  }
  const resolveOwner = (token) => ownerByFold.get(foldRegionKey(token)) ?? "";

  // Neighbours: the map author's declared adjacencies when the catalog carries
  // them (either direction counts), else bounding-box adjacency from geometry —
  // cheap, and an over-approximation that only ever adds a diagonal neighbour,
  // never drops a real one. Computed on demand per region and cached.
  const declaredAdjacency = new Map();
  for (const row of rows) {
    for (const other of row.adjacencies) {
      if (!byId.has(other) || other === row.id) continue;
      if (!declaredAdjacency.has(row.id)) declaredAdjacency.set(row.id, new Set());
      if (!declaredAdjacency.has(other)) declaredAdjacency.set(other, new Set());
      declaredAdjacency.get(row.id).add(other);
      declaredAdjacency.get(other).add(row.id);
    }
  }
  const neighbourCache = new Map();
  const neighboursOf = (row) => {
    if (neighbourCache.has(row.id)) return neighbourCache.get(row.id);
    const declared = declaredAdjacency.get(row.id);
    const found = declared
      ? [...declared].map((id) => byId.get(id)).filter(Boolean)
      : row.bbox
        ? rows.filter((other) => other !== row && bboxesTouch(row.bbox, other.bbox))
        : [];
    neighbourCache.set(row.id, found);
    return found;
  };

  const cityRows = array(cities).map((city) => ({
    name: clean(city.name ?? city.city),
    aliases: array(city.aliases).map(clean).filter(Boolean),
    coordinates: Array.isArray(city.coordinates) ? city.coordinates : null,
    population: Number(city.population) || 0,
    capital: clean(city.capital),
  })).filter((city) => city.name && city.coordinates);
  // The region a city sits in: the polygon that contains it when the map's
  // geometry is at hand, else the nearest region centroid (the catalog always
  // carries centroids), reported as approximate.
  const cityRegionCache = new Map();
  const placeCity = (city) => {
    const key = `${city.name}|${city.coordinates.join(",")}`;
    if (cityRegionCache.has(key)) return cityRegionCache.get(key);
    let placed = null;
    const inside = rows.find((row) => row.bbox && row.geometry
      && city.coordinates[0] >= row.bbox[0] && city.coordinates[0] <= row.bbox[2]
      && city.coordinates[1] >= row.bbox[1] && city.coordinates[1] <= row.bbox[3]
      && pointInGeometry(city.coordinates, row.geometry));
    if (inside) placed = { row: inside, approximate: false };
    else {
      let best = null; let bestDistance = NEAREST_CENTROID_DEGREES ** 2;
      for (const row of rows) {
        if (!row.centroid || row.geometry) continue;
        const distance = distanceSquared(row.centroid, city.coordinates);
        if (distance < bestDistance) { bestDistance = distance; best = row; }
      }
      if (best) placed = { row: best, approximate: true };
    }
    cityRegionCache.set(key, placed);
    return placed;
  };
  const regionOfCity = (city) => placeCity(city)?.row ?? null;
  const citiesInRegion = (row) => cityRows.filter((city) => regionOfCity(city) === row);

  const eventList = (Array.isArray(events) ? events : Object.values(events ?? {}).flat())
    .filter((event) => event && typeof event === "object");

  return {
    rows, byId, ownerRows, resolveOwner, neighboursOf, cityRows, regionOfCity, placeCity, citiesInRegion,
    world, polities, claimants, sovereignty, events: eventList, chats: array(chats), units: array(units), player: clean(player),
  };
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const regionBrief = (row) => ({ id: row.id, name: row.name, owner: row.owner || "unowned" });

const unknownPower = (context, token) => ({
  error: `"${clean(token)}" is not a power on this map. Owner names are exact. Call list_powers for the exact names.`,
  powers: [...context.ownerRows.keys()].sort().slice(0, 60),
});

const stringsIn = (value, depth = 0, out = []) => {
  if (depth > 4 || value == null) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) stringsIn(entry, depth + 1, out);
  else if (typeof value === "object") for (const entry of Object.values(value)) stringsIn(entry, depth + 1, out);
  return out;
};
const mentions = (record, name) => {
  const key = foldRegionKey(name);
  return key && stringsIn(record).some((value) => foldRegionKey(value) === key);
};

const eventBrief = (event) => {
  const impacts = event?.impacts ?? {};
  const moved = [
    ...array(impacts.regionTransfers).map((t) => `${t.regionName || t.regionId} -> ${t.toCode}`),
    ...array(impacts.regionControlOps).map((op) => `${op.op}: ${op.regionName || op.regionId}${op.toCode ? ` -> ${op.toCode}` : ""}`),
    ...array(impacts.regionClaims).map((c) => `${c.drop ? "claim dropped" : "claim"}: ${c.regionName || c.regionId} by ${c.claimantCode}`),
  ];
  return {
    id: clean(event.id),
    date: clean(event.date),
    title: clean(event.title),
    summary: clean(event.description).slice(0, 400),
    ...(moved.length ? { mapChanges: moved.slice(0, 20) } : {}),
  };
};

const warBrief = (war) => ({
  id: clean(war?.id),
  status: clean(war?.status) || "active",
  title: clean(war?.title || war?.name),
  participants: [...new Set(stringsIn(war?.sides ?? war?.participants ?? war?.belligerents ?? war?.aggressors ?? war))].slice(0, 12),
  since: clean(war?.startedAt || war?.startDate || war?.since),
});

export const executeLookup = (context, name, args = {}) => {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "list_powers": {
      const query = foldRegionKey(a.query);
      const powers = [...context.ownerRows.entries()]
        .map(([label, rows]) => ({ name: label, regions: rows.length, ...(label === context.player ? { player: true } : {}) }))
        .filter((power) => !query || foldRegionKey(power.name).includes(query))
        .sort((x, y) => y.regions - x.regions || x.name.localeCompare(y.name));
      return { count: powers.length, powers: powers.slice(0, 250) };
    }
    case "list_regions": {
      const owner = context.resolveOwner(a.owner);
      if (!owner) return unknownPower(context, a.owner);
      const rows = context.ownerRows.get(owner) ?? [];
      const offset = clampInt(a.offset, 0, Math.max(0, rows.length), 0);
      const limit = clampInt(a.limit, 1, 300, 200);
      const page = rows.slice(offset, offset + limit).map((row) => ({ id: row.id, name: row.name }));
      return { owner, total: rows.length, offset, regions: page, ...(offset + limit < rows.length ? { next: offset + limit } : {}) };
    }
    case "find_region": {
      const query = clean(a.name);
      if (!query) return { error: "name is required" };
      let pool = context.rows;
      let owner = "";
      if (clean(a.owner)) {
        owner = context.resolveOwner(a.owner);
        if (!owner) return unknownPower(context, a.owner);
        pool = context.ownerRows.get(owner) ?? [];
      }
      const key = foldRegionKey(query);
      const stripped = stripRegionAffixes(key) || key;
      const scored = [];
      for (const row of pool) {
        const names = [row.name, ...row.aliases].map(foldRegionKey);
        let score = 0;
        for (const candidate of names) {
          const bare = stripRegionAffixes(candidate) || candidate;
          if (candidate === key) score = Math.max(score, 100);
          else if (bare === stripped) score = Math.max(score, 90);
          else if (stripped.length >= 4 && (bare === stripped || `${bare} `.startsWith(`${stripped} `) || bare.startsWith(`${stripped} `) || stripped.startsWith(`${bare} `))) score = Math.max(score, 70);
          else if (stripped.length >= 5 && bare.length >= 5) {
            const distance = editDistance(stripped, bare, 2);
            if (distance <= 2) score = Math.max(score, 60 - distance * 10);
          }
        }
        if (score > 0) scored.push({ score, row });
      }
      scored.sort((x, y) => y.score - x.score || x.row.name.localeCompare(y.row.name));
      const unique = matchRegionName(query, pool, { maxFuzzy: owner ? 2 : 1 });
      return {
        query,
        ...(owner ? { owner } : {}),
        ...(unique ? { bestMatch: { ...regionBrief(unique.region), rule: unique.rule } } : {}),
        matches: scored.slice(0, 8).map(({ score, row }) => ({ ...regionBrief(row), confidence: score })),
        ...(scored.length === 0 ? { hint: "No region has a name like that. Try list_regions on the owner, or find_city if you know a city there." } : {}),
      };
    }
    case "region_info": {
      const row = context.byId.get(clean(a.regionId));
      if (!row) return { error: `No region with id "${clean(a.regionId)}". Use find_region or list_regions to get ids.` };
      return {
        ...regionBrief(row),
        sovereign: row.sovereign || row.owner || "unowned",
        claimants: array(context.claimants[row.id]).map(clean).filter(Boolean),
        cities: context.citiesInRegion(row).slice(0, 12).map((city) => ({ name: city.name, population: city.population, ...(city.capital ? { capital: city.capital } : {}) })),
        neighbours: context.neighboursOf(row).slice(0, 24).map(regionBrief),
      };
    }
    case "find_city": {
      const key = foldRegionKey(a.name);
      if (!key) return { error: "name is required" };
      const stripped = stripRegionAffixes(key) || key;
      const near = (folded) => folded === key || folded === stripped || (stripped.length >= 5 && editDistance(stripped, folded, 1) <= 1);
      const hits = context.cityRows
        .filter((city) => near(foldRegionKey(city.name)) || city.aliases.some((alias) => near(foldRegionKey(alias))))
        .slice(0, 8)
        .map((city) => {
          const placed = context.placeCity(city);
          const row = placed?.row;
          return {
            city: city.name,
            population: city.population,
            ...(row ? { regionId: row.id, regionName: row.name, owner: row.owner || "unowned" } : { regionId: null }),
            ...(placed?.approximate ? { approximate: true, note: "nearest region by centroid; the map carries no polygon for this city" } : {}),
          };
        });
      return { query: clean(a.name), matches: hits, ...(hits.length === 0 ? { hint: "No city by that name on this map." } : {}) };
    }
    case "power_info": {
      const owner = context.resolveOwner(a.name);
      if (!owner) return unknownPower(context, a.name);
      const record = context.polities[owner] ?? Object.values(context.polities).find((entry) => clean(entry?.name) === owner) ?? {};
      const world = context.world ?? {};
      const held = context.ownerRows.get(owner) ?? [];
      const wars = array(world.wars).filter((war) => mentions(war, owner)).map(warBrief);
      const relations = array(world.relations)
        .filter((relation) => mentions(relation, owner))
        .slice(0, 24)
        .map((relation) => ({ ...(relation && typeof relation === "object" ? relation : { value: relation }) }));
      const claimsBy = []; const claimsAgainst = [];
      for (const [regionId, names] of Object.entries(context.claimants)) {
        const row = context.byId.get(regionId);
        if (!row) continue;
        if (array(names).some((claimant) => clean(claimant) === owner)) claimsBy.push(regionBrief(row));
        if (row.owner === owner && array(names).length) claimsAgainst.push({ ...regionBrief(row), claimants: array(names).map(clean) });
      }
      return {
        name: owner,
        regions: held.length,
        ...(record?.note ? { description: clean(record.note).slice(0, 600) } : {}),
        ...(array(record?.tags).length ? { tags: array(record.tags).map(clean) } : {}),
        ...(Number.isFinite(Number(world.internationalReputation?.[owner])) ? { reputation: Number(world.internationalReputation[owner]) } : {}),
        ...(Number.isFinite(Number(world.intelligence?.[owner])) ? { intelligence: Number(world.intelligence[owner]) } : {}),
        wars,
        relations,
        claimsAsserted: claimsBy.slice(0, 20),
        claimsAgainstIt: claimsAgainst.slice(0, 20),
        units: context.units.filter((unit) => clean(unit?.ownerCode) === owner).length,
        ...(world.countryStats?.[owner] ? { stats: world.countryStats[owner] } : {}),
      };
    }
    case "recent_events": {
      const limit = clampInt(a.limit, 1, 40, 12);
      const about = clean(a.about);
      const filtered = about ? context.events.filter((event) => mentions({ t: event.title, d: event.description, i: event.impacts }, about)
        || foldRegionKey(`${event.title} ${event.description}`).includes(foldRegionKey(about))) : context.events;
      return { total: filtered.length, events: filtered.slice(-limit).map(eventBrief) };
    }
    case "war_ledger": {
      const world = context.world ?? {};
      return {
        wars: array(world.wars).map(warBrief),
        agreements: array(world.agreements).slice(0, 40).map((agreement) => ({
          id: clean(agreement?.id), kind: clean(agreement?.kind || agreement?.type), title: clean(agreement?.title || agreement?.name),
          status: clean(agreement?.status), parties: [...new Set(stringsIn(agreement?.parties ?? agreement?.participants ?? agreement?.members ?? []))].slice(0, 12),
        })),
      };
    }
    case "chat_history": {
      const owner = context.resolveOwner(a.with);
      if (!owner) return unknownPower(context, a.with);
      const limit = clampInt(a.limit, 1, 40, 12);
      const chat = context.chats.find((entry) => array(entry?.countries).some((country) => clean(country?.name) === owner));
      if (!chat) return { with: owner, messages: [], hint: "No conversation with this power yet." };
      const messages = array(chat.messages).slice(-limit).map((message) => ({
        from: clean(message?.speaker || message?.role || message?.from),
        date: clean(message?.gameDate || message?.date),
        text: clean(message?.text || message?.content).slice(0, 600),
      }));
      return { with: owner, title: clean(chat.title), messages };
    }
    case "list_units": {
      let units = context.units;
      if (clean(a.owner)) {
        const owner = context.resolveOwner(a.owner);
        if (!owner) return unknownPower(context, a.owner);
        units = units.filter((unit) => clean(unit?.ownerCode) === owner);
      }
      return {
        count: units.length,
        units: units.slice(0, 120).map((unit) => ({
          id: clean(unit?.id), name: clean(unit?.name), type: clean(unit?.type), owner: clean(unit?.ownerCode),
          strength: Number(unit?.strength) || 0, posture: clean(unit?.posture), regionId: clean(unit?.regionId),
          ...(Number.isFinite(Number(unit?.lng)) ? { lng: Number(unit.lng), lat: Number(unit.lat) } : {}),
        })),
      };
    }
    case "contested_regions": {
      const rows = [];
      for (const row of context.rows) {
        const claimants = array(context.claimants[row.id]).map(clean).filter(Boolean);
        const sovereign = row.sovereign || row.owner;
        if (!claimants.length && foldRegionKey(sovereign) === foldRegionKey(row.owner)) continue;
        rows.push({ ...regionBrief(row), sovereign: sovereign || "unowned", ...(claimants.length ? { claimants } : {}) });
      }
      return { count: rows.length, regions: rows.slice(0, 120) };
    }
    default:
      return { error: `Unknown lookup "${clean(name)}". Available: ${LOOKUP_TOOL_NAMES.join(", ")}.` };
  }
};

export const isLookupToolName = (name) => LOOKUP_TOOL_NAMES.includes(clean(name));
