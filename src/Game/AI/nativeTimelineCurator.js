/*!
 * open historia enhanced — native timeline curator
 * v0.3.0 — deterministic semantic audit
 *
 * the ai may suggest that an event is redundant or boring.
 * javascript now checks whether that opinion deserves to survive contact
 * with reality before we even think about deleting anything.
 */

const VERSION = "0.3.0-audit";

const CONFIG = Object.freeze({
  historyLookbackEvents: 80,
  priorMatchesPerCandidate: 5,

  redundancyConfidenceFloor: 0.85,
  groundedStrongSimilarity: 0.40,
  groundedModerateSimilarity: 0.28,
  groundedModerateCount: 2,
  reversalDropConfidence: 0.97,

  saturationHardCount: 4,
  nativeProcessFillerConfidenceFloor: 0.82,
  saturatedIncrementalConfidenceFloor: 0.82,

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

// ---- text helpers -----------------------------------------------------------

const eventText = (event) =>
  `${normalizeString(event?.title)}\n${normalizeString(event?.description)}`.trim();

const normalizeText = (text) =>
  normalizeString(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const storylineKey = (value) => normalizeText(value);

// ---- event summaries --------------------------------------------------------

const summarizeEvent = (event, index) => ({
  index: index + 1,
  date: normalizeString(event?.date),
  title: normalizeString(event?.title),
  importance: normalizeString(event?.importance),
  source: normalizeString(event?.source),

  regionTransfers: asArray(event?.impacts?.regionTransfers).length,
  polityChanges: asArray(event?.impacts?.polityChanges).length,
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

  for (const key of [
    "regionTransfers",
    "polityChanges",
    "unitOps",
    "markerOps",
    "createdChats",
  ]) {
    if (asArray(impacts[key]).length) result.push(key);
  }

  return result;
};

// ---- process framing --------------------------------------------------------
// this does not mean "drop it". it means a meeting/review/etc has to prove
// that something actually fucking happened.

const hasProcessFrameCue = (event) => {
  const text = normalizeText(eventText(event));

  return /\b(?:meet(?:s|ing)?|conven(?:e|es|ed|ing)|debat(?:e|es|ed|ing)|review(?:s|ed|ing)?|consult(?:s|ed|ing|ation|ations)?|conferenc(?:e|es)|session|stud(?:y|ies|ied|ying)|hearing|negotiat(?:e|es|ed|ing|ion|ions)|discuss(?:es|ed|ing|ion|ions)?)\b/.test(
    text,
  );
};

const hasNativeProcessFrameCue = (event) => {
  if (hasProcessFrameCue(event)) return true;

  const text = normalizeText(eventText(event));

  return /\b(?:inspect(?:s|ed|ing|ion|ions)?|notification|notifications|notif(?:y|ies|ied|ying)|delegation|delegations|plenary|working group|technical commission|fact finding|factfinding)\b/.test(
    text,
  );
};

// ---- outcome grounding ------------------------------------------------------
// the analyst is allowed to quote a result, but we're checking that the quote
// is really in the native event and isn't just "plans to do x eventually".

const isProspectiveOutcomeEvidence = (event, evidence) => {
  const prose = normalizeText(eventText(event));
  const quote = normalizeText(evidence);

  if (!prose || !quote) return false;

  if (
    /^(?:to\b|in order to\b|aim(?:s|ed|ing)? to\b|seek(?:s|ed|ing)? to\b|plan(?:s|ned|ning)? to\b|intend(?:s|ed|ing)? to\b|expect(?:s|ed|ing)? to\b|scheduled to\b|set to\b|will\b|would\b|could\b|may\b|might\b|should\b)/.test(
      quote,
    )
  ) {
    return true;
  }

  const indexes = [];
  let from = 0;

  while (from < prose.length) {
    const index = prose.indexOf(quote, from);

    if (index === -1) break;

    indexes.push(index);
    from = index + Math.max(1, quote.length);
  }

  for (const index of indexes) {
    const prefix = prose
      .slice(Math.max(0, index - 96), index)
      .trimEnd();

    if (
      /(?:\bin order to|\bto|\baim(?:s|ed|ing)? to|\bseek(?:s|ed|ing)? to|\bplan(?:s|ned|ning)? to|\bintend(?:s|ed|ing)? to|\bexpect(?:s|ed|ing)? to|\bscheduled to|\bset to|\bwill|\bwould|\bcould|\bmay|\bmight|\bshould)\s*$/.test(
        prefix,
      )
    ) {
      return true;
    }
  }

  return false;
};

// ---- recurrence -------------------------------------------------------------
// repeated actual incidents may matter precisely because they keep happening.
// this is not a generic blacklist; it protects material recurrence from the
// "yeah yeah same storyline" garbage disposal.

const hasMaterialRecurrenceCue = (event) => {
  const text = normalizeText(eventText(event));

  return /\b(?:incident|incidents|clash|clashes|skirmish|skirmishes|strike|strikes|protest|protests|riot|riots|unrest|detention|detentions|arrest|arrests|sanction|sanctions|embargo|blockade|shortage|shortages|disruption|disruptions|breakdown|breakdowns|failure|failures|casualty|casualties|killed|wounded|violence|violent|mutiny|mutinies|default|bankruptcy|bankruptcies|epidemic|outbreak|sabotage|collision|accident|losses|walkout|walkouts|shutdown|suspension|withdrawal)\b/.test(
    text,
  );
};

// ---- deterministic prior-history retrieval ---------------------------------

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "upon",
  "under",
  "over",
  "after",
  "before",
  "through",
  "between",
  "among",
  "that",
  "this",
  "these",
  "those",
  "their",
  "there",
  "while",
  "where",
  "which",
  "following",
  "recent",
  "further",
  "again",

  "government",
  "imperial",
  "royal",
  "ministry",
  "authorities",
  "officials",
  "delegates",
  "commission",
  "committee",

  "meeting",
  "meets",
  "convenes",
  "reports",
  "report",
  "announces",
  "announced",
  "successfully",
  "formal",
  "formally",

  "new",
  "latest",
  "current",
  "continued",
  "continuing",
  "ongoing",
  "effort",
  "efforts",
  "operation",
  "operations",

  "military",
  "naval",
  "army",
  "navy",
  "state",
  "states",
  "international",
  "joint",
  "bilateral",
  "local",
  "regional",
]);

const tokensForText = (text) =>
  normalizeText(text)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

const eventTokens = (event) => {
  const title = tokensForText(event?.title);
  const description = tokensForText(event?.description);

  // titles count twice because they're usually the least bullshit part.
  return [...title, ...title, ...description];
};

const buildIdf = (events) => {
  const documentFrequency = new Map();

  for (const event of events) {
    for (const token of new Set(eventTokens(event))) {
      documentFrequency.set(
        token,
        (documentFrequency.get(token) || 0) + 1,
      );
    }
  }

  const total = Math.max(1, events.length);
  const result = new Map();

  for (const [token, count] of documentFrequency.entries()) {
    result.set(
      token,
      Math.log((total + 1) / (count + 1)) + 1,
    );
  }

  return result;
};

const weightedVector = (tokens, idf) => {
  const termFrequency = new Map();

  for (const token of tokens) {
    termFrequency.set(
      token,
      (termFrequency.get(token) || 0) + 1,
    );
  }

  const result = new Map();

  for (const [token, count] of termFrequency.entries()) {
    result.set(
      token,
      count * (idf.get(token) || 1),
    );
  }

  return result;
};

const cosineSimilarity = (aTokens, bTokens, idf) => {
  const a = weightedVector(aTokens, idf);
  const b = weightedVector(bTokens, idf);

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const value of a.values()) {
    normA += value * value;
  }

  for (const value of b.values()) {
    normB += value * value;
  }

  if (!normA || !normB) return 0;

  for (const [token, aValue] of a.entries()) {
    const bValue = b.get(token);

    if (bValue) {
      dot += aValue * bValue;
    }
  }

  return dot / Math.sqrt(normA * normB);
};

const retrievePriorMatches = (candidate, priorEvents) => {
  const canonical = asArray(priorEvents);

  const lookback = canonical.slice(
    -CONFIG.historyLookbackEvents,
  );

  const idf = buildIdf([
    ...lookback,
    candidate,
  ]);

  const candidateTokens = eventTokens(candidate);

  return lookback
    .map((event, localIndex) => ({
      priorIndex:
        canonical.length -
        lookback.length +
        localIndex,

      event,

      similarity: cosineSimilarity(
        candidateTokens,
        eventTokens(event),
        idf,
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CONFIG.priorMatchesPerCandidate);
};

// ---- duplicate guard --------------------------------------------------------

const deterministicNearDuplicate = (
  candidate,
  priorMatches,
) => {
  const candidateText = normalizeText(eventText(candidate));
  const candidateDate = normalizeString(candidate?.date);

  for (const match of priorMatches) {
    if (
      candidateDate &&
      candidateDate === normalizeString(match.event?.date) &&
      normalizeText(eventText(match.event)) === candidateText
    ) {
      return {
        duplicate: true,
        priorIndex: match.priorIndex,
        similarity: 1,
        reason: "same-date exact normalized duplicate",
      };
    }
  }

  return {
    duplicate: false,
  };
};

// ---- analyst packets --------------------------------------------------------

const buildCandidatePacket = (event, index) => ({
  index,
  date: normalizeString(event?.date),
  title: normalizeString(event?.title),
  description: normalizeString(event?.description),
  importance: normalizeString(event?.importance),
  kind: normalizeString(event?.kind),
  playerRelated: event?.playerRelated === true,
  notable: event?.notable === true,

  impacts: {
    regionTransfers: cloneValue(
      asArray(event?.impacts?.regionTransfers),
    ),

    polityChanges: cloneValue(
      asArray(event?.impacts?.polityChanges),
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
});

const buildPriorHistoryPacket = (priorEvents) => {
  const canonical = asArray(priorEvents);
  const window = canonical.slice(-50);
  const startIndex = canonical.length - window.length;

  return window.map((event, offset) => ({
    priorIndex: startIndex + offset,
    date: normalizeString(event?.date),
    title: normalizeString(event?.title),
    description: normalizeString(event?.description),
    importance: normalizeString(event?.importance),
  }));
};

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

// ---- deterministic enforcement ---------------------------------------------

const evaluateCandidate = ({
  event,
  index,
  judgment,
  priorEvents,
  saturationByStoryline,
}) => {
  const model = normalizeJudgment(
    judgment,
    event,
    index,
  );

  const priorMatches = retrievePriorMatches(
    event,
    priorEvents,
  );

  const retrievedMap = new Map(
    priorMatches.map((match) => [
      match.priorIndex,
      Number(match.similarity) || 0,
    ]),
  );

  const groundedPriorEvidence =
    model.matchedPriorIndexes
      .filter((priorIndex) =>
        retrievedMap.has(priorIndex),
      )
      .map((priorIndex) => ({
        priorIndex,
        similarity:
          retrievedMap.get(priorIndex),
      }));

  const ignoredPriorIndexes =
    model.matchedPriorIndexes.filter(
      (priorIndex) =>
        !retrievedMap.has(priorIndex),
    );

  const strongCount =
    groundedPriorEvidence.filter(
      (entry) =>
        entry.similarity >=
        CONFIG.groundedStrongSimilarity,
    ).length;

  const moderateCount =
    groundedPriorEvidence.filter(
      (entry) =>
        entry.similarity >=
        CONFIG.groundedModerateSimilarity,
    ).length;

  const groundedEvidencePass =
    strongCount >= 1 ||
    moderateCount >=
      CONFIG.groundedModerateCount;

  const saturation =
    saturationByStoryline.get(
      storylineKey(model.storyline),
    ) || null;

  const recentStorylineCount =
    Number(saturation?.count) || 0;

  const storylineSaturated =
    saturation?.saturation === "saturated" ||
    recentStorylineCount >=
      CONFIG.saturationHardCount;

  const deterministicNativeProcessCue =
    hasNativeProcessFrameCue(event);

  const nativeProcessEvidenceRequired =
    model.processFramePresent === true ||
    deterministicNativeProcessCue;

  const normalizedOutcomeEvidence =
    normalizeText(
      model.observableOutcomeEvidence,
    );

  const normalizedEventProse =
    normalizeText(eventText(event));

  const nativeOutcomeEvidenceProspective =
    nativeProcessEvidenceRequired &&
    normalizedOutcomeEvidence.length >= 6 &&
    isProspectiveOutcomeEvidence(
      event,
      model.observableOutcomeEvidence,
    );

  const nativeObservableOutcomeGrounded =
    !nativeProcessEvidenceRequired ||
    (
      normalizedOutcomeEvidence.length >= 6 &&
      normalizedEventProse.includes(
        normalizedOutcomeEvidence,
      ) &&
      !nativeOutcomeEvidenceProspective
    );

  const nativePureProcessFiller =
    model.pureProcessFiller === true ||
    (
      nativeProcessEvidenceRequired &&
      !nativeObservableOutcomeGrounded
    );

  const materialRecurrenceCue =
    hasMaterialRecurrenceCue(event);

  const establishedLowValueIncremental =
    recentStorylineCount >=
      CONFIG.lowValueIncrementalMinimumPriorCount &&
    model.confidence >=
      CONFIG.lowValueIncrementalConfidenceFloor &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    model.worthwhile === false &&
    model.personalityTexture === false &&
    !materialRecurrenceCue;

  const routineProcessRecurrenceOverride =
    model.recurrenceMatters === true &&
    !materialRecurrenceCue &&
    (
      (
        nativeProcessEvidenceRequired &&
        model.incrementalProcess === true &&
        model.qualitativeAdvance === false &&
        model.worthwhile === false &&
        model.personalityTexture === false
      ) ||
      establishedLowValueIncremental
    );

  const effectiveRecurrenceMatters =
    model.recurrenceMatters === true &&
    !routineProcessRecurrenceOverride;

  const impacts =
    structuredImpactReasons(event);

  const deterministicDuplicate =
    deterministicNearDuplicate(
      event,
      priorMatches,
    );

  let wouldAction = "KEEP";
  let route = "PRESUME_KEEP";
  let enforcementReason = "default KEEP";
  let hard = false;

  // impacts always win. if the event actually mutates the world, timeline space
  // is the least of our fucking concerns.
  if (impacts.length) {
    route = "STRUCTURED_IMPACT_KEEP";

    enforcementReason =
      `structured impacts: ${impacts.join(", ")}`;
  }

  else if (
    deterministicDuplicate.duplicate
  ) {
    wouldAction = "DROP";
    route = "EXACT_DUPLICATE";

    enforcementReason =
      deterministicDuplicate.reason;
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
        "grounded redundancy: specific prior evidence + no material novelty + recurrence immaterial";
    } else {
      route = "REDUNDANCY_FAIL_OPEN";

      const failures = [];

      if (!confidencePass) {
        failures.push(
          "low analyst confidence",
        );
      }

      if (!groundedEvidencePass) {
        failures.push(
          "insufficient grounded prior evidence",
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
    const noTrigger =
      !model.newTriggerAfterPriorPosture ||
      /^none$/i.test(
        model.newTriggerAfterPriorPosture,
      );

    if (
      model.confidence >=
        CONFIG.reversalDropConfidence &&
      groundedEvidencePass &&
      noTrigger
    ) {
      wouldAction = "DROP";
      route = "UNSUPPORTED_REVERSAL";
      hard = true;

      enforcementReason =
        "explicit grounded same-storyline reversal without a new trigger";
    } else {
      route = "REVERSAL_FAIL_OPEN";

      enforcementReason =
        "reversal claim lacked sufficient grounded evidence/confidence";
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
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    effectiveRecurrenceMatters === false &&
    model.worthwhile === false &&
    model.personalityTexture === false
  ) {
    wouldAction = "DROP";
    route = "NATIVE_PROCESS_FILLER";

    enforcementReason =
      "process-only native event: no analyst-quoted completed observable outcome grounded in title/description";
  }

  // completed micro-outcomes can still be boring as shit once a storyline has
  // already established itself several times.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    establishedLowValueIncremental &&
    effectiveRecurrenceMatters === false
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

  // old saturated-storyline guard. even here we still require grounded history,
  // high confidence, no qualitative advance and no meaningful recurrence.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    storylineSaturated &&
    model.confidence >=
      CONFIG.saturatedIncrementalConfidenceFloor &&
    groundedEvidencePass &&
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
      "grounded prior evidence + high-confidence incremental process + no qualitative advance/meaningful recurrence";
  }

  return {
    index,
    event,

    wouldAction,

    // audit means javascript may decide DROP and we still ignore it.
    actualAction: "KEEP",

    hard,
    route,
    enforcementReason,

    structuredImpacts: impacts,

    priorMatches: priorMatches.map(
      (match) => ({
        priorIndex: match.priorIndex,
        similarity: Number(
          match.similarity.toFixed(3),
        ),
        date:
          normalizeString(
            match.event?.date,
          ),
        title:
          normalizeString(
            match.event?.title,
          ),
      }),
    ),

    groundedPriorEvidence,
    ignoredPriorIndexes,
    groundedEvidencePass,

    deterministicDuplicate,

    storylineSaturation:
      saturation
        ? cloneValue(saturation)
        : null,

    storylineSaturated,
    recentStorylineCount,

    deterministicNativeProcessCue,
    nativeProcessEvidenceRequired,
    nativeOutcomeEvidenceProspective,
    nativeObservableOutcomeGrounded,
    nativePureProcessFiller,

    materialRecurrenceCue,
    routineProcessRecurrenceOverride,
    effectiveRecurrenceMatters,
    establishedLowValueIncremental,

    ...model,
  };
};

// ---- supported turn types ---------------------------------------------------

const shouldCurateMode = (mode) =>
  mode === "jump" || mode === "auto";

// ---- main curator -----------------------------------------------------------

export const curateGeneratedEvents = async ({
  events = [],
  priorEvents = [],
  game = {},
  world = {},
  actions = [],
  mode = "",
  analyzeBatch = null,
} = {}) => {
  const incoming = asArray(events);

  if (!shouldCurateMode(mode)) {
    return incoming;
  }

  const eventSummaries =
    incoming.map(summarizeEvent);

  let analysisResult = null;
  let analysisError = "";

  if (
    incoming.length &&
    typeof analyzeBatch === "function"
  ) {
    try {
      analysisResult =
        await analyzeBatch({
          candidates:
            incoming.map(
              buildCandidatePacket,
            ),

          priorHistory:
            buildPriorHistoryPacket(
              priorEvents,
            ),
        });
    } catch (error) {
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
      storylineKey(row?.storyline);

    if (key) {
      saturationByStoryline.set(
        key,
        row,
      );
    }
  }

  const evaluations =
    incoming.map(
      (event, index) =>
        evaluateCandidate({
          event,
          index,

          judgment:
            judgmentByIndex.get(index),

          priorEvents,
          saturationByStoryline,
        }),
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

        grounded:
          entry.groundedEvidencePass,

        route:
          entry.route,

        wouldAction:
          entry.wouldAction,

        actualAction:
          "KEEP — AUDIT",
      }),
    );

  lastAudit = {
    version: VERSION,
    mode: "audit",
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
      incoming.length,

    droppedCount: 0,

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

  console.group(
    `[OH Native Timeline Curator v${VERSION}] DETERMINISTIC AUDIT — ${incoming.length} generated event(s)`,
  );

  console.log({
    gameDate:
      lastAudit.gameDate,

    round:
      lastAudit.round,

    simulationMode:
      mode,

    priorEventCount:
      lastAudit.priorEventCount,

    plannedActionCount:
      lastAudit.plannedActionCount,

    analysisSource:
      lastAudit.analysisSource,

    analysisFallbackReason:
      lastAudit.analysisFallbackReason ||
      "—",

    wouldKeep:
      wouldKeepCount,

    wouldDrop:
      wouldDropCount,

    actualDropped:
      0,
  });

  if (eventSummaries.length) {
    console.log("native events:");
    console.table(
      eventSummaries,
    );
  }

  if (judgmentRows.length) {
    console.log(
      "deterministic curator:",
    );

    console.table(
      judgmentRows,
    );
  }

  if (
    lastAudit
      .storylineSaturation
      .length
  ) {
    console.log(
      "recent storyline saturation:",
    );

    console.table(
      lastAudit
        .storylineSaturation,
    );
  }

  if (analysisError) {
    console.warn(
      "analyst error:",
      analysisError,
    );
  }

  console.log(
    `audit only — javascript would drop ${wouldDropCount} event(s), but all ${incoming.length} native events are still being returned unchanged.`,
  );

  console.groupEnd();

  // yes, this deliberately ignores wouldAction.
  // v0.3 gets opinions, not ammunition.
  return incoming;
};

export const getLastNativeCuratorAudit =
  () => lastAudit;

if (typeof window !== "undefined") {
  window.__OH_NATIVE_TIMELINE_CURATOR__ = {
    version: VERSION,
    mode: "audit",
    config: CONFIG,
    last: () => lastAudit,
  };
}