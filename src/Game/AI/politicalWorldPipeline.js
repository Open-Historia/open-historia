/*! Open Historia — unified Round-Zero Political World provider seam */

import { applyGeopoliticalWorldBaseline, buildGeopoliticalBaselineDiagnostic } from "./geopoliticalWorldGenerator.js";
import { applyPoliticalWorldPipelineCore, buildPoliticalWorldPipelineDiagnosticCore } from "./politicalWorldPipelineCore.js";

// The combined run is no longer generated. What stays serves a combined run
// log restored with Restore Run Log: Apply to Scenario and Download Combined
// Diagnostic.
export const applyPoliticalWorldPipeline = (options = {}) => applyPoliticalWorldPipelineCore({
  ...options,
  applyGeopolitics: options.applyGeopolitics ?? applyGeopoliticalWorldBaseline,
});

export const buildPoliticalWorldPipelineDiagnostic = (options = {}) => buildPoliticalWorldPipelineDiagnosticCore({
  ...options,
  buildGeopoliticalDiagnostic: options.buildGeopoliticalDiagnostic ?? buildGeopoliticalBaselineDiagnostic,
});

export {
  applyPoliticalWorldPipelineCore,
  buildPoliticalWorldPipelineDiagnosticCore,
};
