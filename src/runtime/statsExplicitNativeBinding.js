/*! Open Historia - explicit, author-chosen binding of an existing custom
 * presentation card to an already canonical national Statistics reading.
 * This only stages a definition; it does not migrate/write any country values.
 */
import { NATIONAL_NATIVE_METRICS, normalizeStatSheetDefinition } from "./statIndexDefinitions.js";

export const stageExplicitNativeStatsBinding = (definitionInput, { key, nativeMetric } = {}) => {
  const def = normalizeStatSheetDefinition(definitionInput, { fallbackStandard: false });
  if (!def.custom) throw new Error("Only a custom Statistics definition has bindable cards.");
  const native = NATIONAL_NATIVE_METRICS[nativeMetric];
  if (!native) throw new Error("Choose an existing native national Statistics metric.");
  const matches = def.sections.flatMap((section) => section.stats).filter((item) => item.key === key);
  if (matches.length !== 1) throw new Error("Select one existing Statistics card by its exact key.");
  const old = matches[0];
  if (old.nativeMetric) throw new Error("This card already has a canonical native source.");
  if (old.kind !== native.kind) {
    throw new Error(`Card ${key} uses ${old.kind}; native ${nativeMetric} requires ${native.kind}. Review its display type and units in the Advanced Statistics Editor first.`);
  }

  const sections = def.sections.map((section) => ({
    ...section,
    stats: section.stats.map((item) => item.key === key ? {
      ...item, nativeMetric,
      ...(native.minimum === undefined ? { minimum: undefined } : { minimum: native.minimum }),
      ...(native.maximum === undefined ? { maximum: undefined } : { maximum: native.maximum }),
    } : item),
  }));
  // The author explicitly opted to replace this card's source. Any existing
  // visual tiles that read that SAME old key must follow the chosen source,
  // retaining their placement, size, labels and accents.
  const oldSource = `custom:${key}`;
  const newSource = `native:${nativeMetric}`;
  const dashboard = def.dashboard ? {
    ...def.dashboard,
    widgets: def.dashboard.widgets.map((widget) =>
      widget.source === oldSource ? { ...widget, source: newSource } : widget),
  } : undefined;
  const staged = normalizeStatSheetDefinition({
    ...def, sections, ...(dashboard ? { dashboard } : {}),
  }, { fallbackStandard: false });
  const converted = staged.sections.flatMap((section) => section.stats).find((item) => item.key === key);
  if (converted?.nativeMetric !== nativeMetric) throw new Error("Native binding failed to round-trip.");
  if (def.dashboard && staged.dashboard?.widgets.length !== def.dashboard.widgets.length) {
    throw new Error("Dashboard binding update would discard a widget.");
  }
  return staged;
};
