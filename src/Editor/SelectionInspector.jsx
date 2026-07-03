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
import { Row, TextField, SelectField } from "./fields.jsx";
import { rgbToHex } from "./fields.jsx";

const commonOr = (arr, blank = "") => {
  if (!arr.length) return blank;
  const first = arr[0];
  return arr.every((v) => v === first) ? first ?? blank : blank;
};

const SelectionInspector = ({ api, selection, types, colors, setSelection }) => {
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
