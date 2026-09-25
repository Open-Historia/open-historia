/*! Open Historia — unified Round-Zero Political World generation/apply core */

import { applyReviewedPoliticalGeneration } from "../../runtime/politicalWorldGenerationReview.js";
import { initializePoliticalDispositionsForWorld } from "../../runtime/politicalDisposition.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const array = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => {
  if (value == null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const summarizeFailures = (label, failures = []) => {
  const entries = array(failures);
  if (!entries.length) return "";
  const sample = entries.slice(0, 12).map((entry) => clean(entry?.polityKey)).filter(Boolean);
  return `${label} failed for ${entries.length} polity/polities${sample.length ? `: ${sample.join(", ")}${entries.length > sample.length ? "…" : ""}` : ""}.`;
};

const proposalReviews = (result, {
  allowEntityExpansion = false,
  fillEmptyGovernmentPartyRefs = false,
} = {}) => array(result?.proposals).map((entry) => ({
  selected: true,
  proposal: entry.proposal,
  actorPatch: entry.proposal?.actorPatch,
  allowEntityExpansion,
  fillEmptyGovernmentPartyRefs,
}));

const applyProposalStage = ({
  politicalActors,
  scenarioDate,
  result,
  allowEntityExpansion = false,
  fillEmptyGovernmentPartyRefs = false,
} = {}) => applyReviewedPoliticalGeneration({
  politicalActors,
  scenarioDate,
  reviews: proposalReviews(result, { allowEntityExpansion, fillEmptyGovernmentPartyRefs }),
});

const blockedPipeline = ({
  scenarioDate,
  generatedAt,
  allowEntityExpansion,
  politics = null,
  governingAlignment = null,
  geopolitics = null,
  blockingErrors = [],
} = {}) => ({
  schemaVersion: 1,
  kind: "political-world-pipeline-result",
  scenarioDate: clean(scenarioDate),
  generatedAt: clean(generatedAt) || new Date().toISOString(),
  allowEntityExpansion: allowEntityExpansion === true,
  politics,
  governingAlignment,
  geopolitics,
  blockingErrors: array(blockingErrors).map(clean).filter(Boolean),
  complete: false,
});

export const generatePoliticalWorldPipelineCore = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  politicalActors = null,
  world = {},
  relevanceByPolity = {},
  scenarioContext = "",
  contextByPolity = {},
  maxBatchSize = 8,
  prioritizeQuantitativeLandscapeBackfill = true,
  allowEntityExpansion = false,
  signal,
  onProgress,
  generatePolitics,
  generateGoverningAlignment,
  generateGeopolitics,
} = {}) => {
  if (typeof generatePolitics !== "function") throw new Error("Political World pipeline requires a Political Actor generator.");
  if (typeof generateGoverningAlignment !== "function") throw new Error("Political World pipeline requires a governing-alignment generator.");
  if (typeof generateGeopolitics !== "function") throw new Error("Political World pipeline requires a geopolitical generator.");
  const date = clean(scenarioDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Political World generation requires the canonical scenario date.");
  const generatedAt = new Date().toISOString();
  const allowEntityExpansionByPolity = allowEntityExpansion
    ? Object.fromEntries(Object.keys(politicalActors?.byPolity ?? {}).map((polityKey) => [polityKey, true]))
    : {};

  const politics = await generatePolitics({
    scenarioDate: date,
    historyAuthority,
    polities,
    politicalActors,
    relevanceByPolity,
    scenarioContext,
    contextByPolity,
    maxBatchSize,
    prioritizeQuantitativeLandscapeBackfill,
    allowEntityExpansionByPolity,
    maxAttempts: 2,
    signal,
    onBatch: (batch) => onProgress?.({ stage: "politics", ...batch }),
  });

  if (array(politics?.failures).length) {
    return blockedPipeline({
      scenarioDate: date,
      generatedAt,
      allowEntityExpansion,
      politics,
      blockingErrors: [summarizeFailures("Political Actor generation", politics.failures)],
    });
  }

  const politicalApplication = applyProposalStage({
    politicalActors,
    scenarioDate: date,
    result: politics,
    allowEntityExpansion,
  });
  if (!politicalApplication.ok) {
    return blockedPipeline({
      scenarioDate: date,
      generatedAt,
      allowEntityExpansion,
      politics,
      blockingErrors: [summarizeFailures("Political Actor staging", politicalApplication.errors)],
    });
  }

  const governingAlignment = await generateGoverningAlignment({
    scenarioDate: date,
    historyAuthority,
    polities,
    politicalActors: politicalApplication.politicalActors,
    relevanceByPolity,
    scenarioContext,
    contextByPolity,
    maxAttempts: 2,
    signal,
    onBatch: (batch) => onProgress?.({ stage: "governing-alignment", ...batch }),
  });

  if (array(governingAlignment?.failures).length) {
    return blockedPipeline({
      scenarioDate: date,
      generatedAt,
      allowEntityExpansion,
      politics,
      governingAlignment,
      blockingErrors: [summarizeFailures("Governing alignment", governingAlignment.failures)],
    });
  }

  const alignmentApplication = applyProposalStage({
    politicalActors: politicalApplication.politicalActors,
    scenarioDate: date,
    result: governingAlignment,
    fillEmptyGovernmentPartyRefs: true,
  });
  if (!alignmentApplication.ok) {
    return blockedPipeline({
      scenarioDate: date,
      generatedAt,
      allowEntityExpansion,
      politics,
      governingAlignment,
      blockingErrors: [summarizeFailures("Governing-alignment staging", alignmentApplication.errors)],
    });
  }

  // Later phases see the generated Political Actor state, but nothing has been
  // persisted yet. This is the key seam that allows one Generate + one Apply.
  const stagedWorld = {
    ...clone(world || {}),
    politicalActors: alignmentApplication.politicalActors,
  };

  const geopolitics = await generateGeopolitics({
    scenarioDate: date,
    historyAuthority,
    polities,
    world: stagedWorld,
    scenarioContext,
    signal,
    onBatch: (batch) => onProgress?.({ stage: "geopolitics", ...batch }),
  });

  const geopoliticalErrors = array(geopolitics?.blockingErrors).map(clean).filter(Boolean);
  return {
    schemaVersion: 1,
    kind: "political-world-pipeline-result",
    scenarioDate: date,
    generatedAt,
    allowEntityExpansion: allowEntityExpansion === true,
    politics,
    governingAlignment,
    geopolitics,
    blockingErrors: geopoliticalErrors,
    complete: geopoliticalErrors.length === 0,
  };
};


export const resumePoliticalWorldPipelineGeopoliticsCore = async ({
  scenarioDate,
  historyAuthority = null,
  polities = [],
  politicalActors = null,
  world = {},
  scenarioContext = "",
  priorResult,
  signal,
  onProgress,
  generateGeopolitics,
} = {}) => {
  if (typeof generateGeopolitics !== "function") throw new Error("Political World geopolitical resume requires a geopolitical generator.");
  if (!priorResult || priorResult.kind !== "political-world-pipeline-result") throw new Error("A prior Political World pipeline result is required to resume geopolitics.");
  const date = clean(scenarioDate || priorResult.scenarioDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Political World geopolitical resume requires the canonical scenario date.");
  if (clean(priorResult.scenarioDate) && clean(priorResult.scenarioDate) !== date) {
    throw new Error(`Political World scenario date mismatch: generated=${clean(priorResult.scenarioDate)} current=${date}.`);
  }
  if (!priorResult.politics || array(priorResult.politics?.failures).length) {
    throw new Error("Cannot resume geopolitics without a clean Political Actor stage.");
  }
  if (!priorResult.governingAlignment || array(priorResult.governingAlignment?.failures).length) {
    throw new Error("Cannot resume geopolitics without a clean governing-alignment stage.");
  }

  const politicalApplication = applyProposalStage({
    politicalActors,
    scenarioDate: date,
    result: priorResult.politics,
    allowEntityExpansion: priorResult.allowEntityExpansion === true,
  });
  if (!politicalApplication.ok) {
    throw new Error(`Political Actor proposals no longer validate for geopolitical resume: ${summarizeFailures("validation", politicalApplication.errors)}`);
  }

  const alignmentApplication = applyProposalStage({
    politicalActors: politicalApplication.politicalActors,
    scenarioDate: date,
    result: priorResult.governingAlignment,
    fillEmptyGovernmentPartyRefs: true,
  });
  if (!alignmentApplication.ok) {
    throw new Error(`Governing-alignment proposals no longer validate for geopolitical resume: ${summarizeFailures("validation", alignmentApplication.errors)}`);
  }

  const stagedWorld = {
    ...clone(world || {}),
    politicalActors: alignmentApplication.politicalActors,
  };
  const geopolitics = await generateGeopolitics({
    scenarioDate: date,
    historyAuthority,
    polities,
    world: stagedWorld,
    scenarioContext,
    signal,
    onBatch: (batch) => onProgress?.({ stage: "geopolitics", ...batch }),
  });
  const geopoliticalErrors = array(geopolitics?.blockingErrors).map(clean).filter(Boolean);
  return {
    ...priorResult,
    scenarioDate: date,
    generatedAt: new Date().toISOString(),
    geopolitics,
    blockingErrors: geopoliticalErrors,
    complete: geopoliticalErrors.length === 0,
  };
};


export const applyPoliticalWorldPipelineCore = ({ world = {}, result, date = "", applyGeopolitics } = {}) => {
  if (typeof applyGeopolitics !== "function") throw new Error("Political World apply requires a geopolitical apply function.");
  if (!result || result.kind !== "political-world-pipeline-result") throw new Error("A Political World pipeline review is required.");
  const scenarioDate = clean(date || result.scenarioDate);
  if (!scenarioDate || (clean(result.scenarioDate) && clean(result.scenarioDate) !== scenarioDate)) {
    throw new Error(`Political World scenario date mismatch: generated=${clean(result.scenarioDate) || "<blank>"} current=${scenarioDate || "<blank>"}.`);
  }
  if (!result.complete || array(result.blockingErrors).length) {
    throw new Error(`Political World review is incomplete and cannot be applied: ${array(result.blockingErrors).join(" ")}`);
  }

  const politicalApplication = applyProposalStage({
    politicalActors: world?.politicalActors,
    scenarioDate,
    result: result.politics,
    allowEntityExpansion: result.allowEntityExpansion === true,
  });
  if (!politicalApplication.ok) {
    throw new Error(`Political Actor proposals no longer validate against current scenario canon: ${summarizeFailures("validation", politicalApplication.errors)}`);
  }

  const alignmentApplication = applyProposalStage({
    politicalActors: politicalApplication.politicalActors,
    scenarioDate,
    result: result.governingAlignment,
    fillEmptyGovernmentPartyRefs: true,
  });
  if (!alignmentApplication.ok) {
    throw new Error(`Governing-alignment proposals no longer validate against current scenario canon: ${summarizeFailures("validation", alignmentApplication.errors)}`);
  }

  const worldWithPolitics = {
    ...clone(world || {}),
    politicalActors: alignmentApplication.politicalActors,
  };
  const geopoliticalApplication = applyGeopolitics({
    world: worldWithPolitics,
    result: result.geopolitics,
    date: scenarioDate,
  });
  const initializedDisposition = initializePoliticalDispositionsForWorld(geopoliticalApplication.world, {
    updatedAt: scenarioDate,
  });

  return {
    world: initializedDisposition.world,
    applied: {
      politics: politicalApplication.applied,
      governingAlignment: alignmentApplication.applied,
      geopolitics: geopoliticalApplication.applied,
    },
    warnings: [
      ...array(result.politics?.warnings),
      ...array(result.governingAlignment?.warnings),
      ...array(result.geopolitics?.warnings),
    ],
  };
};

export const buildPoliticalWorldPipelineDiagnosticCore = ({ result, world = {}, scenario = {}, buildGeopoliticalDiagnostic } = {}) => {
  if (typeof buildGeopoliticalDiagnostic !== "function") throw new Error("Political World diagnostic requires a geopolitical diagnostic builder.");
  if (!result || result.kind !== "political-world-pipeline-result") throw new Error("Political World pipeline result is required.");
  let geopolitics = null;
  if (result.geopolitics) {
    try {
      const politicalApplication = applyProposalStage({
        politicalActors: world?.politicalActors,
        scenarioDate: result.scenarioDate,
        result: result.politics,
        allowEntityExpansion: result.allowEntityExpansion === true,
      });
      const alignmentApplication = politicalApplication.ok
        ? applyProposalStage({
          politicalActors: politicalApplication.politicalActors,
          scenarioDate: result.scenarioDate,
          result: result.governingAlignment,
          fillEmptyGovernmentPartyRefs: true,
        })
        : null;
      const stagedWorld = alignmentApplication?.ok
        ? { ...clone(world || {}), politicalActors: alignmentApplication.politicalActors }
        : clone(world || {});
      geopolitics = buildGeopoliticalDiagnostic({ result: result.geopolitics, world: stagedWorld, scenario });
    } catch (error) {
      geopolitics = { error: clean(error?.message || error) };
    }
  }

  return {
    schemaVersion: 1,
    kind: "political-world-pipeline-diagnostic",
    scenario: {
      id: clean(scenario?.id),
      name: clean(scenario?.name),
      scenarioDate: clean(result.scenarioDate),
    },
    run: {
      generatedAt: clean(result.generatedAt),
      allowEntityExpansion: result.allowEntityExpansion === true,
      complete: result.complete === true,
      applyBlocked: array(result.blockingErrors).length > 0,
      applyBlockReason: array(result.blockingErrors).join(" "),
    },
    politics: result.politics ? {
      plannedPolities: result.politics?.plan?.items?.length ?? 0,
      accepted: result.politics?.generatedPolities ?? 0,
      failed: result.politics?.failedPolities ?? 0,
      warnings: clone(array(result.politics?.warnings)),
      failures: clone(array(result.politics?.failures)),
      batches: clone(array(result.politics?.batches)),
      diagnostics: clone(array(result.politics?.diagnostics)),
      historicalVerification: clone(result.politics?.historicalVerification ?? null),
      acceptedProposals: clone(array(result.politics?.proposals)),
    } : null,
    governingAlignment: result.governingAlignment ? {
      ...clone(result.governingAlignment?.governingAlignmentRepair ?? {}),
      accepted: result.governingAlignment?.generatedPolities ?? 0,
      failed: result.governingAlignment?.failedPolities ?? 0,
      warnings: clone(array(result.governingAlignment?.warnings)),
      failures: clone(array(result.governingAlignment?.failures)),
      diagnostics: clone(array(result.governingAlignment?.diagnostics)),
      acceptedProposals: clone(array(result.governingAlignment?.proposals)),
    } : null,
    geopolitics,
    blockingErrors: clone(array(result.blockingErrors)),
  };
};
