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
//
// The SCALE LINE is a line drawn on the map with the distance it is
// (projection.scale; what it means is in server/mapDistance.js): a freeform
// sheet measures every distance by it, and on a world projection it makes the
// map's world larger or smaller than the Earth. The Scale line tool draws it
// (OlMap.jsx, scaleLineLayer.js); the distance is asked for once it is drawn.

import { useState } from "react";
import Panel from "./Panel.jsx";
import { Row, SelectField, TextField, Toggle } from "./fields.jsx";
import { FREEFORM, PROJECTIONS, normalizeProjection, sameProjection } from "../../server/mapProjection.js";
import { formatAspect, parseAspect, projectionChoice } from "./projectionConvert.js";
import { KM_PER_MILE, scaleLabelOf } from "./scaleLineLayer.js";

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

// The scale line's part of the panel:
//   line           the scale line saved with the projection, or null
//   scaleDraft     { from, to } just drawn and waiting for its distance, or null
//   draftKm        what that line measures now
//   drawingScale   the Scale line tool is out
//   onDrawScale, onCancelScale, onSetScale(km), onClearScale
const ScaleLine = ({ line, scaleDraft, draftKm, drawingScale, onDrawScale, onCancelScale, onSetScale, onClearScale }) => {
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("km");
  const typed = Number(String(amount).replace(",", "."));
  const km = typed > 0 ? (unit === "mi" ? typed * KM_PER_MILE : typed) : 0;
  const canSet = Boolean(scaleDraft) && km > 0 && km <= 1e7;
  const measured = scaleLabelOf(draftKm, { about: true });
  const said = line ? scaleLabelOf(line.km) : "";
  const cancel = () => {
    setAmount("");
    onCancelScale?.();
  };
  return (
    <>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.86)", marginTop: 4 }}>Scale line</div>
      {scaleDraft ? (
        <>
          <Row label="Its distance">
            <span style={{ display: "flex", gap: 6 }}>
              <TextField value={amount} onChange={setAmount} width={70} />
              <SelectField value={unit} onChange={setUnit} width={100} options={[{ value: "km", label: "Kilometres" }, { value: "mi", label: "Miles" }]} />
            </span>
          </Row>
          {measured ? <p style={note}>It measures {measured} now.</p> : null}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={!canSet}
              style={{ ...button(canSet), flex: 1 }}
              onClick={() => {
                if (!canSet) return;
                onSetScale?.(km);
                setAmount("");
              }}
            >
              Set the scale
            </button>
            <button type="button" style={smallButton} onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : drawingScale ? (
        <>
          <p style={note}>Click the line&apos;s two ends on the map.</p>
          <button type="button" style={smallButton} onClick={cancel}>Cancel</button>
        </>
      ) : (
        <>
          {said ? <p style={note}>The scale line is {said}.</p> : null}
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={{ ...smallButton, flex: 1 }} onClick={() => onDrawScale?.()}>
              {line ? "Draw it again" : "Draw a scale line"}
            </button>
            {line ? <button type="button" style={smallButton} onClick={() => onClearScale?.()}>Clear it</button> : null}
          </div>
        </>
      )}
    </>
  );
};

// `blocked`: why the map cannot be converted at all (a detailed map,
// projectionConvert.js), shown in place of the button's offer.
const ProjectionPanel = ({
  projection,
  pictureAspect = null,
  hasPicture = false,
  busy = false,
  error = "",
  blocked = "",
  onConvert,
  onView,
  onClose,
  scaleDraft = null,
  draftKm = 0,
  drawingScale = false,
  onDrawScale,
  onCancelScale,
  onSetScale,
  onClearScale,
}) => {
  const current = normalizeProjection(projection);
  const [type, setType] = useState(current.type);
  const [shape, setShape] = useState(() => formatAspect(current.type === FREEFORM ? current.aspect : pictureAspect || 2));
  const [keepPicture, setKeepPicture] = useState(false);

  const aspect = parseAspect(shape);
  const chosen = type === FREEFORM ? (aspect ? projectionChoice(type, aspect) : null) : projectionChoice(type);
  const changed = Boolean(chosen) && !sameProjection(current, chosen);
  const canConvert = changed && !busy && !blocked;
  // "Already drawn for it" only means something for a picture going to a world
  // projection: to freeform a picture is never redrawn anyway.
  const offersKeep = hasPicture && type !== FREEFORM && current.type !== FREEFORM;

  return (
    <Panel title="Projection" icon="layers" onClose={onClose} width={320}>
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
        </>
      )}
      <p style={note}>
        Converting moves every region, city and unit together with the basemap. Undo does not reach back past it: convert again to return.
      </p>
      {error ? <p style={{ ...note, color: "#ffb4a8" }}>{error}</p> : null}
      {blocked && changed ? <p style={{ ...note, color: "#ffb4a8" }}>{blocked}</p> : null}
      <button
        type="button"
        disabled={!canConvert}
        style={button(canConvert)}
        onClick={() => canConvert && onConvert?.(chosen, { keepPicture: offersKeep && keepPicture })}
      >
        {busy ? "Converting the map…" : changed ? "Convert the map" : "The map is in this projection"}
      </button>
      <Row label="Disable the 3D globe">
        <Toggle value={current.globe === false} onChange={(off) => onView?.({ globe: !off })} />
      </Row>
      <Row label="Disable map looping">
        <Toggle value={current.wrap === false} onChange={(off) => onView?.({ wrap: !off })} />
      </Row>
      <ScaleLine
        line={current.scale ?? null}
        scaleDraft={scaleDraft}
        draftKm={draftKm}
        drawingScale={drawingScale}
        onDrawScale={onDrawScale}
        onCancelScale={onCancelScale}
        onSetScale={onSetScale}
        onClearScale={onClearScale}
      />
    </Panel>
  );
};

export default ProjectionPanel;
