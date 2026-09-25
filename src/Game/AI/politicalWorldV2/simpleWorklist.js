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
  politicalActor: 12,
  politicalActorRetry: 6,
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

const politicalWorldV2ActorCompleteness = ({ checkpoint, inputs } = {}) => {
  const expected = activePoliticalWorldV2Polities(inputs);
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
    const incomplete = new Set(array(plan?.items).map((item) => clean(item?.polityKey)).filter(Boolean));
    return { ok: true, incomplete: expected.filter((polity) => incomplete.has(polity)) };
  } catch {
    // Preserve the legacy coverage fallback for diagnostic/old-job consumers
    // whose fixtures predate a valid scenario date. The *acceptance* seam below
    // still fails closed so a live provider result cannot be marked complete
    // merely because the native planner itself failed.
    return { ok: false, incomplete: [] };
  }
};

export const behaviorallyIncompletePoliticalWorldV2Actors = ({ checkpoint, inputs } = {}) => (
  politicalWorldV2ActorCompleteness({ checkpoint, inputs }).incomplete
);

export const incompletePoliticalWorldV2Actors = ({ checkpoint, inputs } = {}) => {
  const expected = activePoliticalWorldV2Polities(inputs);
  const covered = coverageSet(checkpoint, "political-actor");
  const behaviorallyIncomplete = new Set(behaviorallyIncompletePoliticalWorldV2Actors({ checkpoint, inputs }));
  return expected.filter((polity) => !covered.has(polity) || behaviorallyIncomplete.has(polity));
};

export const acceptedPoliticalWorldV2ActorTargets = ({ checkpoint, inputs, targets = [], rejected = [] } = {}) => {
  const completeness = politicalWorldV2ActorCompleteness({ checkpoint, inputs });
  if (!completeness.ok) return [];
  const behaviorallyIncomplete = new Set(completeness.incomplete);
  const rejectedSet = new Set(unique(rejected));
  return unique(targets).filter((polity) => (
    !rejectedSet.has(polity)
    && checkpoint?.stagedWorld?.politicalActors?.byPolity?.[polity]
    && !behaviorallyIncomplete.has(polity)
  ));
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
  const missingActorSet = new Set(missingActors);
  const actorReadyPolities = expected.filter((polity) => !missingActorSet.has(polity));
  const retryableActors = retryableTargets(missingActors, checkpoint, "political-actor");
  if (retryableActors.length) {
    const targets = firstBatch(retryableActors, SIMPLE_V2_BATCH.politicalActor, SIMPLE_V2_BATCH.politicalActorRetry, checkpoint, "political-actor");
    return { id: `simple:actor:${targets.join("|")}`, type: "political-actor", stage: "politics", targets, payload: {} };
  }

  // A few bounded-out actor targets must not head-of-line block the rest of the
  // world. Resolve downstream work only for actor-ready polities; the Canonical
  // quality gate still remains false until every required actor is eventually
  // repaired. This preserves useful checkpoint work without weakening quality.
  const missingAlignment = missingFromCoverage(actorReadyPolities, checkpoint, "governing-alignment");
  const retryableAlignment = retryableTargets(missingAlignment, checkpoint, "governing-alignment");
  if (retryableAlignment.length) {
    const targets = firstBatch(retryableAlignment, SIMPLE_V2_BATCH.governingAlignment, SIMPLE_V2_BATCH.governingAlignmentRetry, checkpoint, "governing-alignment");
    return { id: `simple:alignment:${targets.join("|")}`, type: "governing-alignment", stage: "politics", targets, payload: {} };
  }

  let institutionChainBlocked = false;
  if (checkpoint?.stages?.institutionDiscovery !== "complete") {
    if (!politicalWorldV2TargetExhausted(checkpoint, "institution-discovery", "global")) {
      return { id: "simple:institutions", type: "institution-discovery", stage: "institutions", targets: [], payload: {} };
    }
    institutionChainBlocked = true;
  }

  const membership = derivePoliticalWorldV2MembershipSurface(checkpoint);
  if (!institutionChainBlocked && membership.unresolvedInstitutionIds.length) {
    const institutionId = membership.unresolvedInstitutionIds.find((id) => !politicalWorldV2TargetExhausted(checkpoint, "institution-membership-resolution", id));
    if (institutionId) {
      return {
        id: `simple:membership:${institutionId}`,
        type: "institution-membership-resolution",
        stage: "institutions",
        targets: [institutionId],
        payload: { institutionId },
      };
    }
    institutionChainBlocked = true;
  }

  if (!institutionChainBlocked && checkpoint?.stages?.institutionGovernance !== "complete") {
    if (!politicalWorldV2TargetExhausted(checkpoint, "institution-governance", "global")) {
      return { id: "simple:institution-governance", type: "institution-governance", stage: "institutions", targets: [], payload: {} };
    }
    institutionChainBlocked = true;
  }

  if (!institutionChainBlocked && checkpoint?.stages?.agreements !== "complete") {
    if (!politicalWorldV2TargetExhausted(checkpoint, "agreement-resolution", "global")) {
      return { id: "simple:agreements", type: "agreement-resolution", stage: "institutions", targets: [], payload: {} };
    }
    institutionChainBlocked = true;
  }

  const missingPower = expected.filter((polity) => !isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score));
  const retryablePower = retryableTargets(missingPower, checkpoint, "power-evidence");
  if (retryablePower.length) {
    const targets = firstBatch(retryablePower, SIMPLE_V2_BATCH.powerEvidence, 6, checkpoint, "power-evidence");
    return { id: `simple:power:${targets.join("|")}`, type: "power-evidence", stage: "politics", targets, payload: {} };
  }

  if (checkpoint?.historicalVerificationRequired === true) {
    const verified = coverageSet(checkpoint, "historical-verification");
    const actorReadySet = new Set(actorReadyPolities);
    const challenges = challengeKeys(checkpoint).filter((polity) => actorReadySet.has(polity) && !verified.has(polity));
    const retryableChallenges = retryableTargets(challenges, checkpoint, "historical-verification");
    if (retryableChallenges.length) {
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

    const challengedSet = new Set(challenges);
    const unverified = actorReadyPolities.filter((polity) => !verified.has(polity) && !challengedSet.has(polity));
    const retryableUnverified = retryableTargets(unverified, checkpoint, "temporal-sentinel");
    if (retryableUnverified.length) {
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
  const actorMissingSet = new Set(actorMissing);
  const actorReadyPolities = expected.filter((polity) => !actorMissingSet.has(polity));
  const alignmentMissing = missingFromCoverage(actorReadyPolities, checkpoint, "governing-alignment");
  const actorRetryable = retryableTargets(actorMissing, checkpoint, "political-actor");
  const alignmentRetryable = retryableTargets(alignmentMissing, checkpoint, "governing-alignment");
  const membershipRetryable = membership.unresolvedInstitutionIds.filter((id) => !politicalWorldV2TargetExhausted(checkpoint, "institution-membership-resolution", id));
  const missingPowerPolities = expected.filter((polity) => !isFinitePowerScore(checkpoint?.stagedWorld?.powerStatus?.byPolity?.[polity]?.score));
  const powerRetryable = retryableTargets(missingPowerPolities, checkpoint, "power-evidence");
  const actorReadySet = new Set(actorReadyPolities);
  const challengeList = challengeKeys(checkpoint).filter((polity) => actorReadySet.has(polity) && !verified.has(polity));
  const verificationList = checkpoint?.historicalVerificationRequired === true ? actorReadyPolities.filter((polity) => !verified.has(polity)) : [];
  const challengeRetryable = retryableTargets(challengeList, checkpoint, "historical-verification");
  const sentinelCandidates = verificationList.filter((polity) => !challengeList.includes(polity));
  const sentinelRetryable = retryableTargets(sentinelCandidates, checkpoint, "temporal-sentinel");

  let pending = 0;
  // One bounded-out actor/alignment target no longer stalls independent world
  // domains. Institution-internal dependencies remain ordered: a failed catalog
  // does not authorize membership/governance/agreement work against an incomplete
  // institutional surface. Power/verification can still progress independently.
  let institutionChainBlocked = false;
  if (actorRetryable.length) {
    pending += chunkCount(actorRetryable.length, SIMPLE_V2_BATCH.politicalActor);
  } else if (alignmentRetryable.length) {
    pending += chunkCount(alignmentRetryable.length, SIMPLE_V2_BATCH.governingAlignment);
  } else {
    if (checkpoint?.stages?.institutionDiscovery !== "complete") {
      if (!politicalWorldV2TargetExhausted(checkpoint, "institution-discovery", "global")) pending += 1;
      else institutionChainBlocked = true;
    } else if (membership.unresolvedInstitutionIds.length) {
      if (membershipRetryable.length) pending += membershipRetryable.length;
      else institutionChainBlocked = true;
    } else if (checkpoint?.stages?.institutionGovernance !== "complete") {
      if (!politicalWorldV2TargetExhausted(checkpoint, "institution-governance", "global")) pending += 1;
      else institutionChainBlocked = true;
    } else if (checkpoint?.stages?.agreements !== "complete") {
      if (!politicalWorldV2TargetExhausted(checkpoint, "agreement-resolution", "global")) pending += 1;
      else institutionChainBlocked = true;
    }
    if (pending === 0 && (institutionChainBlocked || checkpoint?.stages?.agreements === "complete")) {
      if (powerRetryable.length) pending += chunkCount(powerRetryable.length, SIMPLE_V2_BATCH.powerEvidence);
      else if (checkpoint?.historicalVerificationRequired === true) {
        if (challengeRetryable.length) pending += chunkCount(challengeRetryable.length, SIMPLE_V2_BATCH.historicalVerification);
        else pending += chunkCount(sentinelRetryable.length, SIMPLE_V2_BATCH.temporalSentinel);
      }
    }
  }

  const deferred = [
    ...exhaustedTargets(actorMissing, checkpoint, "political-actor").map((target) => ({ kind: "political-actor", target })),
    ...exhaustedTargets(alignmentMissing, checkpoint, "governing-alignment").map((target) => ({ kind: "governing-alignment", target })),
    ...exhaustedTargets(membership.unresolvedInstitutionIds, checkpoint, "institution-membership-resolution").map((target) => ({ kind: "institution-membership-resolution", target })),
    ...exhaustedTargets(missingPowerPolities, checkpoint, "power-evidence").map((target) => ({ kind: "power-evidence", target })),
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
