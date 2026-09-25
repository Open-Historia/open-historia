/*! Open Historia Continuum — deterministic Political World v2 runner */

import { isFinitePowerScore } from "../../../runtime/powerStatus.js";
import { normalizePoliticalWorldV2Checkpoint, recordPoliticalWorldV2ModelCall, setCheckpointQuality } from "./checkpoint.js";
import { createPoliticalWorldV2Executor } from "./executor.js";
import { evaluatePoliticalWorldV2Quality } from "./quality.js";
import { acceptedPoliticalWorldV2ActorTargets, deriveNextPoliticalWorldV2Task, summarizePoliticalWorldV2Worklist } from "./simpleWorklist.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const uniqueClean = (values) => [...new Set(array(values).map(clean).filter(Boolean))];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const taskTargets = (task) => array(task?.targets).map(clean).filter(Boolean);
const attemptKey = (type, target) => `${clean(type)}:${clean(target || "global")}`;
const coverageSet = (checkpoint, key) => new Set(array(checkpoint?.coverage?.[key]).map(clean).filter(Boolean));

const taskProviderCallCeiling = () => 1;

const providerPauseReason = (error) => {
  const message = clean(error?.message || error).toLocaleLowerCase();
  if (/quota|balance.*exhaust|resource[_ -]?exhaust/.test(message)) return "provider-quota";
  if (/rate limit|rate limiting|too many requests/.test(message)) return "provider-rate-limit";
  if (/temporarily unavailable|failed to fetch|network|econn|gateway|timed? out|timeout/.test(message)) return "provider-unavailable";
  if (/unauthori[sz]ed|forbidden|api key|authentication|permission/.test(message)) return "provider-config";
  return "task-error";
};

const retryBucket = (checkpoint, key) => {
  checkpoint.retryContext = checkpoint.retryContext && typeof checkpoint.retryContext === "object" ? checkpoint.retryContext : {};
  checkpoint.retryContext[key] = checkpoint.retryContext[key] && typeof checkpoint.retryContext[key] === "object" ? checkpoint.retryContext[key] : {};
  return checkpoint.retryContext[key];
};

const actorFailureErrors = (result, polity) => {
  const failure = array(result?.generation?.failures).find((entry) => clean(entry?.polityKey) === polity);
  const staging = result?.stagingErrorsByPolity?.[polity];
  const errors = uniqueClean([...(array(failure?.errors)), ...(array(staging))]);
  return errors.length ? errors.slice(0, 8) : ["Previous bounded generation attempt did not produce a valid canonical Political Actor for this polity."];
};

const recordCoverage = (checkpoint, key, targets) => {
  checkpoint.coverage = checkpoint.coverage && typeof checkpoint.coverage === "object" ? checkpoint.coverage : {};
  const merged = coverageSet(checkpoint, key);
  for (const target of array(targets).map(clean).filter(Boolean)) merged.add(target);
  checkpoint.coverage[key] = [...merged];
};

const bumpAttempts = (checkpoint, type, targets) => {
  checkpoint.attempts = checkpoint.attempts && typeof checkpoint.attempts === "object" ? checkpoint.attempts : {};
  for (const target of array(targets).length ? targets : ["global"]) {
    const key = attemptKey(type, target);
    checkpoint.attempts[key] = Math.max(0, Math.trunc(Number(checkpoint.attempts[key]) || 0)) + 1;
  }
};

const clearAttempts = (checkpoint, type, targets) => {
  checkpoint.attempts = checkpoint.attempts && typeof checkpoint.attempts === "object" ? checkpoint.attempts : {};
  for (const target of array(targets).length ? targets : ["global"]) delete checkpoint.attempts[attemptKey(type, target)];
};

const storeActorGenerationEntries = (checkpoint, result) => {
  checkpoint.generationEntriesByPolity = checkpoint.generationEntriesByPolity && typeof checkpoint.generationEntriesByPolity === "object"
    ? checkpoint.generationEntriesByPolity
    : {};
  for (const entry of array(result?.generation?.proposals)) {
    const polity = clean(entry?.item?.polityKey || entry?.proposal?.polityKey);
    if (polity) checkpoint.generationEntriesByPolity[polity] = clone(entry);
  }
};

const storeHistoricalVerificationEntries = (checkpoint, result) => {
  checkpoint.generationEntriesByPolity = checkpoint.generationEntriesByPolity && typeof checkpoint.generationEntriesByPolity === "object"
    ? checkpoint.generationEntriesByPolity
    : {};
  for (const entry of array(result?.verificationEntries)) {
    const polity = clean(entry?.item?.polityKey || entry?.proposal?.polityKey);
    const verdict = clean(entry?.historicalVerification?.verdict).toLocaleLowerCase();
    if (polity && ["confirmed", "corrected"].includes(verdict)) {
      checkpoint.generationEntriesByPolity[polity] = clone(entry);
    }
  }
};

const invalidateDownstreamActorCoverage = (checkpoint, targets) => {
  const accepted = uniqueClean(targets);
  if (!accepted.length) return;
  for (const key of ["governing-alignment", "historical-verification"]) {
    const covered = coverageSet(checkpoint, key);
    let changed = false;
    for (const polity of accepted) changed = covered.delete(polity) || changed;
    if (changed) checkpoint.coverage[key] = [...covered];
  }
  // A newly changed actor needs fresh downstream work. Prior verification
  // challenges/attempt exhaustion describe the old actor and must not suppress
  // the new temporal-sentinel/alignment pass.
  clearAttempts(checkpoint, "governing-alignment", accepted);
  clearAttempts(checkpoint, "historical-verification", accepted);
  clearAttempts(checkpoint, "temporal-sentinel", accepted);
  for (const polity of accepted) delete checkpoint.verification?.challenges?.[polity];
};

export const applySimpleAccounting = (checkpoint, task, result, stagedWorld, inputs = {}) => {
  const next = checkpoint;
  next.stagedWorld = clone(stagedWorld);
  next.stages = next.stages && typeof next.stages === "object" ? next.stages : {};
  next.membership = next.membership && typeof next.membership === "object" ? next.membership : { resolvedInstitutionIds: [] };
  next.verification = next.verification && typeof next.verification === "object" ? next.verification : { challenges: {} };
  next.verification.challenges = next.verification.challenges && typeof next.verification.challenges === "object" ? next.verification.challenges : {};
  next.warnings = [...new Set([...(array(next.warnings).map(clean).filter(Boolean)), ...(array(result?.warnings).map(clean).filter(Boolean))])];

  if (task.type === "political-actor") {
    storeActorGenerationEntries(next, result);
    const declaredRejected = uniqueClean([...array(result?.unresolvedPolities), ...array(result?.stagingRejectedPolities)]);
    const accepted = acceptedPoliticalWorldV2ActorTargets({
      checkpoint: next,
      inputs,
      targets: taskTargets(task),
      rejected: declaredRejected,
    });
    const unresolved = taskTargets(task).filter((polity) => !accepted.includes(polity));
    recordCoverage(next, "political-actor", accepted);
    invalidateDownstreamActorCoverage(next, accepted);
    clearAttempts(next, task.type, accepted);
    const feedback = retryBucket(next, "politicalActor");
    const politicalSystemLocks = retryBucket(next, "politicalSystemLocks");
    for (const polity of accepted) {
      delete feedback[polity];
      delete politicalSystemLocks[polity];
    }
    for (const polity of unresolved) {
      feedback[polity] = actorFailureErrors(result, polity);
      const retryLock = result?.generation?.retryPoliticalSystemLocksByPolity?.[polity];
      if (retryLock && typeof retryLock === "object" && !Array.isArray(retryLock)) politicalSystemLocks[polity] = clone(retryLock);
    }
    bumpAttempts(next, task.type, unresolved);
  } else if (task.type === "governing-alignment") {
    const declaredAccepted = new Set(array(result?.acceptedPolities).map(clean).filter(Boolean));
    const declaredRejected = new Set(uniqueClean([...array(result?.unresolvedPolities), ...array(result?.stagingRejectedPolities)]));
    const accepted = taskTargets(task).filter((polity) => declaredAccepted.has(polity) && !declaredRejected.has(polity) && next.stagedWorld?.politicalActors?.byPolity?.[polity]);
    recordCoverage(next, "governing-alignment", accepted);
    clearAttempts(next, task.type, accepted);
    bumpAttempts(next, task.type, taskTargets(task).filter((polity) => !accepted.includes(polity)));
  } else if (task.type === "institution-discovery") {
    next.stages.institutionDiscovery = "complete";
    clearAttempts(next, task.type, []);
  } else if (task.type === "institution-membership-resolution") {
    const institutionId = clean(task?.payload?.institutionId || task?.targets?.[0]);
    if (institutionId) {
      const resolved = new Set(array(next.membership.resolvedInstitutionIds).map(clean).filter(Boolean));
      resolved.add(institutionId);
      next.membership.resolvedInstitutionIds = [...resolved];
      clearAttempts(next, task.type, [institutionId]);
    }
  } else if (task.type === "institution-governance") {
    next.stages.institutionGovernance = "complete";
    clearAttempts(next, task.type, []);
  } else if (task.type === "agreement-resolution") {
    next.stages.agreements = "complete";
    clearAttempts(next, task.type, []);
  } else if (task.type === "power-evidence") {
    const accepted = taskTargets(task).filter((polity) => isFinitePowerScore(next.stagedWorld?.powerStatus?.byPolity?.[polity]?.score));
    recordCoverage(next, "power-evidence", accepted);
    clearAttempts(next, task.type, accepted);
    const unresolved = taskTargets(task).filter((polity) => !accepted.includes(polity));
    if (unresolved.length) bumpAttempts(next, task.type, unresolved);
  } else if (task.type === "temporal-sentinel") {
    recordCoverage(next, "historical-verification", array(result?.clearPolities));
    clearAttempts(next, task.type, array(result?.clearPolities));
    for (const polity of array(result?.clearPolities)) delete next.verification.challenges[polity];
    for (const [polity, finding] of Object.entries(result?.challenges || {})) next.verification.challenges[polity] = clone(finding);
    if (array(result?.missingActorTargets).length) {
      for (const polity of array(result.missingActorTargets)) {
        const actors = coverageSet(next, "political-actor");
        actors.delete(polity);
        next.coverage["political-actor"] = [...actors];
      }
    }
  } else if (task.type === "historical-verification") {
    storeHistoricalVerificationEntries(next, result);
    recordCoverage(next, "historical-verification", array(result?.acceptedPolities));
    clearAttempts(next, task.type, array(result?.acceptedPolities));
    for (const polity of array(result?.acceptedPolities)) delete next.verification.challenges[polity];
    if (array(result?.unresolvedPolities).length) bumpAttempts(next, task.type, array(result.unresolvedPolities));
    if (array(result?.correctedPolities).length) {
      const aligned = coverageSet(next, "governing-alignment");
      for (const polity of array(result.correctedPolities)) aligned.delete(polity);
      next.coverage["governing-alignment"] = [...aligned];
    }
  }

  return next;
};

export const runSimplePoliticalWorldV2 = async ({
  checkpoint,
  inputs,
  maxModelCalls = 20,
  allowEntityExpansion = false,
  callModel,
  signal = null,
  reconcileDeterministic = null,
  evaluateQuality = evaluatePoliticalWorldV2Quality,
  onCheckpoint = null,
} = {}) => {
  let current = normalizePoliticalWorldV2Checkpoint(checkpoint);
  if (!current) throw new Error("Invalid Political World v2 checkpoint");
  const budget = Math.max(0, Math.trunc(Number(maxModelCalls) || 0));
  const startCalls = Number(current.modelCalls) || 0;
  const sessionLimit = startCalls + budget;
  const totalLimit = Math.max(0, Math.trunc(Number(current.totalModelCallCeiling) || 0));

  const executor = createPoliticalWorldV2Executor({ inputs, allowEntityExpansion, ...(callModel ? { callModel } : {}), signal });

  const persist = async () => {
    if (typeof reconcileDeterministic === "function") current = reconcileDeterministic(current, inputs);
    current = setCheckpointQuality(current, evaluateQuality({
      checkpoint: current,
      polities: inputs?.polities || [],
      historicalVerificationRequired: current.historicalVerificationRequired === true,
    }));
    const worklistSummary = summarizePoliticalWorldV2Worklist({ checkpoint: current, inputs });
    current.worklistSummary = clone(worklistSummary);
    current.updatedAt = new Date().toISOString();
    await onCheckpoint?.(clone(current), worklistSummary);
  };

  await persist();

  while (true) {
    if (signal?.aborted) {
      current.status = "paused";
      current.pauseReason = "aborted";
      current.currentTask = null;
      await persist();
      return current;
    }
    if (current.quality?.canonicalReady === true) {
      current.status = "complete";
      current.pauseReason = "";
      current.currentTask = null;
      await persist();
      return current;
    }
    if ((Number(current.modelCalls) || 0) >= totalLimit) {
      current.status = "paused";
      current.pauseReason = "total-model-call-budget";
      current.lastError = `Political World generation reached its lifetime safety ceiling of ${totalLimit} AI calls. Completed work is saved; inspect unresolved targets instead of blindly spending more calls.`;
      current.currentTask = null;
      await persist();
      return current;
    }
    const task = deriveNextPoliticalWorldV2Task({ checkpoint: current, inputs });
    if (!task) {
      const summary = summarizePoliticalWorldV2Worklist({ checkpoint: current, inputs });
      current.status = "paused";
      current.pauseReason = summary?.deferred?.length ? "bounded-unresolved" : "unresolved-without-work";
      current.currentTask = null;
      if (summary?.deferred?.length) {
        const sample = summary.deferred.slice(0, 6).map((entry) => `${entry.kind}:${entry.target}`).join(", ");
        current.lastError = `Deferred ${summary.deferred.length} unresolved target(s) after bounded retries this session${sample ? `: ${sample}` : ""}`;
      }
      await persist();
      return current;
    }
    const usedCalls = Number(current.modelCalls) || 0;
    const sessionCallsRemaining = Math.max(0, sessionLimit - usedCalls);
    const totalCallsRemaining = Math.max(0, totalLimit - usedCalls);
    const callsRemaining = Math.min(sessionCallsRemaining, totalCallsRemaining);
    const taskCallCeiling = taskProviderCallCeiling(task);
    // Every deterministic work item is a one-call transaction. Do not start a
    // task unless both the per-session budget and the lifetime safety envelope can
    // contain it; corrective retries remain later checkpointed work items.
    if (callsRemaining < taskCallCeiling) {
      current.status = "paused";
      current.pauseReason = totalCallsRemaining < taskCallCeiling ? "total-model-call-budget" : "model-call-budget";
      if (current.pauseReason === "total-model-call-budget") {
        current.lastError = `Political World generation reached its lifetime safety ceiling of ${totalLimit} AI calls. Completed work is saved; inspect unresolved targets instead of blindly spending more calls.`;
      }
      current.currentTask = null;
      await persist();
      return current;
    }

    current.status = "running";
    current.pauseReason = "";
    current.currentTask = clone(task);
    current.lastError = "";
    await persist();

    const consumeModelCall = async () => {
      const used = Number(current.modelCalls) || 0;
      if (used >= totalLimit) {
        const error = new Error("Political World v2 lifetime model-call safety ceiling reached.");
        error.code = "POLITICAL_WORLD_V2_TOTAL_BUDGET";
        throw error;
      }
      if (used >= sessionLimit) {
        const error = new Error("Political World v2 model-call budget reached for this run.");
        error.code = "POLITICAL_WORLD_V2_BUDGET";
        throw error;
      }
      current = recordPoliticalWorldV2ModelCall(current, { type: task.type, stage: task.stage });
      await persist();
    };

    try {
      const result = await executor.executeJob(task, clone(current), { consumeModelCall });
      const applied = await executor.applyJobResult({ checkpoint: clone(current), job: task, result: clone(result) });
      current = applySimpleAccounting(current, task, result, applied?.stagedWorld ?? current.stagedWorld, inputs);
      current.currentTask = null;
      await persist();
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) {
        current.status = "paused";
        current.pauseReason = "aborted";
        current.currentTask = null;
        await persist();
        return current;
      }
      if (error?.code === "POLITICAL_WORLD_V2_BUDGET" || error?.code === "POLITICAL_WORLD_V2_TOTAL_BUDGET") {
        current.status = "paused";
        current.pauseReason = error.code === "POLITICAL_WORLD_V2_TOTAL_BUDGET" ? "total-model-call-budget" : "model-call-budget";
        if (current.pauseReason === "total-model-call-budget") {
          current.lastError = `Political World generation reached its lifetime safety ceiling of ${totalLimit} AI calls. Completed work is saved; inspect unresolved targets instead of blindly spending more calls.`;
        }
        current.currentTask = null;
        await persist();
        return current;
      }
      // Native/model validation failures are returned as a normal job result and
      // retried with corrective feedback. A thrown error is therefore transport,
      // provider, cancellation-adjacent or executor failure and must pause the
      // session immediately. Treating it as a bad polity burns quota while no
      // canonical result can possibly be accepted.
      current.status = "paused";
      current.pauseReason = providerPauseReason(error);
      current.lastError = clean(error?.message || error || "Political World v2 task failed before producing a validation result");
      current.currentTask = null;
      await persist();
      return current;
    }
  }
};
