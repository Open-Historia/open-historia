const titleCase = (value) => String(value ?? "").trim().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

export const register = (ctx) => {
  const { engine, plain } = ctx;
  const features = () => engine.edFeatures;
  const stats = () => engine.edStatDefs;

  return {
    "editor.rules.definitions": async () => {
      const defs = stats();
      return plain({
        features: features().FEATURE_DEFINITIONS,
        stats: {
          defaultSections: defs.defaultCustomStatSheetDefinition().sections,
          maxSections: defs.MAX_STAT_SECTIONS,
          maxPerSection: defs.MAX_STATS_PER_SECTION,
          maxStats: defs.MAX_CUSTOM_STATS,
          kinds: defs.STAT_KINDS,
        },
        memberStatuses: engine.rulInstitutions.INSTITUTION_MEMBER_STATUSES.map((status) => ({ value: status, label: titleCase(status) })),
        puppetKinds: engine.rulPuppets.PUPPET_KINDS.map((kind) => ({ value: kind, label: titleCase(engine.rulPuppets.puppetKindLabel(kind)) })),
      });
    },
    "editor.rules.scriptedOptions": async ({ world = {} } = {}) => {
      const authoring = engine.rulScriptedAuthoring;
      return plain({
        polities: authoring.scriptedEventPolityOptions(world ?? {}),
        institutions: authoring.scriptedEventInstitutionOptions(world ?? {}),
      });
    },
    "editor.rules.normalizeFeatures": async ({ kind = "scenario", value = null, scenarioFeatures = null } = {}) => {
      const api = features();
      return plain({
        settings: api.normalizeFeatureSettings(value),
        overrides: api.normalizeFeatureOverrides(value),
        resolved: kind === "game" ? api.resolveFeatures(scenarioFeatures, value) : api.normalizeFeatureSettings(value),
        scripted: api.normalizeScriptedEvents(value?.worldDirection?.scriptedEvents),
      });
    },
    "editor.rules.statSheet": async ({ value = null, labels = [] } = {}) => {
      const defs = stats();
      return plain({
        normalized: defs.normalizeStatSheetDefinition(value),
        total: defs.flattenStatSheetRows(value).length,
        keys: (Array.isArray(labels) ? labels : []).map((label) => defs.toStatIndexKey(label)),
      });
    },
  };
};
