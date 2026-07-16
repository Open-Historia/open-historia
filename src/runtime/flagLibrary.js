/*! Open Historia — flag library client © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */

// Thin fetch client for the map-maker's saved flags ("My flags"), mirroring
// basemapLibrary.js: the same /api/* call works against Express on the download and
// against the IndexedDB router on the website, so the editor needs no build-mode
// awareness. Kept dependency-free so the editor stays light.

const API = "/api/flags";

// Never throws — the picker renders an empty shelf rather than an error if the
// library is unreachable (same contract as listBasemaps).
export const listFlags = async () => {
  try {
    const r = await fetch(API);
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
};

export const saveFlag = async (body) => {
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Save flag: HTTP ${r.status}`);
  return r.json();
};

export const deleteFlag = async (id) => {
  const r = await fetch(`${API}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`Delete flag: HTTP ${r.status}`);
  return r.json();
};
