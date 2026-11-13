import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GRAND_STRATEGY_PALETTE = [
  [65, 105, 175], [175, 55, 60], [95, 135, 90], [195, 150, 60], [110, 115, 125], [75, 135, 130], [170, 90, 60], [135, 75, 115],
  [160, 140, 85], [80, 120, 155], [110, 140, 90], [180, 110, 75], [70, 95, 145], [145, 65, 70], [125, 135, 100], [185, 130, 95],
  [85, 125, 110], [145, 90, 135], [105, 125, 145], [165, 80, 65], [90, 115, 80], [175, 145, 105], [75, 115, 140], [140, 90, 85],
  [115, 130, 70], [155, 115, 65], [85, 100, 130], [135, 70, 95], [100, 130, 115], [165, 120, 80], [85, 110, 125], [150, 100, 110],
];

const fallbackColor = (code) => {
  const text = String(code || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 37 + text.charCodeAt(index)) >>> 0;
  return [...GRAND_STRATEGY_PALETTE[hash % GRAND_STRATEGY_PALETTE.length], 0.78];
};

const titleCase = (value) => String(value ?? "").trim().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

export const register = (ctx) => {
  const { engine, plain, cacheDir, dataRoot } = ctx;
  const impacts = () => engine.edScriptedImpacts;
  let pickerMap = null;
  let pickerRows = [];

  const cachedFile = (text) => {
    const sha = crypto.createHash("sha256").update(text).digest("hex");
    const file = path.join(cacheDir, "regions", `${sha}.geojson`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, text);
      fs.renameSync(`${file}.tmp`, file);
    }
    return file;
  };

  const stockFile = () => [
    path.join(dataRoot, "server", "data", "stock", "regions.geojson"),
    path.join(dataRoot, "server", "data", "scenarios", "default", "uploads", "regions.geojson"),
  ].find((file) => fs.existsSync(file)) || "";

  const loadPickerMap = async (scenarioId, customRegions) => {
    const key = `${scenarioId}|${customRegions ? 1 : 0}`;
    if (pickerMap?.key === key) return pickerMap.promise;
    const library = engine.library;
    const promise = (async () => {
      const [geojson, colors] = await Promise.all([
        customRegions && scenarioId ? library.downloadScenarioJsonAsset(scenarioId, "regionsGeojson", { coarse: true }).catch(() => null) : null,
        scenarioId ? library.downloadScenarioJsonAsset(scenarioId, "colors").catch(() => null) : null,
      ]);
      const own = Array.isArray(geojson?.features) && geojson.features.length ? geojson : null;
      const catalog = own ? [] : await engine.assets.buildRegionCatalogForMap(null).catch(() => []);
      const file = own ? cachedFile(JSON.stringify(own)) : stockFile();
      if (!file) throw new Error("This scenario's map could not be loaded.");
      return { geojson: own, catalog, file, colors: colors && typeof colors === "object" && !Array.isArray(colors) ? colors : null };
    })();
    pickerMap = { key, promise };
    promise.catch(() => { if (pickerMap?.promise === promise) pickerMap = null; });
    return promise;
  };
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
        impactTypes: impacts().SCRIPTED_IMPACT_TYPES,
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
    "editor.rules.impacts": async ({ rows = [] } = {}) => {
      const api = impacts();
      const list = Array.isArray(rows) ? rows : [];
      return plain({ impacts: api.compileImpactRows(list), problems: api.scriptedImpactProblems(list) });
    },
    "editor.rules.regionPicker": async ({ scenarioId = "", customRegions = false, ownerOverrides = null } = {}) => {
      const authoring = engine.rulScriptedAuthoring;
      const loaded = await loadPickerMap(String(scenarioId ?? "").trim(), customRegions === true);
      const overrides = ownerOverrides && typeof ownerOverrides === "object" && !Array.isArray(ownerOverrides) ? ownerOverrides : null;
      const rows = authoring.pickerRegionRows({ geojson: loaded.geojson, catalog: loaded.catalog, ownerOverrides: overrides });
      pickerRows = rows;
      const toName = engine.ownerNames.toCountryName;
      const fills = {};
      for (const row of rows) {
        const owner = String(row.owner ?? "");
        if (!owner || fills[owner]) continue;
        const name = toName(owner) || owner;
        const shade = loaded.colors?.[name];
        fills[owner] = Array.isArray(shade) ? [Number(shade[0]) || 0, Number(shade[1]) || 0, Number(shade[2]) || 0, 0.82] : fallbackColor(name);
      }
      return plain({ file: loaded.file, rows, owners: authoring.pickerOwnerOptions(rows), fills });
    },
    "editor.rules.searchRegions": async ({ query = "" } = {}) => plain({ matches: engine.rulScriptedAuthoring.searchPickerRegions(pickerRows, query, 40) }),
    "editor.rules.toggleRegions": async ({ selected = [], id = "", owner = "", single = false } = {}) => {
      const authoring = engine.rulScriptedAuthoring;
      const list = Array.isArray(selected) ? selected : [];
      if (owner) return plain({ selected: authoring.toggleOwnerRegions(list, pickerRows, owner) });
      const row = pickerRows.find((entry) => entry.id === String(id)) || { id: String(id), name: String(id) };
      return plain({ selected: authoring.togglePickerRegion(list, row, { single: single === true }) });
    },
    "editor.rules.insertRegions": async ({ value = "", regions = [], start = null, end = null } = {}) => {
      const authoring = engine.rulScriptedAuthoring;
      return plain(authoring.insertAtCursor(value, authoring.regionNameList(regions), Number.isInteger(start) ? start : null, Number.isInteger(end) ? end : null));
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
