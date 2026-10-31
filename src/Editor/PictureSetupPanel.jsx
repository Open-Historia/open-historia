/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Asked once when a basemap PICTURE is uploaded. The picture is kept exactly
// as it is, in its own projection and at its own size: the MAP takes the
// picture's projection instead (MapEditor applyPictureSetup), and the
// provinces and nations already on it are either moved onto the picture or
// deleted. A picture that fits neither is the wrong basemap: choose another.

import { useState } from "react";
import Panel from "./Panel.jsx";
import { NumberField, Row, SelectField, Toggle } from "./fields.jsx";
import { FREEFORM, PROJECTIONS, geoBoxOnSheet, normalizeProjection, sheetBounds } from "../../server/mapProjection.js";

// Q-BAM measured against the game's coastlines: Robinson centred on 10.75°E,
// its globe drawn ~0.5% narrower and ~0.3% shorter than its frame, so the
// frame lies a little past the sheet's edges.
export const QBAM = Object.freeze({
  projection: { type: "robinson", centre: 10.75 },
  bounds: Object.freeze({ west: -181.114, south: -67.1689, east: 180.586, north: 67.0707 }),
});

const note = { fontSize: 11.5, lineHeight: 1.45, color: "rgba(255,255,255,0.6)", margin: 0 };
const warn = { ...note, color: "#ffd59a" };
const button = (primary) => ({
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.16)",
  background: primary ? "#2bc1f3" : "rgba(255,255,255,0.08)",
  color: primary ? "#06222d" : "rgba(255,255,255,0.86)",
  fontWeight: 700,
  fontSize: 12.5,
  cursor: "pointer",
});

const OPTIONS = PROJECTIONS.map((entry) => ({ value: entry.id, label: entry.id === FREEFORM ? "Freeform (no globe)" : entry.name }));

const PictureSetupPanel = ({ name, aspect, busy = false, error = "", onApply, onChooseAnother, onClose }) => {
  const [type, setType] = useState("equirectangular");
  const [centre, setCentre] = useState(0);
  const [box, setBox] = useState({ north: 90, south: -90, west: -180, east: 180 });
  const [deleteProvinces, setDeleteProvinces] = useState(false);
  // Set by the Q-BAM button; any setting changed by hand drops it.
  const [exactBounds, setExactBounds] = useState(null);
  const edited = (set) => (value) => {
    setExactBounds(null);
    set(value);
  };
  const edge = (key) => edited((value) => setBox((current) => ({ ...current, [key]: value })));
  const useQbam = () => {
    setType(QBAM.projection.type);
    setCentre(QBAM.projection.centre);
    setBox({ north: 90, south: -90, west: -180, east: 180 });
    setExactBounds(QBAM.bounds);
  };

  const freeform = type === FREEFORM;
  const valid = freeform || ([box.north, box.south, box.west, box.east, centre].every(Number.isFinite)
    && box.north > box.south && box.east > box.west);
  const apply = () => {
    const projection = normalizeProjection(freeform ? { type, aspect } : { type, centre });
    const bounds = freeform ? sheetBounds(projection) : exactBounds ?? geoBoxOnSheet(projection, box);
    onApply?.({ projection, bounds, deleteProvinces });
  };

  return (
    <Panel title="Basemap picture" icon="layers" onClose={busy ? undefined : onClose} width={320}>
      <p style={note}>
        {name ? `"${name}"` : "This picture"}{aspect ? ` (${aspect.toFixed(2)}:1)` : ""} is kept exactly as it is. Say how it is drawn, and the map takes its projection.
      </p>
      <button type="button" style={{ ...button(false), flex: "none", width: "100%" }} onClick={useQbam}>
        It&apos;s Q-BAM
      </button>
      <Row label="Drawn in">
        <SelectField value={type} onChange={edited(setType)} width={150} options={OPTIONS} />
      </Row>
      {!freeform && (
        <>
          <Row label="Centre longitude"><NumberField value={centre} onChange={edited(setCentre)} step={0.25} min={-180} max={180} /></Row>
          <p style={note}>The part of the globe it shows, in degrees, west and east measured from the centre. A whole-world map is 90, -90, -180, 180.</p>
          <Row label="North edge"><NumberField value={box.north} onChange={edge("north")} step={0.5} min={-90} max={90} /></Row>
          <Row label="South edge"><NumberField value={box.south} onChange={edge("south")} step={0.5} min={-90} max={90} /></Row>
          <Row label="West edge"><NumberField value={box.west} onChange={edge("west")} step={0.5} min={-180} max={180} /></Row>
          <Row label="East edge"><NumberField value={box.east} onChange={edge("east")} step={0.5} min={-180} max={180} /></Row>
          {!valid && <p style={{ ...note, color: "#ffb4a8" }}>North must be above south, and east right of west.</p>}
        </>
      )}
      <Row label="Delete the provinces and nations">
        <Toggle value={deleteProvinces} onChange={setDeleteProvinces} />
      </Row>
      <p style={freeform && !deleteProvinces ? warn : note}>
        {freeform
          ? "A freeform picture has no globe, so the provinces cannot be placed on it: kept, they are only stretched over it. Delete them to draw your own, or choose another basemap."
          : deleteProvinces
            ? "The map starts empty on the picture: provinces, cities and units are removed."
            : "The provinces, cities and units are moved into the picture's projection. If they still do not match it, delete them or choose another basemap."}
      </p>
      {error ? <p style={{ ...note, color: "#ffb4a8" }}>{error}</p> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={button(false)} disabled={busy} onClick={onChooseAnother}>Choose another</button>
        <button type="button" style={button(true)} disabled={busy || !valid} onClick={apply}>
          {busy ? "Applying…" : "Use this picture"}
        </button>
      </div>
    </Panel>
  );
};

export default PictureSetupPanel;
