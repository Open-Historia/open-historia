/*! Open Historia — governing-alignment repair provider seam (Phase006D.1) */

import { callAI } from "./main.jsx";
import { generatePoliticalGoverningAlignmentRepairCore } from "./politicalGoverningAlignmentRepairCore.js";

export const generatePoliticalGoverningAlignmentRepair = (options = {}) => generatePoliticalGoverningAlignmentRepairCore({
  ...options,
  callModel: options.callModel ?? callAI,
});

export { POLITICAL_GOVERNING_ALIGNMENT_TOOL } from "./politicalGoverningAlignmentRepairCore.js";
