/*! Open Historia - native boundary between standard and scenario-defined Stats. */

// Legacy Game Master transport accepts customStats as a generic object, even
// when the active scenario uses the standard Stats sheet. This guard applies
// the actual sheet ownership before Preview or Apply can mutate canon.
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const list = (value) => Array.isArray(value) ? value : [];

const standardCustomStatsError = (value, path, { intelligenceAlias = false } = {}) => {
  if (value === undefined) return "";
  if (!record(value)) return path + " must be an object.";
  const keys = Object.keys(value);
  if (!keys.length) return path + " cannot be empty in a standard Stats sheet.";
  const invalid = keys.filter((key) => !(intelligenceAlias && key === "intelligenceService"));
  if (invalid.length) {
    return path + " contains " + invalid.join(", ") +
      ", which belongs to scenario-defined custom Stats, not the standard sheet. " +
      "Use the standard field, such as economy.inflation, instead.";
  }
  if (intelligenceAlias && (!Number.isInteger(value.intelligenceService) ||
    value.intelligenceService < 0 || value.intelligenceService > 100)) {
    return path + ".intelligenceService must be an integer from 0 to 100.";
  }
  return "";
};

export const standardStatsMutationError = (taskKey, payload) => {
  if (!record(payload)) return "";
  if (taskKey === "countryStatSheet") {
    return standardCustomStatsError(payload.customStats, "$.customStats");
  }
  if (taskKey === "gameMaster") {
    for (const [index, entry] of list(payload.countryStatPatches).entries()) {
      const error = standardCustomStatsError(entry?.patch?.customStats,
        "$.countryStatPatches[" + index + "].patch.customStats",
        { intelligenceAlias: true });
      if (error) return error;
    }
  }
  for (const [eventIndex, event] of list(payload.events).entries()) {
    for (const [changeIndex, change] of list(event?.impacts?.polityChanges).entries()) {
      const error = standardCustomStatsError(change?.stats?.customStats,
        "$.events[" + eventIndex + "].impacts.polityChanges[" + changeIndex + "].stats.customStats");
      if (error) return error;
    }
  }
  return "";
};

// Already-invalid old saves are preserved on disk. Do not show their
// customStats sidecar as a legitimate standard-sheet output field to the AI.
export const standardStatsPreviousSummary = (sheet) => {
  if (!record(sheet)) return {};
  const summary = { ...sheet };
  delete summary.territorialComponents;
  delete summary.customStats;
  return summary;
};

// The old customStats.intelligenceService GM spelling is a live capability
// alias, never a standard economic field. Native capability application owns
// the value; do not also persist a customStats sidecar on a standard sheet.
export const standardGameMasterPatchForApply = (patch) => {
  if (!record(patch)) return {};
  const error = standardCustomStatsError(patch.customStats,
    "$.countryStatPatches[].patch.customStats", { intelligenceAlias: true });
  if (error) throw new Error(error);
  const copy = { ...patch };
  delete copy.customStats;
  return copy;
};
