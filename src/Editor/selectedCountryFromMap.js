/*!
 * Map Editor: explicit selection -> canonical country owner.
 * Region ownership already uses stable polity keys, not prose or aliases.
 */
export const selectedCountryFromMap = (selection, getRegionSummary) => {
  if (!Array.isArray(selection) || selection.length !== 1 || typeof getRegionSummary !== "function") return "";
  const owner = getRegionSummary(selection[0])?.owner;
  return typeof owner === "string" ? owner.trim() : "";
};
