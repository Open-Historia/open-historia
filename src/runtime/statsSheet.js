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

// The scenario's stats.json is read once per (scenario, cache token) and kept
// as the RAW document; every call normalizes its own copy, so no caller can
// mutate what the next one sees. It runs for every stat-context AI task, which
// made an uncached read an IndexedDB or HTTP round trip on every turn.
//
// One entry, keyed by what the library says is current. That shape is what
// keeps the old game-switch race out: the promise is filed under the key of
// the read that started it, so an older stats.json request that resolves late
// can never be served for the new key. The token changes on every library
// mutation (a game or scenario switch, a scenario save, an asset upload — see
// setRuntimeAssetEndpoints), which is exactly when the entry must go. A failed
// read is never kept, so the next call tries again.
let scenarioSheetCache = { key: "", promise: null };

const scenarioSheetKey = (library, scenario) =>
  // JSON_URLS.stats carries the runtime asset token, which the Scenario Editor's
  // own store rotates too.
  [scenario.id, scenario.cacheToken ?? "", scenario.updatedAt ?? "", library?.token ?? "", JSON_URLS.stats].join("|");

const readScenarioSheet = (library, scenario, { force = false } = {}) => {
  const key = scenarioSheetKey(library, scenario);
  if (!force && scenarioSheetCache.key === key && scenarioSheetCache.promise) return scenarioSheetCache.promise;
  const promise = downloadScenarioJsonAsset(scenario.id, "stats").then(
    (raw) => {
      // null from a scenario that HAS a stats.json is a failed read, not a value
      // worth keeping. From one without, it is the answer (the standard sheet).
      if (raw === null && scenario?.assetStatus?.stats && scenarioSheetCache.promise === promise) {
        scenarioSheetCache = { key: "", promise: null };
      }
      return raw;
    },
    (error) => {
      // A download that failed outright. A scenario without a stats.json gets
      // the standard sheet either way; from one that has it, the read failed:
      // dropped, so the next call tries again, and named for the player.
      if (!scenario?.assetStatus?.stats) return null;
      if (scenarioSheetCache.promise === promise) scenarioSheetCache = { key: "", promise: null };
      throw new Error(`Could not load the Stats definition for scenario "${scenario.name || scenario.id}".`, { cause: error });
    },
  );
  scenarioSheetCache = { key, promise };
  return promise;
};

// Tests only: forget the cached sheet.
export const resetStatSheetCache = () => {
  scenarioSheetCache = { key: "", promise: null };
};

export const loadStatSheetDefinition = async ({ force = false } = {}) => {
  // The definition belongs to the scenario, not to the campaign. Resolve the
  // exact runtime scenario first so a stale game-level snapshot can never
  // shadow a Scenario Editor change. This path works in desktop/dev through the
  // normal API and in the hosted build through the IndexedDB API router.
  const library = getLibraryState();
  const scenario = library?.runtimeScenario;
  if (scenario?.id && !scenario?.missing) {
    const raw = await readScenarioSheet(library, scenario, { force });
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
  // source scenario is genuinely missing. assets.js caches this read by its
  // tokenized URL.
  const url = JSON_URLS.stats;
  const raw = url ? await readJson(url, { force }) : null;
  return normalizeStatSheetDefinition(raw);
};

// Backward-compatible projection used by turn schemas that still understand
// strategic 0-100 indices. On a full custom sheet only rows whose kind is index
// participate in that legacy projection; the complete custom sheet travels via
// customStats instead.
// Pass `definition` when the full sheet is already loaded, to skip the read.
export const loadStatIndexDefinition = async ({ definition: loaded = null, ...options } = {}) => {
  const definition = loaded ?? await loadStatSheetDefinition(options);
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
