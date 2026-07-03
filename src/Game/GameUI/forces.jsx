/*! Open Historia — Forces panel © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { useCallback, useEffect, useState } from "react";
import {
  subscribeUnits,
  getUnits,
  getPlayerCode,
  getAllowedUnitTypes,
  getInteractionMode,
  setInteractionMode,
  clearInteractionMode,
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

const MODE_HINT = {
  deploy: "Click the map to place your unit",
  move: "Click a destination to move the unit",
  attack: "Click an enemy unit to attack",
};

const surface = {
  backgroundColor: "rgba(17, 24, 39, 0.92)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  color: "white",
  fontFamily: "sans-serif",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const UnitRow = ({ unit, dimmed, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      padding: "6px 8px",
      marginBottom: "5px",
      cursor: "pointer",
      color: "white",
      textAlign: "left",
      opacity: dimmed ? 0.65 : 1,
    }}
  >
    <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{TYPE_GLYPH[unit.type] ?? "🛡"}</span>
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {unit.name}
      </div>
      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.55)" }}>
        {TYPE_LABEL[unit.type] ?? unit.type} · {polityDisplayName(unit.ownerCode)} · {unit.status}
      </div>
    </div>
    <span style={{ fontSize: "12px", fontWeight: 700, color: unit.strength > 600 ? "#4ade80" : unit.strength > 250 ? "#fbbf24" : "#f87171" }}>
      {unit.strength}
    </span>
  </button>
);

// Controlled panel: the launcher button lives in the bottom toolbar (chat.jsx
// Toolbar) alongside Chat and Actions; main.jsx owns the open state.
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

  useEffect(() => {
    const unsubscribe = subscribeUnits(() => {
      setUnits(getUnits());
      setMode(getInteractionMode());
      setAllowedTypes(getAllowedUnitTypes());
    });
    return unsubscribe;
  }, []);

  // Owner codes render as full names; re-render once the lookup is warm.
  const [, setNamesEpoch] = useState(0);
  useEffect(() => {
    ensurePolityNames().then(() => setNamesEpoch((epoch) => epoch + 1)).catch(() => {});
  }, [units.length]);

  // The scenario may restrict deployable troop types (e.g. no air in 1200).
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
  const myUnits = units.filter((u) => u.ownerCode && u.ownerCode === playerCode);
  const otherUnits = units.filter((u) => !playerCode || u.ownerCode !== playerCode);

  const flyTo = useCallback(
    (unit) => {
      const map = mapRef?.current?.getMap?.() ?? mapRef?.current;
      map?.flyTo?.({ center: [unit.lng, unit.lat], zoom: Math.max(map.getZoom?.() ?? 4, 4.5) });
    },
    [mapRef],
  );

  const startDeploy = () => {
    const name = deployName.trim() || `${TYPE_LABEL[deployType]} ${myUnits.length + 1}`;
    setInteractionMode({
      kind: "deploy",
      params: { type: deployType, strength: Math.max(1, Math.min(1000, Number(deployStrength) || 100)), name },
    });
    setOpen(false);
  };

  return (
    <>
      {/* Mode banner — global instruction while deploying / moving / attacking. */}
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
            gap: "12px",
            padding: "8px 14px",
            fontSize: "13px",
          }}
        >
          <span>{MODE_HINT[mode.kind] ?? "Select a target"}</span>
          <button
            onClick={() => clearInteractionMode()}
            style={{
              background: "rgba(220,70,70,0.25)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "6px",
              color: "white",
              cursor: "pointer",
              fontSize: "11px",
              padding: "3px 9px",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {open && (
        <div
          style={{
            ...surface,
            position: "fixed",
            bottom: "4.75rem",
            left: "0.5rem",
            width: "17rem",
            maxHeight: "60vh",
            display: "flex",
            flexDirection: "column",
            zIndex: 9999,
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <strong style={{ fontSize: "14px" }}>Forces</strong>
            <button
              onClick={() => setOpen(false)}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "14px" }}
            >
              ✕
            </button>
          </div>

          {/* Deploy controls */}
          <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "8px", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "6px" }}>Deploy a unit</div>
            <div style={{ display: "flex", gap: "5px", marginBottom: "6px" }}>
              <select
                value={deployType}
                onChange={(e) => setDeployType(e.target.value)}
                style={{ flex: 1, background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px", fontSize: "12px" }}
              >
                {availableTypes.map((t) => (
                  <option key={t} value={t} style={{ color: "black" }}>
                    {TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={1000}
                value={deployStrength}
                onChange={(e) => setDeployStrength(e.target.value)}
                title="Strength"
                style={{ width: "4rem", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px", fontSize: "12px" }}
              />
            </div>
            <input
              type="text"
              value={deployName}
              placeholder="Unit name (optional)"
              onChange={(e) => setDeployName(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px", fontSize: "12px", marginBottom: "6px" }}
            />
            <button
              onClick={startDeploy}
              style={{ width: "100%", background: "rgba(59,130,246,0.35)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "white", cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "6px 0" }}
            >
              Place on map →
            </button>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", margin: "0 0 5px" }}>
              Your units ({myUnits.length})
            </div>
            {myUnits.length === 0 && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginBottom: "8px" }}>
                None yet — deploy a unit above, or jump time to let the war unfold.
              </div>
            )}
            {myUnits.map((u) => (
              <UnitRow key={u.id} unit={u} onClick={() => flyTo(u)} />
            ))}

            {otherUnits.length > 0 && (
              <>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", margin: "8px 0 5px" }}>
                  Other forces ({otherUnits.length})
                </div>
                {otherUnits.map((u) => (
                  <UnitRow key={u.id} unit={u} dimmed onClick={() => flyTo(u)} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ForcesPanel;
