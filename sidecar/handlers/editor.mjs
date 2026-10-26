const DEFAULT_ACCENT_COLOR = "#2bc1f3";

export const register = (ctx) => {
  const { engine, plain, clean, list } = ctx;
  const lib = engine.library;

  const prompts = () => engine.edPrompts;

  const slimPrompts = (pack) => ({ promptModel: pack?.promptModel ?? 2, guidance: pack?.guidance ?? { advisor: {}, leader: {}, tasks: {} } });

  const buildScenarioEditorState = (details) => {
    const scenario = details?.scenario ?? {};
    const game = details?.data?.game ?? {};
    const world = details?.data?.world ?? {};
    return {
      accentColor: scenario.accentColor ?? DEFAULT_ACCENT_COLOR,
      allowedUnitTypes: Array.isArray(world.allowedUnitTypes) ? world.allowedUnitTypes : [...engine.gameState.UNIT_TYPES],
      country: game.country ?? "",
      description: scenario.description ?? "",
      eyebrow: scenario.eyebrow ?? "",
      features: engine.edFeatures.normalizeFeatureSettings(scenario.features),
      gameDate: game.gameDate ?? "",
      heroSubtitle: scenario.heroSubtitle ?? "",
      heroTitle: scenario.heroTitle ?? "",
      language: game.language ?? world.language ?? "English",
      music: engine.edMusic.normalizeScenarioMusic(scenario.music),
      name: scenario.name ?? "",
      prompts: slimPrompts(prompts().normalizePromptPack(details?.data?.prompts ?? {})),
      labelFont: world.labelFont ?? "",
      labelHaloColor: world.labelHaloColor ?? "",
      labelTextColor: world.labelTextColor ?? "",
      simulationRules: world.simulationRules ?? "",
      startingTimelineText: world.startingTimelineText ?? "",
      subtitle: scenario.subtitle ?? "",
      warSettings: engine.edWarSettings.compactWarSettings(world.warSettings),
    };
  };

  const buildGameEditorState = (details) => {
    const gameMeta = details?.game ?? {};
    const game = details?.data?.game ?? {};
    const world = details?.data?.world ?? {};
    return {
      accentColor: gameMeta.accentColor ?? DEFAULT_ACCENT_COLOR,
      country: game.country ?? "",
      description: gameMeta.description ?? "",
      eyebrow: gameMeta.eyebrow ?? "",
      features: engine.edFeatures.normalizeFeatureOverrides(gameMeta.features),
      scenarioFeatures: engine.edFeatures.normalizeFeatureSettings(details?.scenario?.features),
      gameDate: game.gameDate ?? "",
      heroSubtitle: gameMeta.heroSubtitle ?? "",
      heroTitle: gameMeta.heroTitle ?? "",
      language: game.language ?? world.language ?? "English",
      name: gameMeta.name ?? "",
      prompts: slimPrompts(prompts().normalizePromptPack(details?.data?.prompts ?? {})),
      labelFont: world.labelFont ?? "",
      labelHaloColor: world.labelHaloColor ?? "",
      labelTextColor: world.labelTextColor ?? "",
      simulationRules: world.simulationRules ?? "",
      startingTimelineText: world.startingTimelineText ?? "",
      subtitle: gameMeta.subtitle ?? "",
    };
  };

  const buildForm = (kind, details) => (kind === "scenario" ? buildScenarioEditorState(details) : buildGameEditorState(details));

  const HEAVY_GAME_DATA = ["actions", "advisor", "chat", "events", "intercepts", "snapshots"];
  const detailsView = (details) => {
    const view = plain(details);
    if (view?.data && typeof view.data === "object") {
      for (const key of HEAVY_GAME_DATA) delete view.data[key];
    }
    return view;
  };

  const countryOptionsOf = (details) => {
    const world = details?.data?.world;
    if (!world) return [];
    const names = engine.getLibraryState()?.countryNames ?? {};
    return engine.edNewGameWorld.buildScenarioCountryOptions(
      world,
      Object.entries(names).map(([code, name]) => ({ code, name })),
      details?.scenario?.countryNameOverrides,
    );
  };

  const politicsBadgeOf = (kind, details) => {
    if (kind !== "scenario") return "";
    const capability = engine.edPoliticalCapability;
    const world = details?.data?.world ?? {};
    const status = capability.politicalWorldCapability(world, {
      polityCount: Array.isArray(world.ownerCodes) ? world.ownerCodes.length : 0,
    })?.status;
    if (status === capability.POLITICAL_WORLD_CAPABILITY.ABSENT) return "No world";
    if (status === capability.POLITICAL_WORLD_CAPABILITY.SPARSE) return "Partial";
    return "";
  };

  const normalizeStatsEditorValue = (raw) => {
    const defs = engine.edStatDefs;
    const definition = defs.normalizeStatSheetDefinition(raw);
    return definition.custom
      ? structuredClone(definition)
      : { custom: false, version: 2, sections: defs.defaultCustomStatSheetDefinition().sections };
  };

  const packOf = (kind, details) => ({
    kind,
    id: clean(kind === "scenario" ? details?.scenario?.id : details?.game?.id),
    details: detailsView(details),
    form: buildForm(kind, details),
    countryOptions: countryOptionsOf(details),
    politicsBadge: politicsBadgeOf(kind, details),
  });

  const loadDetails = (kind, id) => (kind === "scenario" ? lib.loadScenarioDetails(clean(id)) : lib.loadGameDetails(clean(id)));

  return {
    "editor.open": async ({ kind = "scenario", id }) => {
      if (kind === "scenario") {
        let statsFailed = false;
        const [details, statsAsset] = await Promise.all([
          lib.loadScenarioDetails(clean(id)),
          lib.downloadScenarioJsonAsset(clean(id), "stats").catch(() => {
            statsFailed = true;
            return null;
          }),
        ]);
        let error = "";
        let current = details;
        const retry = await engine.missingBasemap.retryMissingBasemap(details.scenario).catch(() => null);
        if (retry?.restored) current = retry.details;
        else if (retry && !retry.restored) error = `This scenario's community basemap could not be downloaded. ${retry.reason} The game tries again the next time you start it and open the scenario.`;
        if (statsFailed) error = "This scenario's Stats sheet could not be loaded, so Save leaves it as it is. Close the editor and open it again to edit it.";
        const stats = normalizeStatsEditorValue(statsAsset);
        return { ...packOf("scenario", current), stats, savedStats: stats, statsFailed, error };
      }
      const details = await lib.loadGameDetails(clean(id));
      return { ...packOf("game", details), stats: null, savedStats: null, statsFailed: false, error: "" };
    },
    "editor.details": async ({ kind = "scenario", id }) => packOf(kind, await loadDetails(kind, id)),
  };
};
