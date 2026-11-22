// The map paints the interface's glass (frostedPanels.js), for as long as a game is on screen.
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import { useMainMenuOpen } from "../GameUI/libraryBar";
import { FROST_CLASS, FROST_LAYER_ID, FROST_PANELS, cornerRadius, createFrostLayer, isOverlay, panelBox, samePanels } from "./frostedPanels.js";
import { enforceMapLayerOrder } from "./mapLayerOrder.js";

// How often the panels are looked for, and how long the map keeps drawing after one moves, as a drawer slides for a moment.
const LOOK_MS = 150;
const FOLLOW_MS = 450;

const FrostLayer = () => {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap?.() ?? mapRef ?? null;
  const mainMenuOpen = useMainMenuOpen();
  const failed = useRef(false);

  // The main menu covers the map, so its buttons keep the browser's blur: nothing moves behind them there.
  useEffect(() => {
    if (!map || mainMenuOpen || failed.current) return undefined;
    const root = document.documentElement;
    root.classList.add(FROST_CLASS);
    return () => root.classList.remove(FROST_CLASS);
  }, [map, mainMenuOpen]);

  useEffect(() => {
    if (!map) return undefined;
    let found = [];
    let shown = [];
    let followUntil = 0;

    const look = () => {
      found = [...document.querySelectorAll(FROST_PANELS)].flatMap((element) => {
        if (isOverlay(element.getBoundingClientRect())) {
          element.style.setProperty("--oh-hud-blur", "var(--oh-hud-glass)");
          return [];
        }
        element.style.removeProperty("--oh-hud-blur");
        const style = getComputedStyle(element);
        return style.visibility === "hidden" || style.opacity === "0" ? [] : [{ element, corner: style.borderTopLeftRadius }];
      });
    };
    const measure = () => {
      const box = map.getCanvas().getBoundingClientRect();
      const canvas = { left: box.left, top: box.top, width: box.width, height: box.height };
      const boxes = found.flatMap(({ element, corner }) => {
        const rect = element.getBoundingClientRect();
        const panel = panelBox(rect, canvas, cornerRadius(corner, rect.width, rect.height));
        return panel ? [panel] : [];
      });
      return { canvas, boxes };
    };
    const fallBackToBrowserBlur = () => {
      failed.current = true;
      document.documentElement.classList.remove(FROST_CLASS);
    };
    const layer = createFrostLayer({
      panels: () => {
        if (performance.now() < followUntil) map.triggerRepaint();
        return measure();
      },
      onError: (error) => {
        console.warn("[frost] the map cannot paint the glass, so the browser blurs it:", error);
        fallBackToBrowserBlur();
      },
    });
    const put = () => {
      try {
        if (!map.style || map.getLayer(FROST_LAYER_ID)) return;
        map.addLayer(layer);
        enforceMapLayerOrder(map);
      } catch { /* the map is between styles: asked again when the next has loaded */ }
    };
    const lost = () => {
      layer.forget();
      fallBackToBrowserBlur();
    };
    const watch = () => {
      if (document.hidden) return;
      look();
      const { boxes } = measure();
      if (samePanels(shown, boxes)) return;
      shown = boxes;
      followUntil = performance.now() + FOLLOW_MS;
      map.triggerRepaint();
    };

    look();
    put();
    map.on("styledata", put);
    map.on("webglcontextlost", lost);
    const timer = setInterval(watch, LOOK_MS);
    return () => {
      clearInterval(timer);
      map.off("styledata", put);
      map.off("webglcontextlost", lost);
      for (const element of document.querySelectorAll(FROST_PANELS)) element.style.removeProperty("--oh-hud-blur");
      try {
        if (map.style && map.getLayer(FROST_LAYER_ID)) map.removeLayer(FROST_LAYER_ID);
      } catch { /* the map is gone */ }
    };
  }, [map]);

  return null;
};

export default FrostLayer;
