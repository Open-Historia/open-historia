/*! Open Historia — custom map background loader © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import { useCallback, useEffect, useRef, useState } from "react";
import { JSON_URLS, readJson } from "../../runtime/assets.js";
import { useWorldBackground } from "./useWorldState.js";

export function useCustomBackground() {
  const { background: bgDescriptor, basemap: worldBasemap } = useWorldBackground();
  const [state, setState] = useState({ background: null, declared: false, basemap: null });
  const keyRef = useRef("");

  const bgKey = bgDescriptor?.kind ? JSON.stringify(bgDescriptor) : "";
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
      if (cancelled || keyRef.current !== bgKey) return;

      if (bgDescriptor?.kind === "image" && data?.dataUrl) {
        setState({ background: { kind: "image", imageUrl: data.dataUrl }, declared: true, basemap });
      } else if (bgDescriptor?.kind === "vector" && data?.geojson) {
        setState({ background: { kind: "vector", geojson: data.geojson }, declared: true, basemap });
      } else {
        if (payloadFailed) keyRef.current = "";
        setState({ background: null, declared: false, basemap });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bgKey, basemap, bgDescriptor]);

  return state;
}
