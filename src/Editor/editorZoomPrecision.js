/*!
 * Map Editor V2 - native view and region-boundary precision.
 * The native region-type style bands reach zoom 24. Keep the editing view
 * consistent with them, without asserting imagery has 24 native tile levels.
 */
export const EDITOR_MIN_ZOOM = 1;
export const EDITOR_MAX_ZOOM = 24;
export const EDITOR_FOCUS_MAX_ZOOM = 20;

// Seven decimal degrees (~1 cm latitude) preserve close-up boundary work.
// Five-decimal WGS84 export rounded a moved vertex to approximately a metre.
export const EDITOR_REGION_DECIMALS = 7;
export const EDITOR_REGION_GEOJSON_OPTIONS = Object.freeze({
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857",
  decimals: EDITOR_REGION_DECIMALS,
});
