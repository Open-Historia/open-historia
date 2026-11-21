/*!
 * OpenHistoria Map Editor - publish a generated world into its OWN scenario.
 * A generated map is never permission to copy or reset a historical scenario's
 * Political World and independent world history.
 */

export const validateGeneratedScenarioDestination = (seed, requestedName) => {
  if (seed?.generatedWorldReplacement !== true) {
    throw new Error("A fresh scenario can only be created from an explicitly generated world.");
  }
  if (!Array.isArray(seed?.regions?.features) || seed.regions.features.length === 0) {
    throw new Error("The generated world has no regions to save into a new scenario.");
  }
  if (!seed.world?.polityOverrides || Object.keys(seed.world.polityOverrides).length === 0) {
    throw new Error("The generated world has no polities to save into a new scenario.");
  }
  // Do not let later map edits reintroduce historical polity keys or stale
  // region references after the generator validated its original output.
  const regionIds = new Set(seed.regions.features.map((feature) => String(feature?.id ?? feature?.properties?.id ?? "")));
  const polityKeys = new Set(Object.keys(seed.world.polityOverrides));
  for (const [id, owner] of Object.entries(seed.world.regionOwnershipOverrides ?? {})) {
    if (!regionIds.has(id)) throw new Error("Generated-world ownership references a region absent from its geometry.");
    if (owner != null && owner !== "" && !polityKeys.has(String(owner))) {
      throw new Error("Generated-world region owner does not reference a registered polity.");
    }
  }
  if (typeof requestedName !== "string" || /[\r\n\t]/.test(requestedName)) {
    throw new Error("Enter a single-line name for the new scenario.");
  }
  const name = requestedName.replace(/ +/g, " ").trim();
  if (name.length < 3 || name.length > 96) {
    throw new Error("The new scenario name must contain 3 to 96 characters.");
  }
  return name;
};

/**
 * Create and publish without inheriting or mutating the source scenario.
 * No automated deletion of partial output: a destination with a failed write
 * remains inspectable in the library, and its id is reported to the author.
 * Publication, source-authoring settlement, and UI handoff are ordered so the
 * Workshop never closes with an uncommitted local authoring marker.
 */
export const createFreshScenarioFromGeneratedMap = async ({
  seed,
  name,
  createScenario,
  saveMap,
  settleSource,
  openScenarioEditor,
}) => {
  const validatedName = validateGeneratedScenarioDestination(seed, name);
  if ([createScenario, saveMap, settleSource, openScenarioEditor].some((callback) => typeof callback !== "function")) {
    throw new Error("A required scenario publishing or settlement callback is unavailable.");
  }
  // Never pass the old scenario id as seedScenarioId: that would import its
  // diplomacy, institutions, wars, authoring rules, and history by default.
  const created = await createScenario({ name: validatedName, setActive: false });
  const scenarioId = String(created?.scenario?.id ?? "").trim();
  if (!scenarioId) throw new Error("The new scenario was not created with an identifiable destination.");
  try {
    const applied = await saveMap(scenarioId, seed);
    if (!applied || typeof applied !== "object") {
      throw new Error("The generated map could not be verified as published to the new scenario.");
    }
    await settleSource(applied);
    await openScenarioEditor(scenarioId);
    return {
      ...applied,
      saved: true,
      scenarioId,
      createdScenario: created.scenario,
    };
  } catch (error) {
    throw new Error(
      `Scenario "${validatedName}" (${scenarioId}) was created, but its map handoff could not finish: ${error?.message || error}. ` +
      "Check the new scenario in your library before retrying. The original scenario was not overwritten.",
    );
  }
};
