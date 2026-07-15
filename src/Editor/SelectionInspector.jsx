/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Inspector for the current region selection: edit name (single), type, and owner
// for one or many selected regions. Writes straight to the OL features via the map
// API, which live-restyles the map.

import { useEffect, useMemo, useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton } from "./editorStyles.js";
import { Row, TextField, SelectField, ColorField } from "./fields.jsx";
import { rgbToHex } from "./fields.jsx";
import { FLAG_ACCEPT, fileToFlagDataUrl } from "./flagImage.js";

const commonOr = (arr, blank = "") => {
  if (!arr.length) return blank;
  const first = arr[0];
  return arr.every((v) => v === first) ? first ?? blank : blank;
};

const SelectionInspector = ({ api, selection, types, colors, colorOverrides, setColorOverride, flags, setFlag, setSelection }) => {
  const [flagError, setFlagError] = useState("");
  const summaries = useMemo(
    () => (api ? selection.map((id) => api.getRegionSummary(id)).filter(Boolean) : []),
    [api, selection],
  );
  const [form, setForm] = useState({ name: "", typeId: "", owner: "" });

  useEffect(() => {
    setForm({
      name: summaries.length === 1 ? summaries[0].name : "",
      typeId: commonOr(summaries.map((s) => s.typeId)),
      owner: commonOr(summaries.map((s) => s.owner || "")),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.join(",")]);

  if (!selection.length) return null;
  const single = selection.length === 1;
  const apply = (patch) => api?.setRegionAttrs(selection, patch);
  const ownerRgb = form.owner && colors[form.owner];
  // Only offer Reset when there is something to reset to — i.e. the map-maker set
  // this colour, rather than it being the country's stock one.
  const isCustomColor = Boolean(form.owner && colorOverrides?.[form.owner]);
  const ownerFlag = form.owner ? flags?.[form.owner] : null;

  return (
    <Panel
      title={single ? "Region" : `${selection.length} regions`}
      icon="modify"
      onClose={() => setSelection([])}
      side="right"
      width={300}
    >
      {single && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          {summaries[0]?.id} · {summaries[0]?.country || "—"}
        </div>
      )}
      {single && (
        <Row label="Name">
          <TextField
            value={form.name}
            onChange={(v) => {
              setForm((f) => ({ ...f, name: v }));
              apply({ name: v });
            }}
            width={160}
          />
        </Row>
      )}
      <Row label="Type">
        <SelectField
          value={form.typeId}
          onChange={(v) => {
            setForm((f) => ({ ...f, typeId: v }));
            apply({ typeId: v });
          }}
          options={[
            ...(form.typeId ? [] : [{ value: "", label: "— mixed —" }]),
            ...types.map((t) => ({ value: t.id, label: t.name })),
          ]}
          width={160}
        />
      </Row>
      <Row label="Owner" title="Country code that drives the fill color">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {ownerRgb && (
            <span style={{ width: 18, height: 18, borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", background: rgbToHex(ownerRgb) }} />
          )}
          <TextField
            value={form.owner}
            onChange={(v) => {
              const code = v.toUpperCase();
              setForm((f) => ({ ...f, owner: code }));
              apply({ owner: code || null });
            }}
            width={96}
          />
        </span>
      </Row>
      {form.owner && setColorOverride && (
        <Row label="Colour" title="The colour this country is painted, here and in the game">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ColorField
              value={ownerRgb || [128, 128, 128]}
              onChange={(rgb) => setColorOverride(form.owner, rgb)}
            />
            {isCustomColor && (
              <button
                onClick={() => setColorOverride(form.owner, null)}
                style={pillButton(false)}
                title="Go back to this country's standard colour"
              >
                Reset
              </button>
            )}
          </span>
        </Row>
      )}
      {form.owner && setFlag && (
        <Row label="Flag" title="Shown in the country panel and profile circles in-game">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {ownerFlag && (
              <img
                src={ownerFlag}
                alt=""
                style={{ width: 26, height: 18, objectFit: "cover", borderRadius: 3, border: "1px solid rgba(255,255,255,0.3)" }}
              />
            )}
            <label style={{ ...pillButton(false), cursor: "pointer" }}>
              {ownerFlag ? "Replace" : "Upload"}
              <input
                type="file"
                accept={FLAG_ACCEPT}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // let the same file be picked again after a Remove
                  if (!file) return;
                  setFlagError("");
                  try {
                    setFlag(form.owner, await fileToFlagDataUrl(file));
                  } catch (err) {
                    setFlagError(err.message || "Could not read that image.");
                  }
                }}
              />
            </label>
            {ownerFlag && (
              <button onClick={() => setFlag(form.owner, null)} style={pillButton(false)} title="Use the standard flag again">
                Remove
              </button>
            )}
          </span>
        </Row>
      )}
      {flagError && (
        <div style={{ color: "#ff9a9a", fontSize: 11, marginTop: 2 }}>{flagError}</div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        <button
          onClick={() => {
            setForm((f) => ({ ...f, owner: "" }));
            apply({ owner: null });
          }}
          style={pillButton(false)}
        >
          Clear owner
        </button>
        {selection.length >= 2 && (
          <button onClick={() => api?.mergeRegions(selection)} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="merge" size={13} /> Merge
          </button>
        )}
        <button onClick={() => api?.copyRegions(selection)} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="copy" size={13} /> Copy
        </button>
        <button onClick={() => api?.zoomToSelection(selection)} style={{ ...pillButton(false), display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="fit" size={13} /> Zoom
        </button>
        <button
          onClick={() => api?.deleteRegions(selection)}
          style={{ ...pillButton(false), color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}
        >
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>
    </Panel>
  );
};

export default SelectionInspector;
