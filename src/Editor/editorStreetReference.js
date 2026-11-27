/*!
 * Session-only OSM reference selection for Map Editor V2.
 * Do not persist this in document metadata: historical authored geometry and
 * the scenario's selected basemap remain canonical.
 */
export const streetReferenceActive = ({ enabled = false, online = false, background = null } = {}) =>
  Boolean(enabled && online &&
    !["image", "vector", "raster", "plain"].includes(background?.kind));
