/*! Open Historia Continuum — resumable Political World v2 orchestration */

import { materializeScenarioCanon } from "../../../runtime/scenarioCanon.js";
import { resolveScenarioHistoryAuthority } from "../../../runtime/scenarioHistoryAuthority.js";
import { isFinitePowerScore, refreshPowerStatus } from "../../../runtime/powerStatus.js";
import { initializePoliticalDispositionsForWorld } from "../../../runtime/politicalDisposition.js";
import { reconcilePoliticalWorldV2ReferenceState } from "./referenceBootstrap.js";
import { rebasePoliticalWorldV2ReferenceCanon } from "./checkpointRebase.js";
import {
  buildPoliticalWorldInputFingerprint,
  checkpointMatchesInput,
  createPoliticalWorldV2Checkpoint,
  setCheckpointQuality,
} from "./checkpoint.js";
import { runSimplePoliticalWorldV2 } from "./simpleRunner.js";
import { summarizePoliticalWorldV2Worklist } from "./simpleWorklist.js";
import {
  clearPoliticalWorldV2Checkpoint,
  loadPoliticalWorldV2Checkpoint,
  savePoliticalWorldV2Checkpoint,
} from "./storage.js";
import { evaluatePoliticalWorldV2Quality } from "./quality.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const dateKey = (value) => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Number(`${match[1]}${match[2]}${match[3]}`) : null;
};

const activePolityKeys = (polities = []) => array(polities)
  .filter((entry) => typeof entry === "string" || entry?.active !== false)
  .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
  .filter(Boolean);

const temporalVerificationRequiredFor = (world, scenarioDate) => {
  const authority = resolveScenarioHistoryAuthority({ world, scenarioDate });
  if (!authority.canonInitialized || !authority.referenceAllowed) return false;

  // pre-divergence-only worlds need the existing temporal sentinel/adjudicator
  // even when the target start-world date is much later than the cutoff. Its
  // job is to prevent post-boundary reference-canon leakage, not to restore an
  // external timeline at the target date.
  if (authority.referenceAuthority === "pre-divergence-only") return true;

  // round-zero-only exact-date verification may use external/reference canon on
  // the target date itself, so retain the future-date safeguard.
  if (authority.referenceAuthority === "round-zero-only") {
    const scenarioKey = dateKey(scenarioDate);
    const today = new Date();
    const todayKey = Number(`${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`);
    return Boolean(scenarioKey && scenarioKey <= todayKey);
  }

  return false;
};

const seedNativePowerEvidence = (world, scenarioDate, polities) => {
  const refreshed = refreshPowerStatus(world, { date: scenarioDate, round: 0, immediate: true });
  const acceptedPolities = activePolityKeys(polities).filter((polity) => isFinitePowerScore(refreshed?.powerStatus?.byPolity?.[polity]?.score));
  return { world: refreshed, acceptedPolities };
};

const reconcileDeterministicV2State = (checkpoint, inputs) => {
  const next = clone(checkpoint);
  const scenarioDate = clean(inputs?.scenarioDate);
  let world = clone(next.stagedWorld || inputs?.world || {});
  const reference = reconcilePoliticalWorldV2ReferenceState({
    world,
    scenarioDate,
    polities: inputs?.polities || [],
  });
  world = reference.world;
  const nativePower = seedNativePowerEvidence(world, scenarioDate, inputs?.polities || []);
  world = nativePower.world;
  const priorExpected = new Set(array(next.bootstrap?.expectedReferenceInstitutionIds).map(clean).filter(Boolean));
  const referenceSurfaceChanged = reference.seededInstitutions > 0
    || reference.expectedReferenceInstitutionIds.some((id) => !priorExpected.has(id));

  next.stagedWorld = world;
  next.bootstrap = {
    ...(next.bootstrap || {}),
    activeReferencePackIds: reference.activeReferencePackIds,
    expectedReferenceInstitutionIds: reference.expectedReferenceInstitutionIds,
    materializedReferenceInstitutionIds: reference.materializedReferenceInstitutionIds,
    missingReferenceInstitutionIds: reference.missingReferenceInstitutionIds,
    seededInstitutions: Math.max(Number(next.bootstrap?.seededInstitutions) || 0, Number(reference.seededInstitutions) || 0),
    seededMemberships: Math.max(Number(next.bootstrap?.seededMemberships) || 0, Number(reference.seededMemberships) || 0),
    referenceCoveredInstitutionIds: reference.referenceCoveredInstitutionIds,
    nativePowerResolved: nativePower.acceptedPolities.length,
  };
  if (referenceSurfaceChanged) {
    // Discovery/agreement calls made before the selected reference surface was
    // present are not authoritative completeness checks for that expanded
    // institutional world. Re-run only those global stages; Political Actors,
    // alignment, verification and native power stay checkpointed.
    if (next.stages?.institutionDiscovery === "complete") next.stages.institutionDiscovery = "pending";
    if (next.stages?.institutionGovernance === "complete") next.stages.institutionGovernance = "pending";
    if (next.stages?.agreements === "complete") next.stages.agreements = "pending";
  }
  const referenceCoveredInstitutionIds = reference.referenceCoveredInstitutionIds;
  next.membership = next.membership && typeof next.membership === "object" ? next.membership : { resolvedInstitutionIds: [] };
  const resolvedMemberships = new Set(array(next.membership.resolvedInstitutionIds).map(clean).filter(Boolean));
  for (const institutionId of referenceCoveredInstitutionIds) resolvedMemberships.add(institutionId);
  next.membership.resolvedInstitutionIds = [...resolvedMemberships];
  next.coverage = next.coverage && typeof next.coverage === "object" ? next.coverage : {};
  next.coverage["power-evidence"] = [...new Set(nativePower.acceptedPolities.map(clean).filter(Boolean))];
  return next;
};

export const resetDeferredPoliticalWorldV2Attempts = (checkpoint, inputs) => {
  const next = clone(checkpoint);
  if (!next || typeof next !== "object") return { checkpoint: next, resetCount: 0 };
  const summary = summarizePoliticalWorldV2Worklist({ checkpoint: next, inputs });
  const deferred = array(summary?.deferred);
  next.attempts = next.attempts && typeof next.attempts === "object" ? next.attempts : {};
  let resetCount = 0;
  for (const entry of deferred) {
    const kind = clean(entry?.kind);
    const target = clean(entry?.target || "global");
    if (!kind || !target) continue;
    const key = `${kind}:${target}`;
    if (!Object.prototype.hasOwnProperty.call(next.attempts, key)) continue;
    delete next.attempts[key];
    resetCount += 1;
  }
  if (resetCount) {
    next.status = "ready";
    next.pauseReason = "";
    next.lastError = "";
  }
  return { checkpoint: next, resetCount };
};

export const bootstrapPoliticalWorldV2StagedWorld = ({ inputs } = {}) => {
  const scenarioDate = clean(inputs?.scenarioDate);
  let world = {
    ...clone(inputs?.world || {}),
    // The normalized compatibility view is safe workspace state; this is still
    // not persisted until Apply v2 explicitly materializes canon.
    politicalActors: clone(inputs?.politicalActors || inputs?.world?.politicalActors || {}),
  };
  const reference = reconcilePoliticalWorldV2ReferenceState({
    world,
    scenarioDate,
    polities: inputs?.polities || [],
  });
  world = reference.world;
  const nativePower = seedNativePowerEvidence(world, scenarioDate, inputs?.polities || []);
  world = nativePower.world;
  return {
    world,
    ...reference,
    nativePowerResolvedPolities: nativePower.acceptedPolities,
  };
};


export const generateOrResumePoliticalWorldV2 = async ({
  scenarioId,
  inputs,
  qualityMode = "canonical",
  maxModelCalls = 20,
  allowEntityExpansion = false,
  retryDeferred = false,
  callModel,
  signal = null,
  onProgress = null,
} = {}) => {
  const id = clean(scenarioId);
  const scenarioDate = clean(inputs?.scenarioDate);
  if (!id) throw new Error("Political World v2 requires a scenario id.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scenarioDate)) throw new Error("Political World v2 requires the canonical saved scenario date.");

  const inputFingerprint = buildPoliticalWorldInputFingerprint({
    scenarioId: id,
    scenarioDate,
    world: inputs?.world || {},
    roundZeroContext: inputs?.roundZeroContext || null,
  });
  const verificationRequired = temporalVerificationRequiredFor(inputs?.world || {}, scenarioDate);

  let checkpoint = await loadPoliticalWorldV2Checkpoint(id, { scenarioDate });
  if (checkpoint && !checkpointMatchesInput(checkpoint, inputFingerprint)) {
    const rebased = rebasePoliticalWorldV2ReferenceCanon(checkpoint, inputs, inputFingerprint);
    if (rebased) {
      checkpoint = rebased;
      await savePoliticalWorldV2Checkpoint(checkpoint);
    }
  }
  if (!checkpoint || !checkpointMatchesInput(checkpoint, inputFingerprint)) {
    const bootstrapped = bootstrapPoliticalWorldV2StagedWorld({ inputs });
    checkpoint = createPoliticalWorldV2Checkpoint({
      scenarioId: id,
      scenarioDate,
      inputFingerprint,
      stagedWorld: bootstrapped.world,
      sourceRoundZeroContext: inputs?.roundZeroContext || null,
      maxModelCalls,
    });
    checkpoint.qualityMode = qualityMode;
    checkpoint.allowEntityExpansion = allowEntityExpansion === true;
    checkpoint.historicalVerificationRequired = verificationRequired;
    checkpoint.bootstrap = {
      activeReferencePackIds: bootstrapped.activeReferencePackIds,
      expectedReferenceInstitutionIds: bootstrapped.expectedReferenceInstitutionIds,
      materializedReferenceInstitutionIds: bootstrapped.materializedReferenceInstitutionIds,
      missingReferenceInstitutionIds: bootstrapped.missingReferenceInstitutionIds,
      seededInstitutions: bootstrapped.seededInstitutions,
      seededMemberships: bootstrapped.seededMemberships,
      referenceCoveredInstitutionIds: bootstrapped.referenceCoveredInstitutionIds,
      nativePowerResolved: bootstrapped.nativePowerResolvedPolities.length,
    };
    checkpoint.membership.resolvedInstitutionIds = [...new Set(array(bootstrapped.referenceCoveredInstitutionIds).map(clean).filter(Boolean))];
    checkpoint.coverage["power-evidence"] = [...new Set(array(bootstrapped.nativePowerResolvedPolities).map(clean).filter(Boolean))];
    checkpoint = setCheckpointQuality(checkpoint, evaluatePoliticalWorldV2Quality({
      checkpoint,
      polities: inputs?.polities || [],
      relevanceByPolity: inputs?.relevanceByPolity || {},
      historicalVerificationRequired: verificationRequired,
    }));
    await savePoliticalWorldV2Checkpoint(checkpoint);
  } else {
    checkpoint.status = "ready";
    checkpoint.pauseReason = "";
    checkpoint.lastError = "";
    checkpoint.currentTask = null;
    // Preserve bounded-attempt history across ordinary Resume sessions. A
    // session budget pause must not silently turn the same deterministic failure
    // into another full retry window. Deferred targets are reopened only through
    // the explicit repair action, which clears attempts for those targets alone
    // while retaining native validation feedback.
    if (retryDeferred === true) {
      checkpoint = resetDeferredPoliticalWorldV2Attempts(checkpoint, inputs).checkpoint;
    }
  }

  const persistAndReport = async (next, summary = null) => {
    await savePoliticalWorldV2Checkpoint(next);
    const resolvedSummary = summary || summarizePoliticalWorldV2Worklist({ checkpoint: next, inputs });
    onProgress?.({
      checkpoint: clone(next),
      summary: resolvedSummary,
      quality: clone(next.quality || {}),
      runningJob: clone(next.currentTask || null),
    });
  };

  checkpoint = await runSimplePoliticalWorldV2({
    checkpoint,
    inputs,
    maxModelCalls,
    allowEntityExpansion: checkpoint.allowEntityExpansion === true,
    ...(callModel ? { callModel } : {}),
    signal,
    reconcileDeterministic: reconcileDeterministicV2State,
    onCheckpoint: persistAndReport,
  });

  checkpoint = reconcileDeterministicV2State(checkpoint, inputs);
  checkpoint = setCheckpointQuality(checkpoint, evaluatePoliticalWorldV2Quality({
    checkpoint,
    polities: inputs?.polities || [],
    relevanceByPolity: inputs?.relevanceByPolity || {},
    historicalVerificationRequired: checkpoint.historicalVerificationRequired === true,
  }));
  if (checkpoint.quality?.canonicalReady === true) {
    checkpoint.status = "complete";
    checkpoint.pauseReason = "";
    checkpoint.currentTask = null;
  }
  await savePoliticalWorldV2Checkpoint(checkpoint);
  onProgress?.({
    checkpoint: clone(checkpoint),
    summary: summarizePoliticalWorldV2Worklist({ checkpoint, inputs }),
    quality: clone(checkpoint.quality || {}),
    runningJob: null,
  });
  return checkpoint;
};

export const applyPoliticalWorldV2Checkpoint = ({
  checkpoint,
  freshWorld = {},
  freshRoundZeroContext = null,
  scenarioId = "",
  scenarioDate = "",
} = {}) => {
  if (!checkpoint || checkpoint.kind !== "political-world-checkpoint-v2") throw new Error("Political World v2 checkpoint is required.");
  if (clean(checkpoint.scenarioId) !== clean(scenarioId)) throw new Error("Political World v2 checkpoint belongs to a different scenario.");
  if (clean(checkpoint.scenarioDate) !== clean(scenarioDate)) throw new Error("Political World v2 scenario date changed; regenerate or resume against the new canon.");
  if (checkpoint.quality?.canonicalReady !== true || array(checkpoint.quality?.blockingErrors).length || array(checkpoint.quality?.unresolved).length) {
    throw new Error("Political World v2 has not reached Canonical quality and cannot be applied yet.");
  }
  const fingerprint = buildPoliticalWorldInputFingerprint({
    scenarioId,
    scenarioDate,
    world: freshWorld,
    roundZeroContext: freshRoundZeroContext,
  });
  if (!checkpointMatchesInput(checkpoint, fingerprint)) {
    throw new Error("Political World v2 source canon changed after generation began. Start a fresh v2 checkpoint so authored changes are not overwritten.");
  }
  const staged = checkpoint.stagedWorld || {};
  const materialized = materializeScenarioCanon(freshWorld, {
    canonContext: freshWorld?.canonContext ?? staged?.canonContext,
    politicalActors: staged.politicalActors,
    institutions: staged.institutions,
    agreements: staged.agreements,
    powerStatus: staged.powerStatus,
  });
  return initializePoliticalDispositionsForWorld(materialized, { updatedAt: scenarioDate }).world;
};

export const discardPoliticalWorldV2Checkpoint = (scenarioId) => clearPoliticalWorldV2Checkpoint(scenarioId);

const buildDiagnosticUnresolvedDetails = (checkpoint) => {
  const details = {};
  const attempts = checkpoint?.attempts && typeof checkpoint.attempts === "object" ? checkpoint.attempts : {};
  const retryContext = checkpoint?.retryContext && typeof checkpoint.retryContext === "object" ? checkpoint.retryContext : {};
  for (const entry of array(checkpoint?.quality?.unresolved)) {
    const polityKey = clean(entry?.polityKey);
    const kind = clean(entry?.kind);
    if (!polityKey) continue;
    const current = details[polityKey] || { kinds: [], attempts: {}, validationErrors: [] };
    const politicalSystemLock = retryContext?.politicalSystemLocks?.[polityKey];
    if (politicalSystemLock && typeof politicalSystemLock === "object" && !Array.isArray(politicalSystemLock)) {
      current.politicalSystemLock = clone(politicalSystemLock);
    }
    if (kind && !current.kinds.includes(kind)) current.kinds.push(kind);
    if (kind) current.attempts[kind] = Math.max(0, Math.trunc(Number(attempts[`${kind}:${polityKey}`]) || 0));
    const validationErrors = [
      ...array(retryContext?.politicalActor?.[polityKey]),
      ...array(retryContext?.governingAlignment?.[polityKey]),
    ].map(clean).filter(Boolean);
    current.validationErrors = [...new Set([...current.validationErrors, ...validationErrors])];
    details[polityKey] = current;
  }
  return details;
};

export const buildPoliticalWorldV2Diagnostic = ({ checkpoint, scenario = {} } = {}) => ({
  schemaVersion: 2,
  kind: "political-world-v2-diagnostic",
  scenario: {
    id: clean(scenario?.id || checkpoint?.scenarioId),
    name: clean(scenario?.name),
    scenarioDate: clean(checkpoint?.scenarioDate),
  },
  run: {
    status: clean(checkpoint?.status),
    pauseReason: clean(checkpoint?.pauseReason),
    modelCalls: Number(checkpoint?.modelCalls) || 0,
    totalModelCallCeiling: Number(checkpoint?.totalModelCallCeiling) || 0,
    modelCallsByType: clone(checkpoint?.modelCallsByType || {}),
    modelCallsByStage: clone(checkpoint?.modelCallsByStage || {}),
    qualityMode: clean(checkpoint?.qualityMode),
    createdAt: clean(checkpoint?.createdAt),
    updatedAt: clean(checkpoint?.updatedAt),
  },
  quality: clone(checkpoint?.quality || {}),
  unresolvedDetails: buildDiagnosticUnresolvedDetails(checkpoint),
  bootstrap: clone(checkpoint?.bootstrap || {}),
  canonContext: clone(checkpoint?.stagedWorld?.canonContext || null),
  plan: clone(checkpoint?.plan || {}),
  worklist: {
    currentTask: clone(checkpoint?.currentTask || null),
    attempts: clone(checkpoint?.attempts || {}),
    retryContext: clone(checkpoint?.retryContext || {}),
    membership: clone(checkpoint?.membership || {}),
    verification: clone(checkpoint?.verification || {}),
  },
  stagedSummary: {
    politicalActors: Object.keys(checkpoint?.stagedWorld?.politicalActors?.byPolity || {}).length,
    institutions: Object.keys(checkpoint?.stagedWorld?.institutions?.byId || {}).length,
    agreements: array(checkpoint?.stagedWorld?.agreements).length,
    powerStatus: Object.keys(checkpoint?.stagedWorld?.powerStatus?.byPolity || {}).length,
  },
});
