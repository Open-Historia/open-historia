/*! Open Historia — what changed between two versions of a scenario © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The difference between two scenario bundles (pax-historia-scenario-bundle/2,
// as exportScenarioBundle writes them and the hub serves them), as a list of
// changes an author can accept or reject one at a time. It is what a
// suggestion carries: the player who downloaded a community scenario and
// edited it diffs their copy against the post's file, and the author reviews
// the list — the scenario's details in the Suggested changes dialog, the map in
// the Workshop's review panel, each change highlighted where it is.
//
// Every change is plain JSON: { id, area, kind, ...what it needs }. `area` is
// "details" (everything outside the map editor) or "map". `from` is the value
// in the post's file and `to` the suggested one, so an author whose scenario
// moved on since can be told which changes meet a value they changed
// themselves (conflicts), and which are already in their scenario.
//
// Pure: no DOM, no fetch. Both versions are read the same way, so what the
// store or the Workshop writes on its own — defaults it fills in, a colour it
// makes explicit, a border cleanup's hairline changes — is not a change.

import { FEATURE_DEFINITIONS, normalizeFeatureSettings } from "../../server/gameFeatures.js";
import { PROMPT_GUIDANCE, normalizePackGuidance } from "../Game/AI/promptGuidance.js";
import { normalizeGroups } from "./groups.js";
import COUNTRY_NAMES from "./generated/countryNames.js";
import { DEFAULT_SCENARIO_META, accentOrDefault } from "./web/storeConstants.js";
import {
  buildOwnerRenameMap,
  buildPolityMapRefs,
  migrateGame,
  migrateRegions,
  migrateWorld,
  needsMigration as needsOwnerMigration,
  rekeyOwnerMap,
} from "../../server/ownerMigration.js";

// ---- values -------------------------------------------------------------------

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const textOf = (value) => String(value ?? "").replace(/\r\n/g, "\n").trim();

// Empty is empty: "", null, [], {} and a missing value are one thing, so a
// store that writes a default where the other left the key out is no change.
const isEmptyValue = (value) =>
  value === undefined || value === null || value === ""
  || (Array.isArray(value) && value.length === 0)
  || (isRecord(value) && Object.keys(value).length === 0);

// A stable text form of any JSON value: keys sorted, empties dropped.
export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => !isEmptyValue(value[key])).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "string") return JSON.stringify(value.replace(/\r\n/g, "\n"));
  if (value === undefined) return "null";
  return JSON.stringify(value);
};
export const sameValue = (a, b) => (isEmptyValue(a) && isEmptyValue(b)) || canonicalJson(a) === canonicalJson(b);

// FNV-1a, 32 bits, as eight hex digits. For fingerprints, not security.
export const hashText = (value) => {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

// ---- bundle assets ------------------------------------------------------------

const base64ToText = (base64) => {
  const binary = globalThis.atob(String(base64 ?? ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

// A bundle asset as JSON: undefined when the bundle does not carry it (a
// "default" slot uses the built-in), the parsed value when it does — whether it
// travelled as JSON, as JSON text, or as base64 (bundles made before JSON
// assets stopped being base64'd).
export const bundleAssetJson = (asset) => {
  if (!isRecord(asset) || asset.mode !== "embedded") return undefined;
  const { data, encoding } = asset;
  if (encoding !== "base64" && data !== null && typeof data === "object") return data;
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(encoding === "base64" ? base64ToText(data) : data);
  } catch {
    if (encoding === "base64") return undefined;
    try { return JSON.parse(base64ToText(data)); } catch { return undefined; }
  }
};

// A binary bundle asset (the cover): its bytes as base64, and a fingerprint.
export const bundleAssetBinary = (asset) => {
  if (!isRecord(asset) || asset.mode !== "embedded" || typeof asset.data !== "string" || !asset.data) return null;
  return {
    base64: asset.data,
    contentType: String(asset.contentType ?? "").trim() || "application/octet-stream",
    hash: `${hashText(asset.data)}-${asset.data.length}`,
  };
};

// ---- geometry -----------------------------------------------------------------

// A region's shape, fingerprinted at the five decimals the Workshop writes, so
// a file written at more digits and the same map re-saved are the same shape.
const eachPosition = (geometry, visit) => {
  const walk = (coords, depth) => {
    if (!Array.isArray(coords)) return;
    if (depth === 0) {
      if (coords.length >= 2) visit(Number(coords[0]), Number(coords[1]));
      return;
    }
    for (const part of coords) walk(part, depth - 1);
  };
  const type = geometry?.type;
  if (type === "Polygon") walk(geometry.coordinates, 2);
  else if (type === "MultiPolygon") walk(geometry.coordinates, 3);
};

const ringArea = (ring) => {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (Number(ring[j][0]) * Number(ring[i][1])) - (Number(ring[i][0]) * Number(ring[j][1]));
  }
  return sum / 2;
};
const polygonArea = (rings) => (Array.isArray(rings)
  ? rings.reduce((total, ring, index) => total + (index === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring))), 0)
  : 0);

// The border cleanup a Workshop save runs (topologySweep.js) repairs defects up
// to 500 m wide in the map's projection, 0.0045° at most. On a region the
// player never touched it fills a crack, trims a sliver, and makes or removes
// geometry of next to no area: a spike (a vertex the ring runs out to and
// straight back from), a sliver tip (out and back within the cleanup's width)
// and a speck (a stray part of a few metres), or a whole stray part that is
// only a sliver. A spike or a tip moves a bounding box a long way (0.5° on one
// region), so a region's box is measured without them.
const CLEANUP_WIDTH = 0.005; // degrees
const SPECK_AREA = 1e-5; // square degrees, about a tenth of a square kilometre
const SPIKE_SINE = 0.1; // a turn back within about 6°
// The ring without its spikes and tips; `collapsed` when nothing but them was
// left of it (a sliver, not territory).
const outlinePoints = (ring) => {
  const points = (Array.isArray(ring) ? ring : [])
    .map((position) => [Number(position?.[0]), Number(position?.[1])])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop();
  let removed = 0;
  for (let changed = true; changed && points.length > 3;) {
    changed = false;
    for (let i = 0; i < points.length && points.length > 3; i += 1) {
      const prev = points[(i - 1 + points.length) % points.length];
      const here = points[i];
      const next = points[(i + 1) % points.length];
      const ax = here[0] - prev[0];
      const ay = here[1] - prev[1];
      const bx = next[0] - here[0];
      const by = next[1] - here[1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      const turnsBack = (ax * bx) + (ay * by) < 0;
      const spike = turnsBack && Math.abs((ax * by) - (ay * bx)) <= SPIKE_SINE * la * lb;
      const tip = turnsBack && Math.hypot(next[0] - prev[0], next[1] - prev[1]) <= CLEANUP_WIDTH;
      if (!la || !lb || spike || tip) {
        points.splice(i, 1);
        i -= 1;
        removed += 1;
        changed = true;
      }
    }
  }
  return { points, collapsed: removed > 0 && points.length <= 3 };
};
const ringLength = (ring) => {
  let total = 0;
  for (let i = 1; i < (Array.isArray(ring) ? ring.length : 0); i += 1) {
    total += Math.hypot(Number(ring[i][0]) - Number(ring[i - 1][0]), Number(ring[i][1]) - Number(ring[i - 1][1]));
  }
  return Number.isFinite(total) ? total : 0;
};
const outlineBox = (geometry) => {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const parts = polygons.filter(Array.isArray).map((polygon) => ({ area: Math.abs(polygonArea(polygon)), outline: outlinePoints(polygon[0]) }));
  const significant = parts.filter((part) => part.area >= SPECK_AREA && !part.outline.collapsed);
  let box = null;
  for (const { outline } of significant.length ? significant : parts) {
    for (const [x, y] of outline.points) {
      box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
    }
  }
  return box;
};

export const measureGeometry = (geometry) => {
  if (!geometry || !/Polygon$/.test(String(geometry.type))) return null;
  let hash = 0x811c9dc5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let points = 0;
  eachPosition(geometry, (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    for (const value of [Math.round(x * 1e5), Math.round(y * 1e5)]) {
      hash ^= value & 0xffff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (value >>> 16) & 0xffff;
      hash = Math.imul(hash, 0x01000193);
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    points += 1;
  });
  if (!points) return null;
  const area = geometry.type === "Polygon"
    ? polygonArea(geometry.coordinates)
    : (geometry.coordinates || []).reduce((total, polygon) => total + polygonArea(polygon), 0);
  const perimeter = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates || [])
    .reduce((total, polygon) => total + (Array.isArray(polygon) ? polygon.reduce((sum, ring) => sum + ringLength(ring), 0) : 0), 0);
  return { key: `${(hash >>> 0).toString(16)}-${points}`, bbox: outlineBox(geometry) ?? [minX, minY, maxX, maxY], area: Math.abs(area), perimeter };
};

// Two shapes that differ only by what a save does on its own — rounding, and
// the border cleanup above — are the same region to a person. The area may
// move by a strip a quarter of the cleanup's width along the whole border (a
// crack filled along a long border moved one region 0.19%), and the outline by
// the cleanup's width. A redrawn border moves far more than this.
const AREA_TOLERANCE = 0.0015;
export const sameShape = (a, b) => {
  if (!a || !b) return !a && !b;
  if (a.key === b.key) return true;
  const allowance = Math.max(
    Math.max(a.area, b.area) * AREA_TOLERANCE,
    (CLEANUP_WIDTH / 4) * Math.max(Number(a.perimeter) || 0, Number(b.perimeter) || 0),
  );
  if (Math.abs(a.area - b.area) > allowance) return false;
  return a.bbox.every((value, index) => Math.abs(value - b.bbox[index]) <= CLEANUP_WIDTH);
};

const bboxUnion = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const bboxesTouch = (a, b, pad = 0.01) => Boolean(a && b)
  && a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3];

// ---- colours ------------------------------------------------------------------

const hexToRgb = (value) => {
  const match = /^#?([a-f0-9]{6})$/i.exec(clean(value));
  if (!match) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
};
const rgbOf = (value) => {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((n) => Number.isFinite(Number(n)))) {
    return value.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
  }
  return hexToRgb(value);
};
export const rgbToHex = (rgb) => `#${(rgbOf(rgb) || [128, 128, 128]).map((n) => n.toString(16).padStart(2, "0")).join("")}`;

// ---- snapshots ----------------------------------------------------------------

const META_FIELDS = ["name", "eyebrow", "accentColor", "subtitle", "description", "heroTitle", "heroSubtitle"];
const GAME_FIELDS = ["country", "startDate", "gameDate", "difficulty", "language"];
const WORLD_DETAIL_FIELDS = ["allowedUnitTypes", "labelFont", "labelTextColor", "labelHaloColor", "simulationRules", "startingTimelineText"];
// The Politics tab's generated world (PoliticalWorldGenerationPanel,
// InstitutionAuthoringPanel): diffed entry by entry where entries have ids.
export const POLITICS_FIELDS = ["politicalActors", "institutions", "powerStatus", "agreements", "canonContext"];

const flattenGuidance = (pack) => {
  const guidance = normalizePackGuidance(pack);
  const flat = {};
  for (const section of ["advisor", "leader"]) {
    for (const [segment, value] of Object.entries(guidance[section] ?? {})) flat[`${section}.${segment}`] = value;
  }
  for (const [task, bucket] of Object.entries(guidance.tasks ?? {})) {
    for (const [segment, value] of Object.entries(bucket ?? {})) flat[`tasks.${task}.${segment}`] = value;
  }
  return flat;
};
// Every passage an author can edit, so a passage cleared back to the default
// is a change too.
const GUIDANCE_PATHS = [
  ...["advisor", "leader"].flatMap((section) => (PROMPT_GUIDANCE[section] ?? []).map((seg) => `${section}.${seg.id}`)),
  ...Object.entries(PROMPT_GUIDANCE.tasks ?? {}).flatMap(([task, segments]) => segments.map((seg) => `tasks.${task}.${seg.id}`)),
];

const regionIdOf = (feature) => {
  const props = feature?.properties ?? {};
  const id = props.id ?? feature?.id;
  return id === undefined || id === null ? "" : String(id);
};
const claimantList = (value) => [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))].sort();

// The map's regions as one table: id -> what a person would call the region
// (its name, owner, type, the claims on it, the group whose area it is in) and
// its shape. The world's rows win over the regions file, as they do in the game
// and in the Workshop (claimOverrides.js): a world claims row wins, a settled
// dispute has no claimants, and otherwise the file's own list stands.
const buildRegionTable = (world, regionsFC) => {
  const overrides = isRecord(world.regionOwnershipOverrides) ? world.regionOwnershipOverrides : {};
  const worldClaims = isRecord(world.regionClaimants) ? world.regionClaimants : {};
  const settled = new Set((Array.isArray(world.settledRegionClaims) ? world.settledRegionClaims : []).map((id) => String(id)));
  const groupAreas = isRecord(world.groupAreas) ? world.groupAreas : {};
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const claimsOf = (id, fileList) => claimantList(has(worldClaims, id) ? worldClaims[id] : settled.has(id) ? [] : fileList);
  const regions = new Map();
  const hasGeometry = Boolean(regionsFC && Array.isArray(regionsFC.features) && regionsFC.features.length);
  if (hasGeometry) {
    for (const feature of regionsFC.features) {
      const id = regionIdOf(feature);
      if (!id || regions.has(id)) continue;
      const props = feature.properties ?? {};
      const owner = has(overrides, id) ? clean(overrides[id]) : clean(props.owner);
      regions.set(id, {
        id,
        name: clean(props.name),
        owner: owner || null,
        typeId: clean(props.typeId) || "land",
        claimants: claimsOf(id, props.claimants),
        group: clean(groupAreas[id]) || null,
        gid0: clean(props.gid0),
        edited: Boolean(props.edited),
        shape: measureGeometry(feature.geometry),
        feature,
      });
    }
  } else {
    // A scenario on the stock world ships no regions of its own: only the rows
    // that differ from the stock map, which is all there is to compare. Its
    // owner is `undefined` where the stock map decides it.
    const ids = new Set([...Object.keys(overrides), ...Object.keys(worldClaims), ...Object.keys(groupAreas)]);
    for (const id of ids) {
      regions.set(id, {
        id,
        name: "",
        owner: has(overrides, id) ? clean(overrides[id]) || null : undefined,
        typeId: undefined,
        claimants: claimsOf(id, []),
        group: clean(groupAreas[id]) || null,
        gid0: "",
        edited: false,
        shape: null,
        feature: null,
      });
    }
  }
  return { regions, hasGeometry };
};

const POLITY_IGNORED_FIELDS = new Set(["formerNames", "mapRefs", "verbatim", "color", "name", "aliases", "code", "note", "status"]);
// A polity record as a person would compare it. The Workshop rewrites every
// record on save — its name added to its aliases, its key as its code, a
// status and colour filled in — so those are read the way it writes them.
const polityView = (key, record) => {
  const source = isRecord(record) ? record : {};
  const name = clean(source.name) || key;
  const aliases = [...new Set((Array.isArray(source.aliases) ? source.aliases : []).map(clean).filter((alias) => alias && alias !== name && alias !== key))].sort();
  const code = clean(source.code);
  const rest = Object.fromEntries(Object.entries(source).filter(([field]) => !POLITY_IGNORED_FIELDS.has(field)));
  return {
    name,
    aliases,
    code: code && code !== key ? code : "",
    note: textOf(source.note),
    status: clean(source.status) || "active",
    ...(Object.keys(rest).length ? { extra: canonicalJson(rest) } : {}),
  };
};

const unitView = (unit) => ({
  name: clean(unit?.name) || "Unit",
  type: clean(unit?.type).toLowerCase() || "infantry",
  ownerCode: clean(unit?.ownerCode),
  lng: Number(Number(unit?.lng).toFixed(4)),
  lat: Number(Number(unit?.lat).toFixed(4)),
  strength: Number.isFinite(Number(unit?.strength)) ? Math.round(Number(unit.strength)) : 100,
  composition: clean(unit?.composition),
  note: textOf(unit?.note),
});
const markerView = (marker) => ({
  name: clean(marker?.name),
  kind: clean(marker?.kind).toLowerCase() || "landmark",
  ownerCode: clean(marker?.ownerCode),
  lng: Number(Number(marker?.lng).toFixed(4)),
  lat: Number(Number(marker?.lat).toFixed(4)),
  status: clean(marker?.status) || "active",
  note: textOf(marker?.note),
});
const puppetView = (row) => ({
  overlord: clean(row?.overlord),
  puppet: clean(row?.puppet),
  kind: clean(row?.kind) || "satellite",
  secrecy: row?.secrecy === "covert" ? "covert" : "open",
  loyalty: Number.isFinite(Number(row?.loyalty)) ? Math.round(Number(row.loyalty)) : 50,
  status: clean(row?.status) || "active",
});
// A city's size as the game reads it (exportPreset.js cityTier): the authored
// tier, else one from its population — which the Workshop writes out on save.
export const cityTierOf = (tier, population) => {
  const authored = Number(tier);
  if (Number.isFinite(authored) && authored >= 1 && authored <= 3) return Math.round(authored);
  const pop = Number(population || 0);
  return pop >= 1000000 ? 3 : pop >= 100000 ? 2 : 1;
};
const cityView = (feature) => {
  const props = feature?.properties ?? {};
  const coords = feature?.geometry?.coordinates;
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  const name = clean(props.city ?? props.name);
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const population = Math.max(0, Math.round(Number(props.population) || 0));
  return {
    name,
    coord: [Number(lng.toFixed(4)), Number(lat.toFixed(4))],
    population,
    capital: clean(props.capital) === "primary",
    tier: cityTierOf(props.tier, population),
    ...(isRecord(props.populationByYear) && Object.keys(props.populationByYear).length ? { populationByYear: props.populationByYear } : {}),
  };
};

const indexById = (list, view) => {
  const out = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    const id = clean(entry?.id);
    if (id && !out.has(id)) out.set(id, { id, raw: entry, view: view(entry) });
  }
  return out;
};

// A post from before countries were keyed by name (owner schema < 4, owners as
// codes like "Z08") is migrated by either store the moment it is imported, so
// its copy names them differently from the post. Read the post migrated the
// same way (server/libraryStore.js migrateOwnerRecord), or every such country
// reads as removed and founded again.
export const migrateBundleOwners = (bundle) => {
  const world = bundle?.data?.world;
  if (!isRecord(world) || !needsOwnerMigration(world)) return bundle;
  const assets = isRecord(bundle.assets) ? bundle.assets : {};
  const colors = bundleAssetJson(assets.colors) ?? null;
  const flags = bundleAssetJson(assets.flags) ?? null;
  const tags = bundleAssetJson(assets.tags) ?? null;
  const regions = bundleAssetJson(assets.regionsGeojson) ?? null;
  const context = {
    polityOverrides: world.polityOverrides,
    countryNameOverrides: bundle.scenario?.countryNameOverrides,
    // The committed code -> name table: the same server/country-names.json the
    // stores migrate with (the web store's generated copy exists only after a
    // web build, and tests run without one).
    registry: COUNTRY_NAMES,
    features: regions?.features,
    ownershipOverrides: world.regionOwnershipOverrides,
    sovereigntyOverrides: world.regionSovereigntyOverrides,
    regionClaimants: world.regionClaimants,
    ownerCodes: world.ownerCodes,
    colors,
    flags,
    tags,
    units: world.units,
    countryTags: world.countryTags,
    internationalReputation: world.internationalReputation,
    gameCountry: bundle.data?.game?.country,
  };
  try {
    const renames = buildOwnerRenameMap(context);
    const mapRefs = buildPolityMapRefs(context, renames);
    const quiet = () => {};
    const embedded = (data) => ({ mode: "embedded", data });
    return {
      ...bundle,
      data: {
        ...bundle.data,
        world: migrateWorld(world, renames, quiet, mapRefs),
        ...(bundle.data?.game ? { game: migrateGame(bundle.data.game, renames) } : {}),
      },
      assets: {
        ...assets,
        ...(colors ? { colors: embedded(rekeyOwnerMap(colors, renames, "colors", quiet)) } : {}),
        ...(flags ? { flags: embedded(rekeyOwnerMap(flags, renames, "flags", quiet)) } : {}),
        ...(tags ? { tags: embedded(rekeyOwnerMap(tags, renames, "tags", quiet)) } : {}),
        ...(regions ? { regionsGeojson: embedded(migrateRegions(regions, renames)) } : {}),
      },
    };
  } catch {
    return bundle; // read as it is: a change too many beats no suggestion at all
  }
};

// The card's fields as the stores read them (readScenarioMeta): an empty one
// falls back as it does there, and a retired accent reads as today's default,
// so a post from an older build and its imported copy say the same thing.
const metaOf = (scenario) => {
  const name = textOf(scenario.name) || DEFAULT_SCENARIO_META.name;
  const subtitle = textOf(scenario.subtitle) || DEFAULT_SCENARIO_META.subtitle;
  const description = textOf(scenario.description) || subtitle || DEFAULT_SCENARIO_META.description;
  return {
    name,
    eyebrow: textOf(scenario.eyebrow) || DEFAULT_SCENARIO_META.eyebrow,
    accentColor: accentOrDefault(scenario.accentColor, DEFAULT_SCENARIO_META.accentColor).toLowerCase(),
    subtitle,
    description,
    heroTitle: textOf(scenario.heroTitle) || name,
    heroSubtitle: textOf(scenario.heroSubtitle) || description,
  };
};

export const buildScenarioSnapshot = (bundle) => {
  const legacyOwners = isRecord(bundle?.data?.world) && needsOwnerMigration(bundle.data.world);
  const source = isRecord(bundle) ? migrateBundleOwners(bundle) : {};
  const scenario = isRecord(source.scenario) ? source.scenario : {};
  const data = isRecord(source.data) ? source.data : {};
  const assets = isRecord(source.assets) ? source.assets : {};
  const world = isRecord(data.world) ? data.world : {};
  const game = isRecord(data.game) ? data.game : {};
  const { regions, hasGeometry } = buildRegionTable(world, bundleAssetJson(assets.regionsGeojson));
  const citiesFC = bundleAssetJson(assets.citiesGeojson);
  const backgroundData = bundleAssetJson(assets.backgroundData);
  return {
    meta: metaOf(scenario),
    features: normalizeFeatureSettings(scenario.features),
    game: Object.fromEntries(GAME_FIELDS.map((key) => [key, clean(game[key])])),
    world: Object.fromEntries(WORLD_DETAIL_FIELDS.map((key) => [key, key === "allowedUnitTypes"
      ? (Array.isArray(world[key]) ? [...new Set(world[key].map(clean).filter(Boolean))].sort() : [])
      : textOf(world[key])])),
    politics: Object.fromEntries(POLITICS_FIELDS.map((key) => [key, world[key] ?? null])),
    prompts: flattenGuidance(data.prompts),
    stats: bundleAssetJson(assets.stats) ?? null,
    institutionLogos: bundleAssetJson(assets.institutionLogos) ?? null,
    cover: bundleAssetBinary(assets.cover),
    map: {
      regions,
      hasGeometry,
      // Keyed by code before the post was migrated: its records of countries
      // with no land come out of either store's migration differently.
      legacyOwners,
      polities: isRecord(world.polityOverrides) ? world.polityOverrides : {},
      colors: isRecord(bundleAssetJson(assets.colors)) ? bundleAssetJson(assets.colors) : {},
      flags: isRecord(bundleAssetJson(assets.flags)) ? bundleAssetJson(assets.flags) : {},
      tags: isRecord(bundleAssetJson(assets.tags)) ? bundleAssetJson(assets.tags) : {},
      groups: normalizeGroups(world.groups),
      units: indexById(world.units, unitView),
      markers: indexById(world.markers, markerView),
      puppets: indexById(world.puppets, puppetView),
      cities: citiesFC && Array.isArray(citiesFC.features) ? citiesFC.features.map(cityView).filter(Boolean) : null,
      author: clean(world.author),
      basemap: clean(world.basemap),
      background: world.background?.kind && backgroundData
        ? { kind: clean(world.background.kind), hash: hashText(canonicalJson(backgroundData)), data: backgroundData }
        : null,
    },
  };
};

// ---- the diff -----------------------------------------------------------------

// What changed inside one record, as the paths a person would name
// ("government.leader"), for showing a Politics entry's change. Lists and
// values are compared whole; at most `max` paths, the first ones in order.
export const changedPathsOf = (before, after, { max = 6 } = {}) => {
  const paths = [];
  const walk = (a, b, prefix) => {
    if (paths.length > max || sameValue(a, b)) return;
    if (isRecord(a) && isRecord(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) walk(a[key], b[key], prefix ? `${prefix}.${key}` : key);
      return;
    }
    paths.push({ path: prefix, from: a ?? null, to: b ?? null });
  };
  walk(before, after, "");
  return paths;
};

const TEXT_FIELDS = new Set(["meta.description", "meta.subtitle", "meta.heroSubtitle", "world.simulationRules", "world.startingTimelineText"]);

const featureLabel = (featureKey, settingKey) => {
  const definition = FEATURE_DEFINITIONS.find((entry) => entry.key === featureKey);
  const setting = definition?.settings.find((entry) => entry.key === settingKey);
  return { feature: definition?.label || featureKey, setting: settingKey === "enabled" ? "" : setting?.label || settingKey };
};

// Entries of a Politics list keyed by id where they have one.
const entryKeyOf = (entry, index) => {
  if (isRecord(entry)) {
    for (const field of ["id", "key", "code", "name", "title"]) {
      const value = clean(entry[field]);
      if (value) return value;
    }
  }
  return `#${index}`;
};
const entryLabelOf = (entry, key) => (isRecord(entry) ? clean(entry.name || entry.title || entry.label || entry.id) || key : key);
// A ledger: one map of records inside a wrapper that also carries its format
// (`{ schemaVersion, byPolity }` for the political actors and the power
// status, `{ schemaVersion, ledgerVersion, byId }` for the institutions). Its
// entries are what an author edits, one country or one institution at a time;
// the wrapper's other fields are bookkeeping, never a change of their own.
export const POLITICS_LEDGER_KEYS = Object.freeze(["byPolity", "byId"]);
export const politicsLedgerKeyOf = (value) => (isRecord(value)
  ? POLITICS_LEDGER_KEYS.find((key) => isRecord(value[key]) && Object.values(value[key]).every(isRecord)) ?? ""
  : "");
export const politicsLedgerShellOf = (value, within) => {
  if (!isRecord(value)) return {};
  const shell = { ...value };
  delete shell[within];
  return shell;
};
// What a Politics value is made of: a list of entries, a map of records keyed
// by id, a ledger (above), or anything else (one value, changed whole).
const politicsShapeOf = (value) => {
  if (isEmptyValue(value)) return "empty";
  if (Array.isArray(value)) return value.every(isRecord) ? "list" : "value";
  const within = politicsLedgerKeyOf(value);
  if (within) return `ledger:${within}`;
  if (isRecord(value) && Object.values(value).every(isRecord)) return "map";
  return "value";
};
// A Politics value's entries by key; `within` names a ledger's map.
export const politicsEntries = (value, container, within = "") => {
  if (container === "list") return new Map((Array.isArray(value) ? value : []).map((entry, index) => [entryKeyOf(entry, index), entry]));
  const map = within ? (isRecord(value) ? value[within] : null) : value;
  return new Map(Object.entries(isRecord(map) ? map : {}));
};
const diffPolitics = (field, from, to, changes) => {
  if (sameValue(from, to)) return;
  const fromShape = politicsShapeOf(from);
  const toShape = politicsShapeOf(to);
  const shape = fromShape === "empty" ? toShape : toShape === "empty" || toShape === fromShape ? fromShape : "value";
  if (shape !== "list" && shape !== "map" && !shape.startsWith("ledger:")) {
    changes.push({ id: `politics:${field}`, area: "details", kind: "politics", field, container: "value", entry: null, from: from ?? null, to: to ?? null });
    return;
  }
  const container = shape === "list" ? "list" : "map";
  const within = shape.startsWith("ledger:") ? shape.slice("ledger:".length) : "";
  // The wrapper a first entry is put into, when the author has no ledger yet.
  const ledger = within ? { within, shell: politicsLedgerShellOf(isEmptyValue(to) ? from : to, within) } : {};
  const a = politicsEntries(from, container, within);
  const b = politicsEntries(to, container, within);
  const push = (key, op, entry, before, after) => changes.push({
    id: `politics:${field}:${key}`, area: "details", kind: "politics", field, container, ...ledger, entry: key, label: entryLabelOf(entry, key), op, from: before, to: after,
  });
  for (const [key, entry] of b) {
    if (!a.has(key)) push(key, "add", entry, null, entry);
    else if (!sameValue(a.get(key), entry)) push(key, "change", entry, a.get(key), entry);
  }
  for (const [key, entry] of a) {
    if (!b.has(key)) push(key, "remove", entry, entry, null);
  }
};

const diffDetails = (base, next, changes) => {
  for (const key of META_FIELDS) {
    if (!sameValue(base.meta[key], next.meta[key])) {
      changes.push({ id: `meta:${key}`, area: "details", kind: "field", path: ["meta", key], text: TEXT_FIELDS.has(`meta.${key}`), from: base.meta[key], to: next.meta[key] });
    }
  }
  for (const key of GAME_FIELDS) {
    if (!sameValue(base.game[key], next.game[key])) {
      changes.push({ id: `game:${key}`, area: "details", kind: "field", path: ["game", key], from: base.game[key], to: next.game[key] });
    }
  }
  for (const key of WORLD_DETAIL_FIELDS) {
    if (!sameValue(base.world[key], next.world[key])) {
      changes.push({ id: `world:${key}`, area: "details", kind: "field", path: ["world", key], text: TEXT_FIELDS.has(`world.${key}`), from: base.world[key], to: next.world[key] });
    }
  }
  for (const definition of FEATURE_DEFINITIONS) {
    for (const settingKey of ["enabled", ...definition.settings.map((setting) => setting.key)]) {
      const from = base.features?.[definition.key]?.[settingKey];
      const to = next.features?.[definition.key]?.[settingKey];
      if (sameValue(from, to)) continue;
      const setting = definition.settings.find((entry) => entry.key === settingKey);
      changes.push({
        id: `features:${definition.key}.${settingKey}`,
        area: "details",
        kind: "field",
        path: ["features", definition.key, settingKey],
        text: setting?.type === "text",
        ...featureLabel(definition.key, settingKey),
        from: from ?? null,
        to: to ?? null,
      });
    }
  }
  for (const path of GUIDANCE_PATHS) {
    const from = base.prompts[path] ?? "";
    const to = next.prompts[path] ?? "";
    if (!sameValue(from, to)) {
      changes.push({ id: `prompts:${path}`, area: "details", kind: "field", path: ["prompts", ...path.split(".")], text: true, from, to });
    }
  }
  for (const field of POLITICS_FIELDS) diffPolitics(field, base.politics[field], next.politics[field], changes);
  if (!sameValue(base.stats, next.stats)) {
    changes.push({ id: "stats", area: "details", kind: "stats", from: base.stats, to: next.stats });
  }
  if (!sameValue(base.institutionLogos, next.institutionLogos)) {
    changes.push({ id: "institutionLogos", area: "details", kind: "institutionLogos", from: base.institutionLogos, to: next.institutionLogos });
  }
  if ((base.cover?.hash || "") !== (next.cover?.hash || "")) {
    changes.push({
      id: "cover",
      area: "details",
      kind: "cover",
      from: base.cover ? { hash: base.cover.hash } : null,
      to: next.cover ? { hash: next.cover.hash, contentType: next.cover.contentType, base64: next.cover.base64 } : null,
    });
  }
};

// The owner a region had when a scenario on the stock world did not say: the
// country its stock geometry is in.
const stockOwnerOf = (region) => (region?.gid0 ? COUNTRY_NAMES[region.gid0] || null : null);

const diffRegions = (base, next, changes) => {
  const baseMap = base.map;
  const nextMap = next.map;
  const shapeChanges = [];
  const regionName = (id) => nextMap.regions.get(id)?.name || baseMap.regions.get(id)?.name || id;

  const attrChange = (kind, id, from, to, extra = {}) => {
    changes.push({ id: `${kind}:${id}`, area: "map", kind, regionId: id, regionName: regionName(id), from, to, ...extra });
  };

  // Which regions were drawn, reshaped or removed.
  if (baseMap.hasGeometry && nextMap.hasGeometry) {
    for (const [id, region] of nextMap.regions) {
      const before = baseMap.regions.get(id);
      if (!before) shapeChanges.push({ id, op: "add", region });
      else if (!sameShape(before.shape, region.shape)) shapeChanges.push({ id, op: "reshape", region, before });
    }
    for (const [id, region] of baseMap.regions) {
      if (!nextMap.regions.has(id)) shapeChanges.push({ id, op: "remove", before: region });
    }
  } else if (nextMap.hasGeometry) {
    // The post's scenario is on the stock world; the edited copy wrote the
    // whole map (every Workshop save does). A region drawn in the Workshop is
    // new; a stock region it reshaped says so (edited); the rest are the stock
    // map as it always was. A stock region the post's rows name and the copy
    // no longer has was removed.
    for (const [id, region] of nextMap.regions) {
      if (!/\./.test(id) || /^reg_/.test(id)) shapeChanges.push({ id, op: "add", region });
      else if (region.edited) shapeChanges.push({ id, op: "reshape", region, before: null });
    }
    for (const [id, region] of baseMap.regions) {
      if (!nextMap.regions.has(id)) shapeChanges.push({ id, op: "remove", before: region });
    }
  }

  // What a region's owner was in the post: its own row where it has one, else
  // (a stock-world scenario that never mentioned it) the stock map's owner.
  const ownerBefore = (id, after) => {
    const before = baseMap.regions.get(id);
    if (before && before.owner !== undefined) return { owner: before.owner, known: true };
    if (baseMap.hasGeometry) return { owner: null, known: true };
    const stock = stockOwnerOf(after);
    return { owner: stock, known: Boolean(stock) };
  };

  // Attributes of the regions both versions have (an added or removed region
  // travels whole, in its border change).
  const shaped = new Map(shapeChanges.map((entry) => [entry.id, entry]));
  const regionIds = new Set([...baseMap.regions.keys(), ...nextMap.regions.keys()]);
  for (const id of regionIds) {
    const shape = shaped.get(id);
    if (shape && shape.op !== "reshape") continue;
    const before = baseMap.regions.get(id);
    const after = nextMap.regions.get(id);
    if (!after) {
      // Gone from a copy that ships no geometry: only its rows can have changed.
      if (nextMap.hasGeometry || !before) continue;
      if (before.owner) attrChange("region-owner", id, before.owner, null, { fromStock: false, toStock: true });
      if (before.claimants.length) attrChange("region-claims", id, before.claimants, []);
      if (before.group) attrChange("region-group", id, before.group, null);
      continue;
    }
    const was = ownerBefore(id, after);
    if (after.owner !== undefined && clean(was.owner) !== clean(after.owner)) {
      attrChange("region-owner", id, was.owner || null, after.owner || null, was.known ? {} : { fromStock: true });
    }
    if (before?.feature && after.feature) {
      if (before.name !== after.name) attrChange("region-name", id, before.name, after.name);
      if (before.typeId !== after.typeId) attrChange("region-type", id, before.typeId, after.typeId);
    }
    if (!sameValue(before?.claimants ?? [], after.claimants)) attrChange("region-claims", id, before?.claimants ?? [], after.claimants);
    if (clean(before?.group) !== clean(after.group)) attrChange("region-group", id, before?.group || null, after.group || null);
  }

  // Shape changes that touch each other are one change: a border moved between
  // two regions reshapes both, and accepting one half would leave a gap or an
  // overlap on the map.
  const boxes = shapeChanges.map((entry) => (entry.region?.shape || entry.before?.shape)?.bbox || null);
  const parent = shapeChanges.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < shapeChanges.length; i += 1) {
    for (let j = i + 1; j < shapeChanges.length; j += 1) {
      if (bboxesTouch(boxes[i], boxes[j])) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map();
  shapeChanges.forEach((entry, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push({ entry, bbox: boxes[index] });
  });
  let clusterIndex = 0;
  for (const members of clusters.values()) {
    clusterIndex += 1;
    const regions = members.map(({ entry }) => {
      const region = entry.region;
      // A drawn region travels whole: its owner, claims and group ride on it
      // (they are the world's rows, not the file's).
      const feature = region?.feature ? {
        type: "Feature",
        geometry: region.feature.geometry,
        properties: {
          ...(region.feature.properties ?? {}),
          id: entry.id,
          owner: region.owner || "",
          claimants: region.claimants.length ? region.claimants : null,
          group: region.group || null,
        },
      } : null;
      return {
        id: entry.id,
        op: entry.op,
        name: region?.name || entry.before?.name || entry.id,
        owner: region?.owner ?? entry.before?.owner ?? null,
        // The shapes' measures (measureGeometry), for telling on the author's
        // map whether a region is still the post's, already the suggested one,
        // or something the author redrew themselves.
        ...(feature ? { feature, toShape: region.shape ?? null } : {}),
        ...(entry.before?.shape ? { fromShape: entry.before.shape } : {}),
      };
    });
    changes.push({
      id: `borders:${regions.map((region) => region.id).sort().join(",").slice(0, 120)}`,
      area: "map",
      kind: "borders",
      regions,
      bbox: members.reduce((box, member) => bboxUnion(box, member.bbox), null),
    });
  }
  return clusterIndex;
};

const polityColorOf = (map, key) => rgbOf(map.colors?.[key]) || rgbOf(map.polities?.[key]?.color) || null;

const diffPolities = (base, next, changes) => {
  const a = base.map;
  const b = next.map;
  const ownersIn = (map) => {
    const byOwner = new Map();
    for (const region of map.regions.values()) {
      if (!region.owner) continue;
      if (!byOwner.has(region.owner)) byOwner.set(region.owner, new Set());
      byOwner.get(region.owner).add(region.id);
    }
    return byOwner;
  };
  // A country a map names — as an owner or a claimant — exists whether or not
  // it has a record: the Workshop writes a default record for every such
  // country on save, and that is no country founded or removed.
  const namedOn = (map) => {
    const keys = new Set();
    for (const region of map.regions.values()) {
      if (region.owner) keys.add(region.owner);
      for (const claimant of region.claimants ?? []) keys.add(claimant);
    }
    return keys;
  };
  const namedBefore = namedOn(a);
  const namedAfter = namedOn(b);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  // A post keyed by code (a legacy owner schema) is migrated by whichever store
  // imports it, and the stores leave its landless records differently — a
  // technical code dropped, kept, or read as a country's name. Those records
  // are the migration's, not the player's: a country with no land in either
  // version of such a post is not compared.
  const landlessInBoth = (key) => a.legacyOwners && !namedBefore.has(key) && !namedAfter.has(key);
  const added = Object.keys(b.polities).filter((key) => !has(a.polities, key) && !namedBefore.has(key) && !landlessInBoth(key));
  const removed = Object.keys(a.polities).filter((key) => !has(b.polities, key) && !namedAfter.has(key) && !landlessInBoth(key));
  // Recorded now, named but unrecorded in the post: compared with the record
  // the Workshop would have written for it.
  const materialized = new Set(Object.keys(b.polities).filter((key) => !has(a.polities, key) && namedBefore.has(key)));

  // A rename: a country gone and one new, holding (nearly) the regions the old
  // one held — a renamed country may also have gained or lost a region or two
  // in the same edit. The Workshop re-keys a renamed country everywhere, so
  // without this it reads as one country deleted and another founded.
  const renames = [];
  if (added.length && removed.length) {
    const ownedBefore = ownersIn(a);
    const ownedAfter = ownersIn(b);
    for (const from of removed) {
      const regions = ownedBefore.get(from);
      if (!regions?.size) continue;
      let best = null;
      for (const key of added) {
        if (renames.some((rename) => rename.to === key)) continue;
        const now = ownedAfter.get(key);
        if (!now?.size) continue;
        // At least half of each: most of the old country is the new one, and
        // most of the new one was the old (a country of two that lost one in
        // the same edit is still the same country renamed).
        const shared = [...regions].filter((id) => now.has(id));
        if (shared.length >= 0.5 * regions.size && shared.length >= 0.5 * now.size && (!best || shared.length > best.shared.length)) {
          best = { key, shared };
        }
      }
      if (best) renames.push({ from, to: best.key, regions: best.shared });
    }
  }
  const renamedFrom = new Set(renames.map((rename) => rename.from));
  const renamedTo = new Set(renames.map((rename) => rename.to));
  for (const rename of renames) {
    changes.push({
      id: `polity-rename:${rename.from}`,
      area: "map",
      kind: "polity-rename",
      from: rename.from,
      to: rename.to,
      record: b.polities[rename.to],
      color: polityColorOf(b, rename.to),
      flag: b.flags?.[rename.to] ?? null,
      tags: Array.isArray(b.tags?.[rename.to]) ? b.tags[rename.to] : null,
      regionIds: rename.regions,
    });
  }

  for (const key of added) {
    if (renamedTo.has(key)) continue;
    changes.push({
      id: `polity-add:${key}`,
      area: "map",
      kind: "polity-add",
      key,
      record: b.polities[key],
      color: polityColorOf(b, key),
      flag: b.flags?.[key] ?? null,
      tags: Array.isArray(b.tags?.[key]) ? b.tags[key] : null,
    });
  }
  for (const key of removed) {
    if (renamedFrom.has(key)) continue;
    changes.push({ id: `polity-remove:${key}`, area: "map", kind: "polity-remove", key, record: a.polities[key] });
  }

  // Countries in both: the record's fields, the colour (only where both
  // versions set one: a save writes every default colour out, which is no
  // choice anybody made), the flag and the tags.
  const keys = new Set([...Object.keys(a.polities), ...Object.keys(b.polities), ...Object.keys(a.colors), ...Object.keys(b.colors),
    ...Object.keys(a.flags), ...Object.keys(b.flags), ...Object.keys(a.tags), ...Object.keys(b.tags)]);
  for (const key of keys) {
    if (added.includes(key) || removed.includes(key)) continue;
    const inBoth = has(a.polities, key) && has(b.polities, key);
    const fields = {};
    if (inBoth || materialized.has(key)) {
      const before = polityView(key, inBoth ? a.polities[key] : null);
      const after = polityView(key, b.polities[key]);
      for (const field of ["name", "aliases", "code", "note", "status", "extra"]) {
        if (!sameValue(before[field], after[field])) fields[field] = { from: before[field] ?? null, to: after[field] ?? null };
      }
    }
    const colorBefore = polityColorOf(a, key);
    const colorAfter = polityColorOf(b, key);
    if (colorBefore && colorAfter && rgbToHex(colorBefore) !== rgbToHex(colorAfter)) fields.color = { from: colorBefore, to: colorAfter };
    const flagBefore = a.flags?.[key] ?? null;
    const flagAfter = b.flags?.[key] ?? null;
    if (clean(flagBefore) !== clean(flagAfter)) fields.flag = { from: flagBefore ? hashText(flagBefore) : null, to: flagAfter };
    const tagsBefore = [...new Set((a.tags?.[key] ?? []).map(clean).filter(Boolean))].sort();
    const tagsAfter = [...new Set((b.tags?.[key] ?? []).map(clean).filter(Boolean))].sort();
    if (!sameValue(tagsBefore, tagsAfter)) fields.tags = { from: tagsBefore, to: tagsAfter };
    if (Object.keys(fields).length) {
      changes.push({ id: `polity-change:${key}`, area: "map", kind: "polity-change", key, name: clean(b.polities[key]?.name) || key, fields, record: b.polities[key] ?? null });
    }
  }
  return renames;
};

const diffKeyed = (kindPrefix, before, after, changes, { label }) => {
  for (const [id, entry] of after) {
    const old = before.get(id);
    if (!old) changes.push({ id: `${kindPrefix}-add:${id}`, area: "map", kind: `${kindPrefix}-add`, key: id, label: label(entry.raw, id), to: entry.raw });
    else if (!sameValue(old.view, entry.view)) {
      changes.push({ id: `${kindPrefix}-change:${id}`, area: "map", kind: `${kindPrefix}-change`, key: id, label: label(entry.raw, id), from: old.raw, to: entry.raw });
    }
  }
  for (const [id, entry] of before) {
    if (!after.has(id)) changes.push({ id: `${kindPrefix}-remove:${id}`, area: "map", kind: `${kindPrefix}-remove`, key: id, label: label(entry.raw, id), from: entry.raw });
  }
};

// Cities carry no id: two are one city when the name matches and they stand
// within about 5 km (cityMarkers.js sameCity uses a looser 0.05°).
const CITY_NEAR = 0.05;
export const cityKeyOf = (city) => `${clean(city?.name).toLowerCase()}@${Number(city?.coord?.[0]).toFixed(2)},${Number(city?.coord?.[1]).toFixed(2)}`;
const diffCities = (base, next, changes) => {
  const a = base.map.cities;
  const b = next.map.cities;
  if (!a && !b) return;
  if (!a || !b) {
    // One version keeps the built-in city set and the other its own: the set
    // is one change, accepted or rejected whole.
    changes.push({ id: "cities-replace", area: "map", kind: "cities-replace", from: a ? a.length : null, to: b });
    return;
  }
  const unmatched = new Set(a.map((_, index) => index));
  const findMatch = (city) => {
    for (const index of unmatched) {
      const other = a[index];
      if (other.name.toLowerCase() === city.name.toLowerCase()
        && Math.abs(other.coord[0] - city.coord[0]) <= CITY_NEAR && Math.abs(other.coord[1] - city.coord[1]) <= CITY_NEAR) return index;
    }
    return -1;
  };
  for (const city of b) {
    const index = findMatch(city);
    if (index < 0) {
      changes.push({ id: `city-add:${cityKeyOf(city)}`, area: "map", kind: "city-add", name: city.name, to: city });
      continue;
    }
    unmatched.delete(index);
    if (!sameValue(a[index], city)) {
      changes.push({ id: `city-change:${cityKeyOf(a[index])}`, area: "map", kind: "city-change", name: city.name, from: a[index], to: city });
    }
  }
  for (const index of unmatched) {
    changes.push({ id: `city-remove:${cityKeyOf(a[index])}`, area: "map", kind: "city-remove", name: a[index].name, from: a[index] });
  }
};

const diffGroups = (base, next, changes) => {
  const a = base.map.groups;
  const b = next.map.groups;
  for (const [name, group] of Object.entries(b)) {
    if (!a[name]) changes.push({ id: `group-add:${name}`, area: "map", kind: "group-add", key: name, to: group });
    else if (!sameValue({ description: a[name].description, color: a[name].color }, { description: group.description, color: group.color })) {
      changes.push({ id: `group-change:${name}`, area: "map", kind: "group-change", key: name, from: a[name], to: group });
    }
  }
  for (const [name, group] of Object.entries(a)) {
    if (!b[name]) changes.push({ id: `group-remove:${name}`, area: "map", kind: "group-remove", key: name, from: group });
  }
};

const diffMapFields = (base, next, changes) => {
  if (base.map.author !== next.map.author) {
    changes.push({ id: "map:author", area: "map", kind: "map-field", field: "author", from: base.map.author, to: next.map.author });
  }
  if ((base.map.basemap || "") !== (next.map.basemap || "") && next.map.basemap) {
    changes.push({ id: "map:basemap", area: "map", kind: "map-field", field: "basemap", from: base.map.basemap, to: next.map.basemap });
  }
  if ((base.map.background?.hash || "") !== (next.map.background?.hash || "")) {
    changes.push({
      id: "map:background",
      area: "map",
      kind: "background",
      from: base.map.background ? { kind: base.map.background.kind, hash: base.map.background.hash } : null,
      to: next.map.background ? { kind: next.map.background.kind, hash: next.map.background.hash, data: next.map.background.data } : null,
    });
  }
};

// The changes that turn `baseBundle` into `nextBundle`, details first, then the
// map. Either argument may be a snapshot already (buildScenarioSnapshot).
export const diffScenarioBundles = (baseBundle, nextBundle) => {
  const base = baseBundle?.map?.regions instanceof Map ? baseBundle : buildScenarioSnapshot(baseBundle);
  const next = nextBundle?.map?.regions instanceof Map ? nextBundle : buildScenarioSnapshot(nextBundle);
  const changes = [];
  diffDetails(base, next, changes);
  const renames = diffPolities(base, next, changes);
  diffRegions(base, next, changes);
  // A rename moves its regions with it: those ownership rows are the rename.
  if (renames.length) {
    const folded = new Set(renames.flatMap((rename) => rename.regions.map((id) => `region-owner:${id}`)));
    for (let i = changes.length - 1; i >= 0; i -= 1) {
      const change = changes[i];
      if (folded.has(change.id) && renames.some((rename) => rename.from === change.from && rename.to === change.to)) changes.splice(i, 1);
    }
  }
  diffGroups(base, next, changes);
  diffCities(base, next, changes);
  diffKeyed("unit", base.map.units, next.map.units, changes, { label: (unit, id) => clean(unit?.name) || id });
  diffKeyed("marker", base.map.markers, next.map.markers, changes, { label: (marker, id) => clean(marker?.name) || id });
  diffKeyed("puppet", base.map.puppets, next.map.puppets, changes, { label: (row, id) => `${clean(row?.puppet)} ← ${clean(row?.overlord)}`.trim() || id });
  diffMapFields(base, next, changes);
  return changes;
};

// ---- summaries ----------------------------------------------------------------

// How many changes of each kind, and in each area.
export const countChanges = (changes) => {
  const counts = { details: 0, map: 0, byKind: {} };
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change.area === "map") counts.map += 1;
    else counts.details += 1;
    counts.byKind[change.kind] = (counts.byKind[change.kind] ?? 0) + 1;
  }
  return counts;
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const FIELD_NAMES = {
  "meta.name": "Name", "meta.eyebrow": "Eyebrow", "meta.accentColor": "Accent colour", "meta.subtitle": "Subtitle",
  "meta.description": "Description", "meta.heroTitle": "Hero title", "meta.heroSubtitle": "Hero subtitle",
  "game.country": "Player country", "game.startDate": "Start date", "game.gameDate": "Game date", "game.difficulty": "Difficulty",
  "game.language": "Language", "world.allowedUnitTypes": "Deployable troop types", "world.labelFont": "Country label font",
  "world.labelTextColor": "Country label colour", "world.labelHaloColor": "Country label border colour",
  "world.simulationRules": "Simulation rules", "world.startingTimelineText": "World before round one",
};

// A few plain English lines for the GitHub comment that carries a suggestion:
// it is read on GitHub, where the game's language packs do not reach, so it is
// kept short and the zip holds the whole of it.
export const summarizeChangesForComment = (changes, { maxLines = 14 } = {}) => {
  const list = Array.isArray(changes) ? changes : [];
  const byKind = countChanges(list).byKind;
  const lines = [];
  const fields = list.filter((change) => change.kind === "field");
  for (const change of fields.slice(0, 6)) {
    const key = change.path.slice(0, 2).join(".");
    if (change.path[0] === "features") lines.push(`${change.feature}${change.setting ? `: ${change.setting}` : ""} changed`);
    else if (change.path[0] === "prompts") lines.push(`Prompt guidance edited (${change.path.slice(1).join(" › ")})`);
    else lines.push(`${FIELD_NAMES[key] || key} changed`);
  }
  if (fields.length > 6) lines.push(`${fields.length - 6} more settings changed`);
  const politics = list.filter((change) => change.kind === "politics").length;
  if (politics) lines.push(`${plural(politics, "Politics entry", "Politics entries")} changed`);
  if (byKind.stats) lines.push("Stats sheet changed");
  if (byKind.cover) lines.push("New cover image");
  if (byKind["region-owner"]) lines.push(`${plural(byKind["region-owner"], "region changes", "regions change")} owner`);
  if (byKind.borders) lines.push(`${plural(byKind.borders, "border change", "border changes")}`);
  if (byKind["polity-add"]) lines.push(`${plural(byKind["polity-add"], "new country", "new countries")}`);
  if (byKind["polity-remove"]) lines.push(`${plural(byKind["polity-remove"], "country removed", "countries removed")}`);
  if (byKind["polity-rename"]) lines.push(`${plural(byKind["polity-rename"], "country renamed", "countries renamed")}`);
  if (byKind["polity-change"]) lines.push(`${plural(byKind["polity-change"], "country edited", "countries edited")}`);
  const regionAttrs = (byKind["region-name"] ?? 0) + (byKind["region-type"] ?? 0);
  if (regionAttrs) lines.push(`${plural(regionAttrs, "region renamed or retyped", "regions renamed or retyped")}`);
  if (byKind["region-claims"]) lines.push(`${plural(byKind["region-claims"], "claim changed", "claims changed")}`);
  const groupChanges = (byKind["group-add"] ?? 0) + (byKind["group-remove"] ?? 0) + (byKind["group-change"] ?? 0) + (byKind["region-group"] ?? 0);
  if (groupChanges) lines.push(`${plural(groupChanges, "group change", "group changes")}`);
  const cityChanges = (byKind["city-add"] ?? 0) + (byKind["city-remove"] ?? 0) + (byKind["city-change"] ?? 0);
  if (cityChanges) lines.push(`${plural(cityChanges, "city change", "city changes")}`);
  if (byKind["cities-replace"]) lines.push("A new set of cities");
  const units = (byKind["unit-add"] ?? 0) + (byKind["unit-remove"] ?? 0) + (byKind["unit-change"] ?? 0);
  if (units) lines.push(`${plural(units, "unit change", "unit changes")}`);
  const markers = (byKind["marker-add"] ?? 0) + (byKind["marker-remove"] ?? 0) + (byKind["marker-change"] ?? 0);
  if (markers) lines.push(`${plural(markers, "map feature change", "map feature changes")}`);
  const puppets = (byKind["puppet-add"] ?? 0) + (byKind["puppet-remove"] ?? 0) + (byKind["puppet-change"] ?? 0);
  if (puppets) lines.push(`${plural(puppets, "puppet state change", "puppet state changes")}`);
  if (byKind.background) lines.push("New basemap");
  if (byKind["map-field"]) lines.push(`${plural(byKind["map-field"], "map setting changed", "map settings changed")}`);
  return lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `…and ${lines.length - maxLines + 1} more`] : lines;
};
