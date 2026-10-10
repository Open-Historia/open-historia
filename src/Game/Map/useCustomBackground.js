/*! Open Historia — custom map background loader © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { useEffect, useMemo, useRef, useState } from "react";
import { JSON_URLS, decodeOwnBasemaps, hasOwnMap, readJson } from "../../runtime/assets.js";
import { MAP_SETTING_KEYS, useMapSettingValue } from "../../runtime/mapSettings.js";
import {
  fetchOfficialBasemaps,
  findOfficialBasemap,
  findOfficialEntry,
  findTiledBasemap,
  subscribeTiledBasemaps,
  tiledBasemapArchiveUrl,
} from "../../runtime/tiledBasemaps.js";
import { resolveTiledBasemap, scenarioTiledBasemap, wantsScenarioTerrain } from "./scenarioTerrain.js";
import { useWorldBackground } from "./useWorldState.js";
import { normalizeImageBounds } from "../../../server/mapProjection.js";
import { probeArchive } from "./useDetailedMap.js";

// The scenario's background as the map draws it. `missingTiled` is set when the
// scenario names a Tiled Basemap the player does not have yet (Map shows its
// basemap meanwhile, and the game offers the download); `tiledUpdate` when
// they have it and the official list has a newer version
// (Map/scenarioTerrain.js tiledBasemapOffer).
const EMPTY = { background: null, declared: false, basemap: null, missingTiled: null, tiledUpdate: null };

export function useCustomBackground() {
  const { background: bgDescriptor, basemap: worldBasemap, allowedBasemaps, ownBasemaps } = useWorldBackground();
  const terrainSetting = useMapSettingValue(MAP_SETTING_KEYS.scenarioTerrain);
  const [state, setState] = useState(EMPTY);
  const keyRef = useRef("");
  const descriptorRef = useRef("");
  // Bumped when a Tiled Basemap is installed or removed, so a scenario waiting
  // for one looks again without a reload.
  const [libraryVersion, setLibraryVersion] = useState(0);
  useEffect(() => subscribeTiledBasemaps(() => setLibraryVersion((v) => v + 1)), []);

  const namedTiledBasemap = wantsScenarioTerrain(terrainSetting) ? scenarioTiledBasemap(bgDescriptor) : null;
  const bgKey = hasOwnMap(bgDescriptor) ? `${JSON.stringify(bgDescriptor)}|${namedTiledBasemap ? `tiled:${libraryVersion}` : "painted"}` : "";
  const basemap = worldBasemap || null;

  useEffect(() => {
    if (bgKey === keyRef.current) {
      setState((s) => (s.basemap === basemap ? s : { ...s, basemap }));
      return;
    }
    keyRef.current = bgKey;

    if (!bgKey) {
      setState({ ...EMPTY, basemap });
      return;
    }

    // A plain sea in place of the built-in tiles (a map that is not Mercator
    // and has no basemap of its own): declared, and nothing to load.
    if (bgDescriptor?.kind === "plain") {
      setState({ ...EMPTY, declared: true, basemap });
      return undefined;
    }

    // Commit to "no ESRI" from the light descriptor right away, then load the
    // heavy payload and swap in the actual image/vector.
    // A Basemap arriving for the same scenario keeps its painted background on
    // screen meanwhile; a different background starts from nothing.
    const sameDescriptor = descriptorRef.current === JSON.stringify(bgDescriptor);
    descriptorRef.current = JSON.stringify(bgDescriptor);
    setState((s) => ({ ...EMPTY, background: sameDescriptor ? s.background : null, declared: true, basemap }));

    let cancelled = false;
    let payloadFailed = false;
    const current = () => !cancelled && keyRef.current === bgKey;

    (async () => {
      let data = null;
      try {
        data = await readJson(JSON_URLS.backgroundData, { force: true });
      } catch {
        payloadFailed = true;
      }
      let meta = null;
      let drawn = { tiles: null, missing: null, update: null };
      if (namedTiledBasemap && data?.geojson) {
        meta = namedTiledBasemap.id ? await findOfficialBasemap(namedTiledBasemap.id) : await findTiledBasemap(namedTiledBasemap.hash);
        drawn = resolveTiledBasemap({
          descriptor: bgDescriptor,
          setting: terrainSetting,
          basemap: meta,
          archiveUrl: meta ? tiledBasemapArchiveUrl(meta.id) : "",
        });
        if (drawn.tiles && !(await probeArchive(drawn.tiles.url))) {
          meta = null;
          drawn = { tiles: null, missing: null, update: null };
        }
      }
      if (!current()) return;

      if (bgDescriptor?.kind === "image" && data?.dataUrl) {
        setState({ ...EMPTY, background: { kind: "image", imageUrl: data.dataUrl, bounds: normalizeImageBounds(bgDescriptor.bounds) }, declared: true, basemap });
        return;
      }
      if (!(bgDescriptor?.kind === "vector" && data?.geojson)) {
        if (payloadFailed) keyRef.current = "";
        setState({ ...EMPTY, basemap });
        return;
      }
      // The map draws now. What to offer for an official map waits on the
      // official list, which may be slow or unreachable and must never hold
      // the map up; a map named by checksum alone has nothing to look up.
      setState({
        ...EMPTY,
        background: { kind: "vector", geojson: data.geojson, ...(drawn.tiles ? { terrain: drawn.tiles } : {}) },
        declared: true,
        basemap,
        missingTiled: namedTiledBasemap?.id ? null : drawn.missing,
      });
      const officialId = namedTiledBasemap?.id || meta?.official?.id;
      if (!officialId) return;
      const official = findOfficialEntry(await fetchOfficialBasemaps(), officialId);
      if (!current()) return;
      const offered = resolveTiledBasemap({
        descriptor: bgDescriptor,
        setting: terrainSetting,
        basemap: meta,
        archiveUrl: meta ? tiledBasemapArchiveUrl(meta.id) : "",
        official,
      });
      setState((s) => ({ ...s, missingTiled: offered.missing, tiledUpdate: offered.update }));
    })();

    return () => {
      cancelled = true;
    };
  }, [bgKey, basemap, bgDescriptor, namedTiledBasemap, terrainSetting]);

  // Which built-in maps the scenario lets the player switch to (a string; null =
  // any), and its other basemaps of its own (a string; runtime/assets.js).
  return { ...state, allowedBasemaps, ownBasemaps };
}

// One of the scenario's other basemaps of its own, which the player picked in
// Settings → Map, as the map draws it: its payload from the ownBasemapsData
// asset. null until it has loaded, or when `id` is "" or the payload is not
// there (World.jsx then keeps the scenario's main one on screen).
// A picture is laid on the scenario's sheet (useWorldState.js pictureSheet).
export function useOwnBasemap(id) {
  const { ownBasemaps, pictureSheet } = useWorldBackground();
  const entry = id ? decodeOwnBasemaps(ownBasemaps).find((own) => own.id === id) : null;
  const kind = entry?.kind || "";
  const [loaded, setLoaded] = useState({ id: "", background: null });
  const bounds = useMemo(() => (pictureSheet ? normalizeImageBounds(JSON.parse(pictureSheet)) : null), [pictureSheet]);

  useEffect(() => {
    if (!id || !kind) return undefined;
    let cancelled = false;
    readJson(JSON_URLS.ownBasemapsData, { force: true })
      .catch(() => null)
      .then((data) => {
        if (cancelled) return;
        const payload = data && typeof data === "object" ? data[id] : null;
        const background = kind === "image" && payload?.dataUrl
          ? { kind: "image", imageUrl: payload.dataUrl, bounds: null }
          : kind === "vector" && payload?.geojson ? { kind: "vector", geojson: payload.geojson } : null;
        setLoaded({ id, background });
      });
    return () => {
      cancelled = true;
    };
  }, [id, kind]);

  const background = entry && loaded.id === id ? loaded.background : null;
  return useMemo(() => (background?.kind === "image" ? { ...background, bounds } : background), [background, bounds]);
}
