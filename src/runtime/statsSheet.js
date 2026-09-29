/*! Open Historia — scenario-defined national Stats sheets © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { JSON_URLS, readJson } from "./assets.js";
import { downloadScenarioJsonAsset, getLibraryState } from "./library.js";
import {
  DEFAULT_STAT_INDEX_ROWS,
  describeStatIndexRows,
  describeStatSheetDefinition,
  flattenStatSheetRows,
  normalizeStatIndexRows,
  normalizeStatSheetDefinition,
  serializeStatSheet,
  statSheetKeys,
  toStatIndexKey,
} from "./statIndexDefinitions.js";

export * from "./statIndexDefinitions.js";

// Do not keep a second module-level cache here. assets.js already caches JSON
// by the FULL tokenized runtime URL. A second cache looked harmless, but it had
// one fatal race on game switches: an older stats.json request could resolve
// after the new game's request and overwrite `cachedDefinition` while
// `cachedUrl` still named the new game. The next Stats mount then saw the old
// standard sheet even though /api/runtime/json/stats was serving the new
// scenario's custom definition.
//
// Snapshot the URL for this read and let the runtime asset store own caching and
// generation invalidation. setRuntimeAssetEndpoints() changes the token on game
// switches and clears its caches, so this stays both cheap and generation-safe.
export const loadStatSheetDefinition = async ({ force = false } = {}) => {
  // The definition belongs to the scenario, not to the campaign. Resolve the
  // exact runtime scenario first so a stale game-level snapshot can never
  // shadow a Scenario Editor change. This path works in desktop/dev through the
  // normal API and in the hosted build through the IndexedDB API router.
  const library = getLibraryState();
  const scenario = library?.runtimeScenario;
  if (scenario?.id && !scenario?.missing) {
    const raw = await downloadScenarioJsonAsset(scenario.id, "stats");
    if (raw !== null) return normalizeStatSheetDefinition(raw);

    // A scenario that advertises stats.json but cannot return it is an actual
    // load failure. Do not silently pretend it chose the modern sheet: that was
    // the bug that made canonical custom Stats look "overwritten".
    if (scenario?.assetStatus?.stats) {
      throw new Error(`Could not load the Stats definition for scenario "${scenario.name || scenario.id}".`);
    }
    return normalizeStatSheetDefinition(null);
  }

  // Bootstrap / orphaned imported-game fallback. The runtime resolver itself is
  // scenario-first while a linked scenario exists, and game-owned only when the
  // source scenario is genuinely missing.
  const url = JSON_URLS.stats;
  const raw = url ? await readJson(url, { force }) : null;
  return normalizeStatSheetDefinition(raw);
};

// Backward-compatible projection used by turn schemas that still understand
// strategic 0-100 indices. On a full custom sheet only rows whose kind is index
// participate in that legacy projection; the complete custom sheet travels via
// customStats instead.
export const loadStatIndexDefinition = async (options) => {
  const definition = await loadStatSheetDefinition(options);
  if (!definition.custom) {
    return { custom: false, rows: DEFAULT_STAT_INDEX_ROWS.map((row) => ({ ...row })) };
  }
  const rows = flattenStatSheetRows(definition).filter((row) => row.kind === "index");
  return { custom: rows.length > 0, rows };
};

export {
  describeStatIndexRows,
  describeStatSheetDefinition,
  flattenStatSheetRows,
  normalizeStatIndexRows,
  normalizeStatSheetDefinition,
  serializeStatSheet,
  statSheetKeys,
  toStatIndexKey,
};
