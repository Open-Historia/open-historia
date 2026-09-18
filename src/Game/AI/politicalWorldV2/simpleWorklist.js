/*! Open Historia Continuum — deterministic Political World v2 worklist
 *
 * This intentionally replaces the self-mutating job graph for normal v2 runs.
 * Work is derived from staged canon + explicit unresolved sets on every loop.
 * Nothing can create a second source of truth for progress.
 */

import { normalizeInstitutions, validateInstitutionTemporalBaseline } from "../../../runtime/institutions.js";
import { isFinitePowerScore } from "../../../runtime/powerStatus.js";
import { buildPoliticalGenerationPlan } from "../../../runtime/politicalWorldGeneration.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(array(values).map(clean).filter(Boolean))];
const chunkCount = (count, size) => count > 0 ? Math.ceil(count / Math.max(1, size)) : 0;

export const SIMPLE_V2_BATCH = Object.freeze({
  politicalActor: 8,
  politicalActorRetry: 2,
  governingAlignment: 48,
  governingAlignmentRetry: 6,
  powerEvidence: 24,
  temporalSentinel: 12,
  historicalVerification: 4,
});

export const activePoliticalWorldV2Polities = (inputs = {}) => array(inputs?.polities)
  .filter((entry) => typeof entry === "string" || entry?.active !== false)
  .map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
  .filter(Boolean);

const coverageSet = (checkpoint, key) => new Set(array(checkpoint?.coverage?.[key]).map(clean).filter(Boolean));
export const SIMPLE_V2_MAX_ATTEMPTS = Object.freeze({
  "political-actor": 2,
  "governing-alignment": 2,
  "institution-discovery": 2,
  "institution-governance": 2,
  "institution-membership-resolution": 2,
  "agreement-resolution": 2,
  "power-evidence": 3,
  "temporal-sentinel": 2,
  "historical-verification": 2,
});

export const politicalWorldV2AttemptCount = (checkpoint, kind, target) => Math.max(0, Math.trunc(Number(checkpoint?.attempts?.[`${clean(kind)}:${clean(target || "global")}`]) || 0));
export const politicalWorldV2MaxAttempts = (kind) => Math.max(1, Math.trunc(Number(SIMPLE_V2_MAX_ATTEMPTS[clean(kind)]) || 2));
export const politicalWorldV2TargetExhausted = (checkpoint, kind, target) => politicalWorldV2AttemptCount(checkpoint, kind, target) >= politicalWorldV2MaxAttempts(kind);
const missingFromCoverage = (expected, checkpoint, key) => {
  const covered = coverageSet(checkpoint, key);
  return expected.filter((polity) => !covered.has(polity));
};

export const incompletePoliticalWorldV2Actors = ({ checkpoint, inputs } = {}) => {
  const expected = activePoliticalWorldV2Polities(inputs);
  const covered = coverageSet(checkpoint, "political-actor");
  let behaviorallyIncomplete = new Set();
  try {
    const plan = buildPoliticalGenerationPlan({
      polities: array(inputs?.polities),
      politicalActors: checkpoint?.stagedWorld?.politicalActors,
      relevanceByPolity: inputs?.relevanceByPolity || {},
      scenarioDate: clean(checkpoint?.scenarioDate || inputs?.scenarioDate),
      maxBatchSize: SIMPLE_V2_BATCH.politicalActor,
      behaviorallyCompleteStandard: true,
      requireRepresentationCoverage: true,
    });
    behaviorallyIncomplete = new Set(array(plan?.items).map((item) => clean(item?.polityKey)).filter(Boolean));
  } catch {
    // Invalid checkpoint dates are handled by the pipeline/gate. Coverage remains
    // the conservative fallback rather than pretending a staged actor is ready.
  }
  return expected.filter((polity) => !covered.has(polity) || behaviorallyIncomplete.has(polity));
};

const activeInstitutions = (checkpoint) => {
  const world = checkpoint?.stagedWorld || {};
  const scenarioDate = clean(checkpoint?.scenarioDate);
  return Object.values(normalizeInstitutions(world?.institutions, world).byId)
    .filter((institution) => validateInstitutionTemporalBaseline({ institution, scenarioDate }).valid)
    .map((institution) => clean(institution?.id))
    .filter(Boolean)
    .sort();
};

export const derivePoliticalWorldV2MembershipSurface = (checkpoint) => {
  const activeInstitutionIds = activeInstitutions(checkpoint);
  const resolved = new Set(unique([
    ...array(checkpoint?.bootstrap?.referenceCoveredInstitutionIds),
    ...array(checkpoint?.membership?.resolvedInstitutionIds),
  ]));
  return {
    activeInstitutionIds,
    resolvedInstitutionIds: activeInstitutionIds.filter((id) => resolved.has(id)),
    unresolvedInstitutionIds: activeInstitutionIds.filter((id) => !resolved.has(id)),
    complete: activeInstitutionIds.every((id) => resolved.has(id)),
  };
};

const firstBatch = (targets, normalSize, retrySize, checkpoint, kind) => {
  if (!targets.length) return [];
  const firstAttempt = politicalWorldV2AttemptCount(checkpoint, kind, targets[0]);
  // Deterministically shrink failures: normal batch -> small batch -> single target.
  // A stubborn target can therefore be isolated without blocking every polity behind it.
  const size = firstAttempt <= 0 ? normalSize : firstAttempt === 1 ? retrySize : 1;
  return targets.slice(0, Math.max(1, size));
};

const retryableTargets = (targets, checkpoint, kind) => array(targets).filter((target) => !politicalWorldV2TargetExhausted(checkpoint, kind, target));
const exhaustedTargets = (targets, checkpoint, kind) => array(targets).filter((target) => politicalWorldV2TargetExhausted(checkpoint, kind, target));

const challengeKeys = (checkpoint) => Object.keys(checkpoint?.verification?.challenges || {}).map(clean).filter(Boolean);

export const deriveNextPoliticalWorldV2Task = ({ checkpoint, inputs } = {}) => {
  const expected = activePoliticalWorldV2Polities(inputs);

  const missingActors = incompletePoliticalWorldV2Actors({ checkpoint, inputs });
  if (missingActors.length) {
    const retryable = retryableTargets(missingActors, checkpoint, "political-actor");
    if (retryable.length) {
      const targets = firstBatch(retryable, SIMPLE_V2_BATCH.politicalActor, SIMPLE_V2_BATCH.politicalActorRetry, checkpoint, "political-actor");
      return { id: `simple:actor:${targets.join("|")}`, type: "political-actor", stage: "politics", targets, payload: {} };
    }
    // Do not advance to dependent phases while actor canon is incomplete.
    return null;
  }

  const missingAlignment = missingFromCoverage(expected, checkpoint, "governing-alignment");
  if (missingAlignment.length) {
    const retryable = retryableTargets(missingAlignment, checkpoint, "governing-alignment");
    if (retryable.length) {
      const targets = firstBatch(retryable, SIMPLE_V2_BATCH.governingAlignment, SIMPLE_V2_BATCH.governingAlignmentRetry, checkpoint, "governing-alignment");
      return { id: `simple:alignment:${targets.join("|")}`, type: "governing-alignment", stage: "politics", targets, payload: {} };
    }
    return null;
  }

  if (checkpoint?.stages?.institutionDiscovery !== "complete") {
    if (politicalWorldV2TargetExhausted(checkpoint, "institution-discovery", "global")) return null;
    return { id: "simple:institutions", type: "institution-discovery", stage: "institutions", targets: [], payload: {} };
  }

  const membership = derivePoliticalWorldV2MembershipSurface(checkpoint);
  if (membership.unresolvedInstitutionIds.length) {
    const institutionId = membership.unresolvedInstitutionIds.find((id) => !politicalWorldV2TargetExhausted(checkpoint, "institution-membership-resolution", id));
    if (!institutionId) return null;
    return {
      id: `simple:membership:${institutionId}`,
      type: "institution-membership-resolution",
      stage: "institutions",
      targets: [institutionId],
      payload: { institutionId },
    };
  }

  if (checkpoint?.stages?.institutionGovernance !== "complete") {
    if (politicalWorldV2TargetExhausted(checkpoint, "institution-governance", "global")) return null;
    return { id: "simple:institution-governance", type: "institution-governance", stage: "institutions", targets: [], payload: {} };
  }

  if (checkpoint?.stages?.agreements !== "complete") {
    if (politicalWorldV2TargetExhausted(checkpoint, "agreement-resolution", "global")) return null;
    return { id: "simple:agreements", type: "agreement-resolution", stage: "institutions", targets: [], payload: {} };
  }

  const missingPower = expected.filter((polity) => !isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score));
  if (missingPower.length) {
    const retryable = retryableTargets(missingPower, checkpoint, "power-evidence");
    if (!retryable.length) return null;
    const targets = firstBatch(retryable, SIMPLE_V2_BATCH.powerEvidence, 6, checkpoint, "power-evidence");
    return { id: `simple:power:${targets.join("|")}`, type: "power-evidence", stage: "politics", targets, payload: {} };
  }

  if (checkpoint?.historicalVerificationRequired === true) {
    const verified = coverageSet(checkpoint, "historical-verification");
    const challenges = challengeKeys(checkpoint).filter((polity) => !verified.has(polity));
    if (challenges.length) {
      const retryableChallenges = retryableTargets(challenges, checkpoint, "historical-verification");
      if (!retryableChallenges.length) return null;
      const targets = retryableChallenges.slice(0, SIMPLE_V2_BATCH.historicalVerification);
      const challengeMap = checkpoint?.verification?.challenges || {};
      return {
        id: `simple:verify:${targets.join("|")}`,
        type: "historical-verification",
        stage: "verification",
        targets,
        payload: {
          reviewContextByPolity: Object.fromEntries(targets.map((polity) => [polity, clean(challengeMap?.[polity]?.issue)])),
          correctionRequiredPolities: targets.filter((polity) => challengeMap?.[polity]?.temporalCorrectionEstablished === true),
        },
      };
    }

    const unverified = expected.filter((polity) => !verified.has(polity));
    if (unverified.length) {
      const retryableUnverified = retryableTargets(unverified, checkpoint, "temporal-sentinel");
      if (!retryableUnverified.length) return null;
      const targets = retryableUnverified.slice(0, SIMPLE_V2_BATCH.temporalSentinel);
      return { id: `simple:sentinel:${targets.join("|")}`, type: "temporal-sentinel", stage: "verification", targets, payload: {} };
    }
  }

  return null;
};

export const summarizePoliticalWorldV2Worklist = ({ checkpoint, inputs } = {}) => {
  const expected = activePoliticalWorldV2Polities(inputs);
  const actors = incompletePoliticalWorldV2Actors({ checkpoint, inputs }).length;
  const alignment = missingFromCoverage(expected, checkpoint, "governing-alignment").length;
  const membership = derivePoliticalWorldV2MembershipSurface(checkpoint);
  const missingPower = expected.filter((polity) => !isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score)).length;
  const verified = coverageSet(checkpoint, "historical-verification");
  const challenges = challengeKeys(checkpoint).filter((polity) => !verified.has(polity)).length;
  const verificationRemaining = checkpoint?.historicalVerificationRequired === true ? expected.filter((polity) => !verified.has(polity)).length : 0;

  const actorMissing = incompletePoliticalWorldV2Actors({ checkpoint, inputs });
  const alignmentMissing = missingFromCoverage(expected, checkpoint, "governing-alignment");
  const actorRetryable = retryableTargets(actorMissing, checkpoint, "political-actor");
  const alignmentRetryable = retryableTargets(alignmentMissing, checkpoint, "governing-alignment");
  const membershipRetryable = membership.unresolvedInstitutionIds.filter((id) => !politicalWorldV2TargetExhausted(checkpoint, "institution-membership-resolution", id));
  const powerRetryable = retryableTargets(expected.filter((polity) => !isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score)), checkpoint, "power-evidence");
  const challengeList = challengeKeys(checkpoint).filter((polity) => !verified.has(polity));
  const verificationList = checkpoint?.historicalVerificationRequired === true ? expected.filter((polity) => !verified.has(polity)) : [];
  const challengeRetryable = retryableTargets(challengeList, checkpoint, "historical-verification");
  const sentinelCandidates = verificationList.filter((polity) => !challengeList.includes(polity));
  const sentinelRetryable = retryableTargets(sentinelCandidates, checkpoint, "temporal-sentinel");

  let pending = 0;
  // Dependent stages are intentionally not counted as actionable until prerequisites are complete.
  if (actorMissing.length) {
    pending += chunkCount(actorRetryable.length, SIMPLE_V2_BATCH.politicalActor);
  } else if (alignmentMissing.length) {
    pending += chunkCount(alignmentRetryable.length, SIMPLE_V2_BATCH.governingAlignment);
  } else if (checkpoint?.stages?.institutionDiscovery !== "complete") {
    pending += politicalWorldV2TargetExhausted(checkpoint, "institution-discovery", "global") ? 0 : 1;
  } else if (membership.unresolvedInstitutionIds.length) {
    pending += membershipRetryable.length;
  } else if (checkpoint?.stages?.institutionGovernance !== "complete") {
    pending += politicalWorldV2TargetExhausted(checkpoint, "institution-governance", "global") ? 0 : 1;
  } else if (checkpoint?.stages?.agreements !== "complete") {
    pending += politicalWorldV2TargetExhausted(checkpoint, "agreement-resolution", "global") ? 0 : 1;
  } else if (missingPower > 0) {
    pending += chunkCount(powerRetryable.length, SIMPLE_V2_BATCH.powerEvidence);
  } else if (checkpoint?.historicalVerificationRequired === true) {
    if (challengeList.length) pending += chunkCount(challengeRetryable.length, SIMPLE_V2_BATCH.historicalVerification);
    else pending += chunkCount(sentinelRetryable.length, SIMPLE_V2_BATCH.temporalSentinel);
  }

  const deferred = [
    ...exhaustedTargets(actorMissing, checkpoint, "political-actor").map((target) => ({ kind: "political-actor", target })),
    ...exhaustedTargets(alignmentMissing, checkpoint, "governing-alignment").map((target) => ({ kind: "governing-alignment", target })),
    ...exhaustedTargets(membership.unresolvedInstitutionIds, checkpoint, "institution-membership-resolution").map((target) => ({ kind: "institution-membership-resolution", target })),
    ...exhaustedTargets(expected.filter((polity) => !isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score)), checkpoint, "power-evidence").map((target) => ({ kind: "power-evidence", target })),
    ...exhaustedTargets(challengeList, checkpoint, "historical-verification").map((target) => ({ kind: "historical-verification", target })),
    ...exhaustedTargets(sentinelCandidates, checkpoint, "temporal-sentinel").map((target) => ({ kind: "temporal-sentinel", target })),
  ];
  if (checkpoint?.stages?.institutionDiscovery !== "complete" && politicalWorldV2TargetExhausted(checkpoint, "institution-discovery", "global")) deferred.push({ kind: "institution-discovery", target: "global" });
  if (checkpoint?.stages?.institutionGovernance !== "complete" && politicalWorldV2TargetExhausted(checkpoint, "institution-governance", "global")) deferred.push({ kind: "institution-governance", target: "global" });
  if (checkpoint?.stages?.agreements !== "complete" && politicalWorldV2TargetExhausted(checkpoint, "agreement-resolution", "global")) deferred.push({ kind: "agreement-resolution", target: "global" });

  const running = checkpoint?.currentTask ? 1 : 0;
  const queued = Math.max(0, pending - running);
  return {
    total: pending,
    pending: queued,
    running,
    completed: 0,
    failed: deferred.length,
    deferred,
    paused: checkpoint?.status === "paused" ? 1 : 0,
    skipped: 0,
    runnable: pending > 0 ? 1 : 0,
    membership,
  };
};
