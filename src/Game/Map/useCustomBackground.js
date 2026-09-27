/*! Open Historia — custom map background loader © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useCallback, useEffect, useRef, useState } from "react";
import { JSON_URLS, PMTILES_ARCHIVES, PMTILES_PROTOCOL_URLS, getPmtilesArchive, readJson } from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSettingValue } from "../../runtime/mapSettings.js";
import { normalizeScenarioTerrain, wantsScenarioTerrain } from "./scenarioTerrain.js";
import { useWorldBackground } from "./useWorldState.js";

// Relief tiles are optional on top of a vector background: opening the archive
// proves it is there and readable before the style asks for a single tile. Any
// failure (no archive, a 404, a corrupt header) means the vector background alone.
const probeTerrainArchive = async () => {
  try {
    const header = await getPmtilesArchive(PMTILES_ARCHIVES.terrain).getHeader();
    return Boolean(header && header.numTileEntries !== 0);
  } catch {
    return false;
  }
};

export function useCustomBackground() {
  const { background: bgDescriptor, basemap: worldBasemap } = useWorldBackground();
  const terrainSetting = useMapSettingValue(MAP_SETTING_KEYS.scenarioTerrain);
  const [state, setState] = useState({ background: null, declared: false, basemap: null });
  const keyRef = useRef("");

  const terrain = wantsScenarioTerrain(terrainSetting) ? normalizeScenarioTerrain(bgDescriptor) : null;
  const bgKey = bgDescriptor?.kind ? `${JSON.stringify(bgDescriptor)}|${terrain ? "relief" : "painted"}` : "";
  const basemap = worldBasemap || null;

  useEffect(() => {
    if (bgKey === keyRef.current) {
      setState((s) => (s.basemap === basemap ? s : { ...s, basemap }));
      return;
    }
    keyRef.current = bgKey;

    if (!bgKey) {
      setState({ background: null, declared: false, basemap });
      return;
    }

    // Commit to "no ESRI" from the light descriptor right away, then load the
    // heavy payload and swap in the actual image/vector.
    setState({ background: null, declared: true, basemap });

    let cancelled = false;
    let payloadFailed = false;

    (async () => {
      let data = null;
      try {
        data = await readJson(JSON_URLS.backgroundData, { force: true });
      } catch {
        payloadFailed = true;
      }
      const terrainReady = terrain && data?.geojson ? await probeTerrainArchive() : false;
      if (cancelled || keyRef.current !== bgKey) return;

      if (bgDescriptor?.kind === "image" && data?.dataUrl) {
        setState({ background: { kind: "image", imageUrl: data.dataUrl }, declared: true, basemap });
      } else if (bgDescriptor?.kind === "vector" && data?.geojson) {
        setState({
          background: {
            kind: "vector",
            geojson: data.geojson,
            ...(terrainReady ? { terrain: { ...terrain, url: PMTILES_PROTOCOL_URLS.terrain } } : {}),
          },
          declared: true,
          basemap,
        });
      } else {
        if (payloadFailed) keyRef.current = "";
        setState({ background: null, declared: false, basemap });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bgKey, basemap, bgDescriptor, terrain]);

  return state;
}
