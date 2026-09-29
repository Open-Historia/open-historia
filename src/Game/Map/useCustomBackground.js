/*! Open Historia — custom map background loader © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useEffect, useRef, useState } from "react";
import { JSON_URLS, getPmtilesArchive, readJson } from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSettingValue } from "../../runtime/mapSettings.js";
import { findTiledBasemap, subscribeTiledBasemaps, tiledBasemapArchiveUrl } from "../../runtime/tiledBasemaps.js";
import { resolveTiledBasemap, scenarioTiledBasemap, wantsScenarioTerrain } from "./scenarioTerrain.js";
import { useWorldBackground } from "./useWorldState.js";

// A named Tiled Basemap is optional on top of a vector background: opening its
// archive proves it is there and readable before the style asks for a single
// tile. Any failure (a 404, a corrupt header) means the vector background alone.
const probeArchive = async (pmtilesUrl) => {
  try {
    const header = await getPmtilesArchive(pmtilesUrl.replace(/^pmtiles:\/\//, "")).getHeader();
    return Boolean(header && header.numTileEntries !== 0);
  } catch {
    return false;
  }
};

// The scenario's background as the map draws it. `missingTiled` is set when the
// scenario names a Tiled Basemap the player does not have yet (Map shows its
// painted fallback meanwhile, and the game offers the download).
export function useCustomBackground() {
  const { background: bgDescriptor, basemap: worldBasemap } = useWorldBackground();
  const terrainSetting = useMapSettingValue(MAP_SETTING_KEYS.scenarioTerrain);
  const [state, setState] = useState({ background: null, declared: false, basemap: null, missingTiled: null });
  const keyRef = useRef("");
  const descriptorRef = useRef("");
  // Bumped when a Tiled Basemap is installed or removed, so a scenario waiting
  // for one looks again without a reload.
  const [libraryVersion, setLibraryVersion] = useState(0);
  useEffect(() => subscribeTiledBasemaps(() => setLibraryVersion((v) => v + 1)), []);

  const namedTiledBasemap = wantsScenarioTerrain(terrainSetting) ? scenarioTiledBasemap(bgDescriptor) : null;
  const bgKey = bgDescriptor?.kind ? `${JSON.stringify(bgDescriptor)}|${namedTiledBasemap ? `tiled:${libraryVersion}` : "painted"}` : "";
  const basemap = worldBasemap || null;

  useEffect(() => {
    if (bgKey === keyRef.current) {
      setState((s) => (s.basemap === basemap ? s : { ...s, basemap }));
      return;
    }
    keyRef.current = bgKey;

    if (!bgKey) {
      setState({ background: null, declared: false, basemap, missingTiled: null });
      return;
    }

    // Commit to "no ESRI" from the light descriptor right away, then load the
    // heavy payload and swap in the actual image/vector.
    // A Basemap arriving for the same scenario keeps its painted background on
    // screen meanwhile; a different background starts from nothing.
    const sameDescriptor = descriptorRef.current === JSON.stringify(bgDescriptor);
    descriptorRef.current = JSON.stringify(bgDescriptor);
    setState((s) => ({ background: sameDescriptor ? s.background : null, declared: true, basemap, missingTiled: null }));

    let cancelled = false;
    let payloadFailed = false;

    (async () => {
      let data = null;
      try {
        data = await readJson(JSON_URLS.backgroundData, { force: true });
      } catch {
        payloadFailed = true;
      }
      let drawn = { tiles: null, missing: null };
      if (namedTiledBasemap && data?.geojson) {
        const meta = await findTiledBasemap(namedTiledBasemap.hash);
        drawn = resolveTiledBasemap({
          descriptor: bgDescriptor,
          setting: terrainSetting,
          basemap: meta,
          archiveUrl: meta ? tiledBasemapArchiveUrl(meta.id) : "",
        });
        if (drawn.tiles && !(await probeArchive(drawn.tiles.url))) drawn = { tiles: null, missing: null };
      }
      if (cancelled || keyRef.current !== bgKey) return;

      if (bgDescriptor?.kind === "image" && data?.dataUrl) {
        setState({ background: { kind: "image", imageUrl: data.dataUrl }, declared: true, basemap, missingTiled: null });
      } else if (bgDescriptor?.kind === "vector" && data?.geojson) {
        setState({
          background: { kind: "vector", geojson: data.geojson, ...(drawn.tiles ? { terrain: drawn.tiles } : {}) },
          declared: true,
          basemap,
          missingTiled: drawn.missing,
        });
      } else {
        if (payloadFailed) keyRef.current = "";
        setState({ background: null, declared: false, basemap, missingTiled: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bgKey, basemap, bgDescriptor, namedTiledBasemap, terrainSetting]);

  return state;
}
