/*!
 * Open Historia Map Editor — reviewing a suggestion's map changes
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The Workshop's half of reviewing a suggestion (src/runtime/scenarioSuggestion.js):
// every map change a player suggested for this scenario, measured against the
// map as it is open here, applied when the author accepts it and taken back
// when they undo that. Region edits go through the map's own undo stack
// (OlMap api); the document's (countries, groups, cities, units, features,
// puppets) through useMapDocument's setters, with what they replaced kept so
// Undo can put it back.
//
// ctx = { api, doc, d, setBackground } — the OlMap api, the current document,
// the useMapDocument hook's setters, and MapEditor's own background setter.

import { markerToFeature } from "./mapFeatures.js";
import { newId } from "./useMapDocument.js";
import { withoutPolities } from "./scenarioPuppets.js";
import { canonicalJson, cityTierOf, hashText, measureGeometry, sameShape, sameValue } from "../runtime/scenarioChanges.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const rgbOf = (value) => {
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))));
  const match = /^#?([a-f0-9]{6})$/i.exec(clean(value));
  return match ? [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16)) : null;
};

// ---- where each change belongs in the panel -----------------------------------

export { REVIEW_SECTIONS, sectionOfChange } from "../runtime/suggestionSections.js";

// ---- the map as it is open ----------------------------------------------------

const regionOf = (ctx, id) => ctx.api?.getRegionSummary?.(String(id)) ?? null;
// What a review reads of the map over and over, kept while the regions stay
// as they are (the hook makes a new one on every MapEditor regionEpoch): each
// region's measured shape, and which regions each owner and each group has.
export const createRegionCache = () => ({ shapes: new globalThis.Map(), owners: null, groups: null });
const regionShape = (ctx, id, cache) => {
  const key = String(id);
  if (cache?.shapes.has(key)) return cache.shapes.get(key);
  const fc = ctx.api?.exportRegions?.([key]);
  const feature = fc?.features?.[0];
  const shape = feature ? measureGeometry(feature.geometry) : null;
  cache?.shapes.set(key, shape);
  return shape;
};
const indexRegions = (ctx, cache) => {
  if (cache.owners) return cache;
  cache.owners = new globalThis.Map();
  cache.groups = new globalThis.Map();
  const add = (index, key, id) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(id);
  };
  for (const region of ctx.api?.queryRegions?.("", Infinity) ?? []) {
    add(cache.owners, String(region.owner ?? "").trim(), region.id);
    add(cache.groups, clean(region.group), region.id);
  }
  return cache;
};
// The ids of the regions an owner holds (as listOwnerRegions finds them), and
// of those a group controls.
const ownerRegionIds = (ctx, key, cache) => {
  const owner = String(key ?? "").trim();
  if (!owner) return [];
  if (cache) return indexRegions(ctx, cache).owners.get(owner) ?? [];
  return (ctx.api?.listOwnerRegions?.(owner) ?? []).map((region) => region.id);
};
const groupRegionIds = (ctx, key, cache) => {
  if (cache) return indexRegions(ctx, cache).groups.get(clean(key)) ?? [];
  return (ctx.api?.queryRegions?.("", 100000) ?? []).filter((region) => clean(region.group) === key).map((region) => region.id);
};
const cityFeatures = (doc) => (doc?.features ?? []).filter((feature) => !clean(feature?.kind));
const nearCity = (feature, city) => clean(feature?.name).toLowerCase() === clean(city?.name).toLowerCase()
  && Array.isArray(feature?.coord) && Array.isArray(city?.coord)
  && Math.abs(Number(feature.coord[0]) - Number(city.coord[0])) <= 0.05
  && Math.abs(Number(feature.coord[1]) - Number(city.coord[1])) <= 0.05;
const findCity = (doc, city) => cityFeatures(doc).find((feature) => nearCity(feature, city)) ?? null;
// A city as the comparison reads it (scenarioChanges.js): its size is the
// authored tier or the one its population gives.
const cityView = (feature) => feature ? {
  name: clean(feature.name),
  population: Math.max(0, Math.round(Number(feature.population) || 0)),
  capital: (feature.tags || []).includes("capital"),
  tier: cityTierOf(feature.tier, feature.population),
  ...(isRecord(feature.populationByYear) && Object.keys(feature.populationByYear).length ? { populationByYear: feature.populationByYear } : {}),
} : null;
const suggestedCityView = (city) => city ? {
  name: clean(city.name),
  population: Math.max(0, Math.round(Number(city.population) || 0)),
  capital: Boolean(city.capital),
  tier: cityTierOf(city.tier, city.population),
  ...(isRecord(city.populationByYear) && Object.keys(city.populationByYear).length ? { populationByYear: city.populationByYear } : {}),
} : null;
const markerFeatureOf = (doc, key) => (doc?.features ?? []).find((feature) => clean(feature?.kind)
  && (clean(feature.markerId) === key || `marker-${clean(feature.id)}` === key)) ?? null;
const unitView = (unit) => unit ? {
  name: clean(unit.name), type: clean(unit.type).toLowerCase(), ownerCode: clean(unit.ownerCode),
  lng: Number(Number(unit.lng).toFixed(4)), lat: Number(Number(unit.lat).toFixed(4)),
  strength: Math.round(Number(unit.strength) || 0), composition: clean(unit.composition), note: clean(unit.note),
} : null;
const markerView = (marker) => marker ? {
  name: clean(marker.name), kind: clean(marker.kind).toLowerCase(), ownerCode: clean(marker.ownerCode ?? marker.owner),
  lng: Number(Number(marker.lng ?? marker.coord?.[0]).toFixed(4)), lat: Number(Number(marker.lat ?? marker.coord?.[1]).toFixed(4)),
  status: clean(marker.status) || "active", note: clean(marker.note),
} : null;
// The custom basemap as the diff fingerprints it (scenarioChanges.js
// buildScenarioSnapshot): its kind and a hash of the payload a save uploads
// (exportPreset.js buildBackgroundForGame), or null. Kept per basemap object:
// the payload runs to megabytes, and the statuses are worked out again on
// every document edit while the basemap stays the same object.
const backgroundHashes = new WeakMap();
const backgroundOf = (saved) => {
  if (!isRecord(saved)) return null;
  if (backgroundHashes.has(saved)) return backgroundHashes.get(saved);
  let fingerprint = null;
  if (saved.kind === "image" && saved.dataUrl) fingerprint = { kind: "image", hash: hashText(canonicalJson({ dataUrl: saved.dataUrl })) };
  else if (saved.kind === "vector" && Array.isArray(saved.geojson?.features)) fingerprint = { kind: "vector", hash: hashText(canonicalJson({ geojson: saved.geojson })) };
  backgroundHashes.set(saved, fingerprint);
  return fingerprint;
};
const puppetView = (row) => row ? {
  overlord: clean(row.overlord), puppet: clean(row.puppet), kind: clean(row.kind) || "satellite",
  secrecy: row.secrecy === "covert" ? "covert" : "open", loyalty: Math.round(Number(row.loyalty) || 0), status: clean(row.status) || "active",
} : null;

// A country's key after the renames the author accepted in this review, so a
// change written against the old name still lands on the country.
const renamed = (key, renames) => {
  let current = clean(key);
  for (let guard = 0; guard < 8 && renames?.[current]; guard += 1) current = renames[current];
  return current;
};

const POLITY_FIELD_KEYS = ["name", "aliases", "code", "note", "status"];
const polityFieldValue = (ctx, key, field) => {
  const record = ctx.doc?.polities?.[key];
  if (field === "color") return rgbOf(ctx.doc?.colorOverrides?.[key]) || rgbOf(record?.color);
  if (field === "flag") return ctx.doc?.flags?.[key] ?? null;
  if (field === "tags") return [...new Set((ctx.doc?.tags?.[key] ?? []).map(clean).filter(Boolean))].sort();
  if (field === "aliases") {
    const name = clean(record?.name) || key;
    return [...new Set((record?.aliases ?? []).map(clean).filter((alias) => alias && alias !== name && alias !== key))].sort();
  }
  if (field === "code") return clean(record?.code) === key ? "" : clean(record?.code);
  if (field === "status") return clean(record?.status) || "active";
  if (field === "name") return clean(record?.name) || key;
  return clean(record?.[field]);
};

// "open" (the map still has the post's value: accepting applies it),
// "conflict" (the author changed it since), "applied" (already so), or
// "missing" (what it changes is not on this map any more).
export const mapChangeStatus = (change, ctx, { renames = {}, cache = null } = {}) => {
  const fromOwner = (value) => renamed(value, renames);
  switch (change.kind) {
    case "region-owner": {
      const region = regionOf(ctx, change.regionId);
      if (!region) return "missing";
      const current = clean(region.owner);
      if (current === clean(fromOwner(change.to))) return "applied";
      if (change.fromStock || current === clean(fromOwner(change.from))) return "open";
      return "conflict";
    }
    case "region-name":
    case "region-type": {
      const region = regionOf(ctx, change.regionId);
      if (!region) return "missing";
      const current = change.kind === "region-name" ? clean(region.name) : clean(region.typeId) || "land";
      if (current === clean(change.to)) return "applied";
      return current === clean(change.from) ? "open" : "conflict";
    }
    case "region-claims": {
      const region = regionOf(ctx, change.regionId);
      if (!region) return "missing";
      const current = [...new Set((region.claimants ?? []).map(clean).filter(Boolean))].sort();
      if (sameValue(current, (change.to ?? []).map((key) => fromOwner(key)).sort())) return "applied";
      return sameValue(current, (change.from ?? []).map((key) => fromOwner(key)).sort()) ? "open" : "conflict";
    }
    case "region-group": {
      const region = regionOf(ctx, change.regionId);
      if (!region) return "missing";
      const current = clean(region.group);
      if (current === clean(change.to)) return "applied";
      return current === clean(change.from) ? "open" : "conflict";
    }
    case "borders": {
      // Each region: already as suggested, still as posted, or redrawn here.
      let applied = 0;
      let conflict = false;
      for (const region of change.regions ?? []) {
        const shape = regionShape(ctx, region.id, cache);
        const suggested = region.toShape ?? (region.feature ? measureGeometry(region.feature.geometry) : null);
        if (region.op === "remove") {
          if (!shape) applied += 1;
          else if (region.fromShape && !sameShape(shape, region.fromShape)) conflict = true;
        } else if (shape && suggested && sameShape(shape, suggested)) {
          applied += 1;
        } else if (region.op === "add" ? Boolean(shape) : !shape || (region.fromShape && !sameShape(shape, region.fromShape))) {
          conflict = true;
        }
      }
      if (applied === (change.regions ?? []).length) return "applied";
      return conflict ? "conflict" : "open";
    }
    case "polity-add":
      return ctx.doc?.polities?.[change.key] ? "applied" : "open";
    case "polity-remove": {
      const owned = ownerRegionIds(ctx, change.key, cache).length;
      return !ctx.doc?.polities?.[change.key] && !owned ? "applied" : "open";
    }
    case "polity-rename":
      if (ctx.doc?.polities?.[change.to] && !ctx.doc?.polities?.[change.from]) return "applied";
      return ctx.doc?.polities?.[change.from] || ownerRegionIds(ctx, change.from, cache).length ? "open" : "missing";
    case "polity-change": {
      const key = fromOwner(change.key);
      let open = false;
      let conflict = false;
      let applied = true;
      for (const [field, values] of Object.entries(change.fields ?? {})) {
        if (field === "extra") { applied = false; open = true; continue; }
        const current = polityFieldValue(ctx, key, field);
        const to = field === "color" ? rgbOf(values.to) : values.to;
        if (field === "flag") {
          if (clean(current) === clean(values.to)) continue;
          applied = false;
          open = true;
          continue;
        }
        if (sameValue(current, to)) continue;
        applied = false;
        const from = field === "color" ? rgbOf(values.from) : values.from;
        if (sameValue(current, from)) open = true;
        else conflict = true;
      }
      if (applied && !open) return "applied";
      return conflict ? "conflict" : "open";
    }
    case "group-add":
      return ctx.doc?.groups?.[change.key] ? "applied" : "open";
    case "group-remove":
      return ctx.doc?.groups?.[change.key] ? "open" : "applied";
    case "group-change": {
      const current = ctx.doc?.groups?.[change.key];
      if (!current) return "missing";
      if (sameValue({ d: current.description, c: current.color }, { d: change.to?.description, c: change.to?.color })) return "applied";
      return sameValue({ d: current.description, c: current.color }, { d: change.from?.description, c: change.from?.color }) ? "open" : "conflict";
    }
    case "city-add":
      return findCity(ctx.doc, change.to) ? "applied" : "open";
    case "city-remove":
      return findCity(ctx.doc, change.from) ? "open" : "applied";
    case "city-change": {
      const current = findCity(ctx.doc, change.from) ?? findCity(ctx.doc, change.to);
      if (!current) return "missing";
      if (sameValue(cityView(current), suggestedCityView(change.to))) return "applied";
      return sameValue(cityView(current), suggestedCityView(change.from)) ? "open" : "conflict";
    }
    case "cities-replace": {
      // The post had its own cities (change.from counts them) or the built-in
      // set (null); the suggestion has its own (a list) or the built-in set.
      const current = cityFeatures(ctx.doc);
      const authored = Boolean(ctx.doc?.metadata?.citiesAuthored) || current.length > 0;
      if (Array.isArray(change.to)
        ? authored && current.length === change.to.length && change.to.every((city) => sameValue(cityView(findCity(ctx.doc, city)), suggestedCityView(city)))
        : !authored) return "applied";
      if (change.from === null || change.from === undefined) return authored ? "conflict" : "open";
      return current.length === Number(change.from) ? "open" : "conflict";
    }
    case "unit-add":
      return (ctx.doc?.units ?? []).some((unit) => clean(unit.id) === change.key) ? "applied" : "open";
    case "unit-remove":
      return (ctx.doc?.units ?? []).some((unit) => clean(unit.id) === change.key) ? "open" : "applied";
    case "unit-change": {
      const current = (ctx.doc?.units ?? []).find((unit) => clean(unit.id) === change.key);
      if (!current) return "missing";
      if (sameValue(unitView(current), unitView(change.to))) return "applied";
      return sameValue(unitView(current), unitView(change.from)) ? "open" : "conflict";
    }
    case "marker-add":
      return markerFeatureOf(ctx.doc, change.key) ? "applied" : "open";
    case "marker-remove":
      return markerFeatureOf(ctx.doc, change.key) ? "open" : "applied";
    case "marker-change": {
      const current = markerFeatureOf(ctx.doc, change.key);
      if (!current) return "missing";
      if (sameValue(markerView(current), markerView(change.to))) return "applied";
      return sameValue(markerView(current), markerView(change.from)) ? "open" : "conflict";
    }
    case "puppet-add":
      return (ctx.doc?.puppets ?? []).some((row) => clean(row.id) === change.key) ? "applied" : "open";
    case "puppet-remove":
      return (ctx.doc?.puppets ?? []).some((row) => clean(row.id) === change.key) ? "open" : "applied";
    case "puppet-change": {
      const current = (ctx.doc?.puppets ?? []).find((row) => clean(row.id) === change.key);
      if (!current) return "missing";
      if (sameValue(puppetView(current), puppetView(change.to))) return "applied";
      return sameValue(puppetView(current), puppetView(change.from)) ? "open" : "conflict";
    }
    case "map-field": {
      const current = change.field === "author" ? clean(ctx.doc?.metadata?.author) : clean(ctx.doc?.metadata?.basemap);
      if (current === clean(change.to)) return "applied";
      return current === clean(change.from) ? "open" : "conflict";
    }
    case "background": {
      const current = backgroundOf(ctx.doc?.metadata?.customBackground);
      const matches = (entry) => (entry ? Boolean(current) && current.kind === clean(entry.kind) && current.hash === entry.hash : !current);
      if (matches(change.to)) return "applied";
      return matches(change.from) ? "open" : "conflict";
    }
    default:
      return "open";
  }
};

// ---- what a change needs first ------------------------------------------------

// The countries and groups a change names that this map does not have, which
// the suggestion itself adds: accepting the change accepts those first, so a
// region is never handed to a country the map has never heard of.
export const changeDependencies = (change, changes, ctx) => {
  const polities = new Set();
  const groups = new Set();
  const addPolity = (key) => { const value = clean(key); if (value) polities.add(value); };
  switch (change.kind) {
    case "region-owner": addPolity(change.to); break;
    case "region-claims": (change.to ?? []).forEach(addPolity); break;
    case "region-group": if (change.to) groups.add(clean(change.to)); break;
    case "borders":
      for (const region of change.regions ?? []) {
        if (region.op === "remove") continue;
        addPolity(region.feature?.properties?.owner);
        (region.feature?.properties?.claimants ?? []).forEach(addPolity);
        if (region.feature?.properties?.group) groups.add(clean(region.feature.properties.group));
      }
      break;
    case "unit-add": case "unit-change": addPolity(change.to?.ownerCode); break;
    case "marker-add": case "marker-change": addPolity(change.to?.ownerCode); break;
    case "puppet-add": case "puppet-change": addPolity(change.to?.overlord); addPolity(change.to?.puppet); break;
    default: break;
  }
  const needed = [];
  for (const key of polities) {
    if (ctx.doc?.polities?.[key]) continue;
    const adding = changes.find((entry) => (entry.kind === "polity-add" && entry.key === key) || (entry.kind === "polity-rename" && entry.to === key));
    if (adding && adding.id !== change.id) needed.push(adding.id);
  }
  for (const key of groups) {
    if (ctx.doc?.groups?.[key]) continue;
    const adding = changes.find((entry) => entry.kind === "group-add" && entry.key === key);
    if (adding && adding.id !== change.id) needed.push(adding.id);
  }
  return needed;
};

// ---- accepting, and taking it back --------------------------------------------

const polityRecordPatch = (record, fields) => {
  const source = isRecord(record) ? record : {};
  const patch = {};
  for (const field of fields) {
    if (field === "extra") {
      for (const [key, value] of Object.entries(source)) {
        if (!["name", "aliases", "code", "note", "status", "color", "formerNames", "mapRefs", "verbatim"].includes(key)) patch[key] = clone(value);
      }
    } else if (POLITY_FIELD_KEYS.includes(field) && source[field] !== undefined) {
      patch[field] = clone(source[field]);
    }
  }
  return patch;
};

const capturePolity = (ctx, key) => ({
  key,
  record: clone(ctx.doc?.polities?.[key]),
  color: clone(ctx.doc?.colorOverrides?.[key]),
  flag: ctx.doc?.flags?.[key] ?? null,
  tags: clone(ctx.doc?.tags?.[key]),
});
const restorePolity = (ctx, saved) => {
  if (!saved) return;
  if (saved.record) {
    ctx.d.setPolities((polities) => ({ ...polities, [saved.key]: saved.record }));
  } else {
    ctx.d.setPolities((polities) => {
      const next = { ...polities };
      delete next[saved.key];
      return next;
    });
  }
  ctx.d.setColorOverride(saved.key, saved.color ?? null);
  ctx.d.setFlag(saved.key, saved.flag ?? null);
  ctx.d.setTags(saved.key, saved.tags ?? []);
};
const regionAttrs = (ctx, ids, field) => ids.map((id) => [id, regionOf(ctx, id)?.[field] ?? null]);
const restoreRegionAttrs = (ctx, rows, field) => {
  for (const [id, value] of rows) ctx.api?.setRegionAttrs?.([id], { [field]: field === "claimants" ? (value?.length ? value : null) : value });
};
const editorUnit = (unit) => ({
  id: String(unit?.id || newId("unit")),
  name: String(unit?.name || "Unit"),
  type: String(unit?.type || "infantry"),
  ownerCode: String(unit?.ownerCode || ""),
  lng: Number(unit?.lng),
  lat: Number(unit?.lat),
  strength: Number.isFinite(Number(unit?.strength)) ? Number(unit.strength) : 100,
  composition: String(unit?.composition || ""),
  note: String(unit?.note || ""),
});
const editorCity = (city, id = newId("feat")) => ({
  id,
  name: clean(city?.name) || "City",
  type: "Coordinate",
  symbol: "square",
  coord: [Number(city?.coord?.[0]), Number(city?.coord?.[1])],
  country: "",
  owner: null,
  regionId: null,
  population: Math.max(0, Math.round(Number(city?.population) || 0)),
  tags: city?.capital ? ["city", "capital"] : ["city"],
  ...(city?.tier ? { tier: city.tier } : {}),
  ...(isRecord(city?.populationByYear) && Object.keys(city.populationByYear).length ? { populationByYear: { ...city.populationByYear } } : {}),
});

// Accept one change: make the map say what it suggests. Returns the function
// that takes it back (Undo), or null when there was nothing to do.
export const applyMapChange = (change, ctx, { renames = {} } = {}) => {
  const { api, d } = ctx;
  const owner = (key) => renamed(key, renames) || null;
  switch (change.kind) {
    case "region-owner": {
      const before = regionAttrs(ctx, [change.regionId], "owner");
      api.setRegionAttrs([String(change.regionId)], { owner: owner(change.to) });
      return () => restoreRegionAttrs(ctx, before, "owner");
    }
    case "region-name": {
      const before = regionAttrs(ctx, [change.regionId], "name");
      api.setRegionAttrs([String(change.regionId)], { name: change.to || "" });
      return () => restoreRegionAttrs(ctx, before, "name");
    }
    case "region-type": {
      const before = regionAttrs(ctx, [change.regionId], "typeId");
      api.setRegionAttrs([String(change.regionId)], { typeId: change.to || "land" });
      return () => restoreRegionAttrs(ctx, before, "typeId");
    }
    case "region-claims": {
      const before = regionAttrs(ctx, [change.regionId], "claimants");
      api.setRegionAttrs([String(change.regionId)], { claimants: (change.to ?? []).map(owner).filter(Boolean) });
      return () => restoreRegionAttrs(ctx, before, "claimants");
    }
    case "region-group": {
      const before = regionAttrs(ctx, [change.regionId], "group");
      api.setRegionAttrs([String(change.regionId)], { group: change.to || null });
      return () => restoreRegionAttrs(ctx, before, "group");
    }
    case "borders": {
      const ids = (change.regions ?? []).map((region) => String(region.id));
      const existed = new Set(ids.filter((id) => regionOf(ctx, id)));
      const before = api.exportRegions([...existed]);
      const upsert = (change.regions ?? [])
        .filter((region) => region.op !== "remove" && region.feature)
        .map((region) => ({
          ...region.feature,
          properties: {
            ...(region.feature.properties ?? {}),
            owner: owner(region.feature.properties?.owner) || "",
            claimants: (region.feature.properties?.claimants ?? []).map(owner).filter(Boolean),
          },
        }));
      const remove = (change.regions ?? []).filter((region) => region.op === "remove").map((region) => String(region.id));
      api.applyRegionPatch({ upsert, remove });
      return () => api.applyRegionPatch({
        upsert: before.features ?? [],
        remove: ids.filter((id) => !existed.has(id)),
        withAttributes: true,
      });
    }
    case "polity-add": {
      const saved = capturePolity(ctx, change.key);
      const record = isRecord(change.record) ? change.record : {};
      d.upsertPolity(change.key, polityRecordPatch(record, [...POLITY_FIELD_KEYS, "extra"]));
      const rgb = rgbOf(change.color) || rgbOf(record.color);
      if (rgb) d.setColorOverride(change.key, rgb);
      if (change.flag) d.setFlag(change.key, change.flag);
      if (Array.isArray(change.tags) && change.tags.length) d.setTags(change.key, change.tags);
      return () => restorePolity(ctx, saved);
    }
    case "polity-remove": {
      const key = owner(change.key);
      const saved = capturePolity(ctx, key);
      const regions = (api.queryRegions?.("", 100000) ?? []).filter((region) => clean(region.owner) === key || (region.claimants ?? []).includes(key));
      // Only the puppet rows the removal takes (removePolity drops the ones
      // naming the country): Undo adds those back to the rows as they are
      // then, so a puppet change accepted since stays.
      const kept = new Set(withoutPolities(ctx.doc?.puppets, key));
      const puppets = clone((ctx.doc?.puppets ?? []).filter((row) => !kept.has(row)));
      api.removeOwners([key]);
      d.removePolity(key);
      return () => {
        restorePolity(ctx, saved);
        for (const region of regions) api.setRegionAttrs([region.id], { owner: region.owner || null, claimants: region.claimants?.length ? region.claimants : null });
        if (puppets.length) {
          d.setPuppets((rows) => [...rows, ...puppets.filter((row) => !rows.some((other) => (clean(row.id) ? clean(other.id) === clean(row.id) : sameValue(other, row))))]);
        }
      };
    }
    case "polity-rename": {
      const from = change.from;
      const to = change.to;
      // Both names as they were: the rename carries the country's own colour,
      // flag and tags to the new name and the suggestion's go over them, so
      // renaming back alone would leave the suggestion's on the old country.
      const savedFrom = capturePolity(ctx, from);
      const savedTo = capturePolity(ctx, to);
      api.renameOwner(from, to);
      d.renamePolity(from, to);
      const record = isRecord(change.record) ? change.record : null;
      if (record) d.upsertPolity(to, polityRecordPatch(record, [...POLITY_FIELD_KEYS, "extra"]));
      const rgb = rgbOf(change.color);
      if (rgb) d.setColorOverride(to, rgb);
      if (change.flag) d.setFlag(to, change.flag);
      if (Array.isArray(change.tags) && change.tags.length) d.setTags(to, change.tags);
      return () => {
        api.renameOwner(to, from);
        d.renamePolity(to, from);
        restorePolity(ctx, savedFrom);
        restorePolity(ctx, savedTo);
      };
    }
    case "polity-change": {
      const key = owner(change.key);
      const saved = capturePolity(ctx, key);
      const fields = Object.keys(change.fields ?? {});
      const recordFields = fields.filter((field) => POLITY_FIELD_KEYS.includes(field) || field === "extra");
      if (recordFields.length) d.upsertPolity(key, polityRecordPatch(change.record, recordFields));
      if (fields.includes("color")) d.setColorOverride(key, rgbOf(change.fields.color.to));
      if (fields.includes("flag")) d.setFlag(key, change.fields.flag.to || null);
      if (fields.includes("tags")) d.setTags(key, change.fields.tags.to ?? []);
      return () => restorePolity(ctx, saved);
    }
    case "group-add":
    case "group-change": {
      const before = clone(ctx.doc?.groups?.[change.key]);
      d.setGroups((groups) => ({ ...groups, [change.key]: { ...(groups[change.key] ?? {}), ...clone(change.to), name: change.key } }));
      return () => d.setGroups((groups) => {
        const next = { ...groups };
        if (before) next[change.key] = before;
        else delete next[change.key];
        return next;
      });
    }
    case "group-remove": {
      const before = clone(ctx.doc?.groups?.[change.key]);
      const members = (api.queryRegions?.("", 100000) ?? []).filter((region) => clean(region.group) === change.key).map((region) => region.id);
      api.retagGroup?.(change.key, null);
      d.setGroups((groups) => {
        const next = { ...groups };
        delete next[change.key];
        return next;
      });
      return () => {
        if (before) d.setGroups((groups) => ({ ...groups, [change.key]: before }));
        for (const id of members) api.setRegionAttrs([id], { group: change.key });
      };
    }
    case "city-add": {
      const city = editorCity(change.to);
      d.setFeatures((list) => [...list, city]);
      return () => d.setFeatures((list) => list.filter((feature) => feature.id !== city.id));
    }
    case "city-remove": {
      const current = findCity(ctx.doc, change.from);
      if (!current) return null;
      d.setFeatures((list) => list.filter((feature) => feature.id !== current.id));
      return () => d.setFeatures((list) => [...list, current]);
    }
    case "city-change": {
      const current = findCity(ctx.doc, change.from) ?? findCity(ctx.doc, change.to);
      const next = editorCity(change.to, current?.id ?? newId("feat"));
      if (current) d.setFeatures((list) => list.map((feature) => (feature.id === current.id ? { ...feature, ...next, id: current.id } : feature)));
      else d.setFeatures((list) => [...list, next]);
      return () => d.setFeatures((list) => (current
        ? list.map((feature) => (feature.id === current.id ? current : feature))
        : list.filter((feature) => feature.id !== next.id)));
    }
    case "cities-replace": {
      const before = cityFeatures(ctx.doc);
      const authored = ctx.doc?.metadata?.citiesAuthored;
      const next = (Array.isArray(change.to) ? change.to : []).map((city) => editorCity(city));
      d.setFeatures((list) => [...list.filter((feature) => clean(feature?.kind)), ...next]);
      // No list is the built-in cities: the map stops carrying a set of its own.
      d.patchMetadata({ citiesAuthored: Array.isArray(change.to) });
      return () => {
        d.setFeatures((list) => [...list.filter((feature) => clean(feature?.kind)), ...before]);
        d.patchMetadata({ citiesAuthored: authored });
      };
    }
    case "unit-add":
    case "unit-change": {
      const before = clone((ctx.doc?.units ?? []).find((unit) => clean(unit.id) === change.key));
      const next = editorUnit({ ...change.to, id: change.key, ownerCode: owner(change.to?.ownerCode) });
      d.setUnits((list) => (list.some((unit) => clean(unit.id) === change.key)
        ? list.map((unit) => (clean(unit.id) === change.key ? next : unit))
        : [...list, next]));
      return () => d.setUnits((list) => (before
        ? list.map((unit) => (clean(unit.id) === change.key ? before : unit))
        : list.filter((unit) => clean(unit.id) !== change.key)));
    }
    case "unit-remove": {
      const before = clone((ctx.doc?.units ?? []).find((unit) => clean(unit.id) === change.key));
      if (!before) return null;
      d.setUnits((list) => list.filter((unit) => clean(unit.id) !== change.key));
      return () => d.setUnits((list) => [...list, before]);
    }
    case "marker-add":
    case "marker-change": {
      const current = markerFeatureOf(ctx.doc, change.key);
      const next = markerToFeature({ ...change.to, id: change.key, ownerCode: owner(change.to?.ownerCode) }, current?.id ?? newId("feat"));
      if (!next) return null;
      d.setFeatures((list) => (current ? list.map((feature) => (feature.id === current.id ? next : feature)) : [...list, next]));
      return () => d.setFeatures((list) => (current
        ? list.map((feature) => (feature.id === current.id ? current : feature))
        : list.filter((feature) => feature.id !== next.id)));
    }
    case "marker-remove": {
      const current = markerFeatureOf(ctx.doc, change.key);
      if (!current) return null;
      d.setFeatures((list) => list.filter((feature) => feature.id !== current.id));
      return () => d.setFeatures((list) => [...list, current]);
    }
    case "puppet-add":
    case "puppet-change": {
      const before = clone((ctx.doc?.puppets ?? []).find((row) => clean(row.id) === change.key));
      const next = { ...clone(change.to), id: change.key, overlord: owner(change.to?.overlord), puppet: owner(change.to?.puppet) };
      d.setPuppets((rows) => (rows.some((row) => clean(row.id) === change.key)
        ? rows.map((row) => (clean(row.id) === change.key ? next : row))
        : [...rows, next]));
      return () => d.setPuppets((rows) => (before
        ? rows.map((row) => (clean(row.id) === change.key ? before : row))
        : rows.filter((row) => clean(row.id) !== change.key)));
    }
    case "puppet-remove": {
      const before = clone((ctx.doc?.puppets ?? []).find((row) => clean(row.id) === change.key));
      if (!before) return null;
      d.setPuppets((rows) => rows.filter((row) => clean(row.id) !== change.key));
      return () => d.setPuppets((rows) => [...rows, before]);
    }
    case "map-field": {
      const field = change.field === "author" ? "author" : "basemap";
      const before = ctx.doc?.metadata?.[field] ?? "";
      d.patchMetadata({ [field]: change.to || (field === "basemap" ? before : "") });
      return () => d.patchMetadata({ [field]: before });
    }
    case "background": {
      const before = ctx.doc?.metadata?.customBackground ?? null;
      const data = change.to?.data;
      const saved = change.to?.kind === "image" && data?.dataUrl
        ? { kind: "image", dataUrl: data.dataUrl }
        : change.to?.kind === "vector" && data?.geojson ? { kind: "vector", geojson: data.geojson } : null;
      ctx.setBackground?.(saved);
      return () => ctx.setBackground?.(before);
    }
    default:
      return null;
  }
};

// ---- accepting a list, and what a save records --------------------------------

// Countries and groups first: the rest of a suggestion's changes may need them.
const APPLY_ORDER = ["polity-add", "polity-rename", "group-add", "polity-change", "group-change"];
const applyRank = (change) => {
  const index = APPLY_ORDER.indexOf(change.kind);
  return index < 0 ? APPLY_ORDER.length : index;
};

// The order a list of changes is accepted in: countries and groups first, and
// before each change what it needs (changeDependencies), skipping what is
// already accepted.
export const planAccept = (list, ctx, { changes = [], accepted = new Set() } = {}) => {
  const byId = new globalThis.Map(changes.map((change) => [change.id, change]));
  const done = new Set(accepted);
  const order = [];
  const visit = (change, depth = 0) => {
    if (!change || done.has(change.id) || depth > 6) return;
    for (const id of changeDependencies(change, changes, ctx)) visit(byId.get(id), depth + 1);
    if (done.has(change.id)) return;
    done.add(change.id);
    order.push(change);
  };
  [...list].sort((a, b) => applyRank(a) - applyRank(b)).forEach((change) => visit(change));
  return order;
};

// Accept a list of changes: what they need first, then each in turn, the
// ownership rows batched by the country they go to (one map step each, after
// every rename, so a row written against an old name lands on the new one).
// Returns the ids accepted, each one's undo, and the renames now in force.
export const acceptMapChanges = (list, ctx, { changes = [], accepted = new Set(), renames = {} } = {}) => {
  const order = planAccept(list, ctx, { changes, accepted });
  const localRenames = { ...renames };
  const undoers = new globalThis.Map();
  const ids = [];
  const owners = new globalThis.Map(); // target owner -> changes
  for (const change of order) {
    if (change.kind === "region-owner") {
      const to = clean(change.to);
      if (!owners.has(to)) owners.set(to, []);
      owners.get(to).push(change);
      continue;
    }
    // Every change accepted here gets an undo, even one with nothing to take
    // back: only one accepted in an earlier review has none (canUndo).
    undoers.set(change.id, applyMapChange(change, ctx, { renames: localRenames }) ?? (() => {}));
    if (change.kind === "polity-rename") localRenames[change.from] = change.to;
    ids.push(change.id);
  }
  for (const [to, group] of owners) {
    const target = renamed(to, localRenames);
    const regionIds = group.map((change) => String(change.regionId));
    const before = regionIds.map((id) => [id, ctx.api.getRegionSummary(id)?.owner ?? null]);
    ctx.api.setRegionAttrs(regionIds, { owner: target || null });
    for (const [index, change] of group.entries()) {
      const [id, owner] = before[index];
      undoers.set(change.id, () => ctx.api.setRegionAttrs([id], { owner }));
      ids.push(change.id);
    }
  }
  return { accepted: ids, undoers, renames: localRenames };
};

// How a change stands once the author's decisions are counted: theirs, else
// accepted when the map already has it and rejected when what it changes is
// gone, else null (still to decide).
export const decisionOf = (change, decisions, statuses) => {
  if (decisions.accepted.has(change.id)) return "accepted";
  if (decisions.rejected.has(change.id)) return "rejected";
  if (statuses[change.id] === "applied") return "accepted";
  if (statuses[change.id] === "missing") return "rejected";
  return null;
};

// What a save should record: the author's decisions, with what is already on
// the map counted as accepted and what is no longer on it as rejected.
export const decisionsFor = (changes, decisions, statuses) => {
  const accepted = new Set(decisions.accepted);
  const rejected = new Set(decisions.rejected);
  for (const change of changes) {
    const decision = decisionOf(change, decisions, statuses);
    if (decision === "accepted") accepted.add(change.id);
    else if (decision === "rejected") rejected.add(change.id);
  }
  return { accepted: [...accepted], rejected: [...rejected] };
};

// ---- where a change is on the map ---------------------------------------------

// What to outline and zoom to for a change: region ids on this map, suggested
// shapes (GeoJSON, WGS84) that are not on it yet, and points.
export const changeTargets = (change, ctx, { changes = [], renames = {}, cache = null } = {}) => {
  const regionIds = [];
  const shapes = [];
  const points = [];
  const ownedBy = (key) => ownerRegionIds(ctx, renamed(key, renames), cache);
  switch (change.kind) {
    case "region-owner": case "region-name": case "region-type": case "region-claims": case "region-group":
      regionIds.push(String(change.regionId));
      break;
    case "borders":
      for (const region of change.regions ?? []) {
        if (regionOf(ctx, region.id)) regionIds.push(String(region.id));
        if (region.feature) shapes.push(region.feature);
      }
      break;
    case "polity-add":
      for (const entry of changes) {
        if (entry.kind === "region-owner" && entry.to === change.key) regionIds.push(String(entry.regionId));
        if (entry.kind === "borders") for (const region of entry.regions ?? []) if (region.feature?.properties?.owner === change.key) shapes.push(region.feature);
      }
      break;
    case "polity-remove": case "polity-change":
      regionIds.push(...ownedBy(change.key));
      break;
    case "polity-rename":
      regionIds.push(...ownedBy(change.from), ...ownedBy(change.to));
      break;
    case "group-add": case "group-change": case "group-remove":
      regionIds.push(...groupRegionIds(ctx, change.key, cache));
      for (const entry of changes) if (entry.kind === "region-group" && (entry.to === change.key || entry.from === change.key)) regionIds.push(String(entry.regionId));
      break;
    case "city-add": case "city-change": case "city-remove": {
      const city = change.to ?? change.from;
      if (Array.isArray(city?.coord)) points.push(city.coord);
      break;
    }
    case "unit-add": case "unit-change": case "unit-remove": case "marker-add": case "marker-change": case "marker-remove": {
      const entry = change.to ?? change.from;
      if (Number.isFinite(Number(entry?.lng)) && Number.isFinite(Number(entry?.lat))) points.push([Number(entry.lng), Number(entry.lat)]);
      break;
    }
    case "puppet-add": case "puppet-change": case "puppet-remove":
      regionIds.push(...ownedBy((change.to ?? change.from)?.puppet));
      break;
    default:
      break;
  }
  return { regionIds: [...new Set(regionIds)], shapes, points };
};
