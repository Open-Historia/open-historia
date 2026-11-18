/*! Open Historia — what one player may see of the host's game © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The host holds the whole game. Each player is sent a VIEW of it: the same
// documents, in the single-player shape the game's screens already read
// (game.country is the viewer, and the viewer is the implicit player of their
// own diplomatic threads), holding only what that player's government may know.
// A view is all that ever leaves the host (client/remoteRuntime.js serves it),
// so a player who reads their own network traffic learns nothing more than
// their screen shows. The host's own screen is a player like any other and gets
// a view too.
//
// FAIL CLOSED, key by key. Every key of the world is classified below as public,
// filtered for the viewer, or the host's alone; a key nobody classified is left
// out of every view, and projection.test.js fails until it is classified. The
// per-row rules are the game's own where it has them: spyAsSeenBy (audience.js),
// visiblePuppetsFor (puppets.js), buildPublicPoliticalView (politicalKnowledge.js),
// the reports' distribution lists, the thread log's membership (chatThreads.js).
//
// What stays with the host even for the host's own screen is the narrator's:
// AI-written prose written from everywhere at once (the last jump's summary, the
// history documents, the storylines), the simulation's receipts and bookkeeping,
// and the Game Master's audit. No canary can check prose for secrets, so none of
// it is sent.
//
// v1 limits, kept deliberately narrow rather than guessed at:
// - A country's stat sheet is what any government can count or read: capital,
//   government, population, the economy and the scenario's own figures. Every
//   sheet goes to every player, as single player shows them. (A scenario's own
//   figures may be military; the host cannot yet mark some of them private.)
// - How good a country's intelligence service is, is exact only for its own
//   government: everyone else is sent an estimate, to the nearest ten.
// - Agreements carry no secrecy flag yet, so every treaty is public.
// - Scenes are a single-player feature still keyed to the host's seat; other
//   seats get none. Each player's agents' traffic is its own (runtime/
//   spycraft.js interceptTableOf), with its own seal (runtime/spySeal.js sealOf).
// - The AI's suggested orders are each device's own, asked with that player's
//   own key and kept on that device (client/seatWrites.js): no view carries any.
//   The advice the week itself brings each player (world.seatAdvice) is theirs
//   alone, and so is their advisor's thread of secrets (advisorDesk.js).

import { advisorThreadFor } from "./advisorDesk.js";
import { normalizeWorldState } from "../../runtime/gameState.js";
import { normalizeReports } from "../../runtime/reports.js";
import { visiblePuppetsFor } from "../../runtime/puppets.js";
import { buildPublicPoliticalView } from "../../runtime/politicalKnowledge.js";
import { battlefieldsForViewer } from "../../runtime/fronts/view.js";
import { polityMatches, spyAsSeenBy, viewerAudience } from "../../Game/AI/audience.js";
import { eventNamesPolity } from "../../runtime/eventConcerns.js";
import { formerNamesOf } from "./foundings.js";
import { settleBoards } from "./seatBoards.js";
import { interceptTableOf } from "../../runtime/spycraft.js";
import { sealOf } from "../../runtime/spySeal.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const same = (left, right) => Boolean(fold(left)) && fold(left) === fold(right);
const list = (value) => (Array.isArray(value) ? value : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// --- The world, key by key ------------------------------------------------------

// What every government knows: the map, who owns and claims it, the wars, the
// scenario's own text, and what anyone can count or read in a newspaper.
export const PUBLIC_WORLD_KEYS = Object.freeze([
  "allowedBasemaps", "allowedUnitTypes", "author", "background", "basemap", "cityPopulations", "cityRenames",
  "countryTags", "customCities", "customRegions", "difficulty", "diplomaticLedgerVersion",
  "groupAreas", "groups", "internationalReputation", "labelFont", "labelHaloColor",
  "labelTextColor", "language", "lastJumpMode", "lastJumpTargetDate", "mapCredit", "markers",
  "ownBasemaps", "ownerCodes", "ownerSchema", "polityOverrides", "powerStatus", "regionClaimants",
  "regionOwnershipOverrides", "regionRenames", "regionSovereigntyOverrides", "settledRegionClaims",
  "simulationRules", "startingTimelineText", "unitSystem", "wars", "agreements",
  // And what an event's strike looked like: every map plays it.
  "strikes",
  // And what the war room's air strikes did: who was struck knows it (runtime/fronts/airStrike.js).
  "airStrikes",
  "seaBattles",
  "blockades",
  // War weariness, and the peaces made (Game/AI/warAndPeace.js): what every
  // government would know of. (The offers and the calls to arms coming due are
  // their parties' own until answered: FILTERED_WORLD_KEYS.)
  "warWeariness",
  // And what each country has left to fight with (runtime/warResources.js).
  "warResources",
  // And what attrition has cost each (runtime/attrition.js).
  "attrition",
  // How the scenario's wars are fought (runtime/warSettings.js): the scenario's own rules.
  "warSettings",
  // And its own unit types (runtime/unitTypes.js): what a dragon is, every player may know.
  "unitTypes",
  // What the scenario draws on its map for war (runtime/warGeography.js): there for all to see.
  "terrainAreas",
  "climateZones",
  "freezingRegions",
  // And the water frozen now, and each climate zone's weather: there for all to see.
  "frozenRegions",
  "zoneWeather",
  "reparations",
  "peaceTreaties",
  // Rostra, the social network (runtime/socialFeed.js): posts are public.
  "socialFeed",
  // The stat sheets, and how each has moved: public figures (see the limits above).
  "countryStats", "countryStatsHistory",
  // The map itself, as the scenario draws it: how it is projected, its region
  // types (a sea, a wasteland), its seas, whether it is drawn by hand, how its
  // cities' people are counted, its countries' common names, and which built-in
  // map it is. In no view before, the host's own included, so on a flat or
  // custom map every screen drew a different map from the one the engine ran:
  // seas painted as land, a flat sheet wrapped round the globe, distances as on
  // Earth.
  "projection", "regionTypes", "seas", "customGeometry", "cityPopulationBasis", "commonNames",
  "builtInMap", "builtInRevision",
]);

// The narrator's and the engine's own. Never in any view.
export const HOST_ONLY_WORLD_KEYS = Object.freeze([
  "actionSuggestions", "chargedRefusals", "chatKnowledgeCursors", "consolidatedHistory",
  "gmAudit", "gmChanges", "historyDocument", "idlePulseTick", "lastJumpSummary", "naviesRaised", "notes",
  "pendingEventOutreach", "politicalSimulation", "seatBoards", "seatSeals", "seenFleetPostures", "simulationReminders",
  "storylines",
  // What the last time skip's prompt read (runtime/promptSnapshot.js).
  "promptSnapshot", "promptReference",
  // The campaign's canon, kept beside the history document (runtime/historyTiers.js).
  "canonFacts",
  // And the scenario's canon model (runtime/scenarioCanon.js).
  "canonContext", "canonModelVersion",
  // What the Workshop wrote for a new game to open with: its pre-history
  // (runtime/scenarioPrehistory.js) and its fronts (AI/frontScenario.js). A game
  // holds what they made (its events, its battlefields), which the views carry.
  "prehistory", "scenarioFronts",
  // What an old save kept apart, folded into the Political World on reading
  // (runtime/politicalLandscapeFold.js).
  "politics",
]);

// The host seat's single-player features (a scene in progress, the key its own
// intercepts are sealed with): its own view only.
const HOST_SEAT_WORLD_KEYS = Object.freeze([
  "activeInteractive", "interactiveOffer", "lastInteractiveOfferRound",
  // Which countries' sheets a skip refreshes is the host's setting, on the
  // host's AI key.
  "countryStatsTracking",
]);

const ownsUnit = (world, unitId, viewer) => {
  const unit = list(world.units).find((entry) => clean(entry?.id) === clean(unitId));
  return Boolean(unit) && same(unit.ownerCode, viewer);
};

const isMember = (institution, viewer) => list(institution?.members).some((member) =>
  (polityMatches(member?.polity, viewer) || polityMatches(member, viewer))
  && !["left", "expelled", "suspended"].includes(fold(member?.status)));

// What a non-member sees of an institution: what it is and who is in it, not
// its deliberations.
const PUBLIC_INSTITUTION_KEYS = [
  "id", "name", "shortName", "aliases", "badgeKey", "logoUrl", "logoAsset", "priority", "kind",
  "status", "members", "leaders", "foundedDate", "dissolvedDate", "predecessors", "charter",
  "membershipHistory", "lastUpdatedDate", "sourceEventIds",
];

const pick = (record, keys) => Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));

// WHAT IS ONLY ORDERED STAYS PRIVATE UNTIL THE SKIP (the owner's decision 6,
// 2026-11-18: "just do A only"): units and structures that exist are seen by
// everyone; what a country has ordered and the world has not yet seen happen
// is its own. Another player's view showed a formation raised, a formation
// stood down, a convoy ordered and whom it hunts, a line still being built
// and a fleet's new posture the moment they were ordered (the gap audit of
// 2026-11-18). Each filter below keeps another country's as it stood at the
// last skip.
// A planned stand-down's order carries the formation as it was (host/forces.js
// disbandFor): until the skip, another sees it there.
const standingDown = (actions, viewer) => list(actions)
  .filter((action) => !same(action?.ownerCode, viewer) && clean(action?.status || "planned") === "planned")
  .map((action) => action?.unitRevert?.restore)
  .filter((unit) => isRecord(unit) && clean(unit.id));

// What became of a turn's events written for the viewer's own orders that the
// engine kept off the timeline (runtime/filedEvents.js: a card, its fate and
// why): told to the player whose orders they answered, as single player's
// Events panel tells its player, and nobody else. Which orders a card answered
// is what it cites (actionIds), never its words. No player was told why their
// order's event was refused, the host included (the gap audit of 2026-11-18):
// the order just came back overdue. A card cites only the viewer's own orders
// here; the other players' order ids are theirs.
const filedOrderCards = (cards, ownOrders) => {
  const own = new Set(list(ownOrders).map((action) => clean(action?.id)).filter(Boolean));
  if (!own.size) return [];
  return list(cards).filter(isRecord).flatMap((card) => {
    const cited = list(card.actionIds).map(clean).filter((id) => own.has(id));
    return cited.length ? [{ ...card, actionIds: cited }] : [];
  });
};

// Filtered keys: each is given the whole world and returns what the viewer may
// have of that key. `actions`: the order queue, for what is only ordered.
const FILTERED_WORLD_KEYS = Object.freeze({
  // Units are seen, their orders are not. Another country's formation raised
  // this round (pending) is not seen yet, one it stood down still is, and a
  // fleet's posture is as it was at the last skip (world.seenFleetPostures).
  units: (world, viewer, { actions = [] } = {}) => {
    const seen = isRecord(world.seenFleetPostures) ? world.seenFleetPostures : {};
    const asSeen = (unit) => {
      const was = seen[clean(unit?.id)];
      return isRecord(was) ? { ...unit, posture: was.posture ?? unit.posture, status: was.status ?? unit.status } : unit;
    };
    const standing = list(world.units)
      .filter((unit) => same(unit?.ownerCode, viewer) || clean(unit?.status) !== "pending")
      .map((unit) => (same(unit?.ownerCode, viewer) ? unit : { ...asSeen(unit), orderId: "" }));
    const ids = new Set(standing.map((unit) => clean(unit?.id)));
    const stoodDown = standingDown(actions, viewer).filter((unit) => !ids.has(clean(unit.id))).map((unit) => ({ ...asSeen(unit), orderId: "" }));
    return [...standing, ...stoodDown];
  },
  // Transporters are seen as fleets are, once under way: a convoy only ordered
  // is its owner's, and whom a country's ships hunt is that country's own.
  transports: (world, viewer) => list(world.transports)
    .filter((entry) => same(entry?.owner, viewer) || clean(entry?.status) !== "ordered")
    .map((entry) => (Array.isArray(entry?.hunters) ? { ...entry, hunters: entry.hunters.filter((name) => same(name, viewer)) } : entry)),
  // A line ordered since the last skip is its owner's; once time has passed
  // it is seen by everyone, built or still being built. (`building` stays on a
  // line for good, fronts/walls.js standsOn: it is the order's DATE that says
  // it was only ordered. A skip always moves the date on.)
  fortifications: (world, viewer, { date = "" } = {}) => list(world.fortifications)
    .filter((line) => same(line?.owner, viewer) || !(clean(date) && clean(line?.building?.since) === clean(date))),
  pendingUnitOrders: (world, viewer) => list(world.pendingUnitOrders).filter((order) => ownsUnit(world, order?.unitId, viewer)),
  // The air strikes a country has ordered and not yet flown are its own.
  airStrikeOrders: (world, viewer) => list(world.airStrikeOrders).filter((order) => same(order?.owner, viewer)),

  // A battlefield is seen whole, as units are: the line, both sides' troops,
  // what has been taken. A side's standing orders and its reserves are its own
  // (runtime/fronts/view.js), and the engine's bookkeeping stays with the host.
  battlefields: (world, viewer) => battlefieldsForViewer(world.battlefields, viewer),

  // An agent is known to its owner (who never learns it was turned) and to the
  // country that caught it; to nobody else.
  spies: (world, viewer) => {
    const audience = viewerAudience([viewer]);
    return list(world.spies).map((spy) => spyAsSeenBy(audience, spy)).filter(Boolean);
  },

  // A government's Projects board is its own business: what it is working on,
  // and what its services have learned of anyone else's work. The host's seat
  // has the game's own board, as single player does; every other person's is
  // kept beside it (world.seatBoards, gameHost.js "projectOps"). While a round
  // runs, the other players' open entries are lent to the game's board
  // (seatBoards.js lendBoards): the host's view is that board without them, or
  // a view sent mid-round gave the host every player's work, secret too.
  projects: (world, viewer, { host }) => {
    if (same(host, viewer)) return list(settleBoards(world).projects);
    const boards = isRecord(world.seatBoards) ? world.seatBoards : {};
    const mine = Object.keys(boards).find((country) => same(country, viewer));
    return mine ? list(boards[mine]) : [];
  },

  // The turns as every player's Events panel reads them (GameUI/time.jsx): when
  // each ran and which events it wrote, in the order they are shown, with the
  // viewer's own orders, and the events written for those orders that the
  // engine kept off the timeline, with why (filedOrderCards). The narrator's
  // summary of the turn, the model's raw answer, the engine's receipt and
  // everyone else's orders stay with the host.
  simulationHistory: (world, viewer, { host, hiddenEventIds = new Set() }) => list(world.simulationHistory).filter(isRecord).map((entry) => {
    const plannedActions = list(entry.plannedActions).filter((action) => (clean(action?.ownerCode)
      ? same(action.ownerCode, viewer)
      : same(host, viewer)));
    const filed = filedOrderCards(entry.filedEvents, plannedActions);
    return {
      date: clean(entry.date),
      fromDate: clean(entry.fromDate),
      toDate: clean(entry.toDate),
      round: Number(entry.round) || 0,
      mode: clean(entry.mode),
      source: clean(entry.source) || "ai",
      eventIds: list(entry.eventIds).map(clean).filter((id) => id && !hiddenEventIds.has(id)),
      plannedActions,
      ...(filed.length ? { filedEvents: filed } : {}),
      // Why a turn fell back names the host's model and its provider's error.
      ...(same(host, viewer) && clean(entry.fallbackReason) ? { fallbackReason: clean(entry.fallbackReason) } : {}),
    };
  }),

  // A subordination as the viewer believes it to stand; a covert one only once
  // learned; its loyalty only for the overlord; who else knows, never.
  puppets: (world, viewer) => {
    const seen = new Map(visiblePuppetsFor(world, viewer).map((row) => [clean(row.id), row]));
    return list(world.puppets)
      .filter((row) => seen.has(clean(row?.id)))
      .map((row) => {
        const view = seen.get(clean(row.id));
        const { loyalty, knownTo, ...rest } = row;
        const mine = list(knownTo).filter((entry) => same(typeof entry === "string" ? entry : entry?.polity, viewer));
        return {
          ...rest,
          status: view.status,
          endedDate: view.endedDate,
          ...(view.fromIntelligence ? { lastUpdatedDate: view.asOf || rest.lastUpdatedDate } : {}),
          ...(view.role === "overlord" ? { loyalty } : {}),
          knownTo: mine,
        };
      });
  },

  // Documents: the public ones, the ones on the viewer's distribution list, and
  // the ones it stole. Who else stole a copy is never said.
  // A seat that founded a country of its own still holds what its government
  // held before (`readers`, foundings.js formerNamesOf).
  reports: (world, viewer, { readers = [viewer] } = {}) => normalizeReports(world.reports)
    .filter((report) => report.visibleTo === null
      || list(report.visibleTo).some((entry) => readers.some((name) => same(entry, name)))
      || list(report.interceptedBy).some((entry) => readers.some((name) => same(entry, name))))
    .map((report) => {
      const { interceptedBy, receivedFrom, ...rest } = report;
      const stolen = list(interceptedBy).some((entry) => same(entry, viewer));
      const received = isRecord(receivedFrom)
        ? Object.fromEntries(Object.entries(receivedFrom).filter(([polity]) => same(polity, viewer)))
        : null;
      return {
        ...rest,
        ...(stolen ? { interceptedBy: [viewer] } : {}),
        ...(received && Object.keys(received).length ? { receivedFrom: received } : {}),
      };
    }),

  // Relations the viewer is a party to.
  relations: (world, viewer) => list(world.relations).filter((relation) =>
    [relation?.a, relation?.b, relation?.polityA, relation?.polityB, relation?.actorA, relation?.actorB]
      .some((party) => same(party, viewer))),

  // Its own service's rating exact; another's as its own services would put
  // it, to the nearest ten. (The Intelligence tab reads how much of an
  // intercept it can make out from the two ratings, so it needs one of each.)
  intelligence: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.intelligence) ? world.intelligence : {})
    .map(([country, rating]) => [country, same(country, viewer) || !Number.isFinite(Number(rating))
      ? rating
      : Math.max(0, Math.min(100, Math.round(Number(rating) / 10) * 10))])),
  playerGoals: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.playerGoals) ? world.playerGoals : {})
    .filter(([country]) => same(country, viewer))),
  // A player's advisor and the orders they suggest (AI/seatAdvice.js): theirs alone.
  seatAdvice: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.seatAdvice) ? world.seatAdvice : {})
    .filter(([country]) => same(country, viewer))),
  // A treaty one player put to another (runtime/treatyOffers.js) is the two's own business until it is signed: then
  // it is an agreement, which everyone sees.
  treatyOffers: (world, viewer) => (Array.isArray(world.treatyOffers) ? world.treatyOffers : [])
    .filter((offer) => same(offer?.from, viewer) || same(offer?.to, viewer)),
  // Terms of peace (Game/AI/warAndPeace.js world.peaceOffers) are the business
  // of the two they pass between, as a treaty's are, until they are taken: an
  // offer open, turned down or lapsed is theirs alone, and one taken is a peace
  // everyone may know (world.peaceTreaties carries its terms too). A person's
  // terms to another person were in every player's view (the gap audit of
  // 2026-11-18, N2); the screens showed them to the two alone. Only the one an
  // offer is put to may answer it (host/gameHost.js).
  peaceOffers: (world, viewer) => list(world.peaceOffers)
    .filter((offer) => same(offer?.from, viewer) || same(offer?.to, viewer) || clean(offer?.status) === "accepted"),
  // A call to arms (runtime/alliances.js world.callsToArms) is the defender's
  // and its ally's until the ally answers it: then it has joined the war or
  // broken the treaty, which every government sees.
  callsToArms: (world, viewer) => list(world.callsToArms)
    .filter((call) => same(call?.defender, viewer) || same(call?.ally, viewer) || ["honoured", "refused"].includes(clean(call?.status))),

  // Its own government in full; every other only as the public sees it.
  politicalActors: (world, viewer) => {
    const ledger = isRecord(world.politicalActors) ? world.politicalActors : {};
    const byPolity = {};
    for (const [key, record] of Object.entries(isRecord(ledger.byPolity) ? ledger.byPolity : {})) {
      if (same(key, viewer) || same(record?.polityKey, viewer)) byPolity[key] = record;
      else {
        const view = buildPublicPoliticalView(world, key);
        if (view) byPolity[key] = view;
      }
    }
    return { ...ledger, byPolity };
  },

  // A member sees its institution's business; everyone sees what it is; and a
  // country an institution's case is about, or that opened it, sees that case
  // in full: an invited player was sent no case, so its hearing and its
  // Institutions tab offered nothing to accept.
  institutions: (world, viewer) => {
    const ledger = isRecord(world.institutions) ? world.institutions : {};
    const byId = {};
    for (const [id, institution] of Object.entries(isRecord(ledger.byId) ? ledger.byId : {})) {
      if (!isRecord(institution)) continue;
      if (isMember(institution, viewer)) {
        byId[id] = institution;
        continue;
      }
      const shown = pick(institution, PUBLIC_INSTITUTION_KEYS);
      const cases = Object.entries(isRecord(institution.lifecycleCases) ? institution.lifecycleCases : {})
        .filter(([, entry]) => isRecord(entry) && (polityMatches(entry.polity, viewer) || polityMatches(entry.initiatedBy, viewer)));
      byId[id] = cases.length ? { ...shown, lifecycleCases: Object.fromEntries(cases) } : shown;
    }
    return { ...ledger, byId };
  },
});

export const FILTERED_WORLD_KEY_NAMES = Object.freeze([...Object.keys(FILTERED_WORLD_KEYS), ...HOST_SEAT_WORLD_KEYS, "spySeal"]);

// `hiddenEventIds`: the events this viewer is not shown (eventsHiddenFrom), so
// a turn's record does not count them either.
export const projectWorld = (world, viewer, { host = "", hiddenEventIds = new Set(), readers = [viewer], actions = [], date = "" } = {}) => {
  const full = normalizeWorldState(world);
  const out = {};
  for (const key of PUBLIC_WORLD_KEYS) if (full[key] !== undefined) out[key] = full[key];
  for (const [key, filter] of Object.entries(FILTERED_WORLD_KEYS)) out[key] = filter(full, viewer, { host, hiddenEventIds, readers, actions, date });
  if (same(host, viewer)) for (const key of HOST_SEAT_WORLD_KEYS) if (full[key] !== undefined) out[key] = full[key];
  // The seal of the viewer's own agents' traffic, which its intercepts view is
  // sealed with (runtime/spySeal.js sealOf): the host's for the host, each other
  // player's its own. Never another's.
  const seal = sealOf(full, viewer, { gameCountry: host });
  if (seal) out.spySeal = seal;
  return copy(out);
};

// --- Events ---------------------------------------------------------------------

// What an event's reader learns of its effects: the map's changes, public
// changes to polities, and the forces it raised, fought or lost (units are seen).
// The rest (agents, operations, documents, governments' inner workings, other
// players' order ids, another power's march orders) stays with the host.
const PUBLIC_IMPACT_KEYS = ["regionTransfers", "regionControlOps", "regionClaims", "polityChanges", "groupOps", "markerOps"];

// Whether an event is about the viewer, by what it says it concerns, who
// fights in it and its countries (runtime/eventConcerns.js): exact names, case
// and spacing aside, for the seat and the names its government had before.
// Never its words: "Oman" was found inside "Romania", and "la Roumanie" was
// nobody's.
const concernsViewer = (event, readers) => eventNamesPolity(event, readers);

// What one government alone found out is marked for it (event.audience, set by
// runtime/spycraft.js resolveEspionage when several people play): its own
// counter-intelligence catching an agent, its own doubts about one of its
// agents. Nobody else is shown the event at all.
// `viewer` may be a list: a seat and the names its government had before it
// founded a country of its own (foundings.js formerNamesOf).
const readableBy = (event, viewer) => {
  const audience = list(event?.audience).map(clean).filter(Boolean);
  const names = Array.isArray(viewer) ? viewer : [viewer];
  return !audience.length || audience.some((polity) => names.some((name) => same(polity, name)));
};
export const eventsHiddenFrom = (events, viewer) => new Set(list(events)
  .filter((event) => isRecord(event) && !readableBy(event, viewer))
  .map((event) => clean(event.id))
  .filter(Boolean));

// `unitOwner(unitId)` names a unit's owner (from the host's world); a move is a
// march order, and only its owner reads where it is going.
export const projectEvents = (events, viewer, { ownOrderIds = new Set(), unitOwner = () => "", host = "", readers = [viewer] } = {}) => list(events).filter((event) => !isRecord(event) || readableBy(event, readers)).map((event) => {
  if (!isRecord(event)) return event;
  // The narrator's provenance, NPC-reaction bookkeeping and storyline links stay
  // with the host, and so does who else an event was for.
  const { impacts, agency: _agency, npcReaction: _npc, storylineIds: _storylines, audience: _audience, ...rest } = event;
  const own = list(impacts?.actionIds).filter((id) => ownOrderIds.has(clean(id)));
  const unitOps = list(impacts?.unitOps).filter((op) => isRecord(op)
    && (op.op !== "move" || same(unitOwner(op.unitId), viewer)));
  const projected = {};
  for (const key of PUBLIC_IMPACT_KEYS) if (Array.isArray(impacts?.[key])) projected[key] = impacts[key];
  // An opened thread is its owner's (projectChats): single player's and the
  // host's are the host seat's.
  const createdChats = same(host, viewer) ? list(impacts?.createdChats) : [];
  return {
    ...rest,
    impacts: {
      ...projected,
      actionIds: own,
      ...(unitOps.length ? { unitOps } : {}),
      ...(createdChats.length ? { createdChats } : {}),
    },
    // "Mine" is relative to the reader: its own orders, what the event says it
    // is about, and for the host's own seat the skip's own mark too.
    playerRelated: own.length > 0
      || (same(host, viewer) && event.playerRelated === true)
      || concernsViewer(event, readers),
  };
});

// --- Diplomatic threads -----------------------------------------------------------

// A thread's player is the person it belongs to: chat.player in a shared game,
// the host's seat when blank (single player's threads, and the host's own).
const threadOwner = (chat, host) => clean(chat?.player) || clean(host);
const nameOf = (entry) => clean(typeof entry === "object" && entry ? entry.name ?? entry.code : entry);

// A thread's log as one member may be shown it: everything said while it was a
// member (chatThreads.js threadAsSeenBy, kept in the log's own shape here).
const logSeenBy = (events, viewer) => {
  let inside = false;
  return list(events).filter((event) => {
    if (event?.kind === "chat_created") return true;
    if (event?.kind === "member_joined" || event?.kind === "member_left") {
      if (same(event.member?.name, viewer) || same(event.member?.code, viewer)) inside = event.kind === "member_joined";
      return true;
    }
    return inside;
  });
};

// Who is in a thread, as a member's own screen reads it. The chat panel builds
// a thread's participants from its log, with the reader as the implicit player
// (runtime/chatThreads.js projectChatThread). In the stored log that reader is
// the thread's owner: its members are everyone else. So in another member's
// copy the member's own joining is left out, and the owner joins at the start:
// a thread the United States opened with China reads, for China, as a thread
// with the United States.
const membersSeenBy = (events, viewer, owner) => {
  const ownerJoins = (created) => ({
    id: `${clean(created?.id) || "thread"}-owner`,
    kind: "member_joined",
    time: clean(created?.time),
    by: "",
    member: { code: owner, name: owner },
  });
  const out = [];
  let ownerListed = false;
  for (const event of list(events)) {
    const membership = event?.kind === "member_joined" || event?.kind === "member_left";
    if (membership && (same(event.member?.name, viewer) || same(event.member?.code, viewer))) continue;
    out.push(event);
    if (event?.kind === "chat_created" && !ownerListed) {
      ownerListed = true;
      out.push(ownerJoins(event));
    }
  }
  if (!ownerListed) out.unshift(ownerJoins(null));
  return out;
};

export const projectChats = (chats, viewer, { host = "" } = {}) => list(chats).flatMap((chat) => {
  if (!isRecord(chat)) return [];
  const owner = threadOwner(chat, host);
  const isOwner = same(owner, viewer);
  const isMemberOf = list(chat.countries).some((entry) => same(nameOf(entry), viewer));
  if (!isOwner && !isMemberOf) return [];
  // A conversation between people that was the last player's of this country,
  // retired when the seat was let go (host/foundings.js withSeatLetGo): not
  // the next player's to read.
  if (list(chat.retiredFor).some((name) => same(name, viewer))) return [];
  const { player: _player, ...rest } = chat;
  // The viewer is the implicit player of every thread it sees; whoever else is
  // in it, the thread's owner included, is listed.
  const countries = [
    ...(isOwner ? [] : [{ code: owner, name: owner }]),
    ...list(chat.countries).filter((entry) => !same(nameOf(entry), viewer)),
  ];
  // Whose words a line is, from the viewer's side: its own are the player's
  // ("user"); another person's read as that government's; an AI leader's
  // private memory of the talks is not sent at all.
  const asSeen = (line, authorOf) => {
    const { memorySummary: _memory, ...rest } = line;
    const author = authorOf(rest);
    if (same(author, viewer)) return { ...rest, role: "user" };
    if (fold(rest.role) === "user") return { ...rest, role: "leader", ...authorFields(author, rest) };
    return rest;
  };
  const log = Array.isArray(chat.events)
    ? (isOwner ? chat.events : membersSeenBy(logSeenBy(chat.events, viewer), viewer, owner))
    : null;
  // The thread's lines, beside its log: one the log holds is shown only where
  // the viewer's part of the log holds it; one written beside the log was said
  // just now, to everyone in the thread.
  const messageIds = (events) => new Set(list(events).filter((event) => event?.kind === "message").map((event) => clean(event.id)));
  const logged = messageIds(chat.events);
  const heard = messageIds(log);
  const messages = list(chat.messages)
    .filter((message) => !isRecord(message) || !logged.has(clean(message.id)) || heard.has(clean(message.id)))
    .map((message) => (isRecord(message)
      ? asSeen(message, (line) => clean(line.speaker || line.code) || (fold(line.role) === "user" ? owner : ""))
      : message));
  // The votes and demands kept beside a log are read from the whole of it; the
  // viewer's screen reads its own from the part it is sent.
  if (log && !isOwner) {
    delete rest.polls;
    delete rest.demands;
  }
  return [{
    ...rest,
    countries,
    messages,
    ...(log ? {
      events: log.map((event) => (isRecord(event) && event.kind === "message"
        ? asSeen(event, (line) => clean(line.by || line.code) || (fold(line.role) === "user" ? owner : ""))
        : event)),
    } : {}),
  }];
});

// A message names its author as speaker/code; a logged one as by/code.
const authorFields = (author, line) => ("by" in line || "kind" in line
  ? { by: author, code: author }
  : { speaker: author, code: author });

// --- The rest -------------------------------------------------------------------

export const projectActions = (actions, viewer, { host = "" } = {}) => list(actions).filter((action) =>
  (clean(action?.ownerCode) ? same(action.ownerCode, viewer) : same(host, viewer)));

// Every document of one player's view, in the single-player shape.
export const projectForViewer = ({ world, game, events, chat, actions, intercepts, colors, flags } = {}, viewer) => {
  const host = clean(game?.country);
  const seat = clean(viewer);
  if (!seat) throw new TypeError("projectForViewer needs the viewer's polity.");
  const ownActions = projectActions(actions, seat, { host });
  const ownOrderIds = new Set(ownActions.map((action) => clean(action?.id)).filter(Boolean));
  const owners = new Map(list(world?.units).map((unit) => [clean(unit?.id), clean(unit?.ownerCode)]));
  const readers = formerNamesOf(game, seat);
  const seenEvents = projectEvents(events, seat, { ownOrderIds, host, readers, unitOwner: (id) => owners.get(clean(id)) || "" });
  const shown = new Set(list(seenEvents).map((event) => clean(event?.id)));
  return {
    world: projectWorld(world ?? {}, seat, { host, readers, hiddenEventIds: eventsHiddenFrom(events, readers), actions, date: clean(game?.gameDate) }),
    game: copy({ ...(isRecord(game) ? game : {}), country: seat }),
    events: copy(seenEvents),
    // Their advisor's conversation, with the secrets their government keeps
    // (advisorDesk.js): made for this view, never stored.
    chat: copy([...projectChats(chat, seat, { host }), ...[advisorThreadFor({ world, events }, seat, { readers, shown })].filter(Boolean)]),
    actions: copy(ownActions),
    // The viewer's own agents' traffic, its own table of the file
    // (runtime/spycraft.js interceptTableOf): never another player's.
    intercepts: copy(interceptTableOf(isRecord(intercepts) ? intercepts : {}, seat, { gameCountry: host })),
    colors: copy(isRecord(colors) ? colors : {}),
    flags: copy(isRecord(flags) ? flags : {}),
  };
};
