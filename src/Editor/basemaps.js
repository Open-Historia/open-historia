/*! Open Historia Map Editor — ESRI basemap presets © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// ESRI / ArcGIS Online basemaps (public, token-free) shown behind the editor's
// regions so you can see where you're drawing. Kept local to the editor so it
// doesn't pull the game's runtime/assets.js (and its maplibre/pmtiles module
// side effects) into the lazily-loaded editor bundle. Ocean is first = default.
export const EDITOR_BASEMAPS = [
  { id: "ocean", label: "Ocean", service: "Ocean/World_Ocean_Base", maxZoom: 13 },
  { id: "imagery", label: "Satellite", service: "World_Imagery", maxZoom: 19 },
  { id: "streets", label: "Streets", service: "World_Street_Map", maxZoom: 19 },
  { id: "topo", label: "Topographic", service: "World_Topo_Map", maxZoom: 19 },
  { id: "terrain", label: "Terrain", service: "World_Terrain_Base", maxZoom: 13 },
  { id: "shaded", label: "Shaded Relief", service: "World_Shaded_Relief", maxZoom: 13 },
  { id: "natgeo", label: "National Geographic", service: "NatGeo_World_Map", maxZoom: 16 },
  { id: "physical", label: "Physical", service: "World_Physical_Map", maxZoom: 8 },
  { id: "light-gray", label: "Light Gray Canvas", service: "Canvas/World_Light_Gray_Base", maxZoom: 16 },
  { id: "dark-gray", label: "Dark Gray Canvas", service: "Canvas/World_Dark_Gray_Base", maxZoom: 16 },
];

export const editorBasemapById = (id) => EDITOR_BASEMAPS.find((b) => b.id === id) || null;

// EPSG:3857 XYZ template for an ESRI service — the editor View is web-mercator,
// so these render without reprojection.
export const esriXyzUrl = (service) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;

// The z0 tile is the whole world in a single ~20 KB image — a perfect low-res
// preview for the basemap picker (no extra generation, cached by the browser).
export const esriPreviewUrl = (service) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/0/0/0`;
