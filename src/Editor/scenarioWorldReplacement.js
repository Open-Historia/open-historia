/*!
 * Generated-world scenario Save safety.
 *
 * Replacing the editor's map document is NOT permission to carry pre-existing
 * independent scenario history into the new polity universe or to delete it.
 * New-world intent persists in map metadata until canonical Save succeeds.
 */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const meaningful = (value) => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== false && value !== 0;
};

const nestedLedgerHasFacts = (value, ignored) => {
  if (value == null) return false;
  if (!isRecord(value)) return true;
  return Object.entries(value).some(([key, row]) => !ignored.includes(key) && meaningful(row));
};

export const generatedWorldReplacementId = (document) => (
  String(document?.metadata?.generatedWorldReplacementId || "").trim()
);

export const settleGeneratedWorldReplacement = (document, savedId) => {
  if (!savedId || generatedWorldReplacementId(document) !== savedId) return document;
  // The native map-document writer merges nested metadata instead of replacing
  // it. An omitted key would leave the old provenance marker on disk. Persist
  // an explicit null tombstone so Save & reopen cannot resurrect that intent.
  return { ...document, metadata: { ...document.metadata, generatedWorldReplacementId: null } };
};

// Guard only an explicitly authored whole-world generation, not an ordinary
// map edit, region import or country rename. The new map's author may start with
// blank/unset government and history; inventing or silently deleting old canon
// would be a different, unauthorised scenario creation operation.
export const assertGeneratedWorldScenarioSaveAllowed = (world, generated) => {
  if (!generated) return;
  if (!isRecord(world)) {
    throw new Error("Cannot replace the scenario world: canonical world is unavailable or invalid.");
  }
  const facts = [
    ["Political Actors", nestedLedgerHasFacts(world.politicalActors, ["schemaVersion"])],
    ["diplomatic relations", meaningful(world.relations)],
    ["agreements", meaningful(world.agreements)],
    ["institutions", nestedLedgerHasFacts(world.institutions, ["schemaVersion", "ledgerVersion"])],
    ["wars", meaningful(world.wars)],
    ["country Statistics", meaningful(world.countryStats)],
    ["power-status records", nestedLedgerHasFacts(world.powerStatus, ["schemaVersion"])],
    ["prehistory", nestedLedgerHasFacts(world.prehistory, ["version", "generatedAt"])],
    ["scenario fronts", meaningful(world.scenarioFronts)],
    ["regional sovereignty records", meaningful(world.regionSovereigntyOverrides)],
    ["simulation rules", meaningful(world.simulationRules)],
    ["starting narrative", meaningful(world.startingTimelineText)],
  ].filter(([, present]) => present).map(([label]) => label);
  if (facts.length) {
    throw new Error(
      `Cannot save a generated world over a scenario with established independent canon (${facts.join(", ")}). `
      + "Create a new scenario for this world rather than mixing it with the old scenario's history. "
      + "The original scenario has not been changed; the generated working map and verified recovery remain available.",
    );
  }
};
