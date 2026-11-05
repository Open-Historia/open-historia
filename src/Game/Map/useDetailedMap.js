/*! Open Historia — one of the scenario's detailed maps, as the map draws it © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario may name several detailed maps (docs/adr/0007); the player sees
// one at a time. useCustomBackground draws the starting map's; this draws any
// other the player picked in Settings → Map: its tiles when they have it, and
// what to offer when they don't (Map/scenarioTerrain.js tiledBasemapOffer).
import { useEffect, useState } from "react";
import { getPmtilesArchive } from "../../runtime/assets.js";
import {
  fetchOfficialBasemaps,
  findOfficialBasemap,
  findOfficialEntry,
  findTiledBasemap,
  subscribeTiledBasemaps,
  tiledBasemapArchiveUrl,
} from "../../runtime/tiledBasemaps.js";
import { resolveTiledBasemap } from "./scenarioTerrain.js";

// A named detailed map is optional on top of a drawn map: opening its archive
// proves it is there and readable before the style asks for a single tile. Any
// failure (a 404, a corrupt header) means the drawn map alone.
export const probeArchive = async (pmtilesUrl) => {
  try {
    const header = await getPmtilesArchive(pmtilesUrl.replace(/^pmtiles:\/\//, "")).getHeader();
    return Boolean(header && header.numTileEntries !== 0);
  } catch {
    return false;
  }
};

const EMPTY = { key: "", tiles: null, missing: null, update: null };

// `named`: { id, version } or { hash }, null for none; `fillOpacity`: the
// scenario's fill ramp for it.
export function useDetailedMap(named, fillOpacity = null) {
  const key = named ? JSON.stringify([named, fillOpacity]) : "";
  const [state, setState] = useState(EMPTY);
  // Bumped when a detailed map is installed or removed, so one waiting for it
  // looks again without a reload.
  const [libraryVersion, setLibraryVersion] = useState(0);
  useEffect(() => subscribeTiledBasemaps(() => setLibraryVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!key) return undefined;
    const [wanted, ramp] = JSON.parse(key);
    const descriptor = { kind: "vector", tiled: wanted, ...(Array.isArray(ramp) ? { fillOpacity: ramp } : {}) };
    let cancelled = false;
    (async () => {
      let meta = wanted.id ? await findOfficialBasemap(wanted.id) : await findTiledBasemap(wanted.hash);
      let drawn = resolveTiledBasemap({ descriptor, setting: "", basemap: meta, archiveUrl: meta ? tiledBasemapArchiveUrl(meta.id) : "" });
      if (drawn.tiles && !(await probeArchive(drawn.tiles.url))) {
        meta = null;
        drawn = { tiles: null, missing: null, update: null };
      }
      if (cancelled) return;
      // The map draws now; what to offer for an official map waits on the
      // official list, which may be slow or unreachable.
      setState({ key, tiles: drawn.tiles, missing: wanted.id ? null : drawn.missing, update: null });
      const officialId = wanted.id || meta?.official?.id;
      if (!officialId) return;
      const official = findOfficialEntry(await fetchOfficialBasemaps(), officialId);
      if (cancelled) return;
      const offered = resolveTiledBasemap({ descriptor, setting: "", basemap: meta, archiveUrl: meta ? tiledBasemapArchiveUrl(meta.id) : "", official });
      setState((current) => (current.key === key ? { ...current, missing: offered.missing, update: offered.update } : current));
    })();
    return () => {
      cancelled = true;
    };
  }, [key, libraryVersion]);

  return state.key === key ? state : EMPTY;
}
