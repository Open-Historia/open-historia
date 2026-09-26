import { buildCompactEconomicContext, isCompleteCountryStatSheet } from "../../runtime/countryStats.js";
import { buildBoundedDiplomaticContext } from "./nativeDiplomaticDirector.js";
import { trimWorldForFocus } from "./playerFocus.js";
import {
  buildNativeWorldExplorationSlate,
  deriveWorldTrajectoryValue,
  deferredStorylineReentryHasConcreteTrigger,
  latestCanonicalWorldEventDate,
  worldIntegrityAgeDays,
  worldActorsEquivalent,
  canonicalWorldActor,
  createWorldActorResolver,
} from "./nativeWorldIntegrity.js";
import { addGameDays, compareGameDates, gameDateDayNumber, gameDateYear } from "../../runtime/gameDates.js";
import { polityRoleOf } from "../../../server/polityRole.js";
import { boardEntriesConcernedByEvent, isProjectOpen } from "../../runtime/projects.js";

// Native World Director (ported from kernely's Continuum branch).
//
// Phase 6B.2: bounded multi-pass world initiative + fair persistent storyline attention.
//
// This module does NOT call AI and does NOT decide what history "must" happen.
// It only builds a bounded, current-state-first ledger so the expensive world
// simulation starts from THIS campaign instead of from the model's memorized
// historical calendar.
//
// Performance contract:
// - no network reads
// - no polling
// - one-pass territorial identity scan; never nested per-region alias rebuilds
// - recent history only
// - bounded candidate count
// - O(recent events + recent chats + a tiny bounded world-state sample)

export const DIPLOMATIC_STATE_HEADING = "Diplomatic state (the relevant slice of the ledger):";

export const WORLD_DIRECTOR_VERSION = "0.13.1-crisis-seam-repair";

const DEFAULT_MAX_CANDIDATES = 10;
const RECENT_EVENT_WINDOW = 56;
const RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS = 180;
const RECENT_CHAT_WINDOW = 16;
const CONSOLIDATED_HISTORY_WINDOW = 6;
const TERRITORIAL_SAMPLE_LIMIT = 8;
const ACTIVE_UNIT_SAMPLE_LIMIT = 6;
const MAX_ATTENTION_STORYLINES = 8;
const MAX_PERSISTED_STORYLINES = 96;
const MAX_DEFERRED_STORYLINE_HINTS = 16;
const MAX_ECONOMIC_ACTORS = 8;
const CANDIDATE_STORYLINE_REPEAT_PENALTY = 4;
const CANDIDATE_TYPE_REPEAT_PENALTY = 0.75;
const CANDIDATE_TRAJECTORY_WEIGHT = 1.6;
const RECENT_VISIBLE_EVENT_PENALTY_DAYS = Object.freeze([
  [21, 6],
  [45, 3],
  [75, 1],
]);

// 08.3.1 — consequence-aware liveness calibration. This is a SIGNAL, not a new
// subsystem and not an event quota. The same World Director / composition path
// uses it to notice when a busy rolling timeline has become almost entirely
// incremental. Javascript measures the recent canon; the model still decides
// whether any mature pressure has actually crossed a threshold.
const CONSEQUENCE_LOOKBACK_DAYS = 90;
const CONSEQUENCE_MIN_VISIBLE_EVENTS = 8;
const STRATEGIC_CONSEQUENCE_RE =
  /\b(annex(?:es|ed|ation)?|incorporat(?:e|es|ed|ion)|cede[sd]?|cession|independence|proclaim(?:s|ed)?\s+(?:the\s+)?(?:republic|kingdom|state|government)|abdica(?:te|tes|ted|tion)|resign(?:s|ed|ation)|assassinat(?:e|es|ed|ion)|coup|revolution|uprising|rebellion|mutiny|surrender(?:s|ed)?|armistice|ceasefire|peace treaty|declares? war|declaration of war|joins? (?:the )?war|withdraw(?:s|al)? from (?:the )?war|capture(?:s|d)?|seiz(?:e|es|ed)|occup(?:y|ies|ied)|liberat(?:e|es|ed)|breakthrough|government falls?|cabinet resign(?:s|ed)?|election results?|elected president|elected prime minister|ratif(?:y|ies|ied|ication)|signs? (?:a |the )?(?:treaty|pact|accord|agreement)|treaty (?:is )?(?:signed|concluded|ratified)|strike (?:begins|erupts|ends)|calls? off .*strike|bank(?:ing)? panic|financial crash|defaults? on|bankruptcy|martial law|state of emergency|mobiliz(?:e|es|ed|ation)|reserve(?:s)? (?:called|mobilized|activated)|calls? up (?:the )?reserves|force concentration|troop buildup|ultimatum|blockade|nuclear alert|combat alert|evacuat(?:e|es|ed|ion)|border closure|airspace closure|martial law)\b/i;
const HARD_MILITARY_CONSEQUENCE_RE =
  /\b(capture(?:s|d)?|seiz(?:e|es|ed)|occup(?:y|ies|ied)|liberat(?:e|es|ed)|retreat(?:s|ed)?|withdraw(?:s|n|al)?|surrender(?:s|ed)?|ceasefire|armistice|breakthrough|encircl(?:e|es|ed)|destroy(?:s|ed)?|defeat(?:s|ed)?|repuls(?:e|es|ed)|casualt(?:y|ies)|killed|wounded|front collapses?)\b/i;

const STORYLINE_ESCALATION_OR_FAILURE_RE =
  /\b(?:without agreement|fail(?:s|ed|ure|ing)?|break(?:s|ing)? down|collapse(?:s|d)?|walk(?:s|ed)? out|reject(?:s|ed|ion)?|renewed? warnings?|threat(?:s|en|ened|ening)?|ultimatum|missile test|weapons? test|mobiliz(?:e|es|ed|ation)|call(?:s|ed)? up (?:the )?reserves|reserve activation|force concentration|troop buildup|deploy(?:s|ed|ment)|dispers(?:e|es|ed|al)|combat alert|nuclear alert|border incident|airspace violation|blockade|sanction(?:s|ed)?|retaliat(?:e|es|ed|ion)|strike|attack|clash(?:es)?|warning shots?|sabotage|covert operation)\b/i;

const STORYLINE_DEESCALATION_RE =
  /\b(?:agreement reached|deal reached|ceasefire|armistice|stand(?:s|ing)? down|de[- ]?escalat(?:e|es|ed|ion)|demobiliz(?:e|es|ed|ation)|withdraw(?:s|n|al|ing)?|pulls? back|redeploys? away|sanctions? relief|lifts? sanctions?|reopens? talks|resumes? talks|confidence[- ]building|hotline established|inspection agreement|mediation succeeds?|accepts? mediation|restraint agreement|moratorium|suspends? (?:the )?(?:test|exercise|deployment))\b/i;


const UNRESOLVED_CRISIS_CUE_RE =
  /\b(?:crisis|standoff|showdown|deadlock|without agreement|talks? (?:fail|collapse|break down)|missile test|nuclear test|nuclear alert|mobiliz(?:e|es|ed|ation)|reserve call[- ]?up|ultimatum|blockade|border clash|border incident|incursion|airspace violation|coup attempt|mutiny|uprising|rebellion|insurgency|mass protest|general strike|nationwide strike|state of emergency|martial law|banking panic|currency crash|financial panic|government crisis|constitutional crisis|secession crisis|separatist crisis|military confrontation|armed confrontation)\b/i;

const CRISIS_RESOLUTION_CUE_RE =
  /\b(?:crisis (?:ends|resolved)|agreement reached|deal reached|peace agreement|ceasefire|armistice|settlement reached|stands? down|de[- ]?escalat(?:e|es|ed|ion)|demobiliz(?:e|es|ed|ation)|coup (?:fails|is defeated|collapses)|uprising (?:ends|is defeated|is suppressed)|strike (?:ends|is called off)|government restored|constitutional settlement|stabilization package succeeds?|withdraw(?:s|n|al)|lifts? blockade)\b/i;

const ROUTINE_ADMINISTRATIVE_PROCESS_RE =
  /\b(?:technical review|committee review|working group|administrative implementation|implementation review|compliance review|compliance tracking|inspection protocol|inspection standards|regulatory harmonization|protocol refinement|procedural update|standards update|report(?:s|ed)? (?:on|its)|publishes? (?:a )?(?:review|assessment|report)|issues? (?:a )?(?:review|assessment|report)|streamlined (?:procedures|protocols|standards)|finaliz(?:e|es|ed) (?:technical|administrative|inspection|compliance|procedural|regulatory)|monitoring framework|coordination mechanism|advisory committee)\b/i;

const HUMAN_TEXTURE_RE =
  /\b(?:festival|funeral|wedding|ceremony|sport|football|university|concert|film|literature|art|scandal|accident|disaster|storm|flood|earthquake|wildfire|public mourning|popular craze|public celebration|scientific discovery|record broken)\b/i;

const ESCALATION_LADDER = Object.freeze([
  {
    maxPressure: 34,
    id: "background-pressure",
    label: "background pressure",
    guidance: "signaling, political hardening, diplomatic warnings, intelligence activity, limited sanctions, contingency planning",
  },
  {
    maxPressure: 54,
    id: "coercive-friction",
    label: "coercive friction",
    guidance: "sanctions escalation, exercises, military signaling, covert pressure, alliance consultations, domestic emergency preparation",
  },
  {
    maxPressure: 69,
    id: "confrontation",
    label: "confrontation",
    guidance: "reserve alerts/call-ups, force dispersal, forward deployments, border or airspace restrictions, explicit ultimatums, logistics preparation, evacuation planning",
  },
  {
    maxPressure: 84,
    id: "pre-conflict-brinkmanship",
    label: "pre-conflict brinkmanship",
    guidance: "mobilization, major force concentration, combat alerts, emergency powers, blockade preparation, reciprocal deployments, dangerous interceptions/incidents, alliance activation",
  },
  {
    maxPressure: 100,
    id: "breakpoint",
    label: "breakpoint",
    guidance: "limited strikes, incursions, blockades, direct clashes, attempted faits accomplis, or canonical war when the native belligerency threshold is actually crossed; rapid de-escalation remains possible",
  },
]);

export const worldStorylineEscalationPosture = (storyline = {}) => {
  const pressure = clampPercent(storyline?.pressure);
  const momentum = clampPercent(storyline?.momentum);
  const band = ESCALATION_LADDER.find((entry) => pressure <= entry.maxPressure)
    || ESCALATION_LADDER.at(-1);
  const momentumNote =
    momentum >= 70
      ? "Momentum is high: near-term movement should be expected unless a concrete blocker or reversal intervenes."
      : momentum >= 50
        ? "Momentum is active: compare escalation and de-escalation branches rather than defaulting to stasis."
        : momentum <= 20
          ? "Momentum is low: pressure may stay dangerous while actors pause, reorganize, or seek an off-ramp."
          : "Momentum is moderate: either movement or a justified pause is plausible.";

  return {
    id: band.id,
    label: band.label,
    pressure,
    momentum,
    guidance: band.guidance,
    momentumNote,
  };
};


const HOSTILE_RELATION_STATUS_RE =
  /\b(hostile|enemy|adversarial|rival|severe|confrontational|very tense|crisis)\b/i;
const DEFENSE_COUPLING_RE =
  /\b(alliance|defen[cs]e|mutual assistance|guarantee|security pact|collective security)\b/i;
const SYSTEMIC_ESCALATION_CUE_RE =
  /\b(mobiliz(?:e|es|ed|ation)|reserve call[- ]?up|ultimatum|blockade|invasion|incursion|border clash|armed clash|direct clash|combat alert|nuclear alert|force concentration|troop buildup|forward deploy(?:ment|ed)|airspace closure|border closure|missile test|nuclear test|failed talks|talks? collapse|ceasefire collapse|coup attempt|mutiny|uprising|secession)\b/i;
const CRISIS_LIKE_STORYLINE_KIND_RE =
  /\b(war|crisis|revolution|uprising|insurgency|secession|standoff|security|constitutional|succession|financial|banking)\b/i;

// R3.5 — campaign-state conflict propensity.
//
// This is NOT a probability roll and the date never decides whether war happens.
// The era supplies only a modest prior. Current campaign evidence — active wars,
// crisis pressure/momentum, hostile relations, alliance coupling, territorial
// claims and fresh escalation signals — does the heavy lifting. This lets a 1914
// start naturally tolerate much higher war risk while a stable 2020 remains more
// restrained, without creating either "1914 must go to war" or "2020 cannot" rules.
export const deriveWorldConflictRiskPosture = ({
  bundle,
  targetDate = "",
  causalCandidates = [],
} = {}) => {
  const world = bundle?.world || {};
  const date = normalizeString(targetDate || bundle?.game?.gameDate);
  // Signed: 218 BC is -218, so an ancient scenario takes the unknown-era prior.
  const year = gameDateYear(date);

  let eraAdjustment = 0;
  let eraLabel = "unknown-era neutral prior";
  if (Number.isInteger(year)) {
    if (year >= 1870 && year <= 1945) {
      eraAdjustment = 18;
      eraLabel = "mass-mobilization / imperial great-power era: substantially higher baseline interstate-war friction";
    } else if (year >= 1946 && year <= 1991) {
      eraAdjustment = -3;
      eraLabel = "nuclear-deterrence / bloc-competition era: direct great-power war constrained, proxy and peripheral conflict remain plausible";
    } else if (year >= 1992) {
      eraAdjustment = -8;
      eraLabel = "post-Cold-War institutional era: lower baseline interstate-war prior, not immunity from war";
    } else if (year >= 1815) {
      eraAdjustment = 8;
      eraLabel = "pre-mass-war balance-of-power era: moderately elevated interstate-war prior";
    } else {
      eraAdjustment = 10;
      eraLabel = "pre-modern/early-modern interstate system: war is a relatively normal policy instrument when capabilities and causes support it";
    }
  }

  const activeWars = normalizeArray(world?.wars).filter((war) =>
    ["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())
  );

  let crisisPressure = 0;
  let highMomentumProcesses = 0;
  for (const storyline of normalizeArray(world?.storylines)) {
    if (normalizeString(storyline?.status).toLowerCase() !== "active") continue;
    if (!CRISIS_LIKE_STORYLINE_KIND_RE.test(normalizeString(storyline?.kind))) continue;
    const pressure = clampPercent(storyline?.pressure);
    const momentum = clampPercent(storyline?.momentum);
    crisisPressure += Math.max(0, pressure - 40) * 0.22;
    if (momentum >= 60) highMomentumProcesses += 1;
  }

  const hostileRelations = normalizeArray(world?.relations).filter((relation) =>
    HOSTILE_RELATION_STATUS_RE.test(normalizeString(
      relation?.status || relation?.state || relation?.summary,
    ))
  ).length;

  const defenseCoupling = normalizeArray(world?.agreements).filter((agreement) => {
    const status = normalizeString(agreement?.status).toLowerCase();
    if (["ended", "expired", "terminated", "suspended"].includes(status)) return false;
    return DEFENSE_COUPLING_RE.test(normalizeString(
      `${agreement?.type || ""} ${agreement?.title || ""} ${agreement?.terms || ""}`,
    ));
  }).length;

  const contestedRegions = Object.values(world?.regionClaimants || {})
    .filter((claimants) => normalizeArray(claimants).length > 0)
    .length;

  const escalationSignals = normalizeArray(causalCandidates).filter((candidate) =>
    SYSTEMIC_ESCALATION_CUE_RE.test(
      `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`,
    )
  ).length;

  const structural =
    Math.min(18, activeWars.length * 8) +
    Math.min(24, crisisPressure) +
    Math.min(8, highMomentumProcesses * 3) +
    Math.min(12, hostileRelations * 3) +
    Math.min(8, defenseCoupling * 1.5) +
    Math.min(10, contestedRegions * 1.25) +
    Math.min(15, escalationSignals * 3);

  const score = Math.max(0, Math.min(100, Math.round(18 + structural + eraAdjustment)));
  const posture = score >= 70
    ? {
        id: "acute",
        label: "acute systemic conflict risk",
        guidance: "direct clashes and new wars are plausible if actors cross a concrete threshold; do not skip the mobilization/diplomatic/operational causes that make that threshold real",
      }
    : score >= 50
      ? {
          id: "elevated",
          label: "elevated conflict risk",
          guidance: "coercion, mobilization, alliance activation, dangerous incidents and limited clashes deserve serious consideration; war is possible but still requires a causal crossing",
        }
      : score >= 30
        ? {
            id: "guarded",
            label: "guarded conflict risk",
            guidance: "new crises and coercive escalation are plausible, but direct interstate war should normally require accumulating pressure, a severe trigger, miscalculation or deliberate high-risk choice",
          }
        : {
            id: "low",
            label: "low systemic conflict risk",
            guidance: "new interstate war should be exceptional without a threshold shock; political, economic, constitutional, separatist, diplomatic and security crises can still form and develop with real consequences",
          };

  return {
    ...posture,
    score,
    year,
    eraAdjustment,
    eraLabel,
    drivers: {
      activeWars: activeWars.length,
      hostileRelations,
      defenseCoupling,
      contestedRegions,
      escalationSignals,
      highMomentumProcesses,
      crisisPressure: Math.round(crisisPressure * 10) / 10,
    },
  };
};

const linkedRecordTouchesEvent = (records, eventIndex) =>
  normalizeArray(records).some((entry) =>
    normalizeArray(entry?.eventIndexes).some((value) => Number(value) === eventIndex)
  );

const eventCanonicalConsequenceChannels = (candidate, eventIndex) => {
  const event = normalizeArray(candidate?.events)[eventIndex];
  if (!event || typeof event !== "object") return [];

  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const channels = [];

  for (const field of [
    "regionTransfers",
    "regionClaims",
    "regionControlOps",
    "polityChanges",
    "politicalActorOps",
    "createdChats",
    "unitOps",
    "markerOps",
  ]) {
    if (normalizeArray(impacts[field]).length) channels.push(`impacts.${field}`);
  }

  if (normalizeArray(event?.storylineIds).length) channels.push("storyline");
  if (normalizeString(event?.warId)) channels.push("war-event");

  if (linkedRecordTouchesEvent(candidate?.storylineUpdates, eventIndex)) channels.push("storyline-update");
  if (linkedRecordTouchesEvent(candidate?.warUpdates, eventIndex)) channels.push("war-update");
  if (linkedRecordTouchesEvent(candidate?.relationUpdates, eventIndex)) channels.push("relation-update");
  if (linkedRecordTouchesEvent(candidate?.agreementUpdates, eventIndex)) channels.push("agreement-update");
  if (linkedRecordTouchesEvent(candidate?.countryStatPatches, eventIndex)) channels.push("stats");

  return [...new Set(channels)];
};

const eventLooksStrategicallyMajor = (event) => {
  if (!event || typeof event !== "object") return false;
  const importance = normalizeString(event?.importance).toLowerCase();
  if (importance !== "major" && event?.notable !== true) return false;
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  return STRATEGIC_CONSEQUENCE_RE.test(text)
    || STORYLINE_ESCALATION_OR_FAILURE_RE.test(text)
    || UNRESOLVED_CRISIS_CUE_RE.test(text)
    || normalizeString(event?.kind).toLowerCase() === "military";
};

const eventLooksLikeUnresolvedCrisis = (event) => {
  if (!eventLooksStrategicallyMajor(event)) return false;
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  if (!UNRESOLVED_CRISIS_CUE_RE.test(text)) return false;
  return !CRISIS_RESOLUTION_CUE_RE.test(text);
};

const eventLooksLikeRoutineAdministrativeCard = (event) => {
  if (!event || typeof event !== "object") return false;
  if (event?.playerRelated === true) return false;
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  if (normalizeArray(impacts?.actionIds).length) return false;

  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  return ROUTINE_ADMINISTRATIVE_PROCESS_RE.test(text)
    && !STRATEGIC_CONSEQUENCE_RE.test(text)
    && !STORYLINE_ESCALATION_OR_FAILURE_RE.test(text)
    && !HUMAN_TEXTURE_RE.test(text);
};

// A major event whose only consequence is a Board entry. The Board is not a
// channel the jump can write — the board pass records it after the segments —
// so such an event passes the check PROVISIONALLY: the engine's own matcher says
// it concerns an open Board entry, and the turn must later see the board pass
// materially change a Board entry because of it, or the event is kept off the
// timeline. "Probably about Westbird" is never taken for "Westbird changed".
// A crisis is not eligible: a crisis is a Storyline by definition.
const eventRestsOnBoardConsequence = (candidate, index, board, playerCountry) => {
  const event = normalizeArray(candidate?.events)[index];
  if (!eventLooksStrategicallyMajor(event) || eventLooksLikeUnresolvedCrisis(event)) return false;
  if (eventCanonicalConsequenceChannels(candidate, index).length) return false;
  return boardEntriesConcernedByEvent(event, board, { playerCountry }).length > 0;
};

export const boardProvisionalConsequenceIndexes = (candidate, { board = [], playerCountry = "" } = {}) =>
  normalizeArray(candidate?.events)
    .map((_, index) => index)
    .filter((index) => eventRestsOnBoardConsequence(candidate, index, board, playerCountry));

export const validateWorldEventConsequencePayload = (
  candidate,
  {
    selectedStorylines = [],
    strict = true,
    board = [],
    playerCountry = "",
  } = {},
) => {
  if (!strict) return "";
  const events = normalizeArray(candidate?.events);

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const channels = eventCanonicalConsequenceChannels(candidate, index);

    if (eventLooksLikeUnresolvedCrisis(event) && !channels.some((value) => value.startsWith("storyline"))) {
      return `Major unresolved crisis event ${index + 1} ("${normalizeString(event?.title)}") has no persistent storyline consequence. Create/update the canonical storyline for the unresolved process and link this event; do not let a multi-turn crisis vanish after one card.`;
    }

    if (
      eventLooksStrategicallyMajor(event) &&
      channels.length === 0 &&
      !eventRestsOnBoardConsequence(candidate, index, board, playerCountry)
    ) {
      const boardOwner = normalizeArray(board).some(isProjectOpen) ? ", a Board entry named exactly as the Board names it" : "";
      return `Strategically major event ${index + 1} ("${normalizeString(event?.title)}") has no canonical consequence at all. Keep the event only if something materially changes in an existing owner (storyline, Stats, relations, agreements, units, war, territory/control, polity metadata, markers${boardOwner}, or a created diplomatic chat); otherwise downgrade/drop the card instead of narrating a consequence-free crisis.`;
    }
  }

  if (events.length >= 4) {
    const adminIndexes = events
      .map((event, index) => ({ event, index }))
      .filter(({ event, index }) =>
        eventLooksLikeRoutineAdministrativeCard(event)
        && eventCanonicalConsequenceChannels(candidate, index).length === 0
      )
      .map(({ index }) => index);

    const adminThreshold = Math.max(3, Math.ceil(events.length * 0.6));
    if (adminIndexes.length >= adminThreshold) {
      const selectedHighPressure = normalizeArray(selectedStorylines)
        .some((storyline) =>
          normalizeString(storyline?.status).toLowerCase() === "active"
          && clampPercent(storyline?.pressure) >= HIGH_PRESSURE_STAGNATION_THRESHOLD
        );
      return `World pass is dominated by ${adminIndexes.length}/${events.length} low-consequence administrative cards${selectedHighPressure ? " while a high-pressure process is active" : ""}. Re-search the same causal world for fewer, stronger outcomes (political decisions/failures, escalation or de-escalation, strikes/unrest, deployments/mobilization, market shocks, leadership change, diplomatic rupture/agreement, concrete capability changes, or human/public texture). Do not invent chaos; do not spend most visible slots on process paperwork.`;
    }
  }

  return "";
};

const eventConsequenceScore = (event) => {
  if (!event || typeof event !== "object") return 0;
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  const text = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
  let score = 0;

  if (normalizeArray(impacts.regionTransfers).length) score += 5;
  if (normalizeArray(impacts.regionClaims).length) score += 4;
  if (normalizeArray(impacts.regionControlOps).length) score += 4;
  if (normalizeArray(impacts.polityChanges).length) score += 4;
  if (normalizeArray(impacts.politicalActorOps).length) score += 4;

  const unitOps = normalizeArray(impacts.unitOps);
  if (unitOps.some((op) => ["remove"].includes(normalizeString(op?.op).toLowerCase()))) score += 3;
  if (normalizeString(event?.warId) && HARD_MILITARY_CONSEQUENCE_RE.test(text)) score += 3;
  if (STRATEGIC_CONSEQUENCE_RE.test(text)) score += 3;

  // Major events with a concrete durable map/capability object are meaningful,
  // but ordinary administrative completions do not become "strategic thresholds"
  // merely because they contain the word completed.
  if (normalizeString(event?.importance).toLowerCase() === "major") score += 1;
  if (normalizeArray(impacts.markerOps).length && normalizeString(event?.importance).toLowerCase() === "major") score += 1;

  return score;
};

export const assessRecentWorldConsequenceLiveness = ({
  events = [],
  additionalEvents = [],
  referenceDate = "",
  lookbackDays = CONSEQUENCE_LOOKBACK_DAYS,
} = {}) => {
  const reference = parseIsoDate(referenceDate);
  if (reference == null) {
    return { level: "unknown", eventCount: 0, consequentialCount: 0, lookbackDays, examples: [] };
  }

  const seen = new Set();
  const recent = [];
  for (const event of [...normalizeArray(events), ...normalizeArray(additionalEvents)]) {
    const date = parseIsoDate(event?.date);
    if (date == null || date > reference) continue;
    const age = Math.max(0, Math.round((reference - date) / 86400000));
    if (age > lookbackDays) continue;
    const key = normalizeString(event?.id) || `${normalizeString(event?.date)}|${normalizeString(event?.title).toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recent.push(event);
  }

  const consequential = recent
    .map((event) => ({ event, score: eventConsequenceScore(event) }))
    .filter((row) => row.score >= 3);
  const eventCount = recent.length;
  const consequentialCount = consequential.length;
  const lowCeiling = Math.max(1, Math.floor(eventCount * 0.18));
  const level =
    eventCount >= CONSEQUENCE_MIN_VISIBLE_EVENTS && consequentialCount <= lowCeiling
      ? "low"
      : "normal";

  return {
    level,
    eventCount,
    consequentialCount,
    lookbackDays,
    examples: consequential
      .slice(-4)
      .map(({ event }) => `${normalizeString(event?.date)} — ${normalizeString(event?.title)}`)
      .filter(Boolean),
  };
};

// Fix 07 — an active high-pressure process may be quiet, but it may not vanish
// from causal simulation for months at a time. 35 days forces a fresh endogenous
// reappraisal; 70 days adds an objective anti-stasis backstop. Neither threshold
// is an event quota or a demand for territorial movement.
const HIGH_PRESSURE_STAGNATION_THRESHOLD = 55;
const STAGNATION_REAPPRAISAL_DAYS = 21;
const STAGNATION_BACKSTOP_DAYS = 45;

let lastAnalysis = null;

const normalizeString = (value) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeArray = (value) =>
  Array.isArray(value) ? value : [];

const truncate = (value, max = 260) => {
  const text = normalizeString(value);
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
};

const parseIsoDate = (value) => {
  // Milliseconds for a game date, BC included (runtime/gameDates.js).
  const dayNumber = gameDateDayNumber(value);
  return dayNumber === null ? null : dayNumber * 86400000;
};

const addIsoDays = (value, days) => addGameDays(value, Number(days) || 0) || normalizeString(value);

const compareIso = (a, b) => {
  const left = parseIsoDate(a);
  const right = parseIsoDate(b);
  if (left == null || right == null) return 0;
  return left === right ? 0 : left < right ? -1 : 1;
};

const clampPercent = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const ageDays = (originDate, eventDate) => {
  const origin = parseIsoDate(originDate);
  const event = parseIsoDate(eventDate);
  if (origin == null || event == null) return 99999;
  return Math.max(0, Math.round((origin - event) / 86400000));
};

const latestMessageDate = (chat) => {
  const messages = normalizeArray(chat?.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const date = normalizeString(messages[i]?.time || messages[i]?.date);
    if (date) return date;
  }
  return "";
};

const latestMemorySummary = (chat) => {
  const messages = normalizeArray(chat?.messages);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const summary = normalizeString(messages[i]?.memorySummary);
    if (summary) return summary;
  }
  return "";
};

const importanceScore = (importance) => {
  switch (normalizeString(importance).toLowerCase()) {
    case "critical":
      return 8;
    case "major":
      return 5;
    case "moderate":
      return 3;
    case "minor":
      return 1;
    default:
      return 0;
  }
};

const recencyScore = (days) => {
  if (days <= 14) return 7;
  if (days <= 30) return 6;
  if (days <= 60) return 5;
  if (days <= 120) return 4;
  if (days <= 240) return 3;
  if (days <= 365) return 2;
  return 0;
};

const countImpactSignals = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object"
    ? event.impacts
    : {};
  let signals = 0;
  for (const key of [
    "regionTransfers",
    "regionClaims",
    "regionControlOps",
    "polityChanges",
    "politicalActorOps",
    "unitOps",
    "markerOps",
    "createdChats",
  ]) {
    if (normalizeArray(impacts[key]).length) signals += 1;
  }
  return signals;
};

const eventCandidate = (event, originDate, index) => {
  const title = normalizeString(event?.title);
  if (!title) return null;

  const days = ageDays(originDate, event?.date);
  const impactSignals = countImpactSignals(event);
  const kind = normalizeString(event?.kind).toLowerCase();

  let score =
    importanceScore(event?.importance) +
    recencyScore(days) +
    Math.min(6, impactSignals * 2);

  if (event?.notable) score += 2;
  if (kind === "military" || kind === "diplomacy") score += 1;

  // Player-related events are NOT boosted. Phase 6 explicitly avoids treating
  // the human polity as the center of gravity merely because it is human.
  return {
    id: `event:${normalizeString(event?.id) || index}`,
    sourceEventId: normalizeString(event?.id),
    type: "recent-event",
    score,
    date: normalizeString(event?.date),
    title,
    detail: truncate(event?.description || event?.summary, 280),
    ageDays: days,
    storylineIds: [...new Set(
      normalizeArray(event?.storylineIds)
        .map(normalizeString)
        .filter(Boolean),
    )].slice(0, 6),
    trajectoryValue: deriveWorldTrajectoryValue(event),
  };
};

const chatCandidate = (chat, originDate, index) => {
  if (!chat || normalizeString(chat.status).toLowerCase() === "closed") return null;

  const memory = latestMemorySummary(chat);
  if (!memory) return null;

  const participants = normalizeArray(chat.countries)
    .map((country) => normalizeString(country?.name || country?.code))
    .filter(Boolean);

  const date = latestMessageDate(chat);
  const days = ageDays(originDate, date);
  const score = 7 + recencyScore(days);

  return {
    id: `chat:${normalizeString(chat.id) || index}`,
    type: "diplomatic-thread",
    score,
    date,
    title: participants.length
      ? `Active diplomacy: ${participants.join(", ")}`
      : "Active diplomatic thread",
    detail: truncate(memory, 320),
    ageDays: days,
    trajectoryValue: deriveWorldTrajectoryValue({
      title: participants.length ? `Active diplomacy: ${participants.join(", ")}` : "Active diplomatic thread",
      detail: memory,
    }),
  };
};

const consolidatedCandidate = (entry, index) => {
  const summary = normalizeString(entry?.summary);
  if (!summary) return null;

  return {
    id: `canon:${normalizeString(entry?.id) || index}`,
    type: "durable-canon",
    score: 7,
    date: normalizeString(entry?.date || entry?.throughDate || entry?.endDate),
    title: "Durable campaign canon",
    detail: truncate(summary, 320),
    ageDays: 99999,
  };
};

const actorSuppressedByDeferredSet = (
  actor,
  suppressedActors,
  world,
  gameCountry = "",
) =>
  [...suppressedActors].some((deferredActor) =>
    worldActorsEquivalent(actor, deferredActor, world, gameCountry)
  );

const pushTerritorialCandidates = (candidates, world, suppressedActors = new Set(), gameCountry = "") => {
  const claimants = world?.regionClaimants && typeof world.regionClaimants === "object"
    ? world.regionClaimants
    : {};
  const controllers = world?.regionOwnershipOverrides && typeof world.regionOwnershipOverrides === "object"
    ? world.regionOwnershipOverrides
    : {};
  const sovereigns = world?.regionSovereigntyOverrides && typeof world.regionSovereigntyOverrides === "object"
    ? world.regionSovereigntyOverrides
    : {};

  let added = 0;
  for (const regionId in claimants) {
    if (added >= TERRITORIAL_SAMPLE_LIMIT) break;

    const contenderList = normalizeArray(claimants[regionId])
      .map(normalizeString)
      .filter(Boolean);
    const controller = normalizeString(controllers[regionId]);
    const sovereign = normalizeString(sovereigns[regionId]);

    if (!contenderList.length && (!controller || !sovereign || controller === sovereign)) {
      continue;
    }

    const territorialActors = [controller, sovereign, ...contenderList]
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter(Boolean);
    if (
      territorialActors.length &&
      territorialActors.every((actor) =>
        actorSuppressedByDeferredSet(actor, suppressedActors, world, gameCountry)
      )
    ) {
      continue;
    }

    candidates.push({
      id: `territory:${regionId}`,
      type: "territorial-pressure",
      score: 10,
      date: "",
      title: `Active territorial pressure: ${regionId}`,
      detail: [
        controller ? `controller ${controller}` : "",
        sovereign ? `legal sovereign ${sovereign}` : "",
        contenderList.length ? `claimants/contenders ${contenderList.join(", ")}` : "",
        // What those claimants are, when their records say (server/polityRole.js).
        contenderList
          .map((name) => ({ name, role: polityRoleOf(world?.polityOverrides, name) }))
          .filter((entry) => entry.role)
          .map((entry) => `${entry.name} is ${entry.role}`)
          .join(", "),
      ].filter(Boolean).join("; "),
      ageDays: 0,
      trajectoryValue: 4,
    });
    added += 1;
  }
};

const pushActiveUnitCandidates = (candidates, world, suppressedActors = new Set(), gameCountry = "") => {
  let added = 0;
  for (const unit of normalizeArray(world?.units)) {
    if (added >= ACTIVE_UNIT_SAMPLE_LIMIT) break;

    const status = normalizeString(unit?.status).toLowerCase();
    if (!status || status === "idle") continue;

    const owner = normalizeString(unit?.ownerCode || unit?.owner);
    if (
      owner &&
      actorSuppressedByDeferredSet(owner, suppressedActors, world, gameCountry)
    ) continue;
    const name = normalizeString(unit?.name) || "Unit";
    const region = normalizeString(unit?.regionId);

    candidates.push({
      id: `unit:${normalizeString(unit?.id) || added}`,
      type: "active-military-state",
      score: 7,
      date: "",
      title: `Active military state: ${owner ? `${owner} — ` : ""}${name}`,
      detail: [status ? `status ${status}` : "", region ? `region ${region}` : ""]
        .filter(Boolean)
        .join("; "),
      ageDays: 0,
    });
    added += 1;
  }
};

const normalizeStorylineForDirector = (entry, index = 0) => {
  if (!entry || typeof entry !== "object") return null;
  const title = normalizeString(entry.title);
  if (!title) return null;
  const statusRaw = normalizeString(entry.status).toLowerCase();
  const status = ["active", "dormant", "resolved"].includes(statusRaw)
    ? statusRaw
    : "active";
  return {
    id: normalizeString(entry.id) || `storyline-${index}`,
    kind: normalizeString(entry.kind) || "world",
    title,
    participants: [...new Set(normalizeArray(entry.participants).map(normalizeString).filter(Boolean))].slice(0, 12),
    status,
    pressure: clampPercent(entry.pressure),
    momentum: clampPercent(entry.momentum),
    startedDate: normalizeString(entry.startedDate),
    accountedThroughDate: normalizeString(entry.accountedThroughDate || entry.lastUpdatedDate || entry.startedDate),
    lastUpdatedDate: normalizeString(entry.lastUpdatedDate || entry.accountedThroughDate || entry.startedDate),
    lastVisibleEventDate: normalizeString(entry.lastVisibleEventDate),
    nextReviewDate: status === "resolved" ? "" : normalizeString(entry.nextReviewDate),
    state: truncate(entry.state || entry.summary || entry.description, 520),
    drivers: [...new Set(normalizeArray(entry.drivers).map(normalizeString).filter(Boolean))].slice(0, 8),
    constraints: [...new Set(normalizeArray(entry.constraints).map(normalizeString).filter(Boolean))].slice(0, 8),
    sourceEventIds: [...new Set(normalizeArray(entry.sourceEventIds).map(normalizeString).filter(Boolean))].slice(0, 16),
    createdRound: Math.max(0, Math.trunc(Number(entry.createdRound) || 0)),
    updatedRound: Math.max(0, Math.trunc(Number(entry.updatedRound) || 0)),
  };
};


const storylineParticipantsKey = (participants) =>
  [...new Set(
    normalizeArray(participants)
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter(Boolean),
  )]
    .sort()
    .join("|");

const storylineSemanticIdentityKey = (storyline) => {
  const kind = normalizeString(storyline?.kind).toLowerCase() || "world";
  const title = normalizeString(storyline?.title).toLowerCase();
  const participants = storylineParticipantsKey(storyline?.participants);
  if (!title) return "";
  return `${kind}|${title}|${participants}`;
};

const storylineFreshnessValue = (storyline) => {
  const date =
    parseIsoDate(storyline?.lastUpdatedDate) ??
    parseIsoDate(storyline?.accountedThroughDate) ??
    parseIsoDate(storyline?.startedDate);
  if (date != null) return date;
  return Math.max(0, Number(storyline?.updatedRound) || 0);
};

const canonicalWarStorylineIdForGroup = (world, group) => {
  if (!group.length || normalizeString(group[0]?.kind).toLowerCase() !== "war") return "";
  const participantsKey = storylineParticipantsKey(group[0]?.participants);
  if (!participantsKey) return "";

  const matchingWars = normalizeArray(world?.wars).filter((war) => {
    const warParticipants = [
      ...normalizeArray(war?.sideA),
      ...normalizeArray(war?.sideB),
    ];
    return storylineParticipantsKey(warParticipants) === participantsKey;
  });

  if (matchingWars.length !== 1) return "";
  const warId = normalizeString(matchingWars[0]?.id);
  if (!warId) return "";

  const preferred = `storyline-${warId}`;
  return group.some((entry) => normalizeString(entry?.id) === preferred)
    ? preferred
    : "";
};

// Fix 07.4 — canonical ACTIVE wars receive causal attention by conflict status,
// not by whether a pressure score happens to sit above an arbitrary threshold.
// Prefer exact war-id linkage, then fall back to kind+participant identity for
// compatibility saves whose storyline ids predate the canonical war id.
const activeCanonicalWarForStoryline = (storyline, worldLike) => {
  if (!storyline || normalizeString(storyline?.status).toLowerCase() !== "active") return null;
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const storylineId = normalizeString(storyline?.id);
  const kind = normalizeString(storyline?.kind).toLowerCase();
  const participantsKey = storylineParticipantsKey(storyline?.participants);

  for (const war of normalizeArray(world?.wars)) {
    if (normalizeString(war?.status).toLowerCase() !== "active") continue;
    const warId = normalizeString(war?.id);
    if (warId && storylineId === `storyline-${warId}`) return war;

    if (kind !== "war" || !participantsKey) continue;
    const warParticipants = [
      ...normalizeArray(war?.sideA),
      ...normalizeArray(war?.sideB),
    ];
    if (storylineParticipantsKey(warParticipants) === participantsKey) return war;
  }

  return null;
};

const coalesceWorldStorylines = (worldLike) => {
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const normalized = normalizeArray(world?.storylines)
    .map(normalizeStorylineForDirector)
    .filter(Boolean);

  const groups = new Map();
  for (const storyline of normalized) {
    const semanticKey = storylineSemanticIdentityKey(storyline) || `id:${storyline.id}`;
    if (!groups.has(semanticKey)) groups.set(semanticKey, []);
    groups.get(semanticKey).push(storyline);
  }

  const aliasToCanonical = new Map();
  const storylines = [];
  const duplicateGroups = [];

  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) =>
      (storylineFreshnessValue(b) - storylineFreshnessValue(a)) ||
      ((Number(b?.updatedRound) || 0) - (Number(a?.updatedRound) || 0)) ||
      (normalizeArray(b?.sourceEventIds).length - normalizeArray(a?.sourceEventIds).length) ||
      normalizeString(a?.id).localeCompare(normalizeString(b?.id))
    );

    const freshest = ordered[0];
    const canonicalId =
      canonicalWarStorylineIdForGroup(world, group) ||
      normalizeString(freshest?.id);

    for (const entry of group) {
      aliasToCanonical.set(normalizeString(entry?.id), canonicalId);
    }

    if (group.length === 1) {
      storylines.push({
        ...freshest,
        id: canonicalId,
      });
      continue;
    }

    const startedDates = group
      .map((entry) => normalizeString(entry?.startedDate))
      .filter((date) => parseIsoDate(date) != null)
      .sort();

    const lastVisibleDates = group
      .map((entry) => normalizeString(entry?.lastVisibleEventDate))
      .filter((date) => parseIsoDate(date) != null)
      .sort();

    const sourceEventIds = [...new Set(
      group.flatMap((entry) => normalizeArray(entry?.sourceEventIds))
        .map(normalizeString)
        .filter(Boolean),
    )].slice(-16);

    const drivers = [...new Set(
      group.flatMap((entry) => normalizeArray(entry?.drivers))
        .map(normalizeString)
        .filter(Boolean),
    )].slice(0, 8);

    const constraints = [...new Set(
      group.flatMap((entry) => normalizeArray(entry?.constraints))
        .map(normalizeString)
        .filter(Boolean),
    )].slice(0, 8);

    const createdRounds = group
      .map((entry) => Math.max(0, Math.trunc(Number(entry?.createdRound) || 0)))
      .filter((value) => value > 0);

    const merged = normalizeStorylineForDirector({
      ...freshest,
      id: canonicalId,
      participants: [...new Set(
        group.flatMap((entry) => normalizeArray(entry?.participants))
          .map(normalizeString)
          .filter(Boolean),
      )],
      startedDate: startedDates[0] || freshest?.startedDate,
      lastVisibleEventDate: lastVisibleDates.at(-1) || "",
      drivers,
      constraints,
      sourceEventIds,
      createdRound: createdRounds.length
        ? Math.min(...createdRounds)
        : Math.max(0, Math.trunc(Number(freshest?.createdRound) || 0)),
      updatedRound: Math.max(
        ...group.map((entry) => Math.max(0, Math.trunc(Number(entry?.updatedRound) || 0))),
      ),
    });

    if (merged) storylines.push(merged);

    duplicateGroups.push({
      canonicalId,
      ids: group.map((entry) => normalizeString(entry?.id)).filter(Boolean),
      title: normalizeString(freshest?.title),
    });
  }

  return {
    storylines,
    aliasToCanonical,
    duplicateGroups,
    mergedDuplicateCount: normalized.length - storylines.length,
  };
};

const recentEventEligibleForInitiative = (event, originDate) => {
  if (!event || typeof event !== "object") return false;

  const originParsed = parseIsoDate(originDate);
  const eventParsed = parseIsoDate(event?.date);
  if (originParsed != null && eventParsed != null) {
    if (ageDays(originDate, event?.date) > RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS) {
      return false;
    }
  }

  // A recent timeline card is not automatically a present-tense causal seed.
  if (countImpactSignals(event) > 0) return true;
  if (event?.notable === true) return true;
  if (event?.playerRelated === true) return true;
  if (normalizeArray(event?.storylineIds).length > 0) return true;

  const importance = normalizeString(event?.importance).toLowerCase();
  if (["critical", "major"].includes(importance)) return true;

  const age = eventParsed != null && originParsed != null
    ? ageDays(originDate, event?.date)
    : 99999;

  if (importance === "moderate" && age <= 60) return true;

  if (normalizeString(event?.kind).toLowerCase() === "diplomacy" && age <= 45) {
    return true;
  }

  return false;
};

const storylineStagnationAgeDays = (storyline, referenceDate) => {
  if (!storyline || parseIsoDate(referenceDate) == null) return 0;

  const anchor =
    parseIsoDate(storyline.lastVisibleEventDate) != null
      ? storyline.lastVisibleEventDate
      : parseIsoDate(storyline.lastUpdatedDate) != null
        ? storyline.lastUpdatedDate
        : parseIsoDate(storyline.accountedThroughDate) != null
          ? storyline.accountedThroughDate
          : storyline.startedDate;

  if (parseIsoDate(anchor) == null) return 0;
  return ageDays(referenceDate, anchor);
};

// Soft 21-day causal reappraisal is about time since the simulator last looked at
// the process, not time since the last visible card. This prevents an active war
// that honestly remains quiet from being selected on every one-day jump forever.
// The 45-day objective anti-stasis backstop still uses visible-stagnation age.
const storylineReviewAgeDays = (storyline, referenceDate) => {
  if (!storyline || parseIsoDate(referenceDate) == null) return 0;
  const anchor =
    parseIsoDate(storyline.lastUpdatedDate) != null
      ? storyline.lastUpdatedDate
      : parseIsoDate(storyline.accountedThroughDate) != null
        ? storyline.accountedThroughDate
        : storyline.startedDate;
  if (parseIsoDate(anchor) == null) return 0;
  return ageDays(referenceDate, anchor);
};

const storylineAttentionScore = (storyline, originDate, targetDate, world = null) => {
  if (!storyline || storyline.status === "resolved") return -Infinity;

  let score = storyline.status === "active" ? 8 : 1;
  score += storyline.pressure / 10;
  score += storyline.momentum / 8;

  const stagnationAgeAtHorizon = storylineStagnationAgeDays(storyline, targetDate);
  const reviewAgeAtHorizon = storylineReviewAgeDays(storyline, targetDate);
  const activeWar = Boolean(activeCanonicalWarForStoryline(storyline, world));
  if (activeWar) {
    if (stagnationAgeAtHorizon >= STAGNATION_BACKSTOP_DAYS) score += 24;
    else if (reviewAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS) score += 14;
  } else if (
    storyline.status === "active" &&
    storyline.pressure >= HIGH_PRESSURE_STAGNATION_THRESHOLD
  ) {
    if (stagnationAgeAtHorizon >= STAGNATION_BACKSTOP_DAYS) score += 24;
    else if (stagnationAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS) score += 14;
  }

  const nextReview = storyline.nextReviewDate;
  if (!nextReview) {
    score += storyline.status === "active" ? 12 : 3;
  } else if (parseIsoDate(nextReview) != null && parseIsoDate(targetDate) != null) {
    if (nextReview <= originDate) score += 16;
    else if (nextReview <= targetDate) score += 11;
  }

  // Starvation bonus: a lower-ranked but still unresolved process gradually
  // climbs if it has not received semantic attention. This prevents one crisis
  // from permanently monopolising the scheduler without inventing filler.
  const staleDays = ageDays(originDate, storyline.lastUpdatedDate || storyline.accountedThroughDate);
  if (staleDays >= 240) score += 8;
  else if (staleDays >= 120) score += 6;
  else if (staleDays >= 60) score += 4;
  else if (staleDays >= 30) score += 2;

  // Visible-history cooldown is deliberately separate from unresolved pressure.
  // A storyline may remain dangerous for months without deserving another card
  // every time the scheduler looks at it. Recent visibility pays a modest score
  // penalty so other due processes can compete; genuine high momentum can still win.
  if (parseIsoDate(storyline.lastVisibleEventDate) != null) {
    const visibleAge = ageDays(originDate, storyline.lastVisibleEventDate);
    for (const [maxDays, penalty] of RECENT_VISIBLE_EVENT_PENALTY_DAYS) {
      if (visibleAge <= maxDays) {
        score -= penalty;
        break;
      }
    }
  }

  return score;
};

const storylineNeedsAttentionWithin = (storyline, originDate, targetDate, world = null) => {
  if (!storyline || storyline.status === "resolved") return false;

  // Fix 07.4: every canonical ACTIVE war gets a causal reappraisal after ~35 days
  // since its last semantic review regardless of numerical pressure. This is hidden
  // simulation attention, not a demand for a battle/event. Non-war storylines keep
  // the existing high-pressure visible-stagnation override.
  const stagnationAgeAtHorizon = storylineStagnationAgeDays(storyline, targetDate);
  const reviewAgeAtHorizon = storylineReviewAgeDays(storyline, targetDate);
  const activeWar = Boolean(activeCanonicalWarForStoryline(storyline, world));
  if (activeWar && reviewAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS) {
    return true;
  }
  if (
    storyline.status === "active" &&
    storyline.pressure >= HIGH_PRESSURE_STAGNATION_THRESHOLD &&
    stagnationAgeAtHorizon >= STAGNATION_REAPPRAISAL_DAYS
  ) {
    return true;
  }

  if (!storyline.nextReviewDate) return storyline.status === "active";
  if (parseIsoDate(storyline.nextReviewDate) == null || parseIsoDate(targetDate) == null) {
    return storyline.status === "active";
  }

  // Urgency is normally encoded into nextReviewDate when updates are persisted.
  // Active-war review age above is an additional compatibility guard for older
  // saves whose review date was scheduled under the pre-07.4 pressure cliff.
  return compareGameDates(storyline.nextReviewDate, targetDate) <= 0;
};

const selectStorylineAttention = (world, originDate, targetDate) => {
  const coalesced = coalesceWorldStorylines(world);
  const normalized = coalesced.storylines
    .slice(0, MAX_PERSISTED_STORYLINES);

  const ranked = normalized
    .filter((entry) => storylineNeedsAttentionWithin(entry, originDate, targetDate, world))
    .map((entry) => ({
      ...entry,
      attentionScore: Math.round(storylineAttentionScore(entry, originDate, targetDate, world) * 10) / 10,
    }))
    .sort((a, b) =>
      (b.attentionScore - a.attentionScore) ||
      (b.momentum - a.momentum) ||
      (b.pressure - a.pressure) ||
      a.id.localeCompare(b.id)
    );

  // Greedy diversity-aware selection. A dominant war/crisis can still rank first
  // and receive attention every pass, but closely-overlapping processes pay a
  // small penalty once the same participants/kind already occupy slots. This is
  // a fairness bias, NOT a quota: genuinely urgent related processes can still win.
  const pool = [...ranked];
  const selected = [];
  const kindUse = new Map();
  const participantUse = new Map();

  while (pool.length > 0 && selected.length < MAX_ATTENTION_STORYLINES) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;

    for (let index = 0; index < pool.length; index += 1) {
      const entry = pool[index];
      const kindKey = normalizeString(entry.kind).toLowerCase() || "world";
      const overlapPenalty =
        (kindUse.get(kindKey) || 0) * 1.5 +
        normalizeArray(entry.participants).reduce(
          (sum, participant) =>
            sum + (participantUse.get(normalizeString(participant).toLowerCase()) || 0) * 1.25,
          0,
        );
      const adjusted = entry.attentionScore - overlapPenalty;
      if (
        adjusted > bestAdjusted ||
        (
          adjusted === bestAdjusted &&
          (
            entry.momentum > pool[bestIndex].momentum ||
            (
              entry.momentum === pool[bestIndex].momentum &&
              entry.pressure > pool[bestIndex].pressure
            )
          )
        )
      ) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    selected.push({
      ...picked,
      adjustedAttentionScore: Math.round(bestAdjusted * 10) / 10,
    });

    const kindKey = normalizeString(picked.kind).toLowerCase() || "world";
    kindUse.set(kindKey, (kindUse.get(kindKey) || 0) + 1);
    for (const participant of normalizeArray(picked.participants)) {
      const key = normalizeString(participant).toLowerCase();
      if (key) participantUse.set(key, (participantUse.get(key) || 0) + 1);
    }
  }

  return {
    all: normalized,
    ranked,
    selected,
    aliasToCanonical: coalesced.aliasToCanonical,
    duplicateGroups: coalesced.duplicateGroups,
    mergedDuplicateCount: coalesced.mergedDuplicateCount,
  };
};

const recommendedReviewDays = (pressure, momentum, status, { activeWar = false } = {}) => {
  if (status === "resolved") return 0;

  // Pressure is unresolved seriousness; momentum is the rate of meaningful change.
  // Fix 07.4 keeps genuinely fast processes on shorter cadence, caps every canonical
  // ACTIVE war at 21 days regardless of pressure, and keeps the same 21-day guard
  // for other active high-pressure processes. This is never a visible-card cadence.
  const p = clampPercent(pressure);
  const m = clampPercent(momentum);

  if (m >= 85) return 10;
  if (m >= 70) return 18;
  if (normalizeString(status).toLowerCase() === "active" && activeWar) {
    return STAGNATION_REAPPRAISAL_DAYS;
  }
  if (
    normalizeString(status).toLowerCase() === "active" &&
    p >= HIGH_PRESSURE_STAGNATION_THRESHOLD
  ) return STAGNATION_REAPPRAISAL_DAYS;
  if (m >= 50) return 30;
  if (m >= 30) return 45;

  if (p >= 50) return 75;
  if (p >= 30) return 120;
  return 180;
};

const clampNextReviewDate = ({ stopDate, pressure, momentum, status, requested, activeWar = false }) => {
  if (status === "resolved") return "";
  if (parseIsoDate(stopDate) == null) return normalizeString(requested);
  const latestAllowed = addIsoDays(
    stopDate,
    recommendedReviewDays(pressure, momentum, status, { activeWar }),
  );
  const requestedText = normalizeString(requested);
  if (parseIsoDate(requestedText) == null || requestedText <= stopDate || requestedText > latestAllowed) {
    return latestAllowed;
  }
  return requestedText;
};


const STORYLINE_RECORD_SEPARATOR = "~";
const MAX_STORYLINE_UPDATES_PER_JUMP = 16;

// A storyline state is a sentence; a kind, a title and a list of polity names
// are not. The longest comma-separated stretch decides it: the longest official
// polity name ("United Kingdom of Great Britain and Northern Ireland") is eight
// words, so a list of names never reaches nine, and a stretch of six or more
// words that ends like a sentence is prose. A list that happens to end "U.S."
// stays a list, because none of its names is six words long.
const looksLikeStorylineStateProse = (value) => {
  const text = normalizeString(value);
  const longest = Math.max(0, ...text.split(",").map((part) => part.trim().split(/\s+/).filter(Boolean).length));
  return longest >= 9 || (longest >= 6 && /[.!?]$/.test(text));
};

const parseStorylineRecord = (line, index = 0) => {
  const text = normalizeString(line);
  if (!text) return null;

  // Format:
  // id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventIndexesCSV~state
  // Split only the first nine separators so accidental "~" in the final state
  // can be preserved rather than corrupting the record.
  const fields = [];
  let rest = text;
  let separators = 9;
  for (let cut = 0; cut < 9; cut += 1) {
    const pos = rest.indexOf(STORYLINE_RECORD_SEPARATOR);
    if (pos < 0) {
      fields.push(rest);
      rest = "";
      separators = cut;
      break;
    }
    fields.push(rest.slice(0, pos));
    rest = rest.slice(pos + 1);
  }
  while (fields.length < 9) fields.push("");
  fields.push(rest);

  // Two or more empty positional fields left out. The one-short shape (state in
  // the event-number slot) is recovered below; a model that also drops an empty
  // kind/title/participants field pushes the state further left — a player's
  // turn came back as "id~active~20~75~2024-01-09~~~<state>", seven separators,
  // which put every state into participantsCSV and cost the whole jump to
  // "record 1 must describe the process state". The line's final field is where
  // the model put the state; move it home when that is plainly what it is.
  // Only kind, title and participants are recovered: a record short enough to
  // put its state in startedDate or earlier is too broken to read positionally.
  if (
    separators >= 5 &&
    separators <= 7 &&
    !normalizeString(fields[9]) &&
    looksLikeStorylineStateProse(fields[separators])
  ) {
    fields[9] = fields[separators];
    fields[separators] = "";
  }

  const [
    idRaw,
    statusRaw,
    pressureRaw,
    momentumRaw,
    startedDateRaw,
    kindRaw,
    titleRaw,
    participantsRaw,
    eventIndexesRaw,
    stateRaw,
  ] = fields;

  let normalizedEventNumbersRaw = normalizeString(eventIndexesRaw);
  let normalizedStateRaw = normalizeString(stateRaw);

  // Native linkage means the event-number field is optional. Cheap models may
  // omit the empty positional field entirely, producing
  // ...~participantsCSV~state instead of ...~participantsCSV~~state. Detect that
  // harmless shape and recover the state rather than misreading prose as indexes.
  if (
    !normalizedStateRaw &&
    normalizedEventNumbersRaw &&
    !/^\d+(?:\s*,\s*\d+)*$/.test(normalizedEventNumbersRaw)
  ) {
    normalizedStateRaw = normalizedEventNumbersRaw;
    normalizedEventNumbersRaw = "";
  }

  const eventIndexes = normalizedEventNumbersRaw
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isInteger(entry) && entry >= 1)
    .map((entry) => entry - 1)
    .slice(0, 12);

  return {
    id: normalizeString(idRaw) || `storyline-${index}`,
    status: normalizeString(statusRaw).toLowerCase(),
    pressure: clampPercent(pressureRaw),
    momentum: clampPercent(momentumRaw),
    startedDate: normalizeString(startedDateRaw),
    kind: normalizeString(kindRaw),
    title: normalizeString(titleRaw),
    participants: participantsRaw
      .split(",")
      .map(normalizeString)
      .filter(Boolean)
      .slice(0, 12),
    eventIndexes,
    state: normalizedStateRaw,
  };
};

export const decodeWorldStorylineUpdates = (value) => {
  // Internal/back-compat callers may already provide object records.
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => {
        if (typeof entry === "string") return parseStorylineRecord(entry, index);
        if (!entry || typeof entry !== "object") return null;
        return {
          ...entry,
          eventIndexes: normalizeArray(entry.eventIndexes)
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item >= 0)
            .slice(0, 12),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_STORYLINE_UPDATES_PER_JUMP);
  }

  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => parseStorylineRecord(line, index))
    .filter(Boolean)
    .slice(0, MAX_STORYLINE_UPDATES_PER_JUMP);
};

const STORYLINE_LINK_STOPWORDS = new Set([
  "about", "after", "again", "against", "among", "because", "between", "during",
  "from", "into", "over", "that", "their", "there", "these", "this", "through",
  "under", "with", "without", "storyline", "government", "empire", "kingdom",
  "republic", "state", "states", "process", "current", "continues", "continued",
]);

const storylineLinkText = (value) =>
  normalizeString(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const storylineLinkTokens = (value) =>
  [...new Set(
    storylineLinkText(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !STORYLINE_LINK_STOPWORDS.has(token))
  )];

const storylineParticipantAliases = (participant) => {
  const raw = storylineLinkText(participant);
  if (!raw) return [];
  const variants = new Set([raw]);
  const stripped = raw
    .replace(/^(the )?(kingdom|republic|empire|federation|commonwealth|union|state) of /, "")
    .replace(/ (kingdom|republic|empire|federation|commonwealth|union|state)$/, "")
    .trim();
  if (stripped) variants.add(stripped);
  return [...variants].filter((value) => value.length >= 3);
};

const storylineEventStructuredActors = (event) => {
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  return [
    ...normalizeArray(event?.combatants),
    ...normalizeArray(impacts?.polityChanges).flatMap((entry) => [entry?.code, entry?.name]),
    ...normalizeArray(impacts?.politicalActorOps).map((entry) => entry?.polityKey || entry?.polity || entry?.country),
    ...normalizeArray(impacts?.regionTransfers).flatMap((entry) => [entry?.fromCode, entry?.toCode]),
    ...normalizeArray(impacts?.regionClaims).flatMap((entry) => [
      entry?.claimantCode,
      entry?.claimant,
    ]),
    ...normalizeArray(impacts?.regionControlOps).flatMap((entry) => [
      entry?.fromCode,
      entry?.toCode,
      entry?.actorCode,
      entry?.claimantCode,
    ]),
    ...normalizeArray(impacts?.createdChats).flatMap((chat) => [
      chat?.speaker,
      ...normalizeArray(chat?.countries),
    ]),
  ].map(normalizeString).filter(Boolean);
};

const scoreStorylineEventLink = (update, event, world, { ignoreActor = "" } = {}) => {
  const eventText = storylineLinkText([
    event?.id,
    event?.title,
    event?.description,
    event?.warId,
    JSON.stringify(event?.impacts ?? {}),
  ].filter(Boolean).join(" "));
  if (!eventText) return 0;

  const structuredActors = storylineEventStructuredActors(event);
  let score = 0;

  // R3.8: an already-established native event->storyline binding is objective
  // bookkeeping evidence. Give it overwhelming precedence so a subsequent
  // normalization pass can propagate the same link back into update.eventIndexes
  // before anti-stasis evaluation. This does not create a semantic link by itself;
  // only callers such as bindSelectedStorylineEvents may establish event.storylineIds.
  const updateId = normalizeString(update?.id);
  if (
    updateId &&
    normalizeArray(event?.storylineIds).map(normalizeString).includes(updateId)
  ) {
    score += 40;
  }

  for (const participant of normalizeArray(update?.participants).map(normalizeString).filter(Boolean)) {
    if (ignoreActor && worldActorsEquivalent(participant, ignoreActor, world || {}, "")) continue;
    const structuredHit = structuredActors.some((actor) =>
      worldActorsEquivalent(participant, actor, world || {}, "")
    );
    if (structuredHit) {
      score += 10;
      continue;
    }

    if (
      storylineParticipantAliases(participant)
        .some((alias) => (` ${eventText} `).includes(` ${alias} `))
    ) {
      score += 6;
    }
  }

  const titleTokens = storylineLinkTokens(`${update?.id || ""} ${update?.title || ""}`);
  const stateTokens = storylineLinkTokens(update?.state);
  const eventTokens = new Set(storylineLinkTokens(eventText));
  score += Math.min(8, titleTokens.filter((token) => eventTokens.has(token)).length * 2);
  score += Math.min(4, stateTokens.filter((token) => eventTokens.has(token)).length);

  const kind = normalizeString(update?.kind).toLowerCase();
  const eventWarId = storylineLinkText(event?.warId);
  if (kind === "war" && eventWarId) {
    const warTokens = new Set(storylineLinkTokens(eventWarId));
    const storylineWarTokens = storylineLinkTokens(`${update?.id || ""} ${update?.title || ""}`);
    const warOverlap = storylineWarTokens.filter((token) => warTokens.has(token)).length;
    if (warOverlap > 0) score += Math.min(8, 4 + warOverlap * 2);
  }

  return score;
};

const inferStorylineEventIndexes = (update, events, world) => {
  const scored = normalizeArray(events)
    .map((event, index) => ({
      index,
      score: scoreStorylineEventLink(update, event, world),
    }))
    .filter((row) => row.score >= 6)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!scored.length) return [];
  const best = scored[0].score;

  // Multiple events may legitimately advance the same persistent process in one
  // pass. Keep only strong near-best matches, never a broad participant-only fanout.
  return scored
    .filter((row) => row.score >= Math.max(8, best - 2))
    .slice(0, 4)
    .map((row) => row.index);
};


// R3.1 — deterministic selected-storyline event salvage.
//
// The model owns WHAT happened and the semantic storyline state. Native JS owns
// obvious bookkeeping. If the main world pass generated an event that strongly
// and uniquely matches one scheduler-selected persistent storyline, attach that
// existing storyline id even when the model forgot storylineUpdates entirely.
//
// This is deliberately conservative:
// - selected/current storylines only;
// - strong score floor;
// - ambiguous near-ties are left alone;
// - existing explicit ids are preserved;
// - no pressure/momentum/state is invented here.
export const bindSelectedStorylineEvents = (
  candidate,
  {
    selectedStorylines = [],
    world = {},
    // The player's polity. Once the player joins a storyline (a mediator, say),
    // naming the player would otherwise be enough to bind: every event about the
    // player's own programmes landed in a Gulf crisis because it said "British".
    // The player's link to a storyline has to come from the storyline's own
    // subject, not from the player being in it.
    gameCountry = "",
    minScore = 6,
    ambiguityMargin = 4,
  } = {},
) => {
  if (!candidate || typeof candidate !== "object") {
    return { bound: 0, bindings: [] };
  }

  const events = normalizeArray(candidate?.events);
  const selected = normalizeArray(selectedStorylines)
    .filter((storyline) => {
      const id = normalizeString(storyline?.id);
      const status = normalizeString(storyline?.status).toLowerCase();
      return id && ["active", "dormant"].includes(status);
    });

  if (!events.length || !selected.length) {
    return { bound: 0, bindings: [] };
  }

  let bound = 0;
  const bindings = [];

  candidate.events = events.map((event, eventIndex) => {
    if (!event || typeof event !== "object") return event;

    const currentIds = normalizeArray(event?.storylineIds)
      .map(normalizeString)
      .filter(Boolean);

    const scored = selected
      .map((storyline) => ({
        storyline,
        id: normalizeString(storyline?.id),
        score: scoreStorylineEventLink(storyline, event, world, { ignoreActor: gameCountry }),
      }))
      .filter((row) => row.id && row.score >= minScore)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    if (!scored.length) {
      return {
        ...event,
        storylineIds: [...new Set(currentIds)].slice(0, 6),
      };
    }

    const best = scored[0];
    const second = scored[1];
    const unambiguous =
      !second ||
      best.score - second.score >= ambiguityMargin ||
      best.score >= second.score + 2 * ambiguityMargin;

    if (!unambiguous) {
      return {
        ...event,
        storylineIds: [...new Set(currentIds)].slice(0, 6),
      };
    }

    const alreadyLinked = currentIds.includes(best.id);
    const storylineIds = [...new Set([...currentIds, best.id])].slice(0, 6);

    if (!alreadyLinked) {
      bound += 1;
      bindings.push({
        eventIndex,
        eventId: normalizeString(event?.id),
        storylineId: best.id,
        score: best.score,
      });
    }

    return {
      ...event,
      storylineIds,
    };
  });

  return { bound, bindings };
};

// R3.8 — deterministic new-storyline <-> event seam repair.
//
// Crisis Discovery may correctly create a new persistent process but omit the
// mechanical eventIndexes field. That must not discard an otherwise valuable
// breadth pass. For NEW storylines only, bind the single strongest returned event
// when the semantic match is strong and unambiguous. Ambiguous cases remain
// invalid and are rejected by the normal validator.
export const bindNewStorylineEvents = (
  candidate,
  {
    existingStorylines = [],
    world = {},
    minScore = 12,
    ambiguityMargin = 4,
  } = {},
) => {
  if (!candidate || typeof candidate !== "object") {
    return { bound: 0, bindings: [], ambiguous: [] };
  }

  const events = normalizeArray(candidate?.events);
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  if (!events.length || !updates.length) {
    return { bound: 0, bindings: [], ambiguous: [] };
  }

  const existingIds = new Set(
    normalizeArray(existingStorylines)
      .map((entry) => normalizeString(entry?.id))
      .filter(Boolean),
  );

  let bound = 0;
  const bindings = [];
  const ambiguous = [];

  candidate.storylineUpdates = updates.map((update, updateIndex) => {
    const id = normalizeString(update?.id);
    if (!id || existingIds.has(id) || normalizeArray(update?.eventIndexes).length) {
      return update;
    }

    const scored = events
      .map((event, eventIndex) => ({
        eventIndex,
        score: scoreStorylineEventLink(update, event, world),
      }))
      .filter((row) => row.score >= minScore)
      .sort((a, b) => b.score - a.score || a.eventIndex - b.eventIndex);

    if (!scored.length) return update;

    const best = scored[0];
    const second = scored[1];
    if (second && best.score - second.score < ambiguityMargin) {
      ambiguous.push({
        storylineId: id,
        updateIndex,
        bestEventIndex: best.eventIndex,
        bestScore: best.score,
        secondEventIndex: second.eventIndex,
        secondScore: second.score,
      });
      return update;
    }

    const event = events[best.eventIndex];
    events[best.eventIndex] = {
      ...event,
      storylineIds: [...new Set([
        ...normalizeArray(event?.storylineIds).map(normalizeString).filter(Boolean),
        id,
      ])].slice(0, 6),
    };

    bound += 1;
    bindings.push({
      storylineId: id,
      updateIndex,
      eventIndex: best.eventIndex,
      score: best.score,
    });

    return {
      ...update,
      eventIndexes: [best.eventIndex],
    };
  });

  candidate.events = events;
  return { bound, bindings, ambiguous };
};

export const normalizeWorldStorylineEventLinks = (
  candidate,
  {
    world = {},
  } = {},
) => {
  if (!candidate || typeof candidate !== "object") {
    return { updates: [], rebound: 0, strippedInvalid: 0 };
  }

  const events = normalizeArray(candidate?.events);
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  let rebound = 0;
  let strippedInvalid = 0;

  const normalized = updates.map((update) => {
    const supplied = normalizeArray(update?.eventIndexes)
      .map(Number)
      .filter((index) => Number.isInteger(index));
    const validSupplied = supplied.filter(
      (index) => index >= 0 && index < events.length,
    );
    strippedInvalid += Math.max(0, supplied.length - validSupplied.length);

    const inferred = inferStorylineEventIndexes(update, events, world);
    let eventIndexes = inferred;

    // If native semantic inference has no confident match, retain only supplied
    // indexes that themselves look related. This treats model numbers as hints,
    // never as authority.
    if (!eventIndexes.length && validSupplied.length) {
      eventIndexes = validSupplied.filter(
        (index) => scoreStorylineEventLink(update, events[index], world) >= 6,
      );
    }

    if (
      eventIndexes.length &&
      JSON.stringify(eventIndexes) !== JSON.stringify(validSupplied)
    ) {
      rebound += 1;
    }

    return {
      ...update,
      eventIndexes: [...new Set(eventIndexes)].slice(0, 12),
    };
  });

  candidate.storylineUpdates = normalized;

  if (rebound || strippedInvalid) {
    console.info(
      `[OH storyline native binding] ${rebound} storyline record(s) rebound from semantic event evidence; ` +
      `${strippedInvalid} invalid event reference(s) stripped.`,
    );
  }

  return { updates: normalized, rebound, strippedInvalid };
};


const storylineSemanticStateKey = (value) =>
  normalizeString(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const storylinePassDays = (originDate, stopDate) => {
  const origin = parseIsoDate(originDate);
  const stop = parseIsoDate(stopDate);
  if (origin == null || stop == null) return 0;
  return Math.max(0, Math.round((stop - origin) / 86400000));
};

const storylineMateriallyEvolved = (prior, update) => {
  if (!prior || !update) return true;
  const nextStatus = normalizeString(update.status).toLowerCase();
  if (nextStatus && nextStatus !== normalizeString(prior.status).toLowerCase()) return true;
  if (Math.abs(clampPercent(update.pressure) - clampPercent(prior.pressure)) >= 4) return true;
  if (Math.abs(clampPercent(update.momentum) - clampPercent(prior.momentum)) >= 6) return true;

  const beforeState = storylineSemanticStateKey(prior.state);
  const afterState = storylineSemanticStateKey(update.state);
  if (beforeState && afterState && beforeState !== afterState) return true;

  return normalizeArray(update.eventIndexes).length > 0;
};

// The smallest numeric movement the anti-stasis backstop accepts as real hidden
// evolution. Exported so the motion repair's prompt states the same numbers the
// validator enforces.
export const ANTI_STASIS_MIN_PRESSURE_DELTA = 4;
export const ANTI_STASIS_MIN_MOMENTUM_DELTA = 6;

// The backstop's rule in words, built from the same constants the validator
// (storylineHasObjectiveEvolution) enforces, so no prompt can promise the model
// something the validator then rejects. The main pass, the validator's
// rejection and the motion repair all read it. `withEvent` names the one way
// out only the main pass has: linking a material event, which the repair may
// not manufacture.
export const describeAntiStasisObjectiveRule = ({ withEvent = true } = {}) =>
  `${withEvent ? "link a material event, " : ""}change status, move pressure by ${ANTI_STASIS_MIN_PRESSURE_DELTA} or more points, or move momentum by ${ANTI_STASIS_MIN_MOMENTUM_DELTA} or more points`;

// Whether a storyline is past its anti-stasis backstop at stopDate: an active
// war or high-pressure process with no visible milestone for
// STAGNATION_BACKSTOP_DAYS. The one test behind the repair detector, the
// validator, and the repair prompt, so the three cannot drift apart.
export const storylineAtAntiStasisBackstop = (prior, stopDate, world = null) => {
  if (!prior || normalizeString(prior?.status).toLowerCase() !== "active") return false;
  const activeWar = Boolean(activeCanonicalWarForStoryline(prior, world));
  if (!activeWar && clampPercent(prior?.pressure) < HIGH_PRESSURE_STAGNATION_THRESHOLD) return false;
  return storylineStagnationAgeDays(prior, stopDate) >= STAGNATION_BACKSTOP_DAYS;
};

// Stronger than storylineMateriallyEvolved: this deliberately ignores prose-only
// state rewording. At the 45-day anti-stasis backstop, the model must either link
// a real event, change status, or move pressure/momentum enough to represent an
// actual hidden evolution rather than paraphrasing the same stalemate.
const storylineHasObjectiveEvolution = (prior, update, candidate = null) => {
  if (!prior || !update) return true;
  const nextStatus = normalizeString(update.status).toLowerCase();
  if (nextStatus && nextStatus !== normalizeString(prior.status).toLowerCase()) return true;
  if (Math.abs(clampPercent(update.pressure) - clampPercent(prior.pressure)) >= ANTI_STASIS_MIN_PRESSURE_DELTA) return true;
  if (Math.abs(clampPercent(update.momentum) - clampPercent(prior.momentum)) >= ANTI_STASIS_MIN_MOMENTUM_DELTA) return true;

  const eventIndexes = normalizeArray(update.eventIndexes);
  return Boolean(
    eventIndexes.length &&
    candidate &&
    deferredStorylineReentryHasConcreteTrigger(
      candidate,
      eventIndexes,
      prior,
      update,
      { requireObjectiveDelta: false },
    )
  );
};

// Fix 07.2 / 07.2B — selected-storyline motion is a LOCAL repair concern, not
// a reason to throw away an otherwise-valid whole-world simulation. This detector
// covers both objective anti-stasis failures AND a selected native-attention process
// that the main pass omitted entirely. Callers can preserve the main pass, repair
// only the affected process, and leave a failed repair overdue for the next turn
// instead of falling back the entire world.
export const findWorldStorylineAntiStasisIssues = (
  candidate,
  {
    existingStorylines = [],
    selectedStorylines = [],
    originDate = "",
    stopDate = "",
    world = null,
  } = {},
) => {
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  const updateById = new Map(
    updates
      .map((entry) => [normalizeString(entry?.id), entry])
      .filter(([id]) => Boolean(id)),
  );
  const existingById = new Map(
    normalizeArray(existingStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );

  const issues = [];
  for (const selected of normalizeArray(selectedStorylines)) {
    const id = normalizeString(selected?.id);
    if (!id) continue;
    const prior = existingById.get(id) || normalizeStorylineForDirector(selected);
    if (!prior) continue;

    // When the caller supplies the pass origin, mirror the same native-attention
    // horizon test used by strict validation. Without an origin (older callers and
    // self-tests), selectedStorylines is already treated as the due repair set.
    if (
      normalizeString(originDate) &&
      !storylineNeedsAttentionWithin(selected, originDate, stopDate, world)
    ) {
      continue;
    }

    const update = updateById.get(id);
    const stagnationAgeAtStop = storylineStagnationAgeDays(prior, stopDate);
    const activeWar = Boolean(activeCanonicalWarForStoryline(prior, world));
    // The repair's own validator enforces the backstop on either kind of issue,
    // so the repair prompt has to know when the numeric rule applies.
    const requiresObjectiveDelta = storylineAtAntiStasisBackstop(prior, stopDate, world);

    if (!update) {
      issues.push({
        id,
        prior,
        update: null,
        activeWar,
        kind: "missing-update",
        requiresObjectiveDelta,
        stagnationAgeDays: stagnationAgeAtStop,
        reason: `Native-attention storyline ${id} was omitted from the main pass and needs a local semantic repair through ${stopDate || "the pass horizon"}.`,
      });
      continue;
    }
    if (
      requiresObjectiveDelta &&
      !storylineHasObjectiveEvolution(prior, update, candidate)
    ) {
      issues.push({
        id,
        prior,
        update,
        activeWar,
        kind: "anti-stasis",
        requiresObjectiveDelta,
        stagnationAgeDays: stagnationAgeAtStop,
        reason: `${activeWar ? "Active-war" : "High-pressure"} storyline ${id} has gone ${stagnationAgeAtStop} day(s) without a visible milestone and still has no objective evolution.`,
      });
    }
  }

  return issues;
};

// ---- Motion repair, judged once per skip ------------------------------------
// The repair used to run after every segment with no memory: a 92-day segment
// is longer than the 21-day review and 45-day backstop, so every segment
// re-flagged the same protected storylines, and a four-segment skip could make
// 32 unbounded calls on the same few processes. Segments are a transport
// detail, so the skip is judged as the one round it is: after the last segment,
// each storyline selected at any point is checked once, from where it stood
// before the skip to its last update in it.

// A storyline selected by any segment, first sighting kept: the earliest copy
// is the one closest to the state the skip started from. Deduped by id, so the
// skip-level check sees each storyline once however many segments chose it.
export const mergeSkipAttentionStorylines = (existing = [], incoming = []) => {
  const seen = new Set(normalizeArray(existing).map((entry) => normalizeString(entry?.id)));
  const merged = [...normalizeArray(existing)];
  for (const entry of normalizeArray(incoming)) {
    const id = normalizeString(entry?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(entry);
  }
  return merged;
};

// The skip's storylines as one pass: the last update each storyline received in
// any segment stands for its end state (its numbers are what the ledger ends
// on), and its event links are rebuilt from the skip's events, which carry
// storylineIds once each segment is screened — per-segment eventIndexes point
// into that segment's own events and mean nothing across the skip.
export const findSkipStorylineMotionIssues = ({
  events = [],
  storylineUpdates = [],
  existingStorylines = [],
  selectedStorylines = [],
  originDate = "",
  stopDate = "",
  world = null,
} = {}) => {
  const skipEvents = normalizeArray(events);
  const lastUpdateById = new Map();
  for (const update of decodeWorldStorylineUpdates(storylineUpdates)) {
    const id = normalizeString(update?.id);
    if (id) lastUpdateById.set(id, update);
  }
  const netUpdates = [...lastUpdateById.entries()].map(([id, update]) => ({
    ...update,
    eventIndexes: skipEvents.reduce((indexes, event, index) => {
      if (normalizeArray(event?.storylineIds).map(normalizeString).includes(id)) indexes.push(index);
      return indexes;
    }, []),
  }));
  return findWorldStorylineAntiStasisIssues(
    { events: skipEvents, storylineUpdates: netUpdates },
    { existingStorylines, selectedStorylines, originDate, stopDate, world },
  );
};

// Limits on what the skip's one repair pass may spend. A skipped repair is
// handled exactly like a failed one (the storyline stays overdue for the main
// pass), so these cost staleness, never the turn.

// The most one pass has ever needed: every attention storyline repaired once.
export const MAX_MOTION_REPAIRS_PER_JUMP = MAX_ATTENTION_STORYLINES;
// What repairs may use of one skip in total. None starts once it is spent, and
// the one still running when it runs out is stopped (repairCall.js), so this
// caps the pass rather than only saying when repairs may start.
export const MAX_MOTION_REPAIR_MS_PER_JUMP = 600000;
// A storyline whose repair failed is left to the main pass for this many
// rounds, unless it changes in the meantime. The main pass is told the same
// numeric rule the repair is (describeAntiStasisObjectiveRule), so it can move
// the storyline itself; until it does, the storyline's copy-forwards are
// withdrawn and it stays overdue.
export const MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS = 3;
const MAX_REMEMBERED_MOTION_REPAIR_FAILURES = 64;

export const createMotionRepairBudget = () => ({
  calls: 0,
  ms: 0,
});

// What a failed repair saw. Anything that moves the storyline (a main-pass
// update, a newly linked event) changes it and makes the storyline eligible again.
export const storylineRepairFingerprint = (storyline) => {
  const normalized = normalizeStorylineForDirector(storyline);
  if (!normalized) return "";
  return JSON.stringify([
    normalized.status,
    normalized.pressure,
    normalized.momentum,
    normalized.accountedThroughDate,
    normalized.lastUpdatedDate,
    normalized.lastVisibleEventDate,
    normalized.state,
  ]);
};

const motionRepairFailureKey = (campaignId, id) =>
  `${normalizeString(campaignId)}::${normalizeString(id)}`;

// "" when the issue may be repaired now, otherwise why not.
export const motionRepairSkipReason = (
  issue,
  { budget = null, failures = null, campaignId = "", round = 0 } = {},
) => {
  const id = normalizeString(issue?.id);
  const currentRound = Number(round) || 0;

  // Only a failure from this round or the few before it counts. A round EARLIER
  // than the failure means the player rewound (undo, or an older save of the same
  // campaign): that failure belongs to a future that no longer exists.
  const failure = failures?.get?.(motionRepairFailureKey(campaignId, id));
  if (
    failure &&
    failure.fingerprint === storylineRepairFingerprint(issue?.prior) &&
    currentRound >= failure.round &&
    currentRound < failure.round + MOTION_REPAIR_FAILURE_COOLDOWN_ROUNDS
  ) {
    return "failed-recently";
  }

  if (budget && budget.calls >= MAX_MOTION_REPAIRS_PER_JUMP) return "call-cap";
  if (budget && budget.ms >= MAX_MOTION_REPAIR_MS_PER_JUMP) return "time-budget";
  return "";
};

// Counted whatever the outcome: a failed attempt still spent a call and its time.
export const recordMotionRepairAttempt = (budget, ms = 0) => {
  if (!budget) return;
  budget.calls += 1;
  budget.ms += Math.max(0, Number(ms) || 0);
};

export const recordMotionRepairOutcome = (
  failures,
  { campaignId = "", id = "", fingerprint = "", round = 0, ok = false } = {},
) => {
  if (!failures) return;
  const key = motionRepairFailureKey(campaignId, id);
  failures.delete(key);
  if (ok) return;
  failures.set(key, { fingerprint, round: Number(round) || 0 });
  // Map iteration is insertion order, and the delete above re-inserts a
  // refreshed failure at the end, so the first key is always the oldest.
  while (failures.size > MAX_REMEMBERED_MOTION_REPAIR_FAILURES) {
    failures.delete(failures.keys().next().value);
  }
};

// How long the next repair may run before the skip's repair time is spent.
// The repair call is stopped at this (repairCall.js), so the budget holds
// while a call runs as well as before one starts.
export const motionRepairTimeRemainingMs = (budget) =>
  Math.max(0, MAX_MOTION_REPAIR_MS_PER_JUMP - Math.max(0, Number(budget?.ms) || 0));

// What one repair call means for the pass and for the failure memory. Its
// time always counts against the skip's budget. A repair stopped because the
// PASS ran out of time is not the storyline failing: it is left overdue like
// any issue past the budget and starts no cooldown, so the next skip may try
// it again. Returns "repaired", "failed" or "stopped-at-time-budget".
export const settleMotionRepairCall = (
  issue,
  { budget = null, failures = null, campaignId = "", round = 0, ms = 0, ok = false, stoppedAtTimeBudget = false } = {},
) => {
  recordMotionRepairAttempt(budget, ms);
  if (!ok && stoppedAtTimeBudget) return "stopped-at-time-budget";
  recordMotionRepairOutcome(failures, {
    campaignId,
    id: normalizeString(issue?.id),
    fingerprint: storylineRepairFingerprint(issue?.prior),
    round,
    ok,
  });
  return ok ? "repaired" : "failed";
};

// Each segment's storylineUpdates once the skip's motion repair pass has
// settled. The skip's copy-forwards are withdrawn for every settled storyline
// (repaired, failed or skipped) that existed before the skip: a failed or
// skipped one then keeps its old accounted/review dates and stays overdue next
// turn instead of being silently pushed forward, and a repaired one ends on its
// repair. A storyline BORN in the skip keeps its updates — withdrawing them
// would erase it. The repairs ride on the last segment, after its own updates,
// so they are the last word on their storylines when the merged updates are
// applied in order.
//
// One entry per segment, index for index. An entry nothing touched comes back
// as it went in (internal transport may be object records after schema
// validation, and the native decoder accepts that form), so an untouched
// segment is never rewritten.
export const settleSkipStorylineUpdates = (
  segmentUpdates = [],
  { settledIds = [], preSkipIds = [], repairedUpdates = [] } = {},
) => {
  const preSkip = new Set([...(preSkipIds ?? [])].map((id) => normalizeString(id)).filter(Boolean));
  const withdraw = new Set(
    [...(settledIds ?? [])].map((id) => normalizeString(id)).filter((id) => id && preSkip.has(id)),
  );
  const settled = (Array.isArray(segmentUpdates) ? segmentUpdates : []).map((raw) => {
    if (!withdraw.size) return raw;
    const updates = decodeWorldStorylineUpdates(raw);
    if (!updates.some((entry) => withdraw.has(normalizeString(entry?.id)))) return raw;
    return updates.filter((entry) => !withdraw.has(normalizeString(entry?.id)));
  });
  const repairs = normalizeArray(repairedUpdates);
  if (repairs.length && settled.length) {
    const last = settled.length - 1;
    settled[last] = [...decodeWorldStorylineUpdates(settled[last]), ...repairs];
  }
  return settled;
};

// Surgical salvage for deferred-storyline bookkeeping mistakes.
//
// Deferred storylines are outside the native attention window. The model may still
// mention their actors, but an existing deferred storyline is allowed to re-enter
// only when this pass actually contains a concrete endogenous/external trigger.
// A single invalid deferred update must never discard unrelated valid events from
// an otherwise-good whole-world response.
//
// We therefore remove BOTH:
//   1) quiet deferred bookkeeping records with no event link; and
//   2) linked deferred records whose linked event(s) still fail the SAME concrete-
//      trigger predicate used by validateWorldStorylinePayload.
//
// When case (2) is salvaged, the invalid storyline id is also removed from the
// linked event's storylineIds. The event itself survives and can still be judged by
// the normal consequence/integrity/Curator paths on its own merits.
export const stripQuietDeferredStorylineUpdates = (
  candidate,
  deferredStorylines = [],
) => {
  if (!candidate || typeof candidate !== "object") {
    return {
      strippedIds: [],
      strippedQuietIds: [],
      strippedNonMaterialIds: [],
      unlinkedEventIndexes: [],
    };
  }

  const deferredById = new Map(
    normalizeArray(deferredStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [normalizeString(entry.id), entry])
      .filter(([id]) => Boolean(id)),
  );

  if (!deferredById.size) {
    return {
      strippedIds: [],
      strippedQuietIds: [],
      strippedNonMaterialIds: [],
      unlinkedEventIndexes: [],
    };
  }

  const raw = candidate.storylineUpdates;
  const strippedQuietIds = [];
  const strippedNonMaterialIds = [];
  const unlinkByEventIndex = new Map();

  const classifyStrip = (entry) => {
    const parsed = typeof entry === "string"
      ? parseStorylineRecord(entry)
      : decodeWorldStorylineUpdates([entry])[0];
    if (!parsed) return false;

    const id = normalizeString(parsed.id);
    const deferred = deferredById.get(id);
    if (!deferred) return false;

    const eventIndexes = normalizeArray(parsed.eventIndexes)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0);

    if (!eventIndexes.length) {
      strippedQuietIds.push(id);
      return true;
    }

    if (
      deferredStorylineReentryHasConcreteTrigger(
        candidate,
        eventIndexes,
        deferred,
        parsed,
      )
    ) {
      return false;
    }

    strippedNonMaterialIds.push(id);
    for (const eventIndex of eventIndexes) {
      if (!unlinkByEventIndex.has(eventIndex)) unlinkByEventIndex.set(eventIndex, new Set());
      unlinkByEventIndex.get(eventIndex).add(id);
    }
    return true;
  };

  if (Array.isArray(raw)) {
    candidate.storylineUpdates = raw.filter((entry) => !classifyStrip(entry));
  } else {
    const lines = String(raw ?? "")
      .split(/\r?\n/)
      .filter((line) => normalizeString(line));
    candidate.storylineUpdates = lines
      .filter((line) => !classifyStrip(line))
      .join("\n");
  }

  const events = normalizeArray(candidate.events);
  for (const [eventIndex, ids] of unlinkByEventIndex) {
    const event = events[eventIndex];
    if (!event || typeof event !== "object") continue;
    event.storylineIds = normalizeArray(event.storylineIds)
      .map(normalizeString)
      .filter((id) => id && !ids.has(id));
  }

  const strippedIds = [...new Set([
    ...strippedQuietIds,
    ...strippedNonMaterialIds,
  ])];

  return {
    strippedIds,
    strippedQuietIds: [...new Set(strippedQuietIds)],
    strippedNonMaterialIds: [...new Set(strippedNonMaterialIds)],
    unlinkedEventIndexes: [...unlinkByEventIndex.keys()].sort((a, b) => a - b),
  };
};

export const validateWorldStorylinePayload = (
  candidate,
  {
    existingStorylines = [],
    selectedStorylines = [],
    deferredStorylines = [],
    originDate = "",
    stopDate = "",
    enforceAntiStasis = true,
    enforceSelectedCoverage = true,
    world = null,
  } = {},
) => {
  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  const updateById = new Map();

  if (updates.length > MAX_STORYLINE_UPDATES_PER_JUMP) {
    return `$.storylineUpdates may contain at most ${MAX_STORYLINE_UPDATES_PER_JUMP} records.`;
  }

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    const id = normalizeString(update?.id);
    if (!id) return `$.storylineUpdates record ${index + 1} must have an id.`;
    if (updateById.has(id)) {
      return `$.storylineUpdates contains duplicate storyline id ${id}.`;
    }
    updateById.set(id, update);

    const status = normalizeString(update?.status).toLowerCase();
    if (!["active", "dormant", "resolved"].includes(status)) {
      return `$.storylineUpdates record ${index + 1} status must be active, dormant, or resolved.`;
    }
    if (!normalizeString(update?.state)) {
      return `$.storylineUpdates record ${index + 1} must describe the process state through ${stopDate || "the jump horizon"}.`;
    }

    const started = normalizeString(update?.startedDate);
    if (started && parseIsoDate(started) == null) {
      return `$.storylineUpdates record ${index + 1} startedDate must be YYYY-MM-DD or blank.`;
    }

    for (const eventIndex of normalizeArray(update?.eventIndexes)) {
      if (eventIndex < 0 || eventIndex >= normalizeArray(candidate?.events).length) {
        return `$.storylineUpdates record ${index + 1} references event ${eventIndex + 1}, but only ${normalizeArray(candidate?.events).length} event(s) exist.`;
      }
    }
  }

  const existingById = new Map(
    normalizeArray(existingStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );
  const passDays = storylinePassDays(originDate, stopDate);

  for (const selected of normalizeArray(selectedStorylines)) {
    if (!storylineNeedsAttentionWithin(selected, originDate, stopDate, world)) continue;
    const id = normalizeString(selected?.id);
    if (!id) continue;
    const update = updateById.get(id);
    if (!update) {
      if (enforceSelectedCoverage) {
        return `$.storylineUpdates must include native-attention storyline ${id} (${normalizeString(selected?.title) || "untitled"}) with its semantic state through ${stopDate}.`;
      }
      // Whole-world generation may preserve otherwise-valid events and hand this
      // one missing selected process to the targeted local repair seam. The strict
      // default remains unchanged for all other callers.
      continue;
    }

    // Momentum must have mechanical meaning. A high-momentum process cannot
    // claim that several weeks passed while its status, numeric trajectory,
    // visible milestones, AND semantic state all remained unchanged.
    const prior = existingById.get(id) || normalizeStorylineForDirector(selected);
    const activeWar = Boolean(activeCanonicalWarForStoryline(prior, world));

    // Hidden numeric direction must agree with the linked visible development.
    // Failed talks + renewed threats cannot quietly lower crisis pressure unless
    // the same event establishes a concrete de-escalatory fact.
    //
    // Only for a storyline that is actually a crisis: pressure already at the
    // high-pressure threshold, or a war. The cue list is plain keywords, and on
    // a quiet programme they fire on ordinary words — a player's Iranian cyber
    // programme at pressure 18 lost a whole jump to the canned fallback because
    // its event "deploys" new cryptographic hardware and it eased from 18 to 14.
    // A low-pressure process drifting a few points lower is not crisis pressure
    // being quietly erased. "Crisis" is judged from the numbers the engine keeps,
    // not from the storyline's kind label: the model writes that label freely
    // and could call a hardware rollout a crisis.
    const crisisStoryline =
      activeWar ||
      normalizeString(prior?.kind).toLowerCase() === "war" ||
      clampPercent(prior?.pressure) >= HIGH_PRESSURE_STAGNATION_THRESHOLD;
    const linkedEventText = normalizeArray(update?.eventIndexes)
      .map((eventIndex) => normalizeArray(candidate?.events)[eventIndex])
      .filter(Boolean)
      .map((event) =>
        `${normalizeString(event?.title)} ${normalizeString(event?.description)}`
      )
      .join(" ");
    const pressureDelta =
      clampPercent(update?.pressure) - clampPercent(prior?.pressure);
    if (
      crisisStoryline &&
      pressureDelta <= -4 &&
      STORYLINE_ESCALATION_OR_FAILURE_RE.test(linkedEventText) &&
      !STORYLINE_DEESCALATION_RE.test(linkedEventText)
    ) {
      return `Storyline ${id} lowers pressure by ${Math.abs(pressureDelta)} point(s), but its linked event(s) contain escalation/failure cues and no concrete de-escalatory outcome. Keep/increase pressure, or establish the factual de-escalation that justifies the drop.`;
    }

    if (
      passDays >= 21 &&
      clampPercent(prior?.momentum) >= 70 &&
      !storylineMateriallyEvolved(prior, update)
    ) {
      return `High-momentum storyline ${id} (${clampPercent(prior?.momentum)}) did not materially evolve during the ${passDays}-day internal world pass. Advance it, cool its momentum, resolve/dormant it, or describe a genuinely changed state; do not silently freeze it.`;
    }

    const stagnationAgeAtStop = storylineStagnationAgeDays(prior, stopDate);
    if (
      enforceAntiStasis &&
      storylineAtAntiStasisBackstop(prior, stopDate, world) &&
      !storylineHasObjectiveEvolution(prior, update, candidate)
    ) {
      return `${activeWar ? "Active-war" : "High-pressure"} storyline ${id} has gone ${stagnationAgeAtStop} day(s) without a visible milestone and reached the ${STAGNATION_BACKSTOP_DAYS}-day anti-stasis backstop. Do not copy the same equilibrium forward again — reworded prose with the same numbers is rejected. You must ${describeAntiStasisObjectiveRule()}.`;
    }
  }

  // Scheduler authority is native, but scheduling controls ATTENTION rather than
  // permission for history to happen. A deferred existing storyline may not receive
  // a quiet bookkeeping update merely because it exists; however, its own actors
  // and internal conditions remain autonomous. A linked MATERIAL endogenous
  // development (or external trigger) may reactivate it. Routine artillery/patrol
  // continuation and prose-only rewording still do not qualify.
  const deferredById = new Map(
    normalizeArray(deferredStorylines)
      .map(normalizeStorylineForDirector)
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );

  for (const [id, deferred] of deferredById) {
    const update = updateById.get(id);
    if (!update) continue;

    const eventIndexes = normalizeArray(update?.eventIndexes);
    if (!eventIndexes.length) {
      return `Deferred storyline ${id} (${normalizeString(deferred?.title) || "untitled"}) is outside focused attention and may not receive a quiet bookkeeping update. Leave it untouched unless this pass produces a linked material endogenous development or external trigger.`;
    }

    if (
      !deferredStorylineReentryHasConcreteTrigger(
        candidate,
        eventIndexes,
        deferred,
        update,
      )
    ) {
      return `Deferred storyline ${id} (${normalizeString(deferred?.title) || "untitled"}) re-entered without a material development. Its actors may act autonomously, but routine artillery/patrol continuation, meetings, weather-only stasis, or fresh wording of the same state do not qualify.`;
    }
  }

  return "";
};

export const applyWorldStorylineUpdates = ({
  world,
  updates,
  events = [],
  stopDate = "",
  round = 0,
} = {}) => {
  const coalescedExisting = coalesceWorldStorylines(world);
  const existing = coalescedExisting.storylines;
  const actorResolver = createWorldActorResolver(world);
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const canonicalStorylineId = (value) => {
    const id = normalizeString(value);
    return coalescedExisting.aliasToCanonical.get(id) || id;
  };

  const linkedEvents = new Map();
  for (const event of normalizeArray(events)) {
    for (const rawId of normalizeArray(event?.storylineIds).map(normalizeString).filter(Boolean)) {
      const id = canonicalStorylineId(rawId);
      if (!linkedEvents.has(id)) linkedEvents.set(id, []);
      linkedEvents.get(id).push(event);
    }
  }

  const decodedUpdates = decodeWorldStorylineUpdates(updates);
  const appliedIds = [];

  for (let index = 0; index < decodedUpdates.length; index += 1) {
    const raw = decodedUpdates[index];
    const requestedId = normalizeString(raw?.id);
    const id = canonicalStorylineId(requestedId);
    if (!id) continue;

    const prior = byId.get(id) || null;
    const statusRaw = normalizeString(raw?.status).toLowerCase();
    const status = ["active", "dormant", "resolved"].includes(statusRaw)
      ? statusRaw
      : (prior?.status || "active");
    const pressure = clampPercent(raw?.pressure, prior?.pressure || 0);
    const momentum = clampPercent(raw?.momentum, prior?.momentum || 0);
    const accountedThroughDate = normalizeString(stopDate || prior?.accountedThroughDate);

    const related = linkedEvents.get(id) || [];
    const relatedDates = related
      .map((event) => normalizeString(event?.date))
      .filter((date) => parseIsoDate(date) != null)
      .sort();
    const earliestVisible = relatedDates[0] || "";
    const newestVisible = relatedDates.at(-1) || "";

    const sourceEventIds = [...new Set([
      ...normalizeArray(prior?.sourceEventIds),
      ...related.map((event) => normalizeString(event?.id)).filter(Boolean),
    ])].slice(-16);

    const title =
      normalizeString(raw?.title) ||
      normalizeString(prior?.title) ||
      normalizeString(related[0]?.title) ||
      id.replace(/^storyline[-_:]?/i, "").replaceAll("-", " ");
    const kind =
      normalizeString(raw?.kind) ||
      normalizeString(prior?.kind) ||
      normalizeString(related[0]?.kind) ||
      "world";
    // Storyline participant lists are cumulative causal membership, not a
    // replacement projection of whichever actors happened to appear in the latest
    // event. Omission can never silently eject Japan/China/Russia/etc. from a
    // six-party crisis. Incoming aliases are canonicalized against current world
    // identity first, then merged with the prior participant set.
    const priorParticipants = normalizeArray(prior?.participants)
      .map((actor) => actorResolver.canonical(actor))
      .map(normalizeString)
      .filter(Boolean);
    const incomingParticipants = normalizeArray(raw?.participants)
      .map((actor) => actorResolver.canonical(actor))
      .map(normalizeString)
      .filter(Boolean);
    const nextParticipants = [...new Set([
      ...priorParticipants,
      ...incomingParticipants,
    ])].slice(0, 12);

    const rawStarted = normalizeString(raw?.startedDate);
    const validRawStarted = parseIsoDate(rawStarted) != null ? rawStarted : "";
    const activeWar = Boolean(activeCanonicalWarForStoryline({
      ...(prior || {}),
      id,
      kind,
      participants: nextParticipants,
      status,
    }, world));

    const next = normalizeStorylineForDirector({
      ...prior,
      id,
      kind,
      title,
      participants: nextParticipants,
      status,
      pressure,
      momentum,
      startedDate: prior?.startedDate || validRawStarted || earliestVisible || accountedThroughDate,
      accountedThroughDate,
      lastUpdatedDate: accountedThroughDate || prior?.lastUpdatedDate,
      lastVisibleEventDate: newestVisible || prior?.lastVisibleEventDate || "",
      nextReviewDate: clampNextReviewDate({
        stopDate: accountedThroughDate,
        pressure,
        momentum,
        status,
        requested: "",
        activeWar,
      }),
      state: normalizeString(raw?.state) || prior?.state || title,
      drivers: normalizeArray(prior?.drivers),
      constraints: normalizeArray(prior?.constraints),
      sourceEventIds,
      createdRound: prior?.createdRound || Math.max(0, Math.trunc(Number(round) || 0)),
      updatedRound: Math.max(0, Math.trunc(Number(round) || 0)),
    }, index);

    if (!next) continue;
    byId.set(id, next);
    appliedIds.push(id);
  }

  // R3.7 bookkeeping salvage: visible causal linkage is objective history even
  // when the semantic storyline update was omitted/rejected. Do NOT invent a new
  // state/pressure/momentum here; simply advance lastVisibleEventDate and source
  // provenance for existing storylines so a March event cannot still look 100+
  // days invisible in May. Semantic review remains due independently.
  const semanticallyApplied = new Set(appliedIds);
  for (const [id, related] of linkedEvents) {
    if (semanticallyApplied.has(id)) continue;
    const prior = byId.get(id);
    if (!prior) continue;

    const relatedDates = normalizeArray(related)
      .map((event) => normalizeString(event?.date))
      .filter((date) => parseIsoDate(date) != null)
      .sort();
    const newestVisible = relatedDates.at(-1) || "";
    if (!newestVisible) continue;

    const priorVisible = normalizeString(prior?.lastVisibleEventDate);
    const nextVisible =
      parseIsoDate(priorVisible) == null || newestVisible > priorVisible
        ? newestVisible
        : priorVisible;

    const sourceEventIds = [...new Set([
      ...normalizeArray(prior?.sourceEventIds),
      ...normalizeArray(related).map((event) => normalizeString(event?.id)).filter(Boolean),
    ])].slice(-16);

    byId.set(id, {
      ...prior,
      lastVisibleEventDate: nextVisible,
      sourceEventIds,
    });
  }

  const postMerge = coalesceWorldStorylines({
    ...(world && typeof world === "object" ? world : {}),
    storylines: [...byId.values()],
  });
  const statusRank = { active: 0, dormant: 1, resolved: 2 };
  const storylines = postMerge.storylines
    .sort((a, b) =>
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
      compareGameDates(b.lastUpdatedDate || "", a.lastUpdatedDate || "") ||
      a.id.localeCompare(b.id)
    )
    .slice(0, MAX_PERSISTED_STORYLINES);

  return {
    world: {
      ...(world && typeof world === "object" ? world : {}),
      storylines,
    },
    appliedIds,
    storylines,
  };
};


const resolveCountryStatEntry = (worldLike, token) => {
  const world = worldLike && typeof worldLike === "object" ? worldLike : {};
  const raw = normalizeString(token);
  if (!raw) return null;

  const countryStats = world.countryStats && typeof world.countryStats === "object"
    ? world.countryStats
    : {};
  const directKey = Object.keys(countryStats)
    .find((key) => normalizeString(key).toLowerCase() === raw.toLowerCase());
  if (directKey) return { key: directKey, sheet: countryStats[directKey] };

  const overrides = world.polityOverrides && typeof world.polityOverrides === "object"
    ? world.polityOverrides
    : {};
  for (const [key, polity] of Object.entries(overrides)) {
    const names = [
      key,
      polity?.code,
      polity?.name,
      ...normalizeArray(polity?.aliases),
    ]
      .map(normalizeString)
      .filter(Boolean);
    if (!names.some((name) => name.toLowerCase() === raw.toLowerCase())) continue;

    const statKey = Object.keys(countryStats)
      .find((candidate) => normalizeString(candidate).toLowerCase() === normalizeString(key).toLowerCase());
    if (statKey) return { key: statKey, sheet: countryStats[statKey] };
  }

  return null;
};

const buildEconomicAttentionContext = (bundle, storylineAttention, extraActors = []) => {
  const world = bundle?.world || {};
  const requested = [
    normalizeString(bundle?.game?.country),
    ...normalizeArray(storylineAttention?.selected)
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map(normalizeString),
    ...normalizeArray(extraActors).map(normalizeString),
  ].filter(Boolean);

  const seen = new Set();
  const rows = [];
  for (const actor of requested) {
    if (rows.length >= MAX_ECONOMIC_ACTORS) break;
    const key = actor.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const resolved = resolveCountryStatEntry(world, actor);
    // Partial sheets can exist after a leadership-only event. They are useful as
    // persistence scaffolding but are NOT a canonical economic baseline. Do not
    // let a stray debt/growth field masquerade as a complete national economy.
    if (!resolved?.sheet || !isCompleteCountryStatSheet(resolved.sheet)) continue;
    const summary = buildCompactEconomicContext(resolved.sheet, { name: actor });
    if (!summary) continue;

    rows.push({
      actor,
      canonicalKey: resolved.key,
      summary: truncate(summary, 620),
    });
  }

  return rows;
};

const candidateKey = (candidate) =>
  `${normalizeString(candidate?.type).toLowerCase()}|${normalizeString(candidate?.title).toLowerCase()}|${normalizeString(candidate?.detail).toLowerCase()}`;

const candidateStorylineKeys = (candidate) =>
  [...new Set(
    normalizeArray(candidate?.storylineIds)
      .map((id) => normalizeString(id).toLowerCase())
      .filter(Boolean),
  )];

const selectBoundedCandidates = (rankedCandidates, limit) => {
  const pool = normalizeArray(rankedCandidates).map((candidate) => ({ ...candidate }));
  const selected = [];
  const storylineUse = new Map();
  const typeUse = new Map();
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || DEFAULT_MAX_CANDIDATES));

  while (pool.length > 0 && selected.length < boundedLimit) {
    let bestIndex = 0;
    let bestAdjusted = -Infinity;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const storylinePenalty = candidateStorylineKeys(candidate)
        .reduce(
          (sum, key) =>
            sum + (storylineUse.get(key) || 0) * CANDIDATE_STORYLINE_REPEAT_PENALTY,
          0,
        );
      const typeKey = normalizeString(candidate?.type).toLowerCase() || "unknown";
      const typePenalty = Math.max(0, (typeUse.get(typeKey) || 0) - 1) *
        CANDIDATE_TYPE_REPEAT_PENALTY;
      const trajectoryValue = Number.isFinite(Number(candidate?.trajectoryValue))
        ? Math.max(0, Math.min(5, Number(candidate.trajectoryValue)))
        : deriveWorldTrajectoryValue(candidate);
      const adjusted =
        (Number(candidate?.score) || 0) +
        trajectoryValue * CANDIDATE_TRAJECTORY_WEIGHT -
        storylinePenalty -
        typePenalty;

      if (
        adjusted > bestAdjusted ||
        (
          adjusted === bestAdjusted &&
          (
            (Number(candidate?.score) || 0) > (Number(pool[bestIndex]?.score) || 0) ||
            (
              (Number(candidate?.score) || 0) === (Number(pool[bestIndex]?.score) || 0) &&
              (
                Number.isFinite(Number(candidate?.ageDays)) ? Number(candidate.ageDays) : 99999
              ) <
              (
                Number.isFinite(Number(pool[bestIndex]?.ageDays)) ? Number(pool[bestIndex].ageDays) : 99999
              )
            )
          )
        )
      ) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    const storylineKeys = candidateStorylineKeys(picked);
    const typeKey = normalizeString(picked?.type).toLowerCase() || "unknown";
    selected.push({
      ...picked,
      trajectoryValue: Number.isFinite(Number(picked?.trajectoryValue))
        ? Math.max(0, Math.min(5, Number(picked.trajectoryValue)))
        : deriveWorldTrajectoryValue(picked),
      adjustedSelectionScore: Math.round(bestAdjusted * 10) / 10,
    });

    for (const key of storylineKeys) {
      storylineUse.set(key, (storylineUse.get(key) || 0) + 1);
    }
    typeUse.set(typeKey, (typeUse.get(typeKey) || 0) + 1);
  }

  return selected;
};

const runWorldDirectorSelfTests = () => {
  const fixtureWorld = {
    wars: [
      {
        id: "polish-war-of-independence",
        status: "active",
        sideA: ["Poland"],
        sideB: ["Russian Empire"],
      },
      {
        id: "austro-serbian-war",
        status: "active",
        sideA: ["Austria-Hungary"],
        sideB: ["Kingdom of Serbia"],
      },
    ],
    storylines: [
      {
        id: "storyline-polish-war-of-independence",
        kind: "war",
        title: "War of Polish Independence",
        participants: ["Poland", "Russian Empire"],
        status: "active",
        pressure: 85,
        momentum: 30,
        startedDate: "1915-04-18",
        accountedThroughDate: "1916-03-13",
        lastUpdatedDate: "1916-03-13",
        state: "Older canonical-id copy.",
        sourceEventIds: ["polish-a"],
      },
      {
        id: "storyline-polish-independence",
        kind: "war",
        title: "War of Polish Independence",
        participants: ["Poland", "Russian Empire"],
        status: "active",
        pressure: 72,
        momentum: 18,
        startedDate: "1915-04-18",
        accountedThroughDate: "1916-04-12",
        lastUpdatedDate: "1916-04-12",
        state: "Newer duplicate-id copy.",
        sourceEventIds: ["polish-b"],
      },
      {
        id: "storyline-july-crisis",
        kind: "war",
        title: "Austro-Serbian War",
        participants: ["Austria-Hungary", "Kingdom of Serbia"],
        status: "active",
        pressure: 68,
        momentum: 20,
        startedDate: "1914-06-28",
        accountedThroughDate: "1916-05-12",
        lastUpdatedDate: "1916-05-12",
        state: "Freshest Austro-Serbian state.",
        sourceEventIds: ["serbia-a"],
      },
      {
        id: "storyline-austro-serbian-war",
        kind: "war",
        title: "Austro-Serbian War",
        participants: ["Austria-Hungary", "Kingdom of Serbia"],
        status: "active",
        pressure: 80,
        momentum: 25,
        startedDate: "1914-07-28",
        accountedThroughDate: "1916-03-13",
        lastUpdatedDate: "1916-03-13",
        state: "Older canonical-id Austro-Serbian copy.",
        sourceEventIds: ["serbia-b"],
      },
    ],
  };

  const merged = coalesceWorldStorylines(fixtureWorld);
  const polish = merged.storylines.find((entry) =>
    entry.id === "storyline-polish-war-of-independence"
  );
  const serbia = merged.storylines.find((entry) =>
    entry.id === "storyline-austro-serbian-war"
  );

  const cases = [
    {
      name: "semantic duplicate wars collapse",
      pass: merged.storylines.length === 2 && merged.mergedDuplicateCount === 2,
      detail: `${merged.storylines.length} storyline(s), ${merged.mergedDuplicateCount} duplicate(s) merged`,
    },
    {
      name: "canonical war storyline id survives newer alias",
      pass:
        polish?.id === "storyline-polish-war-of-independence" &&
        polish?.state === "Newer duplicate-id copy." &&
        normalizeArray(polish?.sourceEventIds).includes("polish-a") &&
        normalizeArray(polish?.sourceEventIds).includes("polish-b"),
      detail: polish?.id || "",
    },
    {
      name: "canonical Austro-Serbian id keeps freshest state",
      pass:
        serbia?.id === "storyline-austro-serbian-war" &&
        serbia?.state === "Freshest Austro-Serbian state.",
      detail: serbia?.id || "",
    },
    {
      name: "360-day event is not current initiative evidence",
      pass: !recentEventEligibleForInitiative(
        { date: "1915-04-18" },
        "1916-04-12",
      ),
      detail: "1915-04-18 → 1916-04-12",
    },
    {
      name: "30-day storyline event remains current initiative evidence",
      pass: recentEventEligibleForInitiative(
        {
          date: "1916-03-13",
          importance: "minor",
          storylineIds: ["storyline-test"],
          impacts: {},
        },
        "1916-04-12",
      ),
      detail: "1916-03-13 storyline-linked",
    },
    {
      name: "minor no-impact narrative card is not a causal seed",
      pass: !recentEventEligibleForInitiative(
        {
          date: "1916-01-29",
          importance: "minor",
          notable: false,
          playerRelated: false,
          kind: "world",
          storylineIds: [],
          impacts: {},
        },
        "1916-04-12",
      ),
      detail: "minor + no impacts + no storyline",
    },
    {
      name: "minor structured event remains a causal seed",
      pass: recentEventEligibleForInitiative(
        {
          date: "1916-03-20",
          importance: "minor",
          notable: false,
          storylineIds: [],
          impacts: { markerOps: [{ op: "build" }] },
        },
        "1916-04-12",
      ),
      detail: "minor + persistent impact",
    },
  ];

  const stagnantHighPressure = {
    id: "storyline-motion-test",
    kind: "war",
    title: "Motion Test War",
    participants: ["Poland", "Russian Empire"],
    status: "active",
    pressure: 78,
    momentum: 20,
    startedDate: "1916-01-01",
    accountedThroughDate: "1916-06-11",
    lastUpdatedDate: "1916-06-11",
    lastVisibleEventDate: "1916-04-20",
    nextReviewDate: "1916-09-01",
    state: "A high-pressure stalemate remains unchanged.",
  };

  cases.push({
    name: "21-day high-pressure stagnation overrides later review date",
    pass: storylineNeedsAttentionWithin(
      stagnantHighPressure,
      "1916-06-11",
      "1916-07-11",
    ),
    detail: `stagnation ${storylineStagnationAgeDays(stagnantHighPressure, "1916-07-11")}d`,
  });

  const stagnantError = validateWorldStorylinePayload(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 78,
        momentum: 20,
        eventIndexes: [],
        state: "A high-pressure stalemate remains unchanged.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
    },
  );

  cases.push({
    name: "45-day high-pressure anti-stasis rejects copy-forward",
    pass: /anti-stasis backstop/i.test(stagnantError),
    detail: stagnantError || "unexpectedly accepted",
  });

  const repairIssues = findWorldStorylineAntiStasisIssues(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 78,
        momentum: 20,
        eventIndexes: [],
        state: "A high-pressure stalemate remains unchanged.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      stopDate: "1916-07-11",
    },
  );

  const nonFatalStagnantError = validateWorldStorylinePayload(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 78,
        momentum: 20,
        eventIndexes: [],
        state: "A high-pressure stalemate remains unchanged.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
      enforceAntiStasis: false,
    },
  );

  cases.push({
    name: "45-day anti-stasis is detectable without invalidating whole pass",
    pass: repairIssues.length === 1 && repairIssues[0]?.id === stagnantHighPressure.id && nonFatalStagnantError === "",
    detail: `${repairIssues.length} repair issue(s); validation ${nonFatalStagnantError || "accepted"}`,
  });

  const missingSelectedCandidate = {
    events: [],
    storylineUpdates: [],
  };
  const missingSelectedStrictError = validateWorldStorylinePayload(
    missingSelectedCandidate,
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
      enforceAntiStasis: false,
    },
  );
  const missingSelectedRepairableError = validateWorldStorylinePayload(
    missingSelectedCandidate,
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
      enforceAntiStasis: false,
      enforceSelectedCoverage: false,
    },
  );
  const missingSelectedIssues = findWorldStorylineAntiStasisIssues(
    missingSelectedCandidate,
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
    },
  );

  cases.push({
    name: "missing native-attention update becomes local repair instead of whole-pass failure",
    pass:
      /must include native-attention storyline/i.test(missingSelectedStrictError) &&
      missingSelectedRepairableError === "" &&
      missingSelectedIssues.length === 1 &&
      missingSelectedIssues[0]?.kind === "missing-update" &&
      missingSelectedIssues[0]?.id === stagnantHighPressure.id,
    detail:
      `strict=${missingSelectedStrictError || "accepted"}; ` +
      `repairable=${missingSelectedRepairableError || "accepted"}; ` +
      `issues=${missingSelectedIssues.map((issue) => `${issue.kind}:${issue.id}`).join(", ") || "none"}`,
  });

  const evolvedError = validateWorldStorylinePayload(
    {
      events: [],
      storylineUpdates: [{
        ...stagnantHighPressure,
        pressure: 74,
        momentum: 28,
        eventIndexes: [],
        state: "The front remains intact, but both commands reorganize and operational tempo begins to recover.",
      }],
    },
    {
      existingStorylines: [stagnantHighPressure],
      selectedStorylines: [stagnantHighPressure],
      deferredStorylines: [],
      originDate: "1916-06-11",
      stopDate: "1916-07-11",
    },
  );

  cases.push({
    name: "45-day backstop accepts objective hidden evolution",
    pass: evolvedError === "",
    detail: evolvedError || "pressure/momentum changed",
  });

  const lowPressureActiveWar = {
    id: "storyline-polish-war-of-independence",
    kind: "war",
    title: "War of Polish Independence",
    participants: ["Poland", "Russian Empire"],
    status: "active",
    pressure: 65,
    momentum: 25,
    startedDate: "1915-04-18",
    accountedThroughDate: "1916-12-08",
    lastUpdatedDate: "1916-12-08",
    lastVisibleEventDate: "1916-11-20",
    nextReviewDate: "1917-04-07",
    state: "Winter positions hold while the active war remains unresolved.",
  };

  cases.push({
    name: "21-day active-war review overrides pressure cliff",
    pass: storylineNeedsAttentionWithin(
      lowPressureActiveWar,
      "1917-01-07",
      "1917-02-06",
      fixtureWorld,
    ),
    detail: `review age ${storylineReviewAgeDays(lowPressureActiveWar, "1917-02-06")}d at pressure ${lowPressureActiveWar.pressure}`,
  });

  const lowPressureWarAntiStasis = findWorldStorylineAntiStasisIssues(
    {
      events: [],
      storylineUpdates: [{
        ...lowPressureActiveWar,
        pressure: 65,
        momentum: 25,
        eventIndexes: [],
        state: lowPressureActiveWar.state,
      }],
    },
    {
      existingStorylines: [lowPressureActiveWar],
      selectedStorylines: [lowPressureActiveWar],
      stopDate: "1917-02-06",
      world: fixtureWorld,
    },
  );

  cases.push({
    name: "45-day active-war anti-stasis ignores pressure cliff",
    pass:
      lowPressureWarAntiStasis.length === 1 &&
      lowPressureWarAntiStasis[0]?.activeWar === true,
    detail: `${lowPressureWarAntiStasis.length} issue(s) at pressure ${lowPressureActiveWar.pressure}`,
  });

  const lowPressureNonWar = {
    ...lowPressureActiveWar,
    id: "storyline-domestic-control",
    kind: "politics",
    title: "Domestic Control Test",
    participants: ["Poland"],
    nextReviewDate: "1917-04-07",
  };

  cases.push({
    name: "non-war pressure 65 enters high-pressure review cadence",
    pass: storylineNeedsAttentionWithin(
      lowPressureNonWar,
      "1917-01-07",
      "1917-02-06",
      fixtureWorld,
    ),
    detail: "pressure 65 is now above the 55 high-pressure guard",
  });

  cases.push({
    name: "active-war persisted review cadence caps at 21 days",
    pass: recommendedReviewDays(65, 25, "active", { activeWar: true }) === 21,
    detail: `${recommendedReviewDays(65, 25, "active", { activeWar: true })}d`,
  });

  const deferredQuietCandidate = {
    events: [{
      title: "Independent material event",
      description: "A separate development occurs elsewhere.",
      impacts: {},
    }],
    storylineUpdates: [
      {
        id: "storyline-selected-test",
        status: "active",
        pressure: 72,
        momentum: 24,
        startedDate: "1916-01-01",
        kind: "war",
        title: "Selected Test War",
        participants: ["Poland", "Russian Empire"],
        eventIndexes: [0],
        state: "A material development changes the selected process.",
      },
      {
        id: "storyline-deferred-quiet-test",
        status: "active",
        pressure: 35,
        momentum: 15,
        startedDate: "1915-01-01",
        kind: "diplomacy",
        title: "Deferred Quiet Test",
        participants: ["German Empire", "British Empire"],
        eventIndexes: [],
        state: "The quiet detente remains unchanged.",
      },
    ],
  };
  const quietSalvage = stripQuietDeferredStorylineUpdates(
    deferredQuietCandidate,
    [{
      id: "storyline-deferred-quiet-test",
      status: "active",
      pressure: 35,
      momentum: 15,
      title: "Deferred Quiet Test",
    }],
  );
  const remainingQuietSalvageUpdates = decodeWorldStorylineUpdates(
    deferredQuietCandidate.storylineUpdates,
  );

  cases.push({
    name: "final-attempt salvage strips only quiet deferred bookkeeping",
    pass:
      quietSalvage.strippedIds.length === 1 &&
      quietSalvage.strippedIds[0] === "storyline-deferred-quiet-test" &&
      remainingQuietSalvageUpdates.length === 1 &&
      remainingQuietSalvageUpdates[0]?.id === "storyline-selected-test",
    detail: `${quietSalvage.strippedIds.join(", ") || "none"} stripped`,
  });

  const passed = cases.every((entry) => entry.pass);
  console.table(cases);
  console.info(
    `[OH Native World Director self-test] ${passed ? "PASS" : "FAIL"} — ` +
    `${cases.filter((entry) => entry.pass).length}/${cases.length}`,
  );
  return { passed, cases };
};

const installDebugApi = () => {
  if (typeof globalThis === "undefined") return;

  globalThis.__OH_NATIVE_WORLD_DIRECTOR__ = {
    version: WORLD_DIRECTOR_VERSION,
    last: () => lastAnalysis
      ? JSON.parse(JSON.stringify(lastAnalysis))
      : null,
    selfTest: () => runWorldDirectorSelfTests(),
  };
};

installDebugApi();

export const buildWorldInitiativeContext = (
  bundle,
  {
    targetDate = "",
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    playerFocus = "",
    // The scenario's "Puppet states" feature, handed down rather than read:
    // this module runs in a worker and in node tests, so it stays clear of the
    // browser runtime (see the same argument in nativeDiplomaticDirector.js).
    puppetStates = true,
  } = {},
) => {
  const originDate = normalizeString(bundle?.game?.gameDate);
  const horizonDate = normalizeString(targetDate) || originDate;
  const candidates = [];
  const storylineAttention = selectStorylineAttention(
    bundle?.world || {},
    originDate,
    horizonDate,
  );

  const selectedStorylineIds = new Set(
    storylineAttention.selected
      .map((storyline) => normalizeString(storyline.id))
      .filter(Boolean),
  );

  const allDeferredStorylines = storylineAttention.all
    .filter((storyline) =>
      storyline.status !== "resolved" &&
      !selectedStorylineIds.has(normalizeString(storyline.id))
    );

  const deferredStorylineIds = new Set(
    allDeferredStorylines
      .map((storyline) => normalizeString(storyline.id))
      .filter(Boolean),
  );

  const deferredSourceEventIds = new Set(
    allDeferredStorylines
      .flatMap((storyline) => normalizeArray(storyline?.sourceEventIds))
      .map(normalizeString)
      .filter(Boolean),
  );

  const selectedParticipantKeys = new Set(
    storylineAttention.selected
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter(Boolean),
  );

  const suppressedDeferredParticipantKeys = new Set(
    allDeferredStorylines
      .flatMap((storyline) => normalizeArray(storyline?.participants))
      .map((actor) => normalizeString(actor).toLowerCase())
      .filter((actor) => actor && !selectedParticipantKeys.has(actor)),
  );

  const diplomaticAttention = buildBoundedDiplomaticContext(bundle?.world || {}, {
    playerPolity: normalizeString(bundle?.game?.country),
    selectedStorylines: storylineAttention.selected,
    maxActors: 8,
    puppetStates,
  });

  const canonicalStorylineId = (value) => {
    const id = normalizeString(value);
    return storylineAttention.aliasToCanonical?.get(id) || id;
  };

  const recentEvents = normalizeArray(bundle?.events).slice(-RECENT_EVENT_WINDOW);
  // R3.7: crisis discovery gets a separate cheap evidence lane sourced from the
  // same bounded recent-history window. This prevents a trajectory-4/5 rupture
  // from disappearing merely because the ordinary top-10 initiative ranking is
  // crowded by newer diplomatic/admin cards. No extra AI call is introduced.
  const crisisEvidenceCandidates = [];
  let deferredRecentEventsSuppressed = 0;
  let staleRecentEventsSuppressed = 0;
  let lowSignalRecentEventsSuppressed = 0;

  recentEvents.forEach((event, index) => {
    const eventId = normalizeString(event?.id);
    const eventStorylineIds = normalizeArray(event?.storylineIds)
      .map(canonicalStorylineId)
      .filter(Boolean);

    // Preserve only unresolved-looking, high-trajectory cards for crisis
    // discovery. Existing storyline-linked history is not eligible to bootstrap
    // a second parallel crisis. Age remains bounded by the same 180-day window.
    const crisisCandidate = eventCandidate(event, originDate, index);
    if (
      crisisCandidate &&
      crisisCandidate.ageDays <= RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS &&
      !eventStorylineIds.length &&
      Number(crisisCandidate.trajectoryValue) >= 4
    ) {
      crisisEvidenceCandidates.push(crisisCandidate);
    }

    if (!recentEventEligibleForInitiative(event, originDate)) {
      const age = ageDays(originDate, event?.date);
      if (
        parseIsoDate(originDate) != null &&
        parseIsoDate(event?.date) != null &&
        age > RECENT_EVENT_CANDIDATE_MAX_AGE_DAYS
      ) {
        staleRecentEventsSuppressed += 1;
      } else {
        lowSignalRecentEventsSuppressed += 1;
      }
      return;
    }

    const belongsToSelected =
      eventStorylineIds.some((id) => selectedStorylineIds.has(id));

    const belongsToDeferred =
      eventStorylineIds.some((id) => deferredStorylineIds.has(id)) ||
      (eventId && deferredSourceEventIds.has(eventId));

    // A deferred process remains canonical through its storyline state, but its
    // recent cards are not fresh initiative candidates. Otherwise the causal
    // ledger immediately re-injects the exact process the scheduler deferred.
    if (belongsToDeferred && !belongsToSelected) {
      deferredRecentEventsSuppressed += 1;
      return;
    }

    const candidate = eventCandidate(event, originDate, index);
    if (candidate) candidates.push(candidate);
  });

  const recentChats = normalizeArray(bundle?.chats).slice(-RECENT_CHAT_WINDOW);
  recentChats.forEach((chat, index) => {
    const candidate = chatCandidate(chat, originDate, index);
    if (candidate) candidates.push(candidate);
  });

  const consolidated = normalizeArray(bundle?.world?.consolidatedHistory)
    .slice(-CONSOLIDATED_HISTORY_WINDOW);
  const durableCanonExcludedFromInitiative = consolidated.length;
  // Consolidated history remains available in the ordinary world-history prompt.
  // It is chronology/continuity, not present-tense pressure, so do not inject it
  // again into CURRENT EXPLICIT EVIDENCE.

  pushTerritorialCandidates(
    candidates,
    bundle?.world || {},
    suppressedDeferredParticipantKeys,
    normalizeString(bundle?.game?.country),
  );
  pushActiveUnitCandidates(
    candidates,
    bundle?.world || {},
    suppressedDeferredParticipantKeys,
    normalizeString(bundle?.game?.country),
  );

  const activeInteractive = bundle?.world?.activeInteractive;
  if (activeInteractive && typeof activeInteractive === "object") {
    const title = normalizeString(activeInteractive.title);
    const premise = normalizeString(activeInteractive.premise || activeInteractive.opening);
    if (title || premise) {
      candidates.push({
        id: "active-interactive",
        type: "active-crisis",
        score: 11,
        date: originDate,
        title: title || "Active unresolved crisis",
        detail: truncate(premise, 320),
        ageDays: 0,
        trajectoryValue: 5,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  deduped.sort((a, b) =>
    (b.score - a.score) ||
    (a.ageDays - b.ageDays) ||
    compareGameDates(b.date || "", a.date || "")
  );

  const bounded = selectBoundedCandidates(
    deduped,
    maxCandidates,
  );

  const explorationSlate = buildNativeWorldExplorationSlate({
    bundle,
    allStorylines: storylineAttention.all,
    selectedStorylines: storylineAttention.selected,
    diplomaticActors: diplomaticAttention.actors,
    causalCandidates: bounded,
    crisisCandidates: crisisEvidenceCandidates,
  });

  const conflictRiskPosture = deriveWorldConflictRiskPosture({
    bundle,
    targetDate: horizonDate,
    causalCandidates: bounded,
  });

  const explorationActors = explorationSlate
    .filter((slot) => slot.type === "actor-domain")
    .map((slot) => slot.actor);

  const economicAttention = buildEconomicAttentionContext(
    bundle,
    storylineAttention,
    explorationActors,
  );

  const currentUnitCount = normalizeArray(bundle?.world?.units).length;

  // The player's focus decides how much of the world's own attention this
  // context carries (AI/playerFocus.js): all of it at World first and Balanced,
  // less at Focused and Spotlight. The world loses its weakest ranked evidence
  // first; anything naming the player stays, as does every player-sphere
  // exploration lane and the protected crisis lane below.
  const playerKey = normalizeString(bundle?.game?.country).toLowerCase();
  const keptCandidates = trimWorldForFocus(bounded, {
    focus: playerFocus,
    isPlayerItem: (candidate) => Boolean(playerKey)
      && `${normalizeString(candidate?.title)} ${normalizeString(candidate?.detail)}`.toLowerCase().includes(playerKey),
  });
  const lines = keptCandidates.map((candidate, index) => {
    const when = candidate.date ? ` (${candidate.date})` : "";
    return `${index + 1}. ${candidate.title}${when}` +
      (candidate.detail ? `\n   ${candidate.detail}` : "");
  });

  const deferredStorylines = allDeferredStorylines
    .slice(0, MAX_DEFERRED_STORYLINE_HINTS);
  const deferredLines = deferredStorylines.map((storyline, index) =>
    `${index + 1}. [${[storyline.id, storyline.kind, storyline.status, `pressure ${storyline.pressure}`].join(" | ")}] ${storyline.title}`);

  const attentionLines = storylineAttention.selected.map((storyline, index) => {
    const visibleAge = parseIsoDate(storyline.lastVisibleEventDate) != null
      ? ageDays(originDate, storyline.lastVisibleEventDate)
      : null;
    const stagnationAge = storylineStagnationAgeDays(storyline, horizonDate);
    // The same test the detector and the validator use: a storyline here that
    // does not move is sent back for a repair, which is a whole extra request.
    const atBackstop = storylineAtAntiStasisBackstop(storyline, horizonDate, bundle?.world);
    const meta = [
      storyline.id,
      storyline.kind,
      storyline.status,
      `pressure ${storyline.pressure}`,
      `momentum ${storyline.momentum}`,
    ].join(" | ");
    const detail = [
      storyline.participants.length ? `participants: ${storyline.participants.join(", ")}` : "",
      storyline.state ? `state: ${storyline.state}` : "",
      storyline.drivers.length ? `drivers: ${storyline.drivers.join("; ")}` : "",
      storyline.constraints.length ? `constraints: ${storyline.constraints.join("; ")}` : "",
      visibleAge == null ? "no visible event yet" : `last visible event ${visibleAge} day(s) before this jump`,
      atBackstop
        ? `MUST MOVE THIS PERIOD: ${stagnationAge} days with no visible development by the stop date; it must ${describeAntiStasisObjectiveRule()}.`
        : "",
    ].filter(Boolean).join("\n   ");
    return `${index + 1}. [${meta}] ${storyline.title}${detail ? `\n   ${detail}` : ""}`;
  });

  // A lane the ledger itself flags as a possible crisis is the one piece of the
  // exploration slate worth showing: named evidence, not an assignment.
  const crisisLines = explorationSlate
    .filter((slot) => slot?.type === "crisis-discovery" && Number(slot?.trajectoryValue) >= 4 && normalizeString(slot?.basis))
    .map((slot) => `- ${normalizeString(slot.actor)}: ${normalizeString(slot.basis)}`);

  const latestVisibleDate = latestCanonicalWorldEventDate(
    bundle?.events,
    originDate,
  );

  const visibleSilenceDays = latestVisibleDate
    ? worldIntegrityAgeDays(originDate, latestVisibleDate)
    : 99999;

  const horizonDays = originDate && horizonDate
    ? worldIntegrityAgeDays(horizonDate, originDate)
    : 0;

  const consequenceSignal = assessRecentWorldConsequenceLiveness({
    events: bundle?.events,
    referenceDate: originDate,
  });

  const text = [
    `[What Is in Motion — ${originDate || "unknown"} to ${horizonDate || "unknown"}]`,
    "Storylines are this world's ongoing processes — wars, crises, standoffs, movements. Each one due this period gets one storylineUpdates record saying where it stands on the stop date, whether or not it produces a visible event:",
    attentionLines.length ? attentionLines.join("\n") : "None due this period.",
    "",
    "Other open storylines (a record only when something material happens in one):",
    deferredLines.length
      ? deferredLines.join("\n") + (allDeferredStorylines.length > deferredLines.length ? `\n... and ${allDeferredStorylines.length - deferredLines.length} more.` : "")
      : "None.",
    "",
    "Pressures in the record, most pressing first:",
    lines.length ? lines.join("\n") : "Nothing in the record stands out.",
    ...(crisisLines.length ? ["", "Instability the record says may be turning into a crisis:", ...crisisLines] : []),
    "",
    `Conflict risk in this world right now: ${conflictRiskPosture.label}. ${conflictRiskPosture.guidance}.`,
    "",
    "Economic baselines (a strained state can still borrow, tax or print, at a price):",
    economicAttention.length
      ? economicAttention.map((row, index) => `${index + 1}. ${row.summary}`).join("\n")
      : "None recorded yet.",
    "",
    DIPLOMATIC_STATE_HEADING,
    diplomaticAttention.text,
    "",
    "[Storyline Records]",
    "storylineUpdates is ONE string: one record per line, at most 16, fields separated by ~ (never inside a field):",
    "id~status~pressure~momentum~startedDate~kind~title~participantsCSV~eventNumbersCSV~state",
    "status is active, dormant or resolved. pressure (how much is at stake) and momentum (how fast it is changing) run 0-100. startedDate is YYYY-MM-DD for a new storyline; an existing one may leave kind, title and participants blank; eventNumbersCSV may be blank; state says what is true on the stop date. Open a new storyline when an event starts something that will run over several turns — a crisis, an insurgency, a standoff, a war — never for a one-off announcement, and never for an effort on the Projects board.",
    `An active war or high-pressure storyline with no visible development for ${STAGNATION_BACKSTOP_DAYS} days may not stand still: it must ${describeAntiStasisObjectiveRule()}.`,
  ].join("\n");

  lastAnalysis = {
    version: WORLD_DIRECTOR_VERSION,
    originDate,
    targetDate: normalizeString(targetDate),
    candidateCount: bounded.length,
    storylineCount: storylineAttention.all.length,
    attentionCount: storylineAttention.selected.length,
    attentionStorylines: storylineAttention.selected,
    deferredCount: allDeferredStorylines.length,
    deferredStorylines: allDeferredStorylines,
    deferredPromptStorylines: deferredStorylines,
    explorationSlate,
    explorationSlotCount: explorationSlate.length,
    explorationActorCount: explorationSlate.filter((slot) => slot.type === "actor-domain").length,
    explorationPlayerSphereCount: explorationSlate.filter((slot) => slot.scope === "player-sphere").length,
    explorationWiderWorldCount: explorationSlate.filter((slot) => slot.scope === "wider-world").length,
    crisisDiscoverySlotCount: explorationSlate.filter((slot) => slot.type === "crisis-discovery").length,
    conflictRiskPosture,
    visibleSilenceDays,
    horizonDays,
    consequenceSignal,
    stagnationPolicy: {
      highPressure: HIGH_PRESSURE_STAGNATION_THRESHOLD,
      activeWarsRegardlessOfPressure: true,
      reappraisalDays: STAGNATION_REAPPRAISAL_DAYS,
      backstopDays: STAGNATION_BACKSTOP_DAYS,
    },
    deferredRecentEventsSuppressed,
    staleRecentEventsSuppressed,
    lowSignalRecentEventsSuppressed,
    durableCanonExcludedFromInitiative,
    mergedDuplicateStorylines: storylineAttention.mergedDuplicateCount || 0,
    duplicateStorylineGroups: storylineAttention.duplicateGroups || [],
    economicActors: economicAttention,
    currentUnitCount,
    diplomaticActors: diplomaticAttention.actors,
    diplomaticRelations: diplomaticAttention.relations,
    diplomaticAgreements: diplomaticAttention.agreements,
    scanned: {
      recentEvents: recentEvents.length,
      recentEventsSuppressedAsDeferredEvidence: deferredRecentEventsSuppressed,
      recentEventsSuppressedAsStaleInitiative: staleRecentEventsSuppressed,
      recentEventsSuppressedAsLowSignalInitiative: lowSignalRecentEventsSuppressed,
      durableCanonExcludedFromCurrentInitiative: durableCanonExcludedFromInitiative,
      mergedDuplicateStorylines: storylineAttention.mergedDuplicateCount || 0,
      recentChats: recentChats.length,
      consolidatedHistory: consolidated.length,
      storylines: storylineAttention.all.length,
    },
    candidates: bounded,
    doctrine: {
      historicalEvents: "candidates-not-appointments",
      historicalTiming: "causally-re-earned",
      historicalConsequences: "branch-recomputed",
      historicalContinuity: "causal-inertia-not-penalized",
      unchangedHistoricalStructure: "surviving-causes-are-present-tense-reason",
      unchangedHistoricalDateRequires: "surviving-scheduling-mechanism",
      playerSilence: "no-new-authorization",
      worldProcesses: "persistent-storylines-not-event-cards",
      currentUnits: "world.units-exhaustive-history-cannot-resurrect-absent-formations",
      storylineTransport: "compact-line-records",
      storylineBookkeeping: "runtime-owned",
      schedulerFairness: "diversity-aware-with-starvation-and-recent-visibility-cooldown",
      liveness: "breadth-plus-endogenous-active-war-and-high-pressure-motion-without-event-quota",
      reviewCadence: "21d-active-war-or-high-pressure-reappraisal-45d-objective-anti-stasis",
      visibleMilestones: "strategic-ordinary-consequential-or-human-texture",
      deferredStorylines: "low-attention-not-frozen-material-endogenous-reentry-allowed",
      candidateBreadth: "deferred-storyline-evidence-suppressed-plus-repeat-penalties-plus-native-trajectory-bias",
      exploration: "structural-5-5-player-wider-slate-with-protected-trajectory-crisis-lane",
      precuration: "native-integrity-screen-before-hidden-pass-state",
      stagnation: "21d-active-war-or-high-pressure-soft-reappraisal-45d-no-copy-forward-backstop",
      scheduler: "bounded-native-attention",
      eventDensity: "state-dependent-two-stage-world-composition-post-curator-no-hard-quota",
    },
    generatedAt: new Date().toISOString(),
  };

  installDebugApi();

  console.info(
    `[OH Native World Director v${WORLD_DIRECTOR_VERSION}] ` +
    `${storylineAttention.selected.length}/${storylineAttention.all.length} storyline(s) selected, ` +
    `${explorationSlate.length} exploration slot(s) (${explorationSlate.filter((slot) => slot.scope === "player-sphere").length} player-sphere / ${explorationSlate.filter((slot) => slot.scope === "wider-world").length} wider-world), ${bounded.length} causal candidate(s), ` +
    `${economicAttention.length} economic actor baseline(s), ${currentUnitCount} current unit(s), ` +
    `${diplomaticAttention.relations.length} relation(s), ${diplomaticAttention.agreements.length} agreement(s), ` +
    `${recentEvents.length} recent event(s), ${recentChats.length} recent chat(s)`,
  );

  if (typeof globalThis !== "undefined" && globalThis.__OH_CONTEXT_DIAGNOSTICS__ === true) {
    console.groupCollapsed(
      `[OH World Exploration v${WORLD_DIRECTOR_VERSION}] ${explorationSlate.length} slot(s); ` +
      `visible silence ${visibleSilenceDays < 99999 ? `${visibleSilenceDays}d` : "unknown"}; ` +
      `${deferredRecentEventsSuppressed} deferred + ${staleRecentEventsSuppressed} stale + ${lowSignalRecentEventsSuppressed} low-signal recent event candidate(s) suppressed; ` +
      `${durableCanonExcludedFromInitiative} durable canon block(s) kept out of current initiative; ` +
      `${storylineAttention.mergedDuplicateCount || 0} duplicate storyline(s) coalesced`,
    );
    console.table(
      explorationSlate.map((slot) => ({
        id: slot.id,
        actor: slot.actor,
        relevance: slot.relevance ?? "",
        domain: slot.domain,
        basis: slot.basis || "",
        deferredTopics: slot.deferredTopics.join("; "),
      })),
    );
    console.info("selected storylines:", storylineAttention.selected.map((entry) => entry.id));
    console.info("deferred storylines:", allDeferredStorylines.map((entry) => entry.id));
    console.groupEnd();
  }

  return {
    text,
    analysis: lastAnalysis,
  };
};
