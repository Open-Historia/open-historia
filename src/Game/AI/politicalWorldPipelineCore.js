/*! Open Historia — apply core for a restored combined Political World run
 *
 * The combined run (Political Actors, governing alignment, then the one-shot
 * geopolitical baseline) is no longer generated. Restore Run Log can still
 * bring back one of its run logs; this applies it or builds its diagnostic.
 */

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
