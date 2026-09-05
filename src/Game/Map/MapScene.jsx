/*! Open Historia — map scene composition © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React from "react";
import Nations from "./Nations";
import Cities from "./Cities";
import MarkersLayer from "./MarkersLayer.jsx";
import LegacyNations from "./legacy/Nations.jsx";
import LegacyCities from "./legacy/Cities.jsx";
import LegacyMarkersLayer from "./legacy/MarkersLayer.jsx";
import LegacyLayerOrder from "./legacy/LayerOrder.jsx";
import Units from "./Units";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import UnitPopup from "../Selection/Units";
import FeaturePopup from "../Selection/Features.jsx";
import { MAP_SETTING_KEYS, useMapSetting } from "../../runtime/mapSettings.js";

// The camera/basemap shell lives in World.jsx. Everything that is projected
// into that world lives here, in deliberate paint/placement order. Keeping the
// scene graph behind one boundary keeps layer changes decoupled from
// projection, terrain, or GPU lifecycle.
//
// It is also the single place the renderer choice is made. The legacy map is a
// VERBATIM copy of the components under src/Game/Map/legacy/, so this switch is
// the only edit the current renderer's files carry for it: with the setting off
// they render exactly as they do without this feature at all. See legacy/README.
const MapScene = ({ isGlobe = false }) => {
  const legacy = useMapSetting(MAP_SETTING_KEYS.legacyMapRenderer);
  return (
    <>
      {legacy ? (
        <>
          <LegacyNations isGlobe={isGlobe} />
          <LegacyCities />
          <LegacyMarkersLayer />
        </>
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
      {legacy && <LegacyLayerOrder />}
      <GlobeEffects active={isGlobe} />
      <RegionPopup />
      <CountryInfoPanel />
      <UnitPopup />
      <FeaturePopup />
    </>
  );
};

export default MapScene;
