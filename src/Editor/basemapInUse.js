/*! Open Historia — which map the Maps window marks "In use" © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The Maps window (BasemapPicker.jsx) marks the map the scenario is drawn on.
// A built-in basemap only while the scenario has no map of its own: a drawn or
// picture map leaves the document's built-in id behind (Ocean, by default), and
// that map is not what anyone sees. Of the library's maps: the one just picked;
// the painted or picture basemap holding the scenario's own map, found by its
// checksum when the scenario is opened again (ownMapHash.js); and the
// scenario's detailed map (doc.metadata.tiledBasemap), named by its official id
// or by the checksum of the author's own file. An own map in no card gets a
// card of its own (ownMapCard), so something always says what is in use.
export const basemapInUse = ({ builtinId = "", hasOwnMap = false, libraryId = null, detailedMap = null, ownMapHash = null } = {}) => {
  const isDetailedMap = (bm) => bm?.kind === "tiled" && Boolean(
    (detailedMap?.id && bm.official?.id === detailedMap.id) || (detailedMap?.hash && bm.contentHash === detailedMap.hash),
  );
  const holdsOwnMap = (bm) => bm?.kind !== "tiled" && Boolean(
    bm?.id === libraryId || (hasOwnMap && ownMapHash && bm?.contentHash === ownMapHash),
  );
  return {
    builtin: (id) => !hasOwnMap && !libraryId && builtinId === id,
    library: (bm) => Boolean(bm) && (holdsOwnMap(bm) || bm.id === libraryId || isDetailedMap(bm)),
    ownMapCard: (library) => hasOwnMap && !(library ?? []).some(holdsOwnMap),
  };
};
