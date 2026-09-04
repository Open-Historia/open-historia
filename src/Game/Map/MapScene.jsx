/*! Open Historia — map scene composition © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React from "react";
import Nations from "./Nations";
import Cities from "./Cities";
import MarkersLayer from "./MarkersLayer.jsx";
import Units from "./Units";
import GlobeEffects from "./GlobeEffects.jsx";
import RegionPopup from "../Selection/Regions";
import CountryInfoPanel from "../Selection/CountryPanel.jsx";
import UnitPopup from "../Selection/Units";
import FeaturePopup from "../Selection/Features.jsx";

// The camera/basemap shell lives in World.jsx. Everything that is projected
// into that world lives here, in deliberate paint/placement order. Keeping the
// scene graph behind one boundary keeps layer changes decoupled from
// projection, terrain, or GPU lifecycle.
const MapScene = ({ isGlobe = false }) => (
  <>
    <Nations isGlobe={isGlobe} />
    <Cities />
    <MarkersLayer />
    <Units />
    <GlobeEffects active={isGlobe} />
    <RegionPopup />
    <CountryInfoPanel />
    <UnitPopup />
    <FeaturePopup />
  </>
);

export default MapScene;
