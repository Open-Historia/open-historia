/*! Open Historia — native timeline curator. */
// The model may suggest that a freshly generated event is redundant or not
// worth a timeline slot. Nothing is deleted on that opinion alone: the checks
// below hold it to the record's own structure (the prior events it cites must
// share a storyline with the event, hard mechanical consequences always keep
// an event, storyline saturation is the analyst's own count) before an event
// is dropped, and every failure of the analysis keeps everything. The default
// is KEEP.
//
// Nothing here reads an event's words. The analyst reads them, in whatever
// language the game is played in, and answers in fields: verdict, confidence,
// matchedPriorIndexes, the booleans below. The engine reads those, the event's
// tags and operations, and the storyline ids the events carry. It used to read
// English word lists too (process words, modal verbs, harm words, military
// words) and compared events by their shared words: none of that ever fired in
// another language, and in English it misfired on negation and synonyms, so
// the same world was curated differently by language.

const VERSION = "curator-2";

const CONFIG = Object.freeze({
  // The prior events the analyst is shown, and the only ones it may cite.
  priorHistoryWindow: 50,

  redundancyConfidenceFloor: 0.85,
  reversalDropConfidence: 0.97,

  saturationHardCount: 4,
  nativeProcessFillerConfidenceFloor: 0.82,
  saturatedIncrementalConfidenceFloor: 0.82,
  routineMilitaryConfidenceFloor: 0.80,

  lowValueIncrementalConfidenceFloor: 0.88,
  lowValueIncrementalMinimumPriorCount: 2,
});

let lastAudit = null;

const normalizeString = (value) => String(value ?? "").trim();

const asArray = (value) => Array.isArray(value) ? value : [];

const cloneValue = (value) => {
  try {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

// The analyst names a storyline in its judgment and again in its saturation
// rows; the two are matched as written, with case and spacing folded and
// nothing else.
const labelKey = (value) =>
  normalizeString(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ");

// An event's category tags (runtime/eventTags.js), matched exactly.
const hasTag = (event, tag) =>
  asArray(event?.tags).some((entry) => normalizeString(entry).toLowerCase() === tag.toLowerCase());

const storylineIdsOf = (event) =>
  asArray(event?.storylineIds).map(normalizeString).filter(Boolean);

// ---- event summaries --------------------------------------------------------

const summarizeEvent = (event, index) => ({
  index: index + 1,
  date: normalizeString(event?.date),
  title: normalizeString(event?.title),
  importance: normalizeString(event?.importance),
  source: normalizeString(event?.source),

  regionTransfers: asArray(event?.impacts?.regionTransfers).length,
  polityChanges: asArray(event?.impacts?.polityChanges).length,
  politicalActorOps: asArray(event?.impacts?.politicalActorOps).length,
  unitOps: asArray(event?.impacts?.unitOps).length,
  markerOps: asArray(event?.impacts?.markerOps).length,
  createdChats: asArray(event?.impacts?.createdChats).length,
});

const structuredImpactReasons = (event) => {
  const impacts =
    event?.impacts && typeof event.impacts === "object"
      ? event.impacts
      : {};

  const result = [];

  // Hard mechanical consequences deserve fail-open protection because dropping the
  // event would otherwise erase an actual map/control/unit/object/chat transition.
  for (const key of [
    "regionTransfers",
    "regionClaims",
    "groupOps",
    "regionControlOps",
    "politicalActorOps",
    "unitOps",
    "markerOps",
    "createdChats",
  ]) {
    if (asArray(impacts[key]).length) result.push(key);
  }

  // Polity lifecycle transitions are equally hard. A generic operation="update"
  // is deliberately NOT an automatic KEEP: models sometimes decorate an otherwise
  // redundant debate/review with a tiny stability/tag tweak. Such soft metadata/stat
  // updates must earn the event's timeline slot through the normal semantic gates.
  const hardPolityLifecycle = asArray(impacts.polityChanges)
    .some((change) =>
      ["create", "rename", "restore", "dissolve"]
        .includes(normalizeString(change?.operation).toLowerCase())
      || normalizeString(change?.name)
      || normalizeString(change?.color),
    );
  if (hardPolityLifecycle) result.push("polityLifecycle");

  // An event bound to the war ledger is a belligerency transition or the combat
  // it licenses; dropping it would orphan the ledger's causal chain.
  if (normalizeString(event?.warId)) result.push("warState");

  return result;
};

// ---- prior history ----------------------------------------------------------
//
// The prior events the analyst is shown, each with its absolute index. A
// judgment may cite only these.
const priorWindow = (priorEvents) => {
  const canonical = asArray(priorEvents);
  const shown = canonical.slice(-CONFIG.priorHistoryWindow);
  const startIndex = canonical.length - shown.length;
  return shown.map((event, offset) => ({ priorIndex: startIndex + offset, event }));
};

// The prior events in the window that share a storyline with the candidate:
// the record's own link between two events (event.storylineIds, written when
// a skip's storyline updates name the events they move). This is what a
// repeat is held to. It replaces a comparison of the two events' words, which
// found nothing alike between a translated name and the canonical one.
const storylinePriorsOf = (event, history) => {
  const own = new Set(storylineIdsOf(event));
  if (!own.size) return [];
  return history.filter((row) => storylineIdsOf(row.event).some((id) => own.has(id)));
};

// ---- analyst packets --------------------------------------------------------

const buildCandidatePacket = (event, index) => {
  const storylineIds = storylineIdsOf(event);
  const tags = asArray(event?.tags).map(normalizeString).filter(Boolean);
  return {
    index,
    date: normalizeString(event?.date),
    title: normalizeString(event?.title),
    description: normalizeString(event?.description),
    importance: normalizeString(event?.importance),
    kind: normalizeString(event?.kind),
    playerRelated: event?.playerRelated === true,
    notable: event?.notable === true,
    ...(tags.length ? { tags } : {}),
    ...(storylineIds.length ? { storylineIds } : {}),

    impacts: {
      regionTransfers: cloneValue(
        asArray(event?.impacts?.regionTransfers),
      ),

      polityChanges: cloneValue(
        asArray(event?.impacts?.polityChanges),
      ),

      politicalActorOps: cloneValue(
        asArray(event?.impacts?.politicalActorOps),
      ),

      unitOps: cloneValue(
        asArray(event?.impacts?.unitOps),
      ),

      markerOps: cloneValue(
        asArray(event?.impacts?.markerOps),
      ),

      createdChats: cloneValue(
        asArray(event?.impacts?.createdChats),
      ),
    },
  };
};

const buildPriorHistoryPacket = (priorEvents) =>
  priorWindow(priorEvents).map(({ priorIndex, event }) => {
    const storylineIds = storylineIdsOf(event);
    return {
      priorIndex,
      date: normalizeString(event?.date),
      title: normalizeString(event?.title),
      description: normalizeString(event?.description),
      importance: normalizeString(event?.importance),
      ...(storylineIds.length ? { storylineIds } : {}),
    };
  });

// ---- analyst normalization --------------------------------------------------
// omitted or malformed judgments are KEEP. fail open, because history is a
// stupid place to experiment with optimistic deletion.

const normalizeJudgment = (
  judgment,
  event,
  index,
) => {
  const rawVerdict =
    normalizeString(judgment?.verdict).toUpperCase();

  return {
    index,

    verdict: [
      "KEEP",
      "REDUNDANT",
      "UNSUPPORTED_REVERSAL",
    ].includes(rawVerdict)
      ? rawVerdict
      : "KEEP",

    confidence: Math.max(
      0,
      Math.min(
        1,
        Number(judgment?.confidence) || 0,
      ),
    ),

    materialStateChange:
      normalizeString(
        judgment?.materialStateChange,
      ) ||
      "Analyst omitted event; fail-open KEEP.",

    matchedPriorIndexes: asArray(
      judgment?.matchedPriorIndexes,
    )
      .map(Number)
      .filter(Number.isInteger),

    materiallyNewDimensions: asArray(
      judgment?.materiallyNewDimensions,
    )
      .map(normalizeString)
      .filter(Boolean),

    recurrenceMatters:
      judgment?.recurrenceMatters === true,

    newTriggerAfterPriorPosture:
      normalizeString(
        judgment?.newTriggerAfterPriorPosture,
      ),

    // Whether a new trigger explains an apparent reversal. Null when the
    // answer does not say (one written before the field existed).
    newTrigger:
      typeof judgment?.newTrigger === "boolean"
        ? judgment.newTrigger
        : null,

    worthwhile:
      judgment?.worthwhile !== false,

    substantive:
      judgment?.substantive === true,

    personalityTexture:
      judgment?.personalityTexture === true,

    storyline:
      normalizeString(judgment?.storyline) ||
      normalizeString(event?.title) ||
      `event-${index}`,

    qualitativeAdvance:
      judgment?.qualitativeAdvance !== false,

    incrementalProcess:
      judgment?.incrementalProcess === true,

    processFramePresent:
      judgment?.processFramePresent === true,

    observableOutcomeEvidence:
      normalizeString(
        judgment?.observableOutcomeEvidence,
      ),

    pureProcessFiller:
      judgment?.pureProcessFiller === true,

    reason:
      normalizeString(judgment?.reason) ||
      "Analyst omitted event; fail-open KEEP.",
  };
};

// No new trigger behind an apparent reversal: the analyst's newTrigger says
// so; an answer without it says so by leaving the trigger it names empty.
const noNewTrigger = (model) =>
  model.newTrigger === false ||
  (model.newTrigger === null && !model.newTriggerAfterPriorPosture);

// ---- deterministic enforcement ---------------------------------------------

const evaluateCandidate = ({
  event,
  index,
  judgment,
  history,
  saturationByStoryline,
}) => {
  const model = normalizeJudgment(
    judgment,
    event,
    index,
  );

  // The prior events the candidate shares a storyline with. A prior event the
  // analyst cites counts as evidence only when it is one of these.
  const storylinePriors = storylinePriorsOf(event, history);
  const onStoryline = new Set(storylinePriors.map((row) => row.priorIndex));

  const groundedPriorIndexes =
    model.matchedPriorIndexes.filter(
      (priorIndex) => onStoryline.has(priorIndex),
    );

  const ignoredPriorIndexes =
    model.matchedPriorIndexes.filter(
      (priorIndex) => !onStoryline.has(priorIndex),
    );

  const groundedEvidencePass = groundedPriorIndexes.length > 0;
  const storylineOnRecord = storylinePriors.length > 0;

  const saturation =
    saturationByStoryline.get(
      labelKey(model.storyline),
    ) || null;

  const recentStorylineCount =
    Number(saturation?.count) || 0;

  const storylineSaturated =
    saturation?.saturation === "saturated" ||
    recentStorylineCount >=
      CONFIG.saturationHardCount;

  // Process framing is the analyst's call: a meeting, a review, a
  // consultation, in any language. Framed so, the event has to state a
  // completed observable outcome, and the analyst quotes it; it does not
  // mean "drop it".
  const nativeProcessEvidenceRequired =
    model.processFramePresent === true;

  const nativeObservableOutcomeStated =
    !nativeProcessEvidenceRequired ||
    model.observableOutcomeEvidence.length > 0;

  const nativePureProcessFiller =
    model.pureProcessFiller === true ||
    (
      nativeProcessEvidenceRequired &&
      !nativeObservableOutcomeStated
    );

  // A war event carries its war (warId) and is kept above; one tagged
  // Military without a war is what the routine-military route weighs.
  const militaryTagged = hasTag(event, "Military");

  // Repetition that matters is the analyst's recurrenceMatters, and nothing
  // overrides it.
  const effectiveRecurrenceMatters =
    model.recurrenceMatters === true;

  const establishedLowValueIncremental =
    recentStorylineCount >=
      CONFIG.lowValueIncrementalMinimumPriorCount &&
    model.confidence >=
      CONFIG.lowValueIncrementalConfidenceFloor &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    model.worthwhile === false &&
    model.personalityTexture === false &&
    effectiveRecurrenceMatters === false;

  const impacts =
    structuredImpactReasons(event);

  let wouldAction = "KEEP";
  let route = "PRESUME_KEEP";
  let enforcementReason = "default KEEP";
  let hard = false;

  // Hard structured impacts always win. Soft polity operation="update" metadata/stat
  // tweaks do not: they must earn the event's existence through the semantic gates,
  // otherwise a model can smuggle repetitive filler into canon by attaching a tiny
  // arbitrary stability/tag update.
  if (impacts.length) {
    route = "STRUCTURED_IMPACT_KEEP";

    enforcementReason =
      `structured impacts: ${impacts.join(", ")}`;
  }

  else if (
    model.verdict === "REDUNDANT"
  ) {
    const confidencePass =
      model.confidence >=
      CONFIG.redundancyConfidenceFloor;

    const noNewDimensions =
      model.materiallyNewDimensions.length === 0;

    const semanticPass =
      !model.recurrenceMatters &&
      model.worthwhile === false &&
      model.personalityTexture === false;

    if (
      confidencePass &&
      groundedEvidencePass &&
      noNewDimensions &&
      semanticPass
    ) {
      wouldAction = "DROP";
      route = "EVIDENCED_REDUNDANCY";

      enforcementReason =
        "grounded redundancy: a cited prior event on the same storyline + no material novelty + recurrence immaterial";
    }

    else {
      route = "REDUNDANCY_FAIL_OPEN";

      const failures = [];

      if (!confidencePass) {
        failures.push(
          "low analyst confidence",
        );
      }

      if (!groundedEvidencePass) {
        failures.push(
          "no cited prior event on the same storyline",
        );
      }

      if (!noNewDimensions) {
        failures.push(
          "materially new dimension present",
        );
      }

      if (model.recurrenceMatters) {
        failures.push(
          "recurrence matters",
        );
      }

      if (model.worthwhile !== false) {
        failures.push(
          "analyst says worthwhile",
        );
      }

      if (model.personalityTexture) {
        failures.push(
          "personality texture",
        );
      }

      enforcementReason =
        `redundancy fail-open: ${
          failures.join("; ") ||
          "safety condition failed"
        }`;
    }
  }

  else if (
    model.verdict ===
    "UNSUPPORTED_REVERSAL"
  ) {
    if (
      model.confidence >=
        CONFIG.reversalDropConfidence &&
      groundedEvidencePass &&
      noNewTrigger(model)
    ) {
      wouldAction = "DROP";
      route = "UNSUPPORTED_REVERSAL";
      hard = true;

      enforcementReason =
        "explicit grounded same-storyline reversal without a new trigger";
    } else {
      route = "REVERSAL_FAIL_OPEN";

      enforcementReason =
        "reversal claim lacked a cited prior event on the same storyline, confidence, or the absence of a new trigger";
    }
  }

  // process-only filler does not require an older duplicate.
  // it does require basically every safety signal to agree before we'd kill it.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    model.confidence >=
      CONFIG.nativeProcessFillerConfidenceFloor &&
    nativePureProcessFiller &&
    model.materiallyNewDimensions.length === 0 &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    effectiveRecurrenceMatters === false &&
    model.worthwhile === false &&
    model.personalityTexture === false
  ) {
    wouldAction = "DROP";
    route = "NATIVE_PROCESS_FILLER";

    enforcementReason =
      "process-only event: the analyst found no completed observable outcome";
  }

  // completed micro-outcomes can still be unremarkable once a storyline has
  // already established itself several times.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    establishedLowValueIncremental
  ) {
    wouldAction = "DROP";
    route = "LOW_VALUE_INCREMENTAL_CHURN";

    enforcementReason =
      `low-value incremental storyline: ${
        saturation?.storyline ||
        model.storyline
      } (${recentStorylineCount} recent); ` +
      "high-confidence incremental continuation + no qualitative advance/worthwhile value/personality/material recurrence";
  }

  // Routine military continuation: an event the skip tagged Military, with no
  // war, unit or map operation of its own, that the analyst calls another
  // incremental step that changes nothing in kind and adds no new dimension.
  // Saturation is useful evidence but is not required: otherwise the same
  // artillery/patrol/probe loop escapes as soon as its recent count cools from
  // "saturated" to "busy", then rebuilds the saturation again. A concrete
  // consequence (casualties, a breakthrough, a capture, a ceasefire) is a new
  // dimension in the analyst's answer, or an operation on the event.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    militaryTagged &&
    model.confidence >= CONFIG.routineMilitaryConfidenceFloor &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    model.materiallyNewDimensions.length === 0 &&
    model.personalityTexture === false
  ) {
    wouldAction = "DROP";
    route = "ROUTINE_MILITARY_NO_DELTA";

    enforcementReason =
      `routine military continuation with no material delta: ${
        saturation?.storyline ||
        model.storyline
      }; incremental/no qualitative advance and no new dimension`;
  }

  // old saturated-storyline guard. even here we still require recorded
  // storyline history, high confidence, no qualitative advance and no
  // meaningful recurrence.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    storylineSaturated &&
    model.confidence >=
      CONFIG.saturatedIncrementalConfidenceFloor &&
    storylineOnRecord &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    effectiveRecurrenceMatters === false &&
    model.personalityTexture === false
  ) {
    wouldAction = "DROP";
    route =
      "SATURATED_INCREMENTAL_REDUNDANCY";

    enforcementReason =
      `saturated incremental storyline: ${
        saturation?.storyline ||
        model.storyline
      } (${recentStorylineCount} recent); ` +
      "prior events on the same storyline + high-confidence incremental process + no qualitative advance/meaningful recurrence";
  }

  return {
    index,
    event,

    wouldAction,

    // live mode means the deterministic decision actually counts now.
    actualAction: wouldAction,

    hard,
    route,
    enforcementReason,

    structuredImpacts: impacts,

    storylinePriors: storylinePriors.map(
      (row) => ({
        priorIndex: row.priorIndex,
        date:
          normalizeString(
            row.event?.date,
          ),
        title:
          normalizeString(
            row.event?.title,
          ),
      }),
    ),

    groundedPriorIndexes,
    ignoredPriorIndexes,
    groundedEvidencePass,
    storylineOnRecord,

    storylineSaturation:
      saturation
        ? cloneValue(saturation)
        : null,

    storylineSaturated,
    recentStorylineCount,

    nativeProcessEvidenceRequired,
    nativeObservableOutcomeStated,
    nativePureProcessFiller,
    militaryTagged,
    effectiveRecurrenceMatters,
    establishedLowValueIncremental,

    ...model,
  };
};

// ---- supported turn types ---------------------------------------------------

const shouldCurateMode = (mode) =>
  mode === "jump" || mode === "auto";

// ---- main curator -----------------------------------------------------------

// Drop routes that decide only whether a Canonical event is WORTH SHOWING. An
// event removed by one of these still happened, so it is handed on as a Hidden
// event: the Board reads every Canonical event, and routine progress on a Board
// entry is exactly what these routes keep off the timeline.
//
// An allowlist on purpose. UNSUPPORTED_REVERSAL (it contradicts history, so it
// never happened) is withheld, and so is any route added later until someone
// decides which kind it is — the safe default for a Board that must never
// record a contradiction.
const VISIBILITY_ROUTES = new Set([
  "EVIDENCED_REDUNDANCY",
  "NATIVE_PROCESS_FILLER",
  "LOW_VALUE_INCREMENTAL_CHURN",
  "ROUTINE_MILITARY_NO_DELTA",
  "SATURATED_INCREMENTAL_REDUNDANCY",
]);

// ---- is a judgment worth asking for? ----------------------------------------
//
// The analyst is a model request, and on a free key requests are what run out
// (requestBudget.js). Whether it is worth one is decided from the record's
// structure alone, never from what the events say:
//
//   - an event with a hard mechanical consequence (a transfer, a unit or
//     marker op, a war, a new chat...) is always kept, whatever is said;
//   - the routes that rest on history (a redundancy, a reversal, a saturated
//     storyline) need a prior event on record that shares a storyline with the
//     candidate, and a judgment can cite only those.
//
// So the analyst is asked only when some candidate without a hard consequence
// continues a storyline that already has an event in the window it is shown.
// Three routes rest on the analyst's word alone — a process frame only it can
// see, a storyline it calls crowded, a routine military step — and can remove
// an event only when a review happens to run for another candidate. Asking on
// their account would mean asking about nearly every skip. All three fail
// toward KEEP.
//
// Returns the indexes worth a judgment; empty means the analyst can be skipped.
export const candidatesWorthJudging = ({ events = [], priorEvents = [], mode = "jump" } = {}) => {
  if (!shouldCurateMode(mode)) return [];

  const history = priorWindow(priorEvents);
  const worth = [];
  asArray(events).forEach((event, index) => {
    if (structuredImpactReasons(event).length) return;
    if (storylinePriorsOf(event, history).length) worth.push(index);
  });
  return worth;
};

// What the analyst is shown, or null when there is nothing to show. Its own
// function so a review can ask for the judgments as one job among several,
// with exactly this input.
export const buildCuratorInput = ({ events = [], priorEvents = [], mode = "jump" } = {}) => {
  const incoming = asArray(events);
  if (!shouldCurateMode(mode) || !incoming.length) return null;
  return {
    candidates: incoming.map(buildCandidatePacket),
    priorHistory: buildPriorHistoryPacket(priorEvents),
  };
};

// The timeline, as before.
export const curateGeneratedEvents = async (args = {}) =>
  (await curateGeneratedEventsWithHidden(args)).events;

// The timeline plus the Hidden events it left out: { events, hidden }, where each
// hidden row is { event, route, reason }.
export const curateGeneratedEventsWithHidden = async ({
  events = [],
  priorEvents = [],
  game = {},
  world = {},
  actions = [],
  mode = "",
  analyzeBatch = null,
  isSparedFromFiller = null,
  signal = null,
} = {}) => {
  const incoming = asArray(events);

  if (!shouldCurateMode(mode)) {
    return { events: incoming, hidden: [], dropped: [] };
  }

  const eventSummaries =
    incoming.map(summarizeEvent);

  let analysisResult = null;
  let analysisError = "";

  // The analyst is a request. When no candidate is one it could remove
  // (candidatesWorthJudging: every event carries a transfer, a unit op or a
  // war, or continues no storyline on record), every event is kept whatever
  // it says, so it is not asked.
  if (
    incoming.length &&
    typeof analyzeBatch === "function" &&
    candidatesWorthJudging({ events: incoming, priorEvents, mode }).length > 0
  ) {
    try {
      analysisResult =
        await analyzeBatch(
          buildCuratorInput({ events: incoming, priorEvents, mode }),
        );
    } catch (error) {
      // The player's Cancel is not a failed analyst: it must reach the skip.
      if (signal?.aborted) throw error;
      analysisError =
        normalizeString(
          error?.message || error,
        );

      console.warn(
        "[OH Native Timeline Curator] semantic analyst failed; keeping everything.",
        error,
      );
    }
  }

  const analysisPayload =
    analysisResult?.payload || null;

  const rawJudgments =
    asArray(
      analysisPayload?.judgments,
    );

  const judgmentByIndex =
    new Map();

  for (const judgment of rawJudgments) {
    const index =
      Number(judgment?.index);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= incoming.length
    ) {
      continue;
    }

    judgmentByIndex.set(
      index,
      judgment,
    );
  }

  const saturationByStoryline =
    new Map();

  for (
    const row of asArray(
      analysisPayload?.storylineSaturation,
    )
  ) {
    const key =
      labelKey(row?.storyline);

    if (key) {
      saturationByStoryline.set(
        key,
        row,
      );
    }
  }

  const history = priorWindow(priorEvents);

  // An event that answers one of the player's orders, or a Project date due
  // this period, is what the player asked the jump for (AI/playerFocus.js
  // createSpareTest). However routine it reads, the filler gates may not take
  // it off the timeline — it would leave the order or the milestone with
  // nothing to show for it. Every other event is judged as before.
  const spared = typeof isSparedFromFiller === "function" ? isSparedFromFiller : () => false;
  const evaluations =
    incoming.map(
      (event, index) => {
        const evaluation = evaluateCandidate({
          event,
          index,

          judgment:
            judgmentByIndex.get(index),

          history,
          saturationByStoryline,
        });
        if (evaluation.wouldAction === "KEEP" || !spared(event)) return evaluation;
        return {
          ...evaluation,
          wouldAction: "KEEP",
          actualAction: "KEEP",
          route: "PLAYER_FOCUS_SPARE",
          enforcementReason: `spared: it answers the player's own order or a Project date due this period (was ${evaluation.route})`,
        };
      },
    );

  // audit is over. the deterministic gates decide.
  const keptEvents =
    evaluations
      .filter(
        (entry) =>
          entry.wouldAction === "KEEP",
      )
      .map(
        (entry) => entry.event,
      );

  const droppedEvents =
    evaluations
      .filter(
        (entry) =>
          entry.wouldAction === "DROP",
      )
      .map(
        (entry) => entry.event,
      );

  const wouldDropCount =
    evaluations.filter(
      (entry) =>
        entry.wouldAction === "DROP",
    ).length;

  const wouldKeepCount =
    evaluations.length -
    wouldDropCount;

  const judgmentRows =
    evaluations.map(
      (entry) => ({
        index: entry.index + 1,

        title:
          normalizeString(
            entry.event?.title,
          ),

        verdict:
          entry.verdict,

        confidence:
          entry.confidence,

        storyline:
          entry.storyline,

        worthwhile:
          entry.worthwhile,

        qualitative:
          entry.qualitativeAdvance,

        incremental:
          entry.incrementalProcess,

        processFiller:
          entry.nativePureProcessFiller,

        recurrence:
          entry.effectiveRecurrenceMatters,

        military:
          entry.militaryTagged,

        grounded:
          entry.groundedEvidencePass,

        route:
          entry.route,

        wouldAction:
          entry.wouldAction,

        actualAction:
          entry.actualAction,
      }),
    );

  lastAudit = {
    version: VERSION,
    mode: "live",
    simulationMode: mode,

    gameDate:
      normalizeString(
        game?.gameDate,
      ),

    round:
      Number(game?.round) || 0,

    generatedCount:
      incoming.length,

    keptCount:
      keptEvents.length,

    droppedCount:
      droppedEvents.length,

    wouldKeepCount,
    wouldDropCount,

    priorEventCount:
      asArray(priorEvents).length,

    plannedActionCount:
      asArray(actions)
        .filter(
          (action) =>
            action?.status ===
            "planned",
        )
        .length,

    analysisSource:
      normalizeString(
        analysisResult
          ?.generation
          ?.source,
      ) ||
      (
        analysisResult
          ? "unknown"
          : "not-run"
      ),

    analysisFallbackReason:
      normalizeString(
        analysisResult
          ?.generation
          ?.fallbackReason,
      ),

    analysisError,

    eventSummaries,

    events:
      cloneValue(incoming),

    judgments:
      cloneValue(rawJudgments),

    evaluations:
      cloneValue(evaluations),

    judgmentRows:
      cloneValue(judgmentRows),

    storylineSaturation:
      cloneValue(
        asArray(
          analysisPayload
            ?.storylineSaturation,
        ),
      ),

    underrepresentedDomains:
      cloneValue(
        asArray(
          analysisPayload
            ?.underrepresentedDomains,
        ),
      ),

    recentHistoryMechanical:
      analysisPayload
        ?.recentHistoryMechanical ===
      true,

    rawAnalysis:
      cloneValue(
        analysisPayload,
      ),

    timestamp:
      new Date().toISOString(),
  };

  const verboseDiagnostics =
    typeof window !== "undefined" && window.__OH_AI_VERBOSE__ === true;

  if (verboseDiagnostics) {
    console.group(
      `[OH Native Timeline Curator v${VERSION}] DETERMINISTIC LIVE — ${incoming.length} generated event(s)`,
    );

    console.log({
      gameDate: lastAudit.gameDate,
      round: lastAudit.round,
      simulationMode: mode,
      priorEventCount: lastAudit.priorEventCount,
      plannedActionCount: lastAudit.plannedActionCount,
      analysisSource: lastAudit.analysisSource,
      analysisFallbackReason: lastAudit.analysisFallbackReason || "—",
      wouldKeep: wouldKeepCount,
      wouldDrop: wouldDropCount,
      actualDropped: droppedEvents.length,
    });

    if (eventSummaries.length) {
      console.log("native events:");
      console.table(eventSummaries);
    }

    if (judgmentRows.length) {
      console.log("deterministic curator:");
      console.table(judgmentRows);
    }

    if (lastAudit.storylineSaturation.length) {
      console.log("recent storyline saturation:");
      console.table(lastAudit.storylineSaturation);
    }

    if (analysisError) console.warn("analyst error:", analysisError);
    console.log(`live curator — kept ${keptEvents.length} event(s), dropped ${droppedEvents.length}.`);
    console.groupEnd();
  } else {
    console.info(
      `[OH Native Timeline Curator v${VERSION}] kept ${keptEvents.length}/${incoming.length} event(s)` +
      `${droppedEvents.length ? `; dropped ${droppedEvents.length}` : ""}.`,
    );
    if (analysisError) console.warn(`[OH Native Timeline Curator] analyst error: ${analysisError}`);
  }

  const hidden = evaluations
    .filter((entry) => entry.wouldAction === "DROP" && VISIBILITY_ROUTES.has(entry.route))
    .map((entry) => ({ event: entry.event, route: entry.route, reason: entry.enforcementReason }));

  // Every event this pass removed, whichever kind of route removed it: `hidden`
  // above is only the canonical ones the Board still reads. The turn's
  // application receipt (runtime/applicationReceipt.js) tells the simulator about
  // all of them, because none of them is in the record it is shown next turn.
  const dropped = evaluations
    .filter((entry) => entry.wouldAction === "DROP")
    .map((entry) => ({
      // By its id: the turn files its card by it (gameplay.js filedEventsFromRows).
      id: normalizeString(entry.event?.id),
      title: normalizeString(entry.event?.title),
      route: entry.route,
      reason: entry.enforcementReason,
    }));

  // alright, no more training wheels.
  return { events: keptEvents, hidden, dropped };
};

if (typeof window !== "undefined") {
  window.__OH_NATIVE_TIMELINE_CURATOR__ = {
    version: VERSION,
    mode: "live",
    config: CONFIG,
    last: () => lastAudit,
  };
}
