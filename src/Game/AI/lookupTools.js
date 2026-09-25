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
import { getPoliticalProfile } from "../../runtime/politicalActors.js";
import { buildPoliticalKnowledgeView, POLITICAL_KNOWLEDGE_LEVELS } from "../../runtime/politicalKnowledge.js";
import { normalizeInstitutions } from "../../runtime/institutions.js";
import { polityRoleOf } from "../../../server/polityRole.js";
import {
  SIMULATION_AUDIENCE,
  audienceIncludes,
  audienceSeesChat,
  isSimulationAudience,
  normalizeAudience,
  spyAsSeenBy,
} from "./audience.js";

const clean = (value) => String(value ?? "").trim();
const array = (value) => (Array.isArray(value) ? value : []);

// What each named power is, when its record says (server/polityRole.js), as
// { name: role } — given beside a list of names that stays exact, so a name is
// always one to copy into an operation as it stands.
const rolesFor = (polities, names) => {
  const roles = {};
  for (const name of array(names)) {
    const key = clean(name);
    if (!key || roles[key]) continue;
    const role = polityRoleOf(polities, key);
    if (role) roles[key] = role;
  }
  return roles;
};
const withRoles = (field, polities, names) => {
  const roles = rolesFor(polities, names);
  return Object.keys(roles).length ? { [field]: roles } : {};
};
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
  "list_projects",
  "relations_between",
  "storylines",
  "region_history",
  "path_between",
  "spy_network",
  "border_between",
  "map_around",
  "list_cities",
  "political_actor",
  "list_institutions",
  "institution_info",
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
  {
    name: "list_projects",
    description:
      "The Projects & Operations board: long-running programmes with owner, status, priority, progress, target date, "
      + "next milestone, last update and what completing them changes on the map. Open entries by default.",
    schema: object("Optional filters.", {
      owner: text("Optional exact power name; omit for every power's projects."),
      status: text("open (default), closed, or all."),
    }),
  },
  {
    name: "relations_between",
    description:
      "The diplomatic relation between two exact powers: score (-100..100), status, summary, when it last moved; "
      + "the agreements between them and whether they are at war with each other.",
    schema: object("The two powers.", { a: text("One power's exact name."), b: text("The other power's exact name.") }, ["a", "b"]),
  },
  {
    name: "storylines",
    description:
      "The world's persistent storylines (the processes already in motion): id, kind, title, status, participants, "
      + "pressure and momentum, when they started, their current state, drivers and constraints. Continue these rather than restarting them.",
    schema: object("Optional filters.", {
      participant: text("Optional exact power name: only storylines it takes part in."),
      status: text("Optional status filter (active, dormant, resolved...)."),
    }),
  },
  {
    name: "region_history",
    description:
      "How one region changed hands over the campaign: every recorded transfer, control change and claim, oldest first, "
      + "with the event that carried it; plus who holds it now.",
    schema: object("Which region.", { regionId: text("The region id (from list_regions / find_region).") }, ["regionId"]),
  },
  {
    name: "path_between",
    description:
      "The shortest chain of neighbouring regions from one region to another, each with its owner: whose land a force "
      + "must cross, whether two powers touch, how far a front is. Adjacency is the map's own.",
    schema: object("Endpoints.", {
      fromRegionId: text("Start region id."),
      toRegionId: text("Destination region id."),
      maxSteps: integer("Give up beyond this many steps (default 12, max 40)."),
    }, ["fromRegionId", "toRegionId"]),
  },
  {
    name: "spy_network",
    description:
      "Espionage as the ledger records it: the agents a power runs abroad (target, status, cover, since when, whether suspected) "
      + "and the foreign agents known or suspected on its soil. All powers when no owner is given.",
    schema: object("Optional filter.", { owner: text("Optional exact power name.") }),
  },
  {
    name: "border_between",
    description:
      "The frontier between two powers: every pair of neighbouring regions where one power's region touches the "
      + "other's, with ids and names on both sides. Use it to see where two powers meet before writing an offensive, "
      + "a border incident or a cession; an empty result means they share no land border.",
    schema: object("The two powers.", {
      a: text("One power's exact name."),
      b: text("The other power's exact name."),
      limit: integer("How many pairs (default 40, max 120)."),
    }, ["a", "b"]),
  },
  {
    name: "map_around",
    description:
      "Who owns what around one region: the region itself and every region within a few neighbour steps, each with "
      + "its owner and sovereign, grouped by owner. A bounded local map — use it instead of asking for whole powers.",
    schema: object("The centre and the radius.", {
      regionId: text("The centre region id (from find_region / list_regions)."),
      steps: integer("How many neighbour steps out (default 1, max 3)."),
    }, ["regionId"]),
  },
  {
    name: "list_cities",
    description:
      "Cities on the map with the region each sits in and that region's owner, largest first; optionally one power's, "
      + "optionally capitals only.",
    schema: object("Optional filters.", {
      owner: text("Optional exact power name: only cities in its regions."),
      capitalsOnly: { type: "boolean", description: "Only cities marked as capitals." },
      limit: integer("How many (default 40, max 200)."),
    }),
  },
  {
    name: "political_actor",
    description:
      "Canonical political state for one polity. The simulation may read the full actor; polity-scoped audiences receive only their own canonical state or a foreign polity's public political projection. A lookup never grants authority to act for a polity.",
    schema: object("Which polity.", { polity: text("Canonical polity name or known alias.") }, ["polity"]),
  },
  {
    name: "list_institutions",
    description:
      "Canonical institutions in the campaign: identity, kind, status and membership count. Optionally filter to institutions containing one polity.",
    schema: object("Optional membership filter.", { member: text("Optional polity name.") }),
  },
  {
    name: "institution_info",
    description:
      "Canonical institution identity, membership and governance/business state. The simulation can inspect the full canonical workspace; polity-scoped audiences only receive full formal business for institutions they belong to. Membership never grants authority to decide for another member.",
    schema: object("Which institution.", { institution: text("Institution id, name or short name.") }, ["institution"]),
  },

]);

// The instruction that goes with the tools.
export const LOOKUP_DIRECTIVE = [
  "[Lookup tools]",
  "You have lookup functions beside your output function. They answer from the live campaign and the rendered map, and every name they return is spelled exactly as the map spells it.",
  "The prompt above carries the powers with their region counts, the last few events, a short view of the chats and the main contested regions. Region names and ids, older events, full conversations, the rest of the contested map, the board and the ledgers are behind the functions.",
  "Rules:",
  "1. Before you write ANY regionTransfers, regionControlOps or regionClaims entry, look the region up (find_region or list_regions) and copy its id and exact name into the entry. Never guess a region name. And the reverse holds: an event that narrates a capture, occupation, liberation or cession MUST carry that entry, with the id you looked up — narration alone never moves the map.",
  "2. Every owner field (fromCode, toCode, ownerCode, claimantCode, actorCode) must be a power's exact name as returned by list_powers or power_info. A short form, a translation or a code names nobody.",
  "3. Who owns what around a place comes from map_around (one region and its surroundings, grouped by owner) and border_between (where two powers' regions touch); region_info for one region's neighbours; find_city when you know the city but not the region. Never ask for a whole power's regions just to see a front.",
  "4. What is already in motion is on the ledgers: storylines, list_projects, war_ledger, relations_between, spy_network. Continue those rather than restarting them.",
  "5. You have at most THREE lookup rounds, and the first is the one that counts: call every function you will need in the same turn (every region you will name, every power you will check, the front you will move on) rather than one per turn.",
  "6. Then call the output function once with the complete answer. Do not narrate your lookups.",
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
 *   audience  who is asking (audience.js). Two of these functions answer from
 *             material a government keeps to itself — chat_history and
 *             spy_network — and they answer only what this audience could know.
 *             Every task that carries lookups today is the narrator, so the
 *             default is the narrator; a surface that speaks AS a polity (a
 *             leader, an envoy) MUST pass a viewer, or it can read the player's
 *             letters to everyone else through a function call.
 */
export const buildLookupContext = ({ regions = [], world = {}, cities = [], events = [], chats = [], units = [], player = "", audience = SIMULATION_AUDIENCE } = {}) => {
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
    audience: normalizeAudience(audience),
  };
};

// ---------------------------------------------------------------------------
// Places a text names — answered before anyone asks
// ---------------------------------------------------------------------------
//
// A lookup function lets the model ask who holds Mariupol. But asking is a round
// trip: the whole prompt goes out again, and on a free key requests are what run
// out (requestBudget.js). For a task whose input is a handful of finished events,
// the question can be answered beforehand — the events already name the places
// they are about — so placesNamedIn reads the text the way a reader would and
// hands over each named region and city with who controls it now, who lawfully
// owns it where that differs, and who claims it.
//
// Whole words only, accents and case folded, and a name of three letters or
// fewer is skipped: a region called "Ob" or "Aa" is in half the words of any
// paragraph. A city answers with the region it stands in. Longest names first,
// so "South Ossetia" is not also reported as "Ossetia".

const foldForSearch = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const MIN_PLACE_NAME_CHARS = 4;
export const PLACES_NAMED_LIMIT = 40;

export const placesNamedIn = (context, textValue, { limit = PLACES_NAMED_LIMIT } = {}) => {
  const haystack = ` ${foldForSearch(textValue)} `;
  if (haystack.length < MIN_PLACE_NAME_CHARS + 2 || !context) return [];

  const candidates = [];
  for (const row of array(context.rows)) {
    for (const name of [row.name, ...array(row.aliases)]) {
      const folded = foldForSearch(name);
      if (folded.length >= MIN_PLACE_NAME_CHARS) candidates.push({ folded, label: clean(name), kind: "region", row });
    }
  }
  for (const city of array(context.cityRows)) {
    for (const name of [city.name, ...array(city.aliases)]) {
      const folded = foldForSearch(name);
      if (folded.length >= MIN_PLACE_NAME_CHARS) candidates.push({ folded, label: clean(name), kind: "city", city });
    }
  }
  candidates.sort((a, b) => b.folded.length - a.folded.length || a.folded.localeCompare(b.folded));

  // Text already accounted for by a longer name is blanked, so a shorter name
  // inside it does not match a second time.
  let remaining = haystack;
  const found = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const needle = ` ${candidate.folded} `;
    const at = remaining.indexOf(needle);
    if (at < 0) continue;
    remaining = remaining.split(needle).join(` ${"#".repeat(candidate.folded.length)} `);
    const row = candidate.kind === "region" ? candidate.row : context.regionOfCity?.(candidate.city) ?? null;
    const key = `${candidate.kind}|${candidate.label.toLowerCase()}|${row?.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const claimants = row ? array(context.claimants?.[row.id]).map(clean).filter(Boolean) : [];
    found.push({
      at,
      place: candidate.label,
      kind: candidate.kind,
      ...(row ? {
        regionId: row.id,
        ...(candidate.kind === "city" || row.name !== candidate.label ? { region: row.name } : {}),
        controller: row.owner || "unowned",
        ...(row.sovereign && row.sovereign !== row.owner ? { lawfulOwner: row.sovereign } : {}),
        ...(claimants.length ? { claimants, ...withRoles("claimantRoles", context.polities, claimants) } : {}),
      } : { region: "not on this map" }),
    });
  }
  // In the order the text names them, which is the order a reader meets them in.
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, limit))
    .map(({ at: _at, ...place }) => place);
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

const warSides = (war) => {
  const sideA = array(war?.sideA).map(clean).filter(Boolean);
  const sideB = array(war?.sideB).map(clean).filter(Boolean);
  if (sideA.length || sideB.length) return { sideA, sideB };
  const named = stringsIn(war?.sides ?? war?.participants ?? war?.belligerents ?? war?.aggressors ?? war);
  return { sideA: [...new Set(named)].slice(0, 12), sideB: [] };
};
const warBrief = (war) => {
  const { sideA, sideB } = warSides(war);
  return {
    id: clean(war?.id),
    status: clean(war?.status) || "active",
    title: clean(war?.title || war?.name),
    ...(sideB.length ? { sideA, sideB } : {}),
    participants: [...new Set([...sideA, ...sideB])].slice(0, 24),
    since: clean(war?.startedDate || war?.startedAt || war?.startDate || war?.since),
    ...(war?.cause ? { cause: clean(war.cause).slice(0, 300) } : {}),
    ...(war?.note ? { note: clean(war.note).slice(0, 300) } : {}),
  };
};
const warBetween = (war, a, b) => {
  const { sideA, sideB } = warSides(war);
  const has = (side, name) => side.some((entry) => foldRegionKey(entry) === foldRegionKey(name));
  return (has(sideA, a) && has(sideB, b)) || (has(sideA, b) && has(sideB, a));
};

const projectBrief = (project) => {
  const effects = project?.onComplete && typeof project.onComplete === "object" ? project.onComplete : null;
  const mapEffects = effects ? [
    ...array(effects.regionTransfers).map((t) => `transfer ${t.regionName || t.regionId} -> ${t.toCode}`),
    ...array(effects.regionClaims).map((c) => `claim ${c.regionName || c.regionId} by ${c.claimantCode}`),
    ...array(effects.polityChanges).map((p) => `polity ${p.code || p.name}`),
  ] : [];
  return {
    id: clean(project?.id),
    name: clean(project?.name),
    kind: clean(project?.kind),
    owner: clean(project?.ownerCode || project?.owner),
    status: clean(project?.status) || "active",
    priority: clean(project?.priority),
    progress: Number(project?.progress) || 0,
    ...(project?.secrecy && clean(project.secrecy) !== "public" ? { secrecy: clean(project.secrecy) } : {}),
    summary: clean(project?.summary).slice(0, 300),
    startedAt: clean(project?.startedAt),
    ...(project?.ongoing ? { ongoing: true } : { targetDate: clean(project?.targetDate) }),
    ...(project?.nextMilestone ? { nextMilestone: { title: clean(project.nextMilestone.title), date: clean(project.nextMilestone.date), status: clean(project.nextMilestone.status) } } : {}),
    lastUpdate: clean(project?.lastUpdate).slice(0, 300),
    ...(mapEffects.length ? { onComplete: mapEffects.slice(0, 12) } : {}),
  };
};
// One board entry as `audience` may know it, or null. See list_projects.
const projectAsSeenBy = (audience, project, player) => {
  if (!project || typeof project !== "object") return null;
  if (isSimulationAudience(audience)) return project;
  const owner = clean(project.ownerCode || project.owner) || clean(player);
  if (owner && audienceIncludes(audience, owner)) return project;
  const secrecy = clean(project.secrecy).toLowerCase() || "public";
  if (secrecy === "public") return project;
  if (secrecy === "restricted") {
    // Known to exist, and no more: no summary, progress, milestones or effects.
    return { id: project.id, name: project.name, kind: project.kind, ownerCode: owner, status: project.status, secrecy };
  }
  return null;
};

const OPEN_PROJECT_STATUSES = new Set(["active", "planned", "stalled", "paused", "in-progress", "ongoing"]);
const projectIsOpen = (project) => {
  const status = clean(project?.status).toLowerCase();
  return !status || OPEN_PROJECT_STATUSES.has(status);
};

const storylineBrief = (storyline) => ({
  id: clean(storyline?.id),
  kind: clean(storyline?.kind),
  title: clean(storyline?.title),
  status: clean(storyline?.status) || "active",
  participants: array(storyline?.participants).map(clean).filter(Boolean),
  pressure: Number(storyline?.pressure) || 0,
  momentum: Number(storyline?.momentum) || 0,
  startedDate: clean(storyline?.startedDate),
  lastUpdatedDate: clean(storyline?.lastUpdatedDate),
  state: clean(storyline?.state).slice(0, 500),
  ...(array(storyline?.drivers).length ? { drivers: array(storyline.drivers).map(clean) } : {}),
  ...(array(storyline?.constraints).length ? { constraints: array(storyline.constraints).map(clean) } : {}),
});

const spyBrief = (spy) => ({
  id: clean(spy?.id),
  owner: clean(spy?.owner),
  target: clean(spy?.target),
  status: clean(spy?.status),
  ...(spy?.deployedAt ? { since: clean(spy.deployedAt) } : {}),
  ...(spy?.coverStory ? { cover: clean(spy.coverStory).slice(0, 200) } : {}),
  ...(spy?.suspected ? { suspected: true } : {}),
});

const agreementBrief = (agreement) => ({
  id: clean(agreement?.id),
  kind: clean(agreement?.kind || agreement?.type),
  title: clean(agreement?.title || agreement?.name),
  status: clean(agreement?.status),
  parties: [...new Set(stringsIn(agreement?.parties ?? agreement?.participants ?? agreement?.members ?? []))].slice(0, 12),
  ...(agreement?.terms ? { terms: clean(agreement.terms).slice(0, 300) } : {}),
  ...(agreement?.startedDate ? { since: clean(agreement.startedDate) } : {}),
});

const politicalActorLookup = (context, polity) => {
  const requested = clean(polity);
  if (!requested) return { error: "polity is required" };
  const actor = getPoliticalProfile(context.world, requested);
  if (!actor) return { error: `No canonical Political Actor found for "${requested}". Do not invent one.` };

  const actorName = clean(actor.polityKey || actor.name || requested);
  const ownAudience = audienceIncludes(context.audience, actorName) || audienceIncludes(context.audience, requested);
  const level = isSimulationAudience(context.audience) || ownAudience
    ? POLITICAL_KNOWLEDGE_LEVELS.GM
    : POLITICAL_KNOWLEDGE_LEVELS.PUBLIC;
  const view = buildPoliticalKnowledgeView(context.world, actorName, { level });
  if (!view) return { error: `No readable Political Actor state found for "${requested}".` };
  return {
    polity: actorName,
    authority: "read-only evidence; never permission to act for this polity",
    ...view,
  };
};

const normalizedInstitutionRows = (world) => Object.values(normalizeInstitutions(world?.institutions, world).byId || {});

const institutionMemberNames = (institution) => array(institution?.members)
  .map((member) => clean(member?.polity || member?.name || member))
  .filter(Boolean);

const institutionIsVisibleInFull = (context, institution) => (
  isSimulationAudience(context.audience)
  || institutionMemberNames(institution).some((member) => audienceIncludes(context.audience, member))
);

const institutionIdentityBrief = (institution) => ({
  id: clean(institution?.id),
  name: clean(institution?.name),
  shortName: clean(institution?.shortName),
  kind: clean(institution?.kind),
  status: clean(institution?.status),
  memberCount: institutionMemberNames(institution).length,
  purpose: array(institution?.charter?.lifecycle?.purpose).slice(0, 8).map(clean).filter(Boolean),
  geographicScope: array(institution?.charter?.lifecycle?.identity?.geographicScope).slice(0, 8).map(clean).filter(Boolean),
  politicalCharacter: clean(institution?.charter?.lifecycle?.identity?.politicalCharacter).slice(0, 400),
});

const institutionFullBrief = (institution) => {
  const proposalSource = institution?.proposals ?? institution?.agenda ?? institution?.matters;
  const proposals = Array.isArray(proposalSource)
    ? proposalSource
    : Object.values(proposalSource && typeof proposalSource === "object" ? proposalSource : {});
  return {
    ...institutionIdentityBrief(institution),
    foundedDate: clean(institution?.foundedDate),
    members: array(institution?.members).slice(0, 80).map((member) => ({
      polity: clean(member?.polity || member?.name || member),
      status: clean(member?.status || "member"),
      role: clean(member?.role || "member"),
    })).filter((member) => member.polity),
    ...(institution?.charter && typeof institution.charter === "object" ? { charter: institution.charter } : {}),
    activeBusiness: proposals.filter((proposal) => {
      const status = clean(proposal?.status).toLowerCase();
      return !["resolved", "adopted", "rejected", "withdrawn", "closed", "failed", "passed"].includes(status);
    }).slice(0, 20).map((proposal) => ({
      id: clean(proposal?.id),
      title: clean(proposal?.title || proposal?.name),
      summary: clean(proposal?.summary).slice(0, 500),
      status: clean(proposal?.status),
      sponsor: clean(proposal?.sponsor || proposal?.proposer),
      ...(proposal?.votingRule || proposal?.rule ? { votingRule: proposal?.votingRule || proposal?.rule } : {}),
    })),
    pendingLifecycle: Object.values(institution?.lifecycleCases || {}).filter((entry) => ["pending", "negotiating", "pending-approval"].includes(clean(entry?.status).toLowerCase())).slice(0, 24).map((entry) => ({
      id: clean(entry?.id),
      kind: clean(entry?.kind),
      polity: clean(entry?.polity),
      initiatedBy: clean(entry?.initiatedBy),
      requestedStatus: clean(entry?.requestedStatus),
      status: clean(entry?.status),
      proposalId: clean(entry?.proposalId),
      effectiveDate: clean(entry?.effectiveDate),
      reason: clean(entry?.reason).slice(0, 400),
    })),
    membershipHistory: array(institution?.membershipHistory).slice(-24).map((entry) => ({
      action: clean(entry?.action), polity: clean(entry?.polity), actor: clean(entry?.actor), date: clean(entry?.date),
      status: clean(entry?.status), role: clean(entry?.role), reason: clean(entry?.reason).slice(0, 300),
    })),
  };
};

export const executeLookup = (context, name, args = {}) => {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "list_powers": {
      const query = foldRegionKey(a.query);
      const powers = [...context.ownerRows.entries()]
        .map(([label, rows]) => {
          const role = polityRoleOf(context.polities, label);
          return { name: label, regions: rows.length, ...(role ? { role } : {}), ...(label === context.player ? { player: true } : {}) };
        })
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
      const claimants = array(context.claimants[row.id]).map(clean).filter(Boolean);
      return {
        ...regionBrief(row),
        sovereign: row.sovereign || row.owner || "unowned",
        claimants,
        ...withRoles("claimantRoles", context.polities, claimants),
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
        ...(clean(record?.role) ? { role: clean(record.role) } : {}),
        ...(record?.note ? { description: clean(record.note).slice(0, 600) } : {}),
        ...(array(record?.tags).length ? { tags: array(record.tags).map(clean) } : {}),
        ...(Number.isFinite(Number(world.internationalReputation?.[owner])) ? { reputation: Number(world.internationalReputation[owner]) } : {}),
        ...(Number.isFinite(Number(world.intelligence?.[owner])) ? { intelligence: Number(world.intelligence[owner]) } : {}),
        wars,
        relations,
        claimsAsserted: claimsBy.slice(0, 20),
        claimsAgainstIt: claimsAgainst.slice(0, 20),
        ...withRoles("claimantRoles", context.polities, claimsAgainst.slice(0, 20).flatMap((entry) => entry.claimants)),
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
      const wars = array(world.wars).map(warBrief);
      return {
        wars,
        ...withRoles("participantRoles", context.polities, wars.flatMap((war) => war.participants)),
        agreements: array(world.agreements).slice(0, 40).map(agreementBrief),
      };
    }
    case "chat_history": {
      const owner = context.resolveOwner(a.with);
      if (!owner) return unknownPower(context, a.with);
      const limit = clampInt(a.limit, 1, 40, 12);
      const audience = context.audience ?? SIMULATION_AUDIENCE;
      // Only a conversation the asker was in. A chat it was not party to is
      // answered exactly as one that does not exist: saying "you may not read
      // that" would itself tell a government that the player is talking to
      // someone, and to whom.
      const chat = context.chats.find((entry) =>
        array(entry?.countries).some((country) => clean(country?.name) === owner)
        && audienceSeesChat(audience, entry, { player: context.player }));
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
      const shown = rows.slice(0, 120);
      return {
        count: rows.length,
        regions: shown,
        ...withRoles("claimantRoles", context.polities, shown.flatMap((entry) => entry.claimants ?? [])),
      };
    }
    case "list_projects": {
      const world = context.world ?? {};
      let owner = "";
      if (clean(a.owner)) {
        owner = context.resolveOwner(a.owner);
        if (!owner) return unknownPower(context, a.owner);
      }
      const status = clean(a.status).toLowerCase() || "open";
      const audience = context.audience ?? SIMULATION_AUDIENCE;
      const projects = array(world.projects)
        .filter((project) => !owner || foldRegionKey(project?.ownerCode || project?.owner) === foldRegionKey(owner))
        .filter((project) => status === "all" || (status === "closed" ? !projectIsOpen(project) : projectIsOpen(project)))
        // A programme's secrecy is a fact about who knows of it. The narrator and
        // the owner see every entry whole; anyone else sees a public one whole, a
        // restricted one only as the fact that it exists, and a covert one not at
        // all. A blank ownerCode is the player's (world-state.md).
        .map((project) => projectAsSeenBy(audience, project, context.player))
        .filter(Boolean);
      return { ...(owner ? { owner } : {}), status, count: projects.length, projects: projects.slice(0, 60).map(projectBrief) };
    }
    case "relations_between": {
      const first = context.resolveOwner(a.a);
      if (!first) return unknownPower(context, a.a);
      const second = context.resolveOwner(a.b);
      if (!second) return unknownPower(context, a.b);
      const world = context.world ?? {};
      const pair = new Set([foldRegionKey(first), foldRegionKey(second)]);
      const relation = array(world.relations).find((entry) => entry && pair.has(foldRegionKey(entry.a)) && pair.has(foldRegionKey(entry.b)) && pair.size === 2);
      const agreements = array(world.agreements).filter((agreement) => {
        const parties = stringsIn(agreement?.parties ?? agreement?.participants ?? agreement?.members ?? []).map(foldRegionKey);
        return parties.includes(foldRegionKey(first)) && parties.includes(foldRegionKey(second));
      });
      const wars = array(world.wars).filter((war) => warBetween(war, first, second));
      return {
        a: first,
        b: second,
        relation: relation
          ? { score: Number(relation.score) || 0, status: clean(relation.status), summary: clean(relation.summary).slice(0, 400), lastUpdatedDate: clean(relation.lastUpdatedDate) }
          : null,
        ...(relation ? {} : { hint: "No relation is recorded between these two powers; treat them as neutral unless a war or agreement below says otherwise." }),
        agreements: agreements.slice(0, 12).map(agreementBrief),
        wars: wars.map(warBrief),
        atWar: wars.some((war) => clean(war?.status).toLowerCase() !== "ended"),
      };
    }
    case "storylines": {
      const world = context.world ?? {};
      let participant = "";
      if (clean(a.participant)) {
        participant = context.resolveOwner(a.participant);
        if (!participant) return unknownPower(context, a.participant);
      }
      const status = clean(a.status).toLowerCase();
      const list = array(world.storylines)
        .filter((storyline) => !participant || array(storyline?.participants).some((name) => foldRegionKey(name) === foldRegionKey(participant)))
        .filter((storyline) => !status || clean(storyline?.status).toLowerCase() === status);
      return { ...(participant ? { participant } : {}), count: list.length, storylines: list.slice(0, 40).map(storylineBrief) };
    }
    case "region_history": {
      const row = context.byId.get(clean(a.regionId));
      if (!row) return { error: `No region with id "${clean(a.regionId)}". Use find_region or list_regions to get ids.` };
      const keys = new Set([foldRegionKey(row.id), foldRegionKey(row.name), ...row.aliases.map(foldRegionKey)]);
      const matches = (entry) => keys.has(foldRegionKey(entry?.regionId)) || keys.has(foldRegionKey(entry?.regionName));
      const changes = [];
      for (const event of context.events) {
        const impacts = event?.impacts ?? {};
        for (const transfer of array(impacts.regionTransfers)) {
          if (matches(transfer)) changes.push({ date: clean(event.date), event: clean(event.title), change: `transfer${transfer.fromCode ? ` from ${transfer.fromCode}` : ""} to ${transfer.toCode}` });
        }
        for (const op of array(impacts.regionControlOps)) {
          if (matches(op)) changes.push({ date: clean(event.date), event: clean(event.title), change: `${clean(op.op) || "control"}${op.toCode ? ` -> ${op.toCode}` : ""}${op.actorCode ? ` by ${op.actorCode}` : ""}` });
        }
        for (const claim of array(impacts.regionClaims)) {
          if (matches(claim)) changes.push({ date: clean(event.date), event: clean(event.title), change: `${claim.drop ? "claim dropped" : "claim"} by ${claim.claimantCode}` });
        }
      }
      return { ...regionBrief(row), sovereign: row.sovereign || row.owner || "unowned", changes: changes.slice(-40), ...(changes.length === 0 ? { hint: "No recorded change of hands in this campaign." } : {}) };
    }
    case "path_between": {
      const from = context.byId.get(clean(a.fromRegionId));
      const to = context.byId.get(clean(a.toRegionId));
      if (!from) return { error: `No region with id "${clean(a.fromRegionId)}".` };
      if (!to) return { error: `No region with id "${clean(a.toRegionId)}".` };
      const maxSteps = clampInt(a.maxSteps, 1, 40, 12);
      if (from === to) return { steps: 0, path: [regionBrief(from)] };
      const previous = new Map([[from.id, null]]);
      let frontier = [from];
      let found = null;
      for (let depth = 0; depth < maxSteps && frontier.length && !found; depth += 1) {
        const next = [];
        for (const row of frontier) {
          for (const neighbour of context.neighboursOf(row)) {
            if (previous.has(neighbour.id)) continue;
            previous.set(neighbour.id, row);
            if (neighbour === to) { found = neighbour; break; }
            next.push(neighbour);
          }
          if (found) break;
        }
        frontier = next;
      }
      if (!found) {
        return { error: `No chain of neighbouring regions within ${maxSteps} steps (the regions may be separated by sea, or the map declares no adjacency for one of them).` };
      }
      const path = [];
      for (let row = found; row; row = previous.get(row.id)) path.unshift(regionBrief(row));
      const crossed = [...new Set(path.slice(1, -1).map((entry) => entry.owner))];
      return { steps: path.length - 1, path, ...(crossed.length ? { crosses: crossed } : {}) };
    }
    case "spy_network": {
      const world = context.world ?? {};
      const audience = context.audience ?? SIMULATION_AUDIENCE;
      // The narrator sees every agent. Anyone else sees its own people — a turned
      // or discovered one still reading as active, because that is what its
      // service believes — and only the foreign agents it has actually caught
      // (audience.js spyAsSeenBy).
      const spies = isSimulationAudience(audience)
        ? array(world.spies)
        : array(world.spies).map((spy) => spyAsSeenBy(audience, spy)).filter(Boolean);
      if (clean(a.owner)) {
        const owner = context.resolveOwner(a.owner);
        if (!owner) return unknownPower(context, a.owner);
        const key = foldRegionKey(owner);
        return {
          owner,
          agentsAbroad: spies.filter((spy) => foldRegionKey(spy?.owner) === key).map(spyBrief),
          foreignAgentsAtHome: spies.filter((spy) => foldRegionKey(spy?.target) === key).map(spyBrief),
        };
      }
      return { count: spies.length, agents: spies.slice(0, 120).map(spyBrief) };
    }
    case "list_cities": {
      let owner = "";
      if (clean(a.owner)) {
        owner = context.resolveOwner(a.owner);
        if (!owner) return unknownPower(context, a.owner);
      }
      const limit = clampInt(a.limit, 1, 200, 40);
      const capitalsOnly = a.capitalsOnly === true;
      const placed = context.cityRows
        .filter((city) => !capitalsOnly || city.capital)
        .map((city) => ({ city, row: context.regionOfCity(city) }))
        .filter(({ row }) => !owner || (row && row.owner === owner))
        .sort((x, y) => y.city.population - x.city.population);
      return {
        ...(owner ? { owner } : {}),
        count: placed.length,
        cities: placed.slice(0, limit).map(({ city, row }) => ({
          name: city.name,
          population: city.population,
          ...(city.capital ? { capital: city.capital } : {}),
          ...(row ? { regionId: row.id, regionName: row.name, owner: row.owner || "unowned" } : { regionId: null }),
        })),
      };
    }
    case "border_between": {
      const first = context.resolveOwner(a.a);
      if (!first) return unknownPower(context, a.a);
      const second = context.resolveOwner(a.b);
      if (!second) return unknownPower(context, a.b);
      if (first === second) return { error: "Name two different powers." };
      const limit = clampInt(a.limit, 1, 120, 40);
      const pairs = [];
      for (const row of context.ownerRows.get(first) ?? []) {
        for (const neighbour of context.neighboursOf(row)) {
          if (neighbour.owner !== second) continue;
          pairs.push({ [first]: { id: row.id, name: row.name }, [second]: { id: neighbour.id, name: neighbour.name } });
        }
      }
      return {
        a: first, b: second, count: pairs.length, pairs: pairs.slice(0, limit),
        ...(pairs.length === 0 ? { hint: "No region of one touches a region of the other: they share no land border on this map (or the map declares no adjacency there)." } : {}),
      };
    }
    case "map_around": {
      const centre = context.byId.get(clean(a.regionId));
      if (!centre) return { error: `No region with id "${clean(a.regionId)}". Use find_region or list_regions to get ids.` };
      const steps = clampInt(a.steps, 1, 3, 1);
      const distance = new Map([[centre.id, 0]]);
      let frontier = [centre];
      for (let depth = 1; depth <= steps && frontier.length; depth += 1) {
        const next = [];
        for (const row of frontier) {
          for (const neighbour of context.neighboursOf(row)) {
            if (distance.has(neighbour.id)) continue;
            distance.set(neighbour.id, depth);
            next.push(neighbour);
          }
        }
        frontier = next;
      }
      const byOwner = {};
      for (const [id, depth] of distance) {
        const row = context.byId.get(id);
        const owner = row.owner || "unowned";
        (byOwner[owner] ??= []).push({ id: row.id, name: row.name, steps: depth, ...(row.sovereign && row.sovereign !== row.owner ? { sovereign: row.sovereign } : {}) });
      }
      for (const list of Object.values(byOwner)) list.sort((x, y) => x.steps - y.steps || x.name.localeCompare(y.name));
      return { centre: regionBrief(centre), steps, regions: distance.size, byOwner };
    }
    case "political_actor":
      return politicalActorLookup(context, a.polity);
    case "list_institutions": {
      const member = clean(a.member);
      const rows = normalizedInstitutionRows(context.world).filter((institution) => (
        !member || institutionMemberNames(institution).some((name) => foldRegionKey(name) === foldRegionKey(member))
      ));
      return {
        count: rows.length,
        institutions: rows.slice(0, 80).map(institutionIdentityBrief),
      };
    }
    case "institution_info": {
      const token = foldRegionKey(a.institution);
      if (!token) return { error: "institution is required" };
      const institution = normalizedInstitutionRows(context.world).find((entry) => (
        [entry?.id, entry?.name, entry?.shortName].some((value) => foldRegionKey(value) === token)
      ));
      if (!institution) return { error: `No canonical institution matches "${clean(a.institution)}".` };
      if (!institutionIsVisibleInFull(context, institution)) {
        return {
          ...institutionIdentityBrief(institution),
          members: institutionMemberNames(institution),
          note: "Formal business is not exposed to this audience because it is not a member of this institution.",
        };
      }
      return {
        ...institutionFullBrief(institution),
        authority: "read-only canonical governance evidence; membership is not consent and this lookup cannot cast votes or decide outcomes",
      };
    }
    default:
      return { error: `Unknown lookup "${clean(name)}". Available: ${LOOKUP_TOOL_NAMES.join(", ")}.` };
  }
};

export const isLookupToolName = (name) => LOOKUP_TOOL_NAMES.includes(clean(name));
