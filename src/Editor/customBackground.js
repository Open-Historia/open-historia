/*! Open Historia Map Editor — custom background loaders © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Turns a user-uploaded map background into an OpenLayers layer (or, for a plain
// image, a descriptor the editor places with drag handles). Georeferenced
// formats carry their own coordinates and slot straight onto the EPSG:3857 map;
// GeoTIFF/PMTiles render as raster; PNG/JPG/SVG have no coordinates, so they come
// back as an image descriptor for the editor to position.
//
// The heavy parsers (shpjs, jszip) are dynamically imported so they only load
// when a matching file is actually chosen — the editor bundle stays lean.
import GeoJSON from "ol/format/GeoJSON";
import KML from "ol/format/KML";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import WebGLTileLayer from "ol/layer/WebGLTile";
import GeoTIFFSource from "ol/source/GeoTIFF";
import TileLayer from "ol/layer/Tile";
import Style from "ol/style/Style";
import Stroke from "ol/style/Stroke";
import Fill from "ol/style/Fill";
import { PMTilesRasterSource } from "ol-pmtiles";

// Accept string for the upload <input>. Kept in sync with the switch below.
export const BACKGROUND_ACCEPT =
  ".geojson,.json,.kml,.kmz,.zip,.shp,.tif,.tiff,.pmtiles,.png,.jpg,.jpeg,.svg," +
  "image/png,image/jpeg,image/svg+xml,application/geo+json";

const extOf = (name) => (name.split(".").pop() || "").toLowerCase();

// A generic uploaded vector reads as reference geometry — a soft blue outline that
// doesn't hide the regions drawn on top. But a feature that carries its own `fill`
// colour (the generated biome basemap) is painted with it, so the terrain backdrop
// actually shows — matching how the game renders the same background.
const referenceStyle = new Style({
  stroke: new Stroke({ color: "rgba(96,165,250,0.9)", width: 1.2 }),
  fill: new Fill({ color: "rgba(96,165,250,0.10)" }),
});
const biomeStyleCache = new Map();
const vectorStyle = (feature) => {
  const fill = feature.get("fill");
  if (!fill) return referenceStyle;
  let style = biomeStyleCache.get(fill);
  if (!style) {
    style = new Style({ fill: new Fill({ color: fill }), stroke: new Stroke({ color: "rgba(0,0,0,0.12)", width: 0.5 }) });
    biomeStyleCache.set(fill, style);
  }
  return style;
};

const readAsFeatures = (parseFn) => {
  const source = new VectorSource({ features: parseFn() });
  return new VectorLayer({ source, style: vectorStyle, updateWhileInteracting: false });
};

const readGeoJSON = async (file) => {
  const data = JSON.parse(await file.text());
  const layer = readAsFeatures(() =>
    new GeoJSON().readFeatures(data, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
  );
  return { kind: "vector", layer };
};

const featuresFromKmlText = (text) =>
  new KML({ extractStyles: false }).readFeatures(text, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });

const readKMZ = async (file) => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const kmlName = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".kml"));
  if (!kmlName) throw new Error("No .kml found inside the .kmz archive.");
  const text = await zip.files[kmlName].async("string");
  return { kind: "vector", layer: readAsFeatures(() => featuresFromKmlText(text)) };
};

const readShapefile = async (file) => {
  const shp = (await import("shpjs")).default;
  // shpjs accepts a zip of the .shp/.dbf/.prj sidecars, or a bare .shp buffer.
  const result = await shp(await file.arrayBuffer());
  const collections = Array.isArray(result) ? result : [result];
  const fmt = new GeoJSON();
  const layer = readAsFeatures(() =>
    collections.flatMap((fc) =>
      fmt.readFeatures(fc, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
    ),
  );
  return { kind: "vector", layer };
};

const readGeoTIFF = async (file) => {
  const url = URL.createObjectURL(file);
  const source = new GeoTIFFSource({ sources: [{ url }], convertToRGB: "auto", normalize: true });
  return { kind: "raster", layer: new WebGLTileLayer({ source }), cleanup: () => URL.revokeObjectURL(url) };
};

const readPMTiles = async (file) => {
  const url = URL.createObjectURL(file);
  const source = new PMTilesRasterSource({ url, attributions: [] });
  return { kind: "raster", layer: new TileLayer({ source }), cleanup: () => URL.revokeObjectURL(url) };
};

const readImage = async (file) => {
  // A data URL doubles as the render source AND the persisted copy (an object URL
  // wouldn't survive a save/reload), and avoids object-URL lifecycle management.
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that image."));
    r.readAsDataURL(file);
  });
  const size = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ width: el.naturalWidth || 1000, height: el.naturalHeight || 1000 });
    el.onerror = () => reject(new Error("Could not read that image."));
    el.src = dataUrl;
  });
  // The editor places this with drag handles; it owns the ImageStatic layer.
  return { kind: "image", url: dataUrl, dataUrl, aspect: size.width / size.height };
};

export const loadBackgroundFile = async (file) => {
  const ext = extOf(file.name);
  const type = (file.type || "").toLowerCase();

  if (ext === "geojson" || ext === "json" || type.includes("geo+json")) return readGeoJSON(file);
  if (ext === "kml") {
    const text = await file.text();
    return { kind: "vector", layer: readAsFeatures(() => featuresFromKmlText(text)) };
  }
  if (ext === "kmz") return readKMZ(file);
  if (ext === "shp" || ext === "zip") return readShapefile(file);
  if (ext === "tif" || ext === "tiff") return readGeoTIFF(file);
  if (ext === "pmtiles") return readPMTiles(file);
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "svg" || type.startsWith("image/")) {
    return readImage(file);
  }
  throw new Error(`Unsupported background format: .${ext || type || "unknown"}`);
};

// Persistence helpers: only formats that fit in the JSON document are saved with
// it (vector as GeoJSON, images as a data URL + placement). GeoTIFF/PMTiles are
// rendered for the session; persisting those big binaries is a follow-up.
export const vectorLayerToGeoJSON = (layer) =>
  JSON.parse(
    new GeoJSON().writeFeatures(layer.getSource().getFeatures(), {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857",
      decimals: 6,
    }),
  );

export const vectorLayerFromGeoJSON = (geojson) =>
  readAsFeatures(() =>
    new GeoJSON().readFeatures(geojson, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
  );

// Rebuild a live background descriptor from what was saved in the document
// (vector GeoJSON, or an image data URL + WGS84 placement). Raster (GeoTIFF/
// PMTiles) is session-only, so it never round-trips through here.
// `persisted` (default true) marks a background restored from a saved doc/scenario
// so the OlMap effect renders it WITHOUT re-emitting it into the document (which
// would dirty it and trigger a stray autosave). Pass persisted:false when the user
// deliberately picks a basemap — that IS an edit and should save.
export const rebuildPersistedBackground = (saved, { persisted = true } = {}) => {
  if (!saved) return null;
  if (saved.kind === "vector") {
    return { kind: "vector", persisted, layer: vectorLayerFromGeoJSON(saved.geojson) };
  }
  if (saved.kind === "image") {
    return {
      kind: "image",
      persisted,
      url: saved.dataUrl,
      dataUrl: saved.dataUrl,
      aspect: saved.aspect || 1,
      extentWgs84: saved.extentWgs84 || null,
    };
  }
  return null;
};
