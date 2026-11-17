import { resolveStockCountryCode } from "../../runtime/polityIdentity.js";
import {
  EVENT_AGENCY_MAX_SOVEREIGN_ACTORS,
  EVENT_AGENCY_SOVEREIGN_AUTHORITIES,
  normalizeEventAgency,
  eventAgencyStructureReason,
} from "../../runtime/eventAgency.js";
import { propagateCanonicalProcessAuthorityRefs } from "./playerAgencyAuthority.js";
import { institutionResolutionAuthorityIds } from "../../runtime/institutionalAuthority.js";
import { resolveInstitutionRecord } from "../../runtime/institutions.js";
import { compareGameDates, gameDateDayNumber } from "../../runtime/gameDates.js";
import { humanCountriesOf } from "../../runtime/humanPolities.js";
import { CRISIS_STORYLINE_KINDS, storylineKindOf } from "../../runtime/storylineKinds.js";
// Native World Integrity (ported from kernely's Continuum branch).
//
// This module is deliberately separate from the World Director and Timeline
// Curator. Responsibilities:
// - provide a deterministic rotating exploration slate so "independent world"
//   attention is concrete rather than a vague prompt sentence;
// - derive exploration coverage from the actual returned world payload so audit bookkeeping is native;
// - tell whose decision each event is, from what it carries, and hold a
//   person's country to that person's own orders and messages;
// - decide whether a scheduler-deferred storyline has a material endogenous
//   development or external trigger strong enough to re-enter this pass.
//
// It does NOT decide which plausible event is historically interesting. That
// remains the semantic Timeline Curator's job.

export const WORLD_INTEGRITY_VERSION = "0.19.0-structured-agency";
export const NATIVE_AUTHORITY_BINDER_VERSION = "3.0.0-structured-authority";
export const NATIVE_EVENT_PROVENANCE_VERSION = "2.0.0-structured-actors";

// R3.6: keep the 10-lane attention slate structurally balanced rather than
// hoping actor availability happens to produce 50/50. Up to five independent
// PLAYER-SPHERE actor lanes and three independent WIDER-WORLD actor lanes are used
// when available. If selected-storyline exclusion leaves one side sparse, cheap
// regional/system evaluation lanes fill that side instead of borrowing actors from
// the other side. Two protected wider-world global lanes (crisis discovery +
// cross-border system) complete the normal 5/5 layout. Evaluation only, no quota.
const EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS = 5;
const EXPLORATION_WIDER_EVIDENCE_ACTOR_SLOTS = 1;
const EXPLORATION_WIDER_LATENT_ACTOR_SLOTS = 2;
const EXPLORATION_WIDER_ACTOR_SLOTS =
  EXPLORATION_WIDER_EVIDENCE_ACTOR_SLOTS + EXPLORATION_WIDER_LATENT_ACTOR_SLOTS;
const EXPLORATION_TARGET_PER_SCOPE = 5;

const EXPLORATION_DOMAINS = Object.freeze([
  "diplomacy / foreign policy / commercial relations",
  "domestic politics / institutions / leadership pressures",
  "economy / industry / trade / finance",
  "society / labour / public order / reform",
  "science / technology / infrastructure / communications",
  "military readiness / doctrine / procurement (not routine battlefield continuation)",
  "regional / colonial / minority governance where applicable",
  "third-party reaction to wars, crises, treaties, and balance-of-power changes",
  "political rupture / elite fracture / mass unrest / coup or constitutional risk when current pressures support it",
  "strategic risk / coercive escalation / mobilization / brinkmanship / miscalculation when current interests support it",
]);

// The domains above that look across a border: a lane given one of them is
// covered by what passes between polities (outreach, a ledger record, an event
// with two parties). The game's own list, looked up exactly.
const CROSS_BORDER_DOMAINS = new Set([
  "diplomacy / foreign policy / commercial relations",
  "economy / industry / trade / finance",
  "third-party reaction to wars, crises, treaties, and balance-of-power changes",
]);

// No word list reads an event for the war: who is at war, who lives under war
// conditions and whether fighting changed anything are the war ledger's
// records and the event's own operations, in every language. "dont do
// keywording its super unreliable" (the owner, 2026-11-06). Removed on
// 2026-11-13: the rejection of a homefront condition for a polity the
// pre-segment ledger had at peace (WAR_DEPENDENT_HOMEFRONT_RE, with
// PREPAREDNESS_RE and FOREIGN_SPILLOVER_RE to excuse it), which also refused
// "Poland introduces wartime rationing" in the very segment that opened
// Poland's war; the hiding of "routine" military news (ROUTINE_MILITARY_CUE_RE,
// excused by STRONG_MILITARY_CONSEQUENCE_RE, CONCRETE_MILESTONE_RE,
// CLEARLY_NON_MILITARY_TITLE_RE and a "burn" word); and the words that woke or
// kept asleep a deferred storyline (ENDOGENOUS_MATERIAL_CUE_RE and the same
// two). The skip is told the rules instead: the war ledger's (a polity at peace
// does not live under war conditions) and FOLDED_SKIP_CONSEQUENCES' (no filler).
//
// Nor is any event read for anything else, since the same day (the owner,
// 2026-11-13: "absolutely no keywording ... anywhere"). Gone with the word
// lists:
// - the stripping of a polity's stat update from an event that read like a
//   meeting (PROCESS_ONLY_POLITY_UPDATE_RE, CONCRETE_POLITY_OUTCOME_RE):
//   "Committee reviews tariffs; rates rise 5%" lost its figures;
// - the hiding of "routine administrative" cards, one at a time
//   (ROUTINE_ADMINISTRATIVE_CUE_RE, ADMINISTRATIVE_MATERIAL_OUTCOME_RE) and in
//   clusters (LOW_TRAJECTORY_INSTITUTIONAL_RE): the skip is told to write no
//   filler and that nothing takes it off the timeline afterwards, and the
//   curator judges what it writes anyway. Nothing in an event says
//   "paperwork" in every language, and the model's rating of it (minor) is no
//   such word: a minor event can be a real outcome;
// - an event's weight read from breakpoint, instability, capability and
//   settlement words (TRAJECTORY_*_RE): deriveWorldTrajectoryValue below reads
//   what the event carries and the model's own rating of it;
// - a storyline's kind read for a crisis (CRISIS_DISCOVERY_KIND_RE): a kind
//   is one word of a fixed list (runtime/storylineKinds.js);
// - who chose an event, read from its title's subject and English verbs, and
//   whether the player's orders or messages backed it, read by the words they
//   shared with it: see "Whose decision an event is" below.

// The impact families that change the world's records. A polity's lifecycle
// (create, rename, restore, dissolve) is one; an update of its figures is not.
const HARD_IMPACT_FAMILIES = Object.freeze([
  "regionTransfers",
  "regionClaims",
  "groupOps",
  "regionControlOps",
  "politicalActorOps",
  "unitOps",
  "markerOps",
  "createdChats",
]);

export const hardImpactKeysForEvent = (event) => {
  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};

  const keys = HARD_IMPACT_FAMILIES.filter((key) => normalizeArray(impacts[key]).length);

  const lifecycle = normalizeArray(impacts?.polityChanges).filter((change) =>
    ["create", "rename", "restore", "dissolve"].includes(
      normalizeString(change?.operation).toLowerCase()
    )
  );

  if (lifecycle.length) keys.push("polityLifecycle");
  return keys;
};

// The storyline pressure past which a process is held to the anti-stasis
// cadence (nativeWorldDirector.js HIGH_PRESSURE_STAGNATION_THRESHOLD).
const HIGH_STORYLINE_PRESSURE = 55;

// How many different futures an event (or one of the director's candidates)
// still opens, 0 to 5: from what it carries, the storyline it advances and the
// model's own rating of it (importance, notable), never from its words. The
// breakpoint, instability, capability and settlement word lists it was read
// by were English, so a coup written in any other language was a 1. Candidate
// selection prefers a higher value and the crisis lane looks for 4 and up; it
// decides nothing about what happens.
//
// `storylinePressure`: the pressure of the busiest storyline the record
// advances, or -1 when it advances none. A record may carry it itself.
export const deriveWorldTrajectoryValue = (record = {}, { storylinePressure = record?.storylinePressure ?? -1 } = {}) => {
  const hardImpacts = hardImpactKeysForEvent(record).length;
  const importance = normalizeString(record?.importance).toLowerCase();
  const rated = importance === "major" || importance === "critical" || record?.notable === true;
  const pressure = Number.isFinite(Number(storylinePressure)) ? Number(storylinePressure) : -1;
  if (importance === "critical" || (rated && hardImpacts >= 2)) return 5;
  if (hardImpacts >= 2 || (rated && pressure >= HIGH_STORYLINE_PRESSURE)) return 4;
  if (hardImpacts === 1 || rated || pressure >= HIGH_STORYLINE_PRESSURE) return 3;
  if (importance === "moderate" || pressure >= 0 || normalizeString(record?.warId)) return 2;
  return 1;
};

// What a crisis lane's trigger may lead to, from what its event carried: its
// own tags (the model's categories) and the families of its operations. Every
// crisis is a storyline in the making and moves relations.
const CRISIS_CHANNELS_BY_TAG = Object.freeze({
  Military: "units / readiness",
  Politics: "polity/government state",
  Economy: "Stats / economic-social state",
  Disaster: "Stats / economic-social state",
});
const CRISIS_CHANNELS_BY_IMPACT = Object.freeze({
  regionTransfers: "war or territorial control if belligerency actually crosses the threshold",
  regionControlOps: "war or territorial control if belligerency actually crosses the threshold",
  regionClaims: "war or territorial control if belligerency actually crosses the threshold",
  groupOps: "war or territorial control if belligerency actually crosses the threshold",
  unitOps: "units / readiness",
  politicalActorOps: "polity/government state",
  polityLifecycle: "polity/government state",
});
const crisisConsequenceChannels = (candidate) => {
  const channels = new Set(["persistent storyline", "relations"]);
  for (const tag of normalizeArray(candidate?.tags)) {
    const channel = CRISIS_CHANNELS_BY_TAG[normalizeString(tag)];
    if (channel) channels.add(channel);
  }
  for (const key of normalizeArray(candidate?.impactKeys)) {
    const channel = CRISIS_CHANNELS_BY_IMPACT[normalizeString(key)];
    if (channel) channels.add(channel);
  }
  return [...channels].slice(0, 5);
};

// The polities a director's candidate concerns, from its structured record
// (nativeWorldDirector.js gives each candidate its `parties`): never the
// names its title or detail happen to contain.
const candidatePolities = (candidate, actorResolver) => uniqueStrings(
  normalizeArray(candidate?.parties)
    .map((party) => actorResolver.knownCanonical(party))
    .filter(Boolean),
);

const deriveLatentCrisisDiscoveryCandidate = ({
  causalCandidates = [],
  actorResolver,
  playerSphereKeys = new Set(),
} = {}) => {
  const rows = [];
  for (const candidate of normalizeArray(causalCandidates)) {
    if (normalizeArray(candidate?.storylineIds).length) continue;
    const trajectoryValue = Number.isFinite(Number(candidate?.trajectoryValue))
      ? Number(candidate.trajectoryValue)
      : deriveWorldTrajectoryValue(candidate);
    if (trajectoryValue < 4) continue;

    const actors = candidatePolities(candidate, actorResolver);
    if (!actors.length) continue;

    const widerActors = actors.filter((actor) => !playerSphereKeys.has(actor.toLowerCase()));
    if (!widerActors.length) continue;

    rows.push({
      actor: widerActors[0],
      actors: actors.slice(0, 4),
      sourceCandidateId: normalizeString(candidate?.id),
      sourceTitle: normalizeString(candidate?.title),
      sourceDetail: normalizeString(candidate?.detail),
      trajectoryValue,
      score: (Number(candidate?.score) || 0) + trajectoryValue * 3,
      consequenceChannels: crisisConsequenceChannels(candidate),
    });
  }

  return rows.sort((a, b) =>
    (b.score - a.score) ||
    (b.trajectoryValue - a.trajectoryValue) ||
    a.actor.localeCompare(b.actor)
  )[0] || null;
};

const normalizeString = (value) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeArray = (value) =>
  Array.isArray(value) ? value : [];


const uniqueStrings = (items) => [...new Set(
  normalizeArray(items).map(normalizeString).filter(Boolean),
)];

const stableHash = (value) => {
  let hash = 2166136261;
  for (const ch of String(value ?? "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// Milliseconds for a game date, BC included (runtime/gameDates.js).
const parseIsoDate = (value) => {
  const dayNumber = gameDateDayNumber(value);
  return dayNumber === null ? null : dayNumber * 86400000;
};

export const worldIntegrityAgeDays = (originDate, eventDate) => {
  const origin = parseIsoDate(originDate);
  const event = parseIsoDate(eventDate);
  if (origin == null || event == null) return 99999;
  return Math.max(0, Math.round((origin - event) / 86400000));
};

export const latestCanonicalWorldEventDate = (events, originDate) =>
  normalizeArray(events)
    .map((event) => normalizeString(event?.date))
    .filter((date) => parseIsoDate(date) != null && (!originDate || compareGameDates(date, originDate) <= 0))
    .sort(compareGameDates)
    .at(-1) || "";

const activeWarEntries = (world) =>
  normalizeArray(world?.wars).filter((war) =>
    ["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())
  );

// `humans` are a shared game's other human polities (runtime/humanPolities.js):
// known here even when no ledger names them yet, like the player.
const polityAliasRecords = (world, gameCountry = "", humans = []) => {
  const records = [];
  const overrideAliasMap = new Map();

  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    const canonical = normalizeString(entry?.name || entry?.code || key);
    if (!canonical) continue;

    for (const alias of uniqueStrings([
      canonical,
      key,
      entry?.code,
      entry?.name,
      ...normalizeArray(entry?.aliases),
    ])) {
      overrideAliasMap.set(alias.toLowerCase(), canonical);
    }
  }

  const canonicalize = (token) => {
    const raw = normalizeString(token);
    if (!raw) return "";
    return overrideAliasMap.get(raw.toLowerCase()) || raw;
  };

  const add = (token, aliases = []) => {
    const canonical = canonicalize(token);
    if (!canonical) return;

    const expandedAliases = uniqueStrings([
      canonical,
      token,
      ...normalizeArray(aliases),
    ]);

    const stockCodes = uniqueStrings(
      expandedAliases
        .map((alias) => resolveStockCountryCode(alias))
        .filter(Boolean),
    );

    records.push({
      canonical,
      aliases: expandedAliases,
      stockCodes,
    });
  };

  add(gameCountry);
  for (const human of normalizeArray(humans)) add(human);

  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    add(
      entry?.name || entry?.code || key,
      [key, entry?.code, entry?.name, ...normalizeArray(entry?.aliases)],
    );
  }

  for (const key of Object.keys(world?.countryStats || {})) add(key);

  // Territory ownership is identity provenance too. A bounded/normalized world
  // view may omit full polityOverrides while still carrying exact active owner
  // names. Admit those names so stock short aliases such as "North Korea" can
  // resolve back to the campaign identity "Democratic People's Republic of Korea".
  for (const owner of uniqueStrings(Object.values(world?.regionOwnershipOverrides || {}))) add(owner);
  for (const owner of uniqueStrings(Object.values(world?.regionSovereigntyOverrides || {}))) add(owner);
  for (const actor of uniqueStrings(
    Object.values(world?.regionClaimants || {}).flatMap((claimants) => normalizeArray(claimants)),
  )) add(actor);

  for (const war of normalizeArray(world?.wars)) {
    for (const actor of [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]) {
      add(actor);
    }
  }

  for (const relation of normalizeArray(world?.relations)) {
    add(relation?.polityA || relation?.a || relation?.actorA);
    add(relation?.polityB || relation?.b || relation?.actorB);
  }

  for (const agreement of normalizeArray(world?.agreements)) {
    for (const actor of normalizeArray(agreement?.parties)) add(actor);
  }

  for (const storyline of normalizeArray(world?.storylines)) {
    for (const actor of normalizeArray(storyline?.participants)) add(actor);
  }

  const byCanonical = new Map();

  for (const record of records) {
    const key = record.canonical.toLowerCase();
    const prior = byCanonical.get(key);

    byCanonical.set(key, {
      canonical: prior?.canonical || record.canonical,
      aliases: uniqueStrings([
        ...(prior?.aliases || []),
        ...record.aliases,
      ]),
      stockCodes: uniqueStrings([
        ...(prior?.stockCodes || []),
        ...normalizeArray(record.stockCodes),
      ]),
    });
  }

  return [...byCanonical.values()];
};

export const createWorldActorResolver = (world, gameCountry = "", { humans = [] } = {}) => {
  const records = polityAliasRecords(world, gameCountry, humans);
  const byAlias = new Map();
  const byCanonical = new Map();
  const stockToCanonicals = new Map();

  for (const record of records) {
    const canonical = normalizeString(record?.canonical);
    if (!canonical) continue;
    byCanonical.set(canonical.toLowerCase(), record);
    for (const alias of uniqueStrings([canonical, ...normalizeArray(record?.aliases)])) {
      const key = alias.toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, canonical);
    }
    for (const code of normalizeArray(record?.stockCodes)) {
      const key = normalizeString(code).toUpperCase();
      if (!key) continue;
      if (!stockToCanonicals.has(key)) stockToCanonicals.set(key, new Set());
      stockToCanonicals.get(key).add(canonical);
    }
  }

  // Current-state identity intentionally excludes storylines, because a stale
  // storyline alias is exactly what this precedence layer is meant to heal.
  const authoritativeTokens = uniqueStrings([
    gameCountry,
    ...normalizeArray(humans),
    ...Object.entries(world?.polityOverrides || {}).flatMap(([keyValue, entry]) => [
      keyValue,
      entry?.code,
      entry?.name,
      ...normalizeArray(entry?.aliases),
    ]),
    ...Object.keys(world?.countryStats || {}),
    ...Object.values(world?.regionOwnershipOverrides || {}),
    ...Object.values(world?.regionSovereigntyOverrides || {}),
    ...Object.values(world?.regionClaimants || {}).flatMap((claimants) => normalizeArray(claimants)),
    ...normalizeArray(world?.wars).flatMap((war) => [
      ...normalizeArray(war?.sideA),
      ...normalizeArray(war?.sideB),
    ]),
    ...normalizeArray(world?.relations).flatMap((relation) => [
      relation?.polityA || relation?.a || relation?.actorA,
      relation?.polityB || relation?.b || relation?.actorB,
    ]),
    ...normalizeArray(world?.agreements).flatMap((agreement) => normalizeArray(agreement?.parties)),
  ]);

  const authoritativeByStock = new Map();
  for (const token of authoritativeTokens) {
    const code = normalizeString(resolveStockCountryCode(token)).toUpperCase();
    if (!code) continue;
    const canonical =
      byAlias.get(normalizeString(token).toLowerCase()) ||
      normalizeString(token);
    if (!canonical) continue;
    if (!authoritativeByStock.has(code)) authoritativeByStock.set(code, new Set());
    authoritativeByStock.get(code).add(canonical);
  }

  const canonical = (actor) => {
    const raw = normalizeString(actor);
    if (!raw) return "";
    const stockCode = normalizeString(resolveStockCountryCode(raw)).toUpperCase();

    if (stockCode) {
      const authoritative = [...(authoritativeByStock.get(stockCode) || [])];
      if (authoritative.length === 1) return authoritative[0];
    }

    const exact = byAlias.get(raw.toLowerCase());
    if (exact) return exact;

    if (stockCode) {
      const matches = [...(stockToCanonicals.get(stockCode) || [])];
      if (matches.length === 1) return matches[0];
    }

    return raw;
  };

  // `canonical()` intentionally preserves an unknown token as itself because
  // several legacy callers use it as a normalization helper. Grounding cannot
  // treat that fallback as proof that the token is a real polity, though. This
  // stricter resolver is for legal/canonical ownership decisions.
  const knownCanonical = (actor) => {
    const resolved = canonical(actor);
    return resolved && byCanonical.has(resolved.toLowerCase()) ? resolved : "";
  };

  const equivalent = (left, right) => {
    const a = canonical(left).toLowerCase();
    const b = canonical(right).toLowerCase();
    return Boolean(a && b && a === b);
  };

  // No resolver call looks for a name in a text: what an event, a candidate or
  // a record concerns is read from the names its structured fields hold
  // (eventStructuredPartyNames below), looked up exactly here. The whole-word
  // alias search it had (mentionedPolities, mentions) found a polity only
  // where its name was written as the save writes it, never in a translation,
  // a demonym or another script.
  return {
    records,
    canonical,
    knownCanonical,
    equivalent,
  };
};

export const canonicalWorldActor = (actor, world, gameCountry = "") =>
  createWorldActorResolver(world, gameCountry).canonical(actor);


export const worldActorsEquivalent = (
  left,
  right,
  world,
  gameCountry = "",
) => {
  const a = canonicalWorldActor(left, world, gameCountry).toLowerCase();
  const b = canonicalWorldActor(right, world, gameCountry).toLowerCase();
  return Boolean(a && b && a === b);
};

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A chat participant as a name: a string, or a { name, code } record.
const participantName = (value) => normalizeString(typeof value === "string" ? value : value?.name || value?.code);

// Every polity name an event's structured fields hold: who it says decided
// (actors), who fought in it, the sovereign rows of its agency, and every
// polity its operations name. Raw names, as written: a caller looks them up
// (createWorldActorResolver knownCanonical). Its title and description are
// never read for a name.
export const eventStructuredPartyNames = (event) => {
  if (!isPlainObject(event)) return [];
  const impacts = isPlainObject(event.impacts) ? event.impacts : {};
  const agency = isPlainObject(event.agency) ? event.agency : {};
  return uniqueStrings([
    ...normalizeArray(event.actors),
    ...normalizeArray(event.combatants),
    agency.sovereignPolity,
    agency.jurisdictionPolity,
    normalizeString(agency.principalKind).toLowerCase() === "polity" ? agency.principal : "",
    ...normalizeArray(agency.sovereignActors).map((row) => row?.polity || row?.sovereignPolity),
    ...normalizeArray(impacts.polityChanges).flatMap((change) => [change?.code, change?.name]),
    ...normalizeArray(impacts.politicalActorOps).map((operation) => operation?.polityKey || operation?.polity || operation?.country),
    ...normalizeArray(impacts.regionTransfers).flatMap((entry) => [entry?.fromCode, entry?.toCode]),
    ...normalizeArray(impacts.regionClaims).flatMap((entry) => [entry?.claimantCode, entry?.claimant]),
    ...normalizeArray(impacts.regionControlOps).flatMap((entry) => [entry?.fromCode, entry?.toCode, entry?.actorCode, entry?.claimantCode]),
    ...normalizeArray(impacts.createdChats).flatMap((chat) => [chat?.speaker, chat?.to, ...normalizeArray(chat?.countries).map(participantName)]),
    ...normalizeArray(impacts.unitOps).flatMap((operation) => [operation?.ownerCode, operation?.unit?.ownerCode]),
    ...normalizeArray(impacts.institutionLifecycleOps).flatMap((operation) => [operation?.actorPolity, operation?.targetPolity]),
  ].map((name) => (typeof name === "string" ? name : participantName(name))));
};

// The known polities among them, as the resolver names them.
const eventPartyPolities = (event, resolver) => uniqueStrings(
  eventStructuredPartyNames(event).map((name) => resolver.knownCanonical(name)).filter(Boolean),
);

const transportReferencesEventNumber = (value, oneBasedEventNumber) => {
  const target = Number(oneBasedEventNumber);
  if (!Number.isInteger(target) || target < 1) return false;

  return String(value ?? "")
    .split(/\r?\n/)
    .some((line) => {
      const fields = line.split("~");
      if (fields.length < 5) return false;

      return fields[4]
        .split(",")
        .map((item) => Number.parseInt(item.trim(), 10))
        .some((item) => item === target);
    });
};

// The ledgers whose records an event rests on: wars, relations, agreements and
// the battlefields' orders (nativeFrontLedger.js), which carry their events'
// numbers in the same field.
const EVENT_LEDGERS = Object.freeze(["warUpdates", "relationUpdates", "agreementUpdates", "frontOrders"]);

// The records of one ledger tied to an event: by the event's id, or by its
// place, once a skip's ledgers are pinned (ledgerPins.js) and read as objects;
// by the event's number in a ledger still in its `~` lines.
const ledgerRecordsOfEvent = (value, event, eventIndex) => {
  if (!Array.isArray(value)) return transportReferencesEventNumber(value, eventIndex + 1) ? [{}] : [];
  const eventId = normalizeString(event?.id);
  return value.filter((record) => {
    if (typeof record === "string") return transportReferencesEventNumber(record, eventIndex + 1);
    if (!isPlainObject(record)) return false;
    return (eventId && normalizeArray(record.eventIds).map(normalizeString).includes(eventId))
      || normalizeArray(record.eventIndexes).map(Number).includes(eventIndex);
  });
};

const eventHasLedgerTrigger = (candidate, zeroBasedEventIndex) => {
  const event = normalizeArray(candidate?.events)[zeroBasedEventIndex];
  return EVENT_LEDGERS.some((key) => ledgerRecordsOfEvent(candidate?.[key], event, zeroBasedEventIndex).length > 0);
};

// The polities a ledger record names: an agreement's parties, a relation's two
// sides, a war's actors and opponents.
const ledgerRecordPolities = (record) => uniqueStrings([
  ...normalizeArray(record?.parties),
  ...normalizeArray(record?.sideA),
  ...normalizeArray(record?.sideB),
  ...normalizeArray(record?.actors),
  ...normalizeArray(record?.opponents),
  record?.a,
  record?.b,
  record?.polityA,
  record?.polityB,
]);

// Whether the event takes in a participant the storyline update adds: one the
// event's structured fields or its ledger records name. Never one found in its
// prose: a participant named in a translation, or in the genitive, was never
// found, and one named in passing woke a storyline.
const newParticipantsInEvent = (prior, update, candidate, event, eventIndex) => {
  const before = new Set(
    normalizeArray(prior?.participants)
      .map((item) => normalizeString(item).toLowerCase())
      .filter(Boolean),
  );

  const additions = normalizeArray(update?.participants)
    .map(normalizeString)
    .filter(Boolean)
    .filter((participant) => !before.has(participant.toLowerCase()));

  if (!additions.length) return false;

  const named = new Set([
    ...eventStructuredPartyNames(event),
    ...EVENT_LEDGERS.flatMap((key) => ledgerRecordsOfEvent(candidate?.[key], event, eventIndex)).flatMap(ledgerRecordPolities),
  ].map((name) => normalizeString(name).toLowerCase()).filter(Boolean));

  return additions.some((participant) => named.has(participant.toLowerCase()));
};

const deferredUpdateHasObjectiveDelta = (prior, update) => {
  if (!prior || !update) return false;

  const priorStatus = normalizeString(prior?.status).toLowerCase();
  const nextStatus = normalizeString(update?.status).toLowerCase();
  if (nextStatus && nextStatus !== priorStatus) return true;

  const priorPressure = Math.max(0, Math.min(100, Number(prior?.pressure) || 0));
  const nextPressure = Math.max(0, Math.min(100, Number(update?.pressure) || 0));
  if (Math.abs(nextPressure - priorPressure) >= 4) return true;

  const priorMomentum = Math.max(0, Math.min(100, Number(prior?.momentum) || 0));
  const nextMomentum = Math.max(0, Math.min(100, Number(update?.momentum) || 0));
  return Math.abs(nextMomentum - priorMomentum) >= 6;
};

// Whether a deferred storyline's linked events give it a reason to come back
// into this pass, from what they carry and whom they name, never from what
// their words say happened: an operation of their own, a war, relation,
// agreement or front record, a new participant the event's own fields or
// records name, or, with the storyline's own state moved, an event the model
// rated major or notable. A minor event that changes nothing wakes nothing,
// whatever it says, in any language (the words used to: "counteroffensive",
// "mutiny", "election" and the rest woke a storyline, and "artillery" or
// "patrol" kept one asleep, in English only).
export const deferredStorylineReentryHasConcreteTrigger = (
  candidate,
  eventIndexes,
  prior,
  update,
  { requireObjectiveDelta = true } = {},
) =>
  normalizeArray(eventIndexes).some((eventIndex) => {
    const event = normalizeArray(candidate?.events)[eventIndex];
    if (!event) return false;

    // Existing hard mechanics/ledger transitions remain sufficient by themselves.
    if (hardImpactKeysForEvent(event).length) return true;
    if (eventHasLedgerTrigger(candidate, eventIndex)) return true;
    if (newParticipantsInEvent(prior, update, candidate, event, eventIndex)) return true;

    if (requireObjectiveDelta && !deferredUpdateHasObjectiveDelta(prior, update)) return false;

    const importance = normalizeString(event?.importance).toLowerCase();
    if (event?.notable === true || ["major", "critical"].includes(importance)) {
      return true;
    }

    return false;
  });

const actorPoolForExploration = (
  bundle,
  diplomaticActors = [],
  causalCandidates = [],
) => {
  const world = bundle?.world || {};
  const gameCountry = normalizeString(bundle?.game?.country);
  const actorResolver = createWorldActorResolver(world, gameCountry);
  const playerCanonical = actorResolver.canonical(gameCountry);
  const weighted = [];

  const add = (actor, weight = 1, reason = "") => {
    const text = actorResolver.canonical(actor);
    if (!text) return;

    // The human polity may belong to the PLAYER-SPHERE as a causal target, but it
    // must never receive its own autonomous actor-domain exploration lane. A named
    // player slot strongly invites the model to invent cabinet/parliament/foreign-
    // policy choices merely to satisfy exploration. Connected NPC actors and the
    // regional/system lanes keep the player's sphere alive without granting that
    // sovereign discretion.
    if (playerCanonical && actorResolver.equivalent(text, playerCanonical)) return;

    weighted.push({
      actor: text,
      weight: Math.max(0, Number(weight) || 0),
      reason: normalizeString(reason),
    });
  };

  // Named exploration slots must be earned by CURRENT campaign evidence.
  // The previous implementation added every alias/stat entry in the save,
  // which turned the world sweep into a tour of tiny states, dormant regimes,
  // and future/historical catalog identities. The human polity is deliberately
  // excluded by add(): PLAYER-SPHERE is an attention scope, not permission for
  // autonomous player-government decisions.

  for (const actor of normalizeArray(diplomaticActors)) {
    add(actor, 9, "active diplomatic ledger");
  }

  for (const war of activeWarEntries(world)) {
    for (const actor of [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]) {
      add(actor, 8, `active canonical conflict ${normalizeString(war?.id) || "war"}`);
    }
  }

  for (const storyline of normalizeArray(world?.storylines)) {
    const status = normalizeString(storyline?.status).toLowerCase();
    if (status === "resolved") continue;
    for (const actor of normalizeArray(storyline?.participants)) {
      add(
        actor,
        status === "active" ? 7 : 4,
        `unresolved ${normalizeString(storyline?.kind) || "world"} storyline`,
      );
    }
  }

  for (const agreement of normalizeArray(world?.agreements)) {
    const status = normalizeString(agreement?.status).toLowerCase();
    if (["ended", "expired", "terminated"].includes(status)) continue;
    for (const actor of normalizeArray(agreement?.parties)) {
      add(actor, 7, `formal ${normalizeString(agreement?.type) || "agreement"} relationship`);
    }
  }

  for (const relation of normalizeArray(world?.relations)) {
    add(relation?.polityA || relation?.a || relation?.actorA, 6, "bilateral relation ledger");
    add(relation?.polityB || relation?.b || relation?.actorB, 6, "bilateral relation ledger");
  }

  for (const unit of normalizeArray(world?.units)) {
    add(unit?.ownerCode || unit?.owner, 6, "persistent military presence");
  }

  for (const owner of uniqueStrings(Object.values(world?.regionOwnershipOverrides || {}))) {
    add(owner, 6, "current de-facto territorial state");
  }
  for (const owner of uniqueStrings(Object.values(world?.regionSovereigntyOverrides || {}))) {
    add(owner, 6, "current legal territorial state");
  }
  for (const actor of uniqueStrings(
    Object.values(world?.regionClaimants || {}).flatMap((claimants) => normalizeArray(claimants)),
  )) {
    add(actor, 6, "current territorial claim/contest");
  }

  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    if (normalizeString(entry?.status).toLowerCase() === "active") {
      add(entry?.name || entry?.code || key, 5, "explicitly active polity lifecycle");
    }
  }

  // Current causal evidence may introduce a relevant actor that is not otherwise
  // present in a formal ledger. This is bounded to the Director's filtered
  // present-tense evidence, never the raw full history, and to the polities a
  // candidate's record names (its parties), never the names in its text.
  for (const candidate of normalizeArray(causalCandidates)) {
    for (const actor of candidatePolities(candidate, actorResolver)) {
      add(actor, 8, `current evidence: ${normalizeString(candidate?.title) || "active development"}`);
    }
  }

  const best = new Map();
  for (const row of weighted) {
    const key = row.actor.toLowerCase();
    const prior = best.get(key);
    if (!prior) {
      best.set(key, {
        actor: row.actor,
        weight: row.weight,
        reasons: row.reason ? [row.reason] : [],
      });
      continue;
    }

    prior.weight = Math.max(prior.weight, row.weight);
    if (row.reason && !prior.reasons.includes(row.reason)) {
      prior.reasons.push(row.reason);
    }
  }

  return [...best.values()];
};

const buildPlayerSphereActorKeys = ({
  bundle,
  diplomaticActors = [],
  causalCandidates = [],
  actorResolver,
} = {}) => {
  const world = bundle?.world || {};
  const player = actorResolver.canonical(bundle?.game?.country);
  const playerKey = normalizeString(player).toLowerCase();
  const keys = new Set();
  const add = (actor) => {
    const canonical = actorResolver.canonical(actor);
    const key = normalizeString(canonical).toLowerCase();
    if (key) keys.add(key);
  };

  add(player);

  // The bounded diplomatic context is already selected around the player and
  // active processes, so its actors are legitimate members of the player's
  // current causal sphere rather than arbitrary geographic catalog entries.
  for (const actor of normalizeArray(diplomaticActors)) add(actor);

  for (const relation of normalizeArray(world?.relations)) {
    const a = actorResolver.canonical(relation?.polityA || relation?.a || relation?.actorA);
    const b = actorResolver.canonical(relation?.polityB || relation?.b || relation?.actorB);
    if (normalizeString(a).toLowerCase() === playerKey) add(b);
    if (normalizeString(b).toLowerCase() === playerKey) add(a);
  }

  for (const agreement of normalizeArray(world?.agreements)) {
    const parties = normalizeArray(agreement?.parties).map((actor) => actorResolver.canonical(actor));
    if (parties.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of parties) add(actor);
    }
  }

  for (const war of activeWarEntries(world)) {
    const actors = [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]
      .map((actor) => actorResolver.canonical(actor));
    if (actors.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of actors) add(actor);
    }
  }

  for (const storyline of normalizeArray(world?.storylines)) {
    if (normalizeString(storyline?.status).toLowerCase() === "resolved") continue;
    const participants = normalizeArray(storyline?.participants)
      .map((actor) => actorResolver.canonical(actor));
    if (participants.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of participants) add(actor);
    }
  }

  // Current evidence can pull a nearby/connected actor into the sphere even
  // before a formal relation ledger exists. This is intentionally bounded to
  // the Director's present-tense causal candidate set, and to the polities each
  // candidate's record names beside the player.
  for (const candidate of normalizeArray(causalCandidates)) {
    const parties = candidatePolities(candidate, actorResolver);
    if (parties.some((actor) => normalizeString(actor).toLowerCase() === playerKey)) {
      for (const actor of parties) add(actor);
    }
  }

  return keys;
};

export const buildNativeWorldExplorationSlate = ({
  bundle,
  allStorylines = [],
  selectedStorylines = [],
  diplomaticActors = [],
  causalCandidates = [],
  crisisCandidates = causalCandidates,
} = {}) => {
  const actorRows = actorPoolForExploration(
    bundle,
    diplomaticActors,
    causalCandidates,
  );
  const actorResolver = createWorldActorResolver(
    bundle?.world || {},
    normalizeString(bundle?.game?.country),
  );
  const originDate = normalizeString(bundle?.game?.gameDate);
  const round = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));
  const seed = stableHash(
    `${originDate}|${round}|${actorRows.map((row) => row.actor).sort().join("|")}`,
  );

  const selectedIds = new Set(
    normalizeArray(selectedStorylines)
      .map((storyline) => normalizeString(storyline?.id))
      .filter(Boolean),
  );

  // Selected storylines already give their participants dedicated causal
  // attention. Keep them out of independent actor-domain slots so a crisis actor
  // cannot earn another routine card merely by being salient. R3.6 fixes the live
  // 1/9 scope imbalance with same-scope SYSTEM fillers instead of violating this
  // separation.
  const selectedParticipantKeys = new Set(
    normalizeArray(selectedStorylines)
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map((actor) => actorResolver.canonical(actor).toLowerCase())
      .filter(Boolean),
  );

  const deferred = normalizeArray(allStorylines)
    .filter((storyline) =>
      normalizeString(storyline?.status).toLowerCase() !== "resolved" &&
      !selectedIds.has(normalizeString(storyline?.id))
    );

  // R3.6 composition target: five PLAYER-SPHERE evaluation lanes and five
  // WIDER-WORLD lanes by construction. This does NOT mean five local + five global
  // events. Quiet lanes stay quiet. Actor scarcity is handled by system/global
  // lanes rather than silently turning a 50/50 scheduler into 1/9.
  const playerSphereKeys = buildPlayerSphereActorKeys({
    bundle,
    diplomaticActors,
    causalCandidates,
    actorResolver,
  });

  const stableRank = (salt) => (a, b) =>
    (b.weight - a.weight) ||
    (stableHash(`${seed}|${salt}|${a.actor}`) - stableHash(`${seed}|${salt}|${b.actor}`)) ||
    a.actor.localeCompare(b.actor);

  const eligibleActorRows = actorRows.filter((row) =>
    !selectedParticipantKeys.has(row.actor.toLowerCase())
  );

  const spherePool = eligibleActorRows
    .filter((row) => playerSphereKeys.has(row.actor.toLowerCase()))
    .sort(stableRank("player-sphere"));

  const widerPool = eligibleActorRows
    .filter((row) => !playerSphereKeys.has(row.actor.toLowerCase()));

  const sphereActors = spherePool
    .slice(0, EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS)
    .map((row) => ({ ...row, scope: "player-sphere" }));

  const sphereUsed = new Set(sphereActors.map((row) => row.actor.toLowerCase()));
  const widerEvidenceActors = widerPool
    .filter((row) => row.weight > 5)
    .sort(stableRank("wider-evidence"))
    .slice(0, EXPLORATION_WIDER_EVIDENCE_ACTOR_SLOTS)
    .map((row) => ({ ...row, scope: "wider-world" }));

  const widerUsed = new Set(widerEvidenceActors.map((row) => row.actor.toLowerCase()));
  const widerLatentActors = widerPool
    .filter((row) =>
      row.weight <= 5 &&
      !widerUsed.has(row.actor.toLowerCase())
    )
    .sort((a, b) =>
      (stableHash(`${seed}|wider-latent|${a.actor}`) - stableHash(`${seed}|wider-latent|${b.actor}`)) ||
      a.actor.localeCompare(b.actor)
    )
    .slice(0, EXPLORATION_WIDER_LATENT_ACTOR_SLOTS)
    .map((row) => ({
      ...row,
      scope: "wider-world",
      reasons: uniqueStrings([
        ...normalizeArray(row.reasons),
        "rotating latent-world attention: active polity outside the player sphere without a stronger recent evidence slot",
      ]),
    }));

  const widerActors = [...widerEvidenceActors, ...widerLatentActors];
  const usedKeys = new Set([
    ...sphereUsed,
    ...widerActors.map((row) => row.actor.toLowerCase()),
  ]);

  // Fill a sparse side from its own remaining actors first. If one side genuinely
  // cannot fill, borrow from the other side rather than shrinking the world sweep.
  const fillTo = (rows, target, pool, scope, salt) => {
    if (rows.length >= target) return;
    const extras = [...pool]
      .filter((row) => !usedKeys.has(row.actor.toLowerCase()))
      .sort(stableRank(salt));
    for (const row of extras) {
      if (rows.length >= target) break;
      rows.push({ ...row, scope });
      usedKeys.add(row.actor.toLowerCase());
    }
  };

  fillTo(
    sphereActors,
    EXPLORATION_PLAYER_SPHERE_ACTOR_SLOTS,
    spherePool,
    "player-sphere",
    "player-sphere-fill",
  );
  fillTo(
    widerActors,
    EXPLORATION_WIDER_ACTOR_SLOTS,
    widerPool,
    "wider-world",
    "wider-world-fill",
  );

  // Never borrow across the scope boundary just to hit an actor count. Missing
  // PLAYER-SPHERE actor lanes become regional/system lanes below; missing wider
  // actor lanes become wider-system lanes. This preserves both selected-storyline
  // isolation and the 5/5 attention contract.
  const rankedActors = [...sphereActors, ...widerActors];

  const actorSlots = rankedActors.map((row, index) => {
    const actor = row.actor;
    const domain =
      EXPLORATION_DOMAINS[(seed + index * 3) % EXPLORATION_DOMAINS.length];

    const deferredTopics = deferred
      .filter((storyline) =>
        normalizeArray(storyline?.participants)
          .some((participant) => actorResolver.equivalent(actor, participant))
      )
      .slice(0, 3)
      .map((storyline) => normalizeString(storyline?.title))
      .filter(Boolean);

    // The candidates whose record names this actor among its parties.
    const candidateEvidence = normalizeArray(causalCandidates)
      .filter((candidate) =>
        candidatePolities(candidate, actorResolver).some((party) => actorResolver.equivalent(party, actor))
      )
      .slice(0, 2)
      .map((candidate) => normalizeString(candidate?.title))
      .filter(Boolean);

    const basisParts = uniqueStrings([
      ...normalizeArray(row.reasons),
      ...candidateEvidence.map((title) => `current causal evidence: ${title}`),
    ]).slice(0, 4);

    return {
      id: index + 1,
      actor,
      domain,
      deferredTopics,
      basis: basisParts.join("; "),
      relevance: row.weight,
      scope: row.scope || (playerSphereKeys.has(actor.toLowerCase()) ? "player-sphere" : "wider-world"),
      type: "actor-domain",
    };
  });

  const latentCrisis = deriveLatentCrisisDiscoveryCandidate({
    // R3.7: dedicated crisis evidence is allowed to come from the full bounded
    // recent-history scan rather than only the ordinary top-10 initiative list.
    causalCandidates: normalizeArray(crisisCandidates).length
      ? crisisCandidates
      : causalCandidates,
    actorResolver,
    playerSphereKeys,
  });

  let nextId = actorSlots.length + 1;
  const systemSlots = [];

  const playerCount = actorSlots.filter((slot) => slot.scope === "player-sphere").length;
  const playerDeficit = Math.max(0, EXPLORATION_TARGET_PER_SCOPE - playerCount);
  for (let index = 0; index < playerDeficit; index += 1) {
    const domain = index === 0
      ? "cross-border reaction, non-sovereign domestic spillover, regional security pressure, incoming diplomacy, economic shock, social response, or a NEW latent problem inside the player's current causal sphere that is not merely another routine update to a selected storyline; do not originate a fresh government/parliament/sovereign choice for the human polity"
      : EXPLORATION_DOMAINS[(seed + 17 + index * 5) % EXPLORATION_DOMAINS.length];
    systemSlots.push({
      id: nextId++,
      actor: index === 0 ? "Player-sphere regional system" : `Player-sphere independent system ${index + 1}`,
      domain,
      // What covers the lane (deriveWorldExplorationAudit): material between
      // polities, for the regional lane and a cross-border domain.
      crossBorder: index === 0 || CROSS_BORDER_DOMAINS.has(domain),
      deferredTopics: [],
      basis:
        "same-scope balance filler: local actors already receiving selected-storyline attention remain excluded from independent actor slots; inspect independent regional/system consequences rather than borrowing a wider-world actor or servicing the selected storyline again. PLAYER-SPHERE is not player authority: if the human government must choose, stop at the pressure/proposal unless exact prior player authority exists",
      relevance: 0,
      scope: "player-sphere",
      type: "regional-system",
    });
  }

  const crisisActor = latentCrisis?.actor || "Wider-world latent instability";
  const crisisBasis = latentCrisis
    ? `PROTECTED CURRENT TRIGGER: ${latentCrisis.sourceTitle}. ${latentCrisis.sourceDetail || ""} ` +
      `Native trajectory value ${latentCrisis.trajectoryValue}/5. Plausible consequence channels if the process genuinely crosses threshold: ${latentCrisis.consequenceChannels.join(", ")}. ` +
      "Do not force escalation; decide whether this evidence has actually become a new persistent unstable process."
    : "No trajectory-4/5 wider-world trigger was found in the bounded present-tense ledger. Search latent instability conservatively; a crisis is not required and war is not the default.";

  systemSlots.push({
    id: nextId++,
    actor: crisisActor,
    domain:
      "CRISIS DISCOVERY: test whether current political legitimacy, elite fracture, constitutional/succession dispute, separatism/federal tension, mass unrest, military-security friction, financial panic, resource shock, sanctions pressure, alliance fracture, or similar instability has crossed from background tension into a genuinely NEW persistent multi-turn crisis",
    deferredTopics: [],
    basis: crisisBasis,
    relevance: latentCrisis?.score || 0,
    scope: "wider-world",
    type: "crisis-discovery",
    targetActor: latentCrisis?.actor || "",
    targetActors: latentCrisis?.actors || [],
    sourceCandidateId: latentCrisis?.sourceCandidateId || "",
    trajectoryValue: latentCrisis?.trajectoryValue || 0,
    consequenceChannels: latentCrisis?.consequenceChannels || [],
  });

  systemSlots.push({
    id: nextId++,
    actor: "Cross-border / wider world system",
    domain:
      "new diplomacy, mediation, alignment, trade, alliance, third-party reaction, technology, industry, social movement, institutional change, disaster, or regional pressure not already represented by a deferred storyline",
    deferredTopics: [],
    basis:
      "scan the wider current map/canon and surviving structural conditions for an independent consequential development; do not resurrect dormant or future polities from memorized history",
    relevance: 0,
    scope: "wider-world",
    type: "global",
    crossBorder: true,
  });

  const widerCount = actorSlots.filter((slot) => slot.scope === "wider-world").length +
    systemSlots.filter((slot) => slot.scope === "wider-world").length;
  const widerDeficit = Math.max(0, EXPLORATION_TARGET_PER_SCOPE - widerCount);
  for (let index = 0; index < widerDeficit; index += 1) {
    const domain = EXPLORATION_DOMAINS[(seed + 31 + index * 7) % EXPLORATION_DOMAINS.length];
    systemSlots.push({
      id: nextId++,
      actor: `Wider-world independent system ${index + 1}`,
      domain,
      crossBorder: CROSS_BORDER_DOMAINS.has(domain),
      deferredTopics: [],
      basis:
        "same-scope balance filler: current evidence did not provide another independent named wider-world actor, so inspect structural/latent causes without borrowing a player-sphere actor",
      relevance: 0,
      scope: "wider-world",
      type: "global",
    });
  }

  // Hard cap remains ten. Scope fillers only replace absent actor lanes, so this
  // slice normally removes nothing; it is a final safety guard for malformed saves.
  return [...actorSlots, ...systemSlots].slice(0, 10);
};

// A storyline record of the answer: an object, or its `~` line
// (id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventNumbersCSV~state).
const decodeStorylineAuditRecords = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);

  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const text = normalizeString(line);
      if (!text || !text.includes("~")) return null;

      const fields = text.split("~");

      return {
        id: normalizeString(fields[0]),
        status: normalizeString(fields[1]).toLowerCase(),
        pressure: Number(fields[2]) || 0,
        kind: normalizeString(fields[5]),
        title: normalizeString(fields[6]),
        participants: normalizeString(fields[7])
          .split(",")
          .map(normalizeString)
          .filter(Boolean),
        eventIndexes: normalizeString(fields[8])
          .split(",")
          .map((entry) => Number.parseInt(entry.trim(), 10) - 1)
          .filter((entry) => Number.isInteger(entry) && entry >= 0),
        state: normalizeString(fields.slice(9).join("~")),
      };
    })
    .filter(Boolean);
};

const hasNativeLedgerRecords = (value) =>
  Array.isArray(value)
    ? value.length > 0
    : Boolean(normalizeString(value));

// The polities a ledger's records name, for a ledger already read into
// records (a `~` line names its parties in fields of its own, and a raw ledger
// is counted only as material).
const ledgerPolities = (value) => normalizeArray(value)
  .filter(isPlainObject)
  .flatMap(ledgerRecordPolities);

// The polities an outreach letter names: who writes it, to whom, and the
// governments in it.
const outreachPolities = (chat) => uniqueStrings([
  chat?.speaker,
  chat?.to,
  ...normalizeArray(chat?.countries).map(participantName),
]);

export const deriveWorldExplorationAudit = (
  candidate,
  analysis = null,
  {
    world = {},
    gameCountry = "",
  } = {},
) => {
  const slate = normalizeArray(analysis?.explorationSlate);
  const events = normalizeArray(candidate?.events);
  const storylineUpdates = decodeStorylineAuditRecords(candidate?.storylineUpdates);
  const outreach = normalizeArray(candidate?.diplomaticOutreach);
  const ledgerValues = [
    candidate?.warUpdates,
    candidate?.relationUpdates,
    candidate?.agreementUpdates,
  ];
  const entries = new Map();
  const claimedEventIndexes = new Set();
  const claimedStorylineIds = new Set();
  // Build the actor catalogue once for this audit. Fire Rises-sized worlds can
  // contain hundreds of polity aliases and thousands of ownership rows; rebuilding
  // that catalogue inside every actor/text probe turns exploration validation into
  // an accidental quadratic main-thread workload.
  const resolver = createWorldActorResolver(world, gameCountry);
  // Who each event concerns, by its structured fields (eventStructuredPartyNames),
  // and who the outreach and the ledgers name. Never a name in a text.
  const eventParties = events.map((event) => eventPartyPolities(event, resolver));
  const outreachParties = outreach.flatMap(outreachPolities);
  const ledgerParties = ledgerValues.flatMap(ledgerPolities);
  const names = (list, actor) => normalizeArray(list).some((name) => resolver.equivalent(name, actor));

  const claimEventForActor = (actor) => {
    for (let index = 0; index < events.length; index += 1) {
      if (names(eventParties[index], actor)) {
        claimedEventIndexes.add(index);
        return `event${index + 1}`;
      }
    }
    return "";
  };

  const claimStorylineForActor = (actor) => {
    for (const update of storylineUpdates) {
      if (names(update?.participants, actor)) {
        const id = normalizeString(update?.id);
        if (id) claimedStorylineIds.add(id.toLowerCase());
        return id ? `storyline:${id}` : "";
      }
    }
    return "";
  };

  // Actor-domain slots are derived from actual returned material. The model no
  // longer has to maintain a parallel magic-string audit in summary.
  for (const slot of slate.filter((entry) => entry?.type === "actor-domain")) {
    const id = Number(slot?.id);
    if (!Number.isInteger(id)) continue;

    const actor = normalizeString(slot?.actor);
    let verdict = actor ? claimEventForActor(actor) : "";

    if (!verdict && actor) verdict = claimStorylineForActor(actor);

    if (!verdict && actor && names(outreachParties, actor)) {
      verdict = "outreach";
    }

    if (!verdict && actor && names(ledgerParties, actor)) {
      verdict = "ledger";
    }

    entries.set(id, verdict || "quiet");
  }

  // Global slots are intentionally conservative. They only count as covered when
  // the returned payload itself contains cross-border or otherwise-unclaimed world
  // material; they are never "satisfied" by a model-authored audit claim.
  for (const slot of slate.filter((entry) => entry?.type !== "actor-domain")) {
    const id = Number(slot?.id);
    if (!Number.isInteger(id)) continue;

    let verdict = "";

    if (slot?.type === "crisis-discovery") {
      // A genuinely NEW persistent unstable process: a storyline the world does
      // not have yet, of a crisis kind (runtime/storylineKinds.js), under real
      // pressure, with a visible event.
      const existingIds = new Set(
        normalizeArray(world?.storylines)
          .map((entry) => normalizeString(entry?.id).toLowerCase())
          .filter(Boolean),
      );
      const discovered = storylineUpdates.find((entry) => {
        const idValue = normalizeString(entry?.id).toLowerCase();
        const status = normalizeString(entry?.status).toLowerCase();
        return (
          idValue &&
          !existingIds.has(idValue) &&
          status !== "resolved" &&
          CRISIS_STORYLINE_KINDS.includes(storylineKindOf(entry?.kind)) &&
          (Number(entry?.pressure) || 0) >= 40 &&
          normalizeArray(entry?.eventIndexes).length > 0
        );
      });
      if (discovered) {
        const storylineId = normalizeString(discovered?.id);
        if (storylineId) claimedStorylineIds.add(storylineId.toLowerCase());
        verdict = storylineId ? `storyline:${storylineId}` : "new-crisis";
      }
    } else if (slot?.crossBorder === true) {
      if (outreach.length > 0) {
        verdict = "outreach";
      } else if (ledgerValues.some(hasNativeLedgerRecords)) {
        verdict = "ledger";
      } else {
        for (let index = 0; index < events.length; index += 1) {
          const createdChats = normalizeArray(events[index]?.impacts?.createdChats).length;
          if (eventParties[index].length >= 2 || createdChats > 0) {
            claimedEventIndexes.add(index);
            verdict = `event${index + 1}`;
            break;
          }
        }
      }
    } else {
      const unclaimedEventIndex = events.findIndex(
        (_event, index) => !claimedEventIndexes.has(index),
      );
      if (unclaimedEventIndex >= 0) {
        claimedEventIndexes.add(unclaimedEventIndex);
        verdict = `event${unclaimedEventIndex + 1}`;
      } else {
        const unclaimedStoryline = storylineUpdates.find((entry) => {
          const idValue = normalizeString(entry?.id).toLowerCase();
          return idValue && !claimedStorylineIds.has(idValue);
        });
        if (unclaimedStoryline) {
          const storylineId = normalizeString(unclaimedStoryline?.id);
          claimedStorylineIds.add(storylineId.toLowerCase());
          verdict = `storyline:${storylineId}`;
        }
      }
    }

    entries.set(id, verdict || "quiet");
  }

  // Defensive completion for malformed/internal slates: every real slot gets a
  // deterministic verdict even if its type was missing.
  for (const slot of slate) {
    const id = Number(slot?.id);
    if (Number.isInteger(id) && !entries.has(id)) entries.set(id, "quiet");
  }

  const quietSlotIds = [...entries.entries()]
    .filter(([, verdict]) => verdict === "quiet")
    .map(([id]) => id);
  const nonQuietCount = [...entries.values()]
    .filter((verdict) => verdict !== "quiet")
    .length;

  return {
    entries,
    quietSlotIds,
    nonQuietCount,
    slotCount: slate.length,
  };
};

export const validateWorldExplorationAudit = (
  candidate,
  analysis = null,
  {
    finalAttempt = false,
    world = {},
    gameCountry = "",
  } = {},
) => {
  const slate = normalizeArray(analysis?.explorationSlate);
  if (!slate.length) return "";

  // 0.8.6: exploration bookkeeping is now entirely native. The model still has
  // to evaluate the slate because the Director prompt tells it to, but it no
  // longer has to mirror that reasoning into a fragile WORLD_SWEEP magic string.
  // Coverage is derived from the actual returned events/storylines/diplomacy.
  const audit = deriveWorldExplorationAudit(candidate, analysis, {
    world,
    gameCountry,
  });

  // Long silence still gets one deliberate second look, but the retry is now
  // triggered from ACTUAL lack of material output rather than a model-authored
  // audit string. On the final attempt a genuinely quiet world is legal.
  const silenceDays = Number(analysis?.visibleSilenceDays);

  if (
    !finalAttempt &&
    Number.isFinite(silenceDays) &&
    silenceDays >= 60 &&
    slate.length >= 4 &&
    audit.nonQuietCount === 0
  ) {
    return `The campaign has had no canonical visible milestone for ${silenceDays} days and native inspection found no material result across ${slate.length} exploration slot(s). Re-evaluate the slate once more from current interests/capabilities and surviving latent causes. This is NOT an event quota: if the second pass is still genuinely quiet, keep it quiet.`;
  }

  return "";
};

const stablePolityIdentityToken = (token, world) => {
  const raw = normalizeString(token);
  if (!raw) return "";

  const target = raw.toLowerCase();
  for (const [key, entry] of Object.entries(world?.polityOverrides || {})) {
    const stable = normalizeString(entry?.code || key || entry?.name);
    const aliases = uniqueStrings([
      key,
      entry?.code,
      entry?.name,
      ...(normalizeArray(entry?.aliases)),
    ]);

    if (aliases.some((alias) => alias.toLowerCase() === target)) {
      return stable || raw;
    }
  }

  return raw;
};

const deepMergePlain = (left, right) => {
  if (
    !left || typeof left !== "object" || Array.isArray(left) ||
    !right || typeof right !== "object" || Array.isArray(right)
  ) {
    return right == null ? left : right;
  }

  const out = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
    ) {
      out[key] = deepMergePlain(out[key], value);
    } else if (value != null) {
      out[key] = value;
    }
  }
  return out;
};

const mergePolityUpdateRecords = (base, incoming) => {
  const merged = {
    ...base,
    ...incoming,
    // Keep the first emitted code/name spelling for presentation. The stable
    // lineage key is used only for duplicate detection; runtime identity
    // resolution still canonicalizes the mutation itself.
    code: normalizeString(base?.code) || normalizeString(incoming?.code),
    name: normalizeString(base?.name) || normalizeString(incoming?.name),
    aliases: uniqueStrings([
      ...normalizeArray(base?.aliases),
      ...normalizeArray(incoming?.aliases),
    ]),
    stats: deepMergePlain(base?.stats || {}, incoming?.stats || {}),
  };

  if (incoming?.tags == null && base?.tags != null) merged.tags = base.tags;
  if (incoming?.reputation == null && base?.reputation != null) {
    merged.reputation = base.reputation;
  }
  if (!normalizeString(incoming?.color) && normalizeString(base?.color)) {
    merged.color = base.color;
  }
  if (!normalizeString(incoming?.note) && normalizeString(base?.note)) {
    merged.note = base.note;
  }

  return merged;
};

const sanitizeDuplicatePolityUpdates = (event, world) => {
  if (!event || typeof event !== "object") {
    return { event, merged: 0 };
  }

  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};
  const changes = normalizeArray(impacts?.polityChanges);
  if (changes.length < 2) return { event, merged: 0 };

  const kept = [];
  const updateIndexByStable = new Map();
  let mergedCount = 0;

  for (const change of changes) {
    const operation = normalizeString(change?.operation).toLowerCase();
    if (operation !== "update") {
      kept.push(change);
      continue;
    }

    const stable = stablePolityIdentityToken(
      change?.code || change?.name,
      world,
    ).toLowerCase();

    if (!stable || !updateIndexByStable.has(stable)) {
      const index = kept.length;
      kept.push(change);
      if (stable) updateIndexByStable.set(stable, index);
      continue;
    }

    const index = updateIndexByStable.get(stable);
    kept[index] = mergePolityUpdateRecords(kept[index], change);
    mergedCount += 1;
  }

  if (!mergedCount) return { event, merged: 0 };

  return {
    event: {
      ...event,
      impacts: {
        ...impacts,
        polityChanges: kept,
      },
    },
    merged: mergedCount,
  };
};

const sanitizeNoOpRegionControlOps = (event, world) => {
  if (!event || typeof event !== "object") {
    return { event, removed: 0 };
  }

  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};
  const ops = normalizeArray(impacts?.regionControlOps);
  if (!ops.length) return { event, removed: 0 };

  const kept = [];
  const seenContestKeys = new Set();
  let removed = 0;

  for (const op of ops) {
    const kind = normalizeString(op?.op).toLowerCase();
    const regionId = normalizeString(op?.regionId);
    const claimants = normalizeArray(world?.regionClaimants?.[regionId])
      .map((claimant) =>
        stablePolityIdentityToken(
          typeof claimant === "string"
            ? claimant
            : claimant?.code || claimant?.name || claimant?.claimantCode,
          world,
        ).toLowerCase()
      )
      .filter(Boolean);

    if (kind === "contest") {
      const actor = stablePolityIdentityToken(op?.actorCode, world).toLowerCase();
      const signature = `${regionId.toLowerCase()}|${actor}`;

      if (
        !regionId ||
        !actor ||
        claimants.includes(actor) ||
        seenContestKeys.has(signature)
      ) {
        removed += 1;
        continue;
      }

      seenContestKeys.add(signature);
      kept.push(op);
      continue;
    }

    if (kind === "clear_contest") {
      const clearAll = op?.clearAll === true;
      const claimant = stablePolityIdentityToken(
        op?.claimantCode,
        world,
      ).toLowerCase();

      if (
        !regionId ||
        (clearAll && claimants.length === 0) ||
        (!clearAll && (!claimant || !claimants.includes(claimant)))
      ) {
        removed += 1;
        continue;
      }
    }

    kept.push(op);
  }

  if (!removed) return { event, removed: 0 };

  return {
    event: {
      ...event,
      impacts: {
        ...impacts,
        regionControlOps: kept,
      },
    },
    removed,
  };
};

// --- Whose decision an event is ----------------------------------------------
//
// An event's agency says who decided it, and on whose authority. It is read
// from what the event carries, never from its words: the governments and
// institutions it lists as deciding it (event.actors, a field of the skip's
// event, sent in every game but a shared game's host, which has no room for
// it: gameplaySchemas.js withEventActors), the parties of an agreement it
// starts and the side that starts or joins a war by it (the answer's own
// records, tied to it by id), a government
// whose own strategy it rewrites, the queued orders it cites
// (impacts.actionIds) and the open mandate it carries out. It used to be read
// from its title's subject (English verbs cut it out), from English words for
// police, protests, storms and meetings, and from the words it shared with the
// player's orders and messages. In another language a player's own event was
// "not safely classifiable", a treaty agreed in chat was unproven, and an
// order was settled, or stripped from the event that answered it, by what its
// words happened to share with the event's.
//
// A person's country decides only on that person's word: an order of theirs
// the event cites, or a message of theirs to every other party of what the
// event commits them to. Which of their words agreed to what is the model's to
// read when it writes the event; the engine checks only who spoke to whom. A
// shared game holds this hard (screenGeneratedWorldEvents); single player
// logs it.
//
// An event that lists no one deciding it, cites no order, carries out no
// mandate and belongs to no process already under way has no agency: the
// neutral default, kept as written. Nothing is guessed for it.

const currentActionRecords = (actions) => normalizeArray(actions)
  .filter((entry) => {
    const status = normalizeString(entry?.status).toLowerCase();
    return !status || status === "planned";
  })
  .map((entry) => ({
    id: normalizeString(entry?.id),
    source: entry,
  }))
  .filter((entry) => entry.id);

const currentActionIds = (actions) => new Set(currentActionRecords(actions).map((entry) => entry.id));

// The messages a human wrote, each with the governments of its conversation.
// Speaker identity is stronger provenance than generic chat role labels: the
// role (user/player) counts only when the transport names no speaker, and
// never in a shared game, where several people write.
const humanMessageRecords = (chats, resolver, humanCanonical, { roleFallback = true } = {}) => {
  const records = [];
  for (const chat of normalizeArray(chats)) {
    const countries = uniqueStrings(normalizeArray(chat?.countries).map(participantName));
    for (const message of normalizeArray(chat?.messages)) {
      const id = normalizeString(message?.id);
      if (!id || !normalizeString(message?.text || message?.content || message?.message)) continue;
      const role = normalizeString(message?.role).toLowerCase();
      const claimedActor = normalizeString(message?.polityKey || message?.code || message?.speaker);
      const authored = claimedActor
        ? resolver.equivalent(claimedActor, humanCanonical)
        : roleFallback && (role === "user" || role === "player");
      if (authored) records.push({ id, countries });
    }
  }
  return records;
};

// The human polities whose sovereignty the guard protects, and what each has
// authorized: its own queued orders and the messages it wrote. Single player
// has one, the player, and every order is theirs. In a shared game
// (runtime/humanPolities.js) an order counts only for the polity that gave it
// (ownerCode, the player's when blank) and a message only for its speaker: with
// several people writing, a bare "user" role says nothing about whose word it
// is. The resolver must know every human (createWorldActorResolver humans).
const humanAuthorities = ({ resolver, gameCountry = "", humanCountries = [], actions = [], chats = [] }) => {
  const primary = resolver.canonical(normalizeString(gameCountry));
  const canonicals = uniqueStrings(
    [gameCountry, ...normalizeArray(humanCountries)]
      .map((name) => resolver.canonical(normalizeString(name)))
      .filter(Boolean),
  );
  const shared = canonicals.length > 1;
  const records = currentActionRecords(actions);
  const humans = canonicals.map((canonical) => {
    const messages = humanMessageRecords(chats, resolver, canonical, { roleFallback: !shared });
    return {
      canonical,
      actionRecords: records.filter((entry) => {
        const owner = normalizeString(entry.source?.ownerCode);
        return resolver.equivalent(owner || primary, canonical);
      }),
      messages,
      commitmentIds: new Set(messages.map((entry) => entry.id)),
    };
  });
  // The human a polity name stands for, or null for everyone else.
  const find = (polity) => {
    const canonical = resolver.canonical(normalizeString(polity));
    return canonical ? humans.find((human) => resolver.equivalent(canonical, human.canonical)) || null : null;
  };
  return { primary, humans, shared, find };
};

// The other humans of a shared game, for createWorldActorResolver.
const otherHumans = (gameCountry, humanCountries) => {
  const player = normalizeString(gameCountry).toLowerCase();
  return uniqueStrings(normalizeArray(humanCountries).map(normalizeString).filter((name) => name && name.toLowerCase() !== player));
};

const canonicalProcessIds = (world) => {
  const ids = new Set();
  const add = (value) => {
    const id = normalizeString(value);
    if (id) ids.add(id);
  };

  for (const storyline of normalizeArray(world?.storylines)) {
    const status = normalizeString(storyline?.status).toLowerCase();
    if (status && status === "resolved") continue;
    add(storyline?.id);
  }
  for (const project of normalizeArray(world?.projects)) {
    const status = normalizeString(project?.status).toLowerCase();
    if (["completed", "cancelled", "canceled", "failed", "removed"].includes(status)) continue;
    add(project?.id);
  }
  for (const war of normalizeArray(world?.wars)) {
    const status = normalizeString(war?.status).toLowerCase();
    if (!["active", "ceasefire"].includes(status)) continue;
    add(war?.id);
  }
  for (const order of normalizeArray(world?.pendingUnitOrders)) add(order?.id);
  for (const id of institutionResolutionAuthorityIds(world)) add(id);

  return ids;
};

const nativeCanonicalProcessCandidates = (event, world) => {
  const allowed = canonicalProcessIds(world);
  const candidates = new Set();
  const add = (value) => {
    const id = normalizeString(value);
    if (id && allowed.has(id)) candidates.add(id);
  };
  for (const id of normalizeArray(event?.storylineIds)) add(id);
  add(event?.warId);
  return candidates;
};

const mirrorPrimaryAgencyRow = (agency) => {
  const rows = normalizeArray(agency?.sovereignActors);
  const primary = rows[0];
  if (!primary) return agency;
  return {
    ...agency,
    sovereignPolity: normalizeString(primary?.polity || primary?.sovereignPolity),
    authority: normalizeString(primary?.authority).toLowerCase(),
    authorityRef: normalizeString(primary?.authorityRef),
    sovereignActors: rows,
  };
};

// A name as the game's own vocabulary is compared: case and spacing folded,
// nothing else.
const identityKey = (value) => normalizeString(value).normalize("NFKC").toLocaleLowerCase();

const activeInstitutionEntries = (world = {}) => {
  const ledger = world?.institutions?.byId || world?.institutions || {};
  return Object.entries(ledger)
    .filter(([id, institution]) => id !== "schemaVersion" && id !== "ledgerVersion"
      && institution && typeof institution === "object" && !Array.isArray(institution)
      && normalizeString(institution.status || "active").toLowerCase() === "active")
    .map(([id, institution]) => ({ ...institution, id: institution.id || id }));
};

// The one active institution a name is, by its exact id, name, short name or
// alias (case and spacing aside). Two institutions under one name are no
// answer. A name that merely contains an institution's ("EU Foreign Affairs
// Council") is not that institution: it used to be, when it held an English
// organ word (council, committee, ministers), and in no other language.
const resolveInstitutionAuthorityPrincipal = (world = {}, principal = "") => {
  const key = identityKey(principal);
  if (!key) return null;
  const matches = activeInstitutionEntries(world).filter((institution) =>
    [institution.id, institution.name, institution.shortName, ...normalizeArray(institution.aliases)]
      .some((identity) => identityKey(identity) === key));
  return matches.length === 1 ? matches[0] : null;
};

// Whether an event makes a polity's own sovereign choice is read from what
// the event carries, never from its wording (no word lists: a world event that
// mentions the player's country beside "government" or "approves" is still
// the world's). The structured signs:
//   - the polity is one of the event's actors: the parties of an agreement it
//     starts, the side that starts or joins a war by it, or event.actors;
//   - a political-actor operation rewrites that government's own choices: its
//     strategy or how it means to behave. Parties, leaders, coalitions,
//     pressures and a new political system happen TO a country.
const SOVEREIGN_CHOICE_POLITICAL_OPS = new Set(["set-strategy", "set-behavioral-disposition"]);

const politicalChoiceTargets = (event, resolver) => uniqueStrings(normalizeArray(event?.impacts?.politicalActorOps)
  .filter((operation) => SOVEREIGN_CHOICE_POLITICAL_OPS.has(normalizeString(operation?.op).toLowerCase()))
  .map((operation) => resolver.canonical(normalizeString(operation?.polityKey || operation?.polity || operation?.country)))
  .filter(Boolean));

// The polities the event lists as deciding it (event.actors), by their exact
// names: an institution, a mandate or a name the world does not know is none.
const actorPolities = (event, resolver) => uniqueStrings(
  normalizeArray(event?.actors).map((actor) => resolver.knownCanonical(normalizeString(actor))).filter(Boolean),
);

// The institutions it lists as deciding it, each by its exact identity.
const actorInstitutions = (event, world, resolver) => {
  const byId = new Map();
  for (const actor of normalizeArray(event?.actors)) {
    if (resolver.knownCanonical(normalizeString(actor))) continue;
    const institution = resolveInstitutionAuthorityPrincipal(world, actor);
    const id = normalizeString(institution?.id);
    if (id && !byId.has(id)) byId.set(id, institution);
  }
  return [...byId.values()];
};

// The open mandate the event carries out: the id of an [Open Institutional
// Mandates] resolution it lists among its actors (runtime/institutionalAuthority.js),
// exactly as the skip was shown it.
const citedMandate = (event, world) => {
  const actors = normalizeArray(event?.actors).map(normalizeString).filter(Boolean);
  if (!actors.length) return "";
  const open = institutionResolutionAuthorityIds(world);
  return actors.find((actor) => open.has(actor)) || "";
};

const eventMakesStructuredChoiceFor = (event, resolver, polity) => Boolean(polity) && (
  actorPolities(event, resolver).some((actor) => resolver.equivalent(actor, polity))
  || politicalChoiceTargets(event, resolver).some((target) => resolver.equivalent(target, polity))
);

// The answer's records tied to an event, by its id or, before it has one, by
// its place: its agreements, wars and relations.
const recordsOfEvent = (candidate, event, eventIndex) => {
  const eventId = normalizeString(event?.id);
  const tied = (record) => isPlainObject(record) && (
    (eventId && normalizeArray(record.eventIds).map(normalizeString).includes(eventId))
    || (Number.isInteger(eventIndex) && normalizeArray(record.eventIndexes).map(Number).includes(eventIndex))
  );
  return {
    agreements: normalizeArray(candidate?.agreementUpdates).filter(tied),
    wars: normalizeArray(candidate?.warUpdates).filter(tied),
    relations: normalizeArray(candidate?.relationUpdates).filter(tied),
  };
};

// A war record that makes its actors choose: they start the war or join it.
const WAR_CHOICE_OPS = new Set(["start", "join-a", "join-b"]);

// Who decided the event: the polities it lists as deciding it, the parties of
// an agreement it starts, the side that starts or joins a war by it, and a
// government whose own strategy or disposition it rewrites. A relation's
// parties are not (a sanction's target is one), nor is the side a war is
// started against.
const choosersOf = (event, records, resolver) => uniqueStrings([
  ...actorPolities(event, resolver),
  ...records.agreements
    .filter((record) => normalizeString(record?.op).toLowerCase() === "start")
    .flatMap((record) => normalizeArray(record?.parties)),
  ...records.wars
    .filter((record) => WAR_CHOICE_OPS.has(normalizeString(record?.op).toLowerCase()))
    .flatMap((record) => normalizeArray(record?.actors)),
  ...politicalChoiceTargets(event, resolver),
].map((name) => resolver.knownCanonical(normalizeString(name))).filter(Boolean));

// Everyone the event commits its choosers to: the choosers themselves, and the
// parties of every record tied to it.
const involvedOf = (choosers, records, resolver) => uniqueStrings([
  ...choosers,
  ...[...records.agreements, ...records.wars, ...records.relations].flatMap(ledgerRecordPolities),
].map((name) => resolver.knownCanonical(normalizeString(name))).filter(Boolean));

// The first queued order of this human's that the event cites.
const citedOrderOf = (event, human) => {
  const owned = new Set(normalizeArray(human?.actionRecords).map((entry) => entry.id));
  return normalizeArray(event?.impacts?.actionIds).map(normalizeString).find((id) => owned.has(id)) || "";
};

// A message of this human's to every other party of what the event commits it
// to: the last one written in a conversation with any of them. "" when there is
// no other party, or one this human never wrote to. Who wrote to whom is all
// the engine reads; what the message agreed is the model's to have read.
const messageAuthorityOf = (human, others, resolver) => {
  if (!others.length) return "";
  const heard = (polity) => normalizeArray(human?.messages)
    .some((message) => message.countries.some((country) => resolver.equivalent(country, polity)));
  if (!others.every(heard)) return "";
  return normalizeArray(human?.messages)
    .filter((message) => message.countries.some((country) => others.some((polity) => resolver.equivalent(country, polity))))
    .at(-1)?.id || "";
};

const othersThan = (involved, human, resolver) => involved.filter((polity) => !resolver.equivalent(polity, human.canonical));

// An agency of sovereign rows, the first its principal. At most the native
// limit of rows: every person's row is kept, the governments the AI plays
// after them.
const polityAgency = (allRows) => {
  const rows = [
    ...allRows.filter((row) => row.authority !== "autonomous"),
    ...allRows.filter((row) => row.authority === "autonomous"),
  ].slice(0, EVENT_AGENCY_MAX_SOVEREIGN_ACTORS);
  const primary = allRows.find((row) => rows.includes(row)) || rows[0];
  return {
    principal: primary.polity,
    principalKind: "polity",
    sovereignPolity: primary.polity,
    authority: primary.authority,
    authorityRef: primary.authorityRef,
    sovereignActors: [primary, ...rows.filter((row) => row !== primary)],
  };
};

// The agency an event's structure gives it, or none (see above).
const deriveEventAgency = (event, { world = {}, resolver, authorities, records }) => {
  if (!isPlainObject(event)) return { agency: null, reason: "not-an-event", source: "none" };

  // Who decided it. A person's country among them needs that person's word.
  const choosers = choosersOf(event, records, resolver);
  const involved = involvedOf(choosers, records, resolver);
  const rows = [];
  for (const polity of choosers) {
    const human = authorities.find(polity);
    if (!human) {
      rows.push({ polity, authority: "autonomous", authorityRef: "" });
      continue;
    }
    const order = citedOrderOf(event, human);
    const message = order ? "" : messageAuthorityOf(human, othersThan(involved, human, resolver), resolver);
    if (!order && !message) {
      return {
        agency: null,
        reason: choosers.length > 1 ? "joint-player-sovereign-choice-without-authority" : "player-fresh-sovereign-choice-without-authority",
        source: "native-unresolved-player",
        polity: human.canonical,
      };
    }
    rows.push({ polity: human.canonical, authority: order ? "player-order" : "player-commitment", authorityRef: order || message });
  }

  // An open mandate the event carries out: the members act on the
  // institution's resolution, not on a fresh choice of their own, unless a
  // person's country is among them, whose own word then stands.
  const mandate = citedMandate(event, world);
  if (mandate && rows.every((row) => row.authority === "autonomous")) {
    const institution = actorInstitutions(event, world, resolver)[0];
    return {
      source: "native-mandate",
      reason: "cited-open-mandate",
      agency: {
        principal: normalizeString(institution?.name || institution?.shortName || institution?.id) || mandate,
        principalKind: "institution",
        sovereignPolity: "",
        authority: "canonical-process",
        authorityRef: mandate,
        sovereignActors: [],
      },
    };
  }

  if (rows.length) {
    return {
      source: "native-actors",
      reason: rows.length > 1 ? "joint-structured-choosers" : "structured-chooser",
      agency: polityAgency(rows),
    };
  }

  // No one listed as deciding it, but it carries out queued orders: the
  // governments that gave them, in the order the event cites them.
  const ordered = [];
  for (const id of normalizeArray(event?.impacts?.actionIds).map(normalizeString)) {
    const human = authorities.humans.find((entry) => entry.actionRecords.some((record) => record.id === id));
    if (human && !ordered.some((row) => row.polity === human.canonical)) {
      ordered.push({ polity: human.canonical, authority: "player-order", authorityRef: id });
    }
  }
  if (ordered.length) {
    return { source: "native-player-order", reason: "cited-current-order", agency: polityAgency(ordered) };
  }

  // An institution acting in its own right.
  const institutions = actorInstitutions(event, world, resolver);
  if (institutions.length === 1) {
    return {
      source: "native-institution",
      reason: "structured-institution-actor",
      agency: {
        principal: normalizeString(institutions[0]?.name || institutions[0]?.shortName || institutions[0]?.id),
        principalKind: "institution",
        sovereignPolity: "",
        authority: "autonomous",
        authorityRef: "",
        sovereignActors: [],
      },
    };
  }

  // A consequence of the one process already under way that it belongs to.
  const processIds = nativeCanonicalProcessCandidates(event, world);
  if (processIds.size === 1) {
    const [processId] = [...processIds];
    return {
      source: "native-canonical-process",
      reason: "one-process-under-way",
      agency: {
        principal: `canonical process ${processId}`,
        principalKind: "exogenous-process",
        sovereignPolity: "",
        authority: "canonical-process",
        authorityRef: processId,
        sovereignActors: [],
      },
    };
  }

  return { agency: null, reason: "no-structured-decider", source: "native-neutral" };
};

// An agency an event already carries (none of the game's contracts asks the
// model for one; a save or a test may hold one), its references bound from
// what the event carries: a person's order row to the order of theirs it cites,
// a commitment row to their message (an id of theirs it names, or the one its
// parties heard), an institution principal to its exact name, and a process to
// the one storyline or war it advances or the mandate it lists. Its claims are
// never rewritten: the authority check judges them.
const bindGivenAgency = (rawAgency, event, { world = {}, resolver, authorities, records }) => {
  let agency = { ...rawAgency };
  let rows = Array.isArray(rawAgency.sovereignActors)
    ? rawAgency.sovereignActors.map((row) => ({ ...row }))
    : [];

  const agencyAuthority = normalizeString(agency.authority).toLowerCase();
  if (normalizeString(agency.principalKind).toLowerCase() === "institution"
      && ["autonomous", "independent"].includes(agencyAuthority)) {
    const institution = resolveInstitutionAuthorityPrincipal(world, agency.principal);
    const canonicalPrincipal = normalizeString(institution?.name || institution?.shortName || institution?.id);
    if (canonicalPrincipal) agency.principal = canonicalPrincipal;
  }

  // Backward-compatible normalization for a singular sovereign mirror.
  if (!rows.length && normalizeString(rawAgency.sovereignPolity) &&
      EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(agencyAuthority)) {
    rows = [{
      polity: normalizeString(rawAgency.sovereignPolity),
      authority: agencyAuthority,
      authorityRef: normalizeString(rawAgency.authorityRef),
    }];
  }

  const involved = involvedOf(
    [...choosersOf(event, records, resolver), ...rows.map((row) => normalizeString(row?.polity || row?.sovereignPolity))],
    records,
    resolver,
  );
  rows = rows.map((row) => {
    const next = { ...row };
    const authority = normalizeString(row?.authority).toLowerCase();
    // Opaque ids on autonomous sovereign rows are never meaningful.
    if (authority === "autonomous") {
      next.authorityRef = "";
      return next;
    }
    const human = authorities.find(normalizeString(row?.polity || row?.sovereignPolity));
    if (!human) return next;
    if (authority === "player-order") next.authorityRef = citedOrderOf(event, human);
    if (authority === "player-commitment" && !human.commitmentIds.has(normalizeString(row?.authorityRef))) {
      next.authorityRef = messageAuthorityOf(human, othersThan(involved, human, resolver), resolver);
    }
    return next;
  });

  if (rows.length) {
    agency = mirrorPrimaryAgencyRow({ ...agency, sovereignActors: rows });
  } else if (agencyAuthority === "canonical-process" && !normalizeString(agency.authorityRef)) {
    const processes = nativeCanonicalProcessCandidates(event, world);
    agency.authorityRef = processes.size === 1 ? [...processes][0] : citedMandate(event, world);
  }
  return agency;
};

// The queued orders an event cites, as it cites them, while they are still
// queued: an id is exact or it is no citation. Citing an order is what makes
// the event its answer; the order's words and the event's are never compared
// to confirm or refuse it.
const withCurrentActionIds = (event, knownActionIds) => {
  const impacts = isPlainObject(event?.impacts) ? event.impacts : null;
  if (!impacts || !Array.isArray(impacts.actionIds)) return null;
  const cited = impacts.actionIds
    .map(normalizeString)
    .filter((id) => id && knownActionIds.has(id));
  return { ...impacts, actionIds: [...new Set(cited)] };
};

// Each event's agency, from what it carries (deriveEventAgency), or an agency
// it already has with its references bound (bindGivenAgency), and its order
// citations held to the orders still queued. An event left without one is
// listed in `unresolved`, with the reason; one that makes a person's country
// choose without that person's word is listed as such (source
// native-unresolved-player), which a shared game refuses.
export const bindWorldEventAuthorityRefs = (candidate, {
  world = {},
  gameCountry = "",
  // A shared game's human polities (runtime/humanPolities.js humanCountriesOf);
  // single player passes none and has only gameCountry.
  humanCountries = [],
  actions = [],
  chats = [],
  resolver: sharedResolver = null,
} = {}) => {
  if (!candidate || typeof candidate !== "object") {
    return { applied: 0, unresolved: [], bindings: [] };
  }

  // A canonical-process agency the event already has takes the one storyline
  // it advances (playerAgencyAuthority.js). Raw model update indexes remain
  // excluded here.
  propagateCanonicalProcessAuthorityRefs(candidate, {
    world,
    includeStorylineUpdates: false,
  });

  // A resolver handed in must already know every human polity (see the screen).
  const resolver = sharedResolver || createWorldActorResolver(world, gameCountry, { humans: otherHumans(gameCountry, humanCountries) });
  const authorities = humanAuthorities({ resolver, gameCountry, humanCountries, actions, chats });
  const knownActionIds = currentActionIds(actions);
  const bindings = [];
  const unresolved = [];
  let applied = 0;

  candidate.events = normalizeArray(candidate?.events).map((event, eventIndex) => {
    if (!isPlainObject(event)) return event;

    const context = { world, resolver, authorities, records: recordsOfEvent(candidate, event, eventIndex) };
    const structureReason = eventAgencyStructureReason(event.agency);
    const given = structureReason ? null : normalizeEventAgency(event.agency);
    let agency = null;
    if (given) {
      agency = bindGivenAgency(event.agency, event, context);
    } else {
      const derived = deriveEventAgency(event, context);
      if (derived.agency) {
        agency = derived.agency;
        applied += 1;
        bindings.push({
          eventIndex,
          rowIndex: -1,
          authority: "native-provenance",
          authorityRef: normalizeString(agency.authorityRef),
          principal: normalizeString(agency.principal),
          source: derived.source,
          reason: derived.reason,
        });
      } else {
        unresolved.push({
          eventIndex,
          rowIndex: -1,
          authority: "native-provenance",
          reason: derived.reason || structureReason || "missing-event-agency",
          source: derived.source || "native-unresolved",
          // The human whose choice it was, when several people play.
          ...(derived.polity ? { polity: derived.polity } : {}),
        });
      }
    }

    const impacts = withCurrentActionIds(event, knownActionIds);
    if (!agency && !impacts) return event;
    return {
      ...event,
      ...(agency ? { agency } : {}),
      ...(impacts ? { impacts } : {}),
    };
  });

  return { applied, unresolved, bindings };
};

const delegatedStructuredSovereignReason = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  for (const key of ["actionIds", "polityChanges", "politicalActorOps", "regionTransfers", "regionClaims", "spyOps"]) {
    if (normalizeArray(impacts?.[key]).length) return `${key} changes sovereign/legal state and cannot be justified by delegated-routine authority`;
  }
  for (const op of normalizeArray(impacts?.unitOps)) {
    const kind = normalizeString(op?.op).toLowerCase();
    if (["spawn", "remove"].includes(kind)) {
      return `unitOps.${kind} creates/removes persistent military capability and requires sovereign or already-authorized process provenance`;
    }
  }
  return "";
};

// Whether a name is one of the world's polities, by any of its names. Such a
// principal is a government, which no non-sovereign authority may stand for.
const namesKnownPolity = (resolver, value) => {
  const name = normalizeString(value).toLowerCase();
  return Boolean(name) && resolver.records.some((record) =>
    [record.canonical, ...normalizeArray(record.aliases)]
      .some((alias) => normalizeString(alias).toLowerCase() === name));
};

// FC5: human control protects fresh sovereign political will, not every event
// inside the country. An agency the event carries may class it as
// delegated-routine or endogenous-domestic; native JS checks whether the event
// actually crosses a sovereign-policy gate before accepting that.
const nonSovereignPlayerActivityReason = (event, agency, { world = {}, resolver, playerCanonical }) => {
  const authority = normalizeString(agency?.authority).toLowerCase();
  if (!["delegated-routine", "endogenous-domestic"].includes(authority)) return "";

  const jurisdiction = resolver.canonical(normalizeString(agency?.jurisdictionPolity));
  if (!jurisdiction) return `${authority} jurisdictionPolity does not resolve to a canonical polity`;
  const principalKind = normalizeString(agency?.principalKind).toLowerCase();
  const principal = normalizeString(agency?.principal);
  if (principalKind === "polity" || namesKnownPolity(resolver, principal)) {
    return `${authority} cannot relabel a sovereign polity/government principal as non-sovereign activity`;
  }
  if (authority === "delegated-routine" && !["domestic-actor", "organization", "person", "institution"].includes(principalKind)) {
    return `delegated-routine principalKind must be domestic-actor, organization, person, or subordinate domestic institution; received ${principalKind || "(blank)"}`;
  }
  if (authority === "delegated-routine" && principalKind === "institution") {
    // `institution` is also the canonical kind used by international/collective
    // institutions elsewhere in the runtime. A domestic ministry, border guard,
    // armed-forces command or similar subordinate state body may execute routine
    // activity inside its jurisdiction, but an international/canonical institution
    // must use its own-right institutional authority path instead of borrowing the
    // human polity's delegated mandate.
    const institution = resolveInstitutionRecord(world, principal);
    if (institution) {
      return "delegated-routine institution principal resolves to a canonical institution; use institutional own-right authority or sovereign provenance instead of a domestic delegated mandate";
    }
  }
  if (authority === "endogenous-domestic" && !["domestic-process", "domestic-actor", "organization", "person"].includes(principalKind)) {
    return `endogenous-domestic principalKind must be domestic-process, domestic-actor, organization, or person; received ${principalKind || "(blank)"}`;
  }

  // What the event carries, not the authority label (nor its wording),
  // decides whether a claimed non-sovereign event is the government's choice.
  if (eventMakesStructuredChoiceFor(event, resolver, jurisdiction)) {
    return `${authority} event lists ${jurisdiction} among its actors or sets its strategy; a non-sovereign label cannot authorize that government's choice or a new international commitment`;
  }
  if (authority === "delegated-routine") {
    const structured = delegatedStructuredSovereignReason(event);
    if (structured) return structured;
  }

  // For the human polity this is the key distinction: jurisdiction says where
  // the activity occurs; it never turns into consent by that sovereign.
  if (playerCanonical && resolver.equivalent(jurisdiction, playerCanonical)) return "";
  return "";
};

const eventAgencyAuthorityReason = (event, {
  world = {},
  gameCountry = "",
  humanCountries = [],
  actions = [],
  chats = [],
  requireAgency = false,
  resolver: sharedResolver = null,
} = {}) => {
  const player = normalizeString(gameCountry);
  if (!player || !event || typeof event !== "object") return "";

  const rawAgency = event?.agency;
  const structureReason = eventAgencyStructureReason(rawAgency);
  if (structureReason) return structureReason;
  if (rawAgency && Object.prototype.hasOwnProperty.call(rawAgency, "sovereignActors")) {
    if (!Array.isArray(rawAgency.sovereignActors)) {
      return "event.agency.sovereignActors must be an array";
    }
    if (rawAgency.sovereignActors.length > EVENT_AGENCY_MAX_SOVEREIGN_ACTORS) {
      return `event.agency.sovereignActors exceeds the native limit of ${EVENT_AGENCY_MAX_SOVEREIGN_ACTORS}`;
    }
    for (const row of rawAgency.sovereignActors) {
      const polity = normalizeString(row?.polity || row?.sovereignPolity);
      const authority = normalizeString(row?.authority).toLowerCase();
      if (!polity) return "each event.agency.sovereignActors row requires a polity";
      if (!EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) {
        return `sovereign actor ${polity} uses invalid authority ${authority || "(blank)"}`;
      }
    }
  }

  const agency = normalizeEventAgency(rawAgency);
  if (!agency) {
    return requireAgency
      ? "event is missing valid structural agency provenance"
      : "";
  }

  const resolver = sharedResolver || createWorldActorResolver(world, player, { humans: otherHumans(player, humanCountries) });
  const authorities = humanAuthorities({ resolver, gameCountry: player, humanCountries, actions, chats });
  const playerCanonical = authorities.primary;
  const sovereignActors = normalizeArray(agency.sovereignActors);

  // Every human polity whose government's own choices (its strategy, how it
  // means to behave) the event's politicalActorOps rewrite. An election, a
  // party's rise or a new leader happens TO a country and needs no order.
  const mutatedHumans = [];
  for (const target of politicalChoiceTargets(event, resolver)) {
    const human = authorities.find(target);
    if (human && !mutatedHumans.includes(human)) mutatedHumans.push(human);
  }
  if (mutatedHumans.length) {
    for (const human of mutatedHumans) {
      const authorizedPlayerRow = sovereignActors.some((row) => {
        const target = resolver.canonical(normalizeString(row?.polity));
        const authority = normalizeString(row?.authority).toLowerCase();
        return Boolean(
          target
          && resolver.equivalent(target, human.canonical)
          && ["player-order", "player-commitment"].includes(authority)
        );
      });
      if (!authorizedPlayerRow) {
        return `politicalActorOps encodes a fresh sovereign-policy choice for the human-controlled polity ${human.canonical} without player-order or player-commitment authority`;
      }
    }
  }

  const nonSovereignReason = nonSovereignPlayerActivityReason(event, agency, { world, resolver, playerCanonical });
  if (nonSovereignReason) return nonSovereignReason;

  if (sovereignActors.length > EVENT_AGENCY_MAX_SOVEREIGN_ACTORS) {
    return `event.agency.sovereignActors exceeds the native limit of ${EVENT_AGENCY_MAX_SOVEREIGN_ACTORS}`;
  }

  if (sovereignActors.length) {
    const seen = new Set();
    const actionsById = currentActionIds(actions);
    const eventActionIds = new Set(
      normalizeArray(event?.impacts?.actionIds).map(normalizeString).filter(Boolean),
    );

    for (const row of sovereignActors) {
      const polity = normalizeString(row?.polity);
      const authority = normalizeString(row?.authority).toLowerCase();
      const authorityRef = normalizeString(row?.authorityRef);
      if (!polity) return "each event.agency.sovereignActors row requires a polity";
      if (!EVENT_AGENCY_SOVEREIGN_AUTHORITIES.includes(authority)) {
        return `sovereign actor ${polity} uses invalid authority ${authority || "(blank)"}`;
      }

      const canonical = resolver.canonical(polity);
      const identityKey = normalizeString(canonical || polity).toLocaleLowerCase();
      if (seen.has(identityKey)) {
        return `event.agency.sovereignActors lists ${canonical || polity} more than once`;
      }
      seen.add(identityKey);

      // Which human this row speaks for, if any: its authority can come only
      // from that human's own orders and messages.
      const human = canonical ? authorities.find(canonical) : null;
      if (authority === "autonomous") {
        if (human) {
          return `${human.canonical} is human-controlled, but event.agency grants it autonomous sovereign authority as a principal, co-signatory, or joint participant without pre-existing player authorization`;
        }
        if (authorityRef) return `autonomous authority for ${canonical || polity} must leave authorityRef blank`;
        continue;
      }

      if (!human) {
        return `${authority} authority is valid only for the human-controlled polity, not ${canonical || polity}`;
      }
      if (!authorityRef) return `${authority} authority for ${human.canonical} requires authorityRef`;

      if (authority === "player-order") {
        if (!actionsById.has(authorityRef)) {
          return `player-order authorityRef "${authorityRef}" does not match a current queued player action`;
        }
        if (!human.actionRecords.some((entry) => entry.id === authorityRef)) {
          return `player-order authorityRef "${authorityRef}" is another player's order, not one ${human.canonical} gave`;
        }
        if (!eventActionIds.has(authorityRef)) {
          return `player-order authorityRef "${authorityRef}" must also appear in impacts.actionIds`;
        }
      } else if (!human.commitmentIds.has(authorityRef)) {
        return `player-commitment authorityRef "${authorityRef}" does not match an existing player-authored diplomatic message`;
      }
    }

    return "";
  }

  if (["delegated-routine", "endogenous-domestic"].includes(agency.authority)) {
    if (agency.sovereignPolity || sovereignActors.length) {
      return `${agency.authority} is non-sovereign provenance and must leave sovereignPolity blank and sovereignActors empty`;
    }
    if (agency.authorityRef) return `${agency.authority} must leave authorityRef blank`;
    return "";
  }

  if (["independent", "external-consequence"].includes(agency.authority) && agency.sovereignPolity) {
    return `${agency.authority} authority cannot exercise sovereignPolity; use autonomous/player-order/canonical-process when a sovereign state is actually making the choice`;
  }

  if (["autonomous", "independent"].includes(agency.authority)) {
    if (agency.authority === "independent" && agency.principalKind === "collective-process"
        && actorPolities(event, resolver).length >= 2) {
      return "independent collective-process provenance cannot disguise a commitment its listed actors chose together";
    }
    // Own-right discretion is not confined to sovereign governments. Membership
    // in a collective institution is NOT a fresh choice by every member state.
    // Conversely, relabeling a known government as a private actor grants nothing.
    if (agency.principalKind === "polity" || namesKnownPolity(resolver, agency.principal)) {
      return `${agency.authority} authority for a polity requires at least one sovereignActors row`;
    }
    if (agency.principalKind === "exogenous-process") {
      return "a non-discretionary process requires canonical-process or external-consequence authority";
    }
    if (agency.authorityRef) return `${agency.authority} own-right authority must leave authorityRef blank`;
    if (agency.principalKind === "institution") {
      const institution = resolveInstitutionAuthorityPrincipal(world, agency.principal);
      if (!institution) {
        return "institutional own-right authority requires one unambiguous active canonical institution principal; membership alone grants no sovereign authority";
      }
    }
    return "";
  }

  if (agency.authority === "external-consequence" && agency.principalKind !== "exogenous-process") {
    return "external-consequence requires a non-discretionary exogenous-process principal, not a disguised actor decision";
  }

  if (agency.authority === "player-order") {
    return "player-order authority requires a sovereignActors row for the human-controlled polity";
  }

  if (agency.authority === "player-commitment") {
    return "player-commitment authority requires a sovereignActors row for the human-controlled polity";
  }

  if (agency.authority === "canonical-process") {
    // A pre-existing process can own a consequence, but it cannot be cited as a
    // magic permission token for a fresh sovereign decision. If sovereign
    // discretion is still being exercised, the event must use the corresponding
    // sovereign authority (autonomous for AI polities, player-order/commitment for
    // the human polity). Process consequences therefore carry no sovereignPolity.
    if (agency.sovereignPolity || sovereignActors.length) {
      return "canonical-process authority represents an already-authorized consequence and must leave sovereignPolity blank and sovereignActors empty; it cannot grant fresh sovereign discretion";
    }
    const ref = normalizeString(agency.authorityRef);
    if (!ref) return "canonical-process authority requires authorityRef";
    if (!canonicalProcessIds(world).has(ref)) {
      return `canonical-process authorityRef "${ref}" is not an already-existing active canonical storyline/project/war/order/institution resolution`;
    }
    return "";
  }

  // independent and external-consequence are deliberately valid only when they
  // do not borrow sovereign authority. Their effects may still affect the player;
  // target/effect is not decision ownership.
  return "";
};

export const playerAgencyViolationReason = (event, options = {}) =>
  eventAgencyAuthorityReason(event, { ...options, requireAgency: false });


// Whether an event is the player's sphere's or the wider world's: the
// player's when it says it concerns the player (playerRelated) or its
// structured fields name a player-sphere polity, the wider world's when they
// name others, unknown when they name none. Its words are never searched for a
// name.
export const createWorldEventScopeClassifier = (
  analysis = null,
  { world = {}, gameCountry = "", resolver: sharedResolver = null } = {},
) => {
  // Build identity provenance ONCE for the bounded visible batch. Never recreate
  // the 4k+ region alias index once per event; that is the exact class of hotpath
  // R3.2 removed from the World Director.
  const resolver = sharedResolver || createWorldActorResolver(world, gameCountry);
  const playerActors = uniqueStrings([
    gameCountry,
    ...normalizeArray(analysis?.explorationSlate)
      .filter((slot) => slot?.scope === "player-sphere" && slot?.type === "actor-domain")
      .map((slot) => slot?.actor),
  ])
    .map((actor) => resolver.canonical(actor))
    .filter(Boolean);

  return (event) => {
    if (!event || typeof event !== "object") return "unknown";
    if (event?.playerRelated === true) return "player-sphere";

    const actors = eventPartyPolities(event, resolver);

    if (
      actors.some((actor) =>
        playerActors.some((sphereActor) => resolver.equivalent(actor, sphereActor))
      )
    ) {
      return "player-sphere";
    }

    return actors.length ? "wider-world" : "unknown";
  };
};

// The native verdicts that mean the world made a person's own sovereign
// choice: their country is among the event's choosers (its actors, a party to
// an agreement it starts, the side that starts or joins a war by it, a
// government whose strategy it rewrites) and neither an order nor a message of
// theirs backs it. A shared game refuses such an event
// (HUMAN_SOVEREIGN_REFUSALS). Single player only logs it, marked
// wouldWithhold, and keeps it: the player has only themselves to answer to.
const PLAYER_SOVEREIGN_CHOICE_VERDICTS = new Set([
  "player-fresh-sovereign-choice-without-authority",
  "joint-player-sovereign-choice-without-authority",
]);

const playerSovereignChoiceReason = (event, verdict, actions) => {
  if (!PLAYER_SOVEREIGN_CHOICE_VERDICTS.has(normalizeString(verdict?.reason))) return "";
  // An event citing a queued order is the model's answer to something the
  // player asked for; dropping it would carry the order over as overdue.
  const queued = currentActionIds(actions);
  if (normalizeArray(event?.impacts?.actionIds).some((id) => queued.has(normalizeString(id)))) return "";
  return `${verdict.reason}: the human-controlled polity makes a fresh sovereign choice that no queued order or player-authored message authorizes`;
};

// The reasons the binder gives when an event makes a human polity's own
// sovereign choice without that human's order or message: the boundary a
// shared game holds hard (screenGeneratedWorldEvents).
export const HUMAN_SOVEREIGN_REFUSALS = Object.freeze([...PLAYER_SOVEREIGN_CHOICE_VERDICTS]);
const HUMAN_SOVEREIGN_REFUSAL_SET = new Set(HUMAN_SOVEREIGN_REFUSALS);

// The screen of one segment's events before they join the round: each event's
// agency from what it carries (bindWorldEventAuthorityRefs), a person's
// country held to that person's own word in a shared game, an agency the
// authority check refuses withheld, and two sanitizers of operations that
// would change nothing (a duplicate update of one polity, a contest the map
// already has). Nothing is kept off the timeline for its words: `hidden`
// stays empty, for the callers that hand hidden events to the Board.
export const screenGeneratedWorldEvents = ({
  events = [],
  world = {},
  game = {},
  actions = [],
  chats = [],
  analysis = null,
  // The segment's records, bound to its events by id: the parties of a treaty
  // an event starts and the side that starts or joins a war by it are who
  // made that choice, and every party of a record tied to it, relations
  // included, is someone it commits its choosers to.
  agreementUpdates = [],
  warUpdates = [],
  relationUpdates = [],
} = {}) => {
  const kept = [];
  const dropped = [];
  let mergedDuplicatePolityUpdates = 0;
  let strippedNoOpRegionControlOps = 0;
  // What native provenance concluded about each event that involves the player
  // without authority, enforced or not: the console trail for tuning the rule.
  const playerVerdicts = [];
  // The polities people play (runtime/humanPolities.js). Single player keeps an
  // event it cannot attribute, as it always has; a shared game holds the human
  // boundary hard, so one person's orders never make another's country choose.
  const humanCountries = humanCountriesOf(game);
  const sharedGame = humanCountries.length > 1;
  // One identity index for the whole batch: every check below reads it. It
  // knows every human polity of a shared game.
  const resolver = createWorldActorResolver(world, normalizeString(game?.country), {
    humans: otherHumans(game?.country, humanCountries),
  });

  for (const original of normalizeArray(events)) {
    const lineageSanitized = sanitizeDuplicatePolityUpdates(original, world);
    mergedDuplicatePolityUpdates += lineageSanitized.merged;

    const controlSanitized = sanitizeNoOpRegionControlOps(
      lineageSanitized.event,
      world,
    );
    strippedNoOpRegionControlOps += controlSanitized.removed;

    const eventId = normalizeString(controlSanitized.event?.id);
    const tiedTo = (updates) => (eventId
      ? normalizeArray(updates)
        .filter((update) => normalizeArray(update?.eventIds).map(normalizeString).includes(eventId))
        .map((update) => ({ ...update, eventIndexes: [] }))
      : []);
    const eventWrapper = {
      events: [controlSanitized.event],
      agreementUpdates: tiedTo(agreementUpdates),
      warUpdates: tiedTo(warUpdates),
      relationUpdates: tiedTo(relationUpdates),
    };
    const binding = bindWorldEventAuthorityRefs(eventWrapper, {
      world,
      gameCountry: normalizeString(game?.country),
      humanCountries,
      actions,
      chats,
      resolver,
    });
    const event = eventWrapper.events[0];

    const playerVerdict = binding.unresolved.find((row) => row.source === "native-unresolved-player");
    if (playerVerdict) {
      playerVerdicts.push({
        id: normalizeString(event?.id),
        title: normalizeString(event?.title),
        reason: playerVerdict.reason,
        wouldWithhold: Boolean(playerSovereignChoiceReason(event, playerVerdict, actions)),
      });
    }

    const refusal = sharedGame
      ? binding.unresolved.find((entry) => entry.rowIndex === -1 && HUMAN_SOVEREIGN_REFUSAL_SET.has(entry.reason))
      : null;
    const agencyReason = refusal
      ? `${refusal.polity || "a human-controlled polity"} is played by a person, and only its own orders and messages make its government's choices`
      : eventAgencyAuthorityReason(event, {
        world,
        gameCountry: normalizeString(game?.country),
        humanCountries,
        actions,
        chats,
        requireAgency: false,
        resolver,
      });
    if (agencyReason) {
      dropped.push({
        id: normalizeString(event?.id),
        title: normalizeString(event?.title),
        route: "PLAYER_AGENCY_AUTHORITY",
        reason: agencyReason,
      });
      continue;
    }

    kept.push(event);
  }

  if (playerVerdicts.length) {
    console.info(
      `[OH Native Event Provenance v${NATIVE_EVENT_PROVENANCE_VERSION}] player-agency verdicts:`,
      playerVerdicts,
    );
  }

  const result = {
    events: kept,
    dropped,
    hidden: [],
    mergedDuplicatePolityUpdates,
    strippedNoOpRegionControlOps,
    playerVerdicts,
    analysisVersion:
      normalizeString(analysis?.version) ||
      WORLD_INTEGRITY_VERSION,
  };

  if (
    dropped.length ||
    mergedDuplicatePolityUpdates ||
    strippedNoOpRegionControlOps
  ) {
    console.info(
      `[OH Native World Integrity v${WORLD_INTEGRITY_VERSION}] ` +
      `kept ${result.events.length}/${normalizeArray(events).length} generated event(s); ` +
      `dropped ${dropped.length}, ` +
      `merged ${mergedDuplicatePolityUpdates} duplicate polity update(s), ` +
      `stripped ${strippedNoOpRegionControlOps} no-op control op(s).`,
      result,
    );
  }

  return result;
};

const installDebugApi = () => {
  if (typeof globalThis === "undefined") return;

  // Only the version: the screen's regression cases run under node --test
  // (nativeWorldIntegrity.test.js), not in every player's bundle.
  globalThis.__OH_NATIVE_WORLD_INTEGRITY__ = {
    version: WORLD_INTEGRITY_VERSION,
  };
};

installDebugApi();
