/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { callAI, providerSupportsBatch, retrieveAIBatch, sendDiplomaticMessageOnceOff, submitAIBatch } from "./main.jsx";
import { logAi } from "../../runtime/logClient.js";
import { NATIVE_GAME_MASTER_PROMPT, normalizePromptPack } from "./gameplayPrompts.js";
import { directGeneratedUnitOps } from "./nativeUnitDirector.js";
import { directGeneratedTerritoryOps } from "./nativeTerritoryDirector.js";
import { curateGeneratedEvents } from "./nativeTimelineCurator.js";
import {
  applyWorldStorylineUpdates,
  assessRecentWorldConsequenceLiveness,
  bindNewStorylineEvents,
  bindSelectedStorylineEvents,
  buildWorldInitiativeContext,
  decodeWorldStorylineUpdates,
  findWorldStorylineAntiStasisIssues,
  normalizeWorldStorylineEventLinks,
  stripQuietDeferredStorylineUpdates,
  validateWorldEventConsequencePayload,
  validateWorldStorylinePayload,
} from "./nativeWorldDirector.js";
import {
  createWorldEventScopeClassifier,
  deriveWorldExplorationAudit,
  screenGeneratedWorldEvents,
  stripWorldSweepAudit,
  validateWorldExplorationAudit,
} from "./nativeWorldIntegrity.js";
import { isContextDiagnosticsEnabled, logContextDiagnostics, resolveTemplateVariableDemand } from "./contextDiagnostics.js";
import {
  SEGMENTED_JUMP_MIN_DAYS,
  buildSegmentInstruction,
  eventCountRangeForDays,
  formatDurationLabel,
  mergeSegmentPayloads,
  planJumpSegments,
  segmentEventRange,
} from "./jumpSegments.js";
import { UNIT_CONTRACT_MARKER, collapseRepeatedBlock, templateAlreadySays } from "./promptDedupe.js";
import { buildJumpProjectsDirective } from "./projectsDirective.js";
import { extractJsonPayload, unwrapMimickedToolCall } from "./jsonSalvage.js";
import { decodeGameMasterTransportPayload, getGameplayTool, normalizeGameplayPayload, validateGameplayPayload } from "./gameplaySchemas.js";
import { buildOwnerAliasMap, canonicalOwnerName, toCountryName } from "../../runtime/ownerNames.js";
import {
  describeDoubtedForPrompt,
  doubtedAwaitingFreshSource,
  spyIntelDoubtOps,
  spyOperationOps,
  isProjectOpen,
  spyProvenanceOps,
} from "../../runtime/projects.js";
import { activeSpies, applySpyOps, espionageBrief, intelligenceOf, normalizeIntercepts, normalizeSpies, resolveEspionage } from "../../runtime/spycraft.js";
import { buildSpyOrdersDirective } from "./spyOrdersDirective.js";
import { echoesExistingMessage, renderOpenChatsForPrompt } from "../../runtime/chatEcho.js";
import { isSeal, newSeal, openExchange, sealExchange } from "../../runtime/spySeal.js";
import {
  buildActionHistoryText,
  buildChatSummaryText,
  buildDetailedChatHistoryText,
  buildEventHistoryText,
  buildPromptContext,
  formatDateReadable,
  getUnconsolidatedEvents,
  resolveHelperValues,
} from "./promptContext.js";
import { renderTemplateCached, staticPrefixEndOf } from "./promptLayout.js";
import { attachAttemptOutcome, finishAiRecord, normalizeParsedSummary } from "./telemetry.js";
import {
  JSON_URLS,
  loadCountryNames,
  loadRegionCatalog,
  loadScenarioRegionCatalog,
  readJson,
  writeJson,
} from "../../runtime/assets.js";
import {
  advanceStandingOrders,
  applyEventImpactsToWorld,
  applyProjectOpsToWorld,
  enforceUnitVolume,
  readInterceptsState,
  writeInterceptsState,
  normalizeActionEntry,
  normalizeEventEntry,
  normalizeActions,
  normalizeChatEntry,
  normalizeChats,
  normalizeEvents,
  normalizeGameData,
  normalizeWorldState,
  readActionsState,
  readChatsState,
  readEventsState,
  readGameData,
  readGameStateBundle,
  readCountryStatsBundle,
  readWorldStateView,
  primeCountryStatsWorkerCommit,
  applyCountryStatPatchToWorld,
  readWorldState,
  resumeStandingOrders,
  writeActionsState,
  writeChatsState,
  writeEventsState,
  writeGameData,
  writeWorldState,
} from "../../runtime/gameState.js";
import { dedupeGeneratedEvents } from "../../runtime/eventDedup.js";
import { allocateCanonicalTurnEventIds, remapLedgerEventIds } from "../../runtime/eventIdentity.js";
import { sortTimelineEventsChronologically } from "../../runtime/timelineOrder.js";
import { buildPolityIdentityIndex, resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import {
  applyWarUpdates,
  bindWarUpdatesToEvents,
  buildCanonicalWarContext,
  decodeWarUpdates,
  reconcileCombatWarState,
  validateCanonicalWarEvents,
  validateWarLedgerPayload,
} from "./nativeWarLedger.js";
import {
  DIPLOMATIC_LEDGER_VERSION,
  applyDiplomaticUpdates,
  bindAgreementUpdatesToEvents,
  bindRelationUpdatesToEvents,
  buildBoundedDiplomaticContext,
  decodeAgreementUpdates,
  decodeRelationUpdates,
  migrateLegacyDiplomaticState,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";
import {
  appendCountryStatHistorySample,
  captureCountryStatsHistory,
  COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
  COUNTRY_STATS_TRACKING_MAX_POLITIES,
  countryStatsTrackingMonthsElapsed,
  finalizeCountryStatSheet,
  guardCountryStatContinuity,
  isCompleteCountryStatSheet,
  mergeCountryStatPatch,
  normalizeCountryStatSheet,
  normalizeCountryStatsTracking,
  expandTerritorialMacroEstimates,
} from "../../runtime/countryStats.js";
import { beginTurnPerfStage, endTurnPerfStage, measureTurnPerfStage, recordTurnPerfAiAttempt } from "../../runtime/turnPerf.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { MAP_SETTING_KEYS, getMapSetting, getMapSettingDefaultOn, isBetaUnits } from "../../runtime/mapSettings.js";
import { AI_FIRST_BYTE_TIMEOUT_MS, AI_IDLE_TIMEOUT_MS, createIdleDeadline } from "./idleDeadline.js";
import { logDebugEvent } from "../../runtime/debugLog.js";
import { assertCampaignUnchanged } from "../../runtime/campaignGuard.js";
import { getLibraryState } from "../../runtime/library.js";

const CHAT_HINT_PATTERNS = [
  /\bchat\b/i,
  /\bconference\b/i,
  /\bcontact\b/i,
  /\bdiplomac/i,
  /\bmeet\b/i,
  /\bmessage\b/i,
  /\bnegotiat/i,
  /\boutreach\b/i,
  /\bparley\b/i,
  /\bpeace talk/i,
  /\breach out\b/i,
  /\bspeak with\b/i,
  /\bsummit\b/i,
  /\btalk to\b/i,
  /\btalks? with\b/i,
  /\bпереговор/i,
  /\bвстрет/i,
  /\bдипломат/i,
  /\bсвяз/i,
  /\bчат/i,
  /\bдоговор/i,
];

const DEFAULT_SUGGESTION_TOPICS = [
  {
    title: "Stabilize the domestic front",
    description: "Keep the home front orderly and reduce the chance of internal drift while outside pressure builds.",
  },
  {
    title: "Shape the diplomatic field",
    description: "Use talks, signals, and leverage to narrow hostile options before the next crisis hardens.",
  },
  {
    title: "Prepare military leverage",
    description: "Create visible readiness and practical reserves so rivals must factor your capability into their plans.",
  },
  {
    title: "Secure economic depth",
    description: "Expand the industrial and fiscal base that decides whether later gambles are sustainable.",
  },
];

const cloneValue = (value) => {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
};

const normalizeString = (value) => String(value ?? "").trim();
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const parseIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeString(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1] ? { day, month, year } : null;
};

const addIsoDays = (value, days) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return "";
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) return "";
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

export const validateTimelineDates = ({ candidate, mode, originDate, targetDate, requireAdvance = false }) => {
  const stopDate = normalizeString(candidate?.stopDate);
  if (!parseIsoDate(originDate)) {
    const eventDates = normalizeArray(candidate?.events).map((event) => normalizeString(event?.date));
    const outputDates = [stopDate, ...eventDates];
    const malformedIsoIndex = outputDates.findIndex((date) => /^\d{4}-/.test(date) && !parseIsoDate(date));
    if (malformedIsoIndex >= 0) {
      const path = malformedIsoIndex === 0 ? "$.stopDate" : `$.events[${malformedIsoIndex - 1}].date`;
      return `${path} must be a real Gregorian date when using YYYY-MM-DD format.`;
    }
    // A whole-day advance was requested but the model kept the clock where it
    // was — the stuck-save signature (it then re-simulates the past instead of
    // the future). Reject on the strict attempt so the retry moves time forward.
    if (requireAdvance && stopDate && stopDate === normalizeString(originDate)) {
      return `$.stopDate must move time forward - it must not equal the current date ${originDate}.`;
    }
    if (parseIsoDate(stopDate)) {
      let previousDate = "";
      for (let index = 0; index < eventDates.length; index += 1) {
        if (!parseIsoDate(eventDates[index])) return `$.events[${index}].date must use the same YYYY-MM-DD format as $.stopDate.`;
        if (eventDates[index] > stopDate) return `$.events[${index}].date must not be later than ${stopDate}.`;
        if (previousDate && eventDates[index] < previousDate) return `$.events[${index}].date must not precede the previous event date.`;
        previousDate = eventDates[index];
      }
    }
    return "";
  }
  if (!parseIsoDate(stopDate)) return `$.stopDate must be a real date in YYYY-MM-DD format; received ${stopDate || "an empty value"}.`;
  if (mode === "auto") {
    if (stopDate <= originDate || stopDate > targetDate) {
      return `$.stopDate must be after ${originDate} and no later than ${targetDate}.`;
    }
  } else if (stopDate !== targetDate) {
    return `$.stopDate must equal the requested target date ${targetDate}.`;
  }

  let previousDate = originDate;
  for (let index = 0; index < normalizeArray(candidate?.events).length; index += 1) {
    const eventDate = normalizeString(candidate.events[index]?.date);
    if (!parseIsoDate(eventDate)) return `$.events[${index}].date must be a real date in YYYY-MM-DD format.`;
    // Events dated ON the origin date are legitimate for every jump length: a
    // sub-day skip stays on that date, and a 1-day jump's window used to be a
    // single legal date ("after Jan 14 and no later than Jan 15") that models
    // constantly missed by dating events "today" — burning the strict attempt
    // (and the whole turn, when the retry ran out of road) over nothing.
    if (eventDate < originDate || eventDate > stopDate) {
      return `$.events[${index}].date must be on or after ${originDate} and no later than ${stopDate}.`;
    }
    if (eventDate < previousDate) return `$.events[${index}].date must not precede the previous event date.`;
    previousDate = eventDate;
  }
  return "";
};

// Attempt-2 salvage for timeline dates: rather than discarding a finished
// (possibly very long) generation to the canned fallback because the model
// simulated a little past the window, pull the strays in. Events dated on or
// before the origin land on the first simulated day, events past the stop land
// on the stop date, unparseable dates become the stop date, and ordering is
// restored monotonically. The CONTENT is untouched — a good story with sloppy
// dates beats canned events every time (a 1-day skip whose model "kept going"
// used to trash the whole turn exactly this way).
export const clampTimelineDates = (candidate, { mode, originDate, targetDate }) => {
  if (!parseIsoDate(originDate)) return; // textual/BCE scenarios use the lenient branch
  let stopDate = normalizeString(candidate?.stopDate);
  if (mode === "auto") {
    if (!parseIsoDate(stopDate) || stopDate <= originDate || stopDate > targetDate) stopDate = targetDate;
  } else {
    stopDate = targetDate;
  }
  candidate.stopDate = stopDate;
  // Mirrors validation: on-or-after the origin is in-window for every jump
  // length, so strays dated before the origin pull up to the origin itself.
  const floor = originDate > stopDate ? stopDate : originDate;
  let previous = floor;
  for (const event of normalizeArray(candidate?.events)) {
    if (!event || typeof event !== "object") continue;
    let date = normalizeString(event.date);
    if (!parseIsoDate(date)) date = stopDate;
    if (date <= originDate) date = floor;
    if (date > stopDate) date = stopDate;
    if (date < previous) date = previous;
    event.date = date;
    previous = date;
  }
};

const sentenceCase = (value) => {
  const text = normalizeString(value);
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

export { extractJsonPayload } from "./jsonSalvage.js";

const loadPromptCatalog = async ({ force = false } = {}) =>
  normalizePromptPack(await readJson(JSON_URLS.prompts, { defaultValue: {}, force }));

const MILITARY_ACTION_PATTERN =
  /\b(troop|army|armies|attack|invade|invasion|deploy|fleet|navy|naval|air force|airforce|bomb|siege|offensive|battalion|regiment|garrison|blockade|mobiliz)/i;

// Reach/logistics doctrine for the AI. Deliberately CONDITIONAL: it only
// rides along when the turn actually involves forces (units on the map or
// military-sounding orders), so peaceful turns don't pay the context cost.
const buildMilitaryFeasibilityText = (world, actionsText) => {
  const hasUnits = normalizeArray(world?.units).length > 0;
  if (!hasUnits && !MILITARY_ACTION_PATTERN.test(actionsText || "")) {
    return "";
  }

  return [
    "",
    "MILITARY FEASIBILITY — test every deploy request, move/attack order and your own unitOps against the era and the unit's type before honoring it:",
    "- Era reach: before ~1500, armies march on foot or horse and cross water only by coastal shipping — intercontinental operations are impossible. ~1500–1850 (age of sail): overseas action needs fleets and friendly ports and takes months. 1850–1945: rail and steamships speed logistics; aircraft stay short-ranged until the 1940s. After 1945: global power projection belongs only to major powers with bases, carriers or allies along the route.",
    "- Unit type: air units are fastest but need airbases or carriers within range and cannot hold ground; naval units move only by sea; infantry, armor and artillery crawl overland and need supply lines; garrisons do not travel.",
    "- Distance: compare the unit's coordinates with the target's. An order beyond plausible reach or pace is NOT executed as given — reject it, or convert it into a partial advance with an event explaining the delay, the transport it would need, or why it failed.",
    "- Never teleport units: each move op may only cover what that unit could actually travel in the elapsed time; long campaigns should progress across several turns.",
  ].join("\n");
};

const STAT_SHEETS_STORAGE_KEY = "oh-stat-sheets";

const readStoredStatSheets = () => {
  try {
    return JSON.parse(localStorage.getItem(STAT_SHEETS_STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
};

// International reputation the AI evolves each turn (world.internationalReputation),
// surfaced to prompts. Falls back to the last stat sheet the player viewed, then a
// neutral 50 — so it is never "unknown".
const buildPlayerPolityReputationText = async (bundle) => {
  const playerCode = normalizeString(bundle.game.country);
  if (!playerCode) {
    return "No player polity is currently set.";
  }
  const world = bundle.world && typeof bundle.world === "object" ? bundle.world : {};
  let reputation = Number(world.internationalReputation?.[playerCode]);
  if (!Number.isFinite(reputation)) {
    const gameKey = normalizeString(bundle.game.id || bundle.game.name || "game");
    reputation = Number(readStoredStatSheets()[`${gameKey}:${playerCode}`]?.sheet?.indices?.internationalReputation);
  }
  if (!Number.isFinite(reputation)) {
    reputation = 50;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(reputation)));
  const band = clamped >= 70 ? "well-regarded" : clamped >= 40 ? "mixed" : "poor";
  return `International reputation: ${clamped}/100 (${band}).`;
};

// ---- Canonical war and diplomacy ledgers ------------------------------------
// world.wars, world.relations and world.agreements are engine-owned state (see
// nativeWarLedger.js and nativeDiplomaticDirector.js). The model changes them
// only through the compact warUpdates / relationUpdates / agreementUpdates lines
// on a jump payload: validated per segment against the world as the earlier
// segments left it (validateSegmentLedgers), bound to event ids so the segments
// can be merged, and folded into the world once per turn (applySimulationResult).
// The directives below are appended at call time, so frozen prompt packs get
// them too; the line formats live here rather than in the tool schema.

const canonicalCampaignPolity = (value, world, identityIndex = null) => {
  const raw = normalizeString(value);
  if (!raw) return "";
  const resolved = resolvePolityIdentity(raw, world && typeof world === "object" ? world : {}, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
    identityIndex,
  });
  return normalizeString(resolved?.resolved) || toCountryName(raw) || raw;
};

const relationStatusForScore = (value) => {
  const score = Math.max(-100, Math.min(100, Math.round(Number(value) || 0)));
  if (score >= 55) return "friendly";
  if (score >= 20) return "cordial";
  if (score >= -10) return "neutral";
  if (score >= -30) return "cautious";
  if (score >= -60) return "strained";
  if (score > -90) return "hostile";
  return "rival";
};

const WORLD_WAR_TRANSITION_HINTS = Object.freeze({
  start: /\b(declar(?:e|es|ed|ation)|war begins|hostilities begin|invad(?:e|es|ed|ing|sion)|opens? hostilities)\b/i,
  "join-a": /\b(joins?|enters?|interven(?:e|es|ed|tion)|declares? war)\b/i,
  "join-b": /\b(joins?|enters?|interven(?:e|es|ed|tion)|declares? war)\b/i,
  leave: /\b(leaves?|withdraws?|withdrawal|exits?|separate peace)\b/i,
  ceasefire: /\b(cease[- ]?fire|armistice|truce|suspends? hostilities)\b/i,
  resume: /\b(resumes? hostilities|cease[- ]?fire collapses?|armistice collapses?|fighting resumes?)\b/i,
  end: /\b(peace|surrenders?|capitulat(?:e|es|ed|ion)|war ends?|ends? the war|peace settlement)\b/i,
});

// The model decides WHAT happened; the engine owns which event a war record is
// bound to. Model-supplied event numbers are hints only and are rebound here from
// event.warId plus the transition's own vocabulary, so a wrong number can never
// bind a declaration to an unrelated event.
const normalizeWorldWarEventLinks = (candidate) => {
  if (!candidate || typeof candidate !== "object") return { rebound: 0 };
  const events = normalizeArray(candidate?.events);
  const updates = decodeWarUpdates(candidate?.warUpdates);
  let rebound = 0;

  const normalized = updates.map((update) => {
    const warId = normalizeString(update?.id);
    const supplied = normalizeArray(update?.eventIndexes)
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length);

    const sameWar = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => normalizeString(event?.warId) === warId);

    const hint = WORLD_WAR_TRANSITION_HINTS[normalizeString(update?.op).toLowerCase()];
    const semantic = hint
      ? sameWar.filter(({ event }) =>
          hint.test(`${normalizeString(event?.title)} ${normalizeString(event?.description)}`))
      : [];

    let eventIndexes = [];
    if (semantic.length === 1) {
      eventIndexes = [semantic[0].index];
    } else if (sameWar.length === 1) {
      eventIndexes = [sameWar[0].index];
    } else {
      const suppliedSameWar = supplied.filter((index) =>
        normalizeString(events[index]?.warId) === warId);
      const suppliedSemantic = semantic.length
        ? suppliedSameWar.filter((index) => semantic.some((row) => row.index === index))
        : suppliedSameWar;
      if (suppliedSemantic.length === 1) eventIndexes = suppliedSemantic;
    }

    if (JSON.stringify(eventIndexes) !== JSON.stringify(supplied)) rebound += 1;
    return {
      ...update,
      eventIndexes,
      eventIds: [],
    };
  });

  candidate.warUpdates = normalized;
  if (rebound) {
    console.info(`[ai] war ledger: rebound ${rebound} record(s) from event.warId and transition semantics.`);
  }
  return { rebound, updates: normalized };
};

const buildWarLedgerDirective = (variables) => {
  const playerName = normalizeString(variables?.playerPolity) || "the player's polity";
  const canonicalWarContext = normalizeString(variables?.canonicalWarContext);
  return `[Canonical War-State Ledger]
world.wars is the AUTHORITATIVE source of belligerency. A tense relationship, an alliance, a mobilisation or real-world history does NOT make two polities belligerents; only this ledger does.

CURRENT CANONICAL CONFLICTS:
${canonicalWarContext || "No active or ceasefire canonical wars are recorded."}

Hard rules:
- Actual battlefield combat requires an ACTIVE canonical war.
- Battle/offensive/invasion/bombardment/raid/siege/front-combat events MUST carry event.warId and event.combatants.
- event.combatants must name real belligerent polities from BOTH opposing sides of that war.
- A declaration of war, entry into an existing war, departure, ceasefire, resumption, or peace/end MUST emit a matching top-level warUpdates record AND a real event carrying the same warId. The engine binds the record to that event; do not spend effort counting event positions.
- An alliance does not silently activate. Mobilization does not silently activate. A historical war does not silently activate.
- If a historically expected belligerent has not actually joined in THIS campaign, it has no battlefield front.
- WAR-DEPENDENT DOMESTIC / ECONOMIC FRAMING is ledger-bound too. A polity that is NOT a belligerent must not be described as operating under its own wartime economy, rationing, mobilisation, war taxes, blockade conditions or comparable home-front conditions merely because the calendar matches real history or because OTHER countries are fighting. Spillover into a neutral is allowed only with a concrete causal bridge (disrupted imports, refugee pressure, sanctions) and must be described as spillover from the named foreign conflict.
- Real-world chronology is never evidence that an absent war, blockade, mobilisation or home-front regime exists in THIS campaign.
- ${playerName} may not be inserted into a war merely because history or alliance logic suggests it. The player-agency rules still control every new player commitment.
- warUpdates is compact text, one record per line, fields separated by ~ (never use ~ inside a field):
  warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note
  ops: start | join-a | join-b | leave | ceasefire | resume | end
  For start, actorsCSV is side A and opponentsCSV is side B; for join-a/join-b/leave, actorsCSV names the polities joining or leaving. eventNumbersCSV is the 1-based number of the event that establishes the transition and may be blank: the engine binds from warId and the transition's own wording. Use a stable, descriptive warId (e.g. war-france-germany-1914) and reuse it for later lifecycle records.
- Return warUpdates:"" when belligerency does not change in this pass.`;
};

const buildDiplomaticLedgerDirective = (variables) => {
  const playerName = normalizeString(variables?.playerPolity) || "the player's polity";
  const canonicalDiplomacy = normalizeString(variables?.canonicalDiplomaticContext);
  return `[Canonical Diplomatic Ledger]
${canonicalDiplomacy || "No canonical bilateral relations or formal agreements are recorded yet."}

Lasting bilateral political shifts use top-level relationUpdates; signed, ratified or concluded formal treaties, alliances, guarantees and pacts use top-level agreementUpdates. polityChanges remains for polity metadata and reputation, regionTransfers for legal territorial settlements, and unitOps for concrete military coordination. A.I.-controlled polities have their own diplomacy and may negotiate, threaten, align, mediate, trade or make agreements among themselves without waiting for ${playerName}; private A.I.-to-A.I. diplomacy belongs in the TIMELINE as events, never in a chat the player is not part of.

Relation decision model: a canonical bilateral relation score/status is persistent political climate, not decoration. Use it as a strong prior for A.I. trust, threat interpretation, bargaining posture, willingness to cooperate or compromise, tolerance of strategic risk and severity of reaction. It is NOT a hard acceptance probability or veto: national interest, formal obligations, geography, relative power, domestic constraints, reputation and the concrete proposal remain independent causes, so a friendly government may reject a dangerous demand and a hostile one may cooperate under necessity. Formal agreements, bilateral warmth and actual war are separate facts: a strained ally may still owe treaty duties; friendly states without a treaty have promised nothing; hostility alone does not create belligerency. When a NEW event materially changes a bilateral climate, emit a relationUpdates record with the new ABSOLUTE score bound to that event; never drift scores merely because time passed, and let the same foreign action provoke different responses from a trusted partner than from a distrusted rival.

- relationUpdates is compact text, one record per line, fields separated by ~ (never use ~ inside a field):
  A~B~score~status~eventNumbersCSV~summary
  score is the new absolute score from -100 to 100; status is one of friendly | cordial | neutral | cautious | strained | hostile | rival (blank derives it from the score); eventNumbersCSV is the 1-based number of the causal event and may be blank (the engine binds the one event that matches).
- agreementUpdates is compact text, one record per line:
  agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms
  ops: start | update | suspend | resume | end | expire. type is one of alliance | mutual_defense | guarantee | non_aggression | friendship_consultation | trade_economic | military_cooperation | military_access | neutrality | peace_settlement | other. Use a stable, descriptive agreementId (e.g. franco-russian-alliance-1894) and reuse it for later lifecycle records; every record needs a real causal event in this response, and only start needs the full type/parties/title.
- Return relationUpdates:"" and agreementUpdates:"" when nothing material changes.`;
};

const IDLE_RELATION_DECISION_MODEL = `[Diplomatic Relation Decision Model]
Treat the canonical bilateral relation score/status as a strong prior for diplomatic tone and willingness to initiate contact. Friendly relations make reassurance, congratulations, candid consultation, alliance follow-up and commercial feelers more plausible; strained or hostile relations make protests, warnings, guarded clarification, counter-balancing or silence more plausible. This is not a hard threshold: current interests and events still decide whether anybody has a real reason to write.`;

const buildPregameBootstrapDirective = (variables) => {
  const roundOneDate =
    normalizeString(variables?.pregameStartDate) ||
    normalizeString(variables?.dateReadable) ||
    normalizeString(variables?.date) ||
    "the game start date";
  const vocabulary = normalizeString(variables?.pregameCanonicalPolityVocabulary) || "No current polity vocabulary was available.";
  return `[Round-Zero World Bootstrap Contract]
This ONE pregameHistory response writes bounded history strictly BEFORE ${roundOneDate} and compiles the belligerency and diplomacy ALREADY TRUE at Round 1 into the canonical war, relation and agreement ledgers. It is not a future-history scheduler.

CANONICAL ENVELOPE
Use canonicalUpdates only. Every item uses the same flat required fields; fill the fields a kind does not use with "", [] or 0.
Kinds:
- relation: polities=[A,B], score (absolute, -100..100), detail (summary).
- storyline:active | storyline:dormant: id (stable, e.g. storyline-<slug>), polities (participants), pressure (0-100, unresolved stakes), momentum (0-100, current rate of change), date (when the process began, YYYY-MM-DD), category (process kind: crisis, revolution, diplomacy, politics, economy, insurgency...), title, detail (state: what is true now and why it is unresolved). One per unresolved multi-turn process still alive at Round 1 that is NOT itself a live war; the engine mirrors every live war into a storyline on its own.
- war:start | war:join-a | war:join-b | war:leave | war:ceasefire | war:resume | war:end: id, polities (actors / side A), opponents (side B), detail (note). Every war still live at Round 1 begins with a war:start, and the pre-game event that started it carries the same event.warId.
- agreement:start: id, polities (parties), category (agreement type: alliance | mutual_defense | guarantee | non_aggression | friendship_consultation | trade_economic | military_cooperation | military_access | neutrality | peace_settlement | other), title, detail (terms). Only agreements still in force on the start date; instruments that already ended belong in the backstory only.
Never output relation status or event indexes/ids; the engine owns those.

ROUND-ZERO AUDIT
- Every war still live at Round 1 must be represented.
- Every unresolved non-war process that shapes Day-1 decisions (a crisis, an insurgency, a negotiation in progress, an economic emergency) should be a storyline; never spend a slot mirroring a live war.
- Every materially important active formal agreement explicit in the source must be represented.
- Persist the sparse bilateral relations needed to explain how the central actors make decisions on Day 1; do not leave central actors blank when the source establishes allies, patrons, rivals or enemies.
- Keep wars, relations and agreements distinct. Preserve causal inertia where its causes remain intact; never schedule future outcomes.

[Round-Zero Runtime Grounding]
Start date: ${roundOneDate}

CURRENT ROUND-ONE POLITIES (structured-output authority):
${vocabulary}

Rules:
- Every polity token inside canonicalUpdates.polities/opponents MUST resolve to one of the current polities above. Historical or prose labels are descriptive only; never create a structured umbrella or legacy polity that does not exist in the current save.
- Titles and details may use natural historical prose; structured polity identity must remain canonical.

CURRENT CANONICAL STATE ALREADY PRESENT:
Wars:
${normalizeString(variables?.canonicalWarContext) || "None recorded."}

Diplomacy:
${normalizeString(variables?.canonicalDiplomaticContext) || "None recorded."}

Do not duplicate canonical state already present. Return canonicalUpdates:[] only when no qualifying Day-1 canonical state exists.

[Round-Zero Diplomatic Baseline]
Round-Zero relations are absolute as-of-start political memory, not single-event deltas. Existing agreements are standing Day-1 state, not necessarily newly signed during the displayed backstory window. Emit historically justified relation and agreement baseline records even when no single generated event card uniquely anchors them: the engine attaches a source event when one is clear and otherwise keeps the valid baseline fact without inventing causality. Do NOT create filler event cards solely to satisfy bookkeeping; within the envelope's capacity, cover the material diplomatic graph rather than stopping after a handful of obvious pairs.`;
};

// Pregame history answers with one flat "canonicalUpdates" envelope (see
// canonicalUpdateSchema); it is expanded here into the three ledger transports
// the rest of the code reads, so the validators and appliers have one shape.
const CANONICAL_UPDATE_ENVELOPE_TASKS = new Set(["pregameHistory"]);

const canonicalUpdateKind = (value) => {
  const [family = "", ...rest] = normalizeString(value).toLowerCase().split(":");
  return { family: family.trim(), operation: rest.join(":").trim() };
};

const expandCanonicalUpdateEnvelope = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;

  const storylineUpdates = [];
  const warUpdates = [];
  const relationUpdates = [];
  const agreementUpdates = [];

  for (const raw of normalizeArray(candidate.canonicalUpdates)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const { family, operation } = canonicalUpdateKind(raw.kind);
    const polities = normalizeArray(raw.polities).map(normalizeString).filter(Boolean);
    const opponents = normalizeArray(raw.opponents).map(normalizeString).filter(Boolean);

    if (family === "storyline") {
      storylineUpdates.push({
        id: normalizeString(raw.id),
        status: operation,
        pressure: Number(raw.pressure),
        momentum: Number(raw.momentum),
        startedDate: normalizeString(raw.date),
        kind: normalizeString(raw.category).toLowerCase(),
        title: normalizeString(raw.title),
        participants: polities,
        eventIndexes: [],
        eventIds: [],
        state: normalizeString(raw.detail),
      });
    } else if (family === "war") {
      warUpdates.push({
        id: normalizeString(raw.id),
        op: operation,
        actors: polities,
        opponents,
        eventIndexes: [],
        eventIds: [],
        note: normalizeString(raw.detail),
      });
    } else if (family === "relation") {
      relationUpdates.push({
        a: normalizeString(polities[0]),
        b: normalizeString(polities[1]),
        score: Number(raw.score),
        // The director derives the status band from the score.
        eventIndexes: [],
        eventIds: [],
        summary: normalizeString(raw.detail),
      });
    } else if (family === "agreement") {
      agreementUpdates.push({
        id: normalizeString(raw.id),
        op: operation,
        type: normalizeString(raw.category).toLowerCase(),
        parties: polities,
        eventIndexes: [],
        eventIds: [],
        title: normalizeString(raw.title),
        terms: normalizeString(raw.detail),
      });
    }
  }

  const expanded = { ...candidate, storylineUpdates, warUpdates, relationUpdates, agreementUpdates };
  delete expanded.canonicalUpdates;
  return expanded;
};

// One jump segment's ledger records, checked against the world as the earlier
// segments left it. Strict while a retry remains (the model gets the exact
// error), salvaged on the final attempt: an ambiguous combat event is dropped
// together with the war record only it established, rather than the whole
// segment going to the fallback. Ends by binding every record to this
// segment's event ids, which is what lets mergeSegmentPayloads concatenate.
const validateSegmentLedgers = (candidate, { world, strict, segmentIndex = 0 }) => {
  const events = normalizeArray(candidate?.events);
  // Temporary ids: the canonical round-scoped ones are minted once the whole
  // round is in hand (applySimulationResult), and the records follow them.
  events.forEach((event, index) => {
    if (event && typeof event === "object" && !normalizeString(event.id)) {
      event.id = `segment-${segmentIndex + 1}-event-${index + 1}`;
    }
  });

  // Combat the model narrated but did not bind: attach it to the one matching
  // active war, resume the one matching ceasefire, or start a war from two
  // explicit opposing combatants; anything ambiguous comes back as an error.
  const combatWarRepair = reconcileCombatWarState(candidate, { world });
  if (combatWarRepair.unresolved.length && strict) {
    const first = combatWarRepair.unresolved[0];
    return `Combat event "${first.title || `event ${first.index + 1}`}" could not be canonically bound: ${first.reason}. ` +
      "If this is real battlefield combat, name the direct opposing combatants in event.combatants and supply the matching warUpdates lifecycle record. If it is deployment, readiness, an exercise, deterrence, military cooperation or other non-combat activity, remove warId/combatants/warUpdates rather than inventing belligerency.";
  }

  normalizeWorldWarEventLinks(candidate);
  let warError = validateWarLedgerPayload(candidate, { world });

  if (warError && !strict && combatWarRepair.unresolved.length) {
    const dropIndexes = new Set(combatWarRepair.unresolved.map((entry) => entry.index));
    // A war record is causal with the event that established it: if every
    // establishing event of a record is being dropped, the record goes too.
    const boundBefore = decodeWarUpdates(candidate?.warUpdates);
    const orphaned = new Set();
    boundBefore.forEach((update, updateIndex) => {
      const eventIndexes = normalizeArray(update?.eventIndexes)
        .map(Number)
        .filter((index) => Number.isInteger(index) && index >= 0);
      if (eventIndexes.length && eventIndexes.every((index) => dropIndexes.has(index))) orphaned.add(updateIndex);
    });
    candidate.events = normalizeArray(candidate.events).filter((_, index) => !dropIndexes.has(index));
    if (orphaned.size) candidate.warUpdates = boundBefore.filter((_, index) => !orphaned.has(index));
    console.warn(
      `[ai] war ledger salvage: dropped ${dropIndexes.size} ambiguous hard-combat event(s) and ${orphaned.size} orphaned war record(s) ` +
      "after the model failed its corrective retry; keeping the rest of the segment.",
    );
    normalizeWorldWarEventLinks(candidate);
    warError = validateWarLedgerPayload(candidate, { world });
  }
  if (warError) return warError;

  const diplomaticError = validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true });
  if (diplomaticError) return diplomaticError;

  const boundEvents = normalizeArray(candidate.events);
  candidate.warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(candidate.warUpdates), boundEvents);
  candidate.relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(candidate.relationUpdates), boundEvents);
  candidate.agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(candidate.agreementUpdates), boundEvents);
  return "";
};

// One segment's storyline records, after its ledgers. The director's semantic
// binder attaches a strong unique match to its selected storyline, quiet echoes
// of deferred storylines are stripped, serious visible history must bite into a
// canonical owner, and the records are checked against the storyline ledger as
// the earlier segments left it. A stale selected storyline, or one whose update
// was omitted, is repaired LOCALLY after acceptance (repairAntiStasisStorylines)
// so one overdue process never discards a segment's other events.
const validateSegmentStorylines = (candidate, {
  world,
  analysis,
  strict,
  finalAttempt,
  originDate,
  targetDate,
  gameCountry,
}) => {
  normalizeWorldStorylineEventLinks(candidate, { world });
  const selectedBinding = bindSelectedStorylineEvents(candidate, {
    selectedStorylines: analysis?.attentionStorylines,
    world,
  });
  if (selectedBinding.bound) {
    console.info(
      `[OH world director] attached ${selectedBinding.bound} event(s) to their uniquely matching selected storyline(s).`,
    );
    // The binding is objective history; propagate it into the records before
    // anything judges a storyline by its visibility dates.
    normalizeWorldStorylineEventLinks(candidate, { world });
  }
  const deferredSalvage = stripQuietDeferredStorylineUpdates(candidate, analysis?.deferredStorylines);
  if (deferredSalvage.strippedIds.length) {
    console.warn(
      `[OH world director] stripped ${deferredSalvage.strippedIds.length} quiet or non-material deferred storyline update(s): ` +
      `${deferredSalvage.strippedIds.join(", ")}. The segment's other events and records stand.`,
    );
  }
  const consequenceError = validateWorldEventConsequencePayload(candidate, {
    selectedStorylines: analysis?.attentionStorylines,
    strict,
  });
  if (consequenceError) return `[world consequence] ${consequenceError}`;
  const storylineError = validateWorldStorylinePayload(candidate, {
    existingStorylines: world?.storylines,
    selectedStorylines: analysis?.attentionStorylines,
    deferredStorylines: analysis?.deferredStorylines,
    originDate,
    stopDate: normalizeString(candidate?.stopDate) || targetDate,
    world,
    enforceAntiStasis: false,
    enforceSelectedCoverage: false,
  });
  if (storylineError) return storylineError;
  return validateWorldExplorationAudit(candidate, analysis, { finalAttempt, world, gameCountry });
};

// Native integrity screening of an accepted segment BEFORE it joins the round:
// an event that is objectively impossible in this world (a non-belligerent's
// wartime economy) or an obvious no-delta restatement never feeds the next
// segment or the curator, and a ledger or storyline record bound only to a
// dropped event goes with it. The exploration audit of what survived is kept
// per segment for the post-curation breadth repair. The segment's temporary
// event ids are already bound into its ledger records (validateSegmentLedgers),
// so storyline ids are attached to the events in place, never by re-labelling.
const screenSegmentPayload = (payload, {
  analysis,
  priorEvents,
  world,
  game,
  state,
  originDate,
  targetDate,
  horizonDays,
  eventCeiling,
  generationSource,
}) => {
  const audit = deriveWorldExplorationAudit(payload, analysis, {
    world,
    gameCountry: game?.country,
  });
  state.breadthRepairContexts.push({
    analysis,
    explorationAudit: {
      quietSlotIds: audit.quietSlotIds,
      nonQuietCount: audit.nonQuietCount,
      slotCount: audit.slotCount,
    },
    originDate,
    targetDate,
    horizonDays,
    eventCeiling,
    generationSource,
  });

  const decodedStorylineUpdates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
  const taggedEvents = attachStorylineIdsByIndexes(payload?.events, decodedStorylineUpdates);
  const screened = screenGeneratedWorldEvents({
    events: taggedEvents,
    priorEvents,
    world,
    game,
    analysis,
  });
  if (screened.dropped?.length) {
    console.warn(
      `[OH world integrity] dropped ${screened.dropped.length} segment event(s) before the round: ` +
      screened.dropped.map((entry) => `"${entry?.title || entry?.id}" (${entry?.route})`).join(", "),
    );
  }
  payload.events = screened.events;
  payload.warUpdates = filterBoundLedgerUpdatesToKeptEvents(payload?.warUpdates, taggedEvents, screened.events);
  payload.relationUpdates = filterBoundLedgerUpdatesToKeptEvents(payload?.relationUpdates, taggedEvents, screened.events);
  payload.agreementUpdates = filterBoundLedgerUpdatesToKeptEvents(payload?.agreementUpdates, taggedEvents, screened.events);
  payload.storylineUpdates = filterStorylineUpdatesAfterIntegrityScreen({
    updates: decodedStorylineUpdates,
    allEvents: taggedEvents,
    existingStorylines: world?.storylines,
    dropped: screened.dropped,
  });
  payload.summary = stripWorldSweepAudit(payload?.summary);
};

// The one exploration audit the post-curation breadth repair works from: the
// segment whose slate was left quietest, widened to the whole jump. Only a jump
// of roughly a month qualifies (WORLD_BREADTH_REPAIR_MIN/MAX_DAYS).
const selectBreadthRepairContext = (state, context) => {
  const { mode, originDate, targetDate, safeDays, plannedActionCount } = context;
  if (mode !== "jump" || safeDays < WORLD_BREADTH_REPAIR_MIN_DAYS || safeDays > WORLD_BREADTH_REPAIR_MAX_DAYS) {
    return null;
  }
  const ranked = normalizeArray(state.breadthRepairContexts)
    .map((entry) => ({
      entry,
      quietCount: quietWorldBreadthSlots(entry?.analysis, entry?.explorationAudit).length,
    }))
    .sort((a, b) => b.quietCount - a.quietCount);
  const chosen = ranked[0]?.entry;
  if (!chosen) return null;
  return {
    ...chosen,
    originDate,
    targetDate,
    horizonDays: safeDays,
    eventCeiling: segmentEventRange(safeDays, plannedActionCount)[1],
    generationSource: normalizeString(state.generation?.source) || "ai",
  };
};

// The world a later segment is validated against and shown: the base world plus
// the war, diplomacy and storyline records of the segments already in hand. No impacts are
// applied here - the round's events are applied once, at the end.
const advanceLedgerWorld = (world, payload, { stopDate = "", round = 0 } = {}) => {
  const events = normalizeArray(payload?.events);
  const warMerge = applyWarUpdates({
    world,
    updates: normalizeArray(payload?.warUpdates),
    events,
    stopDate,
    round,
  });
  const diplomaticMerge = applyDiplomaticUpdates({
    world: warMerge.world,
    relationUpdates: normalizeArray(payload?.relationUpdates),
    agreementUpdates: normalizeArray(payload?.agreementUpdates),
    events,
    stopDate,
    round,
  });
  // Storylines too, so the next segment's world director sees a crisis born
  // mid-round and lets it compete for attention before the round ends.
  return applyWorldStorylineUpdates({
    world: diplomaticMerge.world,
    updates: normalizeArray(payload?.storylineUpdates),
    events,
    stopDate,
    round,
  }).world;
};

// A save from before the ledgers existed has its treaties and alliances only as
// events (and some standing alliances only in chats). Seed the two ledgers from
// them once; the version stamp keeps it from running again.
const withDiplomaticLedgerMigration = (bundle) => {
  const migration = migrateLegacyDiplomaticState({
    world: bundle.world,
    events: bundle.events,
    chats: bundle.chats,
    game: bundle.game,
  });
  if (!migration.migrated) return bundle;
  console.info(
    `[ai] diplomacy ledger seeded from ${migration.scannedEvents} legacy event(s) and ${migration.scannedChats || 0} chat(s): ` +
    `${migration.agreementsAdded} agreement(s), ${migration.relationsAdded} relation(s).`,
  );
  logDebugEvent("turn", "Diplomacy ledger seeded from the save's legacy treaty events.", {
    scannedEvents: migration.scannedEvents,
    agreementsAdded: migration.agreementsAdded,
    relationsAdded: migration.relationsAdded,
  }, { verbose: true });
  return { ...bundle, world: migration.world };
};

// ---- Native country stats (Continuum C7) ------------------------------------
// The Stats tool answers with a bounded set of demographic macro buckets; native
// code expands them into the exact live-map component ledger before the sheet
// is validated and persisted (see generateCountryStatSheet).
const decodeCountryStatMacroEstimates = (value, macroPlan = []) => {
  const nativePlan = normalizeArray(macroPlan)
    .map((entry, index) => ({
      index: Number(entry?.index) || index + 1,
      memberCount: normalizeArray(entry?.members).length,
    }))
    .filter((entry) => entry.memberCount > 0);

  const text = normalizeString(value);
  if (nativePlan.length > 0) {
    if (!text) {
      return { estimates: [], error: `territorialMacroComponentsText is empty; return exactly ${nativePlan.length} macro estimate row(s).` };
    }

    const estimates = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split("~").map((part) => part.trim());
      if (parts.length !== 4) continue;

      const index = Number(parts[0]);
      const group = parts[1].toLowerCase();
      const population = Number(String(parts[2]).replace(/[,_\s]/g, ""));
      const gdpPerCapita = Number(String(parts[3]).replace(/[,_€$£\s]/g, ""));

      if (!Number.isInteger(index) || !nativePlan.some((entry) => entry.index === index)) continue;
      if (!["core", "integrated", "overseas/dependent"].includes(group)) continue;
      if (!Number.isFinite(population) || population < 0) continue;
      if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;
      if (estimates.has(index)) continue;

      estimates.set(index, {
        index,
        group,
        population: Math.round(population),
        gdpPerCapita,
      });
    }

    const missing = nativePlan.map((entry) => entry.index).filter((index) => !estimates.has(index));
    if (missing.length > 0 || estimates.size !== nativePlan.length) {
      return {
        estimates: [],
        error: `territorialMacroComponentsText must contain exactly one valid row for every native macro bucket; missing index(es): ${missing.join(", ") || "none"}.`,
      };
    }
    return { estimates: nativePlan.map((entry) => estimates.get(entry.index)), error: "" };
  }

  // Compatibility fallback for landless/custom scenarios with no native map basis.
  // In that rare path, accept the old group~geography~population~gdpPerCapita rows
  // and return them as ready-made components rather than inventing macro geography.
  if (!text) return { estimates: [], components: [], error: "" };
  const components = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const parts = rawLine.trim().split("~").map((part) => part.trim());
    if (parts.length !== 4) continue;
    const [groupRaw, geography, populationRaw, gdpPerCapitaRaw] = parts;
    const group = groupRaw.toLowerCase();
    const population = Number(String(populationRaw).replace(/[,_\s]/g, ""));
    const gdpPerCapita = Number(String(gdpPerCapitaRaw).replace(/[,_€$£\s]/g, ""));
    if (!["core", "integrated", "overseas/dependent"].includes(group)) continue;
    if (!geography || !Number.isFinite(population) || population < 0) continue;
    if (!Number.isFinite(gdpPerCapita) || gdpPerCapita <= 0) continue;
    components.push({ geography, group, population: Math.round(population), gdpPerCapita });
  }
  return { estimates: [], components, error: "" };
};


const STATS_ACCOUNTING_BASE_YEAR = 2026;

const validateNativeEconomicCalibration = ({
  calibration,
  populationCalibration,
  components,
  eligibleEvidenceIds,
  currentDate,
} = {}) => {
  if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    return "economicCalibration is required for a fresh/hard-audit native Stats baseline.";
  }

  const allowedModes = new Set(["historical_start", "counterfactual_start", "campaign_reconstruction"]);
  const mode = normalizeString(calibration?.mode);
  const cutoff = normalizeString(calibration?.historyAuthorityCutoff);
  const basis = normalizeString(calibration?.basis);
  const anchorYear = Math.trunc(Number(calibration?.anchorYear));
  const anchorCurrency = normalizeString(calibration?.anchorCurrency).toUpperCase();
  const nominalGdpBillions = Number(calibration?.nominalGdpBillions);
  const nominalGdpPerCapita = Number(calibration?.nominalGdpPerCapita);
  const rebasedGdpPerCapita = Number(calibration?.rebasedGdpPerCapita2026Eur);
  const divergenceEventIds = normalizeArray(calibration?.divergenceEventIds)
    .map(normalizeString)
    .filter(Boolean);

  if (!allowedModes.has(mode)) {
    return `economicCalibration.mode must be historical_start, counterfactual_start, or campaign_reconstruction; received ${mode || "blank"}.`;
  }
  if (!cutoff) return "economicCalibration.historyAuthorityCutoff is required.";
  if (!basis) return "economicCalibration.basis must briefly state the nominal-output evidence used.";
  if (!Number.isInteger(anchorYear) || anchorYear < 1 || anchorYear > 9999) {
    return "economicCalibration.anchorYear must be a real integer year.";
  }
  if (!new Set(["USD", "EUR"]).has(anchorCurrency)) {
    return "economicCalibration.anchorCurrency must be USD or EUR so native code can audit the rebasing scale.";
  }
  if (!(nominalGdpBillions > 0) || !(nominalGdpPerCapita > 0) || !(rebasedGdpPerCapita > 0)) {
    return "economicCalibration nominal GDP, nominal GDP/capita, and rebased 2026-EUR GDP/capita anchors must all be positive.";
  }

  const populationMode = normalizeString(populationCalibration?.mode);
  if (populationMode && populationMode !== mode) {
    return `economicCalibration.mode (${mode}) must match populationCalibration.mode (${populationMode}) for the same baseline.`;
  }

  const eligible = new Set(normalizeArray(eligibleEvidenceIds).map(normalizeString).filter(Boolean));
  const invalidEvidence = divergenceEventIds.filter((id) => !eligible.has(id));
  if (invalidEvidence.length) {
    return `economicCalibration.divergenceEventIds contains event id(s) not present in the bounded fresh economic evidence: ${invalidEvidence.join(", ")}.`;
  }

  // The rebasing factor is an ACCOUNTING conversion only: contemporaneous nominal
  // USD/EUR -> constant 2026 EUR. It must never smuggle PPP/international-dollar
  // purchasing power into the canonical nominal GDP ledger. The modern-era ceiling
  // is intentionally generous enough for CPI + FX movement while still rejecting
  // the classic 2x-3x PPP substitution seen in Belarus-style failures.
  const rebasingFactor = rebasedGdpPerCapita / nominalGdpPerCapita;
  if (anchorYear >= 2000 && anchorYear <= STATS_ACCOUNTING_BASE_YEAR) {
    const maxModernFactor = Math.min(
      3,
      1 + (STATS_ACCOUNTING_BASE_YEAR - anchorYear) * 0.075,
    );
    if (rebasingFactor < 0.45 || rebasingFactor > maxModernFactor) {
      return (
        `economicCalibration rebasing factor ${rebasingFactor.toFixed(2)}x is not credible for a ${anchorYear} ${anchorCurrency} nominal anchor ` +
        `(allowed modern accounting range 0.45x-${maxModernFactor.toFixed(2)}x). Do not substitute PPP/international-dollar output for nominal GDP.`
      );
    }
  }

  const cutoffYearMatch = cutoff.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  const cutoffYear = cutoffYearMatch ? Number(cutoffYearMatch[1]) : null;
  if (mode === "historical_start" && Number.isInteger(cutoffYear) && anchorYear > cutoffYear + 1) {
    return (
      `economicCalibration.anchorYear ${anchorYear} lies after the shared-history cutoff ${cutoffYear}. ` +
      "Later real-world economic outcomes are forbidden after scenario divergence."
    );
  }

  const rows = normalizeArray(components);
  const totalPopulation = rows.reduce(
    (sum, component) => sum + Math.max(0, Number(component?.population) || 0),
    0,
  );
  const totalGdp = rows.reduce(
    (sum, component) =>
      sum +
      Math.max(0, Number(component?.population) || 0) *
        Math.max(0, Number(component?.gdpPerCapita) || 0),
    0,
  );
  const generatedGdpPerCapita = totalPopulation > 0 ? totalGdp / totalPopulation : 0;

  if (mode === "historical_start" && totalPopulation > 0) {
    const impliedAnchorPopulation = (nominalGdpBillions * 1e9) / nominalGdpPerCapita;
    const scopeRatio = impliedAnchorPopulation / totalPopulation;
    if (scopeRatio < 0.6 || scopeRatio > 1.67) {
      return (
        `economicCalibration nominal GDP and GDP/capita imply ${Math.round(impliedAnchorPopulation).toLocaleString()} people, ` +
        `but the authoritative live baseline contains ${Math.round(totalPopulation).toLocaleString()}. ` +
        "The nominal economic anchor appears to use the wrong territorial scope."
      );
    }

    const currentYear = parseIsoDate(currentDate)?.year;
    const elapsedYears = Number.isInteger(currentYear) ? Math.max(0, currentYear - anchorYear) : 0;
    const noEvidenceMultiplier = Math.min(2, 1.35 + elapsedYears * 0.08);
    const scaleRatio = generatedGdpPerCapita / rebasedGdpPerCapita;
    const scaleOutsideUnexplainedRange =
      generatedGdpPerCapita > 0 &&
      (scaleRatio > noEvidenceMultiplier || scaleRatio < 1 / noEvidenceMultiplier);

    if (scaleOutsideUnexplainedRange && divergenceEventIds.length === 0) {
      return (
        `Generated nominal GDP/capita (${Math.round(generatedGdpPerCapita).toLocaleString()} 2026-EUR) is ${scaleRatio.toFixed(2)}x the audited ` +
        `historical nominal anchor (${Math.round(rebasedGdpPerCapita).toLocaleString()} 2026-EUR) without any cited canonical economic divergence event. ` +
        "Preserve the nominal historical scale or cite supplied divergenceEventIds that causally justify the departure."
      );
    }
  }

  return "";
};


// World-simulation transport envelope: young campaigns get their complete
// consolidated history; once it exceeds the activation ceiling the same budget
// becomes broad summary coverage plus canonical event anchors, so decisive
// divergences never disappear merely because they are old.
const WORLD_SIMULATION_CONSOLIDATED_HISTORY_MAX_CHARS = 24000;
const WORLD_SIMULATION_HISTORICAL_ANCHOR_ACTIVATION_CHARS = 24000;
const WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_CHARS = 6000;
const WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_ITEMS = 18;

const perfNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const buildTerritorialControlContext = async (worldLike) => {
  const world = normalizeWorldState(worldLike);
  const catalog = await loadRegionCatalog().catch(() => []);
  const byId = new Map(catalog.map((region) => [region.id, region]));
  const ids = new Set([
    ...Object.keys(world.regionOwnershipOverrides || {}),
    ...Object.keys(world.regionSovereigntyOverrides || {}),
    ...Object.keys(world.regionClaimants || {}),
  ]);

  const rows = [];
  for (const regionId of ids) {
    const region = byId.get(regionId);
    const baseOwner = normalizeString(region?.country || toCountryName(region?.countryCode) || "");
    const controller = normalizeString(world.regionOwnershipOverrides?.[regionId]) || baseOwner;
    const sovereign = normalizeString(world.regionSovereigntyOverrides?.[regionId]) || controller || baseOwner;
    const claimants = normalizeArray(world.regionClaimants?.[regionId]).map(normalizeString).filter(Boolean);

    if (!claimants.length && controller.toLowerCase() === sovereign.toLowerCase()) continue;

    rows.push(
      `- ${region?.name || regionId} (${regionId}): sovereign ${sovereign || "unknown"}; ` +
      `controller ${controller || "unknown"}` +
      (claimants.length ? `; active claimants/contenders ${claimants.join(", ")}` : ""),
    );
  }

  return rows.length > 0
    ? rows.slice(0, 80).join("\n") + (rows.length > 80 ? `\n(+${rows.length - 80} more non-normal territorial states omitted)` : "")
    : "No active occupation/control-vs-sovereignty differences or contested regions are currently recorded.";
};

const buildGameMasterStorylineContext = (worldLike) => {
  const world = normalizeWorldState(worldLike);
  const storylines = normalizeArray(world.storylines)
    .filter((entry) => entry && typeof entry === "object" && normalizeString(entry.id))
    .slice(0, 24);
  if (!storylines.length) return "No persistent world storylines are currently recorded.";
  return storylines.map((entry) => {
    const participants = normalizeArray(entry.participants).map(normalizeString).filter(Boolean);
    return [
      `- ${normalizeString(entry.id)} | ${normalizeString(entry.status) || "active"} | ` +
        `pressure ${Math.max(0, Math.min(100, Math.round(Number(entry.pressure) || 0)))}/100 | ` +
        `momentum ${Math.max(0, Math.min(100, Math.round(Number(entry.momentum) || 0)))}/100`,
      `  ${normalizeString(entry.title) || "Untitled process"}${participants.length ? ` | participants: ${participants.join(", ")}` : ""}`,
      `  state: ${normalizeString(entry.state) || "No current semantic state recorded."}`,
    ].join("\n");
  }).join("\n");
};

// The intelligence rating the AI evolves (world.intelligence), surfaced for the
// same reason reputation is: a number the model never sees is a number it never
// moves. Field report: a player built spy academies and researched the tech for
// a dozen turns and the rating never budged. The plumbing was fine — schema
// field, normalizer, applyEventImpactsToWorld, the Stats panel's own bar all
// read and write it — but the ONLY mention of it anywhere in a jump prompt was
// one clause in the actions menu telling the model to change it "only when
// something changed it", with no current value to change FROM. Across a dozen
// real saves not one event had ever set it, while reputation (which does get a
// block like this) moved normally.
//
// Unrated is "ordinary", not "none": every polity runs a service whether or not
// the AI has ever put a number on it (spycraft.js DEFAULT_INTELLIGENCE).
const buildPlayerPolityIntelligenceText = (bundle) => {
  const playerCode = normalizeString(bundle.game.country);
  if (!playerCode) {
    return "";
  }
  const world = bundle.world && typeof bundle.world === "object" ? bundle.world : {};
  const rating = intelligenceOf(world, playerCode);
  const band = rating >= 75 ? "formidable" : rating >= 55 ? "capable" : rating >= 35 ? "ordinary" : "weak";
  const lines = [`${playerCode}'s intelligence service: ${rating}/100 (${band}).`];

  // Only services the AI has actually rated. Every other polity is ordinary by
  // definition, and listing two hundred identical defaults would bury the few
  // that carry a real judgement.
  const rated = Object.entries(world.intelligence ?? {})
    .map(([code, value]) => [normalizeString(code), Number(value)])
    .filter(([code, value]) => code && code !== playerCode && Number.isFinite(value))
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
  if (rated.length > 0) {
    lines.push(`Other rated services: ${rated.map(([code, value]) => `${code} ${Math.round(value)}/100`).join(", ")}.`);
  }

  return lines.join("\n");
};

const buildTemplateVariables = async (bundle, options = {}) => {
  const startedAt = perfNow();
  const taskKey = normalizeString(options?.taskKey);
  const explicitRequiredKeys = options?.requiredKeys;

  // Demand comes from the ACTUAL loaded prompt pack (campaigns carry frozen and
  // custom templates), so a task pays only to construct the context it can see.
  // When demand cannot be resolved the build falls open to the full context:
  // that request may cost more, but model-visible knowledge never shrinks.
  let demand = null;
  if (explicitRequiredKeys == null && taskKey) {
    try {
      const prompts = await loadPromptCatalog();
      const promptTemplate = taskKey === "gameMaster" ? NATIVE_GAME_MASTER_PROMPT : prompts.tasks[taskKey];
      if (promptTemplate) {
        demand = resolveTemplateVariableDemand({
          helperTemplates: prompts.helpers,
          promptTemplate,
          taskKey,
          variables: {},
        });
      }
    } catch {
      demand = null;
    }
  }
  const requiredKeys = explicitRequiredKeys != null
    ? explicitRequiredKeys
    : demand?.requiredVariableKeys ?? null;
  const requiredSet = requiredKeys == null
    ? null
    : new Set(
        (requiredKeys instanceof Set ? [...requiredKeys] : normalizeArray(requiredKeys))
          .map(normalizeString)
          .filter(Boolean),
      );
  const wants = (key) => !requiredSet || requiredSet.has(key);

  const variables = await buildPromptContext(bundle, { ...options, requiredKeys, taskKey });
  // The diplomatic slice is bounded to the player plus, for a chat task, the
  // polities in the thread; wars are few enough to show whole.
  const focusActors = normalizeArray(options?.chat?.countries)
    .map((country) => normalizeString(country?.name || country?.code))
    .filter(Boolean);
  if (wants("canonicalWarContext")) {
    variables.canonicalWarContext = buildCanonicalWarContext(bundle.world);
  }
  if (wants("canonicalDiplomaticContext")) {
    variables.canonicalDiplomaticContext = buildBoundedDiplomaticContext(bundle.world, {
      playerPolity: normalizeString(bundle?.game?.country),
      focusActors,
      maxActors: 8,
    }).text;
  }
  if (wants("territorialControlContext")) {
    variables.territorialControlContext = await buildTerritorialControlContext(bundle.world);
  }
  if (wants("canonicalStorylineContext")) {
    variables.canonicalStorylineContext = buildGameMasterStorylineContext(bundle.world);
  }
  if (wants("playerPolityReputationContext")) {
    variables.playerPolityReputationContext = await buildPlayerPolityReputationText(bundle);
  }
  if (wants("playerPolityIntelligenceContext")) {
    variables.playerPolityIntelligenceContext = buildPlayerPolityIntelligenceText(bundle);
  }
  if (wants("unitsSummary")) {
    variables.unitsSummary =
      normalizeString(variables.unitsSummary) +
      buildMilitaryFeasibilityText(bundle.world, buildActionHistoryText(bundle.actions));
  }
  if (isContextDiagnosticsEnabled()) {
    console.info(
      `[context] ${taskKey || "task"}: ${Object.keys(variables).length} variable(s)` +
      `${requiredSet ? ` for ${requiredSet.size} demanded` : " (full build)"} in ${(perfNow() - startedAt).toFixed(1)} ms`,
    );
  }
  return variables;
};

// Give the AI real time: local/self-hosted models (and reasoning modes) often
// need well over a minute per turn. The old 12s default silently discarded
// their answers and served the canned fallback instead — turns "completed"
// with nothing to show. The UI has spinners; waiting beats silently wrong.
// Capability reference appended to every timeline jump (see runJsonTask below): the
// full menu of world-changing levers the tool schema exposes, so the model always ends
// its system prompt with an explicit list of what it can do and how. Injected at call
// time so it reaches existing frozen-prompt games too.
const ACTIONS_REFERENCE = "[Actions You Can Take]\nThis is the full menu of levers you have to change the world. Everything you change rides on an event's \"impacts\" object, except the two whole-jump levers noted at the end. Reach for the RIGHT lever, and NEVER narrate a change in an event's text without also emitting the impact that makes it real — narration and world state must always agree.\n\n• regionTransfers — Move a region to a new owner. This is the most important lever and the one most often forgotten: use it for every conquest, cession, sale, liberation, annexation, or hand-over, one entry per region. Shape: {\"regionId\":\"<exact id, or the plain region name if you don't know the id>\",\"regionName\":\"\",\"fromCode\":\"\",\"toCode\":\"<new owner code>\"}. An event whose text says land changed hands but that carries no regionTransfers is invalid output and silently breaks the map. Transfer in order of proximity to the attacker's territory; never hand over an isolated region ringed by enemy land without a naval or airborne reason. A transfer is enacted IMMEDIATELY when the other side has agreed (a treaty, a negotiated cession, an event where they conceded) or when the ground has already been taken and held - a hand-over both sides accept needs no programme and no project. Where neither is true the land has NOT changed hands: record the claim with regionClaims instead and leave the border exactly where it is.\n\n• polityChanges — Create, rename, recolor, or re-describe a polity. One entry can do any combination: {\"code\":\"<polity code>\",\"name\":\"<new name, only if it changed>\",\"color\":\"#RRGGBB (only if it changed)\",\"aliases\":[\"...\"],\"reputation\":0-100,\"intelligence\":0-100,\"tags\":[\"...\"],\"stats\":{...},\"note\":\"<why>\"}. Create a polity by giving a new code with a name and color. Change name/color when the polity's identity actually changes - a regime change, a revolution, a unification or partition, a proclaimed republic or a restored monarchy - and ALWAYS when the player has ordered it for their own polity. A mere new leader is not a rename. But a rename or recolour the player has ordered for THEIR OWN country is an administrative act of their own government: it needs no other power's consent, it cannot be refused, and it must be enacted in this jump by an event carrying polityChanges with the new name and that action's id in actionIds. Keep \"code\" as the polity's CURRENT name - the engine matches on it and then stores the new one; a change addressed to the name you are introducing lands on nothing and mints a second country beside the real one. On an ideological or alignment shift, rewrite the COMPLETE tags list (it is a full replacement, not a delta). Set reputation (0 = pariah, 100 = universally trusted) only when this turn's events actually moved a polity's standing. Set intelligence (0 = no service to speak of, 100 = the best in the world) only when something changed it: a purge or defection, a new bureau or budget, a foreign spy ring exposed, a player action that built the service up or ran it down. A SUDDEN shock — a purge, a defector, a ring rolled up — is a direct change here and takes effect at once. Building a service UP is not sudden and does not belong here: open it on the Projects board as a programme and put the new rating in that project's onComplete.polityChanges, so it arrives when the work actually finishes and the player can watch it coming, fund it, or have a rival wreck it first. Deciding to have a better service is not the same as having one. A country's national statistics move ONLY through \"stats\" here — send just the fields that changed; everything omitted keeps its prior value. That includes WHO LEADS: when a leader is overthrown, assassinated, dies, resigns or is voted out, put the successor's name in stats.leader (together with stats.government and stats.stability when those moved too). An event that narrates a leader falling but leaves stats.leader untouched leaves the OLD name standing on that country's stat sheet, so the story and the sheet disagree.\n\n• regionClaims — Mark territory CLAIMED but not held, so the map can show a dispute instead of pretending nothing happened. Use it when a polity asserts a right to land it does not control and has not been given: an irredentist declaration, a proclaimed union, a contested border, a government-in-exile's title, a player declaring a neighbour's province theirs. Shape: {\"regionId\":\"<exact id, or the plain region name>\",\"claimantCode\":\"<claiming polity's full name>\",\"note\":\"<why>\"}; add \"drop\":true to withdraw a claim that was renounced, traded away, or lost with the claimant's defeat. The region renders striped in every claimant's colour and stays that way until it is settled - by a regionTransfers entry when someone finally wins or concedes it, or by a drop. NEVER move a border for a claim alone, and never leave a claim unrecorded either: a declaration that changes nothing the player can see is a declaration they cannot tell they made.\n\n• unitOps — Move the war on the map with battalions. Four ops:\n    {\"op\":\"spawn\",\"unit\":{\"name\":\"\",\"type\":\"infantry|armor|air|naval|artillery|garrison\",\"ownerCode\":\"\",\"strength\":1-1000,\"lng\":0,\"lat\":0,\"regionId\":\"\"}}\n    {\"op\":\"move\",\"unitId\":\"<existing id>\",\"toLng\":0,\"toLat\":0,\"regionId\":\"\",\"note\":\"\"}\n    {\"op\":\"strength\",\"unitId\":\"<existing id>\",\"strength\":0-1000,\"note\":\"\"}\n    {\"op\":\"remove\",\"unitId\":\"<existing id>\",\"note\":\"\"}\n  Spawn units for mobilizations and reinforcements, move them to reflect offensives, lower their strength as they take losses, and remove them only when destroyed or disbanded. Only reference unit ids that appear in the current-units list. When a front is decisively won, pair the advance with a regionTransfers entry so the border follows the troops.\n\n• markerOps — Place, remove, rename or resize a named structure or city. Four ops:\n    {\"op\":\"build\",\"marker\":{\"name\":\"\",\"kind\":\"<lowercase, e.g. military base / port / embassy / airfield / city>\",\"ownerCode\":\"\",\"lng\":0,\"lat\":0,\"note\":\"\",\"foundedAt\":\"\"}}\n    {\"op\":\"remove\",\"name\":\"<exact existing name>\",\"note\":\"\"}\n    {\"op\":\"rename\",\"name\":\"<current name>\",\"newName\":\"<new name>\",\"note\":\"<why>\"}\n    {\"op\":\"population\",\"name\":\"<city>\",\"population\":<whole number of people>,\"note\":\"<why>\"}\n  Emit build whenever an event founds or constructs a place, remove when one is destroyed, and rename when a city or structure is renamed (rename works on existing map cities too — a city renamed after a leader or ideology, a capital re-designated, a conquered city given the conqueror's name). Structures NEVER move borders: a facility one polity builds inside another's land does not transfer the region, and ownerCode is who runs the facility, not who owns the ground. Emit population whenever an event plausibly moves how many people live somewhere - a siege, famine, epidemic, bombing or evacuation shrinking a city; an industrial boom, resettlement or refugee influx growing one - giving the new TOTAL, not the change. It works on any city on the map, whether the scenario authored it or it came with the world.\n\n• createdChats — Have another polity open a diplomatic chat with the player BECAUSE of this event (a war scare prompting mediation, a border incident prompting an ultimatum, a windfall prompting a trade delegation). Shape: {\"countries\":[\"...\"],\"title\":\"<names the purpose>\",\"speaker\":\"<the initiating polity — never the player>\",\"openingMessage\":\"<that leader's first message, in their voice>\"}. The other side always speaks first; a blank or untitled chat is invalid.\n\n• actionIds — List the ids of the player's queued actions that this event resolves, so the game can clear them from the queue.\n\nWhole-jump levers (top level of your output, NOT inside an event):\n• diplomaticOutreach — Polities reaching out to the player on their OWN initiative this period — treaty feelers, trade proposals, non-aggression pacts, mediation offers, warnings, summit invitations — not tied to any single event. Same shape as createdChats. Open one whenever a polity plausibly would, rather than defaulting to none.\n• catalyst — An interactive branching scene handed to the player when a moment genuinely demands their decision, or null when none is warranted. Shape: {\"title\":\"\",\"premise\":\"\",\"opening\":\"\",\"choices\":[\"...\", \"...\", up to 5 distinct]}.\n\nKeep the total across createdChats and diplomaticOutreach to at most 3 per jump, and only when the approach genuinely serves the sender's interests.";

// Written into a fallback's rawResponse when there is no model output to show.
// Exported so the debug report (time.jsx) can tell this apart from real model
// text and label its section honestly, rather than matching on the wording.
export const NO_RESPONSE_BODY_NOTE = "(no response body — the request failed before the model answered, so there was nothing to parse. See the failure reason above: a transport or HTTP error like this usually means the provider URL, API key or model name is wrong, not that the model misbehaved.)";
export const EMPTY_RESPONSE_BODY_NOTE = "(the provider returned an empty response body — the request succeeded but the model produced no text)";

// "Limit AI generation" (ON by default) — the whole policy, in one place rather
// than a number per call site.
//
// It used to be a stopwatch: five minutes for a jump, two for most tasks, one
// for the small ones, counted from the moment the request was sent and applied
// whether or not the model was answering. That could not tell a slow model from
// a stopped one, so it was off by default and the game waited forever instead —
// which is no protection at all, and left players watching a dead spinner.
//
// Now it counts SILENCE (idleDeadline.js): five minutes with nothing arriving
// part-way through an answer, fifteen with no answer at all. A model that keeps
// writing is never interrupted however long the turn takes, so the setting is
// safe to ship on; a stalled one is caught instead of hanging the turn forever.
// Off still means "wait as long as the model needs".
const taskIdleTimeoutMs = () =>
  (getMapSettingDefaultOn(MAP_SETTING_KEYS.limitAiGeneration) ? AI_IDLE_TIMEOUT_MS : 0);

// Difficulty 2.0 carries one directive per scope; chat-shaped tasks get the
// diplomacy reading, catalysts their own, everything else the simulation one.
const difficultyScopeForTask = (taskKey) => {
  if (["idleDiplomacy", "nextSpeaker"].includes(taskKey)) return "diplomacy";
  if (String(taskKey || "").startsWith("catalyst")) return "catalyst";
  return "simulation";
};

// Telemetry: how much in-game time this task's prompt covers, from the round
// dates the template variables carry. Null for tasks without a window.
const computeSimulatedDays = (variables) => {
  const origin = Date.parse(String(variables?.date ?? ""));
  const target = Date.parse(String(variables?.targetDate ?? ""));
  if (!Number.isFinite(origin) || !Number.isFinite(target)) return null;
  return Math.max(0, Math.round((target - origin) / 86400000));
};

const runJsonTask = async (taskKey, {
  fallback,
  signal,
  userMessage,
  validatePayload,
  variables,
  // Batch routing (ported from the abdulrahman-2005 fork): sync:false marks a
  // task nobody is waiting on. When the player opted in (Settings → Batch
  // background AI tasks) and the provider has a batch endpoint, the task is
  // submitted there and onBatchResult(payload, source) fires from the poller
  // when the validated answer lands — or with the fallback's answer when it
  // fails. Everything else takes the normal synchronous path, unchanged.
  sync = true,
  onBatchResult,
}) => {
  const prompts = await loadPromptCatalog();
  // The GM operational contract is native behaviour: a campaign's frozen
  // gameMaster prompt would silently roll the transaction semantics back.
  const promptTemplate = taskKey === "gameMaster" ? NATIVE_GAME_MASTER_PROMPT : prompts.tasks[taskKey];
  const liveDemand = resolveTemplateVariableDemand({
    helperTemplates: prompts.helpers,
    promptTemplate,
    taskKey,
    variables,
  });
  const helperValues = resolveHelperValues(prompts.helpers, variables, { includeKeys: liveDemand.helperKeys });
  // Two-pass layout (promptLayout.js): the game-lifetime constants come out
  // first, so the prompt opens with a prefix that is byte-identical from one
  // call to the next within a campaign — the part a provider's prompt cache
  // can discount. Kept as text rather than an offset because the directives
  // and the de-duplication below rewrite the prompt; the offset is recomputed
  // when the call goes out.
  const rendered = renderTemplateCached(promptTemplate, {
    ...variables,
    ...helperValues,
  });
  let systemPrompt = rendered.text;
  const staticPromptPrefix = rendered.text.slice(0, rendered.staticPrefixEnd);

  // The chosen difficulty steers every simulation task (see runtime/difficulty.js).
  try {
    const game = await readGameData();
    systemPrompt = `${systemPrompt}\n\n${difficultyDirective(game.difficulty, difficultyScopeForTask(taskKey))}`;
  } catch {
    // Without game data the task still runs at its default temperament.
  }

  // Player agency: jumps must never sign the player up for landmark decisions.
  // Appended here (not only in defaultPrompts.json) because every game carries
  // its own frozen copy of the task prompts — a directive added at call time is
  // the only way the rule reaches campaigns that already exist. Field report:
  // "the AI just makes events saying that you form a treaty with another
  // country ... it just doesn't give you a choice and makes it an event."
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[Player Agency]\n${playerName} is controlled by a human player. Never commit ${playerName} to a major decision the player did not actually make: do not sign treaties, alliances, ceasefires, surrenders, trade pacts, unions, or other binding agreements on the player's behalf, do not accept or reject offers for them, and do not have ${playerName} take landmark unilateral action (declaring war, ceding territory, changing government) unless it directly executes one of the player's planned actions, chat replies, or explicit requests. When another polity seeks such an agreement or decision from the player, present it as something the player can answer: a diplomaticOutreach entry or an impacts.createdChats chat where the counterpart speaks first and makes the proposal, or an event describing the offer as OPEN and awaiting the player's response. Events remain free to narrate what other polities do among themselves and to resolve the player's own queued actions exactly as ordered.`;
    // Map truth: the recurring field report is the OPPOSITE failure — invasions
    // narrated turn after turn with zero regionTransfers, so the map never moves.
    // Appended at call time for the same reason as [Player Agency]: existing
    // campaigns carry frozen prompts, so a defaultPrompts.json rule never
    // reaches them. This also disarms an over-cautious reading of the agency
    // rule above ("don't act for the player") as "don't move the map".
    systemPrompt = `${systemPrompt}\n\n[Map Truth — Control is not Sovereignty]\nTerritorial narration and the map must never disagree, but wartime control and legal sovereignty are DIFFERENT things. A battle capture, occupation, liberation or retaking uses impacts.regionControlOps (usually op=control; op=contest while the region is actively disputed). A treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement uses impacts.regionTransfers because legal sovereignty changed. Do NOT turn every front-line advance into a permanent legal border. When you do not know the exact region id, preserve the grounded place wording in regionId and set fromCode so the native geography resolver can map it conservatively. Resolving ${playerName}'s own ordered military operations into their real control consequences is REQUIRED and is never a player-agency violation. If nothing actually changed control or sovereignty this period, keep capture/cession language out of the event text.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
    // No restating: the model is shown the recent timeline as context and, left
    // unchecked, re-narrates events it already reported — each restatement gets a
    // fresh id, so the same event stacks up and shows turn after turn. A content-key
    // de-dup on the write path (dedupeGeneratedEvents) drops exact/same-date
    // restatements; this directive stops the "rolling-date" ones (the same situation
    // re-narrated under each new turn's date) that a de-dup can't catch. Appended at
    // call time so existing frozen-prompt campaigns get it too.
    systemPrompt = `${systemPrompt}\n\n[New Developments Only]\nThe events shown to you above have ALREADY happened and appear only as context. Do NOT restate, rephrase, re-report, or re-narrate them. Emit ONLY genuinely NEW developments that occur during THIS period. If an ongoing situation (a war, a crisis, an occupation) has no new development this period, do not emit an event for it.`;
    // Place renaming: appended at call time so existing frozen-prompt campaigns get it
    // too; the markerOps rename op ships via the LIVE tool schema either way.
    systemPrompt = `${systemPrompt}\n\n[Place Renaming]\nYou may rename places when the story warrants it (a city renamed after a leader or ideology, a capital re-designated, a colonial name replaced, a conquered city given the conqueror's name). Emit an impacts.markerOps entry {"op":"rename","name":"<current name>","newName":"<new name>","note":"<why>"}. This works on structures you built AND on existing map cities. Do it sparingly and only when a real event motivates it.`;
  }

  // Two tasks get the espionage picture, framed differently because they do
  // different jobs with it: the simulator turns it into events, the board turns
  // it into entries. Both see the same uncensored brief.
  if (["jumpForward", "autoJumpForward", "projects"].includes(taskKey)) {
    try {
      const [world, game] = await Promise.all([readWorldState({ force: false }), readGameData()]);
      const brief = espionageBrief(normalizeWorldState(world), await readOpenedIntercepts(), { playerPolity: normalizeString(game.country) });
      if (brief) {
        const framing = taskKey === "projects"
          ? "\n\n[Espionage]\nWhat the player's service has read, uncensored — the player sees only what it could decode. This is the ONE source that can put another power's long-term work on the board: when an intercept reveals a programme a rival is running (a weapon, a canal, a mobilisation, a covert operation of their own), open it as a FOREIGN entry with ownerCode set to that polity's full name, and move it as later intercepts say it moved. Reach for this only when the traffic genuinely shows a sustained effort — a rival grumbling about a treaty is not a programme.\nA report from a TURNED agent is marked as planted, and what it describes may be a fabrication. Open it anyway if it reads as a programme: the board records what the player's service believes, and a phantom entry that never delivers is exactly what a successful deception looks like from this side. Never write that an agent has been turned, or that an entry came from a spy at all.\nWhere the brief says the service no longer has an agent somewhere, every foreign entry for that polity is now UNCONFIRMED. Do not advance it, and do not invent a reason it went quiet: mark it stalled with a lastUpdate saying plainly that nothing has been heard since that date. Losing the source IS the blocker, and an honest entry says so.\n[Doubted intelligence]\nAn entry marked doubted was sourced from an agent the service no longer trusts, and may be a fabrication it was fed. Where the board below says a FRESH agent is now inside that polity, settle it from what that new source shows: set verification \"confirmed\" and let the entry run on if the programme is real, or \"refuted\" and fail it if the new material shows there was never anything there. Settle it only when the new source actually bears on it — leave it doubted otherwise, because guessing is what put the phantom on the board to begin with. Never write that any of this came from a spy, or that an agent was turned.\n"
          : "\n\n[Espionage]\nThe following is known to you as the simulator and NOT to the player, who sees only what their service can decode. Let it shape events: a polity with a live agent in the player acts on what it stole; a polity fed a planted story believes it; a public expulsion sours relations; a rival that suspects its agent grows cautious. Never reveal in event text that an agent has been turned unless it is discovered.\n";
        systemPrompt = systemPrompt + framing + brief;
      }
    } catch {
      /* no espionage context this turn */
    }
  }

  // The consolidator's summary REPLACES what it covers, so anything it leaves out
  // is gone from the campaign for good. Existing games carry frozen prompts, so
  // both the instruction and the order list have to arrive at call time.
  if (taskKey === "eventConsolidator") {
    systemPrompt = `${systemPrompt}\n\n[Durable Canon]\nThis summary REPLACES the material it covers: once consolidated, those events, conversations and player orders are never sent to the simulation again, so whatever you omit is lost permanently. Carry forward explicitly, as standing facts rather than narration:\n1. How this world has DIVERGED from real history — states that never formed, wars that never happened, rulers who never fell, borders that never moved. Name them. A later model that sees only a gap fills it from real history and invents powers this campaign does not contain.\n2. The lasting CONSEQUENCES of the player's own orders, not the orders themselves.\n3. Commitments still in force: treaties, alliances, occupations, debts, standing grievances.\nBrevity matters, but never at the cost of a divergence or a commitment that is still true.`;
    const resolvedOrders = normalizeString(variables?.actionsToConsolidate);
    if (resolvedOrders && !resolvedOrders.startsWith("No ")) {
      systemPrompt = `${systemPrompt}\n\n[Player Orders Being Consolidated]\nThese are the player's own resolved orders for the period covered by this summary. Record what they CHANGED about the world; the order text itself is being discarded.\n${resolvedOrders}`;
    }
  }

  // Reputation context: how the world currently regards the player, and how the
  // model should let it bias behaviour and evolve it via polityChanges.
  // Territory is owned by REGIONS, but the model kept naming CITIES in regionTransfers
  // (e.g. "Toulouse"), which match no region and are silently dropped — the map never
  // moves though the event narrates a capture. Force region names, and teach the
  // take-the-whole-region (default) vs capture-only-the-city (markerOps) distinction.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Region and City Capture]\nTerritory is stored by MAP REGIONS. Prefer an exact region id/name from [Game Map Description]. If an event is grounded in a city, fortress, port, translated name, exonym, or historical area and you genuinely do not know the map region name, DO NOT invent one: put that exact grounded place/area wording in regionId (and regionName if useful) and ALWAYS set fromCode to the current controller/losing polity. The native geography resolver can conservatively map that wording only against that side's real regions; if it cannot do so safely, the operation is rejected instead of moving the wrong province.\nA regionControlOps control changes the WHOLE resolved map region's de-facto controller but leaves legal sovereignty intact. A regionTransfers entry changes the WHOLE resolved map region's LEGAL sovereign and normally hands administration over too unless a third-party occupier still physically controls it. If only a city changes hands while the surrounding region does not (a holdout, occupied port, enclave), do not change the region; use the point/marker representation instead.\nFor a total wartime occupation/collapse, regionControlOps control may use wholeCountry=true. For a total legal annexation/unification/partition settlement, regionTransfers may use wholeCountry=true. Never use either wholeCountry shortcut for a partial campaign.`;
  }

  // Polities are identified by their full country name EVERYWHERE. A model that
  // answers "ESP" gets canonicalised on ingest, but it also then reasons about "ESP"
  // and "Spain" as if they were two powers, so state the rule rather than only
  // repairing the output.
  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Polity Names]\nEvery polity is identified ONLY by its full country name, exactly as written in the map description — "Spain", "United States", "Soviet Union". NEVER use a country code or abbreviation such as "ESP", "USA" or "SOV", anywhere, in any field. This applies to every owner field despite their names: toCode, fromCode, ownerCode and a polity's code all take the FULL NAME. A code is not a shorter way of writing a country here; it is a different, non-existent polity, and using one creates a phantom country on the map beside the real one.`;
  }

  // Units kept landing at 0,0 (null island) because the model copied the lng:0,lat:0
  // placeholder from the output template; guide it to real coordinates.
  if (["jumpForward", "autoJumpForward", "idleDiplomacy"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Unit Coordinates]\nWhenever an event says a force is raised, mobilised, garrisoned, landed, reinforced, redeployed or moved, that event MUST carry the matching impacts.unitOps — a spawn for a force that now exists, a move for one that relocated. An event that describes troops without unitOps produces a story about an army the map never shows.\nWrite every coordinate as a plain decimal number, using a POINT for the decimal mark and no other characters: lng 37.06, not "37,06", not "37.06°E". Every unitOps spawn and move MUST use the real-world longitude and latitude of where the unit actually is or is going. The lng 0 / lat 0 shown in the output template is ONLY a placeholder \u2014 0,0 is open ocean off West Africa, never a valid position, and a unit placed there is discarded. Set lng and lat to the actual coordinates: use the values from [City Coordinates] for a unit at or near one of those cities, or the real coordinates of the region or front where the action happens.`;
  }

  // Standing orders (world.pendingUnitOrders) survive a jump's single clearActions
  // flag on purpose - it wipes the actions queue wholesale. The ENGINE advances
  // them every turn (advanceStandingOrders), so this block exists to tell the model
  // what is already in motion, NOT to ask it for the legs: a move op for a unit the
  // engine is already advancing would move that unit twice for the same elapsed time.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const pending = normalizeString(variables.pendingUnitOrders);
    if (pending && !pending.startsWith("No units")) {
      systemPrompt = `${systemPrompt}\n\n[Standing Unit Orders]\nEach unit below is already under a standing order and the engine advances it automatically every turn - a move continues toward its destination at that unit's own pace, and a patrol keeps working its station. You do NOT need to emit a move op for any of them, and you should not: doing so would advance the unit twice. Take these as context for what is happening on the map, and write events about them when the story warrants it. Emit a unit op for one of these units only when this jump genuinely REDIRECTS it (a new destination, a change of posture) or ends it (destroyed, recalled, withdrawn) - and say why in an event. An order clears itself once the unit arrives; you never need to remove one yourself.\n${pending}`;
    }
  }

  // The unit contract itself. defaultPrompts.json carries the same rules for NEW
  // games; this is what reaches the campaigns that already exist, whose prompts are
  // frozen — the same reason [Player Agency] and [Map Truth] are injected here.
  //
  // Skipped when the rendered template ALREADY says it: the bundled template's
  // units section is a near-verbatim copy of this block, so a new game would pay
  // for both, and a rule repeated in two slightly different wordings invites the
  // model to look for a distinction that is not there. Beta only — it describes a
  // map the player cannot move units on, which is not the classic system's map.
  if (["jumpForward", "autoJumpForward"].includes(taskKey) && isBetaUnits() && !templateAlreadySays(systemPrompt, UNIT_CONTRACT_MARKER)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[Units on the Map]\nUnits are EVIDENCE OF YOUR OWN EVENTS. The player cannot move or fight their own formations - the map is there to show them what is happening - so every unit you spawn or move must be something one of this jump's events actually describes. Reach for them readily: a mobilization, a build-up on a border, a fleet sailing, an offensive, a withdrawal all deserve to be visible. But keep the map legible - only formations that matter to the story. A great power at war might show five or six; a country at peace shows one or two, or none.\nstrength is a PERCENTAGE of established strength (100 = fresh and full, 60 = worn down, 20 = a shell), and composition says what the formation actually is ("1 aircraft carrier, 2 frigates", "3 tank regiments"). Write both, plus a one-sentence note on what it is doing and where. A counter that does not say what it is tells the player nothing.\nDo not teleport. A move may only cover what that unit could really travel between the previous event's date and this one's. The engine enforces this: an over-long move becomes a partial advance that continues automatically on later turns, so ordering the full distance is safe and correct.\nThe map is what ${playerName} KNOWS, not omniscience. A force may legitimately appear far from its own territory when it is being DETECTED rather than arriving - a submarine that has shadowed a fleet for weeks, infiltrators already in country, a deployment only now confirmed. Such a unit is drawn as unconfirmed, which is correct and not a penalty. The one thing you cannot conjure is a fixed installation: use markerOps build for a base, and never spawn a far-flung garrison.\nSet posture whenever you place or move a unit - holding, massing, patrol, transit, exercise, blockade, withdrawing, assaulting. It is how the player reads intent off the map. "patrol" is special: the engine keeps a patrolling unit working its station on its own, turn after turn, so state it once and leave it.\n"assaulting" is the other special one: a formation that ARRIVES under it is marked engaged, in contact at the objective, instead of idle. Use it when an event has a force actually storming a province rather than massing near it — including when the player has ordered an assault in words ("Attack Provence"), which is how they commit troops to a province, since they cannot move their own formations. You still own the OUTCOME: resolve the fighting on a later turn with casualties, and a regionTransfer only if the province genuinely falls. An order you judge infeasible is refused in an event that says why, never silently dropped.`;
  }

  // The map reading as if only the player fields an army: unitOps is fully general
  // (any owner, not just the player), but a low events-per-jump budget plus
  // player-centric framing meant other powers rarely got a reason to use it -
  // their militaries existed only when something dramatic happened TO the player.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Other Powers' Militaries]\nThe map should not read as though only ${normalizeString(variables.playerPolity) || "the player's polity"} fields any forces. When a major or currently-relevant power (a scenario-defined actor, a country the player has clashed or negotiated with, a power actively at war or mobilizing) plausibly has forces in the field this period - mobilizing, patrolling a border, escorting a fleet, garrisoning a front, reinforcing an ally - reflect it with impacts.unitOps even when nothing dramatic is happening to the player specifically. A brief, minor event (or a line folded into a larger one) is enough to justify it; it does not need its own headline. Keep this proportionate: a country at peace far from any conflict does not need forces conjured for their own sake, and this must never be used to manufacture aggression toward the player that their own actions or the wider story do not warrant.`;
  }

  // What a player's order actually costs them in time, and the single rule that
  // decides it: does this act need anyone else's consent?
  //
  // Field report behind this: a player asked to rename their country. The
  // advisor opened a Projects board entry for it — the only lever it has — and
  // the rename sat at 15% for twelve in-game months while the advisor reported
  // that the seals had been updated. Nothing had. A rename is one signature.
  //
  // The other half matters just as much in the opposite direction: a transfer of
  // somebody else's land is NOT a signature, and must not resolve just because the
  // player asked. regionClaims is what makes that answerable rather than a refusal.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}

[Sovereign Acts and What Needs Consent]
Before you decide how long one of ${playerName}'s orders takes, ask one question: does this act need anyone else's agreement?

NO - IT IS INTERNAL. Their own name, colour, flag, style, title, anthem, official language, capital designation, ministry structure, proclamations, and the administration of territory they already hold. Their own government decides and nobody may refuse. THESE RESOLVE IN THIS JUMP. Enact each with a single event dated inside the covered period, carrying the impact that makes it real - polityChanges for a change of name, colour, style or tags; markerOps rename for a renamed city or capital - and list that action's id in actionIds. They cannot fail for lack of consent, they need no programme, budget or timetable, and they never take multiple rounds. Narrate the reaction if it is interesting - a rival's contempt, a domestic celebration, the old name lingering in foreign newspapers - but the act itself is DONE. Never open a Projects entry for one, and never report one as in progress.

YES - IT TOUCHES ANOTHER POLITY. Region transfers, cessions, annexations, border adjustments: anything that moves land or binds another government. These need one of two things first, and it must actually be in the campaign record: CONSENT (that polity agreed, in a diplomatic exchange, a treaty, or an event where they conceded) or a FAIT ACCOMPLI (the ground has already been taken and held, so they have no say left - the map and the units are the evidence). Where either is already true, enact it THIS JUMP with regionTransfers; a hand-over both sides accept needs no programme either.

Where NEITHER is true yet, the order is not refused and not quietly deferred - it splits in two, and BOTH halves happen now. First, record the claim with regionClaims, so the region shows as disputed on the map immediately and the player can see that their declaration landed. Second, say plainly what is missing - whose agreement, or what has to be taken - and open the project for the campaign that will obtain it, with the transfer itself on that project's onComplete so the border moves the moment the effort actually succeeds. A declaration that changes nothing the player can see is the failure this rule exists to prevent.`;
  }

  // The Projects & Operations board. It exists precisely so long-running work
  // does not vanish between rounds, which only holds if the jump that narrates a
  // programme also MOVES it — otherwise the board freezes at whatever the advisor
  // last said and the player stops trusting it. Only the game master moves the
  // board inline: the jump hands it to the separate `projects` task
  // (generateProjectOps), whose whole prompt is the board and whose schema is the
  // only place projectOps now appears for a jump.
  if (taskKey === "gameMaster") {
    const projects = normalizeString(variables.projectsSummary);
    const board = projects && !projects.startsWith("No projects")
      ? `\n\nThe board as it stands:\n${projects}`
      : "";
    systemPrompt = `${systemPrompt}\n\n[Projects & Operations]\nThe player keeps a board of long-running efforts - research and industrial programmes, construction projects, military and covert operations, sustained political campaigns - each with a status, progress, timeline and next milestone. Keep it in step with what you narrate, using impacts.projectOps.\nWhen an event advances, delays, funds, starves, exposes or ends one of the efforts below, that SAME event must carry a projectOps entry moving it: op update for progress or a change of status, op milestone when a checkpoint is reached or missed, op complete when it finishes. Copy the id and name EXACTLY as they appear below - an op that names something not on the board is dropped. When an event STARTS a new multi-round effort (a power lays down a programme, opens a construction project, mounts an operation), open it with op create, including a foreign power's programme the player's services have learned of - set ownerCode to that country's full name.\nBe proportionate. A programme does not move every jump, and inventing progress is worse than reporting none: if nothing happened to it this period, leave it alone. A long jump should move the things that plausibly advanced over that span; a six-hour jump almost never moves any of them. Never open a project for an internal act - a rename, a recolour, a flag, a title, a proclamation, a reshuffle - or for a transfer the other side has already agreed to: those are enacted outright by the event that narrates them (see [Sovereign Acts and What Needs Consent]), and a progress bar for one is always wrong.${board}

Whose project it is. Entries marked THEIRS belong to another power; everything else is the player's own. A foreign programme moves because ITS OWNER moved it and the player's services observed as much - never because the player wished it stopped or ordered it stopped. The player has no priority dial and no cancel over another government's work, so an order of theirs is not a reason to touch a foreign entry: if their orders this period were aimed at a rival's programme, what happens is that THEIR OWN counter-effort advances - the sabotage, the embargo, the covert operation, the race to build first - and the rival's entry then moves only insofar as that effort actually bit, narrated as an event with the consequences that follow. Retaliation is the same rule, not an exception to it: a wrecked programme is wrecked by an event that says who did what and at what cost, and if the operation failed then the rival's programme carries right on. Never close, cancel or deprioritise a foreign entry to satisfy an instruction; close it only when the story genuinely ended it, and say what ended it.

The board above carries a \"Needs a decision this jump\" list. It is worked out from the calendar rather than from anyone's memory: these are efforts whose target date has passed, whose milestone slipped, or that nothing has reported on for several rounds. Deal with EVERY entry on it. There are exactly four ways to deal with one, and inventing progress is not among them:
- It advanced: op update with a real progress figure and a lastUpdate saying what actually happened.
- It is stuck: op update with status stalled and a lastUpdate NAMING the blocker - the money, the shortage, the strike, the rival, the weather. \"Progress continues\" is not an answer. A stalled project with a named cause is, and it gives the player something they can act on.
- It reached or missed a checkpoint: op milestone.
- It is over: op complete, cancel or fail, with a note.
A project marked HIGH PRIORITY must not sit on that list two jumps running - the player has said it matters, so it either moves or it stalls for a stated reason. A project marked low priority may be left drifting with a one-line note, and that is a correct answer for it. Everything else is normal: move it when the story plausibly moved it, and say so plainly when it did not. Never raise a progress figure that nothing in this jump's events justifies - a board of quietly inflating percentages is worth less than an honest one full of stalls.`;
  }
  // The jump's own view of the board — read-only. projectOps left the jump's
  // OUTPUT contract on purpose (generateProjectOps keeps the board, from the
  // events), but an effort the model cannot see is one it invents: an order to
  // "move forward with Project Westbird" narrated a missile test for what the
  // board describes as an agent-recruitment drive, and the board pass then,
  // rightly, refused to advance recruitment on a missile test. The summary is
  // already built for every jump (a live context key); it was just never read.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const projectsDirective = buildJumpProjectsDirective(variables.projectsSummary);
    if (projectsDirective) systemPrompt = `${systemPrompt}\n\n${projectsDirective}`;
  }
  // The between-rounds pulse may now move the world's forces a little, so it needs
  // the same discipline the jump gets — injected here so it reaches existing games
  // whose stored idleDiplomacy prompt predates any of this.
  if (taskKey === "idleDiplomacy") {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[World Pulse]\nOnly minutes of real time have passed and the game date has NOT advanced, so any movement is a step, never a redeployment. Return at most two unitOps, and an empty list is the normal answer. Move only what already has a reason to move: a war under way, a crisis already named in recent events, a border already tense, a fleet already at sea. Never invent a new conflict here.\nPrefer moving or re-posturing an EXISTING unit over spawning one. Prefer movement ${playerName} can actually see - near their borders, waters, allies and rivals; a division shuffling across the far side of the world is invisible and not worth an operation. Never move a garrison, and never touch a unit owned by ${playerName}.\nWrite composition and a one-sentence note on anything you spawn, and set posture on anything you touch. Return a sighting ONLY when the movement is inside or near ${playerName}'s sphere and their services would plausibly have seen it; otherwise sighting is null and the movement is silent.\n${normalizeString(variables.idleChatAllowed) === "no" ? "This pulse is MOVEMENT ONLY: return chat as null." : ""}

[What the Sender Knows]
You are shown every chat in the campaign so you can judge WHO would plausibly speak and about what. The polity you then write as does NOT share that view. It knows only: the chats it was itself a participant in, whatever is public knowledge in the events above, and what ${playerName} has told it directly. It has NOT read ${playerName}'s correspondence with anyone else.
So use the wider picture to choose the sender and the moment — never to give them knowledge they could not have. A polity must not reference, allude to, or react to something said in a conversation it was not part of, and must not echo another leader's turn of phrase. If a private exchange elsewhere is the only reason a message would make sense, that is a message this polity cannot send: pick a different sender, or return chat as null.`;
  }

  // The native world director's live analysis for this segment: focused and
  // deferred storylines, the exploration slate, the era's conflict posture and
  // the storyline record contract. Built per segment (runJumpSegments) and
  // appended here so a campaign's frozen prompt pack gets it too.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const worldInitiativeContext = normalizeString(variables?.worldInitiativeContext);
    systemPrompt = `${systemPrompt}\n\n[Native World Director — authoritative live causal context]\n${worldInitiativeContext || "No native World Director context was available; reason from current campaign state without importing a memorized future calendar."}\n\nThe Native World Director context above is the SINGLE live owner of world-attention, historical-candidate/causal-inertia, causal-timing, branch-recompute, exploration, and persistent-storyline doctrine. It supersedes overlapping or older frozen prompt wording on those topics. Follow the separate Player Agency and Canonical War State rules for human authorization and actual belligerency.`;
  }

  // Durable diplomatic memory becomes causal pressure on the turn: agreed
  // follow-throughs, declared intents and threats must be weighed, not just
  // remembered. Appended only when at least one thread carries such memory.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    const diplomaticContinuity = normalizeString(variables?.diplomaticContinuity);
    if (diplomaticContinuity) {
      systemPrompt = `${systemPrompt}\n\n[Diplomatic Consequence Bridge]\nDiplomatic chats are part of the causal world state, not decorative roleplay. Before choosing this period's events, review EVERY durable diplomatic memory below and ask: "Does anything said or agreed here require a new development during the interval from ${normalizeString(variables.dateReadable) || normalizeString(variables.date) || "the origin date"} through ${normalizeString(variables.targetDateReadable) || normalizeString(variables.targetDate) || "the target date"}?"\n\n${diplomaticContinuity}\n\nEvidence rule: the "Standing diplomatic memory" is a compressed continuity aid. The "Recent verbatim diplomatic evidence" is authoritative for the exact words, actor attribution, deadlines, and modal force of recent exchanges. If a summary weakens, strengthens, or otherwise conflicts with the verbatim evidence, FOLLOW THE VERBATIM EVIDENCE. A later acknowledgement, pleasantry, or statement of mutual understanding does NOT cancel an earlier threat, promise, agreement, or declared intent unless it explicitly retracts, supersedes, or modifies it.\n\nApply these rules:\n1. MUTUAL AGREEMENT + DUE DATE: if the player and another polity explicitly agreed that a meeting, consultation, withdrawal, exchange, conference, hand-over, coordinated operation, or other concrete follow-through WILL occur on a date inside this simulated interval, that follow-through is a PRESUMPTIVE TIMELINE EVENT. Generate it unless the supplied canon shows it was already fulfilled, explicitly cancelled/superseded, prevented by a new event, or genuinely too trivial to be newsworthy. If such a commitment is already OVERDUE at the origin date and no fulfillment/cancellation appears in canon, do not forget it either: generate the belated follow-through, cancellation, breach, postponement, or other concrete explanation that best fits the world.\n2. AGREEMENT WITHOUT A FIXED DATE: preserve it as an active commitment and let it shape events; generate implementation when the period/context naturally reaches it.\n3. UNILATERAL DECLARATION: if a polity explicitly said it WILL take an action, treat that declaration as strong evidence of intent, but still simulate whether circumstances permit execution. For the human-controlled ${normalizeString(variables.playerPolity) || "player polity"}, only treat an explicit player chat statement as authorization when it plainly commits to the action; vague discussion is not an order.\n4. THREAT / WARNING / SUSPICIOUS INFORMATION: these do NOT automatically force one scripted reaction. They create DECISION PRESSURE on the affected A.I. polity. You must evaluate that pressure as part of this jump instead of merely remembering the words.\n   - IMMINENT, EXPLICIT THREAT OR ULTIMATUM: a direct credible statement such as "we will invade you in 24 hours", "withdraw by tomorrow or we attack", or an equally immediate military threat is CRITICAL pressure. Unless there is a concrete reason the target believes the threat is impossible, unserious, already withdrawn, or otherwise neutralized, the threatened A.I. polity should normally take at least one timely protective or diplomatic action BEFORE the threatened deadline: mobilize/redeploy forces, raise military readiness, alert allies, issue a protest/ultimatum, seek guarantees, evacuate exposed assets, or another contextually rational response. Do NOT require it to choose a specific response; choose what that government would realistically do.\n   - AMBIGUOUS MILITARY / LOGISTICAL SIGNAL: information such as new depots, rail improvements, exercises, reconnaissance, or logistical hubs near a frontier is NOT proof of hostile intent. Evaluate trust, alliances, recent crises, geography, military balance, prior assurances, and the actor's reputation. A cautious government may increase readiness or investigate; a trusting government may deliberately do nothing extraordinary. Either is valid. Do not manufacture an event merely to prove that the signal was noticed.\n   - POLITICAL / ECONOMIC / DIPLOMATIC SIGNAL: sanctions threats, alliance feelers, guarantees, recognition disputes, trade pressure, or severe diplomatic warnings should likewise alter the affected A.I. polity's choices when consequential, but rhetoric alone need not create a timeline event.\n   - SILENCE IS A DECISION ONLY WHEN PLAUSIBLE: for serious but ambiguous signals, "no extraordinary action" may be the correct outcome and need not be narrated. For an imminent credible invasion threat, silent inaction should be exceptional and supported by the world context, not the default.\n5. REACTIVE CONSEQUENCES ARE OWN ACTIONS: when an A.I. polity reacts, simulate ITS response as a new world event or diplomatic outreach where appropriate. Do not convert the original speaker's words into the target's action. An A.I. protest/contact with the player may use diplomaticOutreach/createdChats; internal cabinet decisions, mobilization, alliance coordination, deployments, investigations, and similar responses belong in timeline events.\n6. PROPOSAL OR REQUEST: a proposal that was never accepted is NOT an agreement. Do not turn it into accomplished fact. The recipient may still react to the proposal itself if accepting, rejecting, countering, preparing, or seeking clarification would be strategically meaningful.\n7. FOLLOW-THROUGH MUST BE NEW: if the commitment's implementation or the reaction already appears in Event History, do not restate it. If a new event makes the commitment impossible, narrate the cancellation/failure/breach instead when that is important.\n8. STRUCTURE REAL CONSEQUENCES: when follow-through or reaction changes persistent state, emit the proper impacts in the SAME event. A meeting or cabinet decision with no mechanical effect may simply be an event. Actual mobilization/redeployment/reinforcement uses unitOps and should reuse existing units where appropriate; spawn only genuinely new mobilized formations. A legal territorial settlement uses regionTransfers; lasting alignment/reputation changes use polityChanges. Do not narrate a concrete military movement that the structured impacts fail to represent.\n9. REACTION TIMING: consequences should occur when a competent government would actually act. An ultimatum expiring in 24 hours may warrant same-day or next-day response; an ambiguous infrastructure signal may take days or weeks to trigger policy. Do not postpone a clearly time-sensitive reaction until after the danger has passed merely because other storylines are active.\n10. REACTION-TARGET INTEGRITY: for every consequential diplomatic memory, identify (a) the polity that originated the signal/request/threat, (b) the polity or polities affected by it, and (c) any explicit response or declared intent already stated by the affected polity. A new event by the ORIGINAL SIGNALING polity does NOT satisfy the affected polity's reaction audit. Example: Germany announces frontier logistics work to Russia; a later German readiness event is not a Russian reaction. Evaluate Russia separately.\n11. RECIPIENT-DECLARED INTENT: inspect the recent verbatim evidence as well as the summary. If the affected A.I. polity itself has already replied with language such as "we must take measures", "we will mobilize", "we intend to reinforce", "we shall consult our allies", or another clear statement of intended action, treat that as a UNILATERAL DECLARATION by that polity, not merely as generic concern. Unless later dialogue/canon EXPLICITLY retracts or supersedes it, the next suitable simulation interval should normally show concrete follow-through or a concrete reason it was delayed/abandoned. Mere acknowledgement or calmer diplomatic language is not a retraction. Preserve proportionality: "take necessary defensive measures" need not mean full mobilization, but it should not silently collapse into no action by default.\n12. INTERNAL DECISION AUDIT: before finalizing the event set, silently review each durable diplomatic memory that contains a threat, warning, declaration, request, or strategically significant disclosure. For EACH affected A.I. polity decide one of: REACT NOW / REACT LATER / NO EXTRAORDINARY REACTION. Check that any output event actually belongs to the affected polity whose reaction you are evaluating. Only output resulting world events/chats that are newsworthy; never output this audit or filler events saying a government "decided to do nothing."\n\nThis bridge does NOT mean every diplomatic sentence deserves an event. It means explicit commitments and consequential signals must participate in normal event selection instead of being disconnected from the simulation.`;
    }
  }

  // Event Editor NPC reaction: a one-shot evaluation of one authored event. The
  // administrator explicitly allowed it; silence stays a valid answer.
  if (taskKey === "idleDiplomacy") {
    const eventReaction = normalizeString(variables?.eventDiplomaticReactionContext);
    if (eventReaction) {
      systemPrompt = `${systemPrompt}\n\n[Event-triggered reaction — one-shot]\nA human administrator explicitly allowed NPCs to react to the canonical event below. Evaluate THIS event in the current diplomatic world. Silence remains valid and must be chosen when nobody would plausibly contact the player. But do not confuse "minor" with "unworthy of human contact": a friendly ally may simply congratulate the player, express sympathy, show interest, or make a brief good-natured remark even when no treaty, warning, or mechanical consequence is needed. Keep any opener natural and proportionate. Return at most one initiating chat for this one-shot evaluation, and no unit movement.\n\n${eventReaction}`;
    }
  }

  // The curator's calibration travels with the call so frozen prompt packs get it.
  if (taskKey === "timelineCurator") {
    systemPrompt = `${systemPrompt}

  [Strict Curator Calibration]

  Be conservative about DELETING history, but do NOT be conservative about CLASSIFYING low-value material accurately. JavaScript applies independent safety gates after your judgment.

  RECURRENCE:
  Set recurrenceMatters=true ONLY when repetition itself creates meaningful historical pressure or consequence.

  Examples that normally justify recurrenceMatters=true:
  - renewed clashes or combat
  - casualties
  - strikes, protests, riots or unrest
  - arrests or repression
  - sanctions, embargoes or blockades
  - shortages or economic disruption
  - mutiny, sabotage, breakdown, failure or withdrawal
  - repeated incidents whose accumulation materially changes the situation

  Routine continuation does NOT make recurrence meaningful.

  Normally set recurrenceMatters=false for repeated:
  - meetings or conferences
  - negotiations without a new settlement
  - planning cycles
  - operational timetables
  - mobilization schedules
  - technical protocols
  - reviews or inspections
  - budget negotiations
  - funding tranches
  - administrative implementation
  - reports, studies or committees
  - ordinary military preparations without a new operational consequence

  Do not use recurrenceMatters merely as a reason to protect an otherwise incremental event.

  WORTHWHILE:
  substantive=true does NOT imply worthwhile=true.

  Set worthwhile=false when an event establishes a real but minor fact that does not deserve its own permanent timeline entry because an already-established storyline merely advanced another routine step.

  Examples:
  - another timetable in an already established military plan
  - another implementation protocol after the policy already exists
  - another round of budget bargaining with no decisive legislative outcome
  - another committee, review, inspection or consultation
  - another technical refinement to an already functioning program

  QUALITATIVE ADVANCE:
  A new detail is not automatically a materially new dimension.

  Things such as another timetable, quota, funding allocation, review result, logistics arrangement, protocol refinement, procedural step, or administrative package normally remain incrementalProcess=true and qualitativeAdvance=false unless they cross a real threshold.

  PROCESS FILLER:
  If processFramePresent=true and there is no completed observable result directly quotable from the candidate, set:
  - observableOutcomeEvidence=""
  - pureProcessFiller=true

  Do not rescue a process-only event merely because the meeting concerns an important subject.

  SATURATED STORYLINES:
  When a storyline already has several recent canonical entries, judge whether the candidate actually changes the situation rather than rewarding it for being specific.

  A small new detail inside an already-established process may still have:
  - substantive=true
  - materiallyNewDimensions containing a minor detail

  while correctly having:
  - worthwhile=false
  - qualitativeAdvance=false
  - incrementalProcess=true

  STORYLINE STAGE REGRESSION:
  A candidate is not a qualitative advance merely because it gives a fresh date or a more detailed description to a diplomatic, political, military, or administrative state that earlier canonical events already resolved.

  Read the supplied prior history chronologically.

  If prior canonical history shows a storyline progressing through stages such as:
  proposal → response → negotiation → decision → implementation

  then a later candidate must not treat an earlier stage as newly occurring again unless the candidate explicitly establishes a new trigger, reopening, reversal, or materially changed position.

  Examples:

  If a government already formally rejected a proposal, a later event saying that government rejects the same proposal again is normally REDUNDANT unless something reopened the question.

  If negotiations already opened and later adjourned, a candidate describing the counterpart's initial response to the original proposal is normally a regression to an already-resolved stage.

  If an alliance already finalized mobilization protocols, another event merely finalizing substantially the same protocols or schedules is normally incremental or redundant.

  Judge the candidate against the LATEST established state of that storyline, not merely against whether its wording differs from one prior event.

  A repeated important fact is still repeated. Importance does not make an already-established state new.

  CONFIDENCE:
  Confidence measures confidence in your CLASSIFICATION, not confidence that the event happened. Do not artificially reduce confidence merely because an event is plausible or historically realistic.

  Default verdict remains KEEP when uncertain.

  [MULTI-PASS CAUSAL CHAIN]
  Candidates may have been generated in successive hidden world windows inside one user jump. If a later candidate materially depends on an earlier candidate in the SAME supplied batch/storyline, do not drop the earlier event merely as incremental/redundant when doing so would make the later development causally unintelligible. This does not protect filler; it protects real prerequisite milestones.

  [CANONICAL WAR-STATE PREREQUISITES]
  An event that starts/joins/resumes a canonical war may be the mechanical prerequisite for later same-batch combat carrying the same warId. Do not drop that transition as redundant when doing so would orphan later battles/offensives from their legal belligerency state. Peace/ceasefire/end transitions are likewise substantive because they change what later combat is allowed to occur.`;
  }

  // The unit director's runtime rules travel with the call so a campaign's
  // frozen prompt pack (which predates the task) still gets the current contract.
  if (taskKey === "unitDirector") {
    const directorUnits = normalizeString(variables.unitDirectorUnits) || "[]";
    const directorCandidates = normalizeString(variables.unitDirectorCandidates) || "[]";
    systemPrompt = `${systemPrompt}\n\n[Native Unit Director — runtime rules]\nYou are NOT writing new history. The supplied events are already canonical candidates. Your only job is to make existing persistent military units behave consistently with those events.\n\nCURRENT GAME DATE: ${normalizeString(variables.unitDirectorGameDate)}\nCURRENT ROUND: ${normalizeString(variables.unitDirectorRound)}\n\nCURRENT PERSISTENT UNITS:\n${directorUnits}\n\nMILITARY EVENT CANDIDATES:\n${directorCandidates}\n\nPriority order:\n1. REUSE existing unit ids. Existing armies should move, fight, weaken, retreat and persist across turns.\n2. MOVE a current unit when the event says that formation advances, withdraws, redeploys, mobilizes toward a front, or otherwise changes position, and set its posture to what it is doing there (assaulting, massing, holding, withdrawing, transit, patrol, blockade, exercise). Fighting is a move into contact with posture assaulting. A conscription law, mobilization order, readiness measure, exercise, procurement, training, administrative integration or other military-policy event is NOT movement or combat.\n3. SPAWN only when the event genuinely creates a new formation, mobilization or reinforcement that is not already represented. Never spawn a new counter merely because an existing army is fighting again.\n4. strength only when the event itself narrates casualties, attrition, disease, desertion, refit, reinforcement or demobilization for that formation. remove only for explicit destruction or disbandment.\n5. Do not invent military activity for diplomatic, political or economic events. It is valid to return no ops for an event.\n6. Never change territory. The territory layer is separate.\n7. Use only supplied existing unit ids. Keep movement local and plausible for the era.\n\nReturn exactly the required tool payload.`;
  }

  // GM territorial semantics: regionTransfers move LEGAL sovereignty, regionControlOps
  // move de-facto control, claims stripe a region without moving anything; and
  // every narrated place must have its own operation.
  if (taskKey === "gameMaster") {
    systemPrompt = `${systemPrompt}\n\n[GM Territorial Semantics — live override]\nA wartime capture/occupation/liberation/retaking changes DE-FACTO control and must use impacts.regionControlOps, not regionTransfers. Use regionTransfers only for a LEGAL sovereignty change such as treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement. Do not conflate the two just because the old frozen GM prompt says \"moves territory\".\n\n[GM Geographic Completeness — LIVE 8B.2.10]\nTerritorial narration and structured operations must agree PLACE BY PLACE, not merely in aggregate. If an authored event says control is established, expanded, consolidated, seized, occupied, liberated or retaken in several named cities/areas, emit a matching regionControlOps operation for EVERY named place whose map region actually changes control. Never narrate \"Płock, Częstochowa and Warsaw\" while emitting only two control operations. For a city-grounded change, put the actual city name in regionId/regionName or the exact rendered region id/name when known; native validation will map the city point to the rendered region and will reject an incomplete preview rather than silently dropping the city. One operation must describe one intended place: never reuse a nearby city's rendered region for a different named city, and never let event-wide prose substitute for the operation's own geographic target.\n\n[GM Physical-World Completeness — LIVE 10.1B]\nCURRENT MAP STRUCTURES is canonical persistent physical state, including stable marker ids and lifecycle status. For EVERY authored GM event, silently audit whether the prose establishes a significant named geographically concrete physical feature that persists beyond the event OR materially changes an existing supplied feature. If YES, the SAME event MUST contain the matching impacts.markerOps mutation. BUILD only a genuinely new feature. UPDATE the SAME existing markerId for major expansion/completion, capture or operator change, conversion, damage, abandonment, reconstruction, or destruction. RENAME preserves identity. REMOVE is only true canonical deletion/admin cleanup — historical destruction is status=destroyed and the marker remains in canon. Use status literally: planned before work, under_construction once construction has begun, active once operational, damaged after material damage, inactive when out of service, abandoned when left behind, destroyed when physically destroyed. A catastrophic explosion that leaves a damaged site therefore MUST update that existing marker to status=damaged; reconstruction later updates the SAME id toward under_construction/active. If a supplied feature merely participates without changing, reference its exact canonical name naturally but emit no markerOp. Never create marker filler merely because this audit exists.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
  }

  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor"].includes(taskKey)) {
    const reputationContext = normalizeString(variables.playerPolityReputationContext);
    if (reputationContext) {
      systemPrompt = `${systemPrompt}\n\n[International Reputation]\n${reputationContext}\nLow international reputation should reduce trade, trust, and coalition support, and should make nearby rivals more likely to sanction, isolate, or form balancing alliances. High reputation should improve access, trust, and coalition-building. When events this turn change how the world regards a polity, record the new value by including a "reputation" field (an integer 0-100) on that polity's impacts.polityChanges entry: aggression, broken treaties, and atrocities lower it; cooperation, aid, and honored commitments raise it. Only include reputation when it actually changes.`;
    }
  }

  // Espionage's counterpart to the reputation block above. Without it the rating
  // is invisible to the model and therefore frozen for the whole campaign.
  if (["actions", "jumpForward", "autoJumpForward", "catalystCreation", "catalystExecutor"].includes(taskKey)) {
    const intelligenceContext = normalizeString(variables.playerPolityIntelligenceContext);
    if (intelligenceContext) {
      systemPrompt = `${systemPrompt}\n\n[Intelligence Services]\n${intelligenceContext}\nThis rating is how much of other polities' private diplomacy a service can read and how well it protects its own, and it moves the same way international reputation does. When this turn's events actually change what a service is capable of, record the new ABSOLUTE value (an integer 0-100) in an "intelligence" field on that polity's impacts.polityChanges entry. Concrete investment the player has ordered and that this turn actually delivers raises it a few points at a time — a training academy opening its doors, a new bureau or directorate standing up, a funding increase taking effect, a recruitment or codebreaking programme bearing fruit; a purge, a mass defection, a network rolled up by a rival, or deep cuts lower it. An intention is not a capability: do not move it for an order that has only just been given, do not restate it when nothing changed, and do not jump it by tens of points for a single measure.`;
    }
  }

  if (taskKey === "countryStatSheet") {
    systemPrompt = `${systemPrompt}

[Native Country Stats — LIVE 7A.2 / 8B.2.18.1]
This is a PERSISTENT campaign stat sheet, not a disposable modern-country lookup. Native code has already selected the authoritative territorial ACCOUNTING MODE and partition below; the model MUST NOT choose a different mode from prose, modern borders, or historical expectation.

AUTHORITATIVE TERRITORIAL BASIS:
${normalizeString(variables?.statsTerritorialContext) || "No territorial basis was resolved; use the target dossier conservatively."}

PRE-SEPARATION / DONOR COMPONENT REFERENCES:
${normalizeString(variables?.statsTerritorialReferenceContext) || "None available. Estimate from the supplied territorial basis and campaign context."}

PREVIOUS PERSISTENT STATS / CONTINUITY ANCHOR:
${normalizeString(variables?.statsPreviousContext) || "No previous persistent stat sheet exists; establish a fresh baseline."}

FRESH ECONOMIC / DEMOGRAPHIC EVIDENCE NOT YET ACCOUNTED IN THAT BASELINE:
${normalizeString(variables?.statsEconomicEvidenceContext) || "None. Preserve continuity; the absence of fresh evidence is not permission to reroll the economy."}

TERRITORIAL ACCOUNTING CONTRACT — REQUIRED:
- LEGAL SOVEREIGNTY is the normal accounting mode. Temporary foreign battlefield occupation does NOT automatically become part of the occupier's national population/GDP, and occupied legally-sovereign territory remains in the legal sovereign's national scope.
- Native code may instead explicitly select DE-FACTO STATE ADMINISTRATION for an active territorial polity that lacks a usable legal-sovereign map basis but actually administers territory as a state/breakaway/provisional government. ONLY when that mode is explicitly printed in the authoritative basis do controlled regions become this polity's Stats scope.
- DE-FACTO STATE ADMINISTRATION is NOT a loophole for ordinary foreign occupiers. The model must never switch modes itself.
- If a de-facto state is administering territory still legally claimed by another polity, both ledgers may legitimately overlap at the world level: the legal sovereign's sheet describes its de-jure realm while the de-facto state's sheet describes the population/economy it actually administers. Do not "fix" that by deleting territory from either side unless canonical sovereignty/control changes.
- When native code supplies a donor/reference component from the displaced legal sovereign, use it as a continuity anchor. For an EXACT/FULL matching component, preserve roughly that population/productivity unless campaign evidence justifies change. For a PARTIAL parent component, NEVER copy the whole donor population; estimate only the explicitly listed controlled subregions.

CONTINUITY CONTRACT — REQUIRED:
- The previous persistent sheet is the numeric baseline, not a suggestion, EXCEPT where the authoritative territorial mode/coverage has changed and the old component layout no longer represents the current scope.
- Events already accounted in the baseline may still appear elsewhere in broad history/context. Do NOT apply them a second time. Only the FRESH evidence block above is newly account-able evidence for this reassessment.
- If the authoritative territorial basis is unchanged and there is little/no fresh evidence, surviving component populations/productivity and macro indicators should remain close to their previous values. Slow demographic/productivity drift over elapsed time is fine; unexplained discontinuities are not.
- A short-span component population or GDP/capita re-baseline of roughly 50% or more needs either a real supplied campaign cause OR an authoritative territorial coverage/mode change that makes the old component non-comparable. Native JavaScript applies a conservative final guard as a second line of defense.
- Legal annexation/cession can add/remove/change normal legal components. In explicitly selected DE-FACTO STATE ADMINISTRATION mode, de-facto control changes can add/remove/change administrative components because control is the native accounting basis for that special polity.
- Never use modern-country wealth/population stereotypes to overwrite the campaign baseline.

SCALE / HISTORY AUTHORITY — REQUIRED:
${normalizeString(variables?.statsCalibrationContext) || "Use the persistent campaign ledger and supplied canon as the numeric authority. Real-world history may fill genuinely unresolved initial conditions, but it must never overwrite established campaign state or import later historical outcomes that did not occur in this timeline."}

SCENARIO / DIVERGENCE CANON FOR BASELINE SCALE:
${normalizeString(variables?.statsScenarioCalibrationCanon) || "No extra scenario-start canon was supplied. The live territorial basis and persistent campaign state still outrank same-date real-world history."}

POPULATION / REGIONAL CALIBRATION CONTRACT — NATIVE CONTROLLED:
${variables?.statsPopulationCalibrationRequested ? `
- CAUSAL CALIBRATION IS REQUIRED for this call. Return populationCalibration as provenance metadata plus one estimate for every NATIVE MACRO BUCKET below.
- populationCalibration describes the authority boundary for THIS SCENARIO. It does NOT contain or impose a whole-polity population target. The national total will be derived by native JavaScript from the regional macro estimates, preventing one bad historical headline lookup from overriding the live territorial footprint.
- First identify historyAuthorityCutoff: the latest point where real-world demographic causality is genuinely shared. If the scenario diverged before the start date, real-world outcomes after that frontier are FORBIDDEN as calibration facts.
- Return basis as ONE concise evidence summary naming the shared baseline and post-cutoff scenario facts used. This is audit provenance, not hidden reasoning.
- mode=historical_start ONLY when scenario canon remains materially historical through the start date. Use mode=counterfactual_start when the scenario already diverged before play. Use mode=campaign_reconstruction for a later manual/repair reconstruction.
- For counterfactual_start/campaign_reconstruction, reason forward from the last shared historical/regional baseline using ONLY supplied scenario/campaign canon after the cutoff. Historical war losses, famine, partition, migration, or territorial losses that did not occur in this timeline must not leak into any regional estimate.
- The live macro buckets are the population scope. Estimate ONLY the territory represented by each bucket. A colony, dependency, subject, or related polity absent from the live bucket list is not part of this national population.
- This is a one-time bootstrap/reconstruction anchor. It does NOT create a historical attractor for future turns.` : `
- CAUSAL CALIBRATION PROVENANCE IS NOT REQUESTED for this call. Omit populationCalibration. The existing persistent component ledger is the numeric authority; assess only bounded changes to the macro buckets.`}

NOMINAL ECONOMIC BASELINE CALIBRATION — NATIVE CONTROLLED:
${variables?.statsEconomicCalibrationRequested ? `
- ECONOMIC CALIBRATION IS REQUIRED for this fresh baseline/hard audit. Return economicCalibration.
- The canonical GDP ledger is NOMINAL economic output expressed in a common constant-2026-EUR accounting unit. It is NOT PPP, purchasing-power parity, international dollars, real living-standard output, or a modernization/productivity adjustment.
- Start from a historically/causally legitimate NOMINAL GDP and NOMINAL GDP/capita anchor at or before the shared-history frontier. economicCalibration.anchorCurrency must be USD or EUR and the two nominal anchor values must be contemporaneous nominal values for anchorYear.
- economicCalibration.rebasedGdpPerCapita2026Eur is ONLY the monetary rebasing of that nominal GDP/capita into constant 2026 EUR. It may reflect ordinary inflation and USD/EUR conversion. It MUST NOT incorporate PPP or make a poorer historical country look like a 2026 rich-country economy.
- economicCalibration.nominalGdpBillions and nominalGdpPerCapita must describe the SAME territorial scope. Native code audits their implied population against the authoritative live baseline when mode=historical_start.
- If the current generated GDP/capita materially departs from the rebased nominal anchor, cite ONLY canonical IDs from this bounded list in economicCalibration.divergenceEventIds: ${normalizeArray(variables?.statsEconomicEvidenceIds).join(", ") || "(none)"}.
- An empty divergenceEventIds array means no supplied campaign event justifies a large departure from the nominal baseline. Do not invent a boom, convergence miracle, collapse, sanctions shock, reform dividend, or productivity leap.
- mode/historyAuthorityCutoff must obey the same scenario-causality frontier as populationCalibration when both are present. Real-world economic outcomes after divergence are forbidden unless scenario canon explicitly preserves them.
- GDP growth is REAL annual growth, separate from the nominal GDP level. For a historical-start baseline, preserve the inherited macro-cycle direction unless supplied post-cutoff campaign evidence causally changes it; do not smooth a recession into generic +1% growth merely because it seems plausible.
- economicCalibration is audit provenance only. Native JavaScript still derives national GDP from exact territorial population × gdpPerCapita rows.` : `
- ECONOMIC CALIBRATION PROVENANCE IS NOT REQUESTED for this call. Omit economicCalibration. The existing persistent nominal component ledger is the economic scale authority; do not re-anchor it to PPP or same-date real-world headlines.`}

BOUNDED REGIONAL METHOD — REQUIRED:
- Native code retains EVERY exact live-map province/component internally, but it has grouped them into a SMALL set of spatial demographic macro buckets for this AI call. This is a performance boundary only.
- Return territorialMacroComponentsText with EXACTLY ONE row for EVERY [M#] macro bucket, in this exact transport format: index~group~population~gdpPerCapita
- Example rows: 1~core~32000000~4200 OR 2~overseas/dependent~4200000~900
- index MUST be the supplied macro integer. Do not return province-by-province rows. Do not add, omit, split, or merge macro buckets.
- Compatibility only: if the authoritative basis explicitly says no mapped macro buckets exist, territorialMacroComponentsText may instead use group~geography~population~gdpPerCapita rows for the genuinely supported landless/custom scope.
- Allowed group values: core | integrated | overseas/dependent.
- Estimate each macro bucket from its representative places, spatial center, scenario canon, and any prior macro baseline. Prefer checkable regional magnitudes over a single historical whole-country headline total.
- Do NOT force the macro-bucket sum to a remembered country/empire headline. A historical headline is usable only as a cross-check when its territorial definition exactly matches the live macro scope; otherwise the regional estimates win.
- The SUM of macro-bucket populations becomes the national population. Native JavaScript expands each macro estimate deterministically back across ALL exact live-map components, preserving prior local proportions where a campaign ledger already exists.
- Do not give colonies, dependencies, peripheral territories, or poorer constituent regions metropolitan productivity by default.
- group is only an economic/display bucket. It is NOT a sovereignty, alliance, customs-union, recognition, or constitutional judgment.
- gdpPerCapita inside each macro bucket is NOMINAL output per person expressed in constant 2026-EUR accounting terms so components and eras can be aggregated. It is NOT PPP/international-dollar purchasing power and does NOT import 2026 technology, institutions, productivity, or living standards.
- population totals and GDP aggregates are DERIVED by native JavaScript after regional expansion.
- economy.gdpGrowth, inflation, unemployment, publicDebt and budgetBalance are percentages expressed as plain numbers; budgetBalance is negative for deficit and positive for surplus.
- economy.currency is the polity's actual current domestic currency/medium, even though GDP accounting uses 2026-EUR-equivalent values.
- GDP breakdown must sum to exactly 100.
- Never invent a war, reform, boom, depression, trade bloc, annexation, reconstruction program, tax change, loan, or fiscal shock absent from supplied campaign evidence.

This live instruction supersedes older frozen country-stat prompts and all earlier 7A.1/7A.2 territorial wording.`;
  }

  // The canonical war and diplomacy ledgers: current state plus the compact
  // line formats the payload carries them in (see the helpers above).
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n${buildWarLedgerDirective(variables)}\n\n${buildDiplomaticLedgerDirective(variables)}`;
  }
  if (["idleDiplomacy", "nextSpeaker"].includes(taskKey)) {
    const canonicalDiplomacy = normalizeString(variables?.canonicalDiplomaticContext);
    if (canonicalDiplomacy) {
      systemPrompt = `${systemPrompt}\n\n[Canonical Diplomatic State]\n${canonicalDiplomacy}\n\n${IDLE_RELATION_DECISION_MODEL}`;
    }
  }
  if (taskKey === "pregameHistory") {
    systemPrompt = `${systemPrompt}\n\n${buildPregameBootstrapDirective(variables)}`;
  }

  // The actions menu goes last so the system prompt for every jump ends with the full
  // list of levers the model can pull (reaches existing games too — see ACTIONS_REFERENCE).
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n${ACTIONS_REFERENCE}`;
    // The espionage lever rides after the menu for the same reason: it reaches
    // campaigns whose prompts were frozen before it existed.
    systemPrompt = `${systemPrompt}\n\n${buildSpyOrdersDirective(normalizeString(variables?.playerPolity) || "the player")}`;
  }

  // The scenario briefing arrives twice on eight of the sixteen prompts: once
  // from the task text's own placeholder and again inside the world summary.
  // On a real campaign that is ~108k characters sent twice, about a third of a
  // jump prompt. Collapsed here rather than in the templates because existing
  // saves carry frozen copies, and two tasks reach the briefing ONLY through the
  // world summary - removing it there would take it from them entirely.
  systemPrompt = collapseRepeatedBlock(
    systemPrompt,
    variables?.worldBeforeRoundOne,
    "(The pre-round-one briefing is reproduced in full earlier in this prompt.)",
  );

  // Batch routing (see the parameter): a deferred task leaves here with no
  // answer and no attempt loop; its result arrives through pollPendingBatches.
  if (!sync && typeof onBatchResult === "function" && batchBackgroundTasksEnabled()) {
    const batchTool = getGameplayTool(taskKey);
    if (batchTool && providerSupportsBatch()) {
      const customId = `oh_${taskKey}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
      const submitted = await submitAIBatch({
        customId,
        history: [{ role: "user", parts: [{ text: userMessage }] }],
        systemPrompt,
        taskKey,
        tool: batchTool,
      });
      if (submitted) {
        registerPendingBatch({ customId, fallback, onBatchResult, record: submitted.record ?? null, taskKey, validatePayload });
        return { deferred: true, generation: { source: "batch", fallbackReason: "", deferred: true }, payload: null };
      }
      // Submission refused (no key, provider hiccup): the synchronous path
      // below — batching is an optimization, never a dependency.
    }
  }

  const controller = new AbortController();
  // Let an external signal (the player pressing Cancel) abort the in-flight AI
  // call too — the abort propagates through callAI to the server relay.
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  const idleMs = taskIdleTimeoutMs();
  const timeoutError = new Error(
    `AI task "${taskKey}" timed out: the model stopped answering. `
      + "Turn off \"Limit AI generation\" in Settings to wait as long as the model needs.",
  );
  // Two windows (idleDeadline.js): a long one for an answer that has not started
  // — prompt evaluation and buffered endpoints both look like a stall from here —
  // and a short one between the pieces of an answer that has.
  const idle = createIdleDeadline(
    { idleMs, firstByteMs: idleMs ? AI_FIRST_BYTE_TIMEOUT_MS : 0 },
    () => controller.abort(timeoutError),
  );
  const tool = getGameplayTool(taskKey);
  const history = [{ role: "user", parts: [{ text: userMessage }] }];
  // Detailed mode follows every AI task, not only the ones that fail. Sizes and
  // shapes, never the prompt itself: a jump's system prompt is tens of thousands
  // of characters of campaign, which would fill the whole log budget in one
  // entry — but "the prompt was 92k characters and there was no tool schema" is
  // most of what a stuck task needs, and it is invisible otherwise.
  const taskStartedAt = Date.now();
  logDebugEvent("ai", `Task "${taskKey}" started.`, {
    promptChars: systemPrompt.length,
    userMessageChars: String(userMessage ?? "").length,
    tool: tool?.name || "(none — raw JSON expected)",
    idleTimeoutMs: idleMs || "(no deadline — waits as long as the model needs)",
    ...(idleMs ? { firstByteTimeoutMs: AI_FIRST_BYTE_TIMEOUT_MS } : {}),
  }, { verbose: true });
  // The instruction itself, separately. It is short (a sentence), it is the one
  // part of the prompt that differs between two runs of the same task, and it is
  // what a reader compares against a payload that came back about the wrong
  // thing.
  logDebugEvent("ai", `Task "${taskKey}" instruction.`, userMessage, { verbose: true });
  let failureReason = "The model did not return valid structured output.";
  // The player's only recourse when a turn falls back is "give Claude the
  // logs" — but the fallback warning below used to log only failureReason, a
  // short label ("Response did not contain parseable JSON..."), never the
  // actual text that failed to parse. Kept across attempts so whichever one
  // the loop last saw is what the warning below can show.
  let lastRawText = "";
  // Whether ANY attempt got as far as a response body. An empty lastRawText has
  // two very different meanings — the request died in transport (a 404 from a
  // mistyped base URL, a timeout, DNS) so the model never answered, versus the
  // model answering with nothing — and the copied debug report used to blame
  // both on "logging wasn't added yet". The first case is the more common one
  // and points straight at provider settings, so say which happened.
  let sawResponseBody = false;
  // Why the FIRST answer was rejected, and the answer itself when it was a
  // complete one. Both exist for the same reason: attempt 2 can die before it
  // produces anything (a provider 500, a timeout), and when it does, everything
  // learned from attempt 1 used to be thrown away with it. See the catch block
  // and the salvage pass below the loop.
  let firstFailureReason = "";
  let salvageCandidate = null;

  try {
    for (let outputAttempt = 1; outputAttempt <= 2; outputAttempt += 1) {
      // Observational only, and off unless enabled from DevTools: measures the
      // exact prompt about to be sent; never filters or reorders it.
      logContextDiagnostics({
        attempt: outputAttempt,
        helperTemplates: prompts.helpers,
        history,
        promptTemplate,
        stage: "structured-request",
        systemPrompt,
        taskKey,
        userMessage,
        variables,
      });
      // Per attempt, not per task: a retry re-sends the whole prompt and so
      // re-does the wait for a first byte.
      idle.start();
      logAi("ai.request", `${taskKey} attempt ${outputAttempt}`, {
        task: taskKey,
        attempt: outputAttempt,
        promptChars: systemPrompt.length,
        historyMessages: Array.isArray(history) ? history.length : 0,
        // The whole context, so "what does the AI actually know here" is
        // answerable from the log rather than by re-deriving it.
        systemPrompt,
      });
      // Telemetry: the record for THIS attempt comes back through the sink, so
      // the validation outcome below lands on the call that produced it.
      const attemptSink = {};
      const response = await callAI(systemPrompt, history, {
        // No output-token cap. A long/action-heavy turn's JSON must not be truncated
        // mid-response — a cut-off response won't parse, so runJsonTask fell back to
        // canned events that carry NO regionTransfers and NO diplomacy, which is why
        // the map never changed and no chats opened. main.jsx now lets each provider
        // use its own model maximum when no maxTokens is passed.
        // The moment this task gives up if nothing more arrives — null while
        // nothing has come back yet. The providers read it to decide whether a
        // busy-retry wait still fits inside the window.
        deadline: idle.deadline,
        // Every network chunk of the answer restarts that window.
        onActivity: idle.note,
        signal: controller.signal,
        tool,
        // Names this call in the ai-call transport entries, so a task's own
        // entries and the request/response pair underneath them line up.
        logLabel: `task "${taskKey}"`,
        // Which model answers is the task's business (Settings → Per-task models).
        taskKey,
        // Where the cacheable prefix of the system prompt ends — null once the
        // prompt was rewritten past it. Anthropic pins it with an explicit
        // cache_control block; OpenAI and Gemini cache identical prefixes on
        // their own, so the layout alone helps them.
        staticPrefixEnd: staticPrefixEndOf(systemPrompt, staticPromptPrefix),
        __debug: { taskKey, attempt: outputAttempt, maxAttempts: 2, simulatedDays: computeSimulatedDays(variables) },
        __debugSink: attemptSink,
      });
      // This attempt is answered: stop counting silence against it. Validation,
      // salvage and the retry's own prompt evaluation all happen with nothing on
      // the wire, and leaving the window armed across them would have attempt
      // 1's clock abort a perfectly healthy attempt 2. The next answer re-arms it.
      idle.cancel();
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      lastRawText = rawText;
      sawResponseBody = true;
      logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt} answered.`, {
        responseChars: rawText.length,
        viaToolCall: Boolean(response?.toolInput),
        elapsedMs: Date.now() - taskStartedAt,
      }, { verbose: true });
      let parsed = response?.toolInput ?? unwrapMimickedToolCall(extractJsonPayload(rawText), tool?.name);
      // The GM answers through a shallow transport (JSON array text per
      // subsystem); decode it here so schema validation sees the structured
      // transaction and a broken array is reported like any other invalid payload.
      let transportDecodeError = "";
      if (taskKey === "gameMaster" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const decoded = decodeGameMasterTransportPayload(parsed);
        transportDecodeError = normalizeString(decoded?.error);
        parsed = decoded?.payload;
      }
      // Lenient jump shapes (gameplaySchemas.js normalizeGameplayPayload): an
      // envelope, a singular event, synonym keys, doubled impacts wrappers —
      // rewritten to the canonical shape before the schema sees them.
      parsed = normalizeGameplayPayload(taskKey, parsed);
      // A single mistyped optional field must not discard the whole turn to the
      // canned fallback: the model sometimes returns `catalyst` as a prose string
      // instead of the object|null the jump schema requires. Coerce any non-object
      // catalyst to null (= no catalyst offered this turn) so the turn's real
      // content (events, transfers, chats) still validates and applies.
      if (parsed && typeof parsed === "object" && parsed.catalyst != null
          && (typeof parsed.catalyst !== "object" || Array.isArray(parsed.catalyst))) {
        parsed.catalyst = null;
      }
      // Same idea for markerOps. The engine has always accepted `found`/`destroy`
      // as aliases and a build written flat, but the schema only ever allowed the
      // canonical spelling — and a single rejected op fails the WHOLE payload, so
      // one flattened building cost the player the entire turn. Rewrite to the
      // canonical shape here, before validation, so the turn survives.
      for (const event of Array.isArray(parsed?.events) ? parsed.events : []) {
        const ops = event?.impacts?.markerOps;
        if (!Array.isArray(ops)) continue;
        event.impacts.markerOps = ops.map((op) => {
          if (!op || typeof op !== "object") return op;
          const kind = String(op.op ?? "").trim().toLowerCase();
          const canonical = kind === "found" ? "build" : kind === "destroy" ? "remove" : kind;
          if (canonical !== "build" || op.marker) return { ...op, op: canonical };
          // Flat build: lift the structure's own fields under `marker`.
          const { op: _op, note, ...marker } = op;
          return { op: "build", marker, ...(note == null ? {} : { note }) };
        });
      }
      // 8B.2.18: the Stats tool now estimates only a bounded set of native
      // demographic macro buckets. Native code expands those estimates back into
      // every exact live-map component before canonical validation/persistence.
      // AI latency therefore stays roughly constant as province count grows.
      let statsCoverageError = "";
      let statsCalibrationError = "";
      let statsEconomicCalibrationError = "";
      if (taskKey === "countryStatSheet" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const macroPlan = normalizeArray(variables?.statsTerritorialMacroPlan);
        const decoded = decodeCountryStatMacroEstimates(
          parsed.territorialMacroComponentsText ?? parsed.territorialComponentsText,
          macroPlan,
        );
        statsCoverageError = normalizeString(decoded?.error);
        let components = decoded?.components || [];

        if (!statsCoverageError && macroPlan.length > 0) {
          const expanded = expandTerritorialMacroEstimates(
            macroPlan,
            decoded?.estimates || [],
            { previousComponents: variables?.statsPreviousTerritorialComponents },
          );
          statsCoverageError = normalizeString(expanded?.error);
          if (!statsCoverageError) components = expanded.components;
        }

        const calibrationRequested = Boolean(variables?.statsPopulationCalibrationRequested);
        const calibration = parsed.populationCalibration;
        if (calibrationRequested) {
          const allowedModes = new Set(["historical_start", "counterfactual_start", "campaign_reconstruction"]);
          const mode = normalizeString(calibration?.mode);
          const cutoff = normalizeString(calibration?.historyAuthorityCutoff);
          const basis = normalizeString(calibration?.basis);
          if (!calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
            statsCalibrationError = "populationCalibration is required for this native Stats bootstrap/reconstruction.";
          } else if (!allowedModes.has(mode)) {
            statsCalibrationError = `populationCalibration.mode must be historical_start, counterfactual_start, or campaign_reconstruction; received ${mode || "blank"}.`;
          } else if (!cutoff) {
            statsCalibrationError = "populationCalibration.historyAuthorityCutoff must identify the latest shared-history frontier used for this scenario estimate.";
          } else if (!basis) {
            statsCalibrationError = "populationCalibration.basis must briefly state the evidence behind the regional causal calibration.";
          } else if (!statsCoverageError) {
            const total = components.reduce((sum, component) => sum + Math.max(0, Number(component?.population) || 0), 0);
            console.info(
              `[stats 8B.2.18.1] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: ` +
                `regional causal calibration applied (${mode}; history authority through ${cutoff}) — ` +
                `${macroPlan.length} macro bucket(s) expanded to ${components.length} exact live component(s), ` +
                `population ${Math.round(total).toLocaleString()}. Basis: ${basis}`,
            );
          }
        }

        const economicCalibrationRequested = Boolean(variables?.statsEconomicCalibrationRequested);
        const economicCalibration = parsed.economicCalibration;
        if (economicCalibrationRequested && !statsCoverageError) {
          statsEconomicCalibrationError = validateNativeEconomicCalibration({
            calibration: economicCalibration,
            populationCalibration: calibration,
            components,
            eligibleEvidenceIds: variables?.statsEconomicEvidenceIds,
            currentDate: variables?.statsEconomicCalibrationCurrentDate,
          });
          if (!statsEconomicCalibrationError) {
            const totalPopulation = components.reduce(
              (sum, component) => sum + Math.max(0, Number(component?.population) || 0),
              0,
            );
            const totalGdp = components.reduce(
              (sum, component) =>
                sum +
                Math.max(0, Number(component?.population) || 0) *
                  Math.max(0, Number(component?.gdpPerCapita) || 0),
              0,
            );
            const generatedPc = totalPopulation > 0 ? totalGdp / totalPopulation : 0;
            console.info(
              `[stats nominal baseline] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: ` +
                `${normalizeString(economicCalibration?.mode)} anchor ${economicCalibration?.anchorYear} ` +
                `${normalizeString(economicCalibration?.anchorCurrency).toUpperCase()} nominal GDP/capita ` +
                `${Math.round(Number(economicCalibration?.nominalGdpPerCapita) || 0).toLocaleString()} -> ` +
                `${Math.round(Number(economicCalibration?.rebasedGdpPerCapita2026Eur) || 0).toLocaleString()} 2026-EUR; ` +
                `generated ${Math.round(generatedPc).toLocaleString()} 2026-EUR.`,
            );
          }
        }

        // Calibration/macro transport fields are generation-only. The save keeps the
        // exact expanded component ledger plus native continuity/calibration stamps.
        const {
          populationCalibration: _populationCalibration,
          economicCalibration: _economicCalibration,
          territorialMacroComponentsText: _territorialMacroComponentsText,
          territorialComponentsText: _territorialComponentsText,
          ...statFields
        } = parsed;
        parsed = finalizeCountryStatSheet({
          ...statFields,
          territorialComponents: components,
        });

        const plannedComponentCount = normalizeArray(variables?.statsTerritorialPlan).length;
        const finalizedComponentCount = normalizeArray(parsed?.territorialComponents).length;
        if (!statsCoverageError && plannedComponentCount > 0 && finalizedComponentCount !== plannedComponentCount) {
          statsCoverageError =
            `Native Stats normalization dropped authoritative territorial components: expected ${plannedComponentCount}, finalized ${finalizedComponentCount}.`;
        }
      }
      let validation = parsed
        ? validateGameplayPayload(taskKey, parsed)
        : { valid: false, error: "Response did not contain parseable JSON or tool arguments." };
      if (validation.valid && (statsCoverageError || statsCalibrationError || statsEconomicCalibrationError)) {
        validation = {
          valid: false,
          error: [statsCoverageError, statsCalibrationError, statsEconomicCalibrationError].filter(Boolean).join(" "),
        };
      }
      if (transportDecodeError) {
        validation = { valid: false, error: transportDecodeError };
      }
      // The flat envelope validates against the schema; everything after this
      // point (the task validator, the caller) reads the three ledger transports.
      if (validation.valid && CANONICAL_UPDATE_ENVELOPE_TASKS.has(taskKey)) {
        parsed = expandCanonicalUpdateEnvelope(parsed);
      }
      // Clearing the schema means this is a complete, applicable turn. Only the
      // task validator can still reject it below, and while a retry remains it
      // does so STRICTLY — for shape-of-story problems it would have salvaged
      // had this been the last word. Worth keeping for exactly that case.
      const schemaValid = validation.valid;
      if (validation.valid && validatePayload) {
        // finalAttempt tells the validator this is the last chance: callers use
        // it to switch from strict (return a corrective error for the retry) to
        // salvage (repair the payload in place). It MUST come from here, not
        // from counting validator invocations — when attempt 1 dies at the
        // schema/parse level this validator never runs, so an invocation
        // counter would treat attempt 2 as "first", return strict feedback
        // meant for the model, and hand the player a fallback whose reason
        // reads "Resend the same response with ..." (a real field report).
        const taskError = normalizeString(
          await validatePayload(parsed, { attempt: outputAttempt, finalAttempt: outputAttempt === 2 }),
        );
        if (taskError) validation = { valid: false, error: taskError };
      }

      if (validation.valid) {
        attachAttemptOutcome(attemptSink.record, { ok: true, parsedSummary: normalizeParsedSummary(taskKey, parsed) });
        logDebugEvent("ai", `Task "${taskKey}" succeeded on attempt ${outputAttempt} in ${Math.round((Date.now() - taskStartedAt) / 1000)}s.`, undefined, { verbose: true });
        // The payload that was ACCEPTED, not only the ones that were rejected.
        // A turn that validates cleanly and still produces the wrong world — a
        // transfer to a polity that does not exist, a chat opened with nobody in
        // it — is a report about content that passed every check, and until now
        // the only output text the log kept was from answers that failed.
        // Logged from the payload rather than rawText so a tool call, which has
        // no raw text at all, is recorded the same way as a JSON reply.
        logDebugEvent("ai", `Task "${taskKey}" accepted payload.`, parsed, { verbose: true });
        return { generation: { source: "ai", fallbackReason: "" }, payload: parsed };
      }

      // Every rejection, including the one attempt 2 goes on to fix. A turn that
      // came out right on the retry still tells you which rule the model keeps
      // breaking, and that is invisible in a log that only records failures.
      attachAttemptOutcome(attemptSink.record, {
        ok: false,
        validationError: validation.error,
        parsedSummary: normalizeParsedSummary(taskKey, parsed),
      });
      logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt} REJECTED: ${validation.error}`, {
        clearedSchema: schemaValid,
        rawResponse: rawText,
      }, { verbose: true });

      failureReason = validation.error;
      if (!firstFailureReason) firstFailureReason = validation.error;
      if (schemaValid && !salvageCandidate) salvageCandidate = parsed;
      if (outputAttempt === 1 && !controller.signal.aborted) {
        history.push({
          role: "model",
          parts: [{ text: rawText || JSON.stringify(parsed ?? null) }],
        });
        // A model that answered with a tool call is told to call it again; one
        // that answered in prose (local models without tool support) is told to
        // answer in raw JSON — telling it to call a tool it cannot see wastes
        // the one retry this task gets.
        const retryInstruction = response?.toolInput
          ? `Call ${tool?.name || "the required tool"} again with corrected input.`
          : "Respond again with ONLY the corrected JSON object - no prose, no explanations, no markdown fences, just the JSON.";
        history.push({
          role: "user",
          parts: [{ text: `Your previous structured answer failed validation: ${validation.error} ${retryInstruction}` }],
        });
        continue;
      }
    }
  } catch (error) {
    const actualError = controller.signal.aborted ? controller.signal.reason : error;
    const transportReason = normalizeString(actualError?.message || actualError);
    // The retry dying in transport used to ERASE why the first answer was
    // rejected, so the debug report the player copies out read "Internal server
    // error" above a raw response that had nothing to do with it — the text
    // shown is attempt 1's (lastRawText is only reassigned once a call returns),
    // and its actual rejection reason was gone. Report the first answer's reason
    // first, since that is the one the raw text belongs to.
    failureReason = firstFailureReason
      ? `${firstFailureReason}${transportReason ? ` The retry then failed: ${transportReason}` : ""}`
      : transportReason || failureReason;
    logAi("ai.failed", `${taskKey}: ${failureReason}`, {
      task: taskKey,
      aborted: controller.signal.aborted,
      stack: actualError?.stack ? String(actualError.stack).slice(0, 4000) : undefined,
    }, "error");
  } finally {
    idle.cancel();
  }

  // A deliberate user cancel must NOT silently fall back to canned events —
  // propagate the abort so the caller can quietly cancel the jump with no state
  // change. (A timeout still uses the fallback, as before.)
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
  }

  // Last chance before the canned fallback. An earlier answer that cleared the
  // schema is a finished turn — every event, transfer and chat the model
  // wrote — and the task validator rejected it only under `strict`, which is on
  // solely BECAUSE a retry remained: an event count, a stray date, an invented
  // region name, all of which it repairs in place on the final attempt. When the
  // retry then produced nothing usable (a provider 500, a timeout, a second
  // answer that failed outright), that final-attempt pass never ran, and the
  // player lost a complete turn to a rule the model was never given the chance
  // to satisfy. Run it now — the same salvage the second answer would have got.
  if (salvageCandidate) {
    try {
      const salvageError = validatePayload
        ? normalizeString(await validatePayload(salvageCandidate, { attempt: 2, finalAttempt: true }))
        : "";
      if (!salvageError) {
        logDebugEvent("ai", `Task "${taskKey}" salvaged an earlier answer after the retry failed — the turn is real, not canned.`, undefined, { verbose: true });
        return { generation: { source: "ai", fallbackReason: "" }, payload: salvageCandidate };
      }
    } catch {
      // Salvage validation is best-effort; fall through to the fallback below.
    }
  }

  if (typeof fallback !== "function") {
    throw new Error(`AI task "${taskKey}" failed: ${failureReason}`);
  }

  console.warn(`[ai] task "${taskKey}" failed (${failureReason}) — using the deterministic fallback.`);
  // Capped so one runaway response can't bloat world.json (this rides along on
  // every recent fallback's simulationHistory entry, see applySimulationResult)
  // or flood the console. Surfaced to the player as the "Copy debugging
  // message" button next to the fallback warning (time.jsx) — that button, not
  // DevTools, is the primary way this reaches anyone now.
  const RAW_RESPONSE_LIMIT = 12000;
  const capturedRawText = lastRawText.length > RAW_RESPONSE_LIMIT
    ? `${lastRawText.slice(0, RAW_RESPONSE_LIMIT)}\n…[${lastRawText.length - RAW_RESPONSE_LIMIT} more characters truncated]`
    : lastRawText;
  // No body at all is itself the diagnosis, so say so instead of leaving the
  // field empty and letting the report guess it is an old turn. The marker
  // goes in the same field the raw text uses, so it survives the reload path
  // (applySimulationResult → world.json) with no extra plumbing.
  const rawResponse = capturedRawText
    || (sawResponseBody ? EMPTY_RESPONSE_BODY_NOTE : NO_RESPONSE_BODY_NOTE);
  if (capturedRawText) {
    console.warn(`[ai] task "${taskKey}" — raw model response that failed to parse:\n${capturedRawText}`);
  } else {
    console.warn(`[ai] task "${taskKey}" — ${rawResponse}`);
  }
  return {
    generation: { source: "fallback", fallbackReason: failureReason, rawResponse, taskKey },
    payload: await fallback(),
  };
};

const CONSOLIDATION_INTERVAL_ROUNDS = 5;
const CONSOLIDATION_RETAIN_EVENTS = 24;
const CONSOLIDATION_SIZE_THRESHOLD = 48;
const CONSOLIDATION_BATCH_SIZE = 60;

// The Projects & Operations board, in its own call.
//
// Why it is separate: projectOps was two thirds of the jump's output contract,
// and the board dominated what the model spent its attention on — a field run
// caught one narrating stalled programmes for three minutes and never reaching
// the events it was asked for. The board is BOOKKEEPING: it follows from the
// events rather than competing with them for the same budget. Split out, each
// call carries one contract, and this one sees only what it needs.
//
// Runs ONCE per jump, never per segment: a segmented jump would otherwise pay
// for this three times and show the model only a third of the round each time.
//
// Returns the ops rather than applying them. applySimulationResult attaches them
// onto the events that caused them (so the board change is recorded as part of
// that event) and then applies them through the same event path as every other
// impact, inside the same single write and the same rollback snapshot.
const generateProjectOps = async (bundle, events, { signal } = {}) => {
  const board = normalizeArray(bundle.world?.projects);
  // Nothing to keep in step, and nothing an event could plausibly open against
  // an empty board that is worth a whole extra request.
  if (board.length === 0 || events.length === 0) return { ops: [], skipped: true };

  const variables = await buildTemplateVariables(bundle, {});
  // The events, numbered, because eventIndex is how an op says which one moved
  // the effort. Impacts are deliberately left out: this call decides what the
  // STORY did to the board, and the other levers are noise for that question.
  const eventList = events
    .map((event, index) => `[${index}] ${event.date || "undated"} — ${event.title}\n${event.description}`)
    .join("\n\n");

  // Doubted entries the player now has a clean pair of eyes on. Named explicitly
  // rather than left for the model to notice, because settling one is only honest
  // when a fresh source genuinely exists — and that is a fact about world state,
  // not something readable from the board text. The sealed file is enough: only
  // `planted` is read, so nothing has to be decrypted.
  const gathered = await readInterceptsState({ force: false }).catch(() => ({}));
  const pendingDoubts = doubtedAwaitingFreshSource(
    normalizeSpies(bundle.world?.spies),
    board,
    {
      playerPolity: normalizeString(bundle.game?.country),
      intercepts: normalizeIntercepts(gathered),
    },
  );
  const doubtBlock = pendingDoubts.length
    ? `\n\nThese doubted entries can now be settled — a fresh agent is in place:\n${describeDoubtedForPrompt(pendingDoubts)}`
    : "";

  const { generation, payload } = await runJsonTask("projects", {
    signal,
    userMessage:
      `These events have just been simulated. Move the board to match them, and return `
      + `{"projectOps":[]} if nothing on it genuinely moved.\n\n${eventList}${doubtBlock}`,
    variables,
    // No fallback: an empty board is exactly what a failed call should leave
    // behind, and runJsonTask throwing is what lets the caller tell the player
    // the board did not update rather than pretending it did.
  });
  return { generation, ops: normalizeArray(payload?.projectOps) };
};

// The turn is generated and waiting, not lost. Flagged so the UI can tell this
// apart from an ordinary jump failure and offer to retry just the board rather
// than regenerating the whole round.
const projectsHeldError = (cause) => {
  const error = new Error(
    "Your events are ready, but the Projects & Operations board did not update, so nothing has been "
    + `saved yet: ${cause?.message || "the board task returned no usable answer"}. `
    + "Retry the board to finish the turn, or discard it and run the turn again.",
  );
  error.projectsHeld = true;
  error.cause = cause;
  return error;
};

// Finish a held turn by re-running ONLY the board call. The events are not
// regenerated — they are already valid, and on a slow model they may have cost
// ten minutes. Because nothing was written, this is the same code path as the
// first attempt rather than a second one to keep in step.
export const retryPendingProjectsJump = async ({ signal } = {}) => {
  if (!pendingProjectsJump) throw new Error("There is no turn waiting on the Projects board.");
  const { applyArgs } = pendingProjectsJump;
  beginSimulation();
  try {
    // Released BEFORE the attempt, so a turn can never be applied twice, and
    // re-held only if the BOARD fails again — a failure after that point is a
    // different situation and must not pretend otherwise.
    pendingProjectsJump = null;
    // The RETRY's signal, not the held turn's — that one belongs to a request
    // that already finished, and if the player cancelled it this call would abort
    // before it started.
    applyArgs.projects = { ...applyArgs.projects, signal };
    // Re-running the whole apply is safe and is why this is one call rather than
    // a second code path to keep in step: it is pure until its final writes, and
    // every step in between is deterministic — espionage included, since its rolls
    // are seeded on the round.
    return await applySimulationResult(applyArgs);
  } catch (error) {
    if (error?.projectsHeld) {
      logDebugEvent("turn", "Board retry failed; the turn is still held.", error);
      pendingProjectsJump = { applyArgs };
    }
    throw error;
  } finally {
    endSimulation();
  }
};

// Put each op onto the event that caused it, so the board move is part of that
// event's impacts. An op with no usable eventIndex lands on the LAST event: the
// alternative is dropping it, and a board change the model asked for is worth
// more than perfect attribution of which event caused it.
const attachProjectOpsToEvents = (events, ops) => {
  if (!events.length || !ops.length) return 0;
  let attached = 0;
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const raw = Number(op.eventIndex);
    const index = Number.isInteger(raw) && raw >= 0 && raw < events.length ? raw : events.length - 1;
    const event = events[index];
    if (!event.impacts || typeof event.impacts !== "object") event.impacts = {};
    if (!Array.isArray(event.impacts.projectOps)) event.impacts.projectOps = [];
    // eventIndex was addressing, not content — it means nothing once the op is
    // sitting on its event, and normalizeProjectOp would only have to ignore it.
    const { eventIndex, ...rest } = op;
    event.impacts.projectOps.push(rest);
    attached += 1;
  }
  return attached;
};

const consolidateHistoryBatch = async (bundle, events, chats, actions = [], { onBatchResult } = {}) => {
  const variables = await buildTemplateVariables(bundle, {
    // Resolved orders are consolidated alongside the events they caused. Capping
    // the history that gets SENT each turn is not enough on its own: drop the old
    // orders without recording what they did and the model loses the campaign's
    // divergences from real history, then refills the gap from real history. A
    // player hit exactly that — a 1920s Europe with no WW1 and a surviving Tsar
    // started growing a Soviet Union that never existed.
    actionsToConsolidate: buildActionHistoryText(actions, {
      includeResolved: true,
      limit: actions.length || 1,
    }),
    chatsToConsolidate: buildDetailedChatHistoryText(chats, { limit: chats.length || 1, messageLimit: 100 }),
    eventsToConsolidate: buildEventHistoryText(events, { limit: events.length || 1 }),
  });
  const { generation, payload, deferred } = await runJsonTask("eventConsolidator", {
    fallback: () => ({
      summary: [
        events.map((event) => `${event.date || "undated"} ${event.title}: ${event.description}`).join("; "),
        buildChatSummaryText(chats, { limit: chats.length || 1 }),
        actions.length ? `Player orders resolved: ${actions.map((action) => action.title).join("; ")}` : "",
      ].filter(Boolean).join("\n"),
    }),
    userMessage: "Consolidate the supplied campaign history with the required tool.",
    variables,
    // Off the critical path when the caller supplies an applier: the summary
    // may land later through the batch poller.
    sync: typeof onBatchResult !== "function",
    onBatchResult,
  });
  if (deferred) return { deferred: true, generation, summary: "" };
  return { generation, summary: normalizeString(payload?.summary) };
};

const compactHistoryIfNeeded = async (bundle) => {
  const world = normalizeWorldState(bundle.world);
  const unconsolidatedEvents = getUnconsolidatedEvents(bundle.events, world);
  const shouldCompactEvents =
    unconsolidatedEvents.length > CONSOLIDATION_SIZE_THRESHOLD ||
    (bundle.game.round % CONSOLIDATION_INTERVAL_ROUNDS === 0 &&
      unconsolidatedEvents.length > CONSOLIDATION_RETAIN_EVENTS);
  const priorChatIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.chatIds));
  const closedChats = normalizeChats(bundle.chats)
    .filter((chat) => chat.status === "closed" && !priorChatIds.has(chat.id));
  const eventsToConsolidate = shouldCompactEvents
    ? unconsolidatedEvents.slice(0, -CONSOLIDATION_RETAIN_EVENTS).slice(0, CONSOLIDATION_BATCH_SIZE)
    : [];

  if (eventsToConsolidate.length === 0 && closedChats.length === 0) return world;

  // Ride along with a consolidation that is happening anyway — no extra AI call,
  // which matters when the point of the exercise is to shrink cost. Orders already
  // folded into an earlier summary are skipped.
  const priorActionIds = new Set(world.consolidatedHistory.flatMap((entry) => entry.actionIds));
  const actionsToConsolidate = normalizeActions(bundle.actions)
    .filter((action) => action.status !== "planned" && action.id && !priorActionIds.has(action.id))
    .slice(0, CONSOLIDATION_BATCH_SIZE);

  const throughEvent = eventsToConsolidate.at(-1);
  // One shape for both writers — the synchronous return below and the
  // deferred applier — so a batch-consolidated entry reads exactly like a
  // live one.
  const entryFor = (summary, source, priorHistory) => ({
    actionIds: actionsToConsolidate.map((action) => action.id),
    chatIds: closedChats.map((chat) => chat.id),
    createdAt: new Date().toISOString(),
    source,
    summary,
    throughDate: throughEvent?.date || bundle.game.gameDate,
    throughEventId: throughEvent?.id || priorHistory.at(-1)?.throughEventId || "",
    throughRound: bundle.game.round,
  });
  const { generation, summary } = await consolidateHistoryBatch(
    bundle,
    eventsToConsolidate,
    closedChats,
    actionsToConsolidate,
    {
      // Batch routing (Settings → Batch background AI tasks): the summary lands
      // later through the poller and is written here out of band, while the
      // jump that asked for it carries on with the events unconsolidated.
      onBatchResult: async (resultPayload, source) => {
        if (isSimulationBusy()) return false;
        const summaryText = normalizeString(resultPayload?.summary);
        if (!summaryText) return true;
        const current = await readGameStateBundle({ force: true });
        const currentWorld = normalizeWorldState(current.world);
        // Superseded when a synchronous consolidation covered these events
        // in the meantime: two summaries of the same weeks would double the
        // campaign's memory of them.
        const stillOpen = throughEvent
          ? getUnconsolidatedEvents(current.events, currentWorld).some((event) => event.id === throughEvent.id)
          : true;
        if (!stillOpen) return true;
        await writeWorldState(normalizeWorldState({
          ...currentWorld,
          consolidatedHistory: [...currentWorld.consolidatedHistory, entryFor(summaryText, source, currentWorld.consolidatedHistory)],
        }));
        logDebugEvent("ai", `Deferred consolidation applied (${source}): ${eventsToConsolidate.length} events, ${closedChats.length} chats.`);
        return true;
      },
    },
  );
  if (!summary) return world;

  return normalizeWorldState({
    ...world,
    consolidatedHistory: [
      ...world.consolidatedHistory,
      entryFor(summary, generation.source, world.consolidatedHistory),
    ],
  });
};

const mergePolityCatalog = (countryCatalog, world) => {
  const merged = new Map();

  for (const country of countryCatalog) {
    if (!country) continue;
    merged.set((country.code || country.name).toUpperCase(), {
      code: country.code || "",
      name: country.name || country.code || "",
    });
  }

  for (const polity of Object.values(normalizeWorldState(world).polityOverrides)) {
    if (!polity) continue;
    merged.set((polity.code || polity.name).toUpperCase(), {
      code: polity.code,
      name: polity.name || polity.code,
    });

    if (polity.name) {
      merged.set(polity.name.toUpperCase(), {
        code: polity.code,
        name: polity.name,
      });
    }
  }

  return Array.from(merged.values());
};

// ---- Simulation busy lock ---------------------------------------------------
// The idle diplomacy drip (maybeSendIdleDiplomacy below) must never run - and
// above all never WRITE chat state - while a jump, game-master command, or
// catalyst stage is in flight: those read the full state bundle at entry and
// write it all back at the end, so a concurrent chat write would be silently
// clobbered (or worse, interleave with the rollback snapshot). Every simulation
// entry point wraps itself in beginSimulation/endSimulation; the drip checks
// the counter before starting AND before writing, and simply skips its turn.
// Which campaign is in front of the player right now. A turn stamps this when
// it reads its state and checks it again before writing, because the runtime
// endpoints follow the active campaign and a switch mid-turn would otherwise
// land the whole turn on the campaign that was switched to (campaignGuard.js).
const activeCampaignId = () => {
  try {
    return String(getLibraryState()?.activeGameId ?? "").trim();
  } catch {
    return "";
  }
};

let activeSimulations = 0;
const beginSimulation = () => { activeSimulations += 1; };
const endSimulation = () => { activeSimulations = Math.max(0, activeSimulations - 1); };
// A turn whose events are generated and validated but NOT yet written, because
// the Projects & Operations board could not be brought in step with them.
//
// Nothing is applied while this is set. That is deliberate and is what keeps the
// retry honest: the board's ops must ride in on the events that caused them and
// be applied before the world is written. Holding the whole turn means the retry
// is the SAME path as the first attempt, with no privileged bypass to add. If it
// cannot be resolved the turn fails like any other and the player rolls back.
let pendingProjectsJump = null;

// A jump whose segments are part-generated: one segment failed, the ones before
// it are still in hand, and NOTHING has been written. Held so the player is told
// which segment failed and can retry just that segment or discard the turn (see
// runJumpSegments).
let pendingJumpSegment = null;

export const hasPendingJumpSegment = () => pendingJumpSegment !== null;

// Abandon the held jump. Nothing was written, so there is nothing to undo — the
// player loses the segments generated so far, as if they had cancelled.
export const discardPendingJumpSegment = () => {
  const had = pendingJumpSegment !== null;
  pendingJumpSegment = null;
  if (had) logDebugEvent("turn", "Held jump discarded; nothing was written and its finished segments are gone.");
  return had;
};

// The turn is part-generated and waiting, not lost. Flagged so the UI can tell
// this apart from an ordinary jump failure and offer to retry the one segment
// that failed rather than regenerating the whole round.
const segmentHeldError = ({ cause, completedSegments, segmentCount, segmentIndex }) => {
  const kept = completedSegments === 0
    ? "No part of the round has been generated yet"
    : `The ${completedSegments === 1 ? "segment" : `${completedSegments} segments`} before it `
      + `${completedSegments === 1 ? "is" : "are"} still here`;
  const error = new Error(
    `Segment ${segmentIndex + 1} of ${segmentCount} of this jump failed, so nothing has been saved: `
    + `${cause?.message || "the AI returned no usable answer"}. ${kept}. `
    + "Retry that segment to carry on from where it stopped, or discard the turn — the game stays on "
    + "its current date either way.",
  );
  error.segmentHeld = true;
  error.segmentIndex = segmentIndex;
  error.segmentCount = segmentCount;
  error.completedSegments = completedSegments;
  error.cause = cause;
  return error;
};

// A held jump counts as busy: the idle pulse checks this before it writes, so it
// cannot write into a world that is about to be replaced by the held turn.
export const isSimulationBusy = () => activeSimulations > 0
  || pendingProjectsJump !== null
  || pendingJumpSegment !== null;

// --- Batch dispatch (ported from the abdulrahman-2005 fork) -------------------
// Tasks submitted with sync:false register here; a lazy poller asks the
// provider's batch endpoint and applies validated results out of band, never
// while a simulation is running. The registry is in memory on purpose: a page
// reload orphans an in-flight batch, which for the event consolidator only
// means those events stay unconsolidated and ride along with the next
// consolidation — nothing is lost, and there is no stale handle to migrate.
const batchBackgroundTasksEnabled = () => getMapSetting(MAP_SETTING_KEYS.batchBackgroundTasks);
const BATCH_POLL_INTERVAL_MS = 60000;
const pendingBatches = new Map(); // customId -> { taskKey, fallback, validatePayload, onBatchResult }
let batchPollerTimer = null;

const registerPendingBatch = (entry) => {
  pendingBatches.set(entry.customId, entry);
  logDebugEvent("ai", `Task "${entry.taskKey}" submitted as batch ${entry.customId} (${pendingBatches.size} in flight).`);
  if (!batchPollerTimer && typeof window !== "undefined") {
    batchPollerTimer = window.setInterval(() => { pollPendingBatches(); }, BATCH_POLL_INTERVAL_MS);
  }
};

export const pendingBatchCount = () => pendingBatches.size;

export const pollPendingBatches = async () => {
  if (pendingBatches.size === 0 || isSimulationBusy()) return;
  for (const [customId, entry] of [...pendingBatches]) {
    const outcome = await retrieveAIBatch(customId);
    if (outcome.status === "pending") continue;
    pendingBatches.delete(customId);
    try {
      let result = null;
      if (entry.record && outcome.usage) entry.record.usage = outcome.usage;
      if (outcome.status === "done") {
        const candidate = outcome.payload ?? (outcome.rawText ? extractJsonPayload(outcome.rawText) : null);
        let validation = candidate
          ? validateGameplayPayload(entry.taskKey, candidate)
          : { valid: false, error: "The batch answer carried no parseable JSON or tool input." };
        if (validation.valid && typeof entry.validatePayload === "function") {
          // No interactive retry stands behind a batch job: the final-attempt
          // (salvage) treatment, as the synchronous path gives attempt 2.
          const taskError = normalizeString(await entry.validatePayload(candidate, { attempt: 1, finalAttempt: true }));
          if (taskError) validation = { valid: false, error: taskError };
        }
        if (validation.valid) {
          result = { value: candidate, source: "batch" };
          attachAttemptOutcome(entry.record, { ok: true, parsedSummary: normalizeParsedSummary(entry.taskKey, candidate) });
          finishAiRecord(entry.record, { ok: true, rawResponse: outcome.rawText ?? "" });
        } else {
          attachAttemptOutcome(entry.record, { ok: false, validationError: validation.error });
          finishAiRecord(entry.record, { ok: false, error: "The batch answer failed validation.", rawResponse: outcome.rawText ?? "" });
          logDebugEvent("ai", `Batch ${customId} ("${entry.taskKey}") failed validation: ${validation.error} Applying the deterministic fallback.`);
        }
      } else {
        finishAiRecord(entry.record, { ok: false, error: "The batch request did not succeed." });
        logDebugEvent("ai", `Batch ${customId} ("${entry.taskKey}") did not succeed. Applying the deterministic fallback.`);
      }
      if (!result) {
        const fallbackPayload = typeof entry.fallback === "function" ? await entry.fallback() : null;
        result = fallbackPayload ? { value: fallbackPayload, source: "fallback" } : null;
      }
      if (!result) continue;
      const applied = await entry.onBatchResult(result.value, result.source);
      // The applier declined (a simulation started meanwhile): keep the entry
      // and try again on the next poll.
      if (applied === false) pendingBatches.set(customId, entry);
    } catch (error) {
      logDebugEvent("ai", `Batch ${customId} ("${entry.taskKey}") could not be applied: ${normalizeString(error?.message || error)}`);
    }
  }
};

export const hasPendingProjectsJump = () => pendingProjectsJump !== null;

// Abandon the held turn. Nothing was written, so there is nothing to undo — the
// player simply loses the generation, the same as cancelling a jump.
export const discardPendingProjectsJump = () => {
  const had = pendingProjectsJump !== null;
  pendingProjectsJump = null;
  if (had) logDebugEvent("turn", "Held turn discarded; the board was never updated and nothing was written.");
  return had;
};

const resolveInvitees = async (names, world, additionalCountries = []) => {
  const countryCatalog = [
    ...mergePolityCatalog(await loadCountryNames(), world),
    ...normalizeArray(additionalCountries).map((entry) => ({
      code: normalizeString(entry?.code),
      name: normalizeString(entry?.name || entry?.code),
    })),
  ];
  const lookup = new Map();

  for (const country of countryCatalog) {
    lookup.set((country.name || "").toUpperCase(), country);
    if (country.code) {
      lookup.set(country.code.toUpperCase(), country);
    }
  }

  const resolved = normalizeArray(names)
    .map((reference) => {
      const candidates = typeof reference === "string"
        ? [reference]
        : [reference?.name, reference?.code];
      return candidates
        .map((candidate) => lookup.get(normalizeString(candidate).toUpperCase()) || null)
        .find(Boolean) || null;
    })
    .filter(Boolean);
  const unique = new Map(resolved.map((entry) => [entry.code || entry.name, entry]));
  return Array.from(unique.values()).map((entry) => ({
      code: entry.code || "",
      name: entry.name || entry.code || "",
    }));
};

const inferInviteeNames = async (text, world, playerCountry = "") => {
  const countryCatalog = mergePolityCatalog(await loadCountryNames(), world);
  const normalizedText = normalizeString(text).toLowerCase();

  return countryCatalog
    .filter((country) => country.name && country.name.toLowerCase() !== normalizeString(playerCountry).toLowerCase())
    .filter((country) => normalizedText.includes(country.name.toLowerCase()))
    .slice(0, 5)
    .map((country) => country.name);
};

const fallbackActionSuggestions = async (bundle) => {
  const recentTitles = normalizeEvents(bundle.events).slice(-3).map((event) => event.title);
  const topics = DEFAULT_SUGGESTION_TOPICS.map((topic, index) => {
    const recentTitle = recentTitles[index];
    const actions = [
      normalizeActionEntry({
        kind: "action",
        source: "suggested",
        text: `Issue a concrete order addressing ${recentTitle || topic.title.toLowerCase()} and assign a responsible ministry or command.`,
        title: recentTitle ? `Respond to ${recentTitle}` : `Act on ${topic.title}`,
      }),
      normalizeActionEntry({
        kind: "action",
        source: "suggested",
        text: `Prepare a second-order measure that protects ${bundle.game.country || "the polity"} if this line of effort triggers resistance.`,
        title: "Create a contingency layer",
      }),
    ].filter(Boolean);

    return {
      actions,
      description: topic.description,
      id: `fallback-topic-${index}`,
      title: recentTitle || topic.title,
    };
  });

  return { topics };
};

const fallbackDescriptionToAction = async (rawInput, bundle) => {
  const trimmed = normalizeString(rawInput);
  const isChat = CHAT_HINT_PATTERNS.some((pattern) => pattern.test(trimmed));
  const inferredInvitees = isChat
    ? await inferInviteeNames(trimmed, bundle.world, bundle.game.country)
    : [];
  const title = sentenceCase(trimmed.split(/[.!?]/)[0] || trimmed);
  const expandedText = isChat
    ? `${trimmed}. Clarify the objective, the concession you can offer, and the outcome you want before the exchange hardens.`
    : `${trimmed}. Define the instrument, timing, and expected political or military effect so the move can be executed cleanly.`;

  return {
    chatStarter: isChat ? trimmed : "",
    invitees: inferredInvitees,
    kind: isChat ? "chat" : "action",
    text: expandedText.slice(0, 520),
    title: title.length > 72 ? `${title.slice(0, 69)}...` : title,
  };
};

const pickMentionedSpeaker = (messageText, participants, excludedSpeaker) => {
  const normalizedText = normalizeString(messageText).toLowerCase();
  if (!normalizedText) return null;

  return (
    participants.find((country) => {
      if (country.name === excludedSpeaker) return false;
      return normalizedText.includes(country.name.toLowerCase());
    }) ?? null
  );
};

const fallbackNextSpeaker = ({ chat, excludedSpeaker }) => {
  const normalizedChat = normalizeChats([chat])[0];
  if (!normalizedChat) {
    return { nextSpeaker: "" };
  }

  const lastMessage = normalizedChat.messages.at(-1);
  const mentionedSpeaker = pickMentionedSpeaker(lastMessage?.text, normalizedChat.countries, excludedSpeaker);
  if (mentionedSpeaker) {
    return { nextSpeaker: mentionedSpeaker.name };
  }

  const fallbackCountry =
    normalizedChat.countries.find((country) => country.name !== excludedSpeaker) ??
    normalizedChat.countries[0] ??
    { name: "" };

  return {
    nextSpeaker: fallbackCountry.name,
  };
};

export const buildGeneratedChat = async (chatLike, linkEventId, world, { fallbackTitle = "", playerName = "" } = {}) => {
  const countriesInput = Array.isArray(chatLike?.countries) ? chatLike.countries : [];
  const countries = await resolveInvitees(countriesInput, world);
  if (countries.length === 0) return null;

  // The initiating polity speaks first — and it is never the player. When the
  // model names no speaker (or names the player), attribute the opener to the
  // first non-player participant.
  const playerKey = normalizeString(playerName).toUpperCase();
  const matchesPlayer = (country) =>
    playerKey && (normalizeString(country.name).toUpperCase() === playerKey || normalizeString(country.code).toUpperCase() === playerKey);
  const speakerKey = normalizeString(chatLike?.speaker).toUpperCase();
  const initiator =
    countries.find((country) =>
      speakerKey && !matchesPlayer(country)
      && (normalizeString(country.name).toUpperCase() === speakerKey || normalizeString(country.code).toUpperCase() === speakerKey))
    ?? countries.find((country) => !matchesPlayer(country))
    ?? countries[0];

  const entry = normalizeChatEntry({
    countries,
    id: chatLike?.id,
    linkedEventId: linkEventId,
    messages:
      Array.isArray(chatLike?.messages) && chatLike.messages.length > 0
        ? chatLike.messages
        : chatLike?.openingMessage
        ? [
            {
              code: initiator?.code || "",
              role: "leader",
              speaker: initiator?.name || normalizeString(chatLike?.speaker),
              text: chatLike.openingMessage,
              time: "",
            },
          ]
        : [],
    source: normalizeString(chatLike?.source) || "invitation",
    status: "open",
    // A chat must say why it exists: the model's title, else the causing
    // event's title, else at least the participants.
    title: chatLike?.title || fallbackTitle || `Chat with ${countries.map((country) => country.name).join(", ")}`,
  });
  // The initiating polity always speaks first. If no first message survives
  // normalization (the model gave no openingMessage, or only blank text), this
  // would be a titled-but-empty "mystery chat" the player can't make sense of
  // ("no clue why talks started"). Drop it instead of opening an empty thread —
  // such chats otherwise slipped through on the salvage/final AI attempt (where
  // validateChatOpener is no longer enforced) and as opener-less idle-diplomacy
  // notes. Every caller already treats a null return as "no chat".
  if (!entry || entry.messages.length === 0) return null;
  return entry;
};

// Region ownership is keyed by the map's own region id (GID_1, e.g. "DEU.2_1"),
// but the prompts ask the model for a region's original NAME in regionId, and the
// model is never shown an id to copy. An unresolved name is not inert: it becomes
// regionOwnershipOverrides["Bayern"], which matches no geometry feature and so
// paints nothing while still counting as a map change in the timeline. Turn names
// into real ids here; whatever cannot be resolved is REPORTED back to the caller
// so the model can be retried with the real region names in hand (see
// validateGeneratedWorldChanges), and only after that is it dropped so a phantom
// key never reaches the world state.
const regionKey = (value) => normalizeString(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ");

// Case/diacritic-insensitive identity for a chat's participant SET (order-blind:
// "France, Spain" and "Spain, France" are the same conversation). Drives the
// dedup below: a country picking up an old thread must land back in that thread,
// not beside it in a freshly forked one.
const chatParticipantKey = (countries) =>
  (Array.isArray(countries) ? countries : [])
    .map((country) => regionKey(country?.name))
    .filter(Boolean)
    .sort()
    .join("|");

// Every message the game itself puts into a diplomatic thread passes through the
// fold below — the notes a jump generates, the idle pulse, and the advisor's own
// "send this to <country>" — so this is where a detailed log records them, with
// WHICH thread they landed in: "it opened a second thread with France instead of
// answering in the one I had" is invisible without that.
const logGeneratedChat = (built, outcome) => {
  const participants = (built?.countries ?? [])
    .map((country) => country?.name || country?.code || "")
    .filter(Boolean)
    .join(", ") || "(no participants)";
  logDebugEvent("diplomacy",
    `Generated note ${outcome} — ${participants}: "${built?.title || "(untitled)"}" (source: ${built?.source || "unknown"}).`,
    (built?.messages ?? []).map((msg) => `${msg?.speaker || msg?.role || "?"}: ${msg?.text ?? ""}`),
    { verbose: true });
};

// Route freshly-generated chats into whichever existing OPEN thread already has
// the same participants (appending their messages there) instead of always
// forking a new one. `built` may itself contain chats that duplicate each other
// (two events in the same turn both reaching out to France), so a match against
// an entry already folded in THIS pass counts too, not just against `storageChats`.
// Every message gets stamped with `stampTime` when it has none of its own —
// including a brand-new chat's own opener: the UI groups and sorts chats by
// their messages' own `time`, so an unstamped opener left the whole chat
// looking dateless.
// `dropEchoes` discards a note that merely parrots something already in the
// thread it would land in. Even when told not to, a model hands back the line it
// was just shown, and posting it has the polity repeat the player to their face —
// worse than saying nothing.
//
// `dropped` on the returned array counts the notes discarded this way, so a
// caller that must know whether anything actually landed can tell without
// diffing the result.
const foldGeneratedChatsIntoStorage = (storageChats, builtChats, { stampTime = "", dropEchoes = false } = {}) => {
  let chats = [...storageChats];
  const created = [];
  let dropped = 0;
  const stamp = (messages) => (stampTime
    ? messages.map((msg) => (msg.time ? msg : { ...msg, time: stampTime }))
    : messages);

  for (const built of builtChats) {
    const key = chatParticipantKey(built.countries);
    const existingIdx = key ? chats.findIndex((chat) =>
      chat.status !== "closed" && chatParticipantKey(chat.countries) === key) : -1;
    if (existingIdx !== -1) {
      if (dropEchoes && built.messages.some((msg) =>
        echoesExistingMessage(msg.text, chats[existingIdx].messages))) {
        logGeneratedChat(built, "dropped — it echoed a message already in the thread");
        dropped += 1;
        continue;
      }
      logGeneratedChat(built, "appended to an existing thread");
      chats = chats.map((chat, index) => (index === existingIdx
        ? { ...chat, messages: [...chat.messages, ...stamp(built.messages)] }
        : chat));
      continue;
    }
    const createdIdx = key ? created.findIndex((chat) => chatParticipantKey(chat.countries) === key) : -1;
    if (createdIdx !== -1) {
      logGeneratedChat(built, "merged into another note from the same turn");
      created[createdIdx] = { ...created[createdIdx], messages: [...created[createdIdx].messages, ...stamp(built.messages)] };
      continue;
    }
    logGeneratedChat(built, "opened a new thread");
    created.push({ ...built, messages: stamp(built.messages) });
  }

  const result = [...created, ...chats];
  // Non-enumerable so this never rides along into a JSON write of the chats.
  Object.defineProperty(result, "dropped", { value: dropped, enumerable: false });
  return result;
};

// The semantic pass answers one resolution per item; a RESOLVED answer must
// carry ids, and no index may be answered twice.
const validateGeographyResolution = (candidate) => {
  const seen = new Set();
  for (let index = 0; index < normalizeArray(candidate?.resolutions).length; index += 1) {
    const resolution = candidate.resolutions[index];
    const itemIndex = Number(resolution?.index);
    if (seen.has(itemIndex)) return `$.resolutions contains duplicate index ${itemIndex}.`;
    seen.add(itemIndex);
    if (normalizeString(resolution?.status).toUpperCase() === "RESOLVED" && normalizeArray(resolution?.regionIds).length === 0) {
      return `$.resolutions[${index}].regionIds must contain at least one id when status is RESOLVED.`;
    }
  }
  return "";
};

const GEOGRAPHY_RESOLVER_BATCH_SIZE = 6;
const GEOGRAPHY_RESOLVER_MAX_CANDIDATES = 140;
const GEOGRAPHY_RESOLVER_MAX_AREA_REGIONS = 12;
const IMPLICIT_WHOLE_COUNTRY_LIMIT = 3;

const resolveRegionTransfers = async (containers, world, {
  ownershipMode = "sovereignty",
  enforceNarratedCityCoverage = false,
} = {}) => {
  // Phase 8B.2.10: resolve against the geography that is ACTUALLY rendered for
  // this scenario. loadRegionCatalog() is intentionally broad and may contain
  // stock GADM rows alongside custom/historical scenario rows; letting those two
  // corpora compete is what made friendly names such as "Masovia" capable of
  // pointing at a real-but-wrong province.
  //
  // The current regionsGeojson is the map truth. Use it as the primary corpus
  // whenever it exists, retaining stock catalog data only as a compatibility
  // fallback for maps that do not expose rendered region features.
  const [mergedCatalog, renderedRegionsGeojson] = await Promise.all([
    loadRegionCatalog().catch(() => []),
    readJson(JSON_URLS.regionsGeojson, { defaultValue: null, force: true }).catch(() => null),
  ]);

  const renderedFeatures = normalizeArray(renderedRegionsGeojson?.features);
  const renderedCatalog = renderedFeatures
    .map((feature) => {
      const props = feature?.properties ?? {};
      const id = normalizeString(
        props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id,
      );
      const name = normalizeString(
        props.name ?? props.NAME_1 ?? props.Name ?? props.regionName,
      );
      if (!id || !name) return null;

      const countryCode = normalizeString(
        props.gid0 ?? props.GID_0 ?? props.gid_0 ?? props.countryCode,
      );
      const country = normalizeString(
        props.owner ??
        props.COUNTRY ??
        props.Country ??
        props.country ??
        toCountryName(countryCode) ??
        "",
      );

      return {
        id,
        name,
        country,
        countryCode,
        geometry: feature?.geometry ?? null,
        aliases: [
          props.sourceBaseRegionName,
          props.sourceBaseRegionId,
          props.NAME_1,
          props.VARNAME_1,
        ].map(normalizeString).filter(Boolean),
      };
    })
    .filter(Boolean);

  const catalog = renderedCatalog.length > 0 ? renderedCatalog : mergedCatalog;

  // Without a catalog we cannot tell a good id from a bad one, and dropping real
  // transfers would be worse than phantom keys — leave the payload alone.
  if (catalog.length === 0) return [];

  const byId = new Map();
  const byName = new Map();
  const byAliasId = new Map();

  const addNameAlias = (token, region) => {
    const key = regionKey(token);
    if (!key) return;
    const bucket = byName.get(key);
    if (bucket) {
      if (!bucket.some((entry) => entry.id === region.id)) bucket.push(region);
    } else {
      byName.set(key, [region]);
    }
  };

  const addIdAlias = (token, region) => {
    const key = normalizeString(token);
    if (!key || key === region.id) return;
    const bucket = byAliasId.get(key);
    if (bucket) {
      if (!bucket.some((entry) => entry.id === region.id)) bucket.push(region);
    } else {
      byAliasId.set(key, [region]);
    }
  };

  for (const region of catalog) {
    byId.set(region.id, region);
    addNameAlias(region.name, region);
    for (const alias of normalizeArray(region.aliases)) {
      addNameAlias(alias, region);
      addIdAlias(alias, region);
    }
  }

  const worldState = normalizeWorldState(world);
  const controlOwners = worldState.regionOwnershipOverrides;
  const sovereigntyOwners = worldState.regionSovereigntyOverrides || {};

  // save-aware owner matching. the old resolver only understood explicit aliases,
  // which meant "Bulgaria" could have ZERO candidate regions while the actual map
  // was owned by "Kingdom of Bulgaria". that is precisely the phantom-country mess
  // polityIdentity.js exists to stop.
  const ownerAlias = new Map();
  for (const [token, entry] of Object.entries(worldState.polityOverrides ?? {})) {
    const canonical = regionKey(token);
    if (!canonical) continue;
    ownerAlias.set(canonical, canonical);
    const displayName = regionKey(entry?.name);
    if (displayName) ownerAlias.set(displayName, canonical);
    for (const alias of entry?.aliases ?? []) {
      const aliasKey = regionKey(alias);
      if (aliasKey) ownerAlias.set(aliasKey, canonical);
    }
  }

  const resolveOwnerName = (token) => {
    const raw = toCountryName(normalizeString(token));
    if (!raw) return "";
    const resolution = resolvePolityIdentity(raw, worldState, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    return resolution.resolved || raw;
  };

  const canonicalOwnerKey = (token) => {
    const key = regionKey(resolveOwnerName(token));
    return ownerAlias.get(key) ?? key;
  };

  const ownerKeyOf = (regionId) => {
    if (ownershipMode === "sovereignty") {
      const sovereign = toCountryName(normalizeString(sovereigntyOwners[regionId]));
      if (sovereign) return canonicalOwnerKey(sovereign);
    }

    const controller = toCountryName(normalizeString(controlOwners[regionId]));
    if (controller) return canonicalOwnerKey(controller);

    // First mutation of a stock region has no runtime override yet. The scenario
    // catalog is therefore the fallback legal owner/controller.
    const region = byId.get(regionId);
    return canonicalOwnerKey(region?.country || toCountryName(region?.countryCode) || "");
  };

  const regionsOwnedBy = (ownerToken) => {
    const key = canonicalOwnerKey(ownerToken);
    if (!key) return [];
    return catalog.filter((region) => ownerKeyOf(region.id) === key);
  };

  // Phase 8B.2.9: city-grounded territory operations must follow the ACTUAL
  // rendered scenario geometry, not a historically plausible region label. A
  // 1915 event may say "Warsaw and Masovia", while this scenario's Warsaw marker
  // is physically inside the map region "Mazowieckie" and a different region is
  // literally named "Masovia". Exact-name matching alone therefore can be wrong.
  //
  // Custom/era scenarios already carry both authoritative city points and region
  // polygons. Use those assets deterministically before accepting a friendly
  // region-name match. This keeps the geography decision in map truth rather than
  // asking the model to guess which similar historical label the scenario author
  // meant. Pure stock maps keep the existing resolver path.
  const pointInRing = ([x, y], ring) => {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      const xi = Number(a?.[0]);
      const yi = Number(a?.[1]);
      const xj = Number(b?.[0]);
      const yj = Number(b?.[1]);
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const crosses = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  };

  const pointInPolygonCoordinates = (point, polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    if (!pointInRing(point, polygon[0])) return false;
    // Holes negate the outer-ring hit.
    for (let index = 1; index < polygon.length; index += 1) {
      if (pointInRing(point, polygon[index])) return false;
    }
    return true;
  };

  const pointInGeometry = (point, geometry) => {
    if (!Array.isArray(point) || point.length < 2 || !geometry) return false;
    if (geometry.type === "Polygon") {
      return pointInPolygonCoordinates(point, geometry.coordinates);
    }
    if (geometry.type === "MultiPolygon") {
      return normalizeArray(geometry.coordinates)
        .some((polygon) => pointInPolygonCoordinates(point, polygon));
    }
    return false;
  };

  let cityAnchorContext = null;
  if (worldState.customCities) {
    try {
      const citiesGeojson = await readJson(
        JSON_URLS.citiesGeojson,
        { defaultValue: null, force: true },
      ).catch(() => null);

      const regionGeometryById = new Map();
      for (const region of catalog) {
        if (region?.id && region?.geometry) regionGeometryById.set(region.id, region.geometry);
      }

      // Compatibility fallback for a map whose primary catalog came from
      // loadRegionCatalog() rather than rendered features.
      if (regionGeometryById.size === 0) {
        for (const feature of renderedFeatures) {
          const props = feature?.properties ?? {};
          const id = normalizeString(
            props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id,
          );
          if (id && feature?.geometry) regionGeometryById.set(id, feature.geometry);
        }
      }

      const cities = normalizeArray(citiesGeojson?.features)
        .map((feature) => {
          const props = feature?.properties ?? {};
          const coordinates = feature?.geometry?.type === "Point"
            ? feature.geometry.coordinates
            : null;
          const name = normalizeString(props.city || props.name);
          const aliases = new Set([name]);
          const renamed = normalizeString(worldState.cityRenames?.[name.toLowerCase()]);
          if (renamed) aliases.add(renamed);
          return {
            aliases: [...aliases].filter(Boolean),
            coordinates,
            name,
          };
        })
        .filter((city) => city.name && Array.isArray(city.coordinates) && city.coordinates.length >= 2);

      if (cities.length && regionGeometryById.size) {
        cityAnchorContext = { cities, regionGeometryById };
      }
    } catch (error) {
      console.warn("[geo resolver] custom city/region anchor data unavailable; using normal geography resolver.", error);
    }
  }

  const mentionedCitiesIn = (text) => {
    if (!cityAnchorContext) return [];
    const haystack = ` ${regionKey(text)} `;
    if (!haystack.trim()) return [];
    const matches = [];
    for (const city of cityAnchorContext.cities) {
      const matched = city.aliases.some((alias) => {
        const key = regionKey(alias);
        return key.length >= 3 && haystack.includes(` ${key} `);
      });
      if (matched) matches.push(city);
    }
    return matches;
  };

  const containingRegionIdsForCity = (city, candidates) => {
    if (!cityAnchorContext || !city || !Array.isArray(candidates) || candidates.length === 0) return [];
    const hits = [];
    for (const region of candidates) {
      const geometry = cityAnchorContext.regionGeometryById.get(region.id);
      if (geometry && pointInGeometry(city.coordinates, geometry)) hits.push(region.id);
    }
    return [...new Set(hits)];
  };

  const cityAnchoredRegionId = (transfer, candidates) => {
    if (!cityAnchorContext || !Array.isArray(candidates) || candidates.length === 0) return "";

    // Phase 8B.2.11: city anchoring is intentionally LOCAL to this operation.
    // Never fall through to the whole event description here: one event commonly
    // names several simultaneous captures, and using event-wide prose allowed the
    // Warsaw marker to hijack a perfectly exact "Piotrków" operation.
    const contexts = [
      normalizeString(transfer?.note),
      `${normalizeString(transfer?.regionId)} ${normalizeString(transfer?.regionName)}`,
    ];

    let anchors = [];
    for (const context of contexts) {
      anchors = mentionedCitiesIn(context);
      if (anchors.length) break;
    }
    if (anchors.length === 0) return "";

    const containing = new Set();
    for (const city of anchors) {
      const hits = containingRegionIdsForCity(city, candidates);
      // A city point must identify exactly one losing-side region. Boundary points,
      // overlapping bad geometry, or missing geometry fail safe instead of guessing.
      if (hits.length !== 1) continue;
      containing.add(hits[0]);
    }

    return containing.size === 1 ? [...containing][0] : "";
  };

  // If the event prose explicitly says control is being established/expanded/
  // consolidated in a named city, that city's rendered region must be present in
  // the structured control ops. This catches the exact partial-coverage failure
  // where prose says "Płock, Częstochowa and Warsaw" but the transaction only
  // carries operations for the first two.
  const NARRATED_CONTROL_TARGET_CUE = /\b(?:captur\w*|seiz\w*|conquer\w*|occup(?:y|ies|ied|ation)|overr[au]n\w*|liberat\w*|retak\w*|recaptur\w*|takes?\s+(?:de[- ]?facto\s+)?control|assumes?\s+(?:de[- ]?facto\s+)?control|establish(?:es|ed|ing)?(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control|expand(?:s|ed|ing)?(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control|extend(?:s|ed|ing)?(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control|consolidat(?:e|es|ed|ing)(?:\s+[a-z0-9'’-]+){0,4}\s+(?:de[- ]?facto\s+)?control)\b/i;

  const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const cityClaimedAsControlTarget = (text, city) => {
    const haystack = regionKey(text);
    if (!haystack) return false;

    for (const alias of city.aliases) {
      const key = regionKey(alias);
      if (key.length < 3) continue;
      const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(key)}(?=$|[^a-z0-9])`, "g");
      for (const match of haystack.matchAll(pattern)) {
        const cityIndex = Number(match.index || 0) + normalizeString(match[1]).length;
        const before = haystack.slice(Math.max(0, cityIndex - 220), cityIndex);
        const clause = before.split(/[.!?;\n]/).pop() || before;
        if (NARRATED_CONTROL_TARGET_CUE.test(clause)) return true;
      }
    }

    return false;
  };

  const expandWholeCountry = (transfer) => {
    const target = resolveOwnerName(
      normalizeString(transfer?.regionId) ||
      normalizeString(transfer?.regionName),
    );
    const key = canonicalOwnerKey(target);
    if (!key) return [];

    const toKey = canonicalOwnerKey(transfer?.toCode);
    const owned = catalog.filter((region) => {
      const owner = ownerKeyOf(region.id);
      return owner === key && owner !== toKey;
    });

    return owned.map((region) => ({
      ...transfer,
      fromCode: resolveOwnerName(transfer?.fromCode) || target,
      regionId: region.id,
      regionName: region.name,
      wholeCountry: undefined,
    }));
  };

  const deterministicResolve = (transfer, event) => {
    const requestedId = normalizeString(transfer?.regionId);
    if (byId.has(requestedId)) {
      return requestedId;
    }

    const fromKey = canonicalOwnerKey(transfer?.fromCode);

    const aliasedIds = byAliasId.get(requestedId) ?? [];
    if (aliasedIds.length === 1) return aliasedIds[0].id;
    if (aliasedIds.length > 1 && fromKey) {
      const owned = aliasedIds.filter((region) => ownerKeyOf(region.id) === fromKey);
      if (owned.length === 1) return owned[0].id;
    }
    const ownedCandidates = fromKey ? regionsOwnedBy(transfer?.fromCode) : [];

    // A city explicitly named INSIDE THIS OPERATION may disambiguate a historical
    // or friendly label (e.g. regionId "Masovia" + note "Warsaw"). Crucially this
    // no longer reads the event-wide prose, so another city in the same event
    // cannot hijack an exact rendered region such as Piotrków.
    const anchored = cityAnchoredRegionId(transfer, ownedCandidates);
    if (anchored) return anchored;

    for (const candidate of [transfer?.regionId, transfer?.regionName]) {
      const query = regionKey(candidate);
      if (!query) continue;

      const matches = byName.get(query) ?? [];
      if (matches.length === 1) return matches[0].id;

      if (matches.length > 1 && fromKey) {
        const owned = matches.filter((region) => ownerKeyOf(region.id) === fromKey);
        if (owned.length === 1) return owned[0].id;
      }

      // This is intentionally the LAST deterministic fuzzy-ish rule. Substring
      // matching inside the losing side is safe only when exactly one map region
      // survives. Anything harder belongs to the bounded semantic geography pass.
      if (fromKey && query.length >= 4) {
        const contains = regionsOwnedBy(transfer.fromCode).filter((region) => {
          const name = regionKey(region.name);
          return name.includes(query) || query.includes(name);
        });
        if (contains.length === 1) return contains[0].id;
      }
    }

    return "";
  };

  const pushUniqueTransfer = (target, transfer) => {
    const id = normalizeString(transfer?.regionId);
    const toCode = regionKey(transfer?.toCode);
    if (!id || !toCode) return;

    const duplicate = target.some(
      (entry) =>
        normalizeString(entry?.regionId) === id &&
        regionKey(entry?.toCode) === toCode,
    );

    if (!duplicate) target.push(transfer);
  };

  const unresolved = [];
  const semanticPending = [];
  const deterministicDestinations = new Map();

  for (const [containerIndex, container] of containers.entries()) {
    const { impacts, path, event } = container;
    const transfers = normalizeArray(impacts?.regionTransfers);
    if (transfers.length === 0) continue;

    const resolved = [];
    const destinationByRegion = new Map();
    deterministicDestinations.set(path, destinationByRegion);

    for (const [transferIndex, transfer] of transfers.entries()) {
      if (transfer?.wholeCountry === true) {
        const expanded = expandWholeCountry(transfer);
        if (expanded.length) {
          console.info(
            `[ai] ${path}.regionTransfers expanded whole country ` +
              `"${normalizeString(transfer?.regionId)}" -> ${normalizeString(transfer?.toCode)}: ` +
              `${expanded.length} region(s).`,
          );
          for (const item of expanded) {
            pushUniqueTransfer(resolved, item);
            destinationByRegion.set(item.regionId, regionKey(item.toCode));
          }
          continue;
        }
      }

      const regionId = deterministicResolve(transfer, event);
      if (regionId) {
        const row = byId.get(regionId);
        const normalized = {
          ...transfer,
          regionId,
          // Preview/apply must expose the ACTUAL canonical map region we resolved,
          // not keep an AI-authored historical/friendly label that can hide a bad
          // mapping (e.g. prose says one place while regionId points elsewhere).
          regionName: row?.name || normalizeString(transfer?.regionName) || regionId,
        };
        pushUniqueTransfer(resolved, normalized);
        destinationByRegion.set(regionId, regionKey(transfer?.toCode));
        continue;
      }

      // If a polity name was used as shorthand for a total takeover, preserve the
      // old compatibility behavior. Explicit wholeCountry remains strongly preferred.
      const expanded = expandWholeCountry(transfer);
      if (expanded.length && expanded.length <= IMPLICIT_WHOLE_COUNTRY_LIMIT) {
        console.info(
          `[ai] ${path}.regionTransfers treated "${normalizeString(transfer?.regionId)}" as a small whole ` +
            `country -> ${normalizeString(transfer?.toCode)}: ${expanded.length} region(s).`,
        );
        for (const item of expanded) {
          pushUniqueTransfer(resolved, item);
          destinationByRegion.set(item.regionId, regionKey(item.toCode));
        }
        continue;
      }
      if (expanded.length > IMPLICIT_WHOLE_COUNTRY_LIMIT) {
        unresolved.push({
          label: normalizeString(transfer?.regionName) || normalizeString(transfer?.regionId),
          fromCode: normalizeString(transfer?.fromCode),
          path,
          candidates: regionsOwnedBy(transfer?.fromCode),
          reason: `implicit whole-country expansion would move ${expanded.length} regions; use wholeCountry:true or an exact region`,
        });
        continue;
      }

      const candidates = regionsOwnedBy(transfer?.fromCode);
      const label =
        normalizeString(transfer?.regionName) ||
        normalizeString(transfer?.regionId);

      const record = {
        candidates,
        containerIndex,
        event,
        impacts,
        label,
        path,
        resolved,
        semanticIndex: semanticPending.length,
        transfer,
        transferIndex,
      };

      // No losing-side region set means there is nothing bounded for the semantic
      // resolver to choose from. Do not hand it the whole planet and ask for vibes.
      if (!label || candidates.length === 0) {
        unresolved.push({
          label,
          fromCode: normalizeString(transfer?.fromCode),
          path,
          candidates,
        });
        continue;
      }

      semanticPending.push(record);
    }

    impacts.regionTransfers = resolved;
  }

  const semanticPlans = [];

  for (let offset = 0; offset < semanticPending.length; offset += GEOGRAPHY_RESOLVER_BATCH_SIZE) {
    const batch = semanticPending.slice(offset, offset + GEOGRAPHY_RESOLVER_BATCH_SIZE);

    const items = batch.map((record) => ({
      index: record.semanticIndex,
      sourcePlace: record.label,
      fromCode: resolveOwnerName(record.transfer?.fromCode) || normalizeString(record.transfer?.fromCode),
      toCode: resolveOwnerName(record.transfer?.toCode) || normalizeString(record.transfer?.toCode),
      event: {
        date: normalizeString(record.event?.date),
        title: normalizeString(record.event?.title),
        description:
          normalizeString(record.event?.description) ||
          normalizeString(record.event?.summary),
      },
      candidateRegions: record.candidates
        .slice(0, GEOGRAPHY_RESOLVER_MAX_CANDIDATES)
        .map((region) => ({
          id: region.id,
          name: region.name,
          baseCountry: region.country || "",
        })),
      omittedCandidateCount: Math.max(
        0,
        record.candidates.length - GEOGRAPHY_RESOLVER_MAX_CANDIDATES,
      ),
    }));

    const fallback = () => ({
      resolutions: items.map((item) => ({
        index: item.index,
        status: "UNRESOLVED",
        relation: "UNRESOLVED",
        regionIds: [],
        confidence: 0,
        reason: "Geography resolver unavailable; safe failure.",
      })),
    });

    let payload = fallback();
    let source = "fallback";

    try {
      const response = await runJsonTask("geographyResolver", {
        fallback,
        validatePayload: validateGeographyResolution,
        userMessage:
          "Resolve every supplied unresolved geography item using only its supplied candidateRegions. " +
          "Resolve by REAL geographic meaning, not spelling similarity. Use the event title/description as disambiguating evidence: " +
          "if the event anchors the change on a named city, choose only the candidate region that actually contains that city; the city anchor outranks a merely similar or historically related sourcePlace label. " +
          "historical areas must map to their genuine modern/scenario equivalents, not a similarly named neighboring region. " +
          "If you are not highly certain, return UNRESOLVED rather than guessing. Return exactly one resolution per item index.",
        variables: {
          geographyResolverItems: JSON.stringify(items, null, 2),
        },
      });
      payload = response.payload || payload;
      source = response.generation?.source || "ai";
    } catch (error) {
      console.warn(
        "[geo resolver] semantic geography pass failed; unresolved transfers will fail safe.",
        error,
      );
    }

    const byIndex = new Map(
      normalizeArray(payload?.resolutions).map((resolution) => [
        Number(resolution?.index),
        resolution,
      ]),
    );

    for (const record of batch) {
      const resolution = byIndex.get(record.semanticIndex);
      const relation = normalizeString(resolution?.relation).toUpperCase();
      const status = normalizeString(resolution?.status).toUpperCase();
      const confidence = Number(resolution?.confidence);
      const allowed = new Set(record.candidates.map((region) => region.id));
      const regionIds = [
        ...new Set(
          normalizeArray(resolution?.regionIds)
            .map((id) => normalizeString(id))
            .filter(Boolean),
        ),
      ];

      const singleRegionRelation =
        relation === "REGION_ALIAS" ||
        relation === "CITY_CONTAINING_REGION";
      const areaRelation =
        relation === "HISTORICAL_AREA" ||
        relation === "TRANSLATED_AREA";
      // historical/translated areas often span several real map regions. 0.95 is
      // already a very strong answer once every returned id is deterministically
      // proven to belong to the losing side's bounded candidate set; demanding
      // 0.96 was just enough to throw away correct mappings like Southern Dobruja.
      const threshold = areaRelation ? 0.95 : 0.93;

      const valid =
        status === "RESOLVED" &&
        Number.isFinite(confidence) &&
        confidence >= threshold &&
        regionIds.length > 0 &&
        regionIds.every((id) => allowed.has(id)) &&
        (!singleRegionRelation || regionIds.length === 1) &&
        (!areaRelation || regionIds.length <= GEOGRAPHY_RESOLVER_MAX_AREA_REGIONS) &&
        (singleRegionRelation || areaRelation);

      if (!valid) {
        unresolved.push({
          label: record.label,
          fromCode: normalizeString(record.transfer?.fromCode),
          path: record.path,
          candidates: record.candidates,
        });

        console.warn(
          `[geo resolver] ${record.path}.regionTransfers[${record.transferIndex}] ` +
            `"${record.label}" remains unresolved; no safe candidate mapping was accepted.`,
          {
            source,
            status,
            relation,
            confidence,
            regionIds,
          },
        );
        continue;
      }

      semanticPlans.push({
        ...record,
        confidence,
        relation,
        regionIds,
        source,
      });
    }
  }

  // A single event cannot semantically resolve the same region to two different
  // recipients. This catches vague split-settlement wording such as two transfers
  // both saying merely "Macedonia" and prevents the resolver from awarding the
  // same province twice based on historical vibes.
  const conflictingPlans = new Set();
  const semanticDestinations = new Map();

  for (const plan of semanticPlans) {
    const deterministic = deterministicDestinations.get(plan.path) || new Map();

    for (const regionId of plan.regionIds) {
      const destination = regionKey(plan.transfer?.toCode);
      const deterministicDestination = deterministic.get(regionId);

      if (
        deterministicDestination &&
        deterministicDestination !== destination
      ) {
        conflictingPlans.add(plan);
        continue;
      }

      const key = `${plan.path}|${regionId}`;
      const existing = semanticDestinations.get(key);
      if (existing && existing.destination !== destination) {
        conflictingPlans.add(plan);
        conflictingPlans.add(existing.plan);
      } else if (!existing) {
        semanticDestinations.set(key, {
          destination,
          plan,
        });
      }
    }
  }

  for (const plan of semanticPlans) {
    if (conflictingPlans.has(plan)) {
      unresolved.push({
        label: plan.label,
        fromCode: normalizeString(plan.transfer?.fromCode),
        path: plan.path,
        candidates: plan.candidates,
      });
      console.warn(
        `[geo resolver] rejected ambiguous cross-recipient mapping for "${plan.label}" in ${plan.path}; ` +
          "the same map region was claimed by incompatible transfers in one event.",
      );
      continue;
    }

    for (const regionId of plan.regionIds) {
      const row = byId.get(regionId);
      if (!row) continue;
      pushUniqueTransfer(plan.resolved, {
        ...plan.transfer,
        regionId,
        regionName: row.name,
        wholeCountry: undefined,
      });
    }

    console.info(
      `[geo resolver] "${plan.label}" -> ` +
        `${plan.regionIds.map((id) => `${byId.get(id)?.name || id} (${id})`).join(", ")} ` +
        `(${plan.relation.toLowerCase()}, ${plan.confidence.toFixed(2)}, ${plan.source}).`,
    );
  }

  if (enforceNarratedCityCoverage && cityAnchorContext) {
    for (const { impacts, path, event } of containers) {
      const controlOps = normalizeArray(impacts?.regionTransfers)
        .filter((entry) => normalizeString(entry?.op).toLowerCase() === "control");
      if (controlOps.length === 0) continue;

      const eventText = [
        normalizeString(event?.title),
        normalizeString(event?.description) || normalizeString(event?.summary),
      ].filter(Boolean).join(". ");
      if (!eventText) continue;

      const resolvedRegionIds = new Set(
        controlOps.map((entry) => normalizeString(entry?.regionId)).filter(Boolean),
      );

      for (const city of cityAnchorContext.cities) {
        if (!cityClaimedAsControlTarget(eventText, city)) continue;

        const hits = containingRegionIdsForCity(city, catalog);
        if (hits.length !== 1) continue;
        const regionId = hits[0];
        if (resolvedRegionIds.has(regionId)) continue;

        const row = byId.get(regionId);
        unresolved.push({
          kind: "narrated-city-coverage",
          label: city.name,
          cityName: city.name,
          regionId,
          regionName: row?.name || regionId,
          fromCode: "",
          path,
          candidates: row ? [row] : [],
        });

        console.warn(
          `[geo resolver] ${path}.regionControlOps narration claims control changes in ` +
            `${city.name}, but no control op targets its rendered region ` +
            `${row?.name || regionId} (${regionId}).`,
        );
      }
    }
  }

  // Claims name regions the same way transfers do — an exact id when the model
  // has one, otherwise a plain name — but a claim is never worth a retry or a
  // failed turn: it moves no border, so one that matches nothing is dropped with
  // a note rather than reported back. A name that repeats across countries is
  // settled by preferring a region the claimant does NOT hold, since a claim is
  // by definition on land its author lacks.
  for (const { impacts, path } of containers) {
    const claims = normalizeArray(impacts?.regionClaims);
    if (claims.length === 0) continue;
    const kept = [];
    for (const claim of claims) {
      if (byId.has(normalizeString(claim?.regionId))) {
        kept.push(claim);
        continue;
      }
      const claimantKey = canonicalOwnerKey(toCountryName(claim?.claimantCode));
      let regionId = "";
      for (const candidate of [claim?.regionId, claim?.regionName]) {
        const query = regionKey(candidate);
        if (!query) continue;
        const matches = byName.get(query) ?? [];
        const pick = matches.length === 1
          ? matches
          : matches.filter((region) => ownerKeyOf(region.id) !== claimantKey);
        if (pick.length === 1) {
          regionId = pick[0].id;
          break;
        }
      }
      if (!regionId) {
        console.warn(
          `[ai] ${path}.regionClaims dropped "${normalizeString(claim?.regionId)}" for ` +
            `${normalizeString(claim?.claimantCode)}: no single map region matches that id or name.`,
        );
        continue;
      }
      claim.regionId = regionId;
      kept.push(claim);
    }
    impacts.regionClaims = kept;
  }
  return unresolved;
};

// regionControlOps use the SAME geography vocabulary and bounded resolver as
// legal transfers, but they are bounded by current DE-FACTO control instead of
// sovereignty. Proxy them through the proven resolver rather than maintain two
// subtly different historical-geography engines.
const resolveRegionControlOps = async (containers, world) => {
  const proxyContainers = containers.map((container) => {
    const proxies = normalizeArray(container?.impacts?.regionControlOps).map((op, index) => {
      const realToCode = normalizeString(op?.toCode);
      const proxyToCode =
        realToCode ||
        normalizeString(op?.actorCode) ||
        normalizeString(op?.claimantCode) ||
        normalizeString(op?.fromCode) ||
        "Unresolved polity";

      return {
        ...cloneValue(op),
        toCode: proxyToCode,
        __controlOpIndex: index,
        __hadRealToCode: Boolean(realToCode),
      };
    });

    return {
      ...container,
      impacts: { regionTransfers: proxies },
    };
  });

  const unresolved = await resolveRegionTransfers(proxyContainers, world, {
    ownershipMode: "control",
    enforceNarratedCityCoverage: true,
  });

  for (let index = 0; index < containers.length; index += 1) {
    const targetImpacts = containers[index]?.impacts;
    if (!targetImpacts || typeof targetImpacts !== "object") continue;

    targetImpacts.regionControlOps = normalizeArray(proxyContainers[index]?.impacts?.regionTransfers)
      .map((entry) => {
        const next = { ...entry };
        delete next.__controlOpIndex;
        const hadRealToCode = next.__hadRealToCode === true;
        delete next.__hadRealToCode;
        if (!hadRealToCode && next.op !== "control") delete next.toCode;
        return next;
      });
  }

  return unresolved;
};

// One retry's worth of corrective vocabulary: the exact regions the losing side
// currently owns, so a model that wrote "Pomerania" can resend the same answer
// with the real names/ids ("Pomorskie (POL.11_1)") instead of losing the map
// change entirely. The lists stay small — one owner's regions, not the world's.
const buildTransferFeedback = (unresolved) => {
  const lines = [];
  for (const entry of unresolved.slice(0, 3)) {
    const target = entry.label || "(blank)";
    if (entry.candidates.length > 0) {
      const listed = entry.candidates.slice(0, 40)
        .map((region) => `${region.name} (${region.id})`)
        .join(", ");
      const more = entry.candidates.length > 40 ? `, +${entry.candidates.length - 40} more` : "";
      lines.push(
        `${entry.path}.regionTransfers: no map region matches "${target}". ` +
          `Regions currently owned by ${entry.fromCode}: ${listed}${more}.`,
      );
    } else {
      lines.push(
        `${entry.path}.regionTransfers: no map region matches "${target}"` +
          `${entry.fromCode ? ` and no regions are recorded for owner "${entry.fromCode}"` : ""}. ` +
          `Use the region's exact in-game name in regionId, and set fromCode to the region's current owner so the engine can locate it.`,
      );
    }
  }
  lines.push(
    "Resend the same response with these regionTransfers corrected to exact regionId values (or exact names) from the lists above; drop a transfer only if no listed region matches your intent.",
  );
  return lines.join("\n");
};

const buildControlFeedback = (unresolved) => {
  const coverage = normalizeArray(unresolved)
    .filter((entry) => entry?.kind === "narrated-city-coverage");
  const ordinary = normalizeArray(unresolved)
    .filter((entry) => entry?.kind !== "narrated-city-coverage");

  const chunks = [];
  if (ordinary.length > 0) {
    chunks.push(
      buildTransferFeedback(ordinary)
        .replaceAll(".regionTransfers", ".regionControlOps")
        .replaceAll("these regionTransfers", "these regionControlOps")
        .replaceAll("applied transfer", "applied control operation")
        .replaceAll("currently owned by", "currently controlled by")
        .replaceAll("current owner", "current controller")
        .replaceAll("drop a transfer", "drop a control operation"),
    );
  }

  for (const entry of coverage) {
    chunks.push(
      `${entry.path}.regionControlOps: event narration explicitly says de-facto control changes in ` +
        `${entry.cityName || entry.label}, which the rendered map places in ` +
        `${entry.regionName} (${entry.regionId}), but no control operation targets that region. ` +
        `Add the matching control operation using regionId "${entry.regionId}" and regionName ` +
        `"${entry.regionName}" with the correct current controller/fromCode and new controller/toCode, ` +
        `or revise the event prose so it does not claim control changed there.`,
    );
  }

  if (coverage.length > 0) {
    chunks.push(
      "Resend the same transaction with every narrated city/territory control change represented by a matching regionControlOps entry. Do not silently drop a named control change merely because another nearby region was resolved successfully.",
    );
  }

  return chunks.join("\n");
};

// Also canonicalizes region ids in place (see resolveRegionTransfers): runJsonTask
// hands the accepted payload straight to the caller, and a payload is only accepted
// once this returns clean, so every applied transfer has passed through here.
//
// strictTransfers: when set, an unresolvable transfer FAILS validation with the
// losing owner's real region list, so runJsonTask's retry gives the model the
// vocabulary to fix its own answer. Callers set it on every attempt EXCEPT the
// last (runJsonTask passes finalAttempt to validatePayload) — the final answer
// must never be rejected into the canned fallback over a name.

// An AI-opened chat must arrive with a reason and a first message — the
// initiating polity speaks first. Empty string when the entry is fine.
const validateChatOpener = (chatLike, path) => {
  const hasMessages = Array.isArray(chatLike?.messages) && chatLike.messages.length > 0;
  if (!normalizeString(chatLike?.title)) {
    return `${path}.title must name the purpose of the chat.`;
  }
  if (!hasMessages && !normalizeString(chatLike?.openingMessage)) {
    return `${path}.openingMessage must carry the initiating polity's first message - never open an empty chat.`;
  }
  return "";
};

// Event text that claims control changed hands (capture verbs) or that legal
// sovereignty moved (cession, annexation, treaty). Word-boundary anchored so
// "preoccupied" never matches; deliberately narrow so a defensive battle that
// moved no borders never trips the reluctance guards below.
const CONTROL_CHANGE_LANGUAGE = /\b(captur\w*|seiz\w*|conquer\w*|occup(?:y|ies|ied|ation)|overr[au]n|liberat\w*|retak\w*|retaken|recaptur\w*|fell to|falls? to|takes? control|assumes? control)\b/i;
const LEGAL_TRANSFER_LANGUAGE = /\b(annex\w*|cedes?|ceded|ceding|cession|sovereignty (?:passes|transfers?|is transferred)|treaty transfer|formal(?:ly)? transfer(?:red)?|incorporat\w*|unification|territorial award|sold|sale of territory)\b/i;

// Strict/salvage discipline, the same contract clampTimelineDates follows:
// the FIRST attempt returns corrective errors so the model can fix its own
// answer; the SECOND attempt never rejects a finished generation — invalid
// ops are DROPPED in place instead ("$.events[4].impacts.unitOps[0].unitId
// does not identify an existing unit" used to trash whole good turns to the
// canned fallback over one stale id).
// What to tell the model when a projectOp names something that is not on the
// board. Same shape as buildTransferFeedback: state the problem, then list the
// real vocabulary, so the single retry has what it needs instead of guessing
// again. Capped because a long board would crowd out the rest of the retry.
const buildProjectFeedback = (operationPath, operation, knownProjects) => {
  const named = normalizeString(operation?.projectId || operation?.id || operation?.name || operation?.project);
  const names = [...new Set(knownProjects.values())].slice(0, 24);
  if (names.length === 0) {
    return `${operationPath} changes "${named}", but no project by that name exists and the board is empty. `
      + `Open it first with {"op":"create","name":"...","summary":"..."}, or drop the op.`;
  }
  return `${operationPath} changes "${named}", which is not on the board. `
    + `Use one of these exact names: ${names.map((name) => `"${name}"`).join(", ")}. `
    + `If this is genuinely a new effort, open it with {"op":"create","name":"...","summary":"..."} instead.`;
};

// captureGuard: the reluctance check below is for turn narration; an administrative
// GM correction may legitimately mention an annexation without moving a border.
export const validateGeneratedWorldChanges = async (candidate, world, { strictTransfers = false, captureGuard = true } = {}) => {
  const strict = strictTransfers;
  const containers = Array.isArray(candidate?.events)
    ? candidate.events.map((event, index) => ({ event, impacts: event?.impacts, path: `$.events[${index}].impacts` }))
    : [{
        event: { date: "", title: "Game master intervention", description: normalizeString(candidate?.summary) },
        impacts: candidate?.impacts,
        path: "$.impacts",
      }];
  // Every project an op could legitimately address: what is already on the
  // board, plus anything a create earlier in this same payload opens.
  const knownProjects = new Map();
  for (const project of normalizeArray(world?.projects)) {
    const name = normalizeString(project?.name);
    if (!name) continue;
    knownProjects.set(name.toLowerCase(), name);
    if (normalizeString(project?.id)) knownProjects.set(normalizeString(project.id), name);
  }

  const unresolvedTransfers = await resolveRegionTransfers(containers, world, { ownershipMode: "sovereignty" });
  if (strict && unresolvedTransfers.length > 0) {
    return buildTransferFeedback(unresolvedTransfers);
  }
  const unresolvedControlOps = await resolveRegionControlOps(containers, world);
  if (strict && unresolvedControlOps.length > 0) {
    return buildControlFeedback(unresolvedControlOps);
  }
  // Reluctance guard (strict attempt only): events that NARRATE a capture while
  // the whole payload ships ZERO regionTransfers are the recurring field report
  // — "two turns of invasions and not a single province transferred". One
  // corrective retry asks the model to reconcile narration with the map (or to
  // strip the capture language if genuinely nothing changed hands). English
  // verb heuristic only — a non-English game just never gets this extra nudge —
  // and the final attempt always passes through salvage, so it can never cost a
  // finished turn. Only for event-shaped payloads: a $.impacts container has no
  // narration to check.
  if (strict && captureGuard && Array.isArray(candidate?.events)) {
    const totalTransfers = containers.reduce(
      (sum, { impacts }) => sum + normalizeArray(impacts?.regionTransfers).length,
      0,
    );
    const totalControlOps = containers.reduce(
      (sum, { impacts }) => sum + normalizeArray(impacts?.regionControlOps).length,
      0,
    );
    const text = (event) => `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
    if (totalControlOps === 0) {
      const controlEvent = candidate.events.find((event) =>
        CONTROL_CHANGE_LANGUAGE.test(text(event)) && !LEGAL_TRANSFER_LANGUAGE.test(text(event)));
      if (controlEvent) {
        return `Your events describe a wartime capture/occupation/control change (e.g. "${normalizeString(controlEvent.title) || "an event"}") but the payload contains ZERO impacts.regionControlOps. Either add the matching control operations (op=control for a capture/occupation/liberation, op=contest while a region is actively disputed; regionId = the exact region id or the grounded place wording, fromCode = the current controller) or rewrite the event so that no control changed hands.`;
      }
    }
    if (totalTransfers === 0) {
      const legalEvent = candidate.events.find((event) => LEGAL_TRANSFER_LANGUAGE.test(text(event)));
      if (legalEvent) {
        return `Your events describe a legal territorial settlement (e.g. "${normalizeString(legalEvent.title) || "an event"}") but the payload contains ZERO impacts.regionTransfers. Either add the matching legal transfers (one per region, or wholeCountry:true for a total annexation/unification) or rewrite the event so that no sovereignty changed.`;
      }
    }
  }
  const unitIds = new Set(normalizeWorldState(world).units.map((unit) => normalizeString(unit.id)).filter(Boolean));
  const generatedPolities = [];
  for (const { impacts } of containers) generatedPolities.push(...normalizeArray(impacts?.polityChanges));

  for (const { impacts, path } of containers) {
    const keptChats = [];
    for (let index = 0; index < normalizeArray(impacts?.createdChats).length; index += 1) {
      const createdChat = impacts.createdChats[index];
      const countries = await resolveInvitees(createdChat?.countries, world, generatedPolities);
      if (countries.length === 0) {
        if (strict) return `${path}.createdChats[${index}].countries must contain at least one known polity.`;
        continue; // salvage: drop the unresolvable chat, keep the turn
      }
      if (strict) {
        const chatError = validateChatOpener(createdChat, `${path}.createdChats[${index}]`);
        if (chatError) return chatError;
      }
      keptChats.push(createdChat);
    }
    if (impacts && Array.isArray(impacts.createdChats)) impacts.createdChats = keptChats;

    const keptUnitOps = [];
    for (let index = 0; index < normalizeArray(impacts?.unitOps).length; index += 1) {
      const operation = impacts.unitOps[index];
      const operationPath = `${path}.unitOps[${index}]`;
      if (operation.op === "spawn") {
        if (!normalizeString(operation.unit?.name) || !normalizeString(operation.unit?.ownerCode)) {
          if (strict) return `${operationPath}.unit must have nonblank name and ownerCode values.`;
          continue;
        }
        const spawnedId = normalizeString(operation.unit?.id);
        if (spawnedId && unitIds.has(spawnedId)) {
          if (strict) return `${operationPath}.unit.id duplicates an existing unit.`;
          delete operation.unit.id; // salvage: let normalization mint a fresh id
        } else if (spawnedId) {
          unitIds.add(spawnedId);
        }
        keptUnitOps.push(operation);
        continue;
      }

      const unitId = normalizeString(operation.unitId);
      if (!unitId) {
        if (strict) return `${operationPath}.unitId must not be blank.`;
        continue;
      }
      if (!unitIds.has(unitId)) {
        if (strict) return `${operationPath}.unitId does not identify an existing unit.`;
        continue; // salvage: drop the op aimed at a unit that no longer exists
      }
      if (operation.op === "remove" || (operation.op === "strength" && operation.strength === 0)) unitIds.delete(unitId);
      keptUnitOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.unitOps)) impacts.unitOps = keptUnitOps;

    // Marker ops that would be silently dropped by normalization instead fail
    // the strict attempt, so the retry tells the model what was missing.
    const keptMarkerOps = [];
    for (let index = 0; index < normalizeArray(impacts?.markerOps).length; index += 1) {
      const operation = impacts.markerOps[index];
      const operationPath = `${path}.markerOps[${index}]`;
      const op = normalizeString(operation?.op).toLowerCase();
      if (op === "build" || op === "found") {
        const marker = operation.marker ?? operation;
        if (!normalizeString(marker?.name)) {
          if (strict) return `${operationPath}.marker.name must not be blank.`;
          continue;
        }
        if (!Number.isFinite(Number(marker?.lng)) || !Number.isFinite(Number(marker?.lat))) {
          if (strict) return `${operationPath}.marker must carry numeric lng and lat coordinates.`;
          continue;
        }
      } else if (op === "remove" || op === "destroy") {
        if (!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) {
          if (strict) return `${operationPath} must carry the name (or markerId) of the structure to remove.`;
          continue;
        }
      }
      keptMarkerOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.markerOps)) impacts.markerOps = keptMarkerOps;

    // Project ops aimed at nothing. applyProjectOps drops these silently (which
    // is the right runtime behaviour - a phantom project conjured from a typo is
    // worse than a missed update), but silence is exactly what makes the failure
    // invisible: the event narrates a programme advancing and the board never
    // moves. On the strict attempt, hand the model the real board so the retry
    // can use the right name; on the final attempt, drop the op and keep the turn.
    const keptProjectOps = [];
    for (let index = 0; index < normalizeArray(impacts?.projectOps).length; index += 1) {
      const operation = impacts.projectOps[index];
      const operationPath = `${path}.projectOps[${index}]`;
      const op = normalizeString(operation?.op).toLowerCase();

      if (["create", "start", "launch", "open", "add"].includes(op)) {
        const project = operation.project ?? operation;
        if (!normalizeString(project?.name)) {
          if (strict) return `${operationPath} must name the project it is opening.`;
          continue;
        }
        // A create is also how a project first appears, so remember it: a later
        // op in the SAME turn may legitimately reference something opened above.
        knownProjects.set(normalizeString(project.name).toLowerCase(), normalizeString(project.name));
        if (normalizeString(project.id)) knownProjects.set(normalizeString(project.id), normalizeString(project.name));
        keptProjectOps.push(operation);
        continue;
      }

      const target = normalizeString(operation?.projectId || operation?.id).toLowerCase()
        || normalizeString(operation?.name || operation?.project).toLowerCase();
      if (!target) {
        if (strict) return `${operationPath} must carry the name (or id) of the project it changes.`;
        continue;
      }
      if (!knownProjects.has(target)) {
        if (strict) return buildProjectFeedback(operationPath, operation, knownProjects);
        continue;
      }
      keptProjectOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.projectOps)) impacts.projectOps = keptProjectOps;
  }

  // Unprompted outreach chats (top-level, not tied to an event) need real
  // participants exactly like createdChats do.
  if (Array.isArray(candidate?.diplomaticOutreach)) {
    const keptOutreach = [];
    for (let index = 0; index < candidate.diplomaticOutreach.length; index += 1) {
      const countries = await resolveInvitees(
        candidate.diplomaticOutreach[index]?.countries,
        world,
        generatedPolities,
      );
      if (countries.length === 0) {
        if (strict) return `$.diplomaticOutreach[${index}].countries must contain at least one known polity.`;
        continue;
      }
      if (strict) {
        const chatError = validateChatOpener(candidate.diplomaticOutreach[index], `$.diplomaticOutreach[${index}]`);
        if (chatError) return chatError;
      }
      keptOutreach.push(candidate.diplomaticOutreach[index]);
    }
    candidate.diplomaticOutreach = keptOutreach;
  }

  return "";
};

const fallbackJumpSimulation = async ({ bundle, days, mode, targetDate }) => {
  const plannedActions = normalizeActions(bundle.actions).filter((action) => action.status === "planned");
  const firstThreeActions = plannedActions.slice(0, 3);
  const events = [];

  // Ancient/FMG scenarios may use textual or BCE dates. Only perform calendar
  // arithmetic on strict Gregorian dates; otherwise preserve the scenario text.
  const advanceGameDate = (dayCount) =>
    addIsoDays(bundle.game.gameDate, dayCount) || normalizeString(bundle.game.gameDate);

  if (firstThreeActions.length > 0) {
    firstThreeActions.forEach((action, index) => {
      const eventDate = advanceGameDate(
        Math.max(1, Math.round(((index + 1) / (firstThreeActions.length + 1)) * Math.max(days, 1))),
      );

      events.push({
        date: eventDate,
        description:
          action.kind === "chat"
            ? `${bundle.game.country} opens a deliberate diplomatic channel tied to ${action.title.toLowerCase()}, forcing counterparts to weigh terms instead of guessing intent.`
            : `${bundle.game.country} begins implementing ${action.title.toLowerCase()}, producing immediate administrative and political consequences that other powers start to notice.`,
        impacts: {
          createdChats:
            action.kind === "chat" && action.invitees.length > 0 && action.chatStarter
              ? [
                  {
                    countries: action.invitees,
                    openingMessage: action.chatStarter,
                    speaker: bundle.game.country,
                    title: action.title,
                  },
                ]
              : [],
          polityChanges: [],
          regionTransfers: [],
        },
        importance: index === firstThreeActions.length - 1 ? "major" : "minor",
        kind: action.kind === "chat" ? "diplomacy" : "player",
        notable: index === firstThreeActions.length - 1,
        playerRelated: true,
        title:
          action.kind === "chat"
            ? `${bundle.game.country} opens a diplomatic channel`
            : `${bundle.game.country} acts on ${action.title.toLowerCase()}`,
      });
    });
  } else {
    const midpoint = advanceGameDate(Math.max(1, Math.round(Math.max(days, 1) / 2)));
    events.push({
      date: midpoint,
      description: `Foreign ministries and general staffs keep adjusting to the current balance of power while ${bundle.game.country} gathers its next move.`,
      impacts: {
        createdChats: [],
        polityChanges: [],
        regionTransfers: [],
      },
      importance: mode === "auto" ? "major" : "minor",
      kind: "world",
      notable: mode === "auto",
      playerRelated: false,
      title: "The international balance remains in motion",
    });
  }

  const lastEvent = events.at(-1) ?? null;
  const catalyst = lastEvent
    ? {
        choices: [
          "Press the advantage immediately",
          "Probe cautiously before committing",
          "Hold position and gather more intelligence",
        ],
        opening: `${lastEvent.title}. ${lastEvent.description}`,
        premise: `This scene begins as ${lastEvent.title.toLowerCase()} reaches the point where direct judgment matters.`,
        title: lastEvent.title,
      }
    : null;

  return {
    catalyst,
    clearActions: true,
    events,
    stopDate: targetDate,
    summary:
      plannedActions.length > 0
        ? `${bundle.game.country} moves from planning into execution, and the world begins adjusting to the turn's most concrete orders.`
        : `Time advances without a direct order from ${bundle.game.country}, but the wider system keeps shifting and building pressure.`,
  };
};

const normalizeGeneratedEvent = (entry, index = 0) => {
  const normalized = normalizeEvents([entry])[0];
  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    id: normalized.id || `generated-event-${index}`,
  };
};

const MAX_ROLLBACK_SNAPSHOTS = 12;

// Persist the PRE-turn state so the cheats menu's "Roll back turn" can restore it.
// A dedicated per-game runtime asset (storage/snapshots.json) — never bundled with
// a scenario or dragged through the 5s poll — capped so a long game can't grow it
// without bound. Purely best-effort: a snapshot failure must never break a turn.
const captureRollbackSnapshot = async ({ round, fromDate, toDate, game, world, events, actions, chat, colors }) => {
  try {
    const prior = await readJson(JSON_URLS.snapshots, { defaultValue: [], force: true }).catch(() => []);
    const list = Array.isArray(prior) ? prior : [];
    const snapshot = {
      id: `snap-${round}-${Date.now()}`,
      round,
      fromDate,
      toDate,
      capturedAt: new Date().toISOString(),
      state: {
        game: cloneValue(game),
        world: cloneValue(world),
        events: cloneValue(events),
        actions: cloneValue(actions),
        chat: cloneValue(chat),
        colors: cloneValue(colors),
      },
    };
    await writeJson(JSON_URLS.snapshots, [snapshot, ...list].slice(0, MAX_ROLLBACK_SNAPSHOTS));
  } catch (error) {
    console.warn("[rollback] snapshot capture failed:", error);
  }
};

// Restore points, newest first (index 0 = undo the most recent turn). Shared by
// the cheats menu and the timeline's Undo control.
export const loadRollbackSnapshots = async () => {
  const list = await readJson(JSON_URLS.snapshots, { defaultValue: [], force: true }).catch(() => []);
  return Array.isArray(list) ? list : [];
};

// Roll back to the start of the turn captured at `index`: restore the six
// per-turn assets, discard that restore point and every newer one (those turns
// no longer happened), and return the freshly-normalized bundle so the caller
// can update immediately. Returns null if there is no such snapshot.
//
// Wrapped in the same beginSimulation/endSimulation busy-lock every jump,
// game-master and catalyst call already uses — without it, the idle pulse (on
// its own real-time timer) could read chat.json mid-rollback, then write its own
// read-modify-write back AFTER this function's restore, resurrecting the
// pre-rollback chat history with its own new note landed on top.
export const rollBackToSnapshot = async (index = 0) => {
  beginSimulation();
  try {
    const snapshots = await loadRollbackSnapshots();
    const snap = snapshots[index];
    if (!snap) return null;
    const s = snap.state ?? {};
    await Promise.all([
      // writeGameData rather than a raw writeJson: the snapshot was captured a
      // whole turn ago and carries that turn's unit-system flag, and a setting
      // must not roll back with the turn. See writeGameData in gameState.js.
      writeGameData(s.game ?? {}),
      writeJson(JSON_URLS.world, s.world ?? {}, { pretty: true }),
      writeJson(JSON_URLS.events, s.events ?? [], { pretty: true }),
      writeJson(JSON_URLS.actions, s.actions ?? [], { pretty: true }),
      writeJson(JSON_URLS.chat, s.chat ?? [], { pretty: true }),
      writeJson(JSON_URLS.colors, s.colors ?? {}, { pretty: true }),
    ]);
    await writeJson(JSON_URLS.snapshots, snapshots.slice(index + 1));
    const bundle = await readGameStateBundle({ force: true });
    // A rollback is the one event that legitimately moves the clock BACKWARDS.
    // The timeline's poll refuses any read older than what it already shows, so
    // without this announcement it discarded every read of the restored state
    // and the panel stayed pinned on the undone turn until the app restarted.
    if (typeof window !== "undefined") window.dispatchEvent(new Event("oh:rolled-back"));
    return { bundle, round: snap.round, remaining: snapshots.length - (index + 1) };
  } finally {
    endSimulation();
  }
};

// Sends a message the Advisor drafted (see ADVISOR_MESSAGE_DRAFT_DIRECTIVE in
// main.jsx) straight into the diplomatic channel with `countryName`, exactly
// as if the player had typed it into the Diplomacy panel and waited for a
// reply — used by advisor.jsx's "Send message to <country>" button so a
// drafted message never has to be manually copy-pasted. Reuses the same
// participant-set matching foldGeneratedChatsIntoStorage applies to
// AI-initiated notes, so this lands in an existing 1-on-1 thread with that
// country instead of forking a duplicate one, and takes the same busy-lock
// every other chat.json writer takes so it can't race the idle pulse or a
// jump/rollback in flight.
export const sendAdvisorDraftedMessage = async ({ countryName, text }) => {
  const trimmedText = normalizeString(text);
  if (!trimmedText) throw new Error("There's no message text to send.");

  beginSimulation();
  try {
    const bundle = await readGameStateBundle({ force: true });
    const playerName = normalizeString(bundle.game?.country);
    if (!playerName) throw new Error("No active game to send a message in.");

    const [recipient] = await resolveInvitees([countryName], bundle.world);
    if (!recipient) throw new Error(`Could not identify "${countryName}" among the known polities.`);
    if (regionKey(recipient.name) === regionKey(playerName)) {
      throw new Error("Can't send a diplomatic message to your own polity.");
    }

    const chats = normalizeChats(await readChatsState({ force: true }));
    const recipientKey = chatParticipantKey([recipient]);
    const existing = chats.find((chat) =>
      chat.status !== "closed" && chatParticipantKey(chat.countries) === recipientKey);
    const priorMessages = existing?.messages ?? [];

    const gameDate = normalizeString(bundle.game?.gameDate);
    const { reply, reaction, memorySummary } = await sendDiplomaticMessageOnceOff({
      playerMessage: trimmedText,
      speakingAs: recipient.name,
      participantNames: [playerName, recipient.name],
      playerCountry: playerName,
      priorMessages,
    });

    const userMessage = {
      role: "user",
      speaker: playerName,
      text: trimmedText,
      time: gameDate,
      ...(reaction ? { reactions: { [recipient.name]: { emoji: reaction, code: recipient.code || "" } } } : {}),
    };
    const leaderMessage = {
      role: "leader", speaker: recipient.name, code: recipient.code || "", text: reply, time: gameDate,
      ...(memorySummary ? { memorySummary } : {}),
    };

    const built = normalizeChatEntry({
      countries: [recipient],
      messages: [userMessage, leaderMessage],
      source: "advisor",
      status: "open",
      title: existing?.title || `Chat with ${recipient.name}`,
    });
    if (!built) throw new Error("Could not build the message.");

    const nextChats = foldGeneratedChatsIntoStorage(chats, [built], {});
    await writeChatsState(nextChats);

    const finalChat = nextChats.find((chat) => chatParticipantKey(chat.countries) === recipientKey);
    return { chat: finalChat, reply };
  } finally {
    endSimulation();
  }
};

// `projects` opts this turn into the Projects & Operations board task. It runs
// HERE rather than in the caller because the board's whole job is to move with
// the events, and espionage does not produce its events until partway through
// this function — a board call made before it never saw an exposure, so a covert
// operation could be rolled up in the story while its entry carried on filling.
//
// Everything the board could need is settled by then and nothing is written yet,
// so a failure still means "nothing happened" and the turn can be held and
// retried. Callers that own the board through their own impacts
// (applyGameMasterCommand) or have no board story (advanceActiveCatalyst)
// simply omit it and are unchanged.
// Ledger records reference the events that caused them by id. When a
// post-processor drops an event, every record bound only to it is dropped too;
// a record bound to no event at all (a baseline row) stays.
const filterBoundLedgerUpdatesToKeptEvents = (updates, allEvents, keptEvents) => {
  const allIds = normalizeArray(allEvents)
    .map((event) => normalizeString(event?.id))
    .filter(Boolean);
  const keptIds = new Set(
    normalizeArray(keptEvents)
      .map((event) => normalizeString(event?.id))
      .filter(Boolean),
  );

  return normalizeArray(updates).filter((update) => {
    const serialized = JSON.stringify(update ?? {});
    const referenced = allIds.filter((id) => serialized.includes(id));
    if (!referenced.length) return true;
    return referenced.some((id) => keptIds.has(id));
  });
};

const applySimulationResult = async ({
  baseActions,
  baseChats,
  baseColors,
  baseEvents,
  baseGame,
  campaignId = "",
  projects = null,
  baseWorld,
  result,
}) => {
  const generatedEvents = normalizeArray(result.events)
    .map((entry, index) => normalizeGeneratedEvent({
      ...entry,
      source: entry?.source || result.generation?.source || "ai",
    }, index))
    .filter(Boolean);
  // The model is shown the running timeline as context and tends to restate events
  // it already reported; each restatement gets a fresh random id, so only a
  // content-key de-dup catches it. Drop restatements BEFORE they persist, apply
  // impacts, or land in this turn's record (also see the [New Developments Only]
  // directive in buildTemplateVariables).
  const priorEvents = normalizeEvents(baseEvents);
  const dedupedEvents = dedupeGeneratedEvents(priorEvents, generatedEvents);

  // One curator analysis for the round's candidates and for the breadth
  // repair's supplemental ones.
  const curatorAnalyzeBatch = ({ candidates, priorHistory }) =>
    runJsonTask("timelineCurator", {
      fallback: () => ({
        judgments: candidates.map((event, index) => ({
          index,
          verdict: "KEEP",
          confidence: 0,
          materialStateChange: "Semantic curator unavailable; event preserved by fail-open fallback.",
          matchedPriorIndexes: [],
          materiallyNewDimensions: ["unknown"],
          recurrenceMatters: false,
          newTriggerAfterPriorPosture: "none",
          worthwhile: true,
          substantive: true,
          personalityTexture: false,
          storyline: normalizeString(event?.title) || `event-${index}`,
          qualitativeAdvance: true,
          incrementalProcess: false,
          processFramePresent: false,
          observableOutcomeEvidence: "",
          pureProcessFiller: false,
          reason: "Curator AI failed; fail-open KEEP.",
        })),
        recentHistoryMechanical: false,
        storylineSaturation: [],
        underrepresentedDomains: [],
      }),
      signal: projects?.signal,
      userMessage:
        "Analyze every supplied native timeline candidate with the required curator tool. Return exactly one judgment for every candidate index.",
      variables: {
        curatorPriorHistory: JSON.stringify(priorHistory, null, 2),
        curatorCandidates: JSON.stringify(candidates, null, 2),
      },
    });

  // The curator decides whether an event exists BEFORE impacts, chats, history
  // and persistence see it: the model judges each candidate against recent
  // canon, and deterministic gates (hard mechanical consequences, retrieved
  // prior matches, saturation) decide what those judgments may remove. The
  // default is KEEP, and any failure of the analysis keeps everything.
  let curatedEvents = await curateGeneratedEvents({
    events: dedupedEvents,
    priorEvents,
    game: baseGame,
    world: baseWorld,
    actions: baseActions,
    mode: result.mode,
    analyzeBatch: curatorAnalyzeBatch,
  });
  // Breadth is measured by what SURVIVES curation. A month-scale jump left with
  // only a few worthwhile events, or a busy window without consequential
  // outcomes, gets one bounded second search of the exploration lanes still
  // visibly neglected; every supplemental event passes the same integrity
  // screen and the same curator. Not a quota: a quiet world may return none.
  const breadthRepair = await maybeRepairWorldBreadthAfterCuration({
    survivingEvents: curatedEvents,
    mainEvents: dedupedEvents,
    bundle: { actions: baseActions, chats: baseChats, events: priorEvents, game: baseGame, world: baseWorld },
    context: result?.breadthRepairContext,
    mode: result.mode,
    signal: projects?.signal,
  });
  if (breadthRepair?.events?.length) {
    // New storyline ids ride on their own repair events before any filtering,
    // so a surviving event carries its continuity exactly like a main event.
    const repairTaggedEvents = attachDecodedStorylineIds(
      breadthRepair.events,
      breadthRepair.storylineUpdates,
      "world-breadth-repair",
    );
    const repairNormalizedEvents = repairTaggedEvents
      .map((entry, index) => normalizeGeneratedEvent({
        ...entry,
        source: entry?.source || "ai",
      }, dedupedEvents.length + index))
      .filter(Boolean);
    const repairFreshEvents = dedupeGeneratedEvents([...priorEvents, ...dedupedEvents], repairNormalizedEvents);
    const repairScreened = screenGeneratedWorldEvents({
      events: repairFreshEvents,
      priorEvents: [...priorEvents, ...curatedEvents],
      world: baseWorld,
      game: baseGame,
      analysis: breadthRepair.analysis,
    });
    const repairCuratedEvents = await curateGeneratedEvents({
      events: repairScreened.events,
      priorEvents: [...priorEvents, ...curatedEvents],
      game: baseGame,
      world: baseWorld,
      actions: baseActions,
      mode: result.mode,
      analyzeBatch: curatorAnalyzeBatch,
    });
    const survivingRepairStorylineIds = new Set(
      repairCuratedEvents
        .flatMap((event) => normalizeArray(event?.storylineIds))
        .map(normalizeString)
        .filter(Boolean),
    );
    const repairStorylineUpdates = normalizeArray(breadthRepair.storylineUpdates)
      .filter((update) => survivingRepairStorylineIds.has(normalizeString(update?.id)));
    if (repairStorylineUpdates.length) {
      result.storylineUpdates = [
        ...decodeWorldStorylineUpdates(result.storylineUpdates),
        ...repairStorylineUpdates,
      ];
    }
    curatedEvents = [...curatedEvents, ...repairCuratedEvents];
    console.info(
      `[OH world composition] supplemental candidates ${breadthRepair.events.length}; ` +
      `integrity kept ${repairScreened.events.length}; curator kept ${repairCuratedEvents.length}.`,
    );
  }
  // A ledger record bound to an event the curator removed goes with it.
  const keptWarUpdates = filterBoundLedgerUpdatesToKeptEvents(result.warUpdates, dedupedEvents, curatedEvents);
  const keptRelationUpdates = filterBoundLedgerUpdatesToKeptEvents(result.relationUpdates, dedupedEvents, curatedEvents);
  const keptAgreementUpdates = filterBoundLedgerUpdatesToKeptEvents(result.agreementUpdates, dedupedEvents, curatedEvents);
  const keptStorylineUpdates = filterBoundLedgerUpdatesToKeptEvents(result.storylineUpdates, dedupedEvents, curatedEvents);

  // Canonical, round-scoped event ids (event-ai-r0007-19140801-003): unique
  // across the whole save, so a ledger or history reference is never ambiguous.
  // Existing history is never renamed. The ledger records were bound to the
  // segments' temporary ids; they follow the rename here.
  const canonicalEventIdentity = allocateCanonicalTurnEventIds({
    existingEvents: priorEvents,
    newEvents: curatedEvents,
    round: (baseGame.round || 1) + 1,
  });
  const freshEvents = canonicalEventIdentity.events;
  const warUpdates = remapLedgerEventIds(normalizeArray(keptWarUpdates), canonicalEventIdentity.idMap);
  const relationUpdates = remapLedgerEventIds(normalizeArray(keptRelationUpdates), canonicalEventIdentity.idMap);
  const agreementUpdates = remapLedgerEventIds(normalizeArray(keptAgreementUpdates), canonicalEventIdentity.idMap);
  const storylineUpdates = remapLedgerEventIds(normalizeArray(keptStorylineUpdates), canonicalEventIdentity.idMap);
  const nextGame = normalizeGameData({
    ...baseGame,
    gameDate: normalizeString(result.stopDate) || baseGame.gameDate,
    round: (baseGame.round || 1) + 1,
  });
  const plannedActionSnapshot = normalizeActions(baseActions).filter((action) => action.status === "planned");
  const nextActions = normalizeActions(baseActions).map((action) => ({
    ...action,
    status: action.status === "planned" && result.clearActions ? "resolved" : action.status,
  }));
  const nextChats = [...normalizeChats(baseChats)];
  // Chats this turn CREATED, kept apart from the pre-turn snapshot. A turn takes a
  // while to generate and the player can edit the chat list while it runs, so the
  // write at the end merges these onto whatever is actually stored by then rather
  // than putting the stale snapshot back. See the re-read before writeChatsState.
  const generatedChats = [];

  // Which unit system this session is running, pinned at startup.
  const betaUnits = isBetaUnits();

  const { colors: nextColors, world: impactedWorld } = applyEventImpactsToWorld({
    colors: baseColors,
    events: freshEvents,
    // Give every unit op a travel budget of the days between the previous event
    // and its own, so a move op advances a formation as far as it could actually
    // have got rather than teleporting it. An over-long move becomes a partial
    // advance plus a standing order the engine keeps working on later turns.
    //
    // Both of these are the beta unit system. In the classic system a unit op
    // lands where the model put it and no standing order is minted, which is
    // what motion: null plus betaEngine: false mean.
    motion: betaUnits ? { originDate: baseGame.gameDate, round: nextGame.round, tick: 0 } : null,
    betaEngine: betaUnits,
    world: {
      ...baseWorld,
      activeCatalyst: result.catalyst ?? null,
      actionSuggestions: [],
      lastJumpMode: normalizeString(result.mode),
      lastJumpSummary: normalizeString(result.summary),
      lastJumpTargetDate: nextGame.gameDate,
      simulationHistory: [
        {
          catalyst: result.catalyst ? cloneValue(result.catalyst) : null,
          date: nextGame.gameDate,
          eventIds: freshEvents.map((event) => event.id),
          fallbackReason: normalizeString(result.generation?.fallbackReason),
          fromDate: baseGame.gameDate,
          mode: normalizeString(result.mode) || "jump",
          plannedActions: plannedActionSnapshot,
          // The raw model response that failed to parse (runJsonTask), so the
          // fallback warning's "Copy debugging message" button (time.jsx) has
          // something to copy even after a reload — only ever non-empty on a
          // fallback turn; a normal AI turn carries nothing here.
          rawResponse: normalizeString(result.generation?.rawResponse),
          round: nextGame.round,
          summary: normalizeString(result.summary),
          source: result.generation?.source || "ai",
          storylineIds: [...new Set(normalizeArray(storylineUpdates).map((entry) => normalizeString(entry?.id)).filter(Boolean))],
          toDate: nextGame.gameDate,
        },
        ...normalizeWorldState(baseWorld).simulationHistory,
      ].slice(0, 12),
    },
  });
  // Advance every standing order the model did NOT touch across the whole jump,
  // and drift the patrols. This is what keeps a fleet crossing an ocean moving
  // turn after turn, and a squadron visibly working its station, with none of it
  // having to come back from the model. Units the model DID move are skipped:
  // they already stepped once per event against that event's own budget, and
  // advancing them again here would move them twice for the same elapsed time.
  //
  // Both this and the unit-volume cap are beta-only: the classic system has no
  // standing orders to advance and no cap on how many formations the world may
  // hold, so it leaves the impacted world exactly as the events left it.
  const movedThisTurn = freshEvents.flatMap((event) =>
    normalizeArray(event.impacts?.unitOps).map((op) => op.unitId || op.unit?.id).filter(Boolean));
  let worldWithImpacts = betaUnits
    ? enforceUnitVolume(
      advanceStandingOrders(
        // Rounds may have passed under the classic system since these orders were
        // issued, which would leave every dormant patrol already expired. Give
        // them the rest of their life from here before advancing anything.
        resumeStandingOrders(impactedWorld, {
          round: nextGame.round,
          previousSystem: normalizeWorldState(baseWorld).unitSystem,
        }),
        {
          fromDate: baseGame.gameDate,
          toDate: nextGame.gameDate,
          round: nextGame.round,
          skipUnitIds: movedThisTurn,
        },
      ),
      { playerCode: baseGame.country },
    )
    : impactedWorld;

  // The war ledger merges BEFORE espionage, so a war declared this turn already
  // counts when the world's services decide whom to spy on; the diplomatic
  // ledger merges after it, so a publicly exposed ring can sour a relation in
  // the same pass. Both are pure: they return a new normalized world.
  const warMerge = applyWarUpdates({
    world: worldWithImpacts,
    updates: warUpdates,
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });
  worldWithImpacts = warMerge.world;

  // Espionage resolves on the world the whole turn produced - after the standing
  // orders above have advanced, so an agent's round is decided against where the
  // fleets actually ended up rather than where they started - deterministically
  // (keyed on the round), and its consequences are EVENTS the model reads next
  // turn: an exposed ring, a suspected agent.
  //
  // Hostility is read from the ledgers (this is the only place it is derived;
  // spycraft.js takes what it is handed): an active war against the player is 1,
  // a ceasefire 0.55, a relation at -70 or worse 0.6, at -40 or worse 0.4, and a
  // pariah reputation 0.35. foreignDeployChance reads the number; `hostile` is
  // the boolean it still accepts. detectionChance / suspicionChance stay
  // independent of the relationship - they are about the two services.
  const espionageIdentityIndex = buildPolityIdentityIndex(worldWithImpacts);
  const canonicalEspionagePolity = (name) => canonicalCampaignPolity(name, worldWithImpacts, espionageIdentityIndex);
  const playerLedgerPolity = canonicalEspionagePolity(baseGame.country);
  const espionageCandidates = [...new Set([
    ...Object.keys(worldWithImpacts.polityOverrides ?? {}),
    ...Object.keys(worldWithImpacts.intelligence ?? {}),
    ...Object.values(worldWithImpacts.regionOwnershipOverrides ?? {}),
    ...normalizeChats(baseChats).flatMap((chat) => chat.countries.map((country) => normalizeString(country.name))),
    ...normalizeArray(worldWithImpacts.wars).flatMap((war) => [...normalizeArray(war?.sideA), ...normalizeArray(war?.sideB)]),
    ...normalizeArray(worldWithImpacts.relations).flatMap((relation) => [relation?.a, relation?.b]),
  ].map(canonicalEspionagePolity).filter((name) => name && name !== playerLedgerPolity))].map((polity) => {
    let hostility = 0;
    for (const war of normalizeArray(worldWithImpacts.wars)) {
      const sideA = new Set(normalizeArray(war?.sideA).map(canonicalEspionagePolity));
      const sideB = new Set(normalizeArray(war?.sideB).map(canonicalEspionagePolity));
      const opponents = (sideA.has(playerLedgerPolity) && sideB.has(polity)) || (sideB.has(playerLedgerPolity) && sideA.has(polity));
      if (!opponents) continue;
      if (war.status === "active") { hostility = 1; break; }
      if (war.status === "ceasefire") hostility = Math.max(hostility, 0.55);
    }
    if (hostility < 1) {
      for (const relation of normalizeArray(worldWithImpacts.relations)) {
        const a = canonicalEspionagePolity(relation?.a);
        const b = canonicalEspionagePolity(relation?.b);
        if (!((a === playerLedgerPolity && b === polity) || (b === playerLedgerPolity && a === polity))) continue;
        const score = Number(relation?.score);
        if (Number.isFinite(score) && score <= -70) hostility = Math.max(hostility, 0.6);
        else if (Number.isFinite(score) && score <= -40) hostility = Math.max(hostility, 0.4);
      }
      if (Number(worldWithImpacts.internationalReputation?.[polity] ?? 50) <= 30) hostility = Math.max(hostility, 0.35);
    }
    return { polity, hostility, hostile: hostility >= 0.75 };
  });
  const espionage = resolveEspionage(worldWithImpacts, {
    round: nextGame.round,
    date: nextGame.gameDate,
    playerPolity: normalizeString(baseGame.country),
    candidates: espionageCandidates,
  });
  worldWithImpacts.spies = espionage.spies;
  // A spy in the world needs a seal for what it will report under.
  if (!isSeal(worldWithImpacts.spySeal) && espionage.spies.length) worldWithImpacts.spySeal = newSeal();
  const espionageEventIds = [];
  // A PUBLIC exposure is not just prose: it lands in the relation ledger as an
  // event-linked deterioration of the pair, the same way ordinary diplomacy does.
  // Secret discoveries and turns stay secret and move nothing.
  const espionageRelationUpdates = [];
  espionage.events.forEach((event, espionageIndex) => {
    const entry = normalizeEventEntry({ ...event, id: "espionage-" + nextGame.round + "-" + freshEvents.length }, freshEvents.length);
    if (!entry) return;
    freshEvents.push(entry);
    espionageEventIds.push(entry.id);
    const notice = espionage.notices?.[espionageIndex] || null;
    const spy = notice?.kind === "exposed" && notice.spyId
      ? espionage.spies.find((candidate) => candidate?.id === notice.spyId)
      : null;
    if (!spy) return;
    const owner = canonicalEspionagePolity(spy.owner);
    const target = canonicalEspionagePolity(spy.target);
    if (!owner || !target || owner === target) return;
    const samePair = (record) => {
      const left = canonicalEspionagePolity(record?.a);
      const right = canonicalEspionagePolity(record?.b);
      return (left === owner && right === target) || (left === target && right === owner);
    };
    const sameTurnUpdate = [...relationUpdates].reverse().find(samePair);
    const priorRelation = normalizeArray(worldWithImpacts.relations).find(samePair);
    const baseScore = Number.isFinite(Number(sameTurnUpdate?.score))
      ? Number(sameTurnUpdate.score)
      : Number.isFinite(Number(priorRelation?.score)) ? Number(priorRelation.score) : 0;
    // A public exposure leaves the pair at least strained — the notice says
    // so — however warm the same turn's diplomacy tried to make it.
    const score = Math.max(-100, Math.min(-31, Math.round(baseScore) - 20));
    espionageRelationUpdates.push({
      id: `relation-update-espionage-${nextGame.round}-${espionageIndex}`,
      a: owner,
      b: target,
      score,
      status: relationStatusForScore(score),
      eventIndexes: [],
      eventIds: [entry.id],
      summary: `Public exposure of ${owner}'s espionage operation in ${target}.`,
    });
  });

  const diplomaticMerge = applyDiplomaticUpdates({
    world: worldWithImpacts,
    relationUpdates: [...relationUpdates, ...espionageRelationUpdates],
    agreementUpdates,
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });
  worldWithImpacts = diplomaticMerge.world;
  // Storylines last: they read the wars and relations as this turn left them.
  const storylineMerge = applyWorldStorylineUpdates({
    world: worldWithImpacts,
    updates: normalizeArray(storylineUpdates),
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });
  worldWithImpacts = storylineMerge.world;
  // Each segment was checked on its own; this is the merged round. A finished
  // turn is never lost to this check, but its verdict is worth a report.
  const canonicalWarError = validateCanonicalWarEvents({ events: freshEvents, updates: warUpdates, world: baseWorld });
  if (canonicalWarError) {
    console.warn(`[ai] canonical war-state check on the merged turn: ${canonicalWarError}`);
    logDebugEvent("warn", "[turn] The canonical war-state check flagged the merged turn.", { error: canonicalWarError });
  }
  if (warMerge.appliedIds.length || diplomaticMerge.appliedRelationIds.length || diplomaticMerge.appliedAgreementIds.length) {
    logDebugEvent("turn", `Ledgers updated: ${warMerge.appliedIds.length} war op(s), ${diplomaticMerge.appliedRelationIds.length} relation(s), ${diplomaticMerge.appliedAgreementIds.length} agreement(s).`, undefined, { verbose: true });
  }
  if (storylineMerge.appliedIds.length) {
    logDebugEvent("turn", `Storylines updated: ${storylineMerge.appliedIds.length}.`, { ids: storylineMerge.appliedIds }, { verbose: true });
  }
  // Built HERE rather than beside freshEvents above, because the loop that just
  // ran appends to it. `[...priorEvents, ...freshEvents]` is a copy, so a snapshot
  // taken before the loop cannot see an exposure or a discovery — and that copy is
  // what writeEventsState persists and what this function returns.
  const nextEvents = [...priorEvents, ...freshEvents];
  // Same reason, for this turn's own record: simulationHistory is built as an
  // argument to applyEventImpactsToWorld, which has to run BEFORE espionage
  // resolves on its output, so its eventIds snapshot also predates the loop.
  // time.jsx renders a turn's events from exactly this list.
  if (espionageEventIds.length && worldWithImpacts.simulationHistory?.[0]) {
    const [turnEntry, ...olderTurns] = worldWithImpacts.simulationHistory;
    worldWithImpacts.simulationHistory = [
      { ...turnEntry, eventIds: [...turnEntry.eventIds, ...espionageEventIds] },
      ...olderTurns,
    ];
  }
  // Keep the board's covert operations in step with the agents they track,
  // BEFORE the board task runs, so the model is shown an entry that already
  // matches this turn's espionage rather than one describing an agent that was
  // caught a moment ago. Engine bookkeeping, not narrative: it only opens an
  // entry and closes it (projects.js spyOperationOps says why).
  const playerPolity = normalizeString(baseGame.country);
  // The player's espionage orders, carried by the events that executed them
  // (impacts.spyOps). Applied here rather than inside applyEventImpactsToWorld
  // so the Spy tab's slot rules hold (three agents, one per country, never at
  // home) with a skipped order logged instead of a lost turn, and so the board
  // sync right below already sees the new agent. After resolveEspionage on
  // purpose: an agent placed this turn is not also caught this turn.
  const spyOrders = normalizeArray(freshEvents).flatMap((event) => normalizeArray(event?.impacts?.spyOps));
  if (spyOrders.length) {
    const outcome = applySpyOps(worldWithImpacts, spyOrders, { date: nextGame.gameDate, playerPolity });
    worldWithImpacts.spies = outcome.spies;
    if (outcome.applied.length) {
      logDebugEvent("espionage", `Spy orders applied: ${outcome.applied.map((entry) => `${entry.op} ${entry.target}`).join(", ")}`);
    }
    for (const skipped of outcome.rejected) {
      logDebugEvent("espionage", `Spy order skipped: ${skipped.reason}`, { op: skipped.op });
    }
  }
  const spySync = [
    // Order matters: provenance first, so an entry stamped this turn can be
    // doubted in the same pass rather than a turn later.
    ...spyOperationOps(normalizeSpies(worldWithImpacts.spies), worldWithImpacts.projects, {
      date: nextGame.gameDate,
      playerPolity,
    }),
    ...spyProvenanceOps(normalizeSpies(worldWithImpacts.spies), worldWithImpacts.projects, { playerPolity }),
  ];
  if (spySync.length) {
    worldWithImpacts = applyProjectOpsToWorld({
      date: nextGame.gameDate,
      ops: spySync,
      playerCountry: playerPolity,
      round: nextGame.round,
      world: worldWithImpacts,
    }).world;
  }
  // Doubt runs on the world the two passes above just produced, so a foreign entry
  // linked a moment ago is covered by the same turn's suspicion.
  const doubtOps = spyIntelDoubtOps(normalizeSpies(worldWithImpacts.spies), worldWithImpacts.projects, {
    playerPolity,
    date: nextGame.gameDate,
  });
  if (doubtOps.length) {
    worldWithImpacts = applyProjectOpsToWorld({
      date: nextGame.gameDate,
      ops: doubtOps,
      playerCountry: playerPolity,
      round: nextGame.round,
      world: worldWithImpacts,
    }).world;
  }
  if (spySync.length || doubtOps.length) {
    logDebugEvent("turn", `Covert operations synced to the board: ${spySync.length} op(s), ${doubtOps.length} doubted.`, undefined, { verbose: true });
  }

  // The board, in its own call, once for the whole round — after the segments
  // merged so it sees the complete story, after espionage so an exposed ring can
  // stall the operation it belonged to, and BEFORE anything is written so its ops
  // ride in on the events that caused them.
  if (projects) {
    try {
      const { ops, skipped } = await generateProjectOps(
        // The LIVE world, not projects.bundle's pre-turn copy: the bundle was
        // read before the turn ran, so its board carries none of this turn's
        // impacts and none of the covert-operation sync just above.
        { ...projects.bundle, game: nextGame, world: worldWithImpacts },
        freshEvents,
        { signal: projects.signal },
      );
      if (!skipped && ops.length) {
        const attached = attachProjectOpsToEvents(freshEvents, ops);
        // Recorded on the events above; APPLIED here, through the same event path
        // every other impact takes (release of completion effects included), so
        // the board the player sees after this write is the one the model moved.
        // Only the project ops are replayed: the events' other impacts were
        // applied when the world was first impacted, and must not run twice.
        const boardEvents = freshEvents
          .filter((event) => normalizeArray(event.impacts?.projectOps).length)
          .map((event) => ({ ...event, impacts: { projectOps: event.impacts.projectOps } }));
        if (boardEvents.length) {
          worldWithImpacts = applyEventImpactsToWorld({
            colors: nextColors,
            events: boardEvents,
            world: worldWithImpacts,
            motion: null,
            betaEngine: betaUnits,
            round: nextGame.round,
          }).world;
        }
        logDebugEvent("turn", `Projects board updated: ${attached} op(s).`, undefined, { verbose: true });
      }
    } catch (error) {
      // A deliberate cancel is the player's and aborts the turn like any other.
      if (error?.name === "AbortError") throw error;
      // Nothing has been written at this point, so the caller can hold the turn
      // and re-run just this call. Marked, not held, here: the caller is the one
      // holding the arguments a retry needs.
      logDebugEvent("turn", "Turn HELD: the board did not update, so nothing was written.", error);
      throw projectsHeldError(error);
    }
  }

  let nextWorld = worldWithImpacts;

  for (const event of freshEvents) {
    for (const createdChat of event.impacts.createdChats) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, worldWithImpacts, {
        fallbackTitle: event.title,
        playerName: baseGame.country,
      });
      if (nextChat) { nextChats.unshift(nextChat); generatedChats.push(nextChat); }
    }
  }

  // Unprompted outreach: polities reaching out on their own initiative during
  // the simulated period, not tied to any event (treaty feelers, summit
  // invitations). Same chat machinery, no linked event.
  for (const chatLike of normalizeArray(result.outreach)) {
    const nextChat = await buildGeneratedChat({ ...chatLike, source: "outreach" }, "", worldWithImpacts, {
      playerName: baseGame.country,
    });
    if (nextChat) { nextChats.unshift(nextChat); generatedChats.unshift(nextChat); }
  }

  if (result.mode === "jump" || result.mode === "auto") {
    try {
      nextWorld = await compactHistoryIfNeeded({
        actions: nextActions,
        chats: nextChats,
        events: nextEvents,
        game: nextGame,
        world: worldWithImpacts,
      });
    } catch (error) {
      console.warn("[ai] campaign history consolidation failed; the completed turn will still be saved.", error);
    }
  }

  // Bounded automatic Stats tracking: only when the player's configured calendar
  // interval is due, and one compact AI batch for every initialised tracked
  // country. A failure never invalidates the completed turn.
  try {
    nextWorld = await refreshTrackedCountryStatsIfDue({
      bundle: {
        actions: nextActions,
        chats: nextChats,
        events: nextEvents,
        game: nextGame,
        world: nextWorld,
      },
      signal: projects?.signal,
    });
  } catch (error) {
    if (projects?.signal?.aborted) throw error;
    console.warn("[stats auto] unexpected scheduler failure; the completed turn is preserved.", error);
  }

  // Permanent compact Stats history: snapshots only the numeric sheets that
  // already exist, so it adds no AI work when tracking is off or not due.
  nextWorld = captureCountryStatsHistory(nextWorld, {
    date: nextGame.gameDate || nextGame.startDate || "",
    round: nextGame.round || 0,
  });

  // Re-read the chat list instead of writing the pre-turn snapshot back over it.
  // Turns take a while, and anything the player did to the list while one ran —
  // deleting a thread, archiving one — exists only in storage. Writing baseChats
  // on top resurrected deleted chats, and the AI's next message then landed in the
  // revived thread instead of opening a fresh one. Falls back to the snapshot if
  // the read fails, which is the old behaviour and never loses a generated chat.
  let chatsToWrite;
  try {
    // Folding (not prepending) matters as much as the re-read: a country that
    // already has an open thread with the player must have its new note land
    // THERE, not beside it in a duplicate chat opened from scratch.
    chatsToWrite = foldGeneratedChatsIntoStorage(
      normalizeChats(await readChatsState({ force: true })),
      generatedChats,
      { stampTime: nextGame.gameDate },
    );
  } catch {
    chatsToWrite = nextChats;
  }

  // Last moment before anything is persisted. Everything above is pure, so a
  // turn generated for a campaign the player has since left is simply lost here
  // rather than written over whichever campaign they opened instead.
  assertCampaignUnchanged(campaignId, activeCampaignId());

  await Promise.all([
    writeActionsState(nextActions),
    writeChatsState(chatsToWrite),
    writeEventsState(nextEvents),
    writeGameData(nextGame),
    writeJson(JSON_URLS.colors, nextColors, { pretty: true }),
    writeWorldState(nextWorld),
  ]);

  // The turn's new state is now persisted. Web-mode encrypted sync listens for this
  // to back up the turn (replacing a fixed 20s poll); it is a no-op in desktop mode
  // where nothing listens. Firing here — the single choke point every turn type runs
  // through (jump, auto-jump, catalyst, game-master) — means the sync's full scan
  // sees the committed round.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("oh:turn-complete"));

  // Spies report on the world the turn just produced. Awaited so the reports are
  // there when the player opens the Spy tab, but never allowed to fail the turn.
  await refreshSpyIntercepts();

  // Snapshot the state we just replaced so it can be rolled back to (best-effort).
  await captureRollbackSnapshot({
    round: baseGame.round || 1,
    fromDate: baseGame.gameDate || baseGame.startDate || "",
    toDate: nextGame.gameDate || "",
    game: baseGame,
    world: baseWorld,
    events: baseEvents,
    actions: baseActions,
    chat: baseChats,
    colors: baseColors,
  });

  return {
    actions: nextActions,
    chats: chatsToWrite, // what was actually persisted, not the pre-turn snapshot
    colors: nextColors,
    events: nextEvents,
    game: nextGame,
    generation: result.generation ?? { source: "ai", fallbackReason: "" },
    world: nextWorld,
  };
};

export const generateActionSuggestions = async ({ force = true } = {}) => {
  const bundle = await readGameStateBundle({ force });
  const variables = await buildTemplateVariables(bundle);
  const { payload } = await runJsonTask("actions", {
    fallback: () => fallbackActionSuggestions(bundle),
    userMessage: "Generate current strategic action suggestions as JSON only.",
    variables,
  });

  const normalizeTopics = (raw) =>
    normalizeArray(raw)
      .map((topic, topicIndex) => {
        if (!topic || typeof topic !== "object") {
          return null;
        }

        const title = normalizeString(topic.title || topic.name);
        if (!title) {
          return null;
        }

        return {
          actions: normalizeArray(topic.actions)
            .map((action, actionIndex) =>
              normalizeActionEntry(
                {
                  ...action,
                  source: "suggested",
                  suggestionTopic: title,
                },
                actionIndex,
              ),
            )
            .filter(Boolean),
          description: normalizeString(topic.description),
          id: normalizeString(topic.id) || `topic-${topicIndex}`,
          title,
        };
      })
      .filter(Boolean);

  // Models told "JSON only" mislabel or wrap the list — accept the common
  // shapes (top-level array, topics, suggestions) before giving up.
  let topics = normalizeTopics(
    Array.isArray(payload) ? payload : payload?.topics ?? payload?.suggestions,
  );

  // A parseable-but-EMPTY answer used to be accepted as "no suggestions were
  // generated" — the deterministic fallback (which always has topics) now
  // covers it, same as empty timeline turns.
  if (topics.length === 0) {
    console.warn("[ai] action suggestions came back empty — using the deterministic fallback.");
    topics = normalizeTopics((await fallbackActionSuggestions(bundle))?.topics);
  }

  const world = normalizeWorldState(await readWorldState());
  world.actionSuggestions = topics;
  await writeWorldState(world);

  return topics;
};

// Freeform AI intelligence briefing on a specific country/polity, grounded in the
// current world state. Returned as plain-text bullet points for the region popup.
// Everything the game state actually records about ONE polity — the target's
// dossier for intelligence briefings. The generic world summary truncates hard
// (24 of possibly thousands of region overrides, 16 polities), so without this
// the target usually isn't in the prompt at all and the AI can only shrug.
const buildTargetDossier = async (bundle, code, normalizedWorld = null) => {
  const world = normalizedWorld || normalizeWorldState(bundle.world);
  const lines = [];

  const polity = code ? world.polityOverrides?.[code] : null;
  if (polity) {
    lines.push(
      `Polity: ${polity.name || code} (code ${code})${
        polity.aliases?.length > 0 ? ` — also known as ${polity.aliases.join(", ")}` : ""
      }`,
    );
    if (polity.note) lines.push(`Notes: ${polity.note}`);
  }

  const overrides = Object.entries(world.regionOwnershipOverrides ?? {});
  const owned = code ? overrides.filter(([, owner]) => owner === code) : [];
  if (owned.length > 0) {
    const regionCatalog = await loadRegionCatalog();
    const regionLookup = new Map(regionCatalog.map((region) => [region.id, region]));
    const names = owned.slice(0, 40).map(([regionId]) => {
      const region = regionLookup.get(regionId);
      return region ? `${region.name}${region.country ? ` (${region.country})` : ""}` : regionId;
    });
    lines.push(
      `Territory: holds ${owned.length} regions${owned.length > names.length ? ", including" : ""}: ${names.join(", ")}${
        owned.length > names.length ? ", …" : ""
      }`,
    );
  } else if (code) {
    lines.push(
      overrides.length > 0
        ? `Territory: no regions on the current map are recorded as held by ${code}.`
        : `Territory: holds its modern-day territory (no territorial changes recorded).`,
    );
  }

  const units = normalizeArray(bundle.world?.units).filter((unit) => unit?.ownerCode === code);
  if (units.length > 0) {
    const byType = new Map();
    let strength = 0;
    for (const unit of units) {
      byType.set(unit.type, (byType.get(unit.type) || 0) + 1);
      strength += Number(unit.strength) || 0;
    }
    const composition = Array.from(byType.entries()).map(([type, n]) => `${n} ${type}`).join(", ");
    lines.push(`Deployed forces: ${units.length} units (${composition}), combined strength ${strength}.`);
  } else {
    lines.push("Deployed forces: none currently on the map.");
  }

  return lines.join("\n");
};

const canonicalStatsPolity = (token, world) => {
  const text = normalizeString(token);
  if (!text) return "";
  const resolved = resolvePolityIdentity(text, world, {
    allowUnknown: true,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return normalizeString(resolved?.resolved) || toCountryName(text) || text;
};

// ---------------------------------------------------------------------------
// Phase 7A.2 — bounded economic continuity evidence
// ---------------------------------------------------------------------------
// This is deliberately cheap/native: no extra AI call, no whole-history semantic
// scan. Stats reassessment sees at most a small recent target-specific evidence
// packet, while the persistent continuity ledger prevents already-accounted events
// from being applied twice.
const STATS_ECONOMIC_EVENT_SCAN_LIMIT = 64;
const STATS_ECONOMIC_EVIDENCE_LIMIT = 12;
const STATS_ACCOUNTED_EVENT_LIMIT = 64;

const ECONOMIC_EVENT_PATTERN = /\b(?:tax|taxation|levy|budget|fiscal|deficit|surplus|debt|bond|loan|credit|bank|banking|currency|monetary|inflation|unemployment|recession|depression|boom|growth|trade|tariff|customs|sanction|blockade|shortage|harvest|famine|food|coal|oil|energy|industry|industrial|factory|rail|railway|infrastructure|subsid|spending|appropriation|finance|financial|wage|strike|mobiliz|war finance|occupation|annex|cession|reparat|investment|export|import)\b/i;

const stableStatsHash = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};


const STATS_MACRO_MAX_BUCKETS = 12;
const STATS_MACRO_TARGET_COMPONENTS = 30;
const STATS_MACRO_SAMPLE_NAMES = 10;

// 8B.2.18.1 performance: detailed scenario GeoJSON is immutable for the life of
// the loaded object, so normalize its 4k+ feature records only once. WeakMap keeps
// scenario swaps safe: a new parsed FeatureCollection gets a new cache entry and
// the old one can be collected naturally.

// Long native territorial scans must not monopolize the browser main thread. The
// Stats pipeline is async already, so yield between bounded chunks and let map/UI
// rendering, input, and DevTools breathe while a large polity is prepared.
const throwIfAborted = (signal, label = "Background task cancelled.") => {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException(label, "AbortError");
};

const yieldToUiFrame = async (signal) => {
  throwIfAborted(signal);

  // scheduler.yield() is explicitly designed to let higher-priority UI/input work
  // run before this continuation. requestAnimationFrame + setTimeout is the portable
  // fallback and guarantees at least one paint opportunity before heavy work resumes.
  if (globalThis?.scheduler?.yield) {
    await globalThis.scheduler.yield();
  } else if (typeof requestAnimationFrame === "function") {
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0))
    );
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throwIfAborted(signal);
};

const statsYieldToMainThread = (signal) => yieldToUiFrame(signal);

// The native world director is pure CPU analysis (no writes, no AI call) that
// can take seconds on a large save. It runs in a module worker so the map keeps
// its frames, with a main-thread fallback when workers are unavailable.
let worldDirectorWorker = null;
let worldDirectorWorkerBroken = false;
let worldDirectorRequestId = 0;
const worldDirectorPending = new Map();

const getWorldDirectorWorker = () => {
  if (worldDirectorWorkerBroken || typeof Worker === "undefined") return null;
  if (worldDirectorWorker) return worldDirectorWorker;

  try {
    const worker = new Worker(
      new URL("./worldDirectorWorker.js", import.meta.url),
      { type: "module", name: "openhistoria-world-director" },
    );

    worker.onmessage = (event) => {
      const id = Number(event?.data?.id);
      const pending = worldDirectorPending.get(id);
      if (!pending) return;
      worldDirectorPending.delete(id);

      if (event?.data?.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event?.data?.result);
    };

    worker.onerror = (event) => {
      worldDirectorWorkerBroken = true;
      for (const pending of worldDirectorPending.values()) {
        pending.reject(new Error(event?.message || "Native World Director worker failed."));
      }
      worldDirectorPending.clear();
      worker.terminate();
      worldDirectorWorker = null;
    };

    worldDirectorWorker = worker;
    return worker;
  } catch {
    worldDirectorWorkerBroken = true;
    return null;
  }
};

const buildWorldInitiativeContextBackground = async (bundle, options = {}, signal) => {
  throwIfAborted(signal);
  const worker = getWorldDirectorWorker();

  if (!worker) {
    await yieldToUiFrame(signal);
    return buildWorldInitiativeContext(bundle, options);
  }

  const id = ++worldDirectorRequestId;

  try {
    return await new Promise((resolve, reject) => {
      const abort = () => {
        worldDirectorPending.delete(id);
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("World Director cancelled.", "AbortError"),
        );
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      worldDirectorPending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener?.("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener?.("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener?.("abort", abort, { once: true });
      worker.postMessage({ id, bundle, options });
    });
  } catch (error) {
    if (signal?.aborted) throw error;

    worldDirectorWorkerBroken = true;
    worldDirectorWorker?.terminate?.();
    worldDirectorWorker = null;
    console.warn(
      "[OH PERF] Native World Director worker unavailable; using main-thread fallback.",
      error,
    );
    await yieldToUiFrame(signal);
    return buildWorldInitiativeContext(bundle, options);
  }
};


// ---- Storyline motion repair (Continuum 07.2) -----------------------------
// A selected storyline that the accepted segment still left objectively
// unchanged past its anti-stasis backstop, or omitted from storylineUpdates,
// is repaired on its own: one narrow AI call that may only return that
// storyline's semantic movement. Unrelated events are never discarded, and a
// failed repair just leaves the process overdue for the next turn.
const WORLD_MOTION_REPAIR_HISTORY_LIMIT = 8;

const compactStorylineRepairHistory = (bundle, storyline) => {
  const id = normalizeString(storyline?.id);
  const participants = normalizeArray(storyline?.participants)
    .map(normalizeString)
    .filter(Boolean);
  const participantKeys = participants.map((name) => name.toLowerCase());

  return normalizeEvents(bundle?.events)
    .filter((event) => {
      if (normalizeArray(event?.storylineIds).map(normalizeString).includes(id)) return true;
      const haystack = `${event?.title || ""} ${event?.description || ""} ${normalizeArray(event?.combatants).join(" ")}`.toLowerCase();
      return participantKeys.some((key) => key.length >= 4 && haystack.includes(key));
    })
    .slice(-WORLD_MOTION_REPAIR_HISTORY_LIMIT)
    .map((event) => {
      const desc = normalizeString(event?.description).slice(0, 520);
      return `${normalizeString(event?.date) || "????-??-??"} — ${normalizeString(event?.title) || "Untitled"}${desc ? `\n${desc}` : ""}`;
    })
    .join("\n\n");
};

const runTargetedWorldMotionRepair = async ({
  bundle,
  issue,
  mainPassEvents = [],
  existingCausalEventIndex = -1,
  originDate,
  targetDate,
  signal,
} = {}) => {
  const prior = issue?.prior;
  const attempted = issue?.update;
  const storylineId = normalizeString(issue?.id || prior?.id);
  if (!prior || !storylineId) return null;

  const participants = normalizeArray(prior?.participants)
    .map(normalizeString)
    .filter(Boolean)
    .slice(0, 8);

  // Repair context used to dump ~4.2k chars PER participant plus 12 long event
  // summaries. The repair only decides one storyline's semantic movement, so keep
  // its evidence narrow. This is both cheaper and less likely to distract the model.
  const dossiers = await Promise.all(
    participants.map(async (name) => {
      try {
        const dossier = await buildTargetDossier(bundle, name);
        return `${name}:\n${normalizeString(dossier).slice(0, 1600) || "No additional dossier available."}`;
      } catch {
        return `${name}: no additional dossier available.`;
      }
    }),
  );

  const recentHistory =
    compactStorylineRepairHistory(bundle, prior) ||
    "No directly matched recent canonical events were found.";

  const existingCausalEvent =
    Number.isInteger(existingCausalEventIndex) &&
    existingCausalEventIndex >= 0 &&
    existingCausalEventIndex < normalizeArray(mainPassEvents).length
      ? normalizeArray(mainPassEvents)[existingCausalEventIndex]
      : null;

  const mainPassSummary = normalizeArray(mainPassEvents)
    .slice(0, 6)
    .map((event, index) =>
      `${index + 1}. ${normalizeString(event?.date)} — ${normalizeString(event?.title)}\n` +
      `${normalizeString(event?.description).slice(0, 420)}`
    )
    .join("\n\n") || "None.";

  const playerPolity = normalizeString(bundle?.game?.country) || "the player polity";
  const repairCause = issue?.kind === "missing-update"
    ? "was selected for native attention, but the accepted whole-world pass omitted its required semantic update"
    : "crossed its anti-stasis backstop after the accepted whole-world pass still left it objectively unchanged";

  let systemPrompt =
    `You are the TARGETED ENDOGENOUS MOTION REPAIR for OpenHistoria.\n\n` +
    `Repair EXACTLY ONE already-existing persistent storyline: ${storylineId}.\n` +
    `The normal whole-world pass remains the sole source of visible timeline events. ` +
    `You CANNOT create events, wars, relations, agreements, territory changes, units, chats, catalysts, Stats edits, or any other ledger mutation. ` +
    `Return exactly one semantic storyline object through the dedicated repair tool.\n\n` +
    `This storyline ${repairCause}. Decide what is true about THIS process at ${targetDate}. ` +
    `Do not merely paraphrase the old equilibrium. Numeric pressure/momentum changes must follow the returned state. ` +
    `Stalemate is legal when the state materially evolves in another dimension: readiness, logistics, command, morale, domestic politics, diplomacy, strategic objectives, preparation, restraint, or de-escalation.\n\n` +
    `Non-player actors are allowed to miscalculate, overreach, mobilize, bluff, radicalize, back down, split internally, or accept dangerous risk when current causes support it. ` +
    `Do not optimize every actor into caution. Do not invent chaos either.\n\n` +
    `PLAYER AGENCY: ${playerPolity} is human-controlled. Do not invent a NEW major sovereign/executive decision for ${playerPolity} unless already authorized by canon.\n\n` +
    `OUTPUT CONTRACT: call submit_world_motion_repair exactly once. stopDate MUST be ${targetDate}. ` +
    `storyline.id MUST be exactly ${storylineId}. Preserve the existing kind/title/startedDate unless current canon genuinely changes status. ` +
    `Participants are cumulative; include the current canonical participant set and any genuinely new participant, never delete a prior participant by omission.\n`;

  try {
    if (participants.some((name) => name.toLowerCase() === playerPolity.toLowerCase())) {
      const game = normalizeGameData(bundle?.game || {});
      systemPrompt += `\n${difficultyDirective(game.difficulty, "simulation")}\n`;
    }
  } catch {
    // Missing difficulty data leaves the repair neutral.
  }

  const userMessage = [
    `INTERVAL: ${originDate} → ${targetDate}`,
    `STAGNATION AGE AT STOP: ${Number(issue?.stagnationAgeDays) || 0} days`,
    "",
    "AUTHORITATIVE STORYLINE BEFORE THIS PASS:",
    JSON.stringify(prior, null, 2),
    "",
    issue?.kind === "missing-update"
      ? "WHOLE-WORLD PASS STORYLINE UPDATE: MISSING."
      : "WHOLE-WORLD PASS ATTEMPTED UPDATE (insufficient):",
    JSON.stringify(attempted || {}, null, 2),
    "",
    existingCausalEvent
      ? "MAIN-PASS CAUSAL EVENT ALREADY GENERATED AND NATIVELY LINKED — your storyline state MUST account for this event; do NOT recreate it:"
      : "NO MAIN-PASS CAUSAL EVENT WAS FOUND — repair hidden semantic state only; do not manufacture a visible event:",
    existingCausalEvent
      ? `${normalizeString(existingCausalEvent?.date)} — ${normalizeString(existingCausalEvent?.title)}\n${normalizeString(existingCausalEvent?.description)}`
      : "None.",
    "",
    "PARTICIPANT DOSSIERS (BOUNDED):",
    dossiers.join("\n\n"),
    "",
    "RECENT CANONICAL HISTORY RELEVANT TO THIS PROCESS:",
    recentHistory,
    "",
    "OTHER MAIN-PASS EVENTS THIS INTERVAL — CONTEXT ONLY:",
    mainPassSummary,
  ].join("\n");

  try {
    if (signal?.aborted) {
      throw signal.reason || new DOMException("Timeline jump cancelled.", "AbortError");
    }

    const timeoutMs = getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 120000 : 0;
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;

    logContextDiagnostics({
      attempt: 1,
      history: [{ role: "user", parts: [{ text: userMessage }] }],
      promptTemplate: systemPrompt,
      stage: "structured-request",
      systemPrompt,
      taskKey: "worldMotionRepair",
      userMessage,
      variables: { storylineId, originDate, targetDate },
    });

    const aiStartedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    let response;
    try {
      response = await callAI(systemPrompt, [
        { role: "user", parts: [{ text: userMessage }] },
      ], {
        deadline,
        reasoningEnabled: false,
        signal,
        taskKey: "worldMotionRepair",
        tool: getGameplayTool("worldMotionRepair"),
      });
    } catch (error) {
      const failedAt =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      recordTurnPerfAiAttempt({
        taskKey: "worldMotionRepair",
        attempt: 1,
        ms: Math.max(0, failedAt - aiStartedAt),
        error: normalizeString(error?.message || error),
      });
      throw error;
    }

    const aiEndedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    recordTurnPerfAiAttempt({
      taskKey: "worldMotionRepair",
      attempt: 1,
      ms: Math.max(0, aiEndedAt - aiStartedAt),
    });

    const rawText =
      typeof response === "string" ? response : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);

    const schemaValidation = validateGameplayPayload("worldMotionRepair", parsed);
    if (!schemaValidation.valid) {
      throw new Error(schemaValidation.error);
    }

    if (normalizeString(parsed?.stopDate) !== targetDate) {
      throw new Error(`repair stopDate must be exactly ${targetDate}`);
    }

    const rawUpdate = parsed?.storyline;
    if (normalizeString(rawUpdate?.id) !== storylineId) {
      throw new Error(`repair storyline id must be exactly ${storylineId}`);
    }

    const validationEvent = existingCausalEvent
      ? {
          ...existingCausalEvent,
          storylineIds: [...new Set([
            ...normalizeArray(existingCausalEvent?.storylineIds).map(normalizeString).filter(Boolean),
            storylineId,
          ])],
        }
      : null;

    const localUpdate = {
      ...rawUpdate,
      eventIndexes: validationEvent ? [0] : [],
    };

    const validationCandidate = {
      events: validationEvent ? [validationEvent] : [],
      storylineUpdates: [localUpdate],
      warUpdates: [],
      relationUpdates: [],
      agreementUpdates: [],
      stopDate: targetDate,
    };

    const storylineError = validateWorldStorylinePayload(validationCandidate, {
      existingStorylines: [prior],
      selectedStorylines: [prior],
      deferredStorylines: [],
      originDate,
      stopDate: targetDate,
      enforceAntiStasis: true,
      world: bundle?.world,
    });
    if (storylineError) throw new Error(storylineError);

    return {
      event: null,
      existingCausalEventIndex:
        validationEvent && Number.isInteger(existingCausalEventIndex)
          ? existingCausalEventIndex
          : -1,
      update: {
        ...rawUpdate,
        eventIndexes: [],
      },
      summary: normalizeString(parsed?.summary),
    };
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Timeline jump cancelled.", "AbortError");
    }
    console.warn(
      `[OH World Motion Repair] ${storylineId} failed: ` +
      `${normalizeString(error?.message || error) || "unknown error"}. ` +
      "Keeping the valid main world pass; this storyline remains overdue for the next turn.",
    );
    return null;
  }
};

const repairAntiStasisStorylines = async ({
  payload,
  bundle,
  analysis,
  originDate,
  targetDate,
  passMaxEvents,
  signal,
} = {}) => {
  const issues = findWorldStorylineAntiStasisIssues(payload, {
    existingStorylines: bundle?.world?.storylines,
    selectedStorylines: analysis?.attentionStorylines,
    originDate,
    stopDate: normalizeString(payload?.stopDate) || targetDate,
    world: bundle?.world,
  });
  if (!issues.length) return { repaired: 0, failed: 0, issues: [] };

  let events = normalizeArray(payload?.events);
  let updates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
  let repaired = 0;
  let failed = 0;

  console.warn(
    `[OH World Motion Repair] ${issues.length} selected storyline repair issue(s): ` +
    issues.map((issue) =>
      issue?.kind === "missing-update"
        ? `${issue.id} (missing semantic update)`
        : `${issue.id} (${issue.stagnationAgeDays}d anti-stasis)`
    ).join(", "),
  );

  for (const issue of issues) {
    const issueId = normalizeString(issue?.id);
    const existingCausalEventIndex = (() => {
      let best = -1;
      events.forEach((event, index) => {
        if (normalizeArray(event?.storylineIds).map(normalizeString).includes(issueId)) {
          best = index;
        }
      });
      return best;
    })();

    const repair = await runTargetedWorldMotionRepair({
      bundle,
      issue,
      mainPassEvents: events,
      existingCausalEventIndex,
      originDate,
      targetDate,
      signal,
    });

    // Remove the insufficient copy-forward either way. If repair fails this keeps
    // the canonical storyline's old accounted/review dates intact, so it remains
    // immediately overdue next turn instead of being silently pushed forward.
    updates = updates.filter((entry) => normalizeString(entry?.id) !== normalizeString(issue.id));

    if (!repair) {
      failed += 1;
      continue;
    }

    if (repair.event) events = [...events, repair.event];

    const repairedEventIndexes =
      Number.isInteger(repair.existingCausalEventIndex) &&
      repair.existingCausalEventIndex >= 0 &&
      repair.existingCausalEventIndex < events.length
        ? [repair.existingCausalEventIndex]
        : [];

    updates.push({
      ...repair.update,
      eventIndexes: repairedEventIndexes,
    });
    repaired += 1;

    console.info(
      `[OH World Motion Repair] repaired ${issue.id}: ` +
      `${repairedEventIndexes.length ? "semantic state bound to existing main-pass event" : "hidden objective evolution"}.`,
    );
  }

  payload.events = events;
  // Internal transport may be object records after schema validation; the native
  // decoder explicitly supports this form and preserves exact event-index offsets.
  payload.storylineUpdates = updates;

  return { repaired, failed, issues };
};

// ---- Post-curation breadth repair (Continuum 08.3.1) -----------------------
// The jump owns player consequences, focused storylines, wars and the obvious
// causal developments. After curation, a month-scale jump left with only a few
// worthwhile events is still suspiciously shallow: breadth is recomputed from
// what SURVIVED, and one bounded second search runs over the exploration lanes
// still quiet. Not a quota: every supplemental event passes the integrity
// screen and the curator, and a quiet world may return none.
const WORLD_BREADTH_REPAIR_MIN_DAYS = 21;
const WORLD_BREADTH_REPAIR_MAX_DAYS = 40;
const WORLD_BREADTH_REPAIR_TRIGGER_MAX_SURVIVORS = 3;
const WORLD_BREADTH_REPAIR_MIN_EXPLORATION_SLOTS = 6;
const WORLD_BREADTH_REPAIR_MIN_QUIET_SLOTS = 2;
const WORLD_BREADTH_REPAIR_EVENT_LIMIT = 5;
const WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS = 6;
const WORLD_BREADTH_REPAIR_HISTORY_LIMIT = 12;
const quietWorldBreadthSlots = (analysis, explorationAudit) => {
  const quietIds = new Set(
    normalizeArray(explorationAudit?.quietSlotIds)
      .map(Number)
      .filter(Number.isInteger),
  );
  if (!quietIds.size) return [];
  return normalizeArray(analysis?.explorationSlate)
    .filter((slot) => quietIds.has(Number(slot?.id)));
};

const postCuratorWorldBreadthSlots = ({ analysis, survivingEvents, bundle } = {}) => {
  // Visible breadth must be measured from visible survivors. A raw candidate that
  // Integrity/Curator rejected, or a hidden storyline/ledger update, must not make
  // an exploration lane look visually occupied. This was the main reason 08.2 could
  // re-check only 2/8 slots after the user actually received one worthwhile event.
  const audit = deriveWorldExplorationAudit(
    {
      events: normalizeArray(survivingEvents),
      storylineUpdates: [],
      diplomaticOutreach: [],
      warUpdates: [],
      relationUpdates: [],
      agreementUpdates: [],
    },
    analysis,
    {
      world: bundle?.world || {},
      gameCountry: bundle?.game?.country,
    },
  );

  const quiet = quietWorldBreadthSlots(analysis, audit);
  if (quiet.length <= WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS) {
    return { audit, slots: quiet };
  }

  // R3.5: when many lanes are quiet, the bounded second search should not fall
  // straight back into the player's neighborhood just because those actor rows
  // carry high relevance scores. Reserve roughly half of the re-check capacity for
  // WIDER-WORLD lanes, with the explicit crisis-discovery lane first when quiet.
  // This is still an evaluation budget, not an output quota.
  const rankSlot = (a, b) => {
    const aCrisis = a?.type === "crisis-discovery" ? 1 : 0;
    const bCrisis = b?.type === "crisis-discovery" ? 1 : 0;
    return (bCrisis - aCrisis) ||
      ((Number(b?.relevance) || 0) - (Number(a?.relevance) || 0)) ||
      (Number(a?.id) || 0) - (Number(b?.id) || 0);
  };

  const playerSphereSlots = quiet
    .filter((slot) => slot?.scope === "player-sphere")
    .sort(rankSlot);
  const widerWorldSlots = quiet
    .filter((slot) => slot?.scope !== "player-sphere")
    .sort(rankSlot);

  const selected = [];
  const targetWider = Math.min(
    widerWorldSlots.length,
    Math.ceil(WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS / 2),
  );
  const targetPlayer = Math.min(
    playerSphereSlots.length,
    WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS - targetWider,
  );

  selected.push(...widerWorldSlots.slice(0, targetWider));
  selected.push(...playerSphereSlots.slice(0, targetPlayer));

  for (const slot of [...widerWorldSlots.slice(targetWider), ...playerSphereSlots.slice(targetPlayer)]) {
    if (selected.length >= WORLD_BREADTH_REPAIR_MAX_RECHECK_SLOTS) break;
    if (!selected.some((entry) => Number(entry?.id) === Number(slot?.id))) selected.push(slot);
  }

  return { audit, slots: selected };
};

const compactBreadthRepairHistory = (bundle) =>
  normalizeEvents(bundle?.events)
    .slice(-WORLD_BREADTH_REPAIR_HISTORY_LIMIT)
    .map((event) => {
      const desc = normalizeString(event?.description).slice(0, 520);
      return `${normalizeString(event?.date) || "????-??-??"} — ${normalizeString(event?.title) || "Untitled"}${desc ? `\n${desc}` : ""}`;
    })
    .join("\n\n");

const runWorldBreadthRepair = async ({
  bundle,
  analysis,
  quietSlots,
  mainEvents,
  visibleEvents = mainEvents,
  originDate,
  targetDate,
  horizonDays,
  eventAllowance,
  survivorCount = 0,
  consequenceSignal = null,
  signal,
} = {}) => {
  const maxEvents = Math.max(0, Math.min(
    WORLD_BREADTH_REPAIR_EVENT_LIMIT,
    Number(eventAllowance) || 0,
  ));
  if (!quietSlots.length || maxEvents <= 0) return null;

  const existingPassEvents = normalizeArray(mainEvents);
  const existingPassSummary = existingPassEvents
    .slice(0, 6)
    .map((event, index) => `${index + 1}. ${normalizeString(event?.date)} — ${normalizeString(event?.title)}\n${normalizeString(event?.description).slice(0, 450)}`)
    .join("\n\n") || "None.";

  const classifyVisibleScope = createWorldEventScopeClassifier(analysis, {
    world: bundle?.world || {},
    gameCountry: bundle?.game?.country,
  });
  const visibleScopeCounts = normalizeArray(visibleEvents).reduce(
    (counts, event) => {
      const scope = classifyVisibleScope(event);
      counts[scope] = (counts[scope] || 0) + 1;
      return counts;
    },
    { "player-sphere": 0, "wider-world": 0, unknown: 0 },
  );
  const underrepresentedVisibleScope =
    visibleScopeCounts["player-sphere"] + 1 < visibleScopeCounts["wider-world"]
      ? "PLAYER-SPHERE"
      : visibleScopeCounts["wider-world"] + 1 < visibleScopeCounts["player-sphere"]
        ? "WIDER-WORLD"
        : "BALANCED/NEAR-BALANCED";

  const actorNames = [...new Set(
    quietSlots
      .filter((slot) =>
        slot?.type === "actor-domain" ||
        (slot?.type === "crisis-discovery" && normalizeString(slot?.targetActor || slot?.actor))
      )
      .map((slot) => normalizeString(slot?.targetActor || slot?.actor))
      .filter((name) => name && !/latent instability|regional system|wider world system/i.test(name)),
  )].slice(0, 5);

  const dossiers = await Promise.all(
    actorNames.map(async (name) => {
      try {
        const text = await buildTargetDossier(bundle, name);
        return `${name}:\n${normalizeString(text).slice(0, 1600) || "No additional dossier available."}`;
      } catch {
        return `${name}: no additional dossier available.`;
      }
    }),
  );

  const playerPolity = normalizeString(bundle?.game?.country) || "the player polity";
  const canonicalWarContext = buildCanonicalWarContext(bundle?.world);
  const diplomaticContext = buildBoundedDiplomaticContext(bundle?.world || {}, {
    playerPolity,
    focusActors: actorNames,
    selectedStorylines: [],
    maxActors: 8,
  });
  const recentHistory = compactBreadthRepairHistory(bundle) || "No recent canonical events are available.";
  const currentStorylineTitles = normalizeArray(bundle?.world?.storylines)
    .filter((storyline) => normalizeString(storyline?.status).toLowerCase() !== "resolved")
    .slice(0, 24)
    .map((storyline) => `${normalizeString(storyline?.id)} — ${normalizeString(storyline?.title)}`)
    .join("\n") || "None.";

  const slotLines = quietSlots.map((slot) => {
    const guard = normalizeArray(slot?.deferredTopics).length
      ? ` Deferred process(es) to avoid routine restatement of: ${normalizeArray(slot.deferredTopics).join("; ")}.`
      : "";
    const basis = normalizeString(slot?.basis)
      ? ` Current native basis: ${normalizeString(slot.basis)}.`
      : " No specific present-tense pressure was identified; inspect latent causes conservatively.";
    const scope = slot?.scope === "player-sphere" ? "PLAYER-SPHERE" : "WIDER-WORLD";
    const crisisTag = slot?.type === "crisis-discovery" ? " | CRISIS-DISCOVERY" : "";
    const trajectoryTag = Number(slot?.trajectoryValue) > 0
      ? ` | native trajectory ${Number(slot.trajectoryValue)}/5`
      : "";
    const channels = normalizeArray(slot?.consequenceChannels).length
      ? ` Potential consequence channels if threshold is genuinely crossed: ${normalizeArray(slot.consequenceChannels).join(", ")}.`
      : "";
    return `${slot.id}. [${scope}${crisisTag}${trajectoryTag}] ${normalizeString(slot?.actor)} — inspect ${normalizeString(slot?.domain)}.${basis}${channels}${guard}`;
  });

  let systemPrompt = `You are the NORMAL-MONTH WORLD COMPOSITION PASS for OpenHistoria, an alternate-history strategy simulation.\n\n` +
    `The primary whole-world pass for ${originDate} → ${targetDate} (${Math.round(Number(horizonDays) || 0)} days) was valid, but after Integrity and semantic Curator only ${Math.max(0, Number(survivorCount) || 0)} worthwhile visible event(s) remain. You are NOT replacing those events, NOT retrying the whole world, and NOT satisfying an event quota. Search the supplied exploration lanes that remain visibly neglected AFTER curation.\n\n` +
    `Evaluate EVERY supplied lane before finalizing. Do not stop after finding the first or second acceptable event if other supplied lanes also contain independent, concrete developments. Return ZERO events if all lanes are genuinely quiet; otherwise return each independently worthwhile outcome you actually find, up to the local ceiling. The purpose is broader discovery, not calendar padding. Small but concrete history is legitimate: domestic politics, industry, science/technology, social movements, institutions, public life, culture, personalities, accidents/disasters, economic decisions, regional developments, and informal diplomacy can all matter without being world-shattering.\n\n` +
    `ATTENTION BALANCE: PLAYER-SPHERE and WIDER-WORLD are scheduler scopes, not event quotas. The native slate is constructed around a 5/5 attention balance. The currently surviving visible set is ${visibleScopeCounts["player-sphere"]} PLAYER-SPHERE / ${visibleScopeCounts["wider-world"]} WIDER-WORLD / ${visibleScopeCounts.unknown} unclassified. Underrepresented visible scope: ${underrepresentedVisibleScope}. Give both serious search effort. When similarly worthwhile candidates compete for a scarce visible slot, prefer the underrepresented visible scope; do not fill the month with several same-texture player-neighborhood consultations or several disconnected global ministry cards merely to hit a ratio.\n\n` +
    `TRAJECTORY PRIORITY: Compare independently grounded candidates by what they open up next, not merely by how easy they are to summarize. Native trajectory value is a 0-5 selection hint: 0 isolated reporting/process; 1 low-branch administrative motion; 2 settled/material ordinary outcome; 3 capability or political change with meaningful next actions; 4 unstable process with several materially different branches; 5 threshold/breakpoint process. This is NOT a drama quota. Never fabricate a 4/5. But when event space is scarce, a grounded trajectory-4/5 development should normally outrank another trajectory-0/1 ministry report, routine framework, or successful implementation milestone.\n\n` +
    `CRISIS DISCOVERY: If a CRISIS-DISCOVERY lane is supplied, it is a PROTECTED evaluation lane, not an event quota. Evaluate it independently before finalizing even if other slots already yielded acceptable cards. When native current evidence names a target actor/trigger, test THAT concrete pressure first rather than replacing it with a random dramatic country. Crisis does NOT mean war: constitutional breakdown, succession struggle, separatism/federal rupture, mass unrest, coup risk, banking/debt panic, alliance fracture, resource shock, border/security standoff or sanctions spiral can all have major consequences without shooting. If nothing crosses a threshold, return quiet AND do not substitute a low-trajectory administrative card as though it satisfied the crisis lane. If a crisis genuinely begins, its establishing event must be concrete and create a NEW storyline whose state identifies the trigger, unresolved stakes, and at least two plausible consequence channels. Under a shared event ceiling, an earned new crisis outranks a trajectory-0/1 administrative card.\n\n` +
    `OUTCOME-FIRST DISCIPLINE: Prefer completed facts and observable results over process. A meeting, review, study, procurement discussion, inspection, exercise, doctrine/planning session, or preliminary inquiry is normally NOT a visible event merely because officials performed it. Return it only when this interval produces a concrete adopted decision, funded order, fielded capability, command change, casualty/accident, deployment, completed project, demonstrated finding, prototype, licensed process, production step, or another observable consequence. Do not inflate process into significance.\n\n` +
    `${consequenceSignal?.level === "low" ? `CONSEQUENCE-AWARE SEARCH BIAS: The rolling visible timeline is busy but unusually low in material threshold outcomes (${Math.max(0, Number(consequenceSignal?.consequentialCount) || 0)}/${Math.max(0, Number(consequenceSignal?.eventCount) || 0)} over ~${Math.max(1, Number(consequenceSignal?.lookbackDays) || 90)} days). While evaluating THESE SAME neglected lanes, first ask whether any already-grounded pressure has matured into a real threshold outcome — a vote/result, resignation/appointment, strike/settlement, completed capability, decisive commercial/financial action, crisis escalation/de-escalation, or other development that materially changes what actors can do next. This is search ordering, NOT a requirement for drama. If no grounded threshold has matured, return ordinary concrete history or nothing rather than fabricating one.\n\n` : ""}` +
    `PHYSICAL-WORLD CONSEQUENCE AUDIT: For EACH event you decide is independently timeline-worthy, silently ask whether that event establishes a significant named geographically concrete physical facility/place that will persist beyond the event. If YES, that same event MUST carry an impacts.markerOps build with real coordinates and a lifecycle status that matches the event (planned, under_construction, or active; do not call a groundbreaking project active). Examples include a major new factory/arsenal, naval yard or port facility, logistics hub, laboratory, fortification, headquarters/base or airfield. Do not create markers for routine activity, generic offices, unnamed workshops, ordinary maintenance or mere continuation. This is NOT a marker quota and is NEVER a reason to invent an event. This narrow breadth-repair pass is not given the full current-feature ledger, so do not guess updates to existing markers; leave existing-feature lifecycle changes to the primary simulation unless an exact stable marker id is explicitly supplied in the evidence.\n\n` +
    `BELLIGERENCY / CAUSALITY DISCIPLINE: Treat the CURRENT CANONICAL WARS section below as authoritative. Do not describe a non-belligerent polity as having a wartime economy, wartime rationing, wartime production, war shortages, mobilization, or home-front controls merely because wars exist elsewhere. For a non-belligerent, such pressure is valid only when THIS campaign supplies an independent cause such as explicit preparedness/contingency policy or genuine foreign-war spillover (for example disrupted trade/imports/shipping, sanctions, refugees, or border disruption). If that cause is absent, find a different grounded development or return nothing.\n\n` +
    `ERA / WAR CALIBRATION: ${analysis?.conflictRiskPosture?.label || "campaign-state conflict risk unknown"}. ${analysis?.conflictRiskPosture?.guidance || "Use current causal evidence rather than assuming either peace or war."} The calendar year is only one contextual prior. A modern date never makes war impossible; an early-20th-century date never makes war automatic. This breadth pass itself cannot declare war, but it may discover the concrete crisis pressure that could later lead there.\n\n` +
    `BAD SEARCH RESULTS: “the general staff reviews artillery procurement” with no adopted outcome; “an institute studies substitutes because of wartime shortages” for a polity that is not at war. BETTER: an order is actually adopted/funded, a capability enters production/service, or research reaches a concrete demonstrated result grounded in the campaign.\n\n` +
    `Do NOT repeat or paraphrase events already generated by the main pass. Do NOT service an existing persistent storyline merely because it exists; selected/deferred processes were handled by the primary simulation and anti-stasis machinery. If a supplied quiet slot independently creates a genuinely NEW unresolved process, you may create a NEW storyline linked to that event. Do not update an existing storyline id.\n\n` +
    `This narrow repair cannot declare/join/end a war, sign/ratify/suspend/end a formal agreement, or mutate bilateral relation ledgers. Those high-consequence ledger transitions belong to the primary whole-world pass. If a quiet-slot search points toward such a development, prefer the preceding concrete pressure/initiative only when it is independently timeline-worthy; otherwise return nothing rather than half-canonizing a treaty or war.\n\n` +
    `PLAYER AGENCY: ${playerPolity} is human-controlled. Autonomous private/social/local actors and limited officials may create circumstances, pressure, proposals, unrest, research, scandals, local actions, or public movements inside it. Do not make a NEW major sovereign/executive choice for ${playerPolity}.\n\n` +
    `OUTPUT CONTRACT: call the normal jump-result tool once. stopDate=${targetDate}. clearActions=false. catalyst=null. diplomaticOutreach must be empty. warUpdates, relationUpdates and agreementUpdates must be empty strings. Return at most ${maxEvents} visible event(s), but there is NO minimum and no preferred exact count. Search all supplied lanes first, then return every independently worthwhile, date-valid outcome you found up to the ceiling. storylineUpdates may contain only NEW storyline ids created by a returned event, never an existing storyline.\n`;

  try {
    const game = normalizeGameData(bundle?.game || {});
    systemPrompt += `\n${difficultyDirective(game.difficulty, "simulation")}\n`;
  } catch {
    // Difficulty failure leaves the breadth repair neutral rather than blocking it.
  }

  const userMessage = [
    `INTERVAL: ${originDate} → ${targetDate}`,
    `LOCAL EVENT CEILING: ${maxEvents} (ceiling only; zero is valid)`,
    `ROLLING CONSEQUENCE SIGNAL: ${consequenceSignal?.level === "low" ? "LOW — prioritize mature threshold outcomes where causally earned" : "normal"} (${Math.max(0, Number(consequenceSignal?.consequentialCount) || 0)}/${Math.max(0, Number(consequenceSignal?.eventCount) || 0)} threshold events across ~${Math.max(1, Number(consequenceSignal?.lookbackDays) || 90)}d)`,
    `CURRENT VISIBLE SCOPE BALANCE: ${visibleScopeCounts["player-sphere"]} PLAYER-SPHERE / ${visibleScopeCounts["wider-world"]} WIDER-WORLD / ${visibleScopeCounts.unknown} unclassified; underrepresented=${underrepresentedVisibleScope}`,
    "",
    "POST-CURATOR NEGLECTED EXPLORATION LANES — evaluate ALL of these:",
    slotLines.join("\n"),
    "",
    "EVENTS ALREADY GENERATED BY THE MAIN PASS — DO NOT DUPLICATE:",
    existingPassSummary,
    "",
    "EXISTING PERSISTENT STORYLINES — DO NOT SERVICE OR UPDATE THESE IDS:",
    currentStorylineTitles,
    "",
    "CURRENT CANONICAL WARS (authoritative belligerency context only; no ledger mutation in this repair):",
    canonicalWarContext || "None recorded.",
    "",
    "BOUNDED DIPLOMATIC CONTEXT:",
    diplomaticContext?.text || "No bounded diplomatic context available.",
    "",
    "QUIET-SLOT ACTOR DOSSIERS:",
    dossiers.join("\n\n") || "No actor-specific dossiers were required.",
    "",
    "RECENT CANONICAL EVENTS — use only to avoid repetition and respect branch state:",
    recentHistory,
  ].join("\n");

  try {
    if (signal?.aborted) throw signal.reason || new DOMException("Timeline jump cancelled.", "AbortError");
    const timeoutMs = getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? 180000 : 0;
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : null;

    logContextDiagnostics({
      attempt: 1,
      history: [{ role: "user", parts: [{ text: userMessage }] }],
      promptTemplate: systemPrompt,
      stage: "structured-request",
      systemPrompt,
      taskKey: "worldBreadthRepair",
      userMessage,
      variables: {
        originDate,
        targetDate,
        horizonDays,
        quietSlotIds: quietSlots.map((slot) => slot.id),
        consequenceSignal,
      },
    });

    const breadthAiStartedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    let response;
    try {
      response = await callAI(systemPrompt, [
        { role: "user", parts: [{ text: userMessage }] },
      ], {
        deadline,
        signal,
        taskKey: "worldBreadthRepair",
        tool: getGameplayTool("jumpForward"),
      });
    } catch (error) {
      const breadthAiFailedAt =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      recordTurnPerfAiAttempt({
        taskKey: "worldBreadthRepair",
        attempt: 1,
        ms: Math.max(0, breadthAiFailedAt - breadthAiStartedAt),
        error: normalizeString(error?.message || error),
      });
      throw error;
    }
    const breadthAiEndedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    recordTurnPerfAiAttempt({
      taskKey: "worldBreadthRepair",
      attempt: 1,
      ms: Math.max(0, breadthAiEndedAt - breadthAiStartedAt),
    });

    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("breadth repair response did not contain a structured jump payload");
    }

    parsed.clearActions = false;
    parsed.catalyst = null;
    parsed.diplomaticOutreach = [];

    const schemaValidation = validateGameplayPayload("jumpForward", parsed);
    if (!schemaValidation.valid) throw new Error(schemaValidation.error);

    if (sortTimelineEventsChronologically(parsed)) {
      console.info(
        `[OH timeline order R3.6] sorted ${normalizeArray(parsed?.events).length} breadth candidate(s) chronologically without a retry.`,
      );
    }

    const repairEvents = normalizeArray(parsed.events);
    if (repairEvents.length > maxEvents) {
      throw new Error(`breadth repair returned ${repairEvents.length} event(s), above its local ceiling ${maxEvents}`);
    }

    if (
      normalizeArray(parsed.warUpdates).length ||
      normalizeArray(parsed.relationUpdates).length ||
      normalizeArray(parsed.agreementUpdates).length
    ) {
      throw new Error("breadth repair attempted to mutate war/relation/agreement ledgers");
    }

    // R3.8: Crisis Discovery may correctly create a new process but forget the
    // mechanical eventIndexes seam. Bind only a strong, unambiguous NEW-storyline
    // match; ambiguity still fails closed below. No extra AI call is involved.
    const newStorylineBinding = bindNewStorylineEvents(parsed, {
      existingStorylines: bundle?.world?.storylines,
      world: bundle?.world,
    });
    if (newStorylineBinding.bound) {
      console.info(
        `[OH World Breadth Crisis Binding R3.8] attached ${newStorylineBinding.bound} new storyline(s) to ` +
        `their uniquely matching returned event(s).`,
      );
    }

    const decodedStorylines = decodeWorldStorylineUpdates(parsed.storylineUpdates);
    const existingStorylineIds = new Set(
      normalizeArray(bundle?.world?.storylines)
        .map((storyline) => normalizeString(storyline?.id))
        .filter(Boolean),
    );
    for (const update of decodedStorylines) {
      const id = normalizeString(update?.id);
      if (existingStorylineIds.has(id)) {
        throw new Error(`breadth repair attempted to update existing storyline ${id}`);
      }
      if (!normalizeArray(update?.eventIndexes).length) {
        throw new Error(`new breadth storyline ${id || "<missing id>"} must link to a returned event`);
      }
    }

    if (!repairEvents.length) {
      if (decodedStorylines.length) {
        throw new Error("breadth repair returned storyline updates without a visible event");
      }
      return {
        events: [],
        storylineUpdates: [],
        quietSlots,
      };
    }

    const dateError = validateTimelineDates({
      candidate: parsed,
      mode: "jump",
      originDate,
      targetDate,
      requireAdvance: true,
    });
    if (dateError) throw new Error(dateError);

    const storylineError = validateWorldStorylinePayload(parsed, {
      existingStorylines: bundle?.world?.storylines,
      selectedStorylines: [],
      deferredStorylines: [],
      originDate,
      stopDate: normalizeString(parsed.stopDate) || targetDate,
      enforceAntiStasis: false,
      world: bundle?.world,
    });
    if (storylineError) throw new Error(storylineError);

    const worldChangeError = await validateGeneratedWorldChanges(
      parsed,
      bundle?.world,
      { strictTransfers: false },
    );
    if (worldChangeError) throw new Error(worldChangeError);

    return {
      events: repairEvents,
      storylineUpdates: decodedStorylines,
      quietSlots,
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Timeline jump cancelled.", "AbortError");
    console.warn(
      `[OH World Breadth Repair] failed: ${normalizeString(error?.message || error) || "unknown error"}. ` +
      "Keeping the valid main world pass unchanged.",
    );
    return null;
  }
};

const maybeRepairWorldBreadthAfterCuration = async ({
  survivingEvents,
  mainEvents,
  bundle,
  context,
  mode = "jump",
  signal,
} = {}) => {
  const analysis = context?.analysis;
  const slate = normalizeArray(analysis?.explorationSlate);
  const postCuratorBreadth = postCuratorWorldBreadthSlots({
    analysis,
    survivingEvents,
    bundle,
  });
  const quietSlots = normalizeArray(postCuratorBreadth?.slots);
  const days = Number(context?.horizonDays) || 0;
  const survivorCount = normalizeArray(survivingEvents).length;
  const eventCeiling = Math.max(0, Number(context?.eventCeiling) || 0);
  const available = Math.max(0, eventCeiling - survivorCount);
  const consequenceSignal = assessRecentWorldConsequenceLiveness({
    events: bundle?.events,
    additionalEvents: survivingEvents,
    referenceDate: normalizeString(context?.targetDate),
  });
  const sparseTrigger = survivorCount <= WORLD_BREADTH_REPAIR_TRIGGER_MAX_SURVIVORS;
  // Same composition pass, no extra AI layer: a busy-but-toothless rolling window
  // may also justify searching the still-neglected lanes. Keep this bounded so a
  // healthy 7-10 event month never receives gratuitous padding.
  const consequenceTrigger =
    consequenceSignal.level === "low" &&
    survivorCount <= Math.min(6, Math.max(0, eventCeiling - 1));

  const eligible =
    mode === "jump" &&
    normalizeString(context?.generationSource || "ai") === "ai" &&
    days >= WORLD_BREADTH_REPAIR_MIN_DAYS &&
    days <= WORLD_BREADTH_REPAIR_MAX_DAYS &&
    (sparseTrigger || consequenceTrigger) &&
    slate.length >= WORLD_BREADTH_REPAIR_MIN_EXPLORATION_SLOTS &&
    quietSlots.length >= WORLD_BREADTH_REPAIR_MIN_QUIET_SLOTS &&
    available > 0;

  if (!eligible) {
    return {
      triggered: false,
      events: [],
      storylineUpdates: [],
      analysis,
      survivorCount,
      quietSlotCount: quietSlots.length,
      consequenceSignal,
    };
  }

  const compositionReason = sparseTrigger
    ? `${survivorCount} worthwhile visible event(s) survived Curator across ${Math.round(days)}d`
    : `${survivorCount} worthwhile visible event(s) survived, but rolling consequence signal is LOW (${consequenceSignal.consequentialCount}/${consequenceSignal.eventCount} threshold events)`;
  console.warn(
    `[OH World Composition 08.3.1] ${compositionReason}; ` +
    `searching ${quietSlots.length}/${slate.length} exploration lane(s) still visibly neglected after curation. ` +
    "This is the existing composition pass with consequence-aware search ordering, not an event/drama quota.",
  );

  const repair = await runWorldBreadthRepair({
    bundle,
    analysis,
    quietSlots,
    mainEvents: normalizeArray(mainEvents),
    visibleEvents: normalizeArray(survivingEvents),
    originDate: normalizeString(context?.originDate),
    targetDate: normalizeString(context?.targetDate),
    horizonDays: days,
    eventAllowance: available,
    survivorCount,
    consequenceSignal,
    signal,
  });

  if (!repair) {
    return {
      triggered: true,
      failed: true,
      events: [],
      storylineUpdates: [],
      analysis,
      survivorCount,
      quietSlotCount: quietSlots.length,
      consequenceSignal,
    };
  }

  console.info(
    `[OH World Composition 08.3.1] search completed: ${normalizeArray(repair.events).length} supplemental candidate(s) from ` +
    `${repair.quietSlots?.length || quietSlots.length} post-Curator neglected exploration lane(s).`,
  );

  return {
    triggered: true,
    failed: false,
    events: normalizeArray(repair.events),
    storylineUpdates: normalizeArray(repair.storylineUpdates),
    analysis,
    survivorCount,
    quietSlotCount: quietSlots.length,
    consequenceSignal,
  };
};

// Storyline ids ride on the events they establish (event.storylineIds); that
// is how applyWorldStorylineUpdates links a record to canonical history.
const attachStorylineIdsByIndexes = (events, decodedStorylineUpdates) => {
  const resultEvents = normalizeArray(events).map((event) => ({
    ...(event && typeof event === "object" ? event : {}),
    storylineIds: normalizeArray(event?.storylineIds),
  }));

  for (const update of normalizeArray(decodedStorylineUpdates)) {
    const storylineId = normalizeString(update?.id);
    if (!storylineId) continue;
    for (const eventIndex of normalizeArray(update?.eventIndexes)) {
      if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= resultEvents.length) continue;
      resultEvents[eventIndex].storylineIds = [...new Set([
        ...normalizeArray(resultEvents[eventIndex].storylineIds).map(normalizeString).filter(Boolean),
        storylineId,
      ])].slice(0, 6);
    }
  }

  return resultEvents;
};

const attachDecodedStorylineIds = (events, decodedStorylineUpdates, passLabel = "pass") =>
  attachStorylineIdsByIndexes(
    normalizeArray(events).map((event, index) => ({
      ...(event && typeof event === "object" ? event : {}),
      // Unique internal ids prevent same-index events from different passes from
      // collapsing into one generated-event-N during the final canonical apply.
      id: `${passLabel}-${normalizeString(event?.id) || `event-${index + 1}`}`,
    })),
    decodedStorylineUpdates,
  );

const filterStorylineUpdatesAfterIntegrityScreen = ({
  updates,
  allEvents,
  existingStorylines,
  dropped,
} = {}) => {
  const existingIds = new Set(
    normalizeArray(existingStorylines)
      .map((entry) => normalizeString(entry?.id))
      .filter(Boolean),
  );

  const fatalDroppedIds = new Set(
    normalizeArray(dropped)
      .filter((entry) =>
        ["NON_BELLIGERENT_WARTIME_CAUSALITY"].includes(
          normalizeString(entry?.route),
        )
      )
      .map((entry) => normalizeString(entry?.id))
      .filter(Boolean),
  );

  if (!fatalDroppedIds.size) return normalizeArray(updates);

  const fatalIndexes = new Set();
  normalizeArray(allEvents).forEach((event, index) => {
    if (fatalDroppedIds.has(normalizeString(event?.id))) {
      fatalIndexes.add(index);
    }
  });

  return normalizeArray(updates).filter((update) => {
    const id = normalizeString(update?.id);
    if (!id || existingIds.has(id)) return true;

    const indexes = normalizeArray(update?.eventIndexes)
      .filter((index) => Number.isInteger(index) && index >= 0);

    if (!indexes.length) return true;

    // A NEW storyline whose only establishing event(s) were rejected for an
    // objective causal impossibility must not survive invisibly and poison the
    // next pass. Existing selected storylines are intentionally preserved so
    // routine no-delta cards can collapse into hidden state updates.
    return !indexes.every((index) => fatalIndexes.has(index));
  });
};


let countryStatsWorker = null;
let countryStatsWorkerBroken = false;
let countryStatsWorkerRequestId = 0;
const countryStatsWorkerPending = new Map();

const resetCountryStatsWorker = ({ broken = false, reason = null } = {}) => {
  if (broken) countryStatsWorkerBroken = true;
  countryStatsWorker?.terminate?.();
  countryStatsWorker = null;

  for (const pending of countryStatsWorkerPending.values()) {
    pending.reject(
      reason instanceof Error
        ? reason
        : new DOMException("Country Stats worker stopped.", "AbortError"),
    );
  }
  countryStatsWorkerPending.clear();
};

const getCountryStatsWorker = () => {
  if (countryStatsWorkerBroken || typeof Worker === "undefined") return null;
  if (countryStatsWorker) return countryStatsWorker;

  try {
    const worker = new Worker(
      new URL("./countryStatsWorker.js", import.meta.url),
      { type: "module", name: "openhistoria-country-stats" },
    );

    worker.onmessage = (event) => {
      const id = Number(event?.data?.id);
      const pending = countryStatsWorkerPending.get(id);
      if (!pending) return;
      countryStatsWorkerPending.delete(id);

      if (event?.data?.error) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve({
          ...event?.data?.result,
          workerTimings:
            event?.data?.timings && typeof event.data.timings === "object"
              ? event.data.timings
              : {},
        });
      }
    };

    worker.onerror = (event) => {
      resetCountryStatsWorker({
        broken: true,
        reason: new Error(event?.message || "Country Stats worker failed."),
      });
    };

    countryStatsWorker = worker;
    return worker;
  } catch {
    countryStatsWorkerBroken = true;
    return null;
  }
};

const buildCountryStatsPreparationBackground = async (
  bundle,
  code,
  normalizedWorld,
  { signal, forceReassess = false } = {},
) => {
  throwIfAborted(signal);

  // R2.39: do NOT prepare or clone the scenario/world payload on the UI thread.
  // The worker fetches/parses its own runtime JSON using the active tokenized URLs.
  throwIfAborted(signal);
  const worker = getCountryStatsWorker();

  if (!worker) {
    await yieldToUiFrame(signal);
    const territorialBasis = await buildTargetStatsTerritorialBasis(
      bundle,
      code,
      normalizedWorld,
      { signal },
    );
    const dossier = await buildTargetDossier(bundle, code, normalizedWorld);
    return {
      territorialBasis,
      dossier,
      workerElapsed: 0,
      source: "main-thread-fallback",
    };
  }

  const id = ++countryStatsWorkerRequestId;
  const startedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  try {
    const result = await new Promise((resolve, reject) => {
      const abort = () => {
        countryStatsWorkerPending.delete(id);

        // There is only one active Stats generation job in the UI. Terminating the
        // worker is the only way to PREEMPT a CPU-bound request immediately rather
        // than waiting for its synchronous loop to finish before a cancel message can
        // be processed. The next country lazily receives a fresh worker.
        resetCountryStatsWorker({
          broken: false,
          reason:
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException("Country Stats calculation cancelled.", "AbortError"),
        });

        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("Country Stats calculation cancelled.", "AbortError"),
        );
      };

      if (signal?.aborted) {
        abort();
        return;
      }

      countryStatsWorkerPending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener?.("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener?.("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener?.("abort", abort, { once: true });

      // Send only the normalized state the deterministic planner actually reads.
      // No map geometry and no chat archive.
      const enqueueStartedAt =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

      worker.postMessage({
        type: "prepare",
        id,
        payload: {
          code,
          forceReassess: Boolean(forceReassess),
          urls: {
            world: JSON_URLS.world,
            events: JSON_URLS.events,
            game: JSON_URLS.game,
            regionsGeojson: JSON_URLS.regionsGeojson,
          },
        },
      });

      const enqueueElapsed =
        (typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now()) - enqueueStartedAt;

      if (enqueueElapsed >= 8) {
        console.info(
          `[stats worker R2.39] ${code}: tiny request enqueue ${enqueueElapsed.toFixed(1)} ms.`,
        );
      }
    });

    throwIfAborted(signal);

    const endedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    const workerTimings = result?.workerTimings || {};
    console.info(
      `[stats worker R2.39] ${code}: ` +
      `wall ${(endedAt - startedAt).toFixed(1)} ms; ` +
      `worker load ${Number(workerTimings.load || 0).toFixed(1)} ms; ` +
      `worker compute+semantic-middle ${Number(workerTimings.compute || 0).toFixed(1)} ms; ` +
      `worker total ${Number(workerTimings.total || 0).toFixed(1)} ms.`,
    );

    return {
      ...result,
      source: "worker-self-loading",
    };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;

    console.warn(
      "[OH PERF] Country Stats worker unavailable/self-load failed; using cooperative main-thread fallback.",
      error,
    );
    resetCountryStatsWorker({ broken: true, reason: error });

    await yieldToUiFrame(signal);
    const territorialBasis = await buildTargetStatsTerritorialBasis(
      bundle,
      code,
      normalizedWorld,
      { signal },
    );
    const dossier = await buildTargetDossier(bundle, code, normalizedWorld);
    return {
      territorialBasis,
      dossier,
      workerElapsed: 0,
      source: "main-thread-fallback",
    };
  }
};

const persistCountryStatsBackground = async ({
  code,
  sheet,
  continuity,
  date,
  round,
  signal,
} = {}) => {
  throwIfAborted(signal);
  const worker = getCountryStatsWorker();
  if (!worker) return null;

  const id = ++countryStatsWorkerRequestId;
  const startedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  const result = await new Promise((resolve, reject) => {
    const abort = () => {
      countryStatsWorkerPending.delete(id);
      resetCountryStatsWorker({
        broken: false,
        reason:
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException("Country Stats persistence cancelled.", "AbortError"),
      });
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Country Stats persistence cancelled.", "AbortError"),
      );
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    countryStatsWorkerPending.set(id, {
      resolve: (value) => {
        signal?.removeEventListener?.("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        signal?.removeEventListener?.("abort", abort);
        reject(error);
      },
    });
    signal?.addEventListener?.("abort", abort, { once: true });

    const enqueueStartedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();

    worker.postMessage({
      type: "persist",
      id,
      payload: {
        code,
        sheet,
        continuity,
        date,
        round,
        urls: { world: JSON_URLS.world },
      },
    });

    const enqueueElapsed =
      (typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()) - enqueueStartedAt;

    if (enqueueElapsed >= 8) {
      console.info(
        `[stats persist R2.40] ${code}: small commit enqueue ${enqueueElapsed.toFixed(1)} ms.`,
      );
    }
  });

  throwIfAborted(signal);
  const endedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const timings = result?.workerTimings || {};

  console.info(
    `[stats persist R2.40] ${code}: ` +
    `wall ${(endedAt - startedAt).toFixed(1)} ms; ` +
    `worker stringify ${Number(timings.stringify || 0).toFixed(1)} ms; ` +
    `PUT/read ${Number(timings.putAndRead || 0).toFixed(1)} ms; ` +
    `echo parse ${Number(timings.echoParse || 0).toFixed(1)} ms; ` +
    `worker total ${Number(timings.totalWall || timings.total || 0).toFixed(1)} ms.`,
  );

  return result;
};

const createUiBudget = (milliseconds = 6) => {
  let sliceStartedAt =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  return async (signal) => {
    const now =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
    if (now - sliceStartedAt < milliseconds) {
      throwIfAborted(signal);
      return;
    }
    await yieldToUiFrame(signal);
    sliceStartedAt =
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now();
  };
};

const statsVerboseTerritoryDebugEnabled = () => {
  try {
    return Boolean(globalThis?.__OH_STATS_DEBUG_FULL_TERRITORY__);
  } catch {
    return false;
  }
};

const statsSphericalVector = (lng, lat) => {
  const lon = (Number(lng) || 0) * Math.PI / 180;
  const phi = (Number(lat) || 0) * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lon), cosPhi * Math.sin(lon), Math.sin(phi)];
};

const statsVectorDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const statsVectorNormalize = (value) => {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
};
const statsVectorLngLat = (value) => {
  const unit = statsVectorNormalize(value);
  return {
    lng: Math.atan2(unit[1], unit[0]) * 180 / Math.PI,
    lat: Math.asin(Math.max(-1, Math.min(1, unit[2]))) * 180 / Math.PI,
  };
};

const statsRegionHeuristicWeight = ({ tags = [], type = "" } = {}) => {
  const lowered = new Set(normalizeArray(tags).map((tag) => normalizeString(tag).toLowerCase()).filter(Boolean));
  const typeKey = normalizeString(type).toLowerCase();
  let weight = 1;
  if ([...lowered].some((tag) => tag.includes("capital"))) weight *= 4;
  else if ([...lowered].some((tag) => tag.includes("metro") || tag.includes("city") || tag.includes("urban"))) weight *= 2.5;
  if ([...lowered].some((tag) => tag.includes("desert"))) weight *= 0.5;
  if ([...lowered].some((tag) => tag.includes("mountain") || tag.includes("hill"))) weight *= 0.8;
  if ([...lowered].some((tag) => tag.includes("jungle"))) weight *= 0.75;
  if (typeKey.includes("island")) weight *= 0.8;
  return Math.max(0.1, weight);
};

const buildStatsMacroPlan = (plannedRows = []) => {
  const rows = normalizeArray(plannedRows)
    .map((row, index) => {
      const geography = normalizeString(row?.geography || row?.baseGeography);
      if (!geography) return null;
      const hasLng = row?.lng !== null && row?.lng !== undefined && row?.lng !== "";
      const hasLat = row?.lat !== null && row?.lat !== undefined && row?.lat !== "";
      const lng = Number(row?.lng);
      const lat = Number(row?.lat);
      const hasPoint = hasLng && hasLat && Number.isFinite(lng) && Number.isFinite(lat);
      return {
        sourceIndex: index,
        index: Number(row?.index) || index + 1,
        geography,
        lng: hasPoint ? lng : ((index * 137.508) % 360) - 180,
        lat: hasPoint ? lat : 0,
        weight: Math.max(0.1, Number(row?.weight) || 1),
        vector: statsSphericalVector(hasPoint ? lng : ((index * 137.508) % 360) - 180, hasPoint ? lat : 0),
        regionIds: normalizeArray(row?.regions).map((region) => normalizeString(region?.id)).filter(Boolean),
        adjacencyIds: normalizeArray(row?.regions).flatMap((region) => normalizeArray(region?.adjacencies).map(normalizeString)).filter(Boolean),
      };
    })
    .filter(Boolean);
  if (!rows.length) return [];

  const clusterSpatially = (subset, bucketCount) => {
    if (!subset.length) return [];
    const count = Math.max(1, Math.min(bucketCount, subset.length));
    if (count === 1) {
      const vector = subset.reduce((sum, row) => [
        sum[0] + row.vector[0] * row.weight,
        sum[1] + row.vector[1] * row.weight,
        sum[2] + row.vector[2] * row.weight,
      ], [0, 0, 0]);
      return [{ members: subset, ...statsVectorLngLat(vector) }];
    }

    const centers = [];
    let first = subset[0];
    for (const row of subset) {
      if (row.weight > first.weight || (row.weight === first.weight && row.geography.localeCompare(first.geography) < 0)) first = row;
    }
    centers.push(first.vector);
    while (centers.length < count) {
      let choice = null;
      let choiceScore = -Infinity;
      for (const row of subset) {
        let nearestDistance = Infinity;
        for (const center of centers) {
          const distance = 1 - Math.max(-1, Math.min(1, statsVectorDot(row.vector, center)));
          if (distance < nearestDistance) nearestDistance = distance;
        }
        const score = nearestDistance * Math.sqrt(row.weight);
        if (score > choiceScore || (score === choiceScore && row.geography.localeCompare(choice?.geography || "") < 0)) {
          choice = row;
          choiceScore = score;
        }
      }
      centers.push(choice?.vector || subset[centers.length % subset.length].vector);
    }

    let assignments = new Array(subset.length).fill(0);
    for (let iteration = 0; iteration < 5; iteration += 1) {
      assignments = subset.map((row) => {
        let best = 0;
        let bestDot = -Infinity;
        for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
          const similarity = statsVectorDot(row.vector, centers[centerIndex]);
          if (similarity > bestDot) {
            bestDot = similarity;
            best = centerIndex;
          }
        }
        return best;
      });
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const members = subset.filter((_, rowIndex) => assignments[rowIndex] === centerIndex);
        if (!members.length) continue;
        const vector = members.reduce((sum, row) => [
          sum[0] + row.vector[0] * row.weight,
          sum[1] + row.vector[1] * row.weight,
          sum[2] + row.vector[2] * row.weight,
        ], [0, 0, 0]);
        centers[centerIndex] = statsVectorNormalize(vector);
      }
    }
    return centers.map((center, centerIndex) => ({
      members: subset.filter((_, rowIndex) => assignments[rowIndex] === centerIndex),
      ...statsVectorLngLat(center),
    })).filter((bucket) => bucket.members.length);
  };

  // Preserve major disconnected territorial blocks before spatial clustering.
  // This prevents a nearby colony (e.g. North Africa) from being blended into the
  // metropole merely because a global k-means center falls across the sea.
  const rowByRegionId = new Map();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const id of rows[rowIndex].regionIds) rowByRegionId.set(id, rowIndex);
  }
  const graph = rows.map(() => new Set());
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const adjacentId of rows[rowIndex].adjacencyIds) {
      const other = rowByRegionId.get(adjacentId);
      if (other == null || other === rowIndex) continue;
      graph[rowIndex].add(other);
      graph[other].add(rowIndex);
    }
  }
  const visited = new Set();
  const connected = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (visited.has(rowIndex)) continue;
    const queue = [rowIndex];
    visited.add(rowIndex);
    const memberIndexes = [];
    while (queue.length) {
      const current = queue.shift();
      memberIndexes.push(current);
      for (const next of graph[current]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    connected.push(memberIndexes.map((index) => rows[index]));
  }

  const majorCandidates = connected.filter((component) => component.length >= 4).sort((a, b) => b.length - a.length);
  const originalTinyRows = connected.filter((component) => component.length < 4).flat();
  const reserveForTiny = originalTinyRows.length || majorCandidates.length > STATS_MACRO_MAX_BUCKETS ? 1 : 0;
  const majorLimit = Math.max(0, STATS_MACRO_MAX_BUCKETS - reserveForTiny);
  const major = majorCandidates.slice(0, majorLimit);
  const tinyRows = [
    ...originalTinyRows,
    ...majorCandidates.slice(majorLimit).flat(),
  ];
  const baseDesired = Math.max(1, Math.min(STATS_MACRO_MAX_BUCKETS, Math.ceil(rows.length / STATS_MACRO_TARGET_COMPONENTS)));
  const tinyCapacity = Math.max(0, STATS_MACRO_MAX_BUCKETS - major.length);
  const tinyMinimum = tinyRows.length ? Math.min(tinyCapacity, 3, Math.ceil(tinyRows.length / 10)) : 0;
  const minimumForLandmasses = major.length + tinyMinimum;
  const desired = Math.max(1, Math.min(STATS_MACRO_MAX_BUCKETS, Math.max(baseDesired, minimumForLandmasses)));

  const allocations = major.map(() => 1);
  let tinyAllocation = tinyMinimum;
  let remaining = desired - allocations.reduce((sum, value) => sum + value, 0) - tinyAllocation;
  while (remaining > 0) {
    let bestType = "major";
    let bestIndex = -1;
    let bestPressure = tinyRows.length && tinyAllocation > 0 ? tinyRows.length / tinyAllocation : -1;
    for (let index = 0; index < major.length; index += 1) {
      const pressure = major[index].length / allocations[index];
      if (pressure > bestPressure) {
        bestPressure = pressure;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) allocations[bestIndex] += 1;
    else if (tinyRows.length) tinyAllocation += 1;
    else break;
    remaining -= 1;
  }

  const buckets = [];
  major.forEach((component, index) => buckets.push(...clusterSpatially(component, allocations[index])));
  if (tinyRows.length && tinyAllocation > 0) {
    buckets.push(...clusterSpatially(tinyRows, tinyAllocation));
  } else if (tinyRows.length && buckets.length) {
    // Pathological case with more major disconnected landmasses than the hard
    // macro cap: retain the cap and attach overflow rows to their nearest bucket.
    for (const row of tinyRows) {
      let nearest = buckets[0];
      let best = -Infinity;
      for (const bucket of buckets) {
        const center = statsSphericalVector(bucket.lng, bucket.lat);
        const similarity = statsVectorDot(row.vector, center);
        if (similarity > best) {
          best = similarity;
          nearest = bucket;
        }
      }
      nearest.members.push(row);
    }
  }
  if (!buckets.length) buckets.push(...clusterSpatially(rows, desired));

  buckets.sort((a, b) => b.lat - a.lat || a.lng - b.lng || a.members[0].geography.localeCompare(b.members[0].geography));
  return buckets.map((bucket, index) => ({ index: index + 1, ...bucket }));
};

const buildStatsMacroContext = (macroPlan = []) => normalizeArray(macroPlan).map((bucket) => {
  const center = statsVectorLngLat(statsSphericalVector(bucket?.lng, bucket?.lat));
  const members = normalizeArray(bucket?.members);
  const samples = [...members]
    .sort((a, b) => b.weight - a.weight || a.geography.localeCompare(b.geography))
    .slice(0, STATS_MACRO_SAMPLE_NAMES)
    .map((member) => member.geography);
  return `[M${bucket.index}] ${members.length} live component(s); center ${Math.abs(center.lat).toFixed(1)}°${center.lat >= 0 ? "N" : "S"}, ${Math.abs(center.lng).toFixed(1)}°${center.lng >= 0 ? "E" : "W"}; representative places: ${samples.join(", ")}`;
}).join("\n");

const buildStatsPreviousMacroContext = (previous, macroPlan = []) => {
  const byGeography = new Map(normalizeArray(previous?.territorialComponents).map((component) => [normalizeString(component?.geography).toLowerCase(), component]));
  const lines = [];
  for (const bucket of normalizeArray(macroPlan)) {
    const components = normalizeArray(bucket?.members)
      .map((member) => byGeography.get(normalizeString(member?.geography).toLowerCase()))
      .filter(Boolean);
    if (!components.length) continue;
    const population = components.reduce((sum, component) => sum + Math.max(0, Number(component?.population) || 0), 0);
    const gdp = components.reduce((sum, component) => sum + Math.max(0, Number(component?.population) || 0) * Math.max(0, Number(component?.gdpPerCapita) || 0), 0);
    const groups = new Map();
    for (const component of components) groups.set(component.group, (groups.get(component.group) || 0) + Math.max(0, Number(component.population) || 0));
    const group = [...groups.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "core";
    lines.push(`[M${bucket.index}] group=${group}; population=${Math.round(population)}; gdpPerCapita=${population > 0 ? Math.round(gdp / population) : 0}; matched=${components.length}/${normalizeArray(bucket.members).length}`);
  }
  return lines.join("\n");
};

const statsDateMillis = (value) => {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const time = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  return Number.isFinite(time) ? time : null;
};

const statsElapsedYears = (fromDate, toDate) => {
  const from = statsDateMillis(fromDate);
  const to = statsDateMillis(toDate);
  if (from == null || to == null || to <= from) return 0;
  return (to - from) / (365.2425 * 86400000);
};

const statsPolityAliases = (world, canonicalName) => {
  const values = new Set([normalizeString(canonicalName)]);
  const target = normalizeString(canonicalName).toLowerCase();
  for (const [key, polity] of Object.entries(world?.polityOverrides || {})) {
    const candidates = [key, polity?.code, polity?.name, ...normalizeArray(polity?.aliases)]
      .map(normalizeString)
      .filter(Boolean);
    const belongs = candidates.some((candidate) => {
      const resolved = canonicalStatsPolity(candidate, world);
      return normalizeString(resolved).toLowerCase() === target;
    });
    if (belongs) candidates.forEach((candidate) => values.add(candidate));
  }
  return [...values].filter(Boolean);
};

const STATS_GENERIC_POLITY_WORDS = new Set([
  "empire", "kingdom", "republic", "state", "states", "federation", "federal",
  "union", "united", "people", "peoples", "grand", "duchy", "commonwealth",
]);

const statsTextMentionsTarget = (textValue, aliases) => {
  const text = normalizeString(textValue).toLowerCase();
  if (!text) return false;

  for (const alias of aliases) {
    const phrase = normalizeString(alias).toLowerCase();
    if (phrase.length >= 4 && text.includes(phrase)) return true;
    const tokens = phrase
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/[\s-]+/)
      .filter((token) => token.length >= 5 && !STATS_GENERIC_POLITY_WORDS.has(token));
    for (const token of tokens) {
      if (text.includes(token)) return true;
      // Conservative adjective/name-family bridge: Germany/German,
      // Russia/Russian, Austria/Austrian, Serbia/Serbian, etc.
      if (token.length >= 6 && text.includes(token.slice(0, 5))) return true;
    }
  }
  return false;
};

const buildTargetEconomicEvidence = ({ bundle, statCode, previous, normalizedWorld = null }) => {
  const world = normalizedWorld || normalizeWorldState(bundle?.world);
  const target = canonicalStatsPolity(statCode, world) || normalizeString(statCode);
  const targetKey = target.toLowerCase();
  const aliases = statsPolityAliases(world, target);
  const accounted = new Set(
    normalizeArray(previous?.continuity?.accountedEventIds)
      .map(normalizeString)
      .filter(Boolean),
  );

  const sameTarget = (token) => {
    const resolved = canonicalStatsPolity(token, world);
    return normalizeString(resolved).toLowerCase() === targetKey;
  };

  const recent = normalizeEvents(bundle?.events).slice(-STATS_ECONOMIC_EVENT_SCAN_LIMIT);
  const relevant = [];

  for (const event of recent) {
    const id = normalizeString(event?.id);
    if (!id) continue;
    const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};

    const statImpact = normalizeArray(impacts.polityChanges).some((change) =>
      change?.stats && sameTarget(change?.code || change?.name));
    const legalTerritoryImpact = normalizeArray(impacts.regionTransfers).some((transfer) =>
      sameTarget(transfer?.fromCode) || sameTarget(transfer?.toCode));
    const controlImpact = normalizeArray(impacts.regionControlOps).some((op) =>
      sameTarget(op?.fromCode) || sameTarget(op?.toCode) || sameTarget(op?.actorCode) || sameTarget(op?.claimantCode));
    const combatant = normalizeArray(event?.combatants).some(sameTarget);
    const mentioned = statsTextMentionsTarget(prose, aliases);
    const economicCue = ECONOMIC_EVENT_PATTERN.test(prose);

    if (!(statImpact || legalTerritoryImpact || (economicCue && (mentioned || controlImpact || combatant)))) {
      continue;
    }

    relevant.push({
      id,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title) || "Economic development",
      description: normalizeString(event?.description),
      importance: normalizeString(event?.importance),
      directStatImpact: statImpact,
      legalTerritoryImpact,
    });
  }

  const unaccounted = relevant.filter((event) => !accounted.has(event.id));
  const selectedFresh = unaccounted.slice(-STATS_ECONOMIC_EVIDENCE_LIMIT);
  const deferredCount = Math.max(0, unaccounted.length - selectedFresh.length);
  const lines = selectedFresh.map((event) => {
    const detail = event.description.length > 360
      ? `${event.description.slice(0, 359).trimEnd()}…`
      : event.description;
    const flags = [
      event.directStatImpact ? "event carries explicit stats impact" : "",
      event.legalTerritoryImpact ? "legal-territory change" : "",
    ].filter(Boolean).join(", ");
    return `- [${event.id}] ${event.date || "undated"} — ${event.title}${flags ? ` [${flags}]` : ""}${detail ? `: ${detail}` : ""}`;
  });
  if (deferredCount > 0) {
    lines.unshift(`- ${deferredCount} earlier fresh relevant economic event(s) are intentionally deferred by the bounded evidence window; do not invent their details.`);
  }

  return {
    text: lines.join("\n"),
    relevantIds: relevant.map((event) => event.id).slice(-STATS_ACCOUNTED_EVENT_LIMIT),
    selectedFreshIds: selectedFresh.map((event) => event.id),
    unaccountedCount: unaccounted.length,
  };
};


const TRACKED_STATS_BATCH_VERSION = "8B.3.1";
const TRACKED_STATS_RECENT_EVENT_LIMIT = 8;
const TRACKED_STATS_SCAN_LIMIT = 80;

const compactTrackedStatsSheet = (sheetInput) => {
  const sheet = finalizeCountryStatSheet(sheetInput);
  if (!sheet) return null;
  return {
    stability: Number(sheet.stability),
    indices: {
      sovereignty: Number(sheet.indices?.sovereignty),
      foodAutonomy: Number(sheet.indices?.foodAutonomy),
      energyAutonomy: Number(sheet.indices?.energyAutonomy),
      economicIndependence: Number(sheet.indices?.economicIndependence),
      internalSecurity: Number(sheet.indices?.internalSecurity),
      internationalReputation: Number(sheet.indices?.internationalReputation),
    },
    population: {
      total: Number(sheet.population?.total),
      coreIntegrated: Number(sheet.population?.coreIntegrated),
      otherTerritories: Number(sheet.population?.otherTerritories),
    },
    economy: {
      gdp: Number(sheet.economy?.gdp),
      gdpPerCapita: Number(sheet.economy?.gdpPerCapita),
      gdpGrowth: Number(sheet.economy?.gdpGrowth),
      inflation: Number(sheet.economy?.inflation),
      unemployment: Number(sheet.economy?.unemployment),
      publicDebt: Number(sheet.economy?.publicDebt),
      budgetBalance: Number(sheet.economy?.budgetBalance),
      currency: normalizeString(sheet.economy?.currency),
    },
    gdpBreakdown: {
      agriculture: Number(sheet.gdpBreakdown?.agriculture),
      industry: Number(sheet.gdpBreakdown?.industry),
      services: Number(sheet.gdpBreakdown?.services),
    },
  };
};

const buildTrackedStatsNarrativeEvidence = ({ bundle, statCode, normalizedWorld }) => {
  const world = normalizedWorld || normalizeWorldState(bundle?.world);
  const aliases = statsPolityAliases(world, statCode);
  const targetKey = normalizeString(canonicalStatsPolity(statCode, world)).toLowerCase();

  const sameTarget = (value) =>
    normalizeString(canonicalStatsPolity(value, world)).toLowerCase() === targetKey;

  return normalizeEvents(bundle?.events)
    .slice(-TRACKED_STATS_SCAN_LIMIT)
    .filter((event) => {
      const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
      const directStats = normalizeArray(impacts.polityChanges)
        .some((change) => change?.stats && sameTarget(change?.code || change?.name));
      const territory = normalizeArray(impacts.regionTransfers)
        .some((change) => sameTarget(change?.fromCode) || sameTarget(change?.toCode));
      const control = normalizeArray(impacts.regionControlOps)
        .some((change) => sameTarget(change?.fromCode) || sameTarget(change?.toCode) || sameTarget(change?.actorCode));
      const combatant = normalizeArray(event?.combatants).some(sameTarget);
      const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
      return directStats || territory || control || combatant || statsTextMentionsTarget(prose, aliases);
    })
    .slice(-TRACKED_STATS_RECENT_EVENT_LIMIT)
    .map((event) => {
      const detail = normalizeString(event?.description);
      return `- ${normalizeString(event?.date) || "undated"} — ${normalizeString(event?.title) || "Untitled event"}${detail ? `: ${detail.slice(0, 320)}` : ""}`;
    })
    .join("\n");
};

const trackedStatsLatestHistoryDate = (world, polity) => {
  const rows = normalizeArray(world?.countryStatsHistory?.[polity]);
  return rows
    .map((row) => normalizeString(row?.date))
    .filter((date) => parseIsoDate(date))
    .sort()
    .at(-1) || "";
};

const sanitizeTrackedStatsPatch = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const percent = (raw) => {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  };
  const signed = (raw, min = -1000, max = 1000) => {
    const number = Number(raw);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : null;
  };
  const positive = (raw) => {
    const number = Number(raw);
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  const patch = {};
  const stability = percent(value.stability);
  if (stability != null) patch.stability = stability;

  const indices = {};
  for (const key of ["sovereignty", "foodAutonomy", "energyAutonomy", "economicIndependence", "internalSecurity", "internationalReputation"]) {
    const number = percent(value?.indices?.[key]);
    if (number != null) indices[key] = number;
  }
  if (Object.keys(indices).length) patch.indices = indices;

  const population = {};
  const totalPopulation = positive(value?.population?.total);
  if (totalPopulation != null) population.total = Math.round(totalPopulation);
  if (Object.keys(population).length) patch.population = population;

  const economy = {};
  const gdp = positive(value?.economy?.gdp);
  const gdpPerCapita = positive(value?.economy?.gdpPerCapita);
  if (gdp != null) economy.gdp = gdp;
  else if (gdpPerCapita != null) economy.gdpPerCapita = gdpPerCapita;
  for (const key of ["gdpGrowth", "inflation", "unemployment", "publicDebt", "budgetBalance"]) {
    const number = signed(value?.economy?.[key]);
    if (number != null) economy[key] = number;
  }
  if (Object.keys(economy).length) patch.economy = economy;

  const breakdown = {};
  for (const key of ["agriculture", "industry", "services"]) {
    const number = percent(value?.gdpBreakdown?.[key]);
    if (number != null) breakdown[key] = number;
  }
  if (Object.keys(breakdown).length === 3) patch.gdpBreakdown = breakdown;

  return Object.keys(patch).length ? patch : null;
};

const refreshTrackedCountryStatsIfDue = async ({
  bundle,
  signal,
} = {}) => {
  const game = normalizeGameData(bundle?.game);
  let world = normalizeWorldState(bundle?.world);
  const currentDate = normalizeString(game?.gameDate || game?.startDate);
  if (!parseIsoDate(currentDate)) return world;

  const tracking = normalizeCountryStatsTracking(world?.countryStatsTracking, {
    playerCountry: game?.country,
  });
  const intervalMonths = Number(tracking.intervalMonths) || 0;
  if (!intervalMonths || !tracking.trackedPolities.length) {
    if (world?.countryStatsTracking) world.countryStatsTracking = tracking;
    return world;
  }

  const due = [];
  const pendingBaseline = [];

  for (const rawPolity of tracking.trackedPolities.slice(0, COUNTRY_STATS_TRACKING_MAX_POLITIES)) {
    const polity = canonicalStatsPolity(rawPolity, world) || normalizeString(rawPolity);
    const previous = normalizeCountryStatSheet(world?.countryStats?.[polity]);
    if (!previous || !isCompleteCountryStatSheet(previous)) {
      pendingBaseline.push(polity);
      continue;
    }

    const lastAuto = normalizeString(tracking.lastAutoRefreshByPolity?.[polity]);
    const baselineDate =
      (parseIsoDate(lastAuto) && lastAuto) ||
      (parseIsoDate(previous?.continuity?.assessedDate) && normalizeString(previous.continuity.assessedDate)) ||
      trackedStatsLatestHistoryDate(world, polity) ||
      normalizeString(game?.startDate);

    if (countryStatsTrackingMonthsElapsed(baselineDate, currentDate) < intervalMonths) continue;

    const economic = buildTargetEconomicEvidence({
      bundle,
      statCode: polity,
      previous,
      normalizedWorld: world,
    });
    const narrative = buildTrackedStatsNarrativeEvidence({
      bundle,
      statCode: polity,
      normalizedWorld: world,
    });
    due.push({
      polity,
      previous,
      baselineDate,
      elapsedMonths: countryStatsTrackingMonthsElapsed(baselineDate, currentDate),
      economic,
      narrative,
    });
  }

  world.countryStatsTracking = normalizeCountryStatsTracking({
    ...tracking,
    pendingBaselinePolities: pendingBaseline,
  }, { playerCountry: game?.country });

  if (!due.length) return world;

  const systemPrompt = `You are Open Historia's bounded periodic national-statistics auditor.

You are refreshing EXISTING persistent country stat sheets for a running alternate-history campaign. This is a continuity update, NOT a fresh historical lookup and NOT a territorial rebase.

RULES:
- The supplied current sheet is canonical. Change it conservatively from that baseline.
- Respect the campaign date and supplied campaign evidence. Real-world outcomes after the campaign start are not automatically canonical.
- Absence of evidence is a strong reason for continuity, not a reason to reroll numbers.
- Current sheets may already include explicit event stat patches from this same turn. Do not double-apply those effects.
- Population and GDP should evolve plausibly over the elapsed interval. Keep GDP, population, GDP/capita, growth, inflation, unemployment, debt and budget balance mutually coherent.
- Strategic indices are 0..100 and should normally move gradually unless evidence clearly supports a shock.
- GDP sector shares must sum to 100 if supplied.
- Do not invent territorial changes. This lightweight periodic audit deliberately preserves the existing territorial component ledger.
- Return exactly one JSON object and no markdown/prose outside it.

OUTPUT:
{
  "updates": [
    {
      "country": "exact supplied canonical key",
      "stability": 0,
      "indices": {
        "sovereignty": 0,
        "foodAutonomy": 0,
        "energyAutonomy": 0,
        "economicIndependence": 0,
        "internalSecurity": 0,
        "internationalReputation": 0
      },
      "population": { "total": 0 },
      "economy": {
        "gdp": 0,
        "gdpPerCapita": 0,
        "gdpGrowth": 0,
        "inflation": 0,
        "unemployment": 0,
        "publicDebt": 0,
        "budgetBalance": 0
      },
      "gdpBreakdown": { "agriculture": 0, "industry": 0, "services": 0 }
    }
  ]
}

You may omit a field when the existing value should remain exactly unchanged.`;

  const userMessage = [
    `Campaign date: ${currentDate}`,
    `Periodic Stats batch version: ${TRACKED_STATS_BATCH_VERSION}`,
    "",
    ...due.flatMap((entry, index) => [
      `=== COUNTRY ${index + 1}: ${entry.polity} ===`,
      `Elapsed since last dedicated Stats audit: ${entry.elapsedMonths} month(s) (baseline ${entry.baselineDate || "unknown"}).`,
      `CURRENT CANONICAL SHEET:`,
      JSON.stringify(compactTrackedStatsSheet(entry.previous)),
      `FRESH TARGET-SPECIFIC ECONOMIC EVIDENCE:`,
      normalizeString(entry.economic?.text) || "None.",
      `RECENT RELEVANT CAMPAIGN CONTEXT:`,
      normalizeString(entry.narrative) || "None.",
      "",
    ]),
  ].join("\n");

  try {
    const response = await callAI(
      systemPrompt,
      [{ role: "user", parts: [{ text: userMessage }] }],
      {
        signal,
        reasoningEnabled: false,
        taskKey: "countryStatSheet",
        ...(getMapSetting(MAP_SETTING_KEYS.limitAiGeneration)
          ? { deadline: Date.now() + 90000 }
          : {}),
      },
    );
    const rawText = typeof response === "string"
      ? response
      : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    const updates = normalizeArray(parsed?.updates);
    const dueByKey = new Map(due.map((entry) => [entry.polity.toLocaleLowerCase(), entry]));

    let applied = 0;
    const refreshed = { ...(tracking.lastAutoRefreshByPolity || {}) };

    for (const update of updates) {
      const polity = canonicalStatsPolity(update?.country, world) || normalizeString(update?.country);
      const entry = dueByKey.get(polity.toLocaleLowerCase());
      if (!entry) continue;

      const patch = sanitizeTrackedStatsPatch(update);
      if (!patch) continue;

      const merged = mergeCountryStatPatch(entry.previous, patch, {
        continuity: {
          assessedDate: currentDate,
          assessedRound: Math.max(0, Math.trunc(Number(game?.round) || 0)),
          accountedEventIds: entry.economic?.relevantIds || [],
        },
      });
      const guarded = guardCountryStatContinuity(
        entry.previous,
        merged,
        {
          elapsedYears: Math.max(0, entry.elapsedMonths / 12),
          evidenceText: [entry.economic?.text, entry.narrative].filter(Boolean).join("\n"),
          territoryChanged: false,
        },
      )?.sheet || merged;

      if (!guarded || !isCompleteCountryStatSheet(guarded)) continue;

      world.countryStats = {
        ...(world.countryStats || {}),
        [entry.polity]: guarded,
      };
      const reputation = Number(guarded?.indices?.internationalReputation);
      if (Number.isFinite(reputation)) {
        world.internationalReputation = {
          ...(world.internationalReputation || {}),
          [entry.polity]: Math.max(0, Math.min(100, Math.round(reputation))),
        };
      }
      refreshed[entry.polity] = currentDate;
      applied += 1;
    }

    world.countryStatsTracking = normalizeCountryStatsTracking({
      ...tracking,
      lastAutoRefreshByPolity: refreshed,
      pendingBaselinePolities: pendingBaseline,
      lastBatchDate: applied > 0 ? currentDate : tracking.lastBatchDate,
    }, { playerCountry: game?.country });

    if (applied > 0) {
      console.info(
        `[stats auto ${TRACKED_STATS_BATCH_VERSION}] refreshed ${applied}/${due.length} due tracked countr${due.length === 1 ? "y" : "ies"} in one AI batch; ` +
        `${pendingBaseline.length} tracked countr${pendingBaseline.length === 1 ? "y needs" : "ies need"} a baseline.`,
      );
    } else {
      console.warn(
        `[stats auto ${TRACKED_STATS_BATCH_VERSION}] batch returned no usable tracked-country updates; completed world turn is preserved.`,
      );
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(
      `[stats auto ${TRACKED_STATS_BATCH_VERSION}] periodic tracked-country refresh failed; completed world turn is preserved.`,
      error,
    );
  }

  return world;
};

// 8B.2.18 — causal population calibration context.
//
// Population bootstrap/reconstruction needs bounded regional historical priors without
// turning same-date real history into an attractor. Feed the EXISTING countryStatSheet
// call the scenario author's own pre-game briefing, the
// canonical pre-game events that Round Zero produced, and bounded campaign checkpoints.
// The model can therefore distinguish "historical 1936 Germany" from "a 1936 Germany
// whose timeline diverged in 1917" without adding another AI/database layer.
const STATS_CALIBRATION_STARTING_TEXT_LIMIT = 5000;
const STATS_CALIBRATION_PREGAME_EVENT_LIMIT = 12;
const STATS_CALIBRATION_CAMPAIGN_EVENT_LIMIT = 16;
const STATS_CALIBRATION_HISTORY_LIMIT = 8;
const STATS_CALIBRATION_CONSOLIDATED_LIMIT = 10;
const STATS_DEMOGRAPHIC_CANON_PATTERN = /\b(?:war|battle|casualt|killed|deaths?|mortality|epidem|pandemic|disease|famine|starvation|refuge|migration|emigration|immigration|expulsion|deport|population|birth|annex|cession|partition|occupation|independence|secession|mobiliz|demobiliz|reconstruction|coloniz|settlement)\b/i;

const compactStatsCalibrationEvent = (event) => {
  const date = normalizeString(event?.date) || "undated";
  const title = normalizeString(event?.title) || "Untitled event";
  const description = normalizeString(event?.description);
  const detail = description.length > 240
    ? `${description.slice(0, 239).trimEnd()}…`
    : description;
  return `- ${date} — ${title}${detail ? `: ${detail}` : ""}`;
};

const buildStatsPopulationCalibrationCanon = ({ bundle, statCode, normalizedWorld = null } = {}) => {
  const world = normalizedWorld || normalizeWorldState(bundle?.world);
  const target = canonicalStatsPolity(statCode, world) || normalizeString(statCode);
  const targetKey = target.toLowerCase();
  const aliases = statsPolityAliases(world, target);
  const startDate = normalizeString(bundle?.game?.startDate || bundle?.game?.gameDate);
  const currentDate = normalizeString(bundle?.game?.gameDate || startDate);
  const events = normalizeEvents(bundle?.events);

  const sameTarget = (token) => {
    const resolved = canonicalStatsPolity(token, world);
    return normalizeString(resolved).toLowerCase() === targetKey;
  };

  const isBeforeStart = (event) => {
    if (normalizeString(event?.source).toLowerCase() === "pregame") return true;
    const eventDate = normalizeString(event?.date);
    const parsedEvent = parseIsoDate(eventDate);
    const parsedStart = parseIsoDate(startDate);
    if (parsedEvent && parsedStart) {
      return statsDateMillis(eventDate) < statsDateMillis(startDate);
    }
    return false;
  };

  const pregame = events
    .filter(isBeforeStart)
    .slice(-STATS_CALIBRATION_PREGAME_EVENT_LIMIT);

  const campaignRelevant = events
    .filter((event) => !isBeforeStart(event))
    .filter((event) => {
      const prose = `${normalizeString(event?.title)} ${normalizeString(event?.description)}`;
      const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
      const directStats = normalizeArray(impacts.polityChanges).some((change) =>
        change?.stats && sameTarget(change?.code || change?.name));
      const territory = normalizeArray(impacts.regionTransfers).some((transfer) =>
        sameTarget(transfer?.fromCode) || sameTarget(transfer?.toCode));
      const combatant = normalizeArray(event?.combatants).some(sameTarget);
      const mentioned = statsTextMentionsTarget(prose, aliases);
      return directStats || territory || combatant || (mentioned && STATS_DEMOGRAPHIC_CANON_PATTERN.test(prose)) ||
        STATS_DEMOGRAPHIC_CANON_PATTERN.test(prose) && /\b(?:pandemic|epidemic|global|worldwide)\b/i.test(prose);
    })
    .slice(-STATS_CALIBRATION_CAMPAIGN_EVENT_LIMIT);

  const startingTimelineText = normalizeString(world?.startingTimelineText);
  const historySummaries = normalizeArray(world?.simulationHistory)
    .map((entry) => {
      const rawSummary = normalizeString(entry?.summary);
      if (!rawSummary) return "";
      const summary = rawSummary.length > 600 ? `${rawSummary.slice(0, 599).trimEnd()}…` : rawSummary;
      const fromDate = normalizeString(entry?.fromDate);
      const toDate = normalizeString(entry?.toDate || entry?.date);
      const mode = normalizeString(entry?.mode);
      return `- ${fromDate || "?"}${toDate && toDate !== fromDate ? ` → ${toDate}` : ""}${mode ? ` [${mode}]` : ""}: ${summary}`;
    })
    .filter(Boolean)
    .slice(-STATS_CALIBRATION_HISTORY_LIMIT);

  // Consolidated history exists specifically to preserve old campaign divergences
  // after raw events fall out of bounded attention. Sample it across the whole
  // chronology, not merely from the tail, so a 1914 divergence still constrains a
  // 1936 hard audit even after decades of play.
  const consolidatedAll = normalizeArray(world?.consolidatedHistory)
    .map((entry) => {
      const rawSummary = normalizeString(entry?.summary);
      if (!rawSummary) return "";
      const summary = rawSummary.length > 700 ? `${rawSummary.slice(0, 699).trimEnd()}…` : rawSummary;
      const throughDate = normalizeString(entry?.throughDate);
      const round = Number(entry?.throughRound);
      return `- through ${throughDate || "?"}${Number.isFinite(round) ? ` (round ${Math.trunc(round)})` : ""}: ${summary}`;
    })
    .filter(Boolean);
  const consolidatedHistory = (() => {
    if (consolidatedAll.length <= STATS_CALIBRATION_CONSOLIDATED_LIMIT) return consolidatedAll;
    const selected = [];
    for (let index = 0; index < STATS_CALIBRATION_CONSOLIDATED_LIMIT; index += 1) {
      const sourceIndex = Math.round(
        index * (consolidatedAll.length - 1) / (STATS_CALIBRATION_CONSOLIDATED_LIMIT - 1),
      );
      selected.push(consolidatedAll[sourceIndex]);
    }
    return [...new Set(selected)];
  })();

  const blocks = [
    `Scenario start: ${startDate || "unknown"}. Current campaign date: ${currentDate || "unknown"}.`,
    "Use this canon to locate the latest genuinely shared historical frontier. A changed polity name, changed borders, a different war outcome, a surviving/dissolved regime, or any other supplied contradiction is evidence that later real-world history belongs to another timeline.",
  ];

  if (startingTimelineText) {
    blocks.push(
      `SCENARIO AUTHOR'S WORLD-BEFORE-ROUND-ONE BRIEFING (highest-priority pre-start canon):\n${startingTimelineText.slice(0, STATS_CALIBRATION_STARTING_TEXT_LIMIT)}`,
    );
  }
  if (pregame.length) {
    blocks.push(
      `CANONICAL PRE-GAME EVENTS (${pregame.length} shown):\n${pregame.map(compactStatsCalibrationEvent).join("\n")}`,
    );
  }
  if (consolidatedHistory.length) {
    blocks.push(
      `LONG-CAMPAIGN CONSOLIDATED CANON (${consolidatedHistory.length} chronological coverage samples):\n${consolidatedHistory.join("\n")}`,
    );
  }
  if (historySummaries.length) {
    blocks.push(
      `RECENT CAMPAIGN HISTORY CHECKPOINTS (${historySummaries.length} shown):\n${historySummaries.join("\n")}`,
    );
  }
  if (campaignRelevant.length) {
    blocks.push(
      `TARGET/DEMOGRAPHIC CAMPAIGN EVENTS AFTER START (${campaignRelevant.length} shown):\n${campaignRelevant.map(compactStatsCalibrationEvent).join("\n")}`,
    );
  }
  if (!startingTimelineText && !pregame.length) {
    blocks.push(
      "No explicit pre-start divergence text/events are available. Do NOT interpret that absence as proof that same-date real history is canonical: the live polity identity and authoritative territorial basis may themselves demonstrate an alternate scenario. If they materially conflict with real history, treat the divergence frontier as earlier/unknown and estimate forward from shared regional priors plus scenario state instead of copying a historical headline total.",
    );
  }

  return blocks.join("\n\n");
};

// Build a native legal-territory accounting basis for Stats. Unlike the old AIO,
// this does not scrape rendered DOM/map prose. We have direct access to the region
// catalog plus separate controller/sovereign ledgers, so temporary occupation can
// stay militarily real without being counted as national population/GDP.
// 7A.1.5: custom/hybrid regions can legitimately omit `country`. Resolve their
// provenance from countryCode when available; otherwise keep the exact region name
// as its own deterministic economic bucket. Never collapse unrelated blank-country
// regions into one fake "Unclassified" component.
const buildTargetStatsTerritorialBasis = async (bundle, code, normalizedWorld = null, { signal } = {}) => {
  const world = normalizedWorld || normalizeWorldState(bundle.world);
  const target = canonicalStatsPolity(code, world);
  if (!target) {
    return {
      context: "No target polity was resolved.",
      plan: [],
      macroPlan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.14: Stats must use the SAME scenario geography that the player actually
  // sees. loadRegionCatalog() is deliberately broad: stock GADM rows are merged
  // with scenario/custom rows and its cache may outlive individual runtime fetches.
  // That is useful for name resolution, but it is not authoritative enough for
  // territorial accounting on hybrid maps. The rendered regionsGeojson is the
  // current map partition and therefore wins whenever it exists. Stock/merged
  // catalog data is retained only as a compatibility fallback for maps that do not
  // expose a rendered region FeatureCollection.
  // 8B.2.18.1 performance: the rendered scenario map is authoritative, so do
  // not eagerly load/merge the broad stock region catalog in parallel. That fallback
  // can be much larger than the active scenario and used to block Stats even when it
  // was immediately discarded.
  // R2.31 performance: never reopen / parse the giant scenario GeoJSON merely to
  // inspect another country's Stats. Nations already projects the exact rendered
  // scenario partition into a compact non-geometry catalog. Use that authoritative
  // projection directly; stock merged catalog remains fallback-only.
  const scenarioCatalog = await loadScenarioRegionCatalog({ force: false }).catch(() => []);

  const renderedCatalog = [];
  const yieldCatalogSlice = createUiBudget(5);
  for (const region of normalizeArray(scenarioCatalog)) {
    const id = normalizeString(region?.id);
    const name = normalizeString(region?.name) || id;

    if (id && name) {
      const countryCode = normalizeString(region?.countryCode);
      const mappedCountryCode = countryCode
        ? normalizeString(toCountryName(countryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== countryCode.toLowerCase()
          ? mappedCountryCode
          : "";

      const country = normalizeString(region?.country);
      const baseGeography = country || resolvedCodeGeography || name || id;
      const baseOwner = country || resolvedCodeGeography || mappedCountryCode || "";

      renderedCatalog.push({
        id,
        name,
        countryCode,
        baseGeography,
        baseOwner,
        lng: Number.isFinite(Number(region?.lng)) ? Number(region.lng) : null,
        lat: Number.isFinite(Number(region?.lat)) ? Number(region.lat) : null,
        weight: statsRegionHeuristicWeight({ tags: region?.tags, type: region?.type }),
        adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
      });
    }

    // Previous cooperative code began only AFTER this 4,390-row projection.
    await yieldCatalogSlice(signal);
  }

  const mergedCatalog = renderedCatalog.length
    ? []
    : await loadRegionCatalog({ force: false }).catch(() => []);

  const fallbackCatalog = normalizeArray(mergedCatalog)
    .map((region) => {
      const id = normalizeString(region?.id);
      const name = normalizeString(region?.name) || id;
      if (!id || !name) return null;

      const rawCountryCode = normalizeString(region?.countryCode);
      const mappedCountryCode = rawCountryCode
        ? normalizeString(toCountryName(rawCountryCode))
        : "";
      const resolvedCodeGeography =
        mappedCountryCode && mappedCountryCode.toLowerCase() !== rawCountryCode.toLowerCase()
          ? mappedCountryCode
          : "";
      const country = normalizeString(region?.country);
      const baseGeography = country || resolvedCodeGeography || name || id;
      const baseOwner = country || resolvedCodeGeography || mappedCountryCode || "";

      const centroid = region?.centroid?.coordinates;
      const lng = Number(Array.isArray(centroid) ? centroid[0] : region?.lng ?? region?.longitude);
      const lat = Number(Array.isArray(centroid) ? centroid[1] : region?.lat ?? region?.latitude);
      return {
        id,
        name,
        countryCode: rawCountryCode,
        baseGeography,
        baseOwner,
        lng: Number.isFinite(lng) ? lng : null,
        lat: Number.isFinite(lat) ? lat : null,
        weight: statsRegionHeuristicWeight({ tags: region?.tags, type: region?.type }),
        adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
      };
    })
    .filter(Boolean);

  const catalog = renderedCatalog.length > 0 ? renderedCatalog : fallbackCatalog;
  if (!catalog.length) {
    return {
      context: "No region catalog is available; use existing campaign records conservatively.",
      plan: [],
      macroPlan: [],
      mode: "none",
      referenceContext: "",
    };
  }

  // 8B.2.18.1 performance: target membership is the hot path over every map
  // feature. Do not invoke the full polity identity resolver 2-4 times per region.
  // Resolve the target once, build its known identity/alias set once, and compare raw
  // map ownership tokens against that set. Keep a tiny generic resolver cache only
  // for the rare displaced-sovereign/donor comparisons that truly need it.
  const targetIdentityKeys = new Set([
    target,
    code,
    ...statsPolityAliases(world, target),
  ].map((value) => normalizeString(value).toLowerCase()).filter(Boolean));
  const mappedTargetCode = normalizeString(toCountryName(code));
  if (mappedTargetCode) targetIdentityKeys.add(mappedTargetCode.toLowerCase());

  const sameTarget = (value) => {
    const raw = normalizeString(value);
    if (!raw) return false;
    const key = raw.toLowerCase();
    if (targetIdentityKeys.has(key)) return true;
    const mapped = normalizeString(toCountryName(raw)).toLowerCase();
    return Boolean(mapped && targetIdentityKeys.has(mapped));
  };

  const canonicalCache = new Map();
  const canonicalCached = (value) => {
    const raw = normalizeString(value);
    if (!raw) return "";
    const key = raw.toLowerCase();
    if (canonicalCache.has(key)) return canonicalCache.get(key);
    const resolved = canonicalStatsPolity(raw, world);
    canonicalCache.set(key, resolved);
    return resolved;
  };
  const same = (a, b) =>
    normalizeString(canonicalCached(a)).toLowerCase() ===
    normalizeString(canonicalCached(b)).toLowerCase();

  const totalByBase = new Map();
  const legalByBase = new Map();
  const controlledByBase = new Map();
  const displacedSovereigns = new Set();

  let occupiedByTarget = 0;
  let targetOccupiedByOthers = 0;
  let nativeHomelandControlled = 0;

  const pushRegion = (map, baseGeography, region) => {
    if (!map.has(baseGeography)) map.set(baseGeography, []);
    map.get(baseGeography).push(region);
  };

  await statsYieldToMainThread(signal);
  const yieldTerritorySlice = createUiBudget(6);
  for (let catalogIndex = 0; catalogIndex < catalog.length; catalogIndex += 1) {
    const region = catalog[catalogIndex];
    const regionId = normalizeString(region?.id);
    const baseGeography = normalizeString(region?.baseGeography) || normalizeString(region?.name) || regionId;
    if (!regionId || !baseGeography) continue;

    totalByBase.set(baseGeography, (totalByBase.get(baseGeography) || 0) + 1);

    const baseOwner = normalizeString(region?.baseOwner);
    const controller = normalizeString(
      world.regionOwnershipOverrides?.[regionId] || baseOwner,
    );
    // 8B.2.14: regionSovereigntyOverrides is intentionally SPARSE. normalizeWorldState
    // drops an explicit sovereignty entry whenever legal sovereign === current controller
    // to avoid persisting thousands of redundant normal-ownership rows. Therefore, when
    // no explicit sovereignty anchor exists, the CURRENT CONTROLLER is the effective legal
    // sovereign. A genuine wartime occupation is safe because its old legal sovereign is
    // preserved as an explicit differing sovereignty override before control flips.
    const sovereign = normalizeString(
      world.regionSovereigntyOverrides?.[regionId] || controller || baseOwner,
    );

    const row = {
      id: regionId,
      name: normalizeString(region?.name) || regionId,
      sovereign,
      lng: Number.isFinite(Number(region?.lng)) ? Number(region.lng) : null,
      lat: Number.isFinite(Number(region?.lat)) ? Number(region.lat) : null,
      weight: Math.max(0.1, Number(region?.weight) || 1),
      adjacencies: normalizeArray(region?.adjacencies).map(normalizeString).filter(Boolean),
    };

    if (sameTarget(controller)) {
      pushRegion(controlledByBase, baseGeography, row);

      if (!sameTarget(sovereign)) {
        occupiedByTarget += 1;
        if (sovereign) displacedSovereigns.add(sovereign);

        // Strong native evidence that the controlled land is the polity's own
        // homeland/base geography rather than an arbitrary foreign occupation.
        if (sameTarget(baseGeography)) nativeHomelandControlled += 1;
      }
    }

    if (sameTarget(sovereign) && controller && !sameTarget(controller)) {
      targetOccupiedByOthers += 1;
    }

    if (sameTarget(sovereign)) pushRegion(legalByBase, baseGeography, row);

    // Time-budgeted rather than item-count-budgeted: one scenario can make 20
    // regions cheap and another can make 20 identity checks expensive. Never hold
    // the browser for more than roughly one half-frame before yielding.
    await yieldTerritorySlice(signal);
  }

  const targetOverrideEntry = Object.entries(world.polityOverrides || {})
    .find(([key, record]) => [
      key,
      record?.code,
      record?.name,
      ...normalizeArray(record?.aliases),
    ].some((value) => value && sameTarget(value)));

  const targetOverride = targetOverrideEntry?.[1] || null;
  const targetExplicitlyActive =
    normalizeString(targetOverride?.status).toLowerCase() === "active";

  // Structured lifecycle evidence is universal and identity-safe. Merely being a
  // CREATEd/RESTOREd polity is not by itself enough (a government-in-exile or newly
  // created foreign invader must not absorb whatever it happens to occupy). Stronger
  // evidence exists when the establishing event ALSO assigns territory/control to the
  // polity. No country names, historical keywords, or scenario-specific ids.
  let lifecycleEstablished = false;
  let foundingTerritoryEstablished = false;
  const yieldLifecycleSlice = createUiBudget(5);
  for (const event of normalizeArray(bundle?.events)) {
    const changes = normalizeArray(event?.impacts?.polityChanges);
    const establishesTarget = changes.some((change) => {
      const operation = normalizeString(change?.operation).toLowerCase();
      return ["create", "restore"].includes(operation) &&
        (sameTarget(change?.code) || sameTarget(change?.name));
    });

    if (!establishesTarget) continue;
    lifecycleEstablished = true;

    const grantsControl = normalizeArray(event?.impacts?.regionControlOps)
      .some((operation) =>
        ["control", "control_flip"].includes(normalizeString(operation?.op).toLowerCase()) &&
        sameTarget(operation?.toCode));

    const grantsSovereignty = normalizeArray(event?.impacts?.regionTransfers)
      .some((transfer) => sameTarget(transfer?.toCode));

    if (grantsControl || grantsSovereignty) foundingTerritoryEstablished = true;
    await yieldLifecycleSlice(signal);
  }

  // Canonical war context is supporting evidence, especially for older saves whose
  // lifecycle-establishing event may have been consolidated away. It is NOT enough
  // by itself to convert a normal foreign occupation into national Stats scope.
  let opposedToDisplacedSovereign = false;
  for (const war of normalizeArray(world?.wars)) {
    if (!["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) continue;

    const sideA = normalizeArray(war?.sideA);
    const sideB = normalizeArray(war?.sideB);
    const targetInA = sideA.some((party) => sameTarget(party));
    const targetInB = sideB.some((party) => sameTarget(party));
    if (!targetInA && !targetInB) continue;

    const opponents = targetInA ? sideB : sideA;
    if (opponents.some((party) =>
      [...displacedSovereigns].some((sovereign) => same(party, sovereign)))) {
      opposedToDisplacedSovereign = true;
      break;
    }
  }

  const legalRegionCount = [...legalByBase.values()]
    .reduce((sum, regions) => sum + regions.length, 0);
  const controlledRegionCount = [...controlledByBase.values()]
    .reduce((sum, regions) => sum + regions.length, 0);

  // Universal de-facto-state rule.
  //
  // Normal states stay on LEGAL SOVEREIGNTY accounting, even while occupying
  // foreign territory. Controller-based accounting is selected ONLY when:
  //   1) there is no usable legal-sovereign mapped basis;
  //   2) the polity actually controls mapped territory;
  //   3) it is an explicitly active campaign polity; and
  //   4) native evidence identifies those holdings as its territorial state base,
  //      not ordinary foreign occupation.
  const deFactoStatehoodEvidence = Boolean(
    nativeHomelandControlled > 0 ||
    foundingTerritoryEstablished ||
    (lifecycleEstablished && opposedToDisplacedSovereign)
  );

  const useDeFactoStateBasis = Boolean(
    legalRegionCount === 0 &&
    controlledRegionCount > 0 &&
    targetExplicitlyActive &&
    deFactoStatehoodEvidence,
  );

  const selectedByBase = useDeFactoStateBasis ? controlledByBase : legalByBase;
  const mode = useDeFactoStateBasis ? "de_facto_state" : "legal";

  if (useDeFactoStateBasis) {
    console.info(
      `[stats 8B.2.18.1] ${target}: DE-FACTO STATE ADMINISTRATION selected — ` +
        `${controlledRegionCount} controlled region(s), 0 legal-sovereign region(s), ` +
        `rendered-geography=${renderedCatalog.length ? "yes" : "fallback"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  } else if (legalRegionCount === 0 && controlledRegionCount > 0) {
    console.info(
      `[stats 8B.2.18.1] ${target}: ${controlledRegionCount} controlled region(s) excluded from national Stats; ` +
        `de-facto state qualification failed (active=${targetExplicitlyActive ? "yes" : "no"}, ` +
        `own-base=${nativeHomelandControlled}, lifecycle=${lifecycleEstablished ? "yes" : "no"}, ` +
        `founding-territory=${foundingTerritoryEstablished ? "yes" : "no"}, ` +
        `war-with-displaced-sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}).`,
    );
  }

  const rows = [...selectedByBase.entries()]
    .map(([baseGeography, regions]) => ({
      baseGeography,
      regions,
      total: totalByBase.get(baseGeography) || regions.length,
    }))
    .sort((a, b) =>
      b.regions.length - a.regions.length ||
      a.baseGeography.localeCompare(b.baseGeography));

  if (!rows.length) {
    return {
      context: [
        `Target: ${target}`,
        "Accounting mode: LEGAL SOVEREIGNTY",
        "No legally sovereign map regions were resolved for this polity.",
        controlledRegionCount > 0
          ? `The polity controls ${controlledRegionCount} region(s), but native statehood safeguards did NOT classify those holdings as a de-facto national administrative basis. Ordinary occupation therefore remains excluded from national population/GDP.`
          : "No de-facto controlled mapped regions were resolved either.",
        "Do not silently substitute modern borders. If this is a landless polity, estimate only what the campaign canon actually supports.",
      ].join("\n"),
      plan: [],
      mode,
      referenceContext: "",
    };
  }

  const plannedRows = rows.map((row, index) => {
    const located = row.regions.filter((region) =>
      region?.lng !== null && region?.lng !== undefined && region?.lng !== "" &&
      region?.lat !== null && region?.lat !== undefined && region?.lat !== "" &&
      Number.isFinite(Number(region.lng)) && Number.isFinite(Number(region.lat))
    );
    const weight = row.regions.reduce((sum, region) => sum + Math.max(0.1, Number(region?.weight) || 1), 0);
    const vector = located.reduce((sum, region) => {
      const localWeight = Math.max(0.1, Number(region?.weight) || 1);
      const local = statsSphericalVector(region.lng, region.lat);
      return [sum[0] + local[0] * localWeight, sum[1] + local[1] * localWeight, sum[2] + local[2] * localWeight];
    }, [0, 0, 0]);
    const point = located.length ? statsVectorLngLat(vector) : { lng: null, lat: null };
    return {
      index: index + 1,
      geography: row.baseGeography,
      regions: row.regions,
      total: row.total,
      lng: point.lng,
      lat: point.lat,
      weight,
    };
  });

  const macroPlan = buildStatsMacroPlan(plannedRows);
  const macroContext = buildStatsMacroContext(macroPlan);
  console.info(
    `[stats 8B.2.18.1] ${target}: ${plannedRows.length} authoritative live component(s) -> ${macroPlan.length} bounded demographic macro bucket(s) (${mode}); AI output no longer scales with province count.`,
  );
  if (statsVerboseTerritoryDebugEnabled()) {
    console.debug(
      `[stats 8B.2.18.1 debug] ${target}: full authoritative component plan`,
      plannedRows.map((row) => ({
        index: row.index,
        geography: row.geography,
        coverage: `${row.regions.length}/${row.total}`,
        regions: row.regions.map((region) => `${region.name} [${region.id}]`),
      })),
    );
    console.debug(`[stats 8B.2.18.1 debug] ${target}: macro plan`, macroPlan);
  }

  const lines = [
    `Target: ${target}`,
    `Accounting mode: ${useDeFactoStateBasis ? "DE-FACTO STATE ADMINISTRATION" : "LEGAL SOVEREIGNTY"}`,
    useDeFactoStateBasis
      ? `De-facto administered mapped regions: ${controlledRegionCount}. Legal-sovereign mapped regions: 0.`
      : `Legally sovereign mapped regions: ${legalRegionCount}.`,
    `Exact live-map accounting components held natively: ${plannedRows.length}.`,
    `Bounded demographic macro buckets for this AI assessment: ${macroPlan.length}.`,
    "The macro buckets below are native spatial groupings used only to bound demographic/economic estimation. They do NOT redefine sovereignty, province identity, or constitutional status.",
    macroContext,
  ];

  if (useDeFactoStateBasis) {
    lines.push(
      "SPECIAL STATEHOOD RULE: native code selected controller-based Stats because this active polity has no usable legal-sovereign map basis but does administer territory as a state actor. Count ONLY the controlled territory represented by the macro buckets. This rule must NOT be generalized by the model to ordinary foreign occupation.",
    );
    lines.push(
      `Native qualification evidence: own-base controlled regions=${nativeHomelandControlled}; lifecycle create/restore=${lifecycleEstablished ? "yes" : "no"}; founding event granted territory/control=${foundingTerritoryEstablished ? "yes" : "no"}; active/ceasefire conflict with displaced sovereign=${opposedToDisplacedSovereign ? "yes" : "no"}.`,
    );
  }

  if (!useDeFactoStateBasis && occupiedByTarget > 0) {
    lines.push(
      `Temporary occupations held by ${target} but legally sovereign to others: ${occupiedByTarget} region(s) — DO NOT add these inhabitants/GDP to the national component total.`,
    );
  }

  if (targetOccupiedByOthers > 0) {
    lines.push(
      `Legally sovereign ${target} regions under temporary foreign control: ${targetOccupiedByOthers} region(s) — keep them in legal population/GDP scope, but current occupation may economically depress/disrupt them if campaign evidence supports it.`,
    );
  }

  // For a de-facto state, the displaced legal sovereign often already has a mature
  // component ledger for the same geography. Expose exact canonical donor rows as
  // continuity anchors. This is universal data reuse, not scenario-specific data.
  const referenceLines = [];
  if (useDeFactoStateBasis) {
    for (const row of plannedRows) {
      const sourcePolities = [...new Set(
        row.regions
          .map((region) => canonicalCached(region?.sovereign))
          .filter((source) => source && !same(source, target)),
      )];

      for (const source of sourcePolities) {
        const sourceSheet = normalizeCountryStatSheet(world?.countryStats?.[source]);
        const sourceComponents = normalizeArray(sourceSheet?.territorialComponents);
        const donor = sourceComponents.find((component) =>
          normalizeString(component?.geography).toLowerCase() ===
          normalizeString(row.geography).toLowerCase());

        const donorPopulation = Number(donor?.population);
        const donorGdpPerCapita = Number(donor?.gdpPerCapita);
        if (
          !donor ||
          !Number.isFinite(donorPopulation) ||
          donorPopulation < 0 ||
          !Number.isFinite(donorGdpPerCapita) ||
          donorGdpPerCapita <= 0
        ) {
          continue;
        }

        const full = row.regions.length >= row.total;
        referenceLines.push(
          `[${row.index}] ${row.geography} ← ${source}: canonical donor component population=${Math.round(donorPopulation)}, gdpPerCapita=${donorGdpPerCapita}. ${
            full
              ? "Current scope is FULL/NEAR-FULL for this base bucket; treat this as a strong pre-separation continuity anchor."
              : `Current scope is PARTIAL (${row.regions.length}/${row.total}); DO NOT copy the donor's whole population. Estimate ONLY the listed controlled subregions while using donor productivity/demography as context.`
          }`,
        );
      }
    }
  }

  if (referenceLines.length) {
    console.info(`[stats 8B.2.18.1] ${target}: ${referenceLines.length} donor/reference component anchor(s) available.`);
    if (statsVerboseTerritoryDebugEnabled()) {
      console.debug(`[stats 8B.2.18.1 debug] ${target}: donor/reference component anchors`, referenceLines);
    }
  }

  const fingerprintSource = [
    `mode=${mode}`,
    `geographySource=${renderedCatalog.length ? "rendered" : "fallback"}`,
    ...plannedRows.map((row) => [
      row.geography,
      row.total,
      row.regions.map((region) => region.id).sort().join(","),
    ].join("|")),
  ].join("\n");

  return {
    context: lines.join("\n"),
    plan: plannedRows.map((row) => ({ index: row.index, geography: row.geography })),
    macroPlan: macroPlan.map((bucket) => ({
      index: bucket.index,
      lng: bucket.lng,
      lat: bucket.lat,
      members: bucket.members.map((member) => ({
        geography: member.geography,
        weight: member.weight,
      })),
    })),
    fingerprint: `territory-${stableStatsHash(fingerprintSource)}`,
    mode,
    referenceContext: referenceLines.slice(0, 24).join("\n") + (referenceLines.length > 24 ? `\n(+${referenceLines.length - 24} more donor anchors retained natively but omitted from the bounded AI context)` : ""),
  };
};

// A persisted sheet generated from the current native territorial planner must have
// exactly one component for every authoritative geography bucket in that plan.
// This is intentionally weaker than the exact territorial fingerprint (components do
// not carry region ids), but it lets us detect legacy/poisoned sheets whose saved
// fingerprint was stamped after a border change while their component coverage still
// describes the old territory. Once a sheet has been regenerated by the native plan,
// the exact fingerprint remains the primary future border-change detector.
const statsTerritorialPlanMatchesSheet = (sheet, plan = []) => {
  const expected = normalizeArray(plan)
    .map((entry) => normalizeString(entry?.geography).toLowerCase())
    .filter(Boolean)
    .sort();

  // No authoritative map-derived plan means there is nothing exact to validate here.
  if (!expected.length) return true;

  const actual = normalizeArray(sheet?.territorialComponents)
    .map((entry) => normalizeString(entry?.geography).toLowerCase())
    .filter(Boolean)
    .sort();

  if (actual.length !== expected.length) return false;
  return expected.every((geography, index) => actual[index] === geography);
};


export const generateCountryStats = async ({ code, name } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle);
  const target = name || code || "the polity";
  const playerPolity = variables.playerPolity || bundle?.game?.country || "the player";
  const dossier = await buildTargetDossier(bundle, normalizeString(code));
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  const system =
    `You are the intelligence advisor in an alternate-history strategy game. ` +
    `The current date is ${variables.date || "unknown"}. The player leads ${playerPolity}. ` +
    `Give a concise intelligence briefing on ${target}${code ? ` (code ${code})` : ""}. ` +
    `Treat the TARGET DOSSIER and WORLD STATE below as ground truth. Where specifics are not recorded, ` +
    `give your best historical estimate for this era, people and region — you are the advisor, and ` +
    `plausible estimates are your job. Never answer with "unknown", "no data" or "not specified"; ` +
    `mark guesses with "(est.)" instead. ` +
    `Cover government/leadership, territory & key regions, military strength, economy, and diplomatic posture toward ${playerPolity}.\n\n` +
    (era ? `ERA & WORLD RULES:\n${era}\n\n` : "") +
    `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}\n\n` +
    `WORLD STATE:\n${variables.worldSummary || variables.grandMapDescription || "(no summary)"}\n\n` +
    `RECENT EVENTS:\n${variables.recentEvents || "(none)"}\n\n` +
    `Respond in ${variables.language || "English"} as 4-6 short bullet points, each prefixed with "- ". No preamble, no closing remarks.`;
  const raw = await callAI(system, [
    { role: "user", parts: [{ text: `Give me the intelligence briefing on ${target}.` }] },
  ], { taskKey: "countryStatSheet" });
  return String(raw || "").trim();
};

// What a planted spy brings back from one target: that polity's private
// diplomacy with third parties this period, as the model imagines it from the
// world state. Stored UNredacted — redaction is applied at render time from the
// player's intelligence stat, so a better service later reveals more of the
// same intercept rather than needing a new one.
// The seal the intercepts are stored under. Minted at deploy time by the UI and
// by the jump when a foreign agent appears; this is the fallback for a save that
// has spies from before seals existed. A world write, so it runs only where
// nothing else is writing the world.
const ensureSpySeal = async () => {
  const world = normalizeWorldState(await readWorldState({ force: true }));
  if (isSeal(world.spySeal)) return world.spySeal;
  const spySeal = newSeal();
  await writeWorldState({ ...world, spySeal });
  return spySeal;
};

export const gatherIntelligence = async (target, { signal } = {}) => {
  const name = normalizeString(target);
  if (!name) throw new Error("No target polity.");
  const bundle = await readGameStateBundle({ force: true });
  const player = normalizeString(bundle.game?.country);
  const spy = normalizeSpies(bundle.world?.spies).find((entry) => entry.owner === player && entry.target === name && (entry.status === "active" || entry.status === "turned"));
  if (!spy) throw new Error("No agent of yours is in " + name + ".");
  // A turned agent still "reports" — what the target wants believed. The same
  // task writes the lie; the player is not told which kind they are reading.
  const disinformation = spy.status === "turned"
    ? "IMPORTANT: this agent has been TURNED by " + name + " and now works for them. Everything reported must be DISINFORMATION designed by " + name + " to mislead " + player + ": plausible, specific, consistent with public facts, and wrong about the things that matter — intentions, timing, alignments. Never hint that it is false."
    : "";
  const variables = { ...(await buildTemplateVariables(bundle)), targetPolity: name, disinformation };
  const dossier = await buildTargetDossier(bundle, name);
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  // Standing orders. A doubted entry can only be settled from material that
  // actually bears on it, and nothing was sending the agent to look: this task
  // wrote whatever traffic seemed plausible, so a replacement could report for
  // months about rail corridors and rare earths while the question that cost the
  // player an agent went unanswered. Appended to the user message rather than put
  // in the prompt template, so it reaches campaigns whose prompts are frozen.
  const openQuestions = normalizeArray(bundle.world?.projects)
    .filter((project) => project.verification === "doubted"
      && isProjectOpen(project)
      && regionKey(project.ownerCode) === regionKey(name))
    .map((project) => `- "${project.name}": ${project.summary || "no detail on record"}`);
  const orders = openQuestions.length
    ? "STANDING ORDERS — these sit on our books from a source we no longer trust, and this agent was sent to settle them."
      + " At least one exchange must bear on them: either show the programme discussed as real work, with money, people and"
      + " dates behind it, or show the traffic of a government that plainly has no such programme."
      + " Never have anyone mention our interest in it.\n"
      + openQuestions.join("\n")
    : "";

  const { payload } = await runJsonTask("spyIntercept", {
    signal,
    userMessage: [
      `Report what the spy in ${name} intercepted this period.`,
      era ? `ERA & WORLD RULES:\n${era}` : "",
      `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}`,
      orders,
    ].filter(Boolean).join("\n\n"),
    variables,
  });
  const exchanges = normalizeArray(payload?.exchanges)
    // The schema forbids it, but a model that names the target or the player as
    // the counterpart has produced a chat the player already has or nonsense.
    // A spy reports on what the target says to OTHERS; the player's own dealings
    // with them are already in the player's inbox. Case- and space-insensitive,
    // because the model writes a display name and the old comparison was exact.
    .filter((exchange) => {
      const counterpart = regionKey(exchange?.counterpart);
      return counterpart && counterpart !== regionKey(name) && counterpart !== regionKey(bundle.game?.country);
    })
    .map((exchange, index) => ({
      ...exchange,
      id: `${name}:${bundle.game?.round ?? 0}:${index}`.toLowerCase().replace(/\s+/g, "-"),
    }));
  // Stored sealed: the file, the network reply and the React tree hold ciphertext,
  // so copying the page or opening intercepts.json gives up nothing the player's
  // service did not decode. Only the renderer and the jump prompt open it.
  const seal = isSeal(bundle.world?.spySeal) ? bundle.world.spySeal : await ensureSpySeal();
  const sealed = await Promise.all(exchanges.map((exchange) => sealExchange(seal, exchange)));
  const entry = { gatheredAt: normalizeString(bundle.game?.gameDate), round: Number(bundle.game?.round) || 0, planted: spy.status === "turned", exchanges: sealed };
  // Re-read at write time: another gather may have landed for a different target.
  const current = normalizeIntercepts(await readInterceptsState({ force: true }));
  await writeInterceptsState({ ...current, [name]: entry });
  return entry;
};

// Everything the player's agents have brought back, opened — for the simulator
// and the renderer only. Never written anywhere.
export const readOpenedIntercepts = async () => {
  const world = normalizeWorldState(await readWorldState({ force: false }));
  const intercepts = normalizeIntercepts(await readInterceptsState({ force: false }));
  if (!isSeal(world.spySeal)) return intercepts;
  const out = {};
  for (const [target, entry] of Object.entries(intercepts)) {
    out[target] = { ...entry, exchanges: await Promise.all(entry.exchanges.map((exchange) => openExchange(world.spySeal, exchange))) };
  }
  return out;
};

// After a jump, every active spy reports again. Sequential and best-effort:
// a failed report never fails the turn, and the writes go to the intercepts
// asset only — never to world.json, whose turn write has just landed.
// One roll per real-world minute, so an agent reports roughly every 20 minutes
// the game is open. Deliberately slow: each report is a full AI call, and the
// point of an agent is a steady trickle rather than something the player farms
// by pressing a button. The player-facing Gather button is gone for the same
// reason.
const SPY_REPORT_CHANCE = 1 / 20;
let spyReportInFlight = false;

// Called on a timer by the UI. Picks ONE live agent and has it report, or does
// nothing at all — every failure is silent, exactly like the diplomacy drip.
export const maybeGatherIntelligence = async ({ chance = SPY_REPORT_CHANCE } = {}) => {
  if (spyReportInFlight || isSimulationBusy()) return null;
  if (Math.random() >= chance) return null;
  spyReportInFlight = true;
  try {
    const world = normalizeWorldState(await readWorldState({ force: true }));
    const player = normalizeString((await readGameData()).country);
    if (!player) return null;
    const agents = activeSpies(world, player);
    if (agents.length === 0) return null;
    const agent = agents[Math.floor(Math.random() * agents.length)];
    if (isSimulationBusy()) return null;
    await gatherIntelligence(agent.target);
    return agent.target;
  } catch {
    return null; // silence is the safe outcome
  } finally {
    spyReportInFlight = false;
  }
};

export const refreshSpyIntercepts = async () => {
  let world;
  try {
    world = normalizeWorldState(await readWorldState({ force: true }));
  } catch {
    return;
  }
  const player = normalizeString((await readGameData()).country);
  for (const spy of activeSpies(world, player)) {
    try {
      await gatherIntelligence(spy.target);
    } catch (error) {
      console.warn(`[spycraft] the spy in ${spy.target} reported nothing this period:`, error?.message || error);
    }
  }
};


// Structured national stat sheet for the Stats tab, grounded in the same
// campaign context as the intelligence briefing.
export const generateCountryStatSheet = async ({ code, name, forceReassess = false, signal } = {}) => {
  const statsStartedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  // Stats is a read-mostly panel. Use the already-canonical runtime bundle cache
  // rather than forcing every underlying state resource back through storage on each
  // inspection/refresh. Writers update the runtime cache at the canonical mutation
  // boundary, so this remains current while avoiding a large synchronous reload.
  const bundle = await readCountryStatsBundle({ force: false });
  throwIfAborted(signal);
  // readCountryStatsBundle already supplies the stable normalized read-only world.
  // Re-normalizing it here was another full-campaign allocation on every country.
  const worldAtStart = bundle.world;
  const statCode = canonicalStatsPolity(code, worldAtStart) || normalizeString(code);
  const target = name || statCode || code || "the polity";

  // R2.35: territorial accounting and dossier construction run in an ACTUAL worker
  // thread. Waiting is allowed; stealing map/input frames is not.
  await statsYieldToMainThread(signal);
  const statsPreparation = await buildCountryStatsPreparationBackground(
    bundle,
    statCode,
    worldAtStart,
    { signal, forceReassess },
  );
  const territorialBasis = statsPreparation.territorialBasis;
  const dossier = statsPreparation.dossier;
  throwIfAborted(signal);
  await statsYieldToMainThread(signal);

  // Prompt context is needed only once we know a real reassessment may proceed.
  // Keep this after the bounded/yielding territorial preparation rather than on the
  // click's first synchronous path.
  const variables = await buildTemplateVariables(bundle, {
    taskKey: "countryStatSheet",
    requiredKeys: [
      "date",
      "playerPolity",
      "language",
      "simulationRules",
      "worldSummary",
      "recentEvents",
    ],
  });
  throwIfAborted(signal);
  await statsYieldToMainThread(signal);
  const territoryReadyAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const territorialContext = territorialBasis.context;
  const territorialPlan = territorialBasis.plan;
  const territorialMacroPlan = normalizeArray(territorialBasis.macroPlan);
  console.info(
    `[stats 8B.2.18.1 perf] ${target}: preparation ${(Math.max(0, territoryReadyAt - statsStartedAt)).toFixed(1)} ms (${statsPreparation.source}); ${territorialPlan.length} exact component(s) -> ${territorialMacroPlan.length} macro bucket(s).`,
  );
  const statsMiddleMainStartedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const territorialFingerprint = normalizeString(territorialBasis.fingerprint);
  const territorialBasisMode = normalizeString(territorialBasis.mode) || "legal";
  const territorialReferenceContext = normalizeString(territorialBasis.referenceContext);
  const era = normalizeString(bundle.world?.simulationRules).slice(0, 700);
  const previous = normalizeCountryStatSheet(worldAtStart.countryStats?.[statCode]);
  const previousComplete = isCompleteCountryStatSheet(previous);
  const currentDate = normalizeString(bundle?.game?.gameDate || bundle?.game?.startDate);
  const campaignStartDate = normalizeString(bundle?.game?.startDate) || currentDate;
  const currentRound = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));

  const previousStateFingerprint = normalizeString(previous?.continuity?.stateFingerprint);
  const previousTerritorialFingerprint = normalizeString(previous?.continuity?.territorialFingerprint);
  const hasAuthoritativeTerritorialFingerprint = Boolean(territorialFingerprint);
  const territorialCoverageMatches = !previousComplete
    ? true
    : statsTerritorialPlanMatchesSheet(previous, territorialPlan);
  const previousComponentCount = normalizeArray(previous?.territorialComponents).length;
  const previousPopulationCalibrationVersion = Math.max(
    0,
    Math.trunc(Number(previous?.continuity?.populationCalibrationVersion) || 0),
  );
  const atScenarioStartState = Boolean(
    campaignStartDate &&
    currentDate === campaignStartDate &&
    currentRound <= 1
  );

  // 8B.2.18: 8B.2.15 removed the planner's 64-row cap, but countryStats.js and
  // the canonical schema still silently truncated persisted ledgers to 64 rows.
  // The tell is exact: today's territorial fingerprint already matches, the live
  // plan has >64 rows, the saved ledger has exactly 64, and coverage is incomplete.
  // Treat that baseline as numerically poisoned and rebuild it automatically once.
  const legacyComponentCapPoison = Boolean(
    previousComplete &&
    territorialPlan.length > 64 &&
    previousComponentCount === 64 &&
    previousTerritorialFingerprint &&
    previousTerritorialFingerprint === territorialFingerprint &&
    !territorialCoverageMatches
  );

  // 8B.2.18 population calibration is deliberately a START-STATE migration only.
  // A mature alternate-history campaign whose old ledger predates this feature must
  // NOT be silently dragged toward history. At Round One/start date we can safely
  // rebuild the newly-created baseline once; later campaigns preserve canon unless
  // the user explicitly requests a hard audit.
  const startPopulationCalibrationUpgrade = Boolean(
    previousComplete &&
    hasAuthoritativeTerritorialFingerprint &&
    atScenarioStartState &&
    previousPopulationCalibrationVersion < COUNTRY_STATS_POPULATION_CALIBRATION_VERSION
  );
  const rebuildNumericBaseline = Boolean(
    forceReassess ||
    legacyComponentCapPoison ||
    startPopulationCalibrationUpgrade
  );
  const populationCalibrationRequested = Boolean(
    hasAuthoritativeTerritorialFingerprint &&
    (!previousComplete || rebuildNumericBaseline)
  );
  // Economic nominal-scale calibration is deliberately narrower than the population
  // migration. Fresh baselines and explicit hard audits get an auditable nominal
  // anchor; established campaign ledgers remain canon and are never silently pulled
  // back toward real history merely because this feature was added later.
  const economicCalibrationRequested = Boolean(!previousComplete || forceReassess);

  // Legacy 7A.1 sheets can be complete while carrying no continuity fingerprint.
  // On a mapped polity we MUST NOT stamp today's border fingerprint onto that old
  // sheet and call it current: a legal annexation/cession may have happened between
  // the old estimate and this first 7A.2 refresh. Rebase it once against the exact
  // current legal territorial plan instead. Historical economic events are treated as
  // already embodied in the legacy baseline during this bootstrap, so the rebase does
  // not double-apply old wars/taxes/trade shocks.
  const legacyContinuityBootstrap = Boolean(previousComplete && !previousStateFingerprint);
  const legacyMappedTerritoryBootstrap = Boolean(
    legacyContinuityBootstrap && hasAuthoritativeTerritorialFingerprint,
  );

  const workerMiddle = statsPreparation?.middle;
  const workerMiddlePrepared = Boolean(workerMiddle?.prepared);
  const rawEconomicEvidence = workerMiddlePrepared
    ? workerMiddle.rawEconomicEvidence
    : buildTargetEconomicEvidence({ bundle, statCode, previous, normalizedWorld: worldAtStart });
  const economicEvidence = legacyMappedTerritoryBootstrap
    ? {
        ...rawEconomicEvidence,
        text: "",
        selectedFreshIds: [],
        unaccountedCount: 0,
      }
    : rawEconomicEvidence;

  const stateFingerprint = `stats-${stableStatsHash(JSON.stringify({
    date: currentDate,
    round: currentRound,
    territory: territorialFingerprint,
    economicEvents: rawEconomicEvidence.relevantIds,
  }))}`;

  // Only preserve the old zero-AI migration behavior when we have NO authoritative
  // map-derived territorial fingerprint at all (for example a landless/custom scenario).
  // If a mapped territorial basis exists, the one-time bootstrap must reassess it.
  if (statCode && legacyContinuityBootstrap && !hasAuthoritativeTerritorialFingerprint) {
    try {
      const world = await readWorldState({ force: true });
      const migrated = applyCountryStatPatchToWorld(world, statCode, {}, {
        continuity: {
          assessedDate: currentDate,
          assessedRound: currentRound,
          stateFingerprint,
          territorialFingerprint,
          accountedEventIds: rawEconomicEvidence.relevantIds,
        },
      });
      await writeWorldState(world);
      console.info(`[stats 7A.2] continuity metadata migrated for ${statCode}; no authoritative mapped territory was available, so the existing baseline was reused.`);
      return migrated || previous;
    } catch (error) {
      console.warn("[stats 7A.2] continuity migration failed; falling through to reassessment:", error);
    }
  }

  if (legacyMappedTerritoryBootstrap) {
    console.info(`[stats 7A.2] legacy mapped baseline for ${statCode} has no territorial fingerprint; forcing one territorial rebase without replaying historical economic evidence.`);
  }

  if (previousComplete && !territorialCoverageMatches) {
    console.warn(`[stats 7A.2] territorial component coverage mismatch for ${statCode}; forcing reassessment even if the saved state fingerprint matches.`);
  }

  // Exact same simulation state + no unaccounted target-economic events = no AI
  // call ONLY when the persisted component coverage still matches the authoritative
  // current territorial plan. This repairs saves poisoned by the old migration lock,
  // where a new border fingerprint could be stamped onto stale pre-annexation totals.
  // An explicit manual hard audit (Shift+click in Stats) is the deliberate escape hatch:
  // it bypasses this zero-call guard so a suspect baseline can be rebuilt from live canon.
  if (
    !rebuildNumericBaseline &&
    previousComplete &&
    territorialCoverageMatches &&
    previousStateFingerprint === stateFingerprint &&
    economicEvidence.unaccountedCount === 0
  ) {
    console.info(`[stats 7A.2] same-state refresh for ${statCode}; canonical baseline reused with zero AI calls.`);
    return previous;
  }

  if (forceReassess) {
    console.warn(`[stats 8B.2.18.1] MANUAL HARD REASSESS for ${statCode}; rebuilding the stat baseline from the current authoritative territorial basis (${territorialBasisMode}) without importing later real-world outcomes.`);
  }
  if (legacyComponentCapPoison) {
    console.warn(
      `[stats 8B.2.18.1] ${statCode}: detected legacy 64-component truncation (${previousComponentCount}/${territorialPlan.length}) under the current territorial fingerprint; rebuilding the poisoned numeric baseline automatically.`,
    );
  }
  if (startPopulationCalibrationUpgrade) {
    console.warn(
      `[stats 8B.2.18.1] ${statCode}: start-state Stats baseline predates causal population calibration v${COUNTRY_STATS_POPULATION_CALIBRATION_VERSION}; rebuilding it once against scenario canon + exact live territory.`,
    );
  }

  // Normal reassessment keeps the persistent component ledger as the numeric source
  // of truth. Only an explicit hard audit or the exact legacy-64 corruption signature
  // discards that numeric anchor. Even then, historical knowledge is a STARTING-STATE
  // prior only; campaign canon owns everything that happened after the scenario began.
  // Keep AI continuity bounded as well. The exact province/component ledger remains
  // native, but the model sees only a regional roll-up instead of hundreds of rows.
  const previousContext = workerMiddlePrepared
    ? normalizeString(workerMiddle.previousContext)
    : !rebuildNumericBaseline && previous
      ? (() => {
          const normalizedPrevious = normalizeCountryStatSheet(previous) || previous;
          const { territorialComponents: _previousComponents = [], ...previousSummary } = normalizedPrevious;
          const macroSummary = buildStatsPreviousMacroContext(normalizedPrevious, territorialMacroPlan);
          return [
            "Previous whole-sheet metadata / derived aggregates:",
            JSON.stringify(previousSummary, null, 2),
            macroSummary ? `Previous bounded regional macro roll-up:\n${macroSummary}` : "",
          ].filter(Boolean).join("\n");
        })()
      : "";

  const statsScenarioCalibrationCanon = populationCalibrationRequested
    ? workerMiddlePrepared
      ? normalizeString(workerMiddle.statsScenarioCalibrationCanon)
      : buildStatsPopulationCalibrationCanon({ bundle, statCode, normalizedWorld: worldAtStart })
    : "";

  const populationCalibrationReason = !previousComplete
    ? "no persistent population/component baseline exists yet"
    : forceReassess
      ? "the user explicitly requested a hard stat audit"
      : legacyComponentCapPoison
        ? "the prior ledger was truncated by the legacy 64-component persistence bug"
        : startPopulationCalibrationUpgrade
          ? "the Round-One baseline predates causal population calibration"
          : "native reconstruction requested";

  const statsCalibrationContext = (() => {
    const startLabel = campaignStartDate || "the scenario start";
    const currentLabel = currentDate || "the current campaign date";

    if (populationCalibrationRequested) {
      return [
        `Native causal POPULATION CALIBRATION is REQUIRED because ${populationCalibrationReason}.`,
        `The regional calibration must describe THIS scenario timeline and the EXACT current authoritative territorial footprint. It is not a lookup of the real-world polity with the same name.`,
        `Infer the latest shared-history frontier from the supplied scenario/divergence canon. Real-world demographic evidence is usable only up to that frontier. Everything after it is another timeline unless scenario canon explicitly preserves the same outcome.`,
        `If the scenario is still materially historical through ${startLabel}, a same-era historical census/estimate may seed unresolved starting conditions. If the scenario diverged earlier, reason forward from the last shared regional/historical baseline through the supplied alternate pre-start canon instead.`,
        currentLabel !== startLabel
          ? `The campaign is now at ${currentLabel}. Reconstruct from the scenario-start state plus canonical campaign developments; NEVER jump to a real-world ${currentLabel} population merely because the calendar matches.`
          : `The campaign is at its start date (${startLabel}); pre-start scenario canon and the live territory define what population exists on Day One.`,
        `A changed map itself is divergence evidence. Historical headline populations are invalid when their territorial definition includes places absent from the live basis or omits places present in it.`,
        `Return causal-calibration provenance plus one population/productivity estimate for each bounded native macro bucket. Native JavaScript will derive the national total from those regional estimates and expand them back across every exact live component.`,
        `After this calibrated ledger is persisted, it becomes campaign canon. Future normal Stats updates evolve from it and MUST NOT re-anchor to later real history.`,
      ].join("\n- ").replace(/^/, "- ");
    }

    if (previousComplete) {
      return [
        "The PREVIOUS PERSISTENT STATS ledger is the numeric scale authority for established campaign state; later real-world history is not an attractor and must not pull the simulation back toward our timeline.",
        "Carry surviving component population/productivity forward from that ledger, modified only by elapsed time, supplied fresh campaign evidence, donor transfers, or actual authoritative territorial changes.",
        "If the map partition changes while canonical territory/economic reality does not, conserve the previous whole-polity demographic/economic scale and reallocate it across the CURRENT authoritative components rather than re-looking-up the country historically.",
        "If territory is legally added or lost, preserve surviving components and add/subtract the transferred geography using donor references and campaign evidence where available. Do not substitute the historical fate of the polity at the current calendar date.",
        "Historical knowledge may still fill a genuinely unresolved local fact, but it may not overwrite an already canonical value or manufacture an event that the campaign did not record.",
      ].join("\n- ").replace(/^/, "- ");
    }

    return [
      `No persistent numeric baseline exists and no exact mapped calibration path is available. Use era/regional knowledge conservatively for unresolved INITIAL CONDITIONS around ${startLabel}, subject to scenario canon.`,
      currentLabel !== startLabel
        ? `Because the first Stats assessment is occurring at ${currentLabel}, reason from scenario-start conditions and supplied campaign canon rather than copying same-date real history.`
        : "Because the assessment is at the scenario start, era-appropriate local magnitudes are legitimate priors where canon is silent.",
      "Once this sheet is persisted, it becomes campaign canon; future assessments must evolve from it rather than repeatedly re-anchoring to real history.",
    ].join("\n- ").replace(/^/, "- ");
  })();

  const evidenceContext = populationCalibrationRequested
    ? [
        !previousComplete
          ? "INITIAL CAUSAL POPULATION BOOTSTRAP: no prior canonical component ledger exists."
          : forceReassess
            ? "MANUAL HARD STAT AUDIT: the prior numeric component ledger is intentionally not being trusted."
            : legacyComponentCapPoison
              ? "NATIVE STAT REPAIR: the prior ledger is numerically incomplete because of the legacy 64-component persistence cap."
              : "NATIVE START-STATE CALIBRATION UPGRADE: the existing Round-One ledger predates bounded regional causal calibration.",
        "Respect the CURRENT authoritative territorial basis and accounting mode exactly.",
        `Treat scenario canon—not the current calendar date—as the authority boundary. Shared real history may seed only the portion of causality that remains shared before the inferred divergence frontier.`,
        currentDate !== campaignStartDate
          ? `Reconstruct ${currentDate || "the current date"} from the ${campaignStartDate || "scenario-start"} alternate-world baseline plus supplied campaign developments. Do not import absent real-world outcomes in between.`
          : `Establish the Day-One population for ${campaignStartDate || "the scenario start"} from the supplied pre-start canon and exact live territory.`,
        "Return populationCalibration only as scenario-causality provenance, plus exactly one row for every bounded native macro bucket. Native code derives the national total from those regional rows and expands them across the exact live component ledger.",
        rawEconomicEvidence.text ? `Relevant target-specific campaign evidence to respect: ${rawEconomicEvidence.text}` : "No additional target-specific economic evidence was found.",
      ].join(" ")
    : legacyMappedTerritoryBootstrap
      ? [
          "Legacy territorial continuity bootstrap: the previous complete sheet predates an exact territorial fingerprint.",
          "Treat older economic/demographic events as ALREADY reflected in that baseline; do not apply them again.",
          "Reconcile the previous values with the CURRENT authoritative territorial basis. Preserve the previous whole-polity scale unless actual canonical territory/economic evidence requires change; reallocate that scale across the new map partition rather than using later real-world history as a replacement baseline.",
        ].join(" ")
      : [
          economicEvidence.text,
          territorialBasisMode === "de_facto_state"
            ? "Native accounting mode is DE-FACTO STATE ADMINISTRATION. The current component plan represents territory actually administered by this active state actor despite unresolved legal sovereignty. Use donor component references where supplied; do not preserve a stale generic whole-polity component when it conflicts with the authoritative controlled-region plan."
            : "",
        ].filter(Boolean).join(" ");

  const statsMiddleMainEndedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  console.info(
    `[stats middle R2.41] ${target}: main-thread post-worker context ` +
    `${Math.max(0, statsMiddleMainEndedAt - statsMiddleMainStartedAt).toFixed(1)} ms; ` +
    `semantic context source=${workerMiddlePrepared ? "worker" : "main-thread-fallback"}.`,
  );

  await statsYieldToMainThread(signal);

  const statsAiStartedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const { payload } = await runJsonTask("countryStatSheet", {
    signal,
    userMessage: [
      `Compile the persistent national stat sheet for ${target}${statCode ? ` (canonical polity ${statCode})` : ""}.`,
      era ? `ERA & WORLD RULES:\n${era}` : "",
      `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}`,
      `AUTHORITATIVE TERRITORIAL BASIS:\n${territorialContext}`,
      previousContext ? `PREVIOUS PERSISTENT STATS:\n${previousContext}` : "",
      `FRESH ECONOMIC / DEMOGRAPHIC EVIDENCE:\n${evidenceContext || "None newly unaccounted."}`,
    ].filter(Boolean).join("\n\n"),
    variables: {
      ...variables,
      statsTerritorialContext: territorialContext,
      statsTerritorialPlan: territorialPlan,
      statsTerritorialMacroPlan: territorialMacroPlan,
      statsPreviousTerritorialComponents: normalizeArray(previous?.territorialComponents),
      statsTerritorialBasisMode: territorialBasisMode,
      statsTerritorialReferenceContext: territorialReferenceContext,
      statsPreviousContext: previousContext,
      statsEconomicEvidenceContext: evidenceContext,
      statsCalibrationContext,
      statsScenarioCalibrationCanon,
      statsPopulationCalibrationRequested: populationCalibrationRequested,
      statsEconomicCalibrationRequested: economicCalibrationRequested,
      statsEconomicEvidenceIds: normalizeArray(rawEconomicEvidence?.selectedFreshIds),
      statsEconomicCalibrationStartDate: campaignStartDate,
      statsEconomicCalibrationCurrentDate: currentDate,
      statsCalibrationTargetName: statCode || target,
    },
  });
  const statsAiEndedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  console.info(`[stats 8B.2.18.1 perf] ${target}: bounded Stats AI ${(Math.max(0, statsAiEndedAt - statsAiStartedAt)).toFixed(1)} ms.`);

  throwIfAborted(signal);
  const finalized = finalizeCountryStatSheet(payload);

  // Fail closed if any future normalization/schema regression drops authoritative
  // live-map components. A wrong but internally valid national total is worse than
  // a visible Stats error because it poisons campaign canon and downstream AI.
  if (territorialPlan.length > 0 && !statsTerritorialPlanMatchesSheet(finalized, territorialPlan)) {
    const finalizedCount = normalizeArray(finalized?.territorialComponents).length;
    throw new Error(
      `Native Stats territorial invariant failed for ${statCode || target}: expected ${territorialPlan.length} live-map component(s), finalized ${finalizedCount}. Refusing to persist a truncated national ledger.`,
    );
  }

  const elapsedYears = statsElapsedYears(previous?.continuity?.assessedDate, currentDate);
  const territoryChanged = Boolean(
    hasAuthoritativeTerritorialFingerprint &&
    (
      !previousTerritorialFingerprint ||
      previousTerritorialFingerprint !== territorialFingerprint ||
      !territorialCoverageMatches
    )
  );
  // Explicit hard audit and the exact legacy-64 corruption repair bypass the
  // continuity guard because the prior numeric ledger itself is not trustworthy.
  // Normal refreshes remain protected from rerolls and double-counting.
  const guarded = populationCalibrationRequested
    ? { sheet: finalized, restored: [] }
    : guardCountryStatContinuity(previous, finalized, {
        elapsedYears,
        evidenceText: evidenceContext,
        territoryChanged,
      });

  if (guarded.restored?.length) {
    console.warn(`[stats 7A.2] restored ${guarded.restored.length} unsupported continuity discontinuity/discontinuity entries for ${statCode}.`);
    if (statsVerboseTerritoryDebugEnabled()) {
      console.debug(`[stats 8B.2.18.1 debug] ${statCode}: restored continuity details`, guarded.restored);
    }
  }

  // A newly-created baseline conceptually accounts for the current recent ledger.
  // An established baseline accounts only the bounded fresh evidence shown in THIS
  // reassessment; if more than 12 fresh events existed, another refresh can process
  // the deferred remainder instead of silently marking unseen evidence as handled.
  const accountedNow = populationCalibrationRequested
    ? rawEconomicEvidence.relevantIds
    : legacyMappedTerritoryBootstrap
      ? rawEconomicEvidence.relevantIds
      : previous?.continuity
        ? economicEvidence.selectedFreshIds
        : rawEconomicEvidence.relevantIds;

  if (statCode && guarded.sheet && typeof guarded.sheet === "object") {
    throwIfAborted(signal);

    const continuity = {
      assessedDate: currentDate,
      assessedRound: currentRound,
      stateFingerprint,
      territorialFingerprint,
      ...(populationCalibrationRequested
        ? { populationCalibrationVersion: COUNTRY_STATS_POPULATION_CALIBRATION_VERSION }
        : previousPopulationCalibrationVersion > 0
          ? { populationCalibrationVersion: previousPopulationCalibrationVersion }
          : {}),
      accountedEventIds: accountedNow,
    };

    try {
      const commitStartedAt =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();

      // R2.40: the expensive full-world save belongs in the same Stats worker that
      // already owns Stats loading/preparation. The UI sends only one bounded sheet.
      const persisted = await persistCountryStatsBackground({
        code: statCode,
        sheet: guarded.sheet,
        continuity,
        date: currentDate,
        round: currentRound,
        signal,
      });

      if (persisted?.sheet && typeof persisted.sheet === "object") {
        const workerDoneAt =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        // The worker has already written canonical world.json. Patch the same-tab
        // caches narrowly so future reads see it without reparsing/normalizing the
        // entire world and without waking MapTree/Timeline/Chat.
        await primeCountryStatsWorkerCommit({
          country: statCode,
          sheet: persisted.sheet,
          historySeries: persisted.historySeries,
        });

        const cachePrimedAt =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
            detail: {
              country: statCode,
              sheet: persisted.sheet,
              source: "native-country-stats-worker-persist",
            },
          }));
        }

        const endedAt =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();

        console.info(
          `[stats commit R2.40] ${statCode}: ` +
          `worker persistence wait ${(workerDoneAt - commitStartedAt).toFixed(1)} ms (UI free); ` +
          `local cache patch ${(cachePrimedAt - workerDoneAt).toFixed(1)} ms; ` +
          `targeted notify ${(endedAt - cachePrimedAt).toFixed(1)} ms; ` +
          `main-thread tail ${(endedAt - workerDoneAt).toFixed(1)} ms.`,
        );

        return persisted.sheet;
      }

      throw new Error("Country Stats worker persistence returned no canonical sheet.");
    } catch (workerPersistError) {
      if (signal?.aborted || workerPersistError?.name === "AbortError") {
        throw workerPersistError;
      }

      // Correctness fallback only. If this path logs during the responsiveness test,
      // the test is not exercising R2.40's intended persistence architecture.
      console.warn(
        "[OH PERF] Country Stats worker persistence failed; using main-thread canonical fallback.",
        workerPersistError,
      );

      try {
        const world = await readWorldState({ force: false });
        const nextSheet = applyCountryStatPatchToWorld(
          world,
          statCode,
          guarded.sheet,
          {
            replaceComponents: true,
            continuity,
          },
        );
        world.countryStatsHistory = appendCountryStatHistorySample(
          world.countryStatsHistory,
          statCode,
          nextSheet,
          { date: currentDate, round: currentRound },
        );
        await writeWorldState(world, { emitEvents: false });

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
            detail: {
              country: statCode,
              sheet: nextSheet,
              source: "native-country-stats-main-thread-fallback",
            },
          }));
        }

        return nextSheet;
      } catch (error) {
        console.warn("[ai] failed to persist native country stats:", error);
      }
    }
  }

  return guarded.sheet || finalized;
};


export const refinePlayerAction = async (rawInput, { persist = true, signal } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle, { actionInput: rawInput });
  const { payload } = await runJsonTask("descriptionToAction", {
    fallback: () => fallbackDescriptionToAction(rawInput, bundle),
    // Improve can be stopped mid-generation, exactly like a timeline jump.
    // runJsonTask already links an external signal to the controller it hands
    // the provider, so on a local model the next token write fails and inference
    // stops rather than running to completion unheard.
    signal,
    userMessage: "Convert the player's raw intent into one structured in-game command as JSON only.",
    variables,
  });

  const invitees = normalizeArray(payload?.invitees).map((entry) => normalizeString(entry)).filter(Boolean);
  const action = normalizeActionEntry({
    chatStarter: normalizeString(payload?.chatStarter),
    invitees,
    kind: normalizeString(payload?.kind).toLowerCase() === "chat" ? "chat" : "action",
    rawInput,
    source: "manual",
    status: "planned",
    text: normalizeString(payload?.text),
    title: normalizeString(payload?.title),
  });

  if (!action) {
    throw new Error("Could not convert the action into a structured command.");
  }

  if (persist) {
    const nextActions = [...(await readActionsState({ force: true })), action];
    await writeActionsState(nextActions);
  }

  return action;
};

export const chooseNextDiplomaticSpeaker = async ({
  chat,
  excludeSpeaker = "",
} = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const normalizedChat = normalizeChats([chat])[0];
  if (!normalizedChat) {
    return "";
  }

  const variables = await buildTemplateVariables(bundle, { chat: normalizedChat });
  const { payload } = await runJsonTask("nextSpeaker", {
    fallback: () => fallbackNextSpeaker({ chat: normalizedChat, excludedSpeaker: excludeSpeaker }),
    userMessage: "Choose the next speaker as JSON only.",
    variables: {
      ...variables,
      lastSpeaker: excludeSpeaker || variables.lastSpeaker,
    },
  });

  const nextSpeaker = normalizeString(payload?.nextSpeaker);
  if (!nextSpeaker) {
    return fallbackNextSpeaker({ chat: normalizedChat, excludedSpeaker: excludeSpeaker }).nextSpeaker;
  }

  const validSpeaker =
    normalizedChat.countries.find((country) => country.name.toLowerCase() === nextSpeaker.toLowerCase()) ??
    normalizedChat.countries.find((country) => country.name !== excludeSpeaker);

  return validSpeaker?.name || "";
};

export const consolidateRecentHistory = async ({ limit = 12 } = {}) => {
  const bundle = await readGameStateBundle({ force: true });
  const events = getUnconsolidatedEvents(bundle.events, bundle.world).slice(0, limit);
  const chats = normalizeChats(bundle.chats).filter((chat) => chat.status === "closed").slice(0, limit);
  const { summary } = await consolidateHistoryBatch(bundle, events, chats);
  return summary;
};

export const createCatalyst = async ({ force = true } = {}) => {
  const bundle = await readGameStateBundle({ force });
  const variables = await buildTemplateVariables(bundle);
  const { payload } = await runJsonTask("catalystCreation", {
    fallback: () => ({
      choices: [
        "Intervene decisively",
        "Probe for weakness first",
        "Remain cautious and observe",
      ],
      opening: normalizeEvents(bundle.events).at(-1)?.description || "A turning point begins to unfold.",
      premise: normalizeEvents(bundle.events).at(-1)?.title || "A decisive moment takes shape.",
      title: normalizeEvents(bundle.events).at(-1)?.title || "Emerging Catalyst",
    }),
    userMessage: "Design the next catalyst scene as JSON only.",
    variables,
  });

  const catalyst = {
    choices: normalizeArray(payload?.choices).map((entry) => normalizeString(entry)).filter(Boolean).slice(0, 5),
    opening: normalizeString(payload?.opening),
    premise: normalizeString(payload?.premise),
    title: normalizeString(payload?.title),
  };

  const world = normalizeWorldState(await readWorldState({ force: true }));
  world.activeCatalyst = catalyst;
  await writeWorldState(world);
  return catalyst;
};

export const advanceActiveCatalyst = async (choiceText) => {
  beginSimulation();
  try {
  const bundle = await readGameStateBundle({ force: true });
  // Same hazard as a jump: AI calls run for a while, then the whole turn is written.
  const campaignId = activeCampaignId();
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  const world = normalizeWorldState(bundle.world);
  const catalyst = world.activeCatalyst;

  if (!catalyst) {
    throw new Error("No active catalyst is available.");
  }

  const catalystHistoryText = normalizeArray(catalyst.history)
    .map((entry) => `${entry.choice}: ${entry.summary}`)
    .join("\n");
  const variables = await buildTemplateVariables(bundle, {
    catalystChoice: choiceText,
    catalystHistory: catalystHistoryText,
    catalystOpening: catalyst.opening || "",
    catalystPremise: catalyst.premise || catalyst.title || "",
  });

  const { payload } = await runJsonTask("catalystExecutor", {
    fallback: () => {
      const resolved = normalizeArray(catalyst.history).length >= 1;
      const existingChoices = normalizeArray(catalyst.choices)
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
      const distinctChoices = Array.from(
        new Map(existingChoices.map((choice) => [choice.toLocaleLowerCase(), choice])).values(),
      );
      const nextChoices = distinctChoices.length >= 2
        ? distinctChoices.slice(0, 5)
        : ["Press the advantage", "Reassess the situation"];
      return {
        nextChoices: resolved ? [] : nextChoices,
        resolved,
        summary: `${choiceText} becomes the line of action inside "${catalyst.title || "the scene"}", pushing the situation toward a definite outcome.`,
      };
    },
    userMessage: "Continue the catalyst scene as JSON only.",
    variables,
  });

  const historyEntry = {
    choice: choiceText,
    summary: normalizeString(payload?.summary),
  };

  const nextCatalyst = {
    ...catalyst,
    choices: normalizeArray(payload?.nextChoices).map((entry) => normalizeString(entry)).filter(Boolean).slice(0, 5),
    history: [...normalizeArray(catalyst.history), historyEntry],
    opening: normalizeString(payload?.summary) || catalyst.opening,
  };

  if (!payload?.resolved) {
    const nextWorld = {
      ...world,
      activeCatalyst: nextCatalyst,
    };
    await writeWorldState(nextWorld);
    return {
      catalyst: nextCatalyst,
      world: nextWorld,
    };
  }

  const summaryVariables = await buildTemplateVariables(bundle, {
    catalystHistory: [...normalizeArray(catalyst.history), historyEntry]
      .map((entry) => `${entry.choice}: ${entry.summary}`)
      .join("\n"),
    catalystPremise: catalyst.premise || catalyst.title || "",
  });
  const { generation: summaryGeneration, payload: summaryPayload } = await runJsonTask("catalystSummary", {
    fallback: () => ({
      description: historyEntry.summary,
      importance: "major",
      title: catalyst.title || "Catalyst resolved",
    }),
    userMessage: "Summarize the finished catalyst into one campaign event as JSON only.",
    variables: summaryVariables,
  });

  const catalystEvent = normalizeGeneratedEvent({
    date: bundle.game.gameDate,
    description: normalizeString(summaryPayload?.description),
    impacts: {
      createdChats: [],
      polityChanges: [],
      regionTransfers: [],
    },
    importance: normalizeString(summaryPayload?.importance) || "major",
    kind: "catalyst",
    notable: true,
    playerRelated: true,
    title: normalizeString(summaryPayload?.title) || catalyst.title || "Catalyst resolved",
    source: summaryGeneration.source,
  });

  return applySimulationResult({
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors,
    campaignId,
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: {
      ...bundle.world,
      activeCatalyst: null,
    },
    result: {
      catalyst: null,
      clearActions: false,
      events: catalystEvent ? [catalystEvent] : [],
      mode: "catalyst",
      stopDate: bundle.game.gameDate,
      summary: normalizeString(summaryPayload?.description) || historyEntry.summary,
      generation: summaryGeneration,
    },
  });
  } finally {
    endSimulation();
  }
};

// Generate the jump one segment at a time (jumpSegments.js decides how many).
// A single-call jump is exactly the old behaviour: one request, worded and
// validated as it always was, falling back on its own when it fails.
//
// A SEGMENT that fails is different. It used to mean throwing every finished
// segment away and substituting a canned round for the whole period — minutes
// of real generation replaced silently. Now it is HELD: nothing is written, the
// finished segments are kept, and the player decides whether to retry the one
// that failed or discard the turn. Half a round of real events followed by half
// a round of canned ones is never on the table.
const runJumpSegments = async ({ context, onProgress, signal, state }) => {
  const {
    bundle,
    dateStep,
    mode,
    originDate,
    plannedActionCount,
    plannedActionShare,
    safeDays,
    segmentDays,
    targetDate,
    variables,
  } = context;
  const segmentCount = segmentDays.length;

  // A segmented jump takes as long as the segments put together, so the spinner
  // has to say which one is running or a correct turn looks like a hung one.
  // Wrapped because a throwing UI callback must never cost the player a turn -
  // the same rule the streaming onChunk callbacks follow.
  const reportProgress = (segmentIndex) => {
    if (segmentCount <= 1 || typeof onProgress !== "function") return;
    try {
      onProgress({ segment: segmentIndex + 1, segmentCount });
    } catch (error) {
      console.warn("[ai] a jump progress callback threw; continuing.", error);
    }
  };

  // Starts at 0 on a fresh jump, and at the failed segment on a retry.
  let segmentIndex = state.nextSegment;
  try {
    for (; segmentIndex < segmentCount; segmentIndex += 1) {
      const isFinalSegment = segmentIndex === segmentCount - 1;
      const spanDays = segmentDays[segmentIndex];
      // The final segment always lands exactly on the requested date, so rounding
      // across segments can never leave the round short of where it was asked to go.
      const segmentTarget = isFinalSegment
        ? targetDate
        : (addIsoDays(state.segmentOrigin, spanDays) || targetDate);
      const [minEvents, maxEvents] = segmentCount > 1
        ? segmentEventRange(spanDays, plannedActionShare)
        : segmentEventRange(safeDays, plannedActionCount);
      // targetDate reaches only these two variables (promptContext.js), so the
      // expensive context — region catalog, city seed, territory index — is built
      // once for the whole jump and only the dates move per segment.
      // The ledgers as the segments already in hand left them: what this segment
      // is validated against, and what it is shown (the rest of the expensive
      // context is built once for the whole jump).
      const ledgerWorld = state.ledgerWorld || bundle.world;
      // The native world director reads the world as the segments in hand left
      // it (ledgers and storylines) plus the events generated so far, and
      // returns the attention/exploration analysis this segment is validated
      // against and the live context the model is shown. CPU only, in a worker.
      const segmentBundle = {
        actions: bundle.actions,
        chats: bundle.chats,
        events: normalizeEvents([...normalizeArray(bundle.events), ...state.generatedSoFar]),
        game: { ...bundle.game, gameDate: state.segmentOrigin },
        world: ledgerWorld,
      };
      const worldInitiative = await buildWorldInitiativeContextBackground(
        segmentBundle,
        { targetDate: segmentTarget },
        signal,
      );
      console.info(
        `[OH world director] segment ${segmentIndex + 1}/${segmentCount} ${state.segmentOrigin} → ${segmentTarget}; ` +
        `storylines ${normalizeArray(ledgerWorld?.storylines).length}; attention ${worldInitiative.analysis?.attentionCount || 0}; ` +
        `exploration slots ${worldInitiative.analysis?.explorationSlotCount || 0}.`,
      );
      const segmentVariables = {
        ...variables,
        worldInitiativeContext: worldInitiative.text,
        ...(segmentCount > 1 ? { targetDate: segmentTarget, targetDateReadable: formatDateReadable(segmentTarget) } : {}),
        ...(segmentIndex > 0 ? {
          canonicalWarContext: buildCanonicalWarContext(ledgerWorld),
          canonicalDiplomaticContext: buildBoundedDiplomaticContext(ledgerWorld, {
            playerPolity: normalizeString(bundle.game.country),
            maxActors: 8,
          }).text,
        } : {}),
      };
      reportProgress(segmentIndex);

      const { generation: segmentGeneration, payload } = await runJsonTask(mode === "auto" ? "autoJumpForward" : "jumpForward", {
        // Only a single-call jump falls back on its own. A failing SEGMENT throws
        // instead, so the catch below can hold the turn and hand the player the
        // choice rather than quietly deciding for them.
        ...(segmentCount > 1
          ? {}
          : { fallback: () => fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }) }),
        signal,
        // The jump IS the game, and its deadline is runJsonTask's for every task:
        // silence, not elapsed time, so a long segment is never mistaken for a
        // stalled one (and a segmented jump gets that window per segment, since it
        // is per request). Cancel works either way.
        userMessage: buildSegmentInstruction({
          mode,
          segmentIndex,
          segmentCount,
          minEvents,
          maxEvents,
          durationLabel: formatDurationLabel(safeDays),
          segmentDurationLabel: formatDurationLabel(spanDays),
          originDate,
          targetDate,
          segmentTargetDate: segmentTarget,
          priorEvents: state.generatedSoFar,
        }),
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          // Shape-of-story problems (event count, stray dates) are STRICT while a
          // retry remains — the model gets the exact error and usually fixes its
          // own answer — and SALVAGED on the final attempt: a finished generation
          // must never lose to the canned fallback over its date stamps, an extra
          // event, or an invented region name. finalAttempt comes from runJsonTask
          // itself (never from counting our own invocations — a schema failure on
          // attempt 1 skips this validator entirely, which used to make attempt 2
          // look "first" and leak strict feedback out as the fallback reason).
          const strict = !finalAttempt;
          // Mechanical: a batch whose dates are all real is put in date order
          // before anything counts positions (a malformed date is left for the
          // date validator below to report).
          sortTimelineEventsChronologically(candidate);
          const eventCount = normalizeArray(candidate?.events).length;
          if (strict && mode !== "auto" && (eventCount < minEvents || eventCount > maxEvents)) {
            return `$.events must contain between ${minEvents} and ${maxEvents} events; received ${eventCount}.`;
          }
          // Each segment is checked against ITS OWN span, so an event dated outside
          // the segment is caught while the model can still fix it rather than at the
          // end of the whole round.
          const dateError = validateTimelineDates({
            candidate,
            mode,
            originDate: state.segmentOrigin,
            targetDate: segmentTarget,
            requireAdvance: dateStep >= 1,
          });
          if (dateError) {
            if (strict) return dateError;
            clampTimelineDates(candidate, { mode, originDate: state.segmentOrigin, targetDate: segmentTarget });
          }
          // The war ledger must see the sanitized impacts, so world changes go first.
          const worldChangeError = await validateGeneratedWorldChanges(candidate, bundle.world, { strictTransfers: strict });
          if (worldChangeError) return worldChangeError;
          const ledgerError = validateSegmentLedgers(candidate, { world: ledgerWorld, strict, segmentIndex });
          if (ledgerError) return ledgerError;
          return validateSegmentStorylines(candidate, {
            world: ledgerWorld,
            analysis: worldInitiative.analysis,
            strict,
            finalAttempt,
            originDate: state.segmentOrigin,
            targetDate: segmentTarget,
            gameCountry: bundle.game.country,
          });
        },
        variables: segmentVariables,
      });

      // The accepted segment keeps its events. A selected storyline that is
      // objectively stale, or was omitted from storylineUpdates, gets one small
      // targeted repair call; a failed repair leaves the process overdue.
      await repairAntiStasisStorylines({
        payload,
        bundle: segmentBundle,
        analysis: worldInitiative.analysis,
        originDate: state.segmentOrigin,
        targetDate: segmentTarget,
        signal,
      });
      screenSegmentPayload(payload, {
        analysis: worldInitiative.analysis,
        priorEvents: segmentBundle.events,
        world: ledgerWorld,
        game: bundle.game,
        state,
        originDate: state.segmentOrigin,
        targetDate: segmentTarget,
        horizonDays: spanDays,
        eventCeiling: maxEvents,
        generationSource: segmentGeneration?.source || "ai",
      });

      state.segmentPayloads.push(payload);
      state.ledgerWorld = advanceLedgerWorld(ledgerWorld, payload, {
        stopDate: normalizeString(payload?.stopDate) || segmentTarget,
        round: (bundle.game.round || 1) + 1,
      });
      state.generatedSoFar.push(...normalizeArray(payload?.events));
      state.generation = segmentGeneration;
      // Where the next segment picks up. An auto jump can stop short of its span on
      // purpose, so follow the payload rather than the calendar.
      state.segmentOrigin = normalizeString(payload?.stopDate) || segmentTarget;
      // Committed only once the segment is safely in hand, so a retry re-runs the
      // segment that failed and never the one before it.
      state.nextSegment = segmentIndex + 1;
    }
  } catch (error) {
    // A deliberate cancel must still cancel.
    if (signal?.aborted || error?.name === "AbortError") throw error;
    const reason = normalizeString(error?.message) || `AI task "jumpForward" failed.`;

    // A single call reaching here has already exhausted its own fallback, so there
    // is no other segment to keep and nothing to retry piecemeal: it falls back
    // for the whole period exactly as it always did.
    if (segmentCount <= 1) {
      console.warn(`[ai] the jump failed (${reason}) — falling back for the whole period.`);
      logDebugEvent("warn", "[turn] The jump failed; it falls back.", { reason });
      state.segmentPayloads.length = 0;
      state.segmentPayloads.push(await fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }));
      state.nextSegment = segmentCount;
      state.generation = {
        source: "fallback",
        fallbackReason: reason,
        taskKey: mode === "auto" ? "autoJumpForward" : "jumpForward",
      };
      return;
    }

    // Held, not lost. state.nextSegment still points at the segment that failed,
    // so a retry resumes with exactly that one.
    pendingJumpSegment = { context, state };
    console.warn(`[ai] jump segment ${segmentIndex + 1}/${segmentCount} failed (${reason}) — the turn is held.`);
    logDebugEvent("warn", "[turn] A jump segment failed; the turn is HELD and nothing was written.", {
      completedSegments: state.segmentPayloads.length,
      segmentCount,
      segmentIndex,
      reason,
    });
    throw segmentHeldError({
      cause: error,
      completedSegments: state.segmentPayloads.length,
      segmentCount,
      segmentIndex,
    });
  }
};

// Merge the segments into the one round the player asked for and write it.
// Shared by the first attempt and by a retry that finished the held segments, so
// there is only ever one way a jump lands.
const finishTimelineJump = async ({ context, signal, state }) => {
  const { baseColors, bundle, mode, targetDate } = context;
  // Every segment is in hand, so there is no longer a jump to resume.
  pendingJumpSegment = null;

  // One round out of every segment. applySimulationResult advances the round
  // exactly once, and the dedupeGeneratedEvents pass inside it already collapses
  // repeats WITHIN the batch as well as against the existing log, so a later
  // segment restating an earlier one cannot reach the timeline.
  const merged = mergeSegmentPayloads(state.segmentPayloads, { targetDate });

  // The surviving military events then make the persistent order of battle
  // move: the unit director proposes ops for existing units, native rules keep
  // only the plausible ones, and they ride the same application path as the
  // simulator's own unitOps (a long move becomes a standing order). A failed or
  // unavailable director never costs the turn — the events pass through as written.
  let directedEvents = merged.events;
  try {
    directedEvents = await directGeneratedUnitOps({
      events: merged.events,
      game: bundle.game,
      world: bundle.world,
      analyzeBatch: ({ candidates, units }) =>
        runJsonTask("unitDirector", {
          fallback: () => ({ eventOrders: [], summary: "Unit director unavailable; existing simulator unitOps preserved." }),
          signal,
          userMessage:
            "Advance the supplied military events through the existing persistent units. Return one eventOrders entry only where a real unit operation is warranted; leaving an event untouched is a valid answer. Return JSON only.",
          variables: {
            unitDirectorCandidates: JSON.stringify(candidates, null, 2),
            unitDirectorUnits: JSON.stringify(units, null, 2),
            unitDirectorGameDate: normalizeString(bundle.game.gameDate),
            unitDirectorRound: String(bundle.game.round || 1),
          },
        }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[OH unit director] pass failed; the simulator's unit operations stand.", error);
    directedEvents = merged.events;
  }


  // Second narrow pass: the surviving prose and front state become the native
  // disputed-region machinery (regionControlOps) without pretending every
  // occupation is international law. Its additions go through the same
  // geography resolver as the simulator's own ops, bounded by current control;
  // an unresolved place fails safe by disappearing rather than minting a
  // phantom region key. A failed pass never costs the turn.
  let territoryEvents = directedEvents;
  try {
    territoryEvents = await directGeneratedTerritoryOps({
      events: directedEvents,
      world: bundle.world,
      analyzeBatch: async ({ candidates, territorialState }) =>
        runJsonTask("territoryDirector", {
          fallback: () => ({
            eventOrders: [],
            summary: "Territory director unavailable; existing legal/control impacts preserved.",
          }),
          signal,
          userMessage:
            "Reconcile the supplied events with de-facto territorial control. Add only control/contest/clear operations that the event itself supports; never invent a legal sovereignty transfer. Return JSON only.",
          variables: {
            territoryDirectorCandidates: JSON.stringify(candidates, null, 2),
            territoryDirectorState: JSON.stringify(territorialState, null, 2),
            territorialControlContext: await buildTerritorialControlContext(bundle.world),
          },
        }),
    });
    const containers = territoryEvents.map((event, index) => ({
      event,
      impacts: event?.impacts,
      path: `$.events[${index}].impacts`,
    }));
    await resolveRegionControlOps(containers, bundle.world);
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[OH territory director] pass failed; the simulator's territorial operations stand.", error);
    territoryEvents = directedEvents;
  }

  const result = {
    catalyst: merged.catalyst,
    clearActions: merged.clearActions,
    events: territoryEvents,
    mode,
    outreach: merged.diplomaticOutreach,
    stopDate: merged.stopDate,
    summary: merged.summary,
    warUpdates: merged.warUpdates,
    relationUpdates: merged.relationUpdates,
    agreementUpdates: merged.agreementUpdates,
    storylineUpdates: merged.storylineUpdates,
    breadthRepairContext: selectBreadthRepairContext(state, context),
    generation: state.generation,
  };
  const applyArgs = {
    baseActions: bundle.actions,
    baseChats: bundle.chats,
    baseColors,
    baseEvents: bundle.events,
    baseGame: bundle.game,
    baseWorld: bundle.world,
    campaignId: context.campaignId,
    result,
  };

  // The board runs inside applySimulationResult so that it sees the espionage
  // events too. All this side does is hold the turn when it fails, because this
  // is where the arguments a retry needs are held.
  applyArgs.projects = { bundle, signal };
  try {
    return await applySimulationResult(applyArgs);
  } catch (error) {
    if (error?.projectsHeld) pendingProjectsJump = { applyArgs };
    throw error;
  }
};

export const simulateTimelineJump = async ({ days, mode = "jump", onProgress, signal } = {}) => {
  // Starting a fresh turn abandons any jump still held on a failed segment. Its
  // state was captured against a world snapshot this one is about to re-read, so
  // applying it later would write a turn built on stale ground.
  discardPendingProjectsJump();
  discardPendingJumpSegment();
  beginSimulation();
  try {
  const bundle = withDiplomaticLedgerMigration(await readGameStateBundle({ force: true }));
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  // Fractional days are allowed so sub-day skips (e.g. 6h = 0.25) work; the game
  // date only advances in whole days, so a sub-day skip keeps the same date.
  const safeDays = Math.max(0, Number(days) || 0);
  if (safeDays <= 0) {
    throw new Error("Choose a time-skip amount greater than zero.");
  }
  const dateStep = Math.max(0, Math.round(safeDays));
  const originDate = normalizeString(bundle.game.gameDate);
  const targetDate = dateStep >= 1 ? (addIsoDays(originDate, dateStep) || originDate) : originDate;
  if (dateStep >= 1 && parseIsoDate(originDate) && targetDate === originDate) {
    throw new Error("The requested jump exceeds the supported date range.");
  }
  const variables = await buildTemplateVariables(bundle, {
    taskKey: mode === "auto" ? "autoJumpForward" : "jumpForward",
    consolidatedHistoryMaxChars: WORLD_SIMULATION_CONSOLIDATED_HISTORY_MAX_CHARS,
    consolidatedHistorySelection: "coverage",
    historicalAnchorActivationChars: WORLD_SIMULATION_HISTORICAL_ANCHOR_ACTIVATION_CHARS,
    historicalAnchorMaxChars: WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_CHARS,
    historicalAnchorMaxItems: WORLD_SIMULATION_HISTORICAL_ANCHOR_MAX_ITEMS,
    targetDate,
  });
  // Guarantee at least one event per queued action, so each planned action has a
  // slot to resolve into (bounded so a huge queue can't demand absurd counts).
  const plannedActionCount = normalizeActions(bundle.actions).filter((action) => action.status === "planned").length;

  // Long skips are generated in SEGMENTS and merged into the one round the player
  // asked for — see jumpSegments.js for why, and for the merge rules. Auto jumps
  // never split: they stop at the next notable moment, so there is no span to
  // divide up front. Short enough, or the setting off, is a single call worded and
  // validated exactly as it always was.
  const segmentDays = (getMapSettingDefaultOn(MAP_SETTING_KEYS.chunkLongJumps)
    && mode !== "auto"
    && dateStep >= SEGMENTED_JUMP_MIN_DAYS)
    ? planJumpSegments(dateStep)
    : [dateStep];
  const segmentCount = segmentDays.length;
  const plannedActionShare = Math.ceil(plannedActionCount / segmentCount);
  if (segmentCount > 1) {
    logDebugEvent("turn", `Timeline jump split into ${segmentCount} segments.`, {
      dateStep,
      segmentDays,
      round: bundle.game.round,
    });
  }

  // Everything constant across the jump, and everything a retry needs to pick the
  // loop back up where it stopped: see runJumpSegments for why a failed segment
  // is HELD rather than swapped for a canned round.
  const jumpContext = {
    baseColors,
    bundle,
    // Stamped here, at the read, not at the write minutes later.
    campaignId: activeCampaignId(),
    dateStep,
    mode,
    originDate,
    plannedActionCount,
    plannedActionShare,
    safeDays,
    segmentDays,
    targetDate,
    variables,
  };
  const jumpState = {
    generatedSoFar: [],
    generation: { source: "ai", fallbackReason: "" },
    nextSegment: 0,
    segmentOrigin: originDate,
    segmentPayloads: [],
    // The base world plus the ledger and storyline records of the segments in hand.
    ledgerWorld: bundle.world,
    // One exploration audit per segment; the quietest is re-searched after curation.
    breadthRepairContexts: [],
  };

  await runJumpSegments({ context: jumpContext, onProgress, signal, state: jumpState });
  return await finishTimelineJump({ context: jumpContext, signal, state: jumpState });
  } finally {
    endSimulation();
  }
};

// Finish a held jump by running ONLY the segments that have not been generated
// yet. The finished ones are not regenerated — they are already valid, and on a
// slow model each one may have cost minutes. Nothing was written when the
// segment failed, so this is the same code path as the first attempt rather than
// a second one to keep in step.
export const retryPendingJumpSegment = async ({ onProgress, signal } = {}) => {
  if (!pendingJumpSegment) throw new Error("There is no jump waiting on a failed segment.");
  const { context, state } = pendingJumpSegment;
  beginSimulation();
  try {
    // Re-holds itself on another failure, so the player can retry again or
    // discard — exactly as they could the first time.
    await runJumpSegments({ context, onProgress, signal, state });
    return await finishTimelineJump({ context, signal, state });
  } finally {
    endSimulation();
  }
};

export const simulateAutoJump = async ({ days = 365, signal } = {}) =>
  simulateTimelineJump({ days, mode: "auto", signal });

// ---- GM Console: previewable, revalidated, audited transactions ------------
// The AI plans a structured transaction; native code validates it against the
// live world, shows every operation to the administrator, and only Apply
// persists exactly that preview. Direct prose execution no longer exists.
const GAME_MASTER_MODE_SET = new Set(["direct", "exact-event", "world-intervention"]);

const relationPairKeyForHistory = (a, b) => [normalizeString(a), normalizeString(b)]
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right))
  .join("|");

const gmPatchHasContent = (patch) => {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  return Object.entries(patch).some(([, value]) => {
    if (value == null) return false;
    if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;
    return true;
  });
};

const gameMasterPolityKey = (value) => normalizeString(value).toLowerCase();

const gameMasterCanonicalPolityKey = (token, world) => {
  const raw = normalizeString(token);
  if (!raw) return "";
  const resolution = resolvePolityIdentity(raw, normalizeWorldState(world), {
    allowUnknown: false,
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return gameMasterPolityKey(normalizeString(resolution?.resolved) || toCountryName(raw) || raw);
};

const validateGameMasterStatPatches = (patches, world, events) => {
  const normalizedWorld = normalizeWorldState(world);
  const eventCount = normalizeArray(events).length;

  for (let index = 0; index < normalizeArray(patches).length; index += 1) {
    const entry = patches[index];
    const requested = normalizeString(entry?.country);
    const resolution = resolvePolityIdentity(requested, normalizedWorld, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    const canonical = normalizeString(resolution?.resolved);
    if (!canonical) {
      return `$.countryStatPatches[${index}].country could not resolve existing polity "${requested}".`;
    }
    if (!gmPatchHasContent(entry?.patch)) {
      return `$.countryStatPatches[${index}].patch must contain at least one requested Stats field.`;
    }

    for (const eventIndex of normalizeArray(entry?.eventIndexes)) {
      if (!Number.isInteger(Number(eventIndex)) || Number(eventIndex) < 0 || Number(eventIndex) >= eventCount) {
        return `$.countryStatPatches[${index}].eventIndexes contains an index outside this transaction's events array.`;
      }
    }

    const breakdown = entry?.patch?.gdpBreakdown;
    if (breakdown && typeof breakdown === "object") {
      const total = Number(breakdown.agriculture) + Number(breakdown.industry) + Number(breakdown.services);
      if (!Number.isFinite(total) || Math.abs(total - 100) > 0.001) {
        return `$.countryStatPatches[${index}].patch.gdpBreakdown must total exactly 100.`;
      }
    }

    const aggregateRebaseRequested =
      Number.isFinite(Number(entry?.patch?.population?.total)) ||
      Number.isFinite(Number(entry?.patch?.economy?.gdp));
    const sheet = normalizedWorld?.countryStats?.[canonical];
    const hasComponentBaseline = Array.isArray(sheet?.territorialComponents) && sheet.territorialComponents.length > 0;
    if (aggregateRebaseRequested && !hasComponentBaseline) {
      return `$.countryStatPatches[${index}] requests a population/GDP re-baseline for ${canonical}, but that polity has no component-backed canonical Stats baseline yet. Open its Stats sheet first, or patch only descriptive fields, indices, stability or macro rates.`;
    }
  }

  return "";
};

const normalizeGameMasterStatPatches = (patches, world) => {
  const normalizedWorld = normalizeWorldState(world);
  return normalizeArray(patches).map((entry) => {
    const resolution = resolvePolityIdentity(entry?.country, normalizedWorld, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    return {
      ...entry,
      country: normalizeString(resolution?.resolved) || normalizeString(entry?.country),
      eventIndexes: normalizeArray(entry?.eventIndexes)
        .map(Number)
        .filter((value) => Number.isInteger(value) && value >= 0),
    };
  });
};

// Bind obvious war metadata from the transaction's own linked warUpdates before
// canonical validation. The AI occasionally emits a correct START/JOIN record
// linked to event 0 but forgets to repeat that war id on the event. That
// relationship is deterministic, so preview normalization may repair it without
// another AI call or any world mutation. For a START event the opposing sides
// also provide an unambiguous combatants fallback. Ambiguous multi-war links are
// left untouched so the canonical validator still fails closed.
const normalizeGameMasterWarEventBindings = (candidate) => {
  const events = normalizeArray(candidate?.events);
  const updates = decodeWarUpdates(candidate?.warUpdates);
  if (!events.length || !updates.length) return candidate;

  const eventIndexById = new Map(
    events
      .map((event, index) => [normalizeString(event?.id), index])
      .filter(([id]) => Boolean(id)),
  );
  const updatesByEventIndex = new Map();

  const link = (index, update) => {
    if (!Number.isInteger(index) || index < 0 || index >= events.length) return;
    if (!updatesByEventIndex.has(index)) updatesByEventIndex.set(index, []);
    updatesByEventIndex.get(index).push(update);
  };

  for (const update of updates) {
    for (const index of normalizeArray(update?.eventIndexes)) {
      link(Number(index), update);
    }
    for (const eventId of normalizeArray(update?.eventIds)) {
      const index = eventIndexById.get(normalizeString(eventId));
      if (Number.isInteger(index)) link(index, update);
    }
  }

  for (const [eventIndex, linkedUpdates] of updatesByEventIndex.entries()) {
    const event = events[eventIndex];
    if (!event || typeof event !== "object") continue;

    const warIds = [...new Set(
      linkedUpdates
        .map((update) => normalizeString(update?.id))
        .filter(Boolean),
    )];

    if (!normalizeString(event.warId) && warIds.length === 1) {
      event.warId = warIds[0];
    }

    const eventWarId = normalizeString(event.warId);
    if (!eventWarId || normalizeArray(event.combatants).length >= 2) continue;

    const startUpdate = linkedUpdates.find((update) =>
      normalizeString(update?.id) === eventWarId &&
      normalizeString(update?.op).toLowerCase() === "start"
    );
    if (!startUpdate) continue;

    const combatants = [...new Set([
      ...normalizeArray(startUpdate.actors),
      ...normalizeArray(startUpdate.opponents),
    ]
      .map((value) => normalizeString(value))
      .filter(Boolean))]
      .slice(0, 8);

    if (combatants.length >= 2) event.combatants = combatants;
  }

  return candidate;
};

const normalizeGameMasterIsoDate = (value) => {
  const raw = normalizeString(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10) === raw ? raw : "";
};

const GAME_MASTER_REQUEST_MONTHS = Object.freeze({
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
});

const gameMasterRequestDateFromParts = (yearValue, monthValue, dayValue) => {
  const year = Number(yearValue);
  const day = Number(dayValue);
  const monthToken = normalizeString(monthValue).toLowerCase();
  const month = Number.isFinite(Number(monthValue))
    ? Number(monthValue)
    : GAME_MASTER_REQUEST_MONTHS[monthToken];
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  return normalizeGameMasterIsoDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
};

export const extractExplicitGameMasterRequestDates = (requestText) => {
  const request = normalizeString(requestText);
  if (!request) return [];
  const dates = new Set();
  const add = (value) => {
    const normalized = normalizeGameMasterIsoDate(value);
    if (normalized) dates.add(normalized);
  };

  for (const match of request.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    add(`${match[1]}-${match[2]}-${match[3]}`);
  }

  const monthPattern = "January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
  const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\s*,?\\s+(\\d{4})\\b`, "gi");
  for (const match of request.matchAll(dayFirst)) {
    add(gameMasterRequestDateFromParts(match[3], match[2], match[1]));
  }

  const monthFirst = new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})\\b`, "gi");
  for (const match of request.matchAll(monthFirst)) {
    add(gameMasterRequestDateFromParts(match[3], match[1], match[2]));
  }

  return [...dates].sort();
};

const validateGameMasterRequestedExactDate = (candidate, { mode, request }) => {
  if (mode !== "exact-event") return "";
  const requestedDates = extractExplicitGameMasterRequestDates(request);
  // Only enforce when the administrator supplied one unambiguous explicit date.
  // Requests that mention several historical dates need semantic interpretation.
  if (requestedDates.length !== 1) return "";

  const expectedDate = requestedDates[0];
  const eventDate = normalizeGameMasterIsoDate(normalizeArray(candidate?.events)[0]?.date);
  if (eventDate === expectedDate) return "";

  return `The administrator explicitly requested the Exact Event date ${expectedDate}, but $.events[0].date is ${eventDate || "blank/invalid"}. Exact Event preview must preserve the requested date.`;
};

const gameMasterEventHasCanonicalEffects = (candidate, eventIndex) => {
  const event = normalizeArray(candidate?.events)[eventIndex];
  const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
  for (const field of [
    "regionTransfers",
    "regionClaims",
    "polityChanges",
    "createdChats",
    "unitOps",
    "markerOps",
    "projectOps",
  ]) {
    if (normalizeArray(impacts[field]).length > 0) return true;
  }

  const linked = (entries) => normalizeArray(entries).some((entry) =>
    normalizeArray(entry?.eventIndexes).some((value) => Number(value) === eventIndex));

  return linked(candidate?.countryStatPatches)
    || linked(candidate?.warUpdates)
    || linked(candidate?.relationUpdates)
    || linked(candidate?.agreementUpdates);
};

const validateGameMasterChronology = (candidate, game) => {
  const currentDate = normalizeGameMasterIsoDate(game?.gameDate || game?.startDate);
  if (!currentDate) return "";

  const events = normalizeArray(candidate?.events);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const eventDate = normalizeGameMasterIsoDate(events[eventIndex]?.date);
    if (!eventDate || eventDate <= currentDate) continue;
    if (!gameMasterEventHasCanonicalEffects(candidate, eventIndex)) continue;

    return `$.events[${eventIndex}] is dated ${eventDate}, after the current game date ${currentDate}, but it establishes canonical state changes. GM Apply never advances time, so date it on or before ${currentDate} or drop its structured effects.`;
  }

  return "";
};

const GAME_MASTER_PERSISTENT_PROCESS_HINT = /\b(?:crisis|collapse|revolution|uprising|insurgency|civil\s+war|succession|regime\s+rupture|banking\s+emergency|sovereign\s+debt|mass\s+unrest|nationwide\s+strike|general\s+strike|standoff|confrontation|instability|tension|escalat(?:e|es|ed|ing|ion)|de-escalat(?:e|es|ed|ing|ion)|prolonged|ongoing)\b/i;

const validateGameMasterStorylineUpdates = async (candidate, { mode, world, game, request = "" } = {}) => {
  // Native semantic binding owns the causal event links; model-supplied indexes are
  // hints. This mutates only the preview candidate and therefore remains visible
  // before Apply can ever persist it.
  normalizeWorldStorylineEventLinks(candidate, { world });

  const normalizedWorld = normalizeWorldState(world);
  const currentDate = normalizeString(game?.gameDate || game?.startDate);
  const validationError = validateWorldStorylinePayload(candidate, {
    existingStorylines: normalizedWorld.storylines,
    selectedStorylines: [],
    deferredStorylines: [],
    originDate: currentDate,
    stopDate: currentDate,
    enforceAntiStasis: false,
    enforceSelectedCoverage: false,
    world: normalizedWorld,
  });
  if (validationError) return validationError;

  const updates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  if (mode === "world-intervention" && GAME_MASTER_PERSISTENT_PROCESS_HINT.test(normalizeString(request)) && !updates.length) {
    return "World Intervention describes an unresolved or changing multi-turn process, but $.storylineUpdates is empty. Persist that crisis/process in canonical world.storylines (or update/resolve the existing storyline) so the normal World Director inherits it on later turns.";
  }

  const currentPolities = new Map(
    (await buildCurrentCanonicalPolityVocabulary(normalizedWorld))
      .map((name) => normalizeString(name))
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]),
  );
  // A world intervention may establish a new/restored polity and a persistent
  // crisis involving it in the SAME preview. Lifecycle validation runs first, so
  // those event-driven identities are safe to admit here even though they do not
  // exist in the pre-transaction world yet.
  for (const event of normalizeArray(candidate?.events)) {
    for (const change of normalizeArray(event?.impacts?.polityChanges)) {
      const operation = normalizeString(change?.operation).toLowerCase();
      if (!["create", "restore", "rename", "update"].includes(operation)) continue;
      for (const token of [change?.name, change?.code]) {
        const name = normalizeString(token);
        if (name) currentPolities.set(name.toLowerCase(), name);
      }
    }
  }

  for (let index = 0; index < updates.length; index += 1) {
    const update = updates[index];
    if (mode !== "direct" && normalizeArray(update?.eventIndexes).length === 0) {
      return `$.storylineUpdates record ${index + 1} must link to at least one authored GM event in ${mode} mode.`;
    }
    for (let participantIndex = 0; participantIndex < normalizeArray(update?.participants).length; participantIndex += 1) {
      const raw = normalizeString(normalizeArray(update.participants)[participantIndex]);
      const resolution = resolvePolityIdentity(raw, normalizedWorld, {
        allowUnknown: false,
        requireActive: false,
        allowCoreMatch: true,
        allowStockBase: true,
      });
      const resolved = normalizeString(resolution?.resolved || raw);
      const canonical = currentPolities.get(resolved.toLowerCase()) || currentPolities.get(raw.toLowerCase()) || "";
      if (!canonical) {
        return `$.storylineUpdates record ${index + 1} participant ${participantIndex + 1} could not resolve to a current or same-transaction canonical polity: "${raw}".`;
      }
      update.participants[participantIndex] = canonical;
    }
  }

  candidate.storylineUpdates = updates;
  return "";
};

const resolveGameMasterLifecycleIdentity = (token, world) => {
  const requested = normalizeString(token);
  if (!requested) return "";
  // Callers already hand us the live/normalized world. Re-normalizing it here is
  // surprisingly expensive when this helper is used while scanning map ownership.
  const resolution = resolvePolityIdentity(requested, world, {
    allowUnknown: false,
    // Do NOT ask the generic identity resolver whether a stock/base name is
    // "active". Its stock-base compatibility path intentionally permits ordinary
    // modern maps with no polity registry, but that is not enough evidence for GM
    // lifecycle semantics in a historical save (1915 Poland was the bug here).
    requireActive: false,
    allowCoreMatch: true,
    allowStockBase: true,
  });
  return normalizeString(resolution?.resolved);
};

const buildGameMasterActivePolitySet = async (world) =>
  new Set((await buildCurrentCanonicalPolityVocabulary(world)).map(gameMasterPolityKey));

// The AI authors the CURRENT regime/display name, but native code owns stable
// polity identity and existence: a stock map name is not proof that the polity
// currently exists (1915 Poland). A create/update aimed at a known dormant
// lineage becomes a restore.
const normalizeGameMasterPolityLifecycle = (candidate, world, baseActivePolities = new Set()) => {
  const active = new Set(baseActivePolities);

  for (const event of normalizeArray(candidate?.events)) {
    const changes = event?.impacts?.polityChanges;
    if (!Array.isArray(changes)) continue;

    event.impacts.polityChanges = changes.map((change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) return change;
      const operation = normalizeString(change.operation).toLowerCase();
      const code = normalizeString(change.code);
      if (!code) return change;

      const knownIdentity = resolveGameMasterLifecycleIdentity(code, world);
      const knownKey = gameMasterPolityKey(knownIdentity || code);
      const activeIdentity = knownKey && active.has(knownKey) ? (knownIdentity || code) : "";

      let normalizedChange = change;

      if (["create", "update"].includes(operation) && knownIdentity && !activeIdentity) {
        normalizedChange = {
          ...change,
          operation: "restore",
          code: knownIdentity,
        };
      } else if (operation === "restore" && knownIdentity) {
        normalizedChange = {
          ...change,
          code: knownIdentity,
        };
      }

      const finalOperation = normalizeString(normalizedChange?.operation).toLowerCase();
      const finalCode =
        resolveGameMasterLifecycleIdentity(normalizedChange?.code, world) ||
        toCountryName(normalizeString(normalizedChange?.code)) ||
        normalizeString(normalizedChange?.code);
      const finalKey = gameMasterPolityKey(finalCode);

      if (["create", "restore"].includes(finalOperation) && finalKey) active.add(finalKey);
      if (finalOperation === "dissolve" && finalKey) active.delete(finalKey);

      return normalizedChange;
    });
  }

  return candidate;
};

const validateGameMasterPolityLifecycle = (candidate, world, baseActivePolities = new Set()) => {
  const active = new Set(baseActivePolities);

  for (let eventIndex = 0; eventIndex < normalizeArray(candidate?.events).length; eventIndex += 1) {
    const event = normalizeArray(candidate?.events)[eventIndex];
    const changes = normalizeArray(event?.impacts?.polityChanges);

    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      const change = changes[changeIndex];
      const operation = normalizeString(change?.operation).toLowerCase();
      const code = normalizeString(change?.code);
      if (!code) continue;

      const knownIdentity = resolveGameMasterLifecycleIdentity(code, world);
      const stableIdentity = knownIdentity || toCountryName(code) || code;
      const stableKey = gameMasterPolityKey(stableIdentity);
      const activeIdentity = stableKey && active.has(stableKey) ? stableIdentity : "";

      if (operation === "create" && activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to CREATE "${code}", but it already resolves to active polity "${activeIdentity}". Use update/rename for the existing polity instead of creating a duplicate identity.`;
      }

      if (operation === "restore" && activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to RESTORE "${code}", but "${activeIdentity}" is already active. Use update/rename if the current regime or display name is changing.`;
      }

      if (operation === "update" && !activeIdentity) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}] tries to UPDATE "${code}", but that polity is not currently active. Use restore for a known historical/dormant identity or create for a genuinely new polity.`;
      }

      if (["create", "restore"].includes(operation) && stableKey) active.add(stableKey);
      if (operation === "dissolve" && stableKey) active.delete(stableKey);
    }
  }

  return "";
};

// A newly created belligerent may not receive LEGAL sovereignty from the very
// power it is fighting for independence in the same transaction: rebel gains
// are control ops until a settlement or recognition.
const validateGameMasterBreakawaySovereignty = (candidate) => {
  const createdPolities = new Set();
  for (const event of normalizeArray(candidate?.events)) {
    for (const change of normalizeArray(event?.impacts?.polityChanges)) {
      const operation = normalizeString(change?.operation).toLowerCase();
      if (!["create", "restore"].includes(operation)) continue;
      const code = normalizeString(change?.code);
      const name = normalizeString(change?.name);
      if (code) createdPolities.add(code.toLowerCase());
      if (name) createdPolities.add(name.toLowerCase());
    }
  }
  if (!createdPolities.size) return "";

  const activeBreakawayPairs = [];
  for (const update of normalizeArray(candidate?.warUpdates)) {
    if (normalizeString(update?.op).toLowerCase() !== "start") continue;
    const sideA = normalizeArray(update?.actors).map((value) => normalizeString(value)).filter(Boolean);
    const sideB = normalizeArray(update?.opponents).map((value) => normalizeString(value)).filter(Boolean);
    for (const a of sideA) {
      for (const b of sideB) {
        if (createdPolities.has(a.toLowerCase()) || createdPolities.has(b.toLowerCase())) {
          activeBreakawayPairs.push([a, b]);
        }
      }
    }
  }
  if (!activeBreakawayPairs.length) return "";

  const opposingPair = (fromCode, toCode) => activeBreakawayPairs.some(([a, b]) => {
    const from = normalizeString(fromCode).toLowerCase();
    const to = normalizeString(toCode).toLowerCase();
    return (a.toLowerCase() === to && b.toLowerCase() === from)
      || (b.toLowerCase() === to && a.toLowerCase() === from);
  });

  for (let eventIndex = 0; eventIndex < normalizeArray(candidate?.events).length; eventIndex += 1) {
    const event = normalizeArray(candidate?.events)[eventIndex];
    const transfers = normalizeArray(event?.impacts?.regionTransfers);
    for (let transferIndex = 0; transferIndex < transfers.length; transferIndex += 1) {
      const transfer = transfers[transferIndex];
      const toCode = normalizeString(transfer?.toCode);
      const fromCode = normalizeString(transfer?.fromCode);
      if (!createdPolities.has(toCode.toLowerCase()) || !opposingPair(fromCode, toCode)) continue;
      return `$.events[${eventIndex}].impacts.regionTransfers[${transferIndex}] attempts to transfer LEGAL sovereignty from "${fromCode}" to newly created belligerent "${toCode}" while their independence war is starting. A unilateral declaration, uprising, revolution or secession does not itself change legal sovereignty. Keep the prior sovereign legally in place and represent the disputed territory with regionControlOps (normally contest; use control only for territory the breakaway has decisively captured/administers). Legal sovereignty can move later through explicit recognition, cession, annexation or settlement.`;
    }
  }

  return "";
};

const validateGameMasterPreviewPayload = async (candidate, { mode, world, game, request = "" }) => {
  if (!candidate || typeof candidate !== "object") return "The GM did not return a transaction object.";
  if (!GAME_MASTER_MODE_SET.has(mode)) return `Unsupported GM mode "${mode}".`;

  // Preview normalization only: this mutates the in-memory candidate the
  // administrator is about to inspect; no save/world writes happen here.
  // Present-state activity comes from the live map, not from stock names.
  const activePolities = await buildGameMasterActivePolitySet(world);
  normalizeGameMasterPolityLifecycle(candidate, world, activePolities);
  normalizeGameMasterWarEventBindings(candidate);

  if (normalizeString(candidate.mode) !== mode) {
    return `$.mode must echo the selected GM mode "${mode}".`;
  }

  const events = normalizeArray(candidate.events);
  if (mode === "exact-event" && events.length !== 1) {
    return `Exact Event mode requires exactly one event; received ${events.length}.`;
  }
  if (mode === "world-intervention" && events.length === 0) {
    return "World Intervention mode requires at least one authored event so the intervention has canonical historical context.";
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!normalizeString(event?.date)) return `$.events[${index}].date must not be blank.`;
    if (!normalizeString(event?.title)) return `$.events[${index}].title must not be blank.`;
    if (!normalizeString(event?.description)) return `$.events[${index}].description must not be blank.`;
  }

  const requestedDateError = validateGameMasterRequestedExactDate(candidate, { mode, request });
  if (requestedDateError) return requestedDateError;

  const chronologyError = validateGameMasterChronology(candidate, game);
  if (chronologyError) return chronologyError;

  const lifecycleError = validateGameMasterPolityLifecycle(candidate, world, activePolities);
  if (lifecycleError) return lifecycleError;

  const breakawaySovereigntyError = validateGameMasterBreakawaySovereignty(candidate);
  if (breakawaySovereigntyError) return breakawaySovereigntyError;

  // Resolve/validate map, unit, marker and chat operations now, while this is
  // still a preview. This may conservatively resolve a grounded place label to
  // an exact map region, but it never writes world state.
  const worldChangeError = await validateGeneratedWorldChanges(candidate, world, { strictTransfers: true, captureGuard: false });
  if (worldChangeError) return worldChangeError;

  const statError = validateGameMasterStatPatches(candidate.countryStatPatches, world, candidate.events);
  if (statError) return statError;

  const normalizedEvents = normalizeArray(candidate.events)
    .map((entry, index) => normalizeGeneratedEvent({
      ...entry,
      source: entry?.source || "game-master-preview",
    }, index))
    .filter(Boolean);

  const warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(candidate.warUpdates), normalizedEvents);
  const warError = validateCanonicalWarEvents({
    events: normalizedEvents,
    updates: warUpdates,
    world,
  });
  if (warError) return `[canonical war-state] ${warError}`;

  const relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(candidate.relationUpdates), normalizedEvents);
  const agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(candidate.agreementUpdates), normalizedEvents);
  const diplomaticError = validateDiplomaticLedgerPayload({
    events: normalizedEvents,
    relationUpdates,
    agreementUpdates,
  }, { world });
  if (diplomaticError) return `[canonical diplomatic-state] ${diplomaticError}`;

  const storylineError = await validateGameMasterStorylineUpdates(candidate, { mode, world, game, request });
  if (storylineError) return `[canonical storyline-state] ${storylineError}`;

  return "";
};

// GM Apply must never report success merely because the common mutation seam
// returned an object. Verify every previewed territorial consequence against the
// in-memory post-apply world before ANY persistence happens.
const verifyGameMasterTerritoryPostconditions = (events, world) => {
  const normalizedWorld = normalizeWorldState(world);

  for (let eventIndex = 0; eventIndex < normalizeArray(events).length; eventIndex += 1) {
    const event = normalizeArray(events)[eventIndex];
    const impacts = event?.impacts || {};

    for (let transferIndex = 0; transferIndex < normalizeArray(impacts.regionTransfers).length; transferIndex += 1) {
      const transfer = normalizeArray(impacts.regionTransfers)[transferIndex];
      // A whole-country transfer names the losing polity, not one region; its
      // regions were rewritten individually by the impact seam.
      if (transfer?.wholeCountry) continue;
      const regionId = normalizeString(transfer?.regionId);
      const expected = gameMasterCanonicalPolityKey(transfer?.toCode, normalizedWorld);
      // The sovereignty map is sparse: no row means the controller is the sovereign.
      const actual = gameMasterCanonicalPolityKey(
        normalizedWorld.regionSovereigntyOverrides?.[regionId] || normalizedWorld.regionOwnershipOverrides?.[regionId],
        normalizedWorld,
      );
      if (!regionId || !expected || actual !== expected) {
        return `territorial operation ${eventIndex}:${transferIndex} did not take effect for ${regionId || "unknown region"} (expected ${normalizeString(transfer?.toCode) || "target"}, found ${normalizeString(normalizedWorld.regionOwnershipOverrides?.[regionId]) || "no override"}).`;
      }
    }

    for (let controlIndex = 0; controlIndex < normalizeArray(impacts.regionControlOps).length; controlIndex += 1) {
      const control = normalizeArray(impacts.regionControlOps)[controlIndex];
      const op = normalizeString(control?.op).toLowerCase();
      const regionId = normalizeString(control?.regionId);
      if (!regionId) {
        return `de-facto control operation ${eventIndex}:${controlIndex} has no canonical region id after preview validation.`;
      }
      if (op === "control") {
        const expected = gameMasterCanonicalPolityKey(control?.toCode, normalizedWorld);
        const actual = gameMasterCanonicalPolityKey(normalizedWorld.regionOwnershipOverrides?.[regionId], normalizedWorld);
        if (!expected || actual !== expected) {
          return `de-facto control operation ${eventIndex}:${controlIndex} did not take effect for ${regionId} (expected ${normalizeString(control?.toCode) || "target"}).`;
        }
      }
      if (op === "contest") {
        const expected = gameMasterCanonicalPolityKey(control?.actorCode || control?.claimantCode, normalizedWorld);
        const claimants = normalizeArray(normalizedWorld.regionClaimants?.[regionId])
          .map((value) => gameMasterCanonicalPolityKey(value, normalizedWorld))
          .filter(Boolean);
        if (!expected || !claimants.includes(expected)) {
          return `contest operation ${eventIndex}:${controlIndex} did not take effect for ${regionId} (expected claimant ${normalizeString(control?.actorCode || control?.claimantCode) || "unknown"}).`;
        }
      }
    }

    for (let claimIndex = 0; claimIndex < normalizeArray(impacts.regionClaims).length; claimIndex += 1) {
      const claim = normalizeArray(impacts.regionClaims)[claimIndex];
      const regionId = normalizeString(claim?.regionId);
      const expected = gameMasterCanonicalPolityKey(claim?.claimantCode || claim?.claimant, normalizedWorld);
      if (!regionId || !expected) {
        return `claim operation ${eventIndex}:${claimIndex} has no canonical region id or claimant after preview validation.`;
      }
      const claimants = normalizeArray(normalizedWorld.regionClaimants?.[regionId])
        .map((value) => gameMasterCanonicalPolityKey(value, normalizedWorld))
        .filter(Boolean);
      const present = claimants.includes(expected);
      if (claim?.drop ? present : !present) {
        return `claim operation ${eventIndex}:${claimIndex} did not take effect for ${regionId} (${claim?.drop ? "claim still present" : "claim missing"} for ${normalizeString(claim?.claimantCode || claim?.claimant)}).`;
      }
    }
  }

  return "";
};

const hashGameMasterText = (value) => {
  let hash = 2166136261;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const createGameMasterTransactionId = () => {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `gm-${Date.now().toString(36)}-${random || "transaction"}`;
};

// Fingerprint only canonical state the GM planner is allowed to mutate/read while
// authoring a transaction. If any of it changes between Preview and Apply, the
// transaction fails closed and the administrator must regenerate instead of having
// native code silently reinterpret an old preview against a new world.
const gameMasterStateFingerprint = ({ game = {}, world = {}, events = [], colors = {} } = {}) => {
  const normalizedWorld = normalizeWorldState(world);
  const relevant = {
    game: {
      country: normalizeString(game?.country),
      gameDate: normalizeString(game?.gameDate),
      round: Number(game?.round) || 0,
      startDate: normalizeString(game?.startDate),
    },
    colors,
    events: normalizeEvents(events).map((event) => ({
      id: event.id,
      date: event.date,
      title: event.title,
      description: event.description,
      impacts: event.impacts,
      warId: event.warId,
      combatants: event.combatants,
    })),
    world: {
      polityOverrides: normalizedWorld.polityOverrides,
      regionOwnershipOverrides: normalizedWorld.regionOwnershipOverrides,
      regionSovereigntyOverrides: normalizedWorld.regionSovereigntyOverrides,
      regionClaimants: normalizedWorld.regionClaimants,
      countryStats: normalizedWorld.countryStats,
      countryTags: normalizedWorld.countryTags,
      internationalReputation: normalizedWorld.internationalReputation,
      units: normalizedWorld.units,
      markers: normalizedWorld.markers,
      cityRenames: normalizedWorld.cityRenames,
      storylines: normalizedWorld.storylines,
      wars: normalizedWorld.wars,
      relations: normalizedWorld.relations,
      agreements: normalizedWorld.agreements,
    },
  };
  return hashGameMasterText(JSON.stringify(relevant));
};

const gameMasterTransactionCandidate = (transaction) => ({
  mode: normalizeString(transaction?.mode),
  summary: normalizeString(transaction?.summary),
  events: cloneValue(normalizeArray(transaction?.events)),
  countryStatPatches: cloneValue(normalizeArray(transaction?.countryStatPatches)),
  storylineUpdates: cloneValue(normalizeArray(transaction?.storylineUpdates)),
  warUpdates: cloneValue(normalizeArray(transaction?.warUpdates)),
  relationUpdates: cloneValue(normalizeArray(transaction?.relationUpdates)),
  agreementUpdates: cloneValue(normalizeArray(transaction?.agreementUpdates)),
  diplomaticOutreach: cloneValue(normalizeArray(transaction?.diplomaticOutreach)),
});

const gameMasterAcceptedOperationLabels = (transaction) => {
  const labels = [];
  for (const [eventIndex, event] of normalizeArray(transaction?.events).entries()) {
    labels.push(`event:${eventIndex}:${normalizeString(event?.id)}`);
    const impacts = event?.impacts || {};
    for (const [field, prefix] of [
      ["regionTransfers", "territory"],
      ["regionClaims", "claim"],
      ["regionControlOps", "control"],
      ["polityChanges", "polity"],
      ["unitOps", "unit"],
      ["markerOps", "marker"],
      ["createdChats", "event-chat"],
    ]) {
      normalizeArray(impacts[field]).forEach((_, index) => labels.push(`${prefix}:${eventIndex}:${index}`));
    }
  }
  normalizeArray(transaction?.countryStatPatches).forEach((entry, index) => labels.push(`stats:${index}:${normalizeString(entry?.country)}`));
  normalizeArray(transaction?.storylineUpdates).forEach((entry, index) => labels.push(`storyline:${index}:${normalizeString(entry?.id)}`));
  normalizeArray(transaction?.warUpdates).forEach((entry, index) => labels.push(`war:${index}:${normalizeString(entry?.id)}`));
  normalizeArray(transaction?.relationUpdates).forEach((entry, index) => labels.push(`relation:${index}:${relationPairKeyForHistory(entry?.a, entry?.b)}`));
  normalizeArray(transaction?.agreementUpdates).forEach((entry, index) => labels.push(`agreement:${index}:${normalizeString(entry?.id)}`));
  normalizeArray(transaction?.diplomaticOutreach).forEach((_, index) => labels.push(`outreach:${index}`));
  return labels.filter(Boolean).slice(0, 128);
};

const gameMasterHistoryEntry = ({ transaction, game, eventIds, summary, transactionId }) => {
  const dates = normalizeArray(transaction?.events).map((event) => normalizeString(event?.date)).filter(Boolean).sort();
  const fallbackDate = normalizeString(game?.gameDate || game?.startDate);
  const fromDate = dates[0] || fallbackDate;
  const toDate = dates.at(-1) || fallbackDate;
  return {
    catalyst: null,
    date: toDate,
    eventIds,
    fallbackReason: "",
    fromDate,
    mode: "game-master",
    plannedActions: [],
    round: Math.max(0, Math.trunc(Number(game?.round) || 0)),
    source: "gm-console",
    summary: normalizeString(summary) || "GM Console transaction applied.",
    toDate,
    transactionId,
  };
};

const insertGameMasterHistoryEntry = (historyInput, entry) => {
  const history = [...normalizeArray(historyInput)];
  const entryDate = normalizeString(entry?.toDate || entry?.date || entry?.fromDate);
  let insertAt = history.findIndex((item) => {
    const itemDate = normalizeString(item?.toDate || item?.date || item?.fromDate);
    return entryDate && itemDate && entryDate > itemDate;
  });
  if (insertAt < 0) insertAt = history.length;
  history.splice(insertAt, 0, entry);
  return history;
};

// GM-authored timeline records are only UI/history links; the canonical event ledger
// remains the source of truth. If an Event Editor deletion removed the linked event,
// discard the now-orphaned GM history record so the Events panel cannot get stuck on
// an empty, stale record (for example an old future-dated GM test event).
const pruneOrphanedGameMasterHistory = (historyInput, eventsInput) => {
  const knownEventIds = new Set(
    normalizeArray(eventsInput)
      .map((event) => normalizeString(event?.id))
      .filter(Boolean),
  );

  return normalizeArray(historyInput)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const source = normalizeString(entry?.source).toLowerCase();
      const mode = normalizeString(entry?.mode).toLowerCase();
      if (source !== "gm-console" && mode !== "game-master") return entry;

      const before = normalizeArray(entry?.eventIds).map(normalizeString).filter(Boolean);
      const after = before.filter((eventId) => knownEventIds.has(eventId));
      if (after.length === 0) return null;
      if (after.length === before.length) return entry;
      return { ...entry, eventIds: after };
    })
    .filter(Boolean);
};

// Generate and validate a GM transaction WITHOUT persisting it. Preview receives
// stable transaction/event ids now so Apply persists exactly the object the
// administrator inspected; Apply never asks the AI to reinterpret it.
export const previewGameMasterCommand = async (requestText, { mode = "world-intervention" } = {}) => {
  const request = normalizeString(requestText);
  const selectedMode = normalizeString(mode).toLowerCase();
  if (!request) throw new Error("Enter a GM request first.");
  if (!GAME_MASTER_MODE_SET.has(selectedMode)) throw new Error(`Unsupported GM mode "${selectedMode}".`);

  beginSimulation();
  try {
    const [bundle, colors] = await Promise.all([
      readGameStateBundle({ force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
    ]);
    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "gameMaster", gameMasterRequest: request })),
      gameMasterMode: selectedMode,
    };

    const { generation, payload } = await runJsonTask("gameMaster", {
      userMessage: `Generate a ${selectedMode} GM transaction preview for the administrator request. Do not apply anything.`,
      validatePayload: (candidate) => validateGameMasterPreviewPayload(candidate, {
        mode: selectedMode,
        world: bundle.world,
        game: bundle.game,
        request,
      }),
      variables,
    });

    const transactionId = createGameMasterTransactionId();
    const storylineUpdates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
    const events = attachStorylineIdsByIndexes(
      normalizeArray(payload?.events)
        .map((entry, index) => normalizeGeneratedEvent({
          ...entry,
          id: `event-manual-${transactionId}-${index + 1}`,
          source: "game-master",
        }, index))
        .filter(Boolean),
      storylineUpdates,
    );
    const warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(payload?.warUpdates), events);
    const relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(payload?.relationUpdates), events);
    const agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(payload?.agreementUpdates), events);
    const countryStatPatches = normalizeGameMasterStatPatches(payload?.countryStatPatches, bundle.world);

    return {
      id: transactionId,
      mode: selectedMode,
      request,
      date: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
      baseFingerprint: gameMasterStateFingerprint({ game: bundle.game, world: bundle.world, events: bundle.events, colors }),
      summary: normalizeString(payload?.summary),
      transaction: {
        id: transactionId,
        mode: selectedMode,
        summary: normalizeString(payload?.summary),
        events,
        countryStatPatches,
        storylineUpdates,
        warUpdates,
        relationUpdates,
        agreementUpdates,
        diplomaticOutreach: normalizeArray(payload?.diplomaticOutreach),
      },
      generation,
      previewOnly: true,
    };
  } finally {
    endSimulation();
  }
};

// Apply the EXACT already-previewed transaction. There is no AI call, no turn
// simulation, no date advance and no round increment. The preview is revalidated
// against a freshly-read canonical world immediately before any write.
export const applyGameMasterPreview = async (preview) => {
  const transactionId = normalizeString(preview?.id || preview?.transaction?.id);
  const mode = normalizeString(preview?.mode || preview?.transaction?.mode).toLowerCase();
  const request = normalizeString(preview?.request);
  if (!transactionId || !preview?.transaction || typeof preview.transaction !== "object") {
    throw new Error("This GM preview is missing its transaction identity. Generate a fresh preview.");
  }
  if (!GAME_MASTER_MODE_SET.has(mode)) throw new Error(`Unsupported GM mode "${mode}".`);
  if (!normalizeString(preview?.baseFingerprint)) {
    throw new Error("This preview carries no safety fingerprint. Generate a fresh preview before applying.");
  }

  beginSimulation();
  try {
    const [bundle, colors] = await Promise.all([
      readGameStateBundle({ force: true }),
      readJson(JSON_URLS.colors, { defaultValue: {}, force: true }),
    ]);
    const liveWorld = normalizeWorldState(bundle.world);

    if (normalizeArray(liveWorld.gmAudit).some((entry) => normalizeString(entry?.transactionId) === transactionId)) {
      throw new Error(`GM transaction ${transactionId} has already been applied.`);
    }

    const liveFingerprint = gameMasterStateFingerprint({ game: bundle.game, world: liveWorld, events: bundle.events, colors });
    if (liveFingerprint !== normalizeString(preview.baseFingerprint)) {
      throw new Error("Canonical state changed after this preview was generated. Nothing was applied; regenerate the preview against the current world.");
    }

    const transaction = cloneValue(preview.transaction);
    const candidate = gameMasterTransactionCandidate(transaction);
    const candidateBeforeValidation = JSON.stringify(candidate);
    const validationError = await validateGameMasterPreviewPayload(candidate, {
      mode,
      world: liveWorld,
      game: bundle.game,
      request: preview.request,
    });
    if (validationError) throw new Error(`GM transaction is no longer valid: ${validationError}`);
    if (JSON.stringify(candidate) !== candidateBeforeValidation) {
      throw new Error("Current canonical validation would reinterpret this preview. Nothing was applied; regenerate it so the changed operation is visible before approval.");
    }

    const events = normalizeArray(transaction.events).map((event) => cloneValue(event));
    const priorEvents = normalizeEvents(bundle.events);
    const freshEvents = dedupeGeneratedEvents(priorEvents, events);
    if (freshEvents.length !== events.length) {
      throw new Error("One or more authored GM events duplicate existing canonical history. Nothing was applied; regenerate or make the event wording/date explicit.");
    }
    const existingIds = new Set(priorEvents.map((event) => normalizeString(event?.id)).filter(Boolean));
    const duplicateId = events.find((event) => existingIds.has(normalizeString(event?.id)));
    if (duplicateId) throw new Error(`Authored GM event id ${duplicateId.id} already exists. Nothing was applied; regenerate the preview.`);

    const impactMerge = applyEventImpactsToWorld({
      colors,
      events,
      round: bundle.game.round || 0,
      world: liveWorld,
    });
    let nextWorld = impactMerge.world;
    const nextColors = impactMerge.colors;

    const territoryPostconditionError = verifyGameMasterTerritoryPostconditions(events, nextWorld);
    if (territoryPostconditionError) {
      throw new Error(
        `A previewed territorial operation failed during the in-memory Apply: ${territoryPostconditionError} Nothing was persisted.`,
      );
    }

    const statCountries = [];
    for (const entry of normalizeArray(transaction.countryStatPatches)) {
      const country = normalizeString(entry?.country);
      const nextSheet = applyCountryStatPatchToWorld(nextWorld, country, cloneValue(entry?.patch));
      if (!nextSheet) throw new Error(`Stats patch for ${country || "unknown polity"} could not be applied. Nothing was persisted.`);
      statCountries.push(country);
      const reputation = Number(nextSheet?.indices?.internationalReputation);
      if (Number.isFinite(reputation)) {
        nextWorld.internationalReputation = {
          ...(nextWorld.internationalReputation || {}),
          [country]: Math.max(0, Math.min(100, Math.round(reputation))),
        };
      }
    }

    if (statCountries.length) {
      nextWorld = captureCountryStatsHistory(nextWorld, {
        date: bundle.game.gameDate || bundle.game.startDate || "",
        round: bundle.game.round || 0,
      });
    }

    const warMerge = applyWarUpdates({
      world: nextWorld,
      updates: normalizeArray(transaction.warUpdates),
      events,
      stopDate: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
    });
    if (warMerge.appliedIds.length !== normalizeArray(transaction.warUpdates).length) {
      throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = warMerge.world;

    const diplomaticMerge = applyDiplomaticUpdates({
      world: nextWorld,
      relationUpdates: normalizeArray(transaction.relationUpdates),
      agreementUpdates: normalizeArray(transaction.agreementUpdates),
      events,
      stopDate: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
    });
    if (diplomaticMerge.appliedRelationIds.length !== normalizeArray(transaction.relationUpdates).length) {
      throw new Error("A canonical relation operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    if (diplomaticMerge.appliedAgreementIds.length !== normalizeArray(transaction.agreementUpdates).length) {
      throw new Error("A canonical agreement operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = diplomaticMerge.world;

    const storylineMerge = applyWorldStorylineUpdates({
      world: nextWorld,
      updates: normalizeArray(transaction.storylineUpdates),
      events,
      stopDate: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
    });
    if (storylineMerge.appliedIds.length !== normalizeArray(transaction.storylineUpdates).length) {
      throw new Error("A canonical storyline operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = storylineMerge.world;

    const generatedChats = [];
    for (const event of events) {
      for (const createdChat of normalizeArray(event?.impacts?.createdChats)) {
        const nextChat = await buildGeneratedChat(createdChat, event.id, nextWorld, {
          fallbackTitle: event.title,
          playerName: bundle.game.country,
        });
        if (!nextChat) throw new Error(`A diplomatic chat linked to event "${event.title}" could not be built. Nothing was persisted.`);
        generatedChats.unshift(nextChat);
      }
    }
    for (const chatLike of normalizeArray(transaction.diplomaticOutreach)) {
      const nextChat = await buildGeneratedChat({ ...chatLike, source: "gm-outreach" }, "", nextWorld, {
        playerName: bundle.game.country,
      });
      if (!nextChat) throw new Error("A GM diplomatic outreach operation could not be built. Nothing was persisted.");
      generatedChats.unshift(nextChat);
    }

    // A note to a polity the player already talks to lands in that thread; only
    // a genuinely new participant set opens a fresh chat (the same fold every
    // generated chat goes through).
    let chatsToWrite = null;
    if (generatedChats.length) {
      const liveChats = normalizeChats(await readChatsState({ force: true }));
      chatsToWrite = foldGeneratedChatsIntoStorage(liveChats, generatedChats, {
        stampTime: bundle.game.gameDate || bundle.game.startDate || "",
      });
    }

    const nextEvents = [...priorEvents, ...events];
    // Repair orphaned GM timeline links before inserting this transaction. This is
    // intentionally limited to GM-owned history records and never touches ordinary
    // turn history.
    nextWorld.simulationHistory = pruneOrphanedGameMasterHistory(
      nextWorld.simulationHistory,
      nextEvents,
    );
    const eventIds = events.map((event) => normalizeString(event?.id)).filter(Boolean);
    const storylineIds = [...new Set(storylineMerge.appliedIds.map(normalizeString).filter(Boolean))];
    const warIds = [...new Set(warMerge.appliedIds.map(normalizeString).filter(Boolean))];
    const relationIds = [...new Set(diplomaticMerge.appliedRelationIds.map(normalizeString).filter(Boolean))];
    const agreementIds = [...new Set(diplomaticMerge.appliedAgreementIds.map(normalizeString).filter(Boolean))];
    const chatIds = generatedChats.map((chat) => normalizeString(chat?.id)).filter(Boolean);
    const summary = normalizeString(transaction.summary || preview.summary);

    if (eventIds.length) {
      nextWorld.simulationHistory = insertGameMasterHistoryEntry(
        nextWorld.simulationHistory,
        gameMasterHistoryEntry({ transaction, game: bundle.game, eventIds, summary, transactionId }),
      );
    }

    const auditRecord = {
      id: `audit-${transactionId}`,
      transactionId,
      appliedAt: new Date().toISOString(),
      date: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
      mode,
      request,
      summary,
      source: "gm-console",
      status: "applied",
      transaction: cloneValue(transaction),
      acceptedOperations: gameMasterAcceptedOperationLabels(transaction),
      rejectedOperations: [],
      eventIds,
      storylineIds,
      warIds,
      relationIds,
      agreementIds,
      chatIds,
      statCountries: [...new Set(statCountries.filter(Boolean))],
    };
    nextWorld.gmAudit = [auditRecord, ...normalizeArray(nextWorld.gmAudit)].slice(0, 64);

    // Canonical persistence only. Deliberately omit actions/game writes, rollback
    // snapshots and oh:turn-complete: a GM edit is administrative authority, not a turn.
    // Avoid rewriting unrelated assets when this transaction did not touch them.
    const touchedEvents = events.length > 0;
    const touchedChats = generatedChats.length > 0;
    const touchedColors = JSON.stringify(nextColors) !== JSON.stringify(colors);
    const writes = [writeWorldState(nextWorld)];
    if (touchedEvents) writes.push(writeEventsState(nextEvents));
    if (touchedChats) writes.push(writeChatsState(chatsToWrite));
    if (touchedColors) writes.push(writeJson(JSON_URLS.colors, nextColors, { pretty: true }));

    try {
      await Promise.all(writes);
    } catch (error) {
      // Storage is file-based rather than transactional. Restore every asset this GM
      // transaction may have touched so a single failed write does not leave half an
      // intervention in canon. Best-effort rollback errors are logged separately.
      const rollbackWrites = [writeWorldState(bundle.world)];
      if (touchedEvents) rollbackWrites.push(writeEventsState(bundle.events));
      if (touchedChats) rollbackWrites.push(writeChatsState(bundle.chats));
      if (touchedColors) rollbackWrites.push(writeJson(JSON_URLS.colors, colors, { pretty: true }));
      const rollbackResults = await Promise.allSettled(rollbackWrites);
      const rollbackFailed = rollbackResults.some((result) => result.status === "rejected");
      if (rollbackFailed) console.error("[GM] persistence rollback was incomplete.", rollbackResults);
      throw new Error(
        rollbackFailed
          ? `GM persistence failed and rollback was incomplete: ${error?.message || error}`
          : `GM persistence failed; the pre-apply state was restored: ${error?.message || error}`,
      );
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("oh:gm-transaction-applied", { detail: { transactionId } }));
      if (events.some((event) => normalizeArray(event?.impacts?.markerOps).length > 0)) {
        window.dispatchEvent(new Event("oh:cities-updated"));
      }
    }

    return {
      applied: true,
      transactionId,
      auditId: auditRecord.id,
      mode,
      date: bundle.game.gameDate || bundle.game.startDate || "",
      round: bundle.game.round || 0,
      summary,
      eventIds,
      storylineIds,
      warIds,
      relationIds,
      agreementIds,
      chatIds,
      statCountries: auditRecord.statCountries,
    };
  } finally {
    endSimulation();
  }
};

// Kept for stale callers, but direct prose execution remains forbidden. The UI must
// always generate and expose a preview before any canonical write can happen.
export const applyGameMasterCommand = async () => {
  throw new Error("Direct GM execution is disabled. Generate a preview and apply that exact transaction through the GM Console.");
};

// ---- Event Editor diplomatic reaction queue ---------------------------------
// A manually-authored event can optionally invite ONE autonomous NPC reaction.
// The editor commits the event immediately, then stores a real-time grace deadline
// in world.pendingEventOutreach. This worker evaluates only when the deadline is
// due, re-reads the exact event before AND after the model call, and routes any
// resulting message through the same chat fold as normal gameplay.
const eventReactionKey = (event) => [
  normalizeString(event?.id),
  normalizeString(event?.createdAt),
].join("");

const eventReactionQueueKey = (entry) => [
  normalizeString(entry?.sourceEventId),
  normalizeString(entry?.sourceEventCreatedAt),
].join("");

const eventReactionPromptText = (event, playerName) => {
  const quote = event?.quote?.text
    ? `\nQuote: “${normalizeString(event.quote.text)}”${event.quote.speaker ? ` — ${normalizeString(event.quote.speaker)}` : ""}`
    : "";
  return [
    `PLAYER POLITY: ${normalizeString(playerName) || "Unknown"}`,
    `EVENT DATE: ${normalizeString(event?.date) || "Undated"}`,
    `EVENT TITLE: ${normalizeString(event?.title) || "Untitled"}`,
    `EVENT KIND: ${normalizeString(event?.kind) || "world"}`,
    `EVENT IMPORTANCE: ${normalizeString(event?.importance) || "minor"}`,
    `PLAYER-RELATED FLAG: ${event?.playerRelated ? "yes" : "no"}`,
    `EVENT DESCRIPTION: ${normalizeString(event?.description) || "No description."}${quote}`,
  ].join("\n");
};

const eventReactionDueMs = (entry) => {
  const ms = Date.parse(normalizeString(entry?.deliverAfter));
  return Number.isFinite(ms) ? ms : 0;
};

const chatParticipantNamesKey = (chat) => normalizeArray(chat?.countries)
  .map((country) => normalizeString(country?.name || country?.code || country).toLowerCase())
  .filter(Boolean)
  .sort()
  .join("|");

let eventReactionInFlight = false;

export const processPendingEventOutreach = async ({ debug = false } = {}) => {
  if (eventReactionInFlight) return debug ? { processed: 0, reason: "already-in-flight", retryAfterMs: 1000 } : null;
  if (isSimulationBusy()) return debug ? { processed: 0, reason: "simulation-busy", retryAfterMs: 5000 } : null;

  eventReactionInFlight = true;
  try {
    const bundle = await readGameStateBundle({ force: true });
    const now = Date.now();
    const queue = normalizeArray(bundle.world?.pendingEventOutreach)
      .slice()
      .sort((a, b) => eventReactionDueMs(a) - eventReactionDueMs(b));
    const due = queue.find((entry) => eventReactionDueMs(entry) <= now);

    if (!due) {
      const nextDue = queue.length ? eventReactionDueMs(queue[0]) : 0;
      return debug ? {
        processed: 0,
        reason: queue.length ? "not-due" : "empty",
        nextDueAt: nextDue ? new Date(nextDue).toISOString() : "",
      } : null;
    }

    const dueKey = eventReactionQueueKey(due);
    const dueQueueId = normalizeString(due?.id);
    const findCurrentEvent = (events) => normalizeArray(events).find((event) => eventReactionKey(event) === dueKey);
    let event = findCurrentEvent(bundle.events);

    const removeQueueEntry = async (worldInput, { events = null, reactionResult = "", chatId = "" } = {}) => {
      const nextWorld = {
        ...worldInput,
        pendingEventOutreach: normalizeArray(worldInput?.pendingEventOutreach)
          .filter((entry) => normalizeString(entry?.id) !== dueQueueId),
      };
      await writeWorldState(nextWorld);

      if (event && events && reactionResult) {
        const updatedEvents = normalizeArray(events).map((candidate) =>
          eventReactionKey(candidate) === dueKey
            ? {
                ...candidate,
                npcReaction: {
                  ...(candidate?.npcReaction || {}),
                  enabled: Boolean(candidate?.npcReaction?.enabled),
                  evaluatedAt: new Date().toISOString(),
                  result: reactionResult,
                  ...(chatId ? { chatId } : {}),
                },
              }
            : candidate
        );
        await writeEventsState(updatedEvents);
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:event-outreach-evaluated", {
          detail: { sourceEventId: due.sourceEventId, result: reactionResult || "cancelled", chatId },
        }));
      }
    };

    if (!event || !event?.npcReaction?.enabled) {
      await removeQueueEntry(bundle.world);
      return debug ? { processed: 1, reason: event ? "reaction-disabled" : "event-missing" } : null;
    }

    const eventSignature = (entry) => JSON.stringify({
      date: entry.date,
      title: entry.title,
      description: entry.description,
      quote: entry.quote || null,
      kind: entry.kind,
      importance: entry.importance,
      playerRelated: Boolean(entry.playerRelated),
    });
    const beforeSignature = eventSignature(event);

    const openChats = normalizeChats(bundle.chats);
    const conversationContext = [
      "",
      "These are the conversations already open with the player, oldest message first:",
      "",
      renderOpenChatsForPrompt(openChats),
      "",
      "If you write to a polity already in an open thread, the note is appended there. Reply to what was actually said; never restart the conversation or parrot an existing message.",
    ].join("\n");

    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "idleDiplomacy" })),
      idleChatAllowed: "yes",
      eventDiplomaticReactionContext: eventReactionPromptText(event, bundle.game?.country),
    };

    let payload;
    try {
      ({ payload } = await runJsonTask("idleDiplomacy", {
        userMessage:
          "Evaluate the supplied canonical event once. Decide whether one AI-controlled polity or a genuinely joint small group would naturally send the player a diplomatic note about it right now, or whether silence is the natural outcome. Return unitOps as an empty array and no sighting."
          + conversationContext
          + "\n\nReturn JSON only.",
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          if (candidate?.chat == null) return "";
          const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
          if (countries.length === 0) {
            return "$.chat.countries must contain at least one known non-player polity (or chat must be null).";
          }
          return finalAttempt ? "" : validateChatOpener(candidate.chat, "$.chat");
        },
        variables,
      }));
    } catch (error) {
      // Keep the request pending, but back off instead of hot-looping a dead provider.
      const latestWorld = await readWorldState({ force: true });
      const latestQueue = normalizeArray(latestWorld.pendingEventOutreach).map((entry) =>
        normalizeString(entry?.id) === dueQueueId
          ? {
              ...entry,
              attempts: Number(entry?.attempts || 0) + 1,
              deliverAfter: new Date(Date.now() + 30000).toISOString(),
              lastError: normalizeString(error?.message),
            }
          : entry
      );
      await writeWorldState({ ...latestWorld, pendingEventOutreach: latestQueue });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
      }
      return debug ? { processed: 0, reason: "ai-error", retryAfterMs: 30000, message: normalizeString(error?.message) } : null;
    }

    // The grace window extends through generation in practice: if the admin edits,
    // disables, or deletes the event while the model is thinking, do NOT send a stale
    // message. Re-evaluate the latest edit instead, or cancel if the event vanished.
    const [latestWorld, latestEvents] = await Promise.all([
      readWorldState({ force: true }),
      readEventsState({ force: true }),
    ]);
    const queueStillPending = normalizeArray(latestWorld.pendingEventOutreach)
      .some((entry) => normalizeString(entry?.id) === dueQueueId);
    const latestEvent = findCurrentEvent(latestEvents);

    if (!queueStillPending || !latestEvent || !latestEvent?.npcReaction?.enabled) {
      if (queueStillPending) await removeQueueEntry(latestWorld);
      return debug ? { processed: 1, reason: "cancelled-during-generation" } : null;
    }

    if (eventSignature(latestEvent) !== beforeSignature) {
      const rescheduled = normalizeArray(latestWorld.pendingEventOutreach).map((entry) =>
        normalizeString(entry?.id) === dueQueueId
          ? { ...entry, deliverAfter: new Date(Date.now() + 1000).toISOString(), lastError: "" }
          : entry
      );
      await writeWorldState({ ...latestWorld, pendingEventOutreach: rescheduled });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
      }
      return debug ? { processed: 0, reason: "event-changed-requeue", retryAfterMs: 1000 } : null;
    }

    event = latestEvent;

    if (!payload?.chat) {
      await removeQueueEntry(latestWorld, { events: latestEvents, reactionResult: "silent" });
      return debug ? { processed: 1, reason: "model-chose-silence" } : null;
    }

    if (isSimulationBusy()) {
      const deferred = normalizeArray(latestWorld.pendingEventOutreach).map((entry) =>
        normalizeString(entry?.id) === dueQueueId
          ? { ...entry, deliverAfter: new Date(Date.now() + 5000).toISOString() }
          : entry
      );
      await writeWorldState({ ...latestWorld, pendingEventOutreach: deferred });
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("oh:event-outreach-queue-changed"));
      return debug ? { processed: 0, reason: "simulation-started-during-generation", retryAfterMs: 5000 } : null;
    }

    const built = await buildGeneratedChat(
      { ...payload.chat, source: "event-reaction" },
      event.id,
      latestWorld,
      { fallbackTitle: event.title, playerName: bundle.game?.country },
    );

    if (!built) {
      await removeQueueEntry(latestWorld, { events: latestEvents, reactionResult: "silent" });
      return debug ? { processed: 1, reason: "generated-chat-invalid-treated-as-silence" } : null;
    }

    const messageDate = normalizeString(event.date) || normalizeString(bundle.game?.gameDate);
    const currentChats = normalizeChats(await readChatsState({ force: true }));
    const nextChats = foldGeneratedChatsIntoStorage(currentChats, [built], { stampTime: messageDate });
    await writeChatsState(nextChats);

    const builtParticipantKey = chatParticipantNamesKey(built);
    const mergedChat = builtParticipantKey
      ? nextChats.find((chat) =>
          normalizeString(chat?.status).toLowerCase() !== "closed" &&
          chatParticipantNamesKey(chat) === builtParticipantKey)
      : null;
    const actualChatId = normalizeString(mergedChat?.id || built.id);

    await removeQueueEntry(latestWorld, {
      events: latestEvents,
      reactionResult: "sent",
      chatId: actualChatId,
    });

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("oh:diplomacy-chats-updated", {
        detail: { source: "event-reaction", linkedEventId: event.id, chatId: actualChatId },
      }));
    }

    return built;
  } finally {
    eventReactionInFlight = false;
  }
};

// ---- Pre-game history -------------------------------------------------------
// Pre-game backstory dates must sit strictly before round one. Strict/salvage
// like the jump validators: attempt 1 returns corrective errors the model can
// fix, attempt 2 drops what cannot be placed instead of rejecting the turn.
// Non-Gregorian scenarios ("1200 BCE") skip date checks entirely — the model
// is told to match the scenario's own dating style and we take it at its word.
const validatePregameEvents = (candidate, { startDate, strict }) => {
  const events = normalizeArray(candidate?.events);
  if (events.length === 0) return "$.events must contain at least one pre-game event.";
  if (!parseIsoDate(startDate)) return "";
  if (strict) {
    let previous = "";
    for (let index = 0; index < events.length; index += 1) {
      const date = normalizeString(events[index]?.date);
      if (!parseIsoDate(date)) {
        return `$.events[${index}].date must be a real YYYY-MM-DD date.`;
      }
      if (date >= startDate) {
        return `$.events[${index}].date must be strictly before the game start date ${startDate} — these events are pre-game history.`;
      }
      if (previous && date < previous) {
        return `$.events[${index}].date must not be earlier than the previous event — order the backstory chronologically.`;
      }
      previous = date;
    }
    return "";
  }
  candidate.events = events
    .filter((event) => {
      const date = normalizeString(event?.date);
      return parseIsoDate(date) && date < startDate;
    })
    .sort((a, b) => normalizeString(a.date).localeCompare(normalizeString(b.date)));
  return "";
};

// ---- Round-zero ledger bootstrap --------------------------------------------
// The polities the pre-game bootstrap may name in structured ledger records:
// every current owner on the map plus every registered polity, canonicalised.
const buildCurrentCanonicalPolityVocabulary = async (world) => {
  const normalizedWorld = normalizeWorldState(world);
  const tokens = new Set();
  const collect = (token) => {
    const raw = normalizeString(token);
    if (raw) tokens.add(raw);
  };

  for (const [key, entry] of Object.entries(normalizedWorld.polityOverrides || {})) {
    if (normalizeString(entry?.status).toLowerCase() !== "dissolved") collect(key);
  }
  // Runtime overrides are authoritative regardless of map type. A legal
  // sovereign remains a current actor even if all of its land is occupied.
  for (const owner of Object.values(normalizedWorld.regionOwnershipOverrides || {})) collect(owner);
  for (const owner of Object.values(normalizedWorld.regionSovereigntyOverrides || {})) collect(owner);

  const scenarioRegions = await readJson(JSON_URLS.regionsGeojson, { defaultValue: null }).catch(() => null);
  const scenarioFeatures = normalizeArray(scenarioRegions?.features);
  if (scenarioFeatures.length > 0) {
    for (const feature of scenarioFeatures) {
      const props = feature?.properties || {};
      collect(
        props.owner ||
        props.COUNTRY ||
        props.Country ||
        props.country ||
        toCountryName(props.GID_0 || props.gid0 || props.gid_0) ||
        "",
      );
    }
  } else {
    const catalog = await loadRegionCatalog().catch(() => []);
    for (const region of normalizeArray(catalog)) {
      const regionId = normalizeString(region?.id);
      collect(
        (regionId && normalizedWorld.regionOwnershipOverrides?.[regionId]) ||
        region?.country ||
        toCountryName(region?.countryCode) ||
        "",
      );
    }
  }

  const identityIndex = buildPolityIdentityIndex(normalizedWorld);
  const byKey = new Map();
  for (const raw of tokens) {
    const canonical = canonicalCampaignPolity(raw, normalizedWorld, identityIndex);
    const key = canonical.toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, canonical);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
};

const validatePregamePolityVocabulary = (candidate, { world = {}, canonicalPolities = [] } = {}) => {
  const allowedByKey = new Map(
    normalizeArray(canonicalPolities)
      .map((name) => normalizeString(name))
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]),
  );
  if (!allowedByKey.size) return "";

  const checkToken = (token, path) => {
    const raw = normalizeString(token);
    if (!raw) return "";
    const resolved = resolvePolityIdentity(raw, world, {
      allowUnknown: false,
      requireActive: false,
      allowCoreMatch: true,
      allowStockBase: true,
    });
    const canonical = normalizeString(resolved?.resolved);
    if (canonical && allowedByKey.has(canonical.toLowerCase())) return "";
    const sample = [...allowedByKey.values()].slice(0, 80).join("; ");
    return `${path} uses the non-current or unresolved polity "${raw}". Round-One ledger records may use ONLY current canonical polities from the save; do not invent an umbrella or legacy actor - decompose it into the applicable current polity or polities. Current polity vocabulary: ${sample}.`;
  };

  const storylineUpdates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  for (let i = 0; i < storylineUpdates.length; i += 1) {
    const participants = normalizeArray(storylineUpdates[i]?.participants);
    for (let j = 0; j < participants.length; j += 1) {
      const error = checkToken(participants[j], `$.canonicalUpdates storyline record ${i + 1} participant ${j + 1}`);
      if (error) return error;
    }
  }
  const warUpdates = decodeWarUpdates(candidate?.warUpdates);
  for (let i = 0; i < warUpdates.length; i += 1) {
    for (const [field, tokens] of [["actors", normalizeArray(warUpdates[i]?.actors)], ["opponents", normalizeArray(warUpdates[i]?.opponents)]]) {
      for (let j = 0; j < tokens.length; j += 1) {
        const error = checkToken(tokens[j], `$.warUpdates record ${i + 1} ${field}[${j}]`);
        if (error) return error;
      }
    }
  }
  const relationUpdates = decodeRelationUpdates(candidate?.relationUpdates);
  for (let i = 0; i < relationUpdates.length; i += 1) {
    const aError = checkToken(relationUpdates[i]?.a, `$.relationUpdates record ${i + 1}.a`);
    if (aError) return aError;
    const bError = checkToken(relationUpdates[i]?.b, `$.relationUpdates record ${i + 1}.b`);
    if (bError) return bError;
  }
  const agreementUpdates = decodeAgreementUpdates(candidate?.agreementUpdates);
  for (let i = 0; i < agreementUpdates.length; i += 1) {
    const parties = normalizeArray(agreementUpdates[i]?.parties);
    for (let j = 0; j < parties.length; j += 1) {
      const error = checkToken(parties[j], `$.agreementUpdates record ${i + 1} parties[${j}]`);
      if (error) return error;
    }
  }
  return "";
};

// A live canonical war and its scheduler-facing war storyline are intentionally
// separate ledgers, but the existence/id of the war storyline is mechanical once
// belligerency is authoritative. Round Zero therefore must not waste an AI output
// slot asking the model to duplicate the same fact with an exact derived id.
//
// Preserve an explicit semantic war storyline when the model supplied one for the
// same participant set (so its pressure/momentum/state judgement is retained), but
// canonicalize its id/status/kind. If none exists, synthesize only the minimal
// scheduler mirror from the already-validated war + its causal historical event.
// This is NOT a new system or new historical judgement; it is an adapter between
// the existing world.wars and world.storylines ledgers.
const ensurePregameWarStorylineMirrors = (
  candidate,
  {
    warProbe = { wars: [] },
    warUpdates = [],
    startDate = "",
  } = {},
) => {
  const events = normalizeArray(candidate?.events);
  let storylines = decodeWorldStorylineUpdates(candidate?.storylineUpdates);

  const participantKey = (participants) =>
    [...new Set(
      normalizeArray(participants)
        .map(normalizeString)
        .filter(Boolean)
        .map((name) => name.toLowerCase()),
    )]
      .sort()
      .join(" | ");

  const liveWars = normalizeArray(warProbe?.wars)
    .filter((war) => ["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase()));

  for (const war of liveWars) {
    const warId = normalizeString(war?.id);
    if (!warId) continue;

    const relatedUpdate = normalizeArray(warUpdates)
      .find((update) => normalizeString(update?.id) === warId);
    if (!relatedUpdate) continue;

    const participants = [...new Set([
      ...normalizeArray(war?.sideA).map(normalizeString),
      ...normalizeArray(war?.sideB).map(normalizeString),
    ].filter(Boolean))];
    const expectedId = `storyline-${warId}`;
    const expectedParticipantsKey = participantKey(participants);

    const causalIndexes = normalizeArray(relatedUpdate?.eventIndexes)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < events.length);
    const causalEvent = causalIndexes.length ? events[causalIndexes[0]] : null;

    const exactIndex = storylines.findIndex(
      (entry) => normalizeString(entry?.id) === expectedId,
    );
    const semanticIndex = exactIndex >= 0
      ? exactIndex
      : storylines.findIndex((entry) =>
          normalizeString(entry?.kind).toLowerCase() === "war" &&
          participantKey(entry?.participants) === expectedParticipantsKey
        );

    const warStatus = normalizeString(war?.status).toLowerCase();
    const defaultPressure = warStatus === "ceasefire" ? 60 : 85;
    const defaultMomentum = warStatus === "ceasefire" ? 15 : 30;
    const fallbackTitle =
      normalizeString(causalEvent?.title) ||
      normalizeString(relatedUpdate?.note) ||
      expectedId;
    const fallbackState =
      normalizeString(relatedUpdate?.note) ||
      normalizeString(causalEvent?.description) ||
      fallbackTitle;
    const fallbackStartedDate =
      normalizeString(causalEvent?.date) ||
      normalizeString(startDate);

    const prior = semanticIndex >= 0 ? storylines[semanticIndex] : null;
    const canonicalMirror = {
      ...(prior || {}),
      id: expectedId,
      status: "active",
      pressure: Number.isFinite(Number(prior?.pressure))
        ? Number(prior.pressure)
        : defaultPressure,
      momentum: Number.isFinite(Number(prior?.momentum))
        ? Number(prior.momentum)
        : defaultMomentum,
      startedDate: normalizeString(prior?.startedDate) || fallbackStartedDate,
      kind: "war",
      title: normalizeString(prior?.title) || fallbackTitle,
      participants,
      eventIndexes: causalIndexes,
      eventIds: [],
      state: normalizeString(prior?.state) || fallbackState,
    };

    // Remove duplicate semantic mirrors for the same exact participant set, then
    // insert the one canonical scheduler record.
    storylines = storylines.filter((entry, index) => {
      if (index === semanticIndex) return false;
      if (normalizeString(entry?.id) === expectedId) return false;
      return !(
        normalizeString(entry?.kind).toLowerCase() === "war" &&
        participantKey(entry?.participants) === expectedParticipantsKey
      );
    });
    storylines.push(canonicalMirror);
  }

  candidate.storylineUpdates = storylines;
};

// Validates only the canonical state that must survive INTO round one; it does
// not demand that every old battle or treaty in the backstory be replayed as a
// mutation. The ledgers' own decoders and appliers stay the sole owners of the
// persisted shapes.
const validatePregameCanonicalBootstrap = (
  candidate,
  { world = {}, startDate = "", strict = true, canonicalPolities = [] } = {},
) => {
  const eventError = validatePregameEvents(candidate, { startDate, strict });
  if (eventError) return eventError;

  const polityError = validatePregamePolityVocabulary(candidate, { world, canonicalPolities });
  if (polityError) return polityError;

  // Rebind after any date salvage/sorting so a model-supplied number can never
  // point at the wrong historical event: wars bind from event.warId, diplomacy
  // from the director's own semantic binder.
  normalizeWorldWarEventLinks(candidate);
  if (!strict) {
    candidate.relationUpdates = decodeRelationUpdates(candidate?.relationUpdates)
      .map((update) => ({ ...update, eventIndexes: [], eventIds: [] }));
    candidate.agreementUpdates = decodeAgreementUpdates(candidate?.agreementUpdates)
      .map((update) => ({ ...update, eventIndexes: [], eventIds: [] }));
    candidate.storylineUpdates = decodeWorldStorylineUpdates(candidate?.storylineUpdates)
      .map((update) => ({ ...update, eventIndexes: [] }));
  }

  const events = normalizeArray(candidate?.events);
  const warUpdates = decodeWarUpdates(candidate?.warUpdates);
  for (let index = 0; index < warUpdates.length; index += 1) {
    const update = warUpdates[index];
    if (!["start", "join-a", "join-b", "leave", "ceasefire", "resume", "end"].includes(normalizeString(update?.op))) {
      return `$.warUpdates record ${index + 1} has the unsupported operation ${normalizeString(update?.op) || "<blank>"}.`;
    }
    const indexes = normalizeArray(update?.eventIndexes);
    if (!indexes.length) {
      return `$.warUpdates record ${index + 1} (${normalizeString(update?.id) || "unnamed war"}) must link to a real pre-game event: set the matching event.warId on the causal pre-game event; the engine owns the binding.`;
    }
    if (indexes.some((eventIndex) => eventIndex < 0 || eventIndex >= events.length)) {
      return `$.warUpdates record ${index + 1} references a pre-game event outside $.events.`;
    }
  }

  // Probe the ledger in memory: catches an invalid start/join/ceasefire order
  // without applying the hard-combat validator to records of old battles.
  const warProbe = applyWarUpdates({ world, updates: warUpdates, events, stopDate: startDate, round: 1 });
  if (warProbe.appliedIds.length !== warUpdates.length) {
    return "$.warUpdates contains an invalid Round-One war lifecycle sequence. Bootstrap only wars that actually survive into the start date, beginning with a valid start operation.";
  }
  for (const warId of new Set(warUpdates.map((update) => normalizeString(update?.id)).filter(Boolean))) {
    const war = normalizeArray(warProbe.wars).find((entry) => normalizeString(entry?.id) === warId);
    if (!war || !["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) {
      return `$.warUpdates leaves ${warId} ${normalizeString(war?.status) || "missing"} at Round One. A war that ended before the campaign belongs only in the pre-game events, not the live war ledger.`;
    }
  }

  // Belligerency is authoritative by now: every surviving Round-One war is
  // mirrored into the storyline ledger mechanically (storyline-<warId>) rather
  // than spending a schema slot on the same fact.
  ensurePregameWarStorylineMirrors(candidate, { warProbe, warUpdates, startDate });

  const agreementUpdates = decodeAgreementUpdates(candidate?.agreementUpdates);
  for (let index = 0; index < agreementUpdates.length; index += 1) {
    if (normalizeString(agreementUpdates[index]?.op).toLowerCase() !== "start") {
      return `$.agreementUpdates record ${index + 1} must use op=start for a formal commitment already in force when this fresh save begins. Ended, expired or suspended historical instruments belong in the backstory, not the active Day-1 ledger.`;
    }
  }

  // Round zero is state that already exists on the start date; its bounded
  // event cards are evidence, not a requirement that every baseline relation or
  // standing treaty have one attributable card. The director binds a causal
  // event when one is clear and otherwise keeps the baseline fact.
  const diplomaticError = validateDiplomaticLedgerPayload(candidate, {
    world,
    allowNativeBinding: true,
    allowUnboundBaseline: true,
  });
  if (diplomaticError) return diplomaticError;

  // Storylines: only unresolved processes alive at Round One, begun on or
  // before the start date, with every live war's mirror present, and the
  // records valid against the world's (normally empty) storyline ledger.
  normalizeWorldStorylineEventLinks(candidate, { world });
  const storylineUpdates = decodeWorldStorylineUpdates(candidate?.storylineUpdates);
  for (let index = 0; index < storylineUpdates.length; index += 1) {
    const storyline = storylineUpdates[index];
    if (normalizeString(storyline?.status).toLowerCase() === "resolved") {
      return `$.canonicalUpdates storyline record ${index + 1} is resolved. The bootstrap persists only unresolved processes still alive at Round One.`;
    }
    const startedDate = normalizeString(storyline?.startedDate);
    if (startedDate && parseIsoDate(startDate) && (!parseIsoDate(startedDate) || startedDate > startDate)) {
      return `$.canonicalUpdates storyline record ${index + 1} date must be on or before the Round-One date ${startDate}.`;
    }
  }
  const storylineById = new Map(
    storylineUpdates
      .map((entry) => [normalizeString(entry?.id), entry])
      .filter(([id]) => Boolean(id)),
  );
  for (const warId of new Set(warUpdates.map((update) => normalizeString(update?.id)).filter(Boolean))) {
    const war = normalizeArray(warProbe.wars).find((entry) => normalizeString(entry?.id) === warId);
    if (!war || !["active", "ceasefire"].includes(normalizeString(war?.status).toLowerCase())) continue;
    const storyline = storylineById.get(`storyline-${warId}`);
    if (!storyline || normalizeString(storyline?.status).toLowerCase() !== "active" || normalizeString(storyline?.kind).toLowerCase() !== "war") {
      return `Round-Zero war-storyline mirror failed for canonical conflict ${warId}.`;
    }
  }
  return validateWorldStorylinePayload(candidate, {
    existingStorylines: world?.storylines,
    selectedStorylines: [],
    deferredStorylines: [],
    originDate: startDate,
    stopDate: startDate,
    world,
    enforceAntiStasis: false,
  });
};

// A fresh game whose scenario wrote a "World Before Round One" briefing gets
// its backstory generated once, the first time the player opens it: the
// briefing (plus rules and map) becomes real timeline events dated before the
// start. Deliberately NOT applySimulationResult — the clock must stay at the
// start date, round must stay 1, and backstory events carry no impacts (the
// scenario's world already reflects them). The simulationHistory entry it
// writes doubles as the done-marker, so it can never run twice.
export const maybeGeneratePregameHistory = async () => {
  if (isSimulationBusy()) return null;
  const bundle = await readGameStateBundle({ force: true });
  const briefing = normalizeString(bundle.world.startingTimelineText);
  if (!briefing) return null;
  if (normalizeEvents(bundle.events).length > 0) return null;
  if ((normalizeWorldState(bundle.world).simulationHistory ?? []).length > 0) return null;
  const startDate = normalizeString(bundle.game.startDate || bundle.game.gameDate);
  if (!startDate) return null;

  beginSimulation();
  try {
    // The backstory now doubles as the round-zero bootstrap of the war and
    // diplomacy ledgers: a campaign that opens mid-war starts with that war on
    // the books, and a standing alliance is a fact from day one.
    const canonicalPolities = await buildCurrentCanonicalPolityVocabulary(bundle.world);
    const variables = {
      ...(await buildTemplateVariables(bundle)),
      pregameStartDate: startDate,
      pregameCanonicalPolityVocabulary: canonicalPolities.length
        ? canonicalPolities.map((name) => `- ${name}`).join("\n")
        : "No current polity vocabulary was available.",
    };
    const { payload } = await runJsonTask("pregameHistory", {
      userMessage: `Write the pre-game historical timeline AND the canonical Round-One bootstrap for ${startDate} as JSON only. ` +
        "Put every war, bilateral relation, formal agreement and unresolved non-war storyline already true on the start date into canonicalUpdates with the correct kind, using ONLY the supplied current polity identities; do not invent event indexes. " +
        "Prioritise every active war and formal agreement first, then the materially important bilateral climates among the central actors. A relation or standing agreement does NOT need its own event card merely to exist; include historical events because they are important timeline anchors, not as bookkeeping padding.",
      validatePayload: (candidate, { finalAttempt } = {}) =>
        validatePregameCanonicalBootstrap(candidate, {
          world: bundle.world,
          startDate,
          strict: !finalAttempt,
          canonicalPolities,
        }),
      variables,
    });

    // The player may have switched games while this generated — the runtime
    // endpoints follow the ACTIVE game, so re-verify the same fresh game is
    // still there before writing anything.
    const [eventsNow, worldNow, gameNow] = await Promise.all([
      readEventsState({ force: true }),
      readWorldState({ force: true }),
      readGameData({ force: true }),
    ]);
    if (normalizeEvents(eventsNow).length > 0) return null;
    const currentWorld = normalizeWorldState(worldNow);
    if ((currentWorld.simulationHistory ?? []).length > 0) return null;
    if (normalizeString(gameNow.startDate || gameNow.gameDate) !== startDate) return null;

    const generatedEvents = normalizeArray(payload?.events)
      .map((entry, index) =>
        normalizeGeneratedEvent({ ...entry, impacts: undefined, source: "pregame" }, index))
      .filter(Boolean);
    if (generatedEvents.length === 0) return null;

    // Round-zero ledgers: bind the Day-1 wars, relations and agreements to the
    // backstory events and merge them into the world the game starts on. The
    // version stamp tells the legacy migration there is nothing left to seed.
    // Storyline ids are attached to the backstory events first, so every Day-1
    // process starts with real sourceEventIds and a last visible date.
    const storylineUpdates = decodeWorldStorylineUpdates(payload?.storylineUpdates);
    const bootstrapEvents = attachStorylineIdsByIndexes(generatedEvents, storylineUpdates);
    const warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(payload?.warUpdates), bootstrapEvents);
    const relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(payload?.relationUpdates), bootstrapEvents);
    const agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(payload?.agreementUpdates), bootstrapEvents);
    const warMerge = applyWarUpdates({
      world: currentWorld,
      updates: warUpdates,
      events: bootstrapEvents,
      stopDate: startDate,
      round: 1,
    });
    const diplomaticMerge = applyDiplomaticUpdates({
      world: warMerge.world,
      relationUpdates,
      agreementUpdates,
      events: bootstrapEvents,
      stopDate: startDate,
      round: 1,
      allowUnboundBaseline: true,
    });
    const storylineMerge = applyWorldStorylineUpdates({
      world: diplomaticMerge.world,
      updates: storylineUpdates,
      events: bootstrapEvents,
      stopDate: startDate,
      round: 1,
    });
    const bootstrapWorld = {
      ...storylineMerge.world,
      diplomaticLedgerVersion: Math.max(Number(diplomaticMerge.world.diplomaticLedgerVersion) || 0, DIPLOMATIC_LEDGER_VERSION),
    };
    console.info(
      `[ai] pregame bootstrap: ${bootstrapEvents.length} event(s), ${storylineMerge.appliedIds.length} storyline(s), ${warMerge.appliedIds.length} war op(s), ` +
      `${diplomaticMerge.appliedRelationIds.length} relation(s), ${diplomaticMerge.appliedAgreementIds.length} agreement(s).`,
    );

    const summary = normalizeString(payload?.summary);
    bootstrapWorld.simulationHistory = [
      {
        catalyst: null,
        date: startDate,
        eventIds: bootstrapEvents.map((event) => event.id),
        fallbackReason: "",
        fromDate: normalizeString(bootstrapEvents[0]?.date) || startDate,
        mode: "pregame",
        plannedActions: [],
        round: 1,
        summary,
        source: "ai",
        storylineIds: [...storylineMerge.appliedIds],
        toDate: startDate,
      },
    ];
    await Promise.all([
      writeEventsState(bootstrapEvents),
      writeWorldState(bootstrapWorld),
    ]);
    return bootstrapEvents;
  } catch (error) {
    // The next open retries; logged because this now seeds the ledgers too.
    console.warn("[ai] pregame bootstrap failed; the next open retries.", error);
    return null;
  } finally {
    endSimulation();
  }
};

// ---- Idle diplomacy drip ----------------------------------------------------
// While the player sits between jumps, the world occasionally speaks first:
// on each real-world-minute tick (the caller's cadence) there is a small chance
// one polity sends a short note to the player's inbox. Hard-suspended while any
// simulation is in flight (busy lock above), never stacked, and silent on any
// failure — there is no canned fallback small talk.
// Raised from 1/20: at 1/20 (with a 60s visible-tab-only roll) a player waited ~20
// idle minutes just to CONSULT the model, and most consulted rolls still returned
// null — so AI-initiated chats felt almost nonexistent. 1/8 keeps a parked tab from
// filling the inbox while making an idle approach actually plausible; the jump-path
// cap (see defaultPrompts.json) remains the primary source of diplomacy.
const IDLE_DIPLOMACY_CHANCE = 1 / 8;
// How often the pulse RUNS at all. Higher than the chat chance because the call
// now also moves the world's forces a little, and the map benefits from breathing
// more often than the inbox does. Splitting the two off one roll keeps the chat
// cadence the player already has exactly as it was while still being ONE request.
const IDLE_PULSE_CHANCE = 1 / 4;
let idleDiplomacyInFlight = false;
// Narrower than idleDiplomacyInFlight above: true only for the half of a pulse
// that actually asks whether a polity would send a note (allowChat). A
// movement-only pulse sets the in-flight guard but not this.
let idleChatPollInFlight = false;

// Whether the model is right now being asked whether a country would reach out
// unprompted. Deliberately NOT true for a jump, a game-master command or an
// advisor exchange: those take the same busy lock and MIGHT emit chats, but only
// a poll whose entire purpose is that question is worth an indicator.
export const isChatGenerationLikely = () => idleChatPollInFlight;

// Apply a pulse's unit ops to the LIVE world. Routed through
// applyEventImpactsToWorld with a synthetic event rather than a hand-rolled
// applier, so the detection gate, the owner-name resolution and the patrol-order
// minting all behave exactly as they do on a real turn.
const applyIdlePulseUnitOps = async (bundle, unitOps) => {
  // Deliberately NOT bundle.world: a jump may have committed while the model was
  // thinking, and writing a world built on the stale snapshot would undo it.
  const freshWorld = await readWorldState({ force: true });
  const tick = (Number(freshWorld.idlePulseTick) || 0) + 1;
  const gameDate = normalizeString(bundle.game?.gameDate);
  const round = Number(bundle.game?.round) || 0;
  const betaUnits = isBetaUnits();

  const { world: impacted } = applyEventImpactsToWorld({
    colors: {},
    events: [{ date: gameDate, title: "", description: "", impacts: { unitOps } }],
    world: freshWorld,
    motion: betaUnits ? { originDate: gameDate, round, tick } : null,
    betaEngine: betaUnits,
  });
  // The classic system has nothing to drift and no cap to enforce — the pulse's
  // ops are the whole of its effect.
  if (!betaUnits) return { ...impacted, idlePulseTick: tick };
  // fromDate === toDate, so no unit travels: the pulse only re-posts standing
  // orders and drifts patrols, which is right when no game time has passed.
  const drifted = advanceStandingOrders(impacted, {
    fromDate: gameDate,
    toDate: gameDate,
    round,
    tick,
  });
  return enforceUnitVolume(
    { ...drifted, idlePulseTick: tick },
    { playerCode: normalizeString(bundle.game?.country) },
  );
};

// One short intelligence report in the event feed, so a build-up the player can
// see on the map also tells them WHY it is there. Only ever written when the
// model judged the movement near enough for their services to have seen it.
const appendSightingEvent = async (bundle, sighting, unitOps) => {
  const events = await readEventsState({ force: true });
  const next = normalizeEvents([
    ...events,
    {
      date: normalizeString(bundle.game?.gameDate),
      title: normalizeString(sighting.title),
      description: normalizeString(sighting.description),
      importance: "minor",
      kind: "intel",
      playerRelated: true,
      notable: false,
      // The event carries the very ops it is reporting. They have already been
      // applied to the world above and nothing re-applies an event's impacts from
      // the log, so this is not a second application — it is what lets the event
      // camera fly to the sighting instead of guessing from the prose.
      impacts: { unitOps },
    },
  ]);
  await writeEventsState(next);
};

export const maybeSendIdleDiplomacy = async ({ chance = IDLE_PULSE_CHANCE } = {}) => {
  if (idleDiplomacyInFlight || isSimulationBusy()) return null;
  const roll = Math.random();
  if (roll >= chance) return null;
  // One call, two rates: the chat half keeps the cadence the player already has,
  // while the movement half runs on every pulse.
  const allowChat = roll < Math.min(chance, IDLE_DIPLOMACY_CHANCE);
  idleDiplomacyInFlight = true;
  idleChatPollInFlight = allowChat;
  try {
    const bundle = await readGameStateBundle({ force: true });
    if (!normalizeString(bundle.game?.country)) return null; // no active game
    const variables = {
      ...(await buildTemplateVariables(bundle)),
      idleChatAllowed: allowChat ? "yes" : "no",
    };
    const openChats = normalizeChats(bundle.chats);
    // The prompt template shows only ONE line per chat (chatSummary: the last
    // message, prefixed by its speaker), and a note sent to a polity the player
    // is already talking to gets APPENDED to that thread. So the model was asked
    // for an opener while its note became a reply, with almost none of the
    // conversation in view — which is how a polity ended up answering a hostile
    // message with an unrelated pleasantry, and how it ended up repeating the
    // player's own line back at them.
    const conversationContext = [
      "",
      "These are the conversations already open with the player, oldest message first:",
      "",
      renderOpenChatsForPrompt(openChats),
      "",
      "A note addressed to a polity the player is ALREADY talking to is appended to that"
      + " conversation, so it must read as the next thing that polity says: answer what was"
      + " actually said, never restate or quote it back, and never open as though the exchange"
      + " were new. If nothing there warrants a reply and no polity has a fresh reason to"
      + " write, return {\"chat\": null}.",
    ].join("\n");
    const { payload } = await runJsonTask("idleDiplomacy", {
      userMessage: allowChat
        ? "A quiet moment between rounds. Decide whether any single polity would send the player a short diplomatic note right now, and whether any forces would visibly move."
          + conversationContext
          + "\n\nReturn JSON only."
        : "A quiet moment between rounds. Decide whether any forces would visibly move right now. Return chat as null. Return JSON only.",
      validatePayload: async (candidate, { finalAttempt } = {}) => {
        if (candidate?.chat == null) return "";
        const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
        if (countries.length === 0) {
          return "$.chat.countries must contain at least one known polity (or chat must be null).";
        }
        // Strict on attempt 1: make the model give the note a title AND a first
        // line, so the player can see why the polity reached out. Salvage on the
        // final attempt — buildGeneratedChat drops an opener-less note rather
        // than posting an empty "mystery" thread.
        return finalAttempt ? "" : validateChatOpener(candidate.chat, "$.chat");
      },
      variables,
    });
    if (!payload) return null;

    // --- movement ---------------------------------------------------------
    const unitOps = normalizeArray(payload.unitOps);
    if (unitOps.length > 0 && !isSimulationBusy()) {
      try {
        const nextWorld = await applyIdlePulseUnitOps(bundle, unitOps);
        // Re-check immediately before the write, exactly as the chat half does:
        // a jump that started while we were applying owns the world now.
        if (!isSimulationBusy()) {
          await writeWorldState(nextWorld);
          if (payload.sighting && !isSimulationBusy()) {
            await appendSightingEvent(bundle, payload.sighting, unitOps);
          }
        }
      } catch (error) {
        // Movement is a bonus; never let it cost the player a diplomatic note.
        console.warn("[ai] idle pulse could not apply unit movement:", error);
      }
    }

    // --- diplomacy --------------------------------------------------------
    if (!allowChat || !payload.chat) return null;
    // A jump may have started while the model was thinking; its state bundle
    // predates our write, so drop the note rather than race the save.
    if (isSimulationBusy()) return null;
    const built = await buildGeneratedChat({ ...payload.chat, source: "outreach" }, "", bundle.world, {
      playerName: bundle.game.country,
    });
    if (!built) return null;
    const chats = normalizeChats(await readChatsState({ force: true }));
    // A note from a country the player already has an open thread with (1:1 or a
    // standing group) lands in that thread; only a genuinely new set of
    // participants opens a fresh chat. Matching 1:1 threads only meant a group
    // approach always opened a duplicate — the participant-set key handles both.
    // dropEchoes discards a note that just repeats what is already in that
    // thread; silence is what this whole path defaults to anyway.
    const nextChats = foldGeneratedChatsIntoStorage(chats, [built], {
      stampTime: normalizeString(bundle.game?.gameDate),
      dropEchoes: true,
    });
    if (nextChats.dropped) return null;
    if (isSimulationBusy()) return null;
    await writeChatsState(nextChats);
    return built;
  } catch {
    return null; // silence is always the safe outcome
  } finally {
    idleDiplomacyInFlight = false;
    idleChatPollInFlight = false;
  }
};

// Clearer name for what this now does. The old export stays because main.jsx
// imports it dynamically and the docs reference it by name.
export const maybeRunIdlePulse = maybeSendIdleDiplomacy;
