import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";

const NEUTRAL = [130, 130, 138];
const GROUP_TINT_ALPHA = 0.3;
const EARTH = 6378137;

const fallbackColorCache = new Map();
const editorCodeToColor = (code) => {
  const hit = fallbackColorCache.get(code);
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const c = 0.5;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.25;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const rgb = [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  fallbackColorCache.set(code, rgb);
  return rgb;
};

const hexRgb = (hex) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexToRgb = (value) => {
  const m = /^#?([a-f0-9]{6})$/i.exec(String(value || "").trim());
  if (!m) return null;
  const hex = m[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
};

const over = (topRgb, topAlpha, rgb, alpha) => {
  const out = topAlpha + alpha * (1 - topAlpha);
  if (out <= 0) return [rgb[0], rgb[1], rgb[2]];
  const mix = (i) => Math.round((topRgb[i] * topAlpha + rgb[i] * alpha * (1 - topAlpha)) / out);
  return [mix(0), mix(1), mix(2)];
};

const fillRgb = (value) => {
  const text = String(value ?? "").trim();
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
};

const normalizePolityKeyedMap = (input, polities) => {
  const out = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  for (const [key, record] of Object.entries(polities || {})) {
    if (out[key] !== undefined) continue;
    const candidates = [record?.name, ...(Array.isArray(record?.aliases) ? record.aliases : [])]
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    const found = candidates.find((candidate) => out[candidate] !== undefined);
    if (found) out[key] = out[found];
  }
  return out;
};

const FLAGCDN = /^https?:\/\/flagcdn\.com\/(?:(?:[wh]\d+|\d+x\d+)\/)?([a-z]{2}(?:-[a-z]{2,3})?)\.(svg|png|webp|jpe?g)(?:[?#].*)?$/i;

const NAME_FIELD_PRIORITY = ["name", "region_name", "regionName", "province_name", "provinceName", "display_name", "displayName", "label", "title", "NAME", "Name"];
const ID_FIELD_PRIORITY = ["__featureId", "__objectKey", "id", "regionId", "region_id", "provinceId", "province_id", "province", "gid", "gid0", "GID_0", "GID_1", "GID_2", "OBJECTID", "FID", "ADM0_A3", "ADM1_CODE", "ADM2_CODE"];
const validFeatureCollection = (value) => value && value.type === "FeatureCollection" && Array.isArray(value.features);
const primitiveKey = (value) => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const text = String(value).trim();
    return text ? text : null;
  }
  return null;
};
const featureFieldValue = (feature, field) => {
  if (field === "__featureId") return feature?.id;
  return feature?.properties?.[field];
};
const recordFieldValue = (record, field) => record?.[field];
const flattenMetadataFeature = (feature) => ({
  ...(feature?.properties && typeof feature.properties === "object" ? feature.properties : {}),
  ...(feature?.id != null ? { __featureId: feature.id } : {}),
});
const objectMapToRecords = (value) =>
  Object.entries(value || {})
    .filter(([, row]) => row && typeof row === "object" && !Array.isArray(row))
    .map(([key, row]) => ({ ...row, __objectKey: key }));
const extractMetadataRecords = (parsed) => {
  if (Array.isArray(parsed)) return parsed.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (validFeatureCollection(parsed)) return parsed.features.map(flattenMetadataFeature);
  if (!parsed || typeof parsed !== "object") return [];
  const preferredContainers = ["regions", "provinces", "records", "items", "data", "features"];
  for (const key of preferredContainers) {
    const nested = parsed[key];
    if (Array.isArray(nested)) {
      if (key === "features" && nested.some((row) => row?.type === "Feature")) {
        return nested.map((row) => (row?.type === "Feature" ? flattenMetadataFeature(row) : row)).filter((row) => row && typeof row === "object" && !Array.isArray(row));
      }
      return nested.filter((row) => row && typeof row === "object" && !Array.isArray(row));
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const rows = objectMapToRecords(nested);
      if (rows.length) return rows;
    }
  }
  return objectMapToRecords(parsed);
};
const collectFields = (rows, { feature = false } = {}) => {
  const counts = new Map();
  const limit = Math.min(rows.length, 5000);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (feature) {
      if (row?.id != null) counts.set("__featureId", (counts.get("__featureId") || 0) + 1);
      const props = row?.properties;
      if (!props || typeof props !== "object") continue;
      for (const [key, value] of Object.entries(props)) if (primitiveKey(value) != null) counts.set(key, (counts.get(key) || 0) + 1);
    } else {
      if (!row || typeof row !== "object") continue;
      for (const [key, value] of Object.entries(row)) if (primitiveKey(value) != null) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const priorityIndex = (field) => {
    const exact = ID_FIELD_PRIORITY.indexOf(field);
    if (exact >= 0) return exact;
    const lower = field.toLowerCase();
    const fuzzy = ID_FIELD_PRIORITY.findIndex((x) => x.toLowerCase() === lower);
    return fuzzy >= 0 ? fuzzy : 999;
  };
  return [...counts.entries()]
    .sort((a, b) => priorityIndex(a[0]) - priorityIndex(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([field]) => field)
    .slice(0, 80);
};
const chooseNameField = (fields) => {
  for (const preferred of NAME_FIELD_PRIORITY) {
    const exact = fields.find((field) => field === preferred);
    if (exact) return exact;
  }
  for (const preferred of NAME_FIELD_PRIORITY) {
    const lower = preferred.toLowerCase();
    const fuzzy = fields.find((field) => field.toLowerCase() === lower);
    if (fuzzy) return fuzzy;
  }
  const containsName = fields.find((field) => /(^|[_-])name([_-]|$|\d)/i.test(field) || /name/i.test(field));
  return containsName || null;
};
const scoreJoinPair = (features, records, geoField, metaField) => {
  const metaValues = new Set();
  for (const row of records) {
    const key = primitiveKey(recordFieldValue(row, metaField));
    if (key != null) metaValues.add(key);
  }
  if (!metaValues.size) return 0;
  let matches = 0;
  let seen = 0;
  for (const feature of features) {
    const key = primitiveKey(featureFieldValue(feature, geoField));
    if (key == null) continue;
    seen += 1;
    if (metaValues.has(key)) matches += 1;
  }
  if (!seen) return 0;
  const coverage = matches / Math.max(1, features.length);
  const precision = matches / Math.max(1, seen);
  return matches + coverage * features.length * 0.35 + precision * features.length * 0.15;
};
const chooseJoinPair = (features, records, geoFields, metaFields, requestedGeo = "auto", requestedMeta = "auto") => {
  const geoCandidates = requestedGeo !== "auto" ? [requestedGeo] : geoFields.slice(0, 32);
  const metaCandidates = requestedMeta !== "auto" ? [requestedMeta] : metaFields.slice(0, 32);
  let best = null;
  for (const geoField of geoCandidates) {
    for (const metaField of metaCandidates) {
      const score = scoreJoinPair(features, records, geoField, metaField);
      if (score <= 0) continue;
      const idBonus =
        (ID_FIELD_PRIORITY.some((x) => x.toLowerCase() === geoField.toLowerCase()) ? 0.25 : 0) +
        (ID_FIELD_PRIORITY.some((x) => x.toLowerCase() === metaField.toLowerCase()) ? 0.25 : 0);
      const row = { geoField, metaField, score: score + idBonus };
      if (!best || row.score > best.score) best = row;
    }
  }
  return best;
};
const cleanMetadataRecord = (record) => {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (key.startsWith("__")) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
};
const normalizeFeatureName = (feature, preferredField = "auto", metadataRecord = null) => {
  const props = feature.properties || (feature.properties = {});
  const metadataFields = metadataRecord ? Object.keys(metadataRecord).filter((key) => !key.startsWith("__")) : [];
  const featureFields = Object.keys(props);
  let field = preferredField !== "auto" ? preferredField : null;
  let value = null;
  if (field) {
    value = metadataRecord?.[field];
    if (value == null) value = props[field];
  } else {
    const metadataNameField = chooseNameField(metadataFields);
    if (metadataNameField) {
      field = metadataNameField;
      value = metadataRecord?.[field];
    }
    if (value == null) {
      const featureNameField = chooseNameField(featureFields);
      if (featureNameField) {
        field = featureNameField;
        value = props[field];
      }
    }
  }
  if (value != null && String(value).trim()) {
    props.name = String(value).trim();
    return { imported: true, field };
  }
  return { imported: false, field: null };
};
const normalizeOwnerColor = (value) => {
  if (value == null || String(value).trim() === "") return null;
  const match = /^#?([a-f0-9]{6})$/i.exec(String(value).trim());
  return match ? `#${match[1].toUpperCase()}` : false;
};
const firstExistingFlagForCandidates = (flags, candidates) => {
  const source = flags && typeof flags === "object" && !Array.isArray(flags) ? flags : {};
  const index = new Map(
    Object.entries(source)
      .filter(([key, value]) => String(key || "").trim() && String(value || "").trim())
      .map(([key, value]) => [String(key).trim().toLowerCase(), value]),
  );
  for (const candidate of candidates || []) {
    const key = String(candidate || "").trim().toLowerCase();
    if (!key) continue;
    const value = index.get(key);
    if (value) return value;
  }
  return null;
};
const normalizeImportTagList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[;,|]/).map((v) => v.trim()).filter(Boolean);
  return [];
};
const boolish = (value) => {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "1" || text === "primary" || text === "capital";
};
const CITY_SYMBOL_TIER = { square: 1, flag: 2, cross: 2, "full-flag": 3 };
const cityPointName = (props) => {
  for (const key of ["name", "city", "label", "title", "NAME", "Name"]) {
    const text = String(props?.[key] ?? "").trim();
    if (text) return text;
  }
  return "";
};
const isExplicitCityPoint = (feature) => {
  if (feature?.geometry?.type !== "Point") return false;
  const props = feature?.properties || {};
  const markerType = String(props.markerType ?? props.marker_type ?? "").trim().toLowerCase();
  if (markerType === "city") return true;
  const tags = normalizeImportTagList(props.tags).map((tag) => tag.toLowerCase());
  return tags.includes("city") || tags.includes("capital");
};
const buildPolityResolver = (polities) => {
  const records = polities && typeof polities === "object" && !Array.isArray(polities) ? polities : {};
  const exactKeys = new Map();
  const exactAliases = new Map();
  const foldedAliases = new Map();
  const addAlias = (map, alias, key) => {
    const text = String(alias || "").trim();
    if (!text) return;
    const set = map.get(text) || new Set();
    set.add(key);
    map.set(text, set);
  };
  for (const key of Object.keys(records)) {
    const stableKey = String(key || "").trim();
    if (!stableKey) continue;
    exactKeys.set(stableKey, stableKey);
  }
  for (const [key, record] of Object.entries(records)) {
    const stableKey = String(key || "").trim();
    if (!stableKey) continue;
    const aliases = [stableKey, record?.name, ...(Array.isArray(record?.aliases) ? record.aliases : [])];
    for (const alias of aliases) {
      const text = String(alias || "").trim();
      if (!text) continue;
      addAlias(exactAliases, text, stableKey);
      addAlias(foldedAliases, text.toLocaleLowerCase(), stableKey);
    }
  }
  return (value) => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (exactKeys.has(text)) return exactKeys.get(text);
    const exact = exactAliases.get(text);
    if (exact?.size === 1) return [...exact][0];
    const folded = foldedAliases.get(text.toLocaleLowerCase());
    if (folded?.size === 1) return [...folded][0];
    return text;
  };
};
const embeddedPolityRowsFromGeoJSON = (value) => {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object" && !Array.isArray(row)).map((row) => ({ ...row }));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).filter(([, row]) => row && typeof row === "object" && !Array.isArray(row)).map(([key, row]) => ({ key, ...row }));
};
const embeddedPolityIndex = (rows) => {
  const map = new Map();
  for (const row of rows || []) {
    const candidates = [row?.key, row?.stableKey, row?.stable_key, row?.name, ...(Array.isArray(row?.aliases) ? row.aliases : [])];
    for (const candidate of candidates) {
      const text = String(candidate || "").trim().toLocaleLowerCase();
      if (!text || map.has(text)) continue;
      map.set(text, row);
    }
  }
  return map;
};
const safeStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};
const cityFeatureToGeoJSON = (feature) => {
  if (!Array.isArray(feature?.coord) || feature.coord.length < 2) return null;
  const lon = Number(feature.coord[0]);
  const lat = Number(feature.coord[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const tags = Array.isArray(feature.tags) ? feature.tags : [];
  if (!tags.includes("city") && !tags.includes("capital")) return null;
  return {
    type: "Feature",
    ...(feature.id != null ? { id: feature.id } : {}),
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      markerType: "city",
      name: feature.name || "",
      displaySymbol: feature.symbol || "square",
      tags,
      capital: tags.includes("capital"),
      population: Number(feature.population || 0),
      tier: Number(feature.tier || 0) || undefined,
      owner: feature.owner || undefined,
      sourceRegionId: feature.sourceRegionId || feature.regionId || undefined,
      scale: feature.scale,
      labelScale: feature.labelScale,
      labelPlacement: feature.labelPlacement,
    },
  };
};

const ENGINE_BUNDLE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "engine.mjs");
const RASTER_PIXEL_CAP = 30000000;

const runProvinceRasterWorker = async () => {
  for (const method of ["log", "info", "debug", "warn"]) {
    console[method] = (...args) => process.stderr.write(`${args.map(String).join(" ")}\n`);
  }
  const { bundle, rawFile, width, height, options } = workerData;
  try {
    const pixels = width * height;
    if (pixels > RASTER_PIXEL_CAP) throw new Error(`Raster is too large (${pixels.toLocaleString()} pixels). Current safety cap is ${RASTER_PIXEL_CAP.toLocaleString()}.`);
    const raw = fs.readFileSync(rawFile);
    if (raw.length !== pixels * 4) throw new Error("Raster pixel buffer does not match its dimensions.");
    const colors = new Int32Array(pixels);
    for (let i = 0, at = 0; i < pixels; i += 1, at += 4) {
      colors[i] = raw[at + 3] === 0 ? -1 : ((raw[at] << 16) | (raw[at + 1] << 8) | raw[at + 2]);
    }
    const engine = await import(pathToFileURL(bundle).href);
    const result = engine.wsProvinceRaster.vectorizeColorGrid(width, height, colors, options, (fraction, message) => parentPort.postMessage({ type: "progress", fraction, message }));
    parentPort.postMessage({ type: "done", result });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error?.message || String(error) });
  }
};

if (!isMainThread && workerData?.ohProvinceRaster) await runProvinceRasterWorker();

const runReprojectWorker = async () => {
  const { bundle, rawFile, width, height, outFile, from, to, bounds, outWidth, outHeight } = workerData;
  try {
    const raw = fs.readFileSync(rawFile);
    if (raw.length !== width * height * 4) throw new Error("The basemap picture could not be read.");
    const engine = await import(pathToFileURL(bundle).href);
    const out = engine.wsProjectionImage.reprojectPixels({ width, height, data: raw }, { from, to, bounds, width: outWidth, height: outHeight });
    fs.writeFileSync(outFile, Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength));
    parentPort.postMessage({ type: "done", result: { width: outWidth, height: outHeight } });
  } catch (error) {
    parentPort.postMessage({ type: "error", message: error?.message || String(error) });
  }
};

if (!isMainThread && workerData?.ohReproject) await runReprojectWorker();

export const register = (ctx) => {
  const { engine, emit, plain, clean, list, cacheDir, repo } = ctx;
  const lib = engine.library;
  const VectorSource = engine.wsOlVectorSource.default;
  const Feature = engine.wsOlFeature.default;
  const GeoJSON = engine.wsOlGeoJSON.default;
  const Polygon = engine.wsOlPolygon.default;
  const { toLonLat, fromLonLat } = engine.wsOlProj;
  const geo = engine.wsGeometry;
  const sweep = engine.wsTopology;
  const mapDoc = engine.wsMapDocument;
  const rename = engine.wsPolityRename;
  const groupsLib = engine.wsGroups;
  const typesLib = engine.wsRegionTypes;
  const undoLib = engine.wsDocumentUndo;
  const flagsDir = path.join(repo, "public", "flags");
  const workDir = path.join(cacheDir, "workshop");
  const clipboardFile = path.join(cacheDir, "workshop-clipboard.json");
  fs.mkdirSync(workDir, { recursive: true });

  let session = null;
  let clipboard = null;
  let flagPosts = [];
  try {
    const stored = JSON.parse(fs.readFileSync(clipboardFile, "utf8"));
    clipboard = engine.wsRegionClipboard.isRegionClipboard(stored) ? stored : null;
  } catch {
    clipboard = null;
  }

  const need = (id) => {
    if (!session || (id && session.id !== id)) throw new Error("The map editor is not open.");
    return session;
  };

  const flagFileOf = (value) => {
    const match = FLAGCDN.exec(String(value ?? "").trim());
    if (!match) return "";
    const file = path.join(flagsDir, `${match[1].toLowerCase()}.svg`);
    return fs.existsSync(file) ? file : "";
  };

  const fmt = new GeoJSON();
  const READ = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" };
  const WRITE = { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857", decimals: 5 };

  const paintColors = (s) => ({ ...s.palette, ...(s.doc.colorOverrides || {}) });
  const typesById = (s) => Object.fromEntries((s.doc.types || []).map((type) => [type.id, type]));

  const status = (s) => ({
    saveStatus: s.saveStatus,
    saveError: s.saveError,
    scenarioDirty: s.scenarioDirty,
    hydrated: s.hydrated,
    action: s.action,
  });
  const pushStatus = (s) => {
    if (session === s) emit("workshop.status", { session: s.id, ...status(s) });
  };

  const scheduleAutosave = (s) => {
    clearTimeout(s.autosaveTimer);
    s.autosaveTimer = setTimeout(() => {
      if (session !== s || s.saveStatus !== "dirty") return;
      s.retries = 0;
      void s.runSave();
    }, 2000);
  };

  const dirty = (s) => {
    s.edits += 1;
    s.saveStatus = "dirty";
    if (s.hydrated) s.scenarioDirty = true;
    scheduleAutosave(s);
  };

  const setDocField = (s, field, fallback) => (updater) => {
    const current = s.doc[field] ?? fallback;
    s.doc = { ...s.doc, [field]: typeof updater === "function" ? updater(current) : (updater ?? fallback) };
    dirty(s);
  };
  const setters = (s) => ({
    features: setDocField(s, "features", []),
    units: setDocField(s, "units", []),
    groups: setDocField(s, "groups", {}),
    puppets: setDocField(s, "puppets", []),
    terrainAreas: setDocField(s, "terrainAreas", []),
    fortifications: setDocField(s, "fortifications", []),
    climateZones: setDocField(s, "climateZones", []),
    freezingRegions: setDocField(s, "freezingRegions", []),
    types: (updater) => {
      s.doc = { ...s.doc, types: typeof updater === "function" ? updater(s.doc.types) : updater };
      dirty(s);
    },
  });

  const patchMetadata = (s, patch) => {
    s.doc = { ...s.doc, metadata: { ...s.doc.metadata, ...patch } };
    if (Object.prototype.hasOwnProperty.call(patch || {}, "customBackground") || Object.prototype.hasOwnProperty.call(patch || {}, "basemap")) s.styleRev = (s.styleRev || 0) + 1;
    dirty(s);
  };

  const setColorOverride = (s, country, rgb) => {
    const owner = clean(country);
    if (!owner) return;
    const next = { ...(s.doc.colorOverrides || {}) };
    if (rgb) next[owner] = rgb; else delete next[owner];
    s.doc = { ...s.doc, colorOverrides: next };
    dirty(s);
  };

  const setFlag = (s, country, dataUrl) => {
    const owner = clean(country);
    if (!owner) return;
    const next = { ...(s.doc.flags || {}) };
    if (dataUrl) next[owner] = dataUrl; else delete next[owner];
    s.doc = { ...s.doc, flags: next };
    dirty(s);
  };

  const setTags = (s, country, values) => {
    const owner = clean(country);
    if (!owner) return;
    const tags = engine.wsCountryTags.normalizeTagList(values);
    const next = { ...(s.doc.tags || {}) };
    if (tags.length) next[owner] = tags; else delete next[owner];
    s.doc = { ...s.doc, tags: next };
    dirty(s);
  };

  const upsertPolity = (s, key, patch = {}) => {
    const stableKey = clean(key);
    if (!stableKey) return;
    const current = s.doc.polities?.[stableKey] || {};
    const record = {
      ...current,
      ...patch,
      name: String(patch.name ?? current.name ?? stableKey).trim() || stableKey,
      aliases: Array.isArray(patch.aliases ?? current.aliases)
        ? [...new Set((patch.aliases ?? current.aliases).map((v) => String(v || "").trim()).filter(Boolean))]
        : [],
    };
    for (const [field, value] of Object.entries(patch)) if (value === undefined) delete record[field];
    s.doc = { ...s.doc, polities: { ...(s.doc.polities || {}), [stableKey]: record } };
    dirty(s);
  };

  const renamePolityDoc = (s, from, to) => {
    try {
      const renamed = rename.renamePolityInDocument(s.doc, from, to);
      const fromKey = rename.findPolityKey(s.doc.polities, from) || from;
      s.doc = { ...renamed, polityRenames: [...(Array.isArray(s.doc.polityRenames) ? s.doc.polityRenames : []), { from: fromKey, to }] };
    } catch (error) {
      console.warn("[editor] polity rename refused:", error);
    }
    dirty(s);
  };

  const removePolitiesDoc = (s, keys) => {
    const stableKeys = [...new Set((keys || []).map((key) => clean(key)).filter(Boolean))];
    if (!stableKeys.length) return;
    const polities = { ...(s.doc.polities || {}) };
    const colorOverrides = { ...(s.doc.colorOverrides || {}) };
    const flags = { ...(s.doc.flags || {}) };
    const tags = { ...(s.doc.tags || {}) };
    for (const stableKey of stableKeys) {
      delete polities[stableKey];
      delete colorOverrides[stableKey];
      delete flags[stableKey];
      delete tags[stableKey];
    }
    s.doc = { ...s.doc, polities, colorOverrides, flags, tags, puppets: engine.wsPuppets.withoutPolities(s.doc.puppets, stableKeys.length === 1 ? stableKeys[0] : stableKeys) };
    dirty(s);
  };

  const importPolityRoster = (s, rows) => {
    const { summary } = engine.wsPolityRoster.mergePolityRoster({ polities: s.doc.polities }, rows);
    if (!summary.count) return summary;
    s.doc = engine.wsPolityRoster.mergePolityRoster(s.doc, rows).doc;
    dirty(s);
    return summary;
  };

  const features = (s) => s.source.getFeatures();

  const pushCmd = (s, cmd) => {
    s.undo.push(cmd);
    if (s.undo.length > 80) s.undo.shift();
    s.redo = [];
  };

  const notify = (s, { loaded = false, geometry = false } = {}) => {
    if (!loaded) dirty(s);
    s.regionRev += 1;
    if (geometry) s.geometryRev += 1;
  };

  const summarize = (f) => ({
    id: f.getId(),
    name: f.get("name") || "",
    owner: f.get("owner") || null,
    typeId: f.get("typeId") || "land",
    country: f.get("country") || "",
    claimants: f.get("claimants") || [],
    group: f.get("group") || "",
  });

  const listPolityUsage = (s) => {
    const rows = new Map();
    const ensure = (key) => {
      const stableKey = clean(key);
      if (!stableKey) return null;
      if (!rows.has(stableKey)) rows.set(stableKey, { key: stableKey, regionCount: 0, claimantCount: 0 });
      return rows.get(stableKey);
    };
    for (const f of features(s)) {
      const owner = ensure(f.get("owner"));
      if (owner) owner.regionCount += 1;
      for (const claimant of Array.isArray(f.get("claimants")) ? f.get("claimants") : []) {
        const row = ensure(claimant);
        if (row) row.claimantCount += 1;
      }
    }
    return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
  };

  const listGroupUsage = (s) => {
    const counts = {};
    for (const f of features(s)) {
      const group = clean(f.get("group"));
      if (group) counts[group] = (counts[group] ?? 0) + 1;
    }
    return counts;
  };

  const listOwners = (s) => {
    const owners = new Set();
    for (const f of features(s)) {
      const owner = f.get("owner");
      if (owner) owners.add(String(owner));
    }
    return [...owners].sort((a, b) => a.localeCompare(b));
  };

  const polityChoices = (s, extra = "") => {
    const keys = new Set(Object.keys(s.doc.polities || {}));
    for (const row of listPolityUsage(s)) keys.add(row.key);
    if (extra) keys.add(extra);
    return [...keys]
      .filter(Boolean)
      .map((key) => ({ key, name: String(s.doc.polities?.[key]?.name || key) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  };

  const setRegionAttrs = (s, ids, patch) => {
    const undos = [];
    for (const id of ids) {
      const f = s.source.getFeatureById(id);
      if (!f) continue;
      const before = {};
      let claimants;
      if ("owner" in patch) { before.owner = f.get("owner") || null; f.set("owner", patch.owner || null); }
      if ("typeId" in patch) { before.typeId = f.get("typeId"); f.set("typeId", patch.typeId); }
      if ("name" in patch) { before.name = f.get("name"); f.set("name", patch.name); s.nameEdits.set(String(f.getId()), String(patch.name ?? "")); }
      if ("claimants" in patch) {
        before.claimants = f.get("claimants") || null;
        claimants = typeof patch.claimants === "function" ? patch.claimants(before.claimants || []) : patch.claimants;
        claimants = claimants?.length ? claimants : null;
        f.set("claimants", claimants);
      }
      if ("group" in patch) { before.group = f.get("group") || null; f.set("group", patch.group || null); }
      undos.push([f, before, claimants]);
    }
    notify(s);
    if (undos.length) {
      const after = { ...patch };
      pushCmd(s, {
        undo: () => undos.forEach(([f, b]) => Object.keys(b).forEach((k) => {
          f.set(k, b[k]);
          if (k === "name") s.nameEdits.set(String(f.getId()), String(b[k] ?? ""));
        })),
        redo: () => undos.forEach(([f, , claimants]) => {
          if ("owner" in after) f.set("owner", after.owner || null);
          if ("typeId" in after) f.set("typeId", after.typeId);
          if ("name" in after) { f.set("name", after.name); s.nameEdits.set(String(f.getId()), String(after.name ?? "")); }
          if ("claimants" in after) f.set("claimants", claimants);
          if ("group" in after) f.set("group", after.group || null);
        }),
      });
    }
  };

  const renameOwner = (s, from, to) => {
    const same = (value) => rename.samePolityName(value, from);
    const undos = [];
    for (const f of features(s)) {
      const owner = f.get("owner") || null;
      const claimants = Array.isArray(f.get("claimants")) ? f.get("claimants") : [];
      const ownerHit = Boolean(owner) && same(owner);
      const claimHit = claimants.some(same);
      if (!ownerHit && !claimHit) continue;
      const before = { owner, claimants: claimants.length ? claimants.slice() : null };
      const nextClaimants = claimHit ? [...new Set(claimants.map((claimant) => (same(claimant) ? to : claimant)))] : before.claimants;
      const after = { owner: ownerHit ? to : owner, claimants: nextClaimants?.length ? nextClaimants : null };
      f.set("owner", after.owner);
      f.set("claimants", after.claimants);
      undos.push([f, before, after]);
    }
    if (!undos.length) return 0;
    notify(s);
    pushCmd(s, {
      undo: () => undos.forEach(([f, b]) => { f.set("owner", b.owner); f.set("claimants", b.claimants); }),
      redo: () => undos.forEach(([f, , a]) => { f.set("owner", a.owner); f.set("claimants", a.claimants); }),
    });
    return undos.length;
  };

  const removeOwners = (s, ownerKeys) => {
    const keys = new Set((ownerKeys || []).map((key) => clean(key)).filter(Boolean));
    if (!keys.size) return { affectedRegions: 0, ownedRegions: 0, claimRefs: 0 };
    const undos = [];
    let ownedRegions = 0;
    let claimRefs = 0;
    for (const f of features(s)) {
      const owner = f.get("owner") || null;
      const claimants = Array.isArray(f.get("claimants")) ? f.get("claimants") : [];
      const ownerHit = Boolean(owner) && keys.has(String(owner).trim());
      const removedClaims = claimants.filter((claimant) => keys.has(clean(claimant)));
      if (!ownerHit && !removedClaims.length) continue;
      const before = { owner, claimants: claimants.length ? claimants.slice() : null };
      const nextClaimants = removedClaims.length ? claimants.filter((claimant) => !keys.has(clean(claimant))) : claimants;
      const after = { owner: ownerHit ? null : owner, claimants: nextClaimants.length ? nextClaimants : null };
      f.set("owner", after.owner);
      f.set("claimants", after.claimants);
      if (ownerHit) ownedRegions += 1;
      claimRefs += removedClaims.length;
      undos.push([f, before, after]);
    }
    if (!undos.length) return { affectedRegions: 0, ownedRegions: 0, claimRefs: 0 };
    notify(s);
    pushCmd(s, {
      undo: () => undos.forEach(([f, b]) => { f.set("owner", b.owner); f.set("claimants", b.claimants); }),
      redo: () => undos.forEach(([f, , a]) => { f.set("owner", a.owner); f.set("claimants", a.claimants); }),
    });
    return { affectedRegions: undos.length, ownedRegions, claimRefs };
  };

  const selectOwner = (s, ownerKey) => {
    const key = clean(ownerKey);
    if (!key) return [];
    return features(s).filter((f) => clean(f.get("owner")) === key).map((f) => f.getId());
  };

  const unionExtent = (feats) => {
    if (!feats.length) return null;
    let ext = feats[0].getGeometry().getExtent().slice();
    for (const f of feats.slice(1)) {
      const e = f.getGeometry().getExtent();
      ext = [Math.min(ext[0], e[0]), Math.min(ext[1], e[1]), Math.max(ext[2], e[2]), Math.max(ext[3], e[3])];
    }
    const [west, south] = toLonLat([ext[0], ext[1]]);
    const [east, north] = toLonLat([ext[2], ext[3]]);
    return [[west, south], [east, north]];
  };

  const interiorPoint = (geom) => {
    const type = geom.getType();
    if (type === "Polygon") {
      const c = geom.getInteriorPoint().getCoordinates();
      return [c[0], c[1]];
    }
    if (type === "MultiPolygon") {
      const pts = geom.getInteriorPoints().getCoordinates();
      return pts.length ? [pts[0][0], pts[0][1]] : null;
    }
    return null;
  };

  const featureList = (s) => s.doc.features || [];

  const regionsPart = (s) => {
    const colors = paintColors(s);
    const groupColors = Object.fromEntries(Object.entries(groupsLib.normalizeGroups(s.doc.groups)).map(([name, group]) => [name, group.color]));
    const byType = typesById(s);
    const ownerKeys = [];
    const ownerIndexOf = new Map();
    const ownerIndex = new Array(s.baked.length);
    const fills = new Array(s.baked.length);
    for (let i = 0; i < s.baked.length; i += 1) {
      const f = s.baked[i];
      if (!f) {
        ownerIndex[i] = -1;
        fills[i] = -1;
        continue;
      }
      const owner = f.get("owner") || null;
      if (owner) {
        if (!ownerIndexOf.has(owner)) {
          ownerIndexOf.set(owner, ownerKeys.length);
          ownerKeys.push(owner);
        }
        ownerIndex[i] = ownerIndexOf.get(owner);
      } else {
        ownerIndex[i] = -1;
      }
      const type = byType[f.get("typeId") || "land"];
      const ownerRgb = (name) => (Array.isArray(colors[name]) ? colors[name] : editorCodeToColor(name));
      const base = type?.overrideColor ? (Array.isArray(type.overrideColor) ? type.overrideColor : NEUTRAL) : owner ? ownerRgb(owner) : null;
      const group = f.get("group") || "";
      const groupRgb = group ? hexRgb(groupColors[group]) : null;
      if (!base && !groupRgb) {
        fills[i] = -1;
        continue;
      }
      const baseRgb = base || NEUTRAL;
      const alpha = owner ? (type?.opacity ?? 0.55) : (type?.unownedOpacity ?? 0.25);
      const rgb = groupRgb ? over(groupRgb, GROUP_TINT_ALPHA, baseRgb, alpha) : baseRgb;
      fills[i] = ((rgb[0] & 255) << 16) | ((rgb[1] & 255) << 8) | (rgb[2] & 255);
    }
    const ownerColors = ownerKeys.map((key) => {
      const rgb = Array.isArray(colors[key]) ? colors[key] : editorCodeToColor(key);
      return rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0))));
    });
    const names = {};
    for (const [id, name] of s.nameEdits) {
      const index = s.bakedIndex.get(id);
      if (index !== undefined) names[index] = name;
    }
    return { rev: s.regionRev, ownerIndex, owners: ownerKeys, ownerNames: ownerKeys.map((key) => String(s.doc.polities?.[key]?.name || key)), ownerColors, fills, names, count: features(s).length };
  };

  const docPart = (s) => {
    const colors = paintColors(s);
    const keys = new Set([...Object.keys(s.doc.polities || {}), ...listOwners(s)]);
    const polityColors = {};
    for (const key of keys) polityColors[key] = Array.isArray(colors[key]) ? colors[key].slice(0, 3) : editorCodeToColor(key);
    const flagFiles = {};
    for (const [key, value] of Object.entries(s.doc.flags || {})) flagFiles[key] = flagFileOf(value);
    return {
      name: s.doc.metadata?.name || "",
      author: s.doc.metadata?.author || "",
      metadata: {
        basemap: s.doc.metadata?.basemap || "ocean",
        projection: s.doc.metadata?.projection ?? null,
        customBackground: s.doc.metadata?.customBackground ? { kind: s.doc.metadata.customBackground.kind } : null,
        tiledBasemap: s.doc.metadata?.tiledBasemap ? { name: s.doc.metadata.tiledBasemap.name || "" } : null,
      },
      polities: s.doc.polities || {},
      colors: polityColors,
      colorOverrides: s.doc.colorOverrides || {},
      flags: s.doc.flags || {},
      flagFiles,
      tags: s.doc.tags || {},
      groups: groupsLib.normalizeGroups(s.doc.groups),
      rawGroups: s.doc.groups || {},
      puppets: s.doc.puppets || [],
      types: s.doc.types || [],
      polityCount: (() => {
        const all = new Set(Object.keys(s.doc.polities || {}));
        for (const row of listPolityUsage(s)) all.add(row.key);
        return all.size;
      })(),
      groupCount: new Set([...Object.keys(s.doc.groups || {}), ...Object.keys(listGroupUsage(s))]).size,
      counts: { regions: features(s).length, features: featureList(s).length, units: (s.doc.units || []).length, types: (s.doc.types || []).length },
      clipboardCount: clipboard?.regions?.features?.length ?? 0,
      militaryDefaults: s.initialMap?.militaryDefaults ?? null,
      freezingCount: freezingCountOf(s),
      styleRev: s.styleRev || 0,
    };
  };

  const featuresPart = (s) => featureList(s).map((f) => ({
    id: f.id,
    name: f.name || "",
    coord: Array.isArray(f.coord) ? f.coord : null,
    population: f.population ?? 0,
    tags: Array.isArray(f.tags) ? f.tags : [],
    tier: f.tier ?? null,
    kind: f.kind || "",
    owner: f.owner || null,
    country: f.country || "",
    status: f.status || "",
    note: f.note || "",
    symbol: f.symbol || "square",
    type: f.type || "Coordinate",
    populationByYear: f.populationByYear || null,
    isMap: engine.wsMapFeatures.isMapFeature(f),
  }));

  const warPart = (s) => ({
    terrainAreas: s.doc.terrainAreas || [],
    fortifications: s.doc.fortifications || [],
    climateZones: s.doc.climateZones || [],
    freezingRegions: s.doc.freezingRegions || [],
  });

  const freezingCountOf = (s) => {
    const typesById = Object.fromEntries((s.doc.types || []).map((type) => [type.id, type]));
    return (s.doc.freezingRegions || []).filter((rid) => {
      const f = s.source.getFeatureById(String(rid));
      return Boolean(f) && engine.wsRegionTypes.isWaterType(typesById[f.get("typeId")]);
    }).length;
  };

  const writeBakeFile = (s, fc) => {
    s.bakeSerial += 1;
    const file = path.join(workDir, `${s.id}-${s.bakeSerial}.geojson`);
    fs.writeFileSync(file, typeof fc === "string" ? fc : JSON.stringify(fc));
    if (s.bakeFile && s.bakeFile !== file) fs.rm(s.bakeFile, { force: true }, () => {});
    s.bakeFile = file;
    return file;
  };

  const rebake = (s) => {
    const feats = features(s);
    const fc = fmt.writeFeaturesObject(feats, WRITE);
    s.baked = feats.slice();
    s.bakedIndex = new Map(feats.map((f, index) => [String(f.getId()), index]));
    s.nameEdits.clear();
    s.bakedGeometryRev = s.geometryRev;
    return writeBakeFile(s, fc);
  };

  const delta = (s, parts = {}) => {
    const out = { session: s.id, status: status(s), history: { canUndo: s.undo.length > 0, canRedo: s.redo.length > 0 } };
    if (s.geometryRev !== s.bakedGeometryRev) {
      out.bake = { file: rebake(s) };
      parts.regions = true;
    }
    if (parts.regions || parts.all) out.regions = regionsPart(s);
    if (parts.doc || parts.all || parts.regions) out.doc = docPart(s);
    if (parts.features || parts.all) out.features = featuresPart(s);
    if (parts.units || parts.all) out.units = s.doc.units || [];
    if (parts.war || parts.all) out.war = warPart(s);
    return plain(out);
  };

  const buildDocumentFields = (s) => ({
    name: s.doc.metadata?.name,
    metadata: s.doc.metadata,
    types: s.doc.types,
    features: s.doc.features,
    colorOverrides: s.doc.colorOverrides || {},
    flags: s.doc.flags || {},
    tags: s.doc.tags || {},
    polities: s.doc.polities || {},
    units: s.doc.units || [],
    groups: s.doc.groups || {},
    puppets: s.doc.puppets || [],
    terrainAreas: s.doc.terrainAreas || [],
    fortifications: s.doc.fortifications || [],
    climateZones: s.doc.climateZones || [],
    freezingRegions: s.doc.freezingRegions || [],
    ownerSchema: s.doc.ownerSchema ?? engine.wsDocumentMigration.OWNER_SCHEMA,
  });

  const serializeRegions = (s) => fmt.writeFeaturesObject(features(s), WRITE);

  const buildPayload = (s, regions = null) => ({ ...buildDocumentFields(s), regions: regions || serializeRegions(s) });

  const serializeRegionChanges = (s) => {
    const feats = features(s);
    const writtenFeatures = (function* write() {
      for (const feature of feats) yield fmt.writeFeatureObject(feature, WRITE);
    })();
    const result = engine.wsRegionChanges.buildRegionChanges({ writtenFeatures, saved: s.savedRegionHashes });
    const commit = () => {
      s.savedRegionHashes.clear();
      if (result.marks) for (const [id, stamp] of result.marks) s.savedRegionHashes.set(id, stamp);
    };
    if (result.full) {
      return {
        full: result.features ? { type: "FeatureCollection", features: result.features } : fmt.writeFeaturesObject(feats, WRITE),
        changed: [],
        removed: [],
        count: feats.length,
        commit,
      };
    }
    return { full: null, changed: result.changed, removed: result.removed, count: result.count, commit };
  };

  const attemptSave = async (s) => {
    const id = s.docId;
    const edits = s.edits;
    if (id && edits === s.savedEdits) return true;
    try {
      s.saveStatus = "saving";
      pushStatus(s);
      const changes = serializeRegionChanges(s);
      const creating = !id;
      const payload = !changes || creating || changes.full
        ? buildPayload(s, changes?.full ?? null)
        : { ...buildDocumentFields(s), regionsDelta: { changed: changes.changed, count: changes.count, removed: changes.removed } };
      let saved = await engine.wsDocumentIO.saveDocument(id, payload);
      if (saved?.needsFullRegions) {
        console.warn("[editor] the store could not apply the map difference; writing the whole map:", saved.needsFullRegions);
        s.savedRegionHashes.clear();
        saved = await engine.wsDocumentIO.saveDocument(saved.id ?? id, buildPayload(s));
      }
      if (!id) s.docId = saved.id;
      changes?.commit?.();
      if (s.edits !== edits) {
        pushStatus(s);
        return false;
      }
      s.savedEdits = edits;
      s.retries = 0;
      s.saveError = "";
      s.saveStatus = "saved";
      pushStatus(s);
      return true;
    } catch (error) {
      console.warn("[editor] save failed:", error);
      s.saveError = error?.message || String(error);
      s.saveStatus = "error";
      pushStatus(s);
      const delay = engine.wsDocumentSaving.saveRetryDelay(s.retries);
      if (delay != null) {
        clearTimeout(s.retryTimer);
        s.retryTimer = setTimeout(() => {
          if (session !== s || s.saveStatus !== "error") return;
          s.retries += 1;
          void s.runSave();
        }, delay);
      }
      return false;
    }
  };

  const loadBasePalette = async () => {
    try {
      const response = await fetch("/assets/colors.json");
      return response.ok ? (await response.json()) || {} : {};
    } catch {
      return {};
    }
  };

  const buildSeedFor = async (scenario, world, { gameDate = "", warSettings } = {}) => {
    const asset = (key) => lib.downloadScenarioJsonAsset(scenario.id, key);
    const [regions, cities, colors, flags, tags, bgData, ownBasemapsData] = await Promise.all([
      asset("regionsGeojson"),
      asset("citiesGeojson"),
      asset("colors"),
      asset("flags"),
      asset("tags"),
      world.background?.kind === "image" || world.background?.kind === "vector" ? asset("backgroundData") : Promise.resolve(null),
      engine.assets.normalizeOwnBasemaps(world.ownBasemaps).length ? asset("ownBasemapsData").catch(() => null) : Promise.resolve(null),
    ]);
    const bgDesc = world.background;
    const background = bgDesc?.kind === "image" && bgData?.dataUrl
      ? { kind: "image", dataUrl: bgData.dataUrl, ...(bgDesc.bounds ? { bounds: bgDesc.bounds } : {}) }
      : bgDesc?.kind === "vector" && bgData?.geojson
        ? { kind: "vector", geojson: bgData.geojson }
        : bgDesc?.kind === "plain"
          ? { kind: "plain" }
          : null;
    const tiledBasemap = bgDesc?.kind === "vector" && (bgDesc.tiled?.id || bgDesc.tiled?.hash)
      ? { ...bgDesc.tiled, ...(Array.isArray(bgDesc.fillOpacity) ? { fillOpacity: bgDesc.fillOpacity } : {}) }
      : null;
    const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
    return {
      tiledBasemap,
      name: scenario.name || "",
      author: world.author || "",
      ownershipOverrides: world.regionOwnershipOverrides || {},
      claimOverrides: {
        claimants: isRecord(world.regionClaimants) ? world.regionClaimants : {},
        settled: Array.isArray(world.settledRegionClaims) ? world.settledRegionClaims : [],
        groupAreas: isRecord(world.groupAreas) ? world.groupAreas : {},
      },
      groups: isRecord(world.groups) ? world.groups : {},
      regions: regions && Array.isArray(regions.features) && regions.features.length ? regions : null,
      cities: cities && Array.isArray(cities.features) ? cities : null,
      colors: isRecord(colors) ? colors : null,
      flags: isRecord(flags) ? flags : null,
      tags: isRecord(tags) ? tags : null,
      polities: isRecord(world.polityOverrides) ? world.polityOverrides : {},
      background,
      startingMapName: typeof bgDesc?.name === "string" ? bgDesc.name : "",
      projection: world.projection ?? null,
      basemap: world.basemap || null,
      allowedBasemaps: Array.isArray(world.allowedBasemaps) ? world.allowedBasemaps : null,
      ownBasemaps: engine.wsOwnBasemaps.ownBasemapsFromGame(world.ownBasemaps, ownBasemapsData),
      customCities: Boolean(world.customCities),
      units: Array.isArray(world.units) ? world.units : [],
      markers: Array.isArray(world.markers) ? world.markers : [],
      puppets: Array.isArray(world.puppets) ? world.puppets : [],
      regionTypes: Array.isArray(world.regionTypes) && world.regionTypes.length ? world.regionTypes : null,
      militaryDefaults: engine.wsMilitaryForm.militaryDefaultsFor(warSettings === undefined ? world.warSettings : warSettings, gameDate, { rules: world.simulationRules }),
      ...engine.wsWarGeography.warGeographyOf(world),
    };
  };

  const hydrate = async (s, initialMap) => {
    s.polityAuthoringOps = [];
    const base = mapDoc.createDocument({ name: initialMap.name || "Scenario Map", kind: "import-world" });
    base.metadata.author = initialMap.author || "";
    if (initialMap.basemap) base.metadata.basemap = initialMap.basemap;
    if (Array.isArray(initialMap.allowedBasemaps)) base.metadata.allowedBasemaps = initialMap.allowedBasemaps;
    if (Array.isArray(initialMap.ownBasemaps) && initialMap.ownBasemaps.length) base.metadata.ownBasemaps = initialMap.ownBasemaps;
    if (initialMap.background) base.metadata.customBackground = initialMap.background;
    if (initialMap.tiledBasemap) base.metadata.tiledBasemap = initialMap.tiledBasemap;
    if (initialMap.startingMapName) base.metadata.startingMapName = initialMap.startingMapName;
    if (initialMap.projection) base.metadata.projection = initialMap.projection;
    if (initialMap.polities && typeof initialMap.polities === "object") base.polities = structuredClone(initialMap.polities);
    base.groups = groupsLib.normalizeGroups(initialMap.groups);
    base.puppets = Array.isArray(initialMap.puppets) ? structuredClone(initialMap.puppets) : [];
    Object.assign(base, engine.wsWarGeography.warGeographyOf(initialMap));
    const regionTypes = typesLib.normalizeRegionTypes(initialMap.regionTypes);
    if (regionTypes.length) base.types = regionTypes;
    if (initialMap.flags) base.flags = normalizePolityKeyedMap(initialMap.flags, base.polities);
    if (initialMap.tags) base.tags = normalizePolityKeyedMap(initialMap.tags, base.polities);
    if (initialMap.customCities) base.metadata.citiesAuthored = true;
    base.features = (initialMap.cities?.features || [])
      .map((f) => engine.wsExportPreset.gameCityToFeature(f, mapDoc.newId("feat")))
      .filter(Boolean);
    base.features.push(...(Array.isArray(initialMap.markers) ? initialMap.markers : [])
      .map((marker) => engine.wsMapFeatures.markerToFeature(marker, mapDoc.newId("feat")))
      .filter(Boolean));
    base.units = (Array.isArray(initialMap.units) ? initialMap.units : [])
      .filter((u) => Number.isFinite(Number(u?.lng)) && Number.isFinite(Number(u?.lat)))
      .map((u) => ({
        id: String(u.id || mapDoc.newId("unit")),
        name: String(u.name || "Unit"),
        type: String(u.type || "infantry"),
        ownerCode: String(u.ownerCode || ""),
        lng: Number(u.lng),
        lat: Number(u.lat),
        strength: Number.isFinite(Number(u.strength)) ? Number(u.strength) : 100,
        composition: String(u.composition || ""),
        note: String(u.note || ""),
      }));
    s.doc = base;
    let palette = {};
    if (initialMap.colors) palette = { ...palette, ...normalizePolityKeyedMap(initialMap.colors, initialMap.polities) };
    if (initialMap.polities) {
      const polityColors = {};
      for (const [key, record] of Object.entries(initialMap.polities)) {
        const rgb = hexToRgb(record?.color);
        if (rgb) polityColors[key] = rgb;
      }
      palette = { ...palette, ...polityColors };
    }
    s.palette = { ...(await loadBasePalette()), ...palette };
    let feats = [];
    let fileText = null;
    if (initialMap.regions) {
      feats = fmt.readFeatures(initialMap.regions, READ);
      const stampClaims = engine.wsClaims.claimStamper(initialMap.claimOverrides || null);
      const overrides = initialMap.ownershipOverrides || {};
      for (const f of feats) {
        const p = f.getProperties();
        if (f.getId() == null && p.id != null) f.setId(String(p.id));
        if (f.get("typeId") == null) f.set("typeId", "land");
        const id = f.getId();
        if (overrides && id != null && Object.prototype.hasOwnProperty.call(overrides, id)) f.set("owner", overrides[id] || null);
        stampClaims(f);
      }
      fileText = JSON.stringify(initialMap.regions);
    } else {
      feats = await engine.wsRegionImport.loadSeedFeatures();
      const stampClaims = engine.wsClaims.claimStamper(initialMap.claimOverrides || null);
      const overrides = initialMap.ownershipOverrides || {};
      for (const f of feats) {
        const id = f.getId();
        if (id != null && overrides[id] !== undefined) f.set("owner", overrides[id] || null);
        stampClaims(f);
      }
    }
    s.source.clear();
    s.savedRegionHashes.clear();
    if (feats.length) s.source.addFeatures(feats);
    s.baked = feats.slice();
    s.bakedIndex = new Map(feats.map((f, index) => [String(f.getId()), index]));
    s.nameEdits.clear();
    s.undo = [];
    s.redo = [];
    s.regionRev += 1;
    s.bakedGeometryRev = s.geometryRev;
    writeBakeFile(s, fileText ?? fmt.writeFeaturesObject(feats, WRITE));
    s.docId = null;
    s.savedEdits = s.edits;
    s.retries = 0;
    s.saveError = "";
    s.saveStatus = "saved";
    s.scenarioDirty = false;
    s.hydrated = true;
  };

  const newSession = (scenario) => {
    const s = {
      id: crypto.randomUUID(),
      scenario: { id: clean(scenario.id), name: clean(scenario.name) },
      doc: mapDoc.createDocument(),
      palette: {},
      source: new VectorSource({ wrapX: false }),
      baked: [],
      bakedIndex: new Map(),
      nameEdits: new Map(),
      bakeFile: "",
      bakeSerial: 0,
      regionRev: 0,
      geometryRev: 0,
      bakedGeometryRev: 0,
      undo: [],
      redo: [],
      polityAuthoringOps: [],
      scenarioDirty: false,
      hydrated: false,
      saveStatus: "saved",
      saveError: "",
      edits: 0,
      savedEdits: 0,
      retries: 0,
      docId: null,
      savedRegionHashes: new Map(),
      initialMap: null,
      action: "",
      cleanupStop: false,
      autosaveTimer: null,
      retryTimer: null,
    };
    s.runSave = engine.wsDocumentSaving.createSaveRunner(() => attemptSave(s));
    return s;
  };

  const closeSession = (s) => {
    clearTimeout(s.autosaveTimer);
    clearTimeout(s.retryTimer);
    if (s.bakeFile) fs.rm(s.bakeFile, { force: true }, () => {});
    if (session === s) session = null;
  };

  const removalsForScenario = (operations) => {
    const removals = [];
    operations.forEach((operation, index) => {
      if (operation?.op !== "remove") return;
      let key = operation.key;
      for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
        const previous = operations[earlier];
        if (previous?.op === "rename" && rename.samePolityName(previous.to, key)) key = previous.from;
      }
      removals.push({ op: "remove", key });
    });
    return removals;
  };

  const expandExtent = (extent, pad) => [extent[0] - pad, extent[1] - pad, extent[2] + pad, extent[3] + pad];
  const pointSegmentDistance = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const wx = p[0] - a[0];
    const wy = p[1] - a[1];
    const vv = vx * vx + vy * vy;
    const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
    const x = a[0] + t * vx;
    const y = a[1] + t * vy;
    return Math.hypot(p[0] - x, p[1] - y);
  };
  const geometryRings = (geom) => {
    if (!geom) return [];
    const type = geom.getType?.();
    const coords = geom.getCoordinates?.() || [];
    if (type === "Polygon") return coords;
    if (type === "MultiPolygon") return coords.flat();
    return [];
  };
  const buildBoundaryIndex = (regionGeom) => {
    const type = regionGeom?.getType?.();
    const ends = type === "Polygon" ? regionGeom.getEnds() : type === "MultiPolygon" ? regionGeom.getEndss().flat() : [];
    return sweep.indexBoundary(ends.length ? regionGeom.getFlatCoordinates() : [], ends, regionGeom?.getStride?.() || 2);
  };
  const boundaryTouchScore = (gapGeom, boundaryIndex, epsilon) => {
    const gapRing = geometryRings(gapGeom)[0] || [];
    if (!gapRing.length || !boundaryIndex || !boundaryIndex.size) return 0;
    const step = Math.max(1, Math.floor(gapRing.length / 80));
    let score = 0;
    for (let i = 0; i < gapRing.length; i += step) {
      const p = gapRing[i];
      const near = boundaryIndex.near(p[0], p[1], epsilon);
      for (const [a, b] of near) {
        if (pointSegmentDistance(p, a, b) <= epsilon) {
          score += 1;
          break;
        }
      }
    }
    return score;
  };

  const topologyTools = (s) => {
    const regionSource = s.source;
    const topologyContext = (feats) => {
      const selectedSet = new Set(feats);
      const featureOrder = new Map(feats.map((feature, index) => [feature, index]));
      const areaCache = new Map();
      const areaOf = (feature) => {
        if (!feature) return -1;
        if (!areaCache.has(feature)) areaCache.set(feature, geo.planarGeometryArea(feature.getGeometry()));
        return areaCache.get(feature);
      };
      const boundaryIndexes = new Map();
      const boundaryIndexOf = (feature) => {
        let index = boundaryIndexes.get(feature);
        if (!index) {
          index = buildBoundaryIndex(feature.getGeometry());
          boundaryIndexes.set(feature, index);
        }
        return index;
      };
      let serial = 0;
      return { selectedSet, featureOrder, areaOf, boundaryIndexOf, nextId: () => ++serial };
    };
    const assignGapTargets = (holes, width, { selectedSet, featureOrder, areaOf, boundaryIndexOf, nextId }, { maxTargetVertices = Infinity, onLeftAlone } = {}) => {
      const items = [];
      const epsilon = Math.max(4, width * 0.08);
      const rimRegionsOf = (row) => {
        const ring = geometryRings(row.geom)[0] || [];
        let holders = 0;
        for (const feature of regionSource.getFeaturesInExtent(row.geom.getExtent())) {
          if (!selectedSet.has(feature)) continue;
          const index = boundaryIndexOf(feature);
          if (sweep.holdsRim(ring, ([x, y], reach) => index.near(x, y, reach))) holders += 1;
          if (holders > 1) break;
        }
        return holders;
      };
      for (const row of sweep.cracksAmong(holes, rimRegionsOf, { maxWidth: width, onLeftAlone })) {
        const ext = expandExtent(row.geom.getExtent(), Math.max(4, width * 1.5));
        const neighbors = regionSource
          .getFeaturesInExtent(ext)
          .filter((feature) => selectedSet.has(feature) && sweep.vertexCountOf(feature.getGeometry()) <= maxTargetVertices)
          .sort((a, b) => featureOrder.get(a) - featureOrder.get(b));
        let target = null;
        let bestScore = -1;
        for (const f of neighbors) {
          const score = boundaryTouchScore(row.geom, boundaryIndexOf(f), epsilon);
          if (score > bestScore || (score === bestScore && areaOf(f) > areaOf(target))) {
            target = f;
            bestScore = score;
          }
        }
        if (!target || bestScore <= 0) continue;
        items.push({ id: `gap-${nextId()}`, kind: "gap", geom: row.geom.clone(), area: row.area, width: row.width, targetId: target.getId() });
      }
      return items;
    };
    const findNarrowOverlaps = (feats, width, { featureOrder, areaOf, nextId }, { from = 0, to = feats.length, minWidth = 0, maxPairVertices = Infinity, onSkip, onLeftAlone, weld = null, onRefused } = {}) => {
      const items = [];
      for (let i = from; i < to; i += 1) {
        const a = feats[i];
        const aExtent = a.getGeometry().getExtent();
        const nearby = regionSource
          .getFeaturesInExtent(aExtent)
          .map((feature) => ({ feature, index: featureOrder.get(feature) }))
          .filter((row) => Number.isInteger(row.index) && row.index > i)
          .sort((x, y) => x.index - y.index);
        for (const { feature: b } of nearby) {
          if (sweep.vertexCountOf(a.getGeometry()) + sweep.vertexCountOf(b.getGeometry()) > maxPairVertices) {
            onSkip?.();
            continue;
          }
          let pieces = [];
          try {
            pieces = geo.overlapGeoms(a.getGeometry(), b.getGeometry(), { maxWidth: width, minWidth });
          } catch (e) {
            try {
              if (!weld) throw e;
              pieces = geo.overlapGeoms(weld(a.getGeometry()), weld(b.getGeometry()), { maxWidth: width, minWidth });
            } catch (again) {
              console.warn("[editor] topology overlap analysis failed:", again);
              onRefused?.(a, b);
              continue;
            }
          }
          if (!pieces.length) continue;
          const aArea = areaOf(a);
          const bArea = areaOf(b);
          if (!sweep.isSliver(pieces[0].shared, Math.min(aArea, bArea))) {
            onLeftAlone?.(a, b);
            continue;
          }
          const winner = aArea >= bArea ? a : b;
          const loser = winner === a ? b : a;
          for (const row of pieces) {
            items.push({ id: `overlap-${nextId()}`, kind: "overlap", geom: row.geom.clone(), area: row.area, width: row.width, winnerId: winner.getId(), loserId: loser.getId() });
          }
        }
      }
      return items;
    };
    const beginTopologyEdit = () => {
      const before = new Map();
      const remember = (f) => {
        if (!f || before.has(f.getId())) return;
        before.set(f.getId(), { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") });
      };
      return { before, remember };
    };
    const trimOverlap = (item, remember) => {
      const winner = regionSource.getFeatureById(item.winnerId);
      const loser = regionSource.getFeatureById(item.loserId);
      if (!winner || !loser) return false;
      remember(loser);
      let after;
      try {
        after = geo.subtractFrom(loser.getGeometry(), winner.getGeometry());
      } catch (e) {
        console.warn("[editor] topology overlap repair failed:", e);
        return false;
      }
      if (!after) return false;
      loser.setGeometry(after);
      loser.set("edited", true);
      return true;
    };
    const fillGap = (item, remember) => {
      const target = regionSource.getFeatureById(item.targetId);
      if (!target) return false;
      remember(target);
      try {
        target.setGeometry(geo.unionGeoms([target.getGeometry(), item.geom]));
        target.set("edited", true);
        return true;
      } catch (e) {
        console.warn("[editor] topology gap repair failed:", e);
        return false;
      }
    };
    const fillGaps = (targetId, items, remember, onFailed) => {
      const target = regionSource.getFeatureById(targetId);
      const oneByOne = () => items.reduce((filled, item) => {
        if (target && fillGap(item, remember)) return filled + 1;
        onFailed?.(item);
        return filled;
      }, 0);
      if (!target || items.length < 2) return oneByOne();
      remember(target);
      try {
        target.setGeometry(geo.unionGeoms([target.getGeometry(), ...items.map((item) => item.geom)]));
        target.set("edited", true);
        return items.length;
      } catch (e) {
        console.warn("[editor] topology gap repair failed for a batch; filling one by one:", e);
        return oneByOne();
      }
    };
    const finishTopologyEdit = ({ before }) => {
      if (!before.size) return 0;
      const after = new Map();
      for (const [id] of before.entries()) {
        const f = regionSource.getFeatureById(id);
        if (f) after.set(id, { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") });
      }
      const restore = (snapshot) => {
        for (const row of snapshot.values()) {
          row.feature.setGeometry(row.geometry.clone());
          if (row.edited === undefined) row.feature.unset("edited", true);
          else row.feature.set("edited", row.edited);
        }
        s.geometryRev += 1;
      };
      pushCmd(s, { undo: () => restore(before), redo: () => restore(after) });
      notify(s, { geometry: true });
      return before.size;
    };
    const welderFor = (regions) => {
      let tables = null;
      let ofRegion = null;
      const ofUnion = new WeakMap();
      return (geom) => {
        if (!tables) {
          const place = new Map(regions.map((feature, index) => [feature, index]));
          const geoms = regions.map((feature) => feature.getGeometry());
          const welded = geo.weldRegions(geoms, (index, box) => regionSource.getFeaturesInExtent(box).map((feature) => place.get(feature)).filter((at) => at !== undefined));
          tables = welded.tables;
          ofRegion = new Map(geoms.map((own, index) => [own, welded.geoms[index]]));
        }
        const region = ofRegion.get(geom);
        if (region) return region;
        let out = ofUnion.get(geom);
        if (!out) {
          out = geo.weldedGeometry(geom, tables);
          ofUnion.set(geom, out);
        }
        return out;
      };
    };
    const repairTopologyEverywhere = async ({ maxWidth = sweep.BORDER_CLEANUP.maxWidth, onProgress, stopRequested } = {}) => {
      const BORDER_CLEANUP = sweep.BORDER_CLEANUP;
      const width = Math.max(1, Number(maxWidth) || BORDER_CLEANUP.maxWidth);
      const floor = Math.min(width, BORDER_CLEANUP.minWidth);
      const feats = regionSource.getFeatures().filter((f) => f.getGeometry?.());
      const regionCount = feats.length;
      const startedAt = Date.now();
      const elapsed = () => Date.now() - startedAt;
      let stopped = "";
      let error = "";
      const shouldStop = () => {
        if (!stopped) {
          if (stopRequested?.()) stopped = "user";
          else if (elapsed() > BORDER_CLEANUP.maxMillis) stopped = "time";
        }
        return Boolean(stopped);
      };
      const progress = {
        phase: "gaps",
        pass: 1,
        maxPasses: BORDER_CLEANUP.maxPasses,
        maxWidth: width,
        regionCount,
        passRegions: regionCount,
        chunkIndex: 0,
        chunkCount: 0,
        gapsFound: 0,
        regionsChecked: 0,
        overlapsFound: 0,
        repairsDone: 0,
        repairCount: 0,
        gapsFilled: 0,
        overlapsTrimmed: 0,
        startedAt,
        elapsedMs: 0,
      };
      const report = (patch) => {
        Object.assign(progress, patch, { elapsedMs: elapsed() });
        onProgress?.({ ...progress });
      };
      const totals = { gaps: 0, overlaps: 0, gapsFound: 0, overlapsFound: 0 };
      let passes = 0;
      let parts = 1;
      let skippedPairs = 0;
      let repairsLeft = 0;
      const leftAlone = sweep.leftAloneTally();
      let welded = false;
      let partsApart = 0;
      const pairsFailed = new Set();
      const repairsFailed = new Set();
      const repairKey = (item) => `${item.kind}:${item.geom.getExtent().map((value) => Math.round(value)).join(",")}`;
      const outcome = (affectedRegions) => ({
        changed: affectedRegions > 0,
        gaps: totals.gaps,
        overlaps: totals.overlaps,
        affectedRegions,
        regionCount,
        maxWidth: width,
        gapsFound: totals.gapsFound,
        overlapsFound: totals.overlapsFound,
        passes,
        parts,
        skippedPairs,
        ...leftAlone.counts(),
        welded,
        partsApart,
        pairsFailed: pairsFailed.size,
        repairsFailed: repairsFailed.size,
        stopped,
        error,
        elapsedMs: elapsed(),
        repairsLeft,
      });
      if (regionCount < 2) {
        report({ phase: "done" });
        return outcome(0);
      }
      const edit = beginTopologyEdit();
      let hotspots = null;
      let changedLast = new Set();
      try {
        while (passes < BORDER_CLEANUP.maxPasses && !shouldStop()) {
          passes += 1;
          const local = hotspots !== null;
          let passFeats = feats;
          let walk = regionCount;
          if (local) {
            const around = new Set();
            for (const spot of hotspots) for (const f of regionSource.getFeaturesInExtent(spot)) around.add(f);
            const changed = feats.filter((f) => changedLast.has(f));
            const others = feats.filter((f) => around.has(f) && !changedLast.has(f));
            passFeats = [...changed, ...others];
            walk = changed.length;
          }
          report({ pass: passes, phase: "gaps", passRegions: passFeats.length, chunkIndex: 0, chunkCount: 0, gapsFound: 0, regionsChecked: 0, overlapsFound: 0, repairsDone: 0, repairCount: 0 });
          const context = topologyContext(passFeats);
          const weld = welderFor(passFeats);
          let passExtent = regionSource.getExtent();
          if (local && passFeats.length) {
            passExtent = passFeats[0].getGeometry().getExtent().slice();
            for (const f of passFeats) {
              const e = f.getGeometry().getExtent();
              passExtent = [Math.min(passExtent[0], e[0]), Math.min(passExtent[1], e[1]), Math.max(passExtent[2], e[2]), Math.max(passExtent[3], e[3])];
            }
          }
          const search = passFeats.length < 2 ? { holes: [], parts: 1, stopped: false } : await sweep.findEnclosedGaps(passFeats, {
            plan: sweep.planTopologyChunks(passExtent, passFeats.length),
            geometryOf: (f) => f.getGeometry(),
            union: geo.unionAllGeoms,
            gapsOf: geo.enclosedGapsOfUnion,
            isCovered: (point) => regionSource.getFeaturesAtCoordinate(point).length > 0,
            maxWidth: width,
            minWidth: floor,
            partial: local,
            shouldStop,
            onChunks: (chunkCount) => report({ chunkCount }),
            onChunk: (chunkIndex) => report({ chunkIndex }),
            weld,
            welded,
            onRefused: (e) => console.warn("[editor] border cleanup: polygon-clipping refused a union:", e),
          });
          parts = Math.max(parts, search.parts);
          welded = welded || Boolean(search.welded);
          partsApart = Math.max(partsApart, Number(search.apart) || 0);
          const holes = local ? search.holes.filter((hole) => sweep.touchesHotspot(hole.geom.getExtent(), hotspots)) : search.holes;
          const gaps = assignGapTargets(holes, width, context, { maxTargetVertices: BORDER_CLEANUP.maxUnionVertices, onLeftAlone: leftAlone.hole });
          report({ gapsFound: gaps.length });
          await sweep.yieldToBrowser();
          const overlapsFound = [];
          let skippedThisPass = 0;
          report({ phase: "overlaps", regionsChecked: 0 });
          for (let from = 0; from < walk && !shouldStop(); from += BORDER_CLEANUP.overlapBatch) {
            const to = Math.min(walk, from + BORDER_CLEANUP.overlapBatch);
            overlapsFound.push(...findNarrowOverlaps(passFeats, width, context, {
              from,
              to,
              minWidth: floor,
              maxPairVertices: BORDER_CLEANUP.maxUnionVertices,
              onSkip: () => { skippedThisPass += 1; },
              onLeftAlone: (a, b) => leftAlone.pair(a.getId(), b.getId()),
              weld,
              onRefused: (a, b) => pairsFailed.add([a.getId(), b.getId()].sort().join("\n")),
            }));
            report({ regionsChecked: to, overlapsFound: overlapsFound.length });
            await sweep.yieldToBrowser();
          }
          skippedPairs = Math.max(skippedPairs, skippedThisPass);
          totals.gapsFound += gaps.length;
          totals.overlapsFound += overlapsFound.length;
          const repairCount = overlapsFound.length + gaps.length;
          report({ phase: "apply", repairCount, repairsDone: 0 });
          if (!repairCount) break;
          await sweep.yieldToBrowser();
          const overApplyBudget = () => elapsed() > BORDER_CLEANUP.maxApplyMillis;
          const applied = [];
          const changed = new Set();
          let gapsFilled = 0;
          let overlapsTrimmed = 0;
          let attempted = 0;
          const notFailed = (item) => {
            if (repairsFailed.size) repairsFailed.delete(repairKey(item));
          };
          const failed = (item) => repairsFailed.add(repairKey(item));
          const byPair = new Map();
          for (const item of overlapsFound) {
            const pair = `${item.winnerId}\n${item.loserId}`;
            if (!byPair.has(pair)) byPair.set(pair, []);
            byPair.get(pair).push(item);
          }
          for (const items of byPair.values()) {
            if (overApplyBudget()) break;
            attempted += items.length;
            const [{ winnerId, loserId }] = items;
            if (trimOverlap(items[0], edit.remember)) {
              overlapsTrimmed += items.length;
              applied.push(...items);
              changed.add(regionSource.getFeatureById(loserId));
              leftAlone.trimmed(winnerId, loserId);
              items.forEach(notFailed);
            } else {
              items.forEach(failed);
            }
          }
          const byTarget = new Map();
          for (const item of gaps) {
            if (!byTarget.has(item.targetId)) byTarget.set(item.targetId, []);
            byTarget.get(item.targetId).push(item);
          }
          for (const [targetId, items] of byTarget) {
            if (overApplyBudget()) break;
            attempted += items.length;
            items.forEach(notFailed);
            const filled = fillGaps(targetId, items, edit.remember, failed);
            if (filled) {
              gapsFilled += filled;
              applied.push(...items);
              changed.add(regionSource.getFeatureById(targetId));
            }
          }
          if (attempted < repairCount) {
            repairsLeft += repairCount - attempted;
            if (!stopped) stopped = "time";
          }
          totals.gaps += gapsFilled;
          totals.overlaps += overlapsTrimmed;
          report({ repairsDone: attempted, gapsFilled: totals.gaps, overlapsTrimmed: totals.overlaps });
          await sweep.yieldToBrowser();
          if (!gapsFilled && !overlapsTrimmed) break;
          hotspots = sweep.hotspotsOf(applied, width * BORDER_CLEANUP.hotspotPad);
          changedLast = changed;
        }
      } catch (e) {
        console.warn("[editor] border cleanup stopped early; keeping the repairs made so far:", e);
        stopped = "error";
        error = e?.message || String(e);
      }
      const affectedRegions = finishTopologyEdit(edit);
      report({ phase: "done" });
      return outcome(affectedRegions);
    };
    const analyzeTopology = (ids, { maxWidth = sweep.BORDER_CLEANUP.maxWidth } = {}) => {
      const width = Math.max(1, Number(maxWidth) || sweep.BORDER_CLEANUP.maxWidth);
      const feats = (ids || []).map((rid) => regionSource.getFeatureById(rid)).filter(Boolean);
      if (feats.length < 2) return [];
      const context = topologyContext(feats);
      const gaps = assignGapTargets(geo.enclosedGapGeoms(feats.map((f) => f.getGeometry()), { maxWidth: width }), width, context);
      const overlapsFound = findNarrowOverlaps(feats, width, context);
      return [...gaps, ...overlapsFound];
    };
    return { repairTopologyEverywhere, analyzeTopology };
  };

  const cleanupEvent = (s, state) => {
    if (session !== s) return;
    const text = sweep.describeCleanupProgress(state);
    emit("workshop.cleanup", { session: s.id, state: plain(state), fraction: text.fraction, headline: text.headline, detail: text.detail, leftAlone: text.leftAlone || [] });
  };

  const cleanBorders = async (s, { exporting = false, mode = "deep" } = {}) => {
    const maxWidth = sweep.cleanupWidthOf(mode);
    let cleanup = null;
    let cleanupError = "";
    s.cleanupStop = false;
    let current = { phase: "gaps", maxWidth, regionCount: 0, chunkIndex: 0, chunkCount: 0, startedAt: Date.now() };
    cleanupEvent(s, current);
    await sweep.yieldToBrowser();
    try {
      cleanup = (await topologyTools(s).repairTopologyEverywhere({
        maxWidth,
        onProgress: (state) => {
          current = state;
          cleanupEvent(s, state);
        },
        stopRequested: () => s.cleanupStop,
      })) ?? null;
    } catch (e) {
      console.warn("[editor] border cleanup before saving failed; saving the map as it is:", e);
      cleanupError = e?.message || String(e);
    }
    current = { ...(current || {}), phase: "save", result: cleanup, error: cleanupError, exporting };
    cleanupEvent(s, current);
    await sweep.yieldToBrowser();
    return [sweep.describeCleanupResult(cleanup, cleanupError), ...sweep.describeCleanupLeftAlone(cleanup)].filter(Boolean);
  };

  const writeMapToScenario = async (scenarioId, seed, renames) => {
    const details = await lib.loadScenarioDetails(scenarioId);
    const currentWorld = details?.data?.world ?? {};
    const { world: reconciledWorld, game: currentGame } = engine.wsPlayerCountry.scenarioAfterWorkshopRenames(
      rename.reconcileMapPolityAuthoringOps(currentWorld, seed.polityAuthoringOps),
      details?.data?.game ?? {},
      renames,
    );
    const seedRegionCount = Array.isArray(seed.regions?.features) ? seed.regions.features.length : 0;
    const hadTerritory = Object.keys(currentWorld.regionOwnershipOverrides ?? {}).length > 0;
    if (seedRegionCount === 0 && hadTerritory) {
      throw new Error("The map in the editor is empty while this scenario has territory — its map had not finished loading. Wait for it to appear, then save again.");
    }
    const scenarioCountry = engine.wsPlayerCountry.playerCountryAfterSave(currentGame.country, seed);
    const savedScenarioDetails = await lib.saveScenario(scenarioId, {
      world: {
        ...reconciledWorld,
        regionOwnershipOverrides: seed.world?.regionOwnershipOverrides ?? {},
        polityOverrides: seed.world?.polityOverrides ?? {},
        ...(seed.world?.regionClaimants
          ? { regionClaimants: seed.world.regionClaimants, settledRegionClaims: seed.world.settledRegionClaims ?? [] }
          : {}),
        ownerSchema: seed.world?.ownerSchema ?? currentWorld.ownerSchema,
        ownerCodes: [...new Set(Object.values(seed.world?.regionOwnershipOverrides ?? {}))].sort(),
        customRegions: true,
        customCities: seed.world?.customCities ?? false,
        author: seed.world?.author ?? "",
        mapCredit: seed.world?.mapCredit ?? "",
        background: seed.world?.background ?? null,
        ...(seed.world?.projection ? { projection: seed.world.projection } : {}),
        basemap: seed.world?.basemap ?? null,
        allowedBasemaps: seed.world?.allowedBasemaps ?? null,
        ownBasemaps: seed.world?.ownBasemaps ?? null,
        units: seed.world?.units ?? [],
        ...(seed.world?.groups ? { groups: seed.world.groups, groupAreas: seed.world.groupAreas ?? {} } : {}),
        ...(Array.isArray(seed.world?.markers) ? { markers: seed.world.markers } : {}),
        ...(Array.isArray(seed.world?.puppets) ? { puppets: seed.world.puppets } : {}),
        ...(Array.isArray(seed.world?.regionTypes) ? { regionTypes: seed.world.regionTypes } : {}),
        ...engine.wsWarGeography.warGeographyWorldPatch(seed.world),
      },
      game: {
        ...currentGame,
        country: scenarioCountry,
        gameDate: currentGame.gameDate || currentGame.startDate || seed.game?.gameDate || seed.game?.startDate || "2016-01-01",
        startDate: currentGame.startDate || currentGame.gameDate || seed.game?.startDate || seed.game?.gameDate || "2016-01-01",
      },
    }, { refresh: false });
    const json = (value) => new Blob([JSON.stringify(value)], { type: "application/json" });
    await lib.uploadScenarioAsset(scenarioId, "colors", json(seed.colors ?? {}), { refresh: false });
    if (seed.flags) await lib.uploadScenarioAsset(scenarioId, "flags", json(seed.flags), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "flags", { refresh: false });
    if (seed.tags) await lib.uploadScenarioAsset(scenarioId, "tags", json(seed.tags), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "tags", { refresh: false });
    await lib.uploadScenarioAsset(scenarioId, "regionsGeojson", json(seed.regions ?? { type: "FeatureCollection", features: [] }), { refresh: false });
    await lib.uploadScenarioAsset(scenarioId, "citiesGeojson", json(seed.cities ?? { type: "FeatureCollection", features: [] }), { refresh: false });
    if (seed.backgroundData) await lib.uploadScenarioAsset(scenarioId, "backgroundData", json(seed.backgroundData), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "backgroundData", { refresh: false });
    if (seed.ownBasemapsData) await lib.uploadScenarioAsset(scenarioId, "ownBasemapsData", json(seed.ownBasemapsData), { refresh: false });
    else await lib.clearScenarioAsset(scenarioId, "ownBasemapsData", { refresh: false });
    return { scenarioCountry, details: savedScenarioDetails };
  };

  const featureById = (s, id) => featureList(s).find((f) => f.id === id) || null;

  const persistClipboard = () => {
    try {
      if (clipboard) fs.writeFileSync(clipboardFile, JSON.stringify(clipboard));
      else fs.rmSync(clipboardFile, { force: true });
    } catch (error) {
      console.warn("[editor] region clipboard not persisted:", error);
    }
  };

  const exportRegions = (s, ids) => {
    const feats = (ids || []).map((id) => s.source.getFeatureById(id)).filter(Boolean);
    const fc = fmt.writeFeaturesObject(feats, WRITE);
    for (const f of fc.features || []) {
      if (f.id != null) f.properties = { ...(f.properties || {}), id: String(f.id) };
    }
    return fc;
  };

  const pasteRegions = (s, fc, { simplify = false } = {}) => {
    const incoming = fc && Array.isArray(fc.features) ? fmt.readFeatures(fc, READ) : [];
    const pasted = incoming.filter((f) => /Polygon$/.test(f.getGeometry()?.getType() || ""));
    if (!pasted.length) return { added: [], trimmed: 0, removed: 0 };
    const simplifyLib = engine.wsSimplify;
    if (simplify) {
      const meters = simplifyLib.detailToleranceMeters(features(s).map((f) => f.getGeometry()));
      const lighter = simplifyLib.simplifyShared(pasted.map((f) => f.getGeometry()), { toleranceAt: simplifyLib.toleranceAtLatitude(meters) });
      pasted.forEach((f, at) => f.setGeometry(lighter[at]));
    }
    const hairline = (geom) => {
      const polys = geom.getType() === "Polygon" ? [geom.getCoordinates()] : geom.getCoordinates();
      let perimeter = 0;
      for (const poly of polys) {
        for (const ring of poly) {
          for (let i = 1; i < ring.length; i += 1) perimeter += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
        }
      }
      return perimeter === 0 || (2 * geom.getArea()) / perimeter < 2;
    };
    const carved = new Map();
    for (const f of pasted) {
      const cutter = f.getGeometry();
      const candidates = [];
      s.source.forEachFeatureIntersectingExtent(cutter.getExtent(), (other) => {
        candidates.push(other);
      });
      for (const other of candidates) {
        const g = other.getGeometry();
        if (!g || !geo.overlaps(g, cutter)) continue;
        const entry = carved.get(other) || { feature: other, before: g.clone(), after: null, removed: false, edited: other.get("edited") };
        const after = geo.subtractFrom(g, cutter);
        if (!after || hairline(after)) {
          s.source.removeFeature(other);
          entry.after = null;
          entry.removed = true;
        } else {
          other.setGeometry(after);
          other.set("edited", true);
          entry.after = after.clone();
          entry.removed = false;
        }
        carved.set(other, entry);
      }
    }
    const ids = engine.wsRegionClipboard.resolvePastedIds(
      pasted.map((f) => f.getId() ?? f.get("id") ?? null),
      features(s).map((f) => f.getId()),
      () => mapDoc.newId(),
    );
    const added = [];
    pasted.forEach((f, index) => {
      const id = ids[index];
      f.setId(id);
      f.set("id", id);
      if (f.get("typeId") == null) f.set("typeId", s.doc.types?.[0]?.id || "land");
      if (f.get("owner") === undefined) f.set("owner", null);
      if (!f.get("name")) f.set("name", "Region");
      f.set("edited", true);
      s.source.addFeature(f);
      added.push(f);
    });
    const entries = [...carved.values()];
    const restore = (entry) => {
      entry.feature.setGeometry(entry.before.clone());
      if (entry.edited) entry.feature.set("edited", entry.edited);
      else entry.feature.unset("edited");
      if (entry.removed) s.source.addFeature(entry.feature);
    };
    const reapply = (entry) => {
      if (entry.removed) {
        s.source.removeFeature(entry.feature);
      } else {
        entry.feature.setGeometry(entry.after.clone());
        entry.feature.set("edited", true);
      }
    };
    notify(s, { geometry: true });
    pushCmd(s, {
      undo: () => {
        added.forEach((f) => s.source.removeFeature(f));
        entries.forEach(restore);
        s.geometryRev += 1;
      },
      redo: () => {
        entries.forEach(reapply);
        added.forEach((f) => s.source.addFeature(f));
        s.geometryRev += 1;
      },
    });
    return { added: added.map((f) => f.getId()), trimmed: entries.filter((entry) => !entry.removed).length, removed: entries.filter((entry) => entry.removed).length };
  };

  const describeClipboard = () => {
    const summary = engine.wsRegionClipboard.describeClipboard(clipboard);
    return summary ? plain(summary) : null;
  };

  const ownerAllowed = (filter, feature) => {
    const owner = feature?.get?.("owner") || null;
    if (filter === "*") return true;
    if (filter === "__unowned__") return !owner;
    return owner === filter;
  };

  const mapsOf = (s) => plain(engine.wsScenarioMaps.scenarioMaps(s.doc.metadata, { scenarioName: s.doc.metadata?.name }));

  const applyMaps = (s, result) => {
    if (result.refused) return { refused: result.refused };
    patchMetadata(s, result.patch);
    return { ok: true };
  };

  const applyRegionPatch = (s, { upsert = [], remove = [], withAttributes = false } = {}) => {
    const steps = [];
    const defaultType = (s.doc.types || [])[0]?.id || "land";
    for (const raw of Array.isArray(upsert) ? upsert : []) {
      const rid = raw?.properties?.id ?? raw?.id;
      if (rid === undefined || rid === null || !raw?.geometry) continue;
      const key = String(rid);
      let geometry;
      try {
        geometry = fmt.readGeometry(raw.geometry, READ);
      } catch (error) {
        console.warn("[editor] a suggested region could not be read:", key, error);
        continue;
      }
      if (!/Polygon$/.test(geometry.getType())) continue;
      const props = raw.properties || {};
      const attrs = {
        owner: props.owner || null,
        name: props.name || "Region",
        typeId: props.typeId || defaultType,
        claimants: Array.isArray(props.claimants) && props.claimants.length ? props.claimants : null,
        group: props.group || null,
        gid0: props.gid0 || "",
      };
      const existing = s.source.getFeatureById(key);
      if (existing) {
        const before = { geometry: existing.getGeometry().clone(), edited: existing.get("edited"), attrs: {} };
        if (withAttributes) for (const field of Object.keys(attrs)) before.attrs[field] = existing.get(field) ?? null;
        steps.push({
          undo: () => {
            existing.setGeometry(before.geometry.clone());
            if (before.edited) existing.set("edited", before.edited); else existing.unset("edited");
            for (const [field, value] of Object.entries(before.attrs)) existing.set(field, value);
          },
          redo: () => {
            existing.setGeometry(geometry.clone());
            existing.set("edited", true);
            if (withAttributes) for (const [field, value] of Object.entries(attrs)) existing.set(field, value);
          },
        });
      } else {
        const feature = new Feature({ geometry: geometry.clone() });
        feature.setId(key);
        feature.setProperties({ ...attrs, id: key, edited: true });
        steps.push({ undo: () => s.source.removeFeature(feature), redo: () => s.source.addFeature(feature) });
      }
    }
    for (const rid of Array.isArray(remove) ? remove : []) {
      const feature = s.source.getFeatureById(String(rid));
      if (!feature) continue;
      steps.push({ undo: () => s.source.addFeature(feature), redo: () => s.source.removeFeature(feature) });
    }
    if (!steps.length) return { changed: 0 };
    steps.forEach((step) => step.redo());
    notify(s, { geometry: true });
    pushCmd(s, {
      undo: () => { [...steps].reverse().forEach((step) => step.undo()); s.geometryRev += 1; },
      redo: () => { steps.forEach((step) => step.redo()); s.geometryRev += 1; },
    });
    return { changed: steps.length };
  };

  const retagGroup = (s, from, to = null) => {
    const key = clean(from);
    if (!key) return 0;
    const touched = features(s).filter((f) => clean(f.get("group")) === key);
    if (!touched.length) return 0;
    const apply = (value) => touched.forEach((f) => f.set("group", value || null));
    apply(to);
    notify(s);
    pushCmd(s, { undo: () => apply(key), redo: () => apply(to) });
    return touched.length;
  };

  const convertForReview = (s, source, target, bounds = null) => {
    const projection = engine.wsMapProjection;
    const convert = engine.wsProjectionConvert;
    const from = projection.normalizeProjection(source);
    const to = projection.normalizeProjection(target);
    if (projection.sameProjection(from, to)) {
      patchMetadata(s, { projection: to });
      return;
    }
    const moveXY = (x, y) => {
      const [X, Y] = projection.convertPlane(from, to, x / EARTH, y / EARTH);
      return [X * EARTH, Y * EARTH];
    };
    const background = s.doc.metadata?.customBackground ?? null;
    const plan = convert.planBasemapChange({ from, to, background, keepPicture: background?.kind === "image" });
    let nextBg = background;
    if (plan.kind === "bounds") {
      const lies = bounds ?? (to.type === "mercator" ? null : plan.bounds);
      nextBg = { kind: "image", dataUrl: background.dataUrl, aspect: background.aspect, ...(lies ? { bounds: lies } : {}) };
    } else if (plan.kind === "vector") {
      nextBg = { ...background, geojson: projection.moveGeojson(background.geojson, (lon, lat) => projection.convertDisplayPoint(from, to, lon, lat)) };
    } else if (plan.kind === "plain") {
      nextBg = { kind: "plain" };
    } else if (plan.kind === "tiles") {
      nextBg = null;
    }
    const transform = (move) => (input, output, stride = 2) => {
      const out = output ?? input;
      for (let i = 0; i < input.length; i += stride) {
        const [x, y] = move(input[i], input[i + 1]);
        out[i] = x;
        out[i + 1] = y;
      }
      return out;
    };
    for (const f of features(s)) f.getGeometry()?.applyTransform(transform(moveXY));
    notify(s, { geometry: true });
    setters(s).features((rows) => convert.moveFeatureCoords(rows, from, to));
    setters(s).units((rows) => convert.moveUnits(rows, from, to));
    setters(s).terrainAreas((rows) => convert.moveWarShapes(rows, from, to));
    setters(s).fortifications((rows) => convert.moveWarShapes(rows, from, to));
    setters(s).climateZones((rows) => convert.moveWarShapes(rows, from, to));
    patchMetadata(s, {
      projection: to,
      ...(plan.kind === "tiles" ? { customBackground: null } : nextBg !== background ? { customBackground: nextBg } : {}),
    });
  };

  const cloneCoords = (value) => (Array.isArray(value) ? value.map(cloneCoords) : value);
  const closestPointOnSegment = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const wx = p[0] - a[0];
    const wy = p[1] - a[1];
    const vv = vx * vx + vy * vy;
    const t = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
    const point = [a[0] + t * vx, a[1] + t * vy];
    return { point, distance: Math.hypot(p[0] - point[0], p[1] - point[1]), t };
  };
  const ringRefs = (geom) => {
    if (!geom) return [];
    const type = geom.getType?.();
    const coords = geom.getCoordinates?.() || [];
    if (type === "Polygon") return coords.map((ring, ringIndex) => ({ path: [ringIndex], ring }));
    if (type === "MultiPolygon") {
      const rows = [];
      coords.forEach((poly, polygonIndex) => poly.forEach((ring, ringIndex) => rows.push({ path: [polygonIndex, ringIndex], ring })));
      return rows;
    }
    return [];
  };
  const getRingAtPath = (coords, type, path) => (type === "Polygon" ? coords[path[0]] : coords[path[0]]?.[path[1]]);
  const nearestBoundarySegment = (geom, point) => {
    let best = null;
    for (const row of ringRefs(geom)) {
      const ring = row.ring || [];
      for (let i = 0; i < ring.length - 1; i += 1) {
        const hit = closestPointOnSegment(point, ring[i], ring[i + 1]);
        if (!best || hit.distance < best.distance) best = { ...hit, path: row.path, index: i, a: ring[i], b: ring[i + 1] };
      }
    }
    return best;
  };
  const sharedBorderPoint = (feats, point, tolerance) => {
    if (!Array.isArray(feats) || feats.length !== 2 || !point) return null;
    const a = nearestBoundarySegment(feats[0]?.getGeometry?.(), point);
    const b = nearestBoundarySegment(feats[1]?.getGeometry?.(), point);
    if (!a || !b || a.distance > tolerance || b.distance > tolerance) return null;
    return { point: [(a.point[0] + b.point[0]) / 2, (a.point[1] + b.point[1]) / 2], a, b };
  };
  const nearestBoundaryVertex = (geom, point) => {
    let best = null;
    for (const row of ringRefs(geom)) {
      const ring = row.ring || [];
      for (let i = 0; i < Math.max(0, ring.length - 1); i += 1) {
        const coord = ring[i];
        const distance = Math.hypot(point[0] - coord[0], point[1] - coord[1]);
        if (!best || distance < best.distance) best = { distance, path: row.path, index: i, coord };
      }
    }
    return best;
  };
  const setRingVertex = (ring, index, coord) => {
    if (!ring?.length || index < 0 || index >= ring.length) return false;
    ring[index] = coord.slice();
    if (index === 0) ring[ring.length - 1] = coord.slice();
    if (index === ring.length - 1) ring[0] = coord.slice();
    return true;
  };
  const weldPointIntoFeature = (feature, point, tolerance) => {
    const geom = feature?.getGeometry?.();
    if (!geom || !point) return false;
    const type = geom.getType?.();
    if (type !== "Polygon" && type !== "MultiPolygon") return false;
    const coords = cloneCoords(geom.getCoordinates());
    const vertex = nearestBoundaryVertex(geom, point);
    if (vertex && vertex.distance <= tolerance * 0.38) {
      const ring = getRingAtPath(coords, type, vertex.path);
      if (!setRingVertex(ring, vertex.index, point)) return false;
      geom.setCoordinates(coords);
      feature.set("edited", true);
      return true;
    }
    const segment = nearestBoundarySegment(geom, point);
    if (!segment || segment.distance > tolerance) return false;
    const ring = getRingAtPath(coords, type, segment.path);
    if (!ring) return false;
    ring.splice(segment.index + 1, 0, point.slice());
    geom.setCoordinates(coords);
    feature.set("edited", true);
    return true;
  };
  const removeSharedVertexNear = (feature, point, tolerance) => {
    const geom = feature?.getGeometry?.();
    if (!geom || !point) return false;
    const type = geom.getType?.();
    if (type !== "Polygon" && type !== "MultiPolygon") return false;
    const vertex = nearestBoundaryVertex(geom, point);
    if (!vertex || vertex.distance > tolerance) return false;
    const coords = cloneCoords(geom.getCoordinates());
    const ring = getRingAtPath(coords, type, vertex.path);
    if (!ring || ring.length <= 4) return false;
    let index = vertex.index;
    if (index === ring.length - 1) index = 0;
    ring.splice(index, 1);
    if (index === 0) ring[ring.length - 1] = ring[0].slice();
    geom.setCoordinates(coords);
    feature.set("edited", true);
    return true;
  };

  const sameCoord = (a, b, eps = 1e-6) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

  const snapPoint = (s, point, tolerance, { skip = null } = {}) => {
    if (!(tolerance > 0)) return { point, kind: null };
    const extent = [point[0] - tolerance, point[1] - tolerance, point[0] + tolerance, point[1] + tolerance];
    let vertex = null;
    let edge = null;
    s.source.forEachFeatureIntersectingExtent(extent, (f) => {
      for (const row of ringRefs(f.getGeometry())) {
        const ring = row.ring || [];
        for (let i = 0; i < ring.length; i += 1) {
          const c = ring[i];
          const skipped = skip && sameCoord(c, skip);
          if (!skipped) {
            const d = Math.hypot(point[0] - c[0], point[1] - c[1]);
            if (d <= tolerance && (!vertex || d < vertex.distance)) vertex = { distance: d, point: [c[0], c[1]] };
          }
          if (i < ring.length - 1) {
            const b = ring[i + 1];
            if (skip && (skipped || sameCoord(b, skip))) continue;
            const hit = closestPointOnSegment(point, c, b);
            if (hit.distance <= tolerance && (!edge || hit.distance < edge.distance)) edge = { distance: hit.distance, point: hit.point };
          }
        }
      }
    });
    if (vertex) return { point: vertex.point, kind: "vertex" };
    if (edge) return { point: edge.point, kind: "edge" };
    return { point, kind: null };
  };

  const traceAlong = (s, from, to, eps = 0.05) => {
    const extent = [Math.min(from[0], to[0]) - eps, Math.min(from[1], to[1]) - eps, Math.max(from[0], to[0]) + eps, Math.max(from[1], to[1]) + eps];
    let best = null;
    const lengthOf = (path) => {
      let total = 0;
      let last = from;
      for (const c of path) {
        total += Math.hypot(c[0] - last[0], c[1] - last[1]);
        last = c;
      }
      return total + Math.hypot(to[0] - last[0], to[1] - last[1]);
    };
    s.source.forEachFeatureIntersectingExtent(extent, (f) => {
      for (const row of ringRefs(f.getGeometry())) {
        const ring = row.ring || [];
        const n = ring.length - 1;
        if (n < 3) continue;
        const where = (p) => {
          let hit = null;
          for (let i = 0; i < n; i += 1) {
            const h = closestPointOnSegment(p, ring[i], ring[i + 1]);
            if (h.distance <= eps && (!hit || h.distance < hit.distance)) hit = { ...h, index: i };
          }
          return hit;
        };
        const a = where(from);
        if (!a) continue;
        const b = where(to);
        if (!b) continue;
        const posA = a.index + a.t;
        const posB = b.index + b.t;
        const forward = [];
        const endForward = posB >= posA ? posB : posB + n;
        for (let k = Math.floor(posA) + 1; k < endForward && forward.length <= n; k += 1) forward.push(ring[k % n]);
        const backward = [];
        const endBackward = posB <= posA ? posB : posB - n;
        for (let k = Math.ceil(posA) - 1; k > endBackward && backward.length <= n; k -= 1) backward.push(ring[((k % n) + n) % n]);
        const tidy = (path) => path.filter((c) => !sameCoord(c, from, eps) && !sameCoord(c, to, eps)).map((c) => [c[0], c[1]]);
        const fw = tidy(forward);
        const bw = tidy(backward);
        const pick = lengthOf(fw) <= lengthOf(bw) ? fw : bw;
        if (!best || lengthOf(pick) < lengthOf(best)) best = pick;
      }
    });
    return best || [];
  };

  const shapeSnapshot = (feats) => new Map(feats.map((f) => [f.getId(), { feature: f, geometry: f.getGeometry().clone(), edited: f.get("edited") }]));
  const shapeRestore = (snapshot) => {
    for (const row of snapshot.values()) {
      row.feature.setGeometry(row.geometry.clone());
      if (row.edited === undefined) row.feature.unset("edited", true);
      else row.feature.set("edited", row.edited);
    }
  };
  const editRings = (s, ids) => {
    const out = [];
    for (const rid of ids) {
      const f = s.source.getFeatureById(String(rid));
      if (!f) continue;
      for (const row of ringRefs(f.getGeometry())) out.push({ id: String(f.getId()), path: row.path, coords: (row.ring || []).map((c) => toLonLat(c)) });
    }
    return out;
  };
  const geometryOutlines = (geom) => {
    const out = [];
    const type = geom?.getType?.();
    const polys = type === "Polygon" ? [geom.getCoordinates()] : type === "MultiPolygon" ? geom.getCoordinates() : [];
    for (const poly of polys) for (const ring of poly) out.push(ring.map((c) => toLonLat(c)));
    return out;
  };

  const reviewApi = (s) => ({
    getRegionSummary: (rid) => {
      const f = s.source.getFeatureById(String(rid));
      return f ? summarize(f) : null;
    },
    exportRegions: (ids) => exportRegions(s, (ids || []).map(String)),
    queryRegions: (text = "", limit = 200) => {
      const q = String(text || "").trim().toLowerCase();
      const search = engine.wsRegionSearch;
      const owners = q ? search.ownersMatchingQuery(s.doc.polities, q) : null;
      const out = [];
      for (const f of features(s)) {
        if (q && !search.regionMatchesQuery({ id: f.getId(), name: f.get("name"), owner: f.get("owner") }, q, owners)) continue;
        out.push(summarize(f));
        if (out.length >= limit) break;
      }
      return out;
    },
    listOwnerRegions: (ownerKey) => {
      const key = clean(ownerKey);
      if (!key) return [];
      return features(s).filter((f) => clean(f.get("owner")) === key).map((f) => ({ id: f.getId(), name: clean(f.get("name")), typeId: f.get("typeId") || "land" }));
    },
    setRegionAttrs: (ids, patch) => setRegionAttrs(s, (ids || []).map(String), patch),
    applyRegionPatch: (args) => applyRegionPatch(s, args),
    removeOwners: (keys) => removeOwners(s, keys),
    renameOwner: (from, to) => renameOwner(s, from, to),
    retagGroup: (from, to = null) => retagGroup(s, from, to),
  });

  const reviewCtx = (s) => ({
    doc: s.doc,
    api: reviewApi(s),
    d: {
      setPolities: (updater) => {
        s.doc = { ...s.doc, polities: typeof updater === "function" ? updater(s.doc.polities || {}) : (updater || {}) };
        dirty(s);
      },
      upsertPolity: (key, patch) => upsertPolity(s, key, patch),
      removePolity: (key) => removePolitiesDoc(s, [key]),
      renamePolity: (from, to) => renamePolityDoc(s, from, to),
      setColorOverride: (key, rgb) => setColorOverride(s, key, rgb),
      setFlag: (key, value) => setFlag(s, key, value),
      setTags: (key, value) => setTags(s, key, value),
      setGroups: setters(s).groups,
      setFeatures: setters(s).features,
      setUnits: setters(s).units,
      setPuppets: setters(s).puppets,
      setTerrainAreas: setters(s).terrainAreas,
      setFortifications: setters(s).fortifications,
      setClimateZones: setters(s).climateZones,
      setFreezingRegions: setters(s).freezingRegions,
      patchMetadata: (patch) => patchMetadata(s, patch),
    },
    setBackground: (saved) => patchMetadata(s, { customBackground: saved || null }),
    convertProjection: (from, to, bounds) => convertForReview(s, from, to, bounds),
  });

  const squash = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const REVIEW_SECTION_TITLES = {
    countries: "Countries",
    ownership: "Who owns which region",
    borders: "Borders",
    regions: "Region names and types",
    claims: "Claims",
    groups: "Groups",
    cities: "Cities",
    units: "Units",
    features: "Map features",
    puppets: "Puppet states",
    basemaps: "Basemaps",
    detailedMap: "Detailed map",
    settings: "Map settings",
  };
  const WAR_MAP_LABELS = { terrainAreas: "Terrain", fortifications: "Fortified lines", climateZones: "Climate zones", freezingRegions: "Water that can freeze" };
  const FIELD_CHIP_LABELS = { name: "Name", aliases: "Other names", code: "Code", note: "Note", status: "Status", color: "Colour", flag: "Flag", tags: "Tags", extra: "Other details" };
  const reviewPolityName = (doc, key) => squash(doc?.polities?.[key]?.name) || squash(key);
  const builtinNames = (ids) => (engine.assets.ESRI_BASEMAPS || []).filter((basemap) => ids.includes(basemap.id)).map((basemap) => basemap.label).join(", ");

  const changeText = (change, doc) => {
    const name = (key) => reviewPolityName(doc, key);
    const ownMapName = (key) => (Array.isArray(doc?.metadata?.ownBasemaps) ? doc.metadata.ownBasemaps.find((own) => own?.id === key)?.name : "") || key;
    switch (change.kind) {
      case "polity-add": return `New country: ${squash(change.record?.name) || change.key}`;
      case "polity-remove": return `Remove ${name(change.key)}`;
      case "polity-rename": return `Rename ${name(change.from)} to ${squash(change.record?.name) || change.to}`;
      case "polity-change": return `Edit country ${name(change.key)}`;
      case "region-owner": return change.regionName || "Region";
      case "borders": {
        const regions = change.regions ?? [];
        return regions.length === 1 ? `New borders for ${regions[0].name}` : `New borders for ${regions.length} neighbouring regions`;
      }
      case "region-name": return `Rename region ${change.from || "Region"} to ${change.to}`;
      case "region-type": return `${change.regionName}: ${change.from || "land"} → ${change.to || "land"}`;
      case "region-claims": return change.to?.length ? `${change.regionName}: claimed by ${change.to.map(name).join(", ")}` : `${change.regionName}: no longer disputed`;
      case "region-group": return change.to ? `${change.regionName}: controlled by ${change.to}` : `${change.regionName}: no longer controlled by ${change.from}`;
      case "group-add": return `New group: ${change.key}`;
      case "group-remove": return `Remove group ${change.key}`;
      case "group-change": return `Edit group ${change.key}`;
      case "city-add": return `Add the city ${change.name}`;
      case "city-remove": return `Remove city ${change.name}`;
      case "city-change": return `Edit city ${change.name}`;
      case "cities-replace": return Array.isArray(change.to) ? `Replace the cities with ${change.to.length} new ones` : "Go back to the built-in cities";
      case "unit-add": return `Add the unit ${change.label}`;
      case "unit-remove": return `Remove unit ${change.label}`;
      case "unit-change": return `Edit unit ${change.label}`;
      case "marker-add": return `New map feature: ${change.label}`;
      case "marker-remove": return `Remove map feature ${change.label}`;
      case "marker-change": return `Edit map feature ${change.label}`;
      case "puppet-add": return `${name(change.to?.puppet)} becomes a puppet of ${name(change.to?.overlord)}`;
      case "puppet-remove": return `${name(change.from?.puppet)} is no longer a puppet of ${name(change.from?.overlord)}`;
      case "puppet-change": return `Change how ${name(change.to?.puppet)} answers to ${name(change.to?.overlord)}`;
      case "projection": {
        if (engine.wsMapProjection.sameProjection(change.from, change.to)) return "Change how the game shows the map (3D globe, looping)";
        const projection = engine.wsMapProjection.PROJECTIONS.find((entry) => entry.id === change.to?.type)?.name ?? change.to?.type;
        return `Map projection: ${projection}`;
      }
      case "map-field":
        if (change.field === "author") return `Map author: ${change.to || "—"}`;
        if (change.field === "startingMapName") return `Name the starting map: ${change.to || "—"}`;
        return `New basemap: ${change.to || "—"}`;
      case "war-map": return WAR_MAP_LABELS[change.field] || change.field;
      case "background": return change.to ? "New custom basemap" : "Remove the custom basemap";
      case "allowed-basemaps":
        return change.to === null
          ? "Built-in maps players can switch to: the default"
          : change.to.length ? `Built-in maps players can switch to: ${builtinNames(change.to)}` : "Players can switch to no built-in map";
      case "own-basemap-add":
        return change.to?.kind === "tiled"
          ? `Add the detailed map ${change.to?.name || change.key} to this scenario's maps`
          : `Offer another basemap: ${change.to?.name || change.key}`;
      case "own-basemap-remove": return `Stop offering the basemap ${change.from?.name || change.key}`;
      case "own-basemap-change":
        if (change.from?.name && change.to?.name && change.from.name !== change.to.name && change.from.hash === change.to.hash) {
          return `Rename the basemap ${change.from.name} to ${change.to.name}`;
        }
        return change.to?.kind === "tiled"
          ? `Change the detailed map ${change.to?.name || change.key}, shown over ${change.to.data?.over ? ownMapName(change.to.data.over) : "the starting map"}`
          : `New version of the basemap ${change.to?.name || change.key}`;
      case "detailed-map": {
        if (!change.to) return change.from?.name ? `Take the detailed map ${change.from.name} off` : "Take the detailed map off";
        const mapName = change.to.name || "a detailed map";
        const sameMap = change.from && ((change.to.id && change.from.id === change.to.id) || (change.to.hash && change.from.hash === change.to.hash));
        if (!sameMap) return `Detailed map: ${mapName}`;
        if (change.to.version && change.from.version !== change.to.version) return `Use version ${change.to.version} of the detailed map ${mapName}`;
        return `Change how strongly countries are coloured over the detailed map ${mapName}`;
      }
      default: return squash(change.kind);
    }
  };

  const reviewStatuses = (s) => {
    const r = s.review;
    const sr = engine.wsSuggestionReview;
    if (!r.cache || r.cacheRev !== s.regionRev) {
      r.cache = sr.createRegionCache();
      r.cacheRev = s.regionRev;
    }
    const ctx = reviewCtx(s);
    const placed = sr.inSuggestedProjection(ctx, r.changes);
    r.statuses = Object.fromEntries(r.changes.map((change) => [change.id, sr.mapChangeStatus(change, change.kind === "projection" ? ctx : placed, { renames: r.renames, cache: r.cache })]));
    return r.statuses;
  };

  const reviewView = (s) => {
    const r = s.review;
    if (!r) return { active: false };
    const sr = engine.wsSuggestionReview;
    const statuses = reviewStatuses(s);
    const decisionOf = (change) => sr.decisionOf(change, r.decisions, statuses);
    const rows = r.changes.map((change) => {
      const regions = change.kind === "borders" ? (change.regions ?? []) : [];
      const lines = regions.slice(0, 8).map((region) => (region.op === "add" ? `New region: ${region.name}` : region.op === "remove" ? `Region removed: ${region.name}` : `Region redrawn: ${region.name}`));
      if (regions.length > 8) lines.push(`and ${regions.length - 8} more`);
      return {
        id: change.id,
        section: sr.sectionOfChange(change),
        text: changeText(change, s.doc),
        decided: r.decisions.accepted.has(change.id) ? "accepted" : r.decisions.rejected.has(change.id) ? "rejected" : "",
        settled: Boolean(decisionOf(change)),
        canUndo: !r.decisions.accepted.has(change.id) || r.undoers.has(change.id),
        status: statuses[change.id] || "open",
        chips: change.kind === "polity-change" ? Object.keys(change.fields ?? {}).map((field) => FIELD_CHIP_LABELS[field] || field) : [],
        lines,
        from: change.kind === "region-owner" ? (change.from ?? "") : "",
        to: change.kind === "region-owner" ? (change.to ?? "") : "",
      };
    });
    const sections = sr.REVIEW_SECTIONS.map((section) => {
      const items = rows.filter((row) => row.section === section.id);
      const out = { id: section.id, title: REVIEW_SECTION_TITLES[section.id] || section.id, rows: items };
      if (section.id === "ownership") {
        const byPair = new Map();
        for (const row of items) {
          const key = `${row.from}→${row.to}`;
          if (!byPair.has(key)) byPair.set(key, { key, fromLabel: row.from ? reviewPolityName(s.doc, row.from) : "Unowned", toLabel: row.to ? reviewPolityName(s.doc, row.to) : "Unowned", ids: [] });
          byPair.get(key).ids.push(row.id);
        }
        out.groups = [...byPair.values()].sort((a, b) => b.ids.length - a.ids.length);
      }
      return out;
    }).filter((section) => section.rows.length);
    return {
      active: true,
      by: squash(r.suggestion?.by),
      note: String(r.suggestion?.note ?? ""),
      total: rows.length,
      settled: rows.filter((row) => row.settled).length,
      sections,
      focusId: r.focusId || "",
    };
  };

  const reviewDecide = (r, ids, kind) => {
    for (const cid of ids) {
      r.decisions.accepted.delete(cid);
      r.decisions.rejected.delete(cid);
      if (kind === "accepted") r.decisions.accepted.add(cid);
      if (kind === "rejected") r.decisions.rejected.add(cid);
    }
  };

  const ringsOf = (geometry) => {
    if (!geometry) return [];
    if (geometry.type === "Polygon") return geometry.coordinates || [];
    if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).flat();
    return [];
  };

  const reviewTargets = (s, change) => engine.wsSuggestionReview.changeTargets(change, { api: reviewApi(s) }, { changes: s.review.changes, renames: s.review.renames, cache: s.review.cache });

  const regionOutlines = (s, ids) => {
    const out = [];
    for (const rid of ids.slice(0, 80)) {
      const f = s.source.getFeatureById(String(rid));
      if (!f) continue;
      const geometry = f.getGeometry().simplify(1500);
      const polygons = geometry.getType() === "Polygon" ? [geometry.getCoordinates()] : geometry.getType() === "MultiPolygon" ? geometry.getCoordinates() : [];
      for (const polygon of polygons) {
        const ring = polygon[0];
        if (ring && ring.length > 2) out.push(ring.map((point) => toLonLat(point)));
      }
    }
    return out;
  };

  const reviewMarkup = (s) => {
    const r = s.review;
    if (!r) return { regions: {}, outlines: [], shapes: [], points: [], focus: null };
    const sr = engine.wsSuggestionReview;
    const statuses = reviewStatuses(s);
    const regions = {};
    const shapes = [];
    const points = [];
    let focus = null;
    for (const change of r.changes) {
      const state = sr.decisionOf(change, r.decisions, statuses) || (statuses[change.id] === "conflict" ? "conflict" : "pending");
      const targets = reviewTargets(s, change);
      for (const rid of targets.regionIds) if (!(rid in regions)) regions[rid] = state;
      if (state === "pending" || state === "conflict") for (const shape of targets.shapes) shapes.push({ rings: ringsOf(shape.geometry), state });
      for (const point of targets.points) points.push({ coord: [Number(point[0]), Number(point[1])], state });
      if (change.id === r.focusId) {
        focus = {
          state,
          outlines: regionOutlines(s, targets.regionIds),
          shapes: targets.shapes.map((shape) => ringsOf(shape.geometry)),
          points: targets.points.map((point) => [Number(point[0]), Number(point[1])]),
          regionIds: targets.regionIds,
          bbox: Array.isArray(change.bbox) ? change.bbox : null,
        };
      }
    }
    const outlines = [];
    for (const rid of Object.keys(regions).slice(0, 300)) {
      for (const ring of regionOutlines(s, [rid])) outlines.push({ ring, state: regions[rid] });
    }
    return { regions, outlines, shapes, points, focus };
  };

  const recordReview = async (s) => {
    const r = s.review;
    const sr = engine.wsSuggestionReview;
    const mapDecisions = sr.decisionsFor(r.changes, r.decisions, r.statuses || reviewStatuses(s));
    const latest = (await lib.loadScenarioDetails(s.scenario.id)).scenario;
    const reviews = { ...(latest?.hubReviews ?? {}) };
    const record = reviews[r.key] ?? { status: "reviewing", accepted: [], rejected: [] };
    const accepted = new Set(record.accepted);
    const rejected = new Set(record.rejected);
    const all = Array.isArray(r.suggestion?.changes) ? r.suggestion.changes : [];
    for (const change of all) {
      if (change.area !== "map") continue;
      accepted.delete(change.id);
      rejected.delete(change.id);
    }
    mapDecisions.accepted.forEach((cid) => accepted.add(cid));
    mapDecisions.rejected.forEach((cid) => rejected.add(cid));
    const everyDecided = all.every((change) => accepted.has(change.id) || rejected.has(change.id));
    reviews[r.key] = {
      status: everyDecided ? "done" : record.status === "dismissed" ? "dismissed" : "reviewing",
      accepted: [...accepted],
      rejected: [...rejected],
      updatedAt: new Date().toISOString(),
    };
    await lib.saveScenario(s.scenario.id, { hubReviews: reviews });
    return { key: r.key, ...reviews[r.key] };
  };

  const startReview = (s, review) => {
    const suggestion = review?.suggestion && typeof review.suggestion === "object" ? review.suggestion : null;
    if (!suggestion) {
      s.review = null;
      return;
    }
    s.review = {
      suggestion,
      key: clean(review.key) || clean(suggestion.id),
      changes: (Array.isArray(suggestion.changes) ? suggestion.changes : []).filter((change) => change?.area === "map"),
      decisions: { accepted: new Set(list(review.decisions?.accepted).map(String)), rejected: new Set(list(review.decisions?.rejected).map(String)) },
      renames: {},
      undoers: new Map(),
      focusId: "",
      cache: null,
      cacheRev: -1,
      statuses: null,
    };
  };

  const uniqueStandardFlag = (candidates) => {
    const codes = new Set();
    for (const candidate of candidates || []) {
      const code = engine.wsPolityIdentity.resolveStockCountryCode(candidate);
      if (code) codes.add(code);
    }
    if (codes.size !== 1) return null;
    return engine.countryFlags.flagImageUrlFromGid([...codes][0]);
  };

  const embeddedFlagForRecord = (record) => {
    if (!record || typeof record !== "object") return null;
    const direct = String(record.flag ?? record.flagUrl ?? record.flag_url ?? record.flagDataUrl ?? "").trim();
    if (direct) return direct;
    const flagCode = String(record.flagCode ?? record.flag_code ?? "").trim();
    return flagCode ? engine.countryFlags.flagImageUrlFromGid(flagCode) : null;
  };

  const collectImportedPolities = (features, polities, flags, embeddedPolityRows = [], { materializeStandardFlags = true } = {}) => {
    const resolvePolity = buildPolityResolver(polities);
    const embeddedIndex = embeddedPolityIndex(embeddedPolityRows);
    const owners = new Map();
    const invalidColors = [];
    let resolvedOwners = 0;
    let colorsWithoutOwner = 0;
    let preservedExistingFlags = 0;
    let embeddedFlags = 0;
    for (const feature of features || []) {
      const props = feature?.properties || (feature.properties = {});
      const importedOwner = primitiveKey(props.owner);
      const rawColor = props.ownerColor;
      if (!importedOwner) {
        if (rawColor != null && String(rawColor).trim()) colorsWithoutOwner += 1;
        continue;
      }
      const stableKey = resolvePolity(importedOwner);
      if (stableKey !== importedOwner) {
        props.owner = stableKey;
        resolvedOwners += 1;
      }
      let row = owners.get(stableKey);
      if (!row) {
        const existing = polities?.[stableKey] || null;
        const embedded = embeddedIndex.get(String(importedOwner).toLocaleLowerCase()) || embeddedIndex.get(String(stableKey).toLocaleLowerCase()) || null;
        const embeddedAliases = Array.isArray(embedded?.aliases) ? embedded.aliases : [];
        const aliases = new Set([
          stableKey,
          importedOwner,
          embedded?.name,
          ...embeddedAliases,
          existing?.name,
          ...(Array.isArray(existing?.aliases) ? existing.aliases : []),
        ].map((v) => String(v || "").trim()).filter(Boolean));
        const identityCandidates = [embedded?.flagCode, embedded?.flag_code, existing?.code, stableKey, importedOwner, embedded?.name, existing?.name, ...aliases];
        const existingFlag = firstExistingFlagForCandidates(flags, identityCandidates);
        const explicitFlag = embeddedFlagForRecord(embedded);
        if (existingFlag) preservedExistingFlags += 1;
        if (!existingFlag && explicitFlag) embeddedFlags += 1;
        row = {
          key: stableKey,
          name: String(embedded?.name || existing?.name || importedOwner).trim() || stableKey,
          aliases,
          flag: !existingFlag ? (explicitFlag || (materializeStandardFlags ? uniqueStandardFlag(identityCandidates) : null)) : null,
          colors: new Map(),
          regions: 0,
        };
        const embeddedColor = normalizeOwnerColor(embedded?.color ?? embedded?.colour ?? null);
        if (embeddedColor === false) throw new Error(`Invalid embedded polity colour for ${row.name}. Use six-digit hex such as #8E1B34.`);
        if (embeddedColor) row.colors.set(embeddedColor, 1);
        owners.set(stableKey, row);
      } else {
        row.aliases.add(importedOwner);
      }
      row.regions += 1;
      const color = normalizeOwnerColor(rawColor);
      if (color === false) {
        if (invalidColors.length < 8) invalidColors.push({ owner: importedOwner, value: String(rawColor), region: String(props.name || props.id || feature?.id || "").trim() });
        continue;
      }
      if (color) row.colors.set(color, (row.colors.get(color) || 0) + 1);
    }
    if (invalidColors.length) {
      const examples = invalidColors.map((row) => `${row.owner}${row.region ? ` (${row.region})` : ""}: ${row.value}`).join("; ");
      throw new Error(`Invalid ownerColor value${invalidColors.length === 1 ? "" : "s"} in imported GeoJSON. Use six-digit hex colours such as #8E1B34. ${examples}`);
    }
    const conflicts = [];
    for (const row of owners.values()) {
      if (row.colors.size > 1) conflicts.push(`${row.name}: ${[...row.colors.keys()].sort().join(", ")}`);
    }
    if (conflicts.length) {
      throw new Error(
        "Conflicting ownerColor values were found for the same resolved polity. " +
        "The importer will not choose a colour based on feature order. Fix the source GeoJSON and analyze again. " +
        conflicts.slice(0, 8).join("; "),
      );
    }
    const rows = [...owners.values()]
      .map((row) => ({ key: row.key, name: row.name, aliases: [...row.aliases], color: row.colors.size ? [...row.colors.keys()][0] : null, flag: row.flag || null }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    return {
      rows,
      owners: rows.length,
      colors: rows.filter((row) => row.color).length,
      flags: rows.filter((row) => row.flag).length,
      embeddedFlags,
      embeddedPolities: embeddedPolityRows.length,
      preservedExistingFlags,
      resolvedOwners,
      colorsWithoutOwner,
    };
  };

  const collectImportedCityPoints = (features, polities) => {
    const resolvePolity = buildPolityResolver(polities);
    const rows = [];
    let skippedUnnamed = 0;
    let skippedInvalidCoordinates = 0;
    let resolvedOwners = 0;
    const symbols = {};
    for (let index = 0; index < (features || []).length; index += 1) {
      const feature = features[index];
      if (!isExplicitCityPoint(feature)) continue;
      const props = feature?.properties || {};
      const coords = feature?.geometry?.coordinates;
      const lon = Number(coords?.[0]);
      const lat = Number(coords?.[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        skippedInvalidCoordinates += 1;
        continue;
      }
      const name = cityPointName(props);
      if (!name) {
        skippedUnnamed += 1;
        continue;
      }
      const displaySymbol = String(props.displaySymbol ?? props.symbol ?? "square").trim().toLowerCase() || "square";
      symbols[displaySymbol] = (symbols[displaySymbol] || 0) + 1;
      const incomingTags = normalizeImportTagList(props.tags);
      const isCapital = boolish(props.capital) || incomingTags.some((tag) => tag.toLowerCase() === "capital") || displaySymbol === "full-flag";
      const tags = [...new Set(["city", ...incomingTags, ...(isCapital ? ["capital"] : [])])];
      const importedOwner = primitiveKey(props.owner);
      const owner = importedOwner ? resolvePolity(importedOwner) : null;
      if (importedOwner && owner !== importedOwner) resolvedOwners += 1;
      const explicitTier = Number(props.tier);
      const symbolTier = CITY_SYMBOL_TIER[displaySymbol] || 1;
      const tier = Number.isFinite(explicitTier) && explicitTier >= 1 && explicitTier <= 3 ? Math.round(explicitTier) : symbolTier;
      const series = engine.wsCityPopulation.populationByYearField(props);
      const population = Number(props.population) || engine.wsCityPopulation.latestPopulation(series.populationByYear);
      const scale = Number(props.scale);
      const labelScale = Number(props.lbSize ?? props.labelScale);
      const sourceRegionId = primitiveKey(props.sourceRegionId ?? props.regionId ?? props.regionID);
      const sourceId = primitiveKey(feature?.id ?? props.id ?? props.markerId ?? props.markerID);
      rows.push({
        sourceId: sourceId || null,
        name,
        type: "Coordinate",
        symbol: displaySymbol,
        coord: [lon, lat],
        country: String(props.country || "").trim(),
        owner: owner || null,
        regionId: sourceRegionId || null,
        sourceRegionId: sourceRegionId || null,
        population: Number.isFinite(population) && population > 0 ? population : 0,
        ...series,
        tier,
        tags,
        ...(Number.isFinite(scale) && scale > 0 ? { scale } : {}),
        ...(Number.isFinite(labelScale) && labelScale > 0 ? { labelScale } : {}),
        ...(props.labelPlacement != null ? { labelPlacement: String(props.labelPlacement) } : {}),
      });
    }
    return { rows, count: rows.length, skippedUnnamed, skippedInvalidCoordinates, resolvedOwners, symbols };
  };

  const analyzeImportGeoJSON = (s, { file = "", metadataFile = "", geoJoinKey = "auto", metadataJoinKey = "auto", metadataNameField = "auto", mergeAllMetadata = true, materializeStandardFlags = true } = {}) => {
    const out = {};
    const polities = s.doc.polities || {};
    const flags = s.doc.flags || {};
    try {
      if (!clean(file)) throw new Error("Choose a GeoJSON file first.");
      const parsed = JSON.parse(fs.readFileSync(clean(file), "utf8"));
      if (!validFeatureCollection(parsed)) throw new Error("That file is not a GeoJSON FeatureCollection.");
      const embeddedPolityRows = embeddedPolityRowsFromGeoJSON(parsed.polities);
      const sourceFeatures = parsed.features.slice();
      const polygonFeatures = sourceFeatures.filter((feature) => feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon");
      if (!polygonFeatures.length) throw new Error("The GeoJSON contains no Polygon/MultiPolygon regions.");
      const cityImport = collectImportedCityPoints(sourceFeatures, polities);
      parsed.importCityRows = cityImport.rows;
      parsed.features = polygonFeatures.map((feature) => ({
        ...feature,
        properties: feature?.properties && typeof feature.properties === "object" ? { ...feature.properties } : {},
      }));
      const geoFields = collectFields(parsed.features, { feature: true });
      out.geoKeyOptions = geoFields;
      let metadataRows = [];
      let metaFields = [];
      let joinPair = null;
      let matched = 0;
      let unmatchedGeometry = 0;
      let metadataUnused = 0;
      let namesImported = 0;
      let resolvedNameField = null;
      if (clean(metadataFile)) {
        let metadataParsed;
        try {
          metadataParsed = JSON.parse(fs.readFileSync(clean(metadataFile), "utf8"));
        } catch (error) {
          throw new Error(`Metadata JSON could not be parsed: ${error?.message || error}`);
        }
        metadataRows = extractMetadataRecords(metadataParsed);
        if (!metadataRows.length) {
          throw new Error(
            "The metadata JSON contains no usable records. Supported shapes: an array of objects, " +
            "{regions:[...]}, {provinces:[...]}, a GeoJSON FeatureCollection, or an object keyed by region/province ID.",
          );
        }
        metaFields = collectFields(metadataRows);
        out.metadataKeyOptions = metaFields;
        out.metadataFieldOptions = metaFields.filter((field) => !field.startsWith("__"));
        joinPair = chooseJoinPair(parsed.features, metadataRows, geoFields, metaFields, geoJoinKey, metadataJoinKey);
        if (!joinPair) {
          throw new Error(
            "Could not match the GeoJSON regions to the metadata JSON automatically. " +
            "Analyze once to populate the key lists, choose the matching Geometry key and Metadata key, then Analyze again.",
          );
        }
        const metadataByKey = new Map();
        for (const row of metadataRows) {
          const key = primitiveKey(recordFieldValue(row, joinPair.metaField));
          if (key != null && !metadataByKey.has(key)) metadataByKey.set(key, row);
        }
        const usedMetadataKeys = new Set();
        for (const feature of parsed.features) {
          const key = primitiveKey(featureFieldValue(feature, joinPair.geoField));
          const metadataRecord = key != null ? metadataByKey.get(key) : null;
          if (metadataRecord) {
            matched += 1;
            usedMetadataKeys.add(key);
            if (mergeAllMetadata) feature.properties = { ...(feature.properties || {}), ...cleanMetadataRecord(metadataRecord) };
            const nameResult = normalizeFeatureName(feature, metadataNameField, metadataRecord);
            if (nameResult.imported) {
              namesImported += 1;
              resolvedNameField ||= nameResult.field;
            }
          } else {
            unmatchedGeometry += 1;
            const nameResult = normalizeFeatureName(feature, "auto", null);
            if (nameResult.imported) {
              namesImported += 1;
              resolvedNameField ||= nameResult.field;
            }
          }
        }
        metadataUnused = Math.max(0, metadataByKey.size - usedMetadataKeys.size);
      } else {
        out.metadataKeyOptions = [];
        out.metadataFieldOptions = [];
        for (const feature of parsed.features) {
          const nameResult = normalizeFeatureName(feature, metadataNameField, null);
          if (nameResult.imported) {
            namesImported += 1;
            resolvedNameField ||= nameResult.field;
          }
        }
      }
      const polityImport = collectImportedPolities(parsed.features, polities, flags, embeddedPolityRows, { materializeStandardFlags });
      parsed.importPolityRows = polityImport.rows;
      parsed.importStats = {
        regions: parsed.features.length,
        source: "geojson",
        metadataRows: metadataRows.length,
        metadataMatched: matched,
        metadataUnmatchedGeometry: unmatchedGeometry,
        metadataUnused,
        geoJoinKey: joinPair?.geoField || null,
        metadataJoinKey: joinPair?.metaField || null,
        metadataNameField: resolvedNameField || (metadataNameField !== "auto" ? metadataNameField : null),
        namesImported,
        metadataMerged: Boolean(clean(metadataFile) && mergeAllMetadata),
        polityOwners: polityImport.owners,
        polityColors: polityImport.colors,
        polityFlags: polityImport.flags,
        embeddedPolities: polityImport.embeddedPolities,
        embeddedPolityFlags: polityImport.embeddedFlags,
        polityFlagsPreserved: polityImport.preservedExistingFlags,
        resolvedOwnerAliases: polityImport.resolvedOwners,
        ownerColorsWithoutOwner: polityImport.colorsWithoutOwner,
        cityMarkers: cityImport.count,
        cityMarkersSkippedUnnamed: cityImport.skippedUnnamed,
        cityMarkersSkippedInvalidCoordinates: cityImport.skippedInvalidCoordinates,
        cityOwnerAliasesResolved: cityImport.resolvedOwners,
        citySymbols: cityImport.symbols,
      };
      s.importResult = parsed;
      out.stats = parsed.importStats;
      out.regions = parsed.features.length;
      out.message = clean(metadataFile)
        ? `Ready: ${parsed.features.length.toLocaleString()} regions; ${matched.toLocaleString()} metadata matches; ${polityImport.owners.toLocaleString()} owners; ${polityImport.colors.toLocaleString()} polity colours; ${polityImport.flags.toLocaleString()} scenario flags; ${cityImport.count.toLocaleString()} city markers`
        : `Ready: ${parsed.features.length.toLocaleString()} polygon regions; ${polityImport.owners.toLocaleString()} owners; ${polityImport.colors.toLocaleString()} polity colours; ${polityImport.flags.toLocaleString()} scenario flags; ${cityImport.count.toLocaleString()} city markers`;
    } catch (error) {
      s.importResult = null;
      out.error = error?.message || String(error);
    }
    return plain(out);
  };

  const replaceRegionsFromImport = (s, fc, { inheritOwners = true, simplifyMeters = 0 } = {}) => {
    if (!fc || !Array.isArray(fc.features)) return { count: 0, inheritedOwners: 0 };
    let feats;
    try {
      feats = fmt.readFeatures(fc, READ);
    } catch (e) {
      console.warn("[editor] province import GeoJSON parse failed:", e);
      return { count: 0, inheritedOwners: 0 };
    }
    feats = feats.filter((f) => {
      const type = f.getGeometry?.()?.getType?.();
      return type === "Polygon" || type === "MultiPolygon";
    });
    if (!feats.length) return { count: 0, inheritedOwners: 0 };
    if (simplifyMeters > 0) {
      const lighter = engine.wsSimplify.simplifyShared(feats.map((f) => f.getGeometry()), { toleranceAt: engine.wsSimplify.toleranceAtLatitude(simplifyMeters) });
      feats.forEach((f, at) => f.setGeometry(lighter[at]));
    }
    const usedIds = new Set();
    let inheritedOwners = 0;
    for (let i = 0; i < feats.length; i += 1) {
      const f = feats[i];
      const p = f.getProperties();
      let fid = f.getId() ?? p.id ?? `imp-${i + 1}`;
      fid = String(fid);
      let unique = fid;
      let suffix = 2;
      while (usedIds.has(unique)) unique = `${fid}-${suffix++}`;
      usedIds.add(unique);
      f.setId(unique);
      if (f.get("typeId") == null) f.set("typeId", "land");
      if (inheritOwners && !f.get("owner") && (f.get("typeId") || "land") !== "water") {
        const coord = interiorPoint(f.getGeometry());
        if (coord) {
          const epsilon = 0.01;
          const candidates = s.source.getFeaturesInExtent([coord[0] - epsilon, coord[1] - epsilon, coord[0] + epsilon, coord[1] + epsilon]);
          const hit = candidates.find((old) => old.getGeometry?.()?.intersectsCoordinate?.(coord));
          if (hit) {
            const owner = hit.get("owner") || null;
            if (owner) {
              f.set("owner", owner);
              inheritedOwners += 1;
            }
            const claimants = hit.get("claimants");
            if (Array.isArray(claimants) && claimants.length) f.set("claimants", claimants.slice());
            const group = hit.get("group");
            if (group) f.set("group", group);
          }
        }
      }
    }
    s.undo = [];
    s.redo = [];
    s.source.clear();
    s.savedRegionHashes.clear();
    s.source.addFeatures(feats);
    notify(s, { geometry: true });
    return { count: feats.length, inheritedOwners };
  };

  const runEngineWorker = (data, fallback) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { bundle: ENGINE_BUNDLE, ...data }, stdout: true, stderr: true });
    worker.stdout.on("data", (chunk) => process.stderr.write(chunk));
    worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    worker.on("message", (msg = {}) => {
      if (msg.type === "done") finish(null, msg.result);
      if (msg.type === "error") finish(new Error(msg.message || fallback));
    });
    worker.on("error", (error) => finish(new Error(error?.message || fallback)));
    worker.on("exit", () => finish(new Error(fallback)));
  });

  const importProgress = (s, fraction, message) => emit("workshop.import.progress", { session: s.id, fraction, message });

  const runProvinceRaster = (s, payload) => new Promise((resolve, reject) => {
    s.importWorker?.terminate?.();
    const worker = new Worker(new URL(import.meta.url), { workerData: { ohProvinceRaster: true, bundle: ENGINE_BUNDLE, ...payload }, stdout: true, stderr: true });
    s.importWorker = worker;
    worker.stdout.on("data", (chunk) => process.stderr.write(chunk));
    worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (s.importWorker === worker) s.importWorker = null;
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    worker.on("message", (msg = {}) => {
      if (msg.type === "progress") {
        importProgress(s, Number(msg.fraction || 0), msg.message || "");
        return;
      }
      if (msg.type === "done") finish(null, msg.result);
      if (msg.type === "error") finish(new Error(msg.message || "Raster vectorization failed."));
    });
    worker.on("error", (error) => finish(new Error(error?.message || "Province importer worker crashed.")));
    worker.on("exit", () => finish(new Error("Province importer worker crashed.")));
  });

  const sha256Of = (text) => crypto.createHash("sha256").update(text).digest("hex");

  const createLibraryBasemap = (normalized, name, thumbnail, extra = {}) => {
    if (normalized.kind === "image") {
      return engine.wsBasemapLibrary.createBasemap({ name, kind: "image", aspect: normalized.aspect || null, thumbnail: thumbnail || null, contentHash: sha256Of(normalized.dataUrl), payload: { dataUrl: normalized.dataUrl }, ...extra });
    }
    return engine.wsBasemapLibrary.createBasemap({ name, kind: "vector", thumbnail: thumbnail || null, contentHash: sha256Of(JSON.stringify(normalized.geojson)), payload: { geojson: normalized.geojson }, ...extra });
  };

  const thumbnailSource = (background) => {
    const dir = path.join(cacheDir, "workshop-thumbnails");
    fs.mkdirSync(dir, { recursive: true });
    if (background?.kind === "image" && background.dataUrl) {
      const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(background.dataUrl));
      if (!match) return null;
      const mime = String(match[1] || "").toLowerCase();
      const ext = mime.includes("svg") ? "svg" : mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
      const file = path.join(dir, `${crypto.createHash("sha1").update(bytes).digest("hex")}.${ext}`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
      return { kind: "image", file, aspect: background.aspect || null };
    }
    if (background?.kind === "vector" && Array.isArray(background.geojson?.features)) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const squash = (lat) => (Math.atan(Math.sinh((lat * Math.PI) / 180)) * 180) / Math.PI;
      const ringOut = (ring) => ring.map(([x, y]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        return [x, squash(y)];
      });
      const features = background.geojson.features;
      const shapes = features.map((feature) => {
        const geom = feature?.geometry;
        if (geom?.type === "Polygon") return { type: "Polygon", coordinates: geom.coordinates.map(ringOut) };
        if (geom?.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: geom.coordinates.map((poly) => poly.map(ringOut)) };
        return null;
      });
      if (!Number.isFinite(minX)) return { kind: "vector", file: "", fills: [], bbox: null };
      const text = JSON.stringify({ type: "FeatureCollection", features: shapes.map((geometry) => ({ type: "Feature", properties: {}, geometry })) });
      const file = path.join(dir, `${sha256Of(text)}.geojson`);
      if (!fs.existsSync(file)) {
        fs.writeFileSync(`${file}.tmp`, text);
        fs.renameSync(`${file}.tmp`, file);
      }
      return { kind: "vector", file, fills: features.map((feature) => fillRgb(feature?.properties?.fill) ?? fillRgb("#33435c")), bbox: [minX, minY, maxX, maxY] };
    }
    return null;
  };

  const readUploadVector = async (target, format) => {
    let collections;
    if (format === "geojson" || format === "json") {
      collections = [JSON.parse(fs.readFileSync(target, "utf8"))];
    } else if (format === "zip") {
      const result = await engine.wsShp.default(fs.readFileSync(target));
      collections = Array.isArray(result) ? result : [result];
    } else {
      const sibling = (ext) => {
        const file = target.replace(/\.shp$/i, `.${ext}`);
        const upper = target.replace(/\.shp$/i, `.${ext.toUpperCase()}`);
        return fs.existsSync(file) ? file : fs.existsSync(upper) ? upper : "";
      };
      const dbf = sibling("dbf");
      const prj = sibling("prj");
      const cpg = sibling("cpg");
      const result = await engine.wsShp.default({
        shp: fs.readFileSync(target),
        ...(dbf ? { dbf: fs.readFileSync(dbf) } : {}),
        ...(prj ? { prj: fs.readFileSync(prj, "utf8") } : {}),
        ...(cpg ? { cpg: fs.readFileSync(cpg, "utf8") } : {}),
      });
      collections = Array.isArray(result) ? result : [result];
    }
    const feats = collections.flatMap((fc) => fmt.readFeatures(fc, READ));
    return fmt.writeFeaturesObject(feats, { ...WRITE, decimals: 6 });
  };

  return {
    "workshop.open": async ({ scenarioId, world = null, gameDate = "", warSettings = null, hasWarSettings = false, review = null } = {}) => {
      if (session) closeSession(session);
      const details = await lib.loadScenarioDetails(clean(scenarioId));
      const scenario = details.scenario;
      const s = newSession(scenario);
      session = s;
      try {
        const sourceWorld = world && typeof world === "object" ? world : details?.data?.world ?? {};
        const initialMap = await buildSeedFor(scenario, sourceWorld, { gameDate: gameDate || details?.data?.game?.gameDate || "", warSettings: hasWarSettings ? warSettings : undefined });
        if (session !== s) throw new Error("The map editor was closed.");
        s.initialMap = initialMap;
        await hydrate(s, initialMap);
        startReview(s, review);
      } catch (error) {
        closeSession(s);
        throw new Error(`The map editor was closed because this scenario's map could not be loaded, so nothing was saved over it. ${error?.message || error}`);
      }
      return { ...delta(s, { all: true }), scenario: { id: s.scenario.id, name: s.scenario.name }, bake: { file: s.bakeFile }, ...(s.review ? { review: reviewView(s) } : {}) };
    },
    "workshop.edit.rings": async ({ session: id, ids = [] } = {}) => plain({ rings: editRings(need(id), list(ids).map(String)) }),
    "workshop.edit.snap": async ({ session: id, at = [0, 0], resolution = 1, pixels = 10 } = {}) => {
      const s = need(id);
      const snapped = snapPoint(s, fromLonLat([Number(at[0]), Number(at[1])]), Math.max(0, Number(pixels) || 0) * Math.max(1e-6, Number(resolution) || 1));
      return { point: toLonLat(snapped.point), kind: snapped.kind };
    },
    "workshop.draw.point": async ({ session: id, at = [0, 0], previous = null, resolution = 1 } = {}) => {
      const s = need(id);
      const snapped = snapPoint(s, fromLonLat([Number(at[0]), Number(at[1])]), 10 * Math.max(1e-6, Number(resolution) || 1));
      let trace = [];
      if (Array.isArray(previous) && previous.length >= 2 && snapped.kind) {
        const prev = snapPoint(s, fromLonLat([Number(previous[0]), Number(previous[1])]), 0.05);
        if (prev.kind) trace = traceAlong(s, prev.point, snapped.point);
      }
      return plain({ point: toLonLat(snapped.point), kind: snapped.kind, trace: trace.map((c) => toLonLat(c)) });
    },
    "workshop.draw.finish": async ({ session: id, ring = [] } = {}) => {
      const s = need(id);
      const points = list(ring).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => snapPoint(s, fromLonLat([Number(p[0]), Number(p[1])]), 0.05).point);
      const distinct = points.filter((p, i) => i === 0 || !sameCoord(p, points[i - 1]));
      if (distinct.length > 1 && sameCoord(distinct[0], distinct[distinct.length - 1])) distinct.pop();
      if (distinct.length < 3) return { ...delta(s, {}), refused: "" };
      const f = new Feature({ geometry: new Polygon([[...distinct.map((p) => p.slice()), distinct[0].slice()]]) });
      f.setId(mapDoc.newId());
      f.setProperties({ typeId: (s.doc.types || [])[0]?.id || "land", owner: null, name: "New Region", gid0: "", country: "" });
      const cutter = f.getGeometry();
      const candidates = [];
      s.source.forEachFeatureIntersectingExtent(cutter.getExtent(), (other) => {
        if (other !== f) candidates.push(other);
      });
      s.source.addFeature(f);
      const carved = [];
      for (const other of candidates) {
        const geom = other.getGeometry();
        if (!geom || !geo.overlaps(geom, cutter)) continue;
        const before = geom.clone();
        const after = geo.subtractFrom(geom, cutter);
        if (!after) {
          s.source.removeFeature(other);
          carved.push({ feature: other, before, after: null });
        } else {
          other.setGeometry(after);
          other.set("edited", true);
          carved.push({ feature: other, before, after: after.clone() });
        }
      }
      notify(s, { geometry: true });
      pushCmd(s, {
        undo: () => {
          s.source.removeFeature(f);
          for (const c of carved) {
            c.feature.setGeometry(c.before.clone());
            if (!c.after) s.source.addFeature(c.feature);
          }
          s.geometryRev += 1;
        },
        redo: () => {
          s.source.addFeature(f);
          for (const c of carved) {
            if (!c.after) s.source.removeFeature(c.feature);
            else c.feature.setGeometry(c.after.clone());
          }
          s.geometryRev += 1;
        },
      });
      return { ...delta(s, { regions: true }), id: String(f.getId()) };
    },
    "workshop.edit.vertex": async ({ session: id, ids = [], op = "move", target = "", path = [], index = -1, to = null, alt = false, resolution = 1, mode = "modify" } = {}) => {
      const s = need(id);
      const wanted = list(ids).map(String);
      const feats = wanted.map((rid) => s.source.getFeatureById(rid)).filter(Boolean);
      const owner = s.source.getFeatureById(String(target));
      const unchanged = () => ({ ...delta(s, {}), rings: editRings(s, wanted), diagnostics: [] });
      if (!owner || !feats.includes(owner) || (mode === "border" && feats.length !== 2)) return unchanged();
      const res = Math.max(1e-6, Number(resolution) || 1);
      const ownGeom = owner.getGeometry();
      const ownRing = getRingAtPath(ownGeom.getCoordinates(), ownGeom.getType(), list(path).map(Number));
      const i = Number(index);
      if (!ownRing || !ownRing[i]) return unchanged();
      const before = shapeSnapshot(feats);
      const modified = new Set();
      const pointer = Array.isArray(to) ? fromLonLat([Number(to[0]), Number(to[1])]) : null;
      const editEach = (fn) => {
        for (const f of feats) {
          const geom = f.getGeometry();
          const type = geom.getType();
          if (type !== "Polygon" && type !== "MultiPolygon") continue;
          const coords = cloneCoords(geom.getCoordinates());
          let changed = false;
          for (const row of ringRefs(geom)) {
            const ring = getRingAtPath(coords, type, row.path);
            if (ring && fn(ring)) changed = true;
          }
          if (changed) {
            geom.setCoordinates(coords);
            modified.add(f);
          }
        }
      };
      const reach = (mode === "border" ? 24 : 18) * res;
      if (op === "move" && pointer) {
        const from = ownRing[i].slice();
        const dest = snapPoint(s, pointer, reach, { skip: from }).point;
        editEach((ring) => {
          let hit = false;
          for (let k = 0; k < ring.length; k += 1) {
            if (sameCoord(ring[k], from)) {
              ring[k] = dest.slice();
              hit = true;
            }
          }
          return hit;
        });
      } else if (op === "insert" && pointer && ownRing[i + 1]) {
        const a = ownRing[i].slice();
        const b = ownRing[i + 1].slice();
        const dest = snapPoint(s, pointer, reach).point;
        editEach((ring) => {
          for (let k = 0; k < ring.length - 1; k += 1) {
            if ((sameCoord(ring[k], a) && sameCoord(ring[k + 1], b)) || (sameCoord(ring[k], b) && sameCoord(ring[k + 1], a))) {
              ring.splice(k + 1, 0, dest.slice());
              return true;
            }
          }
          return false;
        });
      } else if (op === "remove") {
        const at = ownRing[i].slice();
        editEach((ring) => {
          if (ring.length <= 4) return false;
          const k = ring.findIndex((c, n) => n < ring.length - 1 && sameCoord(c, at));
          if (k < 0) return false;
          ring.splice(k, 1);
          if (k === 0) ring[ring.length - 1] = ring[0].slice();
          return true;
        });
      }
      if (mode === "border" && pointer) {
        const tolerance = Math.max(8, res * 24);
        if (op === "remove" || alt) {
          for (const f of feats) if (!modified.has(f)) removeSharedVertexNear(f, pointer, tolerance);
        } else {
          const shared = sharedBorderPoint(feats, pointer, tolerance);
          if (shared) feats.forEach((f) => weldPointIntoFeature(f, shared.point, tolerance));
        }
      }
      const touched = mode === "border" ? feats : [...modified];
      if (!touched.length) return unchanged();
      touched.forEach((f) => f.set("edited", true));
      const after = shapeSnapshot(feats);
      pushCmd(s, {
        undo: () => { shapeRestore(before); s.geometryRev += 1; },
        redo: () => { shapeRestore(after); s.geometryRev += 1; },
      });
      notify(s, { geometry: true });
      let diagnostics = [];
      if (mode === "border") {
        try {
          diagnostics = topologyTools(s).analyzeTopology(feats.map((f) => f.getId()), { maxWidth: 100 }).map((item) => ({ kind: item.kind, rings: geometryOutlines(item.geom) }));
        } catch (error) {
          console.warn("[editor] shared-border local topology check failed:", error);
        }
      }
      return { ...delta(s, { regions: true }), rings: editRings(s, wanted), diagnostics };
    },
    "workshop.basemapStyle": async ({ session: id } = {}) => {
      const s = need(id);
      const meta = s.doc.metadata || {};
      const background = meta.customBackground || null;
      const basemapId = engine.assets.resolveBasemapId({ overrideId: "", scenarioId: meta.basemap || "", fallbackId: engine.assets.DEFAULT_BASEMAP_ID });
      if (background?.kind === "plain") return { kind: "declared", basemapId, key: "plain" };
      if (background?.kind === "image" && background.dataUrl) {
        const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(background.dataUrl));
        const data = match ? (match[2] ? match[3] : Buffer.from(decodeURIComponent(match[3]), "utf8").toString("base64")) : "";
        const key = crypto.createHash("sha1").update(`${String(background.dataUrl).length}|${String(background.dataUrl).slice(-4096)}|${JSON.stringify(background.bounds ?? null)}`).digest("hex");
        return { kind: "image", basemapId, key, image: { quad: engine.wsMapProjection.imageQuad(background.bounds, { globe: false }), data } };
      }
      if (background?.kind === "vector" && Array.isArray(background.geojson?.features)) {
        const features = background.geojson.features;
        const text = JSON.stringify({ type: "FeatureCollection", features: features.map((feature) => ({ type: "Feature", properties: {}, geometry: feature?.geometry ?? null })) });
        const sha = crypto.createHash("sha256").update(text).digest("hex");
        const file = path.join(cacheDir, "workshop-backgrounds", `${sha}.geojson`);
        if (!fs.existsSync(file)) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(`${file}.tmp`, text);
          fs.renameSync(`${file}.tmp`, file);
        }
        return { kind: "vector", basemapId, key: sha, vector: { file, fills: features.map((feature) => fillRgb(feature?.properties?.fill) ?? fillRgb("#33435c")) } };
      }
      return { kind: "builtin", basemapId, key: basemapId };
    },
    "workshop.review.view": async ({ session: id } = {}) => plain(reviewView(need(id))),
    "workshop.review.markup": async ({ session: id } = {}) => plain(reviewMarkup(need(id))),
    "workshop.review.accept": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const r = s.review;
      if (!r) return { ...delta(s, {}), review: { active: false } };
      const wanted = new Set(list(ids).map(String));
      const chosen = r.changes.filter((change) => wanted.has(String(change.id)));
      const result = engine.wsSuggestionReview.acceptMapChanges(chosen, reviewCtx(s), { changes: r.changes, accepted: r.decisions.accepted, renames: r.renames });
      if (result.refused) return { ...delta(s, {}), review: reviewView(s), markup: reviewMarkup(s), refused: result.refused };
      if (result.accepted.length) {
        for (const [cid, undo] of result.undoers) r.undoers.set(cid, undo);
        r.renames = result.renames;
        reviewDecide(r, result.accepted, "accepted");
      }
      return { ...delta(s, { all: true }), review: reviewView(s), markup: reviewMarkup(s) };
    },
    "workshop.review.reject": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const r = s.review;
      if (!r) return { ...delta(s, {}), review: { active: false } };
      reviewDecide(r, list(ids).map(String), "rejected");
      return { ...delta(s, {}), review: reviewView(s), markup: reviewMarkup(s) };
    },
    "workshop.review.undo": async ({ session: id, changeId = "" } = {}) => {
      const s = need(id);
      const r = s.review;
      if (!r) return { ...delta(s, {}), review: { active: false } };
      const change = r.changes.find((entry) => String(entry.id) === String(changeId));
      if (!change) return { ...delta(s, {}), review: reviewView(s), markup: reviewMarkup(s) };
      if (r.decisions.accepted.has(change.id)) {
        if (!r.undoers.has(change.id)) return { ...delta(s, {}), review: reviewView(s), markup: reviewMarkup(s) };
        const refused = engine.wsSuggestionReview.undoRefusal(change, reviewCtx(s));
        if (refused) return { ...delta(s, {}), review: reviewView(s), markup: reviewMarkup(s), refused };
        r.undoers.get(change.id)();
        r.undoers.delete(change.id);
        if (change.kind === "polity-rename") {
          const next = { ...r.renames };
          delete next[change.from];
          r.renames = next;
        }
      }
      reviewDecide(r, [change.id], null);
      return { ...delta(s, { all: true }), review: reviewView(s), markup: reviewMarkup(s) };
    },
    "workshop.review.focus": async ({ session: id, changeId = "" } = {}) => {
      const s = need(id);
      const r = s.review;
      if (!r) return { review: { active: false } };
      r.focusId = String(changeId || "");
      const change = r.changes.find((entry) => String(entry.id) === r.focusId);
      let bounds = null;
      let point = null;
      if (change) {
        reviewStatuses(s);
        const targets = reviewTargets(s, change);
        if (targets.regionIds.length) bounds = unionExtent(targets.regionIds.map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean));
        else if (targets.shapes.length && Array.isArray(change.bbox)) bounds = [[Number(change.bbox[0]), Number(change.bbox[1])], [Number(change.bbox[2]), Number(change.bbox[3])]];
        else if (targets.points.length) point = [Number(targets.points[0][0]), Number(targets.points[0][1])];
      }
      return plain({ review: reviewView(s), markup: reviewMarkup(s), bounds, point });
    },
    "workshop.close": async ({ session: id } = {}) => {
      if (session && (!id || session.id === id)) closeSession(session);
      return true;
    },
    "workshop.flush": async ({ session: id } = {}) => {
      const s = need(id);
      if (!engine.wsDocumentSaving.isUnsavedStatus(s.saveStatus)) return { ok: true };
      const ok = await s.runSave();
      await s.runSave.idle?.();
      return { ok: Boolean(ok) && s.saveStatus === "saved", status: status(s) };
    },
    "workshop.regions": async ({ session: id } = {}) => delta(need(id), { regions: true }),
    "workshop.state": async ({ session: id } = {}) => delta(need(id), { all: true }),
    "workshop.summaries": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const summaries = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean).map(summarize);
      const owners = listOwners(s);
      const keys = new Set([...owners, ...Object.keys(s.doc.polities || {})]);
      const polityOptions = [...keys]
        .map((key) => ({ key, name: String(s.doc.polities?.[key]?.name || key) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
      return plain({ summaries, polityOptions, tagSuggestions: engine.wsCountryTags.TAG_SUGGESTIONS });
    },
    "workshop.paint": async ({ session: id, ids = [], owner = "", only = "*" } = {}) => {
      const s = need(id);
      const after = clean(owner) || null;
      const filter = clean(only) || "*";
      const visited = new Set();
      const rows = [];
      for (const rid of list(ids)) {
        const feature = s.source.getFeatureById(String(rid));
        if (!feature) continue;
        const key = feature.getId() ?? feature;
        if (visited.has(key)) continue;
        visited.add(key);
        const before = feature.get("owner") || null;
        if (!ownerAllowed(filter, feature) || before === after) continue;
        rows.push({ feature, before });
      }
      if (rows.length) {
        for (const row of rows) row.feature.set("owner", after, true);
        pushCmd(s, {
          undo: () => rows.forEach((row) => row.feature.set("owner", row.before, true)),
          redo: () => rows.forEach((row) => row.feature.set("owner", after, true)),
        });
        notify(s);
      }
      return delta(s, { regions: true });
    },
    "workshop.attrs": async ({ session: id, ids = [], patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (patch.claimantsDelta) {
        const deltaRows = patch.claimantsDelta;
        delete next.claimantsDelta;
        next.claimants = (current) => engine.wsClaimantEdits.applyClaimantDelta(current, deltaRows);
      }
      setRegionAttrs(s, list(ids).map(String), next);
      return delta(s, { regions: true });
    },
    "workshop.selectOwner": async ({ session: id, key = "", regionId = "" } = {}) => {
      const s = need(id);
      let owner = clean(key);
      if (!owner && regionId) {
        const hit = s.source.getFeatureById(String(regionId));
        if (!hit) return { ids: [] };
        owner = hit.get("owner") || "";
        if (!owner) return { ids: [String(regionId)] };
        return { ids: features(s).filter((f) => (f.get("owner") || null) === owner).map((f) => String(f.getId())), bounds: null };
      }
      const ids = selectOwner(s, owner).map(String);
      return { ids, bounds: unionExtent(ids.map((rid) => s.source.getFeatureById(rid)).filter(Boolean)) };
    },
    "workshop.selectGroup": async ({ session: id, name = "" } = {}) => {
      const s = need(id);
      const key = clean(name);
      const feats = key ? features(s).filter((f) => clean(f.get("group")) === key) : [];
      return { ids: feats.map((f) => String(f.getId())), bounds: unionExtent(feats) };
    },
    "workshop.bounds": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      return { bounds: unionExtent(list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean)) };
    },
    "workshop.lasso": async ({ session: id, ring = [] } = {}) => {
      const s = need(id);
      const coords = list(ring).map((point) => fromLonLat([Number(point[0]), Number(point[1])]));
      if (coords.length < 3) return { ids: [] };
      const poly = new Polygon([[...coords, coords[0]]]);
      const ids = [];
      s.source.forEachFeatureInExtent(poly.getExtent(), (f) => {
        const pt = interiorPoint(f.getGeometry());
        if (pt && poly.intersectsCoordinate(pt)) ids.push(String(f.getId()));
      });
      return { ids };
    },
    "workshop.queryRegions": async ({ session: id, text = "", limit = 300 } = {}) => {
      const s = need(id);
      const search = engine.wsRegionSearch;
      const q = String(text || "").trim().toLowerCase();
      const owners = search.ownersMatchingQuery(s.doc.polities, q);
      const out = [];
      for (const f of features(s)) {
        if (q && !search.regionMatchesQuery({ id: f.getId(), name: f.get("name"), owner: f.get("owner") }, q, owners)) continue;
        const row = summarize(f);
        out.push({ ...row, ownerName: search.polityDisplayName(s.doc.polities, row.owner) || "" });
        if (out.length >= limit) break;
      }
      return plain({ results: out });
    },
    "workshop.search": async ({ session: id, text = "" } = {}) => {
      const s = need(id);
      const q = String(text || "").trim().toLowerCase();
      if (q.length < 2) return { custom: [], regions: [], world: [] };
      const search = engine.wsRegionSearch;
      const custom = featureList(s).filter((f) => Array.isArray(f.coord) && String(f.name || "").toLowerCase().includes(q)).slice(0, 6);
      const owners = search.ownersMatchingQuery(s.doc.polities, q);
      const regions = [];
      for (const f of features(s)) {
        if (!search.regionMatchesQuery({ id: f.getId(), name: f.get("name"), owner: f.get("owner") }, q, owners)) continue;
        const row = summarize(f);
        regions.push({ ...row, ownerName: search.polityDisplayName(s.doc.polities, row.owner) || "" });
        if (regions.length >= 5) break;
      }
      const world = await engine.wsCitiesImport.searchSeedCities(q, 8);
      return plain({ custom, regions, world });
    },
    "workshop.polities": async ({ session: id } = {}) => {
      const s = need(id);
      return plain({ usage: listPolityUsage(s) });
    },
    "workshop.ownerRegions": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const owner = clean(key);
      if (!owner) return { regions: [] };
      return plain({
        regions: features(s)
          .filter((f) => clean(f.get("owner")) === owner)
          .map((f) => ({ id: String(f.getId()), name: clean(f.get("name")), typeId: f.get("typeId") || "land" }))
          .sort((a, b) => (a.name || String(a.id)).localeCompare(b.name || String(b.id))),
      });
    },
    "workshop.polity.create": async ({ session: id, name = "", assign = [] } = {}) => {
      const s = need(id);
      const key = clean(name);
      if (!key) return delta(s, {});
      const usage = new Set(listPolityUsage(s).map((row) => row.key));
      if (Object.prototype.hasOwnProperty.call(s.doc.polities || {}, key) || usage.has(key)) {
        return { ...delta(s, {}), refused: `A polity named “${key}” already exists.` };
      }
      upsertPolity(s, key, { name: key, code: key, aliases: [key], status: "active", note: "" });
      if (list(assign).length) setRegionAttrs(s, list(assign).map(String), { owner: key });
      return { ...delta(s, { regions: true }), key };
    },
    "workshop.polity.createNamed": async ({ session: id, name = "", assign = [] } = {}) => {
      const s = need(id);
      const text = clean(name);
      if (!text) return delta(s, {});
      upsertPolity(s, text, { name: text, code: text, aliases: [text], status: "active", note: "" });
      if (list(assign).length) setRegionAttrs(s, list(assign).map(String), { owner: text });
      return { ...delta(s, { regions: true }), key: text };
    },
    "workshop.polity.upsert": async ({ session: id, key = "", patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "populationText")) {
        const people = engine.wsPopulation.readPopulationFigure(next.populationText);
        delete next.populationText;
        next.population = people > 0 ? people : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(next, "military") && next.military === null) next.military = undefined;
      upsertPolity(s, key, next);
      return delta(s, { doc: true });
    },
    "workshop.polity.rename": async ({ session: id, key = "", name = "" } = {}) => {
      const s = need(id);
      const from = clean(key);
      const to = clean(name);
      if (!from || !to || from === to) return { ...delta(s, {}), renamed: false };
      const names = [...Object.keys(s.doc.polities || {}), ...listPolityUsage(s).map((row) => row.key)];
      const clash = names.find((other) => rename.samePolityName(other, to) && !rename.samePolityName(other, from));
      if (clash) {
        return { ...delta(s, {}), renamed: false, refused: `“${to}” is already the name of another polity (“${clash}”). A rename cannot merge two countries.` };
      }
      renameOwner(s, from, to);
      renamePolityDoc(s, from, to);
      s.polityAuthoringOps.push({ op: "rename", from, to });
      return { ...delta(s, { regions: true, features: true, units: true, war: true }), renamed: true, to };
    },
    "workshop.polity.remove": async ({ session: id, keys = [] } = {}) => {
      const s = need(id);
      const stableKeys = [...new Set(list(keys).map((key) => clean(key)).filter(Boolean))];
      if (!stableKeys.length) return delta(s, {});
      removeOwners(s, stableKeys);
      removePolitiesDoc(s, stableKeys);
      for (const key of stableKeys) s.polityAuthoringOps.push({ op: "remove", key });
      return delta(s, { regions: true });
    },
    "workshop.polity.transfer": async ({ session: id, from = "", to = "" } = {}) => {
      const s = need(id);
      if (!clean(to) || !clean(from) || clean(from) === clean(to)) return delta(s, {});
      const ids = selectOwner(s, from);
      if (ids.length) setRegionAttrs(s, ids, { owner: clean(to) });
      return delta(s, { regions: true });
    },
    "workshop.polity.color": async ({ session: id, key = "", rgb = null } = {}) => {
      const s = need(id);
      setColorOverride(s, key, Array.isArray(rgb) ? rgb.slice(0, 3).map((value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)))) : null);
      return delta(s, { regions: true });
    },
    "workshop.polity.flag": async ({ session: id, key = "", value = null } = {}) => {
      const s = need(id);
      setFlag(s, key, value || null);
      return delta(s, { doc: true });
    },
    "workshop.polity.tags": async ({ session: id, key = "", tags = [] } = {}) => {
      const s = need(id);
      setTags(s, key, list(tags));
      return delta(s, { doc: true });
    },
    "workshop.puppets.overlord": async ({ session: id, polity = "", overlord = "" } = {}) => {
      const s = need(id);
      const result = engine.wsPuppets.setOverlord(s.doc.puppets || [], polity, overlord);
      if (!result.error) setters(s).puppets(result.puppets);
      return { ...delta(s, { doc: true }), error: result.error || "" };
    },
    "workshop.puppets.patch": async ({ session: id, polity = "", patch = {} } = {}) => {
      const s = need(id);
      setters(s).puppets(engine.wsPuppets.patchPuppetRow(s.doc.puppets || [], polity, patch));
      return delta(s, { doc: true });
    },
    "workshop.puppets.view": async ({ session: id, polity = "" } = {}) => {
      const s = need(id);
      const puppets = engine.wsPuppets;
      const choices = polityChoices(s);
      return plain({
        own: puppets.overlordRowOf(s.doc.puppets || [], polity),
        held: puppets.puppetRowsOf(s.doc.puppets || [], polity),
        options: puppets.overlordChoicesFor(s.doc.puppets || [], polity, choices.map((row) => row.key)),
        kinds: puppets.PUPPET_KIND_OPTIONS,
        secrecy: puppets.PUPPET_SECRECY_OPTIONS,
        coupLoyalty: puppets.PUPPET_COUP_LOYALTY,
      });
    },
    "workshop.military.view": async ({ session: id, value = null } = {}) => {
      const form = engine.wsMilitaryForm;
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(value);
      const fields = ["quality", "technology", "spending", "weariness", "land", "sea", "air", "manpowerShare", "menPerCounter", "cavalryShare", "siegeShare"];
      const s = id ? need(id) : session;
      const defaults = s?.initialMap?.militaryDefaults ?? null;
      return plain({
        kept,
        texts: Object.fromEntries(fields.map((field) => [field, form.militaryFieldText(kept, field)])),
        mix: form.unitMixEra(defaults),
        defaults,
        defaultsText: defaults ? {
          manpowerShare: String(defaults.manpowerShare),
          menPerCounter: engine.wsPopulation.formatPopulationFigure(defaults.menPerCounter),
          cavalryShare: String(Math.round(Number(defaults.cavalryShare) * 1000) / 10),
          siegeShare: String(Math.round(Number(defaults.siegeShare) * 1000) / 10),
        } : null,
      });
    },
    "workshop.military.field": async ({ value = null, field = "", text = "" } = {}) => {
      const form = engine.wsMilitaryForm;
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(value);
      const { military, ok } = form.withMilitaryField(kept, field, text);
      return plain({ ok, military: ok ? military : kept, text: form.militaryFieldText(ok ? military : kept, field), changed: ok && JSON.stringify(military) !== JSON.stringify(kept) });
    },
    "workshop.population.format": async ({ text = "", value = null } = {}) => {
      const people = value !== null ? Number(value) || 0 : engine.wsPopulation.readPopulationFigure(text);
      return { people, text: engine.wsPopulation.formatPopulationFigure(people) };
    },
    "workshop.military.muster": async ({ value = null, points = null } = {}) => {
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(value);
      const next = engine.wsMilitaryForm.withMilitaryMuster(kept, points);
      return plain({ military: next, changed: JSON.stringify(next) !== JSON.stringify(kept) });
    },
    "workshop.military.rate": async ({ session: id, kind = "polity", key = "" } = {}) => {
      const s = need(id);
      const defaults = s.initialMap?.militaryDefaults ?? null;
      const groups = s.doc.groups || {};
      const record = kind === "group" ? (groups[key] ?? {}) : (s.doc.polities?.[key] ?? {});
      const figures = await engine.wsMilitaryRating.rateMilitaryFigures({
        name: kind === "group" ? key : (record?.name || key),
        note: kind === "group" ? record?.description : record?.note,
        population: record?.population,
        rated: kind === "group" ? engine.wsMilitaryForm.militaryScaleOf({}, groups) : engine.wsMilitaryForm.militaryScaleOf(s.doc.polities, kind === "inspector" ? groups : undefined),
        date: defaults?.gameDate,
        era: Number.isInteger(defaults?.era) ? defaults.era : null,
        rules: defaults?.rules,
      });
      const kept = engine.wsMilitaryStats.normalizeMilitaryStats(record?.military);
      const next = engine.wsMilitaryStats.normalizeMilitaryStats({ ...(figures ?? {}), ...(kept ?? {}) });
      if (next && JSON.stringify(next) !== JSON.stringify(kept)) {
        if (kind === "group") {
          const name = key;
          const base = groups[name] ?? { name, description: "", color: groupsLib.defaultGroupColor(name) };
          setters(s).groups((registry) => ({ ...registry, [name]: { ...base, ...(registry?.[name] ?? {}), military: next, name } }));
        } else {
          upsertPolity(s, key, { military: next });
        }
      }
      return delta(s, { doc: true });
    },
    "workshop.roster.read": async ({ session: id, path: file = "" } = {}) => {
      const s = need(id);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(clean(file), "utf8"));
      } catch (error) {
        return { message: error?.message || String(error) };
      }
      const rosterRowsFromJson = (value) => {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];
        if (Array.isArray(value.polities)) return value.polities;
        if (Array.isArray(value.roster)) return value.roster;
        if (Array.isArray(value.countries)) return value.countries;
        const keyed = value.polities && typeof value.polities === "object" && !Array.isArray(value.polities) ? value.polities : value;
        const ignoredTopLevel = new Set(["format", "track", "scenario", "derivation", "metadata", "version"]);
        const rows = [];
        for (const [key, record] of Object.entries(keyed || {})) {
          if (ignoredTopLevel.has(key)) continue;
          if (!record || typeof record !== "object" || Array.isArray(record)) continue;
          rows.push({ key, ...record });
        }
        return rows;
      };
      const rawRows = rosterRowsFromJson(parsed);
      const seen = new Set();
      const rows = [];
      let invalid = 0;
      let duplicates = 0;
      for (const row of rawRows) {
        const key = engine.wsPolityRoster.rosterRowKey(row);
        if (!key) {
          invalid += 1;
          continue;
        }
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        seen.add(key);
        rows.push({ ...row, key });
      }
      if (!rows.length) return { message: "No usable polity records were found in that JSON file." };
      const existing = rows.filter((row) => Object.prototype.hasOwnProperty.call(s.doc.polities || {}, row.key)).length;
      const fileName = path.basename(clean(file));
      return plain({
        preview: {
          fileName,
          rows,
          invalid,
          duplicates,
          existing,
          fresh: rows.length - existing,
          incomingColors: rows.filter((row) => row.color || row.rgb || row.colour).length,
          incomingTags: rows.filter((row) => (Array.isArray(row.tags) ? row.tags.length : clean(row.tags))).length,
          incomingFlags: rows.filter((row) => clean(row.flag || row.flagUrl || row.flag_url || row.flagDataUrl)).length,
        },
      });
    },
    "workshop.roster.apply": async ({ session: id, rows = [] } = {}) => {
      const s = need(id);
      const summary = importPolityRoster(s, list(rows));
      return { ...delta(s, { regions: true }), summary: plain(summary) };
    },
    "workshop.flags.fillPlan": async ({ session: id } = {}) => {
      const s = need(id);
      const usage = listPolityUsage(s);
      const keys = new Set([...Object.keys(s.doc.polities || {}), ...usage.map((row) => row.key)]);
      const importRows = [];
      let unresolved = 0;
      let alreadyFlagged = 0;
      const uniqueStandardFlagForCandidates = (candidates) => {
        const codes = new Set();
        for (const candidate of candidates || []) {
          const code = engine.wsPolityIdentity.resolveStockCountryCode(candidate);
          if (code) codes.add(code);
        }
        if (codes.size !== 1) return null;
        return engine.countryFlags.flagImageUrlFromGid([...codes][0]);
      };
      for (const key of keys) {
        const record = s.doc.polities?.[key] || null;
        if (s.doc.flags?.[key]) {
          alreadyFlagged += 1;
          continue;
        }
        const name = clean(record?.name) || key;
        const aliases = Array.isArray(record?.aliases) ? record.aliases : [];
        const flag = uniqueStandardFlagForCandidates([record?.code, key, name, ...aliases]);
        if (!flag) {
          unresolved += 1;
          continue;
        }
        importRows.push({ key, name, aliases, status: record?.status || "active", note: record?.note || "", mapRefs: record?.mapRefs || null, flag });
      }
      return plain({ importRows, unresolved, alreadyFlagged });
    },
    "workshop.flags.catalog": async ({ session: id, owner = "" } = {}) => {
      const s = need(id);
      const flags = engine.wsBuiltInFlags;
      const builtIn = flags.builtInFlagChoices();
      const suggested = flags.suggestedBuiltInFlag(builtIn, owner);
      const mine = await engine.wsFlagLibrary.listFlags();
      const withFile = (row, value) => ({ ...row, file: flagFileOf(value) });
      return plain({
        builtIn: builtIn.map((flag) => withFile({ code: flag.code, name: flag.name, alpha2: flag.alpha2, imageUrl: flag.imageUrl }, flag.imageUrl)),
        suggested: suggested ? withFile({ code: suggested.code, name: suggested.name, imageUrl: suggested.imageUrl }, suggested.imageUrl) : null,
        inThisMap: Object.entries(s.doc.flags || {}).map(([code, value]) => withFile({ code, value }, value)),
        mine: (Array.isArray(mine) ? mine : []).map((flag) => withFile({ id: flag.id, name: flag.name, code: flag.code, polity: flag.polity, dataUrl: flag.dataUrl, author: flag.author || "", community: Boolean(flag.source?.community), communityUrl: flag.source?.url || null }, flag.dataUrl)),
        current: s.doc.flags?.[owner] ?? null,
        author: s.doc.metadata?.author || "",
      });
    },
    "workshop.flags.filter": async ({ query = "" } = {}) => {
      const flags = engine.wsBuiltInFlags;
      return plain({ codes: flags.filterBuiltInFlags(flags.builtInFlagChoices(), query).map((flag) => flag.code) });
    },
    "workshop.flags.save": async ({ session: id, owner = "", name = "", dataUrl = "" } = {}) => {
      const s = need(id);
      try {
        await engine.wsFlagLibrary.saveFlag({ name: clean(name) || owner || "Flag", code: owner || "", polity: owner || "", author: s.doc.metadata?.author || "", dataUrl });
      } catch (error) {
        console.warn("[editor] could not save flag to the library:", error);
      }
      setFlag(s, owner, dataUrl);
      return delta(s, { doc: true });
    },
    "workshop.flags.community": async ({ force = false } = {}) => {
      const flagsHub = engine.ctCommunityFlags;
      try {
        flagPosts = list(await flagsHub.fetchCommunityFlags({ force: Boolean(force) }));
        return plain({
          hubUrl: flagsHub.communityFlagsHubUrl(),
          posts: flagPosts.map((post) => ({
            id: String(post.id ?? ""),
            title: clean(post.title),
            author: clean(post.author),
            url: post.url || null,
            pictureUrl: post.pictureUrl || "",
            code: clean(post.code),
            polity: clean(post.polity),
            fromScenario: Boolean(post.fromScenario),
            flagCount: Number(post.flagCount || 0),
            official: Boolean(post.official),
          })),
        });
      } catch (error) {
        return { error: error?.message || "Could not load community flags." };
      }
    },
    "workshop.flags.useCommunity": async ({ postId = "" } = {}) => {
      const post = flagPosts.find((entry) => String(entry.id ?? "") === String(postId));
      try {
        if (!post) throw new Error("Could not download that flag.");
        const dataUrl = await engine.ctCommunityFlags.loadCommunityFlagDataUrl(post);
        try {
          await engine.wsFlagLibrary.saveFlag({
            name: post.title || post.polity || post.code || "Flag",
            code: post.polity || post.code || "",
            polity: post.polity || "",
            author: post.author || "",
            dataUrl,
            source: { community: true, url: post.url || null },
          });
        } catch (error) {
          console.warn("[editor] could not save the community flag to the library:", error);
        }
        return { dataUrl };
      } catch (error) {
        return { error: error?.message || "Could not download that flag." };
      }
    },
    "workshop.flags.installPack": async ({ postId = "" } = {}) => {
      const post = flagPosts.find((entry) => String(entry.id ?? "") === String(postId));
      try {
        if (!post) throw new Error("Could not install that flag pack.");
        const flags = await engine.ctCommunityFlags.loadCommunityFlagPack(post);
        let saved = 0;
        for (const flag of flags) {
          try {
            await engine.wsFlagLibrary.saveFlag({
              name: flag.code || post.title,
              code: flag.code || "",
              polity: flag.code || "",
              author: post.author || "",
              dataUrl: flag.dataUrl,
              source: { community: true, url: post.url || null },
            });
            saved += 1;
          } catch {
            continue;
          }
        }
        return { notice: `Added ${saved} flag${saved === 1 ? "" : "s"} from “${post.title}” to My flags — they're in the “In the game” tab now.` };
      } catch (error) {
        return { error: error?.message || "Could not install that flag pack." };
      }
    },
    "workshop.flags.shareForm": async ({ name = "", author = "", polity = "", code = "" } = {}) => {
      const hub = String(engine.ctCommunityFlags.communityFlagsHubUrl()).split("/issues")[0];
      return { url: `${hub}/issues/new?${engine.ctCommunityFlags.flagPublishQuery({ name, author, polity, code })}` };
    },
    "workshop.flags.share": async ({ name = "", author = "", polity = "", code = "", dataUrl = "" } = {}) => {
      const flagsHub = engine.ctCommunityFlags;
      try {
        const text = String(dataUrl || "");
        if (!/^data:[^,]*;base64,/.test(text)) throw new Error("This flag has no image to share.");
        const fileName = flagsHub.flagFileName(name || polity, text);
        const folder = process.env.OH_NATIVE_DOWNLOADS || path.join(os.homedir(), "Downloads", "Open Historia");
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, fileName);
        fs.writeFileSync(file, Buffer.from(text.slice(text.indexOf(",") + 1), "base64"));
        const hub = String(flagsHub.communityFlagsHubUrl()).split("/issues")[0];
        return { file, url: `${hub}/issues/new?${flagsHub.flagPublishQuery({ name, author, polity, code })}`, message: `"${fileName}" was downloaded. On the GitHub page that opened, drag that file into the flag image box, then submit.` };
      } catch (error) {
        return { error: `Could not prepare that flag for sharing: ${error?.message || error}` };
      }
    },
    "workshop.flags.delete": async ({ id: flagId = "" } = {}) => {
      try {
        await engine.wsFlagLibrary.deleteFlag(flagId);
        return { ok: true };
      } catch (error) {
        return { error: `Could not delete that flag: ${error?.message || error}` };
      }
    },
    "workshop.feature.add": async ({ session: id, coord = null, regionId = null, mapFeature = false } = {}) => {
      const s = need(id);
      const fid = mapDoc.newId("feat");
      const hit = regionId ? s.source.getFeatureById(String(regionId)) : null;
      const partial = {
        coord: [Number(Number(coord?.[0]).toFixed(5)), Number(Number(coord?.[1]).toFixed(5))],
        regionId: hit ? hit.getId() : null,
        owner: hit ? hit.get("owner") || null : null,
        country: hit ? hit.get("country") || "" : "",
      };
      if (mapFeature) {
        setters(s).features((rows) => [...rows, engine.wsMapFeatures.newMapFeature({ id: fid, ...partial })]);
      } else {
        setters(s).features((rows) => [...rows, { id: fid, name: "New City", type: "Coordinate", symbol: "square", tags: ["city"], population: 250000, ...partial }]);
      }
      return { ...delta(s, { features: true }), id: fid };
    },
    "workshop.feature.addCity": async ({ session: id, city = {} } = {}) => {
      const s = need(id);
      const fid = mapDoc.newId("feat");
      setters(s).features((rows) => [...rows, {
        id: fid,
        name: city.name,
        type: "Coordinate",
        symbol: "square",
        coord: city.coord,
        country: city.country || "",
        owner: null,
        regionId: null,
        population: city.population || 0,
        tags: city.capital ? ["city", "capital"] : ["city"],
      }]);
      return { ...delta(s, { features: true }), id: fid };
    },
    "workshop.feature.update": async ({ session: id, featureId = "", patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "populationByYearText")) {
        const out = {};
        for (const line of String(next.populationByYearText || "").split(/\n/)) {
          const match = /^\s*(-?\d{1,6})\s*[:=,\s]\s*([\d.,_\s]+)$/.exec(line);
          if (!match) continue;
          const year = Number(match[1]);
          const population = Number(match[2].replace(/[,_\s]/g, ""));
          if (Number.isInteger(year) && year !== 0 && Number.isFinite(population) && population > 0) out[year] = Math.round(population);
        }
        delete next.populationByYearText;
        next.populationByYear = Object.keys(out).length ? out : undefined;
      }
      setters(s).features((rows) => rows.map((f) => (f.id === featureId ? { ...f, ...next } : f)));
      const row = featureById(s, featureId);
      return plain({ session: s.id, status: status(s), feature: row ? featuresPart({ doc: { features: [row] } })[0] : null });
    },
    "workshop.feature.remove": async ({ session: id, featureId = "", undoable = false } = {}) => {
      const s = need(id);
      const step = undoLib.removeRowStep(featureList(s), setters(s).features, featureId);
      if (undoable && step) pushCmd(s, step);
      return delta(s, { features: true });
    },
    "workshop.feature.removeMany": async ({ session: id, ids = [], all = false } = {}) => {
      const s = need(id);
      const wanted = new Set(list(ids).map(String));
      const step = undoLib.removeRowsStep(featureList(s), setters(s).features, all ? () => true : (f) => wanted.has(String(f.id)));
      if (step) pushCmd(s, step);
      return delta(s, { features: true });
    },
    "workshop.feature.tagMany": async ({ session: id, ids = [], tag = "", add = true } = {}) => {
      const s = need(id);
      const wanted = new Set(list(ids).map(String));
      const value = clean(tag);
      if (!value || !wanted.size) return delta(s, {});
      if (add) setters(s).features((rows) => rows.map((f) => (wanted.has(String(f.id)) && !(f.tags || []).includes(value) ? { ...f, tags: [...(f.tags || []), value] } : f)));
      else setters(s).features((rows) => rows.map((f) => (wanted.has(String(f.id)) ? { ...f, tags: (f.tags || []).filter((t) => t !== value) } : f)));
      return delta(s, { features: true });
    },
    "workshop.feature.import": async ({ session: id, mode = "major", confirmed = false } = {}) => {
      const s = need(id);
      const cities = engine.wsCitiesImport;
      let imported;
      try {
        imported = mode === "all" ? await cities.importAllCities() : await cities.importMajorCities();
      } catch (error) {
        console.warn("[editor] city import failed:", error);
        return { ...delta(s, {}), note: "Import failed: the city list could not be downloaded. Check the connection and try again." };
      }
      const added = engine.wsFeatureImport.mergeImportedFeatures(featureList(s), imported).added;
      if (mode === "all" && added >= 1000 && !confirmed) {
        const mb = (cities.estimateJsonBytes(imported) * (added / imported.length)) / 1e6;
        const megabytes = mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
        return { ...delta(s, {}), ask: `Add ${added.toLocaleString("en-US")} cities to this map? That is about ${megabytes} MB more in the map, its saves and the scenario, and so many cities can make the Workshop and the game slow, especially on phones.` };
      }
      setters(s).features((rows) => engine.wsFeatureImport.mergeImportedFeatures(rows, imported).features);
      return { ...delta(s, { features: true }), note: added === 0 ? "Every one of those cities is already on this map." : added === 1 ? "Added 1 city." : `Added ${added} cities.` };
    },
    "workshop.feature.importFile": async ({ session: id, path: file = "" } = {}) => {
      const s = need(id);
      try {
        const { features: imported, skipped, format } = engine.wsFeatureImport.parseFeatureImport(fs.readFileSync(clean(file), "utf8"));
        const outcome = engine.wsFeatureImport.mergeImportedFeatures(featureList(s), imported);
        setters(s).features(outcome.features);
        const name = path.basename(clean(file));
        return {
          ...delta(s, { features: true }),
          note: `Imported ${outcome.added} feature${outcome.added === 1 ? "" : "s"} from ${name} (${format})`
            + (outcome.duplicates ? `, ${outcome.duplicates} already here` : "")
            + (skipped ? `, ${skipped} entr${skipped === 1 ? "y" : "ies"} without a usable point skipped` : "")
            + ".",
        };
      } catch (error) {
        return { ...delta(s, {}), note: `Import failed: ${error?.message || error}` };
      }
    },
    "workshop.unit.add": async ({ session: id, lng = 0, lat = 0, regionId = null } = {}) => {
      const s = need(id);
      const uid = mapDoc.newId("unit");
      const hit = regionId ? s.source.getFeatureById(String(regionId)) : null;
      setters(s).units((rows) => [...rows, {
        id: uid,
        name: "New unit",
        type: "infantry",
        strength: 100,
        composition: "",
        note: "",
        lng: Number(Number(lng).toFixed(5)),
        lat: Number(Number(lat).toFixed(5)),
        ownerCode: hit ? hit.get("owner") || "" : "",
        regionId: hit ? hit.getId() : null,
      }]);
      return { ...delta(s, { units: true }), id: uid };
    },
    "workshop.unit.update": async ({ session: id, unitId = "", patch = {} } = {}) => {
      const s = need(id);
      setters(s).units((rows) => rows.map((u) => (u.id === unitId ? { ...u, ...patch } : u)));
      return delta(s, { units: true });
    },
    "workshop.unit.remove": async ({ session: id, unitId = "", undoable = false } = {}) => {
      const s = need(id);
      if (undoable) {
        const step = undoLib.removeRowStep(s.doc.units || [], setters(s).units, unitId);
        if (step) pushCmd(s, step);
      } else {
        setters(s).units((rows) => rows.filter((u) => u.id !== unitId));
      }
      return delta(s, { units: true });
    },
    "workshop.unit.removeAll": async ({ session: id } = {}) => {
      const s = need(id);
      setters(s).units([]);
      return delta(s, { units: true });
    },
    "workshop.group.create": async ({ session: id, name = "", selection = [] } = {}) => {
      const s = need(id);
      const groupName = groupsLib.normalizeGroupName(name);
      if (!groupName) return delta(s, {});
      const usage = listGroupUsage(s);
      const names = [...new Set([...Object.keys(s.doc.groups || {}), ...Object.keys(usage)])].sort((a, b) => a.localeCompare(b));
      const recordOf = (key) => s.doc.groups?.[key] ?? { name: key, description: "", color: groupsLib.defaultGroupColor(key) };
      const clash = groupsLib.findGroupKey(Object.fromEntries(names.map((key) => [key, recordOf(key)])), groupName);
      if (clash) return { ...delta(s, {}), note: `There is already a group called ${clash}.` };
      const color = groupsLib.GROUP_PALETTE[names.length % groupsLib.GROUP_PALETTE.length];
      setters(s).groups((registry) => ({ ...registry, [groupName]: { name: groupName, description: "", color } }));
      let note = "";
      if (list(selection).length) {
        setRegionAttrs(s, list(selection).map(String), { group: groupName });
        note = `${groupName} controls the ${list(selection).length === 1 ? "selected region" : `${list(selection).length} selected regions`}.`;
      }
      return { ...delta(s, { regions: true }), name: groupName, note };
    },
    "workshop.group.patch": async ({ session: id, name = "", patch = {} } = {}) => {
      const s = need(id);
      const next = { ...patch };
      if (Object.prototype.hasOwnProperty.call(next, "populationText")) {
        const people = engine.wsPopulation.readPopulationFigure(next.populationText);
        delete next.populationText;
        next.population = people > 0 ? people : undefined;
      }
      if (Object.prototype.hasOwnProperty.call(next, "descriptionFinal")) {
        next.description = groupsLib.normalizeGroupDescription(next.descriptionFinal);
        delete next.descriptionFinal;
      }
      if (Object.prototype.hasOwnProperty.call(next, "military") && next.military === null) next.military = undefined;
      const recordOf = (key) => s.doc.groups?.[key] ?? { name: key, description: "", color: groupsLib.defaultGroupColor(key) };
      setters(s).groups((registry) => {
        const record = { ...recordOf(name), ...(registry?.[name] ?? {}), ...next, name };
        for (const [field, value] of Object.entries(next)) if (value === undefined) delete record[field];
        return { ...registry, [name]: record };
      });
      return delta(s, { regions: true });
    },
    "workshop.group.rename": async ({ session: id, from = "", to: target = "" } = {}) => {
      const s = need(id);
      const to = groupsLib.normalizeGroupName(target);
      const usage = listGroupUsage(s);
      const names = [...new Set([...Object.keys(s.doc.groups || {}), ...Object.keys(usage)])];
      if (!from || !to || to === from) return { ...delta(s, {}), name: from };
      const clash = names.find((other) => other !== from && other.toLocaleLowerCase() === to.toLocaleLowerCase());
      if (clash) return { ...delta(s, {}), name: from, note: `There is already a group called ${clash}.` };
      const recordOf = (key) => s.doc.groups?.[key] ?? { name: key, description: "", color: groupsLib.defaultGroupColor(key) };
      const steps = undoLib.groupRenameSteps(setters(s).groups, from, to, recordOf(from));
      const touched = features(s).filter((f) => clean(f.get("group")) === from);
      const apply = (value) => touched.forEach((f) => f.set("group", value || null));
      apply(to);
      steps.redo();
      notify(s);
      pushCmd(s, { undo: () => { apply(from); steps.undo(); }, redo: () => { apply(to); steps.redo(); } });
      return { ...delta(s, { regions: true }), name: to, note: `Renamed to ${to}.` };
    },
    "workshop.group.erase": async ({ session: id, name = "" } = {}) => {
      const s = need(id);
      const steps = undoLib.groupEraseSteps(setters(s).groups, name, s.doc.groups?.[name] ?? null);
      const touched = features(s).filter((f) => clean(f.get("group")) === name);
      const apply = (value) => touched.forEach((f) => f.set("group", value || null));
      apply(null);
      steps.redo();
      notify(s);
      pushCmd(s, { undo: () => { apply(name); steps.undo(); }, redo: () => { apply(null); steps.redo(); } });
      return { ...delta(s, { regions: true }), note: `${name} erased, and its area with it.` };
    },
    "workshop.groups.usage": async ({ session: id } = {}) => plain({ usage: listGroupUsage(need(id)), palette: groupsLib.GROUP_PALETTE }),
    "workshop.types.set": async ({ session: id, types = [] } = {}) => {
      const s = need(id);
      setters(s).types(list(types));
      return delta(s, { regions: true });
    },
    "workshop.types.usage": async ({ session: id } = {}) => {
      const s = need(id);
      const m = {};
      for (const f of features(s)) {
        const t = f.get("typeId") || "land";
        m[t] = (m[t] || 0) + 1;
      }
      return { usage: m };
    },
    "workshop.freezing": async ({ session: id, ids = [], on = true } = {}) => {
      const s = need(id);
      const step = undoLib.membershipStep(s.doc.freezingRegions || [], setters(s).freezingRegions, list(ids).map(String), Boolean(on));
      if (step) pushCmd(s, step);
      return delta(s, { war: true, doc: true });
    },
    "workshop.meta": async ({ session: id, patch = {} } = {}) => {
      const s = need(id);
      const allowed = {};
      for (const key of ["name", "author"]) if (Object.prototype.hasOwnProperty.call(patch, key)) allowed[key] = String(patch[key] ?? "");
      patchMetadata(s, allowed);
      return delta(s, { doc: true });
    },
    "workshop.projection.view": async ({ session: id, patch = {} } = {}) => {
      const s = need(id);
      const next = { ...engine.wsMapProjection.normalizeProjection(s.doc.metadata?.projection) };
      for (const [key, on] of Object.entries(patch)) {
        if (on) delete next[key];
        else next[key] = false;
      }
      patchMetadata(s, { projection: next });
      return delta(s, { doc: true });
    },
    "workshop.projection.options": async ({ session: id } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const convert = engine.wsProjectionConvert;
      return plain({
        projections: projection.PROJECTIONS.map((entry) => ({ id: entry.id, name: entry.name })),
        current: projection.normalizeProjection(s.doc.metadata?.projection),
        freeform: projection.FREEFORM,
        hasPicture: s.doc.metadata?.customBackground?.kind === "image",
        pictureFile: s.doc.metadata?.customBackground?.kind === "image" ? (thumbnailSource(s.doc.metadata.customBackground)?.file || "") : "",
        blocked: convert.hasDetailedMap(s.doc) ? convert.DETAILED_MAP_CONVERSION_MESSAGE : "",
      });
    },
    "workshop.projection.check": async ({ session: id, type = "", shape = "", pictureAspect = 0 } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const convert = engine.wsProjectionConvert;
      const current = projection.normalizeProjection(s.doc.metadata?.projection);
      const aspect = convert.parseAspect(shape);
      const chosen = type === projection.FREEFORM ? (aspect ? convert.projectionChoice(type, aspect) : null) : convert.projectionChoice(type);
      const picture = Number(pictureAspect) > 0 ? Number(pictureAspect) : 0;
      return plain({ aspectOk: Boolean(aspect), chosen, changed: Boolean(chosen) && !projection.sameProjection(current, chosen), shapeText: convert.formatAspect(current.type === projection.FREEFORM ? current.aspect : picture || 2), pictureShape: picture ? convert.formatAspect(picture) : "" });
    },
    "workshop.projection.redraw": async ({ session: id, target = null, rawFile = "", width = 0, height = 0 } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const from = projection.normalizeProjection(s.doc.metadata?.projection);
      const to = projection.normalizeProjection(target);
      const background = s.doc.metadata?.customBackground ?? null;
      const raw = clean(rawFile);
      try {
        if (background?.kind !== "image") throw new Error("The basemap picture could not be read.");
        const { width: outWidth, height: outHeight } = engine.wsProjectionImage.redrawnSize(Number(width), to);
        const outFile = path.join(cacheDir, `workshop-redraw-${crypto.randomUUID()}.rgba`);
        await runEngineWorker({ ohReproject: true, rawFile: raw, width: Number(width), height: Number(height), outFile, from, to, bounds: background.bounds ?? null, outWidth, outHeight }, "The basemap picture could not be redrawn.");
        return plain({ rawFile: outFile, width: outWidth, height: outHeight, aspect: outWidth / outHeight, bounds: projection.sheetBounds(to), jpeg: /^data:image\/jpe?g/i.test(String(background.dataUrl || "")) });
      } catch (error) {
        return { error: error?.message || String(error) };
      } finally {
        if (raw) fs.rm(raw, { force: true }, () => {});
      }
    },
    "workshop.projection.convert": async ({ session: id, target = null, keepPicture = false, redrawn = null } = {}) => {
      const s = need(id);
      const projection = engine.wsMapProjection;
      const convert = engine.wsProjectionConvert;
      const from = projection.normalizeProjection(s.doc.metadata?.projection);
      const to = projection.normalizeProjection(target);
      if (projection.sameProjection(from, to)) return delta(s, {});
      const background = s.doc.metadata?.customBackground ?? null;
      const plan = convert.planBasemapChange({ from, to, background, keepPicture, detailedMap: convert.hasDetailedMap(s.doc) });
      if (plan.kind === "blocked") return { ...delta(s, {}), error: plan.reason };
      if (plan.kind === "redraw" && !redrawn?.file) {
        const source = thumbnailSource(background);
        if (!source?.file) return { ...delta(s, {}), error: "The basemap picture could not be read." };
        return { ...delta(s, {}), redraw: { file: source.file } };
      }
      const moveXY = (x, y) => {
        const [X, Y] = projection.convertPlane(from, to, x / EARTH, y / EARTH);
        return [X * EARTH, Y * EARTH];
      };
      let nextBg = background;
      if (plan.kind === "redraw") {
        const bytes = fs.readFileSync(clean(redrawn.file));
        fs.rm(clean(redrawn.file), { force: true }, () => {});
        nextBg = { kind: "image", dataUrl: `data:${clean(redrawn.mime) || "image/png"};base64,${bytes.toString("base64")}`, aspect: Number(redrawn.aspect) || null, bounds: redrawn.bounds ?? null };
      } else if (plan.kind === "bounds") nextBg = { kind: "image", dataUrl: background.dataUrl, aspect: background.aspect, bounds: plan.bounds };
      else if (plan.kind === "vector") nextBg = { ...background, geojson: projection.moveGeojson(background.geojson, (lon, lat) => projection.convertDisplayPoint(from, to, lon, lat)) };
      else if (plan.kind === "plain") nextBg = { kind: "plain" };
      else if (plan.kind === "tiles") nextBg = null;
      for (const f of features(s)) {
        f.getGeometry()?.applyTransform((input, output, stride = 2) => {
          const out = output ?? input;
          for (let i = 0; i < input.length; i += stride) {
            const [x, y] = moveXY(input[i], input[i + 1]);
            out[i] = x;
            out[i + 1] = y;
          }
          return out;
        });
      }
      s.undo = [];
      s.redo = [];
      notify(s, { geometry: true });
      setters(s).features((rows) => convert.moveFeatureCoords(rows, from, to));
      setters(s).units((rows) => convert.moveUnits(rows, from, to));
      setters(s).terrainAreas((rows) => convert.moveWarShapes(rows, from, to));
      setters(s).fortifications((rows) => convert.moveWarShapes(rows, from, to));
      setters(s).climateZones((rows) => convert.moveWarShapes(rows, from, to));
      const movedOwnBasemaps = engine.wsOwnBasemaps.moveOwnBasemapsBetween(s.doc.metadata?.ownBasemaps, from, to);
      patchMetadata(s, {
        projection: { ...to, ...(from.globe === false ? { globe: false } : {}), ...(from.wrap === false ? { wrap: false } : {}) },
        ...(nextBg !== background ? { customBackground: nextBg } : {}),
        ...(movedOwnBasemaps ? { ownBasemaps: movedOwnBasemaps } : {}),
      });
      return delta(s, { all: true });
    },
    "workshop.maps": async ({ session: id } = {}) => {
      const s = need(id);
      const library = await engine.wsBasemapLibrary.listBasemaps().catch(() => []);
      const hashOf = (background) => {
        const canonical = background?.kind === "image" && background.dataUrl
          ? background.dataUrl
          : background?.kind === "vector" && background.geojson
            ? JSON.stringify(background.geojson)
            : null;
        return canonical == null ? null : crypto.createHash("sha256").update(canonical).digest("hex");
      };
      const rows = mapsOf(s);
      const books = Array.isArray(library) ? library : [];
      const hashes = Object.fromEntries(rows.map((map) => [map.key, hashOf(map.background)]));
      const scenarioHashes = new Set(Object.values(hashes).filter(Boolean));
      const installedHashes = new Set(books.flatMap((bm) => [bm.contentHash, bm.source?.hash]).filter(Boolean).map((hash) => String(hash).toLowerCase()));
      const namesDetailed = (bm, detailed) => (detailed?.id
        ? bm.official?.id === detailed.id
        : Boolean(detailed?.hash) && (bm.contentHash === detailed.hash || (bm.supersedes || []).includes(detailed.hash)));
      const libraryInScenario = (bm) => scenarioHashes.has(String(bm.contentHash || "").toLowerCase())
        || rows.some((map) => map.key === `own:${engine.wsOwnBasemaps.ownBasemapIdOfLibrary(bm)}`);
      const maps = rows.map(({ background, ...row }) => ({
        ...row,
        canSaveToLibrary: Boolean(background) && !(!hashes[row.key] || installedHashes.has(hashes[row.key])),
      }));
      return plain({
        maps,
        builtins: engine.wsBasemaps.EDITOR_BASEMAPS.map((b) => ({
          id: b.id,
          label: b.label,
          preview: engine.wsBasemaps.esriPreviewUrl(b.service),
          filter: b.previewFilter || "",
          inScenario: rows.some((map) => map.builtinId === b.id),
          starting: rows.some((map) => map.starting && map.builtinId === b.id),
        })),
        mine: books.map((bm) => ({
          id: bm.id,
          name: bm.name,
          kind: bm.kind,
          thumbnail: bm.thumbnail || "",
          official: bm.official || null,
          community: Boolean(bm.source?.community),
          communityUrl: bm.source?.url || null,
          size: engine.wsTiledBasemaps.formatBytes(bm.bytes),
          inScenario: bm.kind === "tiled" ? rows.some((map) => map.kind === "detailed" && namesDetailed(bm, map.detailed)) : libraryInScenario(bm),
          starting: bm.kind === "tiled" && rows.some((map) => map.starting && map.kind === "detailed" && namesDetailed(bm, map.detailed)),
        })),
      });
    },
    "workshop.maps.preview": async ({ url = "" } = {}) => {
      const target = String(url || "");
      if (!/^https:\/\/server\.arcgisonline\.com\//.test(target)) return { file: "" };
      const dir = path.join(cacheDir, "workshop-previews");
      const file = path.join(dir, `${crypto.createHash("sha1").update(target).digest("hex")}.tile`);
      if (fs.existsSync(file)) return { file };
      try {
        const response = await fetch(target);
        if (!response.ok) return { file: "" };
        const bytes = Buffer.from(await response.arrayBuffer());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, bytes);
        return { file };
      } catch {
        return { file: "" };
      }
    },
    "workshop.maps.tiledUsers": async ({ basemapId = "" } = {}) => plain({ users: await engine.wsTiledBasemaps.listTiledBasemapUsers(String(basemapId)) }),
    "workshop.maps.addBuiltin": async ({ session: id, builtinId = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.addBuiltinMap(s.doc.metadata, builtinId));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.addLibrary": async ({ session: id, basemapId = "" } = {}) => {
      const s = need(id);
      const library = await engine.wsBasemapLibrary.listBasemaps().catch(() => []);
      const bm = (Array.isArray(library) ? library : []).find((entry) => entry.id === basemapId);
      if (!bm) return { ...delta(s, {}), refused: "Could not add that map: it is not in Your basemaps any more." };
      try {
        if (bm.kind !== "tiled") {
          const entry = engine.wsOwnBasemaps.ownBasemapFromLibrary(bm, await engine.wsBasemapLibrary.getBasemapPayload(bm.id));
          if (!entry) throw new Error("It has no picture or drawn map in it.");
          const result = applyMaps(s, engine.wsScenarioMaps.addOwnMap(s.doc.metadata, entry));
          return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
        }
        const metadata = s.doc.metadata;
        const detailed = {
          id: engine.wsOwnBasemaps.ownBasemapIdOfLibrary(bm),
          name: bm.name,
          detailed: bm.official?.id ? { id: bm.official.id, version: bm.official.version } : { hash: bm.contentHash },
        };
        let result = engine.wsScenarioMaps.addOwnMap(metadata, detailed);
        if (result.refused === engine.wsExportPreset.DETAILED_MAP_NEEDS_BASIC_MAP_MESSAGE) {
          const fallback = (await engine.wsBasemapLibrary.getBasemapPayload(bm.id).catch(() => null))?.geojson;
          if (fallback?.features?.length) {
            const drawn = engine.wsScenarioMaps.addOwnMap(metadata, { id: `${detailed.id.slice(0, 32)}-drawn`, name: `${bm.name} (drawn)`, background: { kind: "vector", geojson: fallback } });
            const both = drawn.patch ? engine.wsScenarioMaps.addOwnMap({ ...metadata, ...drawn.patch }, detailed) : drawn;
            if (both.patch) result = both;
          }
        }
        const applied = applyMaps(s, result);
        return { ...delta(s, { doc: true }), ...applied, maps: mapsOf(s) };
      } catch (error) {
        return { ...delta(s, {}), refused: `Could not add that map: ${error?.message || error}` };
      }
    },
    "workshop.maps.makeStarting": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.makeStartingMap(s.doc.metadata, key, { scenarioName: s.doc.metadata?.name }));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.remove": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.removeMap(s.doc.metadata, key));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.shownOver": async ({ session: id, key = "", over: overKey = "" } = {}) => {
      const s = need(id);
      const result = applyMaps(s, engine.wsScenarioMaps.setShownOver(s.doc.metadata, key, overKey, { scenarioName: s.doc.metadata?.name }));
      return { ...delta(s, { doc: true }), ...result, maps: mapsOf(s) };
    },
    "workshop.maps.readUpload": async ({ session: id, path: file = "", name = "", format = "" } = {}) => {
      const s = need(id);
      s.upload = null;
      const target = clean(file);
      const shown = clean(name) || path.basename(target);
      const ext = (clean(format) || path.extname(target).slice(1)).toLowerCase();
      const baseName = shown.replace(/\.[^.]+$/, "") || "Custom basemap";
      try {
        if (ext === "tif" || ext === "tiff") return { sessionOnly: true };
        if (["png", "jpg", "jpeg", "svg"].includes(ext)) {
          const mime = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
          s.upload = { kind: "image", dataUrl: `data:${mime};base64,${fs.readFileSync(target).toString("base64")}`, name: baseName };
          return { kind: "image" };
        }
        if (!["geojson", "json", "zip", "shp"].includes(ext)) throw new Error(`Unsupported background format: .${ext || "unknown"}`);
        const geojson = await readUploadVector(target, ext);
        s.upload = { kind: "vector", geojson, name: baseName };
        return plain({ kind: "vector", thumbnail: thumbnailSource({ kind: "vector", geojson }) });
      } catch (error) {
        return { error: error?.message || String(error) };
      }
    },
    "workshop.maps.addUpload": async ({ session: id, thumbnail = "", aspect = null } = {}) => {
      const s = need(id);
      const upload = s.upload;
      if (!upload) return { ...delta(s, {}), error: "Choose the map again." };
      s.upload = null;
      const normalized = upload.kind === "image" ? { kind: "image", dataUrl: upload.dataUrl, aspect: Number(aspect) || null } : { kind: "vector", geojson: upload.geojson };
      let meta = null;
      let libraryError = null;
      try {
        meta = await createLibraryBasemap(normalized, upload.name, clean(thumbnail) || null, { author: s.doc.metadata?.author || "" });
      } catch (error) {
        console.warn("[editor] save basemap to library failed:", error);
        libraryError = error?.message || String(error);
      }
      const entry = engine.wsOwnBasemaps.ownBasemapFromLibrary(meta || { id: upload.name, name: upload.name, kind: normalized.kind }, normalized.kind === "vector" ? { geojson: normalized.geojson } : { dataUrl: normalized.dataUrl });
      const result = entry ? applyMaps(s, engine.wsScenarioMaps.addOwnMap(s.doc.metadata, entry)) : { refused: "" };
      return { ...delta(s, { doc: true }), added: Boolean(entry) && !result.refused, ...(result.refused ? { refused: result.refused } : {}), ...(libraryError ? { libraryError } : {}) };
    },
    "workshop.maps.uploadTiled": async ({ session: id, path: file = "" } = {}) => {
      const s = need(id);
      const target = clean(file);
      try {
        const blob = await fs.openAsBlob(target);
        const meta = await engine.wsTiledBasemaps.uploadTiledBasemap(blob, { name: path.basename(target).replace(/\.pmtiles$/i, "") });
        const current = s.doc.metadata?.customBackground;
        if (current?.kind === "vector" && current.geojson) await engine.wsTiledBasemaps.setTiledBasemapFallback(meta.id, current.geojson).catch(() => {});
        return plain({ basemap: meta });
      } catch (error) {
        const message = error?.message || String(error);
        return { error: message, vectorTiles: /vector tiles/i.test(message) };
      }
    },
    "workshop.maps.thumbnailSource": async ({ session: id, key = "" } = {}) => {
      const s = need(id);
      const map = engine.wsScenarioMaps.scenarioMaps(s.doc.metadata, { scenarioName: s.doc.metadata?.name }).find((row) => row.key === key);
      return plain({ source: map?.background ? thumbnailSource(map.background) : null });
    },
    "workshop.maps.saveToLibrary": async ({ session: id, key = "", thumbnail = "" } = {}) => {
      const s = need(id);
      const map = engine.wsScenarioMaps.scenarioMaps(s.doc.metadata, { scenarioName: s.doc.metadata?.name }).find((row) => row.key === key);
      const bg = map?.background;
      try {
        if (!bg) throw new Error("It has no picture or drawn map in it.");
        await createLibraryBasemap(bg.kind === "image" ? { kind: "image", dataUrl: bg.dataUrl, aspect: bg.aspect } : { kind: "vector", geojson: bg.geojson }, map.name, clean(thumbnail) || null);
        return { ok: true };
      } catch (error) {
        return { error: `Could not save that map to Your basemaps: ${error?.message || error}` };
      }
    },
    "workshop.maps.deleteLibrary": async ({ basemapId = "" } = {}) => {
      try {
        await engine.wsBasemapLibrary.deleteBasemap(basemapId);
        return { ok: true };
      } catch (error) {
        return { error: `Could not delete that basemap: ${error?.message || error}` };
      }
    },
    "workshop.war.create": async ({ session: id, kind = "terrain", rings = null, points = null, owner: given = "" } = {}) => {
      let owner = given;
      const s = need(id);
      const war = engine.wsWarGeography;
      const field = war.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      const rowsNow = s.doc[field] || [];
      if (kind === "fortification" && !clean(owner) && Array.isArray(points) && points.length >= 2) {
        const LineString = engine.wsOlLineString.default;
        const geometry = new LineString(points.map((point) => fromLonLat([Number(point[0]), Number(point[1])])));
        const owners = [];
        for (let i = 0; i <= 48; i += 1) {
          const hits = s.source.getFeaturesAtCoordinate(geometry.getCoordinateAt(i / 48));
          const hitOwner = hits.length ? hits[hits.length - 1].get("owner") : null;
          if (hitOwner) owners.push(String(hitOwner));
        }
        owner = engine.wsWarGeography.mostCommon(owners) || "";
      }
      const row = kind === "terrain"
        ? war.newTerrainArea(mapDoc.newId("terrain"), rings, rowsNow)
        : kind === "fortification"
          ? war.newFortification(mapDoc.newId("wall"), points, owner, rowsNow)
          : war.newClimateZone(mapDoc.newId("zone"), rings, rowsNow);
      const step = undoLib.addRowStep(setters(s)[field], row);
      pushCmd(s, step);
      return { ...delta(s, { war: true }), id: row.id };
    },
    "workshop.war.patch": async ({ session: id, kind = "terrain", rowId = "", fields = {} } = {}) => {
      const s = need(id);
      const field = engine.wsWarGeography.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      setters(s)[field]((rows) => (rows || []).map((row) => {
        if (row.id !== rowId) return row;
        const next = { ...(row || {}), ...fields };
        for (const [key, value] of Object.entries(fields)) if (value === undefined || value === null) delete next[key];
        return next;
      }));
      return delta(s, { war: true });
    },
    "workshop.war.patchItem": async ({ session: id, rowId = "", list: listName = "seasons", index = -1, fields = null, effects = null, weather = null, add = null, remove = false } = {}) => {
      const s = need(id);
      if (listName !== "seasons" && listName !== "events") return delta(s, {});
      const mergeInto = (base, patch, dropZero = false) => {
        const next = { ...(base && typeof base === "object" ? base : {}) };
        for (const [key, value] of Object.entries(patch || {})) {
          if (value === undefined || value === null || (dropZero && !(Number(value) > 0))) delete next[key];
          else next[key] = value;
        }
        return next;
      };
      setters(s).climateZones((rows) => (rows || []).map((row) => {
        if (row.id !== rowId) return row;
        const items = Array.isArray(row[listName]) ? row[listName].slice() : [];
        if (add && typeof add === "object") {
          items.push(add);
        } else if (Number.isInteger(index) && index >= 0 && index < items.length) {
          if (remove) items.splice(index, 1);
          else {
            let item = mergeInto(items[index], fields);
            if (effects) item = { ...item, effects: mergeInto(item.effects, effects) };
            if (weather) item = { ...item, weather: mergeInto(item.weather, weather, true) };
            items[index] = item;
          }
        } else return row;
        return { ...row, [listName]: items };
      }));
      return delta(s, { war: true });
    },
    "workshop.war.remove": async ({ session: id, kind = "terrain", rowId = "" } = {}) => {
      const s = need(id);
      const field = engine.wsWarGeography.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      const step = undoLib.removeRowStep(s.doc[field] || [], setters(s)[field], rowId);
      if (step) pushCmd(s, step);
      return delta(s, { war: true });
    },
    "workshop.war.worldStart": async ({ session: id, kind = "terrain" } = {}) => {
      const s = need(id);
      const defaults = engine.wsWorldGeographyDefaults;
      const field = engine.wsWarGeography.WAR_LISTS[kind];
      if (!field) return delta(s, {});
      setters(s)[field](() => JSON.parse(JSON.stringify(kind === "climate" ? defaults.WORLD_CLIMATE_ZONES : defaults.WORLD_TERRAIN_AREAS)));
      return delta(s, { war: true });
    },
    "workshop.war.climateSeasons": async ({ climate = "continental" } = {}) => plain({ seasons: engine.wsWarGeography.seasonsOfClimate(climate) }),
    "workshop.war.constants": async () => plain({
      weather: engine.wsWeather.WEATHER_STATES,
      terrainMost: engine.wsWarGeographyRuntime.TERRAIN_LEVEL_MOST,
      wallLeast: engine.wsWarGeographyRuntime.WALL_LEVEL_LEAST,
      wallMost: engine.wsWarGeographyRuntime.WALL_LEVEL_MOST,
      climatePresets: engine.wsWarGeography.CLIMATE_PRESETS,
      newSeason: engine.wsWarGeography.newSeason(),
      newEvent: engine.wsWarGeography.newClimateEvent(),
    }),
    "workshop.regions.delete": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const removed = [];
      for (const rid of list(ids)) {
        const f = s.source.getFeatureById(String(rid));
        if (f) {
          s.source.removeFeature(f);
          removed.push(f);
        }
      }
      if (removed.length) {
        notify(s, { geometry: true });
        pushCmd(s, {
          undo: () => { removed.forEach((f) => s.source.addFeature(f)); s.geometryRev += 1; },
          redo: () => { removed.forEach((f) => s.source.removeFeature(f)); s.geometryRev += 1; },
        });
      } else {
        notify(s);
      }
      return delta(s, { regions: true });
    },
    "workshop.regions.merge": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const feats = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean);
      if (feats.length < 2) return delta(s, {});
      const cmd = engine.wsShapeEdits.mergeRegionFeatures(s.source, feats);
      if (!cmd) {
        return { ...delta(s, {}), refused: "These regions could not be merged. Borders are repaired when the map is saved into its scenario, so save the map and then try again." };
      }
      notify(s, { geometry: true });
      pushCmd(s, { undo: () => { cmd.undo(); s.geometryRev += 1; }, redo: () => { cmd.redo(); s.geometryRev += 1; } });
      return { ...delta(s, { regions: true }), selection: [String(feats[0].getId())] };
    },
    "workshop.regions.dissolve": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const feats = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean);
      if (feats.length < 2) return delta(s, {});
      const cmd = engine.wsShapeEdits.mergeRegionFeatures(s.source, feats);
      if (!cmd) {
        return { ...delta(s, {}), refused: "The border between these two regions could not be removed. Borders are repaired when the map is saved into its scenario, so save the map and then try again." };
      }
      notify(s, { geometry: true });
      pushCmd(s, { undo: () => { cmd.undo(); s.geometryRev += 1; }, redo: () => { cmd.redo(); s.geometryRev += 1; } });
      return { ...delta(s, { regions: true }), selection: [String(feats[0].getId())] };
    },
    "workshop.regions.simplify": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const simplifyLib = engine.wsSimplify;
      const isArea = (f) => /Polygon$/.test(f?.getGeometry()?.getType() || "");
      const chosen = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(isArea);
      if (!chosen.length) return { ...delta(s, {}), changed: 0 };
      const picked = new Set(chosen);
      const box = engine.wsOlExtent.createEmpty();
      for (const f of chosen) engine.wsOlExtent.extend(box, f.getGeometry().getExtent());
      const nearby = [];
      s.source.forEachFeatureIntersectingExtent(box, (f) => {
        if (!picked.has(f) && isArea(f)) nearby.push(f);
      });
      const meters = simplifyLib.detailToleranceMeters(features(s).filter((f) => !picked.has(f)).map((f) => f.getGeometry()));
      const all = [...chosen, ...nearby];
      const lighter = simplifyLib.simplifyShared(all.map((f) => f.getGeometry()), { toleranceAt: simplifyLib.toleranceAtLatitude(meters), movable: all.map((_, at) => at < chosen.length) });
      const same = (a, b) => {
        const x = a.getFlatCoordinates();
        const y = b.getFlatCoordinates();
        if (x.length !== y.length) return false;
        for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
        return true;
      };
      const changes = [];
      all.forEach((f, at) => {
        const before = f.getGeometry();
        if (!lighter[at] || lighter[at] === before || same(before, lighter[at])) return;
        changes.push({ feature: f, before, after: lighter[at], edited: f.get("edited") });
      });
      if (!changes.length) return { ...delta(s, {}), changed: 0 };
      const apply = (forward) => {
        for (const change of changes) {
          change.feature.setGeometry(forward ? change.after : change.before);
          change.feature.set("edited", forward ? true : change.edited);
        }
        s.geometryRev += 1;
      };
      apply(true);
      notify(s, { geometry: true });
      pushCmd(s, { undo: () => apply(false), redo: () => apply(true) });
      return { ...delta(s, { regions: true }), changed: changes.length };
    },
    "workshop.regions.duplicate": async ({ session: id, ids = [], offset = 0 } = {}) => {
      const s = need(id);
      const off = Number(offset) || 0;
      const created = [];
      for (const rid of list(ids)) {
        const f = s.source.getFeatureById(String(rid));
        if (!f) continue;
        const nf = new Feature({ geometry: geo.translatedClone(f.getGeometry(), off, -off) });
        nf.setId(mapDoc.newId());
        nf.setProperties({
          typeId: f.get("typeId") || "land",
          owner: f.get("owner") || null,
          name: (f.get("name") || "Region") + " copy",
          gid0: f.get("gid0") || "",
          country: f.get("country") || "",
          claimants: f.get("claimants") || null,
          group: f.get("group") || null,
        });
        s.source.addFeature(nf);
        created.push(nf);
      }
      notify(s, { geometry: Boolean(created.length) });
      if (created.length) {
        pushCmd(s, {
          undo: () => { created.forEach((f) => s.source.removeFeature(f)); s.geometryRev += 1; },
          redo: () => { created.forEach((f) => s.source.addFeature(f)); s.geometryRev += 1; },
        });
      }
      return { ...delta(s, { regions: true }), selection: created.map((f) => String(f.getId())) };
    },
    "workshop.regions.move": async ({ session: id, ids = [], from = null, to = null } = {}) => {
      const s = need(id);
      const feats = list(ids).map((rid) => s.source.getFeatureById(String(rid))).filter(Boolean);
      if (!feats.length || !Array.isArray(from) || !Array.isArray(to)) return delta(s, {});
      const [ax, ay] = fromLonLat([Number(from[0]), Number(from[1])]);
      const [bx, by] = fromLonLat([Number(to[0]), Number(to[1])]);
      const dx = bx - ax;
      const dy = by - ay;
      if (!dx && !dy) return delta(s, {});
      const before = engine.wsShapeEdits.captureShapes(feats);
      for (const f of feats) {
        f.getGeometry().translate(dx, dy);
        f.set("edited", true);
      }
      const after = engine.wsShapeEdits.captureShapes(feats);
      notify(s, { geometry: true });
      pushCmd(s, {
        undo: () => { engine.wsShapeEdits.restoreShapes(before); s.geometryRev += 1; },
        redo: () => { engine.wsShapeEdits.restoreShapes(after); s.geometryRev += 1; },
      });
      return delta(s, { regions: true });
    },
    "workshop.clipboard": async ({ session: id } = {}) => {
      need(id);
      return { summary: describeClipboard() };
    },
    "workshop.clipboard.copy": async ({ session: id, ids = [] } = {}) => {
      const s = need(id);
      const regions = exportRegions(s, list(ids).map(String));
      if (!regions.features.length) return { ...delta(s, {}), result: null, summary: describeClipboard() };
      clipboard = engine.wsRegionClipboard.buildClipboardPayload({ regions, doc: s.doc, colors: paintColors(s), sourceName: s.doc.metadata?.name, sourceId: s.doc.id });
      persistClipboard();
      return { ...delta(s, { doc: true }), result: { kind: "copied", count: regions.features.length }, summary: describeClipboard() };
    },
    "workshop.clipboard.paste": async ({ session: id, simplify = true } = {}) => {
      const s = need(id);
      if (!clipboard) return { ...delta(s, {}), result: null };
      const plan = engine.wsRegionClipboard.planClipboardMerge(clipboard, { polities: s.doc.polities, colors: paintColors(s), flags: s.doc.flags, tags: s.doc.tags, types: s.doc.types, groups: s.doc.groups });
      if (plan.types.length) setters(s).types((rows) => [...rows, ...plan.types]);
      if (Object.keys(plan.groups).length) setters(s).groups((registry) => ({ ...plan.groups, ...registry }));
      for (const [key, record] of Object.entries(plan.upserts)) upsertPolity(s, key, record);
      for (const [key, rgb] of Object.entries(plan.colorOverrides)) setColorOverride(s, key, rgb);
      for (const [key, flag] of Object.entries(plan.flags)) setFlag(s, key, flag);
      for (const [key, rows] of Object.entries(plan.tags)) setTags(s, key, rows);
      const result = pasteRegions(s, clipboard.regions, { simplify: Boolean(simplify) });
      return { ...delta(s, { regions: true }), result: { kind: "pasted", ...result }, selection: result.added.map(String), bounds: unionExtent(result.added.map((rid) => s.source.getFeatureById(rid)).filter(Boolean)) };
    },
    "workshop.clipboard.clear": async ({ session: id } = {}) => {
      const s = need(id);
      clipboard = null;
      persistClipboard();
      return { ...delta(s, { doc: true }), summary: null };
    },
    "workshop.undo": async ({ session: id } = {}) => {
      const s = need(id);
      const c = s.undo.pop();
      if (c) {
        c.undo();
        s.redo.push(c);
        notify(s);
      }
      return delta(s, { all: true });
    },
    "workshop.redo": async ({ session: id } = {}) => {
      const s = need(id);
      const c = s.redo.pop();
      if (c) {
        c.redo();
        s.undo.push(c);
        notify(s);
      }
      return delta(s, { all: true });
    },
    "workshop.documents": async () => plain({ docs: await engine.wsDocumentIO.listDocuments() }),
    "workshop.documents.delete": async ({ docId = "" } = {}) => {
      try {
        await engine.wsDocumentIO.deleteDocument(docId);
        return { ok: true };
      } catch (error) {
        return { error: `Could not delete this map: ${error?.message || error}` };
      }
    },
    "workshop.documents.export": async ({ session: id, path: target = "", game = false } = {}) => {
      const s = need(id);
      const content = game
        ? engine.wsExportPreset.buildGameSeed(s.doc, serializeRegions(s), paintColors(s))
        : { ...buildPayload(s), id: s.docId, version: 1 };
      fs.writeFileSync(clean(target), JSON.stringify(content));
      return { saved: clean(target) };
    },
    "workshop.documents.fileName": async ({ session: id, game = false } = {}) => {
      const s = need(id);
      const name = game ? `${s.doc.name || s.doc.metadata?.name || "map"}-game-seed` : (s.doc.metadata?.name || "map");
      return { fileName: `${String(name).replace(/[^a-z0-9]+/gi, "-")}.json` };
    },
    "workshop.save": async ({ session: id, mode = "deep", play = false } = {}) => {
      const s = need(id);
      if (s.action) return { ...delta(s, {}), ignored: true };
      if (!s.hydrated) {
        console.warn("[editor] scenario save requested before its map loaded — ignored.");
        return { ...delta(s, {}), ignored: true };
      }
      s.action = play ? "play" : "save";
      pushStatus(s);
      const note = await cleanBorders(s, { mode });
      let outcome;
      try {
        const authoringOps = s.polityAuthoringOps.slice();
        const seed = {
          ...engine.wsExportPreset.buildGameSeed(s.doc, serializeRegions(s) || { type: "FeatureCollection", features: [] }, paintColors(s)),
          polityAuthoringOps: removalsForScenario(authoringOps),
        };
        const renames = Array.isArray(s.doc.polityRenames) ? s.doc.polityRenames : [];
        const { scenarioCountry, details } = await lib.withSingleLibraryRefresh(() => writeMapToScenario(s.scenario.id, seed, renames));
        if (renames.length) s.doc = { ...s.doc, polityRenames: s.doc.polityRenames.slice(renames.length) };
        s.polityAuthoringOps = s.polityAuthoringOps.slice(authoringOps.length);
        s.scenarioDirty = false;
        let gameId = "";
        if (play) {
          const gameDetails = await lib.createGame({
            name: `${s.scenario.name} Session`,
            scenarioId: s.scenario.id,
            ...(scenarioCountry ? { gamePatch: { country: scenarioCountry } } : null),
            setActive: true,
          });
          gameId = clean(gameDetails?.game?.id);
        }
        let reviewRecord = null;
        if (s.review) {
          try {
            reviewRecord = await recordReview(s);
          } catch (error) {
            console.warn("[editor] could not record the review:", error);
          }
        }
        outcome = { note, details: plain(details), gameId, ...(reviewRecord ? { review: reviewRecord } : {}) };
      } catch (error) {
        console.warn("[editor] scenario save failed:", error);
        outcome = { error: `Could not save the map into the scenario: ${error?.message || error}` };
      } finally {
        s.action = "";
        emit("workshop.cleanup", { session: s.id, state: null });
        pushStatus(s);
      }
      return outcome.error ? { ...delta(s, {}), error: outcome.error } : { ...delta(s, { regions: true }), ...outcome };
    },
    "workshop.stopCleanup": async ({ session: id } = {}) => {
      const s = need(id);
      s.cleanupStop = true;
      return true;
    },
    "workshop.cleanupLimits": async () => {
      const limits = sweep.BORDER_CLEANUP;
      return { minWidth: limits.minWidth, quickWidth: limits.quickWidth, maxWidth: limits.maxWidth, maxMillis: limits.maxMillis };
    },
    "workshop.pref.get": async ({ keys = [] } = {}) => ({ values: Object.fromEntries(list(keys).map((key) => [String(key), ctx.storage.getItem(String(key))])) }),
    "workshop.pref.set": async ({ key = "", value = "" } = {}) => {
      if (clean(key)) {
        ctx.storage.setItem(clean(key), String(value ?? ""));
        ctx.storage.flush?.();
      }
      return true;
    },
    "workshop.extent": async ({ session: id } = {}) => {
      const s = need(id);
      const extent = s.source.getExtent();
      if (!extent || !Number.isFinite(extent[0])) return { bounds: null };
      const [west, south] = toLonLat([extent[0], extent[1]]);
      const [east, north] = toLonLat([extent[2], extent[3]]);
      return { bounds: [[west, south], [east, north]] };
    },
    "workshop.documents.new": async ({ session: id, kind = "blank" } = {}) => {
      const s = need(id);
      s.doc = mapDoc.createDocument({ name: kind === "blank" ? "Untitled Map" : kind === "modern-day" ? "Legacy World Map" : "World Map", kind });
      let feats = [];
      if (kind !== "blank") feats = await engine.wsRegionImport.loadSeedFeatures({ url: engine.wsRegionImport.seedUrlOf(kind) });
      s.source.clear();
      s.savedRegionHashes.clear();
      if (feats.length) s.source.addFeatures(feats);
      s.undo = [];
      s.redo = [];
      s.geometryRev += 1;
      s.regionRev += 1;
      s.docId = null;
      s.styleRev = (s.styleRev || 0) + 1;
      s.savedEdits = s.edits;
      s.retries = 0;
      s.saveError = "";
      s.saveStatus = "saved";
      if (feats.length) dirty(s);
      return delta(s, { all: true });
    },
    "workshop.documents.open": async ({ session: id, docId = "" } = {}) => {
      const s = need(id);
      let opened;
      let feats;
      try {
        opened = mapDoc.openStoredDocument(await engine.wsDocumentIO.loadDocument(docId));
        feats = opened.regions && Array.isArray(opened.regions.features) ? fmt.readFeatures(opened.regions, READ) : [];
        for (const f of feats) {
          const p = f.getProperties();
          if (f.getId() == null && p.id != null) f.setId(String(p.id));
          if (f.get("typeId") == null) f.set("typeId", "land");
        }
      } catch (error) {
        return { ...delta(s, {}), refused: `Could not open this map: ${error?.message || error}. Your current map is unchanged.` };
      }
      s.source.clear();
      s.savedRegionHashes.clear();
      if (feats.length) s.source.addFeatures(feats);
      s.doc = opened.doc;
      s.undo = [];
      s.redo = [];
      s.geometryRev += 1;
      s.regionRev += 1;
      s.docId = opened.doc.id;
      s.styleRev = (s.styleRev || 0) + 1;
      s.savedEdits = s.edits;
      s.retries = 0;
      s.saveError = "";
      s.saveStatus = "saved";
      return delta(s, { all: true });
    },
    "workshop.import.raster": async ({ session: id, rawFile = "", width = 0, height = 0, definitionFile = "", landOnly = true, ignoreBlack = true, minPixels = 1, bounds = null } = {}) => {
      const s = need(id);
      s.importResult = null;
      const raw = clean(rawFile);
      try {
        const definitionText = clean(definitionFile) ? fs.readFileSync(clean(definitionFile), "utf8") : "";
        const result = await runProvinceRaster(s, {
          rawFile: raw,
          width: Number(width),
          height: Number(height),
          options: { definitionText, landOnly: Boolean(landOnly && definitionText), ignoreBlack: Boolean(ignoreBlack), minPixels, bounds },
        });
        s.importResult = result;
        return plain({ stats: result.importStats, regions: result.features.length });
      } catch (error) {
        return { error: error?.message || String(error) };
      } finally {
        if (raw) fs.rm(raw, { force: true }, () => {});
      }
    },
    "workshop.import.geojson": async ({ session: id, ...args } = {}) => analyzeImportGeoJSON(need(id), args),
    "workshop.import.cancel": async ({ session: id } = {}) => {
      const s = need(id);
      s.importWorker?.terminate?.();
      s.importWorker = null;
      return { ok: true };
    },
    "workshop.import.apply": async ({ session: id, mode = "raster", inheritOwners = true, simplify = true, importCities = true, replaceExistingCities = false, skipBackup = false } = {}) => {
      const s = need(id);
      const result = s.importResult;
      if (!validFeatureCollection(result) || !result.features.length) return { error: "Analyze the import again first." };
      let backupFile = "";
      if (!skipBackup) {
        importProgress(s, 0.1, "Backing up current regions…");
        try {
          const backup = serializeRegions(s);
          const pointBackups = (s.doc.features || []).map(cityFeatureToGeoJSON).filter(Boolean);
          const folder = process.env.OH_NATIVE_DOWNLOADS || path.join(os.homedir(), "Downloads", "Open Historia");
          fs.mkdirSync(folder, { recursive: true });
          backupFile = path.join(folder, `open-historia-pre-province-import-${safeStamp()}.geojson`);
          fs.writeFileSync(backupFile, JSON.stringify({ ...backup, features: [...(backup.features || []), ...pointBackups] }));
        } catch (error) {
          return { backupFailed: error?.message || String(error) };
        }
      }
      importProgress(s, 0.45, "Replacing region geometry…");
      const applied = replaceRegionsFromImport(s, result, { inheritOwners: Boolean(inheritOwners), simplifyMeters: mode === "geojson" && simplify ? 100 : 0 });
      if (!applied?.count) return { ...delta(s, {}), error: "The map rejected the imported region collection." };
      const polityImport = Array.isArray(result.importPolityRows) && result.importPolityRows.length ? importPolityRoster(s, result.importPolityRows) : null;
      let cityImport = null;
      if (importCities && Array.isArray(result.importCityRows) && result.importCityRows.length) {
        const options = { replaceExisting: Boolean(replaceExistingCities), nextId: () => mapDoc.newId("feat") };
        const merged = engine.wsCityMarkers.mergeCityMarkers(s.doc.features, result.importCityRows, options);
        s.doc = { ...s.doc, features: merged.features };
        dirty(s);
        cityImport = { count: merged.count, created: merged.created, updated: merged.updated, replaced: merged.replaced, skipped: merged.skipped };
      }
      return { ...delta(s, { all: true }), selection: [], applied: plain({ ...applied, polityImport, cityImport }), backup: backupFile };
    },
    "workshop.documents.current": async ({ session: id } = {}) => {
      const s = need(id);
      return { docId: s.docId, author: s.doc.metadata?.author || "" };
    },
  };
};
