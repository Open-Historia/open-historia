/*! Open Historia — unified Round-Zero Political World provider seam */

import { applyGeopoliticalWorldBaseline, buildGeopoliticalBaselineDiagnostic, generateGeopoliticalWorldBaseline } from "./geopoliticalWorldGenerator.js";
import { applyPoliticalWorldPipelineCore, buildPoliticalWorldPipelineDiagnosticCore, generatePoliticalWorldPipelineCore, resumePoliticalWorldPipelineGeopoliticsCore } from "./politicalWorldPipelineCore.js";

// The combined run is no longer started from the panel. What stays serves a
// combined run log restored with Restore Run Log: Retry Geopolitics Only,
// Apply to Scenario and Download Combined Diagnostic.
export const resumePoliticalWorldPipelineGeopolitics = (options = {}) => resumePoliticalWorldPipelineGeopoliticsCore({
  ...options,
  generateGeopolitics: options.generateGeopolitics ?? generateGeopoliticalWorldBaseline,
});

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
  generatePoliticalWorldPipelineCore,
  resumePoliticalWorldPipelineGeopoliticsCore,
};
