/*! Open Historia — Political World generation provider seam (Phase006B) */

import { callAI } from "./main.jsx";
import { generatePoliticalWorldProposalsCore, reverifyPoliticalWorldProposalsCore } from "./politicalWorldGeneratorCore.js";

// Real provider entry point. Phase006C can call this from Scenario Editor review
// UX; Phase006B deliberately returns validated proposals and never writes world
// or scenario state itself.
export const generatePoliticalWorldProposals = (options = {}) => generatePoliticalWorldProposalsCore({
  ...options,
  verifyHistoricalIdentity: options.verifyHistoricalIdentity ?? true,
  callModel: options.callModel ?? callAI,
});

export const reverifyPoliticalWorldProposals = (options = {}) => reverifyPoliticalWorldProposalsCore({
  ...options,
  callModel: options.callModel ?? callAI,
});

export {
  POLITICAL_WORLD_GENERATION_TOOL,
  POLITICAL_WORLD_HISTORICAL_VERIFICATION_TOOL,
} from "./politicalWorldGeneratorCore.js";
