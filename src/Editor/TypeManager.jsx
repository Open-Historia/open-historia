/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */

// Region Type Manager — mirrors the official editor. Each region "type" carries
// render settings (opacity, unowned opacity, z-index, stroke, override color,
// zoom band, included-in-labels) plus gameplay flags (pathfinding speed,
// interactable, passable). Editing a type live-restyles the map (OlMap
// restyles on the types prop changing). The types go to the game with the
// scenario (world.regionTypes, runtime/regionTypes.js): the game map draws the
// override colour, opacity, stroke and zoom band, and the unit and structure
// directors are told the three flags as rules for moving and placing. Z-Index
// and Included In Labels have no counterpart in the game, and the panel says
// so. The official editor's Show To Default Prompt has no reader in the game,
// so it is not offered here; a type keeps whatever value it had.

import { useState } from "react";
import Panel from "./Panel.jsx";
import Icon from "./Icon.jsx";
import { pillButton } from "./editorStyles.js";
import { Row, NumberField, TextField, ColorField, Toggle } from "./fields.jsx";
import { isWaterType, MAX_REGION_TYPES } from "../runtime/regionTypes.js";
import { canCreateRegionType, filterRegionTypes, regionTypeDeletionReason, uniqueRegionTypeId } from "./regionTypeManagement.js";
import { WorkspaceEmpty, WorkspaceHeading, WorkspaceSearch, WorkspaceSelect, WorkspaceStats, WorkspaceTabs, workspaceCard, workspaceMuted } from "./EditorWorkspaceControls.jsx";

const newType = (id) => ({
  id,
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
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [tab, setTab] = useState("identity");
  const [notice, setNotice] = useState("");
  const filtered = filterRegionTypes(types, usage, { query, scope });
  const usedCount = types.filter((t) => (Number(usage[t.id]) || 0) > 0).length;

  const update = (id, patch) =>
    setTypes((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const updateZoom = (id, patch) =>
    setTypes((list) =>
      list.map((t) =>
        t.id === id ? { ...t, zoomSettings: [{ ...(t.zoomSettings?.[0] || {}), ...patch }] } : t,
      ),
    );
  const addType = () => {
    if (!canCreateRegionType(types)) { setNotice("This map has reached the region-type limit."); return; }
    const t = newType(uniqueRegionTypeId(types, Date.now().toString(36)));
    if (draftName.trim()) t.name = draftName.trim();
    setTypes((list) => [...list, t]);
    setExpanded(new Set([t.id]));
    setTab("identity");
    setDraftName(""); setQuery(""); setScope("all");
    setNotice("Created a new region type. Assign it to regions separately.");
  };
  const remove = (id) => {
    const reason = regionTypeDeletionReason(types, usage, id);
    if (reason) { setNotice(reason); return; }
    const name = types.find((t) => t.id === id)?.name || id;
    if (!window.confirm("Delete unused region type " + name + "? This does not delete regions.")) return;
    setTypes((list) => list.filter((t) => t.id !== id));
    setExpanded(new Set());
    setNotice("Deleted unused type " + name + ".");
  };
  const toggleExpand = (id) => {
    setExpanded((s) => s.has(id) ? new Set() : new Set([id]));
    setTab("identity"); setNotice("");
  };

  return (
    <Panel title="Region Types" icon="types" onClose={onClose} width={490}>
      <WorkspaceHeading title="Region type manager" detail="Configure appearance and native gameplay rules. Assign a type to map regions in the Regions workspace."/>
      <WorkspaceStats items={[
        { label: "Defined", value: types.length },
        { label: "In use", value: usedCount },
        { label: "Limit", value: MAX_REGION_TYPES },
      ]}/>
      <WorkspaceSearch value={query} onChange={setQuery} placeholder="Find type name or stable ID..." />
      <WorkspaceSelect label="Use on the map" value={scope} onChange={setScope} options={[
        { value: "all", label: "All region types" },
        { value: "used", label: "Types assigned to regions" },
        { value: "unused", label: "Unassigned types" },
      ]}/>
      <WorkspaceHeading title="Create a region type" detail="Creating a type does not automatically change any territory."/>
      <div style={{ display: "flex", gap: 6 }}>
        <TextField value={draftName} onChange={setDraftName} placeholder="New type name (e.g. Mountain)" />
        <button type="button" onClick={addType} disabled={!canCreateRegionType(types)}
          style={{ ...pillButton(true), opacity: canCreateRegionType(types) ? 1 : .45, display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="plus" size={14} /> Create
        </button>
      </div>

      {notice && <div role="status" style={{ ...workspaceCard, ...workspaceMuted }}>{notice}</div>}
      <WorkspaceHeading title="Type browser" detail={filtered.length + " of " + types.length + " types match. Open a type to inspect and edit it."}/>
      {filtered.length === 0 && <WorkspaceEmpty title="No matching types" description="Change the search or filter. Existing regions remain unchanged."/>}
      {filtered.map((t) => {
        const open = expanded.has(t.id);
        return (
          <div
            key={t.id}
            style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}
          >
            <button type="button" aria-expanded={open} onClick={() => toggleExpand(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", width: "100%", border: 0, textAlign: "left", color: "var(--oh-ui-text, white)", cursor: "pointer", background: "var(--oh-ui-raised, rgba(255,255,255,0.04))" }}
            >
              <span
                style={{ width: 12, height: 12, borderRadius: 3, background: t.overrideColor ? `rgb(${t.overrideColor.join(",")})` : "rgba(255,255,255,0.25)" }}
              />
              <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{t.name}</span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{usage[t.id] || 0} regions</span>
              <Icon name={open ? "close" : "plus"} size={13} />
            </button>
            {open && (
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={workspaceMuted}>Stable type ID: {t.id} · {Number(usage[t.id]) || 0} referenced regions</div>
                <WorkspaceTabs label="Region type details" tabs={[
                  { id: "identity", label: "Identity" },
                  { id: "appearance", label: "Appearance" },
                  { id: "gameplay", label: "Gameplay" },
                ]} active={tab} onChange={setTab}/>
                {tab === "identity" && <>
                <Row label="Name">
                  <TextField value={t.name} onChange={(v) => update(t.id, { name: v })} width={150} />
                </Row>
                </>}
                {tab === "appearance" && <>
                <WorkspaceHeading title="Map appearance" detail="These properties control how this type is drawn."/>
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
                </>}
                {tab === "gameplay" && <>
                <WorkspaceHeading title="Native gameplay rules" detail="Movement, accessibility and map-water behavior."/>
                <Row label="Pathfinding Speed" title="1 is the usual speed. Below 1 is slower, above 1 is faster, and 0 is impassable.">
                  <NumberField value={t.pathfindingSpeed} step={0.1} min={0} onChange={(v) => update(t.id, { pathfindingSpeed: v })} />
                </Row>
                <Row label="Interactable" title="Off: the AI places no units and builds no structures in these regions.">
                  <Toggle value={t.interactable} onChange={(v) => update(t.id, { interactable: v })} />
                </Row>
                <Row label="Passable" title="Off: the AI moves no units into or through these regions.">
                  <Toggle value={t.passable} onChange={(v) => update(t.id, { passable: v })} />
                </Row>
                <Row label="Water" title="On: these regions are sea. Troop transporters sail through them, and no army marches across them.">
                  <Toggle value={isWaterType(t)} onChange={(v) => update(t.id, { water: v })} />
                </Row>
                <Row label="Included In Labels">
                  <Toggle value={t.includedInLabels} onChange={(v) => update(t.id, { includedInLabels: v })} />
                </Row>
                </>}
                {tab === "appearance" && <>
                <Row label="Zoom Min / Max" title="Type is hidden outside this zoom range">
                  <span style={{ display: "flex", gap: 4 }}>
                    <NumberField value={t.zoomSettings?.[0]?.minZoom ?? 0} step={1} min={0} max={24} width={52} onChange={(v) => updateZoom(t.id, { minZoom: v })} />
                    <NumberField value={t.zoomSettings?.[0]?.maxZoom ?? 24} step={1} min={0} max={24} width={52} onChange={(v) => updateZoom(t.id, { maxZoom: v })} />
                  </span>
                </Row>
                </>}
                {regionTypeDeletionReason(types, usage, t.id) && <div style={workspaceMuted}>
                  {regionTypeDeletionReason(types, usage, t.id)}
                </div>}
                <button type="button" onClick={() => remove(t.id)}
                  disabled={Boolean(regionTypeDeletionReason(types, usage, t.id))}
                  title={regionTypeDeletionReason(types, usage, t.id) || "Delete unused type"}
                  style={{ ...pillButton(false), color: "#f87171", marginTop: 4, display: "flex", alignItems: "center", gap: 5, justifyContent: "center", opacity: regionTypeDeletionReason(types, usage, t.id) ? .45 : 1 }}>
                  <Icon name="trash" size={13} /> Delete unused type
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
