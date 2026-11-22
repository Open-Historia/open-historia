/*! Open Historia — portions (troop deployments + era troop types) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { normalizePromptReference, normalizePromptSnapshot } from "./promptSnapshot.js";
import { normalizeCanonFacts, normalizeHistoryEras, normalizeHistoryYears } from "./historyTiers.js";
import { JSON_URLS, getPrimedScenarioRegionCatalog, loadTurnRestorePoint, primeJson, publishJsonWriteBatch, readJson, reportPerfOperation, writeJson } from "./assets.js";
import { withMapClaims } from "./mapClaims.js";
import { populationFigureOf } from "./populationFigure.js";
import { normalizeNaviesRaised, normalizeSeaBattles } from "./naval/record.js";
import { normalizeBlockades } from "./naval/blockade.js";
import { normalizeCallsToArms } from "./alliances.js";
import { normalizePeaceOffers, normalizePeaceTreaties, normalizeReparations } from "./peaceTerms.js";
import { normalizeTreatyOffers } from "./treatyOffers.js";
import { normalizeWarWeariness } from "./warWeariness.js";
import { MAX_WAR_SIDE_MEMBERS, normalizeWarRecord, normalizeWarRecords, referencedWarIds } from "./warRecord.js";
import { normalizeWarResources } from "./warResources.js";
import { normalizeAttrition } from "./attrition.js";
import { eraSettingOf, normalizeWarSettings } from "./warSettings.js";
import { UNIT_TYPES, findUnitType, mayFieldUnitType, normalizeUnitTypes, unitFigures, unitTypeRef, withUnitTypesApplied } from "./unitTypes.js";
import { AIR_ROLES as UNIT_AIR_ROLES, OPERATION_APPROACHES } from "./fronts/constants.js";
import { normalizeClimateZones, normalizeFortifications, normalizeFreezingRegions, normalizeTerrainAreas, normalizeZoneWeather } from "./warGeography.js";
import { normalizeMilitaryShift, normalizeMilitaryStats, shiftedMilitary } from "./militaryStats.js";
import { MAX_GROUPS, applyGroupOps, canRenameGroup, findGroupKey, normalizeGroupAreas, normalizeGroupOp, normalizeGroups } from "./groups.js";
import { GROUP_DEAL_TYPES, groupPartyKey } from "./groupParties.js";
import { normalizeAgreementEffects } from "./agreementEffects.js";
import { enqueueEventStrings } from "./translator.js";
import { normalizeTagList } from "./countryTags.js";
import { MAX_PUPPETS as MAX_WORLD_PUPPETS, PUPPET_KINDS, PUPPET_SECRECY_LEVELS, PUPPET_STATUSES } from "./puppets.js";
import { displayNameMigrations, renamePolityInColors, renamePolityInWorld, samePolityName } from "../../server/polityRename.js";
import { nameId } from "../../server/nameId.js";
import { nameKey } from "../../server/nameKey.js";
import { renameInBattlefields, renameInTransports } from "../../server/battlefieldNames.js";
import { canPlayerDirect } from "./projects.js";
import {
  ADJUSTMENTS_KEPT,
  ENGINE_STATUSES,
  FUNDING_FROM_PRIORITY,
  OPEN_ENGINE_STATUSES,
  OVERRUN_TOTAL_MOST,
  RELATION_BOUNDS,
  STALL_REASONS,
  boundPlanForOwner,
  boundStatChange,
  isBelief,
  legacyPlanFor,
  mergeTickedBoard,
  normalizeAdjustment,
  normalizeProjectPlan,
  projectFundingMode,
  resolveFunding,
  roundProgress,
  sheetOf,
  statMeasure,
  statValueOf,
  tickProjects,
} from "./projectEngine.js";
import { dedupeEventLog, eventCanonicalKey } from "./eventDedup.js";
import { normalizeEventTags } from "./eventTags.js";
import { normalizeEventPlaces } from "./eventPlaces.js";
import { normalizeMarkerFamily } from "./markerFamily.js";
import { normalizeEventConcerns } from "./eventConcerns.js";
import { normalizeEventPresentation } from "./eventQuote.js";
import { normalizeEventAgency } from "./eventAgency.js";
import { storylineKindOf } from "./storylineKinds.js";
import { buildOwnerAliasMap, createOwnerResolver, isRealCountryName, toCountryName } from "./ownerNames.js";
import { foundPolityIfUnknown } from "./polityFounding.js";
import { normalizeTerritoryBasis, screenTerritoryBasis } from "./territoryBasis.js";
import { normalizeApplicationReceipt } from "./applicationReceipt.js";
import { hasMalformedRelationSummary } from "./relationSummary.js";
import { normalizeFiledEvents } from "./filedEvents.js";
import { applyReportOps, normalizeReportOp, normalizeReports } from "./reports.js";
import { normalizeGmChanges, normalizeReminders } from "./gmChanges.js";
import { normalizePlayerGoals } from "./playerGoal.js";
import { normalizeInteractiveOffer } from "./interactiveOffer.js";
import { normalizeSpyOp, spyTasking } from "./spycraft.js";
import { eventsFromLegacyChat, normalizeChatEvents, projectChatThread, withUnloggedMessages } from "./chatThreads.js";
import { latestTurnEventIds, unseenEvents, withoutUnseenChats, withoutUnseenEvents, withoutUnseenReports } from "./unseenEvents.js";
import { COUNTRY_STATS_EVENT_RESCALE_LIMIT, mergeCountryStatPatch, normalizeCountryStatSheet } from "./countryStats.js";
import { advanceCountryStatsInterval } from "./countryStatsProgression.js";
import {
  canonicalInstitutionIdentity,
  institutionChannelParticipants,
  normalizeInstitutions,
  removePolityFromInstitutions,
} from "./institutions.js";
import { normalizePowerStatus } from "./powerStatus.js";
import { markerOpKind } from "./markerOps.js";
import { normalizeInstitutionLifecycleImpactOp } from "./institutionLifecycleCore.js";
import {
  buildPoliticalActorLegacyStatsProjection,
  getPoliticalProfileKey,
  normalizePoliticalActors,
  POLITICAL_ACTORS_SCHEMA_VERSION,
} from "./politicalActors.js";
import { normalizeSocialFeed } from "./socialFeed.js";
import { applyPoliticalActorOperation } from "./politicalActorOps.js";
import { normalizePoliticalSimulationClock } from "./politicalClock.js";
import { buildPolityIdentityIndex, resolvePolityIdentity } from "./polityIdentity.js";
import {
  DEFAULT_PATROL_RADIUS_KM,
  daysBetweenDates,
  haversineKm,
  kmOnMap,
  maxTravelKm,
  patrolPoint,
  stepToward,
  wrapLng,
} from "./unitMotion.js";
import { noteMapMeasure } from "./mapMeasure.js";
import { compareGameDates, diffGameDays, normalizeGameDate } from "./gameDates.js";
import { normalizeBattlefields, withWarIdFrontsRenamed } from "./fronts/record.js";
import { normalizeTransports } from "./fronts/transports.js";
import { normalizeStrikes } from "./strikes.js";
import { normalizeAirStrikeOrders, normalizeAirStrikes } from "./fronts/airStrike.js";
import { battlefieldHeldClaimants } from "./fronts/heldRegions.js";
import { sharedGameHostCountry } from "./humanPolities.js";
import { foldPoliticsIntoActors } from "./politicalLandscapeFold.js";
import { activeWars } from "./gameFeatures.js";

export const GAME_DEFAULTS = {
  country: "",
  difficulty: "standard",
  gameDate: "",
  language: "English",
  round: 1,
  startDate: "",
};

export const WORLD_DEFAULTS = {
  actionSuggestions: [],
  // The interactive event being played, a scene of beats (AI/interactiveRewind.js).
  activeInteractive: null,
  // The event the last time skip offered to be played out as an interactive
  // event, { eventId, round }, until it is taken up, let pass or replaced by the
  // next skip's; and the round of the last offer made, which keeps offers rare
  // (interactiveOffer.js).
  interactiveOffer: null,
  lastInteractiveOfferRound: 0,
  consolidatedHistory: [],
  // The living history document the AI is shown in place of the folded events
  // (AI/historyConsolidation.js); null until the first consolidation pass.
  historyDocument: null,
  // The facts of the campaign that never fade: treaties, deaths, regime and
  // border changes, office holders, each dated (runtime/historyTiers.js).
  canonFacts: [],
  // What the last time skip's prompt read, and the polity lore its cached
  // opening carries (runtime/promptSnapshot.js); null until a skip writes them.
  promptSnapshot: null,
  promptReference: null,
  // Per-polity international reputation (0-100), evolved by the AI each turn via
  // polityChanges and fed back into prompts. Authoritative, unlike the on-demand
  // stat sheet it was first read from.
  internationalReputation: {},
  // Per-polity intelligence service (0-100), the same shape and lifecycle as
  // reputation: moved by the AI through polityChanges.intelligence, absent means
  // ordinary (see spycraft.js DEFAULT_INTELLIGENCE). It decides how much of an
  // intercepted exchange the player can read — and how much of the player's own
  // traffic a rival can.
  intelligence: {},
  // Every spy in the world, both directions: [{ id, owner, target, deployedAt,
  // status, turnedAt, exposedAt, coverStory, suspected }] — see spycraft.js for
  // the statuses. What the player's spies bring back lives in the intercepts
  // asset, sealed under spySeal (see readInterceptsState, spySeal.js).
  spies: [],
  // Random per-game key the intercepts are sealed with. Minted the first time a
  // spy exists; 64 hex chars.
  spySeal: "",
  // Bounded audit trail of applied GM Console transactions. Administrative
  // history, not a second world model: canonical state stays in the ledgers
  // below; the record keeps the exact previewed transaction for debugging.
  gmAudit: [],
  // Every change made outside the simulation — the GM console and each cheats
  // tool — one line each, tagged with its round, newest first; the next skip is
  // told the ones from the round it starts in. And the Game Master's standing
  // reminders, which every AI in the game is shown. See gmChanges.js.
  gmChanges: [],
  simulationReminders: [],
  // What each player's government is steering toward, set in the Actions panel:
  // polity name -> { text, round, date }. Told to the advisor, the time skip and
  // the suggestions, never to a foreign leader. See playerGoal.js.
  playerGoals: {},
  // Persisted per-country stat sheets (code -> the full sheet), seeded on first view
  // and thereafter changed ONLY by the AI (polityChanges.stats), so a country's stats
  // stop regenerating/drifting every date change.
  countryStats: {},
  // Continuum canonical political substrate. These are native world-state ledgers,
  // not editable Stats aliases: UI/AI consumers project from them through bounded
  // political knowledge/context seams.
  politicalActors: { schemaVersion: POLITICAL_ACTORS_SCHEMA_VERSION, byPolity: {} },
  politicalSimulation: normalizePoliticalSimulationClock({}),
  institutions: { schemaVersion: 1, ledgerVersion: 0, byId: {} },
  powerStatus: { schemaVersion: 1, byPolity: {} },
  // Per-country tags the AI has changed: owner code -> string[]. The scenario's
  // tags.json holds the map-maker's STARTING tags; this holds every change since,
  // and wins where present (see resolveCountryTags).
  countryTags: {},
  // AI renames of STOCK map cities (which live in PMTiles, not world.markers):
  // lowercased original city name -> new display name. world.markers cities are
  // renamed in place by applyMarkerOps; this is the override layer for the rest.
  cityRenames: {},
  // AI renames of map regions/provinces (stock regions live in PMTiles level 1):
  // lowercased original region name or GADM id -> new display name.
  regionRenames: {},
  // AI changes to a city's POPULATION, same override shape as cityRenames and for
  // the same reason: stock cities live in PMTiles and cannot be edited in place.
  // Lowercased original city name -> number. Applies to authored cities too, so a
  // siege or a boom moves one number wherever the city came from.
  cityPopulations: {},
  // Country-label styling, set in the scenario settings. Empty = the defaults
  // (Georgia, white letters, half-black outline). The font renders from the
  // PLAYER's local fonts — the style has no glyphs endpoint, so MapLibre v5
  // rasterizes every glyph client-side using the stack as a CSS font-family.
  labelFont: "",
  labelHaloColor: "",
  labelTextColor: "",
  language: "English",
  lastJumpMode: "",
  lastJumpSummary: "",
  lastJumpTargetDate: "",
  // Structures built during play (world.markers[]): free-form kinds — a city, a
  // military base, a bunker, a missile silo, an embassy — placed at coordinates
  // and rendered as map markers beside the stock cities. Stored here so they
  // share every existing read/write/poll/normalize path, exactly like units.
  markers: [],
  // Documents held by the governments they were addressed to (runtime/reports.js):
  // a secret pact, a letter, an intelligence assessment. Written by events
  // (impacts.reports); read by an audience through visibleTo. Listed in the
  // normalizeWorldState return too, for the reason given elsewhere here.
  reports: [],
  // How far each polity has been shown of each OTHER thread it is party to
  // (AI/crossChatKnowledge.js): "<threadId>|<polity>" -> the last message id it
  // was shown. Keeps a leader from being handed the same exchange twice, and a
  // long campaign from growing the chat prompt without bound.
  chatKnowledgeCursors: {},
  // Refusals of an Overlord's demand the engine has already charged, by the id of
  // the message that carried them (chargeRefusals). It lives HERE, and not as a
  // stamp on the message, because of who writes what: every writer of the world
  // re-reads it at write time, while chats are written from whatever copy each
  // panel happens to hold — so a stamp on a message was erased by the next save
  // from a stale panel, and the refusal charged again on every jump after.
  // Written only by the turn, so it rides the turn's restore point like the
  // puppet ledger it pays into. Never sent to a model.
  chargedRefusals: [],
  // Real-time grace-period queue for optional Event Editor -> NPC diplomatic
  // reactions. Pending evaluations only, never chats: the conversation itself
  // is created later through the normal chat merge seam.
  pendingEventOutreach: [],
  // Bumped by every idle world pulse (see gameplay.js). It is the third component
  // of a patrolling unit's position seed, which is what lets a fleet on station
  // visibly reposition between pulses even though no game time has passed. Listed
  // in the normalizeWorldState return too — this spread is overwritten by the
  // incoming world, so a field declared only here never survives a round trip.
  idlePulseTick: 0,
  // Standing multi-turn orders the ENGINE advances: {id, unitId, kind, toLng,
  // toLat, radiusKm, untilRound, targetId, targetLabel, note, issuedAt,
  // issuedRound}. kind is "move" (travel to a destination) or "patrol" (work a
  // station centred on it). Independent of the actions queue (which a jump's
  // single clearActions flag wipes wholesale), so a unit ordered across an ocean
  // keeps advancing every turn until it arrives — see advanceStandingOrders and
  // pruneSatisfiedUnitOrders below.
  pendingUnitOrders: [],
  polityOverrides: {},
  // Long-running efforts the player is pursuing or has learned of: research
  // programmes, construction projects, military and political operations. Only
  // the AI writes these -- events via impacts.projectOps, the advisor via its
  // ```projects block -- because a hand-editable board would drift out of step
  // with the narrative that is supposed to be driving it. Listed in the
  // normalizeWorldState return too: this spread is overwritten by the incoming
  // world, so a field declared only here never survives a round trip.
  projects: [],
  // Region id -> claimant polity names: the world-data way to mark a region
  // DISPUTED (striped in the administrator's + claimants' colors). Same effect
  // as a claimants list on the region's geojson feature, but declarable by a
  // scenario whose geometry ships as an immutable seed (the modern world), and
  // overridable per-world without touching geometry. Wins over feature props.
  regionClaimants: {},
  // Region ids whose dispute the world has ended — renounced, cleared, handed
  // over cleanly. The claimant list stays sparse (no row once a region is
  // undisputed), so without this the map could not tell a dispute that ended
  // from one never recorded, and drew the claimants the region's geojson feature
  // bakes in again. A region disputed anew leaves the list. See
  // settleRegionClaims.
  settledRegionClaims: [],
  // Groups: actors that are not countries — a terrorist organisation, a cartel,
  // a zombie outbreak — keyed by exact name, each with a description (what the
  // AI is told it is) and a colour (runtime/groups.js). A group owns no land;
  // groupAreas says which regions it CONTROLS (region id -> group name, one
  // group per region), drawn outlined and tinted over the countries' colours.
  groups: {},
  groupAreas: {},
  regionOwnershipOverrides: {},
  // Legal sovereignty where it differs from the polity administering a region
  // (an occupation). Sparse: normal territory has no row. Written by legal
  // regionTransfers and by de-facto regionControlOps, which anchor the lawful
  // sovereign before control flips.
  regionSovereigntyOverrides: {},
  // Canonical diplomacy and belligerency, owned by the engine (see
  // AI/nativeDiplomaticDirector.js and AI/nativeWarLedger.js). Relations say
  // how warm a pair of polities is; agreements are the formal instruments in
  // force between them; wars say who is mechanically at war with whom - the
  // ONLY thing that licenses a battle event. The model changes them through the
  // compact warUpdates / relationUpdates / agreementUpdates lines on a jump
  // payload, never by writing them. Listed in the normalizeWorldState return
  // too, for the usual reason.
  relations: [],
  agreements: [],
  // Set when the pregame bootstrap has written the two ledgers for a fresh
  // game. A save from before the ledgers keeps 0, and keeps what its records
  // hold: nothing is seeded into them from its old events or chats.
  diplomaticLedgerVersion: 0,
  wars: [],
  // Where land wars are fought: two sides, the troops each has there, and the
  // front line between what each holds (runtime/fronts/record.js). Written by
  // the front engine and by nothing else.
  battlefields: [],
  // The transporters carrying troops to where their side holds no land
  // (fronts/transports.js): ordered, under way, and those that ended last turn.
  transports: [],
  // The missiles and bombing runs the last turns' events told of, for the map
  // to play (strikes.js). They change nothing by themselves.
  strikes: [],
  // The air strikes the war room ordered, waiting for time to pass, and those
  // of the last turns as they went (fronts/airStrike.js).
  airStrikeOrders: [],
  airStrikes: [],
  // The battles the last turns' fleets fought (naval/record.js), for the map to
  // mark. What a battle did to the fleets is on the fleets.
  seaBattles: [],
  // When each country was last given a navy by the game, or lost the last of
  // one (naval/record.js): a navy sunk is not handed back the turn after.
  naviesRaised: [],
  // The blockades that stand (naval/blockade.js): how hard each presses on its
  // country and how many days it has stood. Written by the war at sea; the
  // land war and the economy read them.
  blockades: [],
  // How weary of war each country is, 0 to 100 (warWeariness.js): the game's
  // own figure, moved every turn by what the turn did to it.
  warWeariness: [],
  // What each country has left to fight with, 0 to 100 (warResources.js): spent
  // by advancing and building fortified lines, refilled by its funding.
  warResources: [],
  // What the weather and being cut off have cost each country at war (attrition.js).
  attrition: [],
  // How the scenario's wars are fought (warSettings.js): null where it says nothing.
  warSettings: null,
  // The scenario's own unit types (unitTypes.js): a dragon is an air unit that hits harder and lasts longer.
  unitTypes: [],
  // What the scenario draws on its map for war (warGeography.js): ground harder
  // to cross, walls that must be broken through, its own climates, and the
  // water that freezes in winter.
  terrainAreas: [],
  fortifications: [],
  climateZones: [],
  freezingRegions: [],
  // The water frozen as the last turn left it (runtime/fronts/climate.js): for the map to show as ice.
  frozenRegions: [],
  // Each climate zone's weather as the last turn left it (runtime/zoneWeather.js): the map's patches of weather.
  zoneWeather: null,
  // Peace (peaceTerms.js): the offers that wait for an answer or were given
  // one, the reparations being paid, and the last peaces made on terms.
  peaceOffers: [],
  reparations: [],
  peaceTreaties: [],
  // Treaties one country a person plays put to another (treatyOffers.js), waiting to be signed or answered; one
  // signed is an agreement of world.agreements.
  treatyOffers: [],
  // Alliances coming due (alliances.js): who was called on to defend whom in
  // which war, and what they answered.
  callsToArms: [],
  // Subordinations: who directs whom. Directional, partly secret, and written
  // only through the diplomatic director's compact puppetUpdates lines — see
  // docs/adr/0004-puppet-ledger-and-secrecy.md.
  puppets: [],
  // Persistent storylines: the hidden state of the world's ongoing processes
  // (AI/nativeWorldDirector.js), advanced by compact storylineUpdates lines on
  // a jump payload exactly like the ledgers above.
  storylines: [],
  // Rostra, the social network (socialFeed.js): every post kept, oldest first.
  // Written by the player and by the time skip; public in a shared game.
  socialFeed: [],
  simulationHistory: [],
  simulationRules: "",
  startingTimelineText: "",
  units: [],
};

// Military units that ride along inside world state (world.units[]). Stored here
// so they share every existing read/write/poll/normalize path with no server change.
// (The kinds of unit are unitTypes.js's, beside the unit types a scenario names of its own.)
export { UNIT_TYPES };
const UNIT_TYPE_SET = new Set(UNIT_TYPES);
// "pending" = a player deployment awaiting AI resolution (rendered translucent).
export const UNIT_STATUSES = ["idle", "moving", "engaged", "defeated", "pending"];
const UNIT_STATUS_SET = new Set(UNIT_STATUSES);
const UNIT_SOURCE_SET = new Set(["player", "ai", "scenario"]);
// What a formation is DOING, as distinct from `status`, which is its lifecycle.
// Posture is what makes the map readable at a glance — "massing" on a border and
// "exercise" on the same border are the same counter and a completely different
// message. Deliberately NOT "garrison": that would collide with the unit TYPE of
// the same name and make `posture === "garrison"` checks ambiguous.
export const UNIT_POSTURES = [
  "holding",
  "massing",
  "patrol",
  "transit",
  "exercise",
  "blockade",
  "withdrawing",
  // The one posture that also moves the lifecycle: a formation arriving under
  // "assaulting" is stamped status "engaged" rather than "idle" (applyUnitOpBatch).
  // It exists so the BETA system can express a province assault at all. Classic
  // players get there through the Attack button, which does the same bookkeeping
  // locally; beta has no such button by design ("intent, not control"), so a typed
  // order like "Attack Provence" has to be something the MODEL can enact — and
  // without this it could only ever hand back a unit reading "idle" on the
  // objective it had just stormed.
  "assaulting",
];
const UNIT_POSTURE_SET = new Set(UNIT_POSTURES);

// Units the map may hold for A.I. polities. The player's own forces are exempt
// from both caps and are filtered out before counting (see enforceUnitVolume) —
// they can disband their own, so neither cap should apply to them nor should
// their units eat another power's headroom.
export const MAX_UNITS_GLOBAL = 80;
export const MAX_UNITS_PER_POLITY = 12;

// Every caller of this parses a COORDINATE (lng/lat/toLng/toLat), which is why it
// can afford to be lenient in ways a general number parser could not.
//
// It used to be a bare Number(), and a model writing in a language that uses the
// decimal COMMA answers "37,06" — Number() returns NaN, the unit is discarded, and
// the player sees an event describing a deployment with no troops on the map. The
// same went for a coordinate carrying its unit ("37.06°N"). Recover both instead of
// throwing the deployment away.
//
// A comma is only read as a decimal point when it is the ONLY separator: "1,234.5"
// keeps its usual meaning, so a thousands separator can never silently divide a
// value by a thousand.
//
// Nothing that is not a number or a string is one: Number(null) is 0, and a
// coordinate a save kept as null (JSON writes NaN so) read as 0 sent a standing
// order to lng 0, lat 0, where the unit flew or sailed, on the equator in the
// middle of the ocean ("i had an airplane squadron and i tasked them to bomb the
// enemy but they spawned on the equator in the middle of the ocean", a player's
// report, 2026-11-09).
const finiteOrNull = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  let text = value.trim();
  if (!text) return null;

  // A trailing or leading hemisphere letter carries the sign: 37.06 S is -37.06.
  let sign = 1;
  const hemisphere = /^([NSEW])\s*|\s*([NSEW])$/i.exec(text);
  if (hemisphere) {
    const letter = (hemisphere[1] || hemisphere[2]).toUpperCase();
    if (letter === "S" || letter === "W") sign = -1;
    text = text.replace(/^[NSEW]\s*/i, "").replace(/\s*[NSEW]$/i, "");
  }

  if (text.includes(",") && !text.includes(".")) text = text.replace(",", ".");
  // Degree signs, stray spaces, anything else that is not part of a number.
  text = text.replace(/[^\d+\-.eE]/g, "");
  if (!text || !/\d/.test(text)) return null;

  const num = Number(text);
  return Number.isFinite(num) ? sign * num : null;
};

// Strength is a PERCENTAGE of the formation's established strength, 0-100.
//
// It used to be an abstract 1-1000 the model picked freely, which is exactly why
// it read as random: nothing anchored it, so "340" meant whatever the model felt
// that turn. As a percentage it has a fixed referent — 78 means three quarters of
// what this formation should have — and `composition` carries what it actually is
// ("1 aircraft carrier, 2 frigates"). Attrition finally means something.
//
// Saves on the old scale are coerced rather than migrated: anything over 100 is
// divided by 10. The old default of 100 lands on 100%, which is the correct
// reading of a freshly-raised unit anyway.
export const clampUnitStrength = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  const percent = num > 100 ? num / 10 : num;
  return Math.max(0, Math.min(100, Math.round(percent)));
};

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => String(value ?? "").trim();

const normalizeOptionalString = (value) => {
  const nextValue = normalizeString(value);
  return nextValue || "";
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

// Canonical ledger vocabularies (AI/nativeWarLedger.js, AI/nativeDiplomaticDirector.js).
const WORLD_RELATION_STATUS_SET = new Set(["friendly", "cordial", "neutral", "cautious", "strained", "hostile", "rival"]);
// With the deals that fit a group (runtime/groupParties.js): a party may be a group.
const WORLD_AGREEMENT_TYPE_SET = new Set(["alliance", "mutual_defense", "guarantee", "non_aggression", "friendship_consultation", "trade_economic", "military_cooperation", "military_access", "neutrality", "peace_settlement", "other", ...GROUP_DEAL_TYPES]);
const WORLD_AGREEMENT_STATUS_SET = new Set(["active", "suspended", "ended", "expired"]);
const WORLD_STORYLINE_STATUS_SET = new Set(["active", "dormant", "resolved"]);
const MAX_WORLD_STORYLINES = 96;
const MAX_WORLD_RELATIONS = 256;
const MAX_WORLD_AGREEMENTS = 128;

const normalizeTextLike = (value) => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return normalizeOptionalString(value);
  }

  if (value && typeof value === "object") {
    return normalizeOptionalString(
      value.text ??
        value.title ??
        value.label ??
        value.name ??
        value.summary ??
        value.description ??
        value.content ??
        value.result,
    );
  }

  return "";
};

const generateId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const normalizeActionParticipants = (value) =>
  normalizeArray(value)
    .map((entry) => normalizeString(entry))
    .filter(Boolean);

// How to undo a queued manual troop order if its action is deleted before the
// next jump (see unitsController): a deploy is removed again, a disbanded unit
// comes back as it was (`restore`, the whole unit), a move snaps the unit back,
// a long-range order restores the prior status (#368).
const normalizeUnitRevert = (value) => {
  if (!value || typeof value !== "object") return null;
  const unitId = normalizeOptionalString(value.unitId);
  if (!unitId) return null;
  const lng = finiteOrNull(value.lng);
  const lat = finiteOrNull(value.lat);
  const restore = value.restore && typeof value.restore === "object"
    ? normalizeUnitEntry({ ...value.restore, id: unitId })
    : null;
  return {
    unitId,
    ...(lng !== null && lat !== null ? { lng, lat } : {}),
    ...(value.remove === true ? { remove: true } : {}),
    ...(restore ? { restore } : {}),
    ...(normalizeOptionalString(value.status) ? { status: normalizeOptionalString(value.status) } : {}),
    // The standing multi-turn order (world.pendingUnitOrders) this move/attack
    // created, if any — so deleting the queued action also cancels the order
    // instead of leaving an orphaned "keep advancing this unit" entry behind.
    ...(normalizeOptionalString(value.pendingOrderId) ? { pendingOrderId: normalizeOptionalString(value.pendingOrderId) } : {}),
  };
};

export const normalizeActionEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const text = normalizeString(entry);
    if (!text) return null;

    return {
      createdAt: new Date().toISOString(),
      id: generateId(`action-${index}`),
      kind: "action",
      participants: [],
      rawInput: text,
      source: "manual",
      status: "planned",
      text,
      title: text.length > 64 ? `${text.slice(0, 61)}...` : text,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const rawInput = normalizeTextLike(entry.rawInput || entry.input || entry.text || entry.content);
  const text = normalizeTextLike(entry.text || entry.content || entry.body || rawInput);
  const title =
    normalizeTextLike(entry.title || entry.name) ||
    (text.length > 64 ? `${text.slice(0, 61)}...` : text);

  if (!title && !text && !rawInput) {
    return null;
  }

  const kind =
    normalizeString(entry.kind || entry.type).toLowerCase() === "chat"
      ? "chat"
      : "action";

  const unitRevert = normalizeUnitRevert(entry.unitRevert);

  return {
    chatStarter: normalizeOptionalString(entry.chatStarter || entry.openingMessage),
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    id: normalizeOptionalString(entry.id) || generateId(`action-${index}`),
    invitees: normalizeActionParticipants(entry.invitees),
    kind,
    participants: normalizeActionParticipants(entry.participants),
    rawInput: rawInput || text || title,
    source: normalizeOptionalString(entry.source) || "manual",
    status: normalizeOptionalString(entry.status) || "planned",
    suggestionTopic: normalizeOptionalString(entry.suggestionTopic || entry.topic),
    text: text || rawInput || title,
    title: title || rawInput || text,
    ...(unitRevert ? { unitRevert } : {}),
    // The round a skip carried the order out in (AI/playerFocus.js settleOrders).
    ...(Number.isInteger(entry.resolvedRound) ? { resolvedRound: entry.resolvedRound } : {}),
    // Carried over unanswered from the last time skip (AI/playerFocus.js
    // settleOrders): the next skip answers it first.
    ...(entry.overdue === true ? { overdue: true } : {}),
    // The polity whose order this is, in a shared game (runtime/humanPolities.js).
    // Single player's orders name none: they are the player's.
    ...(normalizeOptionalString(entry.ownerCode) ? { ownerCode: normalizeOptionalString(entry.ownerCode) } : {}),
    // Sandbox mode (runtime/sandbox.js): the polity this order is given for,
    // when it is not the player's own.
    ...(normalizeOptionalString(entry.actor) ? { actor: normalizeOptionalString(entry.actor) } : {}),
    // Sandbox mode: an order that happens as written, not one the turn judges.
    ...(entry.decree === true ? { decree: true } : {}),
  };
};

export const normalizeActions = (actions) =>
  normalizeArray(actions)
    .map((entry, index) => normalizeActionEntry(entry, index))
    .filter(Boolean);

const normalizeInteractiveChoice = (entry, index = 0) => {
  if (typeof entry === "string") {
    const text = normalizeString(entry);
    if (!text) {
      return null;
    }

    return {
      id: generateId(`interactive-choice-${index}`),
      result: "",
      text,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const text = normalizeTextLike(entry.text || entry.title || entry.label || entry.name);
  if (!text) {
    return null;
  }

  return {
    ...cloneValue(entry),
    id: normalizeOptionalString(entry.id) || generateId(`interactive-choice-${index}`),
    result: normalizeTextLike(entry.result || entry.summary || entry.outcome || entry.effect || entry.description),
    text,
  };
};

const normalizeInteractiveHistoryEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const summary = normalizeString(entry);
    if (!summary) {
      return null;
    }

    return {
      choice: `Step ${index + 1}`,
      summary,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const choice = normalizeTextLike(entry.choice || entry.text || entry.title || entry.name);
  const summary = normalizeTextLike(entry.summary || entry.result || entry.outcome || entry.description);

  if (!choice && !summary) {
    return null;
  }

  return {
    ...cloneValue(entry),
    choice: choice || `Step ${index + 1}`,
    summary,
  };
};

const normalizeInteractive = (value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const title = normalizeTextLike(value.title || value.name);
  const premise = normalizeTextLike(value.premise || value.summary || value.description);
  const opening = normalizeTextLike(value.opening || value.text || premise);
  const choices = normalizeArray(value.choices)
    .map((entry, index) => normalizeInteractiveChoice(entry, index))
    .filter(Boolean);
  const history = normalizeArray(value.history)
    .map((entry, index) => normalizeInteractiveHistoryEntry(entry, index))
    .filter(Boolean);

  if (!title && !premise && !opening && choices.length === 0 && history.length === 0) {
    return null;
  }

  return {
    ...cloneValue(value),
    choices,
    history,
    opening,
    premise,
    title,
  };
};

const normalizeReactionMap = (value) => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([name, reaction]) => {
        if (!reaction || typeof reaction !== "object") {
          return [name, null];
        }

        const emoji = normalizeOptionalString(reaction.emoji);
        const code = normalizeOptionalString(reaction.code);
        const country = normalizeOptionalString(reaction.country);

        if (!emoji && !code) {
          return [name, null];
        }

        return [
          name,
          {
            ...(code ? { code } : {}),
            ...(emoji ? { emoji } : {}),
            ...(country ? { country } : {}),
          },
        ];
      })
      .filter(([, reaction]) => reaction),
  );
};

const normalizeChatMessage = (message, index = 0) => {
  if (typeof message === "string") {
    const text = normalizeString(message);
    if (!text) return null;

    return {
      code: "",
      id: generateId(`message-${index}`),
      reactions: {},
      role: "system",
      speaker: "",
      text,
      time: "",
      memorySummary: "",
    };
  }

  if (!message || typeof message !== "object") {
    return null;
  }

  const text = normalizeOptionalString(message.text || message.message || message.content);
  if (!text) {
    return null;
  }
  // The event a turn wrote this message with: it is shown when that event is
  // revealed (runtime/unseenEvents.js). Only a turn's own messages carry one.
  const eventId = normalizeOptionalString(message.eventId);
  // What the world did since the thread last spoke, carried on the player's
  // message that was sent with it (AI/conversationCatchUp.js buildThreadCatchUp),
  // and the few words the panel shows for it.
  const catchUp = normalizeOptionalString(message.catchUp);
  const catchUpLabel = normalizeOptionalString(message.catchUpLabel);
  // The advisor's drafted letter a player's message was sent from (the
  // composer stamps its id: GameUI/advisorDrafts.js sentLetterDate).
  const fromDraft = normalizeOptionalString(message.fromDraft).slice(0, 160);
  // In a shared game, the country whose player's own device wrote a
  // government's words (runtime/chatThreads.js keeps it in the log).
  const writtenBy = normalizeOptionalString(message.writtenBy).slice(0, 200);

  return {
    code: normalizeOptionalString(message.code),
    id: normalizeOptionalString(message.id) || generateId(`message-${index}`),
    reactions: normalizeReactionMap(message.reactions),
    role: normalizeOptionalString(message.role || message.sender) || "system",
    speaker: normalizeOptionalString(message.speaker || message.senderName),
    // Rolling durable diplomatic memory attached to a message: never rendered as
    // chat text, it lets long negotiations stay bounded without forgetting
    // agreements, threats or unresolved proposals (promptContext reads the latest).
    memorySummary: normalizeOptionalString(message.memorySummary || message.diplomaticMemorySummary),
    text,
    time: normalizeOptionalString(message.time || message.date),
    ...(eventId ? { eventId } : {}),
    ...(catchUp ? { catchUp, ...(catchUpLabel ? { catchUpLabel } : {}) } : {}),
    ...(fromDraft ? { fromDraft } : {}),
    ...(writtenBy ? { writtenBy } : {}),
  };
};

const normalizeChatCountry = (entry) => {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string") {
    const name = normalizeString(entry);
    if (!name) return null;

    return {
      code: "",
      name,
    };
  }

  if (typeof entry !== "object") {
    return null;
  }

  const name = normalizeOptionalString(entry.name || entry.label || entry.country);
  const code = normalizeOptionalString(entry.code || entry.id);

  if (!name && !code) {
    return null;
  }

  return {
    code,
    name: name || code,
    ...(normalizeOptionalString(entry.polityKey) ? { polityKey: normalizeOptionalString(entry.polityKey) } : {}),
  };
};

export const normalizeChatEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const institutionId = normalizeOptionalString(entry.institutionId || entry.channelInstitutionId);
  const lifecycleInstitutionId = normalizeOptionalString(entry.lifecycleInstitutionId || entry.institutionLifecycleId);
  const lifecycleCaseIds = normalizeArray(entry.lifecycleCaseIds || entry.institutionLifecycleCaseIds)
    .map((value) => normalizeOptionalString(value))
    .filter(Boolean)
    .slice(0, 32);
  const countries = normalizeArray(entry.countries || entry.participants)
    .map((country) => normalizeChatCountry(country))
    .filter(Boolean);
  // Institution channels are durable institutional history. The player is
  // implicit in every diplomatic thread, so an institution whose only active
  // member is the player legitimately has an empty `countries` projection.
  if (countries.length === 0 && !institutionId) return null;

  // The thread's event log, when it has one (runtime/chatThreads.js): who
  // joined, who left, who said what, who voted. It is the TRUTH of the thread;
  // countries, messages and title are its projection, kept beside it so every
  // existing reader of a chat goes on working unchanged. A thread saved before
  // the log existed simply has none, and is migrated where it is read. Messages
  // a writer added beside the log (the one-on-one panel, a note a turn folded
  // in, the player's line before a group turn) are folded into it here, or the
  // projection would drop them.
  const events = withUnloggedMessages(normalizeChatEvents(entry.events), entry.messages, { threadId: entry.id });
  const projected = events.length ? projectChatThread(events) : null;
  // In a shared game a thread belongs to the person who opened it, named here
  // (multiplayer/host/projection.js threadOwner). Single player's threads name
  // nobody: they are the player's.
  const owner = normalizeOptionalString(entry.player);
  // A shared game's conversation between people, retired for a country whose
  // seat was let go (multiplayer/host/foundings.js withSeatLetGo): the next
  // player of that country is not shown it. Single player's threads have none.
  const retiredFor = normalizeArray(entry.retiredFor).map(normalizeOptionalString).filter(Boolean).slice(0, 16);

  return {
    countries: projected?.countries?.length ? projected.countries : countries,
    id: normalizeOptionalString(entry.id) || generateId(`chat-${index}`),
    ...(owner ? { player: owner } : {}),
    ...(retiredFor.length ? { retiredFor } : {}),
    ...(institutionId ? { institutionId } : {}),
    ...(lifecycleInstitutionId ? { lifecycleInstitutionId } : {}),
    ...(lifecycleCaseIds.length ? { lifecycleCaseIds } : {}),
    linkedEventId: normalizeOptionalString(entry.linkedEventId || entry.eventId),
    messages: projected
      ? projected.messages.map((message, messageIndex) => normalizeChatMessage(message, messageIndex)).filter(Boolean)
      : normalizeArray(entry.messages)
        .map((message, messageIndex) => normalizeChatMessage(message, messageIndex))
        .filter(Boolean),
    ...(events.length ? { events } : {}),
    // The binding votes the log carries, ready for the panel to render.
    ...(projected?.polls?.length ? { polls: projected.polls } : {}),
    // The demands the log carries (chatThreads.js), for the panel's demand card
    // and for the turn that charges a refusal.
    ...(projected?.demands?.length ? { demands: projected.demands } : {}),
    source: projected?.source || normalizeOptionalString(entry.source) || "manual",
    status: normalizeOptionalString(entry.status) || "open",
    title: projected?.title || normalizeOptionalString(entry.title),
    // The inbox's persisted activity order is independent of the historical
    // date. Never derive a fresh ordinal while normalizing/read-replaying.
    ...(Number.isSafeInteger(entry.activityOrdinal) && entry.activityOrdinal > 0
      ? { activityOrdinal: entry.activityOrdinal } : {}),
  };
};

// THE ONE DETERMINISTIC LOYALTY RULE's intake: every refusal of an Overlord's
// demand the engine has not yet charged, and the charged record with them added.
// Pure, and it never touches a chat.
//
// Charged ONCE, keyed by the id of the message that carried it — not by date,
// because a retried jump or a reloaded save lands on the same date twice. The
// record is world.chargedRefusals rather than a stamp on the message, because a
// stamp on a message was erased by the next save from any chat panel holding an
// older copy, and the refusal was then charged on every jump after. Every world
// writer re-reads before it writes; chat writers do not.
//
// Both parties come off the message, never from who spoke: an AI Puppet marks
// its own refusal, and an Overlord marks the reply answering the PLAYER's.
export const chargeRefusals = (chats, charged = []) => {
  const seen = new Set(normalizeArray(charged).map((id) => String(id)));
  const refusedDemands = [];
  const newlyCharged = [];
  for (const chat of normalizeArray(chats)) {
    const threadId = normalizeOptionalString(chat?.id);
    for (const demand of normalizeArray(chat?.demands)) {
      if (demand?.status !== "refused") continue;
      const overlord = normalizeOptionalString(demand.by);
      const puppet = normalizeOptionalString(demand.target);
      // A demand id is only unique within its thread, so the key carries both —
      // or one thread's refusal would hide another's that reused the id.
      const key = `${threadId}:${normalizeOptionalString(demand.id)}`;
      if (!overlord || !puppet || !threadId || seen.has(key)) continue;
      seen.add(key);
      newlyCharged.push(key);
      refusedDemands.push({ overlord, puppet });
    }
  }
  return { refusedDemands, charged: [...normalizeArray(charged), ...newlyCharged] };
};

export const normalizeChats = (chats) =>
  normalizeArray(chats)
    .map((entry, index) => normalizeChatEntry(entry, index))
    .filter(Boolean);

// ---------------------------------------------------------------------------
// Canonical chat identity / institution membership bridge
// ---------------------------------------------------------------------------
// Latest Beta made diplomacy threads event-sourced (chatThreads.js) and keeps
// the player implicit in every thread. Continuum institutions add one further
// ownership rule: an institutional channel is identified by the institution,
// NOT by its current member set, and its current participants are a projection
// of the institution ledger rather than a second membership authority.

const normalizedChatIdentityToken = (country, world, identityIndex = null) => {
  const token = normalizeOptionalString(country?.polityKey || country?.name || country?.code || country);
  if (!token) return "";
  if (!world || typeof world !== "object") return token.toLocaleLowerCase();
  const resolved = resolvePolityIdentity(token, world, {
    allowUnknown: true,
    requireActive: false,
    identityIndex,
  });
  return normalizeOptionalString(resolved?.resolved || token).toLocaleLowerCase();
};

const syncThreadMembership = (entry, desiredCountries, world, identityIndex = null) => {
  const normalizedEntry = normalizeChatEntry(entry);
  if (!normalizedEntry) return null;
  const baseEvents = normalizeChatEvents(
    normalizeArray(normalizedEntry.events).length
      ? normalizedEntry.events
      : eventsFromLegacyChat(normalizedEntry),
  );
  const currentCountries = projectChatThread(baseEvents).countries || normalizedEntry.countries || [];
  const desired = normalizeArray(desiredCountries).map(normalizeChatCountry).filter(Boolean);
  const currentByKey = new Map();
  const desiredByKey = new Map();
  for (const country of currentCountries) {
    const key = normalizedChatIdentityToken(country, world, identityIndex);
    if (key && !currentByKey.has(key)) currentByKey.set(key, normalizeChatCountry(country));
  }
  for (const country of desired) {
    const key = normalizedChatIdentityToken(country, world, identityIndex);
    if (key && !desiredByKey.has(key)) desiredByKey.set(key, country);
  }

  const time = normalizeOptionalString(normalizedEntry.messages?.at?.(-1)?.time);
  const changes = [];
  for (const [key, country] of currentByKey) {
    if (desiredByKey.has(key)) continue;
    changes.push({
      id: generateId(`${normalizedEntry.id || "chat"}-leave`),
      kind: "member_left",
      time,
      by: "",
      member: country,
    });
  }
  for (const [key, country] of desiredByKey) {
    if (currentByKey.has(key)) continue;
    changes.push({
      id: generateId(`${normalizedEntry.id || "chat"}-join`),
      kind: "member_joined",
      time,
      by: "",
      member: country,
    });
  }

  const events = changes.length ? normalizeChatEvents([...baseEvents, ...changes]) : baseEvents;
  return normalizeChatEntry({ ...normalizedEntry, countries: desired, events });
};

export const chatThreadIdentityKey = (entry, world, identityIndex = null) => {
  const lifecycleInstitutionId = normalizeOptionalString(entry?.lifecycleInstitutionId || entry?.institutionLifecycleId);
  const lifecycleCaseIds = normalizeArray(entry?.lifecycleCaseIds || entry?.institutionLifecycleCaseIds)
    .map((value) => normalizeOptionalString(value)).filter(Boolean).sort();
  if (lifecycleInstitutionId && lifecycleCaseIds.length) {
    const canonicalId = canonicalInstitutionIdentity({ id: lifecycleInstitutionId }).id;
    return canonicalId ? `institution-lifecycle:${canonicalId}:${lifecycleCaseIds.join(",")}` : "";
  }
  const institutionId = normalizeOptionalString(entry?.institutionId || entry?.channelInstitutionId);
  if (institutionId) {
    const canonicalId = canonicalInstitutionIdentity({ id: institutionId }).id;
    return canonicalId ? `institution:${canonicalId}` : "";
  }
  const index = identityIndex || (world && typeof world === "object" ? buildPolityIdentityIndex(world) : null);
  const participants = normalizeArray(entry?.countries || entry?.participants)
    .map((country) => normalizedChatIdentityToken(country, world, index))
    .filter(Boolean);
  const unique = [...new Set(participants)].sort();
  return unique.length ? `participants:${unique.join("\u001f")}` : "";
};

const reconcileModernChatForPlayer = (entry, world, playerCountry = "", identityIndex = null) => {
  const chat = normalizeChatEntry(entry);
  if (!chat) return null;
  const index = identityIndex || buildPolityIdentityIndex(world || {});
  const playerKey = normalizedChatIdentityToken({ name: playerCountry }, world, index);
  const institutionId = normalizeOptionalString(chat.institutionId || chat.channelInstitutionId);
  const lifecycleInstitutionId = normalizeOptionalString(chat.lifecycleInstitutionId || chat.institutionLifecycleId);
  const lifecycleCaseIds = normalizeArray(chat.lifecycleCaseIds || chat.institutionLifecycleCaseIds)
    .map((value) => normalizeOptionalString(value)).filter(Boolean);
  const lifecycleGovernanceThread = Boolean(institutionId && lifecycleInstitutionId && lifecycleCaseIds.length);

  let desiredCountries = chat.countries;
  // The institution's permanent Council projects participants from the canonical
  // membership ledger. A lifecycle hearing is different: it is a temporary
  // diplomatic table containing the applicant/invitee plus the institution's
  // eligible governments, while institutionId merely enables native governance.
  if (institutionId && !lifecycleGovernanceThread) {
    const canonicalId = canonicalInstitutionIdentity({ id: institutionId }).id;
    desiredCountries = canonicalId ? institutionChannelParticipants(world, canonicalId) : [];
  }
  desiredCountries = normalizeArray(desiredCountries).filter((country) => {
    const key = normalizedChatIdentityToken(country, world, index);
    return !playerKey || !key || key !== playerKey;
  });

  if (!institutionId && desiredCountries.length === 0) return null;
  return syncThreadMembership({
    ...chat,
    ...(institutionId ? { institutionId: canonicalInstitutionIdentity({ id: institutionId }).id } : {}),
  }, desiredCountries, world, index);
};

const mergeChatThreadRecords = (primary, incoming, world, playerCountry = "", identityIndex = null) => {
  const left = reconcileModernChatForPlayer(primary, world, playerCountry, identityIndex);
  const right = reconcileModernChatForPlayer(incoming, world, playerCountry, identityIndex);
  if (!left) return right;
  if (!right) return left;

  const leftEvents = normalizeArray(left.events).length ? normalizeChatEvents(left.events) : eventsFromLegacyChat(left);
  const rightEvents = normalizeArray(right.events).length ? normalizeChatEvents(right.events) : eventsFromLegacyChat(right);
  const rightWithoutSecondCreation = rightEvents.filter((event) => event.kind !== "chat_created");
  const events = normalizeChatEvents([...leftEvents, ...rightWithoutSecondCreation]);
  const merged = normalizeChatEntry({
    ...right,
    ...left,
    id: left.id || right.id,
    institutionId: left.institutionId || right.institutionId || undefined,
    lifecycleInstitutionId: left.lifecycleInstitutionId || right.lifecycleInstitutionId || undefined,
    lifecycleCaseIds: left.lifecycleCaseIds?.length ? left.lifecycleCaseIds : right.lifecycleCaseIds,
    linkedEventId: left.linkedEventId || right.linkedEventId,
    source: left.source || right.source,
    status: left.status || right.status || "open",
    title: left.title || right.title,
    events,
    // withUnloggedMessages inside normalizeChatEntry folds any messages written
    // beside the event log while a provider call was in flight.
    messages: [...normalizeArray(left.messages), ...normalizeArray(right.messages)],
  });
  return reconcileModernChatForPlayer(merged, world, playerCountry, identityIndex);
};

export const reconcileChatsForPlayer = (chats, world, playerCountry = "") => {
  const index = buildPolityIdentityIndex(world || {});
  // In a shared game a thread can belong to another person (entry.player, kept
  // by normalizeChatEntry): its implicit player is that person, so this player
  // may be one of its listed members, and its members may match one of this
  // player's own threads. It is theirs and stays as it stands: never reconciled
  // against this player, never merged into a thread of this player's.
  const playerName = normalizeOptionalString(playerCountry);
  const playerKey = playerName ? normalizedChatIdentityToken(playerName, world, index) : "";
  // While this engine hosts a shared game a thread that names no owner is the
  // host's (multiplayer/host/projection.js threadOwner). Reconciled for a
  // guest's institution business as though it were the guest's, a host's
  // thread with only that guest in it lost its last member and was dropped.
  const hostOwner = normalizeOptionalString(sharedGameHostCountry());
  const anothers = (entry) => {
    const owner = normalizeOptionalString(entry?.player) || hostOwner;
    return Boolean(owner) && normalizedChatIdentityToken(owner, world, index) !== playerKey;
  };
  const reconciled = normalizeArray(chats)
    .map((entry) => (anothers(entry) ? normalizeChatEntry(entry) : reconcileModernChatForPlayer(entry, world, playerCountry, index)))
    .filter(Boolean);

  const output = [];
  const openByIdentity = new Map();
  for (const chat of reconciled) {
    if (anothers(chat)) {
      output.push(chat);
      continue;
    }
    if (normalizeOptionalString(chat.status).toLocaleLowerCase() === "closed") {
      output.push(chat);
      continue;
    }
    const key = chatThreadIdentityKey(chat, world, index);
    if (!key) {
      output.push(chat);
      continue;
    }
    const priorIndex = openByIdentity.get(key);
    if (priorIndex == null) {
      openByIdentity.set(key, output.length);
      output.push(chat);
      continue;
    }
    output[priorIndex] = mergeChatThreadRecords(output[priorIndex], chat, world, playerCountry, index);
  }
  return output.filter(Boolean);
};

const normalizeRegionTransfer = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  // Owners are stored as the FULL COUNTRY NAME. This value is written straight into
  // world.regionOwnershipOverrides, so a model that answered "ESP" out of habit would
  // otherwise mint a phantom country that paints and labels itself beside the real
  // Spain. Canonicalise on the way in, once, rather than papering over it at render.
  const toCode = toCountryName(normalizeOptionalString(entry.toCode || entry.toPolity || entry.ownerCode || entry.owner));
  const fromCode = toCountryName(normalizeOptionalString(entry.fromCode || entry.fromPolity));

  if (!regionId || !toCode) {
    return null;
  }

  // Why the land moves (runtime/territoryBasis.js). Carried only when the entry
  // has one, so a transfer written before the field existed round-trips
  // byte-for-byte and reads as it always did.
  const basis = normalizeTerritoryBasis(entry.basis);

  return {
    ...(basis ? { basis } : {}),
    fromCode,
    note: normalizeOptionalString(entry.note || entry.reason),
    regionId,
    regionName: normalizeOptionalString(entry.regionName || entry.name),
    toCode,
  };
};

// One polity asserting a claim over a region it does not hold — an irredentist
// declaration, a proclaimed union, a contested border, a government-in-exile's
// title. The middle state the world model was missing.
//
// world.regionClaimants has existed since the map editor: Nations.jsx paints a
// claimed region in stripes of every claimant's colour, normalizeWorldState folds
// renames through it, and applyEventImpactsToWorld deletes the entry when the
// region actually changes hands. But nothing could ever CREATE one except the
// scenario seed and the cheats panel — so a unilateral claim had nowhere to go,
// and the simulation's only way to acknowledge one was to open a project and let
// a progress bar stand in for a border that never moved (see issue #7).
//
// `drop` is the other half, and it matters as much: a claim renounced, or a
// claimant defeated, has to be able to clear its stripes. A dispute nothing can
// end is worse than no dispute at all.
const normalizeRegionClaim = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  // Same namespace and the same reason as normalizeRegionTransfer's toCode above:
  // this is written into world.regionClaimants, which the striping reads owner
  // colours out of, so a bare "ESP" would stripe the region in a phantom country's
  // (absent) colour.
  const claimantCode = toCountryName(normalizeOptionalString(
    entry.claimantCode || entry.claimant || entry.byCode || entry.ownerCode || entry.code,
  ));

  // Withdrawn when its `drop` says so (true, or the same written as text), or
  // when the game's own word for it stands in the op's place. Never by another
  // verb: "renounce" once withdrew a claim, in English only, and the same verb
  // in any other language asserted it (the owner, 2026-11-13: no keywording).
  const drop = entry.drop === true || entry.drop === "true" || entry.op === "drop";
  // Every claimant's claim on the region withdrawn at once (a settlement, a
  // country clearing all claims on its land): no claimant needs naming then.
  const allClaimants = drop && (entry.allClaimants === true || entry.allClaimants === "true");

  if (!regionId || (!claimantCode && !allClaimants)) {
    return null;
  }

  return {
    ...(allClaimants ? { allClaimants: true } : {}),
    claimantCode,
    drop,
    note: normalizeOptionalString(entry.note || entry.reason),
    regionId,
    regionName: normalizeOptionalString(entry.regionName || entry.name),
  };
};

// Polity lifecycle: an ordinary update, a genuinely new polity, a rename that
// keeps the stable key, a restored historical polity, or a dissolution.
const POLITY_OPERATION_SET = new Set(["update", "create", "rename", "restore", "dissolve"]);
const POLITY_STATUS_SET = new Set(["active", "dormant", "dissolved"]);

// A de-facto control operation (contest / control / clear_contest): the
// wartime layer that leaves legal sovereignty alone. Owners share the claimant
// namespace, so a bare code is folded onto a country name here too. The op is
// one of the schema's three as it writes them, and every contender goes only
// when clearAll says so: "control_flip", "clear" and a claimant named "all"
// were once read as them, in English only (the owner, 2026-11-13).
const normalizeRegionControlOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;

  const op = normalizeOptionalString(entry.op).toLowerCase();
  const regionId = normalizeOptionalString(entry.regionId || entry.id || entry.gid || entry.GID_1);
  const regionName = normalizeOptionalString(entry.regionName || entry.name);
  const fromCode = toCountryName(normalizeOptionalString(entry.fromCode || entry.fromPolity));
  const note = normalizeOptionalString(entry.note || entry.reason);

  if (!regionId) return null;

  if (op === "contest") {
    const actorCode = toCountryName(normalizeOptionalString(entry.actorCode || entry.claimantCode || entry.toCode));
    if (!fromCode || !actorCode || fromCode.toLowerCase() === actorCode.toLowerCase()) return null;
    return { op, regionId, regionName, fromCode, actorCode, note };
  }

  if (op === "control") {
    const toCode = toCountryName(normalizeOptionalString(entry.toCode || entry.controllerCode || entry.ownerCode));
    if (!fromCode || !toCode || fromCode.toLowerCase() === toCode.toLowerCase()) return null;
    const basis = normalizeTerritoryBasis(entry.basis);
    return {
      op: "control",
      regionId,
      regionName,
      fromCode,
      toCode,
      note,
      ...(basis ? { basis } : {}),
      ...(entry.wholeCountry === true ? { wholeCountry: true } : {}),
      // A change the front engine worked out from where the line stands, not
      // one the model wrote: a turn applied a second time takes these out and
      // works them out afresh (AI/frontTurn.js).
      ...(entry.by === "front" ? { by: "front" } : {}),
    };
  }

  if (op === "clear_contest") {
    const claimantCode = toCountryName(normalizeOptionalString(entry.claimantCode || entry.actorCode));
    const clearAll = entry.clearAll === true;
    if (!claimantCode && !clearAll) return null;
    return {
      op: "clear_contest",
      regionId,
      regionName,
      fromCode,
      claimantCode,
      clearAll,
      note,
    };
  }

  return null;
};

const normalizePolityChange = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const code = toCountryName(normalizeOptionalString(entry.code || entry.id || entry.polityCode));
  if (!code) {
    return null;
  }

  const rawReputation = Number(entry.reputation ?? entry.internationalReputation);
  const reputation = Number.isFinite(rawReputation)
    ? Math.max(0, Math.min(100, Math.round(rawReputation)))
    : null;
  const rawIntelligence = Number(entry.intelligence ?? entry.intelligenceService);
  const intelligence = Number.isFinite(rawIntelligence)
    ? Math.max(0, Math.min(100, Math.round(rawIntelligence)))
    : null;

  // The AI sends the complete new list, so an empty array is meaningful ("this
  // country no longer has defining tags") while undefined means "unchanged" —
  // null keeps those distinguishable for the apply step below.
  const tags = Array.isArray(entry.tags || entry.countryTags)
    ? normalizeTagList(entry.tags || entry.countryTags)
    : null;

  // Persistent stat-sheet update: keep the partial object as-is (the merge + the Stats
  // pane tolerate missing/extra fields); null means "no stat change this period".
  const stats = entry.stats && typeof entry.stats === "object" && !Array.isArray(entry.stats)
    ? entry.stats
    : null;

  // A lasting change to how it makes war (runtime/militaryStats.js): by how
  // much each of its figures moves. Left out when there is none.
  const military = normalizeMilitaryShift(entry.military);

  // Old saved events predate explicit lifecycle operations; they stay ordinary
  // updates. New AI output states create/rename/restore/dissolve explicitly.
  const rawOperation = normalizeOptionalString(entry.operation || entry.op || entry.action).toLowerCase();
  const operation = POLITY_OPERATION_SET.has(rawOperation) ? rawOperation : "update";

  return {
    aliases: normalizeActionParticipants(entry.aliases || entry.additionalNames),
    code,
    color: normalizeOptionalString(entry.color),
    name: normalizeOptionalString(entry.name || entry.newName),
    intelligence,
    ...(military ? { military } : {}),
    note: normalizeOptionalString(entry.note || entry.reason),
    operation,
    reputation,
    stats,
    tags,
  };
};

export const normalizeUnitEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const rawLng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  // A position on a world copy past the date line is the same place in range.
  const lng = rawLng === null ? null : wrapLng(rawLng);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  // Full country name, never a code — same identity everywhere (see ownerNames.js).
  const ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code));
  if (lng === null || lat === null || (lng === 0 && lat === 0) || !ownerCode) {
    return null;
  }

  const type = normalizeOptionalString(entry.type).toLowerCase();
  const status = normalizeOptionalString(entry.status).toLowerCase();
  const source = normalizeOptionalString(entry.source).toLowerCase();
  const posture = normalizeOptionalString(entry.posture).toLowerCase();
  const unitType = unitTypeRef(entry.unitType);
  const timestamp = new Date().toISOString();

  return {
    id: normalizeOptionalString(entry.id) || generateId(`unit-${index}`),
    name: normalizeOptionalString(entry.name) || "Unit",
    type: UNIT_TYPE_SET.has(type) ? type : "infantry",
    // One of the scenario's own unit types (unitTypes.js), by its id: the world
    // checks it against world.unitTypes (normalizeWorldState), where `type`
    // becomes the type's base. Absent on every other unit.
    ...(unitType ? { unitType } : {}),
    ownerCode,
    strength: clampUnitStrength(entry.strength ?? 100),
    lng,
    lat,
    regionId: normalizeOptionalString(entry.regionId),
    status: UNIT_STATUS_SET.has(status) ? status : "idle",
    // What the formation is made of, in words — "1 aircraft carrier, 2 frigates".
    // Together with `note` this is what turns a coloured dot into something the
    // player can actually reason about.
    composition: normalizeOptionalString(entry.composition),
    // One present-tense sentence: "Patrolling the North Atlantic approaches".
    note: normalizeOptionalString(entry.note),
    // Intent, not lifecycle. Unknown values fall back to "" rather than a default,
    // so an absent posture stays absent instead of asserting something untrue.
    posture: UNIT_POSTURE_SET.has(posture) ? posture : "",
    // "No confirmed line of support" — a covert insertion OR a presence the player
    // has only just detected. Engine-assigned (see applyUnitOpBatch); never taken
    // from the model, or it would claim covert whenever convenient.
    covert: entry.covert === true,
    // The event that created or last moved this unit, so the popup can say what
    // put it there and click through to it.
    eventId: normalizeOptionalString(entry.eventId),
    // The war the engine raised this formation for, when it was raised only so a
    // war would have a counter (AI/nativeUnitDirector.js): it is disbanded when
    // that war ends. Absent on every other unit.
    ...(normalizeOptionalString(entry.raisedForWar) ? { raisedForWar: normalizeOptionalString(entry.raisedForWar) } : {}),
    // The battlefield this formation is fighting on (runtime/fronts/). There it
    // is one of its side's troops and the front engine moves it; the record
    // here keeps its name and what it is, and takes its place and strength back
    // when the battlefield closes. Absent on every other unit.
    ...(normalizeOptionalString(entry.committedTo) ? { committedTo: normalizeOptionalString(entry.committedTo) } : {}),
    // A ship the player's story turns on (a hired cog carrying a stolen egg), not
    // a warship: shown while it sails and taken off the map at expiresRound
    // (AI/nativeUnitDirector.js pruneWarUnits) if no arrival removes it first.
    ...(entry.storyVessel === true ? { storyVessel: true } : {}),
    ...(Number.isInteger(entry.expiresRound) ? { expiresRound: entry.expiresRound } : {}),
    // kw5-units: what an air unit flies, fighter, bomber or mixed, as the model or
    // the scenario said (runtime/fronts/airStrike.js fightersShareOf). Absent on
    // every other unit, and on an air unit that said none.
    ...(UNIT_AIR_ROLES.includes(normalizeOptionalString(entry.airRole).toLowerCase()) ? { airRole: normalizeOptionalString(entry.airRole).toLowerCase() } : {}),
    source: UNIT_SOURCE_SET.has(source) ? source : "scenario",
    orderId: normalizeOptionalString(entry.orderId),
    createdAt: normalizeOptionalString(entry.createdAt) || timestamp,
    updatedAt: normalizeOptionalString(entry.updatedAt) || timestamp,
  };
};

export const normalizeUnits = (units) =>
  normalizeArray(units)
    .map((entry, index) => normalizeUnitEntry(entry, index))
    .filter(Boolean);

// Great-circle distance in km. The implementation now lives in unitMotion.js —
// which is import-free, so its tests run without a full install — and is
// re-exported here because promptContext.js and the order pruning below have
// always imported it from this module. There used to be two copies of this
// function (here and unitCombat.js's `distanceKm`); now there is one.
export { haversineKm, kmOnMap };

const PENDING_ORDER_KIND_SET = new Set(["move", "patrol"]);

// A standing multi-turn order the engine advances every turn: "move" travels to
// a destination, "patrol" works a station centred on it. Independent of the
// actions queue. See applyUnitOpBatch (mints them), advanceStandingOrders
// (advances them) and pruneSatisfiedUnitOrders (clears them once satisfied).
const normalizePendingUnitOrderEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") return null;
  const unitId = normalizeOptionalString(entry.unitId);
  const toLng = finiteOrNull(entry.toLng);
  const toLat = finiteOrNull(entry.toLat);
  // (Nor to lng 0, lat 0: no place, as no unit stands there, normalizeUnitEntry.)
  if (!unitId || toLng === null || toLat === null || (toLng === 0 && toLat === 0)) return null;
  const rawKind = normalizeOptionalString(entry.kind).toLowerCase();
  // Saves from before player-issued attacks were removed carry kind "attack".
  // Coerce rather than drop: the destination and targetLabel are still good, so
  // the unit simply keeps advancing on the same objective and the AI narrates
  // what happens when it gets there — which is how combat always resolved anyway.
  const kind = rawKind === "attack" ? "move" : rawKind;
  const numberOr = (value, fallback) =>
    Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : fallback;

  return {
    id: normalizeOptionalString(entry.id) || generateId(`unitorder-${index}`),
    unitId,
    kind: PENDING_ORDER_KIND_SET.has(kind) ? kind : "move",
    toLng,
    toLat,
    // Station radius for a patrol order; 0 (and meaningless) for a move order.
    radiusKm: Math.min(2000, numberOr(entry.radiusKm, 0)),
    // Round after which the order lapses; 0 means it never does. Patrols get a
    // finite life so a fleet does not circle the same station forever.
    untilRound: numberOr(entry.untilRound, 0),
    targetId: normalizeOptionalString(entry.targetId),
    targetLabel: normalizeOptionalString(entry.targetLabel),
    note: normalizeOptionalString(entry.note),
    issuedAt: normalizeOptionalString(entry.issuedAt),
    issuedRound: numberOr(entry.issuedRound, 0),
    // The part of the way that is over water, which paces a redeployment
    // (unitMotion.js kmPerDay). Absent on an order nobody worked it out for.
    ...(entry.seaShare !== null && entry.seaShare !== undefined && Number.isFinite(Number(entry.seaShare))
      ? { seaShare: Math.max(0, Math.min(1, Number(entry.seaShare))) }
      : {}),
  };
};

export const normalizePendingUnitOrders = (orders) =>
  normalizeArray(orders)
    .map((entry, index) => normalizePendingUnitOrderEntry(entry, index))
    .filter(Boolean);

// A unit is considered to have arrived once it's within this of its ordered
// destination — roughly a garrison's engagement range, "close enough that the
// order has plainly been carried out" rather than an exact coordinate match,
// which the AI's own incremental moves would rarely land on precisely.
const PENDING_ORDER_ARRIVAL_KM = 60;

// Drop any order whose unit no longer exists (destroyed/removed) or has
// arrived (within PENDING_ORDER_ARRIVAL_KM of its destination). Runs on every
// normalizeWorldState call — every read AND every write — so an order clears
// itself the moment a move actually lands it, with no separate cleanup call
// needed anywhere else, and player deletes of stale units never leave orphans.
export const pruneSatisfiedUnitOrders = (units, orders) => {
  const byId = new Map(normalizeArray(units).map((unit) => [unit.id, unit]));
  return normalizeArray(orders).filter((order) => {
    const unit = byId.get(order.unitId);
    if (!unit) return false;
    // A patrol order is never "satisfied" by proximity — its destination IS the
    // station the unit is meant to be sitting on, so the arrival test below would
    // delete every patrol the instant it was created. It ends by expiry
    // (untilRound, in advanceStandingOrders) or when its unit goes away.
    if (order.kind === "patrol") return true;
    // A unit still on its way keeps its order until it arrives: a step that stops
    // inside the radius but short of the destination is not an arrival. Dropping
    // it there left a division 59 km short of its destination reading "moving" with
    // nothing to move it. The radius is for a unit already standing near.
    if (unit.status === "moving") return true;
    return kmOnMap(unit.lat, unit.lng, order.toLat, order.toLng) > PENDING_ORDER_ARRIVAL_KM;
  });
};

// A patrol works the station its order names (toLng/toLat), and the map draws
// its ring there. A unit placed somewhere else by hand (the admin placement seam,
// unitsController.placeUnitAdmin) takes its station with it: left behind, the
// ring would stay at the old spot and the next turn's patrol step would pull the
// unit straight back to it. Any other standing order keeps its destination — a
// march simply continues from wherever the unit now stands.
export const recenterPatrolOrders = (orders, unitId, lng, lat) => {
  const list = normalizePendingUnitOrders(orders);
  if (!unitId || !Number.isFinite(lng) || !Number.isFinite(lat)) return list;
  return list.map((order) =>
    (order.unitId === unitId && order.kind === "patrol" ? { ...order, toLng: lng, toLat: lat } : order));
};

// A structure built during play: any named point on the map — city, military
// base, bunker, missile silo, embassy, port. `kind` is deliberately free-form
// (lowercased for stable styling/grouping); unknown kinds are first-class.
// Persistent physical features carry a lifecycle: a feature is planned, built,
// damaged, abandoned or destroyed without losing its identity, and a rename
// keeps the old name as an alias so later events can still find it.
export const MARKER_STATUSES = [
  "planned",
  "under_construction",
  "active",
  "damaged",
  "inactive",
  "abandoned",
  "destroyed",
];
const MARKER_STATUS_SET = new Set(MARKER_STATUSES);
const MAX_MARKER_ALIASES = 12;
const MAX_MARKER_SOURCE_EVENT_IDS = 24;
const MAX_GM_AUDIT = 64;

const hasOwn = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const normalizeMarkerNameList = (values, { exclude = "", limit = MAX_MARKER_ALIASES } = {}) => {
  const excluded = normalizeOptionalString(exclude).toLowerCase();
  const seen = new Set();
  const output = [];
  for (const raw of normalizeArray(values)) {
    const value = normalizeOptionalString(raw);
    const key = value.toLowerCase();
    if (!value || key === excluded || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
};

const normalizeMarkerSourceEventIds = (values) => {
  const seen = new Set();
  const output = [];
  for (const raw of normalizeArray(values)) {
    const value = normalizeOptionalString(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output.slice(-MAX_MARKER_SOURCE_EVENT_IDS);
};

// Pending Event Editor diplomatic evaluations. The grace deadline is real-world
// time because its only purpose is an "undo send" window for the administrator;
// the resulting diplomatic message is stamped with the event's in-game date.
export const normalizePendingEventOutreach = (entries) =>
  normalizeArray(entries)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const sourceEventId = normalizeOptionalString(entry.sourceEventId);
      const sourceEventCreatedAt = normalizeOptionalString(entry.sourceEventCreatedAt);
      const deliverAfter = normalizeOptionalString(entry.deliverAfter);
      if (!sourceEventId || !deliverAfter) return null;
      const attempts = Number.isFinite(Number(entry.attempts))
        ? Math.max(0, Math.trunc(Number(entry.attempts)))
        : 0;
      return {
        id: normalizeOptionalString(entry.id) || generateId(`event-outreach-${index}`),
        sourceEventId,
        sourceEventCreatedAt,
        queuedAt: normalizeOptionalString(entry.queuedAt) || new Date().toISOString(),
        deliverAfter,
        attempts,
        lastError: normalizeOptionalString(entry.lastError),
      };
    })
    .filter(Boolean)
    .slice(-80);

// Bounded canonical audit trail for applied GM transactions. The record keeps
// the exact previewed transaction so later debugging can answer "what did the
// administrator actually authorize?" without the audit itself becoming
// authoritative world state.
export const normalizeGameMasterAudit = (entries) =>
  normalizeArray(entries)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const id = normalizeOptionalString(entry.id) || generateId(`gm-audit-${index}`);
      const transactionId = normalizeOptionalString(entry.transactionId || entry.id);
      if (!transactionId) return null;
      return {
        ...cloneValue(entry),
        id,
        transactionId,
        appliedAt: normalizeOptionalString(entry.appliedAt),
        date: normalizeOptionalString(entry.date),
        mode: normalizeOptionalString(entry.mode),
        request: normalizeTextLike(entry.request),
        summary: normalizeTextLike(entry.summary),
        round: Number.isFinite(Number(entry.round)) ? Math.max(0, Math.trunc(Number(entry.round))) : 0,
        eventIds: normalizeActionParticipants(entry.eventIds),
        storylineIds: normalizeActionParticipants(entry.storylineIds),
        warIds: normalizeActionParticipants(entry.warIds),
        relationIds: normalizeActionParticipants(entry.relationIds),
        agreementIds: normalizeActionParticipants(entry.agreementIds),
        chatIds: normalizeActionParticipants(entry.chatIds),
        statCountries: normalizeActionParticipants(entry.statCountries),
        acceptedOperations: normalizeArray(entry.acceptedOperations).map(normalizeTextLike).filter(Boolean).slice(0, 128),
        rejectedOperations: normalizeArray(entry.rejectedOperations).map(normalizeTextLike).filter(Boolean).slice(0, 128),
        status: normalizeOptionalString(entry.status) || "applied",
        source: normalizeOptionalString(entry.source) || "gm-console",
        transaction: entry.transaction && typeof entry.transaction === "object" ? cloneValue(entry.transaction) : null,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_GM_AUDIT);

export const normalizeMarkerEntry = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
  const lat = finiteOrNull(entry.lat ?? entry.latitude);
  const name = normalizeOptionalString(entry.name || entry.title);
  if (lng === null || lat === null || (lng === 0 && lat === 0) || !name) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const createdAt = normalizeOptionalString(entry.createdAt) || timestamp;
  const status = normalizeOptionalString(entry.status).toLowerCase();
  const foundedAt = normalizeOptionalString(entry.foundedAt || entry.date);
  const approximate = normalizeApproximateMark(entry.approximate);
  // How the map draws it (runtime/markerFamily.js): its family and its
  // strategic weight, as the skip, the Workshop or the Game Master said them.
  const family = normalizeMarkerFamily(entry.family);

  return {
    id: normalizeOptionalString(entry.id) || generateId(`marker-${index}`),
    name,
    kind: (normalizeOptionalString(entry.kind || entry.type) || "landmark").toLowerCase(),
    ownerCode: toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code)),
    lng,
    lat,
    note: normalizeOptionalString(entry.note || entry.description),
    status: MARKER_STATUS_SET.has(status) ? status : "active",
    aliases: normalizeMarkerNameList(entry.aliases, { exclude: name }),
    foundedAt,
    createdAt,
    updatedAt: normalizeOptionalString(entry.updatedAt) || createdAt,
    updatedDate: normalizeOptionalString(entry.updatedDate || entry.lastUpdatedDate) || foundedAt,
    sourceEventIds: normalizeMarkerSourceEventIds(entry.sourceEventIds),
    ...(approximate ? { approximate } : {}),
    // Only when said, so a structure without saves exactly as before.
    ...(family ? { family } : {}),
    ...(entry.strategic === true ? { strategic: true } : {}),
  };
};

// A structure given an approximate placement because the place its event named is
// not on the map (AI/placement.js): what was asked for, and where it went. The
// player settles it with Accept or Move (structurePlacement.js).
const normalizeApproximateMark = (value) => {
  if (!value || typeof value !== "object") return null;
  const asked = normalizeOptionalString(value.asked);
  const country = normalizeOptionalString(value.country);
  // `unnamed`: the thing was given no place at all, so nothing was asked for.
  const unnamed = value.unnamed === true;
  if (!(asked || unnamed) || !country) return null;
  return { asked, country, near: normalizeOptionalString(value.near), ...(unnamed ? { unnamed } : {}) };
};

export const normalizeMarkers = (markers) =>
  normalizeArray(markers)
    .map((entry, index) => normalizeMarkerEntry(entry, index))
    .filter(Boolean);

const normalizeMarkerPatch = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const patch = {};

  if (hasOwn(entry, "kind") || hasOwn(entry, "type")) {
    const kind = normalizeOptionalString(entry.kind || entry.type).toLowerCase();
    if (kind) patch.kind = kind;
  }
  // A new family or strategic weight, when an update says one; a kind changed
  // without one keeps the family it had.
  if (hasOwn(entry, "family")) {
    const family = normalizeMarkerFamily(entry.family);
    if (family) patch.family = family;
  }
  if (hasOwn(entry, "strategic") && typeof entry.strategic === "boolean") patch.strategic = entry.strategic;
  if (hasOwn(entry, "ownerCode") || hasOwn(entry, "owner") || hasOwn(entry, "code")) {
    patch.ownerCode = toCountryName(normalizeOptionalString(entry.ownerCode ?? entry.owner ?? entry.code));
  }
  if (hasOwn(entry, "status")) {
    const status = normalizeOptionalString(entry.status).toLowerCase();
    if (MARKER_STATUS_SET.has(status)) patch.status = status;
  }
  if (hasOwn(entry, "note") || hasOwn(entry, "description")) {
    patch.note = normalizeOptionalString(entry.note ?? entry.description);
  }
  // The Map Feature Editor may repair the establishment date without deleting
  // and rebuilding the object. Normal AI lifecycle updates do not emit foundedAt,
  // so historical continuity stays stable unless an editor deliberately sets it.
  if (hasOwn(entry, "foundedAt") || hasOwn(entry, "date")) {
    patch.foundedAt = normalizeOptionalString(entry.foundedAt ?? entry.date);
  }

  const hasLng = hasOwn(entry, "lng") || hasOwn(entry, "lon") || hasOwn(entry, "longitude");
  const hasLat = hasOwn(entry, "lat") || hasOwn(entry, "latitude");
  if (hasLng && hasLat) {
    const lng = finiteOrNull(entry.lng ?? entry.lon ?? entry.longitude);
    const lat = finiteOrNull(entry.lat ?? entry.latitude);
    if (lng !== null && lat !== null && !(lng === 0 && lat === 0)) {
      patch.lng = lng;
      patch.lat = lat;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
};

// One AI-authored mutation to persistent physical world features: one of the
// five operations of runtime/markerOps.js, as the schema writes them; any other
// word is no op and the entry is left out. Destruction is lifecycle state, not
// deletion: an update to status "destroyed". `remove` is reserved for true
// canonical cleanup or an administrative deletion.
const normalizeMarkerOp = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const op = markerOpKind(entry.op);

  if (op === "build") {
    const marker = normalizeMarkerEntry(entry.marker ?? entry, 0);
    if (!marker) return null;
    return { op: "build", marker };
  }

  if (op === "update") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name);
    if (!markerId && !name) return null;
    // normalizeEventImpacts stores normalized update fields under `changes`;
    // applyMarkerOps may later normalize that already-normalized op again. Accept
    // both shapes so update survives the full event -> world application pipeline.
    const patchSource = entry.changes && typeof entry.changes === "object" && !Array.isArray(entry.changes)
      ? entry.changes
      : entry;
    const changes = normalizeMarkerPatch(patchSource);
    if (!changes) return null;
    return { op: "update", markerId, name, changes };
  }

  if (op === "remove") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name);
    if (!markerId && !name) return null;
    return { op: "remove", markerId, name, note: normalizeOptionalString(entry.note) };
  }

  if (op === "rename") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name || entry.from || entry.oldName);
    const newName = normalizeOptionalString(entry.newName || entry.to);
    if ((!markerId && !name) || !newName) return null;
    return { op: "rename", markerId, name, newName, note: normalizeOptionalString(entry.note) };
  }

  if (op === "population") {
    const markerId = normalizeOptionalString(entry.markerId || entry.id);
    const name = normalizeOptionalString(entry.name || entry.city);
    const population = Number(entry.population ?? entry.value);
    // 0 is a real outcome — a city emptied by war or evacuation — so only a
    // non-finite or negative number is rejected.
    if ((!markerId && !name) || !Number.isFinite(population) || population < 0) return null;
    return {
      op: "population",
      markerId,
      name,
      population: Math.round(population),
      note: normalizeOptionalString(entry.note),
    };
  }

  return null;
};

const markerNameMatches = (marker, name) => {
  const wanted = normalizeOptionalString(name).toLowerCase();
  if (!wanted) return false;
  if (normalizeOptionalString(marker?.name).toLowerCase() === wanted) return true;
  return normalizeArray(marker?.aliases).some((alias) => normalizeOptionalString(alias).toLowerCase() === wanted);
};

const markerMatchesOp = (marker, op) =>
  op?.markerId ? marker?.id === op.markerId : markerNameMatches(marker, op?.name);

const touchMarker = (marker, context = {}) => {
  const eventId = normalizeOptionalString(context.eventId);
  const gameDate = normalizeOptionalString(context.gameDate);
  const timestamp = normalizeOptionalString(context.updatedAt) || new Date().toISOString();
  const sourceEventIds = normalizeMarkerSourceEventIds([
    ...normalizeArray(marker.sourceEventIds),
    ...(eventId ? [eventId] : []),
  ]);
  return {
    ...marker,
    updatedAt: timestamp,
    updatedDate: gameDate || marker.updatedDate || marker.foundedAt || "",
    sourceEventIds,
  };
};

// Apply a batch of marker ops (pure) while preserving object identity. A
// duplicate build of an existing current/alias name never respawns or resurrects
// the object; it only records that the event touched the existing feature.
// Removal matches id first, then exact name or alias — the AI usually knows the
// name, rarely the id.
export const applyMarkerOps = (markers, ops, context = {}) => {
  let next = normalizeMarkers(markers);
  for (const rawOp of normalizeArray(ops)) {
    const op = normalizeMarkerOp(rawOp);
    if (!op) continue;

    if (op.op === "build") {
      const existingIndex = next.findIndex((marker) => markerNameMatches(marker, op.marker.name));
      if (existingIndex >= 0) {
        next = next.map((marker, index) => index === existingIndex ? touchMarker(marker, context) : marker);
        continue;
      }
      next = [...next, touchMarker(op.marker, context)];
      continue;
    }

    if (op.op === "update") {
      next = next.map((marker) => {
        if (!markerMatchesOp(marker, op)) return marker;
        return touchMarker({ ...marker, ...op.changes }, context);
      });
      continue;
    }

    if (op.op === "remove") {
      next = next.filter((marker) => !markerMatchesOp(marker, op));
      continue;
    }

    if (op.op === "rename") {
      next = next.map((marker) => {
        if (!markerMatchesOp(marker, op)) return marker;
        const aliases = normalizeMarkerNameList(
          [...normalizeArray(marker.aliases), marker.name],
          { exclude: op.newName },
        );
        return touchMarker({ ...marker, name: op.newName, aliases }, context);
      });
    }
  }
  return normalizeMarkers(next);
};

// Projects & Operations: the long-running efforts board (world.projects[]).
//
// A project is anything that spans rounds and has a state worth tracking — a
// research programme, a shipbuilding project, a covert operation, a diplomatic
// campaign. It is deliberately NOT the actions queue: an action is one thing the
// player does this round and a jump resolves it, while a project persists across
// many rounds.
//
// Since 2026-11-15 the ENGINE runs a project (runtime/projectEngine.js): a plan
// says what it takes and costs, its owner's budget pays for it every day, and
// its progress, checkpoints, stalls and completion are the engine's. What is
// written from outside is what a project IS (its name, summary, tags, plan when
// it is planned), how it is funded (its owner's choice), and the setbacks,
// breakthroughs and endings the story gives it (ops below).
//
// Enums are closed where the UI switches on the value and open where the
// vocabulary is a judgement call the model makes. `status` is closed because
// the panel colour-codes it; `tags` is wide open (normalizeTagList, the same
// rule country tags use).
export const PROJECT_STATUSES = [...ENGINE_STATUSES];
const PROJECT_STATUS_SET = new Set(PROJECT_STATUSES);
// Statuses that are still running. Exported because the panel and the derived
// helpers both need the same answer, and two copies of this list would drift.
export const PROJECT_OPEN_STATUSES = new Set(OPEN_ENGINE_STATUSES);
const PROJECT_KIND_SET = new Set(["project", "operation"]);
// Whether an entry sourced from a spy can still be trusted. "" is the ordinary
// case and covers everything the player learned openly.
//
// All three are ENGINE-ONLY. "doubted" is stamped when the agent an entry was
// sourced from turns out to be compromised (projects.js spyIntelDoubtOps);
// "confirmed" and "refuted" once a FRESH agent of the knower's has reported from
// that polity, by whether the entry is real work or a belief (spyVerdictOps).
const PROJECT_VERIFICATIONS = ["", "doubted", "confirmed", "refuted"];
const PROJECT_VERIFICATION_SET = new Set(PROJECT_VERIFICATIONS);

const PROJECT_SECRECY_SET = new Set(["public", "restricted", "covert"]);

// Another government's knowledge of an entry, by knower: its agents' ids and
// its analysts' view (projects.js agentKnowledgeChanges). { knownBy } or none.
const normalizeProjectKnowledge = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const knownBy = {};
  for (const [name, known] of Object.entries(value).slice(0, 32)) {
    const knower = normalizeOptionalString(name);
    if (!knower || !known || typeof known !== "object") continue;
    const spyIds = normalizeIdList(known.spyIds, 12);
    const verification = PROJECT_VERIFICATION_SET.has(normalizeOptionalString(known.verification)) ? normalizeOptionalString(known.verification) : "";
    if (spyIds.length || verification) knownBy[knower] = { spyIds, ...(verification ? { verification } : {}) };
  }
  return Object.keys(knownBy).length ? { knownBy } : {};
};

// The board's closed values are read exactly, case and spacing aside, and a word
// that is none of them is LEFT OUT: the value it would have set stays as it was,
// and a new entry takes its default. Never guessed (the owner, 2026-11-13: "there
// should be absolutely no keywording done in this game anywhere").
const closedValue = (set) => (value) => {
  const raw = normalizeOptionalString(value).toLowerCase().replace(/\s+/g, " ");
  return set.has(raw) ? raw : "";
};

// "" for a status that is none of PROJECT_STATUSES (see closedValue above).
const resolveProjectStatus = closedValue(PROJECT_STATUS_SET);
// The old priority dial, read only to set a save's funding from it.
const resolveLegacyPriority = closedValue(new Set(["high", "normal", "low"]));

// How an owner funds a project (projectEngine.js FUNDING_LEVELS): what it pays a
// month and how fast the work goes. The one field the player sets on their own
// work, and what the old priority dial became.
export { FUNDING_LEVELS as PROJECT_FUNDING_LEVELS } from "./projectEngine.js";

// world.json is force-re-read every 5 seconds by TWO pollers (useWorldState and
// unitsController), so everything riding inside it is on a bandwidth budget.
// A forty-round game came back with 44 live projects at ~1 KB each; 120 leaves
// that campaign roughly 2.5x of headroom.
const MAX_PROJECTS = 120;
const MAX_PROJECT_EVENT_IDS = 12;

// What COMPLETING a project from before the engine does to the world: the same
// vocabulary as impacts.polityChanges / regionTransfers / regionClaims, applied
// through the same code path, once (onCompleteAppliedAt). A plan's own
// territory effects are released the same way (applyProjectOutcomesToWorld).
// null rather than an empty object when there is nothing: most projects have
// none, and world.json is re-read every five seconds.
const normalizeProjectOnComplete = (value) => {
  if (!value || typeof value !== "object") return null;

  const polityChanges = normalizeArray(value.polityChanges).map(normalizePolityChange).filter(Boolean).slice(0, 8);
  const regionTransfers = normalizeArray(value.regionTransfers).map(normalizeRegionTransfer).filter(Boolean).slice(0, 24);
  const regionClaims = normalizeArray(value.regionClaims).map(normalizeRegionClaim).filter(Boolean).slice(0, 24);

  if (polityChanges.length === 0 && regionTransfers.length === 0 && regionClaims.length === 0) return null;
  return { polityChanges, regionClaims, regionTransfers };
};

const normalizeProjectCoords = (value) => {
  if (!value || typeof value !== "object") return null;
  const lng = finiteOrNull(value.lng ?? value.lon ?? value.longitude);
  const lat = finiteOrNull(value.lat ?? value.latitude);
  // 0,0 is open ocean off Africa — the coordinate a model emits when it does not
  // actually know where something is. Same guard normalizeMarkerEntry uses.
  if (lng === null || lat === null || (lng === 0 && lat === 0)) return null;
  return { lng, lat };
};

const normalizeIdList = (value, limit) =>
  normalizeArray(value)
    .map((entry) => normalizeOptionalString(entry))
    .filter(Boolean)
    .filter((entry, index, list) => list.indexOf(entry) === index)
    .slice(0, limit);

const finiteAtLeastZero = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

// The next checkpoint still ahead of a project, from its plan: { title,
// atProgress } or null. Derived, never stored.
export const nextProjectMilestone = (project) => {
  const ahead = normalizeArray(project?.plan?.milestones).filter((entry) => !entry?.reached && !entry?.missed);
  return ahead.length ? { title: ahead[0].title, atProgress: ahead[0].atProgress } : null;
};

// Legacy records may lack an ID. A fresh random ID on EVERY world read makes
// canonical identity unstable, so construct a bounded, script-safe digest of
// established identifying facts. Do not seed with progress, status or funding:
// the clock must not change identity as it advances. Distinct otherwise-identical
// legacy entries get stable occurrence ordinals inside normalizeProjects.
const legacyProjectSeed = (entry, ownerScope = "") => JSON.stringify([
  nameKey(entry?.ownerCode || entry?.owner || entry?.code || ownerScope),
  nameKey(entry?.name || entry?.title || entry?.project),
  normalizeOptionalString(entry?.createdAt),
  normalizeOptionalString(entry?.startedAt || entry?.startDate || entry?.began),
  normalizeOptionalString(entry?.summary || entry?.description),
]);

const legacyProjectId = (entry, index = 0, ownerScope = "") =>
  `legacy-project-${nameId(`legacy-project|${legacyProjectSeed(entry, ownerScope)}|${index}`, () => "")}`;

export const normalizeProjectEntry = (entry, index = 0, { ownerScope = "" } = {}) => {
  if (!entry || typeof entry !== "object") return null;

  // The name IS the identity here, exactly as it is for markers and polities: it
  // is what the player reads, what the advisor says out loud, and what an op
  // targets. A nameless project is unaddressable.
  const name = normalizeOptionalString(entry.name || entry.title || entry.project);
  if (!name) return null;

  const kind = normalizeOptionalString(entry.kind || entry.type).toLowerCase();
  const secrecy = normalizeOptionalString(entry.secrecy || entry.classification).toLowerCase();
  const progressRead = Number(entry.progress);
  const updatedRound = Number(entry.updatedRound);
  const verification = PROJECT_VERIFICATION_SET.has(normalizeOptionalString(entry.verification))
    ? normalizeOptionalString(entry.verification)
    : "";

  // The status as written; "proposed", the old board's "agreed but not begun",
  // is a project the engine now simply works on.
  const written = normalizeOptionalString(entry.status).toLowerCase();
  let status = written === "proposed" ? "active" : resolveProjectStatus(entry.status) || "active";

  // The plan. An entry from before the engine has none, and is given one that
  // takes up where it stood (projectEngine.js legacyPlanFor). Only an entry
  // opened as "planning" waits for one.
  let plan = normalizeProjectPlan(entry.plan);
  // (Another country's entry from before the engine was on the player's board
  // because their services had learned of it: it stays known.)
  const fromBefore = !plan && status !== "planning";
  if (fromBefore) plan = legacyPlanFor(entry);
  if (plan && status === "planning") status = "active";

  // The funding, or the old priority dial read as one; a save's paused entry
  // is one its owner stopped paying for.
  let funding = resolveFunding(entry.funding)
    || (written === "paused" ? "none" : FUNDING_FROM_PRIORITY[resolveLegacyPriority(entry.priority)] || "normal");
  const open = PROJECT_OPEN_STATUSES.has(status);
  if (open && status !== "planning") {
    if (funding === "none") status = "paused";
    else if (status === "paused") status = "active";
  }
  if (status === "paused" && funding !== "none") funding = "none";

  // Why it stands still. A stall the old board's model declared was words, and
  // the engine now owns the clock: such an entry works again. So does one
  // stalled because another government's analysts doubted their source
  // ("blocked"): the doubt was theirs, and it stopped the owner's own work for
  // good (projects.js spyIntelDoubtOps no longer writes it).
  let stallReason = STALL_REASONS.includes(normalizeOptionalString(entry.stallReason)) ? normalizeOptionalString(entry.stallReason) : "";
  if (status === "stalled" && (!stallReason || stallReason === "blocked")) status = "active";
  if (status !== "stalled") stallReason = "";

  const ongoing = plan ? plan.ongoing === true : entry.ongoing === true || entry.ongoing === "true";
  const adjustments = normalizeArray(entry.adjustments).map(normalizeAdjustment).filter(Boolean).slice(-ADJUSTMENTS_KEPT);
  const costOverrun = Math.min(OVERRUN_TOTAL_MOST, finiteAtLeastZero(entry.costOverrun));
  const paidShare = Number(entry.paidShare);
  const yieldCarry = entry.yieldCarry && typeof entry.yieldCarry === "object" && !Array.isArray(entry.yieldCarry)
    ? Object.fromEntries(Object.entries(entry.yieldCarry).filter(([key, value]) => statMeasure(key) && Number.isFinite(Number(value)) && Number(value) !== 0).slice(0, 8).map(([key, value]) => [key, Number(value)]))
    : null;

  return {
    id: normalizeOptionalString(entry.id) || legacyProjectId(entry, index, ownerScope),
    name,
    kind: PROJECT_KIND_SET.has(kind) ? kind : "project",
    // Same owner namespace as units, markers and every other polity-keyed field:
    // a country NAME, verbatim. Blank means the player.
    ownerCode: toCountryName(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code)),
    summary: normalizeTextLike(entry.summary || entry.description),
    status,
    stallReason,
    funding,
    // How far along it is, the engine's (projectEngine.js roundProgress: a
    // ten-year programme moves a few hundredths a day).
    progress: Number.isFinite(progressRead) ? roundProgress(Math.max(0, Math.min(100, progressRead))) : 0,
    plan,
    tags: normalizeTagList(entry.tags),
    secrecy: PROJECT_SECRECY_SET.has(secrecy) ? secrecy : "public",
    startedAt: canonicalizeDateString(entry.startedAt || entry.startDate || entry.began),
    ongoing,
    // When the engine expects it done at the pace it is going (projectEngine.js
    // expectedFinish); none for a programme that runs on.
    targetDate: ongoing ? "" : canonicalizeDateString(entry.targetDate || entry.dueDate || entry.completionDate),
    // What the owner has paid for it so far, and the share of its due it was
    // paid over the last period (1: in full).
    spent: finiteAtLeastZero(entry.spent),
    paidShare: Number.isFinite(paidShare) ? Math.max(0, Math.min(1, paidShare)) : 1,
    starvedDays: Math.trunc(finiteAtLeastZero(entry.starvedDays)),
    costOverrun,
    adjustments,
    // A programme that runs on is set up when its work reaches 100, and from then
    // on pays its yields every month it is paid for (yieldDays / yieldShare are
    // the month in progress).
    established: ongoing && entry.established === true,
    yieldDays: Math.trunc(finiteAtLeastZero(entry.yieldDays)),
    yieldShare: finiteAtLeastZero(entry.yieldShare),
    lastYieldAt: canonicalizeDateString(entry.lastYieldAt),
    // The fractions of a point a programme's monthly yields have banked, by stat
    // (gameState.js applyProjectOutcomesToWorld).
    ...(yieldCarry && Object.keys(yieldCarry).length ? { yieldCarry } : {}),
    completedAt: canonicalizeDateString(entry.completedAt),
    // The one-way latch that makes a completion's effects land exactly ONCE
    // (applyProjectOutcomesToWorld): the date they were applied.
    effectsAppliedAt: normalizeOptionalString(entry.effectsAppliedAt),
    lastUpdate: normalizeTextLike(entry.lastUpdate),
    // A project from before the engine whose completion changes the map or a
    // polity (normalizeProjectOnComplete); null for the great majority.
    onComplete: normalizeProjectOnComplete(entry.onComplete || entry.completionEffects),
    onCompleteAppliedAt: normalizeOptionalString(entry.onCompleteAppliedAt),
    // Newest first: the activity feed reads top-down, so the cap must drop the
    // oldest entry rather than the most recent one.
    eventIds: normalizeIdList(entry.eventIds, MAX_PROJECT_EVENT_IDS),
    linkedUnitIds: normalizeIdList(entry.linkedUnitIds, 12),
    linkedMarkerIds: normalizeIdList(entry.linkedMarkerIds, 12),
    // The agent an entry is sourced from: the operation a spy IS (spyOperationOps)
    // or the foreign programme a spy told us about (spyProvenanceOps).
    linkedSpyIds: normalizeIdList(entry.linkedSpyIds, 12),
    verification,
    // A foreign project the player's services know of whatever its secrecy
    // (an agent told of it, or the board had it before the engine): the
    // panel's "Known projects abroad" (projects.js isKnownToPlayer).
    known: entry.known === true || (fromBefore && Boolean(normalizeOptionalString(entry.ownerCode || entry.owner || entry.code))),
    // What other governments' services know of it, each its own (projects.js
    // knowledgeOf), and, only in a time skip's own copy of the world, whose
    // board it was lent from (runtime/seatBoards.js lendBoards).
    ...normalizeProjectKnowledge(entry.knownBy),
    ...(normalizeOptionalString(entry.lentFrom) ? { lentFrom: normalizeOptionalString(entry.lentFrom) } : {}),
    // No country's work but what its board's government was made to believe by
    // material planted on its turned agent (projectEngine.js isBelief), and,
    // only in the time skip that opened it, whose service that is
    // (runtime/seatBoards.js returnBoards takes it home).
    ...(entry.belief === true ? { belief: true } : {}),
    ...(normalizeOptionalString(entry.believedBy) ? { believedBy: normalizeOptionalString(entry.believedBy) } : {}),
    focus: normalizeProjectCoords(entry.focus),
    // kw5-units: how an operation's troops attack its focus (runtime/fronts/plans.js
    // operationsOn), one of OPERATION_APPROACHES; absent on every other entry, and
    // an operation that says none is an advance.
    ...(OPERATION_APPROACHES.includes(normalizeOptionalString(entry.approach).toLowerCase()) ? { approach: normalizeOptionalString(entry.approach).toLowerCase() } : {}),
    note: normalizeTextLike(entry.note),
    // Migration cannot assert when a historical project was created or last
    // touched. Only real creation/update commands stamp the present time.
    createdAt: normalizeOptionalString(entry.createdAt),
    updatedAt: normalizeOptionalString(entry.updatedAt),
    updatedRound: Number.isFinite(updatedRound) && updatedRound > 0 ? Math.trunc(updatedRound) : 0,
  };
};

// An old save can contain more than the board can safely carry. Truncation
// irreversibly deleted projects during every read->write normalization, even
// *active* work. Do not invent an archive, discard IDs, or bypass the 120-row
// live-board invariant. Reject the mutation with a typed, actionable error;
// the original save remains intact for a deliberate lossless migration.
// What other players lent a time skip's own copy of the board (lentFrom,
// runtime/seatBoards.js) is theirs, goes home with the turn and is never
// stored here: it counts toward no cap. Counted, it took the room of the
// board's own history, or was itself left out of the skip.
export class ProjectBoardOverflowError extends RangeError {
  constructor(count, active) {
    super(`Project board limit ${MAX_PROJECTS} exceeded: ${count} records (${active} active). No projects were discarded. The original save must be migrated before continuing.`);
    this.name = "ProjectBoardOverflowError";
    this.code = "PROJECT_BOARD_OVER_CAPACITY";
    this.limit = MAX_PROJECTS;
    this.count = count;
    this.active = active;
  }
}

const capProjectList = (list) => {
  const kept = list.filter((project) => !project.lentFrom);
  if (kept.length > MAX_PROJECTS) {
    throw new ProjectBoardOverflowError(
      kept.length,
      kept.filter((project) => PROJECT_OPEN_STATUSES.has(project.status)).length,
    );
  }
  return list;
};

export class ProjectBoardIdCollisionError extends Error {
  constructor(projectId) {
    super(`Project board contains multiple records with the same canonical ID "${projectId}". No records were discarded. Resolve this identity collision before continuing.`);
    this.name = "ProjectBoardIdCollisionError";
    this.code = "PROJECT_ID_COLLISION";
    this.projectId = projectId;
  }
}

// Recovery inspection may IDENTIFY all rows of an older board without
// normalizing it into a playable world. This does not waive the 120-row cap:
// only normalizeProjects is permitted to feed a canonical game writer.
export const inspectLegacyProjectEntries = (projects, { ownerScope = "" } = {}) => {
  const seenLegacy = new Map();
  const normalized = normalizeArray(projects)
    .map((entry) => {
      if (normalizeOptionalString(entry?.id)) return normalizeProjectEntry(entry);
      const seed = legacyProjectSeed(entry, ownerScope);
      const ordinal = seenLegacy.get(seed) ?? 0;
      seenLegacy.set(seed, ordinal + 1);
      return normalizeProjectEntry(entry, ordinal, { ownerScope });
    })
    .filter(Boolean);

  const seenIds = new Set();
  for (const project of normalized) {
    if (seenIds.has(project.id)) throw new ProjectBoardIdCollisionError(project.id);
    seenIds.add(project.id);
  }
  return normalized;
};

export const normalizeProjects = (projects, options) =>
  capProjectList(inspectLegacyProjectEntries(projects, options));

// Explicitly shelved historical projects retain their COMPLETE source record.
// This is a separate, bounded recovery shelf, not a second live board. Its
// contents never tick or spend, and cannot be made active without an available
// place under the ordinary 120-project cap. Do not flatten it into world.projects.
export const MAX_PROJECT_RECOVERY_ARCHIVE = 512;

export class ProjectRecoveryArchiveError extends RangeError {
  constructor(message) {
    super(message);
    this.name = "ProjectRecoveryArchiveError";
    this.code = "PROJECT_RECOVERY_ARCHIVE_INVALID";
  }
}

export const normalizeProjectRecoveryArchive = (entries, { activeIds = [] } = {}) => {
  if (!Array.isArray(entries) || entries.length > MAX_PROJECT_RECOVERY_ARCHIVE) {
    throw new ProjectRecoveryArchiveError(
      `Project recovery archive must be an array of at most ${MAX_PROJECT_RECOVERY_ARCHIVE} records; no records were discarded.`,
    );
  }
  const seenIds = new Set(activeIds);
  return entries.map((entry) => {
    const id = normalizeOptionalString(entry?.id);
    const project = entry?.project;
    if (!id || !project || typeof project !== "object" || Array.isArray(project)
        || normalizeOptionalString(project.id) !== id || seenIds.has(id)) {
      throw new ProjectRecoveryArchiveError(
        `Invalid or duplicate project recovery archive identity "${id || "(missing)"}"; no records were discarded.`,
      );
    }
    seenIds.add(id);
    // Preserve raw source fields, not just today's normalized project fields:
    // older exported saves may carry provenance no current UI understands.
    const board = normalizeOptionalString(entry.board) || "world";
    if (board !== "world" && !board.startsWith("seat:")) {
      throw new ProjectRecoveryArchiveError(`Invalid recovery board reference "${board}".`);
    }
    return {
      ...entry,
      id, board, project,
      shelvedAt: normalizeOptionalString(entry.shelvedAt),
      priorStatus: normalizeOptionalString(entry.priorStatus),
    };
  });
};

// The board's size limit, exported so the panel can warn the player as they
// approach it instead of work quietly vanishing.
export const PROJECT_BOARD_LIMIT = MAX_PROJECTS;

// Which raw keys map onto each field a create may carry, so a create naming an
// entry that already exists (a restatement) changes only what it said.
const PROJECT_FIELD_ALIASES = {
  name: ["name", "title", "project"],
  kind: ["kind", "type"],
  ownerCode: ["ownerCode", "owner", "code"],
  summary: ["summary", "description"],
  tags: ["tags"],
  secrecy: ["secrecy", "classification"],
  lastUpdate: ["lastUpdate"],
  linkedUnitIds: ["linkedUnitIds"],
  linkedMarkerIds: ["linkedMarkerIds"],
  linkedSpyIds: ["linkedSpyIds"],
  verification: ["verification"],
  focus: ["focus"],
  approach: ["approach"],
  note: ["note"],
  plan: ["plan"],
  funding: ["funding"],
  // A time skip's create of a programme that exists only in material planted
  // on a service: that service (projectEngine.js isBelief). Never a
  // restatement's to add to an entry that exists.
  believedBy: ["believedBy"],
};

// A plain ARRAY, not a Set: normalized ops are persisted inside events.json and
// replayed by the staged reveal, so this has to survive a JSON round trip.
const providesField = (field, value) => value !== undefined && (field !== "funding" || Boolean(resolveFunding(value)));
const listProvidedFields = (source) => {
  if (!source || typeof source !== "object") return [];
  return Object.entries(PROJECT_FIELD_ALIASES)
    .filter(([field, aliases]) => aliases.some((alias) => providesField(field, source[alias])))
    .map(([field]) => field);
};

// One change to the projects board, from outside the engine.
//
//   create    opens an effort, with its plan (a time skip's for a country
//             nobody plays, the planner's, the advisor's), or with none: it
//             then waits in "planning" for one;
//   update    what it IS (summary, tags, secrecy, a new name, the lastUpdate
//             line), how it is funded, or the plan of one still planning.
//             Never its progress, status or dates, nor what anyone knows of
//             it (a verdict on doubted intelligence): those are the engine's;
//   setback   an event set it back: days of work lost (at most
//             SETBACK_DAYS_MOST) and a cost overrun (at most
//             OVERRUN_PERCENT_MOST %), taking hold from the next period;
//   boost     an event brought it on: days of work gained (BOOST_DAYS_MOST);
//   cancel / fail   it ended: it stays on the board under Closed;
//   close     the form cancel and fail are stored in (events.json is replayed
//             through here, so every op this returns must survive it again).
// Nothing else is read as one of them, in any language: an op outside these
// words is left out. PROJECT_OPS is the list the turn's validation says.
export const PROJECT_OPS = Object.freeze(["create", "update", "setback", "boost", "cancel", "fail", "close"]);
export const projectOpKind = (entry) => {
  const op = normalizeOptionalString(entry?.op || entry?.action).toLowerCase();
  return PROJECT_OPS.includes(op) ? op : "";
};
const normalizeProjectOp = (entry) => {
  if (!entry || typeof entry !== "object") return null;

  const op = projectOpKind(entry);
  const projectId = normalizeOptionalString(entry.projectId || entry.id);
  const name = normalizeOptionalString(entry.name || entry.project || entry.title);

  if (op === "create") {
    // The payload may be nested under `project` or inlined on the op itself.
    // What other governments know of an entry, and where a skip lent it from,
    // are never a create's to say (the engine keeps both).
    const { knownBy: _knownBy, lentFrom: _lentFrom, ...source } = entry.project && typeof entry.project === "object" ? entry.project : entry;
    // A create opens an entry with no progress of its own and no plan it has not
    // been given: "planning" when it carries none. It carries what a government
    // gives a new effort (PROJECT_FIELD_ALIASES), its id, and nothing of what the
    // engine records of one under way: never that it is set up already, done,
    // paid or yielding, nor a completion of its own that moves a border or a
    // polity (onComplete is a save's from before the engine). It was read with
    // the reader of the board's own saved entries, so a writer's create that
    // said so was a programme set up from its first day, or one that dissolved
    // a country when it completed (the review of 2026-11-18).
    const given = Object.fromEntries(["id", "priority", ...Object.values(PROJECT_FIELD_ALIASES).flat()]
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]));
    const planned = normalizeProjectPlan(source.plan);
    const project = normalizeProjectEntry({
      ...given,
      progress: 0,
      status: planned ? "active" : "planning",
      plan: planned,
      adjustments: [],
      spent: 0,
      // When it should be done is the engine's to say, from its plan.
      targetDate: "",
    }, 0);
    if (!project) return null;
    // Re-normalizing an op that has already been through here (events.json is
    // replayed by the staged reveal) must not widen the field list to everything.
    const provided = Array.isArray(entry.provided) ? entry.provided : listProvidedFields(source);
    return { op: "create", project, provided };
  }

  if (!projectId && !name) return null;

  if (op === "update") {
    return { op: "update", projectId, name, patch: entry.patch ?? entry.project ?? entry };
  }

  if (op === "setback" || op === "boost") {
    // Read back from its own normalized form too (events.json is replayed through here).
    const source = entry.adjustment && typeof entry.adjustment === "object" ? entry.adjustment : entry;
    const adjustment = normalizeAdjustment({ ...source, kind: op });
    if (!adjustment) return null;
    return { op, projectId, name, adjustment, note: normalizeOptionalString(entry.note || entry.lastUpdate) };
  }

  if (op === "close") {
    const status = resolveProjectStatus(entry.status);
    // Only an ending the story may give: the engine alone completes a project.
    if (status !== "failed" && status !== "cancelled") return null;
    return { op: "close", status, projectId, name, note: normalizeOptionalString(entry.note) };
  }

  if (op === "cancel") return { op: "close", status: "cancelled", projectId, name, note: normalizeOptionalString(entry.note) };
  if (op === "fail") return { op: "close", status: "failed", projectId, name, note: normalizeOptionalString(entry.note) };

  return null;
};

// Fields an `update` op may change: what a project IS, and its links. Not its
// progress, status, dates or effects: those are the engine's. Note the absence
// of `name`: an update carries the name it was matched BY, so renaming goes
// through an explicit `newName`.
const PROJECT_PATCHABLE_FIELDS = [
  "kind", "summary", "secrecy", "lastUpdate", "note", "focus", "approach",
  "linkedUnitIds", "linkedMarkerIds", "linkedSpyIds",
];
// And what only the engine's own ops may set: applyProjectOps ctx.engine. (A
// doubt about where intelligence came from is never a stall: it is the
// knower's, projects.js spyIntelDoubtOps; and so is the verdict on it,
// spyVerdictOps, which the model gave until the engine knew what was real.)
const ENGINE_PATCHABLE_FIELDS = ["status", "stallReason", "known", "verification"];

const patchedAlias = (patch, field) => {
  const aliases = PROJECT_FIELD_ALIASES[field] ?? [field];
  return aliases.find((alias) => patch[alias] !== undefined) ?? "";
};

// Which project an op is addressing: id first, then its name, case and accents
// aside — the model reliably knows what it called something and only sometimes
// the id. An id that names nothing on the board does not hide a name that does:
// "the op on a wrong id with the right name was dropped" (2026-11-15).
//
// Last, the name as a prompt might DISPLAY it: a model copies a whole title,
// quotes and a label word in front included ('Operation "Standing Watch"').
const DISPLAYED_PROJECT_TITLE = /^(?:[^\s"«“„]+\s+)?["«“„](.+)["»”“]$/u;

export const findProjectIndexForOp = (list, op, { owner = null, host = "" } = {}) => {
  const sameOwner = (project) => {
    if (owner === null) return true;
    const actual = normalizeOptionalString(project.ownerCode);
    const wanted = normalizeOptionalString(owner);
    return wanted
      ? Boolean(actual && samePolityName(actual, wanted))
      : !actual || Boolean(host && samePolityName(actual, host));
  };
  if (op.projectId) {
    const byId = list.findIndex((project) => project.id === op.projectId);
    if (byId !== -1 && sameOwner(list[byId])) return byId;
  }
  if (!op.name) return -1;
  // Name-only operations are a compatibility fallback, never an invitation to
  // mutate the first of several identically named programmes. Create operations
  // additionally scope the fallback to the intended owner.
  const bare = op.name.trim().match(DISPLAYED_PROJECT_TITLE)?.[1]?.trim();
  const candidates = [op.name, bare].filter(Boolean);
  const matches = list.map((project, index) => ({ project, index }))
    .filter(({ project }) => candidates.some((name) => samePolityName(project.name, name)))
    .filter(({ project }) => sameOwner(project));
  return matches.length === 1 ? matches[0].index : -1;
};

// Fold a project op's owner name onto the polity it actually names, before the op
// is matched or applied: a foreign power's programme must land on the SAME
// identity as its territory, its units and its colour.
const resolveProjectOpOwner = (raw, resolveOwner) => {
  if (!raw || typeof raw !== "object") return raw;
  const nested = raw.project && typeof raw.project === "object";
  const source = nested ? raw.project : raw;
  const alias = PROJECT_FIELD_ALIASES.ownerCode.find((key) => normalizeOptionalString(source[key]));
  if (!alias) return raw;
  const owner = resolveOwner(source[alias]);
  if (!owner || owner === source[alias]) return raw;
  return nested
    ? { ...raw, project: { ...raw.project, [alias]: owner } }
    : { ...raw, [alias]: owner };
};

// Apply a batch of project ops (pure).
//
// `ctx`:
//   date, eventId, round   the event that caused the change: stamps the activity
//                          feed, dates a new entry, and dates an adjustment;
//   boundPlan(plan, owner) holds a new plan to its owner's means
//                          (projectEngine.js boundPlanForOwner); identity where
//                          the caller has no world to read;
//   engine                 the engine's own ops (the covert-operation sync and
//                          the doubt), which may also set a status.
export const applyProjectOps = (projects, ops, ctx = {}) => {
  const { date = "", eventId = "", round = 0, engine = false, host = "", boundPlan = (plan) => plan, onRefusal = () => {} } = ctx;
  const stamp = new Date().toISOString();
  let next = normalizeProjects(projects);

  const indexOf = (op) => findProjectIndexForOp(next, op);
  const withPlan = (project) => {
    if (!project.plan) return project;
    const bounded = boundPlan(project.plan, normalizeOptionalString(project.ownerCode));
    return bounded ? { ...project, plan: bounded } : { ...project, plan: null, status: "planning" };
  };

  // Every mutation routes through here so the "when did this last move" fields
  // and the activity feed cannot be updated in one branch and forgotten in
  // another.
  const touch = (project) => ({
    ...project,
    updatedAt: stamp,
    updatedRound: round > 0 ? round : project.updatedRound,
    eventIds: eventId
      ? [eventId, ...project.eventIds.filter((id) => id !== eventId)].slice(0, MAX_PROJECT_EVENT_IDS)
      : project.eventIds,
  });
  const renormalize = (project, index) => {
    const normalized = normalizeProjectEntry(project, index);
    return normalized ? { ...normalized, id: project.id, createdAt: project.createdAt } : null;
  };

  // Normalize defensively. Ops arriving from applyEventImpactsToWorld have been
  // through normalizeEventImpacts already, but the advisor feeds this function a
  // freshly parsed ```projects block that has not, and normalizeProjectOp is
  // idempotent.
  for (const raw of normalizeArray(ops)) {
    const op = normalizeProjectOp(raw);
    if (!op) continue;
    if (op.op === "create") {
      const existingIndex = findProjectIndexForOp(next, {
        projectId: op.project.id, name: op.project.name,
      }, { owner: op.project.ownerCode, host });
      if (existingIndex !== -1) {
        // Re-announcing a running project is a restatement, not a second one:
        // only what it said is taken, and never its progress or its course. A
        // plan is taken only by an entry still waiting for one.
        const existing = next[existingIndex];
        const merged = { ...existing };
        for (const field of op.provided ?? []) {
          if (field === "name" || field === "ownerCode" || field === "believedBy") continue;
          if (field === "plan") {
            if (existing.status === "planning" && op.project.plan) Object.assign(merged, withPlan({ ...existing, plan: op.project.plan }), { status: "active", startedAt: existing.startedAt || date });
            continue;
          }
          merged[field] = op.project[field];
        }
        const normalized = renormalize(merged, existingIndex);
        if (normalized) next = next.map((project, index) => (index === existingIndex ? touch(normalized) : project));
        continue;
      }
      // IDs cannot be recycled across owners, and a name-only create must not
      // guess which of two same-owner entries it is restating.
      const ambiguousName = next.filter((project) => findProjectIndexForOp(
        [project], { name: op.project.name }, { owner: op.project.ownerCode, host },
      ) !== -1).length > 1;
      if (ambiguousName || next.some((project) => project.id === op.project.id)) {
        onRefusal(op.project.id, ambiguousName ? "ambiguous project title" : "duplicate project ID");
        continue;
      }
      // Reject a new entry while the canonical board is full. Never report a
      // successful create that a later normalization will silently evict.
      // (What other players lent the skip counts toward no cap: capProjectList.)
      if (next.filter((project) => !project.lentFrom).length >= MAX_PROJECTS) {
        onRefusal(op.project.id, "project board is full");
        continue;
      }
      next = [...next, touch(withPlan({
        ...op.project,
        startedAt: op.project.startedAt || date,
        createdAt: stamp,
      }))];
      continue;
    }

    // An op against a project that does not exist is dropped rather than
    // creating one: a phantom project spawned from a typo is worse than a
    // missed update.
    const index = indexOf(op);
    if (index === -1) continue;
    const current = next[index];

    if (op.op === "update") {
      const patch = op.patch && typeof op.patch === "object" ? op.patch : {};
      const merged = { ...current };
      for (const field of [...PROJECT_PATCHABLE_FIELDS, ...(engine ? ENGINE_PATCHABLE_FIELDS : [])]) {
        // Written under the CANONICAL key whichever alias carried it.
        const alias = patchedAlias(patch, field);
        if (alias && providesField(field, patch[alias])) merged[field] = patch[alias];
      }
      const renamed = normalizeOptionalString(patch.newName || patch.rename);
      if (renamed) merged.name = renamed;
      if (Array.isArray(patch.tags)) merged.tags = patch.tags;
      // How it is funded: its owner's choice, on an open entry with a plan.
      const funding = resolveFunding(patch.funding);
      if (funding && current.plan && PROJECT_OPEN_STATUSES.has(current.status)) {
        merged.funding = funding;
        if (funding === "none") merged.status = "paused";
        else if (current.status === "paused") merged.status = "active";
      }
      // A plan, for an entry still waiting for one.
      if (current.status === "planning" && patch.plan && typeof patch.plan === "object") {
        const planned = normalizeProjectPlan(patch.plan);
        if (planned) Object.assign(merged, withPlan({ ...merged, plan: planned }), { status: "active", startedAt: current.startedAt || date });
      }
      const normalized = renormalize(merged, index);
      if (!normalized) continue;
      next = next.map((project, i) => (i === index ? touch(normalized) : project));
      continue;
    }

    if (op.op === "setback" || op.op === "boost") {
      // Only on work the engine is still doing (a belief is nobody's work).
      if (!PROJECT_OPEN_STATUSES.has(current.status) || !current.plan || isBelief(current)) continue;
      const adjustment = { ...op.adjustment, round: round > 0 ? round : op.adjustment.round, date: date || op.adjustment.date, ...(op.note ? { note: op.note } : {}) };
      const normalized = renormalize({
        ...current,
        adjustments: [...current.adjustments, adjustment],
        lastUpdate: op.note || current.lastUpdate,
      }, index);
      if (normalized) next = next.map((project, i) => (i === index ? touch(normalized) : project));
      continue;
    }

    if (op.op === "close") {
      if (!PROJECT_OPEN_STATUSES.has(current.status)) continue;
      // A checkpoint still ahead of a project that has ended is one it missed.
      const plan = current.plan
        ? { ...current.plan, milestones: current.plan.milestones.map((entry) => (entry.reached ? entry : { ...entry, missed: true })) }
        : null;
      next = next.map((project, i) => (i === index
        ? touch({
          ...project,
          status: op.status,
          stallReason: "",
          plan,
          completedAt: date || project.completedAt,
          lastUpdate: op.note || project.lastUpdate,
        })
        : project));
    }
  }

  return next;
};

// One AI-authored mutation to the unit list: spawn | move | strength | remove.
// Why normalizeUnitOp refused an entry, in words a player can paste into a bug
// report. Mirrors the checks below — keep the two in step.
const describeUnitOpRejection = (entry) => {
  if (!entry || typeof entry !== "object") return "not an object";
  const op = normalizeOptionalString(entry.op).toLowerCase();
  if (!op) return "no op (expected spawn, move, strength or remove)";
  if (op === "spawn") {
    const unit = entry.unit ?? entry;
    if (!unit || typeof unit !== "object") return "spawn without a unit";
    const lng = finiteOrNull(unit.lng ?? unit.lon ?? unit.longitude);
    const lat = finiteOrNull(unit.lat ?? unit.latitude);
    if (lng === null || lat === null) {
      // The usual cause: a non-numeric coordinate ("37,06", "37.06°N") that JSON
      // carried through as a string and Number() turned into NaN.
      return `spawn has unusable coordinates (lng=${JSON.stringify(unit.lng)}, lat=${JSON.stringify(unit.lat)})`;
    }
    if (lng === 0 && lat === 0) return "spawn at 0,0 — the output template's placeholder, not a real position";
    if (!normalizeOptionalString(unit.ownerCode || unit.owner || unit.code)) return "spawn has no owner";
    return "spawn rejected";
  }
  if (!normalizeOptionalString(entry.unitId || entry.id)) return `${op} without a unitId`;
  if (op === "move") {
    const toLng = finiteOrNull(entry.toLng ?? entry.lng);
    const toLat = finiteOrNull(entry.toLat ?? entry.lat);
    if (toLng === null || toLat === null) return `move has unusable destination (toLng=${JSON.stringify(entry.toLng)}, toLat=${JSON.stringify(entry.toLat)})`;
    if (toLng === 0 && toLat === 0) return "move to 0,0 — the output template's placeholder, not a real position";
  }
  return `unknown op "${op}"`;
};

// Says once that a unit op was thrown away, and why.
//
// normalizeEvents runs over the same raw answer many times before it is
// applied: every ledger validator normalizes the events it is handed, and the
// later stages work on copies of them. Each pass said the same drop again, so
// one fleet with no coordinates was eighteen warnings in a player's log, which
// reads as eighteen lost units. A drop is remembered by the op and the event it
// rode on (its date and title: an event's id, and an op's place in its list,
// change between passes), so the same op written again in a later turn's event
// is a new drop and is said again.
const REPORTED_UNIT_OP_DROPS_LIMIT = 256;
const reportedUnitOpDrops = new Set();
const reportUnitOpDrop = (entry, index, event) => {
  let signature = null;
  try {
    signature = JSON.stringify([event?.date ?? "", event?.title ?? "", entry]);
  } catch {
    // Not serializable: said every time rather than never.
  }
  if (signature !== null) {
    if (reportedUnitOpDrops.has(signature)) return;
    // Bounded: past the limit the memory starts again, and a drop may repeat.
    if (reportedUnitOpDrops.size >= REPORTED_UNIT_OP_DROPS_LIMIT) reportedUnitOpDrops.clear();
    reportedUnitOpDrops.add(signature);
  }
  console.warn(`[ai] unitOps[${index}] dropped — ${describeUnitOpRejection(entry)}:`, entry);
};

// An op that names a place and has no coordinates yet is waiting to be placed,
// not broken. Every event of a time skip looks like this while it is being
// written: the panel shows the raw answer as it arrives ("Show time skip events
// as they are written"), and the engine turns `at` into a point only when the
// whole answer is validated (AI/gameplay.js resolvePlacements). A player's log
// (2026-10-12) said two squadrons were "dropped — spawn has unusable
// coordinates (lng=undefined, lat=undefined)" that were on the map a second
// later. The pass that places them says so itself when it cannot.
const awaitsPlacement = (entry) => {
  if (!entry || typeof entry !== "object") return false;
  const op = normalizeOptionalString(entry.op).toLowerCase();
  const none = (...values) => values.every((value) => value === undefined || value === null || value === "");
  if (op === "spawn") {
    const unit = entry.unit && typeof entry.unit === "object" ? entry.unit : entry;
    return none(unit.lng, unit.lon, unit.longitude, unit.lat, unit.latitude)
      && Boolean(normalizeOptionalString(unit.at ?? entry.at) || normalizeOptionalString(unit.regionId ?? entry.regionId));
  }
  if (op === "move") {
    return none(entry.toLng, entry.toLat, entry.lng, entry.lat)
      && Boolean(normalizeOptionalString(entry.at) || normalizeOptionalString(entry.regionId));
  }
  return false;
};

const normalizeUnitOp = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const op = normalizeOptionalString(entry.op).toLowerCase();
  const unitId = normalizeOptionalString(entry.unitId || entry.id);

  if (op === "spawn") {
    const unit = normalizeUnitEntry(entry.unit ?? entry, 0);
    if (!unit) return null;
    unit.source = "ai";
    return { op, unit };
  }

  if (!unitId) {
    return null;
  }

  if (op === "move") {
    const toLng = finiteOrNull(entry.toLng ?? entry.lng);
    const toLat = finiteOrNull(entry.toLat ?? entry.lat);
    if (toLng === null || toLat === null || (toLng === 0 && toLat === 0)) return null;
    const posture = normalizeOptionalString(entry.posture).toLowerCase();
    // The part of the way that is over water (unitMotion.js seaShareOf), when
    // the pass that placed the move worked it out.
    const seaShare = entry.seaShare === null || entry.seaShare === undefined ? null : finiteOrNull(entry.seaShare);
    return {
      op,
      unitId,
      toLng,
      toLat,
      ...(seaShare !== null ? { seaShare: Math.max(0, Math.min(1, seaShare)) } : {}),
      regionId: normalizeOptionalString(entry.regionId),
      // Re-posturing on the move is how "this force is now massing rather than
      // in transit" reaches the map without a second op.
      posture: UNIT_POSTURE_SET.has(posture) ? posture : "",
      note: normalizeOptionalString(entry.note),
    };
  }

  if (op === "strength") {
    // A refit: the formation's ships or equipment replaced, said by its new
    // make-up ("Made new ships ... the ship make-up list when clicked on still
    // show old ships", a player's report, 2026-11-09). A refit that gives no
    // strength keeps the one the formation has.
    const composition = normalizeOptionalString(entry.composition);
    const given = entry.strength !== undefined && entry.strength !== null && String(entry.strength).trim() !== "";
    if (composition && !given) return { op, unitId, strength: null, composition, note: normalizeOptionalString(entry.note) };
    // (Nor does one that says neither: a missing strength is unchanged, never 0, which destroys the formation.)
    if (!given) return null;
    return { op, unitId, strength: clampUnitStrength(entry.strength ?? 0), ...(composition ? { composition } : {}), note: normalizeOptionalString(entry.note) };
  }

  if (op === "remove") {
    return { op, unitId, note: normalizeOptionalString(entry.note) };
  }

  return null;
};

// The owner's known footprint: every point on the map that power visibly holds.
// Region polygons are not available in the runtime layer (loadRegionCatalog
// yields names and ids, no geometry), so this is built from the point data world
// state actually carries — their units and their structures — plus whatever
// extra anchors a caller can supply.
export const buildOwnerFootprint = (world, ownerCode, extraAnchors = []) => {
  const owner = toCountryName(normalizeOptionalString(ownerCode));
  if (!owner) return [];
  const sameOwner = (value) =>
    toCountryName(normalizeOptionalString(value)).toLowerCase() === owner.toLowerCase();

  const points = [];
  for (const unit of normalizeArray(world?.units)) {
    if (sameOwner(unit?.ownerCode) && Number.isFinite(unit?.lng) && Number.isFinite(unit?.lat)) {
      points.push({ lng: unit.lng, lat: unit.lat });
    }
  }
  for (const marker of normalizeArray(world?.markers)) {
    if (sameOwner(marker?.ownerCode) && Number.isFinite(marker?.lng) && Number.isFinite(marker?.lat)) {
      points.push({ lng: marker.lng, lat: marker.lat });
    }
  }
  for (const anchor of normalizeArray(extraAnchors)) {
    if (Number.isFinite(anchor?.lng) && Number.isFinite(anchor?.lat)) {
      points.push({ lng: anchor.lng, lat: anchor.lat });
    }
  }
  return points;
};

const nearestKm = (point, anchors) => {
  let best = Infinity;
  for (const anchor of anchors) {
    const distance = kmOnMap(point.lat, point.lng, anchor.lat, anchor.lng);
    if (distance < best) best = distance;
  }
  return best;
};

// Is a spawn supported by its owner's known footprint?
//
// The point is NOT to refuse implausible spawns. The unit layer is the player's
// intelligence picture, not ground truth: a submarine shadowing their fleet has
// been there for months, and the turn it appears is the turn they detected it.
// Refusing that would break exactly the stories worth telling. So nothing is ever
// dropped for being far from home — the distance only decides whether the unit is
// drawn as an established presence or an unconfirmed one.
//
// The threshold is "30 days of this type's travel", which makes it era- and
// type-aware off the same speed table for free: a modern navy reads as globally
// supported (~18,000 km, correct), a 1400 army does not (~420 km, also correct).
const isUnsupportedSpawn = (point, anchors, type, gameDate, era = null) => {
  // An unknown footprint is not a suspicious one — world.units is empty at the
  // start of most scenarios, and gating on that would ghost every first spawn.
  if (anchors.length === 0) return false;
  const radius = Math.max(600, Math.min(15000, maxTravelKm(type, gameDate, 30, { era })));
  return nearestKm(point, anchors) > radius;
};

// How many rounds a minted patrol order runs for before it lapses. Long enough
// that stating posture "patrol" once keeps a fleet on station for a good while,
// short enough that it does not circle the same water forever.
const PATROL_ORDER_ROUNDS = 12;

const UNIT_SYSTEM_SET = new Set(["beta", "classic"]);

// Bring standing orders back into the present after time passed under the old
// classic unit system (gone now; a save it last wrote still carries its stamp),
// which had no engine to advance or expire them.
//
// A patrol carries an ABSOLUTE expiry round, so ten rounds of classic play would
// leave every dormant patrol already past its untilRound — and the next beta jump
// would clear the lot at once, looking exactly like the orders had been lost when
// in fact they were preserved on disk the whole time. Rebasing gives each one the
// rest of its life from here instead. Move orders need nothing: they have no
// expiry and resume simply by being advanced again.
//
// `previousSystem` is the stamp the save carried BEFORE this turn, which the
// caller has to supply: by the time a world comes back from
// applyEventImpactsToWorld it has already been re-stamped "beta", so reading it
// off the world here would never fire.
//
// Idempotent, and a no-op unless the classic system is what last wrote the save.
export const resumeStandingOrders = (world, { round = 0, previousSystem = "" } = {}) => {
  if (previousSystem !== "classic" || !round) return world;
  const next = normalizeWorldState(world);
  const orders = next.pendingUnitOrders;
  if (orders.length === 0) return world;
  return {
    ...next,
    pendingUnitOrders: orders.map((order) =>
      (order.kind === "patrol" && order.untilRound && order.untilRound <= round
        ? { ...order, untilRound: round + PATROL_ORDER_ROUNDS }
        : order)),
  };
};

// Apply a batch of unit ops to a unit list AND the standing-order list (pure).
// Ops referencing unknown ids are silently ignored; units reduced to <=0 strength
// are dropped.
//
// context: { markers, gameDate, elapsedDays, round, extraAnchors, eventId }
//   elapsedDays === null | undefined  ->  no travel clamp (the old behaviour, and
//   what a non-Gregorian scenario date must fall back to).
// How many rounds a story ship stays on the map when no arrival removes it.
export const STORY_VESSEL_ROUNDS = 10;

// The unit on the map a spawned one already is: the same name and the same
// owner, folded. A unit with no name of its own ("Unit") is never matched.
const unitNameKey = (value) => normalizeOptionalString(value).toLowerCase().replace(/\s+/g, " ");
const sameFormationOnMap = (units, unit) => {
  const name = unitNameKey(unit?.name);
  const owner = unitNameKey(unit?.ownerCode);
  if (!name || name === "unit" || !owner) return null;
  return units.find((entry) => unitNameKey(entry.name) === name && unitNameKey(entry.ownerCode) === owner && entry.strength > 0) ?? null;
};

// A save that already has such a twin: a unit the AI raised with the name,
// owner and kind of one the player placed is that unit's copy, and is dropped;
// the player's own stays where the player put it.
export const withoutTwinsOfPlayerUnits = (units) => {
  const list = normalizeArray(units);
  const placed = new Set(list
    .filter((unit) => unit?.source === "player" && unitNameKey(unit?.name) && unitNameKey(unit?.name) !== "unit")
    .map((unit) => `${unitNameKey(unit.name)}|${unitNameKey(unit.ownerCode)}|${unitNameKey(unit.type)}`));
  if (placed.size === 0) return list;
  const kept = list.filter((unit) => unit?.source === "player"
    || !placed.has(`${unitNameKey(unit?.name)}|${unitNameKey(unit?.ownerCode)}|${unitNameKey(unit?.type)}`));
  return kept.length === list.length ? list : kept;
};

export const applyUnitOpBatch = (units, orders, ops, context = {}) => {
  const {
    gameDate = "", elapsedDays = null, round = 0, extraAnchors = [], eventId = "", era = null,
  } = context;
  let next = normalizeUnits(units);
  let nextOrders = normalizePendingUnitOrders(orders);
  const markers = normalizeArray(context.markers);
  // The scenario's own unit types (unitTypes.js): what a spawn may name, and how fast each moves.
  const unitTypes = normalizeUnitTypes(context.unitTypes);
  const stamp = () => new Date().toISOString();
  // Normalize defensively. Ops arriving from applyEventImpactsToWorld have been
  // through normalizeEventImpacts already (and normalizeUnitOp is idempotent),
  // but the idle pulse and tests hand us raw model output — and a raw spawn has
  // none of the unit fields this function reads.
  const batch = normalizeArray(ops).map((op) => normalizeUnitOp(op)).filter(Boolean);

  const dropOrder = (unitId) => {
    nextOrders = nextOrders.filter((order) => order.unitId !== unitId);
  };
  const upsertOrder = (order) => {
    nextOrders = [...nextOrders.filter((entry) => entry.unitId !== order.unitId), order];
  };

  for (const op of batch) {
    if (op.op === "spawn") {
      // Idempotent: skip a spawn whose unit id is already present, so a re-applied
      // op batch can't duplicate a unit (mirrors the event-restatement de-dup).
      const spawnId = op.unit?.id;
      if (spawnId && next.some((unit) => unit.id === spawnId)) continue;
      // Nor can it raise a second of a formation already there: a spawn named as
      // one of its owner's units on the map is that unit, said again. A player
      // marked his oil and gas sites with units ("GSI Arzew", "Hub Sud"), and
      // each skip that told of them raised a twin beside or far from it.
      if (sameFormationOnMap(next, op.unit)) continue;
      const unit = { ...op.unit };
      // One of the scenario's own unit types (unitTypes.js), named by its name or its id: the unit is of that type's
      // base kind, and a type its owner may not field is not raised at all. A type the scenario does not have is
      // no type: the unit is an ordinary one of the kind it was given.
      if (unit.unitType) {
        const unitType = unit.storyVessel ? null : findUnitType(unitTypes, unit.unitType);
        if (!unitType) delete unit.unitType;
        else if (!mayFieldUnitType(unitType, unit.ownerCode)) continue;
        else {
          unit.unitType = unitType.id;
          unit.type = unitType.base;
        }
      }
      // Nor of a kind the scenario fights without (the Wars feature): no air unit with air units off, no fleet
      // with navies off. (A story ship is no fleet: it is drawn, and guards nothing.)
      const wars = activeWars();
      const spawnType = String(unit.type ?? "").toLowerCase();
      if ((!wars.air && spawnType === "air") || (!wars.navies && spawnType === "naval" && !unit.storyVessel)) continue;

      // A story ship is a ship whatever the model called it, unlisted because
      // nothing guards it, and kept for STORY_VESSEL_ROUNDS at most.
      if (unit.storyVessel) {
        unit.type = "naval";
        unit.covert = true;
        unit.expiresRound = (Number(round) || 0) + STORY_VESSEL_ROUNDS;
      }
      const anchors = buildOwnerFootprint({ units: next, markers }, unit.ownerCode, extraAnchors);
      // Reach/supply feasibility: a spawn its owner could not support where the
      // model put it is downgraded rather than dropped.
      if (isUnsupportedSpawn(unit, anchors, unit.type, gameDate, era)) {
        // A fixed installation is the one thing that cannot simply be detected
        // into existence — it has to be built. Downgrade it to the troops it
        // would take rather than dropping the op, because a silently dropped op
        // leaves the event narrating a deployment the map never shows, which is
        // the failure describeUnitOpRejection exists to make visible.
        // (And a garrison of a type of the scenario's is no longer of that type.)
        if (unit.type === "garrison") {
          unit.type = "infantry";
          delete unit.unitType;
        }
        unit.covert = true;
        if (!unit.posture) unit.posture = "transit";
      }
      if (eventId && !unit.eventId) unit.eventId = eventId;
      next.push(unit);

      if (unit.posture === "patrol") {
        upsertOrder(
          normalizePendingUnitOrderEntry({
            unitId: unit.id,
            kind: "patrol",
            toLng: unit.lng,
            toLat: unit.lat,
            radiusKm: DEFAULT_PATROL_RADIUS_KM[unit.type] ?? 0,
            untilRound: round ? round + PATROL_ORDER_ROUNDS : 0,
            issuedRound: round,
          }),
        );
      }
      continue;
    }

    if (op.op === "move") {
      next = next.map((unit) => {
        if (unit.id !== op.unitId) return unit;
        // Garrisons are fixed by definition — a move op on one is a mistake, not
        // an order (the same doctrine buildMilitaryFeasibilityText already states).
        // Except while it is still a player's pending deployment: the request asks
        // the skip to "confirm it, reposition it, or reject it", and a move is how
        // it answers the first two. It is being sited, not marched, so it goes
        // straight to the spot and joins the order of battle. Ignoring it left a
        // garrison the story had deployed three times a translucent counter.
        if (unit.type === "garrison") {
          if (unit.status !== "pending" || !Number.isFinite(op.toLng) || !Number.isFinite(op.toLat)) return unit;
          dropOrder(unit.id);
          return {
            ...unit,
            lng: op.toLng,
            lat: op.toLat,
            regionId: op.regionId || unit.regionId,
            status: "idle",
            posture: op.posture || unit.posture,
            orderId: "",
            ...(eventId ? { eventId } : {}),
            updatedAt: stamp(),
          };
        }

        const posture = op.posture || unit.posture;
        // A redeployment or an advance, each at its own pace (unitMotion.js), and a unit of one of the scenario's
        // own types at its type's speed (unitTypes.js: 1 for every other).
        const budget =
          elapsedDays === null || elapsedDays === undefined
            ? Infinity
            : maxTravelKm(unit.type, gameDate, elapsedDays, {
              posture,
              era,
              seaShare: op.seaShare ?? null,
              remainingKm: kmOnMap(unit.lat, unit.lng, op.toLat, op.toLng),
            }) * unitFigures(unitTypes, unit).speed;
        const step = stepToward(unit, { lng: op.toLng, lat: op.toLat }, budget);

        if (step.arrived) {
          dropOrder(unit.id);
          if (posture === "patrol") {
            upsertOrder(
              normalizePendingUnitOrderEntry({
                unitId: unit.id,
                kind: "patrol",
                toLng: step.lng,
                toLat: step.lat,
                radiusKm: DEFAULT_PATROL_RADIUS_KM[unit.type] ?? 0,
                untilRound: round ? round + PATROL_ORDER_ROUNDS : 0,
                issuedRound: round,
              }),
            );
          }
        } else {
          // Too far for the time that has passed. Move as far as the unit could
          // actually get and keep a standing order to the FULL destination, so
          // the journey continues by itself next turn. This is what makes
          // over-long move ops safe for the model to write.
          upsertOrder(
            normalizePendingUnitOrderEntry({
              unitId: unit.id,
              kind: "move",
              toLng: op.toLng,
              toLat: op.toLat,
              note: op.note,
              issuedAt: gameDate,
              issuedRound: round,
              seaShare: op.seaShare ?? null,
            }),
          );
        }

        return {
          ...unit,
          lng: step.lng,
          lat: step.lat,
          regionId: op.regionId || unit.regionId,
          // Arrival is arrival, whatever the formation is there to do. This used
          // to read `step.arrived && posture === "patrol"`, so a unit that reached
          // its destination under any other posture was stamped "moving" — and
          // pruneSatisfiedUnitOrders then dropped the order, leaving nothing to
          // ever correct it. The counter kept its yellow moving ring for the rest
          // of the campaign, and the classic popup's Status row said "moving" for
          // a fleet sitting still.
          // Arriving under "assaulting" means the formation closed on the
          // objective and is in contact, so it reads "engaged" rather than idle —
          // the same state the classic Attack button sets locally. The AI still
          // owns the OUTCOME on a later turn (casualties, and a regionTransfer if
          // the province falls); this is only the unit's visible state meanwhile.
          // "engaged" is also protected from the volume cap, which is correct: a
          // formation in contact is not something to prune for headroom.
          status: step.arrived ? (posture === "assaulting" ? "engaged" : "idle") : "moving",
          posture,
          orderId: "",
          ...(eventId ? { eventId } : {}),
          updatedAt: stamp(),
        };
      });
      continue;
    }

    if (op.op === "strength") {
      next = next.map((unit) => {
        if (unit.id !== op.unitId) return unit;
        // (A refit that gave no strength keeps the formation's own.)
        const strength = op.strength === null ? unit.strength : op.strength;
        return {
          ...unit,
          strength,
          status: strength <= 0 ? "defeated" : unit.status,
          ...(op.composition ? { composition: op.composition } : {}),
          ...(eventId ? { eventId } : {}),
          updatedAt: stamp(),
        };
      });
      continue;
    }

    if (op.op === "remove") {
      next = next.filter((unit) => unit.id !== op.unitId);
      dropOrder(op.unitId);
    }
  }

  const survivors = next.filter((unit) => unit.strength > 0 && unit.status !== "defeated");
  return { units: survivors, orders: pruneSatisfiedUnitOrders(survivors, nextOrders) };
};

// A patrol's next point, on the ground its unit works: a fleet's at sea, a land
// formation's ashore. A fleet patrolling 250 km round a station off a coast was
// put down on land a week later (a fantasy scenario's Discord game,
// 2026-10-28): the ring took no notice of the map. Up to eight points of the
// ring are tried; when none is on its ground the unit stays on its station,
// which was placed on it. An air unit flies over both; without `onWater` the
// ring is used as drawn. The tries go round the ring an eighth at a time.
const PATROL_TRIES = 8;
const patrolPointOnItsGround = (unit, order, seed, onWater) => {
  const station = { lng: order.toLng, lat: order.toLat };
  const radius = order.radiusKm || DEFAULT_PATROL_RADIUS_KM[unit.type] || 0;
  const wantsWater = unit.type === "naval" ? true : unit.type === "air" ? null : false;
  if (typeof onWater !== "function" || wantsWater === null) return patrolPoint(station, radius, seed);
  for (let attempt = 0; attempt < PATROL_TRIES; attempt += 1) {
    const point = patrolPoint(station, radius, seed, { turn: attempt });
    if (onWater(point.lng, point.lat) === wantsWater) return point;
  }
  return patrolPoint(station, 0, seed);
};

// Whether advanceStandingOrders could ask `onWater` of this world: only a patrol does, and few worlds have one, so a
// caller with none to ask need not read the map for it (gameplay.js).
export const standingOrdersAskWater = (world) =>
  normalizePendingUnitOrders(world?.pendingUnitOrders).some((order) => order.kind === "patrol");

// Advance every standing order by the time that has passed. This is what makes
// units move realistically turn after turn without a single token being spent:
// a move order steps toward its destination at the unit's own pace, and a patrol
// order repositions deterministically around its station.
//   onWater(lng, lat)  whether a point is at sea (gameplay.js waterTestFor), so a
//                      patrol keeps to its own ground; without it, as drawn
export const advanceStandingOrders = (
  world,
  { fromDate, toDate, round = 0, tick = 0, skipUnitIds = [], movedAt = null, onWater = null } = {},
) => {
  const units = normalizeUnits(world?.units);
  const orders = normalizePendingUnitOrders(world?.pendingUnitOrders);
  if (orders.length === 0) return world;
  const unitTypes = normalizeUnitTypes(world?.unitTypes);

  const elapsed = daysBetweenDates(fromDate, toDate) ?? 0;
  const ordersByUnit = new Map(orders.map((order) => [order.unitId, order]));
  // Units the caller wants left alone entirely.
  const skip = new Set(normalizeArray(skipUnitIds));
  // Units an event MOVED this period (lastUnitMoveDates), with the date of their
  // last move: they already stepped once per event against that event's own
  // budget, so they are credited only the days after it. Skipping them outright
  // froze them for the rest of the jump, and a unit that only took losses or
  // reinforcements was skipped too.
  const lastMoved = movedAt instanceof Map ? movedAt : new Map(Object.entries(movedAt || {}));
  const expired = new Set();
  // Formations that marched in under posture "patrol" and arrived this turn:
  // they start working a station where they stand, as a unit that gets there
  // within the turn does (applyUnitOpBatch). Otherwise the move order was pruned
  // on arrival and the unit sat there reading "Patrolling" with no station and
  // no ring.
  const stations = new Map();
  const stamp = new Date().toISOString();

  const nextUnits = units.map((unit) => {
    const order = ordersByUnit.get(unit.id);
    if (!order || skip.has(unit.id)) return unit;

    if (order.untilRound && round > order.untilRound) {
      expired.add(order.id);
      return { ...unit, orderId: "", posture: "", status: "idle", updatedAt: stamp };
    }

    // The days left after this unit's last move, or the whole period. Moved on
    // its last day (or on a date that does not parse): nothing left to credit.
    const unitElapsed = lastMoved.has(unit.id) ? (daysBetweenDates(lastMoved.get(unit.id), toDate) ?? 0) : elapsed;
    if (lastMoved.has(unit.id) && unitElapsed <= 0) return unit;

    if (order.kind === "patrol") {
      const point = patrolPointOnItsGround(unit, order, `${unit.id}|${round}|${tick}`, onWater);
      return { ...unit, lng: point.lng, lat: point.lat, posture: "patrol", updatedAt: stamp };
    }

    if (unit.type === "garrison") return unit;
    const step = stepToward(
      unit,
      { lng: order.toLng, lat: order.toLat },
      // (A unit of one of the scenario's own types at its type's speed: unitTypes.js.)
      maxTravelKm(unit.type, toDate || fromDate, unitElapsed, {
        posture: unit.posture,
        era: eraSettingOf(world),
        seaShare: order.seaShare ?? null,
        remainingKm: kmOnMap(unit.lat, unit.lng, order.toLat, order.toLng),
      }) * unitFigures(unitTypes, unit).speed,
    );
    if (step.arrived && unit.posture === "patrol") stations.set(unit.id, { lng: step.lng, lat: step.lat, type: unit.type });
    return {
      ...unit,
      lng: step.lng,
      lat: step.lat,
      // On arrival the order is pruned below; the unit stops reading as "moving".
      status: step.arrived ? "idle" : "moving",
      updatedAt: stamp,
    };
  });

  const kept = orders
    .filter((order) => !expired.has(order.id))
    .map((order) => {
      const station = order.kind === "move" ? stations.get(order.unitId) : null;
      if (!station) return order;
      return normalizePendingUnitOrderEntry({
        unitId: order.unitId,
        kind: "patrol",
        toLng: station.lng,
        toLat: station.lat,
        radiusKm: DEFAULT_PATROL_RADIUS_KM[station.type] ?? 0,
        untilRound: round ? round + PATROL_ORDER_ROUNDS : 0,
        issuedRound: round,
      });
    })
    .filter(Boolean);
  return {
    ...world,
    units: nextUnits,
    pendingUnitOrders: pruneSatisfiedUnitOrders(nextUnits, kept),
  };
};

// The units a period's events MOVED, each with the date of its last move, for
// advanceStandingOrders' movedAt. Only a move op changes where a unit is (and a
// spawn puts one somewhere, so a unit raised mid-period is credited from then):
// a strength change or a removal does not, and counting them froze a fleet that
// only took attrition for the whole jump. An event with no date of its own
// counts as `fallbackDate` (the period's start).
export const lastUnitMoveDates = (events, fallbackDate = "") => {
  const moved = new Map();
  for (const event of normalizeArray(events)) {
    const date = normalizeOptionalString(event?.date) || normalizeOptionalString(fallbackDate);
    for (const op of normalizeArray(event?.impacts?.unitOps)) {
      if (op?.op !== "move" && op?.op !== "spawn") continue;
      const unitId = normalizeOptionalString(op.unitId || op.unit?.id);
      if (!unitId) continue;
      const previous = moved.get(unitId);
      if (previous === undefined || compareGameDates(date, previous) > 0) moved.set(unitId, date);
    }
  }
  return moved;
};

// Repair units that claim to be moving when nothing is moving them. This is a
// save repair, not a rule: both systems used to mint these and both are fixed at
// the source now.
//
//   * The old classic system teleported an in-leash move straight to its
//     destination and stamped "moving" on the unit standing on it, with no
//     engine that could ever clear it again.
//   * The beta move op used to read `step.arrived && posture === "patrol"`, so a
//     unit that arrived under any other posture was stamped "moving" — and
//     pruneSatisfiedUnitOrders then dropped its order, leaving nothing behind to
//     correct it (see applyUnitOpBatch).
//
// Either way the formation keeps its yellow moving ring on the map and reads
// "moving" in its popup for the rest of the campaign while it sits still.
//
// A unit is left alone whenever something can still move it: a standing order
// the beta engine is advancing, or a queued classic order the AI has yet to
// answer (`queuedUnitIds`, from the actions queue — a long-range move or an
// approach keeps its unit where it is BY DESIGN, so "moving" is true there and
// clearing it would delete real state). What is left has no motive force behind
// it at all, and is what it looks like: idle.
//
// Deliberately not run from normalizeWorldState, for the reason enforceUnitVolume
// documents below and one of its own: the actions queue is a different file, so a
// world normalizer cannot see the queued orders that make a "moving" unit honest.
// Pure and idempotent — returns the same world untouched when there is nothing to
// repair, so it is safe to run on load.
export const clearStaleUnitMotion = (world, { queuedUnitIds = [] } = {}) => {
  const units = normalizeUnits(world?.units);
  if (!units.some((unit) => unit.status === "moving")) return world;

  const ordered = new Set(
    normalizePendingUnitOrders(world?.pendingUnitOrders).map((order) => order.unitId),
  );
  const queued = new Set(
    normalizeArray(queuedUnitIds).map((id) => normalizeOptionalString(id)).filter(Boolean),
  );
  const isStale = (unit) =>
    unit.status === "moving" && !ordered.has(unit.id) && !queued.has(unit.id);
  if (!units.some(isStale)) return world;

  const stamp = new Date().toISOString();
  return {
    ...world,
    units: units.map((unit) =>
      (isStale(unit) ? { ...unit, status: "idle", orderId: "", updatedAt: stamp } : unit)),
  };
};

// A player deployment is placed "pending" and queued as a Deploy request action
// (unitsController.js deployUnit, whose unitRevert says "remove it" if the
// player deletes the request). The skip that resolves the request decides: a
// remove op rejects it, a move op relocates it — and whatever it left standing
// was accepted. Without this, nothing else ever made a pending unit real: only a
// move op cleared the status, a move on a garrison is ignored by design, and a
// fleet the story says arrived was a translucent counter for the rest of the
// campaign. `resolvedActions` are the planned actions this skip resolved.
//
// `queuedActions`, when given, is the whole queue the skip started from. A
// pending unit with no deploy request anywhere in it is an orphan: its request
// was answered and cleared before this confirmation existed, so nothing can
// ever answer it again, and a skip that resolved the queue takes it as
// accepted too. Seen in a live game (2026-09-21): a garrison placed in 2016 was
// still pending in 2019. Pure; returns the same world when there is nothing to
// confirm.
const deployRequestUnitIds = (actions) => new Set(
  normalizeArray(actions)
    .map((action) => normalizeUnitRevert(action?.unitRevert))
    .filter((revert) => revert?.remove)
    .map((revert) => revert.unitId),
);
export const confirmResolvedDeployments = (world, resolvedActions = [], { queuedActions = null } = {}) => {
  const requested = deployRequestUnitIds(resolvedActions);
  const stillRequested = queuedActions ? deployRequestUnitIds(queuedActions) : null;
  if (requested.size === 0 && !stillRequested) return world;
  const units = normalizeUnits(world?.units);
  const accepted = (unit) => unit.status === "pending"
    && (requested.has(unit.id) || Boolean(stillRequested && !stillRequested.has(unit.id)));
  if (!units.some(accepted)) return world;
  const stamp = new Date().toISOString();
  return {
    ...world,
    units: units.map((unit) => (accepted(unit) ? { ...unit, status: "idle", updatedAt: stamp } : unit)),
  };
};

// A structure the turn built for a Project joins that entry's linked structures
// (nativeStructureDirector.js), so the card can show it on the map. Only a link
// whose structure is really on the map now and whose entry still exists; an
// entry already holding its twelve keeps the ones it has.
export const linkStructuresToProjects = (world, links = []) => {
  const onMap = new Set(normalizeMarkers(world?.markers).map((marker) => marker.id));
  const adding = new Map();
  for (const link of normalizeArray(links)) {
    const markerId = normalizeOptionalString(link?.markerId);
    const projectId = normalizeOptionalString(link?.projectId);
    if (!markerId || !projectId || !onMap.has(markerId)) continue;
    adding.set(projectId, [...(adding.get(projectId) ?? []), markerId]);
  }
  if (adding.size === 0) return world;
  let changed = false;
  const projects = normalizeArray(world?.projects).map((project) => {
    const markerIds = adding.get(normalizeOptionalString(project?.id));
    if (!markerIds) return project;
    const linked = normalizeArray(project.linkedMarkerIds);
    const next = [...new Set([...linked, ...markerIds])].slice(0, 12);
    if (next.length === linked.length) return project;
    changed = true;
    return { ...project, linkedMarkerIds: next };
  });
  return changed ? { ...world, projects } : world;
};

// Keep the map legible. Applies to A.I. polities ONLY: the player's own forces
// are filtered out before anything is counted, so neither cap constrains them and
// their units never eat another power's headroom — the player manages their own
// order of battle by disbanding.
//
// Deliberately NOT run from normalizeWorldState: that runs on every read, and
// pruning there would delete units on a read racing a write and fight the map's
// 5s poll. Call it from the turn commit and the idle pulse instead.
// playerCodes: every polity a person plays, in a shared game
// (runtime/humanPolities.js humanCountriesOf); each one's units are exempt.
export const enforceUnitVolume = (world, { playerCode = "", playerCodes = [] } = {}) => {
  const units = normalizeUnits(world?.units);
  const players = new Set([playerCode, ...normalizeArray(playerCodes)]
    .map((code) => toCountryName(normalizeOptionalString(code)).toLowerCase())
    .filter(Boolean));
  const isPlayers = (unit) =>
    unit.source === "player" ||
    players.has(toCountryName(unit.ownerCode).toLowerCase());

  // A formation fighting on a battlefield is one of its side's troops there
  // (runtime/fronts/): it is not scenery to thin out, and it takes none of its
  // country's room on the map.
  const exempt = (unit) => isPlayers(unit) || Boolean(unit.committedTo);
  const mine = units.filter(exempt);
  const theirs = units.filter((unit) => !exempt(unit));
  if (theirs.length === 0) return world;

  // A total order, so the same world always prunes to the same list — a rollback
  // and re-run must not produce a different map.
  const significance = (a, b) =>
    b.strength - a.strength ||
    Number(a.covert) - Number(b.covert) ||
    String(a.createdAt).localeCompare(String(b.createdAt)) ||
    String(a.id).localeCompare(String(b.id));
  // Never prune a formation that is mid-fight or is a player deployment awaiting
  // adjudication — both are live story beats, not surplus scenery.
  const protectedUnit = (unit) => unit.status === "engaged" || unit.status === "pending";

  const byOwner = new Map();
  for (const unit of theirs) {
    const key = toCountryName(unit.ownerCode).toLowerCase();
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push(unit);
  }

  let survivors = [];
  for (const owned of byOwner.values()) {
    const keep = owned.filter(protectedUnit);
    const trimmable = owned.filter((unit) => !protectedUnit(unit)).sort(significance);
    survivors = survivors.concat(keep, trimmable.slice(0, Math.max(0, MAX_UNITS_PER_POLITY - keep.length)));
  }

  if (survivors.length > MAX_UNITS_GLOBAL) {
    const keep = survivors.filter(protectedUnit);
    const trimmable = survivors.filter((unit) => !protectedUnit(unit)).sort(significance);
    survivors = keep.concat(trimmable.slice(0, Math.max(0, MAX_UNITS_GLOBAL - keep.length)));
  }

  if (survivors.length === theirs.length) return world;

  const nextUnits = [...mine, ...survivors];
  return {
    ...world,
    units: nextUnits,
    pendingUnitOrders: pruneSatisfiedUnitOrders(
      nextUnits,
      normalizePendingUnitOrders(world?.pendingUnitOrders),
    ),
  };
};

// A chat an event opens is written as an opener — who speaks first and what they
// say (the jump's CHAT_OPENER schema) — and turned into a thread only when the
// turn is applied (gameplay.js buildGeneratedChat). The chat normalizer knows
// threads, not openers, and used to drop both fields, so every chat an event
// opened reached the turn with nothing to say and was never opened at all.
const normalizeCreatedChat = (entry, index) => {
  const chat = normalizeChatEntry(entry, index);
  if (!chat) return null;
  const openingMessage = normalizeOptionalString(entry?.openingMessage);
  const speaker = normalizeOptionalString(entry?.speaker);
  // A shared game's letter names the person it is written to (AI/sharedLetters.js).
  const to = normalizeOptionalString(entry?.to);
  return {
    ...chat,
    ...(openingMessage ? { openingMessage } : {}),
    ...(speaker ? { speaker } : {}),
    ...(to ? { to } : {}),
  };
};

const normalizePoliticalActorImpactOp = (entry) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const op = normalizeOptionalString(entry.op);
  const polityKey = normalizeOptionalString(entry.polityKey || entry.polity || entry.country);
  if (!op || !polityKey) return null;

  let argsJson = "";
  if (typeof entry.argsJson === "string") argsJson = entry.argsJson.trim();
  else if (entry.argsJson && typeof entry.argsJson === "object" && !Array.isArray(entry.argsJson)) {
    try { argsJson = JSON.stringify(entry.argsJson); } catch { argsJson = ""; }
  }
  // Native callers/tests may still use the direct operation shape. The provider
  // schema deliberately does not: argsJson keeps the jump schema compact.
  if (!argsJson) {
    const directArgs = Object.fromEntries(Object.entries(entry).filter(([key]) => ![
      "op", "polityKey", "polity", "country", "argsJson",
    ].includes(key)));
    if (Object.keys(directArgs).length) {
      try { argsJson = JSON.stringify(directArgs); } catch { argsJson = ""; }
    }
  }
  return { op, polityKey, argsJson };
};

const politicalActorOperationFromImpact = (entry, resolveOwner = (value) => value) => {
  const normalized = normalizePoliticalActorImpactOp(entry);
  if (!normalized) return { operation: null, error: "missing op or polityKey" };
  let args = {};
  if (normalized.argsJson) {
    try {
      const parsed = JSON.parse(normalized.argsJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { operation: null, error: "argsJson must decode to a JSON object" };
      }
      args = parsed;
    } catch (error) {
      return { operation: null, error: `argsJson is not valid JSON: ${error?.message || error}` };
    }
  }
  const polityKey = normalizeOptionalString(resolveOwner(normalized.polityKey) || normalized.polityKey);
  return { operation: { ...args, op: normalized.op, polityKey }, error: "" };
};

// `event`: the entry these impacts ride on, for the one thing said about them
// here (reportUnitOpDrop).
const normalizeEventImpacts = (value, event = null) => {
  if (!value || typeof value !== "object") {
    return {
      actionIds: [],
      createdChats: [],
      groupOps: [],
      institutionLifecycleOps: [],
      markerOps: [],
      polityChanges: [],
      politicalActorOps: [],
      projectOps: [],
      regionClaims: [],
      regionControlOps: [],
      regionTransfers: [],
      reports: [],
      spyOps: [],
      strikes: [],
      unitOps: [],
    };
  }

  return {
    actionIds: normalizeActionParticipants(value.actionIds),
    createdChats: normalizeArray(value.createdChats).map(normalizeCreatedChat).filter(Boolean),
    // Groups the event creates, changes or erases, and the regions they take or
    // lose (runtime/groups.js).
    groupOps: normalizeArray(value.groupOps).map(normalizeGroupOp).filter(Boolean),
    institutionLifecycleOps: normalizeArray(value.institutionLifecycleOps).map(normalizeInstitutionLifecycleImpactOp).filter(Boolean),
    markerOps: normalizeArray(value.markerOps).map(normalizeMarkerOp).filter(Boolean),
    polityChanges: normalizeArray(value.polityChanges).map(normalizePolityChange).filter(Boolean),
    politicalActorOps: normalizeArray(value.politicalActorOps).map(normalizePoliticalActorImpactOp).filter(Boolean),
    projectOps: normalizeArray(value.projectOps).map(normalizeProjectOp).filter(Boolean),
    regionClaims: normalizeArray(value.regionClaims).map(normalizeRegionClaim).filter(Boolean),
    regionControlOps: normalizeArray(value.regionControlOps).map(normalizeRegionControlOp).filter(Boolean),
    regionTransfers: normalizeArray(value.regionTransfers).map(normalizeRegionTransfer).filter(Boolean),
    // Documents the event writes or widens (runtime/reports.js).
    reports: normalizeArray(value.reports).map(normalizeReportOp).filter(Boolean),
    // The player's espionage orders this event carried (runtime/spycraft.js).
    // Kept on the stored event so a reloaded campaign can replay them.
    spyOps: normalizeArray(value.spyOps).map(normalizeSpyOp).filter(Boolean),
    // The missiles and bombing runs the event tells of, one line each as written (side~weapon~from~target~count~shot
    // down): placed and kept for the map by the turn (Game/AI/gameplay.js, runtime/strikes.js). A string of lines is
    // read as its lines.
    strikes: (Array.isArray(value.strikes) ? value.strikes : String(value.strikes ?? "").split(/\r?\n/))
      .map((line) => (typeof line === "string" ? line.replace(/\s+/g, " ").trim().slice(0, 300) : ""))
      .filter((line) => line.includes("~"))
      .slice(0, 8),
    // Say WHY a unit op was thrown away. A dropped op is the difference between an
    // event that narrates a deployment and troops that actually appear on the map,
    // and it used to vanish into .filter(Boolean) without a word — leaving no way
    // to tell "the model never emitted one" from "it emitted one we rejected".
    // Region transfers have logged their drops for a while; units now match.
    // Once per op, however many times its event is read (reportUnitOpDrop).
    unitOps: normalizeArray(value.unitOps)
      .map((entry, index) => {
        const normalized = normalizeUnitOp(entry);
        if (!normalized && !awaitsPlacement(entry)) reportUnitOpDrop(entry, index, event);
        return normalized;
      })
      .filter(Boolean),
  };
};

// Every family of operation an event's impacts can carry, from the normalizer
// itself, so a list built from it (the GM Console preview) cannot leave out a
// family added later.
export const EVENT_IMPACT_KEYS = Object.freeze(Object.keys(normalizeEventImpacts({})));

// An event's kind and a turn record's mode. A played-out scene was "catalyst"
// in both until interactive events were renamed (18 September 2026).
const normalizeRenamedKind = (value) => {
  const text = normalizeOptionalString(value);
  return text === "catalyst" ? "interactive" : text;
};

// Whether one polity may react to an event (processPendingEventOutreach,
// AI/gameplay.js) and what came of it: put on an event only by the Event Editor
// (GameUI/cheats.jsx). The normalizer used to return a fixed set of fields
// without it, so every read lost it: a queued reaction always found its event
// "disabled" and was cancelled, so none ever fired. (The line someone said, the
// Editor's other field, is read by eventQuote.js normalizeEventPresentation.)
const normalizeEventNpcReaction = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const evaluatedAt = normalizeOptionalString(value.evaluatedAt);
  const result = normalizeOptionalString(value.result);
  const chatId = normalizeOptionalString(value.chatId);
  // A reaction given up after its last failed attempt ("failed") says how many
  // attempts it made and why the last one failed, for the Event Editor.
  const attempts = Math.max(0, Math.trunc(Number(value.attempts) || 0));
  const lastError = normalizeOptionalString(value.lastError);
  return {
    enabled: value.enabled === true,
    ...(evaluatedAt ? { evaluatedAt } : {}),
    ...(result ? { result } : {}),
    ...(chatId ? { chatId } : {}),
    ...(attempts ? { attempts } : {}),
    ...(lastError ? { lastError } : {}),
  };
};

// An event's one-line digest (the time skip writes one beside each event): the
// line a later skip's history shows of it once it is no longer the newest
// (promptContext.js buildEventHistoryText). One line, at most
// EVENT_DIGEST_MAX_CHARS; "" when there is none, as on every event written
// before digests and every event of the Event Editor.
export const EVENT_DIGEST_MAX_CHARS = 140;
export const normalizeEventDigest = (value) => {
  const line = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (line.length <= EVENT_DIGEST_MAX_CHARS) return line;
  const cut = line.slice(0, EVENT_DIGEST_MAX_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > EVENT_DIGEST_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

export const normalizeEventEntry = (entry, index = 0) => {
  if (typeof entry === "string") {
    const title = normalizeString(entry);
    if (!title) return null;

    return {
      createdAt: new Date().toISOString(),
      date: "",
      description: "",
      id: generateId(`event-${index}`),
      impacts: normalizeEventImpacts(null),
      agency: null,
      importance: "minor",
      kind: "world",
      tags: [],
      notable: false,
      playerRelated: false,
      storylineIds: [],
      warId: "",
      combatants: [],
      source: "scenario",
      title,
    };
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const title =
    normalizeOptionalString(entry.title || entry.headline || entry.name) ||
    normalizeOptionalString(entry.description || entry.summary);

  if (!title) {
    return null;
  }

  const presentation = normalizeEventPresentation({
    description: normalizeOptionalString(entry.description || entry.summary || entry.text),
    quote: entry.quote,
  });
  const npcReaction = normalizeEventNpcReaction(entry.npcReaction);
  // In a shared game, what one government alone found out (runtime/spycraft.js
  // resolveEspionage): the polities whose players may read the event. Absent,
  // as on every event of a one-player game, it is everybody's.
  const audience = [...new Set(normalizeActionParticipants(entry.audience))].slice(0, 12);
  // The places the event said it is about, as the engine found them on the
  // map (runtime/eventPlaces.js): what its card links to.
  const places = normalizeEventPlaces(entry.places);
  const digest = normalizeEventDigest(entry.digest);
  // The polities the event says it is about (runtime/eventConcerns.js), read
  // as its combatants are.
  const concerns = normalizeEventConcerns(entry.concerns, { toName: (name) => toCountryName(name) });

  return {
    createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
    date: normalizeOptionalString(entry.date),
    description: presentation.description,
    // Only when present, so an event without one saves exactly as before.
    ...(digest ? { digest } : {}),
    ...(presentation.quote ? { quote: presentation.quote } : {}),
    // Only when present, so an event without one saves exactly as before.
    ...(npcReaction ? { npcReaction } : {}),
    ...(audience.length ? { audience } : {}),
    ...(places.length ? { places } : {}),
    id: normalizeOptionalString(entry.id) || generateId(`event-${index}`),
    impacts: normalizeEventImpacts(entry.impacts, entry),
    agency: normalizeEventAgency(entry.agency),
    importance: normalizeOptionalString(entry.importance) || "minor",
    kind: normalizeRenamedKind(entry.kind) || "world",
    // Category tags for the timeline's filter chips (runtime/eventTags.js).
    tags: normalizeEventTags(entry.tags),
    notable: Boolean(entry.notable),
    playerRelated: Boolean(entry.playerRelated),
    // Persistent storylines this event advances (AI/nativeWorldDirector.js).
    storylineIds: [...new Set(normalizeActionParticipants(entry.storylineIds))].slice(0, 6),
    // Canonical war metadata: the world.wars id an event fights in, declares,
    // joins or ends, and for actual combat the polities on the field from both
    // sides (AI/nativeWarLedger.js validates them against the ledger).
    warId: normalizeOptionalString(entry.warId),
    combatants: [...new Set(
      normalizeActionParticipants(entry.combatants)
        .map((name) => toCountryName(normalizeOptionalString(name)) || normalizeOptionalString(name))
        .filter(Boolean),
    )].slice(0, MAX_WAR_SIDE_MEMBERS),
    // Only when present, so an event without saves exactly as before.
    ...(concerns.length ? { concerns } : {}),
    source: normalizeOptionalString(entry.source) || "scenario",
    title,
  };
};

export const normalizeEvents = (events) => {
  if (Array.isArray(events)) {
    return events
      .map((entry, index) => normalizeEventEntry(entry, index))
      .filter(Boolean);
  }

  if (events && typeof events === "object") {
    if (Array.isArray(events.events)) {
      return normalizeEvents(events.events);
    }

    return Object.values(events)
      .map((entry, index) => normalizeEventEntry(entry, index))
      .filter(Boolean);
  }

  return [];
};

const normalizePolityOverride = (key, value) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const code = normalizeOptionalString(value.code) || normalizeOptionalString(key);
  if (!code) {
    return null;
  }

  // mapRefs.gadm0 is the owner migration's provenance (which stock geography a
  // polity was founded on), status the lifecycle, mapLabel / mapDistinctLabel
  // the map's authored cartographic names, verbatim the editor's collision
  // guard: none of them may be lost on a client write.
  const status = normalizeOptionalString(value.status).toLowerCase();
  const rawMapRefs = value.mapRefs && typeof value.mapRefs === "object" && !Array.isArray(value.mapRefs)
    ? value.mapRefs
    : {};
  const gadm0 = [...new Set(
    normalizeArray(rawMapRefs.gadm0)
      .map((entry) => normalizeOptionalString(entry).toUpperCase())
      .filter(Boolean),
  )];

  // The names this polity was keyed by before a rename re-keyed it; they keep
  // old references folding onto it (ownerNames.js) and its starting tags found
  // (countryTags.js).
  const formerNames = normalizeActionParticipants(value.formerNames);
  return {
    aliases: normalizeActionParticipants(value.aliases || value.additionalNames),
    code,
    color: normalizeOptionalString(value.color),
    ...(formerNames.length ? { formerNames } : {}),
    ...(gadm0.length ? { mapRefs: { ...rawMapRefs, gadm0 } } : {}),
    ...(normalizeOptionalString(value.mapLabel) ? { mapLabel: normalizeOptionalString(value.mapLabel) } : {}),
    ...(normalizeOptionalString(value.mapDistinctLabel) ? { mapDistinctLabel: normalizeOptionalString(value.mapDistinctLabel) } : {}),
    name: normalizeOptionalString(value.name || value.label),
    note: normalizeOptionalString(value.note),
    // Its people when the scenario begins, where its author says (runtime/populationFigure.js).
    ...(populationFigureOf(value) > 0 ? { population: populationFigureOf(value) } : {}),
    // Its own military figures, where its author gives them (runtime/militaryStats.js).
    ...(normalizeMilitaryStats(value.military) ? { military: normalizeMilitaryStats(value.military) } : {}),
    ...(POLITY_STATUS_SET.has(status) ? { status } : {}),
    ...(value.verbatim === true ? { verbatim: true } : {}),
  };
};

const normalizeActionSuggestions = (value) =>
  normalizeArray(value).map((topic) => {
    if (!topic || typeof topic !== "object") {
      return null;
    }

    const title = normalizeOptionalString(topic.title || topic.name);
    if (!title) {
      return null;
    }

    return {
      actions: normalizeArray(topic.actions).map((entry, index) => normalizeActionEntry(entry, index)).filter(Boolean),
      description: normalizeOptionalString(topic.description),
      id: normalizeOptionalString(topic.id) || generateId("topic"),
      title,
      // Canned topics written when the AI could not be reached say so.
      ...(topic.source === "fallback" ? { source: "fallback" } : {}),
    };
  }).filter(Boolean);

// The living history document (AI/historyConsolidation.js). The text is the
// point; the rest records which pass wrote it and how far it reaches.
// `years` and `eras`: the document in tiers (runtime/historyTiers.js); a
// document from before them has its text alone, and one in tiers may have none.
const normalizeHistoryDocument = (value) => {
  if (!value || typeof value !== "object") return null;
  const text = normalizeTextLike(value.text);
  const years = normalizeHistoryYears(value.years);
  const eras = normalizeHistoryEras(value.eras);
  if (!text && !years.length && !eras.length) return null;
  const throughRound = Math.trunc(Number(value.throughRound) || 0);
  return {
    text,
    ...(years.length ? { years } : {}),
    ...(eras.length ? { eras } : {}),
    revision: Math.max(1, Math.trunc(Number(value.revision) || 1)),
    updatedAt: normalizeOptionalString(value.updatedAt) || new Date().toISOString(),
    source: normalizeOptionalString(value.source) || "ai",
    throughDate: normalizeOptionalString(value.throughDate),
    throughEventId: normalizeOptionalString(value.throughEventId),
    throughRound: throughRound > 0 ? throughRound : 0,
  };
};

const normalizeConsolidatedHistory = (value) => normalizeArray(value)
  .map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const summary = normalizeTextLike(entry.summary);
    if (!summary) return null;
    return {
      // Ids of the resolved player orders folded into this summary. Without it the
      // same orders would be re-summarised every consolidation, and — because this
      // object is a fixed whitelist — an actionIds written by the consolidator
      // would be dropped on the next read and the tracking would never stick.
      actionIds: normalizeActionParticipants(entry.actionIds),
      chatIds: normalizeActionParticipants(entry.chatIds),
      createdAt: normalizeOptionalString(entry.createdAt) || new Date().toISOString(),
      source: normalizeOptionalString(entry.source) || "ai",
      summary,
      throughDate: normalizeOptionalString(entry.throughDate),
      throughEventId: normalizeOptionalString(entry.throughEventId),
      throughRound: Number.isFinite(Number(entry.throughRound))
        ? Math.max(0, Math.trunc(Number(entry.throughRound)))
        : 0,
    };
  })
  .filter(Boolean);

// ---- Canonical war and diplomacy ledgers ------------------------------------
// The shapes the war ledger (AI/nativeWarLedger.js) and the diplomatic director
// (AI/nativeDiplomaticDirector.js) persist. Normalised here, on every read and
// write, for the same reason units and projects are: a field this module does
// not know is a field the next round trip loses. Polity names inside them share
// the owner namespace, so a relation between "Germany" and "the German Empire"
// resolves to one pair.
const clampWorldStorylinePercent = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const normalizeWorldStoryline = (entry, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const title = normalizeOptionalString(entry.title || entry.name);
  if (!title) return null;

  const id = normalizeOptionalString(entry.id) || `storyline-${index}`;
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  const status = WORLD_STORYLINE_STATUS_SET.has(rawStatus) ? rawStatus : "active";
  const uniqueStrings = (value, limit) =>
    [...new Set(normalizeActionParticipants(value))].slice(0, limit);

  return {
    id,
    // One of the fixed kinds (runtime/storylineKinds.js); a save's free text
    // is the neutral kind, by its exact value only.
    kind: storylineKindOf(entry.kind),
    title,
    participants: uniqueStrings(entry.participants, 12),
    status,
    pressure: clampWorldStorylinePercent(entry.pressure),
    momentum: clampWorldStorylinePercent(entry.momentum),
    startedDate: canonicalizeDateString(entry.startedDate),
    accountedThroughDate: canonicalizeDateString(
      entry.accountedThroughDate || entry.lastUpdatedDate || entry.startedDate,
    ),
    lastUpdatedDate: canonicalizeDateString(
      entry.lastUpdatedDate || entry.accountedThroughDate || entry.startedDate,
    ),
    lastVisibleEventDate: canonicalizeDateString(entry.lastVisibleEventDate),
    nextReviewDate:
      status === "resolved" ? "" : canonicalizeDateString(entry.nextReviewDate),
    state: normalizeTextLike(entry.state || entry.summary || entry.description),
    ...(entry.canonicalIdentity === true ? { canonicalIdentity: true } : {}),
    sourceEventIds: uniqueStrings(entry.sourceEventIds, 16),
    createdRound:
      Number.isFinite(Number(entry.createdRound)) && Number(entry.createdRound) > 0
        ? Math.trunc(Number(entry.createdRound))
        : 0,
    updatedRound:
      Number.isFinite(Number(entry.updatedRound)) && Number(entry.updatedRound) > 0
        ? Math.trunc(Number(entry.updatedRound))
        : 0,
  };
};

const normalizeWorldStorylines = (value) => {
  const deduped = new Map();

  normalizeArray(value).forEach((entry, index) => {
    const normalized = normalizeWorldStoryline(entry, index);
    if (!normalized) return;
    // Last occurrence wins so a write can intentionally replace an earlier copy.
    deduped.set(normalized.id, normalized);
  });

  const statusRank = { active: 0, dormant: 1, resolved: 2 };
  return [...deduped.values()]
    .sort((a, b) =>
      Number(b.canonicalIdentity === true) - Number(a.canonicalIdentity === true) ||
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      String(b.lastUpdatedDate || b.accountedThroughDate || "").localeCompare(
        String(a.lastUpdatedDate || a.accountedThroughDate || ""),
      ) ||
      a.id.localeCompare(b.id),
    )
    .slice(0, MAX_WORLD_STORYLINES);
};

// The world's wars: the canonical war record (warRecord.js), the one shape the
// ledger, the fronts and the peace all read. This used to be a second copy of
// the ledger's own normalizer, with its own caps (12 a side, 64 wars in all,
// cut whoever still named them) and an id made of the record's position in the
// list, which moved every time the list was sorted. An ended war that a peace
// treaty, reparations, an offer or a battlefield still names is kept.
const normalizeWorldWars = (value, world = null) => normalizeWarRecords(value, { keep: referencedWarIds(world) });

// One identity index per identity world. normalizeWorldState makes that world
// afresh for each pass and only reads it, so the index built for its first
// name holds for all the rest. Without this every relation, agreement and
// puppet row built the index again, each time reading every polity and every
// region's owner: a pass cost rows x regions, the game makes hundreds of
// passes in a skip, and on a phone a scenario with many puppets froze the
// page for minutes before the skip's request was even sent (2026-10-23).
const diplomaticIdentityIndexes = new WeakMap();
const diplomaticIdentityIndexOf = (identityWorld) => {
  if (!identityWorld || typeof identityWorld !== "object") return null;
  let index = diplomaticIdentityIndexes.get(identityWorld);
  if (!index) {
    index = buildPolityIdentityIndex(identityWorld);
    diplomaticIdentityIndexes.set(identityWorld, index);
  }
  return index;
};

// A party to a relation or an agreement: a polity, or a group by its exact name
// (runtime/groupParties.js). "group: X" stays prefixed when a polity shares the
// same name so subsequent normalizations never rebind the record to the state;
// a bare name is a polity's when one answers to it, else a group's, else kept as written.
const resolveWorldDiplomaticPolity = (token, identityWorld) => {
  const raw = normalizeOptionalString(token);
  if (!raw) return "";
  const named = groupPartyKey(identityWorld, raw);
  if (named && /^\s*group\s*:/i.test(raw)) {
    const colliding = resolvePolityIdentity(named, identityWorld, {
      allowUnknown: false,
      requireActive: false,
      allowStockBase: true,
      identityIndex: diplomaticIdentityIndexOf(identityWorld),
    });
    return colliding?.resolved ? `group: ${named}` : named;
  }
  if (named) {
    const known = resolvePolityIdentity(raw, identityWorld, {
      allowUnknown: false,
      requireActive: false,
      allowStockBase: true,
      identityIndex: diplomaticIdentityIndexOf(identityWorld),
    });
    return normalizeOptionalString(known?.resolved) || named;
  }
  const resolved = resolvePolityIdentity(raw, identityWorld, {
    allowUnknown: true,
    requireActive: false,
    allowStockBase: true,
    identityIndex: diplomaticIdentityIndexOf(identityWorld),
  });
  return normalizeOptionalString(resolved?.resolved || toCountryName(raw) || raw);
};

const worldRelationPairKey = (a, b) => [normalizeOptionalString(a), normalizeOptionalString(b)]
  .map((value) => value.toLocaleLowerCase())
  .sort()
  .join("||");

const normalizeWorldRelation = (entry, identityWorld, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const aRaw = resolveWorldDiplomaticPolity(entry.a, identityWorld);
  const bRaw = resolveWorldDiplomaticPolity(entry.b, identityWorld);
  if (!aRaw || !bRaw || aRaw.toLocaleLowerCase() === bRaw.toLocaleLowerCase()) return null;
  const ordered = [aRaw, bRaw].sort((a, b) => a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase()));
  const scoreNumber = Number(entry.score);
  const score = Number.isFinite(scoreNumber) ? Math.max(-100, Math.min(100, Math.round(scoreNumber))) : 0;
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  const status = WORLD_RELATION_STATUS_SET.has(rawStatus)
    ? rawStatus
    : score >= 55 ? "friendly"
      : score >= 20 ? "cordial"
        : score >= -10 ? "neutral"
          : score >= -30 ? "cautious"
            : score >= -60 ? "strained"
              : "hostile";
  return {
    id: normalizeOptionalString(entry.id) || `relation-${index}`,
    a: ordered[0],
    b: ordered[1],
    score,
    status,
    // Legacy saves may contain several compact relation records swallowed by
    // one explanation. Keep the scored pair; never display that payload as prose.
    summary: hasMalformedRelationSummary(entry.summary) ? "" : normalizeTextLike(entry.summary),
    lastUpdatedDate: canonicalizeDateString(entry.lastUpdatedDate),
    sourceEventIds: [...new Set(normalizeActionParticipants(entry.sourceEventIds))].slice(-24),
    createdRound: Number.isFinite(Number(entry.createdRound)) ? Math.max(0, Math.trunc(Number(entry.createdRound))) : 0,
    updatedRound: Number.isFinite(Number(entry.updatedRound)) ? Math.max(0, Math.trunc(Number(entry.updatedRound))) : 0,
  };
};

const normalizeWorldRelations = (value, identityWorld) => {
  const deduped = new Map();
  normalizeArray(value).forEach((entry, index) => {
    const normalized = normalizeWorldRelation(entry, identityWorld, index);
    if (!normalized) return;
    deduped.set(worldRelationPairKey(normalized.a, normalized.b), normalized);
  });
  return [...deduped.values()]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.id.localeCompare(b.id))
    .slice(0, MAX_WORLD_RELATIONS);
};

const normalizeWorldAgreement = (entry, identityWorld, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = normalizeOptionalString(entry.id) || `agreement-${index}`;
  const parties = [...new Set(normalizeArray(entry.parties)
    .map((party) => resolveWorldDiplomaticPolity(party, identityWorld))
    .filter(Boolean))].slice(0, 12);
  if (!id || parties.length < 2) return null;
  const rawType = normalizeOptionalString(entry.type).toLowerCase().replace(/[ -]+/g, "_");
  const type = WORLD_AGREEMENT_TYPE_SET.has(rawType) ? rawType : "other";
  const rawStatus = normalizeOptionalString(entry.status).toLowerCase();
  const status = WORLD_AGREEMENT_STATUS_SET.has(rawStatus) ? rawStatus : "active";
  const guarantor = type === "guarantee"
    ? resolveWorldDiplomaticPolity(entry.guarantor || parties[0], identityWorld)
    : "";
  const beneficiary = type === "guarantee"
    ? resolveWorldDiplomaticPolity(entry.beneficiary || parties[1], identityWorld)
    : "";
  const reciprocalAccess = type === "military_access" && entry.reciprocalAccess === true;
  const grantor = type === "military_access" && !reciprocalAccess
    ? resolveWorldDiplomaticPolity(entry.grantor, identityWorld)
    : "";
  const grantee = type === "military_access" && !reciprocalAccess
    ? resolveWorldDiplomaticPolity(entry.grantee, identityWorld)
    : "";
  return {
    id,
    title: normalizeOptionalString(entry.title) || id,
    type,
    status,
    parties,
    startedDate: canonicalizeDateString(entry.startedDate),
    endedDate: ["ended", "expired"].includes(status)
      ? canonicalizeDateString(entry.endedDate || entry.lastUpdatedDate)
      : "",
    lastUpdatedDate: canonicalizeDateString(entry.lastUpdatedDate || entry.startedDate),
    terms: normalizeTextLike(entry.terms),
    ...(guarantor && beneficiary ? { guarantor, beneficiary } : {}),
    ...(type === "military_access" && reciprocalAccess ? { reciprocalAccess: true } : {}),
    ...(type === "military_access" && grantor && grantee ? { grantor, grantee, reciprocalAccess: false } : {}),
    sourceEventIds: [...new Set(normalizeActionParticipants(entry.sourceEventIds))].slice(-24),
    createdRound: Number.isFinite(Number(entry.createdRound)) ? Math.max(0, Math.trunc(Number(entry.createdRound))) : 0,
    updatedRound: Number.isFinite(Number(entry.updatedRound)) ? Math.max(0, Math.trunc(Number(entry.updatedRound))) : 0,
    ...(entry.migratedLegacy === true ? { migratedLegacy: true } : {}),
    // What it does, as the AI that made it wrote it (runtime/agreementEffects.js),
    // and how far the engine has carried it out (Game/AI/agreementEngine.js): its
    // signing's effects, the months run, the days toward the next month, its end's
    // effects, and who broke it.
    ...(normalizeAgreementEffects(entry.effects) ? { effects: normalizeAgreementEffects(entry.effects) } : {}),
    ...(entry.effectsApplied === true ? { effectsApplied: true } : {}),
    ...(Number(entry.monthsRun) > 0 ? { monthsRun: Math.min(600, Math.trunc(Number(entry.monthsRun))) } : {}),
    ...(Number(entry.carryDays) > 0 ? { carryDays: Math.min(3650, Math.round(Number(entry.carryDays))) } : {}),
    ...(entry.endApplied === true ? { endApplied: true } : {}),
    // Fractions of a point a relation, a standing or a group's figures are owed, banked between months.
    ...(entry.figureCarry && typeof entry.figureCarry === "object" && !Array.isArray(entry.figureCarry)
      && Object.keys(entry.figureCarry).length
      ? { figureCarry: Object.fromEntries(Object.entries(entry.figureCarry).slice(0, 16).map(([key, value]) => [normalizeOptionalString(key).slice(0, 160), Math.max(-1, Math.min(1, Number(value) || 0))]).filter(([key, value]) => key && value)) }
      : {}),
    ...(normalizeOptionalString(entry.brokenBy) ? { brokenBy: normalizeOptionalString(entry.brokenBy) } : {}),
  };
};

const normalizeWorldAgreements = (value, identityWorld) => {
  const deduped = new Map();
  normalizeArray(value).forEach((entry, index) => {
    const normalized = normalizeWorldAgreement(entry, identityWorld, index);
    if (normalized) deduped.set(normalized.id, normalized);
  });
  const statusRank = { active: 0, suspended: 1, ended: 2, expired: 3 };
  return [...deduped.values()]
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      compareGameDates(b.lastUpdatedDate || b.startedDate || "", a.lastUpdatedDate || a.startedDate || "") ||
      a.id.localeCompare(b.id),
    )
    .slice(0, MAX_WORLD_AGREEMENTS);
};

// A subordination is DIRECTIONAL (overlord -> puppet), unlike a relation, and
// partly secret, unlike an agreement. See puppets.js for what a viewer may see
// of one, and the ADR for why it is neither of those two things.
const normalizeWorldPuppet = (entry, identityWorld, index = 0) => {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const overlord = resolveWorldDiplomaticPolity(entry.overlord, identityWorld);
  const puppet = resolveWorldDiplomaticPolity(entry.puppet, identityWorld);
  // Nobody directs themselves, and a one-sided row names no relationship.
  if (!overlord || !puppet || overlord.toLocaleLowerCase() === puppet.toLocaleLowerCase()) return null;

  const status = PUPPET_STATUSES.includes(normalizeOptionalString(entry.status).toLowerCase())
    ? normalizeOptionalString(entry.status).toLowerCase()
    : "active";
  const loyaltyNumber = Number(entry.loyalty);
  const kind = normalizeOptionalString(entry.kind).toLowerCase();
  const secrecy = normalizeOptionalString(entry.secrecy).toLowerCase();

  // knownTo carries WHEN each polity learned a covert arrangement, because the
  // panel shows that date and a bare name cannot answer it. A plain string is
  // still accepted — it grants sight with no date to show.
  const seen = new Set();
  const knownTo = [];
  for (const raw of normalizeArray(entry.knownTo)) {
    const polity = resolveWorldDiplomaticPolity(typeof raw === "string" ? raw : raw?.polity, identityWorld);
    if (!polity) continue;
    const key = polity.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const lastSeen = typeof raw === "string" ? "" : normalizeOptionalString(raw?.seenStatus).toLowerCase();
    knownTo.push({
      polity,
      learnedDate: typeof raw === "string" ? "" : canonicalizeDateString(raw?.learnedDate),
      // The status this polity last SAW. Absent means it saw the arrangement
      // standing — the only thing it could have learned of it by being told.
      ...(PUPPET_STATUSES.includes(lastSeen) ? { seenStatus: lastSeen } : {}),
    });
    if (knownTo.length >= 24) break;
  }

  return {
    id: normalizeOptionalString(entry.id) || `puppet-${index}`,
    overlord,
    puppet,
    kind: PUPPET_KINDS.includes(kind) ? kind : "client",
    loyalty: Number.isFinite(loyaltyNumber) ? Math.max(0, Math.min(100, Math.round(loyaltyNumber))) : 50,
    secrecy: PUPPET_SECRECY_LEVELS.includes(secrecy) ? secrecy : "open",
    knownTo,
    status,
    startedDate: canonicalizeDateString(entry.startedDate),
    endedDate: status === "active" ? "" : canonicalizeDateString(entry.endedDate || entry.lastUpdatedDate),
    lastUpdatedDate: canonicalizeDateString(entry.lastUpdatedDate || entry.startedDate),
    sourceEventIds: [...new Set(normalizeActionParticipants(entry.sourceEventIds))].slice(-24),
    createdRound: Number.isFinite(Number(entry.createdRound)) ? Math.max(0, Math.trunc(Number(entry.createdRound))) : 0,
    updatedRound: Number.isFinite(Number(entry.updatedRound)) ? Math.max(0, Math.trunc(Number(entry.updatedRound))) : 0,
  };
};

const normalizeWorldPuppets = (value, identityWorld) => {
  const rows = [];
  // One Overlord per Puppet. A second LIVE row for the same Puppet is the
  // condominium this deliberately does not model, so it loses to the first;
  // an ended row never blocks a new Overlord, or a country could be subjugated
  // exactly once in a campaign.
  const liveByPuppet = new Set();
  const ids = new Set();
  normalizeArray(value).forEach((entry, index) => {
    const normalized = normalizeWorldPuppet(entry, identityWorld, index);
    if (!normalized || ids.has(normalized.id)) return;
    const key = normalized.puppet.toLocaleLowerCase();
    if (normalized.status === "active") {
      if (liveByPuppet.has(key)) return;
      liveByPuppet.add(key);
    }
    ids.add(normalized.id);
    rows.push(normalized);
  });

  if (rows.length <= MAX_WORLD_PUPPETS) return rows;

  // Evict what is OVER before what is live, oldest first — never a live row.
  // .slice() would drop whatever happened to be last, which is live work as
  // often as not (the same rule the projects board uses).
  // Live rows first, so the cut below can only ever reach finished ones while any
  // remain — that is the whole eviction rule. Each half is ordered by how
  // recently it was touched, so past 64 LIVE subordinations, where something must
  // give whatever we do, what goes is the least recently touched rather than
  // whichever happened to be last in the array.
  const byRecency = (a, b) => compareGameDates(b.lastUpdatedDate || "", a.lastUpdatedDate || "") || a.id.localeCompare(b.id);
  const live = rows.filter((row) => row.status === "active").sort(byRecency);
  const ended = rows.filter((row) => row.status !== "active").sort(byRecency);
  return [...live, ...ended].slice(0, MAX_WORLD_PUPPETS);
};

// Interactive events were called catalysts until 18 September 2026. A save
// from before keeps its scene under the old key; it is read from there and
// never written back under it.
const withFormerSceneKeyMoved = (world) => {
  if (!("activeCatalyst" in world)) return world;
  const { activeCatalyst: formerScene, ...rest } = world;
  return { ...rest, activeInteractive: rest.activeInteractive ?? formerScene };
};

export const normalizeWorldState = (world) => {
  // A battlefield saved under a war's id is renamed, and what names it follows
  // (fronts/record.js withWarIdFrontsRenamed), before anything below reads them.
  // (What the Stats pane's Politics tab kept apart, world.politics, is the Political World's now: folded into it
  // once, and gone. runtime/politicalLandscapeFold.js.)
  const { politics: formerPolitics = null, ...nextWorld } = withWarIdFrontsRenamed(withFormerSceneKeyMoved(world && typeof world === "object" ? world : {}));
  const polityOverrides = Object.fromEntries(
    Object.entries(nextWorld.polityOverrides ?? {})
      .map(([key, value]) => [key, normalizePolityOverride(key, value)])
      .filter(([, value]) => value),
  );

  // Canonicalise on READ too, so a save written before this migrated — or one
  // whose owners were split across a polity's token and its era display name by
  // a build that predates this — resolves to the same owner identity as
  // everything computed now. See ownerNames.js for why a name is an identity.
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(polityOverrides));

  const regionOwnershipOverrides = Object.fromEntries(
    Object.entries(nextWorld.regionOwnershipOverrides ?? {})
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), resolveOwner(ownerCode)])
      .filter(([regionId, ownerCode]) => regionId && ownerCode),
  );

  const regionClaimants = Object.fromEntries(
    Object.entries(nextWorld.regionClaimants ?? {})
      // Claimants share the owner namespace — they are compared against owners to
      // paint a disputed region's stripes (Nations.jsx).
      .map(([regionId, claimants]) => [
        normalizeOptionalString(regionId),
        normalizeArray(claimants).map((name) => resolveOwner(name)).filter(Boolean).slice(0, 4),
      ])
      .filter(([regionId, claimants]) => regionId && claimants.length),
  );

  // Settled disputes: unique region ids, none of them disputed again — a live
  // claimant list is the region's state and wins.
  const groups = normalizeGroups(nextWorld.groups);
  const groupAreas = normalizeGroupAreas(nextWorld.groupAreas, groups);

  const settledRegionClaims = [...new Set(
    normalizeArray(nextWorld.settledRegionClaims).map((regionId) => normalizeOptionalString(regionId)),
  )].filter((regionId) => regionId && !Object.prototype.hasOwnProperty.call(regionClaimants, regionId));

  // Legal sovereignty is SPARSE: only regions whose lawful sovereign differs
  // from the polity administering them. A row that agrees with the controller
  // is dropped (a save from before the ledger simply has none), and owners
  // fold through the same alias map as everything else.
  const regionSovereigntyOverrides = Object.fromEntries(
    Object.entries(nextWorld.regionSovereigntyOverrides ?? {})
      .map(([regionId, ownerCode]) => [normalizeOptionalString(regionId), resolveOwner(ownerCode)])
      .filter(([regionId, ownerCode]) => {
        if (!regionId || !ownerCode) return false;
        const controller = normalizeOptionalString(regionOwnershipOverrides[regionId]);
        return !controller || controller.toLowerCase() !== ownerCode.toLowerCase();
      }),
  );

  const internationalReputation = Object.fromEntries(
    Object.entries(nextWorld.internationalReputation ?? {})
      .map(([polityCode, value]) => [normalizeOptionalString(polityCode), Number(value)])
      .filter(([polityCode, value]) => polityCode && Number.isFinite(value))
      .map(([polityCode, value]) => [polityCode, Math.max(0, Math.min(100, Math.round(value)))]),
  );

  // Same treatment as reputation: name-keyed, integer, 0-100.
  const intelligence = Object.fromEntries(
    Object.entries(nextWorld.intelligence ?? {})
      .map(([polityCode, value]) => [normalizeOptionalString(polityCode), Number(value)])
      .filter(([polityCode, value]) => polityCode && Number.isFinite(value))
      .map(([polityCode, value]) => [polityCode, Math.max(0, Math.min(100, Math.round(value)))]),
  );
  const SPY_STATUSES = ["active", "discovered", "turned", "exposed", "recalled", "dead"];
  const spies = normalizeArray(nextWorld.spies)
    .map((spy, index) => {
      const target = normalizeOptionalString(spy?.target || spy?.polity);
      if (!target) return null;
      return {
        id: normalizeOptionalString(spy?.id) || `spy-${index + 1}`,
        // Pre-ownership records were all the player's; the field is filled in
        // at read time by whoever knows the player's name (spycraft treats an
        // empty owner as "the player" only when asked to).
        owner: normalizeOptionalString(spy?.owner),
        target,
        deployedAt: normalizeOptionalString(spy?.deployedAt),
        status: SPY_STATUSES.includes(spy?.status) ? spy.status : "active",
        turnedAt: normalizeOptionalString(spy?.turnedAt),
        exposedAt: normalizeOptionalString(spy?.exposedAt),
        coverStory: normalizeOptionalString(spy?.coverStory),
        suspected: spy?.suspected === true,
        ...spyTasking(spy),
      };
    })
    .filter(Boolean);
  const spySeal = /^[0-9a-f]{64}$/i.test(String(nextWorld.spySeal ?? "")) ? String(nextWorld.spySeal) : "";

  // Keyed by country NAME, verbatim — same namespace as internationalReputation
  // above, polityOverrides and colors. This used to uppercase while its neighbours
  // did not, so one applyEventImpacts change.code landed under two different keys
  // (countryTags["RUSSIA"] but internationalReputation["Russia"]). Harmless while
  // owners were uppercase GADM codes; a silent desync the moment they are names.
  const countryTags = Object.fromEntries(
    Object.entries(nextWorld.countryTags ?? {})
      .map(([country, list]) => [normalizeOptionalString(country), normalizeTagList(list)])
      .filter(([country, list]) => country && list.length),
  );

  // Persisted per-country stat sheets, each through the native Stats
  // compatibility boundary (countryStats.js): a legacy sheet stays readable, and
  // a component ledger recomputes its population/GDP aggregates on every read.
  // Explicit, not via the spread — new-field trap.
  const countryStats = Object.fromEntries(
    Object.entries(nextWorld.countryStats ?? {})
      .map(([code, sheet]) => [normalizeOptionalString(code), normalizeCountryStatSheet(sheet)])
      .filter(([code, sheet]) => code && sheet && typeof sheet === "object"),
  );

  // The scenario's own unit types (unitTypes.js), their owners folded like every
  // other owner; a unit of one is of that type's base kind, and one naming a type
  // the scenario does not have is an ordinary unit of its own kind.
  const unitTypes = normalizeUnitTypes(nextWorld.unitTypes, { resolveOwner });
  const units = withUnitTypesApplied(withoutTwinsOfPlayerUnits(normalizeUnits(nextWorld.units)), unitTypes);

  // The ledgers resolve their polity names against the overrides computed above,
  // not the raw input, so a renamed polity folds onto one identity.
  const diplomaticIdentityWorld = { ...nextWorld, polityOverrides, regionOwnershipOverrides };

  return {
    ...WORLD_DEFAULTS,
    ...nextWorld,
    countryTags,
    countryStats,
    politicalActors: formerPolitics && typeof formerPolitics === "object" && Object.keys(formerPolitics).length > 0
      ? foldPoliticsIntoActors(nextWorld.politicalActors, formerPolitics)
      : normalizePoliticalActors(nextWorld.politicalActors),
    politicalSimulation: normalizePoliticalSimulationClock(nextWorld.politicalSimulation),
    institutions: normalizeInstitutions(nextWorld.institutions, diplomaticIdentityWorld, diplomaticIdentityIndexOf(diplomaticIdentityWorld)),
    powerStatus: normalizePowerStatus(nextWorld.powerStatus, diplomaticIdentityWorld),
    actionSuggestions: normalizeActionSuggestions(nextWorld.actionSuggestions),
    activeInteractive: normalizeInteractive(nextWorld.activeInteractive),
    interactiveOffer: normalizeInteractiveOffer(nextWorld.interactiveOffer),
    lastInteractiveOfferRound: Number.isFinite(Number(nextWorld.lastInteractiveOfferRound))
      ? Math.max(0, Math.trunc(Number(nextWorld.lastInteractiveOfferRound)))
      : 0,
    consolidatedHistory: normalizeConsolidatedHistory(nextWorld.consolidatedHistory),
    historyDocument: normalizeHistoryDocument(nextWorld.historyDocument),
    canonFacts: normalizeCanonFacts(nextWorld.canonFacts),
    promptSnapshot: normalizePromptSnapshot(nextWorld.promptSnapshot),
    promptReference: normalizePromptReference(nextWorld.promptReference),
    internationalReputation,
    intelligence,
    spies,
    spySeal,
    gmAudit: normalizeGameMasterAudit(nextWorld.gmAudit),
    gmChanges: normalizeGmChanges(nextWorld.gmChanges),
    simulationReminders: normalizeReminders(nextWorld.simulationReminders),
    playerGoals: normalizePlayerGoals(nextWorld.playerGoals),
    labelFont: normalizeOptionalString(nextWorld.labelFont),
    labelHaloColor: normalizeOptionalString(nextWorld.labelHaloColor),
    labelTextColor: normalizeOptionalString(nextWorld.labelTextColor),
    language: normalizeOptionalString(nextWorld.language) || WORLD_DEFAULTS.language,
    lastJumpMode: normalizeOptionalString(nextWorld.lastJumpMode),
    lastJumpSummary: normalizeOptionalString(nextWorld.lastJumpSummary),
    lastJumpTargetDate: normalizeOptionalString(nextWorld.lastJumpTargetDate),
    idlePulseTick: Number.isFinite(Number(nextWorld.idlePulseTick))
      ? Math.max(0, Math.trunc(Number(nextWorld.idlePulseTick)))
      : 0,
    polityOverrides,
    regionClaimants,
    settledRegionClaims,
    groups,
    groupAreas,
    regionOwnershipOverrides,
    regionSovereigntyOverrides,
    simulationHistory: normalizeArray(nextWorld.simulationHistory)
      .map((entry, index, entries) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        // What the engine did with that turn's answer (runtime/applicationReceipt.js).
        // Only the newest receipt keeps its notes — they are read once, by the next
        // jump — so this polled file never carries more than one receipt's text.
        // "Newest receipt", not "newest entry": a Game Master intervention or a
        // resolved interactive event is recorded here too and carries none, and it must not
        // cost the simulator what it was about to be told.
        const newestReceiptIndex = entries.findIndex((candidate) => candidate && typeof candidate === "object" && candidate.receipt);
        const receipt = normalizeApplicationReceipt(entry.receipt, { keepNotes: index === newestReceiptIndex });
        // Taken out of the spread so a malformed receipt is dropped, not kept raw;
        // and the scene a time skip used to propose (under either name), which
        // nothing reads since skips stopped proposing them.
        const { receipt: _storedReceipt, filedEvents: _storedFiled, interactive: _scene, catalyst: _formerScene, ...rest } = cloneValue(entry);
        // Written but kept off the timeline, shown greyed under the turn
        // (runtime/filedEvents.js). Bounded here like the receipt.
        const filedEvents = normalizeFiledEvents(entry.filedEvents);

        return {
          ...rest,
          ...(receipt ? { receipt } : {}),
          ...(filedEvents.length ? { filedEvents } : {}),
          date: normalizeOptionalString(entry.date),
          eventIds: normalizeActionParticipants(entry.eventIds),
          fallbackReason: normalizeOptionalString(entry.fallbackReason),
          fromDate: normalizeOptionalString(entry.fromDate || entry.startDate),
          mode: normalizeRenamedKind(entry.mode),
          plannedActions: normalizeActions(entry.plannedActions || entry.actions),
          // The raw model response a fallback turn failed to parse — empty on a
          // normal AI turn. See gameplay.js's runJsonTask/applySimulationResult.
          rawResponse: normalizeOptionalString(entry.rawResponse),
          round:
            Number.isFinite(Number(entry.round)) && Number(entry.round) > 0
              ? Math.trunc(Number(entry.round))
              : 0,
          summary: normalizeTextLike(entry.summary),
          source: normalizeOptionalString(entry.source) || "ai",
          toDate: normalizeOptionalString(entry.toDate || entry.endDate || entry.date),
        };
      })
      .filter(Boolean),
    markers: normalizeMarkers(nextWorld.markers),
    reports: normalizeReports(nextWorld.reports),
    chatKnowledgeCursors: (() => {
      const source = nextWorld.chatKnowledgeCursors;
      if (!source || typeof source !== "object" || Array.isArray(source)) return {};
      const cursors = {};
      for (const [key, value] of Object.entries(source)) {
        const id = normalizeOptionalString(value);
        if (normalizeOptionalString(key) && id) cursors[key] = id;
      }
      return cursors;
    })(),
    // Capped at the most recent 512: a refusal is rare, and past that many the
    // oldest could be charged again — a campaign would need five hundred refused
    // demands for that to matter, and a list that grew forever would matter sooner.
    chargedRefusals: [...new Set(normalizeArray(nextWorld.chargedRefusals).map((id) => normalizeOptionalString(id)).filter(Boolean))]
      .slice(-512),
    pendingEventOutreach: normalizePendingEventOutreach(nextWorld.pendingEventOutreach),
    // Explicit (not via the ...WORLD_DEFAULTS spread) so these new fields survive every
    // write path — the documented new-world-field trap.
    //
    // Owners folded on READ, exactly as regionOwnershipOverrides and regionClaimants
    // above are, and for the same reason: a board written before the ops door began
    // folding them can still carry a foreign programme filed under a polity's era
    // display name ("the Third Reich") rather than the token everything else keys off
    // ("Germany"). Left alone that is a second power beside the first, with no flag
    // and no colour — and where the renamed polity is the PLAYER'S, it is their own
    // programme sitting in the Foreign column with both of its controls gone. Idempotent,
    // so a board already correct reads back unchanged.
    // Explicit scenario rule, not an inferred GDP datum or a second fiscal
    // ledger. Non-monetary work consumes time/capacity and records no payments.
    projectFundingMode: projectFundingMode(nextWorld),
    projects: normalizeProjects(nextWorld.projects).map((project) => {
      const owner = resolveOwner(project.ownerCode);
      return owner === project.ownerCode ? project : { ...project, ownerCode: owner };
    }),
    // A recovery shelf exists only after a save owner explicitly shelves work.
    // Archived rows never enter the live project clock, and each retains its
    // original source fields for later reinstatement or full game export.
    ...(Object.prototype.hasOwnProperty.call(nextWorld, "projectRecoveryArchive") ? {
      projectRecoveryArchive: normalizeProjectRecoveryArchive(nextWorld.projectRecoveryArchive, {
        activeIds: [
          ...inspectLegacyProjectEntries(nextWorld.projects).map((entry) => entry.id),
          ...Object.entries(nextWorld.seatBoards && typeof nextWorld.seatBoards === "object" ? nextWorld.seatBoards : {})
            .flatMap(([country, board]) => inspectLegacyProjectEntries(board, { ownerScope: country }).map((entry) => entry.id)),
        ],
      }),
    } : {}),
    // A shared game's other boards (multiplayer/host/gameHost.js): every country
    // a second person plays keeps a Projects board of its own here, by country
    // name. world.projects stays the host's, which is single player's. Only a
    // world that has the key keeps it, so a single-player save never gains one.
    ...(Object.prototype.hasOwnProperty.call(nextWorld, "seatBoards") ? {
      seatBoards: Object.fromEntries(
        Object.entries(nextWorld.seatBoards && typeof nextWorld.seatBoards === "object" && !Array.isArray(nextWorld.seatBoards) ? nextWorld.seatBoards : {})
          .map(([country, board]) => [normalizeOptionalString(country), normalizeProjects(board, { ownerScope: country })])
          .filter(([country, board]) => country && board.length)
          .slice(0, 64),
      ),
    } : {}),
    // And what a shared game's other players still see of each fleet a player
    // ordered since the last skip (multiplayer/host/onlyOrdered.js
    // withFleetOrdered): as it stood before, on the date it was ordered, and
    // what the order made of it. What is only ordered stays private. Only a
    // world that has the key keeps it.
    ...(Object.prototype.hasOwnProperty.call(nextWorld, "seenFleetPostures") && nextWorld.seenFleetPostures && typeof nextWorld.seenFleetPostures === "object" && !Array.isArray(nextWorld.seenFleetPostures) ? {
      seenFleetPostures: Object.fromEntries(Object.entries(nextWorld.seenFleetPostures)
        .filter(([id, seen]) => normalizeOptionalString(id) && seen && typeof seen === "object")
        .slice(0, 2000)
        .map(([id, seen]) => [normalizeOptionalString(id), {
          posture: normalizeOptionalString(seen.posture),
          status: normalizeOptionalString(seen.status),
          updatedAt: normalizeOptionalString(seen.updatedAt),
          since: normalizeOptionalString(seen.since),
          ordered: { posture: normalizeOptionalString(seen.ordered?.posture), status: normalizeOptionalString(seen.ordered?.status) },
        }])),
    } : {}),
    // And what those players left waiting while nobody shares the game
    // (multiplayer/host/heldSeats.js): their orders, threads and secret
    // events, kept as they were, read by nothing until the session is taken
    // up again. Only a world that has the key keeps it.
    ...(Object.prototype.hasOwnProperty.call(nextWorld, "seatsHeld") && nextWorld.seatsHeld && typeof nextWorld.seatsHeld === "object" && !Array.isArray(nextWorld.seatsHeld) ? {
      seatsHeld: {
        orders: normalizeArray(nextWorld.seatsHeld.orders).filter((row) => row && typeof row === "object").slice(-4000),
        threads: normalizeArray(nextWorld.seatsHeld.threads).filter((row) => row && typeof row === "object").slice(-1000),
        events: normalizeArray(nextWorld.seatsHeld.events).filter((row) => row?.event && typeof row.event === "object").slice(-4000),
        turns: normalizeArray(nextWorld.seatsHeld.turns).filter((row) => row && typeof row === "object" && Array.isArray(row.orders)).slice(-400),
      },
    } : {}),
    // And each such player's seal for its own agents' traffic (spySeal.js
    // sealOf), by country. world.spySeal stays the game country's. Only a world
    // that has the key keeps it.
    ...(Object.prototype.hasOwnProperty.call(nextWorld, "seatSeals") ? {
      seatSeals: Object.fromEntries(
        Object.entries(nextWorld.seatSeals && typeof nextWorld.seatSeals === "object" && !Array.isArray(nextWorld.seatSeals) ? nextWorld.seatSeals : {})
          .map(([country, seal]) => [normalizeOptionalString(country), String(seal ?? "")])
          .filter(([country, seal]) => country && /^[0-9a-f]{64}$/i.test(seal))
          .slice(0, 64),
      ),
    } : {}),
    cityRenames: Object.fromEntries(
      Object.entries(nextWorld.cityRenames && typeof nextWorld.cityRenames === "object" ? nextWorld.cityRenames : {})
        .map(([key, value]) => [normalizeString(key).toLowerCase(), normalizeString(value)])
        .filter(([key, value]) => key && value),
    ),
    regionRenames: Object.fromEntries(
      Object.entries(nextWorld.regionRenames && typeof nextWorld.regionRenames === "object" ? nextWorld.regionRenames : {})
        .map(([key, value]) => [normalizeString(key).toLowerCase(), normalizeString(value)])
        .filter(([key, value]) => key && value),
    ),
    cityPopulations: Object.fromEntries(
      Object.entries(nextWorld.cityPopulations && typeof nextWorld.cityPopulations === "object" ? nextWorld.cityPopulations : {})
        .map(([city, value]) => [normalizeOptionalString(city).toLowerCase(), Number(value)])
        .filter(([city, value]) => city && Number.isFinite(value) && value >= 0),
    ),
    relations: normalizeWorldRelations(nextWorld.relations, diplomaticIdentityWorld),
    agreements: normalizeWorldAgreements(nextWorld.agreements, diplomaticIdentityWorld),
    diplomaticLedgerVersion: Number.isFinite(Number(nextWorld.diplomaticLedgerVersion))
      ? Math.max(0, Math.trunc(Number(nextWorld.diplomaticLedgerVersion)))
      : 0,
    wars: normalizeWorldWars(nextWorld.wars, nextWorld),
    // Shape and length only: the engine wrote every record, and this runs on
    // every read of the world.
    battlefields: normalizeBattlefields(nextWorld.battlefields),
    transports: normalizeTransports(nextWorld.transports),
    strikes: normalizeStrikes(nextWorld.strikes),
    airStrikeOrders: normalizeAirStrikeOrders(nextWorld.airStrikeOrders),
    airStrikes: normalizeAirStrikes(nextWorld.airStrikes),
    seaBattles: normalizeSeaBattles(nextWorld.seaBattles),
    naviesRaised: normalizeNaviesRaised(nextWorld.naviesRaised),
    blockades: normalizeBlockades(nextWorld.blockades),
    warWeariness: normalizeWarWeariness(nextWorld.warWeariness),
    warResources: normalizeWarResources(nextWorld.warResources),
    attrition: normalizeAttrition(nextWorld.attrition),
    // How the scenario's wars are fought (warSettings.js): null where it says nothing.
    warSettings: normalizeWarSettings(nextWorld.warSettings),
    // Its own unit types (unitTypes.js).
    unitTypes,
    // What it draws on its map for war (warGeography.js).
    terrainAreas: normalizeTerrainAreas(nextWorld.terrainAreas),
    fortifications: normalizeFortifications(nextWorld.fortifications),
    climateZones: normalizeClimateZones(nextWorld.climateZones),
    freezingRegions: normalizeFreezingRegions(nextWorld.freezingRegions),
    frozenRegions: normalizeFreezingRegions(nextWorld.frozenRegions),
    zoneWeather: normalizeZoneWeather(nextWorld.zoneWeather),
    peaceOffers: normalizePeaceOffers(nextWorld.peaceOffers),
    reparations: normalizeReparations(nextWorld.reparations),
    peaceTreaties: normalizePeaceTreaties(nextWorld.peaceTreaties),
    treatyOffers: normalizeTreatyOffers(nextWorld.treatyOffers),
    callsToArms: normalizeCallsToArms(nextWorld.callsToArms),
    puppets: normalizeWorldPuppets(nextWorld.puppets, diplomaticIdentityWorld),
    storylines: normalizeWorldStorylines(nextWorld.storylines),
    socialFeed: normalizeSocialFeed(nextWorld.socialFeed),
    simulationRules: normalizeOptionalString(nextWorld.simulationRules),
    startingTimelineText: normalizeOptionalString(nextWorld.startingTimelineText),
    units,
    // Pruned against the units computed just above, on every read AND write, so
    // an order clears itself the moment its unit actually arrives — see
    // pruneSatisfiedUnitOrders.
    pendingUnitOrders: pruneSatisfiedUnitOrders(units, normalizePendingUnitOrders(nextWorld.pendingUnitOrders)),
    // Which unit system last took a turn on this save: "beta", "classic", or ""
    // for a save written before the two were distinguishable. Stamped by
    // applyEventImpactsToWorld, never by a normalizer — this module has no idea
    // which system is running and must not acquire one.
    //
    // It exists so resumeStandingOrders can tell that game time passed while the
    // beta engine was not running, and so a save can say what wrote it. Neither
    // system reads it to decide behaviour.
    unitSystem: UNIT_SYSTEM_SET.has(normalizeOptionalString(nextWorld.unitSystem))
      ? normalizeOptionalString(nextWorld.unitSystem)
      : "",
  };
};

// Does a polity currently hold no territory? A stateless actor — a
// government-in-exile, a movement, or a person with no country of their own.
// Single source of truth for "landless", used by both the AI prompt
// (buildPlayerPolityRegionsText) and the UI flag resolvers: a landless polity
// with no flag of its own must NOT borrow the code-derived country flag (a
// "stateless person in Japan" is not Japan), so the flag shows neutral instead.
//
// The distinction that matters: owning a region via an override = has land; but
// a scenario that ships NO override list at all means the polity owns its country
// through the base map tiles (a stock modern map), which is NOT landless.
//
// Reads the three maps straight off the world rather than normalizing all of it:
// the UI asks this on every world change, and normalizeWorldState rebuilds
// institutions, actors and relations to answer a question about two maps. Owners
// fold through the same alias resolver normalization uses, built only when a
// region's owner is not already the polity's exact key.
export const isPolityLandless = (world, code) => {
  const polityCode = normalizeString(code);
  if (!polityCode) return false;
  const source = world && typeof world === "object" ? world : {};
  const polityOverrides = source.polityOverrides && typeof source.polityOverrides === "object" ? source.polityOverrides : {};
  const entries = Object.entries(source.regionOwnershipOverrides ?? {})
    .filter(([regionId, ownerCode]) => normalizeOptionalString(regionId) && normalizeOptionalString(ownerCode));
  const wanted = polityCode.toLowerCase();
  let resolveOwner = null;
  const isPolity = (ownerCode) => {
    const raw = normalizeString(ownerCode);
    if (raw.toLowerCase() === wanted) return true;
    resolveOwner ??= createOwnerResolver(buildOwnerAliasMap(polityOverrides));
    return normalizeString(resolveOwner(raw)).toLowerCase() === wanted;
  };
  // Administering a region or being its lawful sovereign both count: an
  // occupied homeland is still a homeland.
  const owns = [...entries, ...Object.entries(source.regionSovereigntyOverrides ?? {})].some(
    ([, ownerCode]) => isPolity(ownerCode),
  );
  if (owns) return false;
  const isKnownPolity = Boolean(polityOverrides[polityCode]);
  // No override list AND not a declared polity = stock map, owns via base tiles.
  if (entries.length === 0 && !isKnownPolity) return false;
  return true;
};

// Recover a Gregorian date stored in a loose format back to strict YYYY-MM-DD.
// Older builds wrote the model's stopDate verbatim, so real saves hold values
// like "2016-12-31T00:00:00.000Z" or "December 31, 2016" — the header displays
// them fine, but date math (addIsoDays) rejects them, so every jump silently
// computes target == origin and the game clock freezes forever while the model
// re-simulates the past. Deliberately non-Gregorian scenario dates ("1200 BCE")
// don't parse and pass through untouched.
const canonicalizeDateString = (value) => {
  const text = normalizeOptionalString(value);
  if (!text) return text;
  // Any game date, BC included ("-218-03-01" becomes "-0218-03-01").
  const canonical = normalizeGameDate(text);
  if (canonical) return canonical;
  // An ISO date prefix (datetime forms) is authoritative — slicing it avoids
  // the timezone day-shift of parsing "...T00:00:00Z" into local time.
  const prefix = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(text);
  if (prefix) return prefix[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    if (year >= 1 && year <= 9999) {
      return `${String(year).padStart(4, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
  }
  return text;
};

export const normalizeGameData = (game) => {
  const nextGame = game && typeof game === "object" ? game : {};
  // `betaUnits` was the per-save unit-system choice while the classic system
  // still existed; there is one system now, so the field is dropped on the way
  // through rather than carried forever.
  const restGame = { ...nextGame };
  delete restGame.betaUnits;

  return {
    ...GAME_DEFAULTS,
    ...restGame,
    // Always store the player's country as its canonical full name, never an ISO-3 code.
    country: toCountryName(normalizeOptionalString(nextGame.country)),
    difficulty: normalizeOptionalString(nextGame.difficulty) || GAME_DEFAULTS.difficulty,
    gameDate: canonicalizeDateString(nextGame.gameDate),
    language: normalizeOptionalString(nextGame.language) || GAME_DEFAULTS.language,
    round:
      Number.isFinite(Number(nextGame.round)) && Number(nextGame.round) > 0
        ? Math.trunc(Number(nextGame.round))
        : GAME_DEFAULTS.round,
    startDate: canonicalizeDateString(nextGame.startDate),
  };
};

export const buildActionDisplayText = (action) => {
  const normalized = normalizeActionEntry(action);
  if (!normalized) {
    return "";
  }

  return normalized.kind === "chat" && normalized.chatStarter
    ? `${normalized.title}: ${normalized.chatStarter}`
    : normalized.text;
};

// A read-only VIEW of the world, shared between callers.
//
// readWorldState() below returns a fresh working object on purpose: many writers
// mutate what they read before writeWorldState(), and sharing one object between
// them would let uncommitted mutations leak. UI and other read-only pipelines
// need no such ownership boundary, and re-normalizing the whole campaign on every
// panel click or unit sync was a measurable source of garbage-collection stalls
// on large saves. The view is rebuilt only when the underlying JSON changes.
let worldViewRaw = null;
let worldViewNormalized = null;

let worldViewCatalog = null;

// Both readers see the disputes the map file declares as well as the world's
// own (runtime/mapClaims.js), from the region catalog the map has already
// parsed; with no map loaded there is nothing to add.
export const readWorldStateView = async ({ force = false } = {}) => {
  const raw = await readJson(JSON_URLS.world, {
    defaultValue: WORLD_DEFAULTS,
    force,
    clone: false,
  });
  const catalog = getPrimedScenarioRegionCatalog();

  if (!force && raw === worldViewRaw && catalog === worldViewCatalog && worldViewNormalized) {
    return worldViewNormalized;
  }

  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const normalized = withMapClaims(normalizeWorldState(raw), catalog);
  const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt;
  reportPerfOperation("normalize world read-only view", elapsed, { warnAt: 40 });

  worldViewRaw = raw;
  worldViewCatalog = catalog;
  worldViewNormalized = normalized;
  noteMapMeasure(normalized);
  return normalized;
};

export const readWorldState = async ({ force = false } = {}) => {
  const world = withMapClaims(
    normalizeWorldState(await readJson(JSON_URLS.world, { defaultValue: WORLD_DEFAULTS, force })),
    getPrimedScenarioRegionCatalog(),
  );
  noteMapMeasure(world);
  return world;
};

// Same-tab cache agreement after a country Stats commit.
//
// This is intentionally NOT a second ledger. The worker has written canonical
// world.json. This helper only makes the same-tab in-memory cache agree with those
// persisted countryStats/history fields without re-reading, re-normalizing,
// re-stringifying or re-broadcasting the whole world document.
export const primeCountryStatsWorkerCommit = async ({
  country,
  sheet,
  historySeries,
} = {}) => {
  const key = normalizeOptionalString(country);
  if (!key || !sheet || typeof sheet !== "object") return null;

  const raw = await readJson(JSON_URLS.world, {
    defaultValue: WORLD_DEFAULTS,
    force: false,
    clone: false,
  });

  if (!raw || typeof raw !== "object") return null;
  if (!raw.countryStats || typeof raw.countryStats !== "object") raw.countryStats = {};
  raw.countryStats[key] = sheet;

  if (Array.isArray(historySeries)) {
    if (!raw.countryStatsHistory || typeof raw.countryStatsHistory !== "object") {
      raw.countryStatsHistory = {};
    }
    raw.countryStatsHistory[key] = historySeries;
  }

  // Keep the raw asset cache pointed at the authoritative same-tab object.
  primeJson(JSON_URLS.world, raw, { clone: false });

  // Keep the explicit read-only normalized view coherent too. Only the Stats
  // domain is patched; map-facing identity/ownership objects retain their stable
  // references and therefore do not wake React/MapLibre consumers.
  if (worldViewRaw && typeof worldViewRaw === "object") {
    if (!worldViewRaw.countryStats || typeof worldViewRaw.countryStats !== "object") {
      worldViewRaw.countryStats = {};
    }
    worldViewRaw.countryStats[key] = sheet;
    if (Array.isArray(historySeries)) {
      if (!worldViewRaw.countryStatsHistory || typeof worldViewRaw.countryStatsHistory !== "object") {
        worldViewRaw.countryStatsHistory = {};
      }
      worldViewRaw.countryStatsHistory[key] = historySeries;
    }
  }

  if (worldViewNormalized && typeof worldViewNormalized === "object") {
    if (!worldViewNormalized.countryStats || typeof worldViewNormalized.countryStats !== "object") {
      worldViewNormalized.countryStats = {};
    }
    worldViewNormalized.countryStats[key] = sheet;
    if (Array.isArray(historySeries)) {
      if (!worldViewNormalized.countryStatsHistory || typeof worldViewNormalized.countryStatsHistory !== "object") {
        worldViewNormalized.countryStatsHistory = {};
      }
      worldViewNormalized.countryStatsHistory[key] = historySeries;
    }
  }

  return sheet;
};

export const writeWorldState = async (world, options = {}) => {
  const normalized = normalizeWorldState(world);
  noteMapMeasure(normalized);
  // Polity names, aliases and notes written during play are not queued for
  // translation: the AI writes them in the player's language already, and the
  // player types theirs in it. A scenario's own polities are content, queued
  // when the game opens and when the scenario is saved (translator.js).
  return writeJson(JSON_URLS.world, normalized, { pretty: true, ...options, normalized: true });
};

export const readGameData = async ({ force = false } = {}) =>
  normalizeGameData(await readJson(JSON_URLS.game, { defaultValue: GAME_DEFAULTS, force }));

export const writeGameData = async (game, options = {}) =>
  writeJson(JSON_URLS.game, normalizeGameData(game), { pretty: true, ...options });

export const readActionsState = async ({ force = false } = {}) =>
  normalizeActions(await readJson(JSON_URLS.actions, { defaultValue: [], force }));

export const writeActionsState = async (actions, options = {}) =>
  writeJson(JSON_URLS.actions, normalizeActions(actions), { pretty: true, ...options });

export const readEventsState = async ({ force = false } = {}) =>
  normalizeEvents(await readJson(JSON_URLS.events, { defaultValue: [], force }));

export const writeEventsState = async (events, options = {}) => {
  const { preserveApprovedEvents = false, ...writeOptions } = options || {};
  // Choke-point safety net: ordinary AI writers cannot persist a log that already
  // contains prose-identical repeats. The GM Console is different: Apply persists
  // the EXACT administrator-approved transaction, and its own canonical duplicate
  // check includes structured effects. A corrected transaction may therefore reuse
  // the same date/title/description while intentionally carrying different impacts.
  const normalizedEvents = normalizeEvents(events);
  // Even then the log stays free of TRUE duplicates — same prose AND the same
  // structured effects (eventCanonicalKey), the rule Apply itself checks with.
  const normalized = preserveApprovedEvents
    ? dedupeEventLog(normalizedEvents, { keyOf: eventCanonicalKey })
    : dedupeEventLog(normalizedEvents);
  // A scenario's own events follow the UI language immediately (see above);
  // the AI's are written in it.
  enqueueEventStrings(normalized);
  return writeJson(JSON_URLS.events, normalized, { pretty: true, ...writeOptions });
};

// Spy intercepts live in their own asset rather than in world.json: they are
// refreshed after a jump, in the wake of the turn's own world write, and a
// second writer on world.json would race it (desktop: last file write wins).
export const readInterceptsState = async ({ force = false } = {}) => {
  const raw = await readJson(JSON_URLS.intercepts, { defaultValue: {}, force });
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
};

export const writeInterceptsState = async (intercepts, options = {}) =>
  writeJson(JSON_URLS.intercepts, intercepts && typeof intercepts === "object" ? intercepts : {}, { pretty: true, ...options });

// The conversations, the player's and the advisor's: a failed read THROWS. It
// used to come back as [] like an empty file, and every writer that read,
// changed and wrote the list (the Diplomacy panel, the runtime store it syncs
// from, a turn's commit, the outreach and idle drips, the advisor's notices)
// then saved that short list over every conversation. A missing document (a
// new game) is legitimately empty: the stores answer it with an empty list or
// a 404.
const readConversationJson = (url, { force = false } = {}) =>
  readJson(url, { force }).catch((error) => {
    if (error?.status === 404) return [];
    throw error;
  });

export const readChatsState = async ({ force = false } = {}) =>
  normalizeChats(await readConversationJson(JSON_URLS.chat, { force }));

export const readAdvisorMessages = async ({ force = false } = {}) => {
  const messages = await readConversationJson(JSON_URLS.advisor, { force });
  return Array.isArray(messages) ? messages : [];
};

let chatWriteQueue = Promise.resolve();

// Unqueued: only for callers already running inside the canonical queue.
const writeChatsNow = (chats, options = {}) =>
  writeJson(JSON_URLS.chat, cloneValue(normalizeChats(chats)), { pretty: true, ...options });

export const writeChatsState = async (chats, options = {}) => {
  const normalized = normalizeChats(chats);
  const snapshot = cloneValue(normalized);
  const write = () => writeJson(JSON_URLS.chat, snapshot, { pretty: true, ...options });
  const pending = chatWriteQueue.then(write, write);
  chatWriteQueue = pending.then(() => undefined, () => undefined);
  return pending;
};

// Publish the six canonical per-turn domains as one generation. Desktop uses a
// durable journal plus per-file atomic replacement; web mode stores the complete
// generation in one IndexedDB game-record transaction. Client caches are flipped
// together only after persistence succeeds, so readers never observe a half-turn.
const buildCanonicalTurnPayload = ({
  actions = [],
  chats = [],
  events = [],
  game = {},
  colors = {},
  world = {},
} = {}, { expectedGameId = "", preserveApprovedEvents = false } = {}) => {
  const normalizedWorld = normalizeWorldState(world);

  const eventLog = normalizeEvents(events);
  const normalizedEvents = preserveApprovedEvents
    ? dedupeEventLog(eventLog, { keyOf: eventCanonicalKey })
    : dedupeEventLog(eventLog);
  enqueueEventStrings(normalizedEvents);

  return {
    actions: cloneValue(normalizeActions(actions)),
    chat: cloneValue(normalizeChats(chats)),
    events: cloneValue(normalizedEvents),
    game: cloneValue(normalizeGameData(game)),
    colors: colors && typeof colors === "object" && !Array.isArray(colors) ? cloneValue(colors) : {},
    world: normalizedWorld,
    ...(String(expectedGameId ?? "").trim() ? { expectedGameId: String(expectedGameId).trim() } : {}),
  };
};

const commitCanonicalTurnPayload = async (payload, {
  emitEvents = true,
  startedAt = typeof performance !== "undefined" ? performance.now() : Date.now(),
} = {}) => {
  const stringifyStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const body = JSON.stringify(payload);
  reportPerfOperation(
    "stringify canonical turn commit",
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - stringifyStartedAt,
    { extra: `${Math.round(body.length / 1024)} KiB`, warnAt: 50 },
  );

  // The campaign this generation is written to, as the endpoints named it when
  // the commit went out. Several MB of echo take a while to arrive and parse, and
  // a switch to another save in that time repoints JSON_URLS at it (the token in
  // them changes): publishing then would fill the new save's caches and map with
  // this campaign's state, and the next unforced read would hand it back to be
  // written over the new save. writeJson is safe the same way, by priming the URL
  // it wrote rather than the one that is current.
  const generationUrl = String(JSON_URLS.game || "");
  const response = await fetch("/api/runtime/turn-commit", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!response.ok) throw new Error(`Failed to commit canonical turn: HTTP ${response.status}`);

  let committed = payload;
  let transactionId = "";
  try {
    const echoed = await response.json();
    if (echoed?.assets && typeof echoed.assets === "object") committed = echoed.assets;
    transactionId = String(echoed?.transactionId ?? "");
  } catch {
    // Alternate/older stores may answer without JSON. The normalized submitted
    // generation remains the best available client representation.
  }

  // Written, and to the right campaign (the store checked expectedGameId), but
  // no longer the one on screen: nothing of it belongs in the caches now.
  if (String(JSON_URLS.game || "") !== generationUrl) {
    reportPerfOperation(
      "canonical turn commit",
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
      { extra: `${transactionId} (not published: the campaign changed)`, warnAt: 100 },
    );
    return { ...committed, transactionId, published: false };
  }

  publishJsonWriteBatch([
    { url: JSON_URLS.actions, value: committed.actions },
    { url: JSON_URLS.chat, value: committed.chat },
    { url: JSON_URLS.events, value: committed.events },
    { url: JSON_URLS.game, value: committed.game },
    { url: JSON_URLS.colors, value: committed.colors },
    { url: JSON_URLS.world, value: committed.world, cacheClone: false, normalized: true },
  ], { emitEvents });

  worldViewRaw = committed.world;
  worldViewNormalized = committed.world;

  reportPerfOperation(
    "canonical turn commit",
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
    { extra: transactionId, warnAt: 100 },
  );
  return { ...committed, transactionId };
};

const enqueueCanonicalGenerationWrite = (write) => {
  const pending = chatWriteQueue.then(write, write);
  chatWriteQueue = pending.then(() => undefined, () => undefined);
  return pending;
};

// How far each leader has been shown of its other threads
// (AI/crossChatKnowledge.js), merged into the saved world after a diplomatic
// reply. Merged rather than replaced: a turn in one chat must not forget what
// another chat showed. In the canonical write queue, so it can neither land
// between a canonical commit's read and its write nor be overwritten by one,
// and it re-reads the world first. Quiet: no echo to parse and no
// world-updated event for the map and every panel, for a few ids nothing on
// screen shows. Calls made while one is waiting to run join it, and nothing is
// written when every cursor already stands at what it is given.
let pendingCursorMerge = null;

export const mergeChatKnowledgeCursors = (cursors) => {
  if (!cursors || typeof cursors !== "object" || !Object.keys(cursors).length) return Promise.resolve(false);
  if (pendingCursorMerge) {
    Object.assign(pendingCursorMerge.cursors, cursors);
    return pendingCursorMerge.done;
  }
  const merge = { cursors: { ...cursors }, done: null };
  pendingCursorMerge = merge;
  merge.done = enqueueCanonicalGenerationWrite(async () => {
    if (pendingCursorMerge === merge) pendingCursorMerge = null;
    const world = await readWorldState({ force: true });
    const current = world?.chatKnowledgeCursors ?? {};
    const moved = Object.entries(merge.cursors).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value));
    if (!moved) return false;
    await writeWorldState({ ...world, chatKnowledgeCursors: { ...current, ...merge.cursors } }, { echo: false, emitEvents: false });
    return true;
  });
  return merge.done;
};

export const writeCanonicalTurnState = (state = {}, {
  expectedGameId = "",
  emitEvents = true,
  preserveApprovedEvents = false,
} = {}) => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const payload = buildCanonicalTurnPayload(state, { expectedGameId, preserveApprovedEvents });
  return enqueueCanonicalGenerationWrite(() => commitCanonicalTurnPayload(payload, { emitEvents, startedAt }));
};

// A write made for an entry of the queue of a shared game's host (`fence`,
// multiplayer/host/worldQueue.js): refused once that entry has been let go,
// when it is asked, and again when its turn in this write queue comes, where
// its mutator writes nothing (null) once the entry is gone. Rejects with the
// fence's refusal when the entry was let go before the write came back. A
// write with no fence is any other, as ever.
const underFence = (fence, mutator, write) => {
  if (!fence) return write(mutator);
  return fence.through(fence.live ? fence.write(write, mutator) : undefined);
};

// Deterministic native read-modify-write against the latest canonical
// generation. Provider/model calls do not belong in this seam: do any slow
// reasoning first, then publish the small native mutation here. The read occurs
// only after prior canonical/chat writes drain, which is what prevents an
// institutional vote or player message queued during an AI call from being
// overwritten by an older snapshot. `fence`: see underFence.
export const mutateCanonicalTurnState = (mutator, {
  expectedGameId = "",
  emitEvents = true,
  guardRuntimeGeneration = true,
  preserveApprovedEvents = false,
  fence = null,
} = {}) => {
  if (typeof mutator !== "function") {
    return Promise.reject(new TypeError("mutateCanonicalTurnState requires a mutator function."));
  }

  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const expectedRuntimeGameUrl = guardRuntimeGeneration ? String(JSON_URLS.game || "") : "";
  const assertRuntimeGeneration = () => {
    if (expectedRuntimeGameUrl && String(JSON_URLS.game || "") !== expectedRuntimeGameUrl) {
      throw new Error("Active campaign changed before canonical mutation could commit.");
    }
  };

  return underFence(fence, mutator, (apply) => enqueueCanonicalGenerationWrite(async () => {
    assertRuntimeGeneration();
    const [actions, chats, events, game, world, colors] = await Promise.all([
      readActionsState({ force: true }),
      readChatsState({ force: true }),
      readEventsState({ force: true }),
      readGameData({ force: true }),
      readWorldState({ force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
    ]);
    const current = { actions, chats, events, game, world, colors };
    const patch = await apply(current);
    assertRuntimeGeneration();
    if (!patch || typeof patch !== "object") {
      return { skipped: true, ...current, chat: current.chats, transactionId: "" };
    }

    const next = {
      ...current,
      ...patch,
      chats: Object.prototype.hasOwnProperty.call(patch, "chats")
        ? patch.chats
        : Object.prototype.hasOwnProperty.call(patch, "chat") ? patch.chat : chats,
    };
    const payload = buildCanonicalTurnPayload(next, { expectedGameId, preserveApprovedEvents });
    return commitCanonicalTurnPayload(payload, { emitEvents, startedAt });
  }));
};

// One document's read-modify-write, on the same queue as the canonical
// generation and the chat writes. The document is read fresh INSIDE the queue,
// so the mutator always starts from what the previous write left. Reading it
// before a model call and writing the whole of it back afterwards is how a unit
// the player deployed, or a note another writer posted, while the call was out
// used to be erased: the old copy won. Call the model first, then hand its
// result to a mutator that applies it to the current document.
//
// The mutator gets the current value and returns the next one (it may change
// the one it was given and return it), or null/undefined to write nothing. It
// must stay native and quick: nothing it awaits may queue another canonical
// write, or the queue waits on itself. Resolves to the saved value, or null
// when nothing was written. Rejects, writing nothing, if the active campaign
// changed after the call was made. `fence`: see underFence.
const RUNTIME_DOCUMENTS = {
  world: {
    read: () => readWorldState({ force: true }),
    write: (value, options) => writeWorldState(value, options),
  },
  chats: {
    read: () => readChatsState({ force: true }),
    write: (value, options) => writeChatsNow(value, options),
  },
  events: {
    read: () => readEventsState({ force: true }),
    write: (value, options) => writeEventsState(value, options),
  },
  actions: {
    read: () => readActionsState({ force: true }),
    write: (value, options) => writeActionsState(value, options),
  },
  game: {
    read: () => readGameData({ force: true }),
    write: (value, options) => writeGameData(value, options),
  },
  intercepts: {
    read: () => readInterceptsState({ force: true }),
    write: (value, options) => writeInterceptsState(value, options),
  },
  // A shared game's session (multiplayer/host/sessionRecord.js): who plays
  // which country, kept with the campaign. Written by the host's engine window
  // alone, in the host's own order; here so it is never written into a campaign
  // that is no longer the open one.
  shared: {
    read: () => readJson(JSON_URLS.shared, { defaultValue: {}, force: true }),
    write: (value, options) => writeJson(JSON_URLS.shared, value && typeof value === "object" && !Array.isArray(value) ? value : {}, options),
  },
  // The game's flags (runtime/polityFlags.js setPolityFlag, the Game Master's
  // renames): written in this one order, so a flag set for an entry of a
  // shared game's host is never written beside another's. Read with no
  // default: the whole map is written back, so a read that failed must stop
  // the write rather than pass for an empty file and erase every other flag.
  flags: {
    read: () => readJson(JSON_URLS.flags, { force: true }),
    write: (value, options) => writeJson(JSON_URLS.flags, value && typeof value === "object" && !Array.isArray(value) ? value : {}, options),
  },
  // The advisor's conversation: written by its panel, by document notices and
  // by a rollback, so all three meet here too.
  advisor: {
    // A read that fails throws (readConversationJson), so nothing is ever written
    // over a conversation that could not be loaded.
    read: () => readAdvisorMessages({ force: true }),
    write: (value, options) => writeJson(JSON_URLS.advisor, Array.isArray(value) ? value : [], options),
  },
};

export const mutateRuntimeDocument = (key, mutator, {
  guardRuntimeGeneration = true,
  fence = null,
  ...writeOptions
} = {}) => {
  const document = RUNTIME_DOCUMENTS[key];
  if (!document) return Promise.reject(new TypeError(`mutateRuntimeDocument: unknown document "${key}".`));
  if (typeof mutator !== "function") {
    return Promise.reject(new TypeError("mutateRuntimeDocument requires a mutator function."));
  }
  const expectedRuntimeGameUrl = guardRuntimeGeneration ? String(JSON_URLS.game || "") : "";
  const assertRuntimeGeneration = () => {
    if (expectedRuntimeGameUrl && String(JSON_URLS.game || "") !== expectedRuntimeGameUrl) {
      throw new Error(`Active campaign changed before the ${key} write could commit.`);
    }
  };
  return underFence(fence, mutator, (apply) => enqueueCanonicalGenerationWrite(async () => {
    assertRuntimeGeneration();
    const current = await document.read();
    const next = await apply(current);
    assertRuntimeGeneration();
    if (next === null || next === undefined) return null;
    return document.write(next, writeOptions);
  }));
};

export const mutateWorldState = (mutator, options) => mutateRuntimeDocument("world", mutator, options);
export const mutateChatsState = (mutator, options) => mutateRuntimeDocument("chats", mutator, options);
export const mutateEventsState = (mutator, options) => mutateRuntimeDocument("events", mutator, options);
export const mutateActionsState = (mutator, options) => mutateRuntimeDocument("actions", mutator, options);
export const mutateGameData = (mutator, options) => mutateRuntimeDocument("game", mutator, options);
export const mutateInterceptsState = (mutator, options) => mutateRuntimeDocument("intercepts", mutator, options);
export const mutateAdvisorState = (mutator, options) => mutateRuntimeDocument("advisor", mutator, options);
export const mutateSharedSessionState = (mutator, options) => mutateRuntimeDocument("shared", mutator, options);
export const mutateFlagsState = (mutator, options) => mutateRuntimeDocument("flags", mutator, options);

// A write another thread performs, run while this page's write queue is held.
// The country-stats worker reads world.json, merges one sheet in and PUTs the
// whole document back itself (it keeps that stringify off the page); held here
// for that round trip, no queued page write can land between its read and its
// PUT and be erased by it. The whole queue waits on the task, so it must settle
// on its own: give it a timeout. Rejects, running nothing, if the active
// campaign changed after the call was made.
export const runInCanonicalWriteQueue = (task, { guardRuntimeGeneration = true } = {}) => {
  if (typeof task !== "function") {
    return Promise.reject(new TypeError("runInCanonicalWriteQueue requires a task function."));
  }
  const expectedRuntimeGameUrl = guardRuntimeGeneration ? String(JSON_URLS.game || "") : "";
  return enqueueCanonicalGenerationWrite(async () => {
    if (expectedRuntimeGameUrl && String(JSON_URLS.game || "") !== expectedRuntimeGameUrl) {
      throw new Error("Active campaign changed before the write could run.");
    }
    return task();
  });
};

export const readCountryStatsBundle = async ({ force = false } = {}) => {
  const [actions, events, game, world] = await Promise.all([
    readActionsState({ force }),
    readEventsState({ force }),
    readGameData({ force }),
    readWorldStateView({ force }),
  ]);

  // Country Stats is grounded in canonical world/events/actions. It does not need
  // to normalize/reconcile the entire diplomatic archive merely to display GDP.
  return {
    actions,
    chats: [],
    events,
    game,
    world,
  };
};

export const readGameStateBundle = async ({ force = false } = {}) => {
  const [actions, chats, events, game, world] = await Promise.all([
    readActionsState({ force }),
    readChatsState({ force }),
    readEventsState({ force }),
    readGameData({ force }),
    readWorldState({ force }),
  ]);

  return {
    actions,
    chats,
    events,
    game,
    world,
  };
};

// What of the finished world belongs to no turn: the Game Master's standing
// facts and log, the seal, what each leader has been shown, the player's goal.
// The world as seen keeps today's.
const STATE_OUTSIDE_THE_TURN = ["simulationReminders", "gmChanges", "spySeal", "seatSeals", "chatKnowledgeCursors", "playerGoals"];

// The campaign as the player has been shown it (runtime/unseenEvents.js). While
// a skip is being revealed the save already holds all of it, and whatever
// speaks to the player — the advisor, a leader, a suggestion — must be built
// from what the player has seen: the events up to the reveal's front, the world
// as those events left it (the turn's restore point with them applied, exactly
// as the map is showing it), the threads without what the unseen events wrote,
// and the date of the last event shown. With nothing unseen everything comes
// back as given; without a restore point the finished world is kept, less the
// papers the unseen events wrote.
export const viewAsSeen = async ({ world, events, chats, game } = {}, { unseen = null } = {}) => {
  const hidden = unseen instanceof Set ? unseen : unseenEvents.unseenFor(world);
  if (!hidden.size) return { world, events, chats, game, unseen: hidden };
  const turn = world?.simulationHistory?.[0] ?? {};
  const byId = new Map(normalizeArray(events).map((event) => [String(event?.id ?? ""), event]));
  const seenTurnEvents = latestTurnEventIds(world)
    .filter((id) => !hidden.has(id))
    .map((id) => byId.get(id))
    .filter(Boolean);
  let seenWorld = null;
  try {
    // The one restore point the turn started from, shared, not the archive of
    // twelve: only its world is copied, since applying events to it may change it.
    const snap = await loadTurnRestorePoint({ fromDate: turn.fromDate, toDate: turn.toDate || turn.date });
    if (snap) {
      const staged = applyEventImpactsToWorld({
        colors: {},
        events: normalizeEvents(seenTurnEvents),
        motion: { originDate: snap.fromDate || turn.fromDate || "", round: Number(turn.round) || Number(snap.round) || 0, tick: 0 },
        world: normalizeWorldState(cloneValue(snap.state.world)),
      }).world;
      const stolenBy = new Map(normalizeArray(world?.reports).map((report) => [report?.id, report?.interceptedBy]));
      seenWorld = {
        ...staged,
        ...Object.fromEntries(STATE_OUTSIDE_THE_TURN.filter((key) => world?.[key] !== undefined).map((key) => [key, world[key]])),
        reports: normalizeArray(staged.reports).map((report) => (normalizeArray(stolenBy.get(report.id)).length
          ? { ...report, interceptedBy: stolenBy.get(report.id) }
          : report)),
      };
    }
  } catch { /* no restore point to stage from: the finished world, less the unseen papers */ }
  const seenDate = normalizeOptionalString(seenTurnEvents.at(-1)?.date) || normalizeOptionalString(turn.fromDate);
  return {
    world: seenWorld ?? { ...world, reports: withoutUnseenReports(world?.reports, hidden) },
    events: withoutUnseenEvents(events, hidden),
    chats: withoutUnseenChats(chats, hidden),
    game: game && seenDate ? { ...game, gameDate: seenDate } : game,
    unseen: hidden,
  };
};

// The polity registry as it will stand once this event's changes land, used only
// to build the alias map. An event's transfers are applied before its polity
// changes, and a conquest routinely arrives in the same event as the rename that
// names its winner — so the new name has to be known before the transfers are
// read, or that one turn's regions land under a second, phantom owner.
const previewPolityOverrides = (polityOverrides, pendingChanges) => {
  if (pendingChanges.length === 0) {
    return polityOverrides;
  }

  const preview = { ...polityOverrides };
  for (const { change, code } of pendingChanges) {
    preview[code] = {
      ...(preview[code] ?? { aliases: [], code, name: "" }),
      ...(change.aliases?.length > 0 ? { aliases: change.aliases } : {}),
      ...(change.name ? { name: change.name } : {}),
    };
  }

  return preview;
};

// motion: { originDate, round, tick } enables realistic travel. Each event gets a
// budget of exactly the days between the previous event and its own date, so an
// op on day 3 of a 90-day jump only moves three days' worth. Passing motion: null
// (the default) leaves moves unclamped, i.e. exactly the old behaviour — which is
// also the right fallback for a scenario whose dates are not Gregorian.
// `round` stamps world.projects[].updatedRound so the board can say how long a
// programme has sat still. It defaults to 0 (meaning "leave the stamp alone")
// rather than being required, because the staged event reveal in time.jsx replays
// impacts purely for display and must not age the projects it is only redrawing.
// The territory-and-identity half of applying impacts: region transfers, region
// claims, and everything a polityChange carries (name, colour, reputation, stats,
// tags).
//
// Extracted from applyEventImpactsToWorld's event loop so that the NON-event
// writers can reach it too. A project's onComplete effects have to be applied by
// whoever completes the project, and the advisor's ```projects fence and the
// Projects panel's own buttons both complete projects without an event anywhere in
// sight. Two implementations of this would be two chances to get the owner-alias
// resolution wrong; there is one.
//
// Mutates `world` and `colors` in place — both are already the caller's private
// normalized copies.
// Public native mutation seam for a country's persistent stat sheet: every
// writer (an event's polityChanges.stats, the Stats pane, tracking) goes through
// the same compatibility + deterministic aggregation path in countryStats.js
// instead of editing the UI-shaped fields directly.
export const applyCountryStatPatchToWorld = (world, canonicalName, patch, options = {}) => {
  if (!world || typeof world !== "object" || !canonicalName) return null;
  if (!world.countryStats || typeof world.countryStats !== "object") world.countryStats = {};

  const next = mergeCountryStatPatch(world.countryStats[canonicalName], patch, options);
  if (next && typeof next === "object") world.countryStats[canonicalName] = next;
  return next;
};

const samePolity = (a, b) =>
  normalizeOptionalString(a).toLowerCase() === normalizeOptionalString(b).toLowerCase();

// The claimant list of a region: one entry per polity (case-insensitively), at
// most four, and the key deleted at zero — the region then recorded as settled
// (settleRegionClaims). An empty array left behind is a
// permanent phantom difference to useWorldState's JSON comparison and a stripe
// nobody can see (Nations.jsx tests `regionClaimants[id]?.length`).
const writeRegionClaimants = (world, regionId, values) => {
  const kept = [];
  for (const raw of normalizeArray(values)) {
    const name = normalizeOptionalString(raw);
    if (!name || kept.some((entry) => samePolity(entry, name))) continue;
    kept.push(name);
  }
  if (kept.length > 0) {
    world.regionClaimants[regionId] = kept.slice(0, 4);
    if (Array.isArray(world.settledRegionClaims) && world.settledRegionClaims.includes(regionId)) {
      world.settledRegionClaims = world.settledRegionClaims.filter((id) => id !== regionId);
    }
  } else {
    settleRegionClaims(world, regionId);
  }
};

// The dispute over a region is over. The row goes, as it always has, and the
// region is recorded as settled: a region's geojson feature may bake claimants
// in (the built-in map does, for 109 regions), and the map draws those wherever
// the world has no row, so without the record an ended dispute came back —
// even one ended by a clean hand-over, which clears whatever the scenario
// declared.
const settleRegionClaims = (world, regionId) => {
  delete world.regionClaimants[regionId];
  if (!Array.isArray(world.settledRegionClaims)) world.settledRegionClaims = [];
  if (!world.settledRegionClaims.includes(regionId)) world.settledRegionClaims.push(regionId);
};

// A world with the claimants given taken off their regions ([{ regionId, claimant }]): contests on a battlefield's
// ground that nothing holds up any more (AI/frontTurn.js checkContests). The world itself when none is there.
export const withoutClaimants = (world, expired) => {
  const list = normalizeArray(expired).filter((entry) => normalizeOptionalString(entry?.regionId) && normalizeOptionalString(entry?.claimant));
  const held = world?.regionClaimants && typeof world.regionClaimants === "object" ? world.regionClaimants : {};
  const touched = list.filter((entry) => normalizeArray(held[entry.regionId]).some((name) => samePolity(name, entry.claimant)));
  if (touched.length === 0) return world;
  const next = {
    ...world,
    regionClaimants: { ...held },
    settledRegionClaims: Array.isArray(world.settledRegionClaims) ? [...world.settledRegionClaims] : [],
  };
  for (const { regionId, claimant } of touched) {
    writeRegionClaimants(next, regionId, normalizeArray(next.regionClaimants[regionId]).filter((name) => !samePolity(name, claimant)));
  }
  return next;
};

// A world in which no region is disputed for being held on a battlefield
// (fronts/heldRegions.js): the claimants a battlefield accounts for are taken
// off the regions its sides have taken from each other. The world itself when
// there is nothing to take off. For a game saved while such ground was still
// drawn in stripes, when its next turn's land war is written.
export const withoutBattlefieldDisputes = (world) => {
  const changed = battlefieldHeldClaimants({
    battlefields: world?.battlefields,
    owners: world?.regionOwnershipOverrides,
    sovereigns: world?.regionSovereigntyOverrides,
    claimants: world?.regionClaimants,
  });
  if (changed.size === 0) return world;
  const next = {
    ...world,
    regionClaimants: { ...world.regionClaimants },
    settledRegionClaims: Array.isArray(world.settledRegionClaims) ? [...world.settledRegionClaims] : [],
  };
  for (const [regionId, kept] of changed) writeRegionClaimants(next, regionId, kept);
  return next;
};

// Legal sovereignty is stored SPARSELY: an entry exists only while the lawful
// sovereign differs from the polity administering the region (an occupation, a
// displaced government's homeland). Normal territory has no row.
const writeRegionSovereign = (world, regionId, sovereign) => {
  const name = normalizeOptionalString(sovereign);
  const controller = normalizeOptionalString(world.regionOwnershipOverrides[regionId]);
  if (!name || (controller && samePolity(controller, name))) delete world.regionSovereigntyOverrides[regionId];
  else world.regionSovereigntyOverrides[regionId] = name;
};

const POLITY_LIFECYCLE_STORES = ["countryStats", "countryTags", "internationalReputation", "intelligence"];

// WHAT A DISSOLVED POLITY LEAVES. "a polity isn't annexed or dismantled
// completely despite specific instructions saying so ... claims staying from
// the dismantled polity (despite it not existing)" (a player, 2026-11). A
// dissolution used to be refused whenever the polity still had a row on the
// map, even one it only occupied, and when it went through, every claim and
// dispute it had stayed drawn. Now it leaves nothing behind.
//
// The heir is the one polity the dissolving event hands the polity's land to
// (its transfers and captures from it), or else the one polity the event
// creates or restores. None, or several, is no heir.
export const dissolutionHeir = ({ code, polityChanges = [], regionTransfers = [], regionControlOps = [], resolveOwner = (name) => name }) => {
  const nameOf = (value) => resolveOwner(value) || normalizeOptionalString(value);
  const receivers = new Map();
  for (const entry of [...normalizeArray(regionTransfers), ...normalizeArray(regionControlOps).filter((op) => op?.op === "control")]) {
    if (!samePolity(nameOf(entry?.fromCode), code)) continue;
    const to = nameOf(entry?.toCode);
    if (to && !samePolity(to, code)) receivers.set(to.toLowerCase(), to);
  }
  if (receivers.size === 1) return [...receivers.values()][0];
  if (receivers.size > 1) return "";
  const founded = normalizeArray(polityChanges)
    .filter(({ change }) => ["create", "restore"].includes(change?.operation))
    .map(({ code: heir }) => heir)
    .filter((heir) => heir && !samePolity(heir, code));
  return founded.length === 1 ? founded[0] : "";
};

// The rows a dissolved polity is in, and what becomes of each: `control`
// rows go to a new controller (its lawful sovereign, or the heir), `title`
// rows are its sovereignty over land another holds (to the heir, or nobody's
// once it is gone), `refused` counts land it holds outright with no heir.
// `heirOf(regionId)`, where given, names the heir of each region it holds
// outright (a state dissolved in defeat, its land divided among the powers that
// took it: runtime/warEndings.js); `heir` stands for any it names none for.
export const dissolvedPolityLand = (world, code, { heir = "", heirOf = null } = {}) => {
  const owners = world?.regionOwnershipOverrides ?? {};
  const sovereigns = world?.regionSovereigntyOverrides ?? {};
  const control = [];
  const title = [];
  let refused = 0;
  for (const [regionId, controller] of Object.entries(owners)) {
    if (!samePolity(controller, code)) continue;
    const sovereign = normalizeOptionalString(sovereigns[regionId]);
    const to = (typeof heirOf === "function" ? normalizeOptionalString(heirOf(regionId)) : "") || heir;
    if (sovereign && !samePolity(sovereign, code)) control.push({ regionId, to: sovereign, sovereign });
    else if (to) control.push({ regionId, to, sovereign: to });
    else refused += 1;
  }
  for (const [regionId, sovereign] of Object.entries(sovereigns)) {
    if (!samePolity(sovereign, code) || samePolity(owners[regionId], code)) continue;
    title.push({ regionId, to: heir });
  }
  return { control, title, refused, heir };
};

export const applyDissolvedPolityLand = (world, code, { control = [], title = [], heir = "" } = {}) => {
  for (const { regionId, to, sovereign } of control) {
    world.regionOwnershipOverrides[regionId] = to;
    writeRegionSovereign(world, regionId, sovereign);
    // Its new holder is no claimant of it: an occupation's stripe ends with the occupier.
    const claimants = normalizeArray(world.regionClaimants?.[regionId]);
    if (claimants.some((name) => samePolity(name, to) || samePolity(name, code))) {
      writeRegionClaimants(world, regionId, claimants.filter((name) => !samePolity(name, to) && !samePolity(name, code)));
    }
  }
  for (const { regionId, to } of title) {
    if (to) writeRegionSovereign(world, regionId, to);
    else delete world.regionSovereigntyOverrides[regionId];
  }
  // Every claim and every dispute it had, everywhere: as the lawful sovereign
  // of land another occupies its heir stands in its place; otherwise it is
  // simply gone. A region with nobody left on it is settled.
  for (const [regionId, claimants] of Object.entries(world.regionClaimants ?? {})) {
    const list = normalizeArray(claimants);
    if (!list.some((name) => samePolity(name, code))) continue;
    const sovereign = normalizeOptionalString(world.regionSovereigntyOverrides[regionId]);
    const standIn = heir && samePolity(sovereign, heir) ? [heir] : [];
    const controller = normalizeOptionalString(world.regionOwnershipOverrides[regionId]);
    writeRegionClaimants(world, regionId, [...list.filter((name) => !samePolity(name, code)), ...standIn]
      .filter((name) => !samePolity(name, controller)));
  }
};

const applyPolityAndTerritoryImpacts = ({
  colors, eventDate = "", eventId = "", polityChanges = [], regionClaims = [], regionControlOps = [], regionTransfers = [], resolveOwner, world,
}) => {
  // The net under the turn validator (runtime/territoryBasis.js). A transfer or
  // a control flip that says its own basis is a claim, a threat or a raid moves
  // no border: the claim becomes a regionClaims entry and the rest is left out.
  // The validator has normally done this already and told the model; this
  // catches the impacts that never met it (the Game Master console, a project's
  // stored onComplete effects, a hand-edited save). Screening is idempotent, and
  // an entry with no basis passes through untouched.
  const screened = screenTerritoryBasis({ regionClaims, regionControlOps, regionTransfers });
  for (const action of screened.actions) {
    console.warn(
      `[territory basis] ${action.family} on ${action.region}${action.toCode ? ` to "${action.toCode}"` : ""} ` +
        `carried basis "${action.basis}"; ${action.outcome === "claimed" ? "recorded as a claim" : "not applied"}.`,
    );
  }
  ({ regionClaims, regionControlOps, regionTransfers } = screened);

  // Lifecycle first: a polity this event creates or restores exists before the
  // same event's territory is resolved. Dissolution waits until the end, so the
  // event can settle the polity's land before it is judged gone.
  const dissolutions = [];
  for (const { change, code } of polityChanges) {
    const operation = change.operation || "update";
    if (operation === "dissolve") {
      dissolutions.push({ change, code });
      continue;
    }
    if (operation !== "create" && operation !== "restore") continue;
    const existing = world.polityOverrides[code];
    const alive = Boolean(existing) && normalizeOptionalString(existing.status).toLowerCase() !== "dissolved";
    if (operation === "create" && (alive || !samePolity(code, change.code))) {
      console.warn(`[polity lifecycle] create of "${change.code}" resolves to the existing polity "${code}"; applied as an update.`);
      continue;
    }
    if (operation === "restore" && alive) {
      console.warn(`[polity lifecycle] restore of "${change.code}" names the active polity "${code}"; applied as an update.`);
      continue;
    }
    world.polityOverrides[code] = {
      ...(existing ?? { aliases: [], code, color: "", name: "", note: "" }),
      status: "active",
    };
    console.info(`[polity lifecycle] ${operation === "create" ? "created" : "restored"} "${code}".`);
  }

  // Claims before transfers, so a region claimed and then actually handed over in
  // the same jump ends up settled rather than striped: the transfer below
  // clears the claim this loop just wrote. The reverse order would leave a border
  // that has already moved still rendering as disputed.
  for (const claim of regionClaims) {
    const claimant = resolveOwner(claim.claimantCode) || claim.claimantCode;
    // A claimant nobody knows becomes a landless polity rather than a phantom name.
    if (!claim.drop) foundPolityIfUnknown(world, colors, claimant);
    const current = normalizeArray(world.regionClaimants[claim.regionId])
      .map((entry) => normalizeOptionalString(entry))
      .filter(Boolean);

    if (claim.drop) {
      // All of them: what stays is the stripe of an occupation (the lawful
      // sovereign, while another holds the region), which is no claim.
      if (claim.allClaimants) {
        const holder = normalizeOptionalString(world.regionOwnershipOverrides[claim.regionId]);
        const sovereign = normalizeOptionalString(world.regionSovereigntyOverrides[claim.regionId]);
        writeRegionClaimants(world, claim.regionId, current.filter((entry) => holder && sovereign && !samePolity(holder, sovereign) && samePolity(entry, sovereign)));
        continue;
      }
      writeRegionClaimants(world, claim.regionId, current.filter((entry) => !samePolity(entry, claimant)));
      continue;
    }

    // De-duplicated case-insensitively: a claim restated across several jumps is
    // one dispute, not a region striped four times in the same colour.
    if (current.some((entry) => samePolity(entry, claimant))) continue;
    writeRegionClaimants(world, claim.regionId, [...current, claimant]);
  }

  // A transfer is a change of LEGAL SOVEREIGNTY (cession, annexation, sale,
  // unification, settlement). Administration normally follows the title: the
  // new sovereign becomes the controller unless a third party still physically
  // holds the region, in which case the lawful sovereign stays visible as a
  // claimant and the sparse sovereignty row records the difference.
  for (const transfer of regionTransfers) {
    const regionId = transfer.regionId;
    const toCode = resolveOwner(transfer.toCode) || normalizeOptionalString(transfer.toCode);
    if (!toCode) continue;
    // A receiver the world does not know is founded on the spot (polityFounding.js):
    // territory given to a polity that does not exist yet brings it into being.
    foundPolityIfUnknown(world, colors, toCode);
    const fromCode = resolveOwner(transfer.fromCode) || normalizeOptionalString(transfer.fromCode);
    const controller = normalizeOptionalString(world.regionOwnershipOverrides[regionId]);
    const previousSovereign = normalizeOptionalString(world.regionSovereigntyOverrides[regionId]) || controller || fromCode;

    // The power handing the region over is no third party to its own treaty.
    // An occupier that cedes what it holds gives up the holding with the
    // title: seen in a 45-skip test (2026-10-09), a reunification treaty by
    // which the United States handed four occupied North Korean regions to
    // South Korea changed their sovereign and left the United States in
    // control of all four, so the map never showed the country reunited.
    if (!controller || samePolity(controller, previousSovereign) || samePolity(controller, toCode) || samePolity(controller, fromCode)) {
      world.regionOwnershipOverrides[regionId] = toCode;
    }
    writeRegionSovereign(world, regionId, toCode);

    const effectiveController = normalizeOptionalString(world.regionOwnershipOverrides[regionId]) || toCode;
    if (samePolity(effectiveController, toCode)) {
      // A clean hand-over resolves whatever dispute the scenario seed or an
      // earlier turn declared for this region: regionClaimants is written by
      // nothing else, so a negotiated cession kept rendering permanently striped
      // with its old claimant, out of step with the ownership map. Settled, so
      // the claimants the map's own file bakes in do not stand in for it either.
      settleRegionClaims(world, regionId);
    } else {
      const remaining = normalizeArray(world.regionClaimants[regionId])
        .filter((name) => !samePolity(name, toCode) && !samePolity(name, previousSovereign));
      writeRegionClaimants(world, regionId, [...remaining, toCode]);
    }
  }

  // De-facto control (AI/nativeTerritoryDirector.js and the simulator's own
  // regionControlOps): wartime capture, an active contest, a contest cleared.
  // The lawful sovereign is anchored BEFORE control flips, which is what keeps
  // an occupied region striped in its sovereign's colour until a settlement.
  for (const op of regionControlOps) {
    const regionId = op.regionId;
    const currentController =
      normalizeOptionalString(world.regionOwnershipOverrides[regionId]) ||
      resolveOwner(op.fromCode) ||
      normalizeOptionalString(op.fromCode);
    const legalSovereign = normalizeOptionalString(world.regionSovereigntyOverrides[regionId]) || currentController;
    const existing = normalizeArray(world.regionClaimants[regionId]).map((entry) => normalizeOptionalString(entry)).filter(Boolean);

    if (op.op === "contest") {
      const actor = resolveOwner(op.actorCode) || normalizeOptionalString(op.actorCode);
      if (!actor || samePolity(actor, currentController)) continue;
      foundPolityIfUnknown(world, colors, actor);
      const claimants = [...existing, actor];
      if (legalSovereign && currentController && !samePolity(legalSovereign, currentController)) claimants.push(legalSovereign);
      writeRegionClaimants(world, regionId, claimants.filter((name) => !samePolity(name, currentController)));
      continue;
    }

    if (op.op === "control") {
      const toCode = resolveOwner(op.toCode) || normalizeOptionalString(op.toCode);
      if (!toCode) continue;
      foundPolityIfUnknown(world, colors, toCode);
      world.regionOwnershipOverrides[regionId] = toCode;
      writeRegionSovereign(world, regionId, legalSovereign);
      // Ground taken on a battlefield (the front engine's own operation, marked
      // by: "front") is simply controlled by whoever took it. The lawful
      // sovereign is recorded as for any occupation, so the region reads as
      // held by one country and belonging to another; but it is not made a
      // disputed region, which the map draws in stripes. Whoever just lost it,
      // and whose it lawfully is, come OFF its claimants; a dispute it has with
      // anybody else stands.
      const fought = op.by === "front";
      const claimants = existing.filter((name) => !samePolity(name, toCode)
        && !(fought && (samePolity(name, currentController) || samePolity(name, legalSovereign))));
      if (!fought) {
        if (currentController && !samePolity(currentController, toCode)) claimants.push(currentController);
        if (legalSovereign && !samePolity(legalSovereign, toCode)) claimants.push(legalSovereign);
      }
      if (fought && claimants.length === 0 && existing.length === 0) continue;
      writeRegionClaimants(world, regionId, claimants);
      continue;
    }

    if (op.op === "clear_contest") {
      const claimant = resolveOwner(op.claimantCode) || normalizeOptionalString(op.claimantCode);
      let claimants = op.clearAll ? [] : existing.filter((name) => !samePolity(name, claimant));
      // Clearing a battlefield dispute must not erase the legal sovereign while a
      // foreign controller still occupies the region: that stripe is the point.
      const controller = normalizeOptionalString(world.regionOwnershipOverrides[regionId]) || currentController;
      if (legalSovereign && controller && !samePolity(legalSovereign, controller)) claimants.push(legalSovereign);
      writeRegionClaimants(world, regionId, claimants.filter((name) => !samePolity(name, controller)));
    }
  }

  // Renames this event performed, so a later entry in the same event that
  // still says the old name lands on the new key rather than minting it back.
  const renamed = [];
  const currentKey = (key) => renamed.reduce((resolved, entry) => (samePolity(resolved, entry.from) ? entry.to : resolved), key);
  for (const { change, code: resolvedCode } of polityChanges) {
    const operation = change.operation || "update";
    if (operation === "dissolve") continue;
    let code = currentKey(resolvedCode);
    // A country IS its name everywhere, so any new name re-keys the polity: every
    // store is rewritten from the old key to the new one and the old name stays
    // only as a former name (server/polityRename.js). A name another polity
    // already answers to is refused rather than merging two countries.
    if (change.name && !samePolity(code, change.name)) {
      try {
        const result = renamePolityInWorld(world, code, change.name);
        Object.assign(world, result.world);
        const nextColors = renamePolityInColors(colors, result.from, result.to);
        for (const key of Object.keys(colors)) delete colors[key];
        Object.assign(colors, nextColors);
        renamed.push({ from: result.from, to: result.to });
        code = result.to;
        console.info(`[polity lifecycle] renamed "${result.from}" to "${result.to}".`);
      } catch (error) {
        console.warn(`[polity lifecycle] rename of "${code}" to "${change.name}" refused: ${error?.message || error}`);
      }
    }
    const current = world.polityOverrides[code] ?? {
      aliases: [],
      code,
      color: "",
      name: code,
      note: "",
    };
    const aliases = [...new Set([
      ...normalizeArray(current.aliases),
      ...(change.aliases?.length > 0 ? change.aliases : []),
    ].map(normalizeOptionalString).filter(Boolean))].filter((name) => !samePolity(name, code));
    world.polityOverrides[code] = {
      ...current,
      ...(aliases.length > 0 || change.aliases?.length > 0 ? { aliases } : {}),
      ...(change.color ? { color: change.color } : {}),
      name: code,
      // A change's note is its REASON (polityChangeSchema: "Brief reason."). It
      // is the description of a polity that has none yet, a new breakaway, and
      // never replaces one it has: a week's "Provision sent to the Order" wiped
      // a scenario's whole description of Brightdale.
      ...(change.note && !normalizeOptionalString(current.note) ? { note: change.note } : {}),
    };

    if (change.color) {
      const normalizedColor = normalizeOptionalString(change.color);
      const hexMatch = /^#?([a-f0-9]{6})$/i.exec(normalizedColor);
      if (hexMatch) {
        const hex = hexMatch[1];
        colors[code] = [
          Number.parseInt(hex.slice(0, 2), 16),
          Number.parseInt(hex.slice(2, 4), 16),
          Number.parseInt(hex.slice(4, 6), 16),
        ];
      }
    }

    // An intelligence rating the AI set this turn — a purge, a new bureau, a
    // defector — becomes the polity's authoritative value. Keyed by the SAME
    // alias-resolved `code` as reputation and the overrides above, so a polity
    // the model named by an alias cannot end up with a second, split rating.
    // The guard is for a world that reached here without normalizeWorldState
    // (which defaults `intelligence` to {}) — saves predating espionage.
    if (Number.isFinite(change.intelligence)) {
      if (!world.intelligence || typeof world.intelligence !== "object") world.intelligence = {};
      world.intelligence[code] = change.intelligence;
    }

    // How it makes war, moved this turn (a purge, a rearmament, a fleet lost:
    // runtime/militaryStats.js), into the game's own sheet, which stands over
    // the figures the scenario's author gave it.
    if (change.military) {
      const military = shiftedMilitary(world, code, change.military);
      if (military) applyCountryStatPatchToWorld(world, code, { military });
    }

    // Reputation the AI set this turn becomes the polity's authoritative value.
    if (Number.isFinite(change.reputation)) {
      world.internationalReputation[code] = change.reputation;
      // Keep the persisted sheet's reputation index in sync only when this
      // scenario actually tracks that index. Custom stat sheets may replace the
      // stock strategic indices entirely; never smuggle a hidden seventh row in.
      if (Object.prototype.hasOwnProperty.call(world.countryStats?.[code]?.indices ?? {}, "internationalReputation")) {
        applyCountryStatPatchToWorld(world, code, {
          indices: { internationalReputation: change.reputation },
        });
      }
    }

    // Persistent stat sheet: the AI's changed fields merge into the stored sheet
    // through the native seam, so a country's stats change ONLY when the AI
    // changes them (not every date); the event is recorded as accounted for so a
    // later reassessment does not apply it twice. The reputation index mirrors
    // into the authoritative store.
    if (change.stats && typeof change.stats === "object") {
      const merged = applyCountryStatPatchToWorld(world, code, change.stats, {
        continuity: eventId ? { accountedEventIds: [eventId] } : null,
        maxAggregateRescale: COUNTRY_STATS_EVENT_RESCALE_LIMIT,
        allowPerCapitaRescale: false,
      });
      const rep = Number(merged?.indices?.internationalReputation);
      if (Number.isFinite(rep)) {
        world.internationalReputation[code] = Math.max(0, Math.min(100, Math.round(rep)));
      }
    }

    // Tags the AI set this turn replace the scenario's starting tags for this
    // country, wholesale — the model sends the complete list, so a revolution
    // that drops "socialist" must actually drop it. null means "unchanged",
    // which is why normalizePolityChange distinguishes null from [].
    if (Array.isArray(change.tags)) {
      if (!world.countryTags || typeof world.countryTags !== "object") {
        world.countryTags = {};
      }
      if (change.tags.length) world.countryTags[code] = change.tags;
      else delete world.countryTags[code];
    }
  }

  // Dissolution last. A polity that still administers or is sovereign over
  // mapped territory is not gone: occupation is not a delete button, and the
  // same event must have settled its land first. A dissolved polity keeps its
  // record (aliases still fold old history onto it) but leaves the present:
  // its stats, tags, reputation, intelligence and colour go, and its standing
  // agreements end on the event's date. So do its wars: it leaves every side it
  // fought on, and a war with nobody left on one side ends that day (the sides
  // are kept as they were, so the record still says who fought). Its units
  // leave the map with it, and their standing orders with them.
  for (const { code } of dissolutions) {
    // What its going settles by itself (dissolvedPolityLand): ground it only
    // occupies goes back to its lawful sovereign, and the rest of its land, and
    // its title to land another holds, to the one heir this event names. It is
    // refused only when it still holds land outright and the event names no
    // heir: then nobody can be said to take it.
    dissolvePolity(world, code, {
      heir: dissolutionHeir({ code, polityChanges, regionTransfers, regionControlOps, resolveOwner }),
      date: eventDate, eventId, regionTransfers, resolveOwner, colors,
    });
  }
  return renamed;
};

// A polity ends: the one door for it (an event's dissolve, a state dissolved in
// defeat: runtime/warEndings.js). Its land is settled first (dissolvedPolityLand:
// ground it only occupies goes back to its lawful sovereign, the rest to
// `heirOf(regionId)` or `heir`), and it is refused, changing nothing, when it
// still holds land outright that goes to nobody. Then it leaves the present
// as the comment above the event loop says. Changes `world` (and `colors`)
// in place; true when it was dissolved.
export const dissolvePolity = (world, code, { heir = "", heirOf = null, date = "", eventId = "", regionTransfers = [], resolveOwner = (name) => name, colors = null } = {}) => {
  const eventDate = date;
  const settlement = dissolvedPolityLand(world, code, { heir, heirOf });
  if (settlement.refused) {
    console.warn(`[polity lifecycle] refusing to dissolve "${code}": it still holds ${settlement.refused} mapped region(s) outright and nobody is given them; transfer that territory first.`);
    return false;
  }
  applyDissolvedPolityLand(world, code, settlement);
  world.polityOverrides[code] = {
    ...(world.polityOverrides[code] ?? { aliases: [], code, color: "", name: "", note: "" }),
    status: "dissolved",
  };
  for (const field of POLITY_LIFECYCLE_STORES) {
    if (world[field] && typeof world[field] === "object" && !Array.isArray(world[field])) delete world[field][code];
  }
  const endedDate = canonicalizeDateString(eventDate);
  world.agreements = normalizeArray(world.agreements).map((agreement) => {
    if (!agreement || typeof agreement !== "object") return agreement;
    if (!["active", "suspended"].includes(normalizeOptionalString(agreement.status).toLowerCase())) return agreement;
    if (!normalizeArray(agreement.parties).some((party) => samePolity(party, code))) return agreement;
    return {
      ...agreement,
      status: "ended",
      endedDate: endedDate || canonicalizeDateString(agreement.lastUpdatedDate),
      lastUpdatedDate: endedDate || canonicalizeDateString(agreement.lastUpdatedDate),
    };
  });
  world.wars = normalizeArray(world.wars).map((war) => {
    if (!war || typeof war !== "object" || war.status === "ended") return war;
    const sideA = normalizeArray(war.sideA).filter((party) => !samePolity(party, code));
    const sideB = normalizeArray(war.sideB).filter((party) => !samePolity(party, code));
    if (sideA.length === normalizeArray(war.sideA).length && sideB.length === normalizeArray(war.sideB).length) return war;
    const lastUpdatedDate = endedDate || war.lastUpdatedDate;
    if (!sideA.length || !sideB.length) {
      return { ...war, status: "ended", endedDate: endedDate || war.lastUpdatedDate, lastUpdatedDate };
    }
    return { ...war, sideA, sideB, lastUpdatedDate };
  });
  world.units = normalizeArray(world.units).filter((unit) => !samePolity(unit?.ownerCode, code));
  const unitIds = new Set(world.units.map((unit) => unit?.id));
  world.pendingUnitOrders = normalizeArray(world.pendingUnitOrders).filter((order) => unitIds.has(order?.unitId));
  // It leaves its institutions (seats, open ballots, open cases), and every
  // subordination it was party to ends: released when it was the Overlord,
  // annexed when it was the Puppet and this event handed its land to the
  // Overlord, released otherwise.
  if (world.institutions && typeof world.institutions === "object") {
    world.institutions = removePolityFromInstitutions(world.institutions, code, world, endedDate);
  }
  if (Array.isArray(world.puppets)) {
    world.puppets = world.puppets.map((row) => {
      if (!row || typeof row !== "object" || normalizeOptionalString(row.status || "active").toLowerCase() !== "active") return row;
      const isOverlord = samePolity(row.overlord, code);
      if (!isOverlord && !samePolity(row.puppet, code)) return row;
      const annexed = !isOverlord && regionTransfers.some((transfer) => (
        samePolity(resolveOwner(transfer.fromCode) || transfer.fromCode, code)
        && samePolity(resolveOwner(transfer.toCode) || transfer.toCode, row.overlord)
      ));
      return {
        ...row,
        status: annexed ? "annexed" : "released",
        endedDate: endedDate || canonicalizeDateString(row.lastUpdatedDate),
        lastUpdatedDate: endedDate || canonicalizeDateString(row.lastUpdatedDate),
        ...(eventId ? { sourceEventIds: [...new Set([...normalizeArray(row.sourceEventIds), eventId])].slice(-24) } : {}),
      };
    });
  }
  if (colors && typeof colors === "object") delete colors[code];
  console.info(`[polity lifecycle] dissolved "${code}".`);
  return true;
};

// `boardOnlyEventIds` names events that are not on the timeline — carriers for a
// Hidden event's Board changes (gameplay.js applySimulationResult). Their project
// ops apply exactly as any event's, completion effects included, but they are
// not stamped into an entry's activity, which lists timeline events only.
export const applyEventImpactsToWorld = ({
  colors = {}, events = [], world, motion = null, round = 0, boardOnlyEventIds = [],
  regionCatalog = null,
}) => {
  const boardOnly = new Set(normalizeArray(boardOnlyEventIds).map(normalizeOptionalString).filter(Boolean));
  let nextColors = cloneValue(colors) ?? {};
  const nextWorld = normalizeWorldState(world);
  let cursorDate = motion ? normalizeOptionalString(motion.originDate) : "";
  const statsStart = normalizeGameDate(motion?.originDate);
  const statsEnd = normalizeGameDate(motion?.statsToDate);
  const turnEvents = normalizeEvents(events);
  // Fail closed on out-of-order, undated or out-of-range events; do not assign
  // economic effects to the wrong side of a historical shock or cession.
  let statsCursor = statsStart;
  const validStatsChronology = Boolean(statsStart && statsEnd && diffGameDays(statsStart, statsEnd) > 0)
    && turnEvents.every((event) => {
      const date = normalizeGameDate(event.date);
      if (!date || diffGameDays(statsStart, date) < 0 || diffGameDays(date, statsEnd) < 0
        || diffGameDays(statsCursor, date) < 0) return false;
      statsCursor = date;
      return true;
    });
  statsCursor = statsStart;
  // The live map's compact catalog is the seed-title authority when a region
  // has no sparse World override. Do not confuse historical base geography
  // with the map's baked political owner, or trust an optional AI fromCode.
  // Only build the index if a legal transfer actually needs an old owner.
  let mapRegionsById = null;
  const baseLegalOwnerOf = (regionId) => {
    if (!mapRegionsById) {
      const rows = Array.isArray(regionCatalog)
        ? regionCatalog
        : (getPrimedScenarioRegionCatalog() ?? []);
      mapRegionsById = new Map(rows
        .filter((row) => normalizeOptionalString(row?.id))
        .map((row) => [normalizeOptionalString(row.id), row]));
    }
    const row = mapRegionsById.get(regionId);
    if (!row) return { found: false, owner: "" };
    const baked = Object.hasOwn(row, "bakedOwner")
      ? row.bakedOwner
      : row.country || row.countryCode || "";
    const owner = normalizeOptionalString(baked);
    return { found: true, owner: toCountryName(owner) || owner };
  };
  const progressTo = (date) => {
    if (!validStatsChronology || !date || !(diffGameDays(statsCursor, date) > 0)) return;
    const settled = advanceCountryStatsInterval(nextWorld.countryStats, {
      fromDate: statsCursor, toDate: date,
    });
    nextWorld.countryStats = settled.countryStats;
    statsCursor = date;
  };
  // Every polity renamed by this apply, for gameplay.js to carry into what the
  // world does not hold (the game's own polity, chats, flags, baked regions).
  // A save from before renames re-keyed still shows a display name over a key;
  // it is brought across first, the same way, so this turn and every prompt
  // after it see one name for one country.
  const renamedPolities = [];
  for (const { from, to } of displayNameMigrations(nextWorld, { isReserved: isRealCountryName })) {
    try {
      const result = renamePolityInWorld(nextWorld, from, to);
      Object.assign(nextWorld, result.world);
      nextColors = renamePolityInColors(nextColors, result.from, result.to);
      renamedPolities.push({ from: result.from, to: result.to });
      console.info(`[polity lifecycle] "${result.from}" is keyed by its name "${result.to}" from now on.`);
    } catch (error) {
      console.warn(`[polity lifecycle] could not re-key "${from}" as "${to}": ${error?.message || error}`);
    }
  }
  // Every owner written below goes through here first. The model reads the story
  // it just wrote, so the turn after a polity is renamed it hands back the NEW
  // name — and storing that verbatim splits one country into two owners, one of
  // which has none of the country's colour, tags, reputation or stats (see
  // ownerNames.js). Rebuilt after each event's polityChanges, since a rename in
  // one event is a name the next event can already be using.
  let resolveOwner = createOwnerResolver(buildOwnerAliasMap(nextWorld.polityOverrides));

  for (const event of turnEvents) {
    // Rates and demographic totals evolve until this event, BEFORE its dated
    // GDP/population shock or growth-rate change becomes canonical.
    progressTo(normalizeGameDate(event.date));
    // Resolve this event's polity changes first — both to fold the renames they
    // make into the alias map before any owner is read through it, and so a
    // change addressed to a polity's current display name lands on that polity
    // rather than creating a second one beside it.
    const polityChanges = event.impacts.polityChanges.map((change) => ({
      change,
      code: resolveOwner(change.code) || change.code,
    }));

    if (polityChanges.length > 0) {
      resolveOwner = createOwnerResolver(buildOwnerAliasMap(
        previewPolityOverrides(nextWorld.polityOverrides, polityChanges),
      ));
    }

    const territoryTransfers = event.impacts.regionTransfers;
    const dissolvingOwners = polityChanges
      .filter(({ change }) => change.operation === "dissolve")
      .map(({ code }) => code);
    // Snapshot ONLY on legal transfer/dissolution events. The former sovereign
    // may be absent from an optional transfer.fromCode, while dissolution can
    // pass additional regions to an heir without an explicit transfer row.
    const trackLegalTitle = territoryTransfers.length > 0 || dissolvingOwners.length > 0;
    const ownersBefore = trackLegalTitle ? { ...nextWorld.regionOwnershipOverrides } : null;
    const sovereignsBefore = trackLegalTitle ? { ...nextWorld.regionSovereigntyOverrides } : null;
    const renamedHere = applyPolityAndTerritoryImpacts({
      colors: nextColors,
      eventDate: event.date,
      eventId: event.id,
      polityChanges,
      regionClaims: event.impacts.regionClaims,
      regionControlOps: event.impacts.regionControlOps,
      regionTransfers: territoryTransfers,
      resolveOwner,
      world: nextWorld,
    });
    // The legal owner is the recorded sovereign, or the controller when no
    // divergent sovereign is recorded. A transfer's optional fromCode is only
    // a fallback when the prior title was not held in the World overrides.
    // Dissolution may hand *other* regions to its heir without explicit rows.
    // These recipients must not compound their pre-annexation component ledgers.
    if (trackLegalTitle) {
      const candidates = new Map(territoryTransfers.map((transfer) => [transfer.regionId, transfer]));
      if (dissolvingOwners.length) {
        for (const regionId of new Set([
          ...Object.keys(ownersBefore),
          ...Object.keys(sovereignsBefore),
        ])) {
          const legalOwner = sovereignsBefore[regionId] || ownersBefore[regionId] || "";
          if (dissolvingOwners.some((code) => samePolity(code, legalOwner)) && !candidates.has(regionId)) {
            candidates.set(regionId, null);
          }
        }
      }
      for (const [regionId, transfer] of candidates) {
        const oldController = ownersBefore[regionId] || "";
        const oldSovereign = sovereignsBefore[regionId] || "";
        const newController = nextWorld.regionOwnershipOverrides?.[regionId] || "";
        const newSovereign = nextWorld.regionSovereigntyOverrides?.[regionId] || "";
        // Screened/refused transfers and mere occupation do not change title.
        if (oldController === newController && oldSovereign === newSovereign) continue;
        const mapTitle = !oldSovereign && !oldController
          ? baseLegalOwnerOf(regionId)
          : null;
        // The accepted turn supplies the active map catalog explicitly. Without
        // a matching map region, an AI fromCode is not proof of the donor:
        // refuse the whole in-memory apply rather than persist stale Stats.
        if (Array.isArray(regionCatalog) && mapTitle && !mapTitle.found) {
          throw new Error(`Cannot settle legal title for "${regionId}": no matching region in the authoritative map catalog.`);
        }
        const oldLegalOwner = oldSovereign || oldController
          || (mapTitle?.found ? mapTitle.owner : transfer?.fromCode || "");
        const newLegalOwner = newSovereign || newController || transfer?.toCode || "";
        if (samePolity(oldLegalOwner, newLegalOwner)) continue;
        for (const owner of [oldLegalOwner, newLegalOwner]) {
          const code = resolveOwner(owner) || owner;
          const sheet = nextWorld.countryStats?.[code];
          if (!sheet) continue;
          nextWorld.countryStats[code] = {
            ...sheet,
            continuity: { ...(sheet.continuity || {}), progressionBlocked: true },
          };
        }
      }
    }
    if (renamedHere.length) {
      renamedPolities.push(...renamedHere);
      // The polity is keyed by its new name now: this event's unit, Political
      // Actor and structure ops, and every later event, must resolve either name
      // to the new key. This ordering is what makes rename + replace-leader in
      // one event mutate one canonical actor rather than minting a stale-key twin.
      resolveOwner = createOwnerResolver(buildOwnerAliasMap(nextWorld.polityOverrides));
    }

    // Groups after the land has moved, so a group can take what the same event
    // just changed hands.
    if (event.impacts.groupOps?.length) {
      // A group that is also a polity (the player leading a group, groups.js
      // playerGroupKey) is one actor under one name. The model may not dissolve
      // it: losing its whole area is a release, and it goes on with none. A
      // rename of it renames the polity, which renames the group with it
      // (server/polityRename.js), so the game's own polity follows.
      const groupOps = [];
      for (const raw of event.impacts.groupOps) {
        const op = normalizeGroupOp(raw);
        if (!op) continue;
        const key = findGroupKey(nextWorld.groups, op.name);
        const isPolity = Boolean(key) && Object.keys(nextWorld.polityOverrides ?? {}).some((name) => samePolityName(name, key));
        if (!isPolity) {
          groupOps.push(op);
          continue;
        }
        if (op.op === "dissolve") {
          console.info(`[groups] "${key}" is a polity as well as a group; it is not dissolved (a release takes its area).`);
          continue;
        }
        let name = key;
        if (canRenameGroup(nextWorld.groups, key, op.newName)) {
          try {
            const result = renamePolityInWorld(nextWorld, key, op.newName);
            Object.assign(nextWorld, result.world);
            nextColors = renamePolityInColors(nextColors, result.from, result.to);
            renamedPolities.push({ from: result.from, to: result.to });
            resolveOwner = createOwnerResolver(buildOwnerAliasMap(nextWorld.polityOverrides));
            name = findGroupKey(nextWorld.groups, result.to) || key;
          } catch (error) {
            console.warn(`[groups] could not rename "${key}" as "${op.newName}": ${error?.message || error}`);
          }
        }
        const { newName: _newName, ...rest } = op;
        groupOps.push({ ...rest, name });
      }
      const applied = applyGroupOps(nextWorld, groupOps);
      nextWorld.groups = applied.groups;
      nextWorld.groupAreas = applied.groupAreas;
      for (const change of applied.changes) {
        // A group that fights on a battlefield is named there as a side's member.
        if (change.op === "rename") {
          nextWorld.battlefields = renameInBattlefields(nextWorld.battlefields, change.from, change.name);
          nextWorld.transports = renameInTransports(nextWorld.transports, change.from, change.name);
        }
        // A dissolved group cannot keep running recurring agreements with no UI to end them.
        if (change.op === "dissolve" && Array.isArray(nextWorld.agreements) && nextWorld.agreements.length) {
          const hasCollidingPolity = Boolean(resolvePolityIdentity(change.name, nextWorld, {
            allowUnknown: false,
            requireActive: false,
            allowStockBase: true,
            identityIndex: diplomaticIdentityIndexOf(nextWorld),
          })?.resolved);
          const groupTag = `group: ${change.name}`.toLocaleLowerCase();
          const bareName = String(change.name ?? "").trim().toLocaleLowerCase();
          nextWorld.agreements = nextWorld.agreements.map((agreement) => {
            if (!["active", "suspended"].includes(String(agreement?.status || "active").toLowerCase())) return agreement;
            const parties = Array.isArray(agreement?.parties) ? agreement.parties : [];
            const involvesGroup = parties.some((party) => {
              const folded = String(party ?? "").trim().toLocaleLowerCase();
              return folded === groupTag || (!hasCollidingPolity && folded === bareName);
            });
            if (!involvesGroup) return agreement;
            return {
              ...agreement,
              status: "ended",
              endedDate: normalizeOptionalString(event?.date) || normalizeOptionalString(agreement?.endedDate),
              lastUpdatedDate: normalizeOptionalString(event?.date) || normalizeOptionalString(agreement?.lastUpdatedDate),
            };
          });
        }
        if (change.op === "refused") console.warn(`[groups] "${change.name}" was not created on event "${event.title}": the ${MAX_GROUPS}-group limit is reached.`);
      }
    }

    if (event.impacts.politicalActorOps?.length) {
      for (const packed of event.impacts.politicalActorOps) {
        const decoded = politicalActorOperationFromImpact(packed, resolveOwner);
        if (!decoded.operation) {
          console.warn(`[Political Actors] event "${event.title}" dropped ${packed?.op || "operation"}: ${decoded.error}.`);
          continue;
        }
        const outcome = applyPoliticalActorOperation(nextWorld, decoded.operation);
        if (!outcome?.applied) {
          console.warn(`[Political Actors] event "${event.title}" could not apply ${decoded.operation.op} to ${decoded.operation.polityKey}: ${outcome?.error || "native validation refused it"}.`);
          continue;
        }

        // Political Actors remain the write authority. When the old Stats sheet
        // already exists, mirror only its legacy government/leader vocabulary so
        // old UI/consumers do not display a contradicted officeholder. Never mint
        // a Stats sheet from this compatibility projection.
        const actorKey = getPoliticalProfileKey(nextWorld, decoded.operation.polityKey) || decoded.operation.polityKey;
        if (nextWorld.countryStats && Object.prototype.hasOwnProperty.call(nextWorld.countryStats, actorKey)) {
          const legacyProjection = buildPoliticalActorLegacyStatsProjection(nextWorld, actorKey);
          if (Object.keys(legacyProjection).length) applyCountryStatPatchToWorld(nextWorld, actorKey, legacyProjection);
        }
      }
    }

    if (event.impacts.unitOps?.length) {
      // A battalion's owner is the same namespace: spawned under a display name
      // it would fly a phantom country's colours beside its own army.
      const applied = applyUnitOpBatch(
        nextWorld.units,
        nextWorld.pendingUnitOrders,
        event.impacts.unitOps.map((op) =>
          (op.op === "spawn" && op.unit?.ownerCode
            ? { ...op, unit: { ...op.unit, ownerCode: resolveOwner(op.unit.ownerCode) } }
            : op)),
        {
          markers: nextWorld.markers,
          // The scenario's own unit types a spawn may name (unitTypes.js).
          unitTypes: nextWorld.unitTypes,
          gameDate: event.date || cursorDate,
          era: eraSettingOf(nextWorld),
          elapsedDays: motion ? daysBetweenDates(cursorDate, event.date) : null,
          round: motion?.round ?? 0,
          eventId: event.id,
        },
      );
      nextWorld.units = applied.units;
      nextWorld.pendingUnitOrders = applied.orders;
    }
    // Advance the cursor even for events that moved no units, so the NEXT event's
    // budget is measured from this event rather than from the start of the jump.
    if (motion && event.date) cursorDate = event.date;

    if (event.impacts.markerOps?.length) {
      const before = normalizeMarkers(nextWorld.markers);
      nextWorld.markers = applyMarkerOps(nextWorld.markers, event.impacts.markerOps.map((op) => {
        if (op.op === "build" && op.marker?.ownerCode) {
          return { ...op, marker: { ...op.marker, ownerCode: resolveOwner(op.marker.ownerCode) } };
        }
        if (op.op === "update" && op.changes?.ownerCode) {
          return { ...op, changes: { ...op.changes, ownerCode: resolveOwner(op.changes.ownerCode) } };
        }
        return op;
      }), {
        eventId: event.id,
        gameDate: event.date || "",
      });
      // A rename that matched no existing structure is a STOCK-map city or region rename (stock
      // cities and regions live in PMTiles, not world.markers) — record it as an override layer so
      // the label layer and region inspector show the new name (see Cities.jsx and regionNameFixes.js).
      for (const raw of normalizeArray(event.impacts.markerOps)) {
        const op = normalizeMarkerOp(raw);
        if (!op || !op.name) continue;
        const matched = before.some((m) =>
          op.markerId ? m.id === op.markerId : m.name.toLowerCase() === op.name.toLowerCase());
        if (op.op === "rename" && !matched) {
          const rawName = String(op.name).trim();
          const isRegion = /^region:\s*/i.test(rawName);
          const cleanName = rawName.replace(/^region:\s*/i, "").trim().toLowerCase();
          if (isRegion) {
            nextWorld.regionRenames = { ...(nextWorld.regionRenames || {}), [cleanName]: op.newName };
          } else {
            nextWorld.cityRenames = { ...(nextWorld.cityRenames || {}), [cleanName]: op.newName };
          }
        }
        // Population is recorded in the override for EVERY city, matched or not.
        // A built marker keeps its own population field, but the map reads the
        // override for both layers, so writing it here is what makes the change
        // visible without a second code path per city source.
        if (op.op === "population") {
          nextWorld.cityPopulations = {
            ...(nextWorld.cityPopulations || {}),
            [op.name.toLowerCase()]: op.population,
          };
        }
      }
    }

    // The documents this event writes or widens (runtime/reports.js). Holders
    // go through the same resolver as every owner above (a code becomes its
    // name, an alias its polity); whether a holder exists at all was settled at
    // validation, where the whole country catalog is in hand (gameplay.js
    // validateReportOps).
    if (event.impacts.reports?.length) {
      const outcome = applyReportOps(nextWorld.reports, event.impacts.reports, {
        eventId: boardOnly.has(event.id) ? "" : event.id,
        date: event.date || "",
        round,
        resolvePolity: resolveOwner,
      });
      nextWorld.reports = outcome.reports;
      for (const entry of outcome.rejected) console.warn(`[reports] an operation on event "${event.title}" was refused — ${entry.reason}.`);
    }

    // Projects & Operations last, so the ops see the world this event has already
    // reshaped. The event's own id and date ride along: that is what stamps the
    // activity feed and dates a project the event has just started, without the
    // model having to restate either.
    if (event.impacts.projectOps?.length) {
      nextWorld.projects = applyProjectOps(
        nextWorld.projects,
        event.impacts.projectOps.map((op) => resolveProjectOpOwner(op, resolveOwner)),
        // A plan an event opens is held to its owner's means as the world stands.
        { date: event.date, eventId: boardOnly.has(event.id) ? "" : event.id, round, boundPlan: projectPlanBounder(nextWorld) },
      );
    }
  }

  // The days after the last event also belong to the interval. Settlement
  // stays in the same accepted World transaction as history and power tiers.
  progressTo(statsEnd);

  return {
    colors: nextColors,
    renamedPolities,
    // Stamp the turn as the engine's. A save last written by the old classic
    // system still says "classic", which is how resumeStandingOrders knows game
    // time passed with nothing advancing its orders.
    world: { ...nextWorld, unitSystem: "beta" },
  };
};

// A create without the believer it named (applyProjectOpsToWorld: a belief is a
// time skip's alone to open).
const withoutBelief = (raw) => {
  if (!raw || typeof raw !== "object" || projectOpKind(raw) !== "create") return raw;
  const { believedBy: _believedBy, ...op } = raw;
  if (!raw.project || typeof raw.project !== "object") return op;
  const { believedBy: _nested, ...project } = raw.project;
  return { ...op, project };
};

// A plan held to its owner's means, against a world's sheets: what every door
// that opens or plans a project passes to applyProjectOps as `boundPlan`. A
// blank owner is `host`, the country a blank owner means.
const projectPlanBounder = (world, host = "") => (plan, owner) => {
  const named = normalizeOptionalString(owner) || normalizeOptionalString(host);
  return boundPlanForOwner(plan, named ? sheetOf(world, named) : null, { sheetFor: (country) => sheetOf(world, country) });
};

// The door every NON-EVENT writer to the projects board goes through: the
// advisor's ```projects fence, the Projects panel's own buttons, and the
// engine's own bookkeeping (the covert-operation sync, the doubt).
//
// `actor` says WHO is writing:
//   "player"  the Projects panel: their own work only (canPlayerDirect), and
//             only what a government does to its own programmes: open one
//             with its plan, plan one still planning, fund it, call it off;
//   "ai"      the advisor: it may open the player's own work (with a plan, or
//             to be planned), fund or call off the player's own, and report on
//             any entry (its lastUpdate). It is not the world: no setback or
//             breakthrough, and no project of another country's (those the
//             world opens, in a time skip);
//   "engine"  the engine's own ops, which may also set a status and a verdict.
// A belief (projectEngine.js isBelief) is a time skip's alone to open: a create
// through here that names one is opened as ordinary work of its own owner.
// Anything refused comes back in refusedProjectIds (or, for a create, nothing
// lands) rather than throwing.
export const applyProjectOpsToWorld = ({
  actor = "ai",
  date = "",
  eventId = "",
  ops,
  playerCountry = "",
  round = 0,
  world,
}) => {
  const nextWorld = normalizeWorldState(world);
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(nextWorld.polityOverrides));
  const resolved = normalizeArray(ops).map((raw) => resolveProjectOpOwner(withoutBelief(raw), resolveOwner));
  const refused = new Set();
  const player = normalizeOptionalString(playerCountry);
  const isPlayersOwn = (owner) => !normalizeOptionalString(owner) || samePolityName(owner, player);

  const allowed = resolved.filter((raw) => {
    const op = normalizeProjectOp(raw);
    if (!op) return actor === "engine";
    if (actor === "engine") return true;
    if (op.op === "create") {
      if (!isPlayersOwn(op.project.ownerCode)) return false;
      const matched = findProjectIndexForOp(nextWorld.projects, {
        projectId: op.project.id, name: op.project.name,
      }, { owner: op.project.ownerCode, host: player });
      // Even an explicit spoofed ID must never make a player's create write
      // another country's project.
      if (matched !== -1 && !isPlayersOwn(nextWorld.projects[matched].ownerCode)) {
        refused.add(nextWorld.projects[matched].id);
        return false;
      }
      return true;
    }
    if (op.op === "setback" || op.op === "boost") return false;
    const index = findProjectIndexForOp(nextWorld.projects, op);
    if (index === -1) return true;
    const target = nextWorld.projects[index];
    const own = isPlayersOwn(target.ownerCode);
    // What a government does to its own programmes: fund, plan, call off.
    const steers = op.op === "close" || (op.op === "update" && (
      op.patch?.funding !== undefined || op.patch?.plan !== undefined ||
      closedValue(PROJECT_SECRECY_SET)(op.patch?.secrecy)
    ));
    if (actor === "player" && (!canPlayerDirect(target, player) || (op.op === "update" && !steers))) {
      refused.add(target.id);
      return false;
    }
    if (steers && !own) {
      refused.add(target.id);
      return false;
    }
    return true;
  });

  // A player update may steer funding/planning and secrecy, not smuggle other
  // canonical fields in alongside an otherwise authorized control.
  const safeOps = actor === "player" ? allowed.map((raw) => {
    const op = normalizeProjectOp(raw);
    if (op?.op !== "update") return raw;
    const patch = op.patch && typeof op.patch === "object" ? op.patch : {};
    return {
      op: "update", projectId: op.projectId, name: op.name,
      patch: Object.fromEntries(["funding", "plan", "secrecy"]
        .filter((field) => patch[field] !== undefined).map((field) => [field, patch[field]])),
    };
  }) : allowed;

  nextWorld.projects = applyProjectOps(nextWorld.projects, safeOps, {
    date,
    eventId,
    round,
    host: player,
    engine: actor === "engine",
    boundPlan: projectPlanBounder(nextWorld, player),
    onRefusal: (id) => refused.add(id),
  });

  return { refusedProjectIds: [...refused], world: nextWorld };
};

// ---- the engine's period, in the world ----------------------------------------------
//
// Runs the projects engine over a turn's days (projectEngine.js tickProjects)
// on the board as the turn BEGAN (`baseWorld`), the board the time skip's prompt
// was told about, and lays the result over the board the turn ended with
// (`world`: its events' ops applied). Pure. Returns the world with the board
// advanced and the outcomes, in date order, for applyProjectOutcomesToWorld.
//   host    the country a blank owner means (the game's own)
//   round   the turn being applied (adjustments told before it take hold)
export const advanceProjectsInWorld = ({ baseWorld, world, fromDate = "", toDate = "", host = "", round = 0 } = {}) => {
  const base = normalizeWorldState(baseWorld ?? world);
  const after = normalizeWorldState(world);
  const tick = tickProjects({ projects: base.projects, world: base, fromDate, toDate, host, round });
  if (!tick.days) return { world: after, outcomes: [], days: 0 };
  const merged = mergeTickedBoard({ base: base.projects, ticked: tick.projects, current: after.projects });
  return { world: { ...after, projects: normalizeProjects(merged) }, outcomes: tick.outcomes, days: tick.days };
};

// The yields a programme that runs on has banked as fractions of a point, by
// stat path, so a monthly yield of half a point lands one whole point every
// second month instead of rounding to nothing.
const YIELD_CARRY_KEY = "yieldCarry";

// A stat effect as a patch for mergeCountryStatPatch, against the sheet as it is:
// { patch, applied } with `applied` the change actually made, or null where the
// sheet has no such figure to move.
export const statEffectPatch = (sheet, effect, scale, share = 1) => {
  const measure = statMeasure(effect.stat);
  const current = statValueOf(sheet, effect.stat);
  if (!measure || !Number.isFinite(current)) return null;
  const change = boundStatChange(effect.stat, effect.change * share, sheet, scale);
  if (!change) return null;
  const [head, key] = effect.stat.split(".");
  const percent = measure === "percentGdp" || measure === "percentPopulation";
  let value = percent ? current * (1 + change / 100) : current + change;
  if (measure === "points" || (measure === "custom" && current >= 0 && current <= 100)) value = Math.max(0, Math.min(100, value));
  if (measure === "rate" && key === "unemployment") value = Math.max(0, Math.min(100, value));
  if (measure === "debt") value = Math.max(0, value);
  if (measure === "percentPopulation") value = Math.round(value);
  const patch = head === "stability" ? { stability: value } : { [head]: { [key]: value } };
  return { patch, applied: change };
};

// What a project's completion (or, for a programme that runs on, its being set
// up) and its monthly yields do to the world, from a tick's outcomes. Each
// completion's effects land exactly once (effectsAppliedAt, and the legacy
// onCompleteAppliedAt); a stat or relation the world has nothing to move (no
// sheet for that country) is passed over, never invented.
//
// Territory is not applied here: it has to be found on the map by name and
// enacted through the event path with everything else that moves a border. It
// comes back in `territory`, one entry per project, for the caller
// (gameplay.js) to resolve and apply.
export const applyProjectOutcomesToWorld = ({ world, outcomes = [], date = "", round = 0, host = "" } = {}) => {
  const nextWorld = normalizeWorldState(world);
  const applied = [];
  const territory = [];
  const findProject = (outcome) => {
    const projectId = normalizeOptionalString(outcome?.projectId);
    const owner = normalizeOptionalString(outcome?.owner) || normalizeOptionalString(host);
    const matchesOwner = (project) => {
      const actual = normalizeOptionalString(project.ownerCode) || normalizeOptionalString(host);
      return !owner || Boolean(actual && samePolityName(actual, owner));
    };
    // Native tick outcomes carry canonical project IDs. A stale/mismatched ID
    // must never silently fall back to a same-title project.
    if (projectId) return nextWorld.projects.findIndex((project) =>
      project.id === projectId && matchesOwner(project));
    // Older serialized/hand-authored outcomes have no ID. Only an unambiguous
    // title *within the intended polity* is safe to apply.
    const title = normalizeOptionalString(outcome?.project);
    if (!title || !owner) return -1;
    const matches = nextWorld.projects
      .map((project, index) => ({ project, index }))
      .filter(({ project }) => project.name === title && matchesOwner(project));
    return matches.length === 1 ? matches[0].index : -1;
  };
  const resolveOwner = createOwnerResolver(buildOwnerAliasMap(nextWorld.polityOverrides));
  const relationOf = (a, b) => nextWorld.relations.findIndex((entry) => (samePolityName(entry.a, a) && samePolityName(entry.b, b)) || (samePolityName(entry.a, b) && samePolityName(entry.b, a)));

  const applyStat = (owner, effect, scale, share, carry = null) => {
    const country = resolveOwner(effect.country || owner) || effect.country || owner;
    const sheetKey = Object.keys(nextWorld.countryStats ?? {}).find((name) => samePolityName(name, country));
    if (!sheetKey) return 0;
    let wanted = effect.change * share;
    // Whole points of a fractional monthly yield, the rest banked.
    if (carry && statMeasure(effect.stat) !== "percentGdp" && statMeasure(effect.stat) !== "percentPopulation") {
      const banked = (Number(carry[effect.stat]) || 0) + wanted;
      wanted = Math.trunc(banked);
      carry[effect.stat] = Math.round((banked - wanted) * 1000) / 1000;
      if (!wanted) return 0;
    }
    const result = statEffectPatch(nextWorld.countryStats[sheetKey], { ...effect, change: wanted }, scale, 1);
    if (!result) return 0;
    applyCountryStatPatchToWorld(nextWorld, sheetKey, result.patch);
    return result.applied;
  };
  const applyRelation = (owner, effect, scale, share) => {
    const other = resolveOwner(effect.country) || effect.country;
    const mine = resolveOwner(owner) || owner;
    if (!other || !mine || samePolityName(other, mine)) return 0;
    const change = Math.max(-RELATION_BOUNDS[scale], Math.min(RELATION_BOUNDS[scale], effect.change * share));
    const rounded = Math.round(change);
    if (!rounded) return 0;
    const index = relationOf(mine, other);
    if (index === -1) {
      nextWorld.relations = [...nextWorld.relations, { a: mine, b: other, score: rounded, lastUpdatedDate: date, updatedRound: round, createdRound: round }];
    } else {
      const entry = nextWorld.relations[index];
      nextWorld.relations = nextWorld.relations.map((row, i) => (i === index
        ? { ...row, score: Math.max(-100, Math.min(100, Number(entry.score || 0) + rounded)), status: "", lastUpdatedDate: date || row.lastUpdatedDate, updatedRound: round || row.updatedRound }
        : row));
    }
    return rounded;
  };

  for (const outcome of normalizeArray(outcomes)) {
    const index = findProject(outcome);
    if (index === -1) continue;
    const project = nextWorld.projects[index];
    const owner = normalizeOptionalString(project.ownerCode) || normalizeOptionalString(host);

    if (outcome.type === "yield") {
      const carry = { ...(project[YIELD_CARRY_KEY] && typeof project[YIELD_CARRY_KEY] === "object" ? project[YIELD_CARRY_KEY] : {}) };
      for (const effect of normalizeArray(project.plan?.yields)) {
        const share = Math.max(0, Math.min(1, Number(outcome.share) || 0));
        const done = effect.type === "stat" ? applyStat(owner, effect, "month", share, carry)
          : effect.type === "relation" ? applyRelation(owner, effect, "month", share) : 0;
        if (done) applied.push({ project: project.name, owner, date: outcome.date, effect: { ...effect, change: done }, monthly: true });
      }
      nextWorld.projects = nextWorld.projects.map((entry, i) => (i === index ? { ...entry, [YIELD_CARRY_KEY]: carry } : entry));
      continue;
    }
    if (outcome.type !== "complete" && outcome.type !== "established") continue;
    if (project.effectsAppliedAt) continue;

    const structures = [];
    const regionTransfers = [];
    const regionClaims = [];
    for (const effect of normalizeArray(project.plan?.effects)) {
      if (effect.type === "stat") {
        const done = applyStat(owner, effect, "once", 1);
        if (done) applied.push({ project: project.name, owner, date: outcome.date, effect: { ...effect, change: done } });
      } else if (effect.type === "relation") {
        const done = applyRelation(owner, effect, "once", 1);
        if (done) applied.push({ project: project.name, owner, date: outcome.date, effect: { ...effect, change: done } });
      } else if (effect.type === "structure") {
        const at = Number.isFinite(effect.lng) && Number.isFinite(effect.lat) ? { lng: effect.lng, lat: effect.lat } : project.focus;
        if (!at) continue;
        structures.push({ op: "build", marker: { name: effect.name, kind: effect.kind, ownerCode: owner, lng: at.lng, lat: at.lat, foundedAt: outcome.date, note: project.summary } });
        applied.push({ project: project.name, owner, date: outcome.date, effect });
      } else if (effect.type === "unitType") {
        const types = normalizeArray(nextWorld.unitTypes);
        const existing = types.findIndex((type) => samePolityName(type?.name, effect.name));
        if (existing !== -1) {
          const type = types[existing];
          const owners = normalizeArray(type.owners);
          if (owners.length && !owners.some((name) => samePolityName(name, owner))) {
            nextWorld.unitTypes = types.map((entry, i) => (i === existing ? { ...entry, owners: [...owners, owner] } : entry));
          }
        } else {
          nextWorld.unitTypes = normalizeUnitTypes([...types, { name: effect.name, base: effect.base, attack: effect.attack, toughness: effect.toughness, speed: effect.speed, icon: effect.icon ?? "", note: effect.note ?? "", owners: [owner] }]);
        }
        applied.push({ project: project.name, owner, date: outcome.date, effect });
      } else if (effect.type === "territory") {
        const region = `region: ${effect.region}`;
        if (effect.claim) regionClaims.push({ regionId: region, claimantCode: effect.country, note: project.name });
        else regionTransfers.push({ regionId: region, toCode: effect.country, note: project.name });
      }
    }
    if (structures.length) nextWorld.markers = applyMarkerOps(nextWorld.markers, structures, { gameDate: outcome.date });
    // A project from before the engine may carry its own completion effects.
    const legacy = project.onComplete && !project.onCompleteAppliedAt ? project.onComplete : null;
    if (regionTransfers.length || regionClaims.length || legacy) {
      territory.push({
        project: project.name,
        owner,
        date: outcome.date,
        regionTransfers: [...regionTransfers, ...normalizeArray(legacy?.regionTransfers)],
        regionClaims: [...regionClaims, ...normalizeArray(legacy?.regionClaims)],
        polityChanges: normalizeArray(legacy?.polityChanges),
      });
    }
    nextWorld.projects = nextWorld.projects.map((entry, i) => (i === index
      ? { ...entry, effectsAppliedAt: outcome.date || date, ...(legacy ? { onCompleteAppliedAt: outcome.date || date } : {}) }
      : entry));
  }

  return { world: normalizeWorldState(nextWorld), applied, territory };
};
