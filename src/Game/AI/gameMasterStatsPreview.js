/*! Open Historia — read-only GM Stats preview projection.
 * This is a disclosure of requested operations, NOT the simulation writer.
 * Dated event effects are shown as changes, never invented final GDP.
 */
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const list = (value) => Array.isArray(value) ? value : [];
const flat = (value, prefix = "") => {
  if (!record(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? prefix + "." + key : key;
    return record(child) ? flat(child, path) : [{ path, value: child }];
  });
};
const read = (sheet, path) => path.split(".").reduce((at, key) => record(at)?.[key], sheet);

const EFFECT_ACTION_FIELDS = new Set([
  "populationChange", "gdpChangePercent", "annualRealGrowthDelta",
  "resolveGrowthInfluenceEventId", "debtFinancedOutlayPercentGdp",
  "stabilityDelta", "indexDeltas", "customStatDeltas",
]);
const EFFECT_BASELINES = Object.freeze({
  populationChange: "population.total",
  gdpChangePercent: "economy.gdp",
  annualRealGrowthDelta: "economy.gdpGrowth",
  debtFinancedOutlayPercentGdp: "economy.publicDebt",
  stabilityDelta: "stability",
});
const statValue = (value) => {
  if (value === undefined) return "Not recorded";
  if (value === null) return "Unset";
  if (Array.isArray(value)) return value.length + " structured entries";
  if (typeof value === "number") return Number.isFinite(value)
    ? new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value) : "Invalid number";
  if (typeof value === "boolean") return String(value);
  return String(value);
};

// Disclosure only. An Economy-tagged GM event can legitimately record
// unquantified news or start a Project, but neither is a national Stats write.
// Do not parse prose to infer percentages or silently convert projects to GDP.
const ECONOMIC_EFFECT_ACTION_FIELDS = new Set([
  "gdpChangePercent", "annualRealGrowthDelta",
  "resolveGrowthInfluenceEventId", "debtFinancedOutlayPercentGdp",
]);
export const reviewGameMasterEconomicPreview = (events, { mode = "" } = {}) => {
  if (mode === "direct") return [];
  return list(events).flatMap((event, index) => {
    const taggedEconomy = list(event?.tags)
      .some((tag) => typeof tag === "string" && tag.toLowerCase() === "economy");
    // Disaster, Politics and other events may explicitly declare national
    // economic accounting without carrying the Economy filter tag. That
    // typed declaration is authoritative enough to require a disclosure;
    // the tag is not the owner of economic completeness.
    const declaredStatus = String(event?.economicAccounting?.status || "").toLowerCase();
    if (!taggedEconomy && !["applied", "unquantified"].includes(declaredStatus)) return [];
    const applied = list(event?.impacts?.polityChanges).some((op) => {
      const effects = record(op?.statsEffects);
      // An independent custom series (steelOutput, for example) is not a
      // national GDP, growth, or fiscal settlement. Its update must not
      // suppress a missing native macroeconomic disclosure.
      return effects && Object.entries(effects).some(([key, value]) =>
        ECONOMIC_EFFECT_ACTION_FIELDS.has(key) &&
          (key === "resolveGrowthInfluenceEventId"
            ? typeof value === "string" && Boolean(value.trim())
            : typeof value === "number" && Number.isFinite(value)));
    });
    if (applied) return [];
    return [{
      eventIndex: index,
      title: String(event?.title || `Event ${index + 1}`),
      declaredStatus: String(event?.economicAccounting?.status || "unspecified"),
      reason: String(event?.economicAccounting?.reason || ""),
    }];
  });
};

export const buildGameMasterStatsPreview = ({ world, events, countryStatPatches } = {}) => {
  const sheets = record(world?.countryStats) || {};
  const rows = [];
  const addAbsolute = ({ country, patch, source, reason, eventIndex }) => {
    const baseline = sheets[country];
    for (const entry of flat(patch)) {
      rows.push({
        country, field: entry.path, source, eventIndex, reason: String(reason || ""),
        before: statValue(read(baseline, entry.path)),
        proposed: statValue(entry.value), kind: "absolute",
      });
    }
  };
  for (const [eventIndex, event] of list(events).entries()) {
    for (const op of list(event?.impacts?.polityChanges)) {
      const country = String(op?.code || op?.name || "").trim();
      if (!country) continue;
      if (record(op?.stats)) addAbsolute({
        country, patch: op.stats, source: "Event baseline", eventIndex,
        reason: event?.title || "",
      });
      const effects = record(op?.statsEffects);
      if (!effects) continue;
      for (const item of flat(Object.fromEntries(
        Object.entries(effects).filter(([key]) => EFFECT_ACTION_FIELDS.has(key)),
      ))) {
        const root = item.path.split(".")[0];
        const baselinePath = root === "indexDeltas" ? "indices." + item.path.slice("indexDeltas.".length)
          : root === "customStatDeltas" ? "customStats." + item.path.slice("customStatDeltas.".length)
          : EFFECT_BASELINES[root];
        const duration = root === "annualRealGrowthDelta" && Number.isInteger(effects.durationDays)
          ? " / " + effects.durationDays + " days" : "";
        const unit = root === "annualRealGrowthDelta" ? " percentage points" :
          ["gdpChangePercent", "debtFinancedOutlayPercentGdp"].includes(root) ? "% GDP" : "";
        rows.push({
          country, field: "statsEffects." + item.path, source: "Dated event effect", eventIndex,
          reason: String(effects.reason || event?.title || ""),
          before: baselinePath ? statValue(read(sheets[country], baselinePath)) : "Not applicable",
          proposed: statValue(item.value) + unit + duration,
          kind: "effect",
        });
      }
    }
  }
  for (const patch of list(countryStatPatches)) {
    const country = String(patch?.country || "").trim();
    if (!country) continue;
    addAbsolute({
      country, patch: patch.patch, source: "Direct baseline", eventIndex: null,
      reason: patch.reason || "",
    });
  }
  return { count: rows.length, rows };
};
