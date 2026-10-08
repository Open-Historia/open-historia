/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// The map's projection: how it is laid on the screen, here and in the game.
// Mercator is what every map was and what a new one is. Another world
// projection shows the same globe in that projection's shape; Freeform is a
// flat sheet of any shape with no globe behind it. Converting moves the
// regions, the cities, the units and the basemap together
// (MapEditor convertProjection; the rules are in projectionConvert.js).

import { useState } from "react";
import Panel from "./Panel.jsx";
import { Row, SelectField, TextField, Toggle } from "./fields.jsx";
import { FREEFORM, PROJECTIONS, normalizeProjection, sameProjection } from "../../server/mapProjection.js";
import { formatAspect, parseAspect, projectionChoice } from "./projectionConvert.js";

const note = { fontSize: 11.5, lineHeight: 1.45, color: "rgba(255,255,255,0.6)", margin: 0 };
const button = (enabled) => ({
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.16)",
  background: enabled ? "#2bc1f3" : "rgba(255,255,255,0.08)",
  color: enabled ? "#06222d" : "rgba(255,255,255,0.45)",
  fontWeight: 700,
  fontSize: 12.5,
  cursor: enabled ? "pointer" : "default",
});
const smallButton = {
  padding: "5px 8px",
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.86)",
  fontSize: 11.5,
  cursor: "pointer",
};

const ProjectionPanel = ({ projection, pictureAspect = null, hasPicture = false, busy = false, error = "", onConvert, onView, onClose }) => {
  const current = normalizeProjection(projection);
  const [type, setType] = useState(current.type);
  const [shape, setShape] = useState(() => formatAspect(current.type === FREEFORM ? current.aspect : pictureAspect || 2));
  const [keepPicture, setKeepPicture] = useState(false);

  const aspect = parseAspect(shape);
  const chosen = type === FREEFORM ? (aspect ? projectionChoice(type, aspect) : null) : projectionChoice(type);
  const changed = Boolean(chosen) && !sameProjection(current, chosen);
  // "Already drawn for it" only means something for a picture going to a world
  // projection: to freeform a picture is never redrawn anyway.
  const offersKeep = hasPicture && type !== FREEFORM && current.type !== FREEFORM;

  return (
    <Panel title="Projection" icon="layers" onClose={onClose} width={320}>
      <p style={note}>
        How the map is laid on the screen, here and in the game. Mercator is what every map starts as. Freeform is a flat sheet of any shape, with no globe behind it.
      </p>
      <Row label="Projection">
        <SelectField
          value={type}
          onChange={setType}
          width={170}
          options={PROJECTIONS.map((entry) => ({ value: entry.id, label: entry.name }))}
        />
      </Row>
      {type === FREEFORM && (
        <>
          <Row label="Shape (width : height)">
            <TextField value={shape} onChange={setShape} placeholder="16:9" width={110} />
          </Row>
          {pictureAspect ? (
            <button type="button" style={smallButton} onClick={() => setShape(formatAspect(pictureAspect))}>
              Use the picture&apos;s own shape
            </button>
          ) : null}
          {!aspect && <p style={{ ...note, color: "#ffb4a8" }}>Give the shape as width : height, such as 16:9 or 2:1.</p>}
        </>
      )}
      {offersKeep && (
        <>
          <Row label="The picture is already drawn for it">
            <Toggle value={keepPicture} onChange={setKeepPicture} />
          </Row>
          <p style={note}>
            Off: the basemap picture is redrawn in the new projection. On: the picture is kept as it is, and only the regions, cities and units are moved.
          </p>
        </>
      )}
      <p style={note}>
        Converting moves every region, city and unit together with the basemap. Undo does not reach back past it: convert again to return.
      </p>
      {error ? <p style={{ ...note, color: "#ffb4a8" }}>{error}</p> : null}
      <button
        type="button"
        disabled={!changed || busy}
        style={button(changed && !busy)}
        onClick={() => changed && !busy && onConvert?.(chosen, { keepPicture: offersKeep && keepPicture })}
      >
        {busy ? "Converting the map…" : changed ? "Convert the map" : "The map is in this projection"}
      </button>
      <Row label="Disable the 3D globe">
        <Toggle value={current.globe === false} onChange={(off) => onView?.({ globe: !off })} />
      </Row>
      <Row label="Disable map looping">
        <Toggle value={current.wrap === false} onChange={(off) => onView?.({ wrap: !off })} />
      </Row>
      <p style={note}>
        Both are for the game. With the globe disabled, players cannot switch this map to the 3D globe. With looping disabled, the map ends at its edges instead of repeating sideways.
      </p>
    </Panel>
  );
};

export default ProjectionPanel;
