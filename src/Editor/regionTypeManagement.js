/*!
 * Native Map Editor region-type management projections and destructive guards.
 * typeId references remain in the map until the region's type is changed.
 */
import { MAX_REGION_TYPES } from "../runtime/regionTypes.js";

const string = (v) => String(v ?? "").trim();
const lower = (v) => string(v).toLocaleLowerCase();

export function regionTypeDeletionReason(types, usage, id) {
  if (!(types || []).some((type) => type.id === id)) return "This type no longer exists.";
  if ((types || []).length <= 1) return "At least one region type must remain.";
  const references = Number(usage?.[id]) || 0;
  if (references > 0) return `Assign another type to the ${references.toLocaleString()} regions using this type before deleting it.`;
  return null;
}

export function canCreateRegionType(types) {
  return Array.isArray(types) && types.length < MAX_REGION_TYPES;
}

export function filterRegionTypes(types, usage, { query = "", scope = "all" } = {}) {
  const q = lower(query);
  return (Array.isArray(types) ? types : []).filter((type) => {
    const count = Number(usage?.[type.id]) || 0;
    if (scope === "used" && !count) return false;
    if (scope === "unused" && count) return false;
    return !q || [type.id, type.name].some((value) => lower(value).includes(q));
  }).sort((a, b) => string(a.name).localeCompare(string(b.name), undefined, { sensitivity: "base" }) || string(a.id).localeCompare(string(b.id)));
}

export function uniqueRegionTypeId(types, token) {
  const keys = new Set((Array.isArray(types) ? types : []).map((type) => type.id));
  const base = `type_${string(token) || "new"}`;
  if (!keys.has(base)) return base;
  let i = 2;
  while (keys.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
