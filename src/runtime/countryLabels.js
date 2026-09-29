/*! Open Historia — portions (custom-region owner labels) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import {
  PMTILES_ARCHIVES,
  decodeVectorTile,
  getPmtilesArchive,
  resolveCountryDisplayName,
} from "./assets.js";

const EMPTY_FEATURE_COLLECTION = { type: "FeatureCollection", features: [] };

let regionLabelGeometryPromise = null;
let regionLabelGeometryKey = null;

// Owner labels only need coarse region shapes. Reading the z0 PMTiles tile keeps
// startup in the hundreds of kilobytes instead of loading the editor's ~55 MB
// full-resolution GeoJSON and walking millions of vertices on the main thread.
export const loadRegionLabelGeometry = async () => {
  const archiveUrl = PMTILES_ARCHIVES.regions;
  if (regionLabelGeometryPromise && regionLabelGeometryKey === archiveUrl) {
    return regionLabelGeometryPromise;
  }

  regionLabelGeometryKey = archiveUrl;
  const request = (async () => {
    const pmtiles = getPmtilesArchive(archiveUrl);
    const tileData = await pmtiles.getZxy(0, 0, 0);
    if (!tileData?.data) throw new Error("Regional z0 tile is unavailable.");

    const tile = await decodeVectorTile(tileData.data);
    const layer = tile.layers.regions;
    if (!layer) throw new Error("Regional z0 tile has no regions layer.");

    const features = [];
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const props = feature.properties ?? {};
      const id = props.GID_1 || props.gid_1 || props.HASC_1 || props.fid;
      if (!id) continue;
      const geojson = feature.toGeoJSON(0, 0, 0);
      if (!geojson?.geometry) continue;
      const gid0 = props.GID_0 || props.gid_0 || "";
      const country = resolveCountryDisplayName(
        props.COUNTRY || props.Country || props.country,
        gid0,
      );
      features.push({
        type: "Feature",
        geometry: geojson.geometry,
        properties: {
          id: String(id),
          gid0: String(gid0),
          country,
          owner: country,
        },
      });
    }

    return { type: "FeatureCollection", features };
  })();
  const handled = request.catch((error) => {
    if (regionLabelGeometryPromise === handled) regionLabelGeometryPromise = null;
    console.error("Failed to load regional label geometry:", error);
    return EMPTY_FEATURE_COLLECTION;
  });
  regionLabelGeometryPromise = handled;

  return regionLabelGeometryPromise;
};
