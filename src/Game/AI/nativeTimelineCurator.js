/*!
 * open historia enhanced — native timeline curator
 * v0.2.0 — semantic audit
 *
 * the curator now lives inside the actual turn pipeline and can ask the game's
 * own ai infrastructure to judge the generated batch. revolutionary stuff:
 * no fetch stalking, no polling, no guessing whether history exists yet.
 */

const VERSION = "0.2.0-audit";

let lastAudit = null;

const normalizeString = (value) => String(value ?? "").trim();

const cloneValue = (value) => {
  try {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const asArray = (value) => Array.isArray(value) ? value : [];

// ---- pretty console summary -------------------------------------------------

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

// ---- analyst packets --------------------------------------------------------
// don't ship the entire fucking world object into a second ai call.
// the analyst needs canonical history and the actual candidate events.

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
    regionTransfers: cloneValue(asArray(event?.impacts?.regionTransfers)),
    polityChanges: cloneValue(asArray(event?.impacts?.polityChanges)),
    unitOps: cloneValue(asArray(event?.impacts?.unitOps)),
    markerOps: cloneValue(asArray(event?.impacts?.markerOps)),
    createdChats: cloneValue(asArray(event?.impacts?.createdChats)),
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

// ---- supported turn types ---------------------------------------------------
// gm commands also wander through applySimulationResult because apparently one
// function is responsible for half the fucking game. leave them alone for now.

const shouldCurateMode = (mode) =>
  mode === "jump" || mode === "auto";

/**
 * native curator choke point.
 *
 * v0.2 is still audit only.
 *
 * the semantic analyst now runs here, but every event still survives.
 * deletion permission comes later after this thing proves it has a brain.
 */
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

  const rows = incoming.map(summarizeEvent);

  let analysisResult = null;
  let analysisError = "";

  if (incoming.length && typeof analyzeBatch === "function") {
    try {
      analysisResult = await analyzeBatch({
        candidates: incoming.map(buildCandidatePacket),
        priorHistory: buildPriorHistoryPacket(priorEvents),
      });
    } catch (error) {
      analysisError = normalizeString(error?.message || error);
      console.warn(
        "[OH Native Timeline Curator] semantic analyst failed; keeping everything.",
        error,
      );
    }
  }

  const analysisPayload = analysisResult?.payload || null;
  const judgments = asArray(analysisPayload?.judgments);

  const judgmentByIndex = new Map();

  for (const judgment of judgments) {
    const index = Number(judgment?.index);

    if (!Number.isInteger(index) || index < 0 || index >= incoming.length) {
      continue;
    }

    judgmentByIndex.set(index, judgment);
  }

  const judgmentRows = incoming.map((event, index) => {
    const judgment = judgmentByIndex.get(index);

    return {
      index: index + 1,
      title: normalizeString(event?.title),
      verdict: normalizeString(judgment?.verdict) || "NO JUDGMENT",
      confidence: Number.isFinite(Number(judgment?.confidence))
        ? Number(judgment.confidence)
        : "—",
      storyline: normalizeString(judgment?.storyline) || "—",
      worthwhile: judgment?.worthwhile ?? "—",
      qualitative: judgment?.qualitativeAdvance ?? "—",
      incremental: judgment?.incrementalProcess ?? "—",
      processFiller: judgment?.pureProcessFiller ?? "—",

      // yes, even REDUNDANT still survives right now. we're observing,
      // not handing a loaded gun to version fucking 0.2.
      actualAction: "KEEP — AUDIT",
    };
  });

  lastAudit = {
    version: VERSION,
    mode: "audit",
    simulationMode: mode,
    gameDate: normalizeString(game?.gameDate),
    round: Number(game?.round) || 0,

    generatedCount: incoming.length,
    keptCount: incoming.length,
    droppedCount: 0,

    priorEventCount: asArray(priorEvents).length,
    plannedActionCount: asArray(actions)
      .filter((action) => action?.status === "planned")
      .length,

    analysisSource:
      normalizeString(analysisResult?.generation?.source) ||
      (analysisResult ? "unknown" : "not-run"),

    analysisFallbackReason:
      normalizeString(analysisResult?.generation?.fallbackReason),

    analysisError,

    eventSummaries: rows,

    // sometimes we need the actual fucking object instead of a postcard.
    events: cloneValue(incoming),

    judgments: cloneValue(judgments),
    judgmentRows: cloneValue(judgmentRows),

    storylineSaturation: cloneValue(
      asArray(analysisPayload?.storylineSaturation),
    ),

    underrepresentedDomains: cloneValue(
      asArray(analysisPayload?.underrepresentedDomains),
    ),

    recentHistoryMechanical:
      analysisPayload?.recentHistoryMechanical === true,

    rawAnalysis: cloneValue(analysisPayload),

    timestamp: new Date().toISOString(),
  };

  console.group(
    `[OH Native Timeline Curator v${VERSION}] SEMANTIC AUDIT — ${incoming.length} generated event(s)`,
  );

  console.log({
    gameDate: lastAudit.gameDate,
    round: lastAudit.round,
    simulationMode: mode,
    priorEventCount: lastAudit.priorEventCount,
    plannedActionCount: lastAudit.plannedActionCount,
    analysisSource: lastAudit.analysisSource,
    analysisFallbackReason: lastAudit.analysisFallbackReason || "—",
  });

  if (rows.length) {
    console.log("native events:");
    console.table(rows);
  }

  if (judgmentRows.length) {
    console.log("semantic analyst:");
    console.table(judgmentRows);
  }

  if (lastAudit.storylineSaturation.length) {
    console.log("recent storyline saturation:");
    console.table(lastAudit.storylineSaturation);
  }

  if (analysisError) {
    console.warn("analyst error:", analysisError);
  }

  console.log(
    "audit only — every native event is still returned unchanged because deletion privileges have not been granted yet.",
  );

  console.groupEnd();

  return incoming;
};

export const getLastNativeCuratorAudit = () => lastAudit;

if (typeof window !== "undefined") {
  window.__OH_NATIVE_TIMELINE_CURATOR__ = {
    version: VERSION,
    mode: "audit",
    last: () => lastAudit,
  };
}