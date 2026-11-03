/*! Open Historia - explicit, non-destructive scenario native-binding migration.
 * Archived duplicates preserve independently authored numeric evidence. Native
 * macro, indices and territorial ledgers remain untouched. No inferred bindings.
 */
import { NATIONAL_NATIVE_METRICS, STAT_INDEX_KEY_PATTERN } from "./statIndexDefinitions.js";
import { nationalStatsAuthoringContract, assertNoLegacyNativeStatCopies } from "./statsMetricBindings.js";
import { normalizeCountryStatSheet } from "./countryStats.js";

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const upper = (s) => s[0].toUpperCase() + s.slice(1);
const readingAt = (sheet, path) => path.reduce((value, key) => value?.[key], sheet);
const maxEntries = 60;

const archivedKeyFor = (original, used) => {
  const base = `archived${upper(original)}`.slice(0, 40);
  if (!STAT_INDEX_KEY_PATTERN.test(base)) throw new Error(`Invalid legacy statistic key ${original}.`);
  for (let count = 1; count <= 1000; count += 1) {
    const tail = count === 1 ? "" : String(count);
    const name = base.slice(0, 40 - tail.length) + tail;
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  }
  throw new Error(`Could not safely reserve archival key for ${original}.`);
};

/**
 * Builds only proposed scenario patches. An author must explicitly confirm
 * their meaning, and the caller must recheck concurrent sheet/map/definition
 * fingerprints immediately before saving. No edits to the passed world.
 */
export const planBoundNationalStatsAliasArchival = ({ definition, world, roster } = {}) => {
  const { boundRows, customKeys } = nationalStatsAuthoringContract(definition);
  if (!boundRows.length) return { patches: {}, originals: {}, entries: [], unsupported: "No explicit native-bound Statistics cards exist." };
  const patches = {};
  const originals = {};
  const entries = [];
  const seenPolities = new Set();
  for (const item of Array.isArray(roster) ? roster : []) {
    const code = String(item?.code ?? "").trim();
    if (!code || seenPolities.has(code)) continue;
    seenPolities.add(code);
    const sheet = world?.countryStats?.[code];
    if (!sheet) continue;
    const oldStats = sheet.customStats;
    if (!oldStats || typeof oldStats !== "object" || Array.isArray(oldStats)) continue;
    const used = new Set([...Object.keys(oldStats), ...customKeys, ...boundRows.map((row) => row.key)]
      .map((key) => key.toLowerCase()));
    const custom = { ...oldStats };
    const seen = new Set();
    const proposed = [];
    for (const row of boundRows) {
      const native = NATIONAL_NATIVE_METRICS[row.nativeMetric];
      if (!native) throw new Error(`Unknown native binding ${row.nativeMetric}.`);
      for (const key of [...new Set([row.key, row.nativeMetric])]) {
        if (seen.has(key) || !own(oldStats, key)) continue;
        seen.add(key);
        const legacyValue = oldStats[key];
        const nativeValue = readingAt(sheet, native.path);
        if (!finite(legacyValue) || !finite(nativeValue)) {
          throw new Error(`${code}: ${key} cannot be archived because one reading is missing or nonnumeric. Resolve this field manually.`);
        }
        // Archival replaces an existing key; it does not add a reading.
        // Exactly maxEntries can therefore be preserved without loss. Reject
        // already-oversized legacy input, which normalization would truncate.
        if (Object.keys(custom).length > maxEntries) {
          throw new Error(`${code}: more than ${maxEntries} custom Statistics slots are occupied; cannot preserve ${key} without loss.`);
        }
        const archivedKey = archivedKeyFor(key, used);
        custom[archivedKey] = legacyValue;
        delete custom[key];
        proposed.push({
          countryCode: code, countryName: String(item.name || code),
          key, nativeMetric: row.nativeMetric, nativePath: native.path.join("."),
          nativeValue, legacyValue, archivedKey, equal: nativeValue === legacyValue,
        });
      }
    }
    if (!proposed.length) continue;
    const patch = { ...sheet, customStats: custom };
    const normalized = normalizeCountryStatSheet(patch);
    // The normalized save/reload form must preserve ALL legacy readings,
    // including unrelated fields, not merely the newly archived aliases.
    // A malformed legacy number/string/key could otherwise silently vanish
    // or be coerced when the scenario world is next normalized.
    const roundTripValues = normalized?.customStats;
    const lossless = roundTripValues
      && Object.keys(roundTripValues).length === Object.keys(custom).length
      && Object.entries(custom).every(([key, value]) =>
        own(roundTripValues, key) && Object.is(roundTripValues[key], value));
    if (!lossless) {
      throw new Error(`${code}: archival is not lossless through Statistics normalization; preserve unrelated legacy values and resolve invalid fields manually before saving.`);
    }
    assertNoLegacyNativeStatCopies(definition, patch);
    patches[code] = patch;
    originals[code] = JSON.stringify(sheet);
    entries.push(...proposed);
  }
  return { patches, originals, entries, unsupported: "" };
};
