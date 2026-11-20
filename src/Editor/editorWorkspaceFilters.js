/*!
 * Open Historia Map Editor - management workspace filtering and list selection.
 * Pure data projections: canonical map / scenario objects remain authoritative.
 */
import { ownersMatchingQuery, regionMatchesQuery } from "./regionSearch.js";
import { isCityFeature } from "./cityMarkers.js";

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const alpha = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
export const WORKSPACE_PAGE_SIZE = 60;
export const pageOf = (rows, count = WORKSPACE_PAGE_SIZE) => rows.slice(0, Math.max(0, count));

export const filterRegionsForWorkspace = (regions = [], {
  query = "", owner = "*", typeId = "*", group = "*", selectedOnly = false,
  selectedIds = [], polities = {}, sort = "name",
} = {}) => {
  const owners = ownersMatchingQuery(polities, fold(query));
  const selected = new Set(selectedIds);
  return regions.filter((row) => {
    if (!regionMatchesQuery(row, query, owners)) return false;
    if (owner !== "*" && (row.owner || "") !== owner) return false;
    if (typeId !== "*" && (row.typeId || "land") !== typeId) return false;
    if (group !== "*" && (row.group || "") !== group) return false;
    return !selectedOnly || selected.has(row.id);
  }).sort((a, b) => {
    const primary = sort === "owner" ? alpha(a.owner || "", b.owner || "")
      : sort === "type" ? alpha(a.typeId || "", b.typeId || "")
        : sort === "id" ? alpha(a.id, b.id)
          : alpha(a.name || a.id, b.name || b.id);
    return primary || alpha(a.id, b.id);
  });
};

export const filterMapFeaturesForWorkspace = (features = [], {
  query = "", category = "*", owner = "*", selectedOnly = false, selectedIds = [],
} = {}) => {
  const q = fold(query);
  const selected = new Set(selectedIds.map(String));
  return features.filter((f) => {
    if (category === "city" && !isCityFeature(f)) return false;
    if (category === "feature" && isCityFeature(f)) return false;
    if (category !== "*" && category !== "city" && category !== "feature" && clean(f.kind) !== category) return false;
    if (owner !== "*" && (clean(f.owner) || clean(f.country)) !== owner) return false;
    if (selectedOnly && !selected.has(String(f.id))) return false;
    const hay = [f.name, f.type, f.kind, f.owner, f.country, f.regionId,
      ...(Array.isArray(f.tags) ? f.tags : [])].map(clean).join(" ").toLocaleLowerCase();
    return !q || hay.includes(q);
  }).sort((a, b) => alpha(a.name || a.id, b.name || b.id) || alpha(a.id, b.id));
};

export const filterUnitsForWorkspace = (units = [], {
  query = "", owner = "*", kind = "*", unitTypes = [], polityName = (key) => key,
} = {}) => {
  const q = fold(query);
  const names = new Map(unitTypes.map((type) => [type.id, type.name]));
  return units.filter((u) => {
    if (owner !== "*" && clean(u.ownerCode) !== owner) return false;
    if (kind !== "*" && clean(u.type) !== kind) return false;
    const hay = [u.name, u.type, u.ownerCode, polityName(u.ownerCode),
      u.composition, u.note, names.get(u.unitType)].map(clean).join(" ").toLocaleLowerCase();
    return !q || hay.includes(q);
  }).sort((a, b) => alpha(polityName(a.ownerCode), polityName(b.ownerCode))
    || alpha(a.name, b.name) || alpha(a.id, b.id));
};

export const groupRowsForWorkspace = (groups = {}, usage = {}, { query = "", scope = "all" } = {}) => {
  const q = fold(query);
  return [...new Set([...Object.keys(groups || {}), ...Object.keys(usage || {})])]
    .map((key) => ({ key, record: groups?.[key] ?? null, regions: usage[key] || 0 }))
    .filter((row) => {
      if (scope === "territorial" && !row.regions) return false;
      if (scope === "landless" && row.regions) return false;
      return !q || [row.key, row.record?.description, row.record?.owner, ...(row.record?.formerNames || [])]
        .some((value) => fold(value).includes(q));
    })
    .sort((a, b) => alpha(a.key, b.key));
};

// A plain click replaces selection; Ctrl/Cmd toggles, Shift extends from the
// previous anchor within the CURRENT filtered ordering. No global IDs inferred.
export const selectionAfterWorkspacePick = (selectedIds, shownIds, id, {
  additive = false, range = false, anchor = null,
} = {}) => {
  const ids = Array.isArray(shownIds) ? shownIds : [];
  const previous = new Set(selectedIds || []);
  if (range && ids.includes(anchor) && ids.includes(id)) {
    const start = ids.indexOf(anchor);
    const end = ids.indexOf(id);
    const next = additive ? previous : new Set();
    for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) next.add(ids[i]);
    return [...next];
  }
  if (!additive) return [id];
  if (previous.has(id)) previous.delete(id);
  else previous.add(id);
  return [...previous];
};
