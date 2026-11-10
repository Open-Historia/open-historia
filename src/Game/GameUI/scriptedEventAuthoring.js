/*! Open Historia — pure authoring helpers for structured scripted-event predicates © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { toCountryName } from "../../runtime/ownerNames.js";
import { resolveRegionName } from "../../runtime/regionNameFixes.js";

const text = (value) => String(value ?? "").trim();
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];

const addOption = (map, idInput, labelInput) => {
  const id = text(idInput);
  if (!id) return;
  const label = text(labelInput) || toCountryName(id) || id;
  const existing = map.get(id);
  if (!existing || existing.label === existing.id) map.set(id, { id, label });
};

export const scriptedEventPolityOptions = (worldInput = {}) => {
  const world = record(worldInput);
  const options = new Map();
  const overrides = record(world.polityOverrides);
  const actors = record(record(world.politicalActors).byPolity);
  const stats = record(world.countryStats);
  const power = record(record(world.powerStatus).byPolity);

  for (const id of array(world.ownerCodes)) addOption(options, id, text(overrides[id]?.name) || text(actors[id]?.name));
  for (const [id, polity] of Object.entries(overrides)) addOption(options, id, polity?.name || polity?.code);
  for (const [id, actor] of Object.entries(actors)) addOption(options, id, actor?.name || actor?.polityKey);
  for (const id of Object.keys(stats)) addOption(options, id, overrides[id]?.name || actors[id]?.name);
  for (const id of Object.keys(power)) addOption(options, id, overrides[id]?.name || actors[id]?.name);

  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
};

export const scriptedEventInstitutionOptions = (worldInput = {}) => {
  const world = record(worldInput);
  const source = record(world.institutions);
  const byId = record(source.byId && typeof source.byId === "object" ? source.byId : source);
  return Object.entries(byId)
    .map(([key, institution]) => {
      if (!institution || typeof institution !== "object" || Array.isArray(institution)) return null;
      const id = text(institution.id || key);
      if (!id) return null;
      return { id, label: text(institution.name || institution.shortName) || id };
    })
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
};

export const scriptedEventPickerLabel = (value, optionsInput = []) => {
  const id = text(value);
  if (!id) return "";
  return optionsInput.find((option) => option.id === id)?.label || id;
};

export const scriptedEventPickerValue = (typed, optionsInput = []) => {
  const value = text(typed);
  if (!value) return "";
  const exactLabel = optionsInput.filter((option) => option.label === value);
  if (exactLabel.length === 1) return exactLabel[0].id;
  const exactId = optionsInput.find((option) => option.id === value);
  return exactId?.id || value;
};

// The region picker's rows: { id, name, owner, baseOwner } for every region the
// map draws, named as the map spells them. `geojson` is the scenario's own
// regions (null for one on the stock world, whose `catalog` rows name them).
export const pickerRegionRows = ({ geojson = null, catalog = [], ownerOverrides = null } = {}) => {
  const overrides = record(ownerOverrides);
  const rows = [];
  const seen = new Set();
  const add = (idInput, rawName, baseOwnerInput) => {
    const id = text(idInput);
    if (!id || seen.has(id)) return;
    const name = resolveRegionName(id, rawName);
    if (!name) return;
    seen.add(id);
    const baseOwner = text(baseOwnerInput);
    const override = Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : undefined;
    const owner = typeof override === "string" ? text(override) : baseOwner;
    rows.push({ id, name, owner, baseOwner });
  };
  if (Array.isArray(geojson?.features) && geojson.features.length) {
    for (const feature of geojson.features) {
      const props = record(feature?.properties);
      const id = props.id ?? props.GID_1 ?? props.gid_1 ?? props.HASC_1 ?? feature?.id;
      add(id, props.name ?? props.NAME_1 ?? props.name_1, props.owner || (props.gid0 ? toCountryName(props.gid0) : "") || props.country);
    }
  } else {
    for (const entry of array(catalog)) add(entry?.id, entry?.name, entry?.country || (entry?.countryCode ? toCountryName(entry.countryCode) : ""));
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name) || left.owner.localeCompare(right.owner));
};

const folded = (value) => text(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Regions whose name holds the query, accents ignored ("chisinau" finds
// "Chişinău"); those that start with it first.
export const searchPickerRegions = (rows, query, limit = 40) => {
  const needle = folded(query);
  if (!needle) return [];
  const starts = [];
  const contains = [];
  for (const row of array(rows)) {
    const name = folded(row?.name);
    if (name.startsWith(needle)) starts.push(row);
    else if (name.includes(needle)) contains.push(row);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
};

// The owners on the map, each with how many regions it holds.
export const pickerOwnerOptions = (rows) => {
  const counts = new Map();
  for (const row of array(rows)) {
    const owner = text(row?.owner);
    if (owner) counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((left, right) => left.owner.localeCompare(right.owner));
};

const asRegion = (row) => ({ id: text(row?.id), name: text(row?.name) || text(row?.id), ...(text(row?.baseOwner) ? { baseOwner: text(row.baseOwner) } : {}) });

// A region clicked: in when it was out, out when it was in. `single` keeps
// only the region clicked.
export const togglePickerRegion = (selected, row, { single = false } = {}) => {
  const region = asRegion(row);
  if (!region.id) return array(selected);
  const list = array(selected);
  if (list.some((entry) => entry.id === region.id)) return single ? [] : list.filter((entry) => entry.id !== region.id);
  return single ? [region] : [...list, region];
};

// A country chosen: all its regions in, or, when all were in already, out.
export const toggleOwnerRegions = (selected, rows, owner) => {
  const list = array(selected);
  const theirs = array(rows).filter((row) => text(row?.owner) === text(owner)).map(asRegion);
  if (!theirs.length) return list;
  const chosen = new Set(list.map((entry) => entry.id));
  if (theirs.every((region) => chosen.has(region.id))) {
    const drop = new Set(theirs.map((region) => region.id));
    return list.filter((entry) => !drop.has(entry.id));
  }
  return [...list, ...theirs.filter((region) => !chosen.has(region.id))];
};

export const regionNameList = (regions) => array(regions).map((region) => text(region?.name)).filter(Boolean).join(", ");

// The names written into the text where the cursor was, replacing what was
// selected, with a space before them when they would touch a word.
export const insertAtCursor = (value, insertion, start, end = start) => {
  const source = String(value ?? "");
  const words = String(insertion ?? "");
  const from = Number.isInteger(start) ? Math.max(0, Math.min(source.length, start)) : source.length;
  const to = Number.isInteger(end) ? Math.max(from, Math.min(source.length, end)) : from;
  if (!words) return { value: source, cursor: from };
  const before = source.slice(0, from);
  const after = source.slice(to);
  const lead = before && !/[\s([{]$/.test(before) ? " " : "";
  const trail = after && /^[\p{L}\p{N}]/u.test(after) ? " " : "";
  const next = `${before}${lead}${words}${trail}${after}`;
  return { value: next, cursor: before.length + lead.length + words.length };
};
