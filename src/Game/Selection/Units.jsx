/*! Open Historia — unit intel popup © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// What the player sees when they click a formation.
//
// This used to be a command panel — Move, Attack, Disband. It is now an
// INTELLIGENCE card: what this formation is, what it is made of, what it is
// doing, and what put it there. The only things the player still does from here
// are disband one of their own units and ask, in words, for orders — which
// queues an action the AI weighs on the next jump rather than moving anything now.

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import {
  subscribeUnits,
  getUnitById,
  getUnitOrder,
  getPlayerCode,
  removeUnit,
  requestUnitOrders,
  setInteractionMode,
} from "../Map/unitsController.js";
import { readEventsState } from "../../runtime/gameState.js";
// One posture vocabulary for the popup and the Forces panel — two copies of this
// map would drift and label the same formation two different things.
import { POSTURE_LABEL } from "../GameUI/forces.jsx";
import { isBetaUnits } from "../../runtime/mapSettings.js";
import { haversineKm } from "../../runtime/unitMotion.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";

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

const ActionButton = ({ label, onClick, tone = "neutral", disabled = false }) => {
  const [hovered, setHovered] = useState(false);
  const tones = {
    neutral: "rgba(255,255,255,0.12)",
    danger: "rgba(220,70,70,0.25)",
    primary: "rgba(59,130,246,0.3)",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        background: hovered && !disabled ? "rgba(255,255,255,0.18)" : tones[tone],
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "6px",
        color: disabled ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.9)",
        cursor: disabled ? "default" : "pointer",
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

// One label/value row. Values wrap rather than truncate — "en route to ..., about
// 340 km to go" is the whole point of the row.
const InfoRow = ({ label, children }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: "10px",
      fontSize: "11px",
      color: "rgba(255,255,255,0.6)",
      marginTop: "4px",
    }}
  >
    <span style={{ flexShrink: 0 }}>{label}</span>
    <span style={{ color: "rgba(255,255,255,0.9)", textAlign: "right" }}>{children}</span>
  </div>
);

// Phrased the same way the AI's own prompt text describes standing orders
// (promptContext.js's buildPendingUnitOrdersText), so the UI and the model never
// tell the player two different stories about the same order.
const describeOrder = (unit, order) => {
  if (!order) return null;
  if (order.kind === "patrol") {
    return `Patrolling · ${Math.round(order.radiusKm)} km station`;
  }
  const remaining = Math.round(haversineKm(unit.lat, unit.lng, order.toLat, order.toLng));
  const destination =
    order.targetLabel || `${order.toLat.toFixed(1)}, ${order.toLng.toFixed(1)}`;
  return `En route to ${destination} — about ${remaining} km to go`;
};

const UnitPopup = () => {
  const [selection, setSelection] = useState(null);
  const [unit, setUnit] = useState(null);
  const [order, setOrder] = useState(null);
  const [screenPos, setScreenPos] = useState(null);
  const [animKey, setAnimKey] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [request, setRequest] = useState("");
  const [requestState, setRequestState] = useState("idle"); // idle | sending | queued
  const [originEvent, setOriginEvent] = useState(null);
  const { current: map } = useMap();

  _setSelection = (value) => {
    _currentSelection = value;
    setDismissing(false);
    setSelection(value);
    setUnit(value ? getUnitById(value.id) : null);
    setOrder(value ? getUnitOrder(value.id) : null);
    setRequest("");
    setRequestState("idle");
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
        setOrder(getUnitOrder(_currentSelection.id));
      }
    });
    return unsubscribe;
  }, []);

  // Resolve "what put this formation here" from the event log. Cached by id, so
  // the log is read at most once per selected unit that carries an eventId and
  // never on a render or a map move.
  //
  // The cache used to be the whole log, read ONCE. This popup is mounted for the
  // life of the map, so every unit spawned by an event after that first read
  // resolved to nothing and silently lost its "Detected" row — the card's main
  // reason for existing. Re-read when the id we want is not in hand; a miss is
  // remembered as null so an event that has genuinely aged out of the log costs one
  // read, not one per selection.
  const eventCache = useRef(new Map());
  const eventId = unit?.eventId || "";
  useEffect(() => {
    let cancelled = false;
    if (!eventId) {
      setOriginEvent(null);
      return undefined;
    }
    if (eventCache.current.has(eventId)) {
      setOriginEvent(eventCache.current.get(eventId));
      return undefined;
    }
    const resolve = async () => {
      let events = [];
      try {
        events = await readEventsState({ force: true });
      } catch {
        // A failed read is not an answer: leave the id unrecorded so selecting the
        // unit again tries once more, rather than pinning it to "not found".
        return;
      }
      for (const entry of events) eventCache.current.set(entry.id, entry);
      if (!eventCache.current.has(eventId)) eventCache.current.set(eventId, null);
      if (cancelled) return;
      setOriginEvent(eventCache.current.get(eventId) ?? null);
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const handleAnimationEnd = (e) => {
    if (e.animationName !== "unitPopupFadeOut") return;
    _currentSelection = null;
    setSelection(null);
    setUnit(null);
    setOrder(null);
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

  // Full owner name, never the code (called before the early return —
  // hook order must not depend on the selection).
  const ownerName = useCountryDisplayName(unit?.ownerCode || "");

  if (!selection || !screenPos || !unit) return null;

  const POPUP_WIDTH = 240;
  const isOwn = unit.ownerCode === getPlayerCode();
  // Strength is a percentage of established strength, so the bar is the value.
  const strengthPct = Math.max(2, Math.min(100, unit.strength));
  const orderText = describeOrder(unit, order);
  const postureText = POSTURE_LABEL[unit.posture] || "";
  // Pinned for the session, so the popup can never show one system's controls
  // while the controller is running the other's.
  const betaUnits = isBetaUnits();

  const disband = () => {
    removeUnit(unit.id);
    _dismiss?.();
  };

  // Classic only. Arms a map-click mode; the click dispatcher in Nations.jsx
  // turns the next click into moveUnitTo / attackWith / attackFeature.
  const beginMove = () => {
    setInteractionMode({ kind: "move", unitId: unit.id });
    _dismiss?.();
  };
  const beginAttack = () => {
    setInteractionMode({ kind: "attack", unitId: unit.id });
    _dismiss?.();
  };

  const sendRequest = async () => {
    if (!request.trim() || requestState === "sending") return;
    setRequestState("sending");
    const queued = await requestUnitOrders(unit.id, request);
    setRequestState(queued ? "queued" : "idle");
    if (queued) setRequest("");
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
              {TYPE_LABEL[unit.type] ?? unit.type} · {ownerName}
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
          {/* Its own row rather than a header chip: squeezed in beside the name it
              broke long ones mid-word ("Unidentifie / d / submarine").
              From the player's side of the map a covert insertion and a force they
              have only just noticed look identical, and that ambiguity is the point. */}
          {unit.covert && (
            <div
              title="No confirmed line of support — assessed to have been operating in the area before it was detected."
              style={{
                display: "inline-block",
                background: "rgba(196,181,253,0.18)",
                border: "1px solid rgba(196,181,253,0.5)",
                borderRadius: "5px",
                color: "rgba(221,214,254,0.95)",
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.02em",
                padding: "2px 6px",
                marginBottom: "7px",
              }}
            >
              Unconfirmed contact
            </div>
          )}
          {/* What it is doing, then what it is made of. A counter that says only
              "Naval · 78%" tells the player nothing they can act on. */}
          {unit.note && (
            <div style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.85)", marginBottom: "3px" }}>
              {unit.note}
            </div>
          )}
          {unit.composition && (
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", marginBottom: "7px" }}>
              {unit.composition}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "rgba(255,255,255,0.7)", marginBottom: "3px" }}>
            <span>Strength</span>
            <span style={{ fontWeight: 600, color: "white" }}>{unit.strength}%</span>
          </div>
          <div style={{ height: "6px", borderRadius: "3px", background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div
              style={{
                width: `${strengthPct}%`,
                height: "100%",
                background: unit.strength > 60 ? "#4ade80" : unit.strength > 25 ? "#fbbf24" : "#f87171",
              }}
            />
          </div>

          {/* Posture and standing orders exist only in the beta system; classic
              shows the plain lifecycle status it has always shown. */}
          {betaUnits && postureText && <InfoRow label="Posture">{postureText}</InfoRow>}
          {betaUnits && orderText && <InfoRow label="Orders">{orderText}</InfoRow>}
          {(!betaUnits || !postureText) && <InfoRow label="Status">{unit.status}</InfoRow>}
          <InfoRow label="Location">
            {unit.lat.toFixed(1)}, {unit.lng.toFixed(1)}
          </InfoRow>
          {originEvent && (
            <InfoRow label="Detected">
              {originEvent.date ? `${originEvent.date} — ` : ""}
              {originEvent.title}
            </InfoRow>
          )}

          {/* Classic: the player moves and fights their own units. Both buttons
              arm a map-click mode the dispatcher in Nations.jsx consumes. */}
          {isOwn && !betaUnits && (
            <div style={{ display: "flex", gap: "5px", marginTop: "10px" }}>
              <ActionButton label="Move" tone="primary" onClick={beginMove} />
              <ActionButton label="Attack" tone="danger" onClick={beginAttack} />
              <ActionButton label="Disband" onClick={disband} />
            </div>
          )}

          {isOwn && betaUnits && (
            <>
              {/* Intent, not control: this queues an action for the AI to weigh on
                  the next jump. Nothing on the map moves now. */}
              <textarea
                value={request}
                onChange={(e) => {
                  setRequest(e.target.value);
                  if (requestState === "queued") setRequestState("idle");
                }}
                rows={2}
                placeholder="Request orders, e.g. move to the Med"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginTop: "10px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "6px",
                  color: "white",
                  fontFamily: "inherit",
                  fontSize: "11px",
                  padding: "5px 6px",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", gap: "5px", marginTop: "6px" }}>
                <ActionButton
                  label={requestState === "queued" ? "✓ Queued" : requestState === "sending" ? "Queueing…" : "Request orders"}
                  tone="primary"
                  disabled={requestState !== "idle" || !request.trim()}
                  onClick={sendRequest}
                />
                <ActionButton label="Disband" onClick={disband} />
              </div>
              {requestState === "queued" && (
                <div style={{ marginTop: "5px", fontSize: "10px", color: "rgba(255,255,255,0.45)", textAlign: "center" }}>
                  Added to your actions for this round.
                </div>
              )}
            </>
          )}

          {/* Classic: the only thing telling a player how attacking works. The
              two branches above are both `isOwn && …`, so replacing the old
              `isOwn ? buttons : hint` pair with them left a foreign unit's popup
              rendering nothing at all. Beta needs no hint — nobody attacks by
              hand there, and the card is an intelligence readout on its own. */}
          {!isOwn && !betaUnits && (
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
