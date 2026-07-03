/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - MIT License (see src/Editor/LICENSE).
 */

// Region Type Manager — mirrors the official editor. Each region "type" carries
// render settings (opacity, unowned opacity, z-index, stroke, override color,
// zoom band) plus gameplay flags (pathfinding speed, interactable, passable,
// show-to-default-prompt, included-in-labels). Editing a type live-restyles the
// map (OlMap restyles on the types prop changing).

import { useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton } from "./editorStyles.js";
import { Row, NumberField, TextField, ColorField, Toggle } from "./fields.jsx";

const newType = () => ({
  id: `type_${Date.now().toString(36)}`,
  name: "New Type",
  opacity: 0.55,
  unownedOpacity: 0.25,
  zIndex: 1,
  strokeWidth: 1.5,
  strokeColor: [0, 0, 0],
  strokeOpacity: 1,
  overrideColor: null,
  pathfindingSpeed: 1,
  interactable: true,
  showToDefaultPrompt: true,
  passable: true,
  includedInLabels: true,
  zoomSettings: [{ minZoom: 0, maxZoom: 24 }],
});

const TypeManager = ({ types, setTypes, usage = {}, onClose }) => {
  const [expanded, setExpanded] = useState(() => new Set(types[0] ? [types[0].id] : []));
  const [draftName, setDraftName] = useState("");

  const update = (id, patch) =>
    setTypes((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const updateZoom = (id, patch) =>
    setTypes((list) =>
      list.map((t) =>
        t.id === id ? { ...t, zoomSettings: [{ ...(t.zoomSettings?.[0] || {}), ...patch }] } : t,
      ),
    );
  const addType = () => {
    const t = newType();
    if (draftName.trim()) t.name = draftName.trim();
    setTypes((list) => [...list, t]);
    setExpanded((s) => new Set([...s, t.id]));
    setDraftName("");
  };
  const remove = (id) => setTypes((list) => (list.length > 1 ? list.filter((t) => t.id !== id) : list));
  const toggleExpand = (id) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <Panel title="Region Types" icon="types" onClose={onClose} width={360}>
      <div style={{ display: "flex", gap: 6 }}>
        <TextField value={draftName} onChange={setDraftName} placeholder="New type name (e.g. Mountain)" />
        <button onClick={addType} style={{ ...pillButton(true), display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>

      {types.map((t) => {
        const open = expanded.has(t.id);
        return (
          <div
            key={t.id}
            style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}
          >
            <div
              onClick={() => toggleExpand(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", background: "rgba(255,255,255,0.04)" }}
            >
              <span
                style={{ width: 12, height: 12, borderRadius: 3, background: t.overrideColor ? `rgb(${t.overrideColor.join(",")})` : "rgba(255,255,255,0.25)" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{usage[t.id] || 0} regions</span>
              <Icon name={open ? "close" : "plus"} size={13} />
            </div>
            {open && (
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                <Row label="Name">
                  <TextField value={t.name} onChange={(v) => update(t.id, { name: v })} width={150} />
                </Row>
                <Row label="Opacity">
                  <NumberField value={t.opacity} step={0.05} min={0} max={1} onChange={(v) => update(t.id, { opacity: v })} />
                </Row>
                <Row label="Unowned Opacity">
                  <NumberField value={t.unownedOpacity} step={0.05} min={0} max={1} onChange={(v) => update(t.id, { unownedOpacity: v })} />
                </Row>
                <Row label="Z-Index">
                  <NumberField value={t.zIndex} step={1} onChange={(v) => update(t.id, { zIndex: v })} />
                </Row>
                <Row label="Stroke Width">
                  <NumberField value={t.strokeWidth} step={0.25} min={0} onChange={(v) => update(t.id, { strokeWidth: v })} />
                </Row>
                <Row label="Stroke Color">
                  <ColorField value={t.strokeColor} onChange={(v) => update(t.id, { strokeColor: v })} />
                </Row>
                <Row label="Stroke Opacity">
                  <NumberField value={t.strokeOpacity} step={0.05} min={0} max={1} onChange={(v) => update(t.id, { strokeOpacity: v })} />
                </Row>
                <Row label="Override Color" title="Force a fixed fill color instead of the owner's color">
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Toggle value={!!t.overrideColor} onChange={(on) => update(t.id, { overrideColor: on ? t.overrideColor || [90, 90, 100] : null })} />
                    {t.overrideColor && <ColorField value={t.overrideColor} onChange={(v) => update(t.id, { overrideColor: v })} />}
                  </span>
                </Row>
                <Row label="Pathfinding Speed">
                  <NumberField value={t.pathfindingSpeed} step={0.1} min={0} onChange={(v) => update(t.id, { pathfindingSpeed: v })} />
                </Row>
                <Row label="Interactable">
                  <Toggle value={t.interactable} onChange={(v) => update(t.id, { interactable: v })} />
                </Row>
                <Row label="Show To Default Prompt">
                  <Toggle value={t.showToDefaultPrompt} onChange={(v) => update(t.id, { showToDefaultPrompt: v })} />
                </Row>
                <Row label="Passable">
                  <Toggle value={t.passable} onChange={(v) => update(t.id, { passable: v })} />
                </Row>
                <Row label="Included In Labels">
                  <Toggle value={t.includedInLabels} onChange={(v) => update(t.id, { includedInLabels: v })} />
                </Row>
                <Row label="Zoom Min / Max" title="Type is hidden outside this zoom range">
                  <span style={{ display: "flex", gap: 4 }}>
                    <NumberField value={t.zoomSettings?.[0]?.minZoom ?? 0} step={1} min={0} max={24} width={52} onChange={(v) => updateZoom(t.id, { minZoom: v })} />
                    <NumberField value={t.zoomSettings?.[0]?.maxZoom ?? 24} step={1} min={0} max={24} width={52} onChange={(v) => updateZoom(t.id, { maxZoom: v })} />
                  </span>
                </Row>
                <button
                  onClick={() => remove(t.id)}
                  disabled={types.length <= 1}
                  style={{ ...pillButton(false), color: "#f87171", marginTop: 4, display: "flex", alignItems: "center", gap: 5, justifyContent: "center", opacity: types.length <= 1 ? 0.4 : 1 }}
                >
                  <Icon name="trash" size={13} /> Delete type
                </button>
              </div>
            )}
          </div>
        );
      })}
    </Panel>
  );
};

export default TypeManager;
