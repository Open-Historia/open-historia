/*! Open Historia — unified Round-Zero Political World provider seam */

import { applyGeopoliticalWorldBaseline, buildGeopoliticalBaselineDiagnostic, generateGeopoliticalWorldBaseline } from "./geopoliticalWorldGenerator.js";
import { generatePoliticalGoverningAlignmentRepair } from "./politicalGoverningAlignmentRepair.js";
import { generatePoliticalWorldProposals } from "./politicalWorldGenerator.js";
import { applyPoliticalWorldPipelineCore, buildPoliticalWorldPipelineDiagnosticCore, generatePoliticalWorldPipelineCore, resumePoliticalWorldPipelineGeopoliticsCore } from "./politicalWorldPipelineCore.js";

export const generatePoliticalWorldPipeline = (options = {}) => generatePoliticalWorldPipelineCore({
  ...options,
  generatePolitics: options.generatePolitics ?? generatePoliticalWorldProposals,
  generateGoverningAlignment: options.generateGoverningAlignment ?? generatePoliticalGoverningAlignmentRepair,
  generateGeopolitics: options.generateGeopolitics ?? generateGeopoliticalWorldBaseline,
});

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
