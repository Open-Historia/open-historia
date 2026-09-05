/*! Open Historia — map scene composition © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { Suspense, lazy } from "react";
import Nations from "./Nations";
import Cities from "./Cities";
import MarkersLayer from "./MarkersLayer.jsx";
import Units from "./Units";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import UnitPopup from "../Selection/Units";
import FeaturePopup from "../Selection/Features.jsx";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

// The legacy renderer is some 2,400 lines that ship off by default, so it is
// its own chunk, fetched only when the setting is on — the shape the editor and
// the debug console already take (App.jsx, GameUI/main.jsx). Both lazies name
// the same module so Rollup emits one chunk for the pair.
const LegacyScene = lazy(() => import("./legacy/index.jsx"));
const LegacyLayerOrder = lazy(() => import("./legacy/index.jsx").then((module) => ({ default: module.LegacyLayerOrder })));

// The camera/basemap shell lives in World.jsx. Everything that is projected
// into that world lives here, in deliberate paint/placement order. Keeping the
// scene graph behind one boundary keeps layer changes decoupled from
// projection, terrain, or GPU lifecycle.
//
// It is also the single place the renderer choice is made. The legacy map is a
// copy of the components under src/Game/Map/legacy/ (see legacy/README for the
// few deliberate edits it carries); with the setting off the current renderer's
// files render exactly as they do without this feature at all. Switching is a
// remount, not a restyle: World.jsx keys the map instance on the renderer, and
// Settings announces the redraw so the game loading screen covers it.
const MapScene = ({ isGlobe = false }) => {
  const legacy = useMapSetting(MAP_SETTING_KEYS.legacyMapRenderer);
  return (
    <>
      {legacy ? (
        <Suspense fallback={null}>
          <LegacyScene isGlobe={isGlobe} />
        </Suspense>
      ) : (
        <>
          <Nations isGlobe={isGlobe} />
          <Cities />
          <MarkersLayer />
        </>
      )}
      {/* Units is deliberately NOT swapped. The beta unit system postdates the
          fork and both branches descend from it, so there is no older version
          to go back to and no reason to want one — it is not part of what the
          renderer draws. */}
      <Units />
      {/* The legacy map ordered its layers itself, after mount. */}
      {legacy && (
        <Suspense fallback={null}>
          <LegacyLayerOrder />
        </Suspense>
      )}
      <GlobeEffects active={isGlobe} />
      <RegionPopup />
      <CountryInfoPanel />
      <UnitPopup />
      <FeaturePopup />
    </>
  );
};

export default MapScene;
