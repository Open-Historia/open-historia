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
// - Another country's stat sheet is sent without its intelligence index and its
//   scenario-defined custom stats (which may be military; the host cannot yet
//   mark them public), and without its history.
// - Agreements carry no secrecy flag yet, so every treaty is public.
// - Scenes, suggestions and intercepts are single-player features still keyed to
//   the host's seat; other seats get none of them.

import { normalizeWorldState } from "../../runtime/gameState.js";
import { normalizeReports } from "../../runtime/reports.js";
import { visiblePuppetsFor } from "../../runtime/puppets.js";
import { buildPublicPoliticalView } from "../../runtime/politicalKnowledge.js";
import { polityMatches, spyAsSeenBy, viewerAudience } from "../../Game/AI/audience.js";

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
  "allowedUnitTypes", "author", "background", "basemap", "cityPopulations", "cityRenames",
  "countryTags", "customCities", "customRegions", "difficulty", "diplomaticLedgerVersion",
  "groupAreas", "groups", "internationalReputation", "labelFont", "labelHaloColor",
  "labelTextColor", "language", "lastJumpMode", "lastJumpTargetDate", "mapCredit", "markers",
  "ownerCodes", "ownerSchema", "polityOverrides", "powerStatus", "regionClaimants",
  "regionOwnershipOverrides", "regionSovereigntyOverrides", "settledRegionClaims",
  "simulationRules", "startingTimelineText", "unitSystem", "wars", "agreements",
]);

// The narrator's and the engine's own. Never in any view.
export const HOST_ONLY_WORLD_KEYS = Object.freeze([
  "boardReviewedRound", "chargedRefusals", "chatKnowledgeCursors", "consolidatedHistory",
  "gmAudit", "gmChanges", "historyDocument", "idlePulseTick", "lastJumpSummary", "notes",
  "pendingEventOutreach", "politicalSimulation", "simulationHistory", "simulationReminders",
  "storylines",
]);

// The host seat's single-player features (a scene in progress, its suggestions,
// the key its own intercepts are sealed with): its own view only.
const HOST_SEAT_WORLD_KEYS = Object.freeze([
  "activeInteractive", "actionSuggestions", "interactiveOffer", "lastInteractiveOfferRound", "spySeal",
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

// Filtered keys: each is given the whole world and returns what the viewer may
// have of that key.
const FILTERED_WORLD_KEYS = Object.freeze({
  // Units are seen, their orders are not.
  units: (world, viewer) => list(world.units).map((unit) => (same(unit?.ownerCode, viewer)
    ? unit
    : { ...unit, orderId: "" })),
  pendingUnitOrders: (world, viewer) => list(world.pendingUnitOrders).filter((order) => ownsUnit(world, order?.unitId, viewer)),

  // An agent is known to its owner (who never learns it was turned) and to the
  // country that caught it; to nobody else.
  spies: (world, viewer) => {
    const audience = viewerAudience([viewer]);
    return list(world.spies).map((spy) => spyAsSeenBy(audience, spy)).filter(Boolean);
  },

  // A government's projects are its own business.
  projects: (world, viewer, { host }) => list(world.projects).filter((project) => (clean(project?.ownerCode)
    ? same(project.ownerCode, viewer)
    : same(host, viewer))),

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
  reports: (world, viewer) => normalizeReports(world.reports)
    .filter((report) => report.visibleTo === null
      || list(report.visibleTo).some((entry) => same(entry, viewer))
      || list(report.interceptedBy).some((entry) => same(entry, viewer)))
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

  // Its own sheet whole; another's without what its services would guard.
  countryStats: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.countryStats) ? world.countryStats : {})
    .map(([country, sheet]) => {
      if (same(country, viewer) || !isRecord(sheet)) return [country, sheet];
      const { customStats: _custom, indices, ...rest } = sheet;
      if (!isRecord(indices)) return [country, rest];
      const { intelligenceService: _intel, ...publicIndices } = indices;
      return [country, { ...rest, indices: publicIndices }];
    })),
  countryStatsHistory: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.countryStatsHistory) ? world.countryStatsHistory : {})
    .filter(([country]) => same(country, viewer))),
  intelligence: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.intelligence) ? world.intelligence : {})
    .filter(([country]) => same(country, viewer))),
  playerGoals: (world, viewer) => Object.fromEntries(Object.entries(isRecord(world.playerGoals) ? world.playerGoals : {})
    .filter(([country]) => same(country, viewer))),

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

  // A member sees its institution's business; everyone sees what it is.
  institutions: (world, viewer) => {
    const ledger = isRecord(world.institutions) ? world.institutions : {};
    const byId = {};
    for (const [id, institution] of Object.entries(isRecord(ledger.byId) ? ledger.byId : {})) {
      if (!isRecord(institution)) continue;
      byId[id] = isMember(institution, viewer) ? institution : pick(institution, PUBLIC_INSTITUTION_KEYS);
    }
    return { ...ledger, byId };
  },
});

export const FILTERED_WORLD_KEY_NAMES = Object.freeze([...Object.keys(FILTERED_WORLD_KEYS), ...HOST_SEAT_WORLD_KEYS]);

export const projectWorld = (world, viewer, { host = "" } = {}) => {
  const full = normalizeWorldState(world);
  const out = {};
  for (const key of PUBLIC_WORLD_KEYS) if (full[key] !== undefined) out[key] = full[key];
  for (const [key, filter] of Object.entries(FILTERED_WORLD_KEYS)) out[key] = filter(full, viewer, { host });
  if (same(host, viewer)) for (const key of HOST_SEAT_WORLD_KEYS) if (full[key] !== undefined) out[key] = full[key];
  return copy(out);
};

// --- Events ---------------------------------------------------------------------

// What an event's reader learns of its effects: the map's changes, public
// changes to polities, and the forces it raised, fought or lost (units are seen).
// The rest (agents, operations, documents, governments' inner workings, other
// players' order ids, another power's march orders) stays with the host.
const PUBLIC_IMPACT_KEYS = ["regionTransfers", "regionControlOps", "regionClaims", "polityChanges", "groupOps", "markerOps"];

const mentions = (event, viewer) => {
  const name = fold(viewer);
  if (!name) return false;
  const text = fold(`${event?.title ?? ""} ${event?.description ?? ""}`);
  return text.includes(name) || list(event?.combatants).some((entry) => same(entry, viewer));
};

// `unitOwner(unitId)` names a unit's owner (from the host's world); a move is a
// march order, and only its owner reads where it is going.
export const projectEvents = (events, viewer, { ownOrderIds = new Set(), unitOwner = () => "", host = "" } = {}) => list(events).map((event) => {
  if (!isRecord(event)) return event;
  // The narrator's provenance, NPC-reaction bookkeeping and storyline links stay
  // with the host.
  const { impacts, agency: _agency, npcReaction: _npc, storylineIds: _storylines, ...rest } = event;
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
    // "Mine" is relative to the reader.
    playerRelated: own.length > 0 || mentions(event, viewer),
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

export const projectChats = (chats, viewer, { host = "" } = {}) => list(chats).flatMap((chat) => {
  if (!isRecord(chat)) return [];
  const owner = threadOwner(chat, host);
  const isOwner = same(owner, viewer);
  const isMemberOf = list(chat.countries).some((entry) => same(nameOf(entry), viewer));
  if (!isOwner && !isMemberOf) return [];
  const { player: _player, ...rest } = chat;
  // The viewer is the implicit player of every thread it sees; whoever else is
  // in it, the thread's owner included, is listed.
  const countries = [
    ...(isOwner ? [] : [{ code: owner, name: owner }]),
    ...list(chat.countries).filter((entry) => !same(nameOf(entry), viewer)),
  ];
  const messages = list(chat.messages).map((message) => {
    if (!isRecord(message)) return message;
    const { memorySummary: _memory, ...line } = message;
    const author = clean(line.speaker || line.code) || (fold(line.role) === "user" ? owner : "");
    if (same(author, viewer)) return { ...line, role: "user" };
    if (fold(line.role) === "user") return { ...line, role: "leader", speaker: author, code: author };
    return line;
  });
  return [{
    ...rest,
    countries,
    messages,
    ...(Array.isArray(chat.events) ? { events: isOwner ? chat.events : logSeenBy(chat.events, viewer) } : {}),
  }];
});

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
  return {
    world: projectWorld(world ?? {}, seat, { host }),
    game: copy({ ...(isRecord(game) ? game : {}), country: seat }),
    events: copy(projectEvents(events, seat, { ownOrderIds, host, unitOwner: (id) => owners.get(clean(id)) || "" })),
    chat: copy(projectChats(chat, seat, { host })),
    actions: copy(ownActions),
    intercepts: same(host, seat) && isRecord(intercepts) ? copy(intercepts) : {},
    colors: copy(isRecord(colors) ? colors : {}),
    flags: copy(isRecord(flags) ? flags : {}),
  };
};
