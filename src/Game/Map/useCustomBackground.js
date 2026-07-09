/*! Open Historia — custom map background loader © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useEffect, useRef, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";

// Reads the active game's custom map background. The light descriptor rides on
// the polled world.json (world.background = { kind }); the heavy payload (image
// data URL / vector GeoJSON) is fetched once from the backgroundData asset.
//
// Returns { background, declared }:
//   - declared: a background is present per the light world.json poll. Flipped on
//     as soon as that resolves — BEFORE the heavy payload — so the map can drop
//     the ESRI basemap immediately instead of flashing satellite Earth.
//   - background: { kind:"image", imageUrl } | { kind:"vector", geojson } | null,
//     available once the payload has loaded. Its reference is kept STABLE while
//     unchanged so the map style isn't rebuilt on every 5s poll.
export function useCustomBackground() {
  const [state, setState] = useState({ background: null, declared: false, basemap: null });
  const keyRef = useRef("");
  const basemapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const world = await readJson(JSON_URLS.world, { defaultValue: {}, force: true }).catch(() => ({}));
      if (cancelled) return;
      // The scenario's chosen built-in basemap (an ESRI preset id) — the game
      // renders it when there's no custom background. Rarely changes (no in-game
      // picker), so we only re-render when it actually does.
      const basemap = world?.basemap || null;
      basemapRef.current = basemap;
      const desc = world?.background;
      // Key on the whole descriptor, not just kind: swapping one image
      // background for another (both kind "image") kept showing the old one
      // until a full reload, because the key never changed.
      const key = desc && desc.kind ? JSON.stringify(desc) : "";
      if (key === keyRef.current) {
        setState((s) => (s.basemap === basemap ? s : { ...s, basemap })); // keep stable ref
        return;
      }
      keyRef.current = key;
      if (!key) {
        setState({ background: null, declared: false, basemap });
        return;
      }
      // Commit to "no ESRI" from the light descriptor right away, then load the
      // heavy payload and swap in the actual image/vector.
      setState({ background: null, declared: true, basemap });
      // Read without a default so a transient fetch failure rejects (rather than
      // silently resolving to null) and we can tell it apart from a genuinely
      // empty payload.
      let data = null;
      let payloadFailed = false;
      try {
        data = await readJson(JSON_URLS.backgroundData, { force: true });
      } catch {
        payloadFailed = true;
      }
      if (cancelled || keyRef.current !== key) return; // superseded while loading
      if (desc.kind === "image" && data?.dataUrl) setState({ background: { kind: "image", imageUrl: data.dataUrl }, declared: true, basemap: basemapRef.current });
      else if (desc.kind === "vector" && data?.geojson) setState({ background: { kind: "vector", geojson: data.geojson }, declared: true, basemap: basemapRef.current });
      else {
        // Don't pin a permanent blank after a failed payload fetch — clear the
        // cached key so the next poll retries instead of short-circuiting above.
        if (payloadFailed) keyRef.current = "";
        setState({ background: null, declared: false, basemap: basemapRef.current });
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return state;
}
