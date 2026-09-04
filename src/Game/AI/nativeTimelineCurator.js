/*! Open Historia — native timeline curator. */
// The model may suggest that a freshly generated event is redundant or not
// worth a timeline slot. Nothing is deleted on that opinion alone: the checks
// below verify it against the campaign's own history (retrieved prior matches,
// hard mechanical consequences, storyline saturation) before an event is
// dropped, and every failure of the analysis keeps everything. The default is
// KEEP.

const VERSION = "curator-1";

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
  saturatedRoutineMilitaryConfidenceFloor: 0.80,

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

  // Hard mechanical consequences deserve fail-open protection because dropping the
  // event would otherwise erase an actual map/control/unit/object/chat transition.
  for (const key of [
    "regionTransfers",
    "regionClaims",
    "regionControlOps",
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

// ---- process framing --------------------------------------------------------
// this does not mean "drop it". it means a meeting/review/etc has to prove
// that something actually happened.

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

// ---- vague process progress -------------------------------------------------
// "we made progress" is not a historical state transition.
// it may be true, but without a concrete agreement/decision/result it does not
// rescue an otherwise process-only event.

const isVagueProcessOutcomeEvidence = (evidence) => {
  const text = normalizeText(evidence);

  if (!text) return false;

  return /\b(?:make|makes|made|making)\s+(?:tangible\s+|significant\s+|substantial\s+|meaningful\s+)?progress\b|\b(?:talks?|discussions?|negotiations?)\s+(?:advance|advances|advanced|progress|progresses|progressed|continue|continues|continued)\b|\b(?:advance|advances|advanced)\s+(?:the\s+)?(?:talks?|discussions?|negotiations?)\b|\b(?:narrow|narrows|narrowed)\s+(?:the\s+)?(?:gap|gaps|difference|differences)\b|\bconstructive\s+(?:talks?|discussions?|negotiations?)\b|\bcautious\s+optimism\b|\bpositive\s+(?:step|movement|progress)\b|\bmove(?:s|d)?\s+closer\s+to\s+(?:agreement|accord|settlement)\b/.test(
    text,
  );
};


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
// "yeah yeah same storyline" filter.

const MATERIAL_RECURRENCE_TERM_RE =
  /\b(?:incident|incidents|clash|clashes|skirmish|skirmishes|strike|strikes|protest|protests|riot|riots|unrest|detention|detentions|arrest|arrests|sanction|sanctions|embargo|blockade|shortage|shortages|disruption|disruptions|breakdown|breakdowns|failure|failures|casualty|casualties|killed|wounded|violence|violent|mutiny|mutinies|default|bankruptcy|bankruptcies|epidemic|outbreak|sabotage|collision|accident|losses|walkout|walkouts|shutdown|suspension|withdrawal)\b/g;

const recurrenceCueIsNegated = (text, cueIndex) => {
  const prefix = text
    .slice(Math.max(0, cueIndex - 72), cueIndex)
    .trimEnd();

  return /(?:\bwithout|\bno|\bnot|\bneither|\babsence of|\bfree of|\bavoided|\baverted|\bprevented)(?:\s+[a-z0-9]+){0,5}$/.test(
    prefix,
  );
};

const hasMaterialRecurrenceCue = (event) => {
  const text = normalizeText(eventText(event));
  if (!text) return false;

  MATERIAL_RECURRENCE_TERM_RE.lastIndex = 0;
  let match;

  while ((match = MATERIAL_RECURRENCE_TERM_RE.exec(text))) {
    if (!recurrenceCueIsNegated(text, match.index)) return true;
  }

  return false;
};

// Routine military recurrence is where saturated war storylines most often
// game the generic recurrence safety valve: another probe/skirmish/artillery
// exchange gets labelled "recurrence matters" despite changing nothing. This
// cue never drops an event by itself; it only participates in the saturated,
// high-confidence, incremental/no-qualitative-advance gate below.
const hasRoutineMilitaryContinuationCue = (event) => {
  const text = normalizeText(eventText(event));
  if (!text) return false;

  const routineMilitaryNoun =
    /\b(?:artillery|barrage|bombardment|counter battery|counter-battery|patrol|patrols|probe|probing|skirmish|skirmishes|trench|trenches|frontline|frontlines|front line|front lines|entrenchment|entrenchments|cantonment|cantonments)\b/.test(text);

  const continuationFrame =
    /\b(?:continue|continues|continued|continuing|ongoing|periodic|sporadic|localized|localised|routine|again|renewed|exchange|exchanges|probe|probing|patrol|patrols|skirmish|skirmishes)\b/.test(text);

  return routineMilitaryNoun && continuationFrame;
};

const hasStrongMilitaryConsequenceCue = (event) => {
  const text = normalizeText(eventText(event));
  if (!text) return false;

  return /\b(?:breakthrough|breaks through|breach|breaches|captur(?:e|es|ed|ing)|seiz(?:e|es|ed|ing)|retreat|retreats|retreated|withdrawal|withdraws|withdrew|encircle|encirclement|surrender|surrenders|capitulat(?:e|es|ed|ion)|collapse|collapses|collapsed|destroy(?:s|ed|ing)|casualty|casualties|killed|wounded|losses|annihilat(?:e|es|ed|ion)|ceasefire|armistice|occupation|liberat(?:e|es|ed|ion)|control changes|changes control|front collapses|offensive begins|major offensive|general offensive)\b/.test(
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

  // titles count twice because they're usually the most reliable part.
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

// the analyst may cite one mediocre prior event while javascript is sitting
// here staring at five much better matches. use our own retrieval evidence
// for saturated-churn detection instead of pretending that makes sense.
const retrievalStrongCount =
  priorMatches.filter(
    (match) =>
      match.similarity >=
      CONFIG.groundedStrongSimilarity,
  ).length;

const retrievalModerateCount =
  priorMatches.filter(
    (match) =>
      match.similarity >=
      CONFIG.groundedModerateSimilarity,
  ).length;

const retrievalEvidencePass =
  retrievalStrongCount >= 1 ||
  retrievalModerateCount >=
    CONFIG.groundedModerateCount;

    // sometimes the analyst correctly points at one prior event, but that single
// match lands just under our similarity threshold while the retriever finds
// several other strong related matches. in that case the evidence isn't
// magically wrong just because one number missed 0.40 by a hair.
const retrievalAssistedRedundancyPass =
  model.confidence >= 0.95 &&
  groundedPriorEvidence.length >= 1 &&
  retrievalEvidencePass &&
  /^none$/i.test(
    model.newTriggerAfterPriorPosture,
  );

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

  const nativeOutcomeEvidenceVague =
    nativeProcessEvidenceRequired &&
    normalizedOutcomeEvidence.length >= 6 &&
    isVagueProcessOutcomeEvidence(
    model.observableOutcomeEvidence,
  );    
const nativeObservableOutcomeGrounded =
  !nativeProcessEvidenceRequired ||
  (
    normalizedOutcomeEvidence.length >= 6 &&
    normalizedEventProse.includes(
      normalizedOutcomeEvidence,
    ) &&
    !nativeOutcomeEvidenceProspective &&
    !nativeOutcomeEvidenceVague
  );

  const nativePureProcessFiller =
    model.pureProcessFiller === true ||
    (
      nativeProcessEvidenceRequired &&
      !nativeObservableOutcomeGrounded
    );

  const materialRecurrenceCue =
    hasMaterialRecurrenceCue(event);

  const routineMilitaryContinuationCue =
    hasRoutineMilitaryContinuationCue(event);

  const strongMilitaryConsequenceCue =
    hasStrongMilitaryConsequenceCue(event);

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
}

else if (
  retrievalAssistedRedundancyPass &&
  noNewDimensions &&
  semanticPass &&
  model.qualitativeAdvance === false
) {
  wouldAction = "DROP";
  route =
    "RETRIEVAL_ASSISTED_REDUNDANCY";

  enforcementReason =
    "high-confidence redundancy: analyst cited retrieved prior history + deterministic retrieval independently found sufficient supporting evidence + no new trigger/material novelty";
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
      "process-only native event: no analyst-quoted completed observable outcome grounded in title/description";
  }

  // completed micro-outcomes can still be unremarkable once a storyline has
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

  // Universal routine-military no-delta gate. Saturation is useful evidence but
  // must NOT be required: otherwise the exact same artillery/patrol/probe loop
  // escapes as soon as its recent count cools from "saturated" to "busy", then
  // rebuilds the saturation again. If the analyst itself says the event is
  // incremental and not a qualitative advance, and the prose contains no concrete
  // military consequence, recurrence/grounding/worthwhile labels cannot buy a card.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    model.confidence >= CONFIG.saturatedRoutineMilitaryConfidenceFloor &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    model.personalityTexture === false &&
    routineMilitaryContinuationCue &&
    !strongMilitaryConsequenceCue
  ) {
    wouldAction = "DROP";
    route = "ROUTINE_MILITARY_NO_DELTA";

    enforcementReason =
      `routine military continuation with no material delta: ${
        saturation?.storyline ||
        model.storyline
      }; incremental/no qualitative advance and no concrete military consequence`;
  }

  // Saturated military loops retain the older stronger labelled backstop for any
  // cases not caught above. Concrete consequences (casualties, breakthrough,
  // capture, retreat, ceasefire, etc.) and qualitative advances still survive.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    storylineSaturated &&
    model.confidence >=
      CONFIG.saturatedRoutineMilitaryConfidenceFloor &&
    model.incrementalProcess === true &&
    model.qualitativeAdvance === false &&
    model.personalityTexture === false &&
    routineMilitaryContinuationCue &&
    !strongMilitaryConsequenceCue
  ) {
    wouldAction = "DROP";
    route = "SATURATED_ROUTINE_MILITARY_CHURN";

    enforcementReason =
      `saturated routine military continuation: ${
        saturation?.storyline ||
        model.storyline
      } (${recentStorylineCount} recent); ` +
      "incremental/no qualitative advance and no concrete military consequence";
  }

  // old saturated-storyline guard. even here we still require grounded history,
  // high confidence, no qualitative advance and no meaningful recurrence.
  if (
    wouldAction === "KEEP" &&
    impacts.length === 0 &&
    storylineSaturated &&
      model.confidence >=
      CONFIG.saturatedIncrementalConfidenceFloor &&
      retrievalEvidencePass &&
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

// live mode means the deterministic decision actually counts now.
actualAction: wouldAction,

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
      retrievalStrongCount,
      retrievalModerateCount,
      retrievalEvidencePass,
      retrievalAssistedRedundancyPass,

    deterministicDuplicate,

    storylineSaturation:
      saturation
        ? cloneValue(saturation)
        : null,

    storylineSaturated,
    recentStorylineCount,

    deterministicNativeProcessCue,
    nativeProcessEvidenceRequired,
    nativeOutcomeEvidenceVague,
    nativeOutcomeEvidenceProspective,
    nativeObservableOutcomeGrounded,
    nativePureProcessFiller,
materialRecurrenceCue,
    routineMilitaryContinuationCue,
    strongMilitaryConsequenceCue,
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

        routineMilitary:
          entry.routineMilitaryContinuationCue,

        militaryConsequence:
          entry.strongMilitaryConsequenceCue,

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

  // alright, no more training wheels.
return keptEvents;
};

export const getLastNativeCuratorAudit =
  () => lastAudit;

const runNativeCuratorSelfTests = () => {
  const make = (description) => ({
    title: "Test",
    description,
    impacts: {
      createdChats: [],
      polityChanges: [],
      regionTransfers: [],
      regionClaims: [],
      unitOps: [],
      markerOps: [],
    },
  });

  const cases = [
    {
      name: "real disruption counts as material recurrence",
      pass: hasMaterialRecurrenceCue(
        make("Repeated shortages and transport disruption spread across the district."),
      ) === true,
    },
    {
      name: "without disruption is not material recurrence",
      pass: hasMaterialRecurrenceCue(
        make("Spring sowing concludes without major domestic disruption."),
      ) === false,
    },
    {
      name: "no shortages is not material recurrence",
      pass: hasMaterialRecurrenceCue(
        make("Officials report no shortages or unrest during the distribution period."),
      ) === false,
    },
  ];

  const passed = cases.every((entry) => entry.pass);
  console.table(cases);
  console.info(
    `[OH Native Timeline Curator self-test] ${passed ? "PASS" : "FAIL"} — ` +
    `${cases.filter((entry) => entry.pass).length}/${cases.length}`,
  );

  return { passed, cases };
};

if (typeof window !== "undefined") {
  window.__OH_NATIVE_TIMELINE_CURATOR__ = {
    version: VERSION,
    mode: "live",
    config: CONFIG,
    last: () => lastAudit,
    selfTest: () => runNativeCuratorSelfTests(),
  };
}
