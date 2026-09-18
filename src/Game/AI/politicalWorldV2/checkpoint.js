/*! Open Historia Continuum — Political World v2 checkpoint model */

export const POLITICAL_WORLD_V2_CHECKPOINT_KIND = "political-world-checkpoint-v2";
export const POLITICAL_WORLD_V2_CHECKPOINT_VERSION = 5;

export const POLITICAL_WORLD_V2_JOB_STATUSES = Object.freeze([
  "pending",
  "running",
  "completed",
  "failed",
  "paused",
  "skipped",
]);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const array = (value) => Array.isArray(value) ? value : [];
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const stableStringify = (value) => JSON.stringify(canonicalize(value));

// Browser-safe deterministic fingerprint. This is an invalidation token, not a
// cryptographic signature.
const fnv1a64 = (text) => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
};

const roundZeroFingerprintContext = (value = null) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    scenario: clone(value.scenario || null),
    universe: clone(value.universe || null),
    historyAuthority: clone(value.historyAuthority || null),
    referencePackIds: array(value.referencePackIds).map(clean).filter(Boolean).sort(),
    divergence: value.divergence && typeof value.divergence === "object" ? {
      date: clean(value.divergence.date),
      authoredText: String(value.divergence.authoredText ?? "").replace(/\r\n?/g, "\n").trim(),
    } : null,
    worldBeforeRoundOne: String(value.worldBeforeRoundOne ?? "").replace(/\r\n?/g, "\n").trim(),
    simulationRules: String(value.simulationRules ?? "").replace(/\r\n?/g, "\n").trim(),
  };
};

export const buildPoliticalWorldInputFingerprint = ({ scenarioId = "", scenarioDate = "", world = {}, game = {}, roundZeroContext = null } = {}) => {
  const source = object(world);
  const politicalInput = {
    scenarioId: clean(scenarioId),
    scenarioDate: clean(scenarioDate || game?.gameDate || game?.startDate),
    startingTimelineText: clean(source.startingTimelineText),
    simulationRules: clean(source.simulationRules),
    canonModelVersion: Number(source.canonModelVersion) || null,
    canonContext: clone(source.canonContext || null),
    roundZeroCanon: roundZeroFingerprintContext(roundZeroContext),
    polityOverrides: clone(source.polityOverrides || {}),
    ownerCodes: clone(source.ownerCodes || []),
    regionOwnershipOverrides: clone(source.regionOwnershipOverrides || {}),
    regionSovereigntyOverrides: clone(source.regionSovereigntyOverrides || {}),
    politicalActors: clone(source.politicalActors || {}),
    institutions: clone(source.institutions || {}),
    agreements: clone(source.agreements || []),
    wars: clone(source.wars || []),
    relations: clone(source.relations || []),
  };
  return `pw2-${fnv1a64(stableStringify(politicalInput))}`;
};

export const createPoliticalWorldV2Checkpoint = ({
  scenarioId = "",
  scenarioDate = "",
  inputFingerprint = "",
  stagedWorld = {},
  sourceRoundZeroContext = null,
  maxModelCalls = null,
  now = new Date().toISOString(),
} = {}) => ({
  kind: POLITICAL_WORLD_V2_CHECKPOINT_KIND,
  version: POLITICAL_WORLD_V2_CHECKPOINT_VERSION,
  scenarioId: clean(scenarioId),
  scenarioDate: clean(scenarioDate),
  inputFingerprint: clean(inputFingerprint),
  createdAt: now,
  updatedAt: now,
  status: "ready",
  pauseReason: "",
  lastError: "",
  modelCalls: 0,
  modelCallsByType: {},
  modelCallsByStage: {},
  maxModelCalls: Number.isFinite(Number(maxModelCalls)) && Number(maxModelCalls) >= 0
    ? Math.trunc(Number(maxModelCalls))
    : null,
  stages: { institutionDiscovery: "pending", institutionGovernance: "pending", agreements: "pending" },
  coverage: {
    "political-actor": [],
    "governing-alignment": [],
    "power-evidence": [],
    "historical-verification": [],
  },
  membership: { resolvedInstitutionIds: [] },
  verification: { challenges: {} },
  attempts: {},
  // Validation feedback that must survive one-call resumable attempts. This is
  // not canon; it only helps the next bounded provider request correct itself.
  retryContext: { politicalActor: {}, governingAlignment: {} },
  generationEntriesByPolity: {},
  warnings: [],
  currentTask: null,
  // Kept empty for UI/backward source compatibility. v3 normal execution does
  // not use a persisted self-mutating job graph.
  jobs: {},
  jobOrder: [],
  stagedWorld: clone(stagedWorld || {}),
  // Workspace-only source snapshot used to decide whether a later reference-pack
  // change is safe to rebase without re-running polity-level generation.
  sourceRoundZeroContext: clone(sourceRoundZeroContext || null),
  quality: {
    structuralReady: false,
    canonicalReady: false,
    unresolved: [],
    blockingErrors: [],
    warnings: [],
    counts: {},
  },
});

export const isPoliticalWorldV2Checkpoint = (value) => Boolean(
  value
  && typeof value === "object"
  && value.kind === POLITICAL_WORLD_V2_CHECKPOINT_KIND
  && Number(value.version) === POLITICAL_WORLD_V2_CHECKPOINT_VERSION,
);

export const checkpointMatchesInput = (checkpoint, inputFingerprint) => Boolean(
  isPoliticalWorldV2Checkpoint(checkpoint)
  && clean(checkpoint.inputFingerprint)
  && clean(checkpoint.inputFingerprint) === clean(inputFingerprint),
);

export const normalizePoliticalWorldV2Checkpoint = (value = {}) => {
  if (!isPoliticalWorldV2Checkpoint(value)) return null;
  const next = clone(value);
  next.modelCalls = Math.max(0, Math.trunc(Number(next.modelCalls) || 0));
  const normalizeCallMap = (value) => Object.fromEntries(Object.entries(object(value))
    .map(([key, count]) => [clean(key), Math.max(0, Math.trunc(Number(count) || 0))])
    .filter(([key, count]) => key && count > 0));
  next.modelCallsByType = normalizeCallMap(next.modelCallsByType);
  next.modelCallsByStage = normalizeCallMap(next.modelCallsByStage);
  next.maxModelCalls = Number.isFinite(Number(next.maxModelCalls)) && Number(next.maxModelCalls) >= 0
    ? Math.trunc(Number(next.maxModelCalls))
    : null;
  next.stages = { institutionDiscovery: "pending", institutionGovernance: "pending", agreements: "pending", ...object(next.stages) };
  next.coverage = Object.fromEntries(Object.entries(object(next.coverage)).map(([type, targets]) => [clean(type), [...new Set(array(targets).map(clean).filter(Boolean))]]).filter(([type]) => type));
  next.membership = { resolvedInstitutionIds: [...new Set(array(next?.membership?.resolvedInstitutionIds).map(clean).filter(Boolean))] };
  next.verification = { challenges: object(next?.verification?.challenges) };
  next.attempts = object(next.attempts);
  next.retryContext = {
    politicalActor: object(next?.retryContext?.politicalActor),
    governingAlignment: object(next?.retryContext?.governingAlignment),
  };
  next.generationEntriesByPolity = object(next.generationEntriesByPolity);
  next.warnings = array(next.warnings).map(clean).filter(Boolean);
  next.currentTask = next.currentTask && typeof next.currentTask === "object" ? clone(next.currentTask) : null;
  // Legacy helper modules/tests may still manipulate jobs, but normal v3
  // generation never reads them as progress/canon truth.
  next.jobs = object(next.jobs);
  next.jobOrder = array(next.jobOrder).map(clean).filter((id) => id && next.jobs[id]);
  next.sourceRoundZeroContext = next.sourceRoundZeroContext && typeof next.sourceRoundZeroContext === "object"
    ? clone(next.sourceRoundZeroContext)
    : null;
  next.quality = {
    structuralReady: next.quality?.structuralReady === true,
    canonicalReady: next.quality?.canonicalReady === true,
    unresolved: array(next.quality?.unresolved).map(clone),
    blockingErrors: array(next.quality?.blockingErrors).map(clean).filter(Boolean),
    warnings: array(next.quality?.warnings).map(clean).filter(Boolean),
    counts: clone(object(next.quality?.counts)),
  };
  return next;
};


export const recordPoliticalWorldV2ModelCall = (checkpoint, { type = "unknown", stage = "unknown" } = {}) => {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new Error("Invalid Political World v2 checkpoint");
  const taskType = clean(type) || "unknown";
  const taskStage = clean(stage) || "unknown";
  checkpoint.modelCalls = Math.max(0, Math.trunc(Number(checkpoint.modelCalls) || 0)) + 1;
  checkpoint.modelCallsByType = object(checkpoint.modelCallsByType);
  checkpoint.modelCallsByStage = object(checkpoint.modelCallsByStage);
  checkpoint.modelCallsByType[taskType] = Math.max(0, Math.trunc(Number(checkpoint.modelCallsByType[taskType]) || 0)) + 1;
  checkpoint.modelCallsByStage[taskStage] = Math.max(0, Math.trunc(Number(checkpoint.modelCallsByStage[taskStage]) || 0)) + 1;
  return checkpoint;
};

export const setCheckpointQuality = (checkpoint, quality = {}, now = new Date().toISOString()) => {
  const next = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!next) throw new Error("Invalid Political World v2 checkpoint");
  next.quality = {
    ...next.quality,
    ...clone(quality),
  };
  next.updatedAt = now;
  return next;
};
