/*! Open Historia Continuum — Political World v2 real domain job executor */

import { callAI } from "../main.jsx";
import { toolResponsePayload } from "../toolResponsePayload.js";
import { generatePoliticalWorldProposals } from "../politicalWorldGenerator.js";
import { generatePoliticalGoverningAlignmentRepair } from "../politicalGoverningAlignmentRepair.js";
import {
  applyGeopoliticalInstitutionGovernanceBaseline,
  applyGeopoliticalWorldBaseline,
  generateGeopoliticalAgreementsJob,
  generateGeopoliticalInstitutionCatalogJob,
  generateGeopoliticalInstitutionGovernanceJob,
  generateGeopoliticalInstitutionMembersBatchJob,
  generateGeopoliticalInstitutionMembersJob,
  generateGeopoliticalPowerEvidenceJob,
} from "../geopoliticalWorldGenerator.js";
import {
  POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL,
  POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL,
  buildPoliticalWorldHistoricalVerificationPrompt,
  buildPoliticalWorldTemporalSentinelPrompt,
  validateHistoricalVerificationPayload,
  validateTemporalSentinelPayload,
} from "../politicalWorldGeneratorCore.js";
import { POLITICAL_GENERATION_NEEDS } from "../../../runtime/politicalWorldGeneration.js";
import { applyReviewedPoliticalGeneration } from "../../../runtime/politicalWorldGenerationReview.js";
import { isFinitePowerScore } from "../../../runtime/powerStatus.js";
import { applyValidatedHistoricalCorrectionToStagedActor } from "./historicalCorrectionStaging.js";
import { historicalChallengeStillAppliesToEntry, rebasePoliticalWorldVerificationEntry } from "./verificationEntry.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => Array.isArray(value) ? value : [];
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};
const unique = (values) => [...new Set(array(values).map(clean).filter(Boolean))];

const sourcePayload = (response, toolName) => toolResponsePayload(response, toolName);

const allPolityObjects = (inputs = {}) => array(inputs.polities).filter((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey));
const targetPolityObjects = (inputs = {}, targets = []) => {
  const wanted = new Set(unique(targets));
  return allPolityObjects(inputs).filter((entry) => wanted.has(clean(typeof entry === "string" ? entry : entry?.polityKey)));
};

const boundedCallModel = (baseCallModel, consumeModelCall, maxCalls = 1) => {
  let calls = 0;
  const limit = Math.max(1, Math.trunc(Number(maxCalls) || 1));
  return async (...args) => {
    if (calls >= limit) {
      const error = new Error(`Political World v2 task exceeded its bounded provider-call ceiling (${limit}).`);
      error.code = "POLITICAL_WORLD_V2_MULTI_CALL_JOB";
      throw error;
    }
    await consumeModelCall();
    calls += 1;
    try {
      return await baseCallModel(...args);
    } catch (error) {
      // Marks a failure of the provider call itself (quota, network, key), which
      // pauses the run without penalizing the targets. A throw without this mark
      // happened after an answer came back, and the runner counts it as an attempt.
      const marked = error && typeof error === "object" && Object.isExtensible(error)
        ? error
        : new Error(String(error?.message || error), { cause: error });
      marked.politicalWorldV2ProviderCall = true;
      throw marked;
    }
  };
};

// v2 owns retry scheduling at the checkpoint/worklist boundary. A single
// resumable task may spend at most one provider call; failed targets are
// retried later with smaller batches and preserved native feedback. Keeping a
// second retry loop inside the domain generators multiplied call cost and made
// the session budget substantially understate actual retry amplification.
const taskProviderCallCeiling = () => 1;

const entryFillsSparseActorPlaceholders = (entry) => entry?.item?.sparsePlaceholderHydration === true;

const reviewsFromGeneration = (generation, {
  allowEntityExpansion = false,
  allowEntityExpansionByPolity = {},
  fillEmptyGovernmentPartyRefs = false,
} = {}) => array(generation?.proposals).map((entry) => {
  const polityKey = clean(entry?.item?.polityKey || entry?.proposal?.polityKey);
  return {
    selected: true,
    proposal: entry.proposal,
    actorPatch: entry.proposal?.actorPatch,
    // Proposal validation already grants entity expansion per polity when the
    // actor is generator-owned rather than authored scenario canon. Staging
    // must honor that same authorization or a valid repair can be accepted by
    // the generator and then rejected while materializing its new party id.
    allowEntityExpansion: allowEntityExpansion === true || allowEntityExpansionByPolity?.[polityKey] === true,
    fillEmptyGovernmentPartyRefs,
    fillSparseActorPlaceholders: entryFillsSparseActorPlaceholders(entry),
  };
});

const applyPoliticalGenerationToWorld = (world, generation, scenarioDate, options = {}) => {
  const reviews = reviewsFromGeneration(generation, options);
  if (!reviews.length) return { world: clone(world), applied: [], errors: [] };

  // Salvage each validated polity independently. The legacy review helper is
  // intentionally atomic for a human Apply action, but v2 staging is a
  // checkpoint workspace: one bad polity must not discard seven good ones.
  let politicalActors = clone(world?.politicalActors);
  const applied = [];
  const errors = [];
  for (const review of reviews) {
    const application = applyReviewedPoliticalGeneration({
      politicalActors,
      scenarioDate,
      reviews: [review],
    });
    if (array(application.errors).length) {
      errors.push(...array(application.errors));
      continue;
    }
    politicalActors = application.politicalActors;
    applied.push(...array(application.applied));
  }
  return {
    world: { ...clone(world || {}), politicalActors },
    applied,
    errors,
  };
};

const generationEntriesForTargets = (checkpoint, targets) => {
  const wanted = new Set(unique(targets));
  const byKey = new Map();
  for (const [polity, entry] of Object.entries(checkpoint?.generationEntriesByPolity || {})) {
    const key = clean(polity || entry?.item?.polityKey);
    if (!key || !wanted.has(key)) continue;
    const stagedActor = checkpoint?.stagedWorld?.politicalActors?.byPolity?.[key];
    byKey.set(key, rebasePoliticalWorldVerificationEntry(entry, stagedActor));
  }
  // Checkpoints saved by the old job runner kept their proposals on jobs.
  // Current runs never write jobs; this only reads those older saves.
  for (const job of Object.values(checkpoint?.jobs || {})) {
    const proposals = array(job?.result?.generation?.proposals);
    for (const entry of proposals) {
      const key = clean(entry?.item?.polityKey);
      if (key && wanted.has(key) && !byKey.has(key)) byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
};

export const createPoliticalWorldV2Executor = ({
  inputs,
  allowEntityExpansion = false,
  callModel = callAI,
  signal = null,
} = {}) => {
  const scenarioDate = clean(inputs?.scenarioDate);
  const allPolities = allPolityObjects(inputs);
  const authoredActors = inputs?.politicalActors?.byPolity || {};
  const allowEntityExpansionByPolity = Object.fromEntries(
    allPolityObjects(inputs).map((entry) => clean(typeof entry === "string" ? entry : entry?.polityKey))
      .filter(Boolean)
      .map((polity) => [
        polity,
        allowEntityExpansion === true || !authoredActors?.[polity],
      ]).filter(([, allowed]) => allowed),
  );

  const executeJob = async (job, checkpoint, { consumeModelCall } = {}) => {
    const trackedCallModel = boundedCallModel(callModel, consumeModelCall, taskProviderCallCeiling(job.type));
    const stagedWorld = checkpoint?.stagedWorld || inputs?.world || {};

    if (job.type === "institution-discovery") {
      const result = await generateGeopoliticalInstitutionCatalogJob({
        scenarioDate,
          historyAuthority: inputs?.historyAuthority || null,
        polities: allPolities,
        world: stagedWorld,
        scenarioContext: inputs?.scenarioContext,
        callModel: trackedCallModel,
        signal,
      });
      return { kind: job.type, ...result, acceptedPolities: [], unresolvedPolities: [] };
    }

    if (job.type === "institution-governance") {
      const result = await generateGeopoliticalInstitutionGovernanceJob({
        scenarioDate,
        historyAuthority: inputs?.historyAuthority || null,
        world: stagedWorld,
        scenarioContext: inputs?.scenarioContext,
        callModel: trackedCallModel,
        signal,
      });
      return { kind: job.type, ...result, acceptedPolities: [], unresolvedPolities: [] };
    }

    if (job.type === "institution-membership-resolution" && array(job?.targets).length > 1) {
      return {
        kind: job.type,
        ...(await generateGeopoliticalInstitutionMembersBatchJob({
          scenarioDate,
          historyAuthority: inputs?.historyAuthority || null,
          institutionIds: job.targets,
          polities: allPolities,
          world: stagedWorld,
          scenarioContext: inputs?.scenarioContext,
          callModel: trackedCallModel,
          signal,
        })),
        acceptedPolities: [],
        unresolvedPolities: [],
      };
    }

    if (job.type === "institution-membership-resolution") {
      const institutionId = clean(job?.payload?.institutionId || job?.targets?.[0]);
      return {
        kind: job.type,
        ...(await generateGeopoliticalInstitutionMembersJob({
          scenarioDate,
          historyAuthority: inputs?.historyAuthority || null,
          institutionId,
          polities: allPolities,
          world: stagedWorld,
          scenarioContext: inputs?.scenarioContext,
          callModel: trackedCallModel,
          signal,
        })),
        acceptedPolities: [],
        unresolvedPolities: [],
      };
    }

    if (job.type === "political-actor") {
      const generation = await generatePoliticalWorldProposals({
        scenarioDate,
        historyAuthority: inputs?.historyAuthority || null,
        polities: targetPolityObjects(inputs, job.targets),
        politicalActors: stagedWorld?.politicalActors,
        relevanceByPolity: inputs?.relevanceByPolity || {},
        scenarioContext: inputs?.scenarioContext,
        contextByPolity: inputs?.contextByPolity || {},
        allowEntityExpansionByPolity,
        maxBatchSize: Math.max(1, job.targets.length),
        // The deterministic v2 worklist owns corrective retries. Keep this domain
        // invocation to one provider call so accepted work checkpoints immediately
        // and a retry cannot silently double-spend the per-run budget.
        maxAttempts: 1,
        prioritizeQuantitativeLandscapeBackfill: false,
        verifyHistoricalIdentity: false,
        behaviorallyCompleteStandard: true,
        requireRepresentationCoverage: true,
        retryErrorsByPolity: checkpoint?.retryContext?.politicalActor || {},
        politicalSystemLocksByPolity: checkpoint?.retryContext?.politicalSystemLocks || {},
        callModel: trackedCallModel,
        signal,
      });
      const unresolvedPolities = array(generation?.failures).map((entry) => clean(entry?.polityKey)).filter(Boolean);
      const unresolvedSet = new Set(unresolvedPolities);
      return {
        kind: job.type,
        generation,
        // A target with no generated proposal may already have satisfied every
        // requested need. Only explicit generator failures remain unresolved.
        acceptedPolities: job.targets.filter((polity) => !unresolvedSet.has(polity)),
        unresolvedPolities,
        warnings: array(generation?.warnings),
      };
    }

    if (job.type === "governing-alignment") {
      const generation = await generatePoliticalGoverningAlignmentRepair({
        scenarioDate,
        historyAuthority: inputs?.historyAuthority || null,
        polities: targetPolityObjects(inputs, job.targets),
        politicalActors: stagedWorld?.politicalActors,
        relevanceByPolity: inputs?.relevanceByPolity || {},
        scenarioContext: inputs?.scenarioContext,
        contextByPolity: inputs?.contextByPolity || {},
        maxAttempts: 1,
        retryErrorsByPolity: checkpoint?.retryContext?.governingAlignment || {},
        callModel: trackedCallModel,
        signal,
      });
      const unresolvedPolities = unique([
        ...array(generation?.failures).map((entry) => clean(entry?.polityKey)).filter(Boolean),
        ...job.targets.filter((polity) => !stagedWorld?.politicalActors?.byPolity?.[polity]),
      ]);
      const unresolvedSet = new Set(unresolvedPolities);
      return {
        kind: job.type,
        generation,
        // Polities absent from the repair candidate list are already valid only
        // when a Political Actor actually exists in staged canon. Missing actor
        // dependencies remain unresolved and receive a later child repair.
        acceptedPolities: job.targets.filter((polity) => !unresolvedSet.has(polity)),
        unresolvedPolities,
        warnings: array(generation?.warnings),
      };
    }

    if (job.type === "power-evidence") {
      const nativeAccepted = array(job.targets).filter((polity) => isFinitePowerScore(stagedWorld?.powerStatus?.byPolity?.[polity]?.score));
      const nativeAcceptedSet = new Set(nativeAccepted);
      const unresolvedTargets = array(job.targets).filter((polity) => !nativeAcceptedSet.has(polity));
      if (!unresolvedTargets.length) {
        return {
          kind: job.type,
          powerCalibration: [],
          acceptedPolities: [...nativeAccepted],
          unresolvedPolities: [],
          returned: 0,
          skippedModelCall: true,
        };
      }
      const result = await generateGeopoliticalPowerEvidenceJob({
        scenarioDate,
          historyAuthority: inputs?.historyAuthority || null,
        targets: unresolvedTargets,
        polities: allPolities,
        world: stagedWorld,
        scenarioContext: inputs?.scenarioContext,
        baseCountryTags: inputs?.baseCountryTags || null,
        callModel: trackedCallModel,
        signal,
      });
      return {
        kind: job.type,
        ...result,
        acceptedPolities: unique([...nativeAccepted, ...array(result.acceptedPolities)]),
        unresolvedPolities: array(result.unresolvedPolities),
      };
    }

    if (job.type === "agreement-resolution") {
      const result = await generateGeopoliticalAgreementsJob({
        scenarioDate,
          historyAuthority: inputs?.historyAuthority || null,
        polities: allPolities,
        world: stagedWorld,
        scenarioContext: inputs?.scenarioContext,
        callModel: trackedCallModel,
        signal,
      });
      return { kind: job.type, ...result, acceptedPolities: [], unresolvedPolities: [] };
    }

    if (job.type === "temporal-sentinel") {
      const entries = generationEntriesForTargets(checkpoint, job.targets);
      const generatedKeys = new Set(entries.map((entry) => clean(entry?.item?.polityKey)));
      const missingActorTargets = job.targets.filter((target) => !generatedKeys.has(target) && !stagedWorld?.politicalActors?.byPolity?.[target]);
      const missingActorSet = new Set(missingActorTargets);
      const authoredOrUnchanged = job.targets.filter((target) => !generatedKeys.has(target) && !missingActorSet.has(target));
      if (!entries.length) {
        return {
          kind: job.type,
          clearPolities: [...authoredOrUnchanged],
          challengePolities: [],
          acceptedPolities: [...authoredOrUnchanged],
          unresolvedPolities: [...missingActorTargets],
          missingActorTargets,
          challenges: {},
          warnings: [],
        };
      }
      const prompt = buildPoliticalWorldTemporalSentinelPrompt({
        scenarioDate,
        historyAuthority: inputs?.historyAuthority || null,
        entries,
        scenarioContext: inputs?.scenarioContext,
        contextByPolity: inputs?.contextByPolity || {},
      });
      const response = await trackedCallModel(prompt.systemPrompt, [{ role: "user", parts: [{ text: prompt.userMessage }] }], {
        signal,
        reasoningEnabled: false,
        taskKey: "politicalWorldVerification",
        logLabel: "political world v2 temporal sentinel",
        tool: POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL,
      });
      const payload = sourcePayload(response, POLITICAL_WORLD_TEMPORAL_SENTINEL_TOOL.name) || {};
      const checked = validateTemporalSentinelPayload({ payload, entries });
      const clearPolities = unique([...checked.clearPolities, ...authoredOrUnchanged]);
      const challengePolities = [...checked.challenges.keys()];
      return {
        kind: job.type,
        clearPolities,
        challengePolities,
        acceptedPolities: clearPolities,
        unresolvedPolities: unique([...challengePolities, ...missingActorTargets]),
        missingActorTargets,
        challenges: Object.fromEntries([...checked.challenges.entries()].map(([key, value]) => [key, clone(value)])),
        diagnostics: checked.diagnostics,
        warnings: checked.warnings,
      };
    }

    if (job.type === "historical-verification") {
      const entries = generationEntriesForTargets(checkpoint, job.targets);
      if (!entries.length) {
        return { kind: job.type, acceptedPolities: [...job.targets], unresolvedPolities: [], confirmedPolities: [...job.targets], correctedPolities: [], warnings: [] };
      }
      const requestedCorrectionRequiredPolities = new Set(array(job?.payload?.correctionRequiredPolities).map(clean).filter(Boolean));
      const correctionRequiredPolities = new Set();
      const staleCorrectionObligations = [];
      for (const polityKey of requestedCorrectionRequiredPolities) {
        const entry = entries.find((candidate) => clean(candidate?.item?.polityKey) === polityKey);
        const challenge = checkpoint?.verification?.challenges?.[polityKey];
        if (!entry || !challenge || historicalChallengeStillAppliesToEntry(challenge, entry)) {
          correctionRequiredPolities.add(polityKey);
        } else {
          staleCorrectionObligations.push(polityKey);
        }
      }
      const prompt = buildPoliticalWorldHistoricalVerificationPrompt({
        scenarioDate,
        historyAuthority: inputs?.historyAuthority || null,
        entries,
        scenarioContext: inputs?.scenarioContext,
        contextByPolity: inputs?.contextByPolity || {},
        correctionRequiredPolities,
        reviewContextByPolity: job?.payload?.reviewContextByPolity || {},
      });
      const response = await trackedCallModel(prompt.systemPrompt, [{ role: "user", parts: [{ text: prompt.userMessage }] }], {
        signal,
        reasoningEnabled: false,
        taskKey: "politicalWorldVerification",
        logLabel: "political world v2 exact-date verification",
        tool: POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL,
      });
      const payload = sourcePayload(response, POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL.name) || {};
      const checked = validateHistoricalVerificationPayload({
        payload,
        entries,
        context: {
          scenarioDate,
          historyAuthority: inputs?.historyAuthority || null,
          // Validate corrections against the pre-generation actor baseline,
          // exactly like the legacy staged pipeline. Generated fields already
          // present in stagedWorld must not become "authored" and block their
          // own exact-date correction.
          politicalActors: inputs?.politicalActors,
          allowEntityExpansionByPolity,
          correctionRequiredPolities,
        },
      });
      const confirmedPolities = array(checked.confirmed).map((entry) => clean(entry?.item?.polityKey)).filter(Boolean);
      const correctedPolities = array(checked.corrected).map((entry) => clean(entry?.item?.polityKey)).filter(Boolean);
      const unresolvedPolities = array(checked.unresolved).map((entry) => clean(entry?.entry?.item?.polityKey)).filter(Boolean);
      return {
        kind: job.type,
        verificationEntries: [...array(checked.confirmed), ...array(checked.corrected)],
        confirmedPolities,
        correctedPolities,
        acceptedPolities: unique([...confirmedPolities, ...correctedPolities]),
        unresolvedPolities,
        diagnostics: checked.diagnostics,
        warnings: [
          ...array(checked.warnings),
          ...staleCorrectionObligations.map((polityKey) => `Discarded stale temporal-correction obligation for ${polityKey} because the challenged generated fact changed in current staged canon; exact-date verification rechecked the new candidate.`),
        ],
      };
    }

    throw new Error(`Unsupported Political World v2 job type: ${job.type}`);
  };

  const applyJobResult = async ({ checkpoint, job, result }) => {
    let stagedWorld = clone(checkpoint?.stagedWorld || inputs?.world || {});

    if (job.type === "institution-discovery") {
      const applied = applyGeopoliticalWorldBaseline({
        world: stagedWorld,
        result: { institutionCatalog: array(result.institutions), records: [], powerCalibration: [], agreements: [], warnings: result.warnings, blockingErrors: [] },
        date: scenarioDate,
      });
      stagedWorld = applied.world;
    }

    if (job.type === "institution-membership-resolution") {
      const applied = applyGeopoliticalWorldBaseline({
        world: stagedWorld,
        result: { institutionCatalog: [], records: array(result.records), powerCalibration: [], agreements: [], warnings: result.warnings, blockingErrors: [] },
        date: scenarioDate,
      });
      stagedWorld = applied.world;
    }

    if (job.type === "political-actor") {
      const applied = applyPoliticalGenerationToWorld(stagedWorld, result.generation, scenarioDate, {
        allowEntityExpansion,
        allowEntityExpansionByPolity,
      });
      stagedWorld = applied.world;
      const stagingRejectedPolities = unique(applied.errors.map((entry) => clean(entry?.polityKey)).filter(Boolean));
      if (stagingRejectedPolities.length) {
        result.stagingRejectedPolities = stagingRejectedPolities;
        result.stagingErrorsByPolity = Object.fromEntries(applied.errors
          .map((entry) => [clean(entry?.polityKey), array(entry?.errors).map(clean).filter(Boolean).slice(0, 8)])
          .filter(([polityKey]) => Boolean(polityKey)));
      }
    }

    if (job.type === "governing-alignment") {
      const applied = applyPoliticalGenerationToWorld(stagedWorld, result.generation, scenarioDate, { fillEmptyGovernmentPartyRefs: true });
      stagedWorld = applied.world;
      const stagingRejectedPolities = unique(applied.errors.map((entry) => clean(entry?.polityKey)).filter(Boolean));
      if (stagingRejectedPolities.length) {
        result.stagingRejectedPolities = stagingRejectedPolities;
        result.stagingErrorsByPolity = Object.fromEntries(applied.errors
          .map((entry) => [clean(entry?.polityKey), array(entry?.errors).map(clean).filter(Boolean).slice(0, 8)])
          .filter(([polityKey]) => Boolean(polityKey)));
      }
    }

    if (job.type === "power-evidence") {
      const applied = applyGeopoliticalWorldBaseline({
        world: stagedWorld,
        result: { institutionCatalog: [], records: [], powerCalibration: array(result.powerCalibration), agreements: [], warnings: [], blockingErrors: [] },
        date: scenarioDate,
      });
      stagedWorld = applied.world;
    }

    if (job.type === "institution-governance") {
      const applied = applyGeopoliticalInstitutionGovernanceBaseline({
        world: stagedWorld,
        governance: array(result.governance),
        date: scenarioDate,
      });
      stagedWorld = applied.world;
      result.warnings = [...array(result.warnings), ...array(applied.warnings)];
    }

    if (job.type === "agreement-resolution") {
      const applied = applyGeopoliticalWorldBaseline({
        world: stagedWorld,
        result: { institutionCatalog: [], records: [], powerCalibration: [], agreements: array(result.agreements), warnings: result.warnings, blockingErrors: [] },
        date: scenarioDate,
      });
      stagedWorld = applied.world;
    }

    if (job.type === "historical-verification") {
      const correctedEntries = array(result.verificationEntries).filter((entry) => entry?.historicalVerification?.verdict === "corrected");
      if (correctedEntries.length) {
        // Exact-date corrections are scoped to fields the generator itself
        // materialized. Apply that validated correction directly to the CURRENT
        // staged actor so a later incremental verification entry cannot rebuild
        // the polity from an older sparse baseline and erase already-accepted
        // generated fields. Authored fields remain protected because the
        // validator carries only generated-owned applied paths into this step.
        stagedWorld.politicalActors = clone(stagedWorld.politicalActors || { schemaVersion: 1, byPolity: {} });
        stagedWorld.politicalActors.byPolity = { ...(stagedWorld.politicalActors.byPolity || {}) };
        for (const entry of correctedEntries) {
          const polityKey = clean(entry?.item?.polityKey);
          if (!polityKey) continue;
          const currentActor = stagedWorld.politicalActors.byPolity?.[polityKey];
          const correctedActor = applyValidatedHistoricalCorrectionToStagedActor({
            currentActor,
            correctionEntry: entry,
          });
          if (!correctedActor) throw new Error(`Historical correction staging failed for ${polityKey}: validated correction did not produce a staged Political Actor.`);
          stagedWorld.politicalActors.byPolity[polityKey] = clone(correctedActor);
        }
      }
    }

    return { stagedWorld };
  };

  return { executeJob, applyJobResult };
};
