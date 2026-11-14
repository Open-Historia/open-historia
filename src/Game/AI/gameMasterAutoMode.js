/*! Open Historia - one-call GM Auto routing admission.
 * The model chooses a normal GM mode; Auto is NEVER a fourth mutation authority.
 * Whichever mode it chooses, the administrator sees the transaction in the
 * preview and applies it or not: the preview is the consent. Direct in Auto
 * used to be refused unless the request held an English correction phrase
 * ("set ... GDP ... to 70"), which no request in another language did.
 */
export const GAME_MASTER_MODES = Object.freeze(["direct", "exact-event", "world-intervention"]);
export const GM_AUTO_MODE = "auto";

const token = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";

// No inferred fallback from an untrusted AI selection. A mode whose authority
// cannot be established rejects before transaction validation or preview.
// Manual modes are not reinterpreted or second-guessed by this router.
export const validateGameMasterModeSelection = ({ requestedMode, selectedMode, countryStatPatches } = {}) => {
  const requested = token(requestedMode);
  const selected = token(selectedMode);
  if (requested !== GM_AUTO_MODE) {
    return GAME_MASTER_MODES.includes(requested) && selected === requested
      ? "" : `GM mode must remain "${requested}" throughout the transaction.`;
  }
  if (!GAME_MASTER_MODES.includes(selected)) {
    return "Auto must choose Direct, Exact Event or World Intervention before a GM transaction can be previewed.";
  }
  // Auto cannot silently turn a narrated crisis into an absolute Stats rewrite.
  // Manual modes retain their existing, separately validated authoring scope.
  if (selected !== "direct" && Array.isArray(countryStatPatches) && countryStatPatches.length > 0) {
    return "Auto narrative modes cannot include administrative Stats baseline patches. Use Direct for an explicit baseline correction, or express a simulated change through event impacts.";
  }
  return "";
};
