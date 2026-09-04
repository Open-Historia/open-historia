// OpenHistoria Continuum — turn performance profiler R4
//
// Observational only. No simulation state is read or mutated here.
// It records complete-turn wall time, AI-call/retry cost, coarse stage timing,
// and foreground event-loop starvation. Console output is emitted ONCE at the
// end of a timeline jump and the full summary is exposed as
// window.__OH_LAST_TURN_PERF__ for copy/paste debugging.

const perfNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const STALL_SAMPLE_MS = 100;
const STALL_RECORD_THRESHOLD_MS = 50;

let activeTrace = null;
let stageSequence = 0;

const finiteMs = (value) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
const round1 = (value) => Math.round(finiteMs(value) * 10) / 10;

const addStageStall = (trace, stageName, duration) => {
  if (!(duration > 0)) return;
  const name = stageName || "unattributed";
  const prior = trace.stallByStage.get(name) || {
    stage: name,
    count: 0,
    totalMs: 0,
    maxMs: 0,
  };
  prior.count += 1;
  prior.totalMs += duration;
  prior.maxMs = Math.max(prior.maxMs, duration);
  trace.stallByStage.set(name, prior);
};

// Attribute a delayed heartbeat by INTERSECTING the actual delayed interval with
// recorded stage windows. R3 simply asked "which async stage is open when the
// timer finally wakes up?", which could blame an 8.8s stall on a stage whose
// entire lifetime was only 2s. This partition is physically bounded: no segment
// attributed to a stage can lie outside that stage's own [start,end] window.
export const attributeTurnPerfStallInterval = (trace, stallStart, stallEnd) => {
  if (!trace || !(stallEnd > stallStart)) return [];

  const windows = [...(trace.stageWindows?.values?.() || [])]
    .map((window) => ({
      ...window,
      endedAt: Number.isFinite(window.endedAt) ? window.endedAt : stallEnd,
    }))
    .filter((window) => window.endedAt > stallStart && window.startedAt < stallEnd);

  const boundaries = new Set([stallStart, stallEnd]);
  for (const window of windows) {
    boundaries.add(Math.max(stallStart, window.startedAt));
    boundaries.add(Math.min(stallEnd, window.endedAt));
  }
  const points = [...boundaries].filter(Number.isFinite).sort((a, b) => a - b);
  const allocations = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!(to > from)) continue;
    const midpoint = from + (to - from) / 2;
    const active = windows
      .filter((window) => window.startedAt <= midpoint && window.endedAt >= midpoint)
      // Prefer the most deeply/narrowly nested stage when several async wrappers
      // overlap. This preserves useful fine-grained attribution without double-
      // counting the same blocked milliseconds in parent and child stages.
      .sort((a, b) => b.startedAt - a.startedAt || a.endedAt - b.endedAt);
    const stage = active[0]?.name || "unattributed";
    const duration = to - from;
    addStageStall(trace, stage, duration);
    allocations.push({ stage, from, to, ms: duration });
  }

  return allocations;
};

const startStallProbe = (trace) => {
  if (typeof window === "undefined" || typeof setInterval !== "function") return;

  let previous = perfNow();
  trace.stallTimer = setInterval(() => {
    const now = perfNow();

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      previous = now;
      return;
    }

    const interval = Math.max(0, now - previous);
    const expectedWake = previous + STALL_SAMPLE_MS;
    previous = now;
    const excess = Math.max(0, interval - STALL_SAMPLE_MS);

    if (excess >= STALL_RECORD_THRESHOLD_MS) {
      trace.stallCount += 1;
      trace.maxMainThreadStallMs = Math.max(trace.maxMainThreadStallMs, excess);
      trace.totalMainThreadStallMs += excess;
      trace.stallIntervals.push({ start: expectedWake, end: now, ms: excess });
      attributeTurnPerfStallInterval(trace, expectedWake, now);
    }
  }, STALL_SAMPLE_MS);
};

const stopStallProbe = (trace) => {
  if (trace?.stallTimer) clearInterval(trace.stallTimer);
  if (trace) trace.stallTimer = null;
};

export const beginTurnPerfTrace = (meta = {}) => {
  if (activeTrace) {
    stopStallProbe(activeTrace);
  }

  activeTrace = {
    id: `turn-perf-${Date.now().toString(36)}`,
    startedAt: perfNow(),
    endedAt: 0,
    meta: { ...meta },
    stages: [],
    aiAttempts: [],
    retries: [],
    fallbacks: [],
    stallCount: 0,
    maxMainThreadStallMs: 0,
    totalMainThreadStallMs: 0,
    activeStages: [],
    stageWindows: new Map(),
    stallByStage: new Map(),
    stallIntervals: [],
    stallTimer: null,
  };
  startStallProbe(activeTrace);
  return activeTrace.id;
};

export const updateTurnPerfMeta = (patch = {}) => {
  if (!activeTrace) return;
  activeTrace.meta = { ...activeTrace.meta, ...patch };
};

export const beginTurnPerfStage = (name, meta = {}) => {
  if (!activeTrace) return null;
  const token = {
    traceId: activeTrace.id,
    id: ++stageSequence,
    name: String(name || "stage"),
    startedAt: perfNow(),
    meta: { ...meta },
  };
  activeTrace.activeStages.push(token);
  activeTrace.stageWindows.set(token.id, {
    id: token.id,
    name: token.name,
    startedAt: token.startedAt,
    endedAt: null,
  });
  return token;
};

export const endTurnPerfStage = (token, meta = {}) => {
  if (!activeTrace || !token || token.traceId !== activeTrace.id) return 0;
  const ms = Math.max(0, perfNow() - token.startedAt);
  activeTrace.stages.push({
    id: token.id,
    name: token.name,
    ms,
    meta: { ...token.meta, ...meta },
  });
  const activeIndex = activeTrace.activeStages.findIndex((entry) => entry.id === token.id);
  if (activeIndex >= 0) activeTrace.activeStages.splice(activeIndex, 1);
  const stageWindow = activeTrace.stageWindows.get(token.id);
  if (stageWindow) stageWindow.endedAt = token.startedAt + ms;
  return ms;
};

export const measureTurnPerfStage = async (name, fn, meta = {}) => {
  const token = beginTurnPerfStage(name, meta);
  try {
    return await fn();
  } finally {
    endTurnPerfStage(token);
  }
};

export const recordTurnPerfAiAttempt = ({
  taskKey,
  attempt = 1,
  ms = 0,
  error = "",
} = {}) => {
  if (!activeTrace) return;
  activeTrace.aiAttempts.push({
    taskKey: String(taskKey || "unknown"),
    attempt: Math.max(1, Number(attempt) || 1),
    ms: finiteMs(ms),
    error: String(error || ""),
  });
};

export const recordTurnPerfRetry = ({ taskKey, reason = "" } = {}) => {
  if (!activeTrace) return;
  activeTrace.retries.push({
    taskKey: String(taskKey || "unknown"),
    reason: String(reason || "").slice(0, 500),
  });
};

export const recordTurnPerfFallback = ({ taskKey, reason = "" } = {}) => {
  if (!activeTrace) return;
  activeTrace.fallbacks.push({
    taskKey: String(taskKey || "unknown"),
    reason: String(reason || "").slice(0, 500),
  });
};

const aggregateBy = (rows, keyFn, valueFn) => {
  const map = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    const prior = map.get(key) || { key, count: 0, ms: 0 };
    prior.count += 1;
    prior.ms += finiteMs(valueFn(row));
    map.set(key, prior);
  }
  return [...map.values()]
    .map((entry) => ({ ...entry, ms: round1(entry.ms) }))
    .sort((a, b) => b.ms - a.ms || b.count - a.count || a.key.localeCompare(b.key));
};


const normalizeStallIntervals = (rows = []) =>
  (rows || []).map((row) => ({
    start: round1(row?.start),
    end: round1(row?.end),
    ms: round1(row?.ms),
  }));

export const buildTurnPerfSummary = (trace, extra = {}) => {
  const endedAt = trace?.endedAt || perfNow();
  const startedAt = trace?.startedAt || endedAt;
  const aiAttempts = trace?.aiAttempts || [];
  const stages = trace?.stages || [];
  const retries = trace?.retries || [];
  const fallbacks = trace?.fallbacks || [];

  const aiByTask = aggregateBy(
    aiAttempts,
    (row) => row.taskKey || "unknown",
    (row) => row.ms,
  ).map((entry) => ({
    taskKey: entry.key,
    calls: entry.count,
    ms: entry.ms,
  }));

  const stageByName = aggregateBy(
    stages,
    (row) => row.name || "stage",
    (row) => row.ms,
  ).map((entry) => ({
    stage: entry.key,
    calls: entry.count,
    ms: entry.ms,
  }));

  const stallByStage = [...(trace?.stallByStage?.values?.() || [])]
    .map((entry) => ({
      stage: entry.stage,
      count: entry.count,
      totalMs: round1(entry.totalMs),
      maxMs: round1(entry.maxMs),
    }))
    .sort((a, b) => b.totalMs - a.totalMs || b.maxMs - a.maxMs || a.stage.localeCompare(b.stage));

  return {
    version: "R4",
    ...trace?.meta,
    ...extra,
    wallMs: round1(Math.max(0, endedAt - startedAt)),
    aiCalls: aiAttempts.length,
    aiRetryCount: retries.length,
    aiFallbackCount: fallbacks.length,
    cumulativeAiMs: round1(aiAttempts.reduce((sum, row) => sum + finiteMs(row.ms), 0)),
    longestAiCallMs: round1(aiAttempts.reduce((max, row) => Math.max(max, finiteMs(row.ms)), 0)),
    maxMainThreadStallMs: round1(trace?.maxMainThreadStallMs),
    totalMainThreadStallMs: round1(trace?.totalMainThreadStallMs),
    mainThreadStallCount: Math.max(0, Number(trace?.stallCount) || 0),
    aiByTask,
    stageByName,
    stallByStage,
    stallIntervals: normalizeStallIntervals(trace?.stallIntervals),
    retries: retries.map((row) => ({ ...row })),
    fallbacks: fallbacks.map((row) => ({ ...row })),
  };
};

const seconds = (ms) => `${(finiteMs(ms) / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;

export const formatTurnPerfSummary = (summary = {}) => {
  const round = summary.round ? ` R${summary.round}` : "";
  const dates =
    summary.originDate || summary.targetDate
      ? ` · ${summary.originDate || "?"} → ${summary.targetDate || "?"}`
      : "";

  const ai = (summary.aiByTask || [])
    .slice(0, 8)
    .map((row) => `${row.taskKey} ${row.calls}×/${seconds(row.ms)}`)
    .join(" · ") || "none";

  const stages = (summary.stageByName || [])
    .slice(0, 8)
    .map((row) => `${row.stage} ${seconds(row.ms)}`)
    .join(" · ") || "none";

  const stalls = (summary.stallByStage || [])
    .slice(0, 6)
    .map((row) => `${row.stage} ${seconds(row.totalMs)} total/${Math.round(finiteMs(row.maxMs))}ms max`)
    .join(" · ") || "none";

  return [
    `[OH TURN PERF${round}] ${seconds(summary.wallMs)} wall${dates}`,
    `AI: ${summary.aiCalls || 0} call(s), ${summary.aiRetryCount || 0} validation retry(s), ${summary.aiFallbackCount || 0} fallback(s), ${seconds(summary.cumulativeAiMs)} cumulative, longest ${seconds(summary.longestAiCallMs)}`,
    `UI starvation: max ${Math.round(finiteMs(summary.maxMainThreadStallMs))}ms, total ${Math.round(finiteMs(summary.totalMainThreadStallMs))}ms across ${summary.mainThreadStallCount || 0} foreground stall(s)`,
    `AI by task: ${ai}`,
    `Stages: ${stages}`,
    `UI stalls by stage: ${stalls}`,
    `Full object: window.__OH_LAST_TURN_PERF__`,
  ].join("\n");
};

export const finishTurnPerfTrace = (extra = {}) => {
  if (!activeTrace) return null;
  const trace = activeTrace;
  trace.endedAt = perfNow();
  stopStallProbe(trace);
  activeTrace = null;

  const summary = buildTurnPerfSummary(trace, extra);

  if (typeof window !== "undefined") {
    window.__OH_LAST_TURN_PERF__ = summary;
  }

  console.info(formatTurnPerfSummary(summary));
  return summary;
};
