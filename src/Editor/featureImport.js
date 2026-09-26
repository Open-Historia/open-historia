/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Point features from a file of the author's own, for the Features panel:
// GeoJSON (a FeatureCollection, a single Feature, or a bare Point / MultiPoint;
// only point geometries carry a place, anything else is counted as skipped), a
// Workshop document or its `features` array (rows with `coord`), or a plain
// array of rows with lon/lat (or lng, longitude, x / latitude, y). Names come
// from name / NAME / title / city / label; tags from tags (array or comma list)
// or kind / category / class; an owner from country / owner / polity.

// Ids in the document's own shape (useMapDocument newId), minted here so the
// parser stays free of React and testable under node.
import { populationByYearField } from "../runtime/cityPopulation.js";

let sequence = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(sequence++).toString(36)}`;

const SYMBOLS = new Set(["square", "circle", "triangle", "star"]);

const text = (value) => String(value ?? "").trim();
const number = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validCoord = (lon, lat) =>
  lon !== null && lat !== null && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 ? [lon, lat] : null;

const coordOfRow = (row) => {
  if (Array.isArray(row.coord) && row.coord.length >= 2) return validCoord(number(row.coord[0]), number(row.coord[1]));
  if (Array.isArray(row.coordinates) && row.coordinates.length >= 2) return validCoord(number(row.coordinates[0]), number(row.coordinates[1]));
  const lon = number(row.lon ?? row.lng ?? row.longitude ?? row.x);
  const lat = number(row.lat ?? row.latitude ?? row.y);
  return validCoord(lon, lat);
};

const readTags = (props) => {
  const raw = props.tags ?? props.tag ?? props.kind ?? props.category ?? props.class;
  if (Array.isArray(raw)) return [...new Set(raw.map(text).filter(Boolean))];
  const joined = text(raw);
  return joined ? [...new Set(joined.split(/[,;|]/).map((entry) => entry.trim()).filter(Boolean))] : [];
};

const toFeature = (props, coord, index) => {
  const symbol = text(props.symbol).toLowerCase();
  return {
    id: newId("feat"),
    name: text(props.name ?? props.NAME ?? props.title ?? props.city ?? props.label) || `Feature ${index + 1}`,
    type: "Coordinate",
    symbol: SYMBOLS.has(symbol) ? symbol : "square",
    coord,
    country: text(props.country ?? props.owner ?? props.polity),
    owner: null,
    regionId: null,
    population: number(props.population) ?? 0,
    tags: readTags(props),
    // A population by year, in any of the shapes the game reads.
    ...populationByYearField(props),
  };
};

// GeoJSON geometries: Points and MultiPoints place a feature; the rest do not.
const pointsOf = (geometry) => {
  if (!isRecord(geometry)) return null;
  if (geometry.type === "Point") {
    const coord = Array.isArray(geometry.coordinates) ? validCoord(number(geometry.coordinates[0]), number(geometry.coordinates[1])) : null;
    return coord ? [coord] : [];
  }
  if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((pair) => (Array.isArray(pair) ? validCoord(number(pair[0]), number(pair[1])) : null))
      .filter(Boolean);
  }
  return null;
};

// { features, skipped, format } — throws on text that is not JSON or holds
// nothing point-like at all.
export const parseFeatureImport = (input) => {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  const features = [];
  let skipped = 0;

  const addGeoJsonFeature = (feature) => {
    const points = pointsOf(feature?.geometry);
    if (!points) {
      skipped += 1;
      return;
    }
    if (!points.length) skipped += 1;
    const props = isRecord(feature.properties) ? feature.properties : {};
    for (const coord of points) features.push(toFeature(props, coord, features.length));
  };

  const addRows = (rows) => {
    for (const row of rows) {
      if (!isRecord(row)) {
        skipped += 1;
        continue;
      }
      const coord = coordOfRow(row);
      if (!coord) {
        skipped += 1;
        continue;
      }
      features.push(toFeature(row, coord, features.length));
    }
  };

  let format;
  if (isRecord(parsed) && parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
    format = "geojson";
    for (const feature of parsed.features) addGeoJsonFeature(feature);
  } else if (isRecord(parsed) && parsed.type === "Feature") {
    format = "geojson";
    addGeoJsonFeature(parsed);
  } else if (isRecord(parsed) && (parsed.type === "Point" || parsed.type === "MultiPoint")) {
    format = "geojson";
    addGeoJsonFeature({ geometry: parsed, properties: {} });
  } else if (isRecord(parsed) && Array.isArray(parsed.features)) {
    format = "document";
    addRows(parsed.features);
  } else if (Array.isArray(parsed)) {
    format = "rows";
    addRows(parsed);
  } else {
    throw new Error("That file holds no features: expected GeoJSON, a Workshop document, or a list of rows with coordinates.");
  }

  if (!features.length) {
    throw new Error(skipped
      ? `None of the ${skipped} entries had a usable point (longitude -180..180, latitude -90..90).`
      : "That file holds no features.");
  }
  return { features, skipped, format };
};

// Merge imported features into the document's list, dropping exact duplicates
// (same name at the same place) of what is already there.
export const mergeImportedFeatures = (existing, imported) => {
  const have = new Set(existing.map((f) => `${f.name}|${f.coord?.join(",")}`));
  const added = imported.filter((f) => !have.has(`${f.name}|${f.coord?.join(",")}`));
  return { features: [...existing, ...added], added: added.length, duplicates: imported.length - added.length };
};
