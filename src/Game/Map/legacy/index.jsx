/*! Open Historia — legacy renderer entry © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// The one module MapScene lazy-loads for the legacy renderer, so nothing under
// legacy/ is fetched, parsed or evaluated until the setting is on. Both exports
// come from this file on purpose: one specifier, one chunk.
import React from "react";
import LegacyNations from "./Nations.jsx";
import LegacyCities from "./Cities.jsx";
import LegacyMarkersLayer from "./MarkersLayer.jsx";
import LegacyLayerOrder from "./LayerOrder.jsx";

export { LegacyLayerOrder };

const LegacyScene = ({ isGlobe = false }) => (
  <>
    <LegacyNations isGlobe={isGlobe} />
    <LegacyCities />
    <LegacyMarkersLayer />
  </>
);

export default LegacyScene;
