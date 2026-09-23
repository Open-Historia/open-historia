/*! Open Historia — portions (briefing dossiers + timeout/fallback hardening) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { callAI, providerSupportsBatch, retrieveAIBatch, sendDiplomaticMessageOnceOff, submitAIBatch } from "./main.jsx";
import { jumpDayStep, jumpTargetDate } from "../../runtime/jumpDates.js";
import { describePuppetBriefing, puppetBriefingFor } from "../../runtime/puppets.js";
import { answerableDemandOf, demandCheckContext, demandCheckPrompt, interpretDemandCheck, openDemandOf } from "../../runtime/demandCheck.js";
import { NATIVE_GAME_MASTER_PROMPT, normalizePromptPack } from "./gameplayPrompts.js";
import { collectFoundedPolities, foundingPolityChange } from "../../runtime/polityFounding.js";
import { TERRITORY_BASIS_DIRECTIVE, describeBasisAction, screenTerritoryBasis } from "../../runtime/territoryBasis.js";
import {
  createApplicationReceipt,
  firstComplaintLine,
  mergeReceipts,
  noteMalformedImpacts,
  noteReceipt,
  renderLastTurnReceipt,
  tallyAppliedEvents,
  withReceiptDraft,
} from "../../runtime/applicationReceipt.js";
import { buildUnitDirectorInput, directGeneratedUnitOps } from "./nativeUnitDirector.js";
import { buildTerritoryDirectorInput, directGeneratedTerritoryOps } from "./nativeTerritoryDirector.js";
import { buildStructureDirectorInput, directGeneratedStructureOps } from "./nativeStructureDirector.js";
import {
  buildPlayerFocusDirective,
  collectPlayerMaterial,
  combinedShares,
  createPlayerEventTest,
  createSpareTest,
  normalizePlayerFocus,
  playerFocusShortfall,
  settleOrders,
  slipPassedMilestones,
  trimWorldForFocus,
} from "./playerFocus.js";
import { expandWholeCountryTransfer, wholeCountrySourceToken } from "./territoryTransferScope.js";
import {
  detectExplicitBaseTerritoryScope,
  requestDemandsExhaustiveTerritorialScope,
  resolveGameMasterBaseGeographyScope,
  scopeContainsRegion,
} from "./gmTerritoryScope.js";
import { buildCuratorInput, candidatesWorthJudging, curateGeneratedEventsWithHidden } from "./nativeTimelineCurator.js";
import {
  applyWorldStorylineUpdates,
  boardProvisionalConsequenceIndexes,
  assessRecentWorldConsequenceLiveness,
  bindNewStorylineEvents,
  bindSelectedStorylineEvents,
  buildWorldInitiativeContext,
  createMotionRepairBudget,
  decodeWorldStorylineUpdates,
  describeAntiStasisObjectiveRule,
  findSkipStorylineMotionIssues,
  mergeSkipAttentionStorylines,
  motionRepairSkipReason,
  motionRepairTimeRemainingMs,
  normalizeWorldStorylineEventLinks,
  settleMotionRepairCall,
  settleSkipStorylineUpdates,
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
import { validatePoliticalImpactCompleteness } from "./politicalImpactCompleteness.js";
import { POLITICAL_TRAIT_KEYS } from "../../runtime/politicalTraitRegistry.js";
import {
  applyPoliticalActorOperation,
  POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE,
  validatePoliticalActorOperationShape,
} from "../../runtime/politicalActorOps.js";
import { buildPromptFingerprint, isContextDiagnosticsEnabled, logContextDiagnostics, resolveTemplateVariableDemand } from "./contextDiagnostics.js";
import {
  SEGMENTED_JUMP_MIN_DAYS,
  buildSegmentInstruction,
  eventCountRangeForDays,
  formatDurationLabel,
  mergeSegmentPayloads,
  planJumpSegments,
  segmentEventRange,
} from "./jumpSegments.js";
import { UNIT_CONTRACT_MARKER, collapseRepeatedWorldContext, templateAlreadySays } from "./promptDedupe.js";
import {
  HIGH_PRIORITY_ASSESSMENT_MARKER,
  HIGH_PRIORITY_ASSESSMENT_RULE,
  buildBoardPassDirective,
  buildJumpProjectsDirective,
} from "./projectsDirective.js";
import { extractJsonPayload, unwrapMimickedToolCall } from "./jsonSalvage.js";
import { isChatVisibleTo, withoutPlayerParticipant } from "./chatVisibility.js";
import { SIMULATION_AUDIENCE } from "./audience.js";
import { buildTargetStatsTerritorialBasisKernel } from "./countryStatsWorkerKernel.js";
import { IO_CONFIG, IO_REQUEST, serveWorkerIo } from "./runtimeIoBridge.js";
import {
  decodeGameMasterTransportPayload,
  decodePregameHistoryTransportPayload,
  getGameplayTool,
  getGameplayToolForCustomStatSheet,
  getGameplayToolForStatIndices,
  normalizeGameplayPayload,
  validateGameplayPayload,
} from "./gameplaySchemas.js";
import { buildOwnerAliasMap, canonicalOwnerName, toCountryName } from "../../runtime/ownerNames.js";
import { editDistance, foldRegionKey, matchRegionName, stripRegionAffixes } from "./regionMatch.js";
import { PLACEMENT_DIRECTIVE, distanceKm as placementDistanceKm, nearestInteriorPoint, pointInGeometry, resolvePlacement, resolveRegionPlacement } from "./placement.js";
import { FOOTPRINT_KM, obstaclesOf, spaceOut } from "../../runtime/featureSpacing.js";
import { LOOKUP_DIRECTIVE, LOOKUP_TOOLS, buildLookupContext, executeLookup, placesNamedIn } from "./lookupTools.js";
import {
  BACKGROUND_REQUEST,
  backgroundAiAllowance,
  createJumpBudget,
  jumpRequestCap,
  requestLedger,
  requestSettings,
  savingRequests,
} from "./requestBudget.js";
import { describeSchemaRemoval, salvageBySchema } from "./schemaSalvage.js";
import {
  TURN_REVIEW_TASK,
  buildTurnReviewPrompt,
  buildTurnReviewTool,
  readTurnReviewAnswer,
  remapBoardOps,
  shareRepeatedBlocks,
} from "./turnReview.js";
import {
  describeDoubtedForPrompt,
  doubtedAwaitingFreshSource,
  spyIntelDoubtOps,
  spyOperationOps,
  boardPassCarriers,
  boardPassReasons,
  isProjectOpen,
  materiallyChangedEntryIds,
  spyProvenanceOps,
  unassessedHighPriorityEntries,
} from "../../runtime/projects.js";
import { activeSpies, applySpyOps, espionageBrief, intelligenceOf, isIntelligenceRated, normalizeIntelligenceRating, normalizeIntercepts, normalizeSpies, redactText, resolveEspionage, signalClarity } from "../../runtime/spycraft.js";
import { buildSpyOrdersDirective } from "./spyOrdersDirective.js";
import { echoesExistingMessage, renderOpenChatsForPrompt } from "../../runtime/chatEcho.js";
import { isSeal, newSeal, newSpyReportId, openExchange, openPoliticalAssessment, sealExchange, sealPoliticalAssessment } from "../../runtime/spySeal.js";
import {
  buildActionHistoryText,
  buildChatSummaryText,
  buildDetailedChatHistoryText,
  buildEventHistoryText,
  buildPromptContext,
  filterToRenderedRegions,
  formatDateReadable,
  getUnconsolidatedEvents,
  resolveHelperValues,
} from "./promptContext.js";
import {
  applyHistoryDocumentUpdate,
  buildHistoryDocumentDirective,
  countWords,
  planHistoryConsolidation,
} from "./historyConsolidation.js";
import {
  expandBakedRegionsForRename,
  renamePolityInActions,
  renamePolityInChats,
  renamePolityInFlags,
  renamePolityInGame,
} from "../../../server/polityRename.js";
import { renderTemplateCached, staticPrefixEndOf } from "./promptLayout.js";
import { attachAttemptOutcome, finishAiRecord, normalizeParsedSummary } from "./telemetry.js";
import {
  JSON_URLS,
  getNationFlags,
  getPrimedScenarioRegionCatalog,
  loadCountryNames,
  loadRegionCatalog,
  loadScenarioRegionCatalog,
  primeCustomRegionCatalog,
  primeCustomRegionCatalogEntries,
  readJson,
  writeJson,
} from "../../runtime/assets.js";
import {
  advanceStandingOrders,
  applyEventImpactsToWorld,
  applyProjectOpsToWorld,
  confirmResolvedDeployments,
  linkStructuresToProjects,
  enforceUnitVolume,
  readInterceptsState,
  writeInterceptsState,
  normalizeActionEntry,
  normalizeEventEntry,
  normalizeActions,
  normalizeChatEntry,
  chargeRefusals,
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
  viewAsSeen,
  writeActionsState,
  writeChatsState,
  writeEventsState,
  writeGameData,
  writeWorldState,
  writeCanonicalTurnState,
} from "../../runtime/gameState.js";
import { advancePoliticalBackgroundSimulation } from "../../runtime/politicalBackground.js";
import { dedupeGeneratedEvents, eventCanonicalKey } from "../../runtime/eventDedup.js";
import {
  ACTION_OUTCOME_ASSOCIATION_SCHEMA,
  ACTION_OUTCOME_ASSOCIATION_TOOL,
  applyActionOutcomeAssociations,
  buildActionOutcomeAssociationPlan,
  normalizeActionOutcomeAssociationAnswer,
  validateQueuedActionIds,
} from "./actionOutcomeAssociations.js";
import { allocateCanonicalTurnEventIds, remapLedgerEventIds } from "../../runtime/eventIdentity.js";
import { sortTimelineEventsChronologically } from "../../runtime/timelineOrder.js";
import { buildPolityIdentityIndex, resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import {
  applyWarUpdates,
  bindWarUpdatesToEvents,
  buildCanonicalWarContext,
  decodeWarUpdates,
  normalizeWorldWarEventLinks,
  reconcileCombatWarState,
  repairWarLedgerPayload,
  validateCanonicalWarEvents,
  validateWarLedgerPayload,
} from "./nativeWarLedger.js";
import {
  DIPLOMATIC_LEDGER_VERSION,
  applyDiplomaticUpdates,
  applyPuppetUpdates,
  bindPuppetUpdatesToEvents,
  revealPuppetsToSpies,
  puppetUpdatesFromCanonical,
  decodePuppetUpdates,
  bindAgreementUpdatesToEvents,
  bindRelationUpdatesToEvents,
  buildBoundedDiplomaticContext,
  decodeAgreementUpdates,
  decodeRelationUpdates,
  migrateLegacyDiplomaticState,
  salvageDiplomaticLedgerPayload,
  validateDiplomaticLedgerPayload,
} from "./nativeDiplomaticDirector.js";
import {
  appendCountryStatHistorySample,
  buildCompactEconomicContext,
  captureCountryStatsHistory,
  COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
  COUNTRY_STATS_TRACKING_MAX_POLITIES,
  countryStatsTrackingMonthsElapsed,
  finalizeCountryStatSheet,
  guardCountryStatContinuity,
  isCompleteCountryStatSheet,
  isCompleteCustomCountryStatSheet,
  mergeCountryStatPatch,
  normalizeCountryStatSheet,
  normalizeCountryStatsTracking,
  normalizeCountryStatsMacroEstimate,
  resolveCountryStatsPopulationCalibration,
  decodeTerritorialComponentSplit,
  expandTerritorialMacroEstimates,
} from "../../runtime/countryStats.js";
import {
  DEFAULT_STAT_INDEX_ROWS,
  describeStatIndexRows,
  describeStatSheetDefinition,
  flattenStatSheetRows,
  loadStatIndexDefinition,
  loadStatSheetDefinition,
  normalizeCustomStatValues,
  statSheetKeys,
} from "../../runtime/statsSheet.js";
import { beginTurnPerfStage, endTurnPerfStage, measureTurnPerfStage, recordTurnPerfAiAttempt } from "../../runtime/turnPerf.js";
import { difficultyDirective } from "../../runtime/difficulty.js";
import { MAP_SETTING_KEYS, getMapSetting, getMapSettingDefaultOn } from "../../runtime/mapSettings.js";
import { AI_FIRST_BYTE_TIMEOUT_MS, AI_IDLE_TIMEOUT_MS, createIdleDeadline } from "./idleDeadline.js";
import { REPAIR_STOP_TIME_BUDGET, runBoundedRepairCall } from "./repairCall.js";
import { isDebugLogVerbose, logDebugEvent } from "../../runtime/debugLog.js";
import { isFallbackListConfigured } from "./providerConfig.js";
import { assertCampaignUnchanged } from "../../runtime/campaignGuard.js";
import { getLibraryState } from "../../runtime/library.js";
import { getActivePlayerFocus, getActiveWorldDirection, idleDiplomacyChancePerMinute, isActiveFeatureEnabled } from "../../runtime/gameFeatures.js";
import { describeIntervention, journalTurn, truncateTurn } from "./intervene.js";
import { applyChatActionBatch, describeChatActionFeedback } from "./chatActions.js";
import { partitionInstitutionChatActions } from "./institutionChatActions.js";
import { parseInstitutionLifecycleResponsesJson, partitionInstitutionLifecycleChatActions } from "./institutionLifecycleChatActions.js";
import { commitInstitutionalChatGovernanceBatch, commitInstitutionalDiplomaticReply } from "../../runtime/institutionalGovernance.js";
import { ensureInstitutionalChannel } from "../../runtime/institutionalChannels.js";
import { autonomousInstitutionBallotDirective, collectAutonomousInstitutionBallotWork } from "./institutionAutonomy.js";
import { buildIdleInstitutionRoutingContext, resolveIdleInstitutionRoute } from "./institutionIdleRouting.js";
import {
  buildIdleDiplomacyPoliticalDecisionSet,
  idleDiplomacyPoliticalContextText,
  idleDiplomacySpeakerHasContext,
} from "./idlePoliticalDiplomacyContext.js";
import {
  advanceInstitutionLifecycleCore,
  applyInstitutionLifecycleImpactBatchCore,
  buildInstitutionLifecycleDecisionContext,
  commitInstitutionLifecycleChatBatch,
} from "../../runtime/institutionLifecycle.js";
import { resolveInstitutionRecord } from "../../runtime/institutions.js";
import { gmChangesForRound, normalizeReminders, recordGmChange, renderGmChangeNarration, renderReminders } from "../../runtime/gmChanges.js";
import { describeGoalForSimulation, describeGoalForSuggestions, playerGoalOf } from "../../runtime/playerGoal.js";
import { createSkipPhases, describeReviewJobs, formatSkipPhases } from "./skipPhases.js";
import { createStreamedEventReader } from "./streamedEvents.js";
import { deliveryEventId, documentExchange, documentNote, documentNotices, isDocumentExchange, markIntercepted, planReportDeliveries, withoutOrphanedDocuments, withoutOrphanedNotices } from "../../runtime/reportDelivery.js";
import { unseenEvents, withoutUnseenMessages } from "../../runtime/unseenEvents.js";
import { canRewindInteractiveTo, isSceneInProgress, openInteractive, recordInteractiveBeat, rewindInteractive } from "./interactiveRewind.js";
import { chooseInteractiveOffer, offeredEvent } from "../../runtime/interactiveOffer.js";
import { buildCrossChatKnowledge } from "./crossChatKnowledge.js";
import { buildBoundedPoliticalDecisionContextSet } from "./politicalDecisionContext.js";
import {
  getPoliticalProfile,
  getPoliticalProfileKey,
  normalizePoliticalActorRecord,
} from "../../runtime/politicalActors.js";
import { normalizePoliticalIntelligenceAssessment } from "../../runtime/politicalKnowledge.js";
import { buildFutureHistoryBoundaryDirective } from "./futureHistoryBoundary.js";
import {
  eventsFromLegacyChat,
  normalizeChatEvents,
  projectChatThread,
  threadAsSeenBy,
} from "../../runtime/chatThreads.js";
import { REPORT_VOICE_DIRECTIVE, describeReportsForPrompt, normalizeReportOp } from "../../runtime/reports.js";
import {
  applyTerritoryTempo,
  buildScriptedEventsInstruction,
  buildWorldDirectionDirective,
  dateKey,
  ensureScriptedEvents,
  parseScriptedEvents,
  scriptedBeatsInSpan,
  worldShareShortfall,
} from "./worldDirection.js";
import { addGameDays, compareGameDates, diffGameDays, gameDateDayNumber, normalizeGameDate, parseGameDate } from "../../runtime/gameDates.js";
import {
  NO_RESPONSE_BODY_NOTE,
  beginSimulation,
  discardPendingJumpSegment,
  discardPendingProjectsJump,
  endSimulation,
  getPendingJumpSegment,
  getPendingProjectsJump,
  isSimulationBusy,
  setChatGenerationInFlight,
  setPendingJumpSegment,
  setPendingProjectsJump,
} from "./simulationStatus.js";

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

// Game dates in any year — a year before AD 1 carries a leading minus and
// counts backwards with no year zero (runtime/gameDates.js). Never compare two
// dates as strings: "-0218" sorts before "-0300" as text, and 218 BC comes
// after 300 BC.
const parseIsoDate = parseGameDate;
const addIsoDays = addGameDays;

export const validateTimelineDates = ({ candidate, mode, originDate, targetDate, requireAdvance = false }) => {
  const stopDate = normalizeString(candidate?.stopDate);
  if (!parseIsoDate(originDate)) {
    const eventDates = normalizeArray(candidate?.events).map((event) => normalizeString(event?.date));
    const outputDates = [stopDate, ...eventDates];
    const malformedIsoIndex = outputDates.findIndex((date) => /^-?\d{1,6}-\d/.test(date) && !parseIsoDate(date));
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
        if (compareGameDates(eventDates[index], stopDate) > 0) return `$.events[${index}].date must not be later than ${stopDate}.`;
        if (previousDate && compareGameDates(eventDates[index], previousDate) < 0) return `$.events[${index}].date must not precede the previous event date.`;
        previousDate = eventDates[index];
      }
    }
    return "";
  }
  if (!parseIsoDate(stopDate)) return `$.stopDate must be a real date in YYYY-MM-DD format; received ${stopDate || "an empty value"}.`;
  if (mode === "auto") {
    if (compareGameDates(stopDate, originDate) <= 0 || compareGameDates(stopDate, targetDate) > 0) {
      return `$.stopDate must be after ${originDate} and no later than ${targetDate}.`;
    }
  } else if (compareGameDates(stopDate, targetDate) !== 0) {
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
    if (compareGameDates(eventDate, originDate) < 0 || compareGameDates(eventDate, stopDate) > 0) {
      return `$.events[${index}].date must be on or after ${originDate} and no later than ${stopDate}.`;
    }
    if (compareGameDates(eventDate, previousDate) < 0) return `$.events[${index}].date must not precede the previous event date.`;
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
  if (!parseIsoDate(originDate)) return; // prose-dated scenarios ("Third Age 3019") use the lenient branch
  let stopDate = normalizeString(candidate?.stopDate);
  if (mode === "auto") {
    if (!parseIsoDate(stopDate) || compareGameDates(stopDate, originDate) <= 0 || compareGameDates(stopDate, targetDate) > 0) stopDate = targetDate;
  } else {
    stopDate = targetDate;
  }
  candidate.stopDate = stopDate;
  // Mirrors validation: on-or-after the origin is in-window for every jump
  // length, so strays dated before the origin pull up to the origin itself.
  const floor = compareGameDates(originDate, stopDate) > 0 ? stopDate : originDate;
  let previous = floor;
  for (const event of normalizeArray(candidate?.events)) {
    if (!event || typeof event !== "object") continue;
    let date = normalizeString(event.date);
    if (!parseIsoDate(date)) date = stopDate;
    if (compareGameDates(date, originDate) <= 0) date = floor;
    if (compareGameDates(date, stopDate) > 0) date = stopDate;
    if (compareGameDates(date, previous) < 0) date = previous;
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
- IF YOU WRITE FIGHTING, OPEN THE WAR IN THE SAME ANSWER. An event that narrates a battle, an offensive, an incursion, a bombardment, a siege or a front must name both sides in event.combatants and carry the warId of a war this ledger already holds, or of one your own warUpdates record starts in this same payload. A fight with no war behind it is not kept as a war: the engine strips its warId and its combatants, the belligerency never happens, and the campaign ends up reading like a war while recording peace - no fronts, no captures, nobody losing anything. If two sides are genuinely trading blows, that IS a war and it is yours to declare; if you cannot name who is fighting whom, then what you are describing is unrest, a raid or a deployment, so write it as that instead.
- ${playerName} may not be JOINED to a war on their behalf merely because history or alliance logic suggests it: entering a war is the player's own commitment, and the player-agency rules control it. Another power DECLARING war on ${playerName} is the opposite case and is entirely yours to write - it is that power's decision, not the player's - provided the causal event narrates it the way this ledger requires of anyone.
- warUpdates is compact text, one record per line, fields separated by ~ (never use ~ inside a field):
  warId~op~actorsCSV~opponentsCSV~eventNumbersCSV~note
  ops: start | join-a | join-b | leave | ceasefire | resume | end
  For start, actorsCSV is side A and opponentsCSV is side B; for join-a/join-b/leave, actorsCSV names the polities joining or leaving. eventNumbersCSV is the 1-based number of the event that establishes the transition and may be blank: the engine binds from warId and the transition's own wording. Use a stable, descriptive warId (e.g. war-france-germany-1914) and reuse it for later lifecycle records.
- Return warUpdates:"" when belligerency does not change in this pass.`;
};

const buildDiplomaticLedgerDirective = (variables) => {
  const playerName = normalizeString(variables?.playerPolity) || "the player's polity";
  // A scenario may switch subordination off entirely (server/gameFeatures.js).
  // The simulator is then never told the contract exists, which is what stops it
  // quietly making one country another's puppet: the ledger would refuse the
  // line anyway, and a model told to emit one it cannot have is a model writing
  // events the world never records.
  const puppetStates = isActiveFeatureEnabled("puppetStates");
  const puppetContract = puppetStates ? `- puppetUpdates is compact text, one record per line, for a SUBORDINATION - one polity directing another's will while it remains a separate country holding its own territory and its own sovereignty:
  op~overlord~puppet~kind~loyalty~secrecy~eventNumbersCSV~note
  ops: install (create) | reclassify (change kind) | loyalty (move the score) | reveal (covert becomes open, permanently) | release (the overlord lets go) | annex (absorbed) | revolt (thrown off) | suppress (a rising CRUSHED - the overlord holds on, loyalty is forced up at gunpoint, and the overlord's reputation should fall with it). kind is one of protectorate (keeps internal rule, surrenders foreign policy) | satellite (keeps formal sovereignty, loses real independence) | client (bought or installed government); it states WHICH POWERS the overlord holds, not how tightly, so use reclassify rather than treating the three as a scale. loyalty is 0-100, how far the puppet accepts direction - move it when the period earned it, never merely because time passed. secrecy is open (the arrangement is publicly known, as a signed protectorate is) or covert (only the two parties know). Only install needs kind/loyalty/secrecy; the rest may leave them blank.
  A puppet may hold no puppets of its own: installing one over a polity that already has them moves those to the new overlord automatically. A polity has at most one overlord, and reveal cannot be undone.
  Coup model: a puppet whose loyalty has collapsed has a hidden storyline building against it, and YOU decide whether and when that breaks. A rising may succeed (emit revolt) or be put down (emit suppress); either is a real outcome and neither is owed to the player. Before it breaks, unrest should be VISIBLE to an overlord who has the means to see it - if the overlord has an agent inside the puppet or a strong intelligence service, return a timeline event reporting the unrest, so the warning is bought rather than given. A puppet at high loyalty does not revolt.
  Puppet decision model: a Puppet is a SEPARATE COUNTRY with its own interests, not a possession. It may refuse what its overlord demands, and loyalty is the prior for how likely that is, never a veto. Annexing one's own Puppet meets far less resistance than conquering a foreign power, and a Puppet at high loyalty may accept absorption outright - and the standing it costs the overlord is applied for you - do not emit a polityChanges reputation drop for it as well, or it is paid twice. Likewise a puppet REFUSING its overlord's demand in conversation is charged its loyalty cost for you, once, by the engine: narrate what follows from the refusal as you see fit, but do not also emit a loyalty line for the refusal itself, or it is paid twice. Move loyalty for everything else the period brought. A covert Puppet must speak and act as a fully independent country toward anyone not party to the arrangement.
` : "";
  const canonicalDiplomacy = normalizeString(variables?.canonicalDiplomaticContext);
  // The Native World Director context (jump tasks) already carries this slice —
  // its CANONICAL DIPLOMATIC STATE section, built from the same ledger for the
  // same segment, with the attention storylines' participants added. Rendering
  // it here too sent every jump request the same relations twice, about five
  // thousand characters; point at that copy instead. Prompts without the
  // director (idle diplomacy, the pregame bootstrap) keep their own.
  const sliceInDirector = normalizeString(variables?.worldInitiativeContext).includes("CANONICAL DIPLOMATIC STATE");
  const state = sliceInDirector
    ? "The bounded relevant slice of this ledger — attention actors, bilateral relations, formal agreements — is the CANONICAL DIPLOMATIC STATE section of the Native World Director context above; it is not repeated here."
    : (canonicalDiplomacy || "No canonical bilateral relations or formal agreements are recorded yet.");
  return `[Canonical Diplomatic Ledger]
${state}

Lasting bilateral political shifts use top-level relationUpdates; signed, ratified or concluded formal treaties, alliances, guarantees and pacts use top-level agreementUpdates. polityChanges remains for polity metadata and reputation, regionTransfers for legal territorial settlements, and unitOps for concrete military coordination. A.I.-controlled polities have their own diplomacy and may negotiate, threaten, align, mediate, trade or make agreements among themselves without waiting for ${playerName}; private A.I.-to-A.I. diplomacy belongs in the TIMELINE as events, never in a chat the player is not part of.

Relation decision model: a canonical bilateral relation score/status is persistent political climate, not decoration. Use it as a strong prior for A.I. trust, threat interpretation, bargaining posture, willingness to cooperate or compromise, tolerance of strategic risk and severity of reaction. It is NOT a hard acceptance probability or veto: national interest, formal obligations, geography, relative power, domestic constraints, reputation and the concrete proposal remain independent causes, so a friendly government may reject a dangerous demand and a hostile one may cooperate under necessity. Formal agreements, bilateral warmth and actual war are separate facts: a strained ally may still owe treaty duties; friendly states without a treaty have promised nothing; hostility alone does not create belligerency. When a NEW event materially changes a bilateral climate, emit a relationUpdates record with the new ABSOLUTE score bound to that event; never drift scores merely because time passed, and let the same foreign action provoke different responses from a trusted partner than from a distrusted rival.

- relationUpdates is compact text, one record per line, fields separated by ~ (never use ~ inside a field):
  A~B~score~status~eventNumbersCSV~summary
  score is the new absolute score from -100 to 100; status is one of friendly | cordial | neutral | cautious | strained | hostile | rival (blank derives it from the score); eventNumbersCSV is the 1-based number of the causal event and may be blank (the engine binds the one event that matches).
- agreementUpdates is compact text, one record per line:
  agreementId~op~type~partiesCSV~eventNumbersCSV~title~terms
  ops: start | update | suspend | resume | end | expire. type is one of alliance | mutual_defense | guarantee | non_aggression | friendship_consultation | trade_economic | military_cooperation | military_access | neutrality | peace_settlement | other. Use a stable, descriptive agreementId (e.g. franco-russian-alliance-1894) and reuse it for later lifecycle records; every record needs a real causal event in this response, and only start needs the full type/parties/title.
${puppetContract}- Return relationUpdates:"" and agreementUpdates:""${puppetStates ? ' and puppetUpdates:""' : ""} when nothing material changes.`;
};

const IDLE_RELATION_DECISION_MODEL = `[Diplomatic Relation Decision Model]
Treat the canonical bilateral relation score/status as a strong prior for diplomatic tone and willingness to initiate contact. Friendly relations make reassurance, congratulations, candid consultation, alliance follow-up and commercial feelers more plausible; strained or hostile relations make protests, warnings, guarded clarification, counter-balancing or silence more plausible. This is not a hard threshold: current interests and events still decide whether anybody has a real reason to write.`;

const buildPregameBootstrapDirective = (variables) => {
  // With the system off, round zero may not seed a subordination either: a
  // scenario cloned with the feature switched off must not start with puppets
  // the rest of the game cannot see, change or end.
  const puppetStatesBootstrapKind = isActiveFeatureEnabled("puppetStates")
    ? `- puppet:open | puppet:covert: polities=[overlord, puppet], category (puppet kind: protectorate | satellite | client - which powers the overlord holds, not how tightly), score (the puppet's loyalty to its overlord, 0-100), detail (how it came about). A polity whose will another directs while it remains a separate country, holding its own territory - a Slovakia under Germany, a Manchukuo under Japan. open if the world knows of it; covert only if it is genuinely secret. One overlord per puppet, and a puppet holds no puppets of its own. Only arrangements standing on the start date.
`
    : "";
  const roundOneDate =
    normalizeString(variables?.pregameStartDate) ||
    normalizeString(variables?.dateReadable) ||
    normalizeString(variables?.date) ||
    "the game start date";
  const vocabulary = normalizeString(variables?.pregameCanonicalPolityVocabulary) || "No current polity vocabulary was available.";
  return `[Round-Zero World Bootstrap Contract]
This ONE pregameHistory response writes bounded history strictly BEFORE ${roundOneDate} and compiles the belligerency and diplomacy ALREADY TRUE at Round 1 into the canonical war, relation and agreement ledgers. It is not a future-history scheduler.

PROVIDER TRANSPORT
The submit_pregame_history function declaration is deliberately shallow. Return exactly these tool fields:
- eventsJson: a STRING containing the JSON array of chronological pre-game event objects.
- summary: the one-paragraph era summary as normal text.
- canonicalUpdatesJson: a STRING containing the JSON array of Day-One canonical-state facts. Use [] only when none qualify.
Native code decodes both JSON strings immediately and validates the resulting events and canonicalUpdates against the full internal schema before any Round-Zero state is accepted. Do not return events or canonicalUpdates as direct top-level tool fields.

CANONICAL ENVELOPE
The objects encoded inside canonicalUpdatesJson are canonicalUpdates. Every item uses the same flat required fields; fill the fields a kind does not use with "", [] or 0.
Kinds:
- relation: polities=[A,B], score (absolute, -100..100), detail (summary).
- storyline:active | storyline:dormant: id (stable, e.g. storyline-<slug>), polities (participants), pressure (0-100, unresolved stakes), momentum (0-100, current rate of change), date (when the process began, YYYY-MM-DD), category (process kind: crisis, revolution, diplomacy, politics, economy, insurgency...), title, detail (state: what is true now and why it is unresolved). One per unresolved multi-turn process still alive at Round 1 that is NOT itself a live war; the engine mirrors every live war into a storyline on its own.
- war:start | war:join-a | war:join-b | war:leave | war:ceasefire | war:resume | war:end: id, polities (actors / side A), opponents (side B), detail (note). Every war still live at Round 1 begins with a war:start, and the pre-game event that started it carries the same event.warId.
- agreement:start: id, polities (parties), category (agreement type: alliance | mutual_defense | guarantee | non_aggression | friendship_consultation | trade_economic | military_cooperation | military_access | neutrality | peace_settlement | other), title, detail (terms). Only agreements still in force on the start date; instruments that already ended belong in the backstory only.
${puppetStatesBootstrapKind}Never output relation status or event indexes/ids; the engine owns those.

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

Do not duplicate canonical state already present. Return canonicalUpdatesJson:"[]" only when no qualifying Day-1 canonical state exists.

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

  // Subordinations already standing on the start date (puppet:open / puppet:covert).
  const puppetUpdates = isActiveFeatureEnabled("puppetStates")
    ? puppetUpdatesFromCanonical(candidate.canonicalUpdates)
    : [];

  const expanded = { ...candidate, storylineUpdates, warUpdates, relationUpdates, agreementUpdates, puppetUpdates };
  delete expanded.canonicalUpdates;
  return expanded;
};

// Why an event the simulator wrote is not on the timeline, in words it can act
// on (runtime/applicationReceipt.js). Two different fates share this: a rejection
// (it never happened) and a canonical event judged too routine to show. Either
// way the record the simulator is shown next turn does not contain it.
const WITHHELD_ROUTE_WORDS = Object.freeze({
  NON_BELLIGERENT_WARTIME_CAUSALITY: "rejected as impossible in this world",
  UNSUPPORTED_REVERSAL: "rejected because it contradicts the established record",
  EXACT_DUPLICATE: "a restatement of an event already on the record",
  EVIDENCED_REDUNDANCY: "a restatement of an event already on the record",
  RETRIEVAL_ASSISTED_REDUNDANCY: "a restatement of an event already on the record",
  NATIVE_PROCESS_FILLER: "process with no concrete outcome — report what changed, not that work continued",
  LOW_VALUE_INCREMENTAL_CHURN: "an increment too small to record",
  ROUTINE_MILITARY_NO_DELTA: "routine military activity that changed nothing",
  ROUTINE_MILITARY_PRECURATION: "routine military activity that changed nothing",
  ROUTINE_ADMINISTRATIVE_PROCESS: "routine administration with no concrete outcome",
  SATURATED_ROUTINE_MILITARY_CHURN: "one more routine military update on a thread that already had several",
  SATURATED_INCREMENTAL_REDUNDANCY: "one more small update on a thread that already had several",
  LOW_TRAJECTORY_FEED_SATURATION: "one more low-consequence update on a thread that already had several",
});
const WITHHELD_ROUTES_WITH_REASON = new Set(["NON_BELLIGERENT_WARTIME_CAUSALITY", "UNSUPPORTED_REVERSAL"]);

const describeWithheldEvent = (row) => {
  const title = normalizeString(row?.title || row?.event?.title) || "(untitled)";
  const route = normalizeString(row?.route);
  const reason = normalizeString(row?.reason);
  const words = WITHHELD_ROUTE_WORDS[route] || reason || "kept off the timeline";
  const detail = WITHHELD_ROUTES_WITH_REASON.has(route) && reason ? `: ${reason}` : "";
  return `"${title}" — ${words}${detail}.`;
};

// One jump segment's ledger records, checked against the world as the earlier
// segments left it. Strict while a retry remains (the model gets the exact
// error), salvaged on the final attempt: an ambiguous combat event is dropped
// together with the war record only it established, rather than the whole
// segment going to the fallback. Ends by binding every record to this
// segment's event ids, which is what lets mergeSegmentPayloads concatenate.
const validateSegmentLedgers = (candidate, { world, strict, segmentIndex = 0, receipt = null }) => {
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
    // What FAILS CLOSED here is the belligerency, not the event. This used to
    // delete the whole event, and a live run showed what that costs: "Tragic
    // Clashes and Fire in Odessa" and "Explosion Rocks Regional Administration
    // Building in Luhansk" — real, dated, consequential events the model wrote
    // and the player never saw, because a riot and a bombing read as hard combat
    // to the detector and neither named two belligerents. Under salvage-first
    // there is no second attempt to correct them, so the loss was permanent.
    //
    // Now the event stays as narrative and loses only what it could not support:
    // its warId and its combatants. No war is created, no ledger record binds to
    // it, and nothing about the canonical war state is guessed — which is the
    // whole point of the guard. The same rule reconcileCombatWarState already
    // applies to a non-combat event carrying an impossible warId.
    const unboundIndexes = new Set(combatWarRepair.unresolved.map((entry) => entry.index));
    // A war record is causal with the event that established it: if every
    // establishing event of a record is being unbound, the record goes too.
    const boundBefore = decodeWarUpdates(candidate?.warUpdates);
    const orphaned = new Set();
    boundBefore.forEach((update, updateIndex) => {
      const eventIndexes = normalizeArray(update?.eventIndexes)
        .map(Number)
        .filter((index) => Number.isInteger(index) && index >= 0);
      if (eventIndexes.length && eventIndexes.every((index) => unboundIndexes.has(index))) orphaned.add(updateIndex);
    });
    for (const entry of combatWarRepair.unresolved) {
      noteReceipt(
        receipt,
        "adjusted",
        `"${normalizeString(entry?.title) || `event ${Number(entry?.index) + 1}`}" — kept, but its war link was removed: it narrated combat that could not be tied to a war (${firstComplaintLine(entry?.reason, 90) || "no matching war"}). `
          + "The event stands as history; nothing about the war ledger was assumed from it. Combat that IS part of a war needs event.combatants naming both sides plus a matching warUpdates record.",
      );
    }
    candidate.events = normalizeArray(candidate.events).map((event, index) => (
      unboundIndexes.has(index) && event && typeof event === "object"
        ? { ...event, warId: "", combatants: [] }
        : event
    ));
    if (orphaned.size) candidate.warUpdates = boundBefore.filter((_, index) => !orphaned.has(index));
    console.warn(
      `[ai] war ledger salvage: unbound ${unboundIndexes.size} hard-combat event(s) from the war ledger and dropped ${orphaned.size} orphaned war record(s) ` +
      "after the model failed its corrective retry; the events themselves are kept.",
    );
    normalizeWorldWarEventLinks(candidate);
    warError = validateWarLedgerPayload(candidate, { world });
  }
  if (warError && !strict) {
    // The last attempt: the model was told what was wrong and still could not
    // bind its war record, and a finished segment is not lost to that. The
    // record's own event numbers are stamped onto their events as the warId
    // they declare; what still cannot bind is dropped with the events' war
    // bindings, and the events stay as narrative (repairWarLedgerPayload).
    const first = warError;
    const repair = repairWarLedgerPayload(candidate, { world });
    const summary = `stamped warId on ${repair.stamped} event(s)`
      + `${repair.anchored ? `, moved ${repair.anchored} war start(s) onto the event that opens the war` : ""}`
      + `, dropped ${repair.droppedIds.length} war record(s)`
      + `${repair.droppedIds.length ? ` (${repair.droppedIds.join(", ")})` : ""}, unbound ${repair.strippedEvents} event(s)`;
    console.warn(
      `[ai] war ledger salvage after the model failed its corrective retry: ${summary}; keeping the segment. `
      + `First rejection: ${first}${repair.residual ? ` The ledger still says: ${repair.residual}` : ""}`,
    );
    logDebugEvent("warn", "[turn] War ledger salvage on the final attempt: the segment is kept, its canonical war changes repaired or dropped.", {
      firstRejection: first,
      stamped: repair.stamped,
      anchored: repair.anchored,
      droppedWarIds: repair.droppedIds,
      unboundEvents: repair.strippedEvents,
      residual: repair.residual,
    });
    if (repair.droppedIds.length || repair.strippedEvents) {
      noteReceipt(
        receipt,
        "dropped",
        `War ledger: ${repair.droppedIds.length} war record(s) were dropped`
          + `${repair.droppedIds.length ? ` (${repair.droppedIds.join(", ")})` : ""} and ${repair.strippedEvents} event(s) lost their war binding `
          + `because the records could not be tied to their events — ${firstComplaintLine(first)}`,
      );
    }
    warError = "";
  }
  if (warError) return warError;

  // On the salvage pass a malformed ledger row - an agreement with one
  // resolvable party, a relation with a name the map does not know - is dropped
  // and said (salvageDiplomaticLedgerPayload), never re-asked: the answer it
  // came with is twenty events the player would otherwise wait for twice. The
  // strict pass still rejects, with the exact row named, for the one retry
  // legacy mode allows.
  if (!strict) {
    for (const note of salvageDiplomaticLedgerPayload(candidate, { world })) noteReceipt(receipt, "dropped", note);
  }
  const diplomaticError = validateDiplomaticLedgerPayload(candidate, { world, allowNativeBinding: true });
  if (diplomaticError) return diplomaticError;

  const boundEvents = normalizeArray(candidate.events);
  candidate.warUpdates = bindWarUpdatesToEvents(decodeWarUpdates(candidate.warUpdates), boundEvents);
  candidate.relationUpdates = bindRelationUpdatesToEvents(decodeRelationUpdates(candidate.relationUpdates), boundEvents);
  candidate.puppetUpdates = bindPuppetUpdatesToEvents(decodePuppetUpdates(candidate.puppetUpdates), boundEvents);
  candidate.agreementUpdates = bindAgreementUpdatesToEvents(decodeAgreementUpdates(candidate.agreementUpdates), boundEvents);
  return "";
};

// One segment's storyline records, after its ledgers. The director's semantic
// binder attaches a strong unique match to its selected storyline, quiet echoes
// of deferred storylines are stripped, serious visible history must bite into a
// canonical owner, and the records are checked against the storyline ledger as
// the earlier segments left it. A stale selected storyline, or one whose update
// was omitted, is repaired LOCALLY once the whole skip is in hand
// (repairSkipStorylineMotion) so one overdue process never discards a segment's
// other events.
const validateSegmentStorylines = (candidate, {
  world,
  analysis,
  strict,
  finalAttempt,
  originDate,
  targetDate,
  gameCountry,
  board = [],
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
  // The Board is a place a major event may land, but the jump cannot write to it:
  // the board pass does, after the segments. So such an event passes on the
  // engine's own reading that it concerns an open Board entry, and its id is
  // recorded for applySimulationResult to prove against the board pass's ops.
  // Only on a strict attempt — the final attempt is fail-soft for every event.
  const playerCountry = toCountryName(normalizeString(gameCountry)) || normalizeString(gameCountry);
  const consequenceError = validateWorldEventConsequencePayload(candidate, {
    selectedStorylines: analysis?.attentionStorylines,
    strict,
    board,
    playerCountry,
  });
  if (consequenceError) return `[world consequence] ${consequenceError}`;
  candidate.boardProvisionalEventIds = strict
    ? boardProvisionalConsequenceIndexes(candidate, { board, playerCountry })
      .map((index) => normalizeString(normalizeArray(candidate?.events)[index]?.id))
      .filter(Boolean)
    : [];
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
    // Runs only on an accepted segment, so these go straight onto the turn's receipt.
    for (const entry of screened.dropped) noteReceipt(state.receipt, "withheld", describeWithheldEvent(entry));
  }
  payload.events = screened.events;
  // Canonical events the screen kept off the timeline still happened: the board
  // pass reads them. A provisional major event the screen hid needs no proving.
  state.hiddenEvents.push(...normalizeArray(screened.hidden).map((row) => row.event));
  const keptIds = new Set(screened.events.map((event) => normalizeString(event?.id)));
  state.boardProvisionalEventIds.push(
    ...normalizeArray(payload?.boardProvisionalEventIds).filter((id) => keptIds.has(id)),
  );
  delete payload.boardProvisionalEventIds;
  payload.warUpdates = filterBoundLedgerUpdatesToKeptEvents(payload?.warUpdates, taggedEvents, screened.events);
  payload.relationUpdates = filterBoundLedgerUpdatesToKeptEvents(payload?.relationUpdates, taggedEvents, screened.events);
  payload.puppetUpdates = filterBoundLedgerUpdatesToKeptEvents(payload?.puppetUpdates, taggedEvents, screened.events);
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
    eventCeiling: segmentEventRange(safeDays, plannedActionCount, { pace: getActiveWorldDirection()?.eventPace })[1],
    generationSource: normalizeString(state.generation?.source) || "ai",
  };
};

// The map's regions, for the one question a subordination needs of them: does
// the would-be Puppet still hold land (landedPolityCheck). Loaded only when
// there is a subordination to check.
const regionCatalogForPuppets = async (puppetUpdates, world) => (normalizeArray(puppetUpdates).length
  ? filterToRenderedRegions(await loadRegionCatalog().catch(() => []), world)
  : []);

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
    puppetUpdates: normalizeArray(payload?.puppetUpdates),
    puppetStates: isActiveFeatureEnabled("puppetStates"),
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

// The contract block for the per-component split generateCountryStatSheet asks
// for when a small polity's ledger has no semantic split yet (countryStats.js
// decodeTerritorialComponentSplit). Empty when no bucket needs one.
const buildStatsComponentSplitContract = (splitBucketsInput) => {
  const splitBuckets = normalizeArray(splitBucketsInput)
    .map((bucket) => ({
      index: Math.trunc(Number(bucket?.index)),
      ids: normalizeArray(bucket?.members).map((member) => normalizeString(member?.componentId)).filter(Boolean),
    }))
    .filter((bucket) => Number.isInteger(bucket.index) && bucket.ids.length > 1);
  if (!splitBuckets.length) return "";
  const bucketLines = splitBuckets.map((bucket) => `  - M${bucket.index}: ${bucket.ids.join(", ")}`).join("\n");
  const [first] = splitBuckets;
  const example = first.ids.slice(0, 2);
  return `- PER-COMPONENT SPLIT — REQUIRED for ${splitBuckets.map((bucket) => `M${bucket.index}`).join(", ")}. These components have no stored split yet. Native code saves this split ONCE and rescales it at later reassessments, so it is the population and economy a territorial transfer carries with each component.
- Also return territorialComponentSplitText with EXACTLY ONE row for EVERY component listed here, in this exact transport format: componentId~sharePercent~group~gdpPerCapita
${bucketLines}
- sharePercent is the component's share of ITS OWN macro bucket's population. The shares within one bucket sum to 100. The macro row still sets the bucket's total population.
- Estimate where the people actually live: cities, farmland, deserts, mountains, islands. NEVER split by how many map regions a component has or by its land area.
- For a component marked PARTIAL, the share covers ONLY its listed held regions.
- group and gdpPerCapita are the component's OWN values: a distant island, colony, or dependency does not inherit the mainland's group or productivity. Native code rescales the components' gdpPerCapita so their population-weighted average equals the bucket's macro gdpPerCapita, keeping the ratios between them.
- Example rows: ${example[0]}~92.5~core~38000 then ${example[1] || example[0]}~7.5~overseas/dependent~21000
`;
};

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

      const normalized = normalizeCountryStatsMacroEstimate({
        index: Number(parts[0]),
        group: parts[1],
        population: Number(String(parts[2]).replace(/[,_\s]/g, "")),
        gdpPerCapita: Number(String(parts[3]).replace(/[,_€$£\s]/g, "")),
      });

      if (!normalized || !nativePlan.some((entry) => entry.index === normalized.index)) continue;
      if (estimates.has(normalized.index)) continue;
      estimates.set(normalized.index, normalized);
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

  // Compatibility fallback for a valid non-territorial polity with no native map
  // basis. Campaign-supported distributed people/organizations may still provide old
  // group~geography~population~gdpPerCapita rows. NONE explicitly means there is no
  // defensible quantitative population/GDP scope; that is valid and must not invent land.
  if (!text || text.toLowerCase() === "none") return { estimates: [], components: [], error: "" };
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

// The model owns the relative productivity story across native macro/components,
// but tiny arithmetic misses just outside the historical-scale guard should not
// burn both structured-output attempts and leave the Stats pane unusable. When a
// historical-start answer cites NO canonical divergence and lands within 10% of
// the guard boundary, preserve its relative regional pattern and nudge the whole
// component ledger only to that boundary. Larger departures still fail closed.
const normalizeNearBoundaryHistoricalNominalScale = ({ calibration, components, currentDate } = {}) => {
  const rows = normalizeArray(components);
  if (!rows.length || !calibration || typeof calibration !== "object" || Array.isArray(calibration)) {
    return { components: rows, adjusted: false };
  }

  const mode = normalizeString(calibration?.mode);
  const divergenceEventIds = normalizeArray(calibration?.divergenceEventIds)
    .map(normalizeString)
    .filter(Boolean);
  const anchorYear = Math.trunc(Number(calibration?.anchorYear));
  const rebasedGdpPerCapita = Number(calibration?.rebasedGdpPerCapita2026Eur);
  if (mode !== "historical_start" || divergenceEventIds.length || !Number.isInteger(anchorYear) || !(rebasedGdpPerCapita > 0)) {
    return { components: rows, adjusted: false };
  }

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
  if (!(generatedGdpPerCapita > 0)) return { components: rows, adjusted: false };

  const currentYear = parseIsoDate(currentDate)?.year;
  const elapsedYears = Number.isInteger(currentYear) ? Math.max(0, currentYear - anchorYear) : 0;
  const noEvidenceMultiplier = Math.min(2, 1.35 + elapsedYears * 0.08);
  const lowerBound = 1 / noEvidenceMultiplier;
  const upperBound = noEvidenceMultiplier;
  const scaleRatio = generatedGdpPerCapita / rebasedGdpPerCapita;
  if (scaleRatio >= lowerBound && scaleRatio <= upperBound) {
    return { components: rows, adjusted: false };
  }

  const nearLowerBoundary = scaleRatio < lowerBound && scaleRatio >= lowerBound * 0.9;
  const nearUpperBoundary = scaleRatio > upperBound && scaleRatio <= upperBound * 1.1;
  if (!nearLowerBoundary && !nearUpperBoundary) {
    return { components: rows, adjusted: false };
  }

  const targetRatio = nearLowerBoundary ? lowerBound : upperBound;
  const factor = targetRatio / scaleRatio;
  const adjustedComponents = rows.map((component) => ({
    ...component,
    gdpPerCapita: Math.max(1, Math.round((Number(component?.gdpPerCapita) || 0) * factor * 100) / 100),
  }));
  return {
    components: adjustedComponents,
    adjusted: true,
    beforeRatio: scaleRatio,
    afterRatio: targetRatio,
    factor,
  };
};

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

const buildTerritorialControlContext = async (worldLike, { maxRows = 80, viaLookups = false } = {}) => {
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
    ? rows.slice(0, maxRows).join("\n") + (rows.length > maxRows
      ? `\n(+${rows.length - maxRows} more non-normal territorial states omitted${viaLookups ? "; contested_regions lists them all" : ""})`
      : "")
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

const gameMasterPoliticalActorReferenceContext = (worldLike, request = "", playerPolity = "") => {
  const world = normalizeWorldState(worldLike);
  const byPolity = world?.politicalActors?.byPolity && typeof world.politicalActors.byPolity === "object"
    ? world.politicalActors.byPolity
    : {};
  const requestText = normalizeString(request).toLocaleLowerCase();
  const simplify = (value) => normalizeString(value).toLocaleLowerCase().replace(/^the\s+/, "");
  const isPoliticalRequest = /\b(?:government|cabinet|prime minister|president|monarch|election|party|parties|coalition|parliament|political|constitution|regime|leader)\b/i.test(requestText);

  const selected = [];
  const seen = new Set();
  const add = (key) => {
    const actualKey = getPoliticalProfileKey(world, key);
    if (!actualKey || seen.has(actualKey) || !byPolity[actualKey]) return;
    seen.add(actualKey);
    selected.push([actualKey, byPolity[actualKey]]);
  };

  for (const key of Object.keys(byPolity)) {
    const full = normalizeString(key).toLocaleLowerCase();
    const short = simplify(key);
    if ((full && requestText.includes(full)) || (short.length >= 4 && requestText.includes(short))) add(key);
    if (selected.length >= 6) break;
  }
  if (!selected.length && isPoliticalRequest && playerPolity) add(playerPolity);
  if (!selected.length) return "No Political Actor named by this request; do not invent party ids from this section.";

  const lines = [
    "Exact canonical Political Actor references for polities named by this GM request.",
    "IDs below are mutation identifiers, not suggestions. Reuse them exactly. create-party/create-power-bloc is only for a genuinely new entity established by the authored event.",
  ];
  for (const [polityKey, actor] of selected) {
    const government = actor?.government && typeof actor.government === "object" ? actor.government : {};
    lines.push(`POLITY: ${polityKey}`);
    lines.push(`Government rulingPartyIds=${JSON.stringify(normalizeArray(government.rulingPartyIds))}; coalitionPartyIds=${JSON.stringify(normalizeArray(government.coalitionPartyIds))}`);
    const parties = normalizeArray(actor?.parties).slice(0, 12);
    if (parties.length) {
      lines.push("Canonical parties:");
      for (const party of parties) {
        const support = Number(party?.support?.percent);
        const influence = Number(party?.influence?.percent);
        const leader = normalizeString(typeof party?.leader === "string" ? party.leader : party?.leader?.name);
        lines.push(`- id=${JSON.stringify(normalizeString(party?.id))} name=${JSON.stringify(normalizeString(party?.name))}${normalizeString(party?.ideology) ? ` ideology=${JSON.stringify(normalizeString(party.ideology))}` : ""}${Number.isFinite(support) ? ` support=${support}` : ""}${Number.isFinite(influence) ? ` influence=${influence}` : ""}${leader ? ` leader=${JSON.stringify(leader)}` : ""}`);
      }
    } else {
      lines.push("Canonical parties: none");
    }
    const blocs = normalizeArray(actor?.powerBlocs).slice(0, 8);
    if (blocs.length) {
      lines.push("Canonical power blocs:");
      for (const bloc of blocs) lines.push(`- id=${JSON.stringify(normalizeString(bloc?.id))} name=${JSON.stringify(normalizeString(bloc?.name))}`);
    }
  }
  return lines.join("\n").slice(0, 5000);
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

  // A task that declares the lookup functions gets the slim prompt (the
  // functions carry the detail); with the setting off it gets the full one.
  const lookups = Boolean(options?.lookups) && lookupFunctionsEnabled();
  const variables = await buildPromptContext(bundle, { ...options, lookups, requiredKeys, taskKey });
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
      puppetStates: isActiveFeatureEnabled("puppetStates"),
    }).text;
  }
  if (wants("territorialControlContext")) {
    variables.territorialControlContext = await buildTerritorialControlContext(bundle.world, lookups ? { maxRows: 24, viaLookups: true } : {});
  }
  if (wants("canonicalStorylineContext")) {
    variables.canonicalStorylineContext = buildGameMasterStorylineContext(bundle.world);
  }
  if (taskKey === "gameMaster" && wants("gameMasterPoliticalActorContext")) {
    variables.gameMasterPoliticalActorContext = gameMasterPoliticalActorReferenceContext(
      bundle.world,
      options?.gameMasterRequest,
      bundle?.game?.country,
    );
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
const ACTIONS_REFERENCE = "[Actions You Can Take]\nThis is the full menu of levers you have to change the world. Everything you change rides on an event's \"impacts\" object, except the two whole-jump levers noted at the end. Reach for the RIGHT lever, and NEVER narrate a change in an event's text without also emitting the impact that makes it real — narration and world state must always agree.\n\n• regionTransfers — Move a region to a new owner. This is the most important lever and the one most often forgotten: use it for every conquest, cession, sale, liberation, annexation, or hand-over, one entry per region. Shape: {\"regionId\":\"<exact id, or the plain region name if you don't know the id>\",\"regionName\":\"\",\"fromCode\":\"\",\"toCode\":\"<new owner code>\"}. toCode may name a polity that does not exist yet: the exact name you write founds it (a new state, a breakaway, a successor), so spell a new polity as it should appear on the map and an existing polity exactly as the map does, since a short form or translation of an existing country founds a second country beside it; add a polityChanges entry in the same event only to give the new polity a colour, aliases or a note. An event whose text says land changed hands but that carries no regionTransfers is invalid output and silently breaks the map. Transfer in order of proximity to the attacker's territory; never hand over an isolated region ringed by enemy land without a naval or airborne reason. A transfer is enacted IMMEDIATELY when the other side has agreed (a treaty, a negotiated cession, an event where they conceded) or when the ground has already been taken and held - a hand-over both sides accept needs no programme and no project. Where neither is true the land has NOT changed hands: record the claim with regionClaims instead and leave the border exactly where it is.\n\n• polityChanges — Create, rename, recolor, or re-describe a polity. One entry can do any combination: {\"code\":\"<polity code>\",\"name\":\"<new name, only if it changed>\",\"color\":\"#RRGGBB (only if it changed)\",\"aliases\":[\"...\"],\"reputation\":0-100,\"intelligence\":0-100,\"tags\":[\"...\"],\"stats\":{...},\"note\":\"<why>\"}. Create a polity by giving a new code with a name and color, or simply by handing it territory in regionTransfers or regionControlOps (it is founded under that exact name; an entry here then sets its colour, aliases and note). Change name/color when the polity's identity actually changes - a regime change, a revolution, a unification or partition, a proclaimed republic or a restored monarchy - and ALWAYS when the player has ordered it for their own polity. A mere new leader is not a rename. But a rename or recolour the player has ordered for THEIR OWN country is an administrative act of their own government: it needs no other power's consent, it cannot be refused, and it must be enacted in this jump by an event carrying polityChanges with the new name and that action's id in actionIds. Keep \"code\" as the polity's CURRENT name - the engine matches on it and then re-keys the country to the new one, so from then on the country IS the new name everywhere and the old one survives only as a former name; a change addressed to the name you are introducing lands on nothing and mints a second country beside the real one. On an ideological or alignment shift, rewrite the COMPLETE tags list (it is a full replacement, not a delta). Set reputation (0 = pariah, 100 = universally trusted) only when this turn's events actually moved a polity's standing. Set intelligence (0 = no service to speak of, 100 = the best in the world) only when something changed it: a purge or defection, a new bureau or budget, a foreign spy ring exposed, a player action that built the service up or ran it down. A SUDDEN shock — a purge, a defector, a ring rolled up — is a direct change here and takes effect at once. Building a service UP is not sudden and does not belong here: open it on the Projects board as a programme and put the new rating in that project's onComplete.polityChanges, so it arrives when the work actually finishes and the player can watch it coming, fund it, or have a rival wreck it first. Deciding to have a better service is not the same as having one. A country's non-political national statistics move through \"stats\" here — send just the fields that changed; everything omitted keeps its prior value. IMPORTANT: Political Actors are the canonical write authority for government, leaders, parties, coalitions, political systems, traits, strategy and perceptions. Do NOT use stats.leader or stats.government to enact a political change; use politicalActorOps below. Native code projects the canonical Political Actor back into an existing legacy Stats sheet where needed, never the other way around.\n\n• politicalActorOps — Make a durable political change caused by this event. Shape: {\"op\":\"<native operation>\",\"polityKey\":\"<exact CURRENT full polity name; if this event also renames it, use the NEW name>\",\"argsJson\":\"<one JSON object string with the operation-specific fields>\"}. Use set-government for administration details, replace-leader for head-of-state/head-of-government succession, form-coalition/leave-coalition for governing membership, create/update/set-party-* for party change, create/update/set-power-bloc-* for power blocs, set-political-system for constitutional structure, set-strategy for goals/fears/ambitions/domestic pressures, set-traits for persistent leader/government traits, and set-perceptions/remove-perception for campaign-derived political beliefs. Never guess the decoded argsJson shape.\n" + POLITICAL_ACTOR_GENERATED_ARG_GUIDANCE + "\nNever use native-derived set-political-pressures or set-behavioral-disposition here. A political event that changes who governs but emits no politicalActorOps changes only the story, not canonical politics. FOUNDATIONAL POLITICAL MATURATION: when an election result or government formation is the first durable settlement of a sparse/emergent polity, do not stop at one government label. Establish the represented parties/power actors and their support/influence, governing force/coalition/leadership, system, goals/fears/ambitions and justified decision-maker traits in the SAME event. Use set-traits only with canonical keys: " + POLITICAL_TRAIT_KEYS.join(", ") + ". Omit facts the campaign has not established; if results are not known, narrate polling/counting rather than a completed result.\n\n• regionClaims — Mark territory CLAIMED but not held, so the map can show a dispute instead of pretending nothing happened. Use it when a polity asserts a right to land it does not control and has not been given: an irredentist declaration, a proclaimed union, a contested border, a government-in-exile's title, a player declaring a neighbour's province theirs. Shape: {\"regionId\":\"<exact id, or the plain region name>\",\"claimantCode\":\"<claiming polity's full name>\",\"note\":\"<why>\"}; add \"drop\":true to withdraw a claim that was renounced, traded away, or lost with the claimant's defeat. The region renders striped in every claimant's colour and stays that way until it is settled - by a regionTransfers entry when someone finally wins or concedes it, or by a drop. NEVER move a border for a claim alone, and never leave a claim unrecorded either: a declaration that changes nothing the player can see is a declaration they cannot tell they made.\n\n• unitOps — Move the war on the map with battalions. Four ops:\n    {\"op\":\"spawn\",\"unit\":{\"name\":\"\",\"type\":\"infantry|armor|air|naval|artillery|garrison\",\"ownerCode\":\"\",\"strength\":1-100,\"composition\":\"\",\"at\":\"<where, in words: near Kharkiv / eastern Ukraine / off Sevastopol>\"}}\n    {\"op\":\"move\",\"unitId\":\"<existing id>\",\"at\":\"<where, in words>\",\"posture\":\"\",\"note\":\"\"}\n    {\"op\":\"strength\",\"unitId\":\"<existing id>\",\"strength\":0-100,\"note\":\"\"}\n    {\"op\":\"remove\",\"unitId\":\"<existing id>\",\"note\":\"\"}\n  Spawn units for mobilizations and reinforcements, move them to reflect offensives, lower their strength as they take losses, and remove them only when destroyed or disbanded. Only reference unit ids that appear in the current-units list. Say WHERE with at, in words (see [Placing Things]); the engine finds the point and keeps counters off each other. Give lng/lat only for a spot no name describes. When a front is decisively won, pair the advance with a regionTransfers entry so the border follows the troops.\n\n• markerOps — Place, remove, rename or resize a named structure or city. Four ops:\n    {\"op\":\"build\",\"marker\":{\"name\":\"\",\"kind\":\"<lowercase, e.g. military base / port / embassy / airfield / city>\",\"ownerCode\":\"\",\"at\":\"<where, in words: near Odesa / coast of Crimea>\",\"note\":\"\",\"foundedAt\":\"\"}}\n    {\"op\":\"remove\",\"name\":\"<exact existing name>\",\"note\":\"\"}\n    {\"op\":\"rename\",\"name\":\"<current name>\",\"newName\":\"<new name>\",\"note\":\"<why>\"}\n    {\"op\":\"population\",\"name\":\"<city>\",\"population\":<whole number of people>,\"note\":\"<why>\"}\n  Emit build whenever an event founds or constructs a place, remove when one is destroyed, and rename when a city or structure is renamed (rename works on existing map cities too — a city renamed after a leader or ideology, a capital re-designated, a conquered city given the conqueror's name). Structures NEVER move borders: a facility one polity builds inside another's land does not transfer the region, and ownerCode is who runs the facility, not who owns the ground. Emit population whenever an event plausibly moves how many people live somewhere - a siege, famine, epidemic, bombing or evacuation shrinking a city; an industrial boom, resettlement or refugee influx growing one - giving the new TOTAL, not the change. It works on any city on the map, whether the scenario authored it or it came with the world.\n\n• institutionLifecycleOps — Change the LIVE lifecycle of canonical institutions when this event actually contains such a political act. Operations: found, invite, apply, respond, withdraw, expel, suspend, reinstate, dissolve. Every op names actorPolity using the exact current polity name. Existing institutions use institutionId copied exactly from canonical institution context; respond also copies the exact pending caseId. These are sovereign political decisions, not bookkeeping: judge them through the actor's current PWv2 government/ideology/goals/fears/domestic pressure, relations with current members, the institution's purpose/geographic scope/obligations and its threat model. FRIENDLY RELATIONS ALONE NEVER MEAN JOIN. A government can prefer observer status, reject, delay or demand terms because the institution is the wrong regional/political fit. An actor explicitly named as the institution's adversary ordinarily should not seek/accept membership absent a real campaign transformation. NEVER act for the human player's acceptance/application/founding/withdrawal/response; AI governments may invite or formally discipline the player, but the player decides their own membership. An invitation/application is NOT membership: native institution law/ballots resolve it. founding invitees are invitations, not automatic founders.\n\n• createdChats — Have another polity open a diplomatic chat with the player BECAUSE of this event (a war scare prompting mediation, a border incident prompting an ultimatum, a windfall prompting a trade delegation). Shape: {\"countries\":[\"...\"],\"title\":\"<names the purpose>\",\"speaker\":\"<the initiating polity — never the player>\",\"openingMessage\":\"<that leader's first message, in their voice>\"}. The other side always speaks first; a blank or untitled chat is invalid.\n\n• actionIds — List the ids of the player's queued actions that this event resolves, so the game can clear them from the queue.\n\nWhole-jump levers (top level of your output, NOT inside an event):\n• diplomaticOutreach — Polities reaching out to the player on their OWN initiative this period — treaty feelers, trade proposals, non-aggression pacts, mediation offers, warnings, summit invitations — not tied to any single event. Same shape as createdChats. Open one whenever a polity plausibly would, rather than defaulting to none.\n\nKeep the total across createdChats and diplomaticOutreach to at most 3 per jump, and only when the approach genuinely serves the sender's interests.";

// Written into a fallback's rawResponse when there is no model output to show.
// Exported so the debug report (time.jsx) can tell this apart from real model
// text and label its section honestly, rather than matching on the wording.
// NO_RESPONSE_BODY_NOTE lives in simulationStatus.js and is re-exported below.
export const EMPTY_RESPONSE_BODY_NOTE = "(the provider returned an empty response body — the request succeeded but the model produced no text)";

// "Limit AI generation" (OFF by default) — the whole policy, in one place rather
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
// safe to turn on; a stalled one is caught instead of hanging the turn forever.
// It ships OFF all the same: the fallback it triggers is a canned turn the
// player did not ask for, and the beta leaves that trade to the player. Off —
// and an absent key — means "wait as long as the model needs".
const taskIdleTimeoutMs = () =>
  (getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? AI_IDLE_TIMEOUT_MS : 0);

// Difficulty 2.0 carries one directive per scope; chat-shaped tasks get the
// diplomacy reading, interactive events their own, everything else the simulation one.
const difficultyScopeForTask = (taskKey) => {
  if (["idleDiplomacy", "nextSpeaker"].includes(taskKey)) return "diplomacy";
  if (String(taskKey || "").startsWith("interactive")) return "interactive";
  return "simulation";
};

// Telemetry: how much in-game time this task's prompt covers, from the round
// dates the template variables carry. Null for tasks without a window.
const computeSimulatedDays = (variables) => {
  const days = diffGameDays(variables?.date, variables?.targetDate);
  return days === null ? null : Math.max(0, days);
};

// How long a task waits before re-asking a provider that refused its first
// attempt as busy. The provider path has already retried once after 5s by then,
// so this is the longer pause — the same 15s the providers use between their own
// status-code retries.
const BUSY_PROVIDER_TASK_PAUSE_MS = 15000;

const abortableWait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

// The campaign behind function calls (lookupTools.js). A task that produces
// map operations gets these declared beside its output function, so the model
// can ask for the exact powers, a power's regions, a region by name, a region's
// neighbours, a city's region, a power's situation, the recent events, the war
// ledger, a chat, the units, instead of guessing names from a summary and
// having the guess dropped by the resolver. Built lazily: the indexes cost a
// catalog load and a city read, paid only when the model actually asks.
// `bundle` is what the task is shown (a jump segment passes the ledgers as the
// segments in hand left them), so lookups and prompt never disagree.
// Settings → AI → AI lookup functions. Off: no task declares them, and the
// prompt carries the region lists and ledgers itself (buildTemplateVariables).
//
// Off as well while requests are being saved (requestBudget.js), whatever the
// toggle says. A lookup round is a whole extra request — the entire prompt goes
// out again — and the budget is three per TASK and per ATTEMPT, so a time skip
// with its passes was measured at 23 requests where the player expected three.
// The full prompt costs more characters and no extra request, which on a free
// key is the right way round. The toggle takes effect once saving is off.
const lookupFunctionsEnabled = () => !savingRequests() && getMapSettingDefaultOn(MAP_SETTING_KEYS.lookupFunctions);

// audience: who is asking (audience.js). Every task that carries lookups today is
// the narrator - the jump, the directors, the game master - so that is the
// default, and it is passed on explicitly rather than left to a blank. A surface
// that speaks AS a polity must pass a viewer here: chat_history, spy_network and
// list_projects answer from material a government keeps to itself.
const buildTaskLookups = (bundle, { maxRounds, audience = SIMULATION_AUDIENCE } = {}) => {
  if (!lookupFunctionsEnabled()) return null;
  const context = lazyLookupContext(bundle, { audience });
  return {
    tools: LOOKUP_TOOLS,
    ...(Number.isInteger(maxRounds) ? { maxRounds } : {}),
    execute: async (name, args) => executeLookup(await context(), name, args),
  };
};

// The map and the campaign indexed for answering questions (lookupTools.js
// buildLookupContext), built on first use. The lookup functions answer from it
// when the model asks; placesNamedIn answers from it before anyone has to — which
// is the only way it is used while requests are being saved.
function lazyLookupContext(bundle, { audience = SIMULATION_AUDIENCE } = {}) {
  let contextPromise = null;
  return () => {
    if (!contextPromise) {
      contextPromise = (async () => {
        const world = normalizeWorldState(bundle?.world);
        // The catalog carries names, owners, centroids and declared adjacencies;
        // the rendered geojson (already parsed once for the map, shared here
        // rather than cloned) adds the polygons that place cities and, failing
        // declared adjacencies, find neighbours.
        const [catalogRows, renderedGeojson, citiesGeojson] = await Promise.all([
          loadRegionCatalog().catch(() => []),
          readJson(JSON_URLS.regionsGeojson, { defaultValue: null, clone: false }).catch(() => null),
          readJson(JSON_URLS.citiesGeojson, { defaultValue: null }).catch(() => null),
        ]);
        const geometryById = new Map();
        for (const feature of normalizeArray(renderedGeojson?.features)) {
          const props = feature?.properties ?? {};
          const id = normalizeString(props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id);
          if (id && feature?.geometry) geometryById.set(id, feature.geometry);
        }
        const catalog = filterToRenderedRegions(catalogRows, world).map((region) => (
          geometryById.has(region.id) ? { ...region, geometry: geometryById.get(region.id) } : region
        ));
        const cities = normalizeArray(citiesGeojson?.features).map((feature) => {
          const props = feature?.properties ?? {};
          const name = normalizeString(props.city || props.name);
          const renamed = normalizeString(world.cityRenames?.[name.toLowerCase()]);
          return {
            name: renamed || name,
            aliases: renamed ? [name] : [],
            coordinates: feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null,
            population: Number(props.population) || 0,
            capital: normalizeString(props.capital),
          };
        });
        return buildLookupContext({
          regions: catalog,
          world,
          cities,
          events: bundle?.events,
          chats: bundle?.chats,
          units: normalizeArray(world.units),
          player: normalizeString(bundle?.game?.country),
          audience,
        });
      })();
    }
    return contextPromise;
  };
}

// The places a text names, with who controls each — for the territory director,
// which writes that controller into fromCode (nativeTerritoryDirector.js).
const placeReaderFor = (bundle) => {
  const context = lazyLookupContext(bundle);
  return async (text) => placesNamedIn(await context(), text);
};

const STAT_INDEX_CONTEXT_TASKS = new Set(["jumpForward", "autoJumpForward", "gameMaster", "countryStatSheet"]);

const validateTaskStatIndexKeys = (taskKey, payload, expectedRows) => {
  const expected = normalizeArray(expectedRows).map((row) => normalizeString(row?.key)).filter(Boolean);
  if (!expected.length || !payload || typeof payload !== "object") return "";
  const allowed = new Set(expected);
  const validateIndices = (indices, path, { complete = false } = {}) => {
    if (indices == null) return complete ? `${path} is required.` : "";
    if (!indices || typeof indices !== "object" || Array.isArray(indices)) return `${path} must be an object.`;
    const keys = Object.keys(indices);
    const unexpected = keys.filter((key) => !allowed.has(key));
    if (unexpected.length) return `${path} contains index key(s) not defined by this scenario: ${unexpected.join(", ")}.`;
    if (complete) {
      const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(indices, key));
      if (missing.length) return `${path} is missing scenario index key(s): ${missing.join(", ")}.`;
    }
    return "";
  };

  if (taskKey === "countryStatSheet") return validateIndices(payload.indices, "$.indices", { complete: true });
  if (taskKey === "gameMaster") {
    for (let patchIndex = 0; patchIndex < normalizeArray(payload.countryStatPatches).length; patchIndex += 1) {
      const error = validateIndices(payload.countryStatPatches[patchIndex]?.patch?.indices, `$.countryStatPatches[${patchIndex}].patch.indices`);
      if (error) return error;
    }
  }
  for (let eventIndex = 0; eventIndex < normalizeArray(payload.events).length; eventIndex += 1) {
    const changes = normalizeArray(payload.events[eventIndex]?.impacts?.polityChanges);
    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      const error = validateIndices(changes[changeIndex]?.stats?.indices, `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}].stats.indices`);
      if (error) return error;
    }
  }
  return "";
};

// A scenario's own stats contract (#773, statIndexDefinitions.js / statsSheet.js):
// a custom sheet replaces the standard stats, custom indices replace the standard
// indices, and an answer may use only the keys the scenario defines. Returns an
// error that starts with the JSONPath it is at, so schemaSalvage.js can leave the
// offending stats out instead of losing the answer; "" when the answer keeps it.
// Normalizes a custom sheet's values in place, as the check always has.
const validateStatContract = (taskKey, parsed, contract = {}) => {
  const { customFullStatSheet = false, customStatKeys = [], statSheetDefinition = null, statIndexRows = [] } = contract ?? {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  if (!customFullStatSheet) {
    return normalizeArray(statIndexRows).length ? validateTaskStatIndexKeys(taskKey, parsed, statIndexRows) : "";
  }
  const validateCustomObject = (customStats, path, { complete = false } = {}) => {
    if (customStats == null) return complete ? `${path} is required.` : "";
    if (!customStats || typeof customStats !== "object" || Array.isArray(customStats)) return `${path} must be an object.`;
    const allowed = new Set(customStatKeys);
    const unexpected = Object.keys(customStats).filter((key) => !allowed.has(key));
    if (unexpected.length) return `${path} contains stat key(s) not defined by this scenario: ${unexpected.join(", ")}.`;
    if (complete) {
      const missing = customStatKeys.filter((key) => !Object.prototype.hasOwnProperty.call(customStats, key));
      if (missing.length) return `${path} is missing scenario stat key(s): ${missing.join(", ")}.`;
    }
    const normalized = normalizeCustomStatValues(customStats, statSheetDefinition, { partial: !complete });
    for (const [key, value] of Object.entries(customStats)) {
      if (!Number.isFinite(Number(value))) return `${path}.${key} must be a finite number.`;
      if (!Object.prototype.hasOwnProperty.call(normalized, key)) return `${path}.${key} is outside this scenario's allowed stat contract.`;
      customStats[key] = normalized[key];
    }
    return "";
  };
  if (taskKey === "countryStatSheet") return validateCustomObject(parsed.customStats, "$.customStats", { complete: true });
  if (taskKey === "gameMaster") {
    for (let patchIndex = 0; patchIndex < normalizeArray(parsed.countryStatPatches).length; patchIndex += 1) {
      const patch = parsed.countryStatPatches[patchIndex]?.patch;
      if (patch?.indices || patch?.economy || patch?.population || patch?.gdpBreakdown || patch?.stability != null) {
        return `$.countryStatPatches[${patchIndex}].patch uses standard modern Stats fields in a custom-sheet scenario; use customStats only.`;
      }
      const error = validateCustomObject(patch?.customStats, `$.countryStatPatches[${patchIndex}].patch.customStats`);
      if (error) return error;
    }
  }
  for (let eventIndex = 0; eventIndex < normalizeArray(parsed.events).length; eventIndex += 1) {
    const changes = normalizeArray(parsed.events[eventIndex]?.impacts?.polityChanges);
    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      const stats = changes[changeIndex]?.stats;
      if (!stats) continue;
      if (stats.indices || stats.economy || stats.population || stats.gdpBreakdown || stats.stability != null) {
        return `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}].stats uses standard modern Stats fields in a custom-sheet scenario; use customStats only.`;
      }
      const error = validateCustomObject(stats.customStats, `$.events[${eventIndex}].impacts.polityChanges[${changeIndex}].stats.customStats`);
      if (error) return error;
    }
  }
  return "";
};


// ---- Placement: `at`, and keeping things off each other ------------------------
//
// A unit or a structure may be placed with a phrase instead of coordinates
// (placement.js: "near Kharkiv", "eastern Ukraine", "off Sevastopol"). This is
// the half of that which needs the map: the gazetteer the phrases are resolved
// against, and the pass over a payload that turns every `at` into a point and
// then moves each newly placed thing clear of whatever already stands there
// (runtime/featureSpacing.js), without letting it leave the region it was put in.
//
// It runs where region names are resolved — at validation — because the runtime
// layer that APPLIES operations has no geometry (see buildOwnerFootprint in
// gameState.js) and must go on receiving plain coordinates.
const buildPlacementGazetteer = (context, world) => {
  const fold = (value) => foldRegionKey(value);
  const units = normalizeArray(world?.units).filter((unit) => Number.isFinite(unit?.lng) && Number.isFinite(unit?.lat));
  const markers = normalizeArray(world?.markers).filter((marker) => Number.isFinite(marker?.lng) && Number.isFinite(marker?.lat));
  const withGeometry = context.rows.filter((row) => row.geometry && row.bbox);
  const asRegion = (row) => ({ id: row.id, name: row.name, geometry: row.geometry });

  // `exact`: the name as the map spells it (or an alias, or "Kharkiv" for
  // "Kharkiv Oblast") and nothing looser — the whole-phrase attempt, where a
  // substring match would read "off Sevastopol" as the region Sevastopol.
  const find = (name, { exact: exactOnly = false } = {}) => {
    const key = fold(name);
    if (!key) return null;
    const unit = units.find((entry) => fold(entry.id) === key || fold(entry.name) === key);
    if (unit) return { kind: "unit", name: unit.name, point: [unit.lng, unit.lat] };
    const marker = markers.find((entry) => fold(entry.id) === key || fold(entry.name) === key);
    if (marker) return { kind: "marker", name: marker.name, point: [marker.lng, marker.lat] };
    const city = context.cityRows.find((entry) => fold(entry.name) === key || entry.aliases.some((alias) => fold(alias) === key));
    if (city) return { kind: "city", name: city.name, point: city.coordinates };
    // A country before a region: "Ukraine" is the country even where a region shares the name.
    const owner = context.resolveOwner(name);
    const owned = owner ? (context.ownerRows.get(owner) ?? []).filter((row) => row.geometry) : [];
    const exact = withGeometry.find((row) => fold(row.name) === key || row.aliases.some((alias) => fold(alias) === key));
    if (owned.length && !(exact && owned.length === 1)) return { kind: "polity", name: owner, regions: owned.map(asRegion) };
    if (exact) return { kind: "region", name: exact.name, region: asRegion(exact) };
    const matched = exactOnly
      ? matchRegionName(name, withGeometry, { allowFuzzy: false, minSubstring: Infinity })
      : matchRegionName(name, withGeometry, { maxFuzzy: 1 });
    if (matched?.region) return { kind: "region", name: matched.region.name, region: asRegion(matched.region) };
    if (exactOnly) return null;
    // A city one letter out ("Kharkov" for "Kharkiv"), last: a near miss must not beat a real region.
    const stripped = stripRegionAffixes(key) || key;
    const close = stripped.length >= 5 && context.cityRows.find((entry) => editDistance(stripped, fold(entry.name), 1) <= 1);
    return close ? { kind: "city", name: close.name, point: close.coordinates } : null;
  };

  // A region by its id, for an operation that gives `regionId` and no phrase.
  const findRegionId = (id) => {
    const key = normalizeString(id);
    if (!key) return null;
    const row = withGeometry.find((candidate) => normalizeString(candidate.id) === key);
    return row ? asRegion(row) : null;
  };

  // What a phrase ALMOST matched, for the receipt. The usual dead end is a name
  // that fits several regions at once — "Falkland Islands" over East and West
  // Falkland Islands — which matchRegionName refuses on purpose rather than pick
  // one of them. Refusing is right; leaving the model to guess again is not, so
  // the receipt names them and it can write one exactly next turn.
  const suggest = (phrase) => {
    const key = fold(phrase);
    if (key.length < 4) return [];
    return withGeometry
      .filter((row) => fold(row.name).includes(key) || key.includes(fold(row.name)))
      .slice(0, 4)
      .map((row) => row.name);
  };

  const regionAt = (point) => {
    const row = withGeometry.find((candidate) => point[0] >= candidate.bbox[0] && point[0] <= candidate.bbox[2]
      && point[1] >= candidate.bbox[1] && point[1] <= candidate.bbox[3]
      && pointInGeometry(point, candidate.geometry));
    return row ? asRegion(row) : null;
  };

  // The nearest region to a point that is in none, within maxKm, and the spot
  // inside it nearest that point: where something put in the sea comes ashore.
  const nearestLand = (point, maxKm) => {
    let best = null; let bestKm = maxKm;
    for (const row of withGeometry) {
      // The bbox first: most of the world is nowhere near.
      const clamped = [Math.min(Math.max(point[0], row.bbox[0]), row.bbox[2]), Math.min(Math.max(point[1], row.bbox[1]), row.bbox[3])];
      const km = placementDistanceKm(point, clamped);
      if (km < bestKm) { bestKm = km; best = row; }
    }
    if (!best) return null;
    const ashore = nearestInteriorPoint(best.geometry, point);
    return ashore ? { point: ashore, region: asRegion(best) } : null;
  };
  return { find, findRegionId, suggest, regionAt, nearestLand };
};

const LAND_UNIT_TYPES = new Set(["infantry", "armor", "artillery", "garrison"]);

// Every `at` — or, failing that, every `regionId` — in a list of containers
// ({ event, impacts, path }) becomes coordinates, and every newly placed thing is
// spaced off the rest. Mutates the operations in place, like the region resolvers
// beside it. `receipt` hears what could not be placed; an operation that then has
// no coordinates at all is left for the normalizer to drop, exactly as one that
// never had any.
const resolvePlacements = async (containers, world, { receipt = null } = {}) => {
  const placing = [];
  for (const { event, impacts, path } of normalizeArray(containers)) {
    if (!impacts || typeof impacts !== "object") continue;
    const title = normalizeString(event?.title);
    for (const op of normalizeArray(impacts.unitOps)) {
      const kind = normalizeString(op?.op).toLowerCase();
      if (kind === "spawn") {
        const unit = op.unit && typeof op.unit === "object" ? op.unit : op;
        placing.push({ family: "unit", target: unit, phrase: normalizeString(unit.at ?? op.at), regionId: normalizeString(unit.regionId ?? op.regionId), lngKey: "lng", latKey: "lat", name: normalizeString(unit.name), id: "", raisedOnLand: LAND_UNIT_TYPES.has(normalizeString(unit.type).toLowerCase()), title, path, spawn: true, owner: normalizeString(unit.ownerCode ?? unit.owner ?? op.ownerCode) });
      } else if (kind === "move") {
        const mover = normalizeArray(world?.units).find((unit) => normalizeString(unit?.id) === normalizeString(op.unitId));
        placing.push({ family: "unit", target: op, phrase: normalizeString(op.at), regionId: normalizeString(op.regionId), lngKey: "toLng", latKey: "toLat", name: normalizeString(op.unitId), id: normalizeString(op.unitId), raisedOnLand: false, title, path, owner: normalizeString(mover?.ownerCode) });
      }
    }
    for (const op of normalizeArray(impacts.markerOps)) {
      const kind = normalizeString(op?.op).toLowerCase();
      if (kind !== "build" && kind !== "found" && kind !== "update") continue;
      const marker = op.marker && typeof op.marker === "object" ? op.marker : op;
      const phrase = normalizeString(marker.at ?? op.at);
      // An update that names no new place is not a placement.
      if (kind === "update" && !phrase && !Number.isFinite(Number(marker.lng))) continue;
      placing.push({ family: "marker", target: marker, phrase, lngKey: "lng", latKey: "lat", name: normalizeString(marker.name), id: normalizeString(op.markerId || marker.id), raisedOnLand: false, title, path });
    }
  }
  if (!placing.length) return { placed: 0, spaced: 0 };

  let gazetteer;
  try {
    gazetteer = buildPlacementGazetteer(await lazyLookupContext({ world })(), world);
  } catch (error) {
    console.warn("[placement] the map could not be read; operations keep the coordinates they came with.", error);
    return { placed: 0, spaced: 0 };
  }

  // What already stands, plus each thing placed by this payload as it lands.
  const standing = obstaclesOf(world);
  let placed = 0; let spaced = 0;
  for (const entry of placing) {
    const { target, lngKey, latKey } = entry;
    // `at` first: a phrase says more than an id can — "off Sevastopol" is at sea,
    // the region it belongs to is not. `regionId` is the fallback, and for an
    // operation that gives only an id it is the whole answer. It used to be
    // ignored, so such an operation was dropped for having no coordinates: the
    // exact move a model reaches for after being told its `at` was not on the map.
    const byPhrase = entry.phrase ? resolvePlacement(entry.phrase, gazetteer, { seedText: entry.name, owner: entry.owner }) : null;
    const byRegion = !(byPhrase && !byPhrase.error) && entry.regionId
      ? resolveRegionPlacement(entry.regionId, gazetteer, { seedText: entry.name })
      : null;
    const resolved = [byPhrase, byRegion].find((attempt) => attempt && !attempt.error) ?? null;
    const givenLng = Number(target[lngKey]); const givenLat = Number(target[latKey]);
    const hasCoordinates = target[lngKey] != null && target[latKey] != null
      && Number.isFinite(givenLng) && Number.isFinite(givenLat) && !(givenLng === 0 && givenLat === 0);
    // A NEW formation that nothing places — no phrase the map knows, no region
    // id, no coordinates of its own — is raised in its owner's own territory
    // rather than not at all. The receipt that told the model to name a place
    // did not stop a player's Ecuador losing the same brigade on consecutive
    // turns, to "northern frontier with Colombia" and then "northern border with
    // Colombia". A moved unit is not treated so: a move that cannot be placed
    // leaves the unit where it stands.
    const homeland = !resolved && !hasCoordinates && entry.spawn && entry.owner
      ? resolvePlacement(entry.owner, gazetteer, { seedText: entry.name })
      : null;
    if (resolved) {
      // A phrase that failed still gets said: the model wrote it, and next turn
      // it should know which of the two the engine went with.
      if (byPhrase?.error) {
        noteReceipt(receipt, "adjusted",
          `${entry.title ? `Event "${entry.title}": ` : ""}${entry.name || "a unit"} could not be placed at "${entry.phrase}" — ${byPhrase.error}. `
          + `Its regionId ${entry.regionId} was used instead: ${resolved.regionName || "that region"}.`);
      }
      target[lngKey] = resolved.lng;
      target[latKey] = resolved.lat;
      if (entry.family === "unit" && resolved.regionId) target.regionId = resolved.regionId;
      placed += 1;
    } else if (homeland && !homeland.error) {
      const tried = byPhrase?.error
        ? `could not be placed at "${entry.phrase}" — ${byPhrase.error}`
        : byRegion?.error
          ? `could not be placed in region "${entry.regionId}" — ${byRegion.error}`
          : "came with no place and no coordinates";
      noteReceipt(receipt, "adjusted",
        `${entry.title ? `Event "${entry.title}": ` : ""}${entry.name || "a unit"} ${tried}. `
        + `It was raised in ${homeland.regionName || entry.owner}, inside ${entry.owner}'s own territory, rather than left off the map. `
        + "Name a city, region, structure or unit as the map spells it — or \"the border with <country>\" for its own side of a border — to place it exactly.");
      target[lngKey] = homeland.lng;
      target[latKey] = homeland.lat;
      if (homeland.regionId) target.regionId = homeland.regionId;
      placed += 1;
    } else if (byPhrase?.error || byRegion?.error) {
      const tried = byPhrase?.error
        ? `could not be placed at "${entry.phrase}" — ${byPhrase.error}`
          + (byRegion?.error ? `; and its regionId "${entry.regionId}" — ${byRegion.error}` : "")
        : `could not be placed in region "${entry.regionId}" — ${byRegion.error}`;
      // The commonest dead end is a name that fits several regions at once, which
      // the matcher refuses rather than guess between. Naming them turns a turn
      // wasted guessing again into one exact name.
      const near = (byPhrase?.names ?? [entry.phrase])
        .map((name) => gazetteer.suggest(name))
        .find((hits) => hits.length) ?? [];
      noteReceipt(receipt, hasCoordinates ? "adjusted" : "dropped",
        `${entry.title ? `Event "${entry.title}": ` : ""}${entry.name || "a unit"} ${tried}.`
        + (near.length ? ` Did you mean ${near.map((name) => `"${name}"`).join(" or ")}?` : "")
        + (hasCoordinates ? " Its coordinates were used instead." : " It was left off the map. Name a city, region, structure or unit as the map spells it."));
      if (!hasCoordinates) continue;
    }
    delete target.at;
    let lng = Number(target[lngKey]); let lat = Number(target[latKey]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) continue;

    // An army is not raised at sea. This is what a guessed longitude looks like:
    // a rifle division standing in the Black Sea, forty kilometres off the city
    // it was meant for. Only a land formation being CREATED, and only close to a
    // shore — one that moves may be at sea in transit, and a point in mid-ocean
    // is not a near miss.
    if (entry.raisedOnLand && !gazetteer.regionAt([lng, lat])) {
      const ashore = gazetteer.nearestLand([lng, lat], 150);
      if (ashore) {
        noteReceipt(receipt, "adjusted", `${entry.title ? `Event "${entry.title}": ` : ""}${entry.name || "a land unit"} was placed in the sea and was moved ashore to ${ashore.region.name}. Place land forces with \`at\` and a place name rather than coordinates.`);
        lng = Number(ashore.point[0].toFixed(5)); lat = Number(ashore.point[1].toFixed(5));
        target[lngKey] = lng; target[latKey] = lat;
        target.regionId = ashore.region.id;
      }
    }

    // Clear of everything else — but never out of the region it was put in, and
    // never ashore when it was put at sea.
    const home = gazetteer.regionAt([lng, lat]);
    const others = entry.id ? standing.filter((obstacle) => obstacle.id !== entry.id) : standing;
    const radiusKm = entry.family === "unit" ? FOOTPRINT_KM.unit : FOOTPRINT_KM.marker;
    const spot = spaceOut({
      lng, lat, radiusKm, obstacles: others,
      inside: home
        ? (point) => gazetteer.regionAt([point.lng, point.lat])?.id === home.id
        : (point) => !gazetteer.regionAt([point.lng, point.lat]),
    });
    if (spot.moved) {
      target[lngKey] = spot.lng;
      target[latKey] = spot.lat;
      spaced += 1;
    }
    // A moved unit leaves where it stood; everything else is simply added.
    if (entry.id) {
      const index = standing.findIndex((obstacle) => obstacle.id === entry.id);
      if (index >= 0) standing.splice(index, 1);
    }
    standing.push({ id: entry.id || `placed-${standing.length}`, lng: Number(target[lngKey]), lat: Number(target[latKey]), radiusKm });
  }
  if (placed || spaced) {
    logDebugEvent("turn", `Placement: ${placed} thing(s) placed by name, ${spaced} moved clear of something already there.`, undefined, { verbose: true });
  }
  return { placed, spaced };
};

// The system prompt a task is sent: its template rendered with the variables,
// then every directive that task carries at call time (they are appended here
// rather than written into defaultPrompts.json because existing campaigns carry
// frozen copies of the templates). Its own function so that the turn review
// (runTurnReview below) can put several tasks into ONE request and still show
// each of them exactly the prompt it would have been sent alone.
//
// `reminders: false` leaves out the Game Master's reminders; the turn review
// adds them once to the whole request instead of once per job.
const buildTaskSystemPrompt = async (taskKey, { variables, lookups = null, reminders = true } = {}) => {
  const prompts = await loadPromptCatalog();
  const statSheetDefinition = STAT_INDEX_CONTEXT_TASKS.has(taskKey)
    ? await loadStatSheetDefinition().catch(() => ({ custom: false, sections: [] }))
    : null;
  const customFullStatSheet = Boolean(statSheetDefinition?.custom);
  const customStatRows = customFullStatSheet ? flattenStatSheetRows(statSheetDefinition) : [];
  const customStatKeys = customStatRows.map((row) => normalizeString(row?.key)).filter(Boolean);
  const statIndexDefinition = STAT_INDEX_CONTEXT_TASKS.has(taskKey) && !customFullStatSheet
    ? await loadStatIndexDefinition().catch(() => ({ custom: false, rows: DEFAULT_STAT_INDEX_ROWS }))
    : null;
  const statIndexRows = customFullStatSheet
    ? customStatRows.filter((row) => row.kind === "index")
    : (normalizeArray(statIndexDefinition?.rows).length
      ? normalizeArray(statIndexDefinition.rows)
      : (STAT_INDEX_CONTEXT_TASKS.has(taskKey) ? DEFAULT_STAT_INDEX_ROWS : []));
  const statIndexKeys = statIndexRows.map((row) => normalizeString(row?.key)).filter(Boolean);
  const customStatIndices = Boolean(!customFullStatSheet && statIndexDefinition?.custom && statIndexKeys.length);
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
    try {
      const [world, game] = await Promise.all([
        readWorldState({ force: false }),
        readGameData(),
      ]);
      systemPrompt = `${systemPrompt}\n\n${buildFutureHistoryBoundaryDirective({
        world: normalizeWorldState(world),
        game,
        originDate: normalizeString(game?.gameDate),
      })}`;
    } catch {
      // Legacy/minimal contexts still receive the template's built-in [What Is True Now].
    }
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[Player Agency]\n${playerName} is controlled by a human player. Never commit ${playerName} to a major decision the player did not actually make: do not sign treaties, alliances, ceasefires, surrenders, trade pacts, unions, or other binding agreements on the player's behalf, do not accept or reject offers for them, and do not have ${playerName} take landmark unilateral action (declaring war, ceding territory, changing government) unless it directly executes one of the player's planned actions, chat replies, or explicit requests. When another polity seeks such an agreement or decision from the player, present it as something the player can answer: a diplomaticOutreach entry or an impacts.createdChats chat where the counterpart speaks first and makes the proposal, or an event describing the offer as OPEN and awaiting the player's response. Events remain free to narrate what other polities do among themselves and to resolve the player's own queued actions exactly as ordered.`;
    // Map truth: the recurring field report is the OPPOSITE failure — invasions
    // narrated turn after turn with zero regionTransfers, so the map never moves.
    // Appended at call time for the same reason as [Player Agency]: existing
    // campaigns carry frozen prompts, so a defaultPrompts.json rule never
    // reaches them. This also disarms an over-cautious reading of the agency
    // rule above ("don't act for the player") as "don't move the map".
    systemPrompt = `${systemPrompt}\n\n[Map Truth — Control is not Sovereignty]\nTerritorial narration and the map must never disagree, but wartime control and legal sovereignty are DIFFERENT things. A battle capture, occupation, liberation or retaking uses impacts.regionControlOps (usually op=control; op=contest while the region is actively disputed). A treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement uses impacts.regionTransfers because legal sovereignty changed. Do NOT turn every front-line advance into a permanent legal border. When you do not know the exact region id, preserve the grounded place wording in regionId and set fromCode so the native geography resolver can map it conservatively. Resolving ${playerName}'s own ordered military operations into their real control consequences is REQUIRED and is never a player-agency violation. If nothing actually changed control or sovereignty this period, keep capture/cession language out of the event text.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
    // The prose rule above, as a field the model has to fill in and the engine
    // reads (runtime/territoryBasis.js): a transfer that admits it is only a claim
    // becomes a claim instead of a border.
    systemPrompt = `${systemPrompt}\n\n${TERRITORY_BASIS_DIRECTIVE}`;
    // No restating: the model is shown the recent timeline as context and, left
    // unchecked, re-narrates events it already reported — each restatement gets a
    // fresh id, so the same event stacks up and shows turn after turn. A content-key
    // de-dup on the write path (dedupeGeneratedEvents) drops exact/same-date
    // restatements; this directive stops the "rolling-date" ones (the same situation
    // re-narrated under each new turn's date) that a de-dup can't catch. Appended at
    // call time so existing frozen-prompt campaigns get it too.
    systemPrompt = `${systemPrompt}\n\n[New Developments Only]\nThe events shown to you above have ALREADY happened and appear only as context. Do NOT restate, rephrase, re-report, or re-narrate them. Emit ONLY genuinely NEW developments that occur during THIS period. If an ongoing situation (a war, a crisis, an occupation) has no new development this period, do not emit an event for it.`;
    // Where a unit or a structure goes, in words (placement.js). Appended at call
    // time for the same reason as the rest; the field itself ships in the live schema.
    systemPrompt = `${systemPrompt}\n\n${PLACEMENT_DIRECTIVE}`;
    // Documents, and what is on file already (runtime/reports.js). The narrator
    // is shown every report — it wrote them — so the list is unscoped here; the
    // audience rule applies where a VIEWER reads them. Read the same way the
    // espionage brief below is, so a frozen-prompt campaign gets it too.
    systemPrompt = `${systemPrompt}\n\n${REPORT_VOICE_DIRECTIVE}`;
    try {
      const reportsOnFile = describeReportsForPrompt(normalizeWorldState(await readWorldState({ force: false })).reports);
      if (reportsOnFile) systemPrompt = `${systemPrompt}\n\n${reportsOnFile}`;
    } catch {
      /* no documents this turn */
    }
    // Place renaming: appended at call time so existing frozen-prompt campaigns get it
    // too; the markerOps rename op ships via the LIVE tool schema either way.
    systemPrompt = `${systemPrompt}\n\n[Place Renaming]\nYou may rename places when the story warrants it (a city renamed after a leader or ideology, a capital re-designated, a colonial name replaced, a conquered city given the conqueror's name). Emit an impacts.markerOps entry {"op":"rename","name":"<current name>","newName":"<new name>","note":"<why>"}. This works on structures you built AND on existing map cities. Do it sparingly and only when a real event motivates it.`;
  }

  // Two tasks get the espionage picture, framed differently because they do
  // different jobs with it: the simulator turns it into events, the board turns
  // it into entries. Both see the same uncensored brief.
  if (isActiveFeatureEnabled("espionage") && ["jumpForward", "autoJumpForward", "projects"].includes(taskKey)) {
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

  // The consolidator maintains the campaign's living history document
  // (historyConsolidation.js). Existing games carry frozen prompts, so the
  // document, the rules for revising it and the order list all arrive at call
  // time.
  if (taskKey === "eventConsolidator") {
    systemPrompt = `${systemPrompt}\n\n[Durable Canon]\nThe history document REPLACES the material it covers: once consolidated, those events, conversations and player orders are never sent to the simulation again, so whatever the document omits is lost permanently. Carry forward explicitly, as standing facts rather than narration:\n1. How this world has DIVERGED from real history — states that never formed, wars that never happened, rulers who never fell, borders that never moved. Name them. A later model that sees only a gap fills it from real history and invents powers this campaign does not contain.\n2. The lasting CONSEQUENCES of the player's own orders, not the orders themselves.\n3. Commitments still in force: treaties, alliances, occupations, debts, standing grievances.\nBrevity matters, but never at the cost of a divergence or a commitment that is still true.`;
    const documentDirective = normalizeString(variables?.historyDocumentContext);
    if (documentDirective) {
      systemPrompt = `${systemPrompt}\n\n${documentDirective}\n\nOutput both fields, always: {"summary": "<this period's compressed history>", "document": "<the whole revised history document>"}.`;
    }
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
  if (["actions", "jumpForward", "autoJumpForward", "interactiveCreation", "interactiveExecutor"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Polity Names]\nEvery polity is identified ONLY by its full country name, exactly as written in the map description — "Spain", "United States", "Soviet Union". NEVER use a country code or abbreviation such as "ESP", "USA" or "SOV", anywhere, in any field. This applies to every owner field despite their names: toCode, fromCode, ownerCode and a polity's code all take the FULL NAME. A code is not a shorter way of writing a country here; it is a different, non-existent polity, and using one creates a phantom country on the map beside the real one. A renamed polity is listed under its new name with its former names as aliases: use the new name, and expect the old one only in history.`;
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
  // model to look for a distinction that is not there.
  if (["jumpForward", "autoJumpForward"].includes(taskKey) && !templateAlreadySays(systemPrompt, UNIT_CONTRACT_MARKER)) {
    const playerName = normalizeString(variables.playerPolity) || "the player's polity";
    systemPrompt = `${systemPrompt}\n\n[Units on the Map]\nUnits are EVIDENCE OF YOUR OWN EVENTS. The player cannot move or fight their own formations - the map is there to show them what is happening - so every unit you spawn or move must be something one of this jump's events actually describes. Reach for them readily: a mobilization, a build-up on a border, a fleet sailing, an offensive, a withdrawal all deserve to be visible. But keep the map legible - only formations that matter to the story. A great power at war might show five or six; a country at peace shows one or two, or none.\nstrength is a PERCENTAGE of established strength (100 = fresh and full, 60 = worn down, 20 = a shell), and composition says what the formation actually is ("1 aircraft carrier, 2 frigates", "3 tank regiments"). Write both, plus a one-sentence note on what it is doing and where. A counter that does not say what it is tells the player nothing.\nDo not teleport. A move may only cover what that unit could really travel between the previous event's date and this one's. The engine enforces this: an over-long move becomes a partial advance that continues automatically on later turns, so ordering the full distance is safe and correct.\nThe map is what ${playerName} KNOWS, not omniscience. A force may legitimately appear far from its own territory when it is being DETECTED rather than arriving - a submarine that has shadowed a fleet for weeks, infiltrators already in country, a deployment only now confirmed. Such a unit is drawn as unconfirmed, which is correct and not a penalty. The one thing you cannot conjure is a fixed installation: use markerOps build for a base, and never spawn a far-flung garrison.\nSet posture whenever you place or move a unit - holding, massing, patrol, transit, exercise, blockade, withdrawing, assaulting. It is how the player reads intent off the map. "patrol" is special: the engine keeps a patrolling unit working its station on its own, turn after turn, so state it once and leave it.\n"assaulting" is the other special one: a formation that ARRIVES under it is marked engaged, in contact at the objective, instead of idle. Use it when an event has a force actually storming a province rather than massing near it — including when the player has ordered an assault in words ("Attack Provence"), which is how they commit troops to a province, since they cannot move their own formations. You still own the OUTCOME: resolve the fighting on a later turn with casualties, and a regionTransfer only if the province genuinely falls. An order you judge infeasible is refused in an event that says why, never silently dropped.`;
  }

  // The map reading as if only the player fields an army: unitOps is fully general
  // (any owner, not just the player), but a low events-per-jump budget plus
  // player-centric framing meant other powers rarely got a reason to use it -
  // their militaries existed only when something dramatic happened TO the player.
  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n[Other Powers' Militaries]\nThe map should not read as though only ${normalizeString(variables.playerPolity) || "the player's polity"} fields any forces. When a major or currently-relevant power (a scenario-defined actor, a country the player has clashed or negotiated with, a power actively at war or mobilizing) plausibly has forces in the field this period - mobilizing, patrolling a border, escorting a fleet, garrisoning a front, reinforcing an ally - reflect it with impacts.unitOps even when nothing dramatic is happening to the player specifically. A brief, minor event (or a line folded into a larger one) is enough to justify it; it does not need its own headline. Keep this proportionate: a country at peace far from any conflict does not need forces conjured for their own sake. The one thing forbidden here is INVENTING A RIVALRY - giving two polities a hostility the campaign never gave them, so that neighbours are enemies merely for sharing a border, or a friendly or indifferent power turns on someone to give you something to write. That rule covers every pair of polities on the map, and ${normalizeString(variables.playerPolity) || "the player's polity"} is one of the pair like any other - neither more nor less protected than the rest. It is not, and never was, a ban on hostility toward the player. Where the motive is already on the record - a claim, a grievance, a treaty broken, an ally to protect, an opening left by a weak or distracted neighbour - that power acts on it, against ${normalizeString(variables.playerPolity) || "the player's polity"} as readily as against anyone else.`;
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
${HIGH_PRIORITY_ASSESSMENT_RULE} A project marked low priority may be left drifting with a one-line note, and that is a correct answer for it. Everything else is normal: move it when the story plausibly moved it, and say so plainly when it did not. Never raise a progress figure that nothing in this jump's events justifies - a board of quietly inflating percentages is worth less than an honest one full of stalls.`;
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
  // The board pass's rules live in its template, which every campaign keeps a
  // frozen copy of; the HIGH PRIORITY rule changed, so it is appended here to
  // reach games whose copy still demands movement — and skipped for one whose
  // template already carries the new rule.
  if (taskKey === "projects" && !templateAlreadySays(systemPrompt, HIGH_PRIORITY_ASSESSMENT_MARKER)) {
    systemPrompt = `${systemPrompt}\n\n${buildBoardPassDirective()}`;
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
  if (["unitDirector", "structureDirector", "gameMaster", "idleDiplomacy", "interactiveExecutor"].includes(taskKey)) {
    systemPrompt = `${systemPrompt}\n\n${PLACEMENT_DIRECTIVE}`;
  }
  if (taskKey === "unitDirector") {
    const directorUnits = normalizeString(variables.unitDirectorUnits) || "[]";
    const directorCandidates = normalizeString(variables.unitDirectorCandidates) || "[]";
    systemPrompt = `${systemPrompt}\n\n[Native Unit Director — runtime rules]\nYou are NOT writing new history. The supplied events are already canonical candidates. Your only job is to make existing persistent military units behave consistently with those events.\n\nCURRENT GAME DATE: ${normalizeString(variables.unitDirectorGameDate)}\nCURRENT ROUND: ${normalizeString(variables.unitDirectorRound)}\n\nCURRENT PERSISTENT UNITS:\n${directorUnits}\n\nMILITARY EVENT CANDIDATES:\n${directorCandidates}\n\nPriority order:\n1. REUSE existing unit ids. CURRENT PERSISTENT UNITS is authoritative; do not spend lookup rounds rediscovering units or powers that are already supplied here. Existing armies should move, fight, weaken, retreat and persist across turns.\n2. MOVE a current unit whenever the event establishes that formation at a materially different place: advances, marches, crosses, enters, reaches, arrives, embarks, sails, retreats, redeploys, establishes a camp/encampment, or fights at a named battlefield away from its current position. Set posture to what it is doing there (assaulting, massing, holding, withdrawing, transit, patrol, blockade, exercise). Fighting is a move into contact with posture assaulting.\n3. EXPLICIT RELOCATION IS NOT OPTIONAL. If a supplied event clearly says an identifiable existing formation changed location, return a move for that unit. Use the event's destination wording in 'at' (for example 'Etruria', 'toward Rome', 'Apulia') and let the native placement/unit engine ground it and enforce travel speed. A destination may be far away: the engine advances long orders over time as standing orders, so do NOT omit a move merely because the objective is beyond one turn's travel.\n4. A conscription law, mobilization order with no field movement, readiness measure, exercise, procurement, training, administrative integration or other military-policy event is NOT movement or combat.\n5. SPAWN only when the event genuinely creates a new formation, mobilization or reinforcement that is not already represented. Never spawn a new counter merely because an existing army is fighting again. A warship or submarine commissioned or delivered into service, or a squadron, air wing or task group formed or stood up, IS a new formation: spawn it for the power that commissioned it, at its home port or base, even when that power already has units. Laying down hulls, ordering ships or funding a programme is not.\n6. strength only when the event itself narrates casualties, attrition, disease, desertion, refit, reinforcement or demobilization for that formation. remove only for explicit destruction or disbandment.\n7. Do not invent military activity for diplomatic, political or economic events. Return no ops only when the event truly leaves every supplied persistent unit materially unchanged.\n8. Never change territory. The territory layer is separate.\n9. Use only supplied existing unit ids. Prefer 'at' to coordinates; copy the event's named destination instead of guessing longitude/latitude.\n\nReturn exactly the required tool payload.`;
  }

  // GM territorial semantics: regionTransfers move LEGAL sovereignty, regionControlOps
  // move de-facto control, claims stripe a region without moving anything; and
  // every narrated place must have its own operation.
  if (taskKey === "gameMaster") {
    systemPrompt = `${systemPrompt}\n\n[GM Territorial Semantics — live override]\nA wartime capture/occupation/liberation/retaking changes DE-FACTO control and must use impacts.regionControlOps, not regionTransfers. Use regionTransfers only for a LEGAL sovereignty change such as treaty cession, annexation/incorporation, recognized hand-over, sale, unification or final settlement. Do not conflate the two just because the old frozen GM prompt says \"moves territory\".\n\n[GM Geographic Completeness — LIVE 8B.2.10]\nTerritorial narration and structured operations must agree PLACE BY PLACE, not merely in aggregate. If an authored event says control is established, expanded, consolidated, seized, occupied, liberated or retaken in several named cities/areas, emit a matching regionControlOps operation for EVERY named place whose map region actually changes control. Never narrate \"Płock, Częstochowa and Warsaw\" while emitting only two control operations. For a city-grounded change, put the actual city name in regionId/regionName or the exact rendered region id/name when known; native validation will map the city point to the rendered region and will reject an incomplete preview rather than silently dropping the city. One operation must describe one intended place: never reuse a nearby city's rendered region for a different named city, and never let event-wide prose substitute for the operation's own geographic target.\n\n[GM Physical-World Completeness — LIVE 10.1B]\nCURRENT MAP STRUCTURES is canonical persistent physical state, including stable marker ids and lifecycle status. For EVERY authored GM event, silently audit whether the prose establishes a significant named geographically concrete physical feature that persists beyond the event OR materially changes an existing supplied feature. If YES, the SAME event MUST contain the matching impacts.markerOps mutation. BUILD only a genuinely new feature. UPDATE the SAME existing markerId for major expansion/completion, capture or operator change, conversion, damage, abandonment, reconstruction, or destruction. RENAME preserves identity. REMOVE is only true canonical deletion/admin cleanup — historical destruction is status=destroyed and the marker remains in canon. Use status literally: planned before work, under_construction once construction has begun, active once operational, damaged after material damage, inactive when out of service, abandoned when left behind, destroyed when physically destroyed. A catastrophic explosion that leaves a damaged site therefore MUST update that existing marker to status=damaged; reconstruction later updates the SAME id toward under_construction/active. If a supplied feature merely participates without changing, reference its exact canonical name naturally but emit no markerOp. Never create marker filler merely because this audit exists.\n\n[Current Non-Normal Territorial State]\n${normalizeString(variables.territorialControlContext) || "No active occupations or contested regions recorded."}`;
  }

  if (["actions", "jumpForward", "autoJumpForward", "interactiveCreation", "interactiveExecutor"].includes(taskKey)) {
    const reputationContext = normalizeString(variables.playerPolityReputationContext);
    if (reputationContext) {
      systemPrompt = `${systemPrompt}\n\n[International Reputation]\n${reputationContext}\nLow international reputation should reduce trade, trust, and coalition support, and should make nearby rivals more likely to sanction, isolate, or form balancing alliances. High reputation should improve access, trust, and coalition-building. When events this turn change how the world regards a polity, record the new value by including a "reputation" field (an integer 0-100) on that polity's impacts.polityChanges entry: aggression, broken treaties, and atrocities lower it; cooperation, aid, and honored commitments raise it. Only include reputation when it actually changes.`;
    }
  }

  // Espionage's counterpart to the reputation block above. Without it the rating
  // is invisible to the model and therefore frozen for the whole campaign.
  if (["actions", "jumpForward", "autoJumpForward", "interactiveCreation", "interactiveExecutor"].includes(taskKey)) {
    const intelligenceContext = normalizeString(variables.playerPolityIntelligenceContext);
    if (intelligenceContext) {
      systemPrompt = `${systemPrompt}\n\n[Intelligence Services]\n${intelligenceContext}\nThis rating is how much of other polities' private diplomacy a service can read and how well it protects its own, and it moves the same way international reputation does. When this turn's events actually change what a service is capable of, record the new ABSOLUTE value (an integer 0-100) in an "intelligence" field on that polity's impacts.polityChanges entry. Concrete investment the player has ordered and that this turn actually delivers raises it a few points at a time — a training academy opening its doors, a new bureau or directorate standing up, a funding increase taking effect, a recruitment or codebreaking programme bearing fruit; a purge, a mass defection, a network rolled up by a rival, or deep cuts lower it. An intention is not a capability: do not move it for an order that has only just been given, do not restate it when nothing changed, and do not jump it by tens of points for a single measure.`;
    }
  }

  if (customFullStatSheet) {
    systemPrompt = `${systemPrompt}

[Scenario National Stats Sheet — LIVE]
This scenario REPLACES Open Historia's standard modern National Stats sheet with a scenario-defined sheet. Do not invent or maintain hidden modern GDP, unemployment, debt, population, stability, or strategic-index fields unless they are explicitly defined below. Every listed value is persistent campaign canon and uses its exact machine key. Values are ABSOLUTE, never deltas. On ordinary turns update only values that genuinely changed; for the countryStatSheet task return every defined value.

${describeStatSheetDefinition(statSheetDefinition)}

Formatting prefixes/suffixes are display metadata only; return plain JSON numbers. Respect each value's declared min/max range and meaning.`;
  } else if (customStatIndices) {
    systemPrompt = `${systemPrompt}

[Scenario Strategic Indices — LIVE]
This scenario replaces the standard strategic indices with EXACTLY these indices, each as an integer from 0 to 100:
${describeStatIndexRows(statIndexRows)}
Use these exact machine keys whenever you author stats.indices. Do not invent default modern indices that are not listed here, and do not invent extra keys.`;
  }

  if (taskKey === "countryStatSheet" && !customFullStatSheet) {
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
- economicCalibration.nominalGdpBillions and nominalGdpPerCapita must describe the SAME territorial scope, and that scope must be the ENTIRE authoritative live Stats basis above - not merely the metropolitan/core state. Native code audits their implied population against the authoritative live baseline when mode=historical_start.
- For empires, federations, composite monarchies, colonial systems, or other mixed territorial polities, NEVER substitute a metropole-only headline GDP/GDP-per-capita anchor for the whole live polity. If no single same-scope historical aggregate exists, construct a defensible same-scope nominal anchor from the supplied regional/macro territorial evidence and say that explicitly in basis.
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
- A genuinely uninhabited bucket may be returned as index~group~0~0. Native code treats that as zero population and zero GDP; do NOT invent inhabitants merely to keep GDP/capita positive.
- index MUST be the supplied macro integer. Do not return province-by-province rows. Do not add, omit, split, or merge macro buckets.
- NON-TERRITORIAL COMPATIBILITY: if the authoritative basis explicitly says NON-TERRITORIAL and no mapped macro buckets exist, territorialMacroComponentsText may use group~geography~population~gdpPerCapita rows ONLY for a genuinely campaign-supported distributed people, organization, workforce, exile community, or other non-map economic/demographic scope. If no defensible quantitative scope exists, return exactly NONE. Never invent a fake province, population, or GDP merely to satisfy the schema.
- Allowed group values: core | integrated | overseas/dependent.
- Estimate each macro bucket from its listed components or representative places, spatial center, scenario canon, and any prior macro baseline. Prefer checkable regional magnitudes over a single historical whole-country headline total.
- A component marked PARTIAL is only part of that country: the polity holds just the listed regions. Estimate ONLY their population and economy — never the whole country the component is named after.
- Do NOT force the macro-bucket sum to a remembered country/empire headline. A historical headline is usable only as a cross-check when its territorial definition exactly matches the live macro scope; otherwise the regional estimates win.
- The SUM of macro-bucket populations becomes the national population. Native JavaScript expands each macro estimate deterministically back across ALL exact live-map components, preserving prior local proportions where a campaign ledger already exists.
${buildStatsComponentSplitContract(variables?.statsComponentSplitBuckets)}- Do not give colonies, dependencies, peripheral territories, or poorer constituent regions metropolitan productivity by default.
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
    if (isActiveFeatureEnabled("espionage")) {
      systemPrompt = `${systemPrompt}\n\n${buildSpyOrdersDirective(normalizeString(variables?.playerPolity) || "the player")}`;
    }
  }

  // The scenario briefing and simulation rules each arrive twice on most
  // prompts: once from the task text's own placeholder and again inside the
  // world summary. On a real campaign the briefing alone is ~108k characters
  // sent twice, about a third of a jump prompt. Collapsed here rather than in
  // the templates because existing saves carry frozen copies, and some tasks
  // reach them ONLY through the world summary - removing them there would take
  // them from those tasks entirely.
  systemPrompt = collapseRepeatedWorldContext(systemPrompt, variables);

  // Lookup functions: tell the model they exist and what they are for. Last,
  // so it stands next to the output contract rather than under the campaign.
  if (Array.isArray(lookups?.tools) && lookups.tools.length) {
    systemPrompt = `${systemPrompt}\n\n${LOOKUP_DIRECTIVE}`;
  }

  // The scenario author's direction (worldDirection.js), and LAST of all: the end
  // of a long prompt is what a model follows best, and the priority rules are
  // meant to outrank everything above them. By default it is one paragraph, the
  // world's share; with world direction switched off it is nothing, and the
  // prompt is what it always was.
  // The player's standing goal (runtime/playerGoal.js): how the player's own
  // government conducts what their orders did not cover. Before the author's
  // direction, which outranks it like every other default.
  if (PLAYER_GOAL_TASKS.has(taskKey)) {
    const block = await playerGoalBlock(normalizeString(variables?.playerPolity));
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  }

  if (["jumpForward", "autoJumpForward"].includes(taskKey)) {
    // The player's focus (playerFocus.js), then the author's direction. Both are
    // appended here rather than rendered into the template, so a campaign's own
    // edited guidance can neither remove them nor starve them of room. Where the
    // two shares together ask for more than the whole period, the world's share
    // is the one that gives way (docs/adr/0003).
    const focusDirective = normalizeString(variables?.playerFocusDirective);
    if (focusDirective) systemPrompt = `${systemPrompt}\n\n${focusDirective}`;
    const direction = getActiveWorldDirection();
    // The world's share as the focus left it (the segment works both out together).
    const worldShare = Number.isFinite(Number(variables?.playerFocusWorldShare))
      ? Number(variables.playerFocusWorldShare)
      : direction?.worldShare;
    const directionDirective = buildWorldDirectionDirective(
      direction ? { ...direction, worldShare } : direction,
      {
        playerPolity: normalizeString(variables?.playerPolity),
        spanDays: computeSimulatedDays(variables) || 30,
      },
    );
    if (directionDirective) systemPrompt = `${systemPrompt}\n\n${directionDirective}`;
  }

  // The Game Master's standing reminders (runtime/gmChanges.js), for every task
  // that writes the world or speaks for a polity. After the author's priority
  // rules: a fact the GM declared mid-game is newer than any rule written before
  // the game began. Nothing at all while there are none.
  if (reminders && GM_REMINDER_TASKS.has(taskKey)) {
    const block = await gmRemindersBlock();
    if (block) systemPrompt = `${systemPrompt}\n\n${block}`;
  }

  // The scenario's stats contract, loaded above for the prompt; runJsonTask
  // picks the tool and checks the answer by it.
  const statContract = { statSheetDefinition, customFullStatSheet, customStatRows, customStatKeys, statIndexRows, statIndexKeys, customStatIndices };
  return { prompts, promptTemplate, staticPromptPrefix, systemPrompt, statContract };
};

// Who is shown the reminders. Left out: the tasks that only reshape text
// (translation, consolidation, place names, the pre-game bootstrap) or only
// describe a polity's figures.
const GM_REMINDER_TASKS = new Set([
  "jumpForward",
  "autoJumpForward",
  "worldMotionRepair",
  "worldBreadthRepair",
  "timelineCurator",
  "unitDirector",
  "territoryDirector",
  "structureDirector",
  "projects",
  "gameMaster",
  "actions",
  "idleDiplomacy",
  "interactiveCreation",
  "interactiveExecutor",
  "spyIntercept",
  "chatActions",
]);

// Read from the stored world as it is, without normalizing the rest of it: a
// reminder is edited in the cheats panel, which writes the world, and the next
// prompt sees the new list.
const gmRemindersBlock = async () => {
  const raw = await readJson(JSON_URLS.world, { defaultValue: {}, clone: false }).catch(() => null);
  return renderReminders(normalizeReminders(raw?.simulationReminders), { formatDate: formatDateReadable });
};

// Who is told the player's standing goal: the time skip and the repairs that
// add to its answer. Never a leader's task — a government's aims are its own
// (the advisor is told it in main.jsx, the suggestions in their request).
const PLAYER_GOAL_TASKS = new Set(["jumpForward", "autoJumpForward", "worldMotionRepair", "worldBreadthRepair"]);

// Read like the reminders: set in the Actions panel, which writes the world.
const playerGoalBlock = async (playerPolity) => {
  const [raw, game] = await Promise.all([
    readJson(JSON_URLS.world, { defaultValue: {}, clone: false }).catch(() => null),
    playerPolity ? null : readJson(JSON_URLS.game, { defaultValue: {}, clone: false }).catch(() => null),
  ]);
  const player = playerPolity || normalizeString(game?.country);
  return describeGoalForSimulation(playerGoalOf(raw, player), player);
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
  // Lookup functions for this task (buildTaskLookups): { tools, execute,
  // maxRounds? }. Declared beside the output function on every provider; the
  // model's calls are answered inside callAI and the answers go back as the
  // next turns of the same conversation (main.jsx runWithLookups).
  lookups = null,
  // Some request classes need the task validator but must not expose the task's
  // normal output function declaration to the provider. `undefined` keeps the
  // task default; explicit `null` means raw JSON text only. Lifecycle membership
  // negotiations use this escape hatch because Gemini has proven fragile around
  // the already-wide submit_chat_actions declaration, while native validation
  // still checks the exact same CHAT_ACTIONS_SCHEMA after parsing.
  toolOverride = undefined,
  // The request budget (requestBudget.js). `budget` is the time skip this task
  // belongs to and `spender` who it is within it: each attempt asks the budget
  // first, and a refusal ends the task the way a failure would (its fallback, or
  // an earlier answer salvaged) rather than making the request. `requestKind`
  // marks a call the player did not ask for, and `onRequest` hears every
  // provider response the task causes, so a skip can say what it cost.
  budget = null,
  spender = "",
  requestKind,
  onRequest,
  // A task whose answer is worth a second request even while requests are being
  // saved: it keeps strict-then-retry. For something asked once per campaign and
  // built on for the rest of it, not for anything asked every turn.
  strictFirst = false,
  // The answer's events as the model writes them (streamedEvents.js): every
  // complete event this attempt has produced, and an empty list when an attempt
  // begins. A preview only, through no validator. Only a time skip passes it.
  onPartialEvents = null,
}) => {
  const { prompts, promptTemplate, staticPromptPrefix, systemPrompt, statContract } = await buildTaskSystemPrompt(taskKey, { variables, lookups });
  const { customFullStatSheet, customStatRows, statIndexRows, statIndexKeys, customStatIndices } = statContract;

  // Batch routing (see the parameter): a deferred task leaves here with no
  // answer and no attempt loop; its result arrives through pollPendingBatches.
  if (!sync && typeof onBatchResult === "function" && batchBackgroundTasksEnabled()) {
    const batchTool = customFullStatSheet
      ? getGameplayToolForCustomStatSheet(taskKey, customStatRows, { custom: true })
      : getGameplayToolForStatIndices(taskKey, statIndexRows, { custom: customStatIndices });
    if (batchTool && providerSupportsBatch(taskKey)) {
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
  const defaultTool = customFullStatSheet
    ? getGameplayToolForCustomStatSheet(taskKey, customStatRows, { custom: true })
    : getGameplayToolForStatIndices(taskKey, statIndexRows, { custom: customStatIndices });
  const tool = toolOverride !== undefined ? toolOverride : defaultTool;
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
  // The call found no model whose context window takes this request
  // (contextWindow.js): kept so a time skip can refuse rather than go canned.
  let tooBigForEveryModel = null;
  // While requests are being saved (requestBudget.js) the FIRST answer is judged
  // the way the last one always was: the task validator repairs it in place
  // instead of sending it back, and a fault the schema names is cut out
  // (schemaSalvage.js) instead of failing the whole answer. A second request is
  // made only when there is nothing usable to keep. The model still learns what
  // was dropped or changed — the jump's application receipt tells it at the top
  // of the next turn — it just does not cost the player a request to say so.
  const salvageFirst = savingRequests() && !strictFirst;
  // What schema salvage cut out of the answer that was finally taken.
  let removedFromAnswer = [];

  try {
    for (let outputAttempt = 1; outputAttempt <= 2; outputAttempt += 1) {
      // The skip's budget is asked before every request. A refused FIRST attempt
      // means the skip has nothing left for this task at all; a refused retry
      // leaves whatever the first answer can still give (the salvage pass below).
      if (budget && !budget.take(outputAttempt === 1 ? (spender || taskKey) : `${spender || taskKey}Retry`)) {
        const spent = `this time skip has used its ${budget.cap} requests`;
        failureReason = outputAttempt === 1 ? `Not asked: ${spent}.` : `${failureReason} Not asked again: ${spent}.`;
        logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt} not made: ${spent}.`, { spends: budget.log }, { verbose: true });
        break;
      }
      const lastChance = outputAttempt === 2 || salvageFirst;
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
      // What the AI was actually given, as sizes and hashes rather than the
      // prompt itself: rebuild the prompt from the save, fingerprint it, and a
      // mismatch names the section that differed (contextDiagnostics.js). Only
      // computed in detailed mode — hashing a jump's prompt is cheap but not
      // free, and the entry is dropped otherwise.
      if (isDebugLogVerbose()) {
        logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt} prompt fingerprint.`, buildPromptFingerprint({
          history,
          promptTemplate,
          systemPrompt,
          userMessage,
          variables,
        }), { verbose: true });
      }
      // Telemetry: the record for THIS attempt comes back through the sink, so
      // the validation outcome below lands on the call that produced it.
      const attemptSink = {};
      // One reader per attempt: a rejected attempt's events leave the panel when the next starts.
      const streamed = [];
      const eventReader = typeof onPartialEvents === "function"
        ? createStreamedEventReader({
          // An index below what is held means the stream restarted: one attempt
          // can produce several, since a busy provider retries in place and the
          // Fallback list moves to the next entry, and the abandoned answer's
          // events must not sit above the real one's. Anything else appends.
          // Never written AT the index: the reader numbers every element it
          // closes, including one it could not parse, so the indexes it hands
          // out can skip. Assigning to those would leave a hole in the array,
          // and the panel builds its record straight off it.
          onEvent: (event, { index }) => {
            if (index < streamed.length) streamed.length = index;
            streamed.push(event);
            try { onPartialEvents(streamed.slice()); } catch { /* a preview listener must never cost a turn */ }
          },
        })
        : null;
      if (eventReader) {
        try { onPartialEvents([]); } catch { /* as above */ }
      }
      let response;
      try {
        response = await callAI(systemPrompt, history, {
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
          // Lookup rounds re-evaluate the prompt, so each one restarts the long
          // first-byte window rather than being timed as a stalled answer.
          lookups: Array.isArray(lookups?.tools) && lookups.tools.length
            ? { ...lookups, onRound: () => { idle.cancel(); idle.start(); } }
            : null,
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
          ...(requestKind ? { requestKind } : {}),
          ...(typeof onRequest === "function" ? { onRequest } : {}),
          // The arguments as they assemble (streamAssembly.js). A lookup round's
          // call is ignored by name, so only the answer itself is read.
          ...(eventReader ? {
            onToolStream: (progress) => {
              if (progress?.name && tool?.name && progress.name !== tool.name) return;
              if (typeof progress?.json === "string") eventReader.pushJson(progress.json);
              else if (progress?.args) eventReader.pushArgs(progress.args, progress.paths);
            },
          } : {}),
        });
      } catch (error) {
        // No finish() here: an attempt that never answered has nothing to release.
        // The provider refused inside the stream and gave no answer at all
        // (providerErrors.js toolStreamRefusalError). There is nothing to correct,
        // so the second attempt is a plain re-ask — after a real pause when it
        // said it was busy, since its own quick retry has already failed — and
        // not the canned fallback. Anything else still ends the task as before.
        if (outputAttempt !== 1 || !error?.providerRefusal || controller.signal.aborted) throw error;
        idle.cancel();
        failureReason = normalizeString(error.message) || failureReason;
        const pauseMs = error.providerRefusal.busy ? BUSY_PROVIDER_TASK_PAUSE_MS : 0;
        logDebugEvent("ai", `Task "${taskKey}" attempt 1 got no answer: the provider refused.`, {
          provider: error.providerRefusal.detail || "(no message)",
          busy: error.providerRefusal.busy,
          retryInMs: pauseMs,
        }, { verbose: true });
        if (pauseMs) await abortableWait(pauseMs, controller.signal);
        continue;
      }
      // This attempt is answered: stop counting silence against it. Validation,
      // salvage and the retry's own prompt evaluation all happen with nothing on
      // the wire, and leaving the window armed across them would have attempt
      // 1's clock abort a perfectly healthy attempt 2. The next answer re-arms it.
      idle.cancel();
      // Releases the last event, which a path stream holds back until the stream closes.
      eventReader?.finish();
      const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
      // A tool-call answer has no text of its own (Gemini sends the call with
      // no text parts), so the call's input IS the answer. Kept as such, or the
      // debug report the player copies says the provider produced nothing when
      // the model produced a whole turn that then failed validation.
      lastRawText = rawText || (response?.toolInput ? JSON.stringify(response.toolInput) : "");
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
      } else if (taskKey === "pregameHistory" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const decoded = decodePregameHistoryTransportPayload(parsed);
        transportDecodeError = normalizeString(decoded?.error);
        parsed = decoded?.payload;
      }
      // Lenient jump shapes (gameplaySchemas.js normalizeGameplayPayload): an
      // envelope, a singular event, synonym keys, doubled impacts wrappers —
      // rewritten to the canonical shape before the schema sees them.
      // It also drops the `interactive event` a time skip no longer proposes.
      parsed = normalizeGameplayPayload(taskKey, parsed);
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
      let statsSplitError = "";
      if (taskKey === "countryStatSheet" && !customFullStatSheet && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const macroPlan = normalizeArray(variables?.statsTerritorialMacroPlan);
        const decoded = decodeCountryStatMacroEstimates(
          parsed.territorialMacroComponentsText ?? parsed.territorialComponentsText,
          macroPlan,
        );
        statsCoverageError = normalizeString(decoded?.error);
        let components = decoded?.components || [];

        // The per-component split, when generateCountryStatSheet asked for one
        // (countryStats.js decodeTerritorialComponentSplit). A bucket whose rows do
        // not validate is sent back once with the reason; on the final attempt it
        // keeps the native weights, is not recorded as split, and is asked again at
        // its next assessment.
        const splitBuckets = normalizeArray(variables?.statsComponentSplitBuckets);
        let componentSplits = null;
        let splitGeographies = [];
        if (splitBuckets.length && macroPlan.length > 0 && !statsCoverageError) {
          const { splits, rejected } = decodeTerritorialComponentSplit(parsed.territorialComponentSplitText, splitBuckets);
          const rejectedText = rejected.map((entry) => `M${entry.index}: ${entry.reason}`).join("; ");
          if (rejected.length && !lastChance) {
            statsSplitError =
              `territorialComponentSplitText must give every listed component exactly one componentId~sharePercent~group~gdpPerCapita row, and each bucket's shares must sum to 100 (${rejectedText}).`;
          } else {
            if (rejected.length) {
              console.warn(
                `[stats split] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: per-component split rejected (${rejectedText}); `
                  + "those bucket(s) keep the native weights this time and will be asked for a split again.",
              );
            }
            componentSplits = splits;
            splitGeographies = [...splits.values()].flat().map((entry) => entry.geography);
          }
        }

        if (!statsCoverageError && macroPlan.length > 0) {
          const expanded = expandTerritorialMacroEstimates(
            macroPlan,
            decoded?.estimates || [],
            {
              previousComponents: variables?.statsPreviousTerritorialComponents,
              componentSplits,
              splitGeographies: variables?.statsStoredSplitComponents,
            },
          );
          statsCoverageError = normalizeString(expanded?.error);
          if (!statsCoverageError) components = expanded.components;
        }

        const calibrationRequested = Boolean(variables?.statsPopulationCalibrationRequested);
        let calibration = parsed.populationCalibration;
        if (calibrationRequested && (calibration === undefined || calibration === null)) {
          const resolvedCalibration = resolveCountryStatsPopulationCalibration(
            calibration,
            parsed.economicCalibration,
          );
          calibration = resolvedCalibration.calibration;
          if (resolvedCalibration.synthesized) {
            parsed.populationCalibration = calibration;
            console.warn(
              `[stats 8B.2.18.2] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: ` +
                "provider omitted populationCalibration provenance; recovered its scenario-causality frontier from economicCalibration. " +
                "Regional macro estimates remain the numeric authority.",
            );
          }
        }
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
          const nominalScaleNormalization = normalizeNearBoundaryHistoricalNominalScale({
            calibration: economicCalibration,
            components,
            currentDate: variables?.statsEconomicCalibrationCurrentDate,
          });
          if (nominalScaleNormalization.adjusted) {
            components = nominalScaleNormalization.components;
            console.warn(
              `[stats nominal baseline] ${normalizeString(variables?.statsCalibrationTargetName) || "polity"}: ` +
                `normalized near-boundary historical GDP/capita drift from ${nominalScaleNormalization.beforeRatio.toFixed(2)}x to ` +
                `${nominalScaleNormalization.afterRatio.toFixed(2)}x of the audited nominal anchor ` +
                `(uniform component factor ${nominalScaleNormalization.factor.toFixed(3)}x).`,
            );
          }
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
          territorialComponentSplitText: _territorialComponentSplitText,
          ...statFields
        } = parsed;
        const plannedComponentCount = normalizeArray(variables?.statsTerritorialPlan).length;
        const territorialScope = normalizeString(variables?.statsTerritorialBasisMode) === "nonterritorial"
          ? "nonterritorial"
          : "mapped";
        parsed = finalizeCountryStatSheet({
          ...statFields,
          territorialScope,
          territorialComponents: components,
        }, customStatIndices ? { indexKeys: statIndexKeys } : undefined);
        // Keyed by the payload itself: the answer runJsonTask returns may be an
        // earlier attempt's (the salvage pass), and only that answer's split counts.
        variables?.statsComponentSplitOutcome?.set?.(parsed, splitGeographies);

        const finalizedComponentCount = normalizeArray(parsed?.territorialComponents).length;
        if (!statsCoverageError && plannedComponentCount > 0 && finalizedComponentCount !== plannedComponentCount) {
          statsCoverageError =
            `Native Stats normalization dropped authoritative territorial components: expected ${plannedComponentCount}, finalized ${finalizedComponentCount}.`;
        }
      }
      let validation = parsed
        ? (taskKey === "countryStatSheet" && customFullStatSheet
          ? { valid: true, error: "" }
          : validateGameplayPayload(taskKey, parsed))
        : { valid: false, error: "Response did not contain parseable JSON or tool arguments." };
      // The scenario's stats contract, once the schema passes (validateStatContract).
      if (validation.valid && parsed) {
        const contractError = validateStatContract(taskKey, parsed, statContract);
        if (contractError) validation = { valid: false, error: contractError };
      }
      // What the salvage validates against: the schema and the scenario's stats
      // contract, so an answer is saved by leaving out a bad stats block too.
      const checkAnswer = (candidate) => {
        const verdict = taskKey === "countryStatSheet" && statContract.customFullStatSheet
          ? { valid: true, error: "" }
          : validateGameplayPayload(taskKey, candidate);
        if (!verdict.valid) return verdict;
        const contractError = validateStatContract(taskKey, candidate, statContract);
        return contractError ? { valid: false, error: contractError } : verdict;
      };
      // A fault the schema can point at is cut out rather than costing the whole
      // answer (schemaSalvage.js) — but only once nothing better is coming: while
      // a retry remains and requests are not being saved, the model is told and
      // fixes its own answer, as it always has. The GM's transaction is left
      // alone: half a transaction is not a smaller transaction.
      let removedThisAttempt = [];
      if (!validation.valid && parsed && lastChance && taskKey !== "gameMaster" && !transportDecodeError) {
        // On a copy: an answer that cannot be saved goes back to the model as it
        // wrote it, not half taken apart.
        const salvaged = salvageBySchema(cloneValue(parsed), checkAnswer, {
          describe: (candidate, path) => (path[0] === "events" && typeof path[1] === "number"
            ? `"${normalizeString(candidate?.events?.[path[1]]?.title) || `event ${path[1] + 1}`}"`
            : ""),
        });
        if (salvaged.valid && salvaged.removed.length) {
          parsed = salvaged.value;
          removedThisAttempt = salvaged.removed;
          validation = { valid: true };
          logDebugEvent("ai", `Task "${taskKey}" attempt ${outputAttempt}: ${salvaged.removed.length} malformed part(s) left out instead of asking again.`, salvaged.removed, { verbose: true });
        }
      }
      if (validation.valid && (statsCoverageError || statsCalibrationError || statsEconomicCalibrationError || statsSplitError)) {
        validation = {
          valid: false,
          error: [statsCoverageError, statsCalibrationError, statsEconomicCalibrationError, statsSplitError].filter(Boolean).join(" "),
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
        // While requests are being saved the first answer IS the last chance
        // (salvageFirst above), so it is repaired here rather than sent back.
        const taskError = normalizeString(
          await validatePayload(parsed, { attempt: outputAttempt, finalAttempt: lastChance }),
        );
        if (taskError) validation = { valid: false, error: taskError };
      }

      if (validation.valid) {
        removedFromAnswer = removedThisAttempt;
        // Native-only metadata: custom scenario sheets need to remember which
        // strategic indices constitute a complete sheet. Attach this only AFTER
        // provider/schema/task validation so the model never authors or alters it.
        // Mutate the accepted object rather than cloning it because Country Stats
        // uses the payload object as a WeakMap key for component-split outcomes.
        if (taskKey === "countryStatSheet" && customStatIndices && parsed && typeof parsed === "object") {
          parsed.indexKeys = [...statIndexKeys];
        }
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
        return { generation: { source: "ai", fallbackReason: "" }, payload: parsed, removed: removedFromAnswer };
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
        rawResponse: lastRawText,
      }, { verbose: true });

      failureReason = validation.error;
      if (!firstFailureReason) firstFailureReason = validation.error;
      if (schemaValid && !salvageCandidate) {
        salvageCandidate = parsed;
        removedFromAnswer = removedThisAttempt;
      }
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
    if (actualError?.providerFailure?.kind === "tooBig") tooBigForEveryModel = actualError;
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
    // Always recorded, not only in detailed mode: a task that failed is what a
    // report is about, so it is also a problem for View log's "problems only".
    // The error itself carries the stack — one frame normally, a real call path
    // in detailed mode.
    logDebugEvent("ai", `Task "${taskKey}" failed${controller.signal.aborted ? " (aborted)" : ""}: ${failureReason}`, actualError instanceof Error ? actualError : undefined, { problem: true });
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

  // The request does not fit any model the player has (contextWindow.js). A
  // canned turn would hide that behind fallback events skip after skip, and
  // write them into the game's history; the time skip refuses instead, and the
  // message says which model to pick. Every other task keeps its harmless
  // "unavailable" fallback.
  if (tooBigForEveryModel && ["jumpForward", "autoJumpForward"].includes(taskKey)) {
    throw tooBigForEveryModel;
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
        return { generation: { source: "ai", fallbackReason: "" }, payload: salvageCandidate, removed: removedFromAnswer };
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
  // or flood the console. Surfaced to the player through the "Save logging
  // file" button next to the fallback warning (time.jsx), which attaches it to
  // the saved log — that button, not DevTools, is the primary way this reaches
  // anyone now.
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

// When a pass is due, what it folds and what stays in full: HISTORY_CONSOLIDATION
// and planHistoryConsolidation in historyConsolidation.js.

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
// `hiddenEvents` are Canonical events the timeline cleanup kept off the timeline
// (routine, low-value, already covered). They still happened, and routine
// progress is exactly what moves a standing Operation, so the Board reads them:
// numbered after the visible events, and marked, so a lastUpdate written from one
// does not point the player at a timeline card that is not there.
// The board's ops when the turn review already asked for them (runTurnReview).
// `skipped` is what it is for generateProjectOps below: the board was not looked
// at, so nothing on it moves and nothing is proven against it.
const reviewedProjectOps = ({ review, visibleEvents, hiddenEvents, idMap }) => {
  const part = review?.parts?.board;
  if (!part) return { ops: [], skipped: true };
  const { ops, dropped } = remapBoardOps({
    ops: part.projectOps,
    shownEvents: review.boardShownEvents,
    visibleEvents,
    hiddenEvents,
    idMap,
  });
  if (dropped) {
    logDebugEvent("turn", `Projects board: ${dropped} op(s) dropped because the event they rested on was withheld from the record.`, undefined, { verbose: true });
  }
  return { ops, skipped: false };
};

const generateProjectOps = async (bundle, events, { signal, hiddenEvents = [], requests = null } = {}) => {
  const board = normalizeArray(bundle.world?.projects);
  const hidden = normalizeArray(hiddenEvents);
  // Nothing to keep in step, and nothing an event could plausibly open against
  // an empty board that is worth a whole extra request.
  if (board.length === 0 || (events.length === 0 && hidden.length === 0)) return { ops: [], skipped: true };

  const variables = await buildTemplateVariables(bundle, { lookups: true });
  // The events, numbered, because eventIndex is how an op says which one moved
  // the effort. Impacts are deliberately left out: this call decides what the
  // STORY did to the board, and the other levers are noise for that question.
  const eventList = [
    ...events.map((event, index) => `[${index}] ${event.date || "undated"} — ${event.title}\n${event.description}`),
    ...hidden.map((event, index) =>
      `[${events.length + index}] ${event.date || "undated"} — ${event.title} (kept off the timeline)\n${event.description}`),
  ].join("\n\n");
  const hiddenNote = hidden.length
    ? "\n\nEvents marked (kept off the timeline) happened, but were too routine to show the player as a card. "
      + "Move the board from them exactly like any other event, and write lastUpdate so it stands on its own "
      + "without pointing at a timeline entry."
    : "";

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
    lookups: buildTaskLookups(bundle),
    signal,
    ...jumpTaskOptions(requests, "review"),
    userMessage:
      `These events have just been simulated. Move the board to match them, and return `
      + `{"projectOps":[]} if nothing on it genuinely moved.${BOARD_MILESTONE_NOTE}${hiddenNote}\n\n${eventList}${doubtBlock}`,
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
  const heldProjectsJump = getPendingProjectsJump();
  if (!heldProjectsJump) throw new Error("There is no turn waiting on the Projects board.");
  const { applyArgs } = heldProjectsJump;
  beginSimulation();
  try {
    // Released BEFORE the attempt, so a turn can never be applied twice, and
    // re-held only if the BOARD fails again — a failure after that point is a
    // different situation and must not pretend otherwise.
    setPendingProjectsJump(null);
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
      setPendingProjectsJump({ applyArgs });
    }
    throw error;
  } finally {
    endSimulation();
  }
};

// The newest turn's record lists the events that turn produced, and time.jsx
// renders a turn from exactly that list, so anything added to or taken out of
// the turn after the record was built (espionage's events, an unbacked
// provisional event) has to be reflected here too.
const withLatestTurnEventIds = (world, rewrite) => {
  const [turnEntry, ...olderTurns] = normalizeArray(world?.simulationHistory);
  if (!turnEntry) return world;
  return {
    ...world,
    simulationHistory: [{ ...turnEntry, eventIds: rewrite(normalizeArray(turnEntry.eventIds)) }, ...olderTurns],
  };
};

// Whether an event stands on a consequence of its own, not only on the Board.
// Checked on the merged turn rather than trusted from the segment check, because
// the unit and territory directors add ops to events after it; spy orders and
// resolved player orders count too — hiding such an event would leave what it
// did applied with nothing on the timeline to say so.
const OWN_CONSEQUENCE_IMPACTS = [
  "regionTransfers", "regionClaims", "regionControlOps", "polityChanges", "politicalActorOps",
  "createdChats", "unitOps", "markerOps", "spyOps", "institutionLifecycleOps", "actionIds",
];
const eventCarriesOwnConsequence = (event) =>
  OWN_CONSEQUENCE_IMPACTS.some((key) => normalizeArray(event?.impacts?.[key]).length > 0)
  || normalizeArray(event?.storylineIds).length > 0
  || Boolean(normalizeString(event?.warId));

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

const consolidateHistoryBatch = async (bundle, events, chats, actions = [], { onBatchResult, onRequest } = {}) => {
  // The document this pass revises, and the revision it was read at: a pass
  // that lands against a different revision (a hand edit in the meantime)
  // appends rather than overwrites (applyHistoryDocumentUpdate).
  const baseRevision = normalizeWorldState(bundle.world).historyDocument?.revision ?? 0;
  const historyDocumentContext = buildHistoryDocumentDirective(bundle.world);
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
    // The deterministic digest cannot judge importance, so it carries no
    // document: the pass appends it to the document instead of rewriting.
    fallback: () => ({
      document: "",
      summary: [
        events.map((event) => `${event.date || "undated"} ${event.title}: ${event.description}`).join("; "),
        buildChatSummaryText(chats, { limit: chats.length || 1 }),
        actions.length ? `Player orders resolved: ${actions.map((action) => action.title).join("; ")}` : "",
      ].filter(Boolean).join("\n"),
    }),
    userMessage: "Consolidate the supplied campaign history with the required tool.",
    ...(typeof onRequest === "function" ? { onRequest } : {}),
    variables: { ...variables, historyDocumentContext },
    // Off the critical path when the caller supplies an applier: the summary
    // may land later through the batch poller.
    sync: typeof onBatchResult !== "function",
    onBatchResult,
  });
  if (deferred) return { deferred: true, generation, summary: "", document: "", baseRevision };
  return {
    generation,
    summary: normalizeString(payload?.summary),
    document: normalizeString(payload?.document),
    baseRevision,
  };
};

// Consolidation never edits the event log: a pass appends its record to
// world.consolidatedHistory (whose throughEventId is the boundary the prompt
// reads from, getUnconsolidatedEvents) and rewrites the living history document
// the AI is shown in place of the folded events. Every event stays in the save.
const compactHistoryIfNeeded = async (bundle, { force = false, requests = null } = {}) => {
  const world = normalizeWorldState(bundle.world);
  // What to fold — the thresholds, the retained tail, the closed chats and the
  // resolved orders riding along — is the planner's call, shared with the
  // Cheats tool and the tests.
  const { eventsToConsolidate, closedChats, actionsToConsolidate, throughEvent } = planHistoryConsolidation(bundle, { force });

  if (eventsToConsolidate.length === 0 && closedChats.length === 0) return world;
  // The skip's budget is asked HERE, not inside the task: a refused task falls
  // back to its deterministic digest, and folding history with a digest is
  // permanent — those events are never shown to the simulator again. Refused,
  // the fold simply waits; it is due again on the next skip.
  if (requests && !requests.budget.take("history")) {
    logDebugEvent("turn", `History consolidation put off: this time skip has used its ${requests.budget.cap} requests. It is due again next skip.`, {
      events: eventsToConsolidate.length,
      chats: closedChats.length,
    });
    return world;
  }
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
  const { generation, summary, document, baseRevision } = await consolidateHistoryBatch(
    bundle,
    eventsToConsolidate,
    closedChats,
    actionsToConsolidate,
    {
      onRequest: jumpTaskOptions(requests, "history").onRequest,
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
        const entry = entryFor(summaryText, source, currentWorld.consolidatedHistory);
        const documentUpdate = applyHistoryDocumentUpdate(currentWorld, {
          document: resultPayload?.document,
          summary: summaryText,
          source,
          throughDate: entry.throughDate,
          throughEventId: entry.throughEventId,
          throughRound: entry.throughRound,
          baseRevision,
        });
        await writeWorldState(normalizeWorldState({
          ...currentWorld,
          consolidatedHistory: [...currentWorld.consolidatedHistory, entry],
          historyDocument: documentUpdate.historyDocument,
        }));
        logDebugEvent("ai", `Deferred consolidation applied (${source}): ${eventsToConsolidate.length} events, ${closedChats.length} chats; history document ${documentUpdate.mode}.`);
        return true;
      },
    },
  );
  if (!summary) return world;

  const entry = entryFor(summary, generation.source, world.consolidatedHistory);
  const documentUpdate = applyHistoryDocumentUpdate(world, {
    document,
    summary,
    source: generation.source,
    throughDate: entry.throughDate,
    throughEventId: entry.throughEventId,
    throughRound: entry.throughRound,
    baseRevision,
  });
  logDebugEvent("ai", `History consolidated (${generation.source}): ${eventsToConsolidate.length} events, ${closedChats.length} chats folded; history document ${documentUpdate.mode}.`);
  return normalizeWorldState({
    ...world,
    consolidatedHistory: [...world.consolidatedHistory, entry],
    historyDocument: documentUpdate.historyDocument,
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
// interactive event stage is in flight: those read the full state bundle at entry and
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

// activeSimulations, pendingProjectsJump and pendingJumpSegment moved to
// simulationStatus.js so the HUD can poll isSimulationBusy() without importing
// this module. Reached through the accessors below; see that file for why.
//
// pendingProjectsJump: a turn whose events are generated and validated but NOT
// yet written, because the Projects & Operations board could not be brought in
// step with them. Nothing is applied while it is set. That is deliberate and is
// what keeps the retry honest: the board's ops must ride in on the events that
// caused them and be applied before the world is written. Holding the whole turn
// means the retry is the SAME path as the first attempt, with no privileged
// bypass to add. If it cannot be resolved the turn fails like any other and the
// player rolls back.
//
// pendingJumpSegment: a jump whose segments are part-generated, where one
// segment failed, the ones before it are still in hand, and NOTHING has been
// written. Held so the player is told which segment failed and can retry just
// that segment or discard the turn (see runJumpSegments).

// Storyline motion repairs that failed, keyed by campaign and storyline id (see
// recordMotionRepairOutcome). Memory only: it keeps a storyline that fails the
// same way from costing a call every turn, and a reload simply forgets it.
const motionRepairFailures = new Map();

export {
  NO_RESPONSE_BODY_NOTE,
  discardPendingJumpSegment,
  discardPendingProjectsJump,
  hasPendingJumpSegment,
  hasPendingProjectsJump,
  isChatGenerationLikely,
  isSimulationBusy,
} from "./simulationStatus.js";

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

// `revealWith` is the event a turn's note is shown with (runtime/unseenEvents.js):
// every message the note brings carries it, so a thread it opens or writes into
// shows it only once the player's reveal has reached that event.
export const buildGeneratedChat = async (chatLike, linkEventId, world, { fallbackTitle = "", playerName = "", revealWith = "" } = {}) => {
  const countriesInput = Array.isArray(chatLike?.countries) ? chatLike.countries : [];
  const revealEventId = normalizeString(revealWith);
  const withReveal = (messages) => (revealEventId
    ? messages.map((message) => (typeof message === "string"
      ? { role: "system", text: message, eventId: revealEventId }
      : { ...message, eventId: revealEventId }))
    : messages);
  // A chat's countries are the OTHER side; the player is implicit
  // (chatVisibility.js). A note naming the player among them is a note to the
  // player, and keeping them there forks a duplicate of the thread already open.
  const countries = withoutPlayerParticipant(await resolveInvitees(countriesInput, world), playerName);
  if (countries.length === 0) return null;

  // The initiating polity speaks first — and it is never the player, who is no
  // longer in the list. When the model names no speaker (or names the player, or
  // someone who is not a participant), attribute the opener to the first one.
  const speakerKey = normalizeString(chatLike?.speaker).toUpperCase();
  const initiator =
    countries.find((country) =>
      speakerKey
      && (normalizeString(country.name).toUpperCase() === speakerKey || normalizeString(country.code).toUpperCase() === speakerKey))
    ?? countries[0];

  const entry = normalizeChatEntry({
    countries,
    id: chatLike?.id,
    linkedEventId: linkEventId,
    messages: withReveal(
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
        : []),
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

const isLifecycleNegotiationChat = (chat) => Boolean(
  chat?.lifecycleInstitutionId && normalizeArray(chat?.lifecycleCaseIds).length,
);

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
      chat.status !== "closed"
      && !isLifecycleNegotiationChat(chat)
      && chatParticipantKey(chat.countries) === key) : -1;
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
// While requests are being saved every unresolved place of a turn goes to the
// resolver together: a batch is a request, and three batches of six were three
// requests for one turn's borders (requestBudget.js).
const GEOGRAPHY_RESOLVER_SAVING_BATCH_SIZE = 18;
const GEOGRAPHY_RESOLVER_MAX_CANDIDATES = 140;
const GEOGRAPHY_RESOLVER_MAX_AREA_REGIONS = 12;
const IMPLICIT_WHOLE_COUNTRY_LIMIT = 3;

// `requests` is the time skip this resolution belongs to (createJumpRequests), so
// the resolver's own model call asks the skip's budget first; callers outside a
// skip leave it out.
const resolveRegionTransfers = async (containers, world, {
  ownershipMode = "sovereignty",
  enforceNarratedCityCoverage = false,
  exactRegionIdsOnly = false,
  explicitScopeText = "",
  requests = null,
} = {}) => {
  // Apply-time GM revalidation must verify the EXACT previewed region ids, not
  // pay to reopen/parse the full scenario geometry and reinterpret friendly
  // place names a second time. The preview path has already resolved every
  // territorial operation to canonical ids. The compact region catalog is
  // primed by Nations/Preview and is enough to prove those ids still exist. If
  // it is unavailable, fail closed rather than silently trusting unknown ids or
  // reopening heavyweight geography during Apply.
  if (exactRegionIdsOnly) {
    // Apply is intentionally forbidden from reopening/parsing the giant authored
    // GeoJSON. Preview already resolved every territory operation to exact ids,
    // and Nations/Preview primes this compact catalog as soon as geometry parses.
    // If the map asset changed, assets.js invalidates the primed catalog and Apply
    // fails closed instead of silently trusting stale ids or blocking the UI.
    const exactCatalog = getPrimedScenarioRegionCatalog() ?? [];
    if (!Array.isArray(exactCatalog) || exactCatalog.length === 0) {
      return containers.flatMap(({ impacts, path }) =>
        normalizeArray(impacts?.regionTransfers).map((transfer, transferIndex) => ({
          candidates: [],
          fromCode: normalizeString(transfer?.fromCode),
          label: normalizeString(transfer?.regionName) || normalizeString(transfer?.regionId) || "unknown region",
          path,
          reason: "the compact scenario region catalog is not primed; regenerate the preview after the map finishes loading",
          transferIndex,
          wholeCountry: Boolean(transfer?.wholeCountry),
        }))
      );
    }

    const exactById = new Map(
      exactCatalog
        .map((region) => [normalizeString(region?.id), region])
        .filter(([id]) => Boolean(id)),
    );
    const unresolved = [];

    for (const { impacts, path } of containers) {
      const resolved = [];
      for (const [transferIndex, transfer] of normalizeArray(impacts?.regionTransfers).entries()) {
        if (transfer?.wholeCountry === true) {
          unresolved.push({
            candidates: [],
            fromCode: normalizeString(transfer?.fromCode),
            label: wholeCountrySourceToken(transfer),
            path,
            reason: "wholeCountry must already be expanded to exact region ids before Apply",
            transferIndex,
            wholeCountry: true,
          });
          continue;
        }

        const regionId = normalizeString(transfer?.regionId);
        const row = exactById.get(regionId);
        if (!regionId || !row) {
          unresolved.push({
            candidates: [],
            fromCode: normalizeString(transfer?.fromCode),
            label: normalizeString(transfer?.regionName) || regionId,
            path,
            reason: "previewed canonical region id no longer exists",
            transferIndex,
          });
          continue;
        }

        resolved.push({
          ...transfer,
          regionId,
          // Preview already named the region from the rendered features. Apply
          // keeps that name: the compact catalog spells a few GADM ids and every
          // placeholder differently, and a respelled candidate would no longer
          // match the approved one ("would reinterpret this preview").
          regionName: normalizeString(transfer?.regionName) || normalizeString(row?.name) || regionId,
        });
      }
      if (impacts && Array.isArray(impacts.regionTransfers)) impacts.regionTransfers = resolved;
    }

    return unresolved;
  }

  // Phase 8B.2.10: resolve against the geography that is ACTUALLY rendered for
  // this scenario. loadRegionCatalog() is intentionally broad and may contain
  // stock GADM rows alongside custom/historical scenario rows; letting those two
  // corpora compete is what made friendly names such as "Masovia" capable of
  // pointing at a real-but-wrong province.
  //
  // The current regionsGeojson is the map truth. Use it as the primary corpus
  // whenever it exists, retaining stock catalog data only as a compatibility
  // fallback for maps that do not expose rendered region features.
  // Read the authored scenario geography once for Preview. When it exists it is
  // already the authoritative resolution corpus, so do not simultaneously build
  // the merged stock catalog (which can trigger a second large scenario read).
  // Prime the compact id/name catalog from this unavoidable parse so Apply can
  // strictly revalidate exact previewed ids without reopening tens of MB of GeoJSON.
  const renderedRegionsGeojson = await readJson(JSON_URLS.regionsGeojson, {
    defaultValue: null,
    force: true,
    clone: false,
  }).catch(() => null);
  const renderedFeatures = normalizeArray(renderedRegionsGeojson?.features);
  if (renderedFeatures.length) {
    primeCustomRegionCatalog(renderedRegionsGeojson, {
      url: JSON_URLS.regionsGeojson,
      invalidateCatalog: false,
    });
  }
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

  const mergedCatalog = renderedCatalog.length > 0
    ? []
    : await loadRegionCatalog().catch(() => []);
  const catalog = renderedCatalog.length > 0 ? renderedCatalog : mergedCatalog;
  if (!renderedCatalog.length && mergedCatalog.length) {
    // Preview may legitimately resolve against the compatibility/stock catalog
    // when no authored scenario features are available. Prime the exact corpus
    // that Preview actually used so Apply can revalidate those approved IDs
    // without performing a second geography load.
    primeCustomRegionCatalogEntries(mergedCatalog, {
      url: JSON_URLS.regionsGeojson,
      invalidateCatalog: false,
    });
  }

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

  // Same-payload polity lifecycle changes outrank pre-existing map provenance.
  // Example: CREATE PRK + transfer North-Korean regions in one GM transaction
  // must mean the newly created North Korea, even if an unrelated active polity
  // currently carries mapRefs.gadm0=["PRK"] for asset/geography provenance.
  const generatedOwnerAliases = new Map();
  const registerGeneratedOwnerAlias = (token, canonical) => {
    const key = regionKey(token);
    if (!key || !canonical) return;
    const existing = generatedOwnerAliases.get(key);
    generatedOwnerAliases.set(key, existing && existing !== canonical ? "" : canonical);
  };
  for (const { impacts } of containers) {
    for (const change of normalizeArray(impacts?.polityChanges)) {
      const operation = normalizeString(change?.operation).toLowerCase();
      if (!["create", "restore", "rename", "update"].includes(operation)) continue;
      const canonical = toCountryName(normalizeString(change?.code)) || normalizeString(change?.code);
      if (!canonical) continue;
      for (const token of [change?.code, change?.name, ...normalizeArray(change?.aliases)]) {
        registerGeneratedOwnerAlias(token, canonical);
        registerGeneratedOwnerAlias(toCountryName(normalizeString(token)), canonical);
      }
    }
  }

  // Standardised polity names. An owner field resolves only to a name this map
  // declares: an owner token actually on the map, a polity record's key, its
  // declared display name, or one of its declared aliases (a stock CODE is
  // first turned into its stock name, which then has to be declared like any
  // other). Existing owners stay exact; same-payload lifecycle aliases above
  // are the only exception so CREATE/RESTORE + transfer can be atomic.
  const ownerNameIndex = new Map(); // folded name -> the owner label as the map spells it
  const declareOwner = (rawName, canonical) => {
    const key = regionKey(rawName);
    if (key && canonical && !ownerNameIndex.has(key)) ownerNameIndex.set(key, canonical);
  };
  for (const [token, entry] of Object.entries(worldState.polityOverrides ?? {})) {
    declareOwner(token, token);
    declareOwner(entry?.name, token);
    for (const alias of normalizeArray(entry?.aliases)) declareOwner(alias, token);
  }
  for (const owner of Object.values(controlOwners)) declareOwner(owner, normalizeString(owner));
  for (const owner of Object.values(sovereigntyOwners)) declareOwner(owner, normalizeString(owner));
  for (const region of catalog) {
    const baked = normalizeString(region?.country) || toCountryName(normalizeString(region?.countryCode));
    declareOwner(baked, baked);
  }
  const knownOwnerLabels = [...new Set(ownerNameIndex.values())].sort((a, b) => a.localeCompare(b));

  const resolveOwnerName = (token) => {
    const rawToken = normalizeString(token);
    const raw = toCountryName(rawToken);
    if (!raw) return "";
    const samePayload = generatedOwnerAliases.get(regionKey(rawToken))
      || generatedOwnerAliases.get(regionKey(raw));
    if (samePayload) return samePayload;
    return ownerNameIndex.get(regionKey(raw)) ?? "";
  };
  const ownerIsKnown = (token) => Boolean(resolveOwnerName(token));

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

  const ownerNameOf = (regionId) => {
    if (ownershipMode === "sovereignty") {
      const sovereign = toCountryName(normalizeString(sovereigntyOwners[regionId]));
      if (sovereign) return resolveOwnerName(sovereign);
    }
    const controller = toCountryName(normalizeString(controlOwners[regionId]));
    if (controller) return resolveOwnerName(controller);
    const region = byId.get(regionId);
    return resolveOwnerName(region?.country || toCountryName(region?.countryCode) || "");
  };

  // GM-only exhaustive base-geography scope. "All North Korean states" means
  // the rendered PRK footprint even when those regions are currently held by a
  // larger alternate-history polity. It must NOT be interpreted as wholeCountry
  // on that current owner (which could move the entire Soviet Union).
  const explicitBaseScope = !exactRegionIdsOnly
    ? detectExplicitBaseTerritoryScope(
        explicitScopeText,
        catalog.map((region) => ({
          ...region,
          // The rendered feature's `owner` may be the CURRENT scenario polity
          // (e.g. Soviet Union), while countryCode remains the immutable base
          // geography provenance (PRK). Exhaustive phrases such as "all North
          // Korean states" must resolve against that base footprint, not the
          // current political owner.
          country: toCountryName(region?.countryCode) || region?.country,
        })),
      )
    : null;

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

  const expandWholeCountry = (transfer) => expandWholeCountryTransfer(transfer, {
    catalog,
    resolveOwnerName,
    canonicalOwnerKey,
    ownerKeyOf,
  });

  // The regions a transfer can legitimately mean: the losing side's when the
  // model named one, else everything the recipient does not already hold.
  const transferPool = (transfer) => {
    const fromKey = canonicalOwnerKey(transfer?.fromCode);
    if (fromKey) return regionsOwnedBy(transfer.fromCode);
    const toKey = canonicalOwnerKey(transfer?.toCode);
    return catalog.filter((region) => ownerKeyOf(region.id) !== toKey);
  };

  // Bounded candidates for the semantic pass when the losing side is unknown:
  // the regions whose (affix-stripped) names start like the label, so the
  // model is never handed the whole planet.
  const similarRegions = (label, transfer) => {
    const stem = stripRegionAffixes(foldRegionKey(label)).slice(0, 4);
    if (stem.length < 4) return [];
    return transferPool(transfer).filter((region) => {
      const name = stripRegionAffixes(foldRegionKey(region.name)) || foldRegionKey(region.name);
      return name.startsWith(stem);
    });
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

      // The shared matcher (regionMatch.js): an appended "Oblast", a stripped
      // "the ... region", a transliteration one edit away — each accepted only
      // when a single region survives. Inside the losing side when the model
      // named it; otherwise among every region the recipient does not already
      // hold, because a transfer without fromCode used to be dropped outright
      // even when its name was on the map. Anything harder belongs to the
      // bounded semantic geography pass.
      const matched = matchRegionName(candidate, transferPool(transfer), { maxFuzzy: fromKey ? 2 : 1 });
      if (matched) return matched.region.id;
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

  // Polities this payload itself brings into being may be named before the
  // world knows them: a creation, restoration or rename in any event's
  // polityChanges declares the name for every transfer in the transaction.
  const payloadDeclared = new Set();
  for (const { impacts } of containers) {
    for (const change of normalizeArray(impacts?.polityChanges)) {
      for (const rawName of [change?.code, change?.name]) {
        const key = regionKey(rawName);
        if (key) payloadDeclared.add(key);
      }
    }
  }
  const payloadDeclares = (token) => payloadDeclared.has(regionKey(toCountryName(normalizeString(token))));
  // resolveRegionControlOps proxies an op with no owner at all under this
  // sentinel; the ownership rules below judge it, not the name check.
  const OWNERLESS_SENTINEL = "Unresolved polity";

  // A receiver the map does not know is FOUNDED, not refused: the exact name the
  // model wrote becomes a polity (runtime/polityFounding.js). Only receivers found
  // one — a transfer's toCode, a capture's toCode, a contest's actor, a live
  // claim's claimant — never the loser, who must already hold the land, and never
  // a clear-contest claimant, who must already be on the region. Each founding
  // becomes a synthesised polityChanges create on the first event that names it
  // (added at the end of this pass), so the lifecycle runs before the territory
  // when the impacts apply and a GM preview lists it like any other creation. A
  // control-op proxy carries its op, which is how a capture is told from a clear.
  const founded = collectFoundedPolities(
    containers.flatMap(({ impacts, path }) => [
      ...normalizeArray(impacts?.regionTransfers).map((transfer) => ({
        token: transfer?.toCode,
        role: !transfer?.op ? "transfer" : transfer.op === "control" ? "control" : transfer.op === "contest" ? "contest" : "",
        path,
      })),
      ...normalizeArray(impacts?.regionClaims).map((claim) => ({ token: claim?.claimantCode, role: claim?.drop ? "" : "claim", path })),
    ]),
    {
      ownerIsKnown: (token) => ownerIsKnown(token) || payloadDeclares(token),
      sentinel: OWNERLESS_SENTINEL,
      fold: (token) => regionKey(toCountryName(normalizeString(token))),
    },
  );
  for (const [key, entry] of founded) {
    payloadDeclared.add(key);
    registerGeneratedOwnerAlias(entry.name, entry.name);
  }

  for (const [containerIndex, container] of containers.entries()) {
    const { impacts, path, event } = container;
    const transfers = normalizeArray(impacts?.regionTransfers);
    if (transfers.length === 0) continue;

    const resolved = [];
    const destinationByRegion = new Map();
    deterministicDestinations.set(path, destinationByRegion);

    for (const [transferIndex, transfer] of transfers.entries()) {
      const unknownOwner = [transfer?.toCode, transfer?.fromCode]
        .map(normalizeString)
        .find((token) => token && token !== OWNERLESS_SENTINEL && !ownerIsKnown(token) && !payloadDeclares(token));
      if (unknownOwner) {
        unresolved.push({
          label: normalizeString(transfer?.regionName) || normalizeString(transfer?.regionId),
          fromCode: normalizeString(transfer?.fromCode),
          path,
          candidates: [],
          unknownOwner,
          knownOwners: knownOwnerLabels,
        });
        continue;
      }
      if (transfer?.wholeCountry === true) {
        const sourceToken = wholeCountrySourceToken(transfer);
        const expanded = expandWholeCountry(transfer);
        if (expanded.length) {
          console.info(
            `[ai] ${path}.regionTransfers expanded whole country ` +
              `"${sourceToken}" -> ${normalizeString(transfer?.toCode)}: ` +
              `${expanded.length} region(s).`,
          );
          for (const item of expanded) {
            pushUniqueTransfer(resolved, item);
            destinationByRegion.set(item.regionId, regionKey(item.toCode));
          }
          continue;
        }

        // Never degrade a failed whole-country request into one exact province.
        // That is how a malformed payload such as wholeCountry=true +
        // regionId="Guangzhouwan" turned "all of France" into one overseas
        // concession. wholeCountry is all-or-nothing: either native ownership
        // expansion succeeds from the losing polity, or the operation is rejected.
        unresolved.push({
          label: sourceToken,
          fromCode: normalizeString(transfer?.fromCode),
          path,
          candidates: regionsOwnedBy(sourceToken),
          reason: "wholeCountry scope could not be expanded from the losing polity",
          transferIndex,
          wholeCountry: true,
        });
        continue;
      }

      const regionId = deterministicResolve(transfer, event);
      if (regionId) {
        // If the administrator explicitly requested an exhaustive rendered
        // geographic footprint ("all North Korean states", "all French
        // territories") and the model supplied at least one correctly grounded
        // operation inside that footprint, native code completes the SAME
        // structured operation across every rendered region in that base
        // geography. This is scope completion, not semantic invention: the
        // model still decides legal sovereignty vs de-facto control and the
        // recipient; native code merely prevents a one-province partial apply.
        if (explicitBaseScope && scopeContainsRegion(explicitBaseScope, regionId)) {
          const destinationKey = regionKey(transfer?.toCode);
          for (const scopedRegionId of explicitBaseScope.regionIds) {
            const scopedRow = byId.get(scopedRegionId);
            if (!scopedRow) continue;
            const fromCode = ownerNameOf(scopedRegionId);
            if (!fromCode || canonicalOwnerKey(fromCode) === canonicalOwnerKey(transfer?.toCode)) continue;
            const expanded = {
              ...transfer,
              fromCode,
              regionId: scopedRegionId,
              regionName: scopedRow.name || scopedRegionId,
              wholeCountry: undefined,
            };
            pushUniqueTransfer(resolved, expanded);
            destinationByRegion.set(scopedRegionId, destinationKey);
          }
          console.info(
            `[gm territory] completed explicit base-geography scope ${explicitBaseScope.countryName || explicitBaseScope.countryCode}: ` +
              `${explicitBaseScope.regionIds.length} rendered region(s) -> ${normalizeString(transfer?.toCode)}.`,
          );
          continue;
        }

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

      const label =
        normalizeString(transfer?.regionName) ||
        normalizeString(transfer?.regionId);
      const candidates = canonicalOwnerKey(transfer?.fromCode)
        ? regionsOwnedBy(transfer?.fromCode)
        : similarRegions(label, transfer);

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
  const resolverBatchSize = savingRequests() ? GEOGRAPHY_RESOLVER_SAVING_BATCH_SIZE : GEOGRAPHY_RESOLVER_BATCH_SIZE;

  for (let offset = 0; offset < semanticPending.length; offset += resolverBatchSize) {
    const batch = semanticPending.slice(offset, offset + resolverBatchSize);

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
        lookups: buildTaskLookups({ world }),
        fallback,
        ...jumpTaskOptions(requests, "geography"),
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
  // The foundings this pass decided, as create entries on the first event that
  // named each polity (the collector skipped names the payload already declares).
  // Prepended, so a model's own later entry for the same name still lands on top
  // as an update.
  for (const entry of founded.values()) {
    const container = containers.find((candidate) => candidate.path === entry.path) ?? containers[0];
    if (!container?.impacts || typeof container.impacts !== "object") continue;
    container.impacts.polityChanges = [foundingPolityChange(entry.name), ...normalizeArray(container.impacts.polityChanges)];
    console.info(`[ai] ${entry.path}: founded "${entry.name}" — it received territory without being on the map.`);
  }
  return unresolved;
};

// regionControlOps use the SAME geography vocabulary and bounded resolver as
// legal transfers, but they are bounded by current DE-FACTO control instead of
// sovereignty. Proxy them through the proven resolver rather than maintain two
// subtly different historical-geography engines.
const resolveRegionControlOps = async (containers, world, { exactRegionIdsOnly = false, explicitScopeText = "", requests = null } = {}) => {
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
      // The event's own lifecycle entries ride along so a polity a transfer in
      // this same payload founded (or the model declared) is not founded twice.
      impacts: { regionTransfers: proxies, polityChanges: normalizeArray(container?.impacts?.polityChanges) },
    };
  });

  const unresolved = await resolveRegionTransfers(proxyContainers, world, {
    ownershipMode: "control",
    enforceNarratedCityCoverage: !exactRegionIdsOnly,
    exactRegionIdsOnly,
    explicitScopeText,
    requests,
  });

  for (let index = 0; index < containers.length; index += 1) {
    const targetImpacts = containers[index]?.impacts;
    if (!targetImpacts || typeof targetImpacts !== "object") continue;

    // Creations the resolver synthesised for a controller or actor the map did
    // not know ride the proxy's polityChanges; carry them onto the real event.
    const declaredBefore = new Set(normalizeArray(targetImpacts.polityChanges));
    const foundedHere = normalizeArray(proxyContainers[index]?.impacts?.polityChanges).filter((change) => !declaredBefore.has(change));
    if (foundedHere.length) targetImpacts.polityChanges = [...foundedHere, ...normalizeArray(targetImpacts.polityChanges)];

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

// Preview resolves claim geography too. Apply must therefore verify the exact
// approved claim ids against the same compact scenario catalog without reopening
// authored GeoJSON, resolving friendly names again, or silently dropping a claim
// the administrator already approved. Ordinary AI generation may still salvage an
// unresolvable claim because claims do not move borders; this exact-id guard is GM
// transaction integrity, not a broader turn-failure rule.
const validateExactApprovedRegionClaims = (containers) => {
  const claimEntries = [];
  for (const { impacts, path } of containers) {
    for (const [claimIndex, claim] of normalizeArray(impacts?.regionClaims).entries()) {
      claimEntries.push({ claim, claimIndex, path });
    }
  }
  if (claimEntries.length === 0) return "";

  const exactCatalog = getPrimedScenarioRegionCatalog() ?? [];
  if (!Array.isArray(exactCatalog) || exactCatalog.length === 0) {
    return "Approved region claims cannot be revalidated because the compact scenario region catalog is not primed; regenerate the GM preview after the map finishes loading.";
  }

  const exactIds = new Set(
    exactCatalog
      .map((region) => normalizeString(region?.id))
      .filter(Boolean),
  );

  for (const { claim, claimIndex, path } of claimEntries) {
    const regionId = normalizeString(claim?.regionId);
    if (!regionId || !exactIds.has(regionId)) {
      return `${path}.regionClaims[${claimIndex}].regionId "${regionId || "(blank)"}" is not present in the primed scenario region catalog. Regenerate the GM preview; Apply will not reinterpret or silently drop an approved claim.`;
    }
  }
  return "";
};

// One retry's worth of corrective vocabulary: the exact regions the losing side
// currently owns, so a model that wrote "Pomerania" can resend the same answer
// with the real names/ids ("Pomorskie (POL.11_1)") instead of losing the map
// change entirely. The lists stay small — one owner's regions, not the world's.
const buildTransferFeedback = (unresolved) => {
  const lines = [];
  for (const entry of unresolved.slice(0, 3)) {
    const target = entry.label || "(blank)";
    if (entry?.wholeCountry) {
      lines.push(
        `${entry.path}.regionTransfers: wholeCountry=true could not be expanded from losing polity "${target}". ` +
          `Set fromCode to the losing polity's FULL current name and set regionId to that same polity name; ` +
          `do not put one province/colony in regionId for a whole-country operation.`,
      );
      continue;
    }
    if (entry.unknownOwner) {
      const powers = normalizeArray(entry.knownOwners);
      const listed = powers.slice(0, 80).map((name) => `"${name}"`).join(", ");
      lines.push(
        `${entry.path}.regionTransfers: "${entry.unknownOwner}" is not a power on this map. Owner names must match a power's name ` +
          `exactly as the map spells it — no short forms, translations or codes. Powers on the map: ${listed}` +
          `${powers.length > 80 ? `, +${powers.length - 80} more` : ""}. Use one of these exact names in fromCode: ` +
          "the polity that loses a region must already hold it (a receiver that is not on the map is founded under the name you give it).",
      );
      continue;
    }
    if (entry.candidates.length > 0) {
      const listed = entry.candidates.slice(0, 200)
        .map((region) => `${region.name} (${region.id})`)
        .join(", ");
      const more = entry.candidates.length > 200 ? `, +${entry.candidates.length - 200} more` : "";
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
// What to tell the NEXT turn about a territorial operation the resolver could not
// place. buildTransferFeedback above is the in-turn version: it spends up to two
// hundred region names on the one retry. By the next turn that vocabulary is a
// lookup away, so the receipt only says what failed to land and why.
const describeUnresolvedTerritory = (entry, family, eventTitle) => {
  const where = eventTitle ? `Event "${eventTitle}": ` : "";
  const what = family === "regionControlOps" ? "control operation on" : "transfer of";
  const label = normalizeString(entry?.label) || "(blank)";
  if (entry?.kind === "narrated-city-coverage") {
    return `${where}the text says control changed in ${entry.cityName || label} (${entry.regionName}), but no control operation targeted that region — the map still shows its previous controller.`;
  }
  if (entry?.wholeCountry) {
    return `${where}the whole-country ${what} "${label}" was dropped — no regions are held under that exact polity name.`;
  }
  if (entry?.unknownOwner) {
    return `${where}the ${what} "${label}" was dropped — "${entry.unknownOwner}" is not a power on this map, and the side that loses land must be named exactly as the map spells it.`;
  }
  const owner = normalizeString(entry?.fromCode);
  return `${where}the ${what} "${label}" was dropped — no map region matches that name${owner ? ` among ${owner}'s regions` : ""}.`;
};

export const validateGeneratedWorldChanges = async (candidate, world, {
  strictTransfers = false,
  captureGuard = true,
  resolvedRegionIdsOnly = false,
  explicitScopeText = "",
  // Collects what salvage drops or changes (runtime/applicationReceipt.js), so
  // the next turn can be told. Null when the caller is not keeping a receipt.
  receipt = null,
  // The time skip being validated (createJumpRequests), so that the place-name
  // resolver's model call asks the skip's budget first. Null outside a skip.
  requests = null,
  // Human polity for institution-lifecycle sovereignty checks. Event-path
  // lifecycle operations may invite/discipline this polity but may never make
  // its accession, founding, response or withdrawal decision.
  playerCountry = "",
  institutionLifecycleAuthority = "npc",
  // Current queued Actions, when this is a time skip. Exact actionIds are native
  // references just like party/project ids: reject invented ids on a strict
  // attempt and strip them on salvage, but never require full coverage here.
  actions = null,
} = {}) => {
  const strict = strictTransfers;
  const containers = Array.isArray(candidate?.events)
    ? candidate.events.map((event, index) => ({ event, impacts: event?.impacts, path: `$.events[${index}].impacts` }))
    : [{
        event: { date: "", title: "Game master intervention", description: normalizeString(candidate?.summary) },
        impacts: candidate?.impacts,
        path: "$.impacts",
      }];
  const titleAt = (path) => normalizeString(containers.find((container) => container.path === path)?.event?.title);
  const drop = (path, text) => noteReceipt(receipt, "dropped", `${titleAt(path) ? `Event "${titleAt(path)}": ` : ""}${text}`);

  // actionIds are stable queue references, not prose hints. Do not guess missing
  // links here; only ensure every link the model DID write points at a current
  // planned action. The bounded semantic review later handles genuine omissions.
  if (Array.isArray(candidate?.events) && Array.isArray(actions)) {
    const actionRefs = validateQueuedActionIds(candidate.events, actions, { strict });
    if (actionRefs.error) return actionRefs.error;
    if (actionRefs.removed) {
      noteReceipt(receipt, "dropped", `${actionRefs.removed} stale or unknown actionId reference${actionRefs.removed === 1 ? " was" : "s were"} removed from generated events; only exact ids of current queued Actions may resolve an order.`);
    }
  }

  // A transfer or control flip that says its own basis is a claim, a threat or a
  // raid moves no border (runtime/territoryBasis.js). Never an error and never a
  // retry: the intent is unambiguous, so the claim is recorded, the rest is left
  // out, and the model is told next turn. Runs before the geography resolver so a
  // claim this produces is resolved to a region id like any other.
  for (const { impacts, path } of containers) {
    if (!impacts || typeof impacts !== "object") continue;
    const screened = screenTerritoryBasis(impacts);
    if (screened.actions.length === 0) continue;
    impacts.regionTransfers = screened.regionTransfers;
    impacts.regionControlOps = screened.regionControlOps;
    impacts.regionClaims = screened.regionClaims;
    for (const action of screened.actions) {
      noteReceipt(receipt, "adjusted", describeBasisAction(action, { eventTitle: titleAt(path) }));
      console.info(`[ai] ${path}.${action.family}: basis "${action.basis}" on ${action.region} — ${action.outcome === "claimed" ? "recorded as a claim" : "not applied"}.`);
    }
  }
  // Every project an op could legitimately address: what is already on the
  // board, plus anything a create earlier in this same payload opens.
  const knownProjects = new Map();
  for (const project of normalizeArray(world?.projects)) {
    const name = normalizeString(project?.name);
    if (!name) continue;
    knownProjects.set(name.toLowerCase(), name);
    if (normalizeString(project?.id)) knownProjects.set(normalizeString(project.id), name);
  }

  const unresolvedTransfers = await resolveRegionTransfers(containers, world, {
    ownershipMode: "sovereignty",
    exactRegionIdsOnly: resolvedRegionIdsOnly,
    explicitScopeText,
    requests,
  });
  if (strict && unresolvedTransfers.length > 0) {
    return buildTransferFeedback(unresolvedTransfers);
  }
  // Salvage: the resolver has already left these out of the payload. The turn is
  // kept — and the model, which still believes the land moved, is told it did not.
  for (const entry of unresolvedTransfers) {
    noteReceipt(receipt, "dropped", describeUnresolvedTerritory(entry, "regionTransfers", titleAt(entry?.path)));
  }
  const unresolvedControlOps = await resolveRegionControlOps(containers, world, {
    exactRegionIdsOnly: resolvedRegionIdsOnly,
    explicitScopeText,
    requests,
  });
  if (strict && unresolvedControlOps.length > 0) {
    return buildControlFeedback(unresolvedControlOps);
  }
  for (const entry of unresolvedControlOps) {
    noteReceipt(receipt, "dropped", describeUnresolvedTerritory(entry, "regionControlOps", titleAt(entry?.path)));
  }
  // Units and structures placed by name (`at`), and everything placed kept clear
  // of what already stands (resolvePlacements above). Never an error: a place
  // that cannot be found is said in the receipt, and the operation keeps any
  // coordinates it came with. Not on the Game Master's apply-time pass, which
  // may not reopen the map's geometry: its preview already placed everything.
  if (!resolvedRegionIdsOnly) await resolvePlacements(containers, world, { receipt });
  if (resolvedRegionIdsOnly) {
    const exactClaimError = validateExactApprovedRegionClaims(containers);
    if (exactClaimError) return exactClaimError;
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

  // Provider transport validation is not enough for politicalActorOps because
  // argsJson is intentionally an opaque string in the compact schema. Decode each
  // native operation, validate its shape, then DRY-RUN it sequentially against a
  // scratch Political Actor world before Preview/turn acceptance. The sequential
  // dry-run is important: a party created earlier in the same transaction becomes
  // a valid later reference, while an invented form-coalition party id fails closed
  // instead of producing a green preview that would be dropped at apply time.
  const politicalValidationSource = typeof structuredClone === "function"
    ? structuredClone(world || {})
    : JSON.parse(JSON.stringify(world || {}));
  const politicalValidationWorld = normalizeWorldState(politicalValidationSource);
  for (const { event, impacts, path } of containers) {
    if (!impacts || typeof impacts !== "object") continue;

    // Runtime polity renames are applied before Political Actor operations. Mirror
    // just that identity effect on the scratch actor map so rename + political op in
    // one event validates against the same identity ordering as real application.
    for (const change of normalizeArray(impacts.polityChanges)) {
      const changeOp = normalizeString(change?.operation).toLocaleLowerCase();
      const from = normalizeString(change?.code);
      const to = normalizeString(change?.name);
      if (!from || !to || from.toLocaleLowerCase() === to.toLocaleLowerCase()) continue;
      if (!["rename", "restore", "update"].includes(changeOp)) continue;
      const fromKey = getPoliticalProfileKey(politicalValidationWorld, from);
      if (!fromKey) continue;
      const actor = politicalValidationWorld?.politicalActors?.byPolity?.[fromKey];
      if (!actor) continue;
      delete politicalValidationWorld.politicalActors.byPolity[fromKey];
      politicalValidationWorld.politicalActors.byPolity[to] = normalizePoliticalActorRecord(
        { ...actor, polityKey: to, name: to },
        to,
      );
    }

    const keptPoliticalOps = [];
    for (let index = 0; index < normalizeArray(impacts.politicalActorOps).length; index += 1) {
      const packed = normalizeArray(impacts.politicalActorOps)[index];
      const operationPath = `${path}.politicalActorOps[${index}]`;
      let args = null;
      try {
        args = JSON.parse(normalizeString(packed?.argsJson));
      } catch (error) {
        const reason = `argsJson is not valid JSON: ${error?.message || error}`;
        if (strict) return `${operationPath} was refused: ${reason}`;
        drop(path, `a Political Actor operation was dropped — ${reason}.`);
        continue;
      }
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        const reason = "argsJson must decode to a JSON object";
        if (strict) return `${operationPath} was refused: ${reason}.`;
        drop(path, `a Political Actor operation was dropped — ${reason}.`);
        continue;
      }
      const operation = { ...args, op: normalizeString(packed?.op), polityKey: normalizeString(packed?.polityKey) };
      const shapeError = validatePoliticalActorOperationShape(operation, { allowNativeDerived: false });
      if (shapeError) {
        if (strict) return `${operationPath} was refused: ${shapeError}`;
        drop(path, `the Political Actor operation ${normalizeString(packed?.op) || "(unknown)"} was dropped — ${shapeError}`);
        continue;
      }
      const nativeOutcome = applyPoliticalActorOperation(politicalValidationWorld, operation);
      if (!nativeOutcome?.applied) {
        const reason = normalizeString(nativeOutcome?.error) || "native Political Actor state validation refused it";
        if (strict) return `${operationPath} was refused: ${reason}`;
        drop(path, `the Political Actor operation ${normalizeString(packed?.op) || "(unknown)"} was dropped — ${reason}`);
        continue;
      }
      keptPoliticalOps.push(packed);
    }
    if (Array.isArray(impacts.politicalActorOps)) impacts.politicalActorOps = keptPoliticalOps;
  }

  // A completed structural political event may not exist as narrative-only history.
  // PWv2 is the canonical owner of governments, leaders, parties, coalitions and
  // political systems; if the prose establishes one of those facts, require the
  // matching politicalActorOps before the event can enter the timeline. This is
  // deliberately semantic/completeness validation, not a second political engine.
  const politicalCompletenessError = validatePoliticalImpactCompleteness(candidate, { world });
  if (politicalCompletenessError) return politicalCompletenessError;

  const unitIds = new Set(normalizeWorldState(world).units.map((unit) => normalizeString(unit.id)).filter(Boolean));
  const generatedPolities = [];
  for (const { impacts } of containers) generatedPolities.push(...normalizeArray(impacts?.polityChanges));

  // Institution lifecycle operations are validated sequentially against a
  // scratch canonical world. That means a later operation in the same answer
  // can legitimately refer to an institution/case created by an earlier event,
  // while an impossible or sovereign-player act is stripped before canon sees
  // it. No request is added: this is native validation only.
  let lifecycleValidationWorld = normalizeWorldState(world);
  let lifecycleValidationChats = [];
  for (const { event, impacts, path } of containers) {
    if (!impacts || typeof impacts !== "object") continue;
    const keptLifecycleOps = [];
    for (let index = 0; index < normalizeArray(impacts.institutionLifecycleOps).length; index += 1) {
      const operation = impacts.institutionLifecycleOps[index];
      const operationPath = `${path}.institutionLifecycleOps[${index}]`;
      const outcome = applyInstitutionLifecycleImpactBatchCore({
        world: lifecycleValidationWorld,
        chats: lifecycleValidationChats,
        playerCountry,
        date: normalizeString(event?.date),
        ops: [operation],
        authority: institutionLifecycleAuthority,
      });
      if (outcome.rejected.length) {
        const reason = normalizeString(outcome.rejected[0]?.reason) || "native institution law refused it";
        if (strict) return `${operationPath} was refused: ${reason}`;
        drop(path, `an institution lifecycle operation was dropped — ${reason}`);
        continue;
      }
      lifecycleValidationWorld = outcome.world;
      lifecycleValidationChats = outcome.chats;
      keptLifecycleOps.push(outcome.applied[0]?.op || operation);
    }
    if (Array.isArray(impacts.institutionLifecycleOps)) impacts.institutionLifecycleOps = keptLifecycleOps;
  }

  for (const { impacts, path } of containers) {
    const keptChats = [];
    for (let index = 0; index < normalizeArray(impacts?.createdChats).length; index += 1) {
      const createdChat = impacts.createdChats[index];
      const countries = await resolveInvitees(createdChat?.countries, world, generatedPolities);
      if (countries.length === 0) {
        if (strict) return `${path}.createdChats[${index}].countries must contain at least one known polity.`;
        drop(path, `the chat "${normalizeString(createdChat?.title) || "(untitled)"}" was not opened — none of its participants is a polity on this map.`);
        continue; // salvage: drop the unresolvable chat, keep the turn
      }
      if (strict) {
        const chatError = validateChatOpener(createdChat, `${path}.createdChats[${index}]`);
        if (chatError) return chatError;
      }
      // The model names its participants; what is kept on the event is the
      // resolved {code, name} list every reader of a stored chat expects.
      keptChats.push({ ...createdChat, countries });
    }
    if (impacts && Array.isArray(impacts.createdChats)) impacts.createdChats = keptChats;

    const keptUnitOps = [];
    for (let index = 0; index < normalizeArray(impacts?.unitOps).length; index += 1) {
      const operation = impacts.unitOps[index];
      const operationPath = `${path}.unitOps[${index}]`;
      if (operation.op === "spawn") {
        if (!normalizeString(operation.unit?.name) || !normalizeString(operation.unit?.ownerCode)) {
          if (strict) return `${operationPath}.unit must have nonblank name and ownerCode values.`;
          drop(path, "a unit spawn was dropped — it had no name or no ownerCode, so no formation appeared.");
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
      const unitOpName = normalizeString(operation.op) || "unit";
      if (!unitId) {
        if (strict) return `${operationPath}.unitId must not be blank.`;
        drop(path, `a ${unitOpName} operation was dropped — it named no unitId, so no formation changed.`);
        continue;
      }
      if (!unitIds.has(unitId)) {
        if (strict) return `${operationPath}.unitId does not identify an existing unit.`;
        drop(path, `the ${unitOpName} operation on unit "${unitId}" was dropped — no unit has that id (it may have been destroyed or never existed).`);
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
          drop(path, "a structure was not built — the build operation gave it no name.");
          continue;
        }
        if (!Number.isFinite(Number(marker?.lng)) || !Number.isFinite(Number(marker?.lat))) {
          if (strict) return `${operationPath}.marker must carry numeric lng and lat coordinates.`;
          drop(path, `"${normalizeString(marker?.name)}" was not built — the build operation carried no numeric lng and lat.`);
          continue;
        }
      } else if (op === "remove" || op === "destroy") {
        if (!normalizeString(operation?.name) && !normalizeString(operation?.markerId)) {
          if (strict) return `${operationPath} must carry the name (or markerId) of the structure to remove.`;
          drop(path, "a structure removal was dropped — it named nothing to remove.");
          continue;
        }
      }
      keptMarkerOps.push(operation);
    }
    if (impacts && Array.isArray(impacts.markerOps)) impacts.markerOps = keptMarkerOps;

    // Documents (runtime/reports.js). A holder the world does not know is the
    // same failure as an unknown chat participant — the document would be
    // written to nobody, or to fewer governments than the story says — and it is
    // checked HERE, where the whole country catalog is in hand.
    const keptReports = [];
    for (let index = 0; index < normalizeArray(impacts?.reports).length; index += 1) {
      const operation = normalizeReportOp(impacts.reports[index]);
      const operationPath = `${path}.reports[${index}]`;
      if (!operation) {
        if (strict) return `${operationPath} must be a report operation: create with a title, a body and visibleTo, or share with a reportId and visibleTo.`;
        drop(path, "a report was dropped — it carried no document to write and no report to widen.");
        continue;
      }
      if (operation.visibleTo.length) {
        const holders = await resolveInvitees(operation.visibleTo, world, generatedPolities);
        const unknown = operation.visibleTo.filter((name) => !holders.some((holder) => regionKey(holder.name) === regionKey(name) || regionKey(holder.code) === regionKey(name)));
        if (!holders.length) {
          if (strict) return `${operationPath}.visibleTo must name polities on this map; "${operation.visibleTo.join('", "')}" ${operation.visibleTo.length === 1 ? "is not one" : "are not"}.`;
          drop(path, `the report "${operation.title || operation.reportId}" was dropped — none of the governments it names (${operation.visibleTo.join(", ")}) is a polity on this map.`);
          continue;
        }
        if (unknown.length && !strict) {
          noteReceipt(receipt, "adjusted", `The report "${operation.title || operation.reportId}" is held by ${holders.map((holder) => holder.name).join(", ")}: ${unknown.join(", ")} ${unknown.length === 1 ? "is not a polity" : "are not polities"} on this map.`);
        }
        if (unknown.length && strict) return `${operationPath}.visibleTo names "${unknown.join('", "')}", which ${unknown.length === 1 ? "is not a polity" : "are not polities"} on this map. Use the full names exactly as the map spells them.`;
        operation.visibleTo = holders.map((holder) => holder.name);
      }
      keptReports.push(operation);
    }
    if (impacts && Array.isArray(impacts.reports)) impacts.reports = keptReports;

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
          drop(path, "a project was not opened — the create operation gave it no name.");
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
        drop(path, `a project ${op || "update"} was dropped — it named no project.`);
        continue;
      }
      if (!knownProjects.has(target)) {
        if (strict) return buildProjectFeedback(operationPath, operation, knownProjects);
        drop(path, `the project ${op || "update"} on "${normalizeString(operation?.projectId || operation?.id || operation?.name || operation?.project)}" was dropped — nothing on the board has that name, so the board did not move.`);
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
        noteReceipt(receipt, "dropped", `The outreach chat "${normalizeString(candidate.diplomaticOutreach[index]?.title) || "(untitled)"}" was not opened — none of its participants is a polity on this map.`);
        continue;
      }
      if (strict) {
        const chatError = validateChatOpener(candidate.diplomaticOutreach[index], `$.diplomaticOutreach[${index}]`);
        if (chatError) return chatError;
      }
      keptOutreach.push({ ...candidate.diplomaticOutreach[index], countries });
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
          // This event exists specifically because of this queued Action. The
          // exact id is what settleOrders consumes; without it a provider
          // fallback narrated the order and then carried it over as overdue.
          actionIds: normalizeString(action.id) ? [normalizeString(action.id)] : [],
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

  // No scene: a time skip no longer writes one (a skip offers an interactive
  // event instead, runtime/interactiveOffer.js).
  return {
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
// `turn` is the journal of what the turn APPLIED (intervene.js journalTurn):
// with the pre-turn state beside it, the turn can be applied again from any
// point the player chooses — Intervene (interveneAfterEvent below).
// `intercepts` is the agents' file as it stood before the turn filed anything
// into it (sealed, as stored): an undone turn takes its agents' reports and the
// documents they stole with it. A snapshot captured before this carried none,
// and restoring one keeps today's file, less the copies of undone documents.
const captureRollbackSnapshot = async ({ round, fromDate, toDate, game, world, events, actions, chat, colors, intercepts = null, turn = null }) => {
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
        ...(intercepts && typeof intercepts === "object" ? { intercepts: cloneValue(intercepts) } : {}),
      },
      ...(turn ? { turn: cloneValue(turn) } : {}),
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
// per-turn assets and the agents' file, discard that restore point and every
// newer one (those turns no longer happened), and return the freshly-normalized
// bundle so the caller can update immediately. Returns null if there is no such
// snapshot.
//
// Wrapped in the same beginSimulation/endSimulation busy-lock every jump,
// game-master and interactive event call already uses — without it, the idle pulse (on
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
    // The player's standing goal is theirs, not the turn's (runtime/playerGoal.js):
    // one set or changed after the snapshot — during the reveal, say, before an
    // Intervene — stays.
    const liveWorld = await readJson(JSON_URLS.world, { defaultValue: {}, force: true }).catch(() => null);
    const worldToRestore = liveWorld && typeof liveWorld === "object" && liveWorld.playerGoals !== undefined
      ? { ...(s.world ?? {}), playerGoals: liveWorld.playerGoals }
      : (s.world ?? {});
    // Rollback uses the same whole-generation publication seam as a forward
    // turn. A restore must never expose restored history with pre-rollback
    // world/actions if one underlying desktop file replacement is interrupted.
    await writeCanonicalTurnState({
      game: s.game ?? {},
      world: worldToRestore,
      events: s.events ?? [],
      actions: s.actions ?? [],
      chats: s.chat ?? [],
      colors: s.colors ?? {},
    }, {
      expectedGameId: activeCampaignId(),
    });
    // The agents' file as it stood before the turn — the traffic and the stolen
    // copies the turn filed go with it. Either way, a copy of a document the
    // restored file no longer holds as stolen is taken out (reportDelivery.js).
    const snapshotIntercepts = s.intercepts && typeof s.intercepts === "object" && !Array.isArray(s.intercepts) ? s.intercepts : null;
    const filedIntercepts = snapshotIntercepts ?? await readInterceptsState({ force: true }).catch(() => ({}));
    const reconciledIntercepts = withoutOrphanedDocuments(filedIntercepts, normalizeWorldState(s.world ?? {}).reports);
    if (snapshotIntercepts || reconciledIntercepts !== filedIntercepts) {
      await writeInterceptsState(reconciledIntercepts);
    }
    // The advisor's notices of papers the restored world no longer puts in the
    // government's hands go with them; its conversation is otherwise the
    // player's and is not rolled back.
    try {
      const advisorMessages = await readJson(JSON_URLS.advisor, { defaultValue: [], force: true });
      const restoredWorld = normalizeWorldState(s.world ?? {});
      const keptMessages = withoutOrphanedNotices(advisorMessages, restoredWorld.reports, normalizeString(s.game?.country));
      if (Array.isArray(advisorMessages) && keptMessages !== advisorMessages) await writeJson(JSON_URLS.advisor, keptMessages);
    } catch (error) {
      console.warn("[rollback] the advisor's notices could not be reconciled:", error?.message || error);
    }
    // Whatever was left of the undone turn's reveal went with it; the turn now
    // newest was seen before the one after it was made.
    unseenEvents.clear();
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

// Whether the last turn can be stopped part-way: a time skip whose journal the
// newest snapshot carries, with more than one event in it.
export const canInterveneInLastTurn = async () => {
  const snapshots = await loadRollbackSnapshots();
  return normalizeArray(snapshots[0]?.turn?.events).length > 1;
};

// Intervene (intervene.js): stop the last turn after its `keptCount`-th event —
// the events revealed so far. The game rolls back to the turn's snapshot and the
// kept prefix of the journal is applied again through the very path the turn
// took, with every check that would ask a model switched off: the events were
// checked when they were made, and stopping a round must cost no request.
// The discarded events never happened; the game's date is the last kept
// event's; the next turn's receipt says so. Returns null when there is nothing
// to stop (no journal, or nothing after the kept events).
export const interveneAfterEvent = async (keptCount) => {
  beginSimulation();
  try {
    const snapshots = await loadRollbackSnapshots();
    const snap = snapshots[0];
    const journal = snap?.turn;
    if (!normalizeArray(journal?.events).length) return null;
    const originDate = normalizeString(snap.state?.game?.gameDate);
    const minimumDate = (originDate && addIsoDays(originDate, 1)) || originDate;
    const { result: truncated, kept, dropped, closingDate } = truncateTurn(journal, keptCount, { originDate, minimumDate });
    if (!dropped.length) return null;

    // Back to the moment before the turn, then forward again with only what the
    // player let happen. The rollback drops this snapshot; the apply captures a
    // fresh one of the same moment with the shorter journal, so undo still works
    // and the round can be stopped earlier still.
    const restored = await rollBackToSnapshot(0);
    if (!restored) return null;
    const { bundle } = restored;
    const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
    const receipt = mergeReceipts(createApplicationReceipt(), journal.receipt ?? null);
    noteReceipt(receipt, "withheld", describeIntervention({ kept, dropped, closingDate }));
    // A budget with nothing left: history consolidation, the tracked stats and
    // every other optional pass ask it first and stand down.
    const requests = createJumpBudget({ cap: 1 });
    requests.take("intervene");
    const applied = await applySimulationResult({
      baseActions: bundle.actions,
      baseChats: bundle.chats,
      baseColors,
      baseEvents: bundle.events,
      baseGame: bundle.game,
      baseWorld: bundle.world,
      campaignId: activeCampaignId(),
      // Every kept event is one the player had already been shown.
      reveal: "shown",
      result: {
        ...truncated,
        generation: { source: "ai", fallbackReason: "" },
        receipt,
        hiddenEvents: [],
        boardProvisionalEventIds: [],
      },
      // An empty review: every director finds its part missing and keeps the
      // events as written, and the board does not move — it moved when the
      // turn was first applied, and the kept events carry their own ops.
      projects: { bundle, signal: null, review: { parts: {}, agentReports: [] }, requests },
    });
    logDebugEvent("turn", `Intervene: the round stopped after "${normalizeString(kept.at(-1)?.title)}" on ${closingDate}; ${dropped.length} event${dropped.length === 1 ? "" : "s"} discarded, no request made.`, {
      kept: kept.map((event) => event.title),
      dropped: dropped.map((event) => event.title),
    });
    return { bundle: applied, kept: kept.length, dropped: dropped.length, closingDate };
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
    // The leader reads the thread as the player has been shown it
    // (runtime/unseenEvents.js); the stored thread is what the fold writes into.
    const priorMessages = withoutUnseenMessages(existing?.messages ?? [], unseenEvents.unseenFor(bundle.world));

    const gameDate = normalizeString(bundle.game?.gameDate);
    const { reply, reaction, memorySummary } = await sendDiplomaticMessageOnceOff({
      playerMessage: trimmedText,
      speakingAs: recipient.name,
      participantNames: [playerName, recipient.name],
      playerCountry: playerName,
      priorMessages,
      chatId: existing?.id ?? "",
    });

    const userMessage = {
      role: "user",
      speaker: playerName,
      text: trimmedText,
      time: gameDate,
      ...(reaction ? { reactions: { [recipient.name]: { emoji: reaction, code: recipient.code || "" } } } : {}),
    };
    const leaderMessage = {
      // Set here so a demand this reply makes can be attached to it.
      id: mintDemandId("msg"),
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

    let nextChats = foldGeneratedChatsIntoStorage(chats, [built], {});
    await writeChatsState(nextChats);

    let finalChat = nextChats.find((chat) => chatParticipantKey(chat.countries) === recipientKey);

    // The advisor's send button is a one-on-one exchange like the panel's, so a
    // reply here can make, answer or settle a demand too (runtime/demandCheck.js).
    // checkDemandReply returns at once, without a request, anywhere but the
    // thread between the player and their own Overlord or Puppet.
    const demandEvents = finalChat
      ? await checkDemandReply({ chat: finalChat, speaker: recipient.name, reply, answering: trimmedText, messageId: leaderMessage.id, time: gameDate })
        .catch(() => [])
      : [];
    if (demandEvents.length) {
      const logged = normalizeChats([{
        ...finalChat,
        events: [...(finalChat.events?.length ? finalChat.events : eventsFromLegacyChat(finalChat)), ...demandEvents],
      }])[0];
      if (logged) {
        nextChats = nextChats.map((chat) => (chat === finalChat ? logged : chat));
        await writeChatsState(nextChats);
        finalChat = logged;
      }
    }
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
// (applyGameMasterCommand) or have no board story (advanceActiveInteractive)
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
  // The skip's phase tracker (skipPhases.js), when a time skip is applying: the
  // board and the history each announce themselves. Null everywhere else.
  phases = null,
  // "staged": a time skip the player will be shown event by event. "shown":
  // events they have already seen (an Intervene re-applying the kept ones).
  reveal = "staged",
  baseWorld,
  result,
}) => {
  // Only a jump keeps one: a resolved interactive event comes through here too, and it is
  // not an answer the simulator will be asked to build on. Every call below is a
  // no-op on null. A copy, because a turn held on its projects pass runs this
  // function a second time with the same arguments, and the tally must not count
  // the turn twice.
  const receipt = result.receipt ? mergeReceipts(createApplicationReceipt(), result.receipt) : null;
  const generatedEvents = normalizeArray(result.events)
    .map((entry, index) => {
      const normalized = normalizeGeneratedEvent({
        ...entry,
        source: entry?.source || result.generation?.source || "ai",
      }, index);
      noteMalformedImpacts(receipt, entry, normalized);
      return normalized;
    })
    .filter(Boolean);
  // The model is shown the running timeline as context and tends to restate events
  // it already reported; each restatement gets a fresh random id, so only a
  // content-key de-dup catches it. Drop restatements BEFORE they persist, apply
  // impacts, or land in this turn's record (also see the [New Developments Only]
  // directive in buildTemplateVariables).
  const priorEvents = normalizeEvents(baseEvents);
  const dedupedEvents = dedupeGeneratedEvents(priorEvents, generatedEvents);
  if (dedupedEvents.length < generatedEvents.length) {
    const fresh = new Set(dedupedEvents);
    for (const event of generatedEvents) {
      if (fresh.has(event)) continue;
      noteReceipt(receipt, "withheld", `"${normalizeString(event?.title)}" — word for word an event already on the record; restating history adds nothing.`);
    }
  }

  // The turn review's answers, when this is a time skip made while requests are
  // being saved (runTurnReview): the curator and the board below read their
  // parts of it instead of making a request each. Null otherwise.
  const review = projects?.review ?? null;
  const requests = projects?.requests ?? null;

  // One curator analysis for the round's candidates and for the breadth
  // repair's supplemental ones.
  const curatorAnalyzeBatch = review
    // The review judged exactly these candidates (reviewCandidateEvents builds
    // the same list this function does). No part — none was asked for, or it came
    // back unusable — is the curator's ordinary "no analyst": everything is kept,
    // and a word-for-word repeat is still removed without one.
    ? async ({ candidates }) => ({
      payload: review.parts.timeline ?? curatorUnavailable(candidates),
      generation: { source: review.parts.timeline ? "ai" : "fallback" },
    })
    : (input) =>
      runJsonTask("timelineCurator", {
        lookups: buildTaskLookups({ world: baseWorld, events: baseEvents, chats: baseChats, game: baseGame }),
        fallback: () => curatorUnavailable(input.candidates),
        signal: projects?.signal,
        userMessage: TIMELINE_CURATOR_INSTRUCTION,
        variables: curatorVariables(input),
        ...jumpTaskOptions(requests, "review"),
      });

  // The curator decides whether an event exists BEFORE impacts, chats, history
  // and persistence see it: the model judges each candidate against recent
  // canon, and deterministic gates (hard mechanical consequences, retrieved
  // prior matches, saturation) decide what those judgments may remove. The
  // default is KEEP, and any failure of the analysis keeps everything.
  // What the player has going on this period (playerFocus.js): the events that
  // answer one of their orders or a Project date due now are spared by the
  // filler gates below, because removing one leaves the order or the milestone
  // with nothing on the timeline to show for it.
  const applyFocus = await readPlayerFocusContext({ game: baseGame, world: baseWorld });
  const focusMaterial = playerMaterialFor(
    { actions: baseActions, chats: baseChats, events: baseEvents, world: baseWorld },
    applyFocus,
    { originDate: baseGame.gameDate, targetDate: normalizeString(result.stopDate) || baseGame.gameDate },
  );
  const spareForFocus = createSpareTest(focusMaterial);
  const mainCuration = await curateGeneratedEventsWithHidden({
    events: dedupedEvents,
    priorEvents,
    game: baseGame,
    world: baseWorld,
    actions: baseActions,
    mode: result.mode,
    analyzeBatch: curatorAnalyzeBatch,
    isSparedFromFiller: spareForFocus,
  });
  let curatedEvents = mainCuration.events;
  for (const row of normalizeArray(mainCuration.dropped)) noteReceipt(receipt, "withheld", describeWithheldEvent(row));
  // Canonical events the curator (and the breadth repair's own screen and
  // curator) kept off the timeline. They still happened; the board pass reads
  // them alongside the segments' screened-out ones (result.hiddenEvents).
  const timelineHiddenEvents = mainCuration.hidden.map((row) => row.event);
  // Breadth is measured by what SURVIVES curation. A month-scale jump left with
  // only a few worthwhile events, or a busy window without consequential
  // outcomes, gets one bounded second search of the exploration lanes still
  // visibly neglected; every supplemental event passes the same integrity
  // screen and the same curator. Not a quota: a quiet world may return none.
  //
  // Not while requests are being saved. It is a second search — a whole request,
  // and a curator pass after it — to pad a skip that came back thin, and a thin
  // skip is still a skip: the lanes it neglected are the ones the world director
  // selects first next turn.
  const breadthRepair = review ? null : await maybeRepairWorldBreadthAfterCuration({
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
    const repairCuration = await curateGeneratedEventsWithHidden({
      isSparedFromFiller: spareForFocus,
      events: repairScreened.events,
      priorEvents: [...priorEvents, ...curatedEvents],
      game: baseGame,
      world: baseWorld,
      actions: baseActions,
      mode: result.mode,
      analyzeBatch: curatorAnalyzeBatch,
    });
    const repairCuratedEvents = repairCuration.events;
    timelineHiddenEvents.push(
      ...normalizeArray(repairScreened.hidden).map((row) => row.event),
      ...repairCuration.hidden.map((row) => row.event),
    );
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
  const keptPuppetUpdates = filterBoundLedgerUpdatesToKeptEvents(result.puppetUpdates, dedupedEvents, curatedEvents);
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
  const puppetUpdates = remapLedgerEventIds(normalizeArray(keptPuppetUpdates), canonicalEventIdentity.idMap);
  const storylineUpdates = remapLedgerEventIds(normalizeArray(keptStorylineUpdates), canonicalEventIdentity.idMap);
  let nextGame = normalizeGameData({
    ...baseGame,
    gameDate: normalizeString(result.stopDate) || baseGame.gameDate,
    round: (baseGame.round || 1) + 1,
  });
  const plannedActionSnapshot = normalizeActions(baseActions).filter((action) => action.status === "planned");
  // An order is resolved by the event that answered it, not by the turn having
  // run (AI/playerFocus.js settleOrders). One the skip passed over stays queued
  // and is marked overdue, so the next skip is told to answer it first — the
  // whole queue used to be cleared either way, and an ignored order simply
  // vanished. Only when the skip resolved the queue at all: a scene or a check
  // that leaves the orders planned has not answered them.
  let nextActions = result.clearActions
    ? settleOrders(normalizeActions(baseActions), freshEvents)
    : normalizeActions(baseActions);
  // An order the skip narrated but never CITED stays queued, because nothing in
  // the answer says it was carried out. The model is told at the top of its next
  // turn, where the same orders are listed as overdue — a model that forgets
  // actionIds once should not leave a player's queue growing quietly.
  const carriedOrders = nextActions.filter((action) => action.status === "planned" && action.overdue === true).length;
  if (carriedOrders) {
    noteReceipt(
      receipt,
      "short",
      `${carriedOrders} of the player's queued order${carriedOrders === 1 ? " was" : "s were"} left without an outcome and ${carriedOrders === 1 ? "is" : "are"} carried over as overdue. `
        + "Answer each of them this period, in an event that lists that order's id in actionIds — an event that tells the story without naming the id does not resolve it.",
    );
  }
  let nextChats = [...normalizeChats(baseChats)];
  // Chats this turn CREATED, kept apart from the pre-turn snapshot. A turn takes a
  // while to generate and the player can edit the chat list while it runs, so the
  // write at the end merges these onto whatever is actually stored by then rather
  // than putting the stale snapshot back. See the re-read before writeChatsState.
  const generatedChats = [];

  // Everything that could keep an event or an operation out has now run, so what
  // is left is what the world is about to receive.
  tallyAppliedEvents(receipt, freshEvents);

  const impactMerge = applyEventImpactsToWorld({
    colors: baseColors,
    events: freshEvents,
    // Give every unit op a travel budget of the days between the previous event
    // and its own, so a move op advances a formation as far as it could actually
    // have got rather than teleporting it. An over-long move becomes a partial
    // advance plus a standing order the engine keeps working on later turns.
    //
    motion: { originDate: baseGame.gameDate, round: nextGame.round, tick: 0 },
    world: {
      ...baseWorld,
      // Whatever comes through here ends a scene: a skip is refused while one is
      // in progress and clears a leftover one, and a scene resolving is this.
      activeInteractive: null,
      actionSuggestions: [],
      lastJumpMode: normalizeString(result.mode),
      lastJumpSummary: normalizeString(result.summary),
      lastJumpTargetDate: nextGame.gameDate,
      simulationHistory: [
        {
          date: nextGame.gameDate,
          eventIds: freshEvents.map((event) => event.id),
          fallbackReason: normalizeString(result.generation?.fallbackReason),
          fromDate: baseGame.gameDate,
          mode: normalizeString(result.mode) || "jump",
          plannedActions: plannedActionSnapshot,
          // The raw model response that failed to parse (runJsonTask), so the
          // fallback warning's "Save logging file" button (time.jsx) has
          // something to attach even after a reload — only ever non-empty on a
          // fallback turn; a normal AI turn carries nothing here.
          rawResponse: normalizeString(result.generation?.rawResponse),
          // What became of this turn's answer, read once by the next jump
          // (runtime/applicationReceipt.js). normalizeWorldState keeps the notes
          // on the newest receipt only, so older turns carry their counts alone.
          ...(receipt ? { receipt } : {}),
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
  const nextColors = impactMerge.colors;
  let impactedWorld = impactMerge.world;
  // A polity renamed this turn — by an event's polityChanges, or a record whose
  // display name still differed from its key — is re-keyed everywhere the world
  // state does not carry: the game's own polity, the queued orders, the chats
  // (below), the flags, and the stock map's baked regions with no override.
  const renamedPolities = normalizeArray(impactMerge.renamedPolities);
  let renamedFlags = null;
  if (renamedPolities.length) {
    const regions = filterToRenderedRegions(await loadRegionCatalog().catch(() => []), impactedWorld);
    for (const { from, to } of renamedPolities) {
      impactedWorld = expandBakedRegionsForRename(impactedWorld, regions, from, to);
      nextGame = renamePolityInGame(nextGame, from, to);
      nextActions = renamePolityInActions(nextActions, from, to);
    }
    const flagsBefore = await getNationFlags({ force: true }).catch(() => ({}));
    renamedFlags = renamedPolities.reduce((flags, { from, to }) => renamePolityInFlags(flags, from, to), flagsBefore);
  }

  // Live institution lifecycle effects ride the SAME events that narrate them.
  // Geography/unit/report reducers remain in gameState; membership needs chats
  // and sovereign authority too, so it is applied here against the already-
  // reconciled canonical world. Any late refusal is stripped from the stored
  // event and recorded in the receipt rather than leaving prose that claims a
  // membership mutation native law refused.
  for (const event of freshEvents) {
    const lifecycleOps = normalizeArray(event?.impacts?.institutionLifecycleOps);
    if (!lifecycleOps.length) continue;
    const batch = applyInstitutionLifecycleImpactBatchCore({
      world: impactedWorld,
      chats: nextChats,
      playerCountry: nextGame.country || baseGame.country,
      date: event.date || nextGame.gameDate,
      ops: lifecycleOps,
    });
    impactedWorld = batch.world;
    nextChats = normalizeChats(batch.chats);
    event.impacts.institutionLifecycleOps = batch.applied.map((entry) => entry.op);
    for (const rejected of batch.rejected) {
      noteReceipt(
        receipt,
        "dropped",
        `Event "${normalizeString(event.title)}": an institution lifecycle operation was refused — ${normalizeString(rejected.reason) || "native institution law rejected it"}.`,
      );
    }
    for (const created of batch.createdChats) {
      const chat = normalizeChatEntry({ ...created, revealWith: event.id });
      if (!chat) continue;
      nextChats = [chat, ...nextChats.filter((entry) => normalizeString(entry?.id) !== normalizeString(chat.id))];
      generatedChats.push(chat);
    }
  }

  // Advance every standing order the model did NOT touch across the whole jump,
  // and drift the patrols. This is what keeps a fleet crossing an ocean moving
  // turn after turn, and a squadron visibly working its station, with none of it
  // having to come back from the model. Units the model DID move are skipped:
  // they already stepped once per event against that event's own budget, and
  // advancing them again here would move them twice for the same elapsed time.
  const movedThisTurn = freshEvents.flatMap((event) =>
    normalizeArray(event.impacts?.unitOps).map((op) => op.unitId || op.unit?.id).filter(Boolean));
  // A deployment the player asked for and this skip resolved without removing
  // it has been accepted (gameState.js confirmResolvedDeployments). Only when the
  // skip resolved the planned actions: a scene or a check that leaves them
  // planned has not answered the request yet.
  let worldWithImpacts = enforceUnitVolume(
    confirmResolvedDeployments(advanceStandingOrders(
      // Rounds may have passed under the old classic system since these orders
      // were issued, which would leave every dormant patrol already expired.
      // Give them the rest of their life from here before advancing anything.
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
    ), result.clearActions ? plannedActionSnapshot : []),
    { playerCode: baseGame.country },
  );

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
  // With espionage switched off for this game nothing is rolled: the agents
  // already in the world stay where they are, silent, and no new one arrives.
  const espionage = isActiveFeatureEnabled("espionage")
    ? resolveEspionage(worldWithImpacts, {
      round: nextGame.round,
      date: nextGame.gameDate,
      playerPolity: normalizeString(baseGame.country),
      candidates: espionageCandidates,
    })
    : { spies: normalizeArray(worldWithImpacts.spies), events: [], notices: [] };
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

  // THE ONE DETERMINISTIC LOYALTY RULE: a demand the Puppet REFUSED costs a
  // fixed amount, once. A demand is a record in its thread's log
  // (chatThreads.js), answered from the demand card by the player or read off
  // an AI's reply by the demandCheck task (runtime/demandCheck.js). Collected
  // here, off the saved threads, rather than charged when it happened, because a
  // world write from the chat panel would race the turn's. chargeRefusals owns
  // the rest — once per refused demand, recorded in world.chargedRefusals where
  // no chat writer can erase it — and is where it can be tested.
  // With the system off nothing is collected and nothing is marked charged: a
  // game that switches back on has not silently spent the refusals it made
  // while the feature was away.
  const puppetStates = isActiveFeatureEnabled("puppetStates");
  const refusalCharge = puppetStates
    ? chargeRefusals(nextChats, worldWithImpacts.chargedRefusals)
    : { refusedDemands: [], charged: worldWithImpacts.chargedRefusals };
  const refusedDemands = refusalCharge.refusedDemands;
  worldWithImpacts = { ...worldWithImpacts, chargedRefusals: refusalCharge.charged };

  const diplomaticMerge = applyDiplomaticUpdates({
    world: worldWithImpacts,
    relationUpdates: [...relationUpdates, ...espionageRelationUpdates],
    agreementUpdates,
    puppetUpdates,
    refusedDemands,
    puppetStates,
    regionCatalog: await regionCatalogForPuppets(puppetUpdates, worldWithImpacts),
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });
  // Agents report on the ledger as this turn left it: an arrangement installed
  // or ended this turn is what an agent inside either party now sees. After the
  // merge, and after espionage has decided which agents are still in place.
  worldWithImpacts = puppetStates
    ? revealPuppetsToSpies(diplomaticMerge.world, nextGame.gameDate)
    : diplomaticMerge.world;
  // Storylines last: they read the wars and relations as this turn left them.
  // A Puppet whose Loyalty has collapsed is handed a hidden Storyline by the
  // engine, not the model — a turn that forgot to open one would mean a decade
  // of mistreatment silently never happened. The director decides WHEN anything
  // comes of it, exactly as for every other ongoing situation.
  const storylineMerge = applyWorldStorylineUpdates({
    world: worldWithImpacts,
    updates: [...normalizeArray(storylineUpdates), ...normalizeArray(diplomaticMerge.puppetStorylineSeeds)],
    events: freshEvents,
    stopDate: nextGame.gameDate,
    round: nextGame.round,
  });
  worldWithImpacts = storylineMerge.world;
  // Each segment was checked on its own; this is the merged round. A finished
  // turn is never lost to this check, but its verdict is worth a report. Read
  // as the one period it is (startsInForce), as the last attempt's repair
  // reads it: a war the round starts is in force for all of the round.
  const canonicalWarError = validateCanonicalWarEvents({ events: freshEvents, updates: warUpdates, world: baseWorld, startsInForce: true });
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
  if (espionageEventIds.length) {
    worldWithImpacts = withLatestTurnEventIds(worldWithImpacts, (ids) => [...ids, ...espionageEventIds]);
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
  if (spyOrders.length && !isActiveFeatureEnabled("espionage")) {
    logDebugEvent("espionage", `Spy orders ignored: espionage is off for this game (${spyOrders.length}).`);
  } else if (spyOrders.length) {
    const outcome = applySpyOps(worldWithImpacts, spyOrders, { date: nextGame.gameDate, playerPolity });
    worldWithImpacts.spies = outcome.spies;
    if (outcome.applied.length) {
      logDebugEvent("espionage", `Spy orders applied: ${outcome.applied.map((entry) => `${entry.op} ${entry.target}`).join(", ")}`);
    }
    for (const skipped of outcome.rejected) {
      logDebugEvent("espionage", `Spy order skipped: ${skipped.reason}`, { op: skipped.op });
    }
    // An agent ordered into a polity nobody has rated: get that service its
    // first reading now (it waits for this turn's write), so the espionage
    // maths it meets next turn run on a judgement rather than the default.
    for (const entry of outcome.applied) {
      if (entry.op === "deploy") void ensureCountryAssessed(entry.target, { reason: "agent deployed by order" });
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
    phases?.enter("board");
    // Every Canonical event the timeline left out, minus anything the log or this
    // turn's own timeline already holds (the de-dup that visible events had).
    const boardHiddenEvents = dedupeGeneratedEvents(
      [...priorEvents, ...freshEvents],
      [...normalizeArray(result.hiddenEvents), ...timelineHiddenEvents]
        .map((entry, index) => normalizeGeneratedEvent(entry, index))
        .filter(Boolean),
    );
    // The major events that passed the consequence check only on a Board entry,
    // by their canonical ids now. The board pass must back each one — unless the
    // event has since gained a consequence of its own (the unit and territory
    // directors add ops after the segment check), in which case it stands on that
    // and is not the board pass's to prove.
    const provisionalIds = new Set(
      normalizeArray(result.boardProvisionalEventIds)
        .map((id) => canonicalEventIdentity.idMap.get(id) || id),
    );
    const provisionalIndexes = new Set(freshEvents
      .map((event, index) => (provisionalIds.has(event.id) && !eventCarriesOwnConsequence(event) ? index : -1))
      .filter((index) => index >= 0));
    try {
      const { ops, skipped } = review
        // Answered already, by the turn review's board job — which numbered the
        // events as the skip WROTE them, so its ops are moved onto the list the
        // turn ended with (turnReview.js remapBoardOps). No board part means the
        // board does not move this turn; it never holds the turn, because the
        // only way to un-hold it would be another request.
        ? reviewedProjectOps({ review, visibleEvents: freshEvents, hiddenEvents: boardHiddenEvents, idMap: canonicalEventIdentity.idMap })
        : await generateProjectOps(
          // The LIVE world, not projects.bundle's pre-turn copy: the bundle was
          // read before the turn ran, so its board carries none of this turn's
          // impacts and none of the covert-operation sync just above.
          { ...projects.bundle, game: nextGame, world: worldWithImpacts },
          freshEvents,
          { signal: projects.signal, hiddenEvents: boardHiddenEvents, requests },
        );
      // The board was looked at this round, whatever it found (projects.js
      // boardPassReasons counts the quiet rounds from here).
      if (!skipped) worldWithImpacts = { ...worldWithImpacts, boardReviewedRound: nextGame.round };
      // One carrier per event, in date order across the visible and Hidden lists,
      // so an entry a Hidden event opens exists before a later event moves it.
      const carriers = boardPassCarriers({
        ops: skipped ? [] : ops,
        visibleEvents: freshEvents,
        hiddenEvents: boardHiddenEvents,
      });
      // Recorded on the visible events that caused them, as always.
      const attached = attachProjectOpsToEvents(freshEvents, carriers
        .filter((carrier) => carrier.onTimeline)
        .flatMap((carrier) => carrier.ops.map((op) => ({ ...op, eventIndex: carrier.eventIndex }))));

      // APPLIED here, one event at a time, through the same event path every other
      // impact takes (release of completion effects included), so the board the
      // player sees after this write is the one the model moved. Only the project
      // ops are replayed: the events' other impacts were applied when the world
      // was first impacted, and must not run twice. A Hidden event's carrier is
      // never stamped into an entry's activity, which lists timeline events only;
      // nor is a fallback, which names no event of its own (stampsActivity).
      //
      // A provisional event is judged on the Board itself, before and after its
      // OWN ops: if nothing changed materially, its claim was never recorded, so
      // its ops are applied unstamped and the event leaves the timeline below.
      const unbackedIds = new Set();
      // A provisional event the board pass left no ops of its own on is unbacked
      // before anything is applied, so not even a fallback op stamps it.
      for (const index of provisionalIndexes) {
        const touched = carriers.some((carrier) => carrier.onTimeline && !carrier.fallback && carrier.eventIndex === index);
        if (!touched && freshEvents[index]) unbackedIds.add(freshEvents[index].id);
      }
      const movedByHidden = new Set();
      let hiddenEventsThatMoved = 0;
      const applyCarrier = (world, carrier, event, { stamped }) => applyEventImpactsToWorld({
        colors: nextColors,
        events: [{ id: event.id, date: event.date || nextGame.gameDate, title: event.title, description: "", impacts: { projectOps: carrier.ops } }],
        world,
        motion: null,
        round: nextGame.round,
        boardOnlyEventIds: stamped ? [] : [event.id],
      }).world;
      for (const carrier of carriers) {
        const event = carrier.onTimeline ? freshEvents[carrier.eventIndex] : boardHiddenEvents[carrier.hiddenIndex];
        if (!event) continue;
        const before = worldWithImpacts;
        const stamped = carrier.stampsActivity && !unbackedIds.has(event.id);
        let after = applyCarrier(before, carrier, event, { stamped });
        const changed = materiallyChangedEntryIds(before.projects, after.projects);
        if (carrier.onTimeline && !carrier.fallback && provisionalIndexes.has(carrier.eventIndex) && !changed.length) {
          unbackedIds.add(event.id);
          after = applyCarrier(before, carrier, event, { stamped: false });
        }
        if (!carrier.onTimeline && changed.length) {
          hiddenEventsThatMoved += 1;
          changed.forEach((id) => movedByHidden.add(id));
        }
        worldWithImpacts = after;
      }
      if (attached) logDebugEvent("turn", `Projects board updated: ${attached} op(s).`, undefined, { verbose: true });

      // An unbacked event made a claim nothing recorded, so it leaves the timeline.
      // It carries no consequence of its own (checked above, after the directors
      // ran), so only the lists that name it need it taken out.
      if (unbackedIds.size) {
        for (const list of [freshEvents, nextEvents]) {
          for (let index = list.length - 1; index >= 0; index -= 1) {
            if (unbackedIds.has(list[index]?.id)) list.splice(index, 1);
          }
        }
        worldWithImpacts = withLatestTurnEventIds(worldWithImpacts, (ids) => ids.filter((id) => !unbackedIds.has(id)));
      }
      const unassessed = skipped ? [] : unassessedHighPriorityEntries(worldWithImpacts.projects, ops, { playerCountry: playerPolity });
      console.info(
        `[OH board] ${boardHiddenEvents.length} Hidden event(s) read, ${hiddenEventsThatMoved} of them moved `
        + `${movedByHidden.size} Board entr${movedByHidden.size === 1 ? "y" : "ies"}; `
        + `${provisionalIndexes.size} provisional major event(s), ${unbackedIds.size} unbacked and kept off the timeline; `
        + `${unassessed.length} HIGH PRIORITY entr${unassessed.length === 1 ? "y" : "ies"} not assessed`
        + `${unassessed.length ? ` (${unassessed.map((entry) => entry.name).join(", ")})` : ""}.`,
      );
    } catch (error) {
      // A deliberate cancel is the player's and aborts the turn like any other.
      if (error?.name === "AbortError") throw error;
      // Nothing has been written at this point, so the caller can hold the turn
      // and re-run just this call. Marked, not held, here: the caller is the one
      // holding the arguments a retry needs.
      logDebugEvent("turn", "Turn HELD: the board did not update, so nothing was written.", error);
      throw projectsHeldError(error);
    }
    phases?.enter("applying");
  }

  // The structures this turn built for a Project, linked to it now that both
  // the map and the board are final (nativeStructureDirector.js).
  worldWithImpacts = linkStructuresToProjects(worldWithImpacts, result.structureLinks);

  // A milestone whose date this skip passed with nothing said about it is late,
  // not still pending (playerFocus.js): the Board says so, and the next skip is
  // asked to answer it. After the board pass, so a milestone the model reached
  // or missed this turn keeps the outcome it was given.
  const slippedProjects = slipPassedMilestones(normalizeArray(worldWithImpacts.projects), { date: nextGame.gameDate });
  if (slippedProjects.some((project, index) => project !== normalizeArray(worldWithImpacts.projects)[index])) {
    worldWithImpacts = { ...worldWithImpacts, projects: slippedProjects };
  }

  // The documents that changed hands this turn, delivered to the player the way
  // a government receives them (runtime/reportDelivery.js): a letter into the
  // thread with its sender (below, with the other notes), a copy stolen by an
  // agent into that agent's intercepts (filed after the write), a published text
  // or the player's own paper onto its event (time.jsx reads those from the
  // file). A stolen copy is marked in the file for the narrator.
  const documentPlayer = normalizeString(baseGame.country);
  const reportDeliveries = planReportDeliveries({
    before: normalizeArray(baseWorld.reports),
    after: normalizeArray(worldWithImpacts.reports),
    player: documentPlayer,
    agents: activeSpies(worldWithImpacts, documentPlayer).filter((spy) => spy.status === "active"),
  });
  if (reportDeliveries.some((delivery) => delivery.channel === "intelligence")) {
    worldWithImpacts = { ...worldWithImpacts, reports: markIntercepted(worldWithImpacts.reports, reportDeliveries, documentPlayer) };
  }
  if (reportDeliveries.length) {
    logDebugEvent("turn", `Documents delivered: ${reportDeliveries.map((delivery) => `"${delivery.report.title}" by ${delivery.channel}`).join("; ")}.`, undefined, { verbose: true });
  }

  // Now and then a time skip offers one of its events to be played out as an
  // interactive event (runtime/interactiveOffer.js). Chosen here, where the
  // turn's events are final, and at no cost: no request is made until the player
  // takes it up. Every skip replaces the last skip's offer, taken up or not.
  if (result.mode === "jump" || result.mode === "auto") {
    const offer = chooseInteractiveOffer({
      events: freshEvents,
      round: nextGame.round,
      lastOfferRound: baseWorld?.lastInteractiveOfferRound,
    });
    worldWithImpacts = {
      ...worldWithImpacts,
      interactiveOffer: offer,
      ...(offer ? { lastInteractiveOfferRound: offer.round } : {}),
    };
    if (offer) {
      const offered = freshEvents.find((event) => event.id === offer.eventId);
      logDebugEvent("turn", `Interactive event offered: "${normalizeString(offered?.title) || offer.eventId}" can be played out as a scene.`);
    }
  }

  let nextWorld = worldWithImpacts;

  // Everything this turn writes into a thread or a file is shown with an event
  // (runtime/unseenEvents.js): a chat an event opened with that event, and what
  // belongs to the period rather than to one event with its last.
  const lastTurnEventId = normalizeString(normalizeArray(worldWithImpacts.simulationHistory?.[0]?.eventIds).at(-1));

  for (const event of freshEvents) {
    for (const createdChat of event.impacts.createdChats) {
      const nextChat = await buildGeneratedChat(createdChat, event.id, worldWithImpacts, {
        fallbackTitle: event.title,
        playerName: baseGame.country,
        revealWith: event.id,
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
      revealWith: lastTurnEventId,
    });
    if (nextChat) { nextChats.unshift(nextChat); generatedChats.unshift(nextChat); }
  }

  // A document the player now holds with other governments is filed in the
  // thread with them, spoken by its sender — folded like any note, so a thread
  // already open is where it lands.
  for (const delivery of reportDeliveries.filter((entry) => entry.channel === "diplomacy")) {
    const revealWith = deliveryEventId(delivery, lastTurnEventId);
    const nextChat = await buildGeneratedChat(documentNote(delivery, { eventId: revealWith }), normalizeString(delivery.report.sourceEventId), worldWithImpacts, {
      playerName: baseGame.country,
      revealWith,
    });
    if (nextChat) { nextChats.unshift(nextChat); generatedChats.push(nextChat); }
  }

  if (result.mode === "jump" || result.mode === "auto") {
    try {
      phases?.enter("history");
      nextWorld = await compactHistoryIfNeeded({
        actions: nextActions,
        chats: nextChats,
        events: nextEvents,
        game: nextGame,
        world: worldWithImpacts,
      }, { requests });
    } catch (error) {
      console.warn("[ai] campaign history consolidation failed; the completed turn will still be saved.", error);
    }
    // Everything after this is the writing of the turn itself.
    phases?.enter("applying");
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
      requests,
    });
  } catch (error) {
    if (projects?.signal?.aborted) throw error;
    console.warn("[stats auto] unexpected scheduler failure; the completed turn is preserved.", error);
  }

  // Native institution lifecycle clock: withdrawal notice periods and other
  // already-authorized dated lifecycle effects resolve without buying an AI
  // request. The lifecycle case itself is the authority; this never invents a
  // new sovereign choice.
  try {
    const lifecycle = advanceInstitutionLifecycleCore({
      world: nextWorld,
      date: nextGame.gameDate || nextGame.startDate || "",
      playerCountry: baseGame.country || "",
    });
    nextWorld = lifecycle.world;
    if (lifecycle.applied.length) {
      logDebugEvent("turn", `Institution lifecycle: ${lifecycle.applied.length} dated lifecycle effect(s) resolved.`, lifecycle.applied, { verbose: true });
    }
  } catch (error) {
    console.warn("[institution lifecycle] native lifecycle advance failed; the completed turn is preserved.", error);
  }

  // Native PWv2 background motion: after the turn's canonical impacts and any
  // due Stats refresh have settled, structural world conditions advance the
  // political-pressure clock and authored/generated political response profiles.
  // This is CPU-only and spends ZERO AI requests. If the worker is unavailable,
  // the previous canonical political state is preserved and a later turn can
  // catch up from the unchanged clock.
  try {
    const political = await advancePoliticalBackgroundSimulation({
      world: nextWorld,
      fromDate: baseGame.gameDate || baseGame.startDate || "",
      toDate: nextGame.gameDate || nextGame.startDate || "",
      round: nextGame.round || 0,
      signal: projects?.signal,
    });
    nextWorld = political.world;
    if (!political.skipped && (political.pressureChangedPolities || political.responseChangedEntities || political.dispositionChangedPolities)) {
      logDebugEvent(
        "turn",
        `Political background: ${political.pressureChangedPolities} pressure polity(s), ${political.responseChangedEntities} political response change(s), ${political.dispositionChangedPolities || 0} disposition change(s).`,
        {
          responseTicks: political.plan?.responseTicks || 0,
          structuralSignalPolities: political.structuralSignalPolities || 0,
          droppedResponseTicks: political.plan?.droppedResponseTicks || 0,
        },
        { verbose: true },
      );
    }
  } catch (error) {
    if (projects?.signal?.aborted) throw error;
    console.warn("[politics background] native political update failed; the completed turn is preserved.", error);
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
  for (const { from, to } of renamedPolities) chatsToWrite = renamePolityInChats(chatsToWrite, from, to);

  // Last moment before anything is persisted. Everything above is pure, so a
  // turn generated for a campaign the player has since left is simply lost here
  // rather than written over whichever campaign they opened instead.
  assertCampaignUnchanged(campaignId, activeCampaignId());

  // A time skip is shown one event at a time (time.jsx), its first on screen as
  // it lands; until the reveal reaches an event, nothing the player or the AI
  // speaking to them is shown may contain it (runtime/unseenEvents.js). Marked
  // before anything is written, so no reader of the new files ever finds the
  // turn without its reveal. An Intervene re-applies events already seen.
  if (reveal === "staged" && (result.mode === "jump" || result.mode === "auto")) {
    unseenEvents.markTurnUnseen(normalizeArray(nextWorld.simulationHistory?.[0]?.eventIds));
  }

  // Publish the complete canonical turn as ONE generation. Desktop persists the
  // six domains behind a recovery journal; web mode updates its single game
  // record transactionally. Client caches switch generation before listeners
  // are notified, so no observer can see a hybrid turn.
  await writeCanonicalTurnState({
    actions: nextActions,
    chats: chatsToWrite,
    events: nextEvents,
    game: nextGame,
    colors: nextColors,
    world: nextWorld,
  }, {
    expectedGameId: campaignId,
  });

  // Flags are presentation data rather than turn authority. A polity rename may
  // update them, but a failed emblem write must not roll back an otherwise valid
  // canonical generation.
  if (renamedFlags) {
    try {
      await writeJson(JSON_URLS.flags, renamedFlags, { pretty: true });
    } catch (error) {
      console.warn("[turn] renamed flags could not be persisted; canonical turn remains committed.", error);
    }
  }

  // The turn's new state is now persisted. Web-mode encrypted sync listens for this
  // to back up the turn (replacing a fixed 20s poll); it is a no-op in desktop mode
  // where nothing listens. Firing here — the single choke point every turn type runs
  // through (jump, auto-jump, interactive event, game-master) — means the sync's full scan
  // sees the committed round.
  if (typeof window !== "undefined") window.dispatchEvent(new Event("oh:turn-complete"));

  // The agents' file before this turn files anything into it, kept with the
  // restore point below so an undo takes the turn's reports and stolen copies
  // back with everything else.
  const baseIntercepts = await readInterceptsState({ force: true }).catch(() => null);

  // Spies report on the world the turn just produced. Awaited so the reports are
  // there when the player opens the Spy tab, but never allowed to fail the turn.
  // While requests are being saved the reports came with the turn review, in its
  // one request, and are only filed here; a turn with no review (a resolved
  // interactive event, a game-master command) waits for the next skip's. Otherwise each
  // agent makes its own request, as before.
  if (review) await fileReviewedAgentReports(review);
  else if (!savingRequests()) await refreshSpyIntercepts();
  // And what the player's agents stole this turn, beside their traffic.
  await fileStolenDocuments(reportDeliveries, { world: nextWorld, game: nextGame, lastEventId: lastTurnEventId });
  // And the advisor flags each new paper in its conversation.
  await postDocumentNotices(reportDeliveries, { lastEventId: lastTurnEventId, date: nextGame.gameDate });

  // Snapshot the state we just replaced so it can be rolled back to (best-effort),
  // with what this turn applied beside it, in the order the reveal shows it, so
  // the player can stop the round part-way (Intervene). Only a time skip is
  // worth stopping: a resolved interactive event or a game-master command is one moment.
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
    intercepts: baseIntercepts,
    turn: result.mode === "jump" || result.mode === "auto"
      ? journalTurn({
        events: freshEvents,
        excludeEventIds: espionageEventIds,
        warUpdates,
        relationUpdates,
        agreementUpdates,
        storylineUpdates,
        stopDate: nextGame.gameDate,
        summary: result.summary,
        outreach: result.outreach,
        clearActions: result.clearActions,
        mode: result.mode,
        receipt,
      })
      : null,
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

// The campaign as the player has been shown it, for whatever speaks to them while
// a skip is being revealed (gameState.js viewAsSeen): the events up to the
// reveal's front and the world as they left it. Read-only — never written back;
// a writer re-reads what is stored.
const readSeenGameStateBundle = async (options) => {
  const saved = await readGameStateBundle(options);
  const seen = await viewAsSeen(saved);
  return { ...saved, world: seen.world, events: seen.events, chats: seen.chats, game: seen.game, savedGame: saved.game, unseen: seen.unseen };
};

export const generateActionSuggestions = async ({ force = true } = {}) => {
  // Suggestions answer the moment the player is looking at (readSeenGameStateBundle).
  const bundle = await readSeenGameStateBundle({ force });
  const variables = await buildTemplateVariables(bundle, { lookups: true });
  const { payload } = await runJsonTask("actions", {
    lookups: buildTaskLookups(bundle),
    fallback: () => fallbackActionSuggestions(bundle),
    // The direction the suggestions serve (runtime/playerGoal.js), when the
    // player has set one.
    userMessage: [
      describeGoalForSuggestions(playerGoalOf(bundle.world, bundle.game?.country)),
      "Generate current strategic action suggestions as JSON only.",
    ].filter(Boolean).join("\n\n"),
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

const collectWorldInitiativePoliticalActors = (analysis, playerPolity = "", maxActors = 8) => {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const actor = normalizeString(value);
    const key = actor.toLocaleLowerCase();
    if (!actor || seen.has(key) || out.length >= Math.max(1, Number(maxActors) || 8)) return;
    seen.add(key);
    out.push(actor);
  };

  // The human polity belongs in the context because endogenous domestic pressure
  // can matter to history, but the prompt below explicitly keeps that evidence
  // separate from authority to invent a sovereign player choice.
  push(playerPolity);

  for (const storyline of normalizeArray(analysis?.attentionStorylines)) {
    for (const participant of normalizeArray(storyline?.participants)) push(participant);
  }
  for (const slot of normalizeArray(analysis?.explorationSlate)) {
    if (normalizeString(slot?.type) === "actor-domain") push(slot?.actor);
  }
  for (const actor of normalizeArray(analysis?.diplomaticActors)) push(actor);
  for (const row of normalizeArray(analysis?.economicActors)) push(row?.actor);

  return out;
};

const buildWorldInitiativePoliticalDecisionContext = ({ world, analysis, playerPolity }) => {
  const actorPolities = collectWorldInitiativePoliticalActors(analysis, playerPolity, 8);
  if (!actorPolities.length) return "";

  const set = buildBoundedPoliticalDecisionContextSet(world, {
    actorPolities,
    maxActors: 8,
    perActorMaxChars: 1900,
    maxTotalChars: 11000,
    limits: {
      traits: 5, goals: 4, fears: 3, ambitions: 3, domesticPressures: 4,
      pressureIssues: 4, governingEntities: 3, oppositionEntities: 2,
      perceptions: 3, relations: 3, agreements: 3, wars: 2, institutions: 6,
    },
  });
  if (!set.text) return "";

  return [
    "[PRIVATE POLITICAL DECISION CONTEXT - ENGINE DATA]",
    set.text,
    "Use each actor capsule only as evidence about that actor's incentives, constraints and endogenous political motion.",
    "For the HUMAN-controlled polity, internal pressure may produce non-sovereign social, party, institutional or public developments, but it is NOT consent or authority to invent a new executive, parliamentary, diplomatic, military, territorial or other sovereign choice. Such choices require exact prior player authority already present in canonical orders/process state.",
    "Do not reveal one actor's private political state to another unless that knowledge is explicitly present in the actor's own Political Knowledge or the objective canonical ledger.",
  ].join("\n");
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


// ---- Bounded call for the world repairs ------------------------------------
// Both repairs used to hand callAI a stopwatch "deadline", which callAI only
// reads to decide whether a busy-retry still fits — nothing ever aborted on it,
// so a stalled repair could hold a finished turn forever. runBoundedRepairCall
// (repairCall.js) aborts on silence with runJsonTask's two windows, always on
// (idleDeadline.js explains why repairs ignore "Limit AI generation"), and at
// `hardLimitMs` when the caller has a time budget to keep. The abort is on a
// local controller: the caller's `signal` stays un-aborted, so its catch sees an
// ordinary failure, while the player's Cancel still cancels.
const callRepairAI = async ({ systemPrompt, userMessage, taskKey, tool, signal, reasoningEnabled, hardLimitMs, lookups = null } = {}) => {
  const now = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const startedAt = now();
  try {
    const response = await runBoundedRepairCall(
      ({ signal: callSignal, deadline, onActivity }) =>
        callAI(systemPrompt, [
          { role: "user", parts: [{ text: userMessage }] },
        ], {
          deadline,
          onActivity,
          ...(reasoningEnabled === undefined ? {} : { reasoningEnabled }),
          signal: callSignal,
          taskKey,
          tool,
          lookups,
        }),
      { taskKey, signal, hardLimitMs },
    );
    recordTurnPerfAiAttempt({ taskKey, attempt: 1, ms: Math.max(0, now() - startedAt) });
    return response;
  } catch (error) {
    recordTurnPerfAiAttempt({
      taskKey,
      attempt: 1,
      ms: Math.max(0, now() - startedAt),
      error: normalizeString(error?.message || error),
    });
    throw error;
  }
};

// ---- Storyline motion repair (Continuum 07.2) -----------------------------
// A selected storyline that the finished skip still left objectively unchanged
// past its anti-stasis backstop, or never updated, is repaired on its own: one
// narrow AI call that may only return that storyline's semantic movement.
// Unrelated events are never discarded, and a failed repair just leaves the
// process overdue for the next turn.
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
  // The rest of the skip's repair time; the call is stopped when it runs out.
  hardLimitMs,
  // Filled in on failure, so the pass can tell a repair stopped by its time
  // budget from one that failed (repairSkipStorylineMotion).
  outcome = null,
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
  // Past the backstop, the validator below (storylineHasObjectiveEvolution)
  // rejects a prose-only change however well argued, so the model has to be told
  // the numbers. It used to be told a prose-only stalemate was legal, and failed
  // the same way every segment.
  const motionRule = issue?.requiresObjectiveDelta
    ? `HARD RULE — this process is past its anti-stasis backstop, so a rewritten state with the same numbers is REJECTED. ` +
      `Compared with the authoritative storyline below, you MUST ${describeAntiStasisObjectiveRule({ withEvent: false })}. ` +
      `A stalemate is still legal, but it must show in the numbers — for example pressure rising as readiness, logistics, or domestic strain builds, ` +
      `or momentum falling as a front freezes or restraint takes hold.\n\n`
    : `Stalemate is legal when the state materially evolves in another dimension: readiness, logistics, command, morale, domestic politics, diplomacy, strategic objectives, preparation, restraint, or de-escalation.\n\n`;

  let systemPrompt =
    `You are the TARGETED ENDOGENOUS MOTION REPAIR for OpenHistoria.\n\n` +
    `Repair EXACTLY ONE already-existing persistent storyline: ${storylineId}.\n` +
    `The normal whole-world pass remains the sole source of visible timeline events. ` +
    `You CANNOT create events, wars, relations, agreements, territory changes, units, chats, interactive events, Stats edits, or any other ledger mutation. ` +
    `Return exactly one semantic storyline object through the dedicated repair tool.\n\n` +
    `This storyline ${repairCause}. Decide what is true about THIS process at ${targetDate}. ` +
    `Do not merely paraphrase the old equilibrium. Numeric pressure/momentum changes must follow the returned state. ` +
    motionRule +
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

    const response = await callRepairAI({
      systemPrompt,
      userMessage,
      reasoningEnabled: false,
      signal,
      hardLimitMs,
      taskKey: "worldMotionRepair",
      tool: getGameplayTool("worldMotionRepair"),
      lookups: buildTaskLookups(bundle),
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
    if (outcome) outcome.error = error;
    console.warn(
      `[OH World Motion Repair] ${storylineId} failed: ` +
      `${normalizeString(error?.message || error) || "unknown error"}. ` +
      "Keeping the valid main world pass; this storyline remains overdue for the next turn.",
    );
    return null;
  }
};

// The skip's one motion repair pass, run once its last segment is in hand (see
// findSkipStorylineMotionIssues for how the skip is judged as a single round).
// Its results are written into the segment payloads, so they reach the ledger
// through the same merge as everything else.
const repairSkipStorylineMotion = async ({ context, state, signal } = {}) => {
  const { bundle, campaignId, originDate, targetDate } = context;
  const payloads = normalizeArray(state?.segmentPayloads);
  const none = { repaired: 0, failed: 0, skipped: [], issues: [] };
  if (!payloads.length) return none;
  // A canned fallback means the model is not answering; repair calls to the same
  // provider would only fail again after costing their wait.
  if (normalizeString(state?.generation?.source) === "fallback") return none;
  // While requests are being saved (requestBudget.js) no repair is asked for:
  // each is a request of its own, to move a storyline the skip left still. Every
  // issue is settled as skipped instead, which is exactly a failed repair — its
  // copy-forward is withdrawn below, the storyline stays overdue, and overdue
  // storylines are what the next skip is told to move first.
  const savingRequestsNow = Boolean(state?.requests?.saving);

  // ONE stop date for detecting the issues, prompting the repair and validating
  // it: the merged one the round is applied at. (Detecting at one date and
  // validating at another could tell the model a prose-only stalemate was fine
  // and then reject exactly that.)
  const merged = mergeSegmentPayloads(payloads, { targetDate });
  const stopDate = normalizeString(merged.stopDate) || targetDate;
  const events = normalizeArray(merged.events);
  const baseStorylines = normalizeArray(bundle?.world?.storylines);
  const world = state.ledgerWorld || bundle.world;
  const issues = findSkipStorylineMotionIssues({
    events,
    storylineUpdates: merged.storylineUpdates,
    existingStorylines: baseStorylines,
    selectedStorylines: state.attentionStorylines,
    originDate,
    stopDate,
    world,
  });
  if (!issues.length) return none;

  const budget = state.motionRepairBudget;
  const round = bundle?.game?.round || 0;
  // The world as the skip left it, for the repair's dossiers and history.
  const repairBundle = {
    actions: bundle.actions,
    chats: bundle.chats,
    events: normalizeEvents([...normalizeArray(bundle.events), ...events]),
    game: bundle.game,
    world,
  };
  const repairedUpdates = [];
  // Storylines whose skip updates this pass replaces (repaired) or withdraws
  // (failed or skipped).
  const settledIds = new Set();
  let repaired = 0;
  let failed = 0;
  const skipped = [];

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

    // Over its limits the issue is treated exactly like a failed repair: the
    // storyline stays overdue for the main pass. Issues arrive in attention
    // order, so the cap keeps the most urgent ones.
    const skipReason = savingRequestsNow
      ? "requests are being saved"
      : motionRepairSkipReason(issue, { budget, failures: motionRepairFailures, campaignId, round });
    if (skipReason) {
      settledIds.add(issueId);
      skipped.push({ id: issueId, reason: skipReason });
      continue;
    }

    const existingCausalEventIndex = (() => {
      let best = -1;
      events.forEach((event, index) => {
        if (normalizeArray(event?.storylineIds).map(normalizeString).includes(issueId)) {
          best = index;
        }
      });
      return best;
    })();

    const repairStartedAt = Date.now();
    const repairOutcome = {};
    const repair = await runTargetedWorldMotionRepair({
      bundle: repairBundle,
      issue,
      mainPassEvents: events,
      existingCausalEventIndex,
      originDate,
      targetDate: stopDate,
      signal,
      // What is left of the skip's repair time: the call is stopped when it
      // runs out, so the budget caps the pass, not only when repairs start.
      hardLimitMs: motionRepairTimeRemainingMs(budget),
      outcome: repairOutcome,
    });
    const settledAs = settleMotionRepairCall(issue, {
      budget,
      failures: motionRepairFailures,
      campaignId,
      round,
      ms: Date.now() - repairStartedAt,
      ok: Boolean(repair),
      stoppedAtTimeBudget: repairOutcome.error?.repairStop === REPAIR_STOP_TIME_BUDGET,
    });
    settledIds.add(issueId);

    if (settledAs === "stopped-at-time-budget") {
      skipped.push({ id: issueId, reason: settledAs });
      continue;
    }

    if (!repair) {
      failed += 1;
      continue;
    }

    // No event index: a causal event already carries this storyline's id (that
    // is how it was found), and the ledger links storylines to events by id.
    repairedUpdates.push({ ...repair.update, eventIndexes: [] });
    repaired += 1;

    console.info(
      `[OH World Motion Repair] repaired ${issue.id}: ` +
      `${existingCausalEventIndex >= 0 ? "semantic state bound to existing main-pass event" : "hidden objective evolution"}.`,
    );
  }

  // Withdraw the skip's copy-forwards for every settled storyline that existed
  // before the skip, and put the repairs on the last segment — see
  // settleSkipStorylineUpdates, which is where this is tested.
  const settledUpdates = settleSkipStorylineUpdates(
    payloads.map((payload) => payload?.storylineUpdates),
    { settledIds, preSkipIds: baseStorylines.map((entry) => entry?.id), repairedUpdates },
  );
  payloads.forEach((payload, index) => {
    if (payload && payload.storylineUpdates !== settledUpdates[index]) {
      payload.storylineUpdates = settledUpdates[index];
    }
  });

  // One line a bug report can carry: what this pass spent and what it left
  // overdue on purpose.
  const skippedByReason = skipped.reduce((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] || 0) + 1;
    return counts;
  }, {});
  const summary = {
    attempted: repaired + failed,
    repaired,
    failed,
    skipped: skippedByReason,
    repairMs: budget ? Math.round(budget.ms) : null,
  };
  console.info(
    `[OH World Motion Repair] skip ${originDate} → ${stopDate}: attempted ${summary.attempted}, repaired ${repaired}, failed ${failed}` +
    `${skipped.length ? `, left overdue ${skipped.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}` : ""}` +
    `${budget ? `; ${Math.round(budget.ms / 1000)}s of repair time` : ""}.`,
  );
  logDebugEvent("turn", "World motion repair pass.", { originDate, stopDate, ...summary });

  return { repaired, failed, skipped, issues };
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
    puppetStates: isActiveFeatureEnabled("puppetStates"),
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
    `OUTPUT CONTRACT: call the normal jump-result tool once. stopDate=${targetDate}. clearActions=false. diplomaticOutreach must be empty. warUpdates, relationUpdates and agreementUpdates must be empty strings. Return at most ${maxEvents} visible event(s), but there is NO minimum and no preferred exact count. Search all supplied lanes first, then return every independently worthwhile, date-valid outcome you found up to the ceiling. storylineUpdates may contain only NEW storyline ids created by a returned event, never an existing storyline.\n`;

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

    const response = await callRepairAI({
      systemPrompt,
      userMessage,
      signal,
      taskKey: "worldBreadthRepair",
      tool: getGameplayTool("jumpForward"),
    });

    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("breadth repair response did not contain a structured jump payload");
    }

    parsed.clearActions = false;
    // The scene field skips used to fill (gameplaySchemas.js normalizeGameplayPayload).
    delete parsed.catalyst;
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
      { strictTransfers: false, playerCountry: bundle?.game?.country || "" },
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

    // Hosted builds (website, Android app) answer /api/* with a patch on THIS
    // thread's fetch, which the worker never sees: its runtime reads and writes
    // come here as `io` messages and go back as `io-result` (runtimeIoBridge.js).
    // The desktop's server answers the worker directly, so it is never told.
    if (import.meta.env.VITE_OH_WEB) worker.postMessage({ type: IO_CONFIG, bridgeRuntimeIo: true });

    worker.onmessage = (event) => {
      if (event?.data?.type === IO_REQUEST) {
        serveWorkerIo(event.data, fetch).then((reply) => { if (reply) worker.postMessage(reply); });
        return;
      }
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
  const dayNumber = gameDateDayNumber(value);
  return dayNumber === null ? null : dayNumber * 86400000;
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

const compactTrackedStatsSheet = (sheetInput, statIndexRows = DEFAULT_STAT_INDEX_ROWS) => {
  const sheet = finalizeCountryStatSheet(sheetInput);
  if (!sheet) return null;
  const indices = Object.fromEntries(
    normalizeArray(statIndexRows)
      .map((row) => normalizeString(row?.key))
      .filter(Boolean)
      .map((key) => [key, Number(sheet.indices?.[key])])
      .filter(([, value]) => Number.isFinite(value)),
  );
  return {
    stability: Number(sheet.stability),
    indices,
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

const sanitizeTrackedStatsPatch = (value, statIndexRows = DEFAULT_STAT_INDEX_ROWS) => {
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
  for (const row of normalizeArray(statIndexRows)) {
    const key = normalizeString(row?.key);
    if (!key) continue;
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

const refreshTrackedCustomStatsIfDue = async ({ bundle, signal, definition } = {}) => {
  const game = normalizeGameData(bundle?.game);
  let world = normalizeWorldState(bundle?.world);
  const currentDate = normalizeString(game?.gameDate || game?.startDate);
  if (!parseIsoDate(currentDate)) return world;

  const keys = statSheetKeys(definition);
  const rows = flattenStatSheetRows(definition);
  if (!keys.length) return world;

  const tracking = normalizeCountryStatsTracking(world?.countryStatsTracking, { playerCountry: game?.country });
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
    if (!previous || !isCompleteCustomCountryStatSheet(previous, keys)) {
      pendingBaseline.push(polity);
      continue;
    }
    const lastAuto = normalizeString(tracking.lastAutoRefreshByPolity?.[polity]);
    const baselineDate =
      (parseIsoDate(lastAuto) && lastAuto) ||
      (parseIsoDate(previous?.continuity?.assessedDate) && normalizeString(previous.continuity.assessedDate)) ||
      trackedStatsLatestHistoryDate(world, polity) ||
      normalizeString(game?.startDate);
    const elapsedMonths = countryStatsTrackingMonthsElapsed(baselineDate, currentDate);
    if (elapsedMonths < intervalMonths) continue;
    due.push({
      polity,
      previous,
      baselineDate,
      elapsedMonths,
      narrative: buildTrackedStatsNarrativeEvidence({ bundle, statCode: polity, normalizedWorld: world }),
    });
  }

  world.countryStatsTracking = normalizeCountryStatsTracking({
    ...tracking,
    pendingBaselinePolities: pendingBaseline,
  }, { playerCountry: game?.country });
  if (!due.length) return world;

  const systemPrompt = `You are Open Historia's bounded periodic scenario-defined National Stats auditor.

The scenario owns the entire Stats vocabulary. The current values are campaign canon. Update conservatively from that baseline using ONLY supplied campaign evidence and the exact machine keys below. Absence of evidence means continuity. Values are absolute, not deltas. Never invent hidden modern GDP, unemployment, debt, population, or strategic-index fields that the scenario did not define. Return plain JSON numbers; prefixes/suffixes are display metadata.

SCENARIO STATS:
${describeStatSheetDefinition(definition)}

Return exactly one JSON object and no markdown:
{"updates":[{"country":"exact supplied canonical key","customStats":{"oneDefinedKey":0}}]}

For each country include only values that genuinely changed.`;

  const userMessage = [
    `Campaign date: ${currentDate}`,
    `Periodic Stats batch version: ${TRACKED_STATS_BATCH_VERSION}-custom`,
    "",
    ...due.flatMap((entry, index) => [
      `=== COUNTRY ${index + 1}: ${entry.polity} ===`,
      `Elapsed since last dedicated Stats audit: ${entry.elapsedMonths} month(s) (baseline ${entry.baselineDate || "unknown"}).`,
      `CURRENT CANONICAL CUSTOM STATS:`,
      JSON.stringify(normalizeCustomStatValues(entry.previous?.customStats, definition, { partial: true })),
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
        ...(getMapSetting(MAP_SETTING_KEYS.limitAiGeneration) ? { deadline: Date.now() + 90000 } : {}),
      },
    );
    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    const parsed = response?.toolInput ?? extractJsonPayload(rawText);
    const updates = normalizeArray(parsed?.updates);
    const dueByKey = new Map(due.map((entry) => [entry.polity.toLocaleLowerCase(), entry]));
    const refreshed = { ...(tracking.lastAutoRefreshByPolity || {}) };
    let applied = 0;

    for (const update of updates) {
      const polity = canonicalStatsPolity(update?.country, world) || normalizeString(update?.country);
      const entry = dueByKey.get(polity.toLocaleLowerCase());
      if (!entry) continue;
      const patchValues = normalizeCustomStatValues(update?.customStats, definition, { partial: true });
      if (!Object.keys(patchValues).length) continue;
      const unknown = Object.keys(update?.customStats || {}).filter((key) => !keys.includes(key));
      if (unknown.length) continue;
      const merged = mergeCountryStatPatch(entry.previous, { customStats: patchValues }, {
        continuity: {
          assessedDate: currentDate,
          assessedRound: Math.max(0, Math.trunc(Number(game?.round) || 0)),
        },
      });
      if (!isCompleteCustomCountryStatSheet(merged, keys)) continue;
      world.countryStats = { ...(world.countryStats || {}), [entry.polity]: merged };
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
      console.info(`[stats auto ${TRACKED_STATS_BATCH_VERSION}-custom] refreshed ${applied}/${due.length} due tracked countries in one AI batch.`);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`[stats auto ${TRACKED_STATS_BATCH_VERSION}-custom] refresh failed; completed world turn is preserved.`, error);
  }

  return world;
};

const refreshTrackedCountryStatsIfDue = async ({
  bundle,
  signal,
  // The time skip this refresh rides on (createJumpRequests), so its one request
  // asks the skip's budget first. Refused, the refresh stays due.
  requests = null,
} = {}) => {
  const game = normalizeGameData(bundle?.game);
  let world = normalizeWorldState(bundle?.world);
  const currentDate = normalizeString(game?.gameDate || game?.startDate);
  if (!parseIsoDate(currentDate)) return world;
  const statSheetDefinition = await loadStatSheetDefinition().catch(() => ({ custom: false, sections: [] }));
  if (statSheetDefinition.custom) {
    return refreshTrackedCustomStatsIfDue({ bundle, signal, definition: statSheetDefinition });
  }
  const statIndexDefinition = await loadStatIndexDefinition().catch(() => ({ custom: false, rows: DEFAULT_STAT_INDEX_ROWS }));
  const statIndexRows = normalizeArray(statIndexDefinition?.rows).length
    ? normalizeArray(statIndexDefinition.rows)
    : DEFAULT_STAT_INDEX_ROWS;
  const statIndexExample = Object.fromEntries(
    statIndexRows.map((row) => normalizeString(row?.key)).filter(Boolean).map((key) => [key, 0]),
  );

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
  if (requests && !requests.budget.take("stats")) {
    logDebugEvent("turn", `Tracked Stats refresh put off: this time skip has used its ${requests.budget.cap} requests. It is due again next skip.`, {
      countries: due.map((entry) => entry.polity),
    });
    return world;
  }

  const systemPrompt = `You are Open Historia's bounded periodic national-statistics auditor.

You are refreshing EXISTING persistent country stat sheets for a running alternate-history campaign. This is a continuity update, NOT a fresh historical lookup and NOT a territorial rebase.

RULES:
- The supplied current sheet is canonical. Change it conservatively from that baseline.
- Respect the campaign date and supplied campaign evidence. Real-world outcomes after the campaign start are not automatically canonical.
- Absence of evidence is a strong reason for continuity, not a reason to reroll numbers.
- Current sheets may already include explicit event stat patches from this same turn. Do not double-apply those effects.
- Population and GDP should evolve plausibly over the elapsed interval. Keep GDP, population, GDP/capita, growth, inflation, unemployment, debt and budget balance mutually coherent.
- Strategic indices are 0..100 and should normally move gradually unless evidence clearly supports a shock.
- Use ONLY the scenario's exact strategic-index keys listed below; do not substitute modern defaults or invent extras.
- Resource-like indices are broad availability/autonomy pressures, not literal stockpile quantities.
- GDP sector shares must sum to 100 if supplied.

SCENARIO STRATEGIC INDICES:
${describeStatIndexRows(statIndexRows)}
- Do not invent territorial changes. This lightweight periodic audit deliberately preserves the existing territorial component ledger.
- Return exactly one JSON object and no markdown/prose outside it.

OUTPUT:
{
  "updates": [
    {
      "country": "exact supplied canonical key",
      "stability": 0,
      "indices": ${JSON.stringify(statIndexExample)},
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
      JSON.stringify(compactTrackedStatsSheet(entry.previous, statIndexRows)),
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
        ...(requests ? { onRequest: jumpTaskOptions(requests, "stats").onRequest } : {}),
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

      const patch = sanitizeTrackedStatsPatch(update, statIndexRows);
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
// The main-thread fallback, for when the Stats worker is unavailable. The logic is
// the worker's own (countryStatsWorkerKernel.js), not a copy: this used to be a
// 520-line duplicate that had to be kept in step by hand. What differs here is
// only where the inputs come from — the catalog Nations already primed, the
// normalized world — and the UI budget passed as `pause`, so the ~850 ms this
// takes on a full map is spread across frames instead of freezing the page.
const buildTargetStatsTerritorialBasis = async (bundle, code, normalizedWorld = null, { signal } = {}) => {
  const world = normalizedWorld || normalizeWorldState(bundle.world);
  // The rendered scenario partition is authoritative; the broad merged catalog
  // is loaded only when there is none (see the kernel for why).
  const scenarioCatalog = await loadScenarioRegionCatalog({ force: false }).catch(() => []);
  const fallbackCatalog = normalizeArray(scenarioCatalog).length
    ? []
    : await loadRegionCatalog({ force: false }).catch(() => []);
  const uiBudget = createUiBudget(5);
  return buildTargetStatsTerritorialBasisKernel({
    bundle: { ...bundle, world },
    code,
    scenarioCatalog,
    fallbackCatalog,
    pause: () => uiBudget(signal),
    debug: statsVerboseTerritoryDebugEnabled(),
  });
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
  const variables = await buildTemplateVariables(bundle, { lookups: true });
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

const qualitativePoliticalBand = (value) => {
  if (value == null || typeof value === "boolean" || Array.isArray(value)) return "";
  const text = normalizeString(value);
  if (!text) return "";
  const numeric = typeof value === "number" || /^-?\d+(?:\.\d+)?$/.test(text) ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return text;
  if (numeric >= 80) return "very high";
  if (numeric >= 65) return "high";
  if (numeric >= 45) return "moderate";
  if (numeric >= 25) return "low";
  return "very low";
};

const politicalMetricLabel = (value) => String(value ?? "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLocaleLowerCase();

// Political Actors owns hidden political truth. The espionage task gets only
// qualitative, source-limited signals so raw canonical scores never cross the
// model boundary and Beta's signal-clarity system remains the information gate.
const buildCollectedPoliticalSignals = (world, polity, { clarity = 0, seed = "" } = {}) => {
  const actor = getPoliticalProfile(world, polity);
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) return "";
  const lines = [];
  const addRecord = (label, value, limit = 10) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const rows = Object.entries(value)
      .slice(0, limit)
      .map(([key, raw]) => {
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const nested = Object.entries(raw).slice(0, 8)
            .map(([nestedKey, nestedValue]) => `${politicalMetricLabel(nestedKey)} ${qualitativePoliticalBand(nestedValue)}`)
            .filter(Boolean)
            .join(", ");
          return nested ? `${key}: ${nested}` : "";
        }
        const described = qualitativePoliticalBand(raw);
        return described ? `${politicalMetricLabel(key)} ${described}` : "";
      })
      .filter(Boolean);
    if (rows.length) lines.push(`${label}: ${rows.join("; ")}`);
  };
  const addList = (label, value, limit = 10) => {
    const rows = normalizeArray(value).map(normalizeString).filter(Boolean).slice(0, limit);
    if (rows.length) lines.push(`${label}: ${rows.join("; ")}`);
  };

  const government = actor.government && typeof actor.government === "object" ? actor.government : {};
  const internalGovernment = {};
  if (government.approval !== undefined) internalGovernment.approval = government.approval;
  if (government.stability !== undefined) internalGovernment.stability = government.stability;
  addRecord("Internal government condition", internalGovernment);
  addRecord("Leadership tendencies", actor.traits);
  addList("Internal fears", actor.fears);
  addList("Latent ambitions", actor.ambitions);
  addRecord("Perceptions", actor.perceptions, 8);
  addList("Domestic pressures", actor.domesticPressures);
  addRecord("Current behavioral disposition", actor.behavioralDisposition);

  const partySignals = normalizeArray(actor.parties)
    .map((party) => {
      const name = normalizeString(party?.name);
      const internal = normalizeString(party?.internalStrategy || party?.internalPressure || party?.privateGoal);
      return name && internal ? `${name}: ${internal}` : "";
    })
    .filter(Boolean)
    .slice(0, 6);
  if (partySignals.length) lines.push(`Party-internal signals: ${partySignals.join("; ")}`);

  const truth = lines.join("\n").slice(0, 5000);
  if (!truth) return "";
  return redactText(truth, clarity, `${seed}:political-signals`);
};

// One agent's report, in three steps — what the task is sent, the request, and
// what is kept of the answer — so that the request can be the task's own
// (gatherIntelligence below) or a job inside the turn review, which carries every
// agent's report in the one request it makes (runTurnReview).
//
// `sharedVariables` lets several agents share one build of the template
// variables; only the target and the disinformation line differ between them.
const prepareSpyReport = async (bundle, spy, { sharedVariables = null } = {}) => {
  const name = normalizeString(spy?.target);
  const player = normalizeString(bundle.game?.country);
  // A turned agent still "reports" — what the target wants believed. The same
  // task writes the lie; the player is not told which kind they are reading.
  const disinformation = spy.status === "turned"
    ? "IMPORTANT: this agent has been TURNED by " + name + " and now works for them. Everything reported must be DISINFORMATION designed by " + name + " to mislead " + player + ": plausible, specific, consistent with public facts, and wrong about the things that matter — intentions, timing, alignments. Never hint that it is false."
    : "";
  const variables = { ...(sharedVariables ?? await buildTemplateVariables(bundle, { lookups: true })), targetPolity: name, disinformation };
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

  const clarity = signalClarity(intelligenceOf(bundle.world, player), intelligenceOf(bundle.world, name));
  const collectedPoliticalSignals = buildCollectedPoliticalSignals(bundle.world, name, {
    clarity,
    seed: spy?.id || name,
  });
  const politicalAssessmentOrder = [
    "POLITICAL ASSESSMENT — alongside the diplomatic exchanges, include politicalAssessment only when the available collection supports a defensible read of hidden decision-making pressures.",
    "Translate collection into player-readable prose. NEVER output raw Political Actor numbers, exact hidden scores, internal schema/property names, or equations. Describe tendencies qualitatively.",
    spy?.suspected === true
      ? "Source integrity is in doubt. Keep confidence low and distinguish uncertain inference from observed traffic."
      : clarity >= 0.62
        ? "Collection quality is strong enough for a relatively specific assessment, but uncertainty still exists."
        : "Collection is partial. Keep the assessment cautious and broad; do not manufacture certainty to fill gaps.",
    collectedPoliticalSignals
      ? `SIMULATION-ONLY COLLECTED POLITICAL SIGNALS (already source-limited; do not quote this block verbatim):\n${collectedPoliticalSignals}`
      : "No additional hidden political signal was collected this period. Base any assessment only on the private traffic and supplied campaign evidence, or omit politicalAssessment if that would be speculation.",
  ].join("\n");

  return {
    name,
    variables,
    userMessage: [
      `Report what the spy in ${name} intercepted this period.`,
      era ? `ERA & WORLD RULES:\n${era}` : "",
      `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}`,
      politicalAssessmentOrder,
      orders,
    ].filter(Boolean).join("\n\n"),
  };
};

// `bundle` is the campaign the report is filed INTO: its date and round stamp the
// entry, and its seal closes it.
const storeSpyReport = async (bundle, spy, payload) => {
  const name = normalizeString(spy?.target);
  const reportId = newSpyReportId();
  const exchanges = normalizeArray(payload?.exchanges)
    // The schema forbids it, but a model that names the target or the player as
    // the counterpart has produced a chat the player already has or nonsense.
    .filter((exchange) => {
      const counterpart = regionKey(exchange?.counterpart);
      return counterpart && counterpart !== regionKey(name) && counterpart !== regionKey(bundle.game?.country);
    })
    .map((exchange, index) => ({
      ...exchange,
      id: `${reportId}:${index}`,
    }));
  // Stored sealed: the file, the network reply and the React tree hold ciphertext.
  const seal = isSeal(bundle.world?.spySeal) ? bundle.world.spySeal : await ensureSpySeal();
  const sealed = await Promise.all(exchanges.map((exchange) => sealExchange(seal, exchange)));

  const rawPoliticalAssessment = normalizePoliticalIntelligenceAssessment(payload?.politicalAssessment);
  const player = normalizeString(bundle.game?.country);
  const clarity = signalClarity(intelligenceOf(bundle.world, player), intelligenceOf(bundle.world, name));
  const politicalAssessment = rawPoliticalAssessment
    ? normalizePoliticalIntelligenceAssessment({
        ...rawPoliticalAssessment,
        confidence: spy?.suspected === true ? "Low" : clarity >= 0.75 ? "High" : clarity >= 0.42 ? "Moderate" : "Low",
        source: spy?.suspected === true
          ? "HUMINT reporting - source integrity concerns"
          : "HUMINT reporting",
        gatheredAt: normalizeString(bundle.game?.gameDate),
      })
    : null;
  const sealedPoliticalAssessment = politicalAssessment
    ? await sealPoliticalAssessment(seal, reportId, politicalAssessment)
    : null;

  // Re-read at write time: another gather may have landed for a different target.
  const current = normalizeIntercepts(await readInterceptsState({ force: true }));
  // Each report replaces the agent's traffic, but not stolen documents already on file.
  const stolen = normalizeArray(current[name]?.exchanges).filter(isDocumentExchange).slice(0, STOLEN_DOCUMENTS_KEPT);
  const entry = {
    reportId,
    spyId: normalizeString(spy?.id),
    gatheredAt: normalizeString(bundle.game?.gameDate),
    round: Number(bundle.game?.round) || 0,
    planted: spy?.status === "turned",
    exchanges: [...stolen, ...sealed],
    ...(sealedPoliticalAssessment ? { politicalAssessment: sealedPoliticalAssessment } : {}),
  };
  await writeInterceptsState({ ...current, [name]: entry });
  return entry;
};
// How many stolen documents an agent's file keeps, newest first.
const STOLEN_DOCUMENTS_KEPT = 8;

// The documents the player's agents stole this turn (reportDelivery.js), filed
// among each agent's intercepts — sealed like the rest, and decoded in the Spies
// tab only as far as the player's service can read the target's. Filing one
// twice files it once (its id comes from the report). Never costs the turn.
const fileStolenDocuments = async (deliveries, { world, game, lastEventId = "" }) => {
  const stolen = normalizeArray(deliveries).filter((delivery) => delivery?.channel === "intelligence");
  if (!stolen.length) return;
  try {
    const seal = isSeal(world?.spySeal) ? world.spySeal : await ensureSpySeal();
    const current = normalizeIntercepts(await readInterceptsState({ force: true }));
    const next = { ...current };
    for (const delivery of stolen) {
      const key = normalizeString(delivery.agentTarget || delivery.target);
      // Shown in the Spies tab once the reveal reaches the event it came with.
      const exchange = documentExchange(delivery, { date: game?.gameDate, eventId: deliveryEventId(delivery, lastEventId) });
      const entry = next[key] ?? { gatheredAt: normalizeString(game?.gameDate), round: Number(game?.round) || 0, planted: false, exchanges: [] };
      if (entry.exchanges.some((existing) => existing.id === exchange.id)) continue;
      const documents = entry.exchanges.filter(isDocumentExchange);
      const traffic = entry.exchanges.filter((existing) => !isDocumentExchange(existing));
      next[key] = { ...entry, exchanges: [await sealExchange(seal, exchange), ...documents].slice(0, STOLEN_DOCUMENTS_KEPT).concat(traffic) };
    }
    await writeInterceptsState(next);
  } catch (error) {
    console.warn("[spycraft] a stolen document could not be filed:", error?.message || error);
  }
};

// The advisor's notices of the papers this turn put in the government's hands
// (reportDelivery.js documentNotices), appended to its conversation; the panel
// merges them in whenever the file changes. One per paper, so re-applying a turn
// (Intervene) posts nothing twice. Never costs the turn.
const postDocumentNotices = async (deliveries, { lastEventId = "", date = "" } = {}) => {
  const notices = documentNotices(deliveries, { lastEventId, date });
  if (!notices.length) return;
  try {
    const stored = await readJson(JSON_URLS.advisor, { defaultValue: [], force: true });
    const list = Array.isArray(stored) ? stored : [];
    const posted = new Set(list.filter((message) => message?.role === "notice").map((message) => message.id));
    const fresh = notices.filter((notice) => !posted.has(notice.id));
    if (fresh.length) await writeJson(JSON_URLS.advisor, [...list, ...fresh]);
  } catch (error) {
    console.warn("[advisor] a new paper could not be flagged:", error?.message || error);
  }
};

const playersAgentIn = (bundle, target) => {
  const player = normalizeString(bundle.game?.country);
  return normalizeSpies(bundle.world?.spies).find((entry) =>
    entry.owner === player && entry.target === target && (entry.status === "active" || entry.status === "turned"));
};

export const gatherIntelligence = async (target, { signal, requestKind } = {}) => {
  const name = normalizeString(target);
  if (!name) throw new Error("No target polity.");
  const bundle = await readGameStateBundle({ force: true });
  const spy = playersAgentIn(bundle, name);
  if (!spy) throw new Error("No agent of yours is in " + name + ".");
  const prepared = await prepareSpyReport(bundle, spy);
  const { payload } = await runJsonTask("spyIntercept", {
    lookups: buildTaskLookups(bundle),
    signal,
    userMessage: prepared.userMessage,
    variables: prepared.variables,
    ...(requestKind ? { requestKind } : {}),
  });
  return storeSpyReport(bundle, spy, payload);
};

// Everything the player's agents have brought back, opened — for the simulator
// and the renderer only. Never written anywhere.
export const readOpenedIntercepts = async () => {
  const world = normalizeWorldState(await readWorldState({ force: false }));
  const intercepts = normalizeIntercepts(await readInterceptsState({ force: false }));
  if (!isSeal(world.spySeal)) return intercepts;
  const out = {};
  for (const [target, entry] of Object.entries(intercepts)) {
    const reportId = entry.reportId || `${target}:${entry.round || 0}:${entry.gatheredAt || "legacy"}`;
    const politicalAssessment = entry.politicalAssessment
      ? await openPoliticalAssessment(world.spySeal, reportId, entry.politicalAssessment)
      : null;
    out[target] = {
      ...entry,
      exchanges: await Promise.all(entry.exchanges.map((exchange) => openExchange(world.spySeal, exchange))),
      ...(politicalAssessment ? { politicalAssessment } : {}),
    };
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

// A skip is being revealed (runtime/unseenEvents.js). Background writers wait
// for it to finish: a note or a report written from the finished world would
// tell the player what they are about to read — or what Intervene may discard.
const revealInProgress = async () => {
  try {
    return unseenEvents.unseenFor(await readWorldStateView()).size > 0;
  } catch {
    return false;
  }
};

// Called on a timer by the UI. Picks ONE live agent and has it report, or does
// nothing at all — every failure is silent, exactly like the diplomacy drip.
export const maybeGatherIntelligence = async ({ chance = SPY_REPORT_CHANCE } = {}) => {
  if (spyReportInFlight || isSimulationBusy()) return null;
  if (!isActiveFeatureEnabled("espionage")) return null;
  // Nobody pressed anything: this is background AI (requestBudget.js), capped
  // for the day, and nothing at all once the player turns it off. The agents
  // still report after every time skip either way.
  if (!backgroundAiAllowance().allowed) return null;
  if (Math.random() >= chance) return null;
  if (await revealInProgress()) return null;
  spyReportInFlight = true;
  try {
    const world = normalizeWorldState(await readWorldState({ force: true }));
    const player = normalizeString((await readGameData()).country);
    if (!player) return null;
    const agents = activeSpies(world, player);
    if (agents.length === 0) return null;
    const agent = agents[Math.floor(Math.random() * agents.length)];
    if (isSimulationBusy()) return null;
    await gatherIntelligence(agent.target, { requestKind: BACKGROUND_REQUEST });
    return agent.target;
  } catch {
    return null; // silence is the safe outcome
  } finally {
    spyReportInFlight = false;
  }
};

export const refreshSpyIntercepts = async () => {
  if (!isActiveFeatureEnabled("espionage")) return;
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


// ---- First readings -------------------------------------------------------
//
// Every service is "ordinary" (spycraft.js DEFAULT_INTELLIGENCE) until something
// puts a number on it, and until now only a turn could — the simulator moves
// world.intelligence through polityChanges.intelligence when a purge or an
// academy warrants it. So every service the player ever looked at sat on the
// same 40/100, their own included, and the espionage maths ran on a default
// rather than a judgement. These ask the model for a first reading the moment
// a service matters — the Stats pane opens on a polity, an agent is sent, an
// intercept is read, a foreign agent is caught — and store it where the turn
// already writes, so from then on it moves like any other rating. A rated
// service is never re-rated here: the turn owns the number after that.
//
// The stat sheet gets the same treatment for the same reason: a polity the
// player is dealing with should have its numbers, not a "loading" card the
// first time they look.

// Both writers below run OUTSIDE a turn. A jump reads the world, works for
// minutes and writes it back; a write from here in the middle of that would be
// clobbered by the turn's, or worse, clobber it. So they wait for the
// simulation to go idle before calling the model at all (the answer would
// otherwise describe a world the turn is about to change) and check again
// before writing.
const waitForSimulationIdle = async ({ signal, timeoutMs = 10 * 60 * 1000 } = {}) => {
  const startedAt = Date.now();
  while (isSimulationBusy()) {
    throwIfAborted(signal);
    if (Date.now() - startedAt > timeoutMs) throw new Error("The simulation stayed busy.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

// One in-flight promise per (campaign, kind, polity), so the pane re-opening
// on the same polity, or a deploy right after the tab opened, does not ask
// twice. Settled promises are dropped, so a failure is retried the next time
// something asks. Silent by design: a reading that fails costs the player
// nothing but the default they already had.
const firstReadingsInFlight = new Map();
const firstReading = (kind, target, reason, work) => {
  const name = normalizeString(target);
  if (!name || typeof window === "undefined" || !isFallbackListConfigured()) return Promise.resolve(null);
  // The player opened a tab or read a report; they did not ask for a model call,
  // and a first reading is up to two. That makes it background AI
  // (requestBudget.js): off until turned on, capped when it is. Without it a
  // service keeps the default rating until a turn gives it one, which is how
  // every service behaved before first readings existed.
  if (!backgroundAiAllowance().allowed) return Promise.resolve(null);
  const key = `${activeCampaignId()}|${kind}|${name.toLowerCase()}`;
  if (firstReadingsInFlight.has(key)) return firstReadingsInFlight.get(key);
  const run = work(name)
    .catch((error) => {
      if (error?.name === "AbortError") return null;
      logDebugEvent("espionage", `${name}: first ${kind} reading failed${reason ? ` (${reason})` : ""}: ${error?.message || error}`);
      return null;
    })
    .finally(() => firstReadingsInFlight.delete(key));
  firstReadingsInFlight.set(key, run);
  return run;
};

// A first reading of one polity's intelligence service: 0-100 from the model,
// written to world.intelligence only while nothing has rated that service.
export const assessIntelligenceService = async (target, { signal, requestKind } = {}) => {
  const name = normalizeString(target);
  if (!name) return null;
  const campaign = activeCampaignId();
  await waitForSimulationIdle({ signal });
  const bundle = await readGameStateBundle({ force: true });
  const world = normalizeWorldState(bundle.world);
  if (isIntelligenceRated(world, name)) return intelligenceOf(world, name);
  const variables = {
    ...(await buildTemplateVariables(bundle, { taskKey: "intelligenceAssessment" })),
    targetPolity: name,
  };
  const dossier = await buildTargetDossier(bundle, name, world);
  const era = normalizeString(world.simulationRules).slice(0, 700);
  const statSheet = normalizeString(buildCompactEconomicContext(world.countryStats?.[name], { name }));
  const { payload } = await runJsonTask("intelligenceAssessment", {
    signal,
    ...(requestKind ? { requestKind } : {}),
    userMessage: [
      `Rate the intelligence service of ${name} as it stands on ${variables.date || "the current date"}.`,
      era ? `ERA & WORLD RULES:\n${era}` : "",
      `TARGET DOSSIER:\n${dossier || "(nothing recorded)"}`,
      statSheet ? `STAT SHEET:\n${statSheet}` : "",
    ].filter(Boolean).join("\n\n"),
    variables,
  });
  const rating = normalizeIntelligenceRating(payload?.intelligence);
  if (rating === null) throw new Error("The assessment carried no rating.");
  // Re-read at write time, once the simulation is idle again: a turn may have
  // rated the service meanwhile (its number wins), and the campaign in front
  // of the player may have changed (then this belongs to nobody).
  await waitForSimulationIdle({ signal });
  throwIfAborted(signal);
  if (activeCampaignId() !== campaign) throw new Error("The campaign changed while the service was being assessed.");
  const fresh = normalizeWorldState(await readWorldState({ force: true }));
  if (isIntelligenceRated(fresh, name)) return intelligenceOf(fresh, name);
  await writeWorldState({ ...fresh, intelligence: { ...(fresh.intelligence ?? {}), [name]: rating } });
  const service = normalizeString(payload?.service);
  logDebugEvent("espionage", `${name}'s intelligence service rated ${rating}/100 on first inspection${service ? ` (${service})` : ""}.`, {
    rationale: normalizeString(payload?.rationale),
  });
  return rating;
};

// Fire-and-forget forms for the UI and the turn: deduplicated, silent on
// failure, and no-ops for a polity that already has its number or a provider
// that is not set up yet.
export const ensureIntelligenceRated = (target, { reason = "" } = {}) =>
  firstReading("intelligence", target, reason, async (name) => {
    const world = normalizeWorldState(await readWorldState({ force: false }));
    if (isIntelligenceRated(world, name)) return intelligenceOf(world, name);
    return assessIntelligenceService(name, { requestKind: BACKGROUND_REQUEST });
  });

export const ensureCountryStatSheet = (target, { reason = "" } = {}) =>
  firstReading("stat sheet", target, reason, async (name) => {
    const [world, definition] = await Promise.all([
      readWorldState({ force: false }).then(normalizeWorldState),
      loadStatSheetDefinition().catch(() => ({ custom: false, sections: [] })),
    ]);
    const persisted = normalizeCountryStatSheet(world.countryStats?.[name]);
    const complete = definition.custom
      ? isCompleteCustomCountryStatSheet(persisted, statSheetKeys(definition))
      : isCompleteCountryStatSheet(persisted);
    if (complete) return persisted;
    await waitForSimulationIdle();
    return generateCountryStatSheet({ code: name, name, requestKind: BACKGROUND_REQUEST });
  });

// Everything a polity the player is dealing with should have: the sheet first,
// so the service reading can see the numbers it rests on.
export const ensureCountryAssessed = (target, options = {}) =>
  ensureCountryStatSheet(target, options).then(() => ensureIntelligenceRated(target, options));

const generateScenarioCustomStatSheet = async ({
  bundle,
  definition,
  statCode,
  target,
  worldAtStart,
  signal,
} = {}) => {
  const currentDate = normalizeString(bundle?.game?.gameDate || bundle?.game?.startDate);
  const currentRound = Math.max(0, Math.trunc(Number(bundle?.game?.round) || 0));
  const previous = normalizeCountryStatSheet(worldAtStart?.countryStats?.[statCode]);
  const previousValues = normalizeCustomStatValues(previous?.customStats, definition, { partial: true });
  const dossier = await buildTargetDossier(bundle, target, worldAtStart);
  const variables = await buildTemplateVariables(bundle, {
    lookups: true,
    taskKey: "countryStatSheet",
    requiredKeys: ["date", "playerPolity", "language", "simulationRules", "worldSummary", "recentEvents"],
  });

  const { payload } = await runJsonTask("countryStatSheet", {
    lookups: buildTaskLookups(bundle),
    signal,
    userMessage: [
      `Compile the complete scenario-defined National Stats sheet for ${target}${statCode ? ` (canonical polity ${statCode})` : ""}.`,
      normalizeString(bundle?.world?.simulationRules) ? `ERA & WORLD RULES:
${normalizeString(bundle.world.simulationRules).slice(0, 1800)}` : "",
      `TARGET DOSSIER:
${dossier || "(nothing recorded)"}`,
      Object.keys(previousValues).length
        ? `PREVIOUS PERSISTENT CUSTOM STATS (campaign canon; preserve continuity unless supplied events justify change):
${JSON.stringify(previousValues)}`
        : "No previous custom Stats baseline exists; establish scenario-appropriate initial values from the supplied canon.",
    ].filter(Boolean).join("\n\n"),
    variables,
  });

  throwIfAborted(signal);
  const customStats = normalizeCustomStatValues(payload?.customStats, definition);
  const expectedKeys = statSheetKeys(definition);
  const missing = expectedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(customStats, key));
  if (missing.length) {
    throw new Error(`Scenario Stats generation omitted required value(s): ${missing.join(", ")}.`);
  }

  const sheet = mergeCountryStatPatch(previous, { customStats }, {
    continuity: {
      assessedDate: currentDate,
      assessedRound: currentRound,
    },
  });

  if (!statCode || !sheet) return sheet;

  try {
    const persisted = await persistCountryStatsBackground({
      code: statCode,
      sheet,
      continuity: { assessedDate: currentDate, assessedRound: currentRound },
      date: currentDate,
      round: currentRound,
      signal,
    });
    if (persisted?.sheet) {
      await primeCountryStatsWorkerCommit({
        country: statCode,
        sheet: persisted.sheet,
        historySeries: persisted.historySeries,
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
          detail: { country: statCode, sheet: persisted.sheet, source: "scenario-custom-stats-worker-persist" },
        }));
      }
      return persisted.sheet;
    }
  } catch (workerPersistError) {
    if (signal?.aborted || workerPersistError?.name === "AbortError") throw workerPersistError;
    console.warn("[stats custom] worker persistence failed; using canonical main-thread fallback.", workerPersistError);
  }

  const world = await readWorldState({ force: false });
  const nextSheet = applyCountryStatPatchToWorld(world, statCode, sheet, {
    continuity: { assessedDate: currentDate, assessedRound: currentRound },
  });
  world.countryStatsHistory = appendCountryStatHistorySample(
    world.countryStatsHistory,
    statCode,
    nextSheet,
    { date: currentDate, round: currentRound },
  );
  await writeWorldState(world, { emitEvents: false });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("oh:country-stats-updated", {
      detail: { country: statCode, sheet: nextSheet, source: "scenario-custom-stats-main-thread-persist" },
    }));
  }
  return nextSheet;
};

// Structured national stat sheet for the Stats tab, grounded in the same
// campaign context as the intelligence briefing.
export const generateCountryStatSheet = async ({ code, name, forceReassess = false, signal, requestKind, budget = null, onRequest } = {}) => {
  // Issue #724: wait out any running simulation before reading the world.
  // The Stats pane calls this directly, not through ensureCountryStatSheet, so
  // it skipped the idle wait every other out-of-turn writer takes — on a fresh
  // game that was a second AI call beside the pregame backstory, and a baseline
  // built from a world with no history in it yet, which then became campaign
  // canon. Ahead of the perf timer, so waiting is not reported as preparation.
  await waitForSimulationIdle({ signal });
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
  const statSheetDefinition = await loadStatSheetDefinition().catch(() => ({ custom: false, sections: [] }));
  if (statSheetDefinition.custom) {
    return generateScenarioCustomStatSheet({
      bundle,
      definition: statSheetDefinition,
      statCode,
      target,
      worldAtStart,
      signal,
    });
  }

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
    lookups: true,
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
  const economicCalibrationRequested = Boolean(
    territorialBasisMode !== "nonterritorial" && (!previousComplete || forceReassess)
  );

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

  // The per-component split (countryStats.js decodeTerritorialComponentSplit).
  // Only when the prompt lists each component by id (a polity small enough for
  // the kernel's componentDetail), and only for a bucket with a component that
  // needs one: on a fresh baseline or hard audit, every component; otherwise one
  // that is new to the ledger, has only ever had the native weights, or now holds
  // a different number of regions than when it was split. Everything else keeps
  // its stored split and is rescaled deterministically.
  const splitKey = (geography) => normalizeString(geography).toLocaleLowerCase();
  const heldRegionCount = (member) => Math.max(0, Math.trunc(Number(member?.heldRegions) || 0));
  const storedSplits = normalizeArray(previous?.continuity?.semanticSplitComponents);
  const storedSplitRegions = new Map(storedSplits.map((entry) => [splitKey(entry?.geography), Number(entry?.regions)]));
  const previousComponentKeys = new Set(
    normalizeArray(previous?.territorialComponents)
      .filter((component) => Number(component?.population) > 0)
      .map((component) => splitKey(component?.geography)),
  );
  const liveMembers = territorialMacroPlan.flatMap((bucket) => normalizeArray(bucket?.members));
  const needsSplit = new Set(
    liveMembers
      .filter((member) => populationCalibrationRequested
        || !previousComponentKeys.has(splitKey(member?.geography))
        || storedSplitRegions.get(splitKey(member?.geography)) !== heldRegionCount(member))
      .map((member) => splitKey(member?.geography)),
  );
  const componentSplitBuckets = territorialBasis.componentDetail
    ? territorialMacroPlan
      .filter((bucket) => normalizeArray(bucket?.members).length > 1)
      .filter((bucket) => normalizeArray(bucket.members).some((member) => needsSplit.has(splitKey(member?.geography))))
      .map((bucket) => ({
        index: bucket.index,
        members: normalizeArray(bucket.members).map((member) => ({ componentId: member.componentId, geography: member.geography })),
      }))
    : [];
  const componentSplitOutcome = new WeakMap();

  const statsAiStartedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const { payload } = await runJsonTask("countryStatSheet", {
    lookups: buildTaskLookups(bundle),
    signal,
    ...(requestKind ? { requestKind } : {}),
    ...(budget ? { budget, spender: "stats" } : {}),
    ...(typeof onRequest === "function" ? { onRequest } : {}),
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
      statsComponentSplitBuckets: componentSplitBuckets,
      statsComponentSplitOutcome: componentSplitOutcome,
      statsStoredSplitComponents: storedSplits.map((entry) => entry?.geography),
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
  const freshlySplitKeys = new Set(normalizeArray(payload && componentSplitOutcome.get(payload)).map(splitKey));
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
        // A component's first semantic split replaces a region-count placeholder
        // (or a split made for a different slice of it); the jump away from that is
        // the fix, not a discontinuity. Its bucket-mates re-split alongside it are
        // still held to the band.
        freshlySplitGeographies: liveMembers
          .map((member) => member.geography)
          .filter((geography) => freshlySplitKeys.has(splitKey(geography)) && needsSplit.has(splitKey(geography))),
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
      // Components whose share of the ledger came from a semantic split, with the
      // regions they held then: the ones split just now, plus earlier ones still
      // holding the same slice. A component left on the native weights, or whose
      // holding changed without a new split, is not listed, so it is asked again.
      semanticSplitComponents: liveMembers
        .filter((member) => freshlySplitKeys.has(splitKey(member?.geography))
          || (previousComponentKeys.has(splitKey(member?.geography))
            && storedSplitRegions.get(splitKey(member?.geography)) === heldRegionCount(member)))
        .map((member) => ({ geography: member.geography, regions: heldRegionCount(member) })),
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
  const bundle = await readSeenGameStateBundle({ force: true });
  const variables = await buildTemplateVariables(bundle, { actionInput: rawInput, lookups: true });
  const { payload } = await runJsonTask("descriptionToAction", {
    lookups: buildTaskLookups(bundle),
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

// ---- One turn of a chat, for every AI participant, in ONE request -----------
//
// The old shape of a group turn: `chooseNextDiplomaticSpeaker` (a request) and
// then one request per leader who answered, capped at three — four requests for
// one player message. This is all of it in a single answer
// (AI/chatActions.js), applied to the thread's event log
// (runtime/chatThreads.js) with per-action feedback carried into the next turn.
//
// Who acts is settled HERE, natively: the AI participants of this thread. The
// model is told the roster is authoritative and may never act for the human.
const institutionGovernancePrompt = (world, institutionId, playerCountry = "") => {
  const institution = resolveInstitutionRecord(world, institutionId);
  if (!institution) return "";
  const proposals = Object.values(institution.proposals || {}).slice(0, 16);
  const proposalLines = proposals.length
    ? proposals.map((proposal) => {
      const amendments = Array.isArray(proposal?.amendments)
        ? proposal.amendments.filter((entry) => entry?.status === "proposed").map((entry) => `${entry.id}: ${entry.text}`).slice(0, 4)
        : [];
      const voting = proposal?.voting;
      const eligible = Array.isArray(voting?.eligibleVoters) ? voting.eligibleVoters.join(", ") : "";
      const already = voting?.ballots && typeof voting.ballots === "object" ? Object.keys(voting.ballots).join(", ") : "";
      return `- ${proposal.id}: ${proposal.title} [${proposal.status}; type=${proposal.type || "resolution"}]`
        + (amendments.length ? `; unresolved amendments: ${amendments.join(" | ")}` : "")
        + (eligible ? `; eligible voters: ${eligible}` : "")
        + (already ? `; ballots already cast: ${already}` : "");
    }).join("\n")
    : "- no formal proposals are currently on the agenda";
  const members = (Array.isArray(institution.members) ? institution.members : [])
    .map((member) => `${member.polity} (${member.status || "member"}${member.role ? `, ${member.role}` : ""})`)
    .join(", ");
  const lifecycle = institution?.charter?.lifecycle || {};
  const identity = lifecycle?.identity || {};
  const identityLines = [
    normalizeArray(lifecycle.purpose).length ? `Institution purpose: ${normalizeArray(lifecycle.purpose).slice(0, 5).join("; ")}.` : "",
    normalizeString(identity.politicalCharacter) ? `Political character: ${normalizeString(identity.politicalCharacter)}.` : "",
    normalizeArray(identity.geographicScope).length ? `Geographic scope: ${normalizeArray(identity.geographicScope).slice(0, 5).join(", ")}.` : "",
    normalizeArray(identity.primaryThreatModel).length ? `Primary threat/adversary model: ${normalizeArray(identity.primaryThreatModel).slice(0, 5).join(", ")}.` : "",
    normalizeString(institution?.charter?.note) ? `Charter / obligations: ${normalizeString(institution.charter.note).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");
  return `[FORMAL INSTITUTIONAL GOVERNANCE - NATIVE LAW]\n`
    + `This thread is the formal channel of ${institution.name} (${institution.id}).\n`
    + (identityLines ? `${identityLines}\n` : "")
    + `Canonical members: ${members || "none"}.\n`
    + `The human-controlled polity is ${playerCountry || "the player"}. NEVER use an institution_* action for it.\n`
    + `Speech, reactions and create_poll/poll_vote are conversation only. They DO NOT create proposals, amendments, legal ballots, membership changes or binding institutional outcomes.\n`
    + `Do not use add_member/remove_member in this channel: membership belongs to the institution ledger.\n`
    + `Use institution_lodge_proposal only when an AI member genuinely tables new formal business. When an eligible AI member has clearly advanced a concrete, actionable institutional proposal in Council, especially when another member or the player endorses it or asks to make it official, table it NOW in this same turn with institution_lodge_proposal instead of merely promising to draft it later. Example pattern: an AI member says "we propose X", the Council engages with X, and the player says "make it official"; that same AI sponsor should lodge X alongside any conversational reply. Keep sponsorship with the AI polity that actually originated the proposal; player endorsement does not transfer authorship to the player. Vague commentary, repetition, or an idea already represented on the formal agenda stays speech only. Lodging puts business on the agenda for debate; do NOT jump straight to a ballot unless the exact sponsor also genuinely submits the existing proposal and native rules permit it.\n`
    + `Use institution_submit_proposal only for an exact existing proposal id when its sponsor is ready to open the charter-defined vote. Use institution_amendment / institution_resolve_amendment only for exact proposal/amendment ids below. Use institution_vote only for an AI polity's formal legal ballot, never for the player. Exact raw-JSON vote shape: {"type":"institution_vote","actorName":"<exact AI polity>","proposalId":"<exact proposal id>","voteChoice":"yes|no|abstain|veto","reason":"<concise rationale>"}. Use actorName and voteChoice exactly; do not substitute polity/vote/choice or repeat institutionId. Native code checks every action and the charter; prose cannot override it.\n`
    + `For accession votes, evaluate the applicant against the institution's actual identity, scope, obligations and threat model as well as that government's PWv2 and relations. Friendly relations alone are not a reason to vote yes; do not hardcode real-world countries either, because campaign politics may have diverged.\n`
    + `[Formal agenda]\n${proposalLines}`;
};

export const runChatActionBatch = async ({
  chat,
  playerMessage = "",
  playerCountry = "",
  // What the world did since this thread last spoke (conversationCatchUp.js
  // buildThreadCatchUp), and the moment the player wrote from; the panel keeps
  // both on the player's line.
  catchUp = "",
  time = "",
  signal = null,
  requestKind = undefined,
  lifecycleResponseRequested = false,
  formalBusinessRequested = false,
  useCanonicalState = false,
  budget = null,
  spender = "",
  onRequest = null,
} = {}) => {
  // Player-facing conversation normally reasons from what has been revealed. A
  // post-turn autonomous ballot is different: it is world simulation and must
  // see the just-committed canonical proposal/ballot state even before the
  // timeline reveal has finished animating.
  const readBundle = useCanonicalState
    ? await readGameStateBundle({ force: true })
    : await readSeenGameStateBundle({ force: true });
  const bundle = useCanonicalState ? { ...readBundle, savedGame: readBundle.game, unseen: new Set() } : readBundle;
  const unseen = bundle.unseen ?? new Set();
  const player = normalizeString(playerCountry) || normalizeString(bundle.game?.country);
  const stored = normalizeChats([chat])[0];
  if (!stored) return { events: [], applied: [], rejected: [], actions: [] };
  // An accepted invitation hearing may carry institutionId so it can be tied to
  // the institution ledger, but it remains a lifecycle negotiation thread until
  // the case is closed. Never let that dual identity masquerade as the permanent
  // Council channel. The formal channel has its own stable thread identity.
  const lifecycleGovernanceThread = Boolean(
    stored.institutionId &&
    stored.lifecycleInstitutionId &&
    normalizeArray(stored.lifecycleCaseIds).length,
  );
  const formalInstitutionPrompt = stored.institutionId && !lifecycleGovernanceThread
    ? institutionGovernancePrompt(bundle.world, stored.institutionId, player)
    : "";
  const lifecycleDecisionContext = stored.lifecycleInstitutionId && normalizeArray(stored.lifecycleCaseIds).length
    ? buildInstitutionLifecycleDecisionContext(bundle.world, {
      institutionId: stored.lifecycleInstitutionId,
      caseIds: stored.lifecycleCaseIds,
      actorPolities: normalizeArray(stored.countries).map((country) => normalizeString(country?.name)).filter(Boolean),
      playerCountry: player,
    })
    : null;
  const institutionLifecyclePrompt = lifecycleDecisionContext?.text || "";
  const autonomousBallotWork = formalBusinessRequested && stored.institutionId && !lifecycleGovernanceThread
    ? collectAutonomousInstitutionBallotWork(bundle.world, player, { maxInstitutions: 8, maxVotersPerInstitution: 32 })
      .find((entry) => regionKey(entry.institutionId) === regionKey(stored.institutionId)) || null
    : null;
  const autonomousBallotActors = new Set(normalizeArray(autonomousBallotWork?.actors).map(regionKey).filter(Boolean));

  // The log is the truth; a thread saved before it existed is migrated on read.
  // The normalized entry has already folded in what was written beside the log —
  // the player's line that started this turn among it — so read it from there:
  // the raw `chat.events` would leave that line out of the thread for good.
  const events = normalizeArray(stored.events).length
    ? stored.events
    : eventsFromLegacyChat(stored);
  const projected = projectChatThread(events);
  const lifecycleResponseActors = new Set((lifecycleDecisionContext?.cases || []).map((entry) => regionKey(entry?.polity)).filter(Boolean));
  const aiParticipants = projected.countries
    .map((country) => normalizeString(country?.name))
    .filter((name) => name && regionKey(name) !== regionKey(player))
    .filter((name) => !(lifecycleResponseRequested && institutionLifecyclePrompt) || lifecycleResponseActors.has(regionKey(name)))
    .filter((name) => !formalBusinessRequested || autonomousBallotActors.has(regionKey(name)));
  if (!aiParticipants.length) return { events: [], applied: [], rejected: [], actions: [] };

  // What this polity has heard in its OTHER threads since it last spoke here —
  // fenced, cursored and scoped by membership (AI/crossChatKnowledge.js). One
  // block per AI participant, each labelled with whose knowledge it is.
  const cursors = normalizeWorldState(bundle.world).chatKnowledgeCursors ?? {};
  const otherThreads = normalizeChats(bundle.chats)
    .filter((entry) => normalizeString(entry?.id) !== normalizeString(stored.id))
    .map((entry) => ({ id: entry.id, title: entry.title, events: eventsFromLegacyChat(entry) }));
  const nextCursors = { ...cursors };
  const knowledgeBlocks = [];
  for (const speaker of aiParticipants) {
    const visible = otherThreads.filter((entry) => isChatVisibleTo(
      { countries: projectChatThread(entry.events).countries },
      speaker,
    ));
    const knowledge = buildCrossChatKnowledge({
      threads: visible,
      polity: speaker,
      cursors: nextCursors,
      projectAsSeenBy: threadAsSeenBy,
    });
    Object.assign(nextCursors, knowledge.cursors);
    if (knowledge.text) knowledgeBlocks.push(`### ${speaker}'s own cables\n${knowledge.text}`);
  }
  const crossChatKnowledge = knowledgeBlocks.length
    ? `${knowledgeBlocks.join("\n\n")}\n\nEach block above belongs to ONE polity. What is in another polity's block is not known to this one: write each leader from its own cables alone.`
    : "";

  // What each AI participant's country knows of who directs whom
  // (runtime/puppets.js) — the group twin of the one-on-one leader's briefing,
  // held to the same discipline as the cables above: one block per polity, and a
  // polity knows only its own. Without it a covert Puppet at the table does not
  // know to present itself as independent, nor that the demand it is refusing
  // came from its own Overlord, so it cannot mark the refusal either. The room is
  // every AI participant and the player, who is exactly who a covert Puppet most
  // needs to deceive.
  const briefingWorld = normalizeWorldState(bundle.world);
  const inTheRoom = [...aiParticipants, player];
  const subordinationBlocks = aiParticipants
    .map((speaker) => describePuppetBriefing(puppetBriefingFor(briefingWorld, speaker, { present: inTheRoom }), speaker))
    .filter(Boolean);
  const subordinationKnowledge = subordinationBlocks.length
    ? `${subordinationBlocks.join('\n\n')}\n\nEach subordinations block belongs to ONE polity, like the cables. A polity may not reveal a covert arrangement it is party to to anyone its block lists as not knowing, and never knows another polity's covert arrangements unless its own block says so.`
    : "";

  const openPolls = projected.polls.filter((poll) => poll.options.length);
  const pollText = openPolls.length
    ? `\n[Polls open in this conversation]\n${openPolls.map((poll) => (
      `- ${poll.id}: "${poll.question}" — ${poll.tally.map((option) => `${option.label} (${option.id}): ${option.votes}`).join("; ")}`
      + `${Object.keys(poll.votes).length ? `; voted: ${Object.keys(poll.votes).join(", ")}` : "; nobody has voted"}`
    )).join("\n")}`
    : "";

  // One request writes every participant, so the whole thread is in front of the
  // model — including what was said before a newcomer came into the room. The
  // log knows who heard each line (chatThreads.js heardBy); a line some present
  // participant did NOT hear says so, and the header says what that means.
  const absentFrom = (message) => {
    const heard = normalizeArray(message.heardBy).map(regionKey);
    return heard.length ? aiParticipants.filter((name) => !heard.includes(regionKey(name))) : [];
  };
  const shownMessages = withoutUnseenMessages(projected.messages, unseen);
  const recent = shownMessages.slice(-24);
  const lines = recent.map((message) => {
    const absent = absentFrom(message);
    return `[${message.id}] ${message.speaker || (message.role === "user" ? player : "someone")}: ${message.text}`
      + (absent.length ? ` (not heard by ${absent.join(", ")})` : "");
  });
  const transcript = [
    ...(recent.some((message) => absentFrom(message).length)
      ? ["(A line marked \"not heard by\" was said while that polity was not in this conversation. It does not know what was said there unless its own cables below tell it; write it that way.)"]
      : []),
    ...lines,
  ].join("\n");
  const rosterText = [
    ...aiParticipants.map((name) => `- ${name} — AI-controlled: you act for it`),
    `- ${player} — HUMAN-controlled (the player): never speak or act for it`,
  ].join("\n");

  const politicalDecisionSet = buildBoundedPoliticalDecisionContextSet(bundle.world, {
    actorPolities: aiParticipants,
    counterpartByActor: Object.fromEntries(aiParticipants.map((name) => [name, player])),
    maxActors: formalBusinessRequested ? 32 : 6,
    perActorMaxChars: formalBusinessRequested ? 900 : 1800,
    maxTotalChars: formalBusinessRequested ? 26000 : 9000,
    limits: {
      traits: 5, goals: 4, fears: 3, ambitions: 3, domesticPressures: 3,
      pressureIssues: 3, governingEntities: 3, oppositionEntities: 1,
      perceptions: 3, relations: 2, agreements: 2, wars: 2, institutions: 6,
    },
  });

  // Each AI participant also sees only the documents its own government can read.
  // One-request group diplomacy contains several governments in one model call,
  // so the blocks are explicitly compartmentalized just like PWv2 and cross-chat
  // knowledge: evidence for one participant is not shared with another by virtue
  // of being present in the combined request. This also keeps institutional
  // councils on the same reports/documents architecture as ordinary diplomacy.
  const documentBlocks = aiParticipants.map((speaker) => {
    const key = normalizeString(speaker).toLowerCase();
    const text = key ? describeReportsForPrompt(bundle.world?.reports, {
      sees: (visibleTo) => visibleTo === null || normalizeArray(visibleTo).some((name) => normalizeString(name).toLowerCase() === key),
      heading: `### ${speaker}'s government documents`,
      limit: 8,
      bodyChars: 220,
    }) : "";
    return text ? text : "";
  }).filter(Boolean);
  const documentKnowledge = documentBlocks.length
    ? `${documentBlocks.join("\n\n")}\n\nEach document block above belongs to ONE government. Never reveal another participant's private papers unless that government actually shares them in this conversation.`
    : "";

  const variables = {
    ...(await buildTemplateVariables(bundle, { taskKey: "chatActions" })),
    chatParticipants: rosterText,
    chatHistory: transcript || "(nothing said yet)",
    CHAT_OPEN_POLLS: pollText,
    CROSS_CHAT_KNOWLEDGE: [crossChatKnowledge, subordinationKnowledge].some(Boolean)
      ? `\n${[crossChatKnowledge, subordinationKnowledge].filter(Boolean).join('\n\n')}`
      : "",
    CHAT_ACTION_FEEDBACK: normalizeString(chat?.actionFeedback) ? `\n${chat.actionFeedback}` : "",
  };

  const { payload } = await runJsonTask("chatActions", {
    fallback: () => ({ actions: [] }),
    signal,
    userMessage: [
      normalizeString(catchUp),
      playerMessage
        ? `${player} has just said: ${playerMessage}`
        : formalBusinessRequested && autonomousBallotWork
          ? autonomousInstitutionBallotDirective(autonomousBallotWork)
          : lifecycleResponseRequested && institutionLifecyclePrompt
            ? "The player explicitly requested a response from this institution membership negotiation. Every AI-controlled government at this table that owns an open lifecycle case MUST now return exactly one lifecycle decision for its own exact case: accept, reject, seek-observer, request-terms, or delay. Use delay if that government is not ready to decide. This lifecycle turn is raw JSON: return an actions array (use send_message with actorName/content for any speech) and return lifecycleResponsesJson as an actual JSON array of response objects. Do not use a dialogue field. Prose alone is not a membership decision."
            : "Nobody has spoken since your last turn; decide whether anyone would speak now.",
      politicalDecisionSet.text
        ? `[PRIVATE POLITICAL DECISION CONTEXT - ENGINE DATA]\n${politicalDecisionSet.text}\n\nUse each actor capsule only for that actor. Do not reveal one participant's private politics to another merely because this combined request contains both.`
        : "",
      documentKnowledge ? `[PRIVATE GOVERNMENT DOCUMENTS - COMPARTMENTALIZED]\n${documentKnowledge}` : "",
      institutionLifecyclePrompt,
      formalInstitutionPrompt,
      "Return this turn's actions as JSON only.",
    ].filter(Boolean).join("\n\n"),
    variables,
    // Keep the one-request Beta group-diplomacy path. Gemini rejects the large
    // submit_chat_actions function declaration once native institution formal
    // actions/lifecycle fields are present, so institution conversations use
    // raw JSON transport. The payload still passes CHAT_ACTIONS_SCHEMA and then
    // native conversation / governance / lifecycle validators below. Transport
    // changes; authority does not.
    ...((institutionLifecyclePrompt || formalInstitutionPrompt) ? { toolOverride: null } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(budget ? { budget, spender: spender || "institutionBallots" } : {}),
    ...(typeof onRequest === "function" ? { onRequest } : {}),
  });

  const known = mergePolityCatalog(await loadCountryNames(), bundle.world).map((entry) => entry.name).filter(Boolean);
  const rawActions = normalizeArray(payload?.actions);
  const lifecyclePartition = partitionInstitutionLifecycleChatActions(rawActions);
  const compactLifecycleResponses = parseInstitutionLifecycleResponsesJson(payload?.lifecycleResponsesJson);
  const lifecycleActions = [...lifecyclePartition.lifecycle];
  for (const action of compactLifecycleResponses) {
    const duplicate = lifecycleActions.some((entry) => regionKey(entry.actorName) === regionKey(action.actorName) && normalizeString(entry.caseId) === normalizeString(action.caseId));
    if (!duplicate) lifecycleActions.push(action);
  }
  const partitioned = stored.institutionId
    ? partitionInstitutionChatActions(lifecyclePartition.conversational)
    : { formal: [], conversational: lifecyclePartition.conversational };
  const turnTime = normalizeString(time) || normalizeString((bundle.savedGame ?? bundle.game)?.gameDate);
  const outcome = applyChatActionBatch(partitioned.conversational, {
    aiParticipants,
    humanParticipants: [player],
    knownPolities: known,
    messageIds: shownMessages.map((message) => message.id),
    polls: projected.polls,
  }, {
    time: turnTime,
    disallowMembershipChanges: Boolean(stored.institutionId),
    // So a second turn on the same game day cannot mint the first one's ids.
    takenIds: events.map((event) => event?.id),
  });

  const memorySummary = normalizeString(payload?.memorySummary);
  if (memorySummary) {
    const lastMessage = [...outcome.events].reverse().find((event) => event.kind === "message");
    if (lastMessage) lastMessage.memorySummary = memorySummary;
  }
  let committedInstitution = null;
  let committedLifecycle = null;
  let formalRejected = [];
  let lifecycleRejected = [];
  if (stored.institutionId) {
    committedInstitution = await commitInstitutionalChatGovernanceBatch({
      institutionId: stored.institutionId,
      playerCountry: player,
      date: turnTime,
      chatEvents: outcome.events,
      formalActions: partitioned.formal,
      cursors: nextCursors,
      expectedGameId: normalizeString(bundle.game?.id || bundle.game?.gameId),
    });
    formalRejected = committedInstitution.rejected || [];
  } else if (stored.lifecycleInstitutionId && lifecycleActions.length) {
    committedLifecycle = await commitInstitutionLifecycleChatBatch({
      chatId: stored.id,
      institutionId: stored.lifecycleInstitutionId,
      lifecycleCaseIds: stored.lifecycleCaseIds || [],
      playerCountry: player,
      date: turnTime,
      chatEvents: outcome.events,
      lifecycleActions,
      cursors: nextCursors,
      expectedGameId: normalizeString(bundle.game?.id || bundle.game?.gameId),
    });
    lifecycleRejected = committedLifecycle.rejected || [];
  }

  const combinedRejected = [...outcome.rejected, ...formalRejected, ...lifecycleRejected];
  const feedbackOutcome = { ...outcome, rejected: combinedRejected };
  logDebugEvent("diplomacy",
    `Chat #${stored.id}: one request acted for ${aiParticipants.length} participant(s) - ${outcome.applied.length} conversational action(s), ${partitioned.formal.length - formalRejected.length} formal institution action(s), ${lifecycleActions.length - lifecycleRejected.length} lifecycle response(s) applied; ${combinedRejected.length} refused.`,
    { applied: outcome.applied.map((action) => `${action.actorName}:${action.type}`), formal: partitioned.formal.map((action) => `${action.actorName}:${action.type}`), lifecycle: lifecycleActions.map((action) => `${action.actorName}:${action.decision}`), rejected: combinedRejected.map((entry) => entry.reason) });

  const committedChannel = committedInstitution?.channel || committedLifecycle?.channel || null;
  const finalChatEvents = committedChannel?.events?.length
    ? committedChannel.events
    : [...events, ...outcome.events];
  const committedNewEvents = (committedInstitution || committedLifecycle)
    ? finalChatEvents.filter((event) => !events.some((before) => before?.id === event?.id))
    : outcome.events;
  return {
    ...outcome,
    rejected: combinedRejected,
    events: finalChatEvents,
    newEvents: committedNewEvents,
    feedback: describeChatActionFeedback(feedbackOutcome),
    cursors: nextCursors,
    actions: rawActions,
    formalActions: partitioned.formal,
    lifecycleActions,
    ...((committedInstitution || committedLifecycle) ? { committed: true } : {}),
    ...(committedInstitution ? { institution: committedInstitution.institution } : {}),
    ...(committedLifecycle ? { lifecycle: committedLifecycle.applied } : {}),
  };
};

// Once a completed turn lands, formal ballots in institutions the player belongs
// to must not freeze merely because the Council was closed. One bounded existing
// chatActions request per affected institution asks only the unresolved NPC
// voters for the oldest open ballot. Native governance still casts, dedupes,
// closes and implements the vote; this function owns no parallel ballot state.
export const runPostTurnInstitutionBallots = async ({
  playerCountry = "",
  date = "",
  signal = null,
  expectedGameId = "",
  requests = null,
} = {}) => {
  const snapshot = await readGameStateBundle({ force: true });
  const player = normalizeString(playerCountry) || normalizeString(snapshot.game?.country);
  if (!player) return { attempted: 0, applied: 0, results: [] };
  const work = collectAutonomousInstitutionBallotWork(snapshot.world, player, { maxInstitutions: 4, maxVotersPerInstitution: 32 });
  // In request-saving mode one provider slot is reserved for institutional
  // governance. Resolve the oldest affected institution this turn; additional
  // institutions remain open and take the reserved slot on later turns. With
  // request saving off, preserve the existing all-institutions behavior.
  const scheduledWork = requests?.saving ? work.slice(0, 1) : work;
  const results = [];
  let applied = 0;
  for (const item of scheduledWork) {
    if (signal?.aborted) break;
    try {
      const materialized = await ensureInstitutionalChannel({
        institutionId: item.institutionId,
        playerCountry: player,
        date: normalizeString(date) || normalizeString(snapshot.game?.gameDate),
        expectedGameId: expectedGameId || normalizeString(snapshot.game?.id || snapshot.game?.gameId),
      });
      const result = await runChatActionBatch({
        chat: materialized.channel,
        playerCountry: player,
        time: normalizeString(date) || normalizeString(snapshot.game?.gameDate),
        signal,
        formalBusinessRequested: true,
        useCanonicalState: true,
        ...jumpTaskOptions(requests, "institutionBallots"),
      });
      const votes = normalizeArray(result?.formalActions).filter((action) => action?.type === "institution_vote");
      const refusedVotes = normalizeArray(result?.rejected).filter((entry) => entry?.action?.type === "institution_vote").length;
      applied += Math.max(0, votes.length - refusedVotes);
      results.push({ ...item, requested: item.actors.length, votes: votes.length, rejected: refusedVotes });
    } catch (error) {
      console.warn(`[institution autonomy] ${item.institutionName || item.institutionId} ballot pass failed; the completed turn remains committed.`, error);
      results.push({ ...item, requested: item.actors.length, votes: 0, rejected: item.actors.length, error: normalizeString(error?.message || error) });
    }
  }
  if (work.length) {
    const deferred = Math.max(0, work.length - scheduledWork.length);
    logDebugEvent("turn", `Institution autonomy: ${scheduledWork.length}/${work.length} open ballot(s) checked after the turn; ${applied} NPC ballot action(s) accepted${deferred ? `; ${deferred} institution(s) deferred by request-saving mode` : ""}.`, results, { verbose: true });
  }
  return { attempted: scheduledWork.length, deferred: Math.max(0, work.length - scheduledWork.length), applied, results };
};

// What an AI's reply does about a demand, in the one-on-one thread between the
// player and their own Overlord or Puppet (runtime/demandCheck.js): the events to
// append to the thread's log — a demand made, answered, or settled — or none.
//
// One small request, and only there: every other reply in the game is never
// checked. Its answer is a REQUIRED choice from a fixed list, which is the whole
// point — the optional hidden line it replaces was left off by a model that had
// plainly understood the refusal. A failed request records nothing: no card, no
// charge, never a guess.
//
// `answering` is the message the reply answers, so the check can tell a refusal
// from a reply to something else. The caller appends what comes back.
const mintDemandId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const checkDemandReply = async ({ chat, speaker, reply, answering = "", messageId = "", time = "", signal = null } = {}) => {
  if (!isActiveFeatureEnabled("puppetStates")) return [];
  const stored = normalizeChats([chat])[0];
  if (!stored || !normalizeString(reply)) return [];
  const [world, game] = await Promise.all([readWorldState({ force: true }), readGameData({ force: true })]);
  const context = demandCheckContext({
    world,
    speaker,
    playerCountry: normalizeString(game?.country),
    participants: stored.countries,
  });
  if (!context) return [];
  // A Puppet answers the demand in play, or thinks better of one it refused;
  // an Overlord acts on whatever is on the table. A Puppet's reply matters only
  // while there is something for it to answer; an Overlord's always might,
  // since any reply of its may make a demand.
  const openDemand = context.role === "puppet" ? answerableDemandOf(stored) : openDemandOf(stored);
  if (context.role === "puppet" && !openDemand) return [];

  const { payload } = await runJsonTask("demandCheck", {
    fallback: () => ({ outcome: "none", summary: "" }),
    signal,
    userMessage: demandCheckPrompt({ context, reply, openDemand, answering, demands: stored.demands }),
    variables: {},
    requestKind: BACKGROUND_REQUEST,
  });
  const events = interpretDemandCheck({ payload, context, openDemand, messageId, time, idFor: mintDemandId, demands: stored.demands });
  logDebugEvent("diplomacy",
    `Demand check on ${speaker}'s reply (${context.role}): ${normalizeString(payload?.outcome) || "none"}${events.length ? ` — ${events.map((event) => event.kind === "demand_made" ? "demand made" : `demand ${event.answer}`).join(", ")}` : ""}.`,
    { outcome: payload?.outcome, summary: payload?.summary, openDemand: openDemand?.id ?? null });
  return events;
};

export const chooseNextDiplomaticSpeaker = async ({
  chat,
  excludeSpeaker = "",
} = {}) => {
  const bundle = await readSeenGameStateBundle({ force: true });
  const storedChat = normalizeChats([chat])[0];
  if (!storedChat) {
    return "";
  }
  const normalizedChat = { ...storedChat, messages: withoutUnseenMessages(storedChat.messages, bundle.unseen) };

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

// Cheats → History Document: fold the older unconsolidated history now —
// everything but the retained tail, one batch — regardless of the round and
// size thresholds, and write the pass and the revised document. Refused while
// a turn is in flight: that turn's own pass would fold the same events again.
export const consolidateHistoryNow = async () => {
  if (isSimulationBusy()) {
    throw new Error("A turn is being generated; wait for it to finish before folding history.");
  }
  beginSimulation();
  try {
    const bundle = await readGameStateBundle({ force: true });
    const plan = planHistoryConsolidation(bundle, { force: true });
    const retained = plan.unconsolidatedEvents.length - plan.eventsToConsolidate.length;
    if (!plan.due) return { consolidated: false, events: 0, chats: 0, retained };
    const before = normalizeWorldState(bundle.world).consolidatedHistory.length;
    const nextWorld = await compactHistoryIfNeeded(bundle, { force: true });
    const consolidated = nextWorld.consolidatedHistory.length > before;
    if (consolidated) await writeWorldState(nextWorld);
    return {
      consolidated,
      events: plan.eventsToConsolidate.length,
      chats: plan.closedChats.length,
      retained,
      documentWords: countWords(nextWorld.historyDocument?.text),
      documentRevision: nextWorld.historyDocument?.revision ?? 0,
    };
  } finally {
    endSimulation();
  }
};

// ---- Interactive events: a moment played out as a scene ---------------------
//
// The player does not ask for one. Now and then a time skip offers one of its
// own events to be played out (runtime/interactiveOffer.js, chosen in
// applySimulationResult); the event's card says so, and the player takes it up
// (GameUI/interactive.jsx) or lets it pass. Taking it up is one request, each
// beat one more, and the end — the beats written into the record as one event —
// one more. A step that fails changes nothing: the canned text a task falls back
// on is not a scene anyone asked for, so it is reported instead.

// What the creation task is told about the moment it is to open: the offered
// event, and the player's angle on it when they gave one.
const offeredSceneDirective = (event, angle) => [
  "[THE MOMENT TO PLAY OUT — BINDING]",
  `The player chose to play out this event from the latest time skip as an interactive event:`,
  `Date: ${normalizeString(event.date) || "(undated)"}`,
  `Event: ${normalizeString(event.title)}`,
  normalizeString(event.description),
  "Open the scene inside this event: its decisive moment if it is still unfolding, or the moment its consequences reach the player's leadership and they must answer, as close to the current date as the event allows. What the event reports has happened; build on it, do not retell it, contradict it or resolve what it leaves open. Establish only the facts needed to begin, and do not invent relationships, motives, arrivals or backstory to make it more dramatic.",
  ...(angle
    ? ["", "[THE PLAYER'S ANGLE — BINDING]", angle, "Build the scene around this within the event above. Do not widen it, escalate it or reinterpret it, and keep any ambiguity the player left."]
    : []),
].join("\n");

const sceneStepFailed = (generation, what) => {
  if (generation?.source !== "fallback") return null;
  const reason = normalizeString(generation.fallbackReason) || "the model's answer could not be used";
  return new Error(`${what} (${reason}). Nothing changed; try again.`);
};

// Take up the interactive event the last time skip offered: the scene opens on
// that event, with the player's angle when they gave one. The offer is spent.
export const createInteractive = async ({ eventId = "", angle = "", force = true } = {}) => {
  if (isSimulationBusy()) throw new Error("A turn is being generated; wait for it to finish before starting a scene.");
  beginSimulation();
  try {
    // The scene starts from the moment the player is looking at: never from
    // events a reveal has not shown them yet (runtime/unseenEvents.js).
    const bundle = await readSeenGameStateBundle({ force });
    if (bundle.unseen?.size) throw new Error("Finish revealing the last time skip before starting a scene.");
    if (hasSceneInProgress(bundle.world)) throw new Error("An interactive event is already in progress: end it or set it aside first.");
    const offer = normalizeWorldState(bundle.world).interactiveOffer;
    const event = offer && (!eventId || offer.eventId === normalizeString(eventId))
      ? offeredEvent({ offer, events: bundle.events })
      : null;
    if (!event) throw new Error("That interactive event has passed.");
    const asked = normalizeString(angle).slice(0, 1200);
    const variables = await buildTemplateVariables(bundle, { lookups: true });
    const { generation, payload } = await runJsonTask("interactiveCreation", {
      lookups: buildTaskLookups(bundle),
      fallback: () => ({ choices: [], opening: "", premise: "", title: "" }),
      userMessage: [offeredSceneDirective(event, asked), "Design the scene as JSON only."].join("\n\n"),
      variables,
    });
    const failed = sceneStepFailed(generation, "The scene could not be written");
    if (failed) throw failed;

    // Opened with its first opening kept, so a beat can be taken back to the very
    // start (interactiveRewind.js); marked as the player's, which is what makes it a
    // scene in progress rather than a leftover.
    const interactive = {
      ...openInteractive({
        choices: normalizeArray(payload?.choices).map((entry) => normalizeString(entry)).filter(Boolean),
        opening: normalizeString(payload?.opening),
        premise: normalizeString(payload?.premise),
        title: normalizeString(payload?.title),
      }),
      origin: "player",
      fromEventId: event.id,
      ...(asked ? { request: asked } : {}),
      startedOn: normalizeString(bundle.game?.gameDate),
    };

    const world = normalizeWorldState(await readWorldState({ force: true }));
    await writeWorldState({ ...world, activeInteractive: interactive, interactiveOffer: null });
    logDebugEvent("turn", `Interactive event: scene "${interactive.title || "untitled"}" opened on "${normalizeString(event.title)}"${asked ? " from the player's angle" : ""}.`);
    return interactive;
  } finally {
    endSimulation();
  }
};

// Let the offered interactive event pass: the offer is gone, nothing else
// changes. No request.
export const declineInteractiveOffer = async () => {
  if (isSimulationBusy()) throw new Error("A turn is being generated; wait for it to finish.");
  const world = normalizeWorldState(await readWorldState({ force: true }));
  if (!world.interactiveOffer) return { interactiveOffer: null };
  await writeWorldState({ ...world, interactiveOffer: null });
  logDebugEvent("turn", "Interactive event let pass.");
  return { interactiveOffer: null };
};

// A scene the player is in the middle of. A scene a time skip proposed before
// skips stopped proposing them is not one: the player never saw it.
const hasSceneInProgress = (world) => isSceneInProgress(normalizeWorldState(world ?? {}).activeInteractive);

// Set the scene aside: it ends with nothing written. No request.
export const setAsideActiveInteractive = async () => {
  if (isSimulationBusy()) throw new Error("A turn is being generated; wait for it to finish before changing the scene.");
  const world = normalizeWorldState(await readWorldState({ force: true }));
  if (!world.activeInteractive) return { interactive: null };
  await writeWorldState({ ...world, activeInteractive: null });
  logDebugEvent("turn", `Interactive event: scene "${world.activeInteractive.title || "untitled"}" set aside.`);
  return { interactive: null };
};

// The scene's beats written into the record as one event, and the scene closed:
// how it resolves when the scene decides it has, and how the player ends it
// early. The one request any resolution costs.
const resolveInteractiveScene = async ({ bundle, baseColors, campaignId, interactive, history }) => {
  const summaryVariables = await buildTemplateVariables(bundle, {
    interactiveHistory: normalizeArray(history)
      .map((entry) => `${entry.choice}: ${entry.summary}`)
      .join("\n"),
    interactivePremise: interactive.premise || interactive.title || "",
  });
  const { generation: summaryGeneration, payload: summaryPayload } = await runJsonTask("interactiveSummary", {
    fallback: () => ({ description: "", importance: "major", title: "" }),
    userMessage: "Summarize the finished interactive event into one campaign event as JSON only.",
    variables: summaryVariables,
  });
  const failed = sceneStepFailed(summaryGeneration, "The scene could not be written into the record");
  if (failed) throw failed;
  const lastSummary = normalizeString(normalizeArray(history).at(-1)?.summary);

  const interactiveEvent = normalizeGeneratedEvent({
    date: bundle.game.gameDate,
    description: normalizeString(summaryPayload?.description) || lastSummary,
    impacts: {
      createdChats: [],
      polityChanges: [],
      regionTransfers: [],
    },
    importance: normalizeString(summaryPayload?.importance) || "major",
    kind: "interactive",
    notable: true,
    playerRelated: true,
    title: normalizeString(summaryPayload?.title) || interactive.title || "Interactive event resolved",
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
      activeInteractive: null,
    },
    result: {
      clearActions: false,
      events: interactiveEvent ? [interactiveEvent] : [],
      mode: "interactive",
      stopDate: bundle.game.gameDate,
      summary: normalizeString(summaryPayload?.description) || lastSummary,
      generation: summaryGeneration,
    },
  });
};

// End the scene where it stands (the panel's End the scene). With no beat
// played there is nothing to record, and it is simply set aside.
export const endActiveInteractive = async () => {
  beginSimulation();
  try {
    const bundle = await readGameStateBundle({ force: true });
    const interactive = normalizeWorldState(bundle.world).activeInteractive;
    if (!interactive) throw new Error("No scene is in progress.");
    if (!normalizeArray(interactive.history).length) {
      const world = normalizeWorldState(await readWorldState({ force: true }));
      await writeWorldState({ ...world, activeInteractive: null });
      return { resolved: false };
    }
    const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
    const applied = await resolveInteractiveScene({ bundle, baseColors, campaignId: activeCampaignId(), interactive, history: interactive.history });
    logDebugEvent("turn", `Interactive event: scene "${interactive.title || "untitled"}" ended by the player after ${interactive.history.length} beat(s).`);
    return { resolved: true, ...applied };
  } finally {
    endSimulation();
  }
};

// Take back beat `beatIndex` of the scene in progress (D6, interactiveRewind.js):
// the scene returns to exactly how it stood when that beat was about to be
// chosen. Nothing outside the scene has changed before it resolves, so the
// rewind itself asks nothing of a model; with `choice` the beat is chosen again
// at once, which is the one request any beat costs.
export const rewindActiveInteractive = async ({ beatIndex, choice = "" } = {}) => {
  if (isSimulationBusy()) throw new Error("A turn is being generated; wait for it to finish before changing the scene.");
  const world = normalizeWorldState(await readWorldState({ force: true }));
  const interactive = world.activeInteractive;
  if (!interactive) throw new Error("No interactive event is in progress.");
  const rewound = rewindInteractive(interactive, Number(beatIndex));
  if (!rewound) {
    throw new Error(canRewindInteractiveTo(interactive, Number(beatIndex))
      ? "That beat cannot be returned to."
      : "That beat was played before the scene kept what was on screen at each beat, so it cannot be returned to; a later one can.");
  }
  await writeWorldState({ ...world, activeInteractive: rewound });
  logDebugEvent("turn", `Interactive event "${rewound.title || "untitled"}": beat ${Number(beatIndex) + 1} taken back${normalizeString(choice) ? " and chosen again" : ""}.`);
  if (normalizeString(choice)) return advanceActiveInteractive(normalizeString(choice));
  return { interactive: rewound };
};

export const advanceActiveInteractive = async (choiceText) => {
  beginSimulation();
  try {
  const bundle = await readGameStateBundle({ force: true });
  // Same hazard as a jump: AI calls run for a while, then the whole turn is written.
  const campaignId = activeCampaignId();
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  const world = normalizeWorldState(bundle.world);
  const interactive = world.activeInteractive;

  if (!interactive) {
    throw new Error("No interactive event is in progress.");
  }

  const interactiveHistoryText = normalizeArray(interactive.history)
    .map((entry) => `${entry.choice}: ${entry.summary}`)
    .join("\n");
  const variables = await buildTemplateVariables(bundle, {
    lookups: true,
    interactiveChoice: choiceText,
    interactiveHistory: interactiveHistoryText,
    interactiveOpening: interactive.opening || "",
    interactivePremise: interactive.premise || interactive.title || "",
  });

  const { generation, payload } = await runJsonTask("interactiveExecutor", {
    lookups: buildTaskLookups(bundle),
    fallback: () => ({ nextChoices: [], resolved: false, summary: "" }),
    userMessage: "Continue the interactive event as JSON only.",
    variables,
  });
  const failed = sceneStepFailed(generation, "The scene did not go on");
  if (failed) throw failed;

  const historyEntry = {
    choice: choiceText,
    summary: normalizeString(payload?.summary),
  };

  // The beat keeps what the player was shown when they chose it, so it can be
  // taken back and chosen differently (interactiveRewind.js).
  const nextInteractive = recordInteractiveBeat(interactive, {
    choice: choiceText,
    summary: historyEntry.summary,
    nextChoices: normalizeArray(payload?.nextChoices).map((entry) => normalizeString(entry)).filter(Boolean),
  });

  if (!payload?.resolved) {
    const nextWorld = {
      ...world,
      activeInteractive: nextInteractive,
    };
    await writeWorldState(nextWorld);
    return {
      interactive: nextInteractive,
      world: nextWorld,
    };
  }

  return resolveInteractiveScene({
    bundle,
    baseColors,
    campaignId,
    interactive,
    history: [...normalizeArray(interactive.history), historyEntry],
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
// ---- Player focus ----------------------------------------------------------
//
// How much of a jump belongs to the player, chosen per Game and kept in game
// data (playerFocus.js holds every rule; this is where the campaign's data is
// gathered for them).
//
// The counter has to know the player's TERRITORY, not just their name: an
// empire's internal events name a city or a province, or the country a province
// used to be, and counting those as the wider world is how unrest in Lahore
// became somebody else's news. Each region the player holds contributes its own
// name and the country it belongs to on the map.
const playerTerritoryNames = async (world, playerNames) => {
  const keys = new Set(normalizeArray(playerNames).map((name) => normalizeString(name).toLowerCase()).filter(Boolean));
  if (!keys.size) return [];
  // Who holds a region, by the one rule the rest of the engine uses
  // (lookupTools.js ownerOf): the campaign's override where there is one, then
  // the region's own owner, then the country it belongs to on the stock map.
  // Reading the overrides ALONE would find nothing for a player who has annexed
  // nothing, which is most players — their home provinces were never transferred.
  const overrides = normalizeWorldState(world).regionOwnershipOverrides ?? {};
  const names = new Set();
  for (const row of normalizeArray(await loadRegionCatalog().catch(() => []))) {
    const owner = normalizeString(overrides[normalizeString(row?.id)] ?? row?.owner ?? row?.country);
    if (!owner || !keys.has(owner.toLowerCase())) continue;
    for (const value of [row?.name, row?.country]) {
      const name = normalizeString(value);
      if (name && !keys.has(name.toLowerCase())) names.add(name);
    }
  }
  return [...names];
};

// The focus, the player's names and the test the counter uses, once per jump.
const readPlayerFocusContext = async (bundle) => {
  const playerName = normalizeString(bundle?.game?.country);
  const playerNames = [...new Set([playerName, toCountryName(playerName)].map(normalizeString).filter(Boolean))];
  const territoryNames = await playerTerritoryNames(bundle?.world, playerNames);
  // The scenario's default under this game's own choice (gameFeatures.js).
  return {
    focus: normalizePlayerFocus(getActivePlayerFocus()),
    playerName,
    playerNames,
    territoryNames,
    isPlayerEvent: createPlayerEventTest({ playerNames, territoryNames }),
  };
};

// What the player has going on over one window, from this campaign's own state.
const playerMaterialFor = (bundle, focusContext, { originDate, targetDate }) => collectPlayerMaterial({
  playerNames: focusContext.playerNames,
  isPlayerEvent: focusContext.isPlayerEvent,
  originDate,
  targetDate,
  actions: normalizeArray(bundle?.actions),
  projects: normalizeArray(bundle?.world?.projects),
  storylines: normalizeArray(bundle?.world?.storylines),
  wars: normalizeArray(bundle?.world?.wars),
  relations: normalizeArray(bundle?.world?.relations),
  chats: normalizeArray(bundle?.chats),
  recentEvents: normalizeArray(bundle?.events),
});

const runJumpSegments = async ({ context, onEvents, onProgress, signal, state }) => {
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
  // has to say which one is running or a correct turn looks like a hung one. The
  // skip's phases (skipPhases.js) carry it to the panel; a retry of a held
  // segment brings its own, since the panel that started the skip may be gone.
  if (!state.phases) state.phases = createSkipPhases({ requestsUsed: () => state.requests?.used ?? 0, onChange: onProgress });
  const writingLabel = `Writing ${formatDurationLabel(safeDays)} of events`;
  // The whole round so far for the panel: the committed segments, which are
  // validated, plus the raw events the running segment has written. Preview
  // only; nothing here reaches the world.
  const showEvents = typeof onEvents === "function"
    ? (partial) => {
      // Ordered as the validator will order it (timelineOrder.js), not as the
      // model wrote it. Sorting is the first thing validatePayload does, so a
      // preview left in write order rearranges itself when the turn lands and
      // the cards the player opened become different ones in the same places.
      const ordered = { events: [...state.generatedSoFar, ...partial] };
      sortTimelineEventsChronologically(ordered);
      try { onEvents(ordered.events); } catch { /* the panel's problem, never the turn's */ }
    }
    : null;
  const reportProgress = (segmentIndex) => {
    state.phases.enter("writing", {
      label: writingLabel,
      detail: segmentCount > 1 ? `part ${segmentIndex + 1} of ${segmentCount}` : "",
    });
  };

  // What the engine did with the PREVIOUS turn's answer, as the first thing this
  // one reads (runtime/applicationReceipt.js). In the user message rather than the
  // system prompt, so the cacheable prefix is untouched, and on every segment,
  // because each segment is a separate request that never saw the one before it.
  // Empty on a campaign's first jump and after a turn that predates receipts, and
  // then the message is byte-for-byte what it always was.
  const lastTurnReceipt = renderLastTurnReceipt(normalizeWorldState(bundle.world).simulationHistory);
  // The player's focus for this Game (playerFocus.js): what counts as a Player
  // event, gathered once, and per segment what the player has going on.
  const focusContext = await readPlayerFocusContext(bundle);
  // And what the Game Master changed by hand since then (runtime/gmChanges.js):
  // the changes made in the round this skip starts from. Once, because the round
  // moves on when the skip lands — and again after a rollback, because the skip
  // that heard them no longer happened. Empty when nobody touched the world.
  const gmChangeNarration = renderGmChangeNarration(gmChangesForRound(bundle.world, bundle.game?.round));

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
      // The scenario author's settings (worldDirection.js): the pace scales what
      // the period is asked for here, and the world's share is counted below.
      const direction = getActiveWorldDirection();
      // The author's scripted events that fall in this span (worldDirection.js):
      // asked for by name, and each one a slot of its own on top of the range.
      // The game's first skip covers its origin day too; after that the origin
      // day belongs to the period before.
      const scriptedBeats = scriptedBeatsInSpan(parseScriptedEvents(direction?.scriptedEvents), {
        originDate: state.segmentOrigin,
        targetDate: segmentTarget,
        includeOrigin: normalizeArray(bundle.world?.simulationHistory).length === 0 && segmentIndex === 0,
      });
      const [pacedMin, pacedMax] = segmentCount > 1
        ? segmentEventRange(spanDays, plannedActionShare, { pace: direction?.eventPace })
        : segmentEventRange(safeDays, plannedActionCount, { pace: direction?.eventPace });
      const minEvents = Math.max(pacedMin, scriptedBeats.length);
      const maxEvents = Math.max(pacedMax, scriptedBeats.length + 1);
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
        { targetDate: segmentTarget, playerFocus: focusContext.focus, puppetStates: isActiveFeatureEnabled("puppetStates") },
        signal,
      );
      console.info(
        `[OH world director] segment ${segmentIndex + 1}/${segmentCount} ${state.segmentOrigin} → ${segmentTarget}; ` +
        `storylines ${normalizeArray(ledgerWorld?.storylines).length}; attention ${worldInitiative.analysis?.attentionCount || 0}; ` +
        `exploration slots ${worldInitiative.analysis?.explorationSlotCount || 0}.`,
      );
      const politicalDecisionContext = buildWorldInitiativePoliticalDecisionContext({
        world: ledgerWorld,
        analysis: worldInitiative.analysis,
        playerPolity: normalizeString(bundle.game?.country),
      });
      // What the player has going on across THIS segment's window, and the
      // block that tells the simulator about it (playerFocus.js). Written with
      // the code-appended directives, where an author's guidance cannot reach it.
      const playerMaterial = playerMaterialFor(
        { ...bundle, events: segmentBundle.events },
        focusContext,
        { originDate: state.segmentOrigin, targetDate: segmentTarget },
      );
      // The two minimums, settled here where both are known: the player's focus
      // wins where they overlap (docs/adr/0003).
      const segmentShares = combinedShares({ focus: focusContext.focus, worldShare: direction?.worldShare });
      const segmentVariables = {
        ...variables,
        playerFocusWorldShare: segmentShares.world,
        playerFocusDirective: buildPlayerFocusDirective({
          focus: focusContext.focus,
          worldShare: direction?.worldShare,
          material: playerMaterial,
          playerName: focusContext.playerName,
        }),
        worldInitiativeContext: worldInitiative.text,
        ...(segmentCount > 1 ? { targetDate: segmentTarget, targetDateReadable: formatDateReadable(segmentTarget) } : {}),
        ...(segmentIndex > 0 ? {
          canonicalWarContext: buildCanonicalWarContext(ledgerWorld),
          canonicalDiplomaticContext: buildBoundedDiplomaticContext(ledgerWorld, {
            playerPolity: normalizeString(bundle.game.country),
            maxActors: 8,
            puppetStates: isActiveFeatureEnabled("puppetStates"),
          }).text,
        } : {}),
      };
      reportProgress(segmentIndex);

      // What this segment's ACCEPTED answer lost or had changed on its way in, and
      // what its rejected attempts were told (runtime/applicationReceipt.js). The
      // validator can run several times before an answer is taken — a strict
      // attempt, the salvaged retry, a late salvage of the first — so each run
      // fills a draft of its own and only the run that returned clean is merged
      // into the turn's receipt. A rejected attempt's drops never reach the record.
      let segmentDraft = null;
      const segmentComplaints = [];

      const { generation: segmentGeneration, payload, removed: removedFromSegment } = await runJsonTask(mode === "auto" ? "autoJumpForward" : "jumpForward", {
        lookups: buildTaskLookups(segmentBundle),
        // The skip itself always runs; asking again is what the budget weighs.
        ...jumpTaskOptions(state.requests, "jump"),
        // Only a single-call jump falls back on its own. A failing SEGMENT throws
        // instead, so the catch below can hold the turn and hand the player the
        // choice rather than quietly deciding for them.
        ...(segmentCount > 1
          ? {}
          : { fallback: () => fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate }) }),
        ...(showEvents ? { onPartialEvents: showEvents } : {}),
        signal,
        // The jump IS the game, and its deadline is runJsonTask's for every task:
        // silence, not elapsed time, so a long segment is never mistaken for a
        // stalled one (and a segmented jump gets that window per segment, since it
        // is per request). Cancel works either way.
        userMessage: [lastTurnReceipt, gmChangeNarration, politicalDecisionContext, buildSegmentInstruction({
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
        }), buildScriptedEventsInstruction(scriptedBeats)].filter(Boolean).join("\n\n"),
        validatePayload: withReceiptDraft(async (candidate, { finalAttempt } = {}, draft) => {
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
          if (mode !== "auto" && (eventCount < minEvents || eventCount > maxEvents)) {
            if (strict) return `$.events must contain between ${minEvents} and ${maxEvents} events; received ${eventCount}.`;
            // Kept, because sending it back is a whole second request — but the
            // model is told, at the top of its next turn, what the period asked for.
            noteReceipt(
              draft,
              "short",
              `You wrote ${eventCount} event${eventCount === 1 ? "" : "s"} for ${formatDurationLabel(spanDays)} that called for ${minEvents} to ${maxEvents}. `
                + (eventCount < minEvents
                  ? "A period that long holds more than that: cover the wider world as well as the player's own front."
                  : "Fewer, weightier events serve a period better than a long list of small ones."),
            );
          }
          // The world's share, a scenario author's setting the engine counts
          // (worldDirection.js). Never a rejection, on any attempt: a lopsided
          // period is still a period, asking again is a whole second request, and
          // the simulator is told at the top of its next turn.
          // The player's focus outranks the author's world share (docs/adr/0003):
          // when the two ask for more than the whole period, the world keeps what
          // is left. Both are counted the same way — never a rejection, said at
          // the top of the next turn.
          const shareShortfall = worldShareShortfall(candidate?.events, segmentShares.world, {
            // The player's TERRITORY counts as the player here too. Without it an
            // event inside the player's own empire satisfies the world's share,
            // which is how unrest in a player-held province came to be filed as
            // news from the wider world.
            playerNames: [...focusContext.playerNames, ...focusContext.territoryNames],
          });
          if (shareShortfall) noteReceipt(draft, "short", shareShortfall.text);
          const focusShortfall = playerFocusShortfall(candidate?.events, {
            focus: focusContext.focus,
            isPlayerEvent: focusContext.isPlayerEvent,
            material: playerMaterial,
            playerName: focusContext.playerName,
          });
          if (focusShortfall) noteReceipt(draft, "short", focusShortfall.text);
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
            noteReceipt(
              draft,
              "adjusted",
              `Some event dates fell outside ${state.segmentOrigin} to ${segmentTarget} and were moved inside it — ${firstComplaintLine(dateError)}`,
            );
          }
          // The map's tempo, an author's ceiling on how many regions change hands
          // in a period (worldDirection.js): counted in event order, before the
          // resolver spends anything on entries the period cannot carry. Never a
          // rejection — the front simply moves this far, and the model is told.
          if (direction?.territoryTempo > 0) {
            const tempo = applyTerritoryTempo(candidate?.events, { ceilingPerMonth: direction.territoryTempo, spanDays });
            if (tempo.withheld > 0) {
              candidate.events = tempo.events;
              noteReceipt(
                draft,
                "withheld",
                `${tempo.withheld} territorial change${tempo.withheld === 1 ? " was" : "s were"} withheld: this scenario's map moves no faster than ${Math.round(direction.territoryTempo)} region${Math.round(direction.territoryTempo) === 1 ? "" : "s"} per thirty days (${tempo.allowance} this period), counted in event order. `
                  + "Carry the rest of that advance into the next period, or write the front as holding.",
              );
            }
          }
          // The author's scripted events (worldDirection.js): one the answer left
          // out is written by the engine, in the author's words, and the model is
          // told so it carries the consequences. An auto jump that stopped short
          // owes only the beats up to where it stopped.
          if (scriptedBeats.length) {
            const stopKey = mode === "auto" ? dateKey(candidate?.stopDate) : null;
            const due = stopKey === null ? scriptedBeats : scriptedBeats.filter((beat) => dateKey(beat.date) <= stopKey);
            const scripted = ensureScriptedEvents(candidate?.events, due);
            if (scripted.inserted.length) {
              candidate.events = scripted.events;
              sortTimelineEventsChronologically(candidate);
              for (const beat of scripted.inserted) {
                noteReceipt(draft, "adjusted", `The scripted event of ${beat.date} — "${beat.title}" — was not in your answer, so the engine wrote it in the author's words, with no impacts. It is history in this world: its consequences are yours to carry forward.`);
              }
            }
          }
          // The war ledger must see the sanitized impacts, so world changes go first.
          const worldChangeError = await validateGeneratedWorldChanges(candidate, bundle.world, {
            strictTransfers: strict,
            receipt: draft,
            requests: state.requests,
            playerCountry: bundle.game.country,
            actions: bundle.actions,
          });
          if (worldChangeError) return worldChangeError;
          const ledgerError = validateSegmentLedgers(candidate, { world: ledgerWorld, strict, segmentIndex, receipt: draft });
          if (ledgerError) return ledgerError;
          return validateSegmentStorylines(candidate, {
            world: ledgerWorld,
            analysis: worldInitiative.analysis,
            strict,
            finalAttempt,
            originDate: state.segmentOrigin,
            targetDate: segmentTarget,
            gameCountry: bundle.game.country,
            board: normalizeArray(bundle.world?.projects),
          });
        }, {
          onAccepted: (draft) => { segmentDraft = draft; },
          onRejected: (complaint) => { segmentComplaints.push(complaint); },
        }),
        variables: segmentVariables,
      });

      // Only now is the answer taken, so only now does its draft count.
      if (segmentGeneration?.source !== "fallback") {
        mergeReceipts(state.receipt, segmentDraft);
        for (const complaint of segmentComplaints.slice(0, 2)) {
          noteReceipt(state.receipt, "redone", firstComplaintLine(complaint));
        }
        // What the schema could not accept and the task runner cut out rather
        // than ask again (schemaSalvage.js): the model wrote it and it is gone.
        for (const removal of normalizeArray(removedFromSegment)) {
          noteReceipt(state.receipt, "dropped", describeSchemaRemoval(removal));
        }
      }

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
      // What this segment asked the model to move, for the skip's one motion
      // repair pass. Recorded only with the committed segment, so a failed
      // attempt's selection never lingers into its retry.
      state.attentionStorylines = mergeSkipAttentionStorylines(
        state.attentionStorylines,
        worldInitiative.analysis?.attentionStorylines,
      );
      state.ledgerWorld = advanceLedgerWorld(ledgerWorld, payload, {
        stopDate: normalizeString(payload?.stopDate) || segmentTarget,
        round: (bundle.game.round || 1) + 1,
      });
      state.generatedSoFar.push(...normalizeArray(payload?.events));
      // The segment is in: its raw preview gives way to the events actually taken.
      showEvents?.([]);
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

    // The request fits no model the player has (contextWindow.js): canned events
    // would hide that, skip after skip. The turn refuses instead, with the
    // message that says which model to pick. Nothing was written.
    if (error?.providerFailure?.kind === "tooBig" && segmentCount <= 1) {
      logDebugEvent("warn", "[turn] The jump was refused: the request fits no model in the Fallback list. Nothing was written.", { reason });
      throw error;
    }

    // A single call reaching here has already exhausted its own fallback, so there
    // is no other segment to keep and nothing to retry piecemeal: it falls back
    // for the whole period exactly as it always did.
    if (segmentCount <= 1) {
      console.warn(`[ai] the jump failed (${reason}) — falling back for the whole period.`);
      logDebugEvent("warn", "[turn] The jump failed; it falls back.", { reason });
      state.segmentPayloads.length = 0;
      const canned = await fallbackJumpSimulation({ bundle, days: dateStep || 1, mode, targetDate });
      state.segmentPayloads.push(canned);
      showEvents?.(normalizeArray(canned?.events));
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
    setPendingJumpSegment({ context, state });
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

  // Every segment is in hand. A selected storyline the skip left objectively
  // stale, or never updated, gets one small targeted repair call — judged once
  // for the whole skip, never per segment; a failed repair leaves it overdue.
  // Outside the try on purpose: nothing here may hold the turn as a failed
  // segment, and a repair never throws except on the player's Cancel.
  await repairSkipStorylineMotion({ context, state, signal });
};

// ---- What a time skip spends ---------------------------------------------------
//
// Every request a skip makes is asked of the skip's budget first and counted on
// the way back (requestBudget.js). While requests are being saved the budget is
// real — one request where it can be, never more than the cap — and the checks
// after the skip go out together as the turn review below. With saving switched
// off the budget grants everything, and the skip runs exactly as it always did.
const createJumpRequests = ({ segments = 1, reserveInstitutionBallot = false } = {}) => {
  const saving = savingRequests();
  const budget = createJumpBudget({ cap: jumpRequestCap({ segments }), unlimited: !saving });
  if (saving && reserveInstitutionBallot) budget.reserve("institutionBallots", 1);
  return {
    saving,
    budget,
    used: 0,
    refused: 0,
  };
};

const jumpTaskOptions = (requests, spender) => (requests ? {
  budget: requests.budget,
  spender,
  onRequest: (status) => {
    if (status >= 200 && status < 300) requests.used += 1;
    else if (status === 429) requests.refused += 1;
  },
} : {});

// Told to the ledger (the time panel shows it) and to the turn log.
const reportJumpRequests = (requests) => {
  if (!requests) return;
  try {
    requestLedger.noteJump({ used: requests.used, refused: requests.refused });
  } catch { /* a count is never worth a turn */ }
  const skipped = requests.budget.skipped;
  logDebugEvent("turn", `This time skip used ${requests.used} request${requests.used === 1 ? "" : "s"}`
    + `${requests.refused ? ` (and was refused ${requests.refused} time${requests.refused === 1 ? "" : "s"} by a rate limit)` : ""}`
    + `${skipped.length ? `; left out to stay inside ${requests.budget.cap}: ${skipped.join(", ")}` : ""}.`, {
    saving: requests.saving,
    spends: requests.budget.log,
  });
};

// ---- The turn review -------------------------------------------------------------
//
// The checks a skip gets after it is written — units, territory, timeline, the
// Projects board, the agents' reports — as ONE request instead of one each
// (turnReview.js says how several jobs share a prompt safely). Only while requests
// are being saved; otherwise each check makes its own request, as before.
//
// Nothing here decides what a check DOES. Each job is built from the input its
// own native director would have sent (buildUnitDirectorInput and the rest), its
// part of the answer is validated by its own schema, and then it is handed to
// that same director in place of the request it would have made. A part that is
// missing or malformed is that director's ordinary "analysis unavailable" case.
//
// Whether to ask at all is decided first, natively, per check:
//   units / territory  the director found events it would ask about;
//   timeline           some candidate could actually be removed (candidatesWorthJudging);
//   board              an event concerns an entry, or the calendar is due (boardPassReasons);
//   agents             a report has gone AGENT_REPORT_EVERY_ROUNDS rounds unrefreshed.
// No reason from any of them means no request: the skip cost one. When there IS
// a reason, every enabled check with something to look at rides along — it is
// the same request either way.
const UNIT_DIRECTOR_INSTRUCTION =
  "Reconcile EVERY supplied military event against the existing persistent units. When an event clearly changes an identifiable supplied formation's location, posture, strength or existence, emit the matching unit operation; do not leave that event untouched. "
  // Said here as well as in the rules: a live run wrote "HMS Dauntless
  // Commissioned at Portsmouth" and "No. 12 Squadron Stands Up at RAF
  // Lossiemouth" and returned no ops at all for either, because the wording
  // that makes a ship or a squadron a NEW formation sat only in the system
  // prompt. It is the last thing the model reads before answering.
  + "A ship, submarine or squadron COMMISSIONED, delivered, stood up or entering service is a new formation that does not exist yet: spawn it for the power that commissioned it, at its named port or base, even when that power already has units. "
  + "No ops is valid only when the event has no material persistent-unit consequence. Prefer `at` with the event's named destination instead of guessing coordinates. Return JSON only.";
const TERRITORY_DIRECTOR_INSTRUCTION =
  "Reconcile the supplied events with de-facto territorial control. Add only control/contest/clear operations that the event itself supports; never invent a legal sovereignty transfer. Return JSON only.";
const TIMELINE_CURATOR_INSTRUCTION =
  "Analyze every supplied native timeline candidate with the required curator tool. Return exactly one judgment for every candidate index.";

const unitDirectorUnavailable = () => ({ eventOrders: [], summary: "Unit director unavailable; existing simulator unitOps preserved." });

// The director's orders may say where in words too. Placed here, before the
// director's own rules measure the move, because those rules read coordinates.
const placeDirectorOrders = async (payload, world, events) => {
  const orders = normalizeArray(payload?.eventOrders);
  if (!orders.length) return payload;
  const containers = orders.map((order, index) => ({
    event: normalizeArray(events)[Number(order?.eventIndex)] ?? null,
    impacts: { unitOps: normalizeArray(order?.unitOps) },
    path: `$.eventOrders[${index}]`,
  }));
  try {
    await resolvePlacements(containers, world, { receipt: null });
  } catch (error) {
    console.warn("[unit director] the orders' places could not be resolved; the orders stand as written.", error);
  }
  return payload;
};
const territoryDirectorUnavailable = () => ({
  eventOrders: [],
  summary: "Territory director unavailable; existing legal/control impacts preserved.",
});

const STRUCTURE_DIRECTOR_INSTRUCTION =
  "Put on the map the physical structures the supplied events built, opened or completed, placed with `at` where each event says it is. Return no structures when none of them built anything. Return JSON only.";
const structureDirectorUnavailable = () => ({ eventOrders: [], summary: "Structure director unavailable; no structures added." });

const structureDirectorVariables = (input, game) => ({
  structureDirectorCandidates: JSON.stringify(input.candidates, null, 2),
  structureDirectorStructures: input.structures.length ? JSON.stringify(input.structures, null, 2) : "None yet.",
  structureDirectorProjects: input.projects.length ? JSON.stringify(input.projects, null, 2) : "None.",
  structureDirectorGameDate: normalizeString(game?.gameDate),
  structureDirectorBudget: String(input.budget),
});

// Same as the unit director's: every `at` becomes coordinates before the
// director's rules, which need a point, look at the structures.
const placeStructureOrders = async (payload, world, events) => {
  const orders = normalizeArray(payload?.eventOrders);
  if (!orders.length) return payload;
  const containers = orders.map((order, index) => ({
    event: normalizeArray(events)[Number(order?.eventIndex)] ?? null,
    impacts: { markerOps: normalizeArray(order?.structures).map((marker) => ({ op: "build", marker })) },
    path: `$.eventOrders[${index}]`,
  }));
  try {
    await resolvePlacements(containers, world, { receipt: null });
  } catch (error) {
    console.warn("[structure director] the structures' places could not be resolved; they stand as written.", error);
  }
  return payload;
};
// Every candidate kept: what the curator does with no analyst.
const curatorUnavailable = (candidates) => ({
  judgments: normalizeArray(candidates).map((event, index) => ({
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
});

// An agent's report rides along on any review; by itself it asks for one only
// when it has gone this many rounds without being refreshed.
const AGENT_REPORT_EVERY_ROUNDS = 3;

const unitDirectorVariables = (input, game) => ({
  unitDirectorCandidates: JSON.stringify(input.candidates, null, 2),
  unitDirectorUnits: JSON.stringify(input.units, null, 2),
  unitDirectorGameDate: normalizeString(game?.gameDate),
  unitDirectorRound: String(game?.round || 1),
});

const territoryDirectorVariables = async (input, world) => ({
  territoryDirectorCandidates: JSON.stringify(input.candidates, null, 2),
  // Compact on purpose, and already cut down to the occupied and disputed
  // regions plus the places the events name (nativeTerritoryDirector.js).
  territoryDirectorState: JSON.stringify(input.territorialState),
  territorialControlContext: await buildTerritorialControlContext(world),
});

const curatorVariables = (input) => ({
  curatorPriorHistory: JSON.stringify(input.priorHistory, null, 2),
  curatorCandidates: JSON.stringify(input.candidates, null, 2),
});

// The events a skip wrote, as the rest of the turn will first see them: shaped,
// and with word-for-word repeats of the record taken out. Pure, so doing it here
// for the review and again in applySimulationResult gives the same list.
const reviewCandidateEvents = (merged, bundle, generation) => dedupeGeneratedEvents(
  normalizeEvents(bundle.events),
  normalizeArray(merged.events)
    .map((entry, index) => normalizeGeneratedEvent({ ...entry, source: entry?.source || generation?.source || "ai" }, index))
    .filter(Boolean),
);

const boardEventList = (events, hidden) => [
  ...events.map((event, index) => `[${index}] ${event.date || "undated"} — ${event.title}\n${event.description}`),
  ...hidden.map((event, index) =>
    `[${events.length + index}] ${event.date || "undated"} — ${event.title} (kept off the timeline)\n${event.description}`),
].join("\n\n");

// Every running entry needs dates to be paced against: Player focus asks the
// skip to answer a milestone whose date it passes (playerFocus.js), and an entry
// with no milestones at all can never come due.
const BOARD_MILESTONE_NOTE = " Any running entry with no milestones at all gets two or three dated checkpoints on its way to its target date, so its progress has something to be measured against; a standing effort with no end (an agent in place, a permanent patrol) gets none.";

const BOARD_HIDDEN_NOTE = "\n\nEvents marked (kept off the timeline) happened, but were too routine to show the player as a card. "
  + "Move the board from them exactly like any other event, and write lastUpdate so it stands on its own "
  + "without pointing at a timeline entry.";

const runTurnReview = async ({ context, merged, signal, state }) => {
  const { bundle, mode } = context;
  const requests = state.requests;
  const review = { asked: false, parts: {}, reasons: [], boardShownEvents: [], agentReports: [] };
  // A canned turn means the model is not answering; asking it to check one would
  // cost a request to learn that again.
  if (normalizeString(state.generation?.source) === "fallback") return review;

  const wants = (section) => requestSettings.reviewSection(section);
  const round = (Number(bundle.game?.round) || 1) + 1;
  const stopDate = normalizeString(merged.stopDate) || context.targetDate;
  const playerCountry = normalizeString(bundle.game?.country);
  const candidates = reviewCandidateEvents(merged, bundle, state.generation);
  const reasons = [];
  const jobs = [];
  const sharedBlocks = [];
  const addJob = async (job, variables) => {
    const { systemPrompt } = await buildTaskSystemPrompt(job.taskKey, { variables, lookups: null, reminders: false });
    jobs.push({ ...job, prompt: systemPrompt, schema: getGameplayTool(job.taskKey)?.schema });
    for (const value of Object.values(variables ?? {})) if (typeof value === "string") sharedBlocks.push(value);
  };

  // --- units ---
  const unitInput = wants("units") ? buildUnitDirectorInput({ events: merged.events, world: bundle.world }) : null;
  if (unitInput) {
    reasons.push(`${unitInput.candidates.length} military event(s) may move units`);
    await addJob({ key: "units", taskKey: "unitDirector", title: "move the units", instruction: UNIT_DIRECTOR_INSTRUCTION },
      unitDirectorVariables(unitInput, bundle.game));
  }

  // --- territory ---
  const territoryInput = wants("territory")
    ? await buildTerritoryDirectorInput({ events: merged.events, world: bundle.world, findPlaces: placeReaderFor(bundle) })
    : null;
  if (territoryInput) {
    reasons.push(`${territoryInput.candidates.length} event(s) may change who holds land`);
    await addJob({ key: "territory", taskKey: "territoryDirector", title: "occupied and disputed land", instruction: TERRITORY_DIRECTOR_INSTRUCTION },
      await territoryDirectorVariables(territoryInput, bundle.world));
  }

  // --- structures ---
  const structureInput = wants("structures")
    ? buildStructureDirectorInput({ events: merged.events, world: bundle.world, playerCountry })
    : null;
  if (structureInput) {
    reasons.push(`${structureInput.candidates.length} event(s) may have built something`);
    await addJob({ key: "structures", taskKey: "structureDirector", title: "new structures", instruction: STRUCTURE_DIRECTOR_INSTRUCTION },
      structureDirectorVariables(structureInput, { ...bundle.game, gameDate: stopDate }));
  }

  // --- timeline ---
  const priorEvents = normalizeEvents(bundle.events);
  const curatorInput = wants("timeline") ? buildCuratorInput({ events: candidates, priorEvents, mode }) : null;
  const worthJudging = curatorInput ? candidatesWorthJudging({ events: candidates, priorEvents, mode }) : [];
  if (worthJudging.length) reasons.push(`${worthJudging.length} event(s) may repeat the record or be filler`);

  // --- board ---
  const board = normalizeArray(bundle.world?.projects);
  const segmentHidden = normalizeArray(state.hiddenEvents)
    .map((entry, index) => normalizeGeneratedEvent(entry, index))
    .filter(Boolean);

  // A narrated outcome with no actionId is not safe to settle natively by text,
  // but it is cheap to repair semantically while this combined review request
  // is already available. The plan exposes only exact current ids + numbered
  // retained candidates; native code validates the returned pairings again.
  const actionOutcomePlan = merged.clearActions === false ? null : buildActionOutcomeAssociationPlan({
    actions: bundle.actions,
    events: candidates,
  });
  review.actionOutcomePlan = actionOutcomePlan;
  if (actionOutcomePlan) reasons.push(`${actionOutcomePlan.pendingActions.length} queued order(s) need exact outcome attribution`);

  const boardHasWork = wants("board") && board.length > 0 && (candidates.length > 0 || segmentHidden.length > 0);
  let pendingDoubts = [];
  if (boardHasWork) {
    const gathered = await readInterceptsState({ force: false }).catch(() => ({}));
    pendingDoubts = doubtedAwaitingFreshSource(normalizeSpies(bundle.world?.spies), board, {
      playerPolity: playerCountry,
      intercepts: normalizeIntercepts(gathered),
    });
    const boardReasons = boardPassReasons({
      board,
      events: [...candidates, ...segmentHidden],
      gameDate: stopDate,
      round,
      reviewedRound: normalizeWorldState(bundle.world).boardReviewedRound,
      playerCountry,
    });
    if (pendingDoubts.length) boardReasons.push(`${pendingDoubts.length} doubted entr${pendingDoubts.length === 1 ? "y" : "ies"} can now be settled`);
    if (boardReasons.length) reasons.push(`the Projects board: ${boardReasons.slice(0, 3).join("; ")}${boardReasons.length > 3 ? `; and ${boardReasons.length - 3} more` : ""}`);
  }

  // --- agents ---
  const agents = wants("spies") && isActiveFeatureEnabled("espionage")
    ? activeSpies(normalizeWorldState(bundle.world), playerCountry)
    : [];
  if (agents.length) {
    // An agent asks for a review of its own in two cases only, and both are
    // bounded by the calendar rather than by whether the last attempt worked — a
    // report that keeps failing must not buy a request every skip:
    //   - it was placed since the last skip and has never reported (once);
    //   - its report is AGENT_REPORT_EVERY_ROUNDS rounds old, and this is one of
    //     the rounds reports are collected on.
    // Every other skip it simply rides along when something else asks.
    const filed = normalizeIntercepts(await readInterceptsState({ force: false }).catch(() => ({})));
    const originDate = normalizeString(bundle.game?.gameDate);
    const collectionRound = round % AGENT_REPORT_EVERY_ROUNDS === 0;
    const justPlaced = agents.filter((spy) => !filed?.[spy.target]
      && normalizeString(spy.deployedAt) && originDate && compareGameDates(spy.deployedAt, originDate) >= 0);
    const overdue = collectionRound
      ? agents.filter((spy) => {
        const last = Number(filed?.[spy.target]?.round);
        return !Number.isFinite(last) || last > round || round - 1 - last >= AGENT_REPORT_EVERY_ROUNDS;
      })
      : [];
    if (justPlaced.length) reasons.push(`${justPlaced.length} newly placed agent(s) have not reported yet`);
    else if (overdue.length) reasons.push(`${overdue.length} agent report(s) are ${AGENT_REPORT_EVERY_ROUNDS}+ rounds old`);
  }

  review.reasons = reasons;
  if (!reasons.length) {
    logDebugEvent("turn", "Turn review not needed: nothing to move, mark, tidy or report.", undefined, { verbose: true });
    return review;
  }

  // There is a reason to ask, so everything with something to look at rides along.
  if (actionOutcomePlan) {
    jobs.push({
      key: "actions",
      title: "queued order outcomes",
      prompt: actionOutcomePlan.prompt,
      instruction: `Return only exact associations supported by the candidate events. Empty is correct when none qualify.`,
      schema: ACTION_OUTCOME_ASSOCIATION_SCHEMA,
      actionOutcome: true,
    });
  }
  if (curatorInput) {
    await addJob({ key: "timeline", taskKey: "timelineCurator", title: "repeats and filler", instruction: TIMELINE_CURATOR_INSTRUCTION },
      curatorVariables(curatorInput));
  }
  if (boardHasWork) {
    const boardBundle = { ...bundle, game: { ...bundle.game, gameDate: stopDate, round } };
    const doubtBlock = pendingDoubts.length
      ? `\n\nThese doubted entries can now be settled — a fresh agent is in place:\n${describeDoubtedForPrompt(pendingDoubts)}`
      : "";
    review.boardShownEvents = [...candidates, ...segmentHidden];
    await addJob({
      key: "board",
      taskKey: "projects",
      title: "the Projects board",
      instruction: `These events have just been simulated. Move the board to match them, and return `
        + `{"projectOps":[]} if nothing on it genuinely moved.${BOARD_MILESTONE_NOTE}${segmentHidden.length ? BOARD_HIDDEN_NOTE : ""}\n\n`
        + `${boardEventList(candidates, segmentHidden)}${doubtBlock}`,
    }, await buildTemplateVariables(boardBundle, { taskKey: "projects" }));
  }
  if (agents.length) {
    // The world the agents report from is the one this skip wrote.
    const agentBundle = {
      ...bundle,
      events: normalizeEvents([...priorEvents, ...candidates]),
      game: { ...bundle.game, gameDate: stopDate, round },
    };
    const sharedVariables = await buildTemplateVariables(agentBundle, { taskKey: "spyIntercept" });
    for (const [index, spy] of agents.entries()) {
      const prepared = await prepareSpyReport(agentBundle, spy, { sharedVariables });
      const key = `agent_${index + 1}`;
      review.agentReports.push({ key, spy, bundle: agentBundle });
      await addJob({ key, taskKey: "spyIntercept", title: `the agent in ${prepared.name}`, instruction: prepared.userMessage }, prepared.variables);
    }
  }

  const usable = jobs.filter((job) => job.schema);
  if (!usable.length || !requests.budget.take("review")) {
    if (usable.length) logDebugEvent("turn", `Turn review not made: this time skip has used its ${requests.budget.cap} requests.`, { reasons });
    return review;
  }

  const { jobs: shared, savedChars } = shareRepeatedBlocks(usable, sharedBlocks);
  // The Game Master's reminders once for the whole request, not once per job.
  const systemPrompt = [buildTurnReviewPrompt(shared), await gmRemindersBlock()].filter(Boolean).join("\n\n");
  const tool = buildTurnReviewTool(shared);
  review.asked = true;
  // The panel says what this one request is doing, by the jobs it carries.
  state.phases?.enter("checking", { label: describeReviewJobs(shared.map((job) => job.key)) });
  logDebugEvent("turn", `Turn review: ${shared.map((job) => job.key).join(", ")} in one request.`, {
    reasons,
    promptChars: systemPrompt.length,
    sharedTextSavedChars: savedChars,
  });

  // The same silence deadline every task gets ("Limit AI generation"), and the
  // player's Cancel. One request, no second try: a review that fails leaves the
  // turn exactly as the simulator wrote it, which is a whole turn.
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  const idleMs = taskIdleTimeoutMs();
  const idle = createIdleDeadline(
    { idleMs, firstByteMs: idleMs ? AI_FIRST_BYTE_TIMEOUT_MS : 0 },
    () => controller.abort(new Error("The turn review timed out: the model stopped answering.")),
  );
  let answer = null;
  try {
    idle.start();
    const response = await callAI(systemPrompt, [{
      role: "user",
      parts: [{ text: `Do the ${shared.length === 1 ? "job" : `${shared.length} jobs`} above and call ${tool.name} once, with every field filled.` }],
    }], {
      deadline: idle.deadline,
      onActivity: idle.note,
      signal: controller.signal,
      tool,
      logLabel: `task "${TURN_REVIEW_TASK}"`,
      taskKey: TURN_REVIEW_TASK,
      __debug: { taskKey: TURN_REVIEW_TASK, attempt: 1, maxAttempts: 1, simulatedDays: null },
      onRequest: jumpTaskOptions(requests, "review").onRequest,
    });
    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    answer = response?.toolInput ?? unwrapMimickedToolCall(extractJsonPayload(rawText), tool.name);
  } catch (error) {
    if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new DOMException("Timeline jump cancelled.", "AbortError"));
    logDebugEvent("turn", "Turn review failed; every check falls back to leaving the turn as written.", error, { problem: true });
    return review;
  } finally {
    idle.cancel();
  }

  // Each part is judged by its own job's schema, and repaired the way that job's
  // own answer would have been (schemaSalvage.js). One bad part costs only itself.
  const parts = readTurnReviewAnswer(shared, answer);
  for (const job of shared) {
    const part = parts[job.key];
    if (!part) {
      logDebugEvent("turn", `Turn review: no usable "${job.key}" part; that check leaves the turn as written.`, undefined, { problem: true });
      continue;
    }
    if (job.actionOutcome) {
      const normalized = normalizeActionOutcomeAssociationAnswer(part, actionOutcomePlan);
      if (normalized.removed) {
        logDebugEvent("turn", `Turn review: ${normalized.removed} invalid queued-order association(s) were ignored; only exact current action ids and candidate indexes are accepted.`, undefined, { verbose: true });
      }
      review.parts[job.key] = { associations: normalized.associations };
      continue;
    }
    const normalized = normalizeGameplayPayload(job.taskKey, part);
    const salvaged = salvageBySchema(normalized, (candidate) => validateGameplayPayload(job.taskKey, candidate));
    if (!salvaged.valid) {
      logDebugEvent("turn", `Turn review: the "${job.key}" part was rejected (${salvaged.error}); that check leaves the turn as written.`, undefined, { problem: true });
      continue;
    }
    if (salvaged.removed.length) {
      logDebugEvent("turn", `Turn review: ${salvaged.removed.length} malformed piece(s) left out of the "${job.key}" part.`, salvaged.removed.map(describeSchemaRemoval), { verbose: true });
    }
    review.parts[job.key] = salvaged.value;
  }
  return review;
};

// With request-saving OFF the legacy directors still make their own calls, so
// there is no combined turn-review request to piggyback on. Outcome attribution
// gets one bounded request of its own only when a current order lacks a citation
// and there are retained candidate events that might answer it. Failure is
// deliberately fail-open: settleOrders will keep the order overdue.
const runStandaloneActionOutcomeReview = async ({ context, merged, signal, state }) => {
  if (normalizeString(state.generation?.source) === "fallback") return null;
  const candidates = reviewCandidateEvents(merged, context.bundle, state.generation);
  const plan = merged.clearActions === false
    ? null
    : buildActionOutcomeAssociationPlan({ actions: context.bundle.actions, events: candidates });
  if (!plan) return null;
  if (!state.requests?.budget?.take("review")) return { plan, answer: null };

  const tool = {
    name: ACTION_OUTCOME_ASSOCIATION_TOOL,
    description: "Link current queued player orders to the retained candidate events that genuinely give them an outcome.",
    schema: ACTION_OUTCOME_ASSOCIATION_SCHEMA,
  };
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  const idleMs = taskIdleTimeoutMs();
  const idle = createIdleDeadline(
    { idleMs, firstByteMs: idleMs ? AI_FIRST_BYTE_TIMEOUT_MS : 0 },
    () => controller.abort(new Error("Queued-order outcome attribution timed out: the model stopped answering.")),
  );
  state.phases?.enter("checking", { label: "queued order outcomes" });
  logDebugEvent("turn", `Queued-order outcome attribution: ${plan.pendingActions.length} order(s), ${plan.candidates.length} candidate event(s).`, undefined, { verbose: true });

  try {
    idle.start();
    const response = await callAI(plan.prompt, [{
      role: "user",
      parts: [{ text: `Check the exact queued orders against the numbered candidate events and call ${tool.name} once.` }],
    }], {
      deadline: idle.deadline,
      onActivity: idle.note,
      signal: controller.signal,
      tool,
      logLabel: `task "${TURN_REVIEW_TASK}:actions"`,
      taskKey: TURN_REVIEW_TASK,
      __debug: { taskKey: TURN_REVIEW_TASK, attempt: 1, maxAttempts: 1, simulatedDays: null },
      onRequest: jumpTaskOptions(state.requests, "review").onRequest,
    });
    const rawText = typeof response === "string" ? response : normalizeString(response?.rawText);
    const raw = response?.toolInput ?? unwrapMimickedToolCall(extractJsonPayload(rawText), tool.name);
    const normalized = normalizeActionOutcomeAssociationAnswer(raw, plan);
    if (normalized.removed) {
      logDebugEvent("turn", `Queued-order outcome attribution ignored ${normalized.removed} invalid association(s).`, undefined, { verbose: true });
    }
    return { plan, answer: { associations: normalized.associations } };
  } catch (error) {
    if (signal?.aborted) throw (signal.reason instanceof Error ? signal.reason : new DOMException("Timeline jump cancelled.", "AbortError"));
    logDebugEvent("turn", "Queued-order outcome attribution failed; unanswered orders remain queued.", error, { problem: true });
    return { plan, answer: null };
  } finally {
    idle.cancel();
  }
};

// The agents' reports the review carried, filed once the turn is written — and
// only for agents who are still in place after it: one caught this turn did not
// get a report out.
const fileReviewedAgentReports = async (review) => {
  if (!review?.agentReports?.length) return;
  let world;
  try {
    world = normalizeWorldState(await readWorldState({ force: true }));
  } catch {
    return;
  }
  const player = normalizeString((await readGameData()).country);
  const stillActive = new Set(activeSpies(world, player).map((spy) => spy.target));
  for (const { key, spy, bundle } of review.agentReports) {
    const payload = review.parts[key];
    if (!payload || !stillActive.has(spy.target)) continue;
    try {
      await storeSpyReport({ ...bundle, world }, spy, payload);
    } catch (error) {
      console.warn(`[spycraft] the report from ${spy.target} could not be filed:`, error?.message || error);
    }
  }
};

// Merge the segments into the one round the player asked for and write it.
// Shared by the first attempt and by a retry that finished the held segments, so
// there is only ever one way a jump lands.
const finishTimelineJump = async ({ context, signal, state }) => {
  const { baseColors, bundle, mode, targetDate } = context;
  // Every segment is in hand, so there is no longer a jump to resume.
  setPendingJumpSegment(null);

  // One round out of every segment. applySimulationResult advances the round
  // exactly once, and the dedupeGeneratedEvents pass inside it already collapses
  // repeats WITHIN the batch as well as against the existing log, so a later
  // segment restating an earlier one cannot reach the timeline.
  const merged = mergeSegmentPayloads(state.segmentPayloads, { targetDate });

  // While requests are being saved, every check below is answered by ONE request
  // made here (runTurnReview) — or by none, when nothing needs checking. Each
  // director then runs exactly as it always has, with its part of that answer in
  // place of the request it would have made. `review` is null when saving is off,
  // and each check makes its own request as before.
  const review = state.requests?.saving ? await runTurnReview({ context, merged, signal, state }) : null;

  // A current order whose outcome event omitted actionIds gets one bounded
  // semantic association pass. Saving mode piggybacks on the combined review;
  // legacy/non-saving mode asks only when needed. Native application accepts
  // exact ids/indexes only, then the normal curator sees the repaired actionIds
  // and protects a genuine order outcome from filler removal.
  const standaloneActionReview = review ? null : await runStandaloneActionOutcomeReview({ context, merged, signal, state });
  const actionPlan = review?.actionOutcomePlan ?? standaloneActionReview?.plan ?? null;
  const actionAnswer = review?.parts?.actions ?? standaloneActionReview?.answer ?? null;
  if (actionPlan && actionAnswer) {
    const repaired = applyActionOutcomeAssociations({ events: merged.events, plan: actionPlan, answer: actionAnswer });
    merged.events = repaired.events;
    if (repaired.applied.length) {
      logDebugEvent("turn", `Restored exact actionId attribution on ${repaired.applied.length} queued order outcome${repaired.applied.length === 1 ? "" : "s"}.`, repaired.applied, { verbose: true });
    }
  }

  // The surviving military events then make the persistent order of battle
  // move: the unit director proposes ops for existing units, native rules keep
  // only the plausible ones, and they ride the same application path as the
  // simulator's own unitOps (a long move becomes a standing order). A failed or
  // unavailable director never costs the turn — the events pass through as written.
  state.phases?.enter("placing");
  let directedEvents = merged.events;
  try {
    directedEvents = await directGeneratedUnitOps({
      events: merged.events,
      game: bundle.game,
      world: bundle.world,
      analyzeBatch: review
        ? async () => ({ payload: await placeDirectorOrders(review.parts.units ?? unitDirectorUnavailable(), bundle.world, merged.events), generation: { source: review.parts.units ? "ai" : "fallback" } })
        : async (input) => {
          const answer = await runJsonTask("unitDirector", {
            lookups: buildTaskLookups(bundle),
            fallback: unitDirectorUnavailable,
            signal,
            userMessage: UNIT_DIRECTOR_INSTRUCTION,
            variables: unitDirectorVariables(input, bundle.game),
            ...jumpTaskOptions(state.requests, "review"),
          });
          await placeDirectorOrders(answer?.payload, bundle.world, merged.events);
          return answer;
        },
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
      // The places the events name, with who holds each (lookupTools.js
      // placesNamedIn), so the director can fill in fromCode without asking.
      // Not needed when the review already answered: the director never asks.
      findPlaces: review ? null : placeReaderFor(bundle),
      analyzeBatch: review
        ? async () => ({ payload: review.parts.territory ?? territoryDirectorUnavailable(), generation: { source: review.parts.territory ? "ai" : "fallback" } })
        : async (input) =>
          runJsonTask("territoryDirector", {
            lookups: buildTaskLookups(bundle),
            fallback: territoryDirectorUnavailable,
            signal,
            userMessage: TERRITORY_DIRECTOR_INSTRUCTION,
            variables: await territoryDirectorVariables(input, bundle.world),
            ...jumpTaskOptions(state.requests, "review"),
          }),
    });
    const containers = territoryEvents.map((event, index) => ({
      event,
      impacts: event?.impacts,
      path: `$.events[${index}].impacts`,
    }));
    await resolveRegionControlOps(containers, bundle.world, { requests: state.requests });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[OH territory director] pass failed; the simulator's territorial operations stand.", error);
    territoryEvents = directedEvents;
  }

  // Third: the structures the events built (nativeStructureDirector.js), which
  // the simulator almost never puts on the map by itself. Each one that belongs
  // to a Project is linked to it once the turn is written (structureLinks).
  let builtEvents = territoryEvents;
  let structureLinks = [];
  try {
    const built = await directGeneratedStructureOps({
      events: territoryEvents,
      world: bundle.world,
      playerCountry: normalizeString(bundle.game?.country),
      analyzeBatch: review
        ? async () => ({ payload: await placeStructureOrders(review.parts.structures ?? structureDirectorUnavailable(), bundle.world, territoryEvents) })
        : requestSettings.reviewSection("structures")
          ? async (input) => {
            const answer = await runJsonTask("structureDirector", {
              lookups: buildTaskLookups(bundle),
              fallback: structureDirectorUnavailable,
              signal,
              userMessage: STRUCTURE_DIRECTOR_INSTRUCTION,
              variables: structureDirectorVariables(input, { ...bundle.game, gameDate: normalizeString(merged.stopDate) || context.targetDate }),
              ...jumpTaskOptions(state.requests, "review"),
            });
            return { payload: await placeStructureOrders(answer?.payload, bundle.world, territoryEvents) };
          }
          : null,
    });
    builtEvents = built.events;
    structureLinks = built.links;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("[OH structure director] pass failed; the events keep the structures they had.", error);
  }

  const result = {
    clearActions: merged.clearActions,
    events: builtEvents,
    structureLinks,
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
    hiddenEvents: state.hiddenEvents,
    boardProvisionalEventIds: state.boardProvisionalEventIds,
    receipt: state.receipt,
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
  // `review` carries the turn review's answers (null when requests are not being
  // saved) and `requests` the skip's budget, for everything the apply still asks.
  applyArgs.projects = { bundle, signal, review, requests: state.requests };
  applyArgs.phases = state.phases;
  state.phases?.enter("applying");
  try {
    const applied = await applySimulationResult(applyArgs);
    // Formal institution ballots are part of the living world, not a UI-only
    // Council interaction. Let unresolved NPC members vote once the new turn is
    // canonical, even when the player never reopened the institution workspace.
    try {
      await runPostTurnInstitutionBallots({
        playerCountry: applied?.game?.country || bundle.game?.country || "",
        date: applied?.game?.gameDate || targetDate,
        signal,
        expectedGameId: normalizeString(applied?.game?.id || applied?.game?.gameId || bundle.game?.id || bundle.game?.gameId),
        requests: state.requests,
      });
    } catch (error) {
      console.warn("[institution autonomy] post-turn ballot pass failed; the completed turn remains committed.", error);
    }
    reportJumpRequests(state.requests);
    // Where the skip's time and requests went, in one line (skipPhases.js),
    // and on the result for the panel's own log entry.
    const phaseSummary = state.phases?.finish();
    if (phaseSummary?.phases?.length) {
      logDebugEvent("turn", `Time skip phases: ${formatSkipPhases(phaseSummary)}.`, phaseSummary);
    }
    return phaseSummary ? { ...applied, phases: phaseSummary } : applied;
  } catch (error) {
    if (error?.projectsHeld) setPendingProjectsJump({ applyArgs });
    throw error;
  }
};

export const simulateTimelineJump = async ({ days, mode = "jump", onEvents, onProgress, signal } = {}) => {
  // Starting a fresh turn abandons any jump still held on a failed segment. Its
  // state was captured against a world snapshot this one is about to re-read, so
  // applying it later would write a turn built on stale ground.
  discardPendingProjectsJump();
  discardPendingJumpSegment();
  beginSimulation();
  // The skip's phases (skipPhases.js): said to the panel as each starts, timed
  // and counted into one log line when the skip lands. The request count comes
  // from the skip's budget once there is one.
  let budgetForPhases = null;
  const phases = createSkipPhases({ requestsUsed: () => budgetForPhases?.used ?? 0, onChange: onProgress });
  phases.enter("reading");
  try {
  const bundle = withDiplomaticLedgerMigration(await readGameStateBundle({ force: true }));
  const baseColors = await readJson(JSON_URLS.colors, { defaultValue: {}, force: true });
  // Fractional days are allowed so sub-day skips (e.g. 6h = 0.25) work; the game
  // date only advances in whole days, so a sub-day skip keeps the same date.
  const safeDays = Math.max(0, Number(days) || 0);
  if (safeDays <= 0) {
    throw new Error("Choose a time-skip amount greater than zero.");
  }
  // Time stands still while the player is in an interactive event: the scene is
  // a moment, and a skip would leave it half played at a date long gone.
  if (hasSceneInProgress(bundle.world)) {
    throw new Error("An interactive event is in progress: end it or set it aside before skipping time.");
  }
  // One rule for where a skip lands, shared with the timeline's labels
  // (runtime/jumpDates.js), so a label never promises a date the jump misses.
  const dateStep = jumpDayStep(safeDays);
  const originDate = normalizeString(bundle.game.gameDate);
  const targetDate = jumpTargetDate(originDate, safeDays);
  if (dateStep >= 1 && parseIsoDate(originDate) && targetDate === originDate) {
    throw new Error("The requested jump exceeds the supported date range.");
  }
  const variables = await buildTemplateVariables(bundle, {
    lookups: true,
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
  // divide up front. Short enough, or the setting off (the default), is a single call worded and
  // validated exactly as it always was.
  const segmentDays = (getMapSetting(MAP_SETTING_KEYS.chunkLongJumps)
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
    // Canonical events the integrity screen kept off the timeline, and the major
    // events that passed the consequence check only on a Board entry — both for
    // the board pass (applySimulationResult).
    hiddenEvents: [],
    boardProvisionalEventIds: [],
    // Every storyline any segment selected, and what the skip's one motion
    // repair pass may spend (repairSkipStorylineMotion).
    attentionStorylines: [],
    motionRepairBudget: createMotionRepairBudget(),
    // Everything this turn's answer loses or has changed between the model and the
    // world, told to the simulator at the top of the next jump
    // (runtime/applicationReceipt.js). Lives on the state so a held segment's
    // retry carries on filling the same one.
    receipt: createApplicationReceipt(),
    // What this skip may spend and what it has spent (requestBudget.js): one
    // request where it can be, never more than the cap, while requests are
    // being saved.
    requests: createJumpRequests({
      segments: segmentCount,
      reserveInstitutionBallot: collectAutonomousInstitutionBallotWork(bundle.world, bundle.game?.country || "", { maxInstitutions: 1 }).length > 0,
    }),
    phases,
  };
  budgetForPhases = jumpState.requests;

  await runJumpSegments({ context: jumpContext, onEvents, onProgress, signal, state: jumpState });
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
export const retryPendingJumpSegment = async ({ onEvents, onProgress, signal } = {}) => {
  const heldSegment = getPendingJumpSegment();
  if (!heldSegment) throw new Error("There is no jump waiting on a failed segment.");
  const { context, state } = heldSegment;
  beginSimulation();
  try {
    // The player pressed Retry, which is a fresh decision to spend: the segments
    // still to come get a budget of their own, sized to what is left to generate.
    // What the held attempt already spent stays on the count.
    const spentSoFar = state.requests ?? { used: 0, refused: 0 };
    state.requests = {
      ...createJumpRequests({
        segments: Math.max(1, context.segmentDays.length - state.nextSegment),
        reserveInstitutionBallot: collectAutonomousInstitutionBallotWork(context.bundle?.world, context.bundle?.game?.country || "", { maxInstitutions: 1 }).length > 0,
      }),
      used: spentSoFar.used,
      refused: spentSoFar.refused,
    };
    // A retry is timed on its own, and tells the panel that asked for it.
    state.phases = createSkipPhases({ requestsUsed: () => state.requests?.used ?? 0, onChange: onProgress });
    // Re-holds itself on another failure, so the player can retry again or
    // discard — exactly as they could the first time.
    await runJumpSegments({ context, onEvents, onProgress, signal, state });
    return await finishTimelineJump({ context, signal, state });
  } finally {
    endSimulation();
  }
};

export const simulateAutoJump = async ({ days = 365, signal, onEvents, onProgress } = {}) =>
  simulateTimelineJump({ days, mode: "auto", signal, onEvents, onProgress });

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
    // Administrative/state-mutation comparisons must not let map provenance
    // redirect a polity token to some other active actor.
    allowMapRefs: false,
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
      allowMapRefs: false,
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
      allowMapRefs: false,
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

const normalizeGameMasterIsoDate = (value) => normalizeGameDate(value);

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

  for (const match of request.matchAll(/(?<![\d-])(-?\d{1,6})-(\d{2})-(\d{2})\b/g)) {
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
    "politicalActorOps",
    "createdChats",
    "unitOps",
    "markerOps",
    "institutionLifecycleOps",
    "projectOps",
  ]) {
    if (normalizeArray(impacts[field]).length > 0) return true;
  }

  const linked = (entries) => normalizeArray(entries).some((entry) =>
    normalizeArray(entry?.eventIndexes).some((value) => Number(value) === eventIndex));

  return linked(candidate?.countryStatPatches)
    || linked(candidate?.warUpdates)
    || linked(candidate?.relationUpdates)
    || linked(candidate?.agreementUpdates)
    || linked(candidate?.puppetUpdates);
};

const validateGameMasterChronology = (candidate, game) => {
  const currentDate = normalizeGameMasterIsoDate(game?.gameDate || game?.startDate);
  if (!currentDate) return "";

  const events = normalizeArray(candidate?.events);
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const eventDate = normalizeGameMasterIsoDate(events[eventIndex]?.date);
    if (!eventDate || compareGameDates(eventDate, currentDate) <= 0) continue;
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
        allowMapRefs: false,
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
    // Stock/base geography and mapRefs are vocabulary/provenance, not proof that
    // a political actor already exists. GM lifecycle identity must come from the
    // campaign's declared political registry/aliases/lineage only.
    allowStockBase: false,
    allowMapRefs: false,
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

// GM exhaustive territorial scopes are a provider-facing semantic shortcut only.
// The rendered map remains authoritative: the model names immutable base geographies
// once, native code expands them into exact per-region operations, and the ordinary
// territory resolver validates every resulting region before the preview is shown.
const loadGameMasterBaseGeographyCatalog = async (world) => {
  const normalizedWorld = normalizeWorldState(world);
  const renderedRegionsGeojson = await readJson(JSON_URLS.regionsGeojson, {
    defaultValue: null,
    force: true,
    clone: false,
  }).catch(() => null);
  const features = normalizeArray(renderedRegionsGeojson?.features);
  if (features.length) {
    return features.map((feature) => {
      const props = feature?.properties || {};
      const id = normalizeString(props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id);
      const name = normalizeString(props.name ?? props.NAME_1 ?? props.Name ?? props.regionName);
      const countryCode = normalizeString(props.gid0 ?? props.GID_0 ?? props.gid_0 ?? props.countryCode);
      // country is intentionally the immutable/base geography here, NOT the current
      // political owner. Historical maps commonly encode Russia as props.owner while
      // gid0 still says EST/LVA/LTU.
      const country = normalizeString(
        toCountryName(countryCode) ||
        props.baseCountry ||
        props.sourceBaseCountry ||
        props.COUNTRY ||
        props.Country ||
        props.country ||
        "",
      );
      const bakedOwner = normalizeString(
        props.owner ||
        props.currentOwner ||
        props.sovereign ||
        props.COUNTRY ||
        props.Country ||
        props.country ||
        country,
      );
      const currentController = normalizeString(normalizedWorld.regionOwnershipOverrides?.[id]) || bakedOwner;
      const currentSovereign = normalizeString(normalizedWorld.regionSovereigntyOverrides?.[id]) || currentController || bakedOwner;
      if (!id || !name || !country) return null;
      return { id, name, country, countryCode, currentController, currentSovereign };
    }).filter(Boolean);
  }

  // Compatibility fallback for maps without authored regionsGeojson.
  return filterToRenderedRegions(await loadRegionCatalog().catch(() => []), normalizedWorld)
    .map((region) => {
      const id = normalizeString(region?.id);
      const countryCode = normalizeString(region?.countryCode);
      const country = normalizeString(toCountryName(countryCode) || region?.country);
      const bakedOwner = normalizeString(region?.country) || country;
      if (!id || !normalizeString(region?.name) || !country) return null;
      return {
        ...region,
        id,
        country,
        countryCode,
        currentController: normalizeString(normalizedWorld.regionOwnershipOverrides?.[id]) || bakedOwner,
        currentSovereign: normalizeString(normalizedWorld.regionSovereigntyOverrides?.[id]) ||
          normalizeString(normalizedWorld.regionOwnershipOverrides?.[id]) || bakedOwner,
      };
    })
    .filter(Boolean);
};

const renderGameMasterBaseGeographyCatalog = (catalog) => {
  const groups = new Map();
  for (const row of normalizeArray(catalog)) {
    const name = normalizeString(row?.country);
    if (!name) continue;
    const key = regionKey(name);
    const prior = groups.get(key) || { name, code: normalizeString(row?.countryCode), count: 0 };
    prior.count += 1;
    groups.set(key, prior);
  }
  return [...groups.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `- ${entry.name}${entry.code ? ` [${entry.code}]` : ""}: ${entry.count} rendered region(s)`)
    .join("\n") || "No rendered base-geography catalog is available.";
};

const pushUniqueGameMasterTerritoryOp = (list, operation, identity) => {
  if (!Array.isArray(list)) return;
  if (list.some((entry) => identity(entry) === identity(operation))) return;
  list.push(operation);
};

const expandGameMasterTerritorialScopes = async (candidate, {
  world,
  request = "",
  resolvedRegionIdsOnly = false,
  baseGeographyCatalog = null,
} = {}) => {
  // Apply revalidates the exact expanded preview and intentionally carries no
  // provider scope envelope. Do not demand or re-expand semantic scopes there.
  if (resolvedRegionIdsOnly) return "";

  const scopes = normalizeArray(candidate?.territorialScopes);
  if (requestDemandsExhaustiveTerritorialScope(request) && scopes.length === 0) {
    return "The administrator requested an exhaustive territorial set (all/every/entire/whole territory), but territorialScopes is empty. Do not sample representative provinces. Put the complete semantic footprint in territorialScopes using exact rendered base-geography names; native code will expand every region before preview.";
  }
  if (!scopes.length) return "";

  const catalog = Array.isArray(baseGeographyCatalog) && baseGeographyCatalog.length
    ? baseGeographyCatalog
    : await loadGameMasterBaseGeographyCatalog(world);
  if (!catalog.length) return "Cannot resolve territorialScopes because the rendered base-geography catalog is unavailable.";

  const events = normalizeArray(candidate?.events);
  for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex += 1) {
    const scope = scopes[scopeIndex] || {};
    const eventIndex = Number(scope.eventIndex);
    const event = Number.isInteger(eventIndex) ? events[eventIndex] : null;
    if (!event) return `$.territorialScopes[${scopeIndex}].eventIndex does not identify an authored GM event.`;
    const toCode = normalizeString(scope.toCode);
    if (!toCode) return `$.territorialScopes[${scopeIndex}].toCode must not be blank.`;

    const resolved = resolveGameMasterBaseGeographyScope(scope.baseCountries, catalog);
    if (resolved.error) return `$.territorialScopes[${scopeIndex}] ${resolved.error}.`;
    if (!resolved.regions.length) return `$.territorialScopes[${scopeIndex}] resolved to zero rendered regions.`;

    if (!event.impacts || typeof event.impacts !== "object" || Array.isArray(event.impacts)) event.impacts = {};
    const kind = normalizeString(scope.kind).toLowerCase();
    const note = normalizeString(scope.note);

    if (kind === "legal-transfer") {
      if (!Array.isArray(event.impacts.regionTransfers)) event.impacts.regionTransfers = [];
      for (const row of resolved.regions) {
        const fromCode = normalizeString(row.currentSovereign || row.currentController);
        if (regionKey(fromCode) && regionKey(fromCode) === regionKey(toCode)) continue;
        pushUniqueGameMasterTerritoryOp(
          event.impacts.regionTransfers,
          { regionId: row.id, regionName: row.name, fromCode, toCode, note, wholeCountry: false },
          (entry) => `${normalizeString(entry?.regionId)}|${regionKey(entry?.toCode)}`,
        );
      }
    } else if (kind === "control") {
      if (!Array.isArray(event.impacts.regionControlOps)) event.impacts.regionControlOps = [];
      for (const row of resolved.regions) {
        const fromCode = normalizeString(row.currentController || row.currentSovereign);
        if (regionKey(fromCode) && regionKey(fromCode) === regionKey(toCode)) continue;
        pushUniqueGameMasterTerritoryOp(
          event.impacts.regionControlOps,
          { op: "control", regionId: row.id, regionName: row.name, fromCode, toCode, note, wholeCountry: false },
          (entry) => `${normalizeString(entry?.op)}|${normalizeString(entry?.regionId)}|${regionKey(entry?.toCode)}`,
        );
      }
    } else if (kind === "contest") {
      if (!Array.isArray(event.impacts.regionControlOps)) event.impacts.regionControlOps = [];
      for (const row of resolved.regions) {
        const fromCode = normalizeString(row.currentController || row.currentSovereign);
        pushUniqueGameMasterTerritoryOp(
          event.impacts.regionControlOps,
          { op: "contest", regionId: row.id, regionName: row.name, fromCode, actorCode: toCode, note },
          (entry) => `${normalizeString(entry?.op)}|${normalizeString(entry?.regionId)}|${regionKey(entry?.actorCode)}`,
        );
      }
    } else {
      return `$.territorialScopes[${scopeIndex}].kind must be legal-transfer, control or contest.`;
    }

    console.info(
      `[gm territory] expanded exhaustive scope ${resolved.countries.map((entry) => entry.name).join(", ")}: ` +
      `${resolved.regions.length} rendered region(s) as ${kind} -> ${toCode}.`,
    );
  }
  return "";
};

const validateGameMasterPreviewPayload = async (candidate, {
  mode,
  world,
  game,
  request = "",
  resolvedRegionIdsOnly = false,
  baseGeographyCatalog = null,
}) => {
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

  const territorialScopeError = await expandGameMasterTerritorialScopes(candidate, {
    world,
    request,
    resolvedRegionIdsOnly,
    baseGeographyCatalog,
  });
  if (territorialScopeError) return territorialScopeError;

  const breakawaySovereigntyError = validateGameMasterBreakawaySovereignty(candidate);
  if (breakawaySovereigntyError) return breakawaySovereigntyError;

  // Resolve/validate map, unit, marker and chat operations now, while this is
  // still a preview. This may conservatively resolve a grounded place label to
  // an exact map region, but it never writes world state.
  const worldChangeError = await validateGeneratedWorldChanges(candidate, world, {
    strictTransfers: true,
    captureGuard: false,
    resolvedRegionIdsOnly,
    explicitScopeText: resolvedRegionIdsOnly ? "" : request,
    playerCountry: game?.country || "",
    institutionLifecycleAuthority: "admin",
  });
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

  // Subordinations, tried against the live world exactly as Apply will run
  // them: every change must apply, or the preview is refused with the reason.
  // A skip may drop a bad line; the GM may not, because a player who asks for
  // a puppet and silently gets none is the bug this closes.
  const puppetUpdates = bindPuppetUpdatesToEvents(decodePuppetUpdates(candidate.puppetUpdates), normalizedEvents);
  if (puppetUpdates.length && !isActiveFeatureEnabled("puppetStates")) {
    return "[canonical subordination-state] Puppet states are switched off for this game, so no country can be made another's protectorate, puppet or client. Turn the feature back on in the scenario or game editor (Features) if you want this change.";
  }
  if (puppetUpdates.length) {
    const trial = applyPuppetUpdates({
      world,
      updates: puppetUpdates,
      regionCatalog: await regionCatalogForPuppets(puppetUpdates, world),
      events: normalizedEvents,
      stopDate: normalizeString(game?.gameDate || game?.startDate),
      round: Number(game?.round) || 0,
    });
    const [first] = normalizeArray(trial.dropped);
    if (first) return `[canonical subordination-state] puppetUpdates[${first.index}]: ${first.reason}`;
  }

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
        // A contest by the polity that controls the region after this
        // transaction is moot — the apply seam skips it on purpose (a
        // controller cannot claim its own region), most often because the same
        // transaction also transferred the region to that polity. Not a failure.
        const controller = gameMasterCanonicalPolityKey(normalizedWorld.regionOwnershipOverrides?.[regionId], normalizedWorld);
        if (expected && controller && expected === controller) continue;
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
  puppetUpdates: cloneValue(normalizeArray(transaction?.puppetUpdates)),
  diplomaticOutreach: cloneValue(normalizeArray(transaction?.diplomaticOutreach)),
});

// The GM console's transaction in one line of words, for the next skip
// (runtime/gmChanges.js). The audit keeps the whole of it; the skip needs to know
// what was done, and that it was done by decree.
const gameMasterChangeSummary = ({ transaction, summary = "", request = "" }) => {
  const count = (list, one, many) => {
    const total = normalizeArray(list).length;
    return total ? `${total} ${total === 1 ? one : many}` : "";
  };
  const events = normalizeArray(transaction?.events);
  const titles = events.slice(0, 3).map((event) => `"${normalizeString(event?.title) || "untitled"}"`).join(", ");
  const statCountries = [...new Set(normalizeArray(transaction?.countryStatPatches)
    .map((entry) => normalizeString(entry?.country)).filter(Boolean))];
  const impactCount = (field) => events.reduce(
    (sum, event) => sum + normalizeArray(event?.impacts?.[field]).length,
    0,
  );
  const legalTransfers = impactCount("regionTransfers");
  const controlOps = impactCount("regionControlOps");
  const claims = impactCount("regionClaims");
  const politicalOps = impactCount("politicalActorOps");
  const parts = [
    events.length ? `wrote ${events.length === 1 ? "the event" : `${events.length} events`} ${titles}${events.length > 3 ? " and more" : ""} into the record` : "",
    legalTransfers ? `${legalTransfers} legal territorial transfer${legalTransfers === 1 ? "" : "s"}` : "",
    controlOps ? `${controlOps} de-facto control operation${controlOps === 1 ? "" : "s"}` : "",
    claims ? `${claims} territorial claim operation${claims === 1 ? "" : "s"}` : "",
    politicalOps ? `${politicalOps} political-actor operation${politicalOps === 1 ? "" : "s"}` : "",
    statCountries.length ? `set the figures of ${statCountries.join(", ")}` : "",
    count(transaction?.warUpdates, "war record", "war records"),
    count(transaction?.relationUpdates, "relation", "relations"),
    count(transaction?.agreementUpdates, "agreement", "agreements"),
    count(transaction?.puppetUpdates, "subordination", "subordinations"),
    count(transaction?.storylineUpdates, "storyline", "storylines"),
    count(transaction?.diplomaticOutreach, "diplomatic note", "diplomatic notes"),
  ].filter(Boolean);
  const what = normalizeString(summary) || normalizeString(request);
  return `${what ? `${what} — ` : ""}the GM console ${parts.length ? parts.join("; ") : "changed nothing that can be listed"}.`;
};

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
      ["politicalActorOps", "political-actor"],
      ["unitOps", "unit"],
      ["markerOps", "marker"],
      ["institutionLifecycleOps", "institution"],
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
  normalizeArray(transaction?.puppetUpdates).forEach((entry, index) => labels.push(`puppet:${index}:${normalizeString(entry?.op)}:${normalizeString(entry?.overlord)}->${normalizeString(entry?.puppet)}`));
  normalizeArray(transaction?.diplomaticOutreach).forEach((_, index) => labels.push(`outreach:${index}`));
  return labels.filter(Boolean).slice(0, 128);
};

const gameMasterHistoryEntry = ({ transaction, game, eventIds, summary, transactionId }) => {
  const dates = normalizeArray(transaction?.events).map((event) => normalizeString(event?.date)).filter(Boolean).sort();
  const fallbackDate = normalizeString(game?.gameDate || game?.startDate);
  const fromDate = dates[0] || fallbackDate;
  const toDate = dates.at(-1) || fallbackDate;
  return {
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
    return entryDate && itemDate && compareGameDates(entryDate, itemDate) > 0;
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
    const baseGeographyCatalog = await loadGameMasterBaseGeographyCatalog(bundle.world);
    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "gameMaster", gameMasterRequest: request, lookups: true })),
      gameMasterMode: selectedMode,
      gameMasterBaseGeographyCatalog: renderGameMasterBaseGeographyCatalog(baseGeographyCatalog),
    };

    const { generation, payload } = await runJsonTask("gameMaster", {
      lookups: buildTaskLookups(bundle),
      userMessage: `Generate a ${selectedMode} GM transaction preview for the administrator request. Do not apply anything.`,
      validatePayload: (candidate) => validateGameMasterPreviewPayload(candidate, {
        mode: selectedMode,
        world: bundle.world,
        game: bundle.game,
        request,
        baseGeographyCatalog,
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
    const puppetUpdates = bindPuppetUpdatesToEvents(decodePuppetUpdates(payload?.puppetUpdates), events);
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
        puppetUpdates,
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
      resolvedRegionIdsOnly: true,
    });
    if (validationError) throw new Error(`GM transaction is no longer valid: ${validationError}`);
    if (JSON.stringify(candidate) !== candidateBeforeValidation) {
      throw new Error("Current canonical validation would reinterpret this preview. Nothing was applied; regenerate it so the changed operation is visible before approval.");
    }

    const events = normalizeArray(transaction.events).map((event) => cloneValue(event));
    const priorEvents = normalizeEvents(bundle.events);

    // Ordinary turn de-duplication is intentionally prose-based because cheap models
    // tend to restate recent timeline text. GM Apply cannot use that rule: a human-
    // approved correction may reuse the exact same date/title/description while
    // changing canonical effects (for example replacing an earlier buggy one-region
    // transfer with the intended whole-country transfer). Reject only a TRUE
    // canonical duplicate here: same visible content AND same structured effects.
    const seenCanonicalEvents = new Set(priorEvents.map((event) => eventCanonicalKey(event)));
    let duplicateCanonicalEvent = null;
    for (const event of events) {
      const key = eventCanonicalKey(event);
      if (seenCanonicalEvents.has(key)) {
        duplicateCanonicalEvent = event;
        break;
      }
      seenCanonicalEvents.add(key);
    }
    if (duplicateCanonicalEvent) {
      throw new Error(
        `Authored GM event "${normalizeString(duplicateCanonicalEvent?.title) || "Untitled"}" exactly duplicates existing canonical history, including its structured effects. Nothing was applied; regenerate or make the event distinct.`,
      );
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
    // A rename in the transaction (or a record whose display name still differed
    // from its key) re-keys the rest of the campaign too: the game's polity,
    // every chat, the flags and the stock map's baked regions.
    const renamedPolities = normalizeArray(impactMerge.renamedPolities);
    let renamedGame = null;
    let renamedChats = null;
    let flagsBefore = null;
    let renamedFlags = null;
    if (renamedPolities.length) {
      const regions = filterToRenderedRegions(await loadRegionCatalog().catch(() => []), nextWorld);
      let game = bundle.game;
      let allChats = normalizeChats(await readChatsState({ force: true }));
      for (const { from, to } of renamedPolities) {
        nextWorld = expandBakedRegionsForRename(nextWorld, regions, from, to);
        game = renamePolityInGame(game, from, to);
        allChats = renamePolityInChats(allChats, from, to);
      }
      if (game !== bundle.game) renamedGame = game;
      renamedChats = allChats;
      flagsBefore = await getNationFlags({ force: true }).catch(() => ({}));
      renamedFlags = renamedPolities.reduce((flags, { from, to }) => renamePolityInFlags(flags, from, to), flagsBefore);
    }

    // Institution lifecycle operations in a GM-approved event use the same native
    // lifecycle owner as normal simulation, but GM authority may explicitly act
    // for the player's polity because the human approved this exact preview.
    // Keep any lifecycle-created invitation channel inside the same in-memory
    // transaction so the event, institution ledger and chat cannot diverge.
    const lifecycleChatIds = [];
    let lifecycleChats = renamedChats;
    let lifecycleTouchedChats = false;
    for (const event of events) {
      const lifecycleOps = normalizeArray(event?.impacts?.institutionLifecycleOps);
      if (!lifecycleOps.length) continue;
      if (!lifecycleChats) lifecycleChats = normalizeChats(await readChatsState({ force: true }));
      const batch = applyInstitutionLifecycleImpactBatchCore({
        world: nextWorld,
        chats: lifecycleChats,
        playerCountry: (renamedGame || bundle.game)?.country || bundle.game.country,
        date: event.date || bundle.game.gameDate || bundle.game.startDate || "",
        ops: lifecycleOps,
        authority: "admin",
      });
      if (batch.rejected.length) {
        throw new Error(`A previewed institution lifecycle operation failed during Apply: ${normalizeString(batch.rejected[0]?.reason) || "native institution law refused it"}. Nothing was persisted; regenerate the preview.`);
      }
      nextWorld = batch.world;
      event.impacts.institutionLifecycleOps = batch.applied.map((entry) => entry.op);
      const createdIds = new Set(batch.createdChats.map((chat) => normalizeString(chat?.id)).filter(Boolean));
      lifecycleChats = normalizeChats(batch.chats).map((chat) => (
        createdIds.has(normalizeString(chat?.id))
          ? (normalizeChatEntry({ ...chat, revealWith: event.id }) || chat)
          : chat
      ));
      for (const id of createdIds) if (!lifecycleChatIds.includes(id)) lifecycleChatIds.push(id);
      lifecycleTouchedChats = true;
    }
    if (lifecycleTouchedChats) renamedChats = lifecycleChats;

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

    const warUpdatesForApply = normalizeArray(transaction.warUpdates);
    const warMerge = warUpdatesForApply.length
      ? applyWarUpdates({
          world: nextWorld,
          updates: warUpdatesForApply,
          events,
          stopDate: bundle.game.gameDate || bundle.game.startDate || "",
          round: bundle.game.round || 0,
        })
      : { world: nextWorld, appliedIds: [] };
    if (warMerge.appliedIds.length !== warUpdatesForApply.length) {
      throw new Error("A canonical war operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    nextWorld = warMerge.world;

    const relationUpdatesForApply = normalizeArray(transaction.relationUpdates);
    const agreementUpdatesForApply = normalizeArray(transaction.agreementUpdates);
    // Subordinations ride the same merge as relations and agreements, so a
    // puppet the GM makes is a ledger row like any other: the country panel
    // shows it, the advisor is briefed on it, and a refusal later charges it.
    // With the system off the GM cannot install one either: the transaction is
    // validated against the same rule, so this is the belt to that braces.
    const puppetUpdatesForApply = isActiveFeatureEnabled("puppetStates")
      ? normalizeArray(transaction.puppetUpdates)
      : [];
    const diplomaticMerge = relationUpdatesForApply.length || agreementUpdatesForApply.length || puppetUpdatesForApply.length
      ? applyDiplomaticUpdates({
          world: nextWorld,
          relationUpdates: relationUpdatesForApply,
          agreementUpdates: agreementUpdatesForApply,
          puppetUpdates: puppetUpdatesForApply,
          puppetStates: isActiveFeatureEnabled("puppetStates"),
          regionCatalog: await regionCatalogForPuppets(puppetUpdatesForApply, nextWorld),
          events,
          stopDate: bundle.game.gameDate || bundle.game.startDate || "",
          round: bundle.game.round || 0,
        })
      : { world: nextWorld, appliedRelationIds: [], appliedAgreementIds: [], appliedPuppetIds: [], droppedPuppetUpdates: [] };
    if (diplomaticMerge.appliedRelationIds.length !== relationUpdatesForApply.length) {
      throw new Error("A canonical relation operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    if (diplomaticMerge.appliedAgreementIds.length !== agreementUpdatesForApply.length) {
      throw new Error("A canonical agreement operation failed during the in-memory apply. Nothing was persisted; regenerate the preview.");
    }
    if (normalizeArray(diplomaticMerge.appliedPuppetIds).length !== puppetUpdatesForApply.length) {
      const [first] = normalizeArray(diplomaticMerge.droppedPuppetUpdates);
      throw new Error(`A subordination change failed during the in-memory apply${first ? `: ${first.reason}` : ""}. Nothing was persisted; regenerate the preview.`);
    }
    nextWorld = diplomaticMerge.world;

    const storylineUpdatesForApply = normalizeArray(transaction.storylineUpdates);
    const storylineMerge = storylineUpdatesForApply.length
      ? applyWorldStorylineUpdates({
          world: nextWorld,
          updates: storylineUpdatesForApply,
          events,
          stopDate: bundle.game.gameDate || bundle.game.startDate || "",
          round: bundle.game.round || 0,
        })
      : { world: nextWorld, appliedIds: [] };
    if (storylineMerge.appliedIds.length !== storylineUpdatesForApply.length) {
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
      const liveChats = renamedChats ?? normalizeChats(await readChatsState({ force: true }));
      chatsToWrite = foldGeneratedChatsIntoStorage(liveChats, generatedChats, {
        stampTime: bundle.game.gameDate || bundle.game.startDate || "",
      });
      for (const { from, to } of renamedPolities) chatsToWrite = renamePolityInChats(chatsToWrite, from, to);
    } else if (renamedChats) {
      chatsToWrite = renamedChats;
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
    const chatIds = [...new Set([
      ...lifecycleChatIds,
      ...generatedChats.map((chat) => normalizeString(chat?.id)).filter(Boolean),
    ])];
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
    nextWorld = recordGmChange(nextWorld, {
      kind: "gm-console",
      summary: gameMasterChangeSummary({ transaction, summary, request }),
      round: bundle.game.round || 0,
      date: bundle.game.gameDate || bundle.game.startDate || "",
      at: auditRecord.appliedAt,
    });

    // Canonical persistence only. Deliberately omit actions/game writes, rollback
    // snapshots and oh:turn-complete: a GM edit is administrative authority, not a turn.
    // Avoid rewriting unrelated assets when this transaction did not touch them.
    const touchedEvents = events.length > 0;
    const touchedChats = generatedChats.length > 0 || Boolean(renamedChats);
    const touchedColors = JSON.stringify(nextColors) !== JSON.stringify(colors);
    const writes = [writeWorldState(nextWorld)];
    if (touchedEvents) writes.push(writeEventsState(nextEvents, { preserveApprovedEvents: true }));
    if (touchedChats) writes.push(writeChatsState(chatsToWrite));
    if (touchedColors) writes.push(writeJson(JSON_URLS.colors, nextColors, { pretty: true }));
    // The one game write the GM console makes: the player's own polity was renamed.
    if (renamedGame) writes.push(writeGameData(renamedGame));
    if (renamedFlags) writes.push(writeJson(JSON_URLS.flags, renamedFlags, { pretty: true }));

    try {
      await Promise.all(writes);
    } catch (error) {
      // Storage is file-based rather than transactional. Restore every asset this GM
      // transaction may have touched so a single failed write does not leave half an
      // intervention in canon. Best-effort rollback errors are logged separately.
      const rollbackWrites = [writeWorldState(bundle.world)];
      if (touchedEvents) rollbackWrites.push(writeEventsState(bundle.events, { preserveApprovedEvents: true }));
      if (touchedChats) rollbackWrites.push(writeChatsState(bundle.chats));
      if (touchedColors) rollbackWrites.push(writeJson(JSON_URLS.colors, colors, { pretty: true }));
      if (renamedGame) rollbackWrites.push(writeGameData(bundle.game));
      if (renamedFlags) rollbackWrites.push(writeJson(JSON_URLS.flags, flagsBefore ?? {}, { pretty: true }));
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
    // A reaction to an event the player has not been shown yet waits for the
    // reveal to reach it (runtime/unseenEvents.js): its note would say what the
    // player is about to read.
    if (event && unseenEvents.unseenFor(bundle.world).has(normalizeString(event.id))) {
      return debug ? { processed: 0, reason: "event-not-yet-revealed", retryAfterMs: 5000 } : null;
    }

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

    const politicalDecisionSet = buildIdleDiplomacyPoliticalDecisionSet(bundle, { event, maxActors: 6 });
    const politicalDecisionContext = idleDiplomacyPoliticalContextText(politicalDecisionSet);
    const variables = {
      ...(await buildTemplateVariables(bundle, { taskKey: "idleDiplomacy", lookups: true })),
      idleChatAllowed: "yes",
      eventDiplomaticReactionContext: eventReactionPromptText(event, bundle.game?.country),
    };

    let payload;
    try {
      ({ payload } = await runJsonTask("idleDiplomacy", {
        lookups: buildTaskLookups(bundle),
        userMessage:
          "Evaluate the supplied canonical event once. Decide whether one AI-controlled polity or a genuinely joint small group would naturally send the player a diplomatic note about it right now, or whether silence is the natural outcome. Return unitOps as an empty array and no sighting."
          + conversationContext
          + (politicalDecisionContext ? `\n\n${politicalDecisionContext}` : "")
          + "\n\nReturn JSON only.",
        validatePayload: async (candidate, { finalAttempt } = {}) => {
          if (candidate?.chat == null) return "";
          const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
          if (countries.length === 0) {
            return "$.chat.countries must contain at least one known non-player polity (or chat must be null).";
          }
          const speaker = normalizeString(candidate.chat.speaker) || normalizeString(countries[0]?.name || countries[0]?.code);
          if (!idleDiplomacySpeakerHasContext(bundle.world, speaker, politicalDecisionSet)) {
            return "$.chat.speaker must be one of the governments supplied in PRIVATE POLITICAL DECISION CONTEXT, or chat must be null.";
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
      if (compareGameDates(date, startDate) >= 0) {
        return `$.events[${index}].date must be strictly before the game start date ${startDate} — these events are pre-game history.`;
      }
      if (previous && compareGameDates(date, previous) < 0) {
        return `$.events[${index}].date must not be earlier than the previous event — order the backstory chronologically.`;
      }
      previous = date;
    }
    return "";
  }
  candidate.events = events
    .filter((event) => {
      const date = normalizeString(event?.date);
      return parseIsoDate(date) && compareGameDates(date, startDate) < 0;
    })
    .sort((a, b) => compareGameDates(a.date, b.date));
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
    if (startedDate && parseIsoDate(startDate) && (!parseIsoDate(startedDate) || compareGameDates(startedDate, startDate) > 0)) {
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
  // Issue #724: take the lock before the first read, not after it. It used to
  // be taken only once the bundle had been read and checked, so for the length
  // of that read the backstory was under way while the lock still said idle —
  // and a Stats pane already open as a fresh game loaded started its own AI
  // call in the gap. The "nothing to do" returns below all pass through the
  // finally, which is what makes holding the lock across them safe.
  beginSimulation();
  try {
    const bundle = await readGameStateBundle({ force: true });
    const briefing = normalizeString(bundle.world.startingTimelineText);
    if (!briefing) return null;
    if (normalizeEvents(bundle.events).length > 0) return null;
    if ((normalizeWorldState(bundle.world).simulationHistory ?? []).length > 0) return null;
    const startDate = normalizeString(bundle.game.startDate || bundle.game.gameDate);
    if (!startDate) return null;

    // The backstory now doubles as the round-zero bootstrap of the war and
    // diplomacy ledgers: a campaign that opens mid-war starts with that war on
    // the books, and a standing alliance is a fact from day one.
    const canonicalPolities = await buildCurrentCanonicalPolityVocabulary(bundle.world);
    const variables = {
      ...(await buildTemplateVariables(bundle, { lookups: true })),
      pregameStartDate: startDate,
      pregameCanonicalPolityVocabulary: canonicalPolities.length
        ? canonicalPolities.map((name) => `- ${name}`).join("\n")
        : "No current polity vocabulary was available.",
    };
    const { payload } = await runJsonTask("pregameHistory", {
      lookups: buildTaskLookups(bundle),
      // Asked once per campaign, and every ledger the campaign runs on is seeded
      // from it: a bootstrap that left out a war is worth one more request to get
      // right, where a single turn is not (requestBudget.js).
      strictFirst: true,
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
    const puppetUpdates = bindPuppetUpdatesToEvents(decodePuppetUpdates(payload?.puppetUpdates), bootstrapEvents);
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
      puppetUpdates,
      puppetStates: isActiveFeatureEnabled("puppetStates"),
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
// The chat half's chance per 60 s roll comes from the scenario's (or the game's)
// "one attempt every N minutes" setting — the Features tab of either editor —
// read from the active features: 1/8 by default, the value 1/20 was raised to
// when a player waited ~20 idle minutes just to CONSULT the model and most
// consulted rolls still returned null. The jump-path cap (see
// defaultPrompts.json) remains the primary source of diplomacy.
//
// The pulse runs at THAT cadence and no other. It used to run at least one roll
// in four, however the feature was set — the same call also moves the world's
// forces a little, and "the map benefits from breathing more often than the
// inbox does" — so switching idle diplomacy OFF still left about fifteen model
// calls an hour. A request is the scarce thing on a free key
// (requestBudget.js): the forces move when a note is being considered, which is
// the same one request, and with the feature off the pulse does not run.
let idleDiplomacyInFlight = false;
// Narrower than idleDiplomacyInFlight above: true only for the half of a pulse
// that actually asks whether a polity would send a note (allowChat). A
// movement-only pulse sets the in-flight guard but not this.
// idleChatPollInFlight moved to simulationStatus.js (setChatGenerationInFlight).

// isChatGenerationLikely is re-exported from simulationStatus.js. It is true
// only while the model is being asked whether a country would reach out
// unprompted. Deliberately NOT true for a jump, a game-master command or an
// advisor exchange: those take the same busy lock and MIGHT emit chats, but only
// a poll whose entire purpose is that question is worth an indicator.

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

  const { world: impacted } = applyEventImpactsToWorld({
    colors: {},
    events: [{ date: gameDate, title: "", description: "", impacts: { unitOps } }],
    world: freshWorld,
    motion: { originDate: gameDate, round, tick },
  });
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

export const maybeSendIdleDiplomacy = async ({ chance } = {}) => {
  if (idleDiplomacyInFlight || isSimulationBusy()) return null;
  // Nobody pressed anything, so this is background AI (requestBudget.js): it
  // stops at its daily cap, and spends nothing once the player turns it off.
  if (!backgroundAiAllowance().allowed) return null;
  // One cadence, the feature's own (see the comment above idleDiplomacyInFlight);
  // zero when idle diplomacy is off for this game, and then nothing runs. An
  // explicit `chance` is a caller's own roll (the tests, a debug trigger).
  const chatChance = idleDiplomacyChancePerMinute();
  const pulseChance = chance ?? chatChance;
  if (!(pulseChance > 0)) return null;
  const roll = Math.random();
  if (roll >= pulseChance) return null;
  if (await revealInProgress()) return null;
  // One call, both halves: whether a polity would write, and whether any forces
  // would visibly move. A caller's own roll does not switch on notes the game has
  // switched off.
  const allowChat = chatChance > 0;
  idleDiplomacyInFlight = true;
  setChatGenerationInFlight(allowChat);
  try {
    const bundle = await readGameStateBundle({ force: true });
    if (!normalizeString(bundle.game?.country)) return null; // no active game
    const variables = {
      ...(await buildTemplateVariables(bundle, { lookups: true })),
      idleChatAllowed: allowChat ? "yes" : "no",
    };
    const openChats = normalizeChats(bundle.chats).filter((chat) => !isLifecycleNegotiationChat(chat));
    const institutionRoutingContext = allowChat
      ? buildIdleInstitutionRoutingContext(bundle.world, bundle.game.country)
      : "";
    const politicalDecisionSet = allowChat
      ? buildIdleDiplomacyPoliticalDecisionSet(bundle, { maxActors: 6 })
      : buildBoundedPoliticalDecisionContextSet(bundle.world, { actorPolities: [], maxActors: 0 });
    const politicalDecisionContext = allowChat ? idleDiplomacyPoliticalContextText(politicalDecisionSet) : "";
    // Lifecycle accession/founding negotiations are excluded on purpose. A
    // background diplomatic note is conversation, not legal membership state,
    // and must never look like a canonical acceptance/rejection inside that
    // negotiation. Those decisions only come through chatActions + native
    // lifecycle validation.
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
      lookups: buildTaskLookups(bundle),
      requestKind: BACKGROUND_REQUEST,
      userMessage: allowChat
        ? "A quiet moment between rounds. Decide whether any single polity would send the player a short diplomatic note right now, and whether any forces would visibly move."
          + conversationContext
          + (institutionRoutingContext ? `\n\n${institutionRoutingContext}` : "")
          + (politicalDecisionContext ? `\n\n${politicalDecisionContext}` : "")
          + "\n\nReturn JSON only."
        : "A quiet moment between rounds. Decide whether any forces would visibly move right now. Return chat as null. Return JSON only.",
      validatePayload: async (candidate, { finalAttempt } = {}) => {
        if (candidate?.chat == null) return "";
        const countries = await resolveInvitees(candidate.chat.countries, bundle.world);
        if (countries.length === 0) {
          return "$.chat.countries must contain at least one known polity (or chat must be null).";
        }
        const speaker = normalizeString(candidate.chat.speaker) || normalizeString(countries[0]?.name || countries[0]?.code);
        if (!idleDiplomacySpeakerHasContext(bundle.world, speaker, politicalDecisionSet)) {
          return "$.chat.speaker must be one of the governments supplied in PRIVATE POLITICAL DECISION CONTEXT, or chat must be null.";
        }
        const requestedInstitution = normalizeString(candidate.chatInstitutionId);
        if (requestedInstitution) {
          if (!resolveIdleInstitutionRoute(bundle.world, {
            institutionId: requestedInstitution,
            playerCountry: bundle.game.country,
            speaker,
          })) {
            return "$.chatInstitutionId must identify an active institution shared by the player and the speaking polity, or be empty.";
          }
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
      // Placed by name, and kept off each other, like a turn's own ops.
      try {
        await resolvePlacements([{ event: null, impacts: { unitOps }, path: "$.unitOps" }], bundle.world, { receipt: null });
      } catch (error) {
        console.warn("[ai] idle pulse ops could not be placed by name; they stand as written.", error);
      }
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
    const requestedInstitutionId = normalizeString(payload.chatInstitutionId);
    const opening = built.messages?.[0] || null;
    const institutionRoute = requestedInstitutionId
      ? resolveIdleInstitutionRoute(bundle.world, {
        institutionId: requestedInstitutionId,
        playerCountry: bundle.game.country,
        speaker: opening?.speaker,
      })
      : null;
    if (institutionRoute && opening?.speaker && normalizeString(opening?.text)) {
      const committed = await commitInstitutionalDiplomaticReply({
        institutionId: institutionRoute.id,
        playerCountry: bundle.game.country,
        speakingAs: opening.speaker,
        code: opening.code || "",
        reply: opening.text,
        date: normalizeString(bundle.game?.gameDate),
        expectedGameId: normalizeString(bundle.game?.id || bundle.game?.gameId),
      });
      logDebugEvent("diplomacy", `Idle diplomacy routed ${opening.speaker} into ${institutionRoute.name || institutionRoute.id} Council instead of Contacts.`, { institutionId: institutionRoute.id }, { verbose: true });
      return { ...built, institutionId: institutionRoute.id, id: committed?.channel?.id || built.id };
    }
    const chats = normalizeChats(await readChatsState({ force: true }));
    const collidesWithLifecycleNegotiation = chats.some((chat) => (
      chat?.status !== "closed"
      && isLifecycleNegotiationChat(chat)
      && chatParticipantKey(chat.countries) === chatParticipantKey(built.countries)
    ));
    if (collidesWithLifecycleNegotiation) {
      logGeneratedChat(built, "dropped — lifecycle negotiations only accept native lifecycle decisions");
      return null;
    }
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
    setChatGenerationInFlight(false);
  }
};

// Clearer name for what this now does. The old export stays because main.jsx
// imports it dynamically and the docs reference it by name.
export const maybeRunIdlePulse = maybeSendIdleDiplomacy;
