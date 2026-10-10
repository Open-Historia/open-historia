/*! Open Historia — a basemap's checksum © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The checksum a painted or picture basemap is known by in the library
// (basemapStore.js): SHA-256 of its picture's data URL, or of its drawing's
// GeoJSON as JSON. The Map Editor takes the same checksum of a scenario's own
// map to find its card (src/Editor/ownMapHash.js).
import crypto from "crypto";

export const hashPayload = (payload) => {
  const canonical = payload?.dataUrl ?? JSON.stringify(payload?.geojson ?? payload ?? null);
  return crypto.createHash("sha256").update(String(canonical)).digest("hex");
};
