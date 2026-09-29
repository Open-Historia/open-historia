/*! Open Historia — Forces panel © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React, { useCallback, useEffect, useState } from "react";
import {
  subscribeUnits,
  getUnits,
  getPlayerCode,
  getAllowedUnitTypes,
  getInteractionMode,
  setInteractionMode,
  clearInteractionMode,
  updateUnitAdmin,
  UNIT_NOT_SAVED,
} from "../Map/unitsController.js";
import { UNIT_STATUSES, UNIT_TYPES } from "../../runtime/gameState.js";
import { ensurePolityNames, polityDisplayName, subscribePolityNames } from "../../runtime/polityNames.js";
import { APP_HEIGHT, SAFE_BOTTOM, SAFE_LEFT, SAFE_TOP, useTouchPrimary } from "../../runtime/mobileUi.js";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { useBackToClose } from "../../runtime/backToClose.js";
import { TURN_RUNNING_NOTE } from "../AI/simulationStatus.js";
import { useTurnRunning } from "./useTurnRunning.js";

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

// Strength is a percentage of the formation's established strength, so the bands
// are readable: near full, worn down, or a shell of itself.
export const strengthColor = (strength) =>
  strength > 60 ? "#4ade80" : strength > 25 ? "#fbbf24" : "#f87171";

// Intent, in the player's language rather than the schema's. Shared with the unit
// popup (Selection/Units.jsx), which imports it from here — the two must not
// disagree about what "massing" is called.
export const POSTURE_LABEL = {
  holding: "Holding position",
  massing: "Massing",
  patrol: "Patrolling",
  transit: "In transit",
  exercise: "On exercise",
  blockade: "Blockading",
  withdrawing: "Withdrawing",
  assaulting: "Assaulting",
};

const MODE_HINT = {
  deploy: "Click the map to place your unit",
  "admin-place": "Click the map to move this unit",
};
// The same instruction where there is no mouse to click with.
const TOUCH_MODE_HINT = {
  deploy: "Tap the map to place your unit",
  "admin-place": "Tap the map to move this unit",
};

const STATUS_LABEL = {
  idle: "Idle",
  moving: "Moving",
  engaged: "Engaged",
  defeated: "Defeated",
  pending: "Pending",
};

const surface = {
  backgroundColor: "rgba(24, 24, 27, 0.92)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "12px",
  color: "white",
  fontFamily: "sans-serif",
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

// What the row says a formation is doing: its posture — the AI's statement of
// intent, which the engine acts on — falling back to the lifecycle status.
//
// The label is the player's word for it, not the schema's token — "Holding
// position", not "holding" — matching the unit popup, which reads POSTURE_LABEL
// from here.
const unitActivity = (unit) => POSTURE_LABEL[unit.posture] || unit.posture || unit.status;

const UnitRow = ({ unit, dimmed, onClick }) => (
  <button
    className="oh-tap-row"
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flex: 1,
      minWidth: 0,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      padding: "6px 8px",
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
        {TYPE_LABEL[unit.type] ?? unit.type} · {polityDisplayName(unit.ownerCode)} · {unitActivity(unit)}
      </div>
    </div>
    <span style={{ fontSize: "12px", fontWeight: 700, color: strengthColor(unit.strength) }}>
      {unit.strength}%
    </span>
  </button>
);

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(0,0,0,0.3)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "6px",
  padding: "4px",
  fontSize: "12px",
};
const smallButtonStyle = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "6px",
  color: "white",
  cursor: "pointer",
  fontSize: "11px",
  padding: "4px 8px",
};

// The Force Manager's repair form (Cheats → Force Manager opens this panel):
// what a unit is called, what it is, how strong, its status and its note,
// written straight to the unit (updateUnitAdmin) — no order, no AI step — and
// a hand placement anywhere on the map (the admin-place mode Nations.jsx
// handles with placeUnitAdmin).
const UnitEditor = ({ unit, onPlace, onClose }) => {
  const [name, setName] = useState(unit.name);
  const [type, setType] = useState(unit.type);
  const [strength, setStrength] = useState(unit.strength);
  const [status, setStatus] = useState(unit.status);
  const [note, setNote] = useState(unit.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    let saved = null;
    try {
      saved = await updateUnitAdmin(unit.id, {
        name: name.trim() || unit.name,
        type,
        strength: Math.max(1, Math.min(100, Number(strength) || unit.strength)),
        status,
        note: note.trim(),
      });
    } catch (failure) {
      console.error("Failed to edit unit:", failure);
    }
    setSaving(false);
    if (saved) onClose();
    else setError(UNIT_NOT_SAVED);
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "8px", margin: "-2px 0 7px", display: "flex", flexDirection: "column", gap: "5px" }}>
      <input className="oh-tap-row" type="text" value={name} aria-label="Unit name" onChange={(e) => setName(e.target.value)} style={fieldStyle} />
      <div style={{ display: "flex", gap: "5px" }}>
        <select className="oh-tap-row" value={type} aria-label="Unit type" onChange={(e) => setType(e.target.value)} style={{ ...fieldStyle, flex: 1 }}>
          {UNIT_TYPES.map((entry) => (
            <option key={entry} value={entry} style={{ color: "black" }}>{TYPE_LABEL[entry] ?? entry}</option>
          ))}
        </select>
        <input
          className="oh-tap-row"
          type="number"
          min={1}
          max={100}
          value={strength}
          aria-label="Strength"
          title="Strength, as a percentage of the formation's established strength"
          onChange={(e) => setStrength(e.target.value)}
          style={{ ...fieldStyle, width: "4rem" }}
        />
      </div>
      <select className="oh-tap-row" value={status} aria-label="Unit status" onChange={(e) => setStatus(e.target.value)} style={fieldStyle}>
        {UNIT_STATUSES.map((entry) => (
          <option key={entry} value={entry} style={{ color: "black" }}>{STATUS_LABEL[entry] ?? entry}</option>
        ))}
      </select>
      <input className="oh-tap-row" type="text" value={note} placeholder="Note (optional)" aria-label="Note" onChange={(e) => setNote(e.target.value)} style={fieldStyle} />
      {error && <div role="alert" style={{ color: "#fca5a5", fontSize: "11px" }}>{error}</div>}
      <div style={{ display: "flex", gap: "5px" }}>
        <button className="oh-tap-row" onClick={save} disabled={saving} style={{ ...smallButtonStyle, flex: 1, background: "rgba(59,130,246,0.35)", fontWeight: 600 }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="oh-tap-row" onClick={onPlace} style={{ ...smallButtonStyle, flex: 1 }}>Move on map</button>
        <button className="oh-tap-row" onClick={onClose} style={smallButtonStyle}>Cancel</button>
      </div>
    </div>
  );
};

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
  const [deployComposition, setDeployComposition] = useState("");
  const [deployName, setDeployName] = useState("");
  const isMobile = useIsMobile();
  const isTouch = useTouchPrimary();
  // On a phone, either way up, the deploy form scrolls with the units under
  // the header. With the form held fixed and every field finger-sized, a
  // landscape screen had no room left for the list, and the form spilled out
  // of the panel.
  const scrollAsOne = isMobile || isTouch;
  // A unit placed while a turn runs would be gone when it lands
  // (unitsController.js), so placing waits for it.
  const turnRunning = useTurnRunning(open);

  useEffect(() => {
    const unsubscribe = subscribeUnits(() => {
      setUnits(getUnits());
      setMode(getInteractionMode());
      setAllowedTypes(getAllowedUnitTypes());
    });
    return unsubscribe;
  }, []);

  // A placement waiting for its tap on the map is the thing on top: on a phone,
  // Back cancels it, as the banner's Cancel does.
  useBackToClose(mode.kind !== "idle", clearInteractionMode);

  // Owner codes render as full names; re-render once the lookup is warm and
  // whenever a world write changes them.
  const [, setNamesEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setNamesEpoch((epoch) => epoch + 1);
    const unsubscribe = subscribePolityNames(bump);
    ensurePolityNames().then(bump).catch(() => {});
    return unsubscribe;
  }, []);

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
    if (turnRunning) return;
    const name = deployName.trim() || `${TYPE_LABEL[deployType]} ${myUnits.length + 1}`;
    setInteractionMode({
      kind: "deploy",
      params: {
        type: deployType,
        // Percent of established strength, not an abstract score.
        strength: Math.max(1, Math.min(100, Number(deployStrength) || 100)),
        name,
        composition: deployComposition.trim(),
      },
    });
    setOpen(false);
  };

  // Each row flies to its unit; the pencil opens the Force Manager's repair
  // form under it (UnitEditor).
  const [editingId, setEditingId] = useState("");
  const renderUnit = (u, dimmed) => (
    <div key={u.id}>
      <div style={{ display: "flex", gap: "5px", marginBottom: "5px" }}>
        <UnitRow unit={u} dimmed={dimmed} onClick={() => flyTo(u)} />
        <button
          className="oh-tap"
          aria-label="Edit this unit"
          title="Edit this unit"
          aria-expanded={editingId === u.id}
          onClick={() => setEditingId((current) => (current === u.id ? "" : u.id))}
          style={{ ...smallButtonStyle, flexShrink: 0, width: "2rem", padding: 0 }}
        >
          ✎
        </button>
      </div>
      {editingId === u.id && (
        <UnitEditor
          unit={u}
          onClose={() => setEditingId("")}
          onPlace={() => {
            setInteractionMode({ kind: "admin-place", unitId: u.id });
            setEditingId("");
            setOpen(false);
          }}
        />
      )}
    </div>
  );

  return (
    <>
      {/* Mode banner — global instruction while deploying / moving / attacking. */}
      {mode.kind !== "idle" && (
        <div
          style={{
            ...surface,
            position: "fixed",
            top: `calc(4.5rem + ${SAFE_TOP})`,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "8px 14px",
            fontSize: "13px",
            // Centred from left: 50%, the banner may only be half the screen
            // wide, which squeezed the hint into a column on a phone. There it
            // is as wide as its words, up to the screen, and wraps past that.
            ...(isMobile
              ? { flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100vw - 1rem)", width: "max-content" }
              : null),
          }}
        >
          {/* A placement that could not be saved stays armed and says why. */}
          <span role={mode.error ? "alert" : undefined} style={mode.error ? { color: "#fca5a5" } : undefined}>
            {mode.error || ((isTouch ? TOUCH_MODE_HINT : MODE_HINT)[mode.kind] ?? "Select a target")}
          </span>
          <button
            className="oh-tap-row"
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
            bottom: `calc(4.75rem + ${SAFE_BOTTOM})`,
            left: `calc(0.5rem + ${SAFE_LEFT})`,
            width: "17rem",
            // 60% of the height the screen actually shows, which follows a
            // phone's address bar and keyboard; 60vh is of the tallest it can.
            maxHeight: `calc(${APP_HEIGHT} * 0.6)`,
            display: "flex",
            flexDirection: "column",
            zIndex: 9999,
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <strong style={{ fontSize: "14px" }}>Forces</strong>
            <button
              className="oh-tap"
              onClick={() => setOpen(false)}
              aria-label="Close forces"
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "14px" }}
            >
              ✕
            </button>
          </div>

          {/* On a phone, one scroller for the form and the units. On a desktop
              it is not there as far as layout goes (display: contents), so its
              children keep the panel's indentation. */}
          <div style={scrollAsOne ? { flex: 1, minHeight: 0, overflowY: "auto" } : { display: "contents" }}>
          {/* Deploy controls */}
          <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: "8px", padding: "8px", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", marginBottom: "6px" }}>Deploy a unit</div>
            <div style={{ display: "flex", gap: "5px", marginBottom: "6px" }}>
              <select
                className="oh-tap-row"
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
                className="oh-tap-row"
                min={1}
                max={100}
                value={deployStrength}
                onChange={(e) => setDeployStrength(e.target.value)}
                title="Strength, as a percentage of the formation's established strength"
                style={{ width: "4rem", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px", fontSize: "12px" }}
              />
            </div>
            <input
              type="text"
              className="oh-tap-row"
              value={deployName}
              placeholder="Unit name (optional)"
              onChange={(e) => setDeployName(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px", fontSize: "12px", marginBottom: "6px" }}
            />
            {/* What the formation actually IS. A counter that only says "Naval, 78%"
                tells the player nothing; "1 aircraft carrier, 2 frigates" does. */}
            <input
              type="text"
              className="oh-tap-row"
              value={deployComposition}
              placeholder="Composition, e.g. 2 frigates (optional)"
              onChange={(e) => setDeployComposition(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "4px", fontSize: "12px", marginBottom: "6px" }}
            />
            <button
              className="oh-tap-row"
              onClick={startDeploy}
              disabled={turnRunning}
              style={{ width: "100%", background: "rgba(59,130,246,0.35)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: turnRunning ? "rgba(255,255,255,0.4)" : "white", cursor: turnRunning ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 600, padding: "6px 0" }}
            >
              Place on map →
            </button>
            {turnRunning && (
              <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", marginTop: "5px" }}>
                {TURN_RUNNING_NOTE}
              </div>
            )}
          </div>

          <div style={scrollAsOne ? undefined : { overflowY: "auto", flex: 1 }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", margin: "0 0 5px" }}>
              Your units ({myUnits.length})
            </div>
            {myUnits.length === 0 && (
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginBottom: "8px" }}>
                None yet — deploy a unit above, or jump time to let the war unfold.
              </div>
            )}
            {myUnits.map((u) => renderUnit(u, false))}

            {otherUnits.length > 0 && (
              <>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", margin: "8px 0 5px" }}>
                  Other forces ({otherUnits.length})
                </div>
                {otherUnits.map((u) => renderUnit(u, true))}
              </>
            )}
          </div>
          </div>{/* the phone scroller */}
        </div>
      )}
    </>
  );
};

export default ForcesPanel;
