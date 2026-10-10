/*! Open Historia — the scenario's own map, fingerprinted as the library does © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The checksum the library knows a basemap by (server/basemapHash.js), taken of
// one of the scenario's maps (scenarioMaps.js): its picture's data URL, or its
// drawing's GeoJSON as JSON. The Maps window uses it to mark the Your basemaps
// card holding the same map, and to offer "Save to Your basemaps" for one no
// card holds. A plain sea, or a background with nothing to hash, has none.
export const ownMapHash = async (background) => {
  const canonical = background?.kind === "image" && background.dataUrl
    ? background.dataUrl
    : background?.kind === "vector" && background.geojson
      ? JSON.stringify(background.geojson)
      : null;
  if (canonical == null) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
