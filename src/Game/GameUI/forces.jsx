/*! Open Historia — Force Manager / Forces panel © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  subscribeUnits,
  getUnits,
  getPlayerCode,
  getAllowedUnitTypes,
  getInteractionMode,
  setInteractionMode,
  clearInteractionMode,
  updateUnitAdmin,
  removeUnit,
} from "../Map/unitsController.js";
import { UNIT_TYPES } from "../../runtime/gameState.js";
import { ensurePolityNames, polityDisplayName } from "../../runtime/polityNames.js";

const TYPE_LABEL = {
  infantry: "Infantry",
  armor: "Armor",
  air: "Air",
  naval: "Naval",
  artillery: "Artillery",
  garrison: "Garrison",
};

const TYPE_GLYPH = {
  infantry: "🛡",
  armor: "⚙",
  air: "✈",
  naval: "⚓",
  artillery: "💥",
  garrison: "🏰",
};

const STATUS_OPTIONS = ["idle", "pending", "moving", "engaged", "defeated"];

const MODE_HINT = {
  deploy: "Click the map to place your unit",
  "admin-place": "Click the map to authoritatively place the selected force",
  move: "Click a destination to move the unit",
  attack: "Click an enemy unit, a city, or a structure to attack",
};

const surface = {
  backgroundColor: "rgba(17, 24, 39, 0.96)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "14px",
  color: "white",
  fontFamily: "sans-serif",
  boxShadow: "0 12px 40px rgba(0,0,0,0.48)",
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(5,10,20,0.58)",
  color: "white",
  colorScheme: "dark",
  border: "1px solid rgba(255,255,255,0.13)",
  borderRadius: "7px",
  padding: "6px 8px",
  fontSize: "12px",
  outline: "none",
};

const optionStyle = {
  background: "#111827",
  color: "#f8fafc",
};

const smallLabelStyle = {
  color: "rgba(255,255,255,0.48)",
  display: "block",
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.045em",
  marginBottom: "4px",
  textTransform: "uppercase",
};

const quietButtonStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.11)",
  borderRadius: "7px",
  color: "rgba(255,255,255,0.82)",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 650,
  padding: "6px 9px",
};

const primaryButtonStyle = {
  ...quietButtonStyle,
  background: "rgba(79,70,229,0.42)",
  border: "1px solid rgba(129,140,248,0.48)",
  color: "white",
};

const dangerButtonStyle = {
  ...quietButtonStyle,
  background: "rgba(127,29,29,0.34)",
  border: "1px solid rgba(248,113,113,0.32)",
  color: "#fecaca",
};

const StrengthBar = ({ value }) => {
  const pct = Math.max(0, Math.min(100, (Number(value) || 0) / 10));
  const fill = Number(value) > 600 ? "#4ade80" : Number(value) > 250 ? "#fbbf24" : "#f87171";
  return (
    <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden", marginTop: 5 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: fill }} />
    </div>
  );
};

const ForceRow = ({ unit, selected, isPlayer, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(unit.id)}
    style={{
      width: "100%",
      textAlign: "left",
      border: selected ? "1px solid rgba(139,92,246,0.62)" : "1px solid rgba(255,255,255,0.08)",
      borderRadius: 9,
      background: selected ? "rgba(91,33,182,0.18)" : "rgba(255,255,255,0.035)",
      color: "white",
      cursor: "pointer",
      padding: "7px 8px",
      marginBottom: 5,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: "1rem", lineHeight: 1 }}>{TYPE_GLYPH[unit.type] ?? "🛡"}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unit.name}</span>
          {isPlayer && (
            <span style={{ flexShrink: 0, border: "1px solid rgba(96,165,250,0.25)", borderRadius: 999, color: "#bfdbfe", fontSize: 8, fontWeight: 800, padding: "1px 5px" }}>YOU</span>
          )}
        </div>
        <div style={{ color: "rgba(255,255,255,0.46)", fontSize: 9.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {TYPE_LABEL[unit.type] ?? unit.type} · {polityDisplayName(unit.ownerCode)} · {unit.status}
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 800, color: unit.strength > 600 ? "#4ade80" : unit.strength > 250 ? "#fbbf24" : "#f87171" }}>
        {unit.strength}
      </span>
    </div>
    <StrengthBar value={unit.strength} />
  </button>
);

const emptyEditFields = () => ({
  name: "",
  type: "infantry",
  strength: "100",
  status: "idle",
  lng: "",
  lat: "",
  note: "",
});

const fieldsFromUnit = (unit) => ({
  name: unit?.name || "",
  type: unit?.type || "infantry",
  strength: String(unit?.strength ?? 100),
  status: unit?.status || "idle",
  lng: Number.isFinite(Number(unit?.lng)) ? String(unit.lng) : "",
  lat: Number.isFinite(Number(unit?.lat)) ? String(unit.lat) : "",
  note: unit?.note || "",
});

// Controlled panel: the launcher lives in the Cheats 2.0 surface. The existing
// map interaction model is retained for normal player deploys. Editing an existing
// force here is an AUTHORITATIVE admin action and intentionally does not queue a
// player order or ask the AI for permission.
export const ForcesPanel = ({ mapRef, topOffset = "0px", open = false, onToggle }) => {
  const setOpen = (next) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (resolved !== open) onToggle?.();
  };

  const [units, setUnits] = useState(getUnits());
  const [mode, setMode] = useState(getInteractionMode());
  const [allowedTypes, setAllowedTypes] = useState(getAllowedUnitTypes());
  const [deployType, setDeployType] = useState("infantry");
  const [deployStrength, setDeployStrength] = useState(100);
  const [deployName, setDeployName] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [editFields, setEditFields] = useState(emptyEditFields());
  const [editDirty, setEditDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeUnits(() => {
      setUnits(getUnits());
      setMode(getInteractionMode());
      setAllowedTypes(getAllowedUnitTypes());
    });
    return unsubscribe;
  }, []);

  const [, setNamesEpoch] = useState(0);
  useEffect(() => {
    ensurePolityNames().then(() => setNamesEpoch((epoch) => epoch + 1)).catch(() => {});
  }, [units.length]);

  const availableTypes =
    Array.isArray(allowedTypes) && allowedTypes.length
      ? UNIT_TYPES.filter((t) => allowedTypes.includes(t))
      : UNIT_TYPES;

  useEffect(() => {
    if (availableTypes.length && !availableTypes.includes(deployType)) {
      setDeployType(availableTypes[0]);
    }
  }, [availableTypes, deployType]);

  const playerCode = getPlayerCode();
  const myUnits = useMemo(() => units.filter((unit) => unit.ownerCode && unit.ownerCode === playerCode), [units, playerCode]);
  const otherUnits = useMemo(() => units.filter((unit) => !playerCode || unit.ownerCode !== playerCode), [units, playerCode]);
  const selectedUnit = units.find((unit) => unit.id === selectedId) || null;

  useEffect(() => {
    if (!selectedId) return;
    if (!selectedUnit) {
      setSelectedId("");
      setEditFields(emptyEditFields());
      setEditDirty(false);
      return;
    }
    if (!editDirty) setEditFields(fieldsFromUnit(selectedUnit));
  }, [selectedId, selectedUnit?.updatedAt, selectedUnit?.id, editDirty]);

  const statusOptions = STATUS_OPTIONS.includes(editFields.status)
    ? STATUS_OPTIONS
    : [editFields.status, ...STATUS_OPTIONS].filter(Boolean);

  const filteredUnits = useMemo(() => {
    const query = search.trim().toLowerCase();
    return units.filter((unit) => {
      if (scope === "player" && unit.ownerCode !== playerCode) return false;
      if (scope === "other" && unit.ownerCode === playerCode) return false;
      if (!query) return true;
      const haystack = [
        unit.name,
        unit.type,
        unit.status,
        unit.ownerCode,
        polityDisplayName(unit.ownerCode),
        unit.note,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [units, search, scope, playerCode]);

  const flyTo = useCallback(
    (unit) => {
      const map = mapRef?.current?.getMap?.() ?? mapRef?.current;
      map?.flyTo?.({ center: [unit.lng, unit.lat], zoom: Math.max(map.getZoom?.() ?? 4, 4.5) });
    },
    [mapRef],
  );

  const startAdminPlace = () => {
    if (!selectedUnit) return;
    if (editDirty) {
      setStatusText("Save or reset field edits before placing this force on the map.");
      return;
    }
    setInteractionMode({ kind: "admin-place", unitId: selectedUnit.id });
    setStatusText("");
    setOpen(false);
  };

  const startDeploy = () => {
    const name = deployName.trim() || `${TYPE_LABEL[deployType]} ${myUnits.length + 1}`;
    setInteractionMode({
      kind: "deploy",
      params: {
        type: deployType,
        strength: Math.max(1, Math.min(1000, Number(deployStrength) || 100)),
        name,
      },
    });
    setStatusText("");
    setOpen(false);
  };

  const selectUnit = (id) => {
    const unit = units.find((entry) => entry.id === id);
    setSelectedId(id);
    setEditFields(fieldsFromUnit(unit));
    setEditDirty(false);
    setStatusText("");
  };

  const setEdit = (key, value) => {
    setEditFields((current) => ({ ...current, [key]: value }));
    setEditDirty(true);
    setStatusText("");
  };

  const resetEdit = () => {
    if (!selectedUnit) return;
    setEditFields(fieldsFromUnit(selectedUnit));
    setEditDirty(false);
    setStatusText("");
  };

  const saveEdit = async () => {
    if (!selectedUnit || saving) return;
    const lng = Number(editFields.lng);
    const lat = Number(editFields.lat);
    const strength = Math.max(1, Math.min(1000, Number(editFields.strength) || 1));
    if (!Number.isFinite(lng) || lng < -180 || lng > 180 || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      setStatusText("Position must use valid longitude / latitude values.");
      return;
    }
    setSaving(true);
    try {
      const saved = await updateUnitAdmin(selectedUnit.id, {
        name: editFields.name.trim() || selectedUnit.name,
        type: editFields.type,
        strength,
        status: editFields.status,
        lng,
        lat,
        note: editFields.note.trim(),
      });
      if (!saved) {
        setStatusText("No force was changed.");
        return;
      }
      setEditFields(fieldsFromUnit(saved));
      setEditDirty(false);
      setStatusText("Authoritative force edit saved.");
    } catch (error) {
      console.error("Failed to save force admin edit:", error);
      setStatusText("Failed to save force edit.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedUnit || saving) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${selectedUnit.name}? This removes the force from the canonical world state.`)) return;
    setSaving(true);
    try {
      await removeUnit(selectedUnit.id);
      setSelectedId("");
      setEditFields(emptyEditFields());
      setEditDirty(false);
      setStatusText("Force deleted.");
    } catch (error) {
      console.error("Failed to delete force:", error);
      setStatusText("Failed to delete force.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {mode.kind !== "idle" && (
        <div
          style={{
            ...surface,
            position: "fixed",
            top: "4.5rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 14px",
            fontSize: 13,
          }}
        >
          <span>{MODE_HINT[mode.kind] ?? "Select a target"}</span>
          <button type="button" onClick={() => clearInteractionMode()} style={dangerButtonStyle}>Cancel</button>
        </div>
      )}

      {open && (
        <div
          style={{
            ...surface,
            position: "fixed",
            bottom: "4.75rem",
            left: "0.5rem",
            width: "min(23rem, calc(100vw - 1rem))",
            maxHeight: "72vh",
            display: "flex",
            flexDirection: "column",
            zIndex: 9999,
            padding: 12,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 9 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <strong style={{ fontSize: 14 }}>Force Manager</strong>
                <span style={{ border: "1px solid rgba(139,92,246,0.35)", borderRadius: 999, color: "#ddd6fe", fontSize: 8, fontWeight: 800, letterSpacing: ".05em", padding: "2px 6px" }}>2.0</span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 10, lineHeight: 1.35, marginTop: 2 }}>
                Deploy, inspect, edit, and authoritatively place forces anywhere in the world.
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} style={{ ...quietButtonStyle, fontSize: 14, padding: "2px 7px", lineHeight: 1.3 }}>✕</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginBottom: 8 }}>
            {[
              ["All", units.length],
              ["Yours", myUnits.length],
              ["Other", otherUnits.length],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, padding: "5px 7px" }}>
                <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 8.5, fontWeight: 750, textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 1 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9, padding: 8, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 750 }}>Deploy player force</div>
                <div style={{ color: "rgba(255,255,255,0.37)", fontSize: 9, marginTop: 1 }}>Normal map placement; still becomes a player order for the next jump.</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 4.7rem", gap: 5, marginBottom: 5 }}>
              <select value={deployType} onChange={(event) => setDeployType(event.target.value)} style={fieldStyle}>
                {availableTypes.map((type) => <option key={type} value={type} style={optionStyle}>{TYPE_LABEL[type] ?? type}</option>)}
              </select>
              <input type="number" min={1} max={1000} value={deployStrength} onChange={(event) => setDeployStrength(event.target.value)} title="Strength" style={fieldStyle} />
            </div>
            <input type="text" value={deployName} placeholder="Unit name (optional)" onChange={(event) => setDeployName(event.target.value)} style={{ ...fieldStyle, marginBottom: 5 }} />
            <button type="button" onClick={startDeploy} style={{ ...primaryButtonStyle, width: "100%" }}>Place on map →</button>
          </div>

          {selectedUnit && (
            <div style={{ background: "rgba(76,29,149,0.11)", border: "1px solid rgba(139,92,246,0.28)", borderRadius: 9, padding: 8, marginBottom: 8 }}>
              <div style={{ marginBottom: 7 }}>
                <div style={{ color: "#ddd6fe", fontSize: 9, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase" }}>Selected force · authoritative edit</div>
                <div style={{ color: "rgba(255,255,255,0.42)", fontSize: 9, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {polityDisplayName(selectedUnit.ownerCode)} · {selectedUnit.id}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1.2fr", gap: 5, marginBottom: 8 }}>
                <button type="button" onClick={() => flyTo(selectedUnit)} style={quietButtonStyle}>Locate</button>
                <button
                  type="button"
                  onClick={startAdminPlace}
                  title={editDirty ? "Save or reset field edits first" : "Authoritatively relocate this force with one map click"}
                  style={{ ...primaryButtonStyle, opacity: editDirty ? 0.58 : 1 }}
                >
                  Place on map →
                </button>
              </div>

              <label style={smallLabelStyle}>Name</label>
              <input value={editFields.name} onChange={(event) => setEdit("name", event.target.value)} style={{ ...fieldStyle, marginBottom: 6 }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 5.2rem", gap: 6, marginBottom: 6 }}>
                <div>
                  <label style={smallLabelStyle}>Type</label>
                  <select value={editFields.type} onChange={(event) => setEdit("type", event.target.value)} style={fieldStyle}>
                    {UNIT_TYPES.map((type) => <option key={type} value={type} style={optionStyle}>{TYPE_LABEL[type] ?? type}</option>)}
                  </select>
                </div>
                <div>
                  <label style={smallLabelStyle}>Strength</label>
                  <input type="number" min={1} max={1000} value={editFields.strength} onChange={(event) => setEdit("strength", event.target.value)} style={fieldStyle} />
                </div>
              </div>

              <div style={{ marginBottom: 6 }}>
                <label style={smallLabelStyle}>Status</label>
                <select value={editFields.status} onChange={(event) => setEdit("status", event.target.value)} style={fieldStyle}>
                  {statusOptions.map((status) => <option key={status} value={status} style={optionStyle}>{status}</option>)}
                </select>
              </div>

              <details style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, marginBottom: 6, padding: "5px 7px" }}>
                <summary style={{ color: "rgba(255,255,255,0.56)", cursor: "pointer", fontSize: 9.5, fontWeight: 700, userSelect: "none" }}>
                  Manual coordinates · advanced
                </summary>
                <div style={{ color: "rgba(255,255,255,0.34)", fontSize: 8.5, lineHeight: 1.35, margin: "5px 0 6px" }}>
                  Prefer Place on map above. Coordinates remain available for exact repair work.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div>
                    <label style={smallLabelStyle}>Longitude</label>
                    <input type="number" step="0.01" value={editFields.lng} onChange={(event) => setEdit("lng", event.target.value)} style={fieldStyle} />
                  </div>
                  <div>
                    <label style={smallLabelStyle}>Latitude</label>
                    <input type="number" step="0.01" value={editFields.lat} onChange={(event) => setEdit("lat", event.target.value)} style={fieldStyle} />
                  </div>
                </div>
              </details>

              <label style={smallLabelStyle}>Admin note</label>
              <textarea rows={2} value={editFields.note} onChange={(event) => setEdit("note", event.target.value)} placeholder="Optional note" style={{ ...fieldStyle, resize: "vertical", marginBottom: 7 }} />

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 5 }}>
                <button type="button" disabled={!editDirty || saving} onClick={saveEdit} style={{ ...primaryButtonStyle, opacity: !editDirty || saving ? 0.45 : 1, cursor: !editDirty || saving ? "default" : "pointer" }}>
                  {saving ? "Saving…" : "Save authoritative edit"}
                </button>
                <button type="button" disabled={!editDirty || saving} onClick={resetEdit} style={{ ...quietButtonStyle, opacity: !editDirty || saving ? 0.45 : 1 }}>Reset</button>
                <button type="button" disabled={saving} onClick={deleteSelected} style={dangerButtonStyle}>Delete</button>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 5, marginBottom: 6 }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search force, owner, status…" style={fieldStyle} />
            <div style={{ display: "flex", gap: 3 }}>
              {[
                ["all", "All"],
                ["player", "Yours"],
                ["other", "Other"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  style={{
                    ...quietButtonStyle,
                    background: scope === value ? "rgba(91,33,182,0.36)" : quietButtonStyle.background,
                    borderColor: scope === value ? "rgba(139,92,246,0.38)" : "rgba(255,255,255,0.11)",
                    padding: "6px 7px",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ minHeight: 0, overflowY: "auto", paddingRight: 1 }}>
            {filteredUnits.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.36)", fontSize: 10.5, padding: "12px 4px", textAlign: "center" }}>No forces match this view.</div>
            ) : (
              filteredUnits.map((unit) => (
                <ForceRow
                  key={unit.id}
                  unit={unit}
                  selected={unit.id === selectedId}
                  isPlayer={!!playerCode && unit.ownerCode === playerCode}
                  onSelect={selectUnit}
                />
              ))
            )}
          </div>

          {statusText && (
            <div style={{ color: statusText.includes("Failed") || statusText.includes("must") ? "#fecaca" : "#c4b5fd", fontSize: 10, lineHeight: 1.35, marginTop: 6 }}>
              {statusText}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ForcesPanel;
