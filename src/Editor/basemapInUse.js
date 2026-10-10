/*! Open Historia — which map the Maps window marks "In use" © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Maps window (BasemapPicker.jsx) marks the map the scenario is drawn on.
// A built-in basemap only while the scenario has no map of its own: a drawn or
// picture map leaves the document's built-in id behind (Ocean, by default), and
// that map is not what anyone sees. Of the library's maps: the one just picked,
// and the scenario's detailed map (doc.metadata.tiledBasemap), named by its
// official id or by the checksum of the author's own file.
export const basemapInUse = ({ builtinId = "", hasOwnMap = false, libraryId = null, detailedMap = null } = {}) => {
  const isDetailedMap = (bm) => bm?.kind === "tiled" && Boolean(
    (detailedMap?.id && bm.official?.id === detailedMap.id) || (detailedMap?.hash && bm.contentHash === detailedMap.hash),
  );
  return {
    builtin: (id) => !hasOwnMap && !libraryId && builtinId === id,
    library: (bm) => Boolean(bm) && (bm.id === libraryId || isDetailedMap(bm)),
  };
};
