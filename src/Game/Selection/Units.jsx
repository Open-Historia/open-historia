import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import {
  subscribeUnits,
  getUnitById,
  getPlayerCode,
  setInteractionMode,
  removeUnit,
} from "../Map/unitsController.js";

let _setSelection = null;
let _currentSelection = null;
let _dismiss = null;

// Called by the map click dispatcher (Nations.jsx) when a unit is clicked.
export const onUnitSelected = ({ id, lngLat }) => {
  if (!_setSelection || !id) return;

  if (_currentSelection && _currentSelection.id === id) {
    _dismiss?.();
    return;
  }
  if (_currentSelection) _dismiss?.();
  _setSelection({ id, lngLat });
};

// Called by the dispatcher when a region (or empty space) is selected, so the
// two popups never show at once.
export const dismissUnitPopup = () => {
  if (_currentSelection) _dismiss?.();
};

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

const ANIM_ID = "unit-popup-anims";
if (typeof document !== "undefined" && !document.getElementById(ANIM_ID)) {
  const style = document.createElement("style");
  style.id = ANIM_ID;
  style.textContent = `
  @keyframes unitPopupFadeIn {
    from { opacity: 0; transform: translateY(calc(-100% + 10px)); }
    to   { opacity: 1; transform: translateY(-100%); }
  }
  @keyframes unitPopupFadeOut {
    from { opacity: 1; transform: translateY(-100%); }
    to   { opacity: 0; transform: translateY(calc(-100% + 10px)); }
  }`;
  document.head.appendChild(style);
}

const ActionButton = ({ label, onClick, tone = "neutral" }) => {
  const [hovered, setHovered] = useState(false);
  const tones = {
    neutral: "rgba(255,255,255,0.12)",
    danger: "rgba(220,70,70,0.25)",
    primary: "rgba(59,130,246,0.3)",
  };
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        background: hovered ? "rgba(255,255,255,0.18)" : tones[tone],
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "6px",
        color: "rgba(255,255,255,0.9)",
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: 600,
        padding: "5px 0",
        transition: "background 0.15s",
      }}
    >
      {label}
    </button>
  );
};

const UnitPopup = () => {
  const [selection, setSelection] = useState(null);
  const [unit, setUnit] = useState(null);
  const [screenPos, setScreenPos] = useState(null);
  const [animKey, setAnimKey] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const { current: map } = useMap();

  _setSelection = (value) => {
    _currentSelection = value;
    setDismissing(false);
    setSelection(value);
    setUnit(value ? getUnitById(value.id) : null);
    if (value !== null) setAnimKey((key) => key + 1);
  };

  _dismiss = () => setDismissing(true);

  // Keep the shown unit in sync with controller state; auto-dismiss if it dies.
  useEffect(() => {
    const unsubscribe = subscribeUnits(() => {
      if (!_currentSelection) return;
      const fresh = getUnitById(_currentSelection.id);
      if (!fresh) {
        _dismiss?.();
      } else {
        setUnit(fresh);
      }
    });
    return unsubscribe;
  }, []);

  const handleAnimationEnd = (e) => {
    if (e.animationName !== "unitPopupFadeOut") return;
    _currentSelection = null;
    setSelection(null);
    setUnit(null);
    setDismissing(false);
  };

  useEffect(() => {
    if (!map || !selection) {
      setScreenPos(null);
      return;
    }

    const update = () => {
      const center = map.getCenter();
      const toRad = (deg) => (deg * Math.PI) / 180;
      const anchor = unit && Number.isFinite(unit.lng)
        ? { lng: unit.lng, lat: unit.lat }
        : selection.lngLat;
      const lat1 = toRad(center.lat);
      const lat2 = toRad(anchor.lat);
      const dLng = toRad(anchor.lng - center.lng);
      const cosAngle =
        Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);

      if (cosAngle < 0) {
        setScreenPos(null);
        return;
      }

      const point = map.project(anchor);
      setScreenPos((prev) => {
        if (prev && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5) {
          return prev;
        }
        return { x: point.x, y: point.y };
      });
    };

    let frameId = 0;
    const scheduleUpdate = () => {
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        update();
      });
    };

    update();
    map.on("move", scheduleUpdate);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      map.off("move", scheduleUpdate);
    };
  }, [map, selection, unit]);

  if (!selection || !screenPos || !unit) return null;

  const POPUP_WIDTH = 220;
  const isOwn = unit.ownerCode === getPlayerCode();
  const strengthPct = Math.max(2, Math.min(100, (unit.strength / 1000) * 100));

  const beginMove = () => {
    setInteractionMode({ kind: "move", unitId: unit.id });
    _dismiss?.();
  };
  const beginAttack = () => {
    setInteractionMode({ kind: "attack", unitId: unit.id });
    _dismiss?.();
  };
  const disband = () => {
    removeUnit(unit.id);
    _dismiss?.();
  };

  return createPortal(
    <div
      key={animKey}
      onAnimationEnd={handleAnimationEnd}
      style={{
        position: "fixed",
        left: screenPos.x - POPUP_WIDTH / 2,
        top: screenPos.y - 14,
        width: `${POPUP_WIDTH}px`,
        zIndex: 21,
        pointerEvents: dismissing ? "none" : "auto",
        animation: dismissing
          ? "unitPopupFadeOut 0.18s cubic-bezier(0.4, 0, 1, 1) both"
          : "unitPopupFadeIn 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(17, 24, 39, 0.96)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px 8px" }}>
          <span style={{ fontSize: "1.5rem", lineHeight: 1 }}>{TYPE_GLYPH[unit.type] ?? "🛡"}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "13px", wordBreak: "break-word" }}>{unit.name}</div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>
              {TYPE_LABEL[unit.type] ?? unit.type} · {unit.ownerCode}
            </div>
          </div>
          <button
            onClick={() => _dismiss?.()}
            style={{
              background: "rgba(17,24,39,0.7)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "6px",
              width: "20px",
              height: "20px",
              cursor: "pointer",
              color: "rgba(255,255,255,0.5)",
              fontSize: "11px",
              padding: 0,
              flexShrink: 0,
            }}
          >
            {"✕"}
          </button>
        </div>

        <div style={{ padding: "0 12px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "rgba(255,255,255,0.7)", marginBottom: "3px" }}>
            <span>Strength</span>
            <span style={{ fontWeight: 600, color: "white" }}>{unit.strength}</span>
          </div>
          <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div
              style={{
                width: `${strengthPct}%`,
                height: "100%",
                background: unit.strength > 600 ? "#4ade80" : unit.strength > 250 ? "#fbbf24" : "#f87171",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "7px" }}>
            <span>Status</span>
            <span style={{ color: "rgba(255,255,255,0.9)", textTransform: "capitalize" }}>{unit.status}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "rgba(255,255,255,0.6)", marginTop: "3px" }}>
            <span>Location</span>
            <span style={{ color: "rgba(255,255,255,0.85)" }}>
              {unit.lat.toFixed(1)}, {unit.lng.toFixed(1)}
            </span>
          </div>

          {isOwn ? (
            <div style={{ display: "flex", gap: "5px", marginTop: "10px" }}>
              <ActionButton label="Move" tone="primary" onClick={beginMove} />
              <ActionButton label="Attack" tone="danger" onClick={beginAttack} />
              <ActionButton label="Disband" onClick={disband} />
            </div>
          ) : (
            <div style={{ marginTop: "9px", fontSize: "10px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
              Enemy unit — select one of your own units to attack it.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default UnitPopup;
