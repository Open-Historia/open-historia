/*! Open Historia — portions (native structure director: the structures an event builds) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The simulator has always been able to build a structure: any event may carry
// a markerOps build, and the map draws it. In practice it never does. Structures
// are one lever among a dozen in a long prompt, nothing checks for the ones it
// leaves out, and a Project on the board can link a structure but not build one.
// A campaign could run for years of shipyards, data centres and ground stations
// with not one of them on the map.
//
// This pass is the backstop, the same shape as the unit director beside it: the
// events that describe something physical being built or opened are shown to a
// narrow AI call with the structures already standing and the board's entries;
// it names the structures those events brought into being, native rules below
// keep only real, placeable, new ones, and the accepted builds ride the event's
// own markerOps like any other. A build that belongs to a Project is linked to
// it once the turn is written (gameState.js linkStructuresToProjects).
//
// What counts: anything physical and fixed in one place. Not what orbits — a
// satellite or a constellation never gets a marker, the ground station serving
// it does — and not what moves, which is a unit.

import { normalizeMarkers } from "../../runtime/gameState.js";

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

// New structures one turn may put on the map, the simulator's own builds
// included, so a busy month does not bury the map in pins.
export const STRUCTURE_BUILDS_PER_TURN = 5;

const BUILD_STATUSES = new Set(["planned", "under_construction", "active"]);

// A thing that stands somewhere. Qualified nouns first ("radar station",
// "research centre"), then the ones that are a place on their own.
const FACILITY_PATTERN =
  /\b(?:(?:air|naval|navy|military|missile|army|submarine|drone|space|research|data|command|logistics|supply|training|test(?:ing)?|launch|listening|radar|tracking|ground|relay|monitoring|intelligence|signals|cyber|operations|control|fusion|nuclear|power|manufacturing|production|assembly|computing)[ -](?:bases?|stations?|centres?|centers?|facilit(?:y|ies)|complex(?:es)?|sites?|hubs?|campus(?:es)?|headquarters|plants?|yards?|ranges?|arrays?))\b|\b(?:shipyards?|dockyards?|dry ?docks?|naval yards?|air ?bases?|airfields?|airstrips?|airports?|spaceports?|cosmodromes?|launch (?:pads?|complex(?:es)?)|ports?|harbou?rs?|silos?|bunkers?|depots?|arsenals?|factor(?:y|ies)|gigafactor(?:y|ies)|foundr(?:y|ies)|refiner(?:y|ies)|reactors?|power (?:plants?|stations?)|laborator(?:y|ies)|data ?cent(?:re|er)s?|server (?:farms?|halls?)|supercomputers?|observator(?:y|ies)|fortress(?:es)?|fortifications?|forts?|barracks|academ(?:y|ies)|pipelines?|terminals?|dams?|bridges?|tunnels?|canals?|embass(?:y|ies)|consulates?|cable landing stations?|mines?|facilit(?:y|ies)|installations?|campus(?:es)?|headquarters|plants?|bases?|stations?|centres?|centers?)\b/i;

// The event says it came into being, not that someone discussed it.
const CONSTRUCTION_CUE_PATTERN =
  /\b(?:build(?:s|ing)?|built|construct(?:s|ed|ing|ion)?|open(?:s|ed|ing)?|inaugurat(?:e|es|ed|ing|ion)|commission(?:s|ed|ing)?|complet(?:e|es|ed|ing|ion)|breaks? ground|broke ground|ground-?breaking|establish(?:es|ed|ing|ment)?|sets? up|erect(?:s|ed|ing)?|install(?:s|ed|ing|ation)?|activat(?:e|es|ed|ing|ion)|(?:goes|go|went|gone|comes?|came|brought|brings?) (?:online|live|operational|into (?:service|operation))|enters? service|entered service|begins? operations?|began operations?|expand(?:s|ed|ing)?|expansion|upgrad(?:e|es|ed|ing)|found(?:s|ed|ing)?|lays? the foundation|laid the foundation)\b/i;

// In orbit: never a marker...
const ORBITAL_PATTERN = /\b(?:satellites?|constellations?|orbit(?:s|al|er|ers|ing)?|space stations?|spacecraft|space probes?)\b/i;
// ...unless it is the part on the ground.
const GROUND_SEGMENT_PATTERN =
  /\b(?:ground (?:stations?|segments?|control|terminals?|receiving)|earth stations?|teleports?|tracking (?:stations?|sites?)|mission control|control cent(?:re|er)s?|launch (?:sites?|pads?|complex(?:es)?|facilit(?:y|ies))|spaceports?|cosmodromes?|downlink)\b/i;

// A kind that is not a place: an effort, an organisation, or something that moves.
const NOT_A_PLACE_PATTERN =
  /\b(?:programmes?|programs?|projects?|initiatives?|networks?|agenc(?:y|ies)|doctrines?|polic(?:y|ies)|treat(?:y|ies)|alliances?|campaigns?|operations?|task (?:forces?|groups?)|fleets?|squadrons?|flotillas?|ships?|vessels?|submarines?|aircraft|units?|divisions?|brigades?)$/i;

const eventText = (event) =>
  `${normalizeString(event?.title)} ${normalizeString(event?.description)}`.trim();

export const eventNeedsStructureDirector = (event) => {
  if (!event || typeof event !== "object") return false;
  const text = eventText(event);
  return FACILITY_PATTERN.test(text) && CONSTRUCTION_CUE_PATTERN.test(text);
};

const isOrbital = (text) => ORBITAL_PATTERN.test(text) && !GROUND_SEGMENT_PATTERN.test(text);

const nameKey = (value) => normalizeString(value).toLowerCase().replace(/\s+/g, " ");

const makeStructureId = () =>
  `structure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const eventBuilds = (event) => normalizeArray(event?.impacts?.markerOps)
  .filter((op) => ["build", "found"].includes(normalizeString(op?.op).toLowerCase()));

// Which events the director would be asked about. Its own function so the turn
// review (gameplay.js runTurnReview) can tell beforehand whether to ask.
const selectStructureDirectorCandidates = (events) => normalizeArray(events)
  .map((event, index) => ({ event, index }))
  .filter(({ event }) => eventNeedsStructureDirector(event));

const summarizeStructure = (marker) => ({
  id: marker.id,
  name: marker.name,
  kind: marker.kind,
  ownerCode: marker.ownerCode,
  status: marker.status,
});

// The entries a structure could belong to: the ones still under way.
const OPEN_PROJECT_STATUSES = new Set(["proposed", "active", "stalled", "paused"]);
const summarizeProjects = (projects, playerCountry) => normalizeArray(projects)
  .filter((project) => normalizeString(project?.id) && OPEN_PROJECT_STATUSES.has(normalizeString(project?.status).toLowerCase() || "active"))
  .map((project) => ({
    id: normalizeString(project.id),
    name: normalizeString(project.name),
    owner: normalizeString(project.ownerCode) || playerCountry || "the player",
    progress: Number(project.progress) || 0,
    summary: normalizeString(project.summary).slice(0, 240),
  }));

const structureDirectorAnalyzerInput = (candidates, world, { playerCountry = "", budget } = {}) => ({
  candidates: candidates.map(({ event, index }) => ({
    eventIndex: index,
    date: normalizeString(event?.date),
    title: normalizeString(event?.title),
    description: normalizeString(event?.description),
    alreadyBuilds: eventBuilds(event).map((op) => normalizeString(op?.marker?.name ?? op?.name)).filter(Boolean),
  })),
  // The newest last, and only as many as a prompt can use.
  structures: normalizeMarkers(world?.markers).slice(-80).map(summarizeStructure),
  projects: summarizeProjects(world?.projects, playerCountry),
  budget,
});

const remainingBudget = (events) => Math.max(
  0,
  STRUCTURE_BUILDS_PER_TURN - normalizeArray(events).reduce((count, event) => count + eventBuilds(event).length, 0),
);

// null when no event needs the director, or the turn already built its fill.
export const buildStructureDirectorInput = ({ events = [], world = {}, playerCountry = "" } = {}) => {
  const candidates = selectStructureDirectorCandidates(events);
  const budget = remainingBudget(events);
  if (!candidates.length || budget <= 0) return null;
  return structureDirectorAnalyzerInput(candidates, world, { playerCountry, budget });
};

// The director's structures, kept or dropped by rule. Pure; `makeId` is for the
// tests. Placement has already run: a structure with no coordinates by now
// could not be placed and is dropped here, not left for the normalizer to lose
// silently.
export const sanitizeStructureOrders = ({ events, orders, world, makeId = makeStructureId }) => {
  const diagnostics = [];
  const acceptedByEvent = new Map();
  const links = [];
  const standing = normalizeMarkers(world?.markers);
  const taken = new Set(standing.flatMap((marker) => [marker.name, ...normalizeArray(marker.aliases)].map(nameKey)));
  for (const event of normalizeArray(events)) {
    for (const op of eventBuilds(event)) taken.add(nameKey(op?.marker?.name ?? op?.name));
  }
  const projects = normalizeArray(world?.projects).filter((project) => normalizeString(project?.id));
  const findProject = (value) => {
    const key = nameKey(value);
    if (!key) return null;
    return projects.find((project) => nameKey(project.id) === key) ?? projects.find((project) => nameKey(project.name) === key) ?? null;
  };
  let budget = remainingBudget(events);

  for (const entry of normalizeArray(orders)) {
    const eventIndex = Number(entry?.eventIndex);
    const event = Number.isInteger(eventIndex) ? events[eventIndex] : null;
    for (const raw of normalizeArray(entry?.structures)) {
      const name = normalizeString(raw?.name);
      const reject = (reason) => diagnostics.push({ eventIndex, name: name || "?", action: "DROP", reason });
      if (!event) { reject("eventIndex does not identify a supplied event"); continue; }
      if (!eventNeedsStructureDirector(event)) { reject("the event does not say anything was built or opened"); continue; }
      const kind = normalizeString(raw?.kind).toLowerCase();
      const ownerCode = normalizeString(raw?.ownerCode);
      if (!name || !kind || !ownerCode) { reject("a structure needs a name, a kind and an owner"); continue; }
      if (isOrbital(`${name} ${kind}`)) { reject("in orbit: satellites get no marker, only their ground station does"); continue; }
      if (NOT_A_PLACE_PATTERN.test(kind)) { reject(`"${kind}" is not a fixed place`); continue; }
      if (taken.has(nameKey(name))) { reject("already on the map"); continue; }
      const lng = Number(raw?.lng);
      const lat = Number(raw?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) {
        reject(`could not be placed${normalizeString(raw?.at) ? ` at "${normalizeString(raw.at)}"` : ""}`);
        continue;
      }
      if (budget <= 0) { reject(`over the ${STRUCTURE_BUILDS_PER_TURN} new structures a turn may build`); continue; }

      const status = normalizeString(raw?.status).toLowerCase();
      const marker = {
        id: makeId(),
        name,
        kind,
        ownerCode,
        status: BUILD_STATUSES.has(status) ? status : "active",
        lng,
        lat,
        note: normalizeString(raw?.note),
        foundedAt: normalizeString(event?.date),
      };
      budget -= 1;
      taken.add(nameKey(name));
      acceptedByEvent.set(eventIndex, [...(acceptedByEvent.get(eventIndex) ?? []), { op: "build", marker }]);
      const project = findProject(raw?.projectId);
      if (project) links.push({ markerId: marker.id, projectId: normalizeString(project.id) });
      diagnostics.push({ eventIndex, name, action: "KEEP", reason: project ? `accepted, linked to ${normalizeString(project.name)}` : "accepted" });
    }
  }
  return { acceptedByEvent, links, diagnostics };
};

// Returns the events with the accepted builds on them, and the Project links to
// make once the turn is written. A failed or absent analysis leaves the events
// exactly as they were.
export const directGeneratedStructureOps = async ({
  events = [],
  world = {},
  playerCountry = "",
  analyzeBatch,
  makeId,
} = {}) => {
  const sourceEvents = normalizeArray(events);
  const input = buildStructureDirectorInput({ events: sourceEvents, world, playerCountry });
  if (!input || typeof analyzeBatch !== "function") return { events: sourceEvents, links: [] };

  let analysis;
  try {
    analysis = await analyzeBatch(input);
  } catch (error) {
    console.warn("[structure director] analysis failed; the events keep the structures they had.", error);
    return { events: sourceEvents, links: [] };
  }
  const payload = analysis?.payload ?? analysis ?? {};
  const { acceptedByEvent, links, diagnostics } = sanitizeStructureOrders({
    events: sourceEvents,
    orders: payload.eventOrders,
    world,
    ...(makeId ? { makeId } : {}),
  });

  console.groupCollapsed(`[OH structure director] ${input.candidates.length} event(s) that may build, ${acceptedByEvent.size} built on`);
  if (diagnostics.length) console.table(diagnostics);
  else console.info("no structures were added this turn.");
  console.groupEnd();

  if (!acceptedByEvent.size) return { events: sourceEvents, links: [] };
  const nextEvents = sourceEvents.map((event, index) => {
    const additions = acceptedByEvent.get(index);
    if (!additions) return event;
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    return { ...event, impacts: { ...impacts, markerOps: [...normalizeArray(impacts.markerOps), ...additions] } };
  });
  return { events: nextEvents, links };
};
