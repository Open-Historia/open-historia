/*! Open Historia - one-call GM Auto routing admission.
 * The model chooses a normal GM mode; Auto is NEVER a fourth mutation authority.
 * Direct in Auto must be an explicit administrative correction, not a narrated
 * world event or an economic consequence inferred from the user's request.
 */
export const GAME_MASTER_MODES = Object.freeze(["direct", "exact-event", "world-intervention"]);
export const GM_AUTO_MODE = "auto";

const token = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";

const authorizesAutoDirect = (request) => {
  const text = String(request ?? "").trim();
  if (!text) return false;
  // The manual Direct choice remains available for all languages. These
  // conservative English constructions identify a request
  // to correct existing canon, rather than asking the engine to simulate a
  // development. Uncertain/multilingual admin requests can pick Direct manually.
  // Scope the correction verb, target FIELD and replacement VALUE to the same
  // short clause. A request to "set banks to collapse, causing GDP losses" is
  // not a request to re-baseline GDP. Numeric fields must name a number.
  const numeric = /\b(?:correct|fix|set|edit|update|replace|override|rebase|change)\b[^.!?;\n]{0,120}\b(?:gdp|population|statistics|stats|stability|inflation|unemployment|public debt|budget|relation score|reputation|energy autonomy|food autonomy)\b[^.!?;\n]{0,45}(?:\bto\b|=)\s*(?:[€$£]\s*)?[+-]?\d/i;
  const named = /\b(?:correct|fix|set|edit|update|replace|override|rebase|change)\b[^.!?;\n]{0,120}\b(?:leader|government|currency|country name|capital)\b[^.!?;\n]{0,45}(?:\b(?:to|as)\b|=)\s*\S/i;
  return numeric.test(text) || named.test(text);
};

// No inferred fallback from an untrusted AI selection. A mode whose authority
// cannot be established rejects before transaction validation or preview.
// Manual modes are not reinterpreted or second-guessed by this router.
export const validateGameMasterModeSelection = ({ requestedMode, selectedMode, request, countryStatPatches } = {}) => {
  const requested = token(requestedMode);
  const selected = token(selectedMode);
  if (requested !== GM_AUTO_MODE) {
    return GAME_MASTER_MODES.includes(requested) && selected === requested
      ? "" : `GM mode must remain "${requested}" throughout the transaction.`;
  }
  if (!GAME_MASTER_MODES.includes(selected)) {
    return "Auto must choose Direct, Exact Event or World Intervention before a GM transaction can be previewed.";
  }
  if (selected === "direct" && !authorizesAutoDirect(request)) {
    return "Auto cannot authorize Direct mode without an explicit administrative correction in the request. Use Exact Event or World Intervention for simulated consequences, or select Direct manually for an intentional baseline edit.";
  }
  // Auto cannot silently turn a narrated crisis into an absolute Stats rewrite.
  // Manual modes retain their existing, separately validated authoring scope.
  if (selected !== "direct" && Array.isArray(countryStatPatches) && countryStatPatches.length > 0) {
    return "Auto narrative modes cannot include administrative Stats baseline patches. Use Direct for an explicit baseline correction, or express a simulated change through event impacts.";
  }
  return "";
};
