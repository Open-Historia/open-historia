/*!
 * Open Historia Scenario Workshop — Province Map Importer
 * Ported from kernely's Continuum branch.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { panelSurface, inputStyle } from "./editorStyles.js";
import { flagImageUrlFromGid } from "../runtime/countryFlags.js";
import { resolveStockCountryCode } from "../runtime/polityIdentity.js";

const WORLD = { west: -180, east: 180, north: 85.05112878, south: -85.05112878 };

const buttonStyle = (active = false) => ({
  ...panelSurface,
  padding: "7px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  background: active ? "rgba(59,130,246,0.42)" : "rgba(255,255,255,0.06)",
});

const downloadGeoJSON = (fc, filename) => {
  const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const safeStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const validFeatureCollection = (value) =>
  value && value.type === "FeatureCollection" && Array.isArray(value.features);

const NAME_FIELD_PRIORITY = [
  "name",
  "region_name",
  "regionName",
  "province_name",
  "provinceName",
  "display_name",
  "displayName",
  "label",
  "title",
  "NAME",
  "Name",
];

const ID_FIELD_PRIORITY = [
  "__featureId",
  "__objectKey",
  "id",
  "regionId",
  "region_id",
  "provinceId",
  "province_id",
  "province",
  "gid",
  "gid0",
  "GID_0",
  "GID_1",
  "GID_2",
  "OBJECTID",
  "FID",
  "ADM0_A3",
  "ADM1_CODE",
  "ADM2_CODE",
];

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
  if (Array.isArray(parsed)) {
    return parsed.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  }

  if (validFeatureCollection(parsed)) {
    return parsed.features.map(flattenMetadataFeature);
  }

  if (!parsed || typeof parsed !== "object") return [];

  const preferredContainers = ["regions", "provinces", "records", "items", "data", "features"];
  for (const key of preferredContainers) {
    const nested = parsed[key];
    if (Array.isArray(nested)) {
      if (key === "features" && nested.some((row) => row?.type === "Feature")) {
        return nested.map((row) => row?.type === "Feature" ? flattenMetadataFeature(row) : row)
          .filter((row) => row && typeof row === "object" && !Array.isArray(row));
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
      for (const [key, value] of Object.entries(props)) {
        if (primitiveKey(value) != null) counts.set(key, (counts.get(key) || 0) + 1);
      }
    } else {
      if (!row || typeof row !== "object") continue;
      for (const [key, value] of Object.entries(row)) {
        if (primitiveKey(value) != null) counts.set(key, (counts.get(key) || 0) + 1);
      }
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

  // GIS exports commonly use NAME_0 / NAME_1 / REGION_NAME_EN and similar.
  // Prefer a field that actually contains "name" over giving the imported
  // region a generic placeholder.
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

// Return one safe built-in flag URL only when every resolvable candidate points
// to the same standard country. This prevents a composite/historical polity with
// conflicting aliases from being silently assigned an arbitrary modern flag.
const uniqueStandardFlagForCandidates = (candidates) => {
  const codes = new Set();
  for (const candidate of candidates || []) {
    const code = resolveStockCountryCode(candidate);
    if (code) codes.add(code);
  }
  if (codes.size !== 1) return null;
  return flagImageUrlFromGid([...codes][0]);
};

// Region ownership uses stable polity keys in current documents. Imported
// GeoJSON often contains the visible polity name instead. Resolve that visible
// identity against the existing registry before replacing the map, so importing
// "Austria-Hungary" into a document whose stable key is "Austria" does not fork
// the country into two identities.
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
    const aliases = [
      stableKey,
      record?.name,
      ...(Array.isArray(record?.aliases) ? record.aliases : []),
    ];
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

    // No safe existing identity match. The imported owner itself becomes the new
    // stable key, which is the same fallback used by the Workshop polity importer.
    return text;
  };
};


const embeddedPolityRowsFromGeoJSON = (value) => {
  if (Array.isArray(value)) {
    return value
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => ({ ...row }));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([, row]) => row && typeof row === "object" && !Array.isArray(row))
    .map(([key, row]) => ({ key, ...row }));
};

const embeddedPolityIndex = (rows) => {
  const map = new Map();
  for (const row of rows || []) {
    const candidates = [
      row?.key,
      row?.stableKey,
      row?.stable_key,
      row?.name,
      ...(Array.isArray(row?.aliases) ? row.aliases : []),
    ];
    for (const candidate of candidates) {
      const text = String(candidate || "").trim().toLocaleLowerCase();
      if (!text || map.has(text)) continue;
      map.set(text, row);
    }
  }
  return map;
};

const embeddedFlagForRecord = (record) => {
  if (!record || typeof record !== "object") return null;
  const direct = String(
    record.flag ??
    record.flagUrl ??
    record.flag_url ??
    record.flagDataUrl ??
    "",
  ).trim();
  if (direct) return direct;

  const flagCode = String(
    record.flagCode ??
    record.flag_code ??
    "",
  ).trim();
  return flagCode ? flagImageUrlFromGid(flagCode) : null;
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
      const embedded =
        embeddedIndex.get(String(importedOwner).toLocaleLowerCase()) ||
        embeddedIndex.get(String(stableKey).toLocaleLowerCase()) ||
        null;
      const embeddedAliases = Array.isArray(embedded?.aliases) ? embedded.aliases : [];
      const aliases = new Set([
        stableKey,
        importedOwner,
        embedded?.name,
        ...embeddedAliases,
        existing?.name,
        ...(Array.isArray(existing?.aliases) ? existing.aliases : []),
      ].map((v) => String(v || "").trim()).filter(Boolean));
      const identityCandidates = [
        embedded?.flagCode,
        embedded?.flag_code,
        existing?.code,
        stableKey,
        importedOwner,
        embedded?.name,
        existing?.name,
        ...aliases,
      ];
      const existingFlag = firstExistingFlagForCandidates(flags, identityCandidates);
      const explicitFlag = embeddedFlagForRecord(embedded);
      if (existingFlag) preservedExistingFlags += 1;
      if (!existingFlag && explicitFlag) embeddedFlags += 1;

      row = {
        key: stableKey,
        name: String(embedded?.name || existing?.name || importedOwner).trim() || stableKey,
        aliases,
        // Explicit GeoJSON polity metadata wins over inference. Existing campaign
        // flags still win over import so a re-import cannot erase an authored
        // historical/custom override.
        flag: !existingFlag
          ? (
              explicitFlag ||
              (materializeStandardFlags ? uniqueStandardFlagForCandidates(identityCandidates) : null)
            )
          : null,
        colors: new Map(),
        regions: 0,
      };

      const embeddedColor = normalizeOwnerColor(embedded?.color ?? embedded?.colour ?? null);
      if (embeddedColor === false) {
        throw new Error(`Invalid embedded polity colour for ${row.name}. Use six-digit hex such as #8E1B34.`);
      }
      if (embeddedColor) row.colors.set(embeddedColor, 1);
      owners.set(stableKey, row);
    } else {
      row.aliases.add(importedOwner);
    }

    row.regions += 1;
    const color = normalizeOwnerColor(rawColor);
    if (color === false) {
      if (invalidColors.length < 8) {
        invalidColors.push({
          owner: importedOwner,
          value: String(rawColor),
          region: String(props.name || props.id || feature?.id || "").trim(),
        });
      }
      continue;
    }
    if (color) row.colors.set(color, (row.colors.get(color) || 0) + 1);
  }

  if (invalidColors.length) {
    const examples = invalidColors
      .map((row) => `${row.owner}${row.region ? ` (${row.region})` : ""}: ${row.value}`)
      .join("; ");
    throw new Error(
      `Invalid ownerColor value${invalidColors.length === 1 ? "" : "s"} in imported GeoJSON. ` +
      `Use six-digit hex colours such as #8E1B34. ${examples}`,
    );
  }

  const conflicts = [];
  for (const row of owners.values()) {
    if (row.colors.size > 1) {
      conflicts.push(`${row.name}: ${[...row.colors.keys()].sort().join(", ")}`);
    }
  }
  if (conflicts.length) {
    throw new Error(
      "Conflicting ownerColor values were found for the same resolved polity. " +
      "The importer will not choose a colour based on feature order. Fix the source GeoJSON and analyze again. " +
      conflicts.slice(0, 8).join("; "),
    );
  }

  const rows = [...owners.values()]
    .map((row) => ({
      key: row.key,
      name: row.name,
      aliases: [...row.aliases],
      color: row.colors.size ? [...row.colors.keys()][0] : null,
      flag: row.flag || null,
    }))
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

const normalizeTagList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[;,|]/).map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

const boolish = (value) => {
  if (value === true || value === 1) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "1" || text === "primary" || text === "capital";
};

const CITY_SYMBOL_TIER = {
  square: 1,
  flag: 2,
  cross: 2,
  "full-flag": 3,
};

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
  const tags = normalizeTagList(props.tags).map((tag) => tag.toLowerCase());
  return tags.includes("city") || tags.includes("capital");
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
    const incomingTags = normalizeTagList(props.tags);
    const isCapital = boolish(props.capital) || incomingTags.some((tag) => tag.toLowerCase() === "capital") || displaySymbol === "full-flag";
    const tags = [...new Set(["city", ...incomingTags, ...(isCapital ? ["capital"] : [])])];

    const importedOwner = primitiveKey(props.owner);
    const owner = importedOwner ? resolvePolity(importedOwner) : null;
    if (importedOwner && owner !== importedOwner) resolvedOwners += 1;

    const explicitTier = Number(props.tier);
    const symbolTier = CITY_SYMBOL_TIER[displaySymbol] || 1;
    const tier = Number.isFinite(explicitTier) && explicitTier >= 1 && explicitTier <= 3
      ? Math.round(explicitTier)
      : symbolTier;
    const population = Number(props.population);
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
      tier,
      tags,
      ...(Number.isFinite(scale) && scale > 0 ? { scale } : {}),
      ...(Number.isFinite(labelScale) && labelScale > 0 ? { labelScale } : {}),
      ...(props.labelPlacement != null ? { labelPlacement: String(props.labelPlacement) } : {}),
    });
  }

  return {
    rows,
    count: rows.length,
    skippedUnnamed,
    skippedInvalidCoordinates,
    resolvedOwners,
    symbols,
  };
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

const ProvinceImportPanel = ({ api, polities = {}, flags = {}, importPolityRoster, importCityMarkers, currentPointFeatures = [], onClose, onApplied }) => {
  const [mode, setMode] = useState("raster");
  const [rasterFile, setRasterFile] = useState(null);
  const [definitionFile, setDefinitionFile] = useState(null);
  const [geojsonFile, setGeojsonFile] = useState(null);
  const [metadataFile, setMetadataFile] = useState(null);
  const [geoJoinKey, setGeoJoinKey] = useState("auto");
  const [metadataJoinKey, setMetadataJoinKey] = useState("auto");
  const [metadataNameField, setMetadataNameField] = useState("auto");
  const [mergeAllMetadata, setMergeAllMetadata] = useState(true);
  const [geoKeyOptions, setGeoKeyOptions] = useState([]);
  const [metadataKeyOptions, setMetadataKeyOptions] = useState([]);
  const [metadataFieldOptions, setMetadataFieldOptions] = useState([]);
  const [bounds, setBounds] = useState(WORLD);
  const [opacity, setOpacity] = useState(0.46);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [landOnly, setLandOnly] = useState(true);
  const [ignoreBlack, setIgnoreBlack] = useState(true);
  const [inheritOwners, setInheritOwners] = useState(true);
  const [materializeStandardFlags, setMaterializeStandardFlags] = useState(true);
  const [importCities, setImportCities] = useState(true);
  const [replaceExistingCities, setReplaceExistingCities] = useState(false);
  const [minPixels, setMinPixels] = useState(1);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ fraction: 0, message: "" });
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("");
  const workerRef = useRef(null);
  const previewUrlRef = useRef(null);

  const hasDefinition = Boolean(definitionFile);
  const stats = result?.importStats || null;

  const boundsValid = useMemo(() => {
    const b = Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, Number(v)]));
    return Object.values(b).every(Number.isFinite) && b.east > b.west && b.north > b.south;
  }, [bounds]);

  const clearPreview = () => {
    api?.clearProvinceImportPreview?.();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  useEffect(() => () => {
    workerRef.current?.terminate?.();
    clearPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "raster" || !rasterFile || !boundsValid || !overlayVisible) {
      api?.clearProvinceImportPreview?.();
      return;
    }
    if (!previewUrlRef.current) previewUrlRef.current = URL.createObjectURL(rasterFile);
    api?.showProvinceImportPreview?.({
      url: previewUrlRef.current,
      bounds,
      opacity,
    });
  }, [api, mode, rasterFile, bounds, opacity, boundsValid, overlayVisible]);

  const chooseRaster = (file) => {
    clearPreview();
    setRasterFile(file || null);
    setOverlayVisible(true);
    setResult(null);
    setStatus("");
  };

  const setBound = (key, value) => {
    setBounds((cur) => ({ ...cur, [key]: value }));
    setResult(null);
  };

  const analyzeGeoJSON = async () => {
    if (!geojsonFile) throw new Error("Choose a GeoJSON file first.");
    const parsed = JSON.parse(await geojsonFile.text());
    if (!validFeatureCollection(parsed)) throw new Error("That file is not a GeoJSON FeatureCollection.");

    const embeddedPolityRows = embeddedPolityRowsFromGeoJSON(parsed.polities);
    const sourceFeatures = parsed.features.slice();
    const polygonFeatures = sourceFeatures.filter(
      (feature) => feature?.geometry?.type === "Polygon" || feature?.geometry?.type === "MultiPolygon",
    );
    if (!polygonFeatures.length) throw new Error("The GeoJSON contains no Polygon/MultiPolygon regions.");

    const cityImport = collectImportedCityPoints(sourceFeatures, polities);
    parsed.importCityRows = cityImport.rows;

    parsed.features = polygonFeatures.map((feature) => ({
      ...feature,
      properties: feature?.properties && typeof feature.properties === "object" ? { ...feature.properties } : {},
    }));

    const geoFields = collectFields(parsed.features, { feature: true });
    setGeoKeyOptions(geoFields);

    let metadataRows = [];
    let metaFields = [];
    let joinPair = null;
    let matched = 0;
    let unmatchedGeometry = 0;
    let metadataUnused = 0;
    let namesImported = 0;
    let resolvedNameField = null;

    if (metadataFile) {
      let metadataParsed;
      try {
        metadataParsed = JSON.parse(await metadataFile.text());
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
      setMetadataKeyOptions(metaFields);
      setMetadataFieldOptions(metaFields.filter((field) => !field.startsWith("__")));

      joinPair = chooseJoinPair(
        parsed.features,
        metadataRows,
        geoFields,
        metaFields,
        geoJoinKey,
        metadataJoinKey,
      );

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
          if (mergeAllMetadata) {
            feature.properties = {
              ...(feature.properties || {}),
              ...cleanMetadataRecord(metadataRecord),
            };
          }

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
      setMetadataKeyOptions([]);
      setMetadataFieldOptions([]);
      for (const feature of parsed.features) {
        const nameResult = normalizeFeatureName(feature, metadataNameField, null);
        if (nameResult.imported) {
          namesImported += 1;
          resolvedNameField ||= nameResult.field;
        }
      }
    }

    const polityImport = collectImportedPolities(
      parsed.features,
      polities,
      flags,
      embeddedPolityRows,
      { materializeStandardFlags },
    );
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
      metadataMerged: Boolean(metadataFile && mergeAllMetadata),
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

    setResult(parsed);
    setProgress({
      fraction: 1,
      message: metadataFile
        ? `Ready: ${parsed.features.length.toLocaleString()} regions; ${matched.toLocaleString()} metadata matches; ${polityImport.owners.toLocaleString()} owners; ${polityImport.colors.toLocaleString()} polity colours; ${polityImport.flags.toLocaleString()} scenario flags; ${cityImport.count.toLocaleString()} city markers`
        : `Ready: ${parsed.features.length.toLocaleString()} polygon regions; ${polityImport.owners.toLocaleString()} owners; ${polityImport.colors.toLocaleString()} polity colours; ${polityImport.flags.toLocaleString()} scenario flags; ${cityImport.count.toLocaleString()} city markers`,
    });
  };

  const analyzeRaster = async () => {
    if (!rasterFile) throw new Error("Choose a province raster first.");
    if (!boundsValid) throw new Error("The geographic bounds are invalid.");

    const definitionText = definitionFile ? await definitionFile.text() : "";
    const buffer = await rasterFile.arrayBuffer();
    const worker = new Worker(new URL("./provinceRasterWorker.js", import.meta.url), { type: "module" });
    workerRef.current?.terminate?.();
    workerRef.current = worker;

    await new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === "progress") {
          setProgress({ fraction: Number(msg.fraction || 0), message: msg.message || "" });
          return;
        }
        if (msg.type === "done") {
          setResult(msg.result);
          worker.terminate();
          workerRef.current = null;
          resolve();
          return;
        }
        if (msg.type === "error") {
          worker.terminate();
          workerRef.current = null;
          reject(new Error(msg.message || "Raster vectorization failed."));
        }
      };
      worker.onerror = (event) => {
        worker.terminate();
        workerRef.current = null;
        reject(new Error(event?.message || "Province importer worker crashed."));
      };
      worker.postMessage({
        type: "vectorize",
        buffer,
        name: rasterFile.name,
        mime: rasterFile.type,
        options: {
          definitionText,
          landOnly: Boolean(landOnly && definitionText),
          ignoreBlack,
          minPixels,
          bounds,
        },
      }, [buffer]);
    });
  };

  const analyze = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    setResult(null);
    setProgress({ fraction: 0.01, message: "Preparing import…" });
    try {
      if (mode === "geojson") await analyzeGeoJSON();
      else await analyzeRaster();
    } catch (e) {
      setProgress({ fraction: 0, message: "" });
      setStatus(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!api || !validFeatureCollection(result) || !result.features.length || busy) return;
    const count = result.features.length;
    const cityCount = importCities && Array.isArray(result.importCityRows) ? result.importCityRows.length : 0;
    const ok = window.confirm(
      `Replace the current region geometry with ${count.toLocaleString()} imported regions?` +
      (cityCount ? `\nAlso import ${cityCount.toLocaleString()} city marker${cityCount === 1 ? "" : "s"}${replaceExistingCities ? " (replacing existing city markers)" : " (merging with existing city markers)"}.` : "") +
      "\n\nThe importer will automatically download a GeoJSON backup of the current regions and city markers first. " +
      "This is intentionally NOT kept in the in-memory Undo stack because whole-map imports can be very large.",
    );
    if (!ok) return;

    setBusy(true);
    setStatus("");
    try {
      setProgress({ fraction: 0.1, message: "Backing up current regions…" });
      const backup = api.serializeRegions?.();
      if (backup) {
        const pointBackups = (currentPointFeatures || []).map(cityFeatureToGeoJSON).filter(Boolean);
        downloadGeoJSON(
          { ...backup, features: [...(backup.features || []), ...pointBackups] },
          `continuum-pre-province-import-${safeStamp()}.geojson`,
        );
      }

      setProgress({ fraction: 0.45, message: "Replacing region geometry…" });
      api.clearProvinceImportPreview?.();
      const applied = api.replaceRegionsFromImport?.(result, { inheritOwners });
      if (!applied?.count) throw new Error("The map rejected the imported region collection.");

      const polityImport = Array.isArray(result.importPolityRows) && result.importPolityRows.length
        ? importPolityRoster?.(result.importPolityRows)
        : null;
      const cityImport = importCities && Array.isArray(result.importCityRows) && result.importCityRows.length
        ? importCityMarkers?.(result.importCityRows, { replaceExisting: replaceExistingCities })
        : null;

      setProgress({ fraction: 1, message: `Imported ${applied.count.toLocaleString()} regions${cityImport?.count ? ` and ${cityImport.count.toLocaleString()} city markers` : ""}` });
      setStatus(
        `${applied.count.toLocaleString()} regions imported` +
        (applied.inheritedOwners ? `; ${applied.inheritedOwners.toLocaleString()} inherited existing polity ownership` : "") +
        (polityImport?.count ? `; ${polityImport.count.toLocaleString()} polities resolved/registered` : "") +
        (polityImport?.colors ? `; ${polityImport.colors.toLocaleString()} polity colours imported` : "") +
        (polityImport?.flags ? `; ${polityImport.flags.toLocaleString()} standard flags stored in scenario` : "") +
        (cityImport?.count ? `; ${cityImport.count.toLocaleString()} city markers imported` : "") +
        (cityImport?.updated ? ` (${cityImport.updated.toLocaleString()} existing markers updated)` : "") +
        ".",
      );
      onApplied?.({ ...applied, polityImport, cityImport });
      api.fitToData?.();
    } catch (e) {
      setStatus(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        ...panelSurface,
        position: "fixed",
        left: 14,
        top: 44,
        width: "min(460px, calc(100vw - 28px))",
        maxHeight: "calc(100vh - 116px)",
        overflowY: "auto",
        zIndex: 45,
        padding: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>🗺 Province Map Importer</div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...buttonStyle(false), padding: "3px 8px" }}>✕</button>
      </div>

      <div style={{ padding: 13, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, lineHeight: 1.45, color: "rgba(255,255,255,0.72)" }}>
          Import a user-supplied colour-coded province raster (including a local HOI4-style <b>provinces.bmp</b>) and turn its colours into real map regions. Shared borders are traced from one pixel lattice, so imported neighbours start with exact matching boundaries.
        </div>

        <div style={{ display: "flex", gap: 7 }}>
          <button onClick={() => { setMode("raster"); setOverlayVisible(true); setResult(null); }} style={buttonStyle(mode === "raster")}>Province raster</button>
          <button onClick={() => { setMode("geojson"); clearPreview(); setResult(null); }} style={buttonStyle(mode === "geojson")}>Region GeoJSON + metadata</button>
        </div>

        {mode === "raster" ? (
          <>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <b>Province image</b>
              <input
                type="file"
                accept=".bmp,.png,.jpg,.jpeg,.webp,image/bmp,image/png,image/jpeg,image/webp"
                onChange={(e) => chooseRaster(e.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: 7 }}
              />
              <span style={{ color: "rgba(255,255,255,0.5)" }}>24/32-bit BMP is decoded directly. PNG/JPEG/WebP use the browser image decoder.</span>
            </label>

            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <b>Optional HOI4 definition.csv</b>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => { setDefinitionFile(e.target.files?.[0] || null); setResult(null); }}
                style={{ ...inputStyle, padding: 7 }}
              />
              <span style={{ color: "rgba(255,255,255,0.5)" }}>When supplied, province IDs/type/terrain metadata are preserved and “land only” can exclude sea/lake provinces.</span>
            </label>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800 }}>Geographic fit</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {[
                  ["west", "West longitude"],
                  ["east", "East longitude"],
                  ["north", "North latitude"],
                  ["south", "South latitude"],
                ].map(([key, label]) => (
                  <label key={key} style={{ fontSize: 10.5, color: "rgba(255,255,255,0.58)" }}>
                    {label}
                    <input
                      type="number"
                      step="0.1"
                      value={bounds[key]}
                      onChange={(e) => setBound(key, e.target.value)}
                      style={{ ...inputStyle, marginTop: 3 }}
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => { setBounds(WORLD); setResult(null); }} style={buttonStyle(false)}>Reset whole-world fit</button>
                <label style={{ fontSize: 10.5, color: "rgba(255,255,255,0.58)" }}>
                  overlay opacity&nbsp;
                  <input type="range" min="0.1" max="0.9" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
                </label>
              </div>
              <div style={{ fontSize: 10.8, color: "#fbbf24", lineHeight: 1.4 }}>
                R1 uses a rectangular geographic fit. It is enough to import a complete province network, but exact control-point warping/alignment is the next importer pass for foreign projections.
              </div>
            </div>

            <div style={{ display: "grid", gap: 7, fontSize: 11.5 }}>
              <label><input type="checkbox" checked={landOnly} disabled={!hasDefinition} onChange={(e) => { setLandOnly(e.target.checked); setResult(null); }} /> Import land provinces only {hasDefinition ? "" : "(needs definition.csv)"}</label>
              <label><input type="checkbox" checked={ignoreBlack} onChange={(e) => { setIgnoreBlack(e.target.checked); setResult(null); }} /> Ignore pure black pixels</label>
              <label>
                Minimum connected component size&nbsp;
                <input type="number" min="1" max="10000" value={minPixels} onChange={(e) => { setMinPixels(e.target.value); setResult(null); }} style={{ ...inputStyle, width: 80, display: "inline-block" }} />
                &nbsp;pixels
              </label>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <b>Region geometry GeoJSON</b>
              <input
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                onChange={(e) => {
                  setGeojsonFile(e.target.files?.[0] || null);
                  setGeoJoinKey("auto");
                  setGeoKeyOptions([]);
                  setResult(null);
                  setStatus("");
                }}
                style={{ ...inputStyle, padding: 7 }}
              />
              <span style={{ color: "rgba(255,255,255,0.5)" }}>
                Polygon/MultiPolygon geometry. A normal <code>properties.name</code> is preserved; common alternatives such as NAME, region_name and province_name are normalized automatically. <code>properties.owner</code> is imported as polity ownership and <code>properties.ownerColor</code> as that polity&apos;s authored colour. Optional <code>Point</code> features explicitly marked with <code>properties.markerType=&quot;city&quot;</code> are recognized as city markers.
              </span>
            </label>

            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <b>Optional separate region metadata JSON</b>
              <input
                type="file"
                accept=".json,.geojson,application/json,application/geo+json"
                onChange={(e) => {
                  setMetadataFile(e.target.files?.[0] || null);
                  setMetadataJoinKey("auto");
                  setMetadataNameField("auto");
                  setMetadataKeyOptions([]);
                  setMetadataFieldOptions([]);
                  setResult(null);
                  setStatus("");
                }}
                style={{ ...inputStyle, padding: 7 }}
              />
              <span style={{ color: "rgba(255,255,255,0.5)" }}>
                Supported: arrays of records, <code>{"{regions:[...]}"}</code>, <code>{"{provinces:[...]}"}</code>, GeoJSON FeatureCollections, or objects keyed by region/province ID.
              </span>
            </label>

            {metadataFile && (
              <div style={{ display: "grid", gap: 7, padding: "9px 10px", borderRadius: 9, background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.18)" }}>
                <div style={{ fontSize: 11.5, fontWeight: 800 }}>Metadata join</div>
                <div style={{ fontSize: 10.7, color: "rgba(255,255,255,0.56)", lineHeight: 1.4 }}>
                  Auto-match compares IDs in both files. If it chooses the wrong fields, run Analyze once, select the correct keys below, then Analyze again.
                </div>

                <label style={{ fontSize: 10.7, color: "rgba(255,255,255,0.65)" }}>
                  Geometry key
                  <select value={geoJoinKey} onChange={(e) => { setGeoJoinKey(e.target.value); setResult(null); }} style={{ ...inputStyle, marginTop: 3 }}>
                    <option value="auto">Auto-detect</option>
                    {geoKeyOptions.map((field) => <option key={field} value={field}>{field === "__featureId" ? "Feature ID" : field}</option>)}
                  </select>
                </label>

                <label style={{ fontSize: 10.7, color: "rgba(255,255,255,0.65)" }}>
                  Metadata key
                  <select value={metadataJoinKey} onChange={(e) => { setMetadataJoinKey(e.target.value); setResult(null); }} style={{ ...inputStyle, marginTop: 3 }}>
                    <option value="auto">Auto-detect</option>
                    {metadataKeyOptions.map((field) => (
                      <option key={field} value={field}>
                        {field === "__objectKey" ? "JSON object key" : field === "__featureId" ? "Feature ID" : field}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: 10.7, color: "rgba(255,255,255,0.65)" }}>
                  Region name field
                  <select value={metadataNameField} onChange={(e) => { setMetadataNameField(e.target.value); setResult(null); }} style={{ ...inputStyle, marginTop: 3 }}>
                    <option value="auto">Auto-detect name / region_name / NAME…</option>
                    {metadataFieldOptions.map((field) => <option key={field} value={field}>{field}</option>)}
                  </select>
                </label>

                <label style={{ fontSize: 11 }}>
                  <input type="checkbox" checked={mergeAllMetadata} onChange={(e) => { setMergeAllMetadata(e.target.checked); setResult(null); }} />{" "}
                  Merge all metadata fields into each region
                </label>
              </div>
            )}

            <div style={{ display: "grid", gap: 6, padding: "9px 10px", borderRadius: 9, background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.18)" }}>
              <label style={{ fontSize: 11.2, lineHeight: 1.4 }}>
                <input
                  type="checkbox"
                  checked={materializeStandardFlags}
                  onChange={(e) => { setMaterializeStandardFlags(e.target.checked); setResult(null); }}
                />{" "}
                <b>Store recognized standard flags in this scenario</b>
              </label>
              <div style={{ fontSize: 10.6, color: "rgba(255,255,255,0.52)", lineHeight: 1.4 }}>
                Explicit top-level <code>polities</code> metadata (<code>flag</code>/<code>flagCode</code>) is imported first. When it is absent, this option may fill safely recognized owners from Open Historia&apos;s built-in catalog. Existing custom/historical campaign flags are preserved.
              </div>
            </div>

            {stats?.cityMarkers > 0 && (
              <div style={{ display: "grid", gap: 6, padding: "9px 10px", borderRadius: 9, background: "rgba(168,85,247,0.07)", border: "1px solid rgba(168,85,247,0.2)" }}>
                <div style={{ fontSize: 11.5, fontWeight: 800 }}>City markers detected: {Number(stats.cityMarkers).toLocaleString()}</div>
                <label style={{ fontSize: 11 }}>
                  <input type="checkbox" checked={importCities} onChange={(e) => setImportCities(e.target.checked)} />{" "}
                  Import explicit city Point markers
                </label>
                <label style={{ fontSize: 11, opacity: importCities ? 1 : 0.5 }}>
                  <input type="checkbox" disabled={!importCities} checked={replaceExistingCities} onChange={(e) => setReplaceExistingCities(e.target.checked)} />{" "}
                  Replace existing city markers instead of merge/update
                </label>
                <div style={{ fontSize: 10.6, color: "rgba(255,255,255,0.52)", lineHeight: 1.4 }}>
                  Only Points explicitly marked as cities are imported. <code>square</code> → Town (tier 1); <code>flag</code>/<code>cross</code> → City (tier 2); <code>full-flag</code> → Major City (tier 3) + Capital. Unmarked Points are ignored.
                </div>
              </div>
            )}
          </div>
        )}

        <label style={{ fontSize: 11.5, lineHeight: 1.4 }}>
          <input type="checkbox" checked={inheritOwners} onChange={(e) => setInheritOwners(e.target.checked)} />{" "}
          <b>Inherit current polity ownership by imported province centroid</b>
          <div style={{ color: "rgba(255,255,255,0.52)", marginLeft: 20 }}>
            Keeps the existing scenario politically useful after a geometry replacement. Existing owner fields already present in imported GeoJSON are preserved.
          </div>
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy || (mode === "raster" ? !rasterFile : !geojsonFile)} onClick={analyze} style={{ ...buttonStyle(false), opacity: busy ? 0.6 : 1 }}>
            {busy ? "Working…" : mode === "raster" ? "Vectorize / analyze" : metadataFile ? "Join metadata / analyze" : "Analyze GeoJSON"}
          </button>
          <button disabled={busy || !result?.features?.length} onClick={apply} style={{ ...buttonStyle(true), opacity: result?.features?.length ? 1 : 0.5 }}>
            Import / replace regions
          </button>
          {mode === "raster" && <button onClick={() => setOverlayVisible((v) => !v)} style={buttonStyle(false)}>{overlayVisible ? "Hide raster overlay" : "Show raster overlay"}</button>}
        </div>

        {(busy || progress.message) && (
          <div style={{ display: "grid", gap: 5 }}>
            <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, (progress.fraction || 0) * 100))}%`, height: "100%", background: "rgba(59,130,246,0.85)" }} />
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)" }}>{progress.message}</div>
          </div>
        )}

        {stats && (
          <div style={{ padding: "9px 10px", borderRadius: 9, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.22)", fontSize: 11.5, lineHeight: 1.5 }}>
            <b>Ready to import:</b> {Number(stats.regions || result.features.length).toLocaleString()} regions
            {stats.width ? <> · raster {stats.width.toLocaleString()}×{stats.height.toLocaleString()}</> : null}
            {stats.definitionRows ? <> · {stats.definitionRows.toLocaleString()} definition rows</> : null}
            {stats.landOnly ? <> · land only</> : null}
            {stats.metadataRows ? <> · metadata {Number(stats.metadataMatched || 0).toLocaleString()}/{Number(stats.metadataRows).toLocaleString()} matched</> : null}
            {Number.isFinite(stats.namesImported) ? <> · {Number(stats.namesImported).toLocaleString()} names</> : null}
            {Number.isFinite(stats.polityOwners) && stats.polityOwners > 0 ? <> · {Number(stats.polityOwners).toLocaleString()} owners</> : null}
            {Number.isFinite(stats.polityColors) && stats.polityColors > 0 ? <> · {Number(stats.polityColors).toLocaleString()} polity colours</> : null}
            {Number.isFinite(stats.embeddedPolities) && stats.embeddedPolities > 0 ? <> · {Number(stats.embeddedPolities).toLocaleString()} embedded polity records</> : null}
            {Number.isFinite(stats.polityFlags) && stats.polityFlags > 0 ? <> · {Number(stats.polityFlags).toLocaleString()} scenario flags</> : null}
            {Number.isFinite(stats.embeddedPolityFlags) && stats.embeddedPolityFlags > 0 ? <> · {Number(stats.embeddedPolityFlags).toLocaleString()} explicit GeoJSON flags</> : null}
            {Number.isFinite(stats.polityFlagsPreserved) && stats.polityFlagsPreserved > 0 ? <> · {Number(stats.polityFlagsPreserved).toLocaleString()} existing flags preserved</> : null}
            {Number.isFinite(stats.resolvedOwnerAliases) && stats.resolvedOwnerAliases > 0 ? <> · {Number(stats.resolvedOwnerAliases).toLocaleString()} owner aliases resolved</> : null}
            {Number.isFinite(stats.cityMarkers) && stats.cityMarkers > 0 ? <> · {Number(stats.cityMarkers).toLocaleString()} city markers</> : null}
            {stats.geoJoinKey && stats.metadataJoinKey ? <> · join <b>{stats.geoJoinKey === "__featureId" ? "Feature ID" : stats.geoJoinKey}</b> ↔ <b>{stats.metadataJoinKey === "__objectKey" ? "JSON object key" : stats.metadataJoinKey}</b></> : null}
            {stats.metadataNameField ? <> · name field <b>{stats.metadataNameField}</b></> : null}
          </div>
        )}

        {stats?.metadataRows && (stats.metadataUnmatchedGeometry || stats.metadataUnused) ? (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 11, lineHeight: 1.45, color: "rgba(254,215,170,0.92)" }}>
            Metadata join warning:
            {stats.metadataUnmatchedGeometry ? <> {Number(stats.metadataUnmatchedGeometry).toLocaleString()} geometry regions had no metadata match.</> : null}
            {stats.metadataUnused ? <> {Number(stats.metadataUnused).toLocaleString()} metadata records were unused.</> : null}
            {" "}Check the join keys before importing if those numbers are unexpected.
          </div>
        ) : null}

        {stats?.ownerColorsWithoutOwner ? (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 11, lineHeight: 1.45, color: "rgba(254,215,170,0.92)" }}>
            Owner colour warning: {Number(stats.ownerColorsWithoutOwner).toLocaleString()} region{Number(stats.ownerColorsWithoutOwner) === 1 ? "" : "s"} supplied <code>ownerColor</code> without an <code>owner</code>, so no polity colour can be assigned from {Number(stats.ownerColorsWithoutOwner) === 1 ? "it" : "them"}.
          </div>
        ) : null}

        {stats && (stats.cityMarkersSkippedUnnamed || stats.cityMarkersSkippedInvalidCoordinates) ? (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 11, lineHeight: 1.45, color: "rgba(254,215,170,0.92)" }}>
            City marker warning:
            {stats.cityMarkersSkippedUnnamed ? <> {Number(stats.cityMarkersSkippedUnnamed).toLocaleString()} explicit city Point{Number(stats.cityMarkersSkippedUnnamed) === 1 ? " was" : "s were"} skipped because no name was present.</> : null}
            {stats.cityMarkersSkippedInvalidCoordinates ? <> {Number(stats.cityMarkersSkippedInvalidCoordinates).toLocaleString()} explicit city Point{Number(stats.cityMarkersSkippedInvalidCoordinates) === 1 ? " had" : "s had"} invalid coordinates.</> : null}
          </div>
        ) : null}

        {status && (
          <div style={{ padding: "8px 9px", borderRadius: 8, background: status.includes("imported") ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border: "1px solid rgba(255,255,255,0.12)", fontSize: 11.5, lineHeight: 1.45 }}>
            {status}
          </div>
        )}

        <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", fontSize: 10.8, lineHeight: 1.45, color: "rgba(255,255,255,0.5)" }}>
          <b>Safety:</b> Apply automatically downloads the current regions plus authored city markers as one mixed GeoJSON backup before replacement, and that backup can be re-imported from the GeoJSON tab. Whole-map import deliberately clears the in-memory region Undo stack instead of keeping two enormous worlds resident at once.
        </div>
      </div>
    </div>
  );
};

export default ProvinceImportPanel;
